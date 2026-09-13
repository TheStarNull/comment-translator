/**
 * Translate every comment in a source string.
 *
 * This is the plugin's equivalent of the CLI's `engine.ts`. The engine itself
 * cannot be reused verbatim because it is built around the filesystem (reading
 * inputs, writing outputs, a JSONL cache, a terminal progress bar) — none of
 * which exist in a WebView.
 *
 * What IS reused is everything that decides *what* to translate and how to put
 * it back: the comment lexer, the JSDoc parser, term protection and the
 * comment rebuilder all come from `@core` (the CLI's `src/`), so the plugin and
 * the CLI can never disagree about which comments exist or how they are
 * reassembled.
 */
import {
  extractComments,
  cleanCommentText,
  rebuildComment,
  ExtractedComment,
} from '@core/parser';
import { TermProtector } from '@core/term-protector';
import type { Translator } from './backend';

export interface TranslateSourceOptions {
  /** File name (used only to pick the right syntax — JSX files use the TS parser). */
  filename: string;
  targetLang: string;
  translator: Translator;
  /** Protect identifiers / URLs / code spans / placeholders. Default: true. */
  protect?: boolean;
  /** Extra terms to keep verbatim. */
  terms?: string[];
}

export interface TranslateSourceResult {
  /** The source with translated comments spliced back in. */
  output: string;
  /** Comments that were sent for translation. */
  translated: number;
  /** Comments found in the file. */
  total: number;
  /** Comments skipped because they had no translatable text. */
  skipped: number;
  /** True when nothing changed (e.g. no comments at all). */
  unchanged: boolean;
}

/**
 * Translate the comments in `source`.
 *
 * Only comments are ever modified — the surrounding code is copied through
 * byte-for-byte, so a translated file keeps compiling.
 */
export async function translateSource(
  source: string,
  opts: TranslateSourceOptions
): Promise<TranslateSourceResult> {
  const { comments } = extractComments(source, opts.filename);

  if (comments.length === 0) {
    return { output: source, translated: 0, total: 0, skipped: 0, unchanged: true };
  }

  // One protector for the whole file: it hands out a fresh placeholder per
  // occurrence, and each comment's translation is restored independently.
  const protector =
    opts.protect === false ? null : new TermProtector({ terms: opts.terms ?? [] });

  const prepared: Array<{ comment: ExtractedComment; text: string }> = [];
  for (const comment of comments) {
    const cleaned = cleanCommentText(comment);
    if (!cleaned.trim()) continue; // e.g. `/** */` or a bare `//`
    prepared.push({
      comment,
      text: protector ? protector.protect(cleaned) : cleaned,
    });
  }

  if (prepared.length === 0) {
    return {
      output: source,
      translated: 0,
      total: comments.length,
      skipped: comments.length,
      unchanged: true,
    };
  }

  const results = await opts.translator.translateBatch(
    prepared.map(p => p.text),
    opts.targetLang
  );

  // Splice from the END backwards so that offsets computed against the original
  // source stay valid while we mutate it.
  let output = source;
  let translated = 0;

  for (let i = prepared.length - 1; i >= 0; i--) {
    const { comment, text: original } = prepared[i];

    // A backend that returns fewer items than asked must not shift the mapping.
    let text = results[i];
    if (typeof text !== 'string' || text.length === 0) text = original;

    // Reverse the terminology protection before rebuilding.
    if (protector) text = protector.restore(text);

    const rebuilt = rebuildComment(comment, text);
    // Leave the comment exactly as-is when nothing actually changed; avoids
    // gratuitous re-indentation of already-correct comments.
    if (rebuilt === comment.original) continue;

    output = output.slice(0, comment.start) + rebuilt + output.slice(comment.end);
    translated++;
  }

  return {
    output,
    translated,
    total: comments.length,
    skipped: comments.length - prepared.length,
    unchanged: translated === 0,
  };
}
