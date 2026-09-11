/**
 * Terminology protection for comment translation.
 *
 * Problem: machine translation APIs tend to translate (or mangle) things that
 * should stay verbatim — API names (`WorldClockReloadTimeMarkerError`), code
 * spans (`onCreate`), URLs, template placeholders (`%s`), and project-specific
 * terminology (`DisplaySlotId`).
 *
 * Solution: before sending text to the translator we replace every protected
 * fragment with a unique placeholder (`\uE000` private-use codepoints); after
 * translation we put the *original* fragment back. Because the placeholder is
 * a single "letter" the API treats it as opaque and never translates it.
 *
 * The protector is fully backend-agnostic: it sits between the engine and
 * `ITranslator.translateBatch`, so DeepL, Google, or any future backend all
 * benefit automatically.
 *
 * Glossary file format (UTF-8 JSON):
 *   {
 *     "terms": ["DisplaySlotId", "WorldClock", "scoreboard"],
 *     "identifiers": { "protected": true },   // auto-detect code-like words
 *     "urls": true,
 *     "codeSpans": true,
 *     "placeholders": true
 *   }
 *
 * `terms` may also be a record for explicit source→target hints
 * (currently used as a protection list; the mapping is reserved for a future
 * "semantic polish" pass):
 *   { "terms": { "scoreboard": "记分板", "DisplaySlotId": "显示槽位 ID" } }
 */

/** Configuration for the term protector. */
export interface TermProtectorOptions {
  /** Explicit terms to protect (highest priority). */
  terms?: string[];
  /** Path to a glossary JSON file (see format above). */
  glossaryFile?: string;
  /** Auto-protect code-like identifiers (camelCase / PascalCase / snake_case). */
  protectIdentifiers?: boolean;
  /** Protect HTTP(S) URLs and `www.` links. */
  protectUrls?: boolean;
  /** Protect backtick `code` spans. */
  protectCodeSpans?: boolean;
  /** Protect printf-style placeholders (%s, %d, %1$s, {0}, ${name}). */
  protectPlaceholders?: boolean;
}

interface GlossaryFile {
  terms?: string[] | Record<string, string>;
  identifiers?: boolean;
  urls?: boolean;
  codeSpans?: boolean;
  placeholders?: boolean;
}

/**
 * A token replaced by a placeholder. `original` is the exact source substring
 * (preserving case / punctuation) so restoration is lossless.
 */
interface ProtectedToken {
  placeholder: string;
  original: string;
}

const PLACEHOLDER_BASE = 0xe000; // Unicode private-use area
const MAX_PLACEHOLDERS = 0x1000; // 4096 — far more than any single comment needs

/**
 * Replaces protected fragments with placeholders and restores them after
 * translation. Instances are single-use per batch (create one per file, or
 * call `reset()` between files).
 */
export class TermProtector {
  private readonly terms = new Set<string>();
  private readonly opts: Required<Omit<TermProtectorOptions, 'terms' | 'glossaryFile'>> & {
    glossaryFile?: string;
  };
  private nextId = 0;
  private map = new Map<string, string>(); // placeholder -> original
  private seqByOriginal = new Map<string, string>(); // original -> placeholder (dedup)

  constructor(options: TermProtectorOptions = {}) {
    this.opts = {
      protectIdentifiers: options.protectIdentifiers !== false, // default true
      protectUrls: options.protectUrls !== false,
      protectCodeSpans: options.protectCodeSpans !== false,
      protectPlaceholders: options.protectPlaceholders !== false,
      glossaryFile: options.glossaryFile,
    };

    // Load glossary file (optional — missing/invalid is a warning, not fatal).
    if (options.glossaryFile) {
      this.loadGlossary(options.glossaryFile);
    }

    // Explicit terms win over file defaults.
    if (options.terms) {
      for (const t of options.terms) this.terms.add(t);
    }
  }

  /** Number of distinct protected fragments in the current batch. */
  get protectedCount(): number {
    return this.map.size;
  }

  /** Reset placeholder state — call between unrelated texts / files. */
  reset(): void {
    this.nextId = 0;
    this.map.clear();
    this.seqByOriginal.clear();
  }

