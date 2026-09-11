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
export function extractComments(source: string, filename: string): ParseResult {
  const comments: ExtractedComment[] = [];
  const lines = source.split('\n');
  let id = 0;

  // State machine approach
  let i = 0;
  const n = source.length;
  let lineNum = 1;
  let lastLineStart = 0;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    // Track line numbers
    if (ch === '\n') {
      lineNum++;
      lastLineStart = i + 1;
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
 * Detect the common leading indentation (including the "*" marker) shared by
 * every line of a block/JSDoc comment. Returns the indent string (e.g. " * ")
 * that should be prepended to each rebuilt line.
 *
 * Using a single, stable indent (rather than re-using each original line's
 * indent) avoids misalignment when the translated text has a different number
 * of lines than the original — the root cause of the historic JSDoc structure
 * corruption bug.
 */
function detectBlockIndent(blockText: string): string {
  const lines = blockText.split('\n');
  // Find the first non-empty line to infer the indent pattern.
  for (const line of lines) {
    const m = line.match(/^(\s*\*\s?)/);
    if (m) return m[1].replace(/\s$/, ' ') /* normalize trailing */ || ' * ';
    const s = line.match(/^(\s*)/);
    if (s && s[1].length > 0) return s[1];
  }
  return ' * ';
}

/**
 * Rebuild comment with translated text, preserving formatting
 */
export function rebuildComment(comment: ExtractedComment, translatedText: string): string {
  if (comment.type === 'jsdoc') {
    // Rebuild JSDoc with a uniform "* " prefix on every line so that the
    // structure stays valid even when translation changes the line count.
    const translatedLines = translatedText.split('\n');
    const indent = detectBlockIndent(comment.text);

    const rebuilt = translatedLines
      .map(line => `${indent}${line}`)
      .join('\n');

    // Wrap with /** ... */  (avoid double star if already present)
    return `/**\n${rebuilt}\n */`;
  }

  if (comment.type === 'block') {
    const translatedLines = translatedText.split('\n');
    const indent = detectBlockIndent(comment.text);

    const rebuilt = translatedLines
      .map(line => `${indent}${line}`)
      .join('\n');

    return `/*\n${rebuilt}\n */`;
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
