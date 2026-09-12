/**
 * Comment Parser - extracts and restores comments from source code
 * Supports: JSDoc, single-line comments, multi-line comments
 * Works with: .js, .ts, .jsx, .tsx, .mjs, .cjs
 */

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

/**
 * Extract all comments from source code while preserving positions
 */
export function extractComments(source: string, _filename: string): ParseResult {
  const comments: ExtractedComment[] = [];
  let id = 0;

  // State machine approach
  let i = 0;
  const n = source.length;
  let lineNum = 1;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // Track line numbers
    if (ch === '\n') {
      lineNum++;
    }

    // Check for comment start
    if (ch === '/' && next === '*') {
      // Block comment or JSDoc
      const start = i;
      const startLine = lineNum;
      const isJSDoc = source[i + 2] === '*';

      // Find the end of the comment
      i += 2;
      let commentContent = '';
      let foundEnd = false;

      while (i < n) {
        if (source[i] === '*' && source[i + 1] === '/') {
          i += 2;
          foundEnd = true;
          break;
        }
        if (source[i] === '\n') {
          lineNum++;
        }
        commentContent += source[i];
        i++;
      }

      if (foundEnd) {
        const end = i;
        const fullComment = source.slice(start, end);
        const innerContent = fullComment.replace(/^\/\*\*?/, '').replace(/\*\/$/, '');

        comments.push({
          id: id++,
          text: innerContent,
          original: fullComment,
          type: isJSDoc ? 'jsdoc' : 'block',
          start,
          end,
          line: startLine,
        });
      }
      continue;
    }

    if (ch === '/' && next === '/') {
      // Single line comment
      const start = i;
      const startLine = lineNum;
      let commentText = '';
      i += 2;

      while (i < n && source[i] !== '\n') {
        commentText += source[i];
        i++;
      }

      const end = i;
      const fullComment = source.slice(start, end);

      comments.push({
        id: id++,
        text: commentText,
        original: fullComment,
        type: 'line',
        start,
        end,
        line: startLine,
      });
      continue;
    }

    // Skip string literals to avoid false positives
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          i += 2;
          continue;
        }
        if (source[i] === quote) {
          i++;
          break;
        }
        if (source[i] === '\n') {
          lineNum++;
        }
        i++;
      }
      continue;
    }

    i++;
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
