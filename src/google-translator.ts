/**
 * Google Cloud Translation API translator.
 *
 * Uses the "Translation API Basic (v2)" REST endpoint:
 *   https://translation.googleapis.com/language/translate/v2
 *
 * Authentication (pick one):
 *   1. API key (simplest): set options.apiKey or env GOOGLE_API_KEY
 *      https://console.cloud.google.com/apis/credentials
 *   2. Service account: set env GOOGLE_APPLICATION_CREDENTIALS=<path-to-key.json>
 *      (requires `google-auth-library` installed; otherwise send the key JSON
 *      via options.credentialsPath)
 *
 * Free tier: 500,000 characters/month. Pricing: $20 / 1M chars.
 * Docs: https://cloud.google.com/translate/docs/reference/rest/v2/translate
 *
 * Every request (including the OAuth token exchange for service-account auth)
 * runs under a hard deadline — see ./fetch-timeout.
 */

import { ITranslator } from './translator';
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout, isTimeoutError } from './fetch-timeout';

export interface GoogleTranslatorOptions {
  /** API key, or falls back to process.env.GOOGLE_API_KEY. */
  apiKey?: string;
  /** Path to a service-account key JSON (used for bearer-token auth). */
  credentialsPath?: string;
  /** Source language code (e.g. 'en'). Omit for auto-detect. */
  sourceLang?: string;
  /** Target language code (e.g. 'zh', 'zh-TW', 'ja'). Defaults to 'zh'. */
  targetLang?: string;
  /** Model: 'base' (NMT) or 'nmt'. Default 'nmt'. */
  model?: 'base' | 'nmt';
  /** Max texts per batch request (Google v2 max is 128). Default 128. */
  maxBatch?: number;
  /** Max retry attempts on 429 / 5xx / timeout. Default 3. */
  maxRetries?: number;
  /** Per-request timeout in ms. Default 30000. */
  timeout?: number;
  /**
   * Override the API endpoint. Mainly for tests / private proxies
   * (e.g. a regional endpoint). Defaults to the public v2 translate URL.
   */
  endpoint?: string;
}

interface GoogleResponse {
  data?: {
    translations?: Array<{ translatedText: string; detectedSourceLanguage?: string }>;
  };
}

/**
 * Translator that calls Google Cloud Translation API v2 over HTTPS.
 * Implements ITranslator so it is a drop-in replacement for DeepLTranslator.
 */
export class GoogleTranslator implements ITranslator {
  private opts: Required<
    Pick<GoogleTranslatorOptions, 'maxBatch' | 'maxRetries' | 'targetLang' | 'model' | 'timeout'>
  > &
    GoogleTranslatorOptions;

  private readonly defaultEndpoint =
    'https://translation.googleapis.com/language/translate/v2';
  private endpoint: string;
  private bearerToken: string | null = null;
  private tokenPromise: Promise<void> | null = null;

  constructor(options: GoogleTranslatorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.GOOGLE_API_KEY ?? '';
    const credentialsPath = options.credentialsPath ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;

    if (!apiKey && !credentialsPath) {
      throw new Error(
        'GoogleTranslator: no credentials configured. ' +
          'Set --api-key / GOOGLE_API_KEY (API key), or provide credentialsPath / ' +
          'GOOGLE_APPLICATION_CREDENTIALS (service-account key.json).'
      );
    }

    this.opts = {
      apiKey,
      credentialsPath,
      targetLang: options.targetLang ?? 'zh',
      model: options.model ?? 'nmt',
      maxBatch: options.maxBatch ?? 128,
      maxRetries: options.maxRetries ?? 3,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      sourceLang: options.sourceLang,
    };

    this.endpoint = options.endpoint ?? this.defaultEndpoint;
  }

  /** Normalize "zh" / "zh-CN" / "ZH" -> Google's "zh-CN" style. */
  private normalizeLang(lang: string | undefined, fallback: string): string {
    const raw = (lang ?? fallback).trim().toLowerCase();
    const map: Record<string, string> = {
      zh: 'zh-CN', 'zh-cn': 'zh-CN', 'zh-hans': 'zh-CN',
      'zh-tw': 'zh-TW', 'zh-hant': 'zh-TW', 'zh-hk': 'zh-TW',
      ja: 'ja', ko: 'ko', en: 'en', de: 'de', fr: 'fr', es: 'es',
      ru: 'ru', it: 'it', pt: 'pt', 'pt-br': 'pt', 'pt-pt': 'pt',
    };
    return map[raw] ?? raw;
  }

