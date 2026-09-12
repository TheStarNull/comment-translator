/**
 * Comment lexer — a small, dependency-free, context-aware scanner.
 *
 * Why not a naive "look for // and /*" scan?
 * -----------------------------------------
 * A comment delimiter is only a comment when it is NOT inside a string, a
 * template literal, or a regular-expression literal. Getting this wrong is
 * silent and destructive: the tool would either invent comments that do not
 * exist (and "translate" them, corrupting code) or swallow real ones.
 *
 * The original implementation handled strings but not regex literals, so:
 *
 *     const re = /[/*]/;        // the /* inside the class was read as a
 *                               // comment opener → everything after was
 *                               // swallowed and never translated
 *     const u  = /https?:\/\//; // the // inside was read as a line comment
 *
 * It also skipped template literals wholesale, so a genuine comment inside a
 * `${ ... }` substitution was invisible:
 *
 *     const s = `${ value /* default *\/ }`;
 *
 * This module fixes both. It tracks the previous significant token so that a
 * `/` can be told apart from a regex, and it descends into `${ ... }` of
 * template literals so nested code is lexed (and its comments collected)
 * properly.
 *
 * JSX is intentionally NOT handled here — see ./ts-comments, which delegates
 * .jsx/.tsx to the TypeScript parser where one is available.
 */

export interface RawComment {
  /** Offset of the first character of the comment (the `/`). */
  start: number;
  /** Offset just past the comment. */
  end: number;
  kind: 'line' | 'block';
  /** true when `end` is `source.length` but the delimiter was never closed. */
  unterminated?: boolean;
}

/* ------------------------------------------------------------------ */
/*  Character helpers                                                  */
/* ------------------------------------------------------------------ */

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9';
}

function isIdentStart(ch: string | undefined): boolean {
  if (ch === undefined) return false;
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    ch === '_' ||
    ch === '$' ||
    ch.charCodeAt(0) > 0x7f // non-ASCII identifiers
  );
}

function isIdentPart(ch: string | undefined): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

function isWhitespace(ch: string): boolean {
  return (
    ch === ' ' ||
    ch === '\t' ||
    ch === '\n' ||
    ch === '\r' ||
    ch === '\f' ||
    ch === '\v' ||
    ch === '\u00a0' || // NBSP
    ch === '\u2028' ||
    ch === '\u2029' ||
    ch === '\ufeff' // BOM
  );
}

/* ------------------------------------------------------------------ */
/*  Keyword tables (only what the regex/division decision needs)       */
/* ------------------------------------------------------------------ */

/**
 * Words after which a `/` is always a REGEX: they cannot end an expression,
 * so the next token starts a new one. E.g. `return /re/`, `typeof /re/`.
 */
const KEYWORD_THEN_EXPRESSION = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'case', 'yield', 'await', 'throw', 'extends', 'default',
  'if', 'for', 'while', 'switch', 'with', 'catch', 'finally', 'try',
  'function', 'class', 'const', 'let', 'var', 'import', 'export', 'from',
  'as', 'satisfies', 'keyof', 'readonly', 'declare', 'abstract', 'async',
  'static', 'public', 'private', 'protected', 'get', 'set', 'constructor',
  'type', 'interface', 'enum', 'namespace', 'module', 'implements',
]);

/** Words that ARE values, so a following `/` is division. */
const KEYWORD_IS_VALUE = new Set(['this', 'super', 'true', 'false', 'null']);

/* ------------------------------------------------------------------ */
/*  Scanner                                                            */
/* ------------------------------------------------------------------ */

/**
 * Scan `source` and return every comment, in source order.
 *
 * Fragments that cannot be a comment (strings, templates, regexes, and the
 * code inside `${ ... }`) are skipped, so the result contains only real
 * comments.
 */
