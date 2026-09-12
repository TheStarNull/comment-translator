/**
 * Regression tests: every network backend must fail fast on a stalled endpoint.
 *
 *   npm run test:timeout
 *
 * Bug it guards against
 * ---------------------
 * Node's built-in `fetch` has no overall request deadline (undici's own
 * headers/body timeouts are 300s, effectively "never" for a CLI). Before this
 * suite:
 *   - GoogleTranslator.callApi        → NO timeout  (could hang forever)
 *   - googleAuthAssertion token swap  → NO timeout  (could hang forever)
 *   - DeepL                           → uncontrolled SDK default (10s)
 * while LibreTranslate (30s) and the LLM client (60s) had ad-hoc inline
 * AbortControllers.
 *
 * The tests stand up a local HTTP server that ACCEPTS a connection and then
 * never replies — the exact failure mode that hangs a real run — and assert
 * each backend surfaces a timeout instead of blocking.
 */
import * as http from 'http';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';

import { fetchWithTimeout, TimeoutError, isTimeoutError } from './fetch-timeout';
import { GoogleTranslator } from './google-translator';
import { LibreTranslateTranslator } from './libretranslate-translator';
import { LlmClient } from './llm-client';
import { googleAuthAssertion } from './google-auth';

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

/* ------------------------------------------------------------------ */
/*  A server that accepts connections and then stalls.                 */
/* ------------------------------------------------------------------ */

let hangHits = 0;

const server = http.createServer((req, res) => {
  const url = req.url ?? '';

  if (url.startsWith('/translate-ok')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: { translations: [{ translatedText: 'OK-FROM-SERVER' }] } }));
    return;
  }
  // LibreTranslate appends /translate to baseUrl, so a path prefix lets the
  // happy-path test coexist with the stalling /translate route.
  if (url.startsWith('/libre/translate')) {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ translatedText: 'LIBRE-OK' }));
    return;
  }

  // Everything else (including /hang) accepts the request and never answers.
  hangHits++;
  // Intentionally no res.end(): the client must time out, not the server.
});

/* ------------------------------------------------------------------ */

function elapsedMs(start: bigint): number {
  return Number(process.hrtime.bigint() - start) / 1e6;
}

