/**
 * Tests for the Acode plugin.
 *
 *   npm run test
 *
 * Two layers:
 *   A. `translateSource()` — the composition step. Uses a fake translator that
 *      UPPERCASES its input, so any text that reaches a backend is visible in
 *      the result. This proves only comments are rewritten (never code).
 *   B. The BUILT bundle (`dist/main.js`) loaded against a fake `acode` global:
 *      bootstraps, registers its commands, and translates a file end-to-end
 *      through the real command handler + MockTranslator.
 */
import { translateSource } from '../src/core/translate-source';
import type { Translator } from '../src/core/backend';
import { MockTranslator } from '@core/mock-translator';

let passed = 0;
let failed = 0;

function ok(name: string, cond: boolean): void {
  if (cond) passed++;
  else {
    failed++;
    console.log('  ✗ ' + name);
  }
}

function eq(name: string, actual: unknown, expected: unknown): void {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

/** Uppercases everything it receives — makes the translated set observable. */
const shout: Translator = {
  async translate(text: string) {
    return text.toUpperCase();
  },
  async translateBatch(texts: string[]) {
    return texts.map(t => t.toUpperCase());
  },
};

/* ================================================================== */
/*  A. translateSource                                                */
/* ================================================================== */

async function testTranslateSource(): Promise<void> {
  const src = [
    '/**',
    ' * Returns the total value.',
    ' * @param {string} userName - The user name',
    ' */',
    'export function f(userName) {',
    '  // A trailing comment',
    '  return 1;',
    '}',
  ].join('\n');

  const res = await translateSource(src, {
    filename: 'a.ts',
    targetLang: 'zh',
    translator: shout,
    protect: false, // first pass: no placeholders, so we see the raw text
  });

  // Two comments: the JSDoc block (which *contains* @param) and the line comment.
  eq('both comments are translated', res.translated, 2);
  eq('total comments found', res.total, 2);
  ok('not reported as unchanged', !res.unchanged);

  // The JSDoc/line comment bodies must now be uppercase…
  ok('jsdoc body translated', res.output.includes('RETURNS THE TOTAL VALUE.'));
  ok('line comment translated', res.output.includes('A TRAILING COMMENT'));
  ok('@param payload translated',
    /@PARAM \{STRING\} USERNAME - THE USER NAME/.test(res.output));

  // …but the CODE must be byte-for-byte identical.
  ok('function signature untouched', res.output.includes('export function f(userName) {'));
  ok('return statement untouched', res.output.includes('return 1;'));
  ok('comment delimiters preserved', res.output.includes('/**') && res.output.includes('*/'));

  /* --- no comments ------------------------------------------------- */
  {
    const plain = 'const a = 1;\nconst b = 2;\n';
    const r = await translateSource(plain, { filename: 'a.ts', targetLang: 'zh', translator: shout });
    eq('no comments → zero translated', r.translated, 0);
    ok('no comments → output unchanged', r.output === plain);
    ok('no comments → flagged unchanged', r.unchanged);
  }

  /* --- empty/whitespace comments are skipped ----------------------- */
  {
    const s = '/** */\n//\nexport const x = 1;\n';
    const r = await translateSource(s, { filename: 'a.ts', targetLang: 'zh', translator: shout });
    eq('empty comments are skipped, not sent', r.translated, 0);
    ok('empty comments counted as skipped', r.skipped === r.total);
  }

  /* --- termination protection ------------------------------------- */
  {
    // Identifiers / URLs / code spans must survive when protection is ON.
    const s = [
      '// Call foo_bar with https://example.com/docs and `register()`',
      '// keeps BlockPermutation intact',
      'export const x = 1;',
    ].join('\n');
    const r = await translateSource(s, {
      filename: 'a.ts',
      targetLang: 'zh',
      translator: shout,
      protect: true,
    });
    ok('identifier foo_bar survives', r.output.includes('foo_bar'));
    ok('PascalCase identifier survives', r.output.includes('BlockPermutation'));
    ok('URL survives', r.output.includes('https://example.com/docs'));
    ok('code span survives', r.output.includes('`register()`'));
    ok('surrounding prose was still translated', r.output.includes('KEEPS'));
  }

  /* --- code containing comment-lookalikes is never touched --------- */
  {
    const s = [
      'const re = /[/*]/;',
      'const u = /https?:\\/\\//;',
      'const t = `${ v /* inner */ }`;',
      '// real comment',
    ].join('\n');
    const r = await translateSource(s, {
      filename: 'a.ts',
      targetLang: 'zh',
      translator: shout,
      protect: false,
    });
    // TWO genuine comments: the one inside the template's `${ }` substitution
    // (that genuinely IS a comment) and the standalone line comment. The regex
    // bodies are NOT comments and must survive untouched.
    eq('only genuine comments are translated', r.translated, 2);
    ok('regex literals untouched', r.output.includes('const re = /[/*]/;'));
    ok('escaped-slash regex untouched', r.output.includes('const u = /https?:\\/\\//;'));
    ok('template structure preserved',
      r.output.includes('const t = `${ v /*') && r.output.includes('*/ }`;'));
    ok('the standalone comment was translated', r.output.includes('REAL COMMENT'));
  }

  /* --- a short backend response must not corrupt the file ---------- */
  {
    const bad: Translator = {
      async translate() {
        return '';
      },
      async translateBatch() {
        return []; // fewer results than inputs
      },
    };
    const s = '// keep me\nexport const x = 1;\n';
    const r = await translateSource(s, { filename: 'a.ts', targetLang: 'zh', translator: bad, protect: false });
    ok('missing backend results fall back to the original text', r.output.includes('keep me'));
    ok('code still intact after a bad batch', r.output.includes('export const x = 1;'));
    eq('a no-op translation is not counted', r.translated, 0);
  }

  /* --- a real (offline) backend end-to-end ------------------------- */
  {
    const r = await translateSource('// Returns the total value.\nexport const x = 1;\n', {
      filename: 'a.ts',
      targetLang: 'zh',
      translator: new MockTranslator({ targetLanguage: 'zh' }),
      protect: false,
    });
    ok(`mock backend translates the comment (${JSON.stringify(r.output.split('\n')[0])})`,
      r.output.includes('返回') && r.output.includes('总计'));
    ok('mock run leaves code intact', r.output.includes('export const x = 1;'));
  }

  /* --- JSX file uses the type-aware parser path -------------------- */
  {
    const s = 'const el = <a>http://x</a>;\n// real comment\n';
    const r = await translateSource(s, {
      filename: 'a.tsx',
      targetLang: 'zh',
      translator: shout,
      protect: false,
    });
    eq('JSX text URL is not mistaken for a comment', r.translated, 1);
    ok('JSX markup untouched', r.output.includes('const el = <a>http://x</a>;'));
  }
}

/* ================================================================== */
/*  B. The built bundle                                               */
/* ================================================================== */

interface FakeEnv {
  commands: any[];
  init: (baseUrl: string) => Promise<void>;
  initSettings: any;
  editorValue: string;
  written: string | null;
}

async function bootBundle(): Promise<FakeEnv> {
  const env: FakeEnv = {
    commands: [],
    init: async () => {},
    initSettings: null,
    editorValue: '',
    written: null,
  };

  const file = { name: 'a.ts', uri: 'file:///a.ts', onsave: undefined as any, save: async () => true };
  const editor = {
    getValue: () => env.editorValue,
    setValue: (v: string) => {
      env.written = v;
      env.editorValue = v;
    },
  };

  const fakeAcode = {
    require: (name: string) => {
      if (name === 'commands') {
        return {
          addCommand: (d: any) => {
            env.commands.push(d);
            return d;
          },
          removeCommand: () => {},
        };
      }
      throw new Error(`unexpected acode.require(${name})`);
    },
    setPluginInit: (_id: string, cb: any, settings: any) => {
      env.init = cb;
      env.initSettings = settings;
    },
    setPluginUnmount: () => {},
  };

  const g = globalThis as any;
  g.window = { acode: fakeAcode };
  g.acode = fakeAcode;
  g.editorManager = { editor, activeFile: file, on: () => {}, off: () => {} };
  g.localStorage = {
    _d: new Map<string, string>(),
    getItem(k: string) {
      return this._d.has(k) ? this._d.get(k) : null;
    },
    setItem(k: string, v: string) {
      this._d.set(k, v);
    },
    removeItem(k: string) {
      this._d.delete(k);
    },
  };
  g.toast = () => {};

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  require('../dist/main.js');
  return env;
}

async function testBundle(): Promise<void> {
  const fs = require('fs') as typeof import('fs');
  const path = require('path') as typeof import('path');
  if (!fs.existsSync(path.join(__dirname, '..', 'dist', 'main.js'))) {
    console.log('  (skipping bundle tests: run `npm run build` first)');
    return;
  }

  const env = await bootBundle();

  ok('bundle registered setPluginInit', typeof env.init === 'function');
  ok('settings descriptor is passed to Acode', Array.isArray(env.initSettings?.list));
  ok('settings expose a backend choice',
    env.initSettings.list.some((s: any) => s.key === 'backend'));

  // Commands are registered by init(), so boot first.
  await env.init('file:///plugins/comment-translator/');

  eq('three commands are registered', env.commands.length, 3);
  ok('commands are namespaced',
    env.commands.every(c => String(c.name).startsWith('comment-translator:')));

  const byName = (n: string) => env.commands.find(c => c.name === n);

  /* --- the translate command, end to end -------------------------- */
  env.editorValue = [
    '/**',
    ' * Returns the total value.',
    ' */',
    'export function f() {',
    '  // A trailing comment',
    '  return 1;',
    '}',
  ].join('\n');
  env.written = null;

  eq('translate command returns a boolean', byName('comment-translator:translate').exec(), true);

  // `exec` kicks off async work; wait for the editor to be written.
  for (let i = 0; i < 200 && env.written === null; i++) {
    await new Promise(r => setTimeout(r, 10));
  }

  ok('command wrote a result back to the editor', env.written !== null);
  const out = env.written ?? '';
  ok('comments were translated', out.includes('返回') && out.includes('总计'));
  ok('code was preserved', out.includes('export function f() {') && out.includes('return 1;'));

  /* --- status command --------------------------------------------- */
  eq('status command returns a boolean', byName('comment-translator:status').exec(), true);

  /* --- toggle on-save --------------------------------------------- */
  env.editorValue = '// x\nexport const a = 1;\n';
  byName('comment-translator:toggle-on-save').exec();
  await new Promise(r => setTimeout(r, 10));
  const settings = typeof localStorage !== 'undefined' ? localStorage.getItem('acode.comment-translator.settings.v1') : null;
  ok('toggle on-save persists the setting', !!settings && /"onSave":true/.test(settings!));
}

/* ================================================================== */

async function main(): Promise<void> {
  console.log('  [A] translateSource()');
  await testTranslateSource();
  console.log('  [B] built bundle + commands');
  await testBundle();

  console.log(`\n[plugin] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('\n[plugin] fatal:', e);
  process.exit(1);
});
