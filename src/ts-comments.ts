/**
 * Comment extraction for JSX files, delegated to the TypeScript parser.
 *
 * Why this exists
 * ---------------
 * JSX cannot be lexed reliably without a real parser. Consider:
 *
 *     const el = <a>http://example.com</a>;   // `//` is JSX *text*, not a comment
 *     const el = <div>{/* remember this *\/}</div>;  // a comment the lexer must find
 *     const id = <T,>(x: T) => x;             // `<` is NOT a JSX tag here
 *
 * A lexer would have to re-implement TypeScript's disambiguation for all three
 * (and `<T,>` is exactly the case TypeScript itself resolves with lookahead).
 * Rather than guess, we ask the real parser.
 *
 * How comments are recovered
 * --------------------------
 * Once the file is parsed, every comment is by definition *trivia* — text that
 * belongs to no token. So:
 *
 *   1. walk the AST and collect the span of every leaf token;
 *   2. everything not covered by a token span is trivia;
 *   3. scan those gaps for `//` and block comments.
 *
 * This is exact: a regex literal containing `/*`, or JSX text containing `//`,
 * is a *token*, so it is never part of a gap and can never be mistaken for a
 * comment. JSDoc nodes are skipped when collecting spans because the parser
 * models JSDoc as nodes — they are comments, not code.
 *
 * `typescript` is an OPTIONAL dependency: if it is not installed we return
 * `null` and the caller falls back to the dependency-free lexer (which is
 * correct for everything except JSX text).
 */

import { RawComment } from './lexer';

/** Cached module (or `false` once we know it is unavailable). */
let tsModule: any | false | undefined;

/**
 * Load `typescript` if it is installed. Never throws.
 * @returns the module, or `null` when unavailable.
 */
export function loadTypeScript(): any | null {
  if (tsModule === undefined) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      tsModule = require('typescript');
    } catch {
      tsModule = false;
    }
  }
  return tsModule === false ? null : tsModule;
}

/** True when the optional `typescript` dependency is present. */
export function isTypeScriptAvailable(): boolean {
  return loadTypeScript() !== null;
}

/** Map a file name to the parser's `ScriptKind`. */
function scriptKindFor(ts: any, fileName: string): any {
  if (/\.tsx$/i.test(fileName)) return ts.ScriptKind.TSX;
  if (/\.jsx$/i.test(fileName)) return ts.ScriptKind.JSX;
  if (/\.(mts|cts|ts)$/i.test(fileName)) return ts.ScriptKind.TS;
  if (/\.(mjs|cjs|js)$/i.test(fileName)) return ts.ScriptKind.JS;
  return ts.ScriptKind.TS;
}

/**
 * Extract comments from JSX/TSX source using the TypeScript parser.
 *
 * @returns comments in source order, or `null` when `typescript` is not
 *          installed / the parse failed (caller should fall back).
 */
export function scanCommentsWithTypeScript(source: string, fileName: string): RawComment[] | null {
  const ts = loadTypeScript();
  if (!ts) return null;

  try {
    // `setParentNodes` is required for `node.getChildren()` below.
    const sf = ts.createSourceFile(
      fileName,
      source,
      ts.ScriptTarget.Latest,
      /* setParentNodes */ true,
      scriptKindFor(ts, fileName)
    );

    const isJSDocKind = (kind: number): boolean =>
      kind >= ts.SyntaxKind.FirstJSDocNode && kind <= ts.SyntaxKind.LastJSDocNode;

    /* ---- 1. collect every leaf token span ---- */
    const spans: Array<[number, number]> = [];
    const walk = (node: any): void => {
      if (isJSDocKind(node.kind)) return; // JSDoc nodes describe comments, not code
      const kids: any[] = node.getChildren(sf).filter((k: any) => !isJSDocKind(k.kind));
      if (kids.length === 0) {
        spans.push([node.getStart(sf), node.end]);
        return;
      }
      for (const kid of kids) walk(kid);
    };
    walk(sf);

    spans.sort((a, b) => a[0] - b[0]);

    /* ---- 2/3. scan the gaps between tokens for comments ---- */
    const comments: RawComment[] = [];

    const scanGap = (from: number, to: number): void => {
      let p = from;
      while (p < to) {
        if (source[p] === '/' && source[p + 1] === '/') {
          const nl = source.indexOf('\n', p);
          const end = nl < 0 ? source.length : nl;
          comments.push({ start: p, end, kind: 'line' });
          p = end;
          continue;
        }
        if (source[p] === '/' && source[p + 1] === '*') {
          const close = source.indexOf('*/', p + 2);
          const end = close < 0 ? source.length : close + 2;
          comments.push({ start: p, end, kind: 'block', unterminated: close < 0 });
          p = end;
          continue;
        }
        p++;
      }
    };

    let cursor = 0;
    for (const [start, end] of spans) {
      if (start > cursor) scanGap(cursor, start);
      if (end > cursor) cursor = end;
    }
    if (cursor < source.length) scanGap(cursor, source.length);

    return comments;
  } catch {
    // Any parser surprise: let the caller fall back to the plain lexer.
    return null;
  }
}