async function main(): Promise<void> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const base = `http://127.0.0.1:${port}`;

  /* ---------------------------------------------------------------- */
  /* 1. The helper itself.                                             */
  /* ---------------------------------------------------------------- */

  // Hangs → deadline fires, and the error is identifiable.
  {
    const t0 = process.hrtime.bigint();
    let err: any = null;
    try {
      await fetchWithTimeout(`${base}/hang`, {}, 300, 'probe');
    } catch (e) {
      err = e;
    }
    const ms = elapsedMs(t0);
    ok('fetchWithTimeout rejects instead of hanging', err !== null);
    ok('fetchWithTimeout raises TimeoutError', err instanceof TimeoutError);
    ok('timeout error is classified by isTimeoutError', isTimeoutError(err));
    ok('timeout error message names the operation and duration',
      /probe timed out after 300ms/.test(String(err?.message)));
    ok('timeout error carries ETIMEDOUT code', err?.code === 'ETIMEDOUT');
    ok(`deadline fires promptly (took ${Math.round(ms)}ms, expected < 2000ms)`, ms < 2000);
  }

  // A healthy endpoint must still resolve normally.
  {
    const res = await fetchWithTimeout(`${base}/translate-ok`, { method: 'POST' }, 5000, 'probe');
    const body: any = await res.json();
    ok('fast response is NOT affected by the deadline', res.ok && body.data.translations[0].translatedText === 'OK-FROM-SERVER');
  }

  // A caller-issued abort must NOT be reported as a timeout (so it is not retried).
  {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    let err: any = null;
    try {
      await fetchWithTimeout(`${base}/hang`, { signal: ac.signal }, 10_000, 'probe');
    } catch (e) {
      err = e;
    }
    ok('caller abort rejects', err !== null);
    ok('caller abort is NOT classified as a timeout', !isTimeoutError(err));
  }

  /* ---------------------------------------------------------------- */
  /* 2. GoogleTranslate — the original offender.                       */
  /* ---------------------------------------------------------------- */

  {
    const t0 = process.hrtime.bigint();
    const gt = new GoogleTranslator({
      apiKey: 'test-key',
      endpoint: `${base}/hang`,
      timeout: 300,
      maxRetries: 1,
    } as any);

    let err: any = null;
    try {
      await gt.translate('Hello world', 'zh');
    } catch (e) {
      err = e;
    }
    const ms = elapsedMs(t0);
    ok('GoogleTranslator fails fast on a stalled endpoint', err !== null);
    ok('GoogleTranslator error is a timeout', isTimeoutError(err));
    ok('GoogleTranslator timeout names the API',
      /Google Translate API timed out/.test(String(err?.message)));
    ok(`GoogleTranslator does not hang (took ${Math.round(ms)}ms, expected < 2500ms)`, ms < 2500);
  }

  // And the happy path must still work end-to-end.
  {
    const gt = new GoogleTranslator({
      apiKey: 'test-key',
      endpoint: `${base}/translate-ok`,
      timeout: 5000,
      maxRetries: 1,
    } as any);
    const out = await gt.translate('Hello world', 'zh');
    ok('GoogleTranslator still returns a translation when the server responds', out === 'OK-FROM-SERVER');
  }

  /* ---------------------------------------------------------------- */
  /* 3. Google OAuth token exchange (service-account auth).            */
  /* ---------------------------------------------------------------- */

  {
    // Signing requires a real RSA key; generate one on the fly (offline).
    const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;

    const t0 = process.hrtime.bigint();
    let err: any = null;
    try {
      await googleAuthAssertion('svc@example.iam.gserviceaccount.com', pem, {
        tokenUrl: `${base}/hang`,
        timeoutMs: 300,
      });
    } catch (e) {
      err = e;
    }
    const ms = elapsedMs(t0);
    ok('OAuth token exchange fails fast', err !== null);
    ok('OAuth token exchange error is a timeout', isTimeoutError(err));
    ok('OAuth timeout names the exchange',
      /Google OAuth token exchange timed out/.test(String(err?.message)));
    ok(`OAuth token exchange does not hang (took ${Math.round(ms)}ms)`, ms < 2500);
  }

  /* ---------------------------------------------------------------- */
  /* 4. LibreTranslate (previously had its own inline implementation). */
  /* ---------------------------------------------------------------- */

  {
    const lt = new LibreTranslateTranslator({
      baseUrl: base,
      timeout: 300,
      maxRetries: 1,
      targetLang: 'zh',
    } as any);

    const t0 = process.hrtime.bigint();
    let err: any = null;
    try {
      await lt.translate('Hello world');
    } catch (e) {
      err = e;
    }
    const ms = elapsedMs(t0);
    ok('LibreTranslate fails fast on a stalled instance', err !== null);
    ok('LibreTranslate error is a timeout', isTimeoutError(err));
    ok(`LibreTranslate does not hang (took ${Math.round(ms)}ms)`, ms < 2500);
  }

  // LibreTranslate happy path (baseUrl with a path prefix → /libre/translate).
  {
    const lt = new LibreTranslateTranslator({
      baseUrl: `${base}/libre`,
      timeout: 5000,
      maxRetries: 1,
    } as any);
    const out = await lt.translate('Hello world');
    ok('LibreTranslate still returns a translation when the instance responds', out === 'LIBRE-OK');
  }

  /* ---------------------------------------------------------------- */
  /* 5. LLM client (polish pass).                                      */
  /* ---------------------------------------------------------------- */

  {
    const llm = new LlmClient({
      provider: 'openai',
      baseUrl: base,
      apiKey: 'test',
      model: 'test-model',
      timeoutMs: 300,
    });

    const t0 = process.hrtime.bigint();
    let err: any = null;
    try {
      await llm.chatCompletion([{ role: 'user', content: 'hi' }]);
    } catch (e) {
      err = e;
    }
    const ms = elapsedMs(t0);
    ok('LLM client fails fast on a stalled gateway', err !== null);
    ok('LLM client error is a timeout', isTimeoutError(err));
    ok(`LLM client does not hang (took ${Math.round(ms)}ms; retries once with backoff)`, ms < 4000);
  }

  /* ---------------------------------------------------------------- */
  /* 6. Timeouts are retried (transient), user aborts are not.         */
  /* ---------------------------------------------------------------- */

  {
    // maxRetries=2 keeps this cheap: retry backoff is a fixed 1s for the first
    // retry, so higher counts make the suite noticeably slower.
    hangHits = 0;
    const gt = new GoogleTranslator({
      apiKey: 'test-key',
      endpoint: `${base}/hang`,
      timeout: 200,
      maxRetries: 2,
    } as any);
    await gt.translate('Hello', 'zh').catch(() => undefined);
    ok(`timeout is retried (server saw ${hangHits} attempts, expected 2)`, hangHits === 2);
  }

  /* ---------------------------------------------------------------- */

  console.log(`\n[timeout] ${passed} passed, ${failed} failed`);
  server.close();
  process.exit(failed ? 1 : 0);
}

main().catch(e => {
  console.error('\n[timeout] fatal:', e);
  server.close();
  process.exit(1);
});
