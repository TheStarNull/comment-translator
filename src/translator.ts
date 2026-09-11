/**
 * Translator interface and DeepL Free API implementation.
 *
 * For production use with real DeepL translation:
 *   npm install deepl-node dotenv
 *
 * DeepL Free vs Pro:
 *   - Free API key ends with ":fx" (e.g. "xxxx-xxxx-xxxx:fx")
 *   - The official client auto-selects the endpoint based on the key suffix
 *     (api-free.deepl.com for Free, api.deepl.com for Pro).
 *
 * This module uses dynamic import for deepl-node to avoid a hard dependency
 * (the mock translator works without it).
 *
 * Supported target language codes: ZH (简体), ZH-HANT (繁体), EN, JA, KO, DE,
 * FR, ES, RU, PT-BR ... (see DeepL docs for the full list).
 */

export type DeepLFormality = 'default' | 'prefer_less' | 'prefer_more' | 'less' | 'more';

export interface DeepLTranslatorOptions {
  /** DeepL API auth key (defaults to process.env.DEEPL_API_KEY) */
  apiKey?: string;
  /** Force Free or Pro endpoint. If omitted, auto-detect by key suffix (:fx). */
  free?: boolean;
  /** Source language code (e.g. 'EN'). Omit for auto-detect. */
  sourceLang?: string;
  /** Target language code (e.g. 'ZH', 'EN', 'JA'). Defaults to 'ZH'. */
  targetLang?: string;
  /** Formality preference (DeepL only, ignored by other translators). */
  formality?: DeepLFormality;
  /** Glossary ID for consistent terminology. */
  glossaryId?: string;
  /** Preserve formatting (punctuation, whitespace). Default true. */
  preserveFormatting?: boolean;
  /** Split sentences: 'on' | 'off' | 'nonewlines'. Default 'nonewlines'. */
  splitSentences?: 'on' | 'off' | 'nonewlines';
  /** Max texts per batch request (DeepL max is 50). Default 50. */
  maxBatch?: number;
  /** Max retry attempts on 429/456/5xx. Default 3. */
  maxRetries?: number;
}

/**
 * Common translator interface - all translators must implement this.
 * `target` is optional per-call; each translator stores a default target
 * (the engine calls translateBatch(items) without an argument).
 */
export interface ITranslator {
  translate(text: string, target?: string): Promise<string>;
  translateBatch(texts: string[], target?: string): Promise<string[]>;
}

/**
 * DeepL translator (uses deepl-node, dynamically imported).
 * Implements ITranslator. Compatible with GoogleTranslator's old shape
 * (translateText / translateBatch) via aliases.
 */
export class DeepLTranslator implements ITranslator {
  private opts: Required<Pick<DeepLTranslatorOptions, 'maxBatch' | 'maxRetries' | 'targetLang'>> &
    DeepLTranslatorOptions;
  private client: any = null;
  private initialized = false;

  constructor(options: DeepLTranslatorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.DEEPL_API_KEY ?? '';
    if (!apiKey) {
      throw new Error(
        'DeepLTranslator: DEEPL_API_KEY is not configured. ' +
          'Set it via options.apiKey or the DEEPL_API_KEY env var.'
      );
    }

    this.opts = {
      apiKey,
      targetLang: options.targetLang ?? 'ZH',
      maxBatch: options.maxBatch ?? 50,
      maxRetries: options.maxRetries ?? 3,
      formality: options.formality,
      preserveFormatting: options.preserveFormatting ?? true,
      splitSentences: options.splitSentences ?? 'nonewlines',
      sourceLang: options.sourceLang,
      glossaryId: options.glossaryId,
      free: options.free,
    };
  }