  private getTarget(target?: string): string {
    return this.normalizeLang(target, this.opts.targetLang);
  }

  private getSource(): string | undefined {
    return this.opts.sourceLang ? this.normalizeLang(this.opts.sourceLang, '') : undefined;
  }

  /**
   * Resolve the `Authorization: Bearer <token>` header when a service-account
   * key is provided. Falls back to `?key=<apiKey>` query param.
   */
  private async authHeaders(): Promise<Record<string, string>> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    if (this.opts.credentialsPath) {
      if (!this.bearerToken) {
        if (!this.tokenPromise) this.tokenPromise = this.fetchBearerToken();
        await this.tokenPromise;
      }
      headers.Authorization = `Bearer ${this.bearerToken}`;
    }
    return headers;
  }

  private async fetchBearerToken(): Promise<void> {
    // Lazy-load the key file (avoids a hard dependency for API-key users).
    let keyJson: { client_email?: string; private_key?: string };
    try {
      keyJson = JSON.parse(require('fs').readFileSync(this.opts.credentialsPath!, 'utf-8'));
    } catch (e: any) {
      throw new Error(`GoogleTranslator: failed to read credentials ${this.opts.credentialsPath}: ${e.message}`);
    }

    // Use Google's JWT-less v1 token endpoint via a simple signed assertion.
    // We delegate signing to Node's built-in crypto; no extra deps required.
    // The token exchange gets the same deadline as a translation request, so a
    // stalled OAuth endpoint cannot hang the run either.
    const { googleAuthAssertion } = await import('./google-auth');
    this.bearerToken = await googleAuthAssertion(keyJson.client_email!, keyJson.private_key!, {
      timeoutMs: this.opts.timeout,
    });
  }

  private buildUrl(): string {
    if (this.opts.apiKey) {
      const sep = this.endpoint.includes('?') ? '&' : '?';
      return `${this.endpoint}${sep}key=${encodeURIComponent(this.opts.apiKey)}`;
    }
    return this.endpoint;
  }

  private async callApi(body: object): Promise<GoogleResponse> {
    // Hard deadline: without one, a server that accepts the connection and then
    // stalls would hang the process indefinitely (Node's fetch has no overall
    // request timeout).
    const res = await fetchWithTimeout(
      this.buildUrl(),
      {
        method: 'POST',
        headers: await this.authHeaders(),
        body: JSON.stringify(body),
      },
      this.opts.timeout,
      'Google Translate API'
    );

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`Google Translate API ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }

    return (await res.json()) as GoogleResponse;
  }

  private async translateMany(texts: string[]): Promise<string[]> {
    const target = this.getTarget();
    const source = this.getSource();

    const out: string[] = [];
    for (let i = 0; i < texts.length; i += this.opts.maxBatch) {
      const chunk = texts.slice(i, i + this.opts.maxBatch);
      const body: any = {
        q: chunk,
        target,
        format: 'text',
        model: this.opts.model === 'base' ? 'base' : undefined,
      };
      if (source) body.source = source;

      const data = await this.withRetry(() => this.callApi(body));
      const translations = data.data?.translations ?? [];
      chunk.forEach((orig, idx) => {
        out.push(translations[idx]?.translatedText ?? orig);
      });
    }
    return out;
  }

  async translate(text: string, _target?: string): Promise<string> {
    if (!text.trim()) return text;
    const result = await this.translateMany([text]);
    return result[0] ?? text;
  }

  async translateBatch(texts: string[], _target?: string): Promise<string[]> {
    const validTexts = texts.filter(t => t.trim());
    if (validTexts.length === 0) return texts;

    // Dedupe while preserving order so the engine's index mapping stays valid.
    const uniq = Array.from(new Set(validTexts));
    const translated = await this.translateMany(uniq);
    const map = new Map(uniq.map((t, i) => [t, translated[i] ?? t]));

    return texts.map(t => (t.trim() ? (map.get(t) ?? t) : t));
  }

  /**
   * Retry on rate-limit (429), 5xx errors, and timeouts. Other errors (e.g. 400
   * invalid target language) are thrown immediately.
   *
   * A timeout is exactly the "transient condition" retries exist for: the
   * server may simply have been slow on that one attempt.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < this.opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? e?.code;
        const retryable = isTimeoutError(e) || [429, 500, 502, 503].includes(Number(status));
        if (!retryable) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }
}