export function scanComments(source: string): RawComment[] {
  const comments: RawComment[] = [];
  const n = source.length;
  let i = 0;

  /**
   * True when the previous significant token can END an expression. An
   * identifier, literal, `)` or `]` sets it; operators, `(`/`[`/`{`/`,`
   * and expression-introducing keywords clear it.
   *
   * A `/` is a REGEX when this is false, and DIVISION when it is true.
   */
  let prevEndsExpression = false;

  function addComment(start: number, end: number, kind: 'line' | 'block', unterminated?: boolean): void {
    comments.push({ start, end, kind, unterminated });
  }

  /** `'x'` / `"x"` — single line unless escaped. */
  function scanString(quote: string): void {
    i++; // opening quote
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === quote) {
        i++;
        return;
      }
      // A raw newline means the string was never closed; stop at the line end.
      if (c === '\n') return;
      i++;
    }
  }

  /** `/pattern/flags` — must only be called when a regex is actually allowed. */
  function scanRegex(): void {
    i++; // opening slash
    let inClass = false;
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '\n') return; // unterminated regex literal
      if (c === '[') inClass = true;
      else if (c === ']') inClass = false;
      else if (c === '/' && !inClass) {
        i++; // closing slash
        while (i < n && isIdentPart(source[i])) i++; // flags
        return;
      }
      i++;
    }
  }

  /** A numeric literal (decimal / hex / binary / octal / exponent / BigInt). */
  function scanNumber(): void {
    if (source[i] === '0' && /[xXbBoO]/.test(source[i + 1] ?? '')) {
      i += 2;
      while (i < n && /[0-9a-fA-F_]/.test(source[i])) i++;
    } else {
      while (i < n && /[0-9_]/.test(source[i])) i++;
      if (source[i] === '.') {
        i++;
        while (i < n && /[0-9_]/.test(source[i])) i++;
      }
      if (source[i] === 'e' || source[i] === 'E') {
        i++;
        if (source[i] === '+' || source[i] === '-') i++;
        while (i < n && /[0-9_]/.test(source[i])) i++;
      }
    }
    if (source[i] === 'n') i++; // BigInt suffix
  }

  /**
   * `` `...` `` — including `${ ... }` substitutions, which contain ordinary
   * code and are therefore lexed recursively so their comments are found.
   */
  function scanTemplate(): void {
    i++; // opening backtick
    while (i < n) {
      const c = source[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        i++;
        return;
      }
      if (c === '$' && source[i + 1] === '{') {
        i += 2; // consume `${`
        scanCode(true); // stops with i at the matching `}`
        if (i < n && source[i] === '}') i++; // consume it
        continue;
      }
      i++;
    }
  }

  /**
   * The core loop.
   *
   * @param stopAtClosingBrace when true, return as soon as a `}` is reached
   *        that is not matched by an inner `{` (the caller consumes it). Used
   *        for template substitutions.
   */
  function scanCode(stopAtClosingBrace: boolean): void {
    let braceDepth = 0;

    while (i < n) {
      const ch = source[i];

      /* ---- comments (checked first: they win over anything else) ---- */

      if (ch === '/' && source[i + 1] === '/') {
        const start = i;
        i += 2;
        while (i < n && source[i] !== '\n') i++;
        addComment(start, i, 'line');
        continue; // not a token: leaves prevEndsExpression untouched
      }

      if (ch === '/' && source[i + 1] === '*') {
        const start = i;
        i += 2;
        let closed = false;
        while (i < n) {
          if (source[i] === '*' && source[i + 1] === '/') {
            i += 2;
            closed = true;
            break;
          }
          i++;
        }
        addComment(start, i, 'block', !closed);
        continue;
      }

      /* ---- whitespace ---- */

      if (isWhitespace(ch)) {
        i++;
        continue;
      }

      /* ---- string literals ---- */

      if (ch === '"' || ch === "'") {
        scanString(ch);
        prevEndsExpression = true;
        continue;
      }

      /* ---- template literals ---- */

      if (ch === '`') {
        scanTemplate();
        prevEndsExpression = true;
        continue;
      }

      /* ---- regex or division ---- */

      if (ch === '/') {
        if (!prevEndsExpression) {
          scanRegex();
          prevEndsExpression = true;
        } else {
          i += source[i + 1] === '=' ? 2 : 1; // `/` or `/=`
          prevEndsExpression = false;
        }
        continue;
      }

      /* ---- braces ---- */

      if (ch === '{') {
        if (stopAtClosingBrace) braceDepth++;
        i++;
        prevEndsExpression = false;
        continue;
      }
      if (ch === '}') {
        if (stopAtClosingBrace) {
          if (braceDepth === 0) return; // caller consumes the `}`
          braceDepth--;
        }
        i++;
        // Treat as the end of an object literal (division follows). A block
        // end is indistinguishable here, and a `/` right after `}` is rare
        // either way — comments are already handled above.
        prevEndsExpression = true;
        continue;
      }

      /* ---- identifiers & keywords ---- */

      if (isIdentStart(ch)) {
        const start = i;
        while (i < n && isIdentPart(source[i])) i++;
        const word = source.slice(start, i);
        if (KEYWORD_IS_VALUE.has(word)) prevEndsExpression = true;
        else if (KEYWORD_THEN_EXPRESSION.has(word)) prevEndsExpression = false;
        else prevEndsExpression = true; // ordinary identifier → a value
        continue;
      }

      /* ---- numeric literals ---- */

      if (isDigit(ch)) {
        scanNumber();
        prevEndsExpression = true;
        continue;
      }
      if (ch === '.' && isDigit(source[i + 1])) {
        scanNumber();
        prevEndsExpression = true;
        continue;
      }

      /* ---- punctuation & operators ---- */

      if (ch === ')' || ch === ']') {
        i++;
        prevEndsExpression = true; // closes an expression / index
        continue;
      }

      // Everything else (`(`, `[`, `,`, `;`, `:`, `=`, `+`, `-`, `*`, `=>`,
      // `?`, `&`, `|`, `<`, `>`, `!`, `~`, `%`, `^`, `.`, spread …) cannot end
      // an expression, so a following `/` may start a regex.
      i++;
      prevEndsExpression = false;
    }
  }

  scanCode(false);
  return comments;
}