  /**
   * Replace every protected fragment in `text` with a placeholder.
   * Safe to call repeatedly (idempotent-ish: placeholders are never re-entrant).
   */
  protect(text: string): string {
    if (!text) return text;

    // 1. Explicit terms (longest first → substrings don't shadow parents).
    const terms = [...this.terms].sort((a, b) => b.length - a.length);
    for (const term of terms) {
      if (!term) continue;
      text = this.replaceWholeWord(text, term);
    }

    // 2. URLs.
    if (this.opts.protectUrls) {
      text = text.replace(/\bhttps?:\/\/[^\s<]+/gi, m => this.alloc(m));
      text = text.replace(/\bwww\.[^\s<]+\.[^\s<]+/gi, m => this.alloc(m));
    }

    // 3. Backtick code spans (must run before identifier detection).
    if (this.opts.protectCodeSpans) {
      text = text.replace(/`[^`]+`/g, m => this.alloc(m));
    }

    // 4. Placeholders: %s, %1$s, {0}, ${name}.
    if (this.opts.protectPlaceholders) {
      text = text.replace(/%\d*\$?[a-z]/gi, m => this.alloc(m)); // %s, %1$s, %d
      text = text.replace(/\{\d+\}/g, m => this.alloc(m));       // {0}, {1}
      text = text.replace(/\$\{[^}]+\}/g, m => this.alloc(m));    // ${name}
    }

    // 5. Code-like identifiers (camelCase, PascalCase, snake_case, UPPER_CASE).
    if (this.opts.protectIdentifiers) {
      text = text.replace(/\b[A-Z][A-Za-z0-9]*_[A-Z0-9_]*\b/g, m => this.alloc(m)); // UPPER_SNAKE
      text = text.replace(/\b[A-Z][a-z0-9]+[A-Z][A-Za-z0-9]*\b/g, m => this.alloc(m)); // PascalCase
      text = text.replace(/\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b/g, m => this.alloc(m)); // camelCase
      text = text.replace(/\b[a-z][a-z0-9]*_[a-z0-9_]+\b/g, m => this.alloc(m)); // snake_case
    }

    return text;
  }

  /**
   * Restore placeholders in a (translated) text back to their originals.
   * Unknown placeholders are left untouched.
   */
  restore(text: string): string {
    if (!text || this.map.size === 0) return text;
    return text.replace(/[\uE000-\uF8FF]+/g, seq => {
      const original = this.map.get(seq);
      return original !== undefined ? original : seq;
    });
  }

  /** Translate many texts in one pass, protecting + restoring each. */
  protectBatch(texts: string[]): string[] {
    this.reset();
    return texts.map(t => this.protect(t));
  }

  /** Counterpart to `protectBatch`: restore an aligned array of translations. */
  restoreBatch(translations: string[]): string[] {
    return translations.map(t => this.restore(t));
  }

  // ------------------------------------------------------------------ //
  //  Internals                                                          //
  // ------------------------------------------------------------------ //

  private alloc(original: string): string {
    const existing = this.seqByOriginal.get(original);
    if (existing) return existing;
    if (this.nextId >= MAX_PLACEHOLDERS) {
      // Extremely unlikely, but keep the mapping stable instead of crashing.
      return original;
    }
    // Two code-points so a single surrogate-ish slot is never ambiguous.
    const seq =
      String.fromCharCode(PLACEHOLDER_BASE + this.nextId) +
      String.fromCharCode(PLACEHOLDER_BASE + this.nextId + 1);
    this.nextId++;
    this.seqByOriginal.set(original, seq);
    this.map.set(seq, original);
    return seq;
  }

  /**
   * Replace `term` only when it forms a whole "word" (so `List` does not
   * clobber `ListItem`). Falls back to a literal scan when the term contains
   * non-word characters (e.g. `v2.1`).
   */
  private replaceWholeWord(text: string, term: string): string {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const isWordy = /^[A-Za-z0-9_.-]+$/.test(term);
    const re = isWordy
      ? new RegExp(`(?<!\\w)${escaped}(?!\\w)`, 'g')
      : new RegExp(escaped.replace(/\$/g, '\\$'), 'g');
    return text.replace(re, () => this.alloc(term));
  }

  private loadGlossary(filePath: string): void {
    let raw: string;
    try {
      raw = require('fs').readFileSync(filePath, 'utf-8');
    } catch (e: any) {
      console.warn(`[term-protector] warning: cannot read glossary "${filePath}" (${e.message})`);
      return;
    }

    let parsed: GlossaryFile;
    try {
      parsed = JSON.parse(raw);
    } catch (e: any) {
      console.warn(`[term-protector] warning: glossary "${filePath}" is not valid JSON (${e.message})`);
      return;
    }

    if (Array.isArray(parsed.terms)) {
      for (const t of parsed.terms as string[]) this.terms.add(t);
    } else if (parsed.terms && typeof parsed.terms === 'object') {
      // Record form: keys are the protected terms (values reserved for future use).
      for (const key of Object.keys(parsed.terms)) this.terms.add(key);
    }

    // File-level toggles (explicit false overrides the constructor default).
    if (parsed.identifiers === false) this.opts.protectIdentifiers = false;
    if (parsed.urls === false) this.opts.protectUrls = false;
    if (parsed.codeSpans === false) this.opts.protectCodeSpans = false;
    if (parsed.placeholders === false) this.opts.protectPlaceholders = false;
  }
}
