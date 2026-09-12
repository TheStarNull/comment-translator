/**
 * Regression tests for TermProtector placeholder round-tripping.
 *
 *   npx tsc && node dist/term-protector.test.js
 *   (or: npm run test:terms)
 *
 * Focus: the "adjacent placeholders" bug. `restore()` used to match runs of
 * private-use codepoints greedily (`/[\uE000-\uF8FF]+/g`) and look the WHOLE run
 * up in the map. When two protected fragments ended up next to each other with
 * no separator, their placeholders merged into one run, the lookup missed, and
 * the placeholders were silently returned verbatim (invisible U+Exxx leaking
 * into the translated text → the term was lost).
 *
 * The fix: one codepoint per placeholder + per-codepoint restoration, so each
 * placeholder is self-delimiting regardless of what surrounds it.
 */
import { TermProtector } from './term-protector';

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

/** Legit private-use codepoint that the protector never allocates. */
const FOREIGN_PUA = '\uE5FF';

/** protect + restore round-trip with a fresh protector (mirrors engine usage). */
function roundTrip(text: string, options: ConstructorParameters<typeof TermProtector>[0] = {}): string {
  const p = new TermProtector(options);
  const [protectedText] = p.protectBatch([text]);
  const [restored] = p.restoreBatch([protectedText]);
  return restored;
}

/** True if any private-use codepoint survived into the output. */
function hasLonePlaceholder(s: string): boolean {
  return /[\uE000-\uF8FF]/.test(s);
}

function main(): void {
  /* ---------------------------------------------------------------- */
  /* 1. Adjacent placeholders — the bug this suite was written for.     */
  /* ---------------------------------------------------------------- */

  // Same fragment twice with no separator. Dedup maps both `%s` to the SAME
  // placeholder, so the protected text is two identical placeholders back to back.
  ok('adjacent identical: %s%s', roundTrip('%s%s') === '%s%s');
  ok('adjacent identical: %d%d', roundTrip('%d%d') === '%d%d');

  // Different fragments back to back → two distinct placeholders touching.
  ok('adjacent distinct: {@link A}{@link B}',
    roundTrip('{@link A}{@link B}') === '{@link A}{@link B}');
  ok('adjacent distinct: {0}{1}', roundTrip('{0}{1}') === '{0}{1}');
  ok('adjacent distinct: ${a}${b}', roundTrip('${a}${b}') === '${a}${b}');

  // Two backtick code spans touching.
  ok('adjacent code spans: `a``b`', roundTrip('`a``b`') === '`a``b`');

  // Three in a row.
  ok('triple adjacent: %s%s%s', roundTrip('%s%s%s') === '%s%s%s');

  // Adjacent at the very start / end of the string.
  ok('adjacent at start: %s%s tail', roundTrip('%s%s tail') === '%s%s tail');
  ok('adjacent at end: head %s%s', roundTrip('head %s%s') === 'head %s%s');

  /* ---------------------------------------------------------------- */
  /* 2. No silent placeholder leakage.                                 */
  /* ---------------------------------------------------------------- */

  const p2 = new TermProtector({});
  const [protectedP2] = p2.protectBatch(['%s%s and {@link A}{@link B}']);
  const [restoredP2] = p2.restoreBatch([protectedP2]);
  ok('no PUA codepoint leaks into restored output', !hasLonePlaceholder(restoredP2));
  ok('restored output keeps both %s', (restoredP2.match(/%s/g) || []).length === 2);
  ok('restored output keeps {@link A} and {@link B}',
    restoredP2.includes('{@link A}') && restoredP2.includes('{@link B}'));

  /* ---------------------------------------------------------------- */
  /* 3. Non-adjacent / separated cases must keep working.              */
  /* ---------------------------------------------------------------- */

  ok('separated by space: %s %s', roundTrip('%s %s') === '%s %s');
  ok('mixed prose + identifier',
    roundTrip('Sets the BlockPermutation via %s.') === 'Sets the BlockPermutation via %s.');
  ok('identifier mid-sentence',
    roundTrip('Call onCreate before scoreboard.') === 'Call onCreate before scoreboard.');
  ok('URL preserved', roundTrip('See https://example.com/docs for more.') === 'See https://example.com/docs for more.');
  ok('inline tag in prose', roundTrip('Throws {@link FooError} on failure.') === 'Throws {@link FooError} on failure.');

  /* ---------------------------------------------------------------- */
  /* 4. Dedup must not inflate the map.                                */
  /* ---------------------------------------------------------------- */

  const p4 = new TermProtector({ terms: ['FooBar'] });
  p4.protectBatch(['FooBar and FooBar and FooBar']);
  ok('repeated term dedups to a single mapping', p4.protectedCount === 1);

  const p4b = new TermProtector({});
  p4b.protectBatch(['%s %s %s']);
  ok('repeated %s dedups to a single mapping', p4b.protectedCount === 1);

  /* ---------------------------------------------------------------- */
  /* 5. Foreign private-use codepoints survive untouched.              */
  /* ---------------------------------------------------------------- */

  ok('foreign PUA char passes through protect+restore',
    roundTrip('text ' + FOREIGN_PUA + ' tail') === 'text ' + FOREIGN_PUA + ' tail');

  const p5 = new TermProtector({});
  const [protectedP5, protectedP5b] = p5.protectBatch(['a%sb', FOREIGN_PUA + '%s' + FOREIGN_PUA]);
  const [restoredP5, restoredP5b] = p5.restoreBatch([protectedP5, protectedP5b]);
  ok('foreign PUA mixed with own placeholder (left)', restoredP5 === 'a%sb');
  ok('foreign PUA mixed with own placeholder (right)',
    restoredP5b === FOREIGN_PUA + '%s' + FOREIGN_PUA);

  /* ---------------------------------------------------------------- */
  /* 6. Large mixed paragraph round-trips exactly.                     */
  /* ---------------------------------------------------------------- */

  const mixed =
    'Represents a {@link BlockPermutation} in the WorldClock. ' +
    'Call `register()` with %s and %s before %d. ' +
    'See https://example.com/`api` for the MAX_RETRY flag. ' +
    'Throws {@link WorldClockReloadTimeMarkerError}{@link LocationOutOfWorldBoundariesError}.';
  const mixedOut = roundTrip(mixed);
  ok('large mixed paragraph round-trips byte-for-byte', mixedOut === mixed);
  ok('large mixed paragraph has no PUA leak', !hasLonePlaceholder(mixedOut));

  /* ---------------------------------------------------------------- */
  /* 7. Simulated translator output (spacing churn) still restores.    */
  /* ---------------------------------------------------------------- */

  // A real engine may re-order or re-space text around placeholders. Each
  // placeholder must still resolve independently.
  const p7 = new TermProtector({});
  const [protected7] = p7.protectBatch(['%s and %s']);
  // Simulate a translator that dropped the spaces between the placeholders.
  const mangled = protected7.replace(/\s+/g, '');
  const restored7 = p7.restore(mangled);
  ok('restores when translator collapses spacing between placeholders',
    restored7 === '%s' + '%s' || restored7 === '%sand%s');

  /* ---------------------------------------------------------------- */
  /* 8. Independent placeholders restore to their own originals.       */
  /* ---------------------------------------------------------------- */

  // Distinct terms adjacent must not swap or collapse.
  const p8 = new TermProtector({ terms: ['FooBar', 'BazQux'] });
  const [protected8] = p8.protectBatch(['FooBarBazQux']);
  const restored8 = p8.restore(protected8);
  ok('distinct adjacent terms restore to own originals', restored8 === 'FooBarBazQux');

  console.log(`\n[terms] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
