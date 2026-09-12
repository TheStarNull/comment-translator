/**
 * Regression tests for comment extraction (src/lexer.ts + src/ts-comments.ts).
 *
 *   npm run test:parser
 *
 * What this guards against
 * ------------------------
 * The previous handler was a hand-rolled state machine that skipped strings but
 * knew nothing about REGEX LITERALS or template `${}` substitutions. It failed
 * silently in both directions — inventing comments that do not exist (and
 * "translating" them) or swallowing real ones:
 *
 *   const re = /[\/\*]/;        // the /* inside was read as a comment opener
 *   const u  = /https?:\/\//;   // the // inside was read as a line comment
 *   const s  = `${ v /* c *\/ }`;  // a real comment, never found
 *   const el = <a>http://x</a>; // `//` is JSX text, not a comment
 *
 * Extraction now dispatches: .jsx/.tsx go to the TypeScript parser (optional
 * dependency) and everything else to a dependency-free context-aware lexer.
 */
import { extractComments, ExtractedComment } from './parser';
import { isTypeScriptAvailable } from './ts-comments';
import { scanComments } from './lexer';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean): void {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.log('  ✗ ' + name);
  }
}

/** Comments of a source string, as `{ text, type, line }` triples. */
function commentsOf(src: string, file = 't.ts'): ExtractedComment[] {
  return extractComments(src, file).comments;
}

/** Assert exactly `expected` comments, all containing `marker`. */
function expectOnly(name: string, src: string, file: string, expected: number, marker = 'real'): void {
  const cs = commentsOf(src, file);
  const allMarked = cs.every(c => c.text.includes(marker));
  ok(
    `${name} → ${cs.length} comment(s)${cs.length === expected && allMarked ? '' : ` [got: ${JSON.stringify(cs.map(c => c.text))}]`}`,
    cs.length === expected && allMarked
  );
}

