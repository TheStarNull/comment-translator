/**
 * LibreTranslate translator backend.
 *
 * LibreTranslate is a FREE, open-source, self-hostable machine translation API.
 * It does NOT require an API key for local/private instances (though the public
 * instance at libretranslate.com may require one).
 *
 * API endpoint (POST /translate):
 *   Request:  { q: string, source: string, target: string, format?: string, api_key?: string }
 *   Response: { translatedText: string, detectedLanguage?: {...}, alternatives?: string[] }
 *
 * Key characteristics:
 *   - Language codes are lower-case ISO 639-1 (e.g. "en", "zh", "ja", "es")
 *   - "auto" for source = auto-detect
 *   - No proprietary dependencies (powered by Argos Translate)
 *   - Can be self-hosted via Docker: docker run -ti --rm -p 5000:5000 libretranslate/libretranslate
 *
 * Docs: https://libretranslate.com/docs
 */

import { ITranslator } from './translator';
import { DEFAULT_TIMEOUT_MS, fetchWithTimeout, isTimeoutError } from './fetch-timeout';

export interface LibreTranslateOptions {
  /** Base URL of the LibreTranslate instance.
   *  Defaults to process.env.LIBRETRANSLATE_URL or "http://localhost:5000".
   *  Use "https://libretranslate.com" for the public hosted instance. */
  baseUrl?: string;
  /** API key (only needed for protected instances). Falls back to env LIBRETRANSLATE_API_KEY. */
  apiKey?: string;
  /** Source language code (e.g. "en"). Use "auto" or omit for auto-detect. */
  sourceLang?: string;
  /** Target language code (e.g. "zh", "en", "ja"). Defaults to "zh". */
  targetLang?: string;
  /** Max texts per batch request (LibreTranslate has no fixed limit, but we batch for efficiency). Default 50. */
  maxBatch?: number;
  /** Max retry attempts on 429 / 5xx / timeout. Default 3. */
  maxRetries?: number;
  /** Request timeout in milliseconds. Default 30000. */
  timeout?: number;
}

interface LibreTranslateResponse {
  translatedText?: string;
  error?: string;
  detectedLanguage?: { confidence: number; language: string };
  alternatives?: string[];
}

/**
 * Translator that calls a LibreTranslate instance over HTTPS.
 * Implements ITranslator so it is a drop-in replacement for DeepLTranslator / GoogleTranslator.
 */
export class LibreTranslateTranslator implements ITranslator {
  private opts: Required<
    Pick<LibreTranslateOptions, 'maxBatch' | 'maxRetries' | 'targetLang' | 'timeout'>
  > &
    LibreTranslateOptions;

  constructor(options: LibreTranslateOptions = {}) {
    const baseUrl =
      options.baseUrl ??
      process.env.LIBRETRANSLATE_URL ??
      'http://localhost:5000';

    this.opts = {
      baseUrl: baseUrl.replace(/\/$/, ''), // strip trailing slash
      apiKey: options.apiKey ?? process.env.LIBRETRANSLATE_API_KEY ?? '',
      targetLang: options.targetLang ?? 'zh',
      maxBatch: options.maxBatch ?? 50,
      maxRetries: options.maxRetries ?? 3,
      timeout: options.timeout ?? DEFAULT_TIMEOUT_MS,
      sourceLang: options.sourceLang,
    };
  }

