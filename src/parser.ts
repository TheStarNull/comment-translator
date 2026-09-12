/**
 * Comment Parser - extracts and restores comments from source code
 * Supports: JSDoc, single-line comments, multi-line comments
 * Works with: .js, .ts, .jsx, .tsx, .mjs, .cjs
 *
 * Extraction is dispatched by file type:
 *   - .jsx / .tsx → ./ts-comments (the TypeScript parser, when installed), because
 *     JSX text and generic arrows cannot be lexed reliably by hand.
 *   - everything else → ./lexer, a small dependency-free context-aware lexer
 *     that understands strings, template `${}` substitutions and regex literals.
 *
 * Both paths return comments in source order with identical shapes.
 */

import { RawComment, scanComments } from './lexer';
import { scanCommentsWithTypeScript } from './ts-comments';

export interface ExtractedComment {
  /** Unique identifier for this comment within the file */
  id: number;
  /** The full comment text (without delimiters) */
  text: string;
  /** Original comment including delimiters */
  original: string;
  /** Type of comment */
  type: 'jsdoc' | 'block' | 'line';
  /** Start position in the source */
  start: number;
  /** End position in the source */
  end: number;
  /** Line number where comment starts */
  line: number;
}

export interface ParseResult {
  comments: ExtractedComment[];
  source: string;
}

/** Files whose syntax (JSX) needs a real parser rather than a lexer. */
const JSX_FILE = /\.(jsx|tsx)$/i;

/**
 * Locate raw comment ranges in `source`.
 *
 * JSX files are handed to the TypeScript parser when it is available; every
 * other file (and JSX files without `typescript` installed) uses the built-in
 * lexer.
 */
export function extractRawComments(source: string, filename: string): RawComment[] {
  if (JSX_FILE.test(filename)) {
    const viaParser = scanCommentsWithTypeScript(source, filename);
    if (viaParser) return viaParser;
  }
  return scanComments(source);
}

/**
 * Extract all comments from source code while preserving positions.
 *
 * Both backends produce plain ranges; the `ExtractedComment` shape (ids,
 * delimiters-stripped text, 1-based line numbers) is assembled here so callers
 * see identical results either way.
 */
export function extractComments(source: string, filename: string): ParseResult {
  const raw = extractRawComments(source, filename);
  const comments: ExtractedComment[] = [];

  let id = 0;
  let line = 1;
  let pos = 0;

  for (const rc of raw) {
    // An unterminated block comment means the source is malformed; leave it
    // untouched rather than trying to rewrite it.
    if (rc.kind === 'block' && rc.unterminated) continue;

    // Advance the line counter up to the comment's first character.
    while (pos < rc.start) {
      if (source[pos] === '\n') line++;
      pos++;
    }
    const startLine = line;
    // …and through the comment itself, so the next one is counted correctly.
    while (pos < rc.end) {
      if (source[pos] === '\n') line++;
      pos++;
    }

    const original = source.slice(rc.start, rc.end);
    const isJSDoc = rc.kind === 'block' && source[rc.start + 2] === '*';
    const text =
      rc.kind === 'line'
        ? original.slice(2)
        : original.replace(/^\/\*\*?/, '').replace(/\*\/$/, '');

    comments.push({
      id: id++,
      text,
      original,
      type: rc.kind === 'line' ? 'line' : isJSDoc ? 'jsdoc' : 'block',
      start: rc.start,
      end: rc.end,
      line: startLine,
    });
  }

  return { comments, source };
}

/**
 * Clean comment text by removing markers and preserving structure
 * e.g. " * " prefix in JSDoc blocks
 */
export function cleanCommentText(comment: ExtractedComment): string {
  if (comment.type === 'jsdoc' || comment.type === 'block') {
    // Remove leading " * " or "* " patterns from each line
    const lines = comment.text.split('\n');
    const cleaned = lines
      .map(line => {
        // Remove leading "* " or " * " (common JSDoc format)
        const trimmed = line.replace(/^\s*\*\s?/, '');
        return trimmed;
      })
      .join('\n');
    return cleaned.trim();
  }

  if (comment.type === 'line') {
    // Remove "//" prefix
    return comment.text.replace(/^\s*\/\/\s?/, '').trim();
  }

  return comment.text;
}

/**
 * Rebuild a comment body by re-applying the original per-line " * " (or
 * equivalent) prefix to each line of `translatedText`.
 *
 * The original bug: this function keyed the prefix off `originalLines[idx]`,
 * so when the translated text had a different number of lines the indent
 * slipped and the reconstructed JSDoc lost its structure.
 *
 * Fix: detect the leading " * "-style prefix from the FIRST non-empty line
 * of the original body (the very first line is often empty because the
 * comment delimiter was stripped), then apply that same prefix uniformly
 * to every line of the translated text. Blank lines in the translated
 * output are rendered as a bare prefix so the visual structure is kept.
 */
function prefixEachLine(originalBody: string, translatedText: string): string {
  const originalLines = originalBody.split('\n');

  // Find the first non-empty line to infer the standard prefix (e.g. "     * ").
  let sample = '';
  for (const line of originalLines) {
    if (line.trim() !== '') { sample = line; break; }
  }
  const prefixMatch = sample.match(/^(\s*\*?\s*)/);
  let prefix = prefixMatch && prefixMatch[0] ? prefixMatch[0] : ' * ';
  if (prefix.trim() === '*') prefix = prefix.replace(/\*$/, '* ');

  const translatedLines = translatedText.split('\n');
  return translatedLines
    .map(line => {
      if (line.trim() === '') {
        // A blank line keeps the leading whitespace/prefix shape (e.g. "     *").
        return prefix.replace(/\S.*$/, '') + (prefix.includes('*') ? '*' : '');
      }
      return `${prefix}${line.trim()}`;
    })
    .join('\n');
}

/**
 * Rebuild comment with translated text, preserving formatting.
 * The translated text is the COMMENT BODY (no delimiters) as produced by
 * serializeJSDoc() — i.e. it already contains the correct tag structure.
 */
export function rebuildComment(comment: ExtractedComment, translatedText: string): string {
  if (comment.type === 'jsdoc') {
    const body = prefixEachLine(comment.text, translatedText);
    return `/**\n${body}\n */`;
  }

  if (comment.type === 'block') {
    const body = prefixEachLine(comment.text, translatedText);
    return `/*\n${body}\n */`;
  }

  // Single line comment
  const indentMatch = comment.original.match(/^(\s*)/);
  const indent = indentMatch ? indentMatch[1] : '';
  return `${indent}// ${translatedText}`;
}

/**
 * Replace all comments in source with translated versions
 */
export function restoreComments(
  source: string,
  comments: ExtractedComment[],
  translations: Map<number, string>,
): string {
  // Build replacements from end to start to preserve positions
  const replacements: { start: number; end: number; text: string }[] = [];

  for (const comment of comments) {
    const translated = translations.get(comment.id);
    if (translated !== undefined) {
      const rebuilt = rebuildComment(comment, translated);
      replacements.push({ start: comment.start, end: comment.end, text: rebuilt });
    }
  }

  // Apply from end to start
  replacements.sort((a, b) => b.start - a.start);

  let result = source;
  for (const rep of replacements) {
    result = result.slice(0, rep.start) + rep.text + result.slice(rep.end);
  }

  return result;
}
