/**
 * Tests for JSDoc part extraction / re-assembly.
 *
 *   npm run test:jsdoc
 *
 * Focus: `@example` (and `@code` / `@pre`) payloads must never be handed to a
 * translator. Their content is code, and translating it silently corrupts the
 * documentation:
 *
 *   @example
 *   const user = getUser();     →   const 用户 = getUser();
 *   return user.name;           →   返回 用户.名称;
 *
 * which no longer compiles. The bug is invisible with a no-op translator, so
 * every assertion here uses a translator that uppercases its input — meaning any
 * text that reaches the translator is detectable in the output.
 */
import {
  parseJSDoc,
  extractTranslatableParts,
  applyTranslations,
  isTranslatableTag,
  isVerbatimTag,
  TRANSLATABLE_TAGS,
  VERBATIM_TAGS,
} from './jsdoc-parser';

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
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    console.log(`  ✗ ${name}\n      expected: ${JSON.stringify(expected)}\n      actual:   ${JSON.stringify(actual)}`);
  }
}

/* ------------------------------------------------------------------ */

/**
 * Build the input `parseJSDoc` actually receives: the comment body AFTER
 * `cleanCommentText()` has stripped the per-line ` * ` decoration and trimmed.
 * (The engine always cleans before parsing, so tests must match.)
 */
function doc(...lines: string[]): string {
  return lines.join('\n');
}

/**
 * Round-trip a JSDoc body through the extraction pipeline with a translator
 * that UPPERCASES everything it receives, so translated text is obvious.
 */
function roundTrip(text: string): { translated: string[]; output: string } {
  const parsed = parseJSDoc(text);
  const parts = extractTranslatableParts(parsed);
  const translated = parts.map(p => p.toUpperCase());
  const result = applyTranslations(parsed, translated);
  return { translated, output: require('./jsdoc-parser').serializeJSDoc(result) as string };
}

function main(): void {
  /* ---------------------------------------------------------------- */
  /* 1. `@example` payload is never sent to the translator.            */
  /* ---------------------------------------------------------------- */

  {
    const src = doc('Returns the user name.', '@example', 'const user = getUser();', 'return user.name;');
    const { translated, output } = roundTrip(src);

    ok('@example body is not among the translated parts',
      !translated.some(p => p.includes('GETUSER') || p.includes('RETURN USER')));
    ok('@example body survives byte-for-byte',
      output.includes('const user = getUser();') && output.includes('return user.name;'));
    ok('prose before @example IS translated', output.includes('RETURNS THE USER NAME.'));
  }

  /* ---------------------------------------------------------------- */
  /* 2. The other code-bearing tags behave the same.                   */
  /* ---------------------------------------------------------------- */

  for (const tag of ['example', 'examples', 'code', 'codeblock', 'pre']) {
    const src = doc('Some prose here.', '@' + tag, 'const x = getValue(1);');
    const { translated, output } = roundTrip(src);
    ok(`@${tag}: payload not translated`, !translated.some(p => p.includes('GETVALUE')));
    ok(`@${tag}: payload preserved verbatim`, output.includes('const x = getValue(1);'));
  }

  /* ---------------------------------------------------------------- */
  /* 3. Prose tags must keep working (no over-blocking).               */
  /* ---------------------------------------------------------------- */

  {
    const src = doc('@param {string} userName - The user name', '@returns {boolean} True if valid');
    const { translated, output } = roundTrip(src);
    eq('two prose parts extracted', translated.length, 2);
    ok('@param tag prefix survives', output.includes('@param '));
    ok('@returns tag prefix survives', output.includes('@returns '));
    ok('@param is not treated as verbatim', !isVerbatimTag('param'));

    // At THIS layer the whole tag remainder travels as one unit — including
    // `{Type}` and the symbol name. Keeping those literal is TermProtector's
    // job (it wraps them in placeholders before the real API sees them), which
    // is covered by `npm run test:terms`. Asserting it here would only be
    // testing the uppercase stub.
    eq('the @param payload is the whole remainder',
      translated[0], '{STRING} USERNAME - THE USER NAME');
  }

  /* ---------------------------------------------------------------- */
  /* 4. The two sets stay consistent and mutually exclusive.           */
  /* ---------------------------------------------------------------- */

  {
    for (const tag of VERBATIM_TAGS) {
      ok(`verbatim tag @${tag} is not in TRANSLATABLE_TAGS`, !TRANSLATABLE_TAGS.has(tag));
    }
    ok('TRANSLATABLE_TAGS no longer lists example', !TRANSLATABLE_TAGS.has('example'));
    ok('TRANSLATABLE_TAGS no longer lists examples', !TRANSLATABLE_TAGS.has('examples'));
    ok('isTranslatableTag(example) is false', !isTranslatableTag('example'));
    ok('isVerbatimTag(example) is true', isVerbatimTag('example'));
    ok('isVerbatimTag(param) is false', !isVerbatimTag('param'));

    // Every verbatim tag passed through isTranslatableTag would be a latent bug
    // (extract and apply disagree) — this guards it.
    ok('no tag is both translatable and verbatim',
      [...VERBATIM_TAGS].every(t => !TRANSLATABLE_TAGS.has(t)));
  }

  /* ---------------------------------------------------------------- */
  /* 5. Part/translation index agreement (ordering contract).          */
  /* ---------------------------------------------------------------- */

  {
    // extract and apply walk the tags independently; if their skip rules ever
    // diverge, a translation lands on the wrong tag. Put an @example BETWEEN two
    // prose tags so a misalignment would be immediately visible.
    const src = doc(
      '@param {string} first - One two',
      '@example',
      'const code = 1;',
      '@returns {number} Three four'
    );
    const { translated, output } = roundTrip(src);
    eq('exactly the two prose parts are extracted', translated.length, 2);
    ok('first description got the FIRST translation',
      output.includes('@param {STRING} FIRST - ONE TWO'));
    ok('last description got the LAST translation',
      output.includes('@returns {NUMBER} THREE FOUR'));
    ok('code between them is untouched', output.includes('const code = 1;'));
  }

  /* ---------------------------------------------------------------- */
  /* 6. Existing skip rules still hold.                                */
  /* ---------------------------------------------------------------- */

  {
    // A tag whose payload is only an inline tag is structural, not prose.
    const inlineOnly = roundTrip(doc('@see {@link FooBar}', '@param {number} count - Two words'));
    eq('inline-only tag contributes no translatable part',
      inlineOnly.translated.length, 1);
    ok('inline-only tag stays byte-for-byte', inlineOnly.output.includes('@see {@link FooBar}'));
    ok('the following prose tag is still translated',
      inlineOnly.output.includes('TWO WORDS'));

    // Marker tags with non-prose payloads (versions, identifiers).
    const marker = roundTrip(doc('@since 1.2.0', '@beta', '@internal foo'));
    eq('marker tags with non-prose payloads are skipped', marker.translated.length, 0);
    ok('version string untouched', marker.output.includes('@since 1.2.0'));

    // …but prose after a marker tag IS translated.
    const markerProse = roundTrip(doc('@beta', 'This feature may change'));
    ok('prose description after marker tag is translated',
      markerProse.output.includes('THIS FEATURE MAY CHANGE'));
  }

  /* ---------------------------------------------------------------- */
  /* 7. Multiline example bodies (blank lines, nested decorators).     */
  /* ---------------------------------------------------------------- */

  {
    const src = doc('@example', 'const a = 1;', '', 'const b = 2;');
    const { translated } = roundTrip(src);
    eq('a multi-paragraph example produces no translatable parts', translated.length, 0);
  }

  console.log(`\n[jsdoc] ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

main();