  /**
   * Lazily initialize the DeepL client.
   * The endpoint is chosen by:
   *   1. explicit options.free  -> true: api-free.deepl.com, false: api.deepl.com
   *   2. else, key ends with ":fx" -> Free endpoint, otherwise Pro
   */
  private async init(): Promise<void> {
    if (this.initialized) return;

    let deepl: any;
    try {
      deepl = await import('deepl-node');
    } catch (err: any) {
      throw new Error(
        'Failed to load deepl-node. Install it with: npm install deepl-node\n' +
          'Original error: ' + err.message
      );
    }

    const DeepLClientCtor = deepl.DeepLClient ?? deepl.Translator;
    if (!DeepLClientCtor) {
      throw new Error('deepl-node is installed but DeepLClient / Translator export was not found.');
    }

    // Determine server URL
    // (apiKey is guaranteed non-empty here due to the constructor check)
    const apiKey: string = this.opts.apiKey!;
    let serverUrl: string | undefined;
    if (this.opts.free === true) {
      serverUrl = 'https://api-free.deepl.com';
    } else if (this.opts.free === false) {
      serverUrl = 'https://api.deepl.com';
    } else if (apiKey.endsWith(':fx')) {
      serverUrl = 'https://api-free.deepl.com';
    } else {
      serverUrl = 'https://api.deepl.com';
    }

    this.client = new DeepLClientCtor(apiKey, { serverUrl });
    this.initialized = true;
  }

  /**
   * Normalize our internal language code to DeepL's expected format (uppercase).
   * Accepts "zh" / "zh-CN" -> "ZH", "en" -> "EN", "pt-br" -> "PT-BR".
   */
  private normalizeLang(lang: string | undefined, fallback: string): string {
    const raw = (lang ?? fallback).trim();
    // Map common lower-case / region variants
    const map: Record<string, string> = {
      zh: 'ZH', 'zh-cn': 'ZH', 'zh-hans': 'ZH',
      'zh-tw': 'ZH-HANT', 'zh-hant': 'ZH-HANT', 'zh-hk': 'ZH-HANT',
      en: 'EN', ja: 'JA', ko: 'KO', de: 'DE', fr: 'FR', es: 'ES',
      ru: 'RU', it: 'IT', pt: 'PT-BR', 'pt-br': 'PT-BR', 'pt-pt': 'PT-PT',
    };
    const lower = raw.toLowerCase();
    if (map[lower]) return map[lower];
    // Already in DeepL format like "ZH-HANT"
    return raw.toUpperCase();
  }

  private getTarget(target?: string): string {
    return this.normalizeLang(target, this.opts.targetLang);
  }

  /**
   * Build the 4th-argument options bag for deepl-node's translateText.
   * NOTE: deepl-node v1 signature is
   *   translateText(texts, sourceLang, targetLang, options)
   * where options is a PLAIN object ({ formality, glossary, preserve_formatting, ... }).
   * It is NOT a "target_lang / source_lang" wrapper — passing those as the 2nd arg
   * is what triggers "langCode must be a non-empty string".
   */
  private requestOptions(): Record<string, any> {
    const opts: Record<string, any> = {
      preserve_formatting: this.opts.preserveFormatting ?? true,
    };
    if (this.opts.formality) opts.formality = this.opts.formality;
    if (this.opts.glossaryId) opts.glossary = this.opts.glossaryId;
    return opts;
  }

  /** Normalized source language, or null for auto-detect. */
  private getSourceLang(): string | null {
    const raw = this.opts.sourceLang?.trim();
    if (!raw) return null;
    return this.normalizeLang(raw, raw); // normalize then uppercase
  }

  async translate(text: string, target?: string): Promise<string> {
    if (!text.trim()) return text;
    await this.init();
    const targetLang = this.getTarget(target);
    const sourceLang = this.getSourceLang();
    return this.withRetry(async () => {
      // Signature: translateText(texts, sourceLang, targetLang, options)
      const res = await this.client.translateText(
        text,
        sourceLang,
        targetLang,
        this.requestOptions()
      );
      // deepl-node returns a single TextResult for singular input
      return (res as any)?.text ?? String(res);
    });
  }

  async translateBatch(texts: string[], target?: string): Promise<string[]> {
    const validTexts = texts.filter(t => t.trim());
    if (validTexts.length === 0) return texts;
    await this.init();

    const targetLang = this.getTarget(target);
    const sourceLang = this.getSourceLang();
    const uniq = Array.from(new Set(validTexts));
    const outMap = new Map<string, string>();

    for (let i = 0; i < uniq.length; i += this.opts.maxBatch) {
      const chunk = uniq.slice(i, i + this.opts.maxBatch);
      // Signature: translateText(texts[], sourceLang, targetLang, options)
      const results: any = await this.withRetry(() =>
        this.client.translateText(chunk, sourceLang, targetLang, this.requestOptions())
      );
      // results is array of { text, detected_source_language }
      const arr: any[] = Array.isArray(results) ? results : [results];
      chunk.forEach((t, idx) => {
        outMap.set(t, arr[idx]?.text ?? t);
      });
    }

    return texts.map(t => (t.trim() ? (outMap.get(t) ?? t) : t));
  }

