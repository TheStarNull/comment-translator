/**
 * Tests for the mock translator and for the "no silent mock" contract.
 *
 *   npm run test:mock
 *
 * Two things are covered:
 *   1. The mock itself — it must be deterministic, structure-preserving, and
 *      NOT recompile its dictionaries on every call.
 *   2. `cli.ts` — a missing API key must be a hard error, never a silent
 *      fallback to simulated output (the mock is now opt-in via `--mock`, or
 *      explicitly via `--allow-mock`).
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { MockTranslator, normalizeLanguage } from './mock-translator';

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

function eq(name: string, actual: unknown, expected: unknown): void {
  const good = actual === expected;
  if (!good) {
    failed++;
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  } else {
    passed++;
  }
}

const t = (target = 'zh') => new MockTranslator({ targetLanguage: target });

async function main(): Promise<void> {
  /* ---------------------------------------------------------------- */
  /* 1. Language normalisation                                         */
  /* ---------------------------------------------------------------- */

  eq('normalize zh-CN → zh', normalizeLanguage('zh-CN'), 'zh');
  eq('normalize ZH_TW → zh', normalizeLanguage('ZH_TW'), 'zh');
  eq('normalize pt-BR → pt', normalizeLanguage('pt-BR'), 'pt');
  eq('normalize EN → en', normalizeLanguage('EN'), 'en');
  eq('normalize unknown → base tag', normalizeLanguage('xx-YY'), 'xx');
  eq('normalize empty → en', normalizeLanguage(''), 'en');

  /* ---------------------------------------------------------------- */
  /* 2. Determinism                                                    */
  /* ---------------------------------------------------------------- */

  {
    const a = await t().translate('Returns the total value.');
    const b = await t().translate('Returns the total value.');
    eq('same input → same output', a, b);
    ok('output is marked as simulated', a.startsWith('[zh] '));
  }

  /* ---------------------------------------------------------------- */
  /* 3. Structure preservation — JSDoc tags ({Type}, name, separator)  */
  /* ---------------------------------------------------------------- */

  {
    const out = await t().translate('@param {string} userName - The user name');
    ok(`{Type} is preserved → ${out}`, out.includes('{string}'));
    ok('parameter name is preserved', out.includes('userName'));
    ok('separator is preserved', / - /.test(out));
    ok('description was translated', !/The user name/.test(out));
    ok('tag itself is preserved', out.includes('@param'));
  }

  {
    const out = await t().translate('@returns {boolean} True if the value is valid');
    ok('@returns keeps its type', out.includes('{boolean}'));
    ok('@returns keeps its tag', out.includes('@returns'));
    ok('@returns description translated', !/True if the value is valid/.test(out));
  }

  {
    const out = await t().translate('@throws {Error} When the state is invalid');
    ok('@throws keeps tag + type', out.includes('@throws') && out.includes('{Error}'));
  }

  /* ---------------------------------------------------------------- */
  /* 4. Verbatim blocks (`@example`)                                   */
  /* ---------------------------------------------------------------- */

  {
    const src = ['@example', 'const x = getValue();', '// keep me as is', '@returns {number} The value'].join('\n');
    const out = await t().translate(src);
    ok('@example body is untouched', out.includes('const x = getValue();'));
    ok('@example comment inside body untouched', out.includes('// keep me as is'));
    ok('text after the verbatim block is translated again', !/The value$/.test(out));
  }

  /* ---------------------------------------------------------------- */
  /* 5. Code constructs are never rewritten                            */
  /* ---------------------------------------------------------------- */

  {
    // [source, fragment that must survive verbatim]
    const cases: Array<[string, string, string]> = [
      ['camelCase identifier', 'Call onCreate now', 'onCreate'],
      ['PascalCase identifier', 'Represents BlockPermutation here', 'BlockPermutation'],
      ['UPPER_SNAKE identifier', 'See MAX_RETRY for details', 'MAX_RETRY'],
      ['snake_case identifier', 'Uses foo_bar in code', 'foo_bar'],
      ['versioned identifier', 'Supports v2 syntax', 'v2'],
      ['{@link} inline tag', 'Throws {@link FooError} when invalid', '{@link FooError}'],
      ['code span', 'Call `register()` before this', '`register()`'],
      ['URL', 'See https://example.com/docs for the value', 'https://example.com/docs'],
    ];
    for (const [label, src, frag] of cases) {
      const out = await t().translate(src);
      ok(`${label}: “${frag}” survives`, out.includes(frag));
    }

    // …while the prose around them IS translated (so we know protection is
    // selective rather than the whole line being skipped).
    const prose = await t().translate('Call onCreate for the user');
    ok(`prose around an identifier is translated (got “${prose}”)`,
      prose.includes('onCreate') && prose.includes('用户'));
    ok('the protected identifier itself is untouched in that line', !prose.includes('创建Create'));
  }

  /* ---------------------------------------------------------------- */
  /* 6. Line structure & indentation                                   */
  /* ---------------------------------------------------------------- */

  {
    const src = '\n * Represents a user.\n * @param {string} name - The name\n ';
    const out = await t().translate(src);
    const lines = out.split('\n');
    eq('line count is preserved', lines.length, 4);
    ok('leading ` * ` decoration preserved', /^ \* \[zh\] /.test(lines[1]));
    ok('tag line keeps its decoration', /^ \* \[zh\] @param \{string\} name - /.test(lines[2]));
    eq('blank/whitespace line preserved', lines[0], '');
  }

  /* ---------------------------------------------------------------- */
  /* 7. Case preservation on cased targets                             */
  /* ---------------------------------------------------------------- */

  {
    const fr = t('fr');
    const out = await fr.translate('Returns the value');
    ok(`French capitalisation preserved → ${out}`, out.includes('Retourne') || out.includes('retourne'));
    const lower = await fr.translate('returns the value');
    ok('lower-case input stays lower-case', !lower.includes('Retourne'));
  }

  /* ---------------------------------------------------------------- */
  /* 8. Language coverage + pseudo fallback                            */
  /* ---------------------------------------------------------------- */

  {
    const expectations: Array<[string, string]> = [
      ['zh', '世界'],
      ['ja', '世界'],
      ['ko', '세계'],
      ['es', 'mundo'],
      ['fr', 'monde'],
      ['de', 'Welt'],
      ['pt', 'mundo'],
      ['ru', 'мир'],
    ];
    for (const [lang, word] of expectations) {
      const out = await t(lang).translate('hello world');
      ok(`${lang}: translated to “${word}”`, out.includes(word));
    }
  }

  {
    // `en` and unknown codes have no dictionary → pseudo-localisation.
    const en = await t('en').translate('hello world');
    ok(`en falls back to pseudo-localisation → ${en}`, /h[ée]ll[óo]/.test(en) || en.includes('h'));
    ok('pseudo output is not identical to the input', en !== 'hello world');
    const xx = await t('xx').translate('description here');
    ok('unknown language also pseudo-localises', xx !== 'description here');
  }

  /* ---------------------------------------------------------------- */
  /* 9. Call counting (used by cache tests)                            */
  /* ---------------------------------------------------------------- */

  {
    const m = t();
    eq('callCount starts at 0', m.callCount, 0);
    await m.translate('a');
    await m.translate('b');
    eq('translate() counts 1 per call', m.callCount, 2);
    await m.translateBatch(['c', 'd', 'e']);
    eq('translateBatch() counts per text', m.callCount, 5);
    await m.translateBatch([]);
    eq('empty batch adds nothing', m.callCount, 5);
    m.reset();
    eq('reset() clears the counter', m.callCount, 0);
  }

  /* ---------------------------------------------------------------- */
  /* 10. Edge cases                                                    */
  /* ---------------------------------------------------------------- */

  {
    const m = t();
    eq('empty string passes through', await m.translate(''), '');
    eq('whitespace-only is returned unchanged', await m.translate('   '), '   ');
    const batch = await m.translateBatch(['hello', '', 'world'], 'zh');
    eq('batch preserves order and length', batch.length, 3);
    ok('batch translates each item', batch[0].includes('你好') && batch[2].includes('世界'));
    ok('explicit target overrides the instance default', batch[0].startsWith('[zh] '));
    const ja = await m.translate('hello', 'ja');
    ok('per-call target language is honoured', ja.startsWith('[ja] '));
  }

  /* ---------------------------------------------------------------- */
  /* 11. Performance: dictionaries are compiled once, not per call.    */
  /* ---------------------------------------------------------------- */

  {
    const m = t();
    const sentence =
      'Represents the current state of a BlockPermutation and returns the total value for each user in the world.';
    const N = 3000;
    const start = Date.now();
    for (let i = 0; i < N; i++) await m.translate(sentence);
    const elapsed = Date.now() - start;
    // Previously every call recompiled ~80 regexes (one per dictionary word),
    // which made this loop take many seconds. Compiled-once keeps it far below.
    ok(`3000 translations stay fast (${elapsed}ms, expected < 3000ms)`, elapsed < 3000);
  }

  /* ---------------------------------------------------------------- */
  /* 12. CLI contract: no silent mock without credentials              */
  /* ---------------------------------------------------------------- */

  {
    const CLI = path.join(__dirname, '..', 'dist', 'cli.js');
    if (!fs.existsSync(CLI)) {
      console.log('  (skipping CLI checks: run `npm run build` first)');
    } else {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-mock-'));
      const srcDir = path.join(tmp, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'a.ts'), '/** Represents a user. */\nexport class A {}\n');

      const env = { ...process.env };
      delete env.DEEPL_API_KEY;
      delete env.GOOGLE_API_KEY;
      delete env.GOOGLE_APPLICATION_CREDENTIALS;

      const run = (args: string[]) =>
        spawnSync(process.execPath, [CLI, srcDir, '--target', 'zh', '--no-progress', '--no-cache', '-o', path.join(tmp, 'out'), ...args], {
          encoding: 'utf-8',
          env,
        });

      // (a) deepL without a key → hard failure, no output produced.
      const bare = run(['--backend', 'deepl']);
      eq('missing credentials exit non-zero', bare.status, 1);
      ok('error names the missing variable', /DEEPL_API_KEY/.test(bare.stderr + bare.stdout));
      ok('error suggests --mock', /--mock/.test(bare.stderr + bare.stdout));
      ok('no fake output was written', !fs.existsSync(path.join(tmp, 'out', 'a.ts')));

      // (b) --allow-mock opts back into the old behaviour, loudly.
      const allowed = run(['--backend', 'deepl', '--allow-mock']);
      eq('--allow-mock succeeds', allowed.status, 0);
      ok('--allow-mock warns that output is simulated',
        /SIMULATED/.test(allowed.stdout + allowed.stderr));
      ok('--allow-mock actually produced output', fs.existsSync(path.join(tmp, 'out', 'a.ts')));

      // (c) --mock is explicit and works without credentials.
      const explicit = run(['--mock']);
      eq('--mock succeeds', explicit.status, 0);
      ok('--mock announces simulation', /SIMULATED/.test(explicit.stdout));

      // (d) LibreTranslate needs no key → must NOT error.
      const libre = spawnSync(process.execPath, [CLI, srcDir, '--backend', 'libretranslate', '--libre-url', 'http://127.0.0.1:9', '--timeout', '500', '--target', 'zh', '--no-progress', '--no-cache', '-o', path.join(tmp, 'out2')], { encoding: 'utf-8', env });
      ok('LibreTranslate is not blocked for missing key', !/No credentials/.test(libre.stdout + libre.stderr));

      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }

  console.log(`\n[mock] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('\n[mock] fatal:', e);
  process.exit(1);
});