function main(): void {
  const tsAvailable = isTypeScriptAvailable();
  console.log(`  [env] typescript available: ${tsAvailable}`);

  /* ---------------------------------------------------------------- */
  /* 1. Regex literals — the headline bug.                             */
  /* ---------------------------------------------------------------- */

  expectOnly('regex containing /* inside a class', 'const re = /[/*]/;\n// real\nconst b = 1;', 't.ts', 1);
  expectOnly('regex containing escaped //', 'const u = /https?:\\/\\//;\n// real\nconst b = 1;', 't.ts', 1);
  expectOnly('regex with raw * sequence', 'const r = /a*b/;\n// real\nconst b = 1;', 't.ts', 1);
  expectOnly('regex containing // after star', 'const r = /x*/;\n// real\nconst b = 1;', 't.ts', 1);
  expectOnly('regex as an argument', 'f(/[/]/);\n// real\nconst b = 1;', 't.ts', 1);
  expectOnly('regex after return', 'function f() {\n  return /a\\/\\/b/;\n}\n// real', 't.ts', 1);
  expectOnly('regex after typeof', 'const t = typeof /x/;\n// real', 't.ts', 1);
  expectOnly('regex after comma in array', 'const a = [1, /[/*]/, 2];\n// real', 't.ts', 1);
  expectOnly('regex after colon in object', 'const o = { p: /\\/\\// };\n// real', 't.ts', 1);
  expectOnly('regex with flags', 'const r = /[/*]/gi;\n// real', 't.ts', 1);

  /* ---------------------------------------------------------------- */
  /* 2. Division must NOT be mistaken for a regex.                     */
  /* ---------------------------------------------------------------- */

  expectOnly('simple division', 'const x = a / b;\n// real\nconst b = 1;', 't.ts', 1);
  expectOnly('division after parens', 'const x = (a + b) / c;\n// real', 't.ts', 1);
  expectOnly('division after index', 'const x = a[0] / 2;\n// real', 't.ts', 1);
  expectOnly('division after number', 'const x = 10 / 2;\n// real', 't.ts', 1);
  expectOnly('division after string', 'const x = "a" / 2;\n// real', 't.ts', 1);
  expectOnly('divide-assign', 'let x = 1;\nx /= 2;\n// real', 't.ts', 1);
  expectOnly('division then regex', 'const y = a / b + c;\nconst r = /x/;\n// real', 't.ts', 1);
  expectOnly('division then comment-looking division', 'const y = a / /* real */ b;', 't.ts', 1);

  /* ---------------------------------------------------------------- */
  /* 3. Template literals.                                             */
  /* ---------------------------------------------------------------- */

  expectOnly('template containing //', 'const s = `http://x`;\n// real', 't.ts', 1);
  expectOnly('template containing /* */', 'const s = `a /* not a comment */ b`;\n// real', 't.ts', 1);
  expectOnly('escaped backtick inside template', 'const s = `a \\` b`;\n// real', 't.ts', 1);
  expectOnly('nested template literal', 'const s = `a ${ `b ${ c }` } d`;\n// real', 't.ts', 1);
  expectOnly('comment inside a substitution', 'const s = `${ a /* real */ }`;', 't.ts', 1);
  expectOnly('line comment inside a substitution', 'const s = `${\n  a // real\n}`;', 't.ts', 1);
  expectOnly('comment inside nested substitution', 'const s = `x ${ y ${ z /* real */ } }`;', 't.ts', 1);

  /* ---------------------------------------------------------------- */
  /* 4. Strings (regression: these already worked, keep them working). */
  /* ---------------------------------------------------------------- */

  expectOnly('double-quoted URL', 'const s = "http://x";\n// real', 't.ts', 1);
  expectOnly('block-comment-looking string', 'const s = "a /* not */ b";\n// real', 't.ts', 1);
  expectOnly('quote inside the comment is fine', '// real don\'t\nconst b = 1;', 't.ts', 1);
  expectOnly('escaped quote in string', 'const s = "a\\"// b";\n// real', 't.ts', 1);

  /* ---------------------------------------------------------------- */
  /* 5. JSX / TSX (TypeScript-parser path).                            */
  /* ---------------------------------------------------------------- */

  if (tsAvailable) {
    expectOnly('JSX text containing //', 'const el = <a>http://x</a>;\n// real\nconst b = 1;', 't.tsx', 1);
    expectOnly('JSX comment container', 'const el = <div>{/* real */}</div>;', 't.tsx', 1);
    expectOnly('JSX comment container with expr', 'const el = <div>{a /* real */}</div>;', 't.tsx', 1);
    expectOnly('generic arrow <T,> is not JSX', 'const f = <T,>(x: T) => x;\n// real\nconst b = 1;', 't.tsx', 1);
    expectOnly('JSX attribute string with //', 'const el = <a href="http://x">y</a>;\n// real', 't.tsx', 1);
    expectOnly('nested JSX elements', 'const el = <div><span>a//b</span></div>;\n// real', 't.tsx', 1);
    expectOnly('JSX fragment', 'const el = <>http://x</>;\n// real', 't.tsx', 1);
    expectOnly('self-closing with // in attr', 'const el = <img alt="//" />;\n// real', 't.tsx', 1);
    expectOnly('tsx type annotation + jsx', 'const f = (n: number) => <b>{n // real\n}</b>;', 't.tsx', 1);
  }

  /* ---------------------------------------------------------------- */
  /* 6. Ordinary structural cases (behaviour must not regress).        */
  /* ---------------------------------------------------------------- */

  expectOnly('comment before closing object brace', 'const o = {\n  a: 1, /* real */\n};', 't.ts', 1);
  expectOnly('comment in an empty function body', 'function f() { /* real */ }', 't.ts', 1);
  expectOnly('comment in an empty arrow body', 'const f = () => { /* real */ };', 't.ts', 1);
  expectOnly('trailing comment on same line', 'const b = 1; // real', 't.ts', 1);
  expectOnly('comment at the very end', 'const b = 1;\n// real', 't.ts', 1);
  expectOnly('consecutive line comments', '// real one\n// real two', 't.ts', 2);
  expectOnly('comment between declarations', 'const a = 1;\n// real\nconst b = 2;', 't.ts', 1);
  expectOnly('empty class body with comment', 'class C { /* real */ }', 't.ts', 1);
  expectOnly('comment inside array literal', 'const a = [\n  1, // real\n  2,\n];', 't.ts', 1);

  /* ---------------------------------------------------------------- */
  /* 7. Shape of the returned objects.                                 */
  /* ---------------------------------------------------------------- */

  {
    const src = '/**\n * Doc line.\n */\nconst a = 1;\n// line\n/* block */\n';
    const cs = commentsOf(src, 't.ts');
    ok('finds jsdoc + line + block', cs.length === 3);
    ok('classifies jsdoc', cs[0].type === 'jsdoc');
    ok('classifies line', cs[1].type === 'line');
    ok('classifies block', cs[2].type === 'block');

    // `text` must match the historical shape (delimiters stripped, jsdoc keeps
    // its leading newline and per-line ` * ` prefixes).
    ok('jsdoc text keeps inner layout', cs[0].text === '\n * Doc line.\n ');
    ok('line text is the content only', cs[1].text === ' line');
    ok('block text is the content only', cs[2].text === ' block ');

    // `original` must be exactly the source substring, so restore/rebuild is lossless.
    for (const c of cs) {
      ok(`original is verbatim for comment ${c.id}`, src.slice(c.start, c.end) === c.original);
    }

    // 1-based line numbers: jsdoc on line 1, `// line` on line 5, block on line 6.
    ok(
      `line numbers are 1-based and correct (got ${cs.map(c => c.line).join(',')})`,
      cs[0].line === 1 && cs[1].line === 5 && cs[2].line === 6
    );

    // Ids are sequential from 0.
    ok('ids are sequential', cs.every((c, idx) => c.id === idx));
  }

  /* ---------------------------------------------------------------- */
  /* 8. Zero false positives on comment-free code.                     */
  /* ---------------------------------------------------------------- */

  {
    const noComments = [
      'const re = /[/*]/;',
      'const u = /https?:\\/\\//;',
      'const s = "// not a comment";',
      'const t = `/* nor this */`;',
      'const d = a / b / c;',
    ].join('\n');
    ok('no comments invented in comment-free code', commentsOf(noComments, 't.ts').length === 0);
  }

  /* ---------------------------------------------------------------- */
  /* 9. Lexer-level ranges are well-formed.                            */
  /* ---------------------------------------------------------------- */

  {
    const src = '/** a */\n// b\nconst x = /[/*]/;\n/* c */';
    const raw = scanComments(src);
    ok('lexer finds 3 comments', raw.length === 3);
    ok('lexer ranges are ordered and non-overlapping',
      raw.every((r, idx) => idx === 0 || r.start >= raw[idx - 1].end));
    ok('lexer ranges are within bounds',
      raw.every(r => r.start >= 0 && r.end <= src.length && r.end > r.start));
    ok('lexer reports no unterminated comments', raw.every(r => !r.unterminated));
  }

  /* ---------------------------------------------------------------- */
  /* 10. Unterminated block comment is left alone.                     */
  /* ---------------------------------------------------------------- */

  {
    const cs = commentsOf('const a = 1;\n/* never closed', 't.ts');
    ok('unterminated block comment is ignored (source is malformed)', cs.length === 0);
    ok('lexer still flags it as unterminated',
      scanComments('const a = 1;\n/* never closed').some(r => r.unterminated === true));
  }

  /* ---------------------------------------------------------------- */

  console.log(`\n[parser] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