  /** Alias kept for backward compatibility with old Google-based code. */
  translateText(text: string): Promise<string> {
    return this.translate(text);
  }

  /**
   * Retry on rate-limit (429), quota exceeded (456), and 5xx errors.
   * Other errors (e.g. 401 invalid key) are thrown immediately.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < this.opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const status = e?.response?.status ?? e?.status ?? e?.code;
        if (![429, 456, 500, 502, 503].includes(Number(status))) {
          throw e;
        }
        const wait = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }
}

/* ================================================================== */
/*  Backend registry / factory                                        */
/* ================================================================== */

/** Translation backend identifiers supported by `--backend`. */
export type BackendName = 'deepl' | 'google' | 'libretranslate';

/** Normalize a CLI value into a known BackendName; throws on unknown input. */
export function parseBackend(value: string | undefined, fallback: BackendName = 'deepl'): BackendName {
  const v = (value ?? fallback).trim().toLowerCase();
  if (v === 'deepl' || v === 'google' || v === 'libretranslate') return v;
  throw new Error(
    `Unknown --backend "${value}". Supported values: deepl, google, libretranslate.`
  );
}

/**
 * Common configuration accepted by every backend. The engine / CLI build this
 * once and pass it to `createTranslator`, keeping backend selection in one
 * place (single responsibility).
 */
export interface CreateTranslatorOptions {
  /** Backend to use. Defaults to 'deepl'. */
  backend?: BackendName;
  /** API key (DeepL: DEEPL_API_KEY, Google: GOOGLE_API_KEY). */
  apiKey?: string;
  /** Target language code (DeepL: 'ZH', Google: 'zh-CN'). */
  targetLang?: string;
  /** Source language code (optional, auto-detect when omitted). */
  sourceLang?: string;
  /** DeepL only: force Free / Pro endpoint. */
  free?: boolean;
  /** DeepL only: formality preference. */
  formality?: DeepLFormality;
  /** DeepL only: glossary ID. */
  glossaryId?: string;
  /** Google only: service-account key.json path. */
  credentialsPath?: string;
  /** Google only: 'base' | 'nmt'. */
  googleModel?: 'base' | 'nmt';
  /** LibreTranslate only: custom server URL (e.g. http://localhost:5000). */
  libretranslateUrl?: string;
}

/**
 * Create an ITranslator for the requested backend. This is the single entry
 * point used by the CLI; individual backend classes stay decoupled.
 */
export function createTranslator(opts: CreateTranslatorOptions = {}): ITranslator {
  const backend = parseBackend(opts.backend);

  if (backend === 'google') {
    // Lazy require so DeepL-only users do not pull in Google-specific code.
    const { GoogleTranslator } = require('./google-translator') as {
      GoogleTranslator: new (o: any) => ITranslator;
    };
    return new GoogleTranslator({
      apiKey: opts.apiKey ?? process.env.GOOGLE_API_KEY,
      credentialsPath: opts.credentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS,
      targetLang: opts.targetLang,
      sourceLang: opts.sourceLang,
      model: opts.googleModel,
    });
  }

  if (backend === 'libretranslate') {
    // Lazy require — LibreTranslate is an optional dependency.
    const { LibreTranslateTranslator } = require('./libretranslate') as {
      LibreTranslateTranslator: new (o: any) => ITranslator;
    };
    return new LibreTranslateTranslator({
      endpoint: opts.libretranslateUrl,
      apiKey: opts.apiKey ?? process.env.LIBRETRANSLATE_API_KEY,
      targetLang: opts.targetLang,
      sourceLang: opts.sourceLang,
    });
  }

  // Default: DeepL (historical behaviour, preserved for backward compat).
  return new DeepLTranslator({
    apiKey: opts.apiKey ?? process.env.DEEPL_API_KEY,
    targetLang: opts.targetLang,
    sourceLang: opts.sourceLang,
    free: opts.free,
    formality: opts.formality,
    glossaryId: opts.glossaryId,
  });
}
