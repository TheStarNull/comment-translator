/**
 * E2E regression test: terminology protection must be ON BY DEFAULT.
 *
 *   npm run test:protection
 *
 * Bug it guards against
 * ---------------------
 * `cli.ts` used to build the TermProtector options unconditionally but only
 * passed them to the engine when `--glossary-file` or `--term` was supplied
 * (the `hasTerms` flag). Consequences, both reproduced before the fix:
 *
 *   1. `comment-translator ./src` ran with NO protection at all, even though
 *      the README documents identifiers/URLs/code spans as protected "默认开".
 *   2. Every `--no-protect-*` flag was a silent no-op: it only wrote a config
 *      key, which never triggered protector creation, so the whole pass stayed
 *      off (protection "appeared" to be disabled for the wrong reason).
 *
 * These tests drive the real CLI entry point as a subprocess and read the
 * engine's own `Terms protected:` counter, which is the user-visible signal
 * documented in the README.
 */
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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

/**
 * We drive `dist/cli.js` rather than `src/cli.ts`: spawning ts-node costs ~3.5s
 * per run, which made this suite far too slow. `npm run test:protection`
 * compiles first (see package.json), so dist is guaranteed fresh.
 */
const CLI = path.join(__dirname, '..', 'dist', 'cli.js');

if (!fs.existsSync(CLI)) {
  console.error(
    '\n✗ dist/cli.js not found.\n' +
      '  Run `npm run build` first — or just use `npm run test:protection`,\n' +
      '  which builds and then runs this suite.\n'
  );
  process.exit(1);
}

/**
 * One comment containing exactly one fragment of each protectable kind:
 *   3 identifiers (PascalCase ×2 + UPPER_SNAKE), 1 URL, 1 code span, 1 placeholder
 *   → 6 protected fragments by default.
 */
const SAMPLE = [
  '/**',
  ' * Represents a BlockPermutation in the WorldClock.',
  ' * See https://example.com/docs for MAX_RETRY and `register()` details.',
  ' * Formats output with %s before returning.',
  ' */',
  'export class A {}',
  '',
].join('\n');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-protection-'));
const srcDir = path.join(tmp, 'src');
fs.mkdirSync(srcDir, { recursive: true });
fs.writeFileSync(path.join(srcDir, 'a.ts'), SAMPLE);

interface RunResult {
  stdout: string;
  outFile: string;
  outDir: string;
}

/** Run the real CLI against the sample with the given extra flags. */
function run(extra: string[]): RunResult {
  const outDir = fs.mkdtempSync(path.join(tmp, 'out-'));
  const res = spawnSync(
    process.execPath,
    [CLI, srcDir, '--mock', '--target', 'zh', '-o', outDir, '--no-progress', '--no-cache', ...extra],
    { encoding: 'utf-8' }
  );
  if (res.error) throw res.error;
  const stdout = (res.stdout || '') + (res.stderr || '');
  return { stdout, outFile: path.join(outDir, 'a.ts'), outDir };
}

/** Parse the engine's `Terms protected: N` summary line (0 when absent). */
function protectedCount(stdout: string): number {
  const m = stdout.match(/Terms protected:\s*(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

function main(): void {
  const base = run([]);
  const none = run(['--no-protection']);
  const noIdent = run(['--no-protect-identifiers']);
  const noUrls = run(['--no-protect-urls']);
  const noCode = run(['--no-protect-code-spans']);
  const noPlace = run(['--no-protect-placeholders']);

  const n0 = protectedCount(base.stdout);
  console.log(
    `  [diag] protected counts → default=${n0} no-identifiers=${protectedCount(noIdent.stdout)} ` +
      `no-urls=${protectedCount(noUrls.stdout)} no-code=${protectedCount(noCode.stdout)} ` +
      `no-placeholders=${protectedCount(noPlace.stdout)} no-protection=${protectedCount(none.stdout)}`
  );

  /* ---------------------------------------------------------------- */
  /* The regression: protection active with default flags.             */
  /* ---------------------------------------------------------------- */

  ok('protection is ON by default (Terms protected > 0)', n0 > 0);
  ok('default protects all 6 sample fragments', n0 === 6);

  /* ---------------------------------------------------------------- */
  /* Per-category off-switches must actually take effect.              */
  /* ---------------------------------------------------------------- */

  ok('--no-protection disables the whole pass', protectedCount(none.stdout) === 0);
  ok('--no-protection prints no Terms-protected line', !/Terms protected/.test(none.stdout));
  ok('--no-protect-identifiers removes exactly the 3 identifiers',
    protectedCount(noIdent.stdout) === n0 - 3);
  ok('--no-protect-urls removes exactly the 1 URL',
    protectedCount(noUrls.stdout) === n0 - 1);
  ok('--no-protect-code-spans removes exactly the 1 code span',
    protectedCount(noCode.stdout) === n0 - 1);
  ok('--no-protect-placeholders removes exactly the 1 placeholder',
    protectedCount(noPlace.stdout) === n0 - 1);

  /* ---------------------------------------------------------------- */
  /* The user-visible outcome: protected fragments survive verbatim.   */
  /* ---------------------------------------------------------------- */

  const out = fs.readFileSync(base.outFile, 'utf-8');
  for (const token of [
    'BlockPermutation',
    'WorldClock',
    'MAX_RETRY',
    '`register()`',
    'https://example.com/docs',
    '%s',
  ]) {
    ok('translated output preserves: ' + token, out.includes(token));
  }
  ok('no private-use placeholder leaks into output', !/[\uE000-\uF8FF]/.test(out));

  /* ---------------------------------------------------------------- */
  /* The startup banner should reflect the real state.                 */
  /* ---------------------------------------------------------------- */

  ok('banner reports protection categories by default',
    /Protect:\s+identifiers, urls, code-spans, placeholders/.test(base.stdout));
  ok('banner reflects a disabled category',
    /Protect:\s+on, except urls/.test(noUrls.stdout));
  ok('banner reports full disable',
    /Protect:\s+disabled \(--no-protection\)/.test(none.stdout));

  console.log(`\n[protection] ${passed} passed, ${failed} failed`);
  fs.rmSync(tmp, { recursive: true, force: true });
  process.exit(failed ? 1 : 0);
}

main();