  /**
   * Normalize language codes to LibreTranslate's expected format (lowercase ISO 639-1).
   * Accepts "ZH" / "zh-CN" / "zh" -> "zh", "EN" -> "en", etc.
   * LibreTranslate uses simple 2-letter codes: en, zh, ja, ko, de, fr, es, ru, it, pt, ar, hi, tr, vi...
   */
  private normalizeLang(lang: string | undefined, fallback: string): string {
    const raw = (lang ?? fallback).trim().toLowerCase();
    // Map common variants to LibreTranslate's 2-letter codes
    const map: Record<string, string> = {
      'zh-cn': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh', 'zh-tw': 'zh', 'zh-hk': 'zh',
      'pt-br': 'pt', 'pt-pt': 'pt',
      en: 'en', ja: 'ja', ko: 'ko', de: 'de', fr: 'fr', es: 'es',
      ru: 'ru', it: 'it', nl: 'nl', pl: 'pl', tr: 'tr', vi: 'vi',
      ar: 'ar', hi: 'hi', th: 'th', cs: 'cs', sv: 'sv', da: 'da', fi: 'fi',
      no: 'no', hu: 'hu', el: 'el', he: 'he', id: 'id', ms: 'ms', fa: 'fa',
      uk: 'uk', bg: 'bg', ro: 'ro', sk: 'sk', sl: 'sl', hr: 'hr', lt: 'lt', lv: 'lv',
    };
    return map[raw] ?? raw.split('-')[0] ?? raw;
  }

  private getTarget(target?: string): string {
    return this.normalizeLang(target, this.opts.targetLang);
  }

  private getSource(): string {
    if (this.opts.sourceLang) return this.normalizeLang(this.opts.sourceLang, 'auto');
    return 'auto';
  }

  /** Build the request body for the /translate endpoint. */
  private buildBody(texts: string[], target: string): Record<string, any> {
    const body: Record<string, any> = {
      q: texts.length === 1 ? texts[0] : texts,
      source: this.getSource(),
      target,
      format: 'text',
    };
    if (this.opts.apiKey) body.api_key = this.opts.apiKey;
    return body;
  }

  /** Single translate call (handles both single string and array mode). */
  private async callTranslate(texts: string[], target: string): Promise<string[]> {
    const url = `${this.opts.baseUrl}/translate`;

    // Shared deadline helper (see ./fetch-timeout). Replaces the previous
    // hand-rolled AbortController so every backend behaves identically.
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.buildBody(texts, target)),
      },
      this.opts.timeout,
      'LibreTranslate API'
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const err: any = new Error(
        `LibreTranslate API ${res.status}: ${errText.slice(0, 500)}`
      );
      err.status = res.status;
      throw err;
    }

    const data = (await res.json()) as LibreTranslateResponse | LibreTranslateResponse[];

    // Response format depends on whether "q" was a string or array:
    //   Single:  { translatedText: "..." }
    //   Array:   [{ translatedText: "..." }, ...]
    const results: LibreTranslateResponse[] = Array.isArray(data)
      ? (data as LibreTranslateResponse[])
      : [{ translatedText: (data as LibreTranslateResponse).translatedText ?? '' }];

    return results.map(r => r.translatedText ?? '');
  }

  async translate(text: string, target?: string): Promise<string> {
    if (!text.trim()) return text;
    const targetLang = this.getTarget(target);
    return this.withRetry(async () => {
      const results = await this.callTranslate([text], targetLang);
      return results[0] ?? text;
    });
  }

  async translateBatch(texts: string[], target?: string): Promise<string[]> {
    const validTexts = texts.filter(t => t.trim());
    if (validTexts.length === 0) return texts;

    const targetLang = this.getTarget(target);
    const uniq = Array.from(new Set(validTexts));
    const outMap = new Map<string, string>();

    for (let i = 0; i < uniq.length; i += this.opts.maxBatch) {
      const chunk = uniq.slice(i, i + this.opts.maxBatch);
      const results = await this.withRetry(() => this.callTranslate(chunk, targetLang));
      chunk.forEach((t, idx) => {
        outMap.set(t, results[idx] ?? t);
      });
    }

    return texts.map(t => (t.trim() ? (outMap.get(t) ?? t) : t));
  }

  /**
   * Retry on rate-limit (429), 5xx errors, and timeouts. Other errors are
   * thrown immediately. A self-hosted instance under load is exactly the case
   * where one slow attempt should not abort the whole run.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < this.opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? e?.code;
        // 429 = slow down, 5xx = server error, timeout = transient
        const retryable = isTimeoutError(e) || [429, 500, 502, 503].includes(Number(status));
        if (!retryable) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }
}
