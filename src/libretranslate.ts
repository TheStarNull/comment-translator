/**
 * LibreTranslate translator backend.
 *
 * LibreTranslate is a FREE, open-source machine translation API.
 * It can be self-hosted or used via a public instance.
 *
 * Key features:
 *   - 100% free, no API key required (unless the instance enforces one)
 *   - Supports 30+ languages
 *   - Simple REST API: POST /translate
 *
 * Public instances (may have rate limits):
 *   - https://libretranslate.com        (official, requires API key)
 *   - https://translate.argosopentech.com (free, no key)
 *   - https://libretranslate.de          (free, no key)
 *
 * Self-host with Docker:
 *   docker run -d -p 5000:5000 libretranslate/libretranslate
 *
 * API docs: https://libretranslate.com/docs
 */

import { ITranslator } from './translator';

export interface LibreTranslateOptions {
  /** LibreTranslate server URL (default: https://libretranslate.com) */
  endpoint?: string;
  /** API key (optional for some public instances, required for libretranslate.com) */
  apiKey?: string;
  /** Source language code (e.g. 'en'). Omit for auto-detect. */
  sourceLang?: string;
  /** Target language code (e.g. 'zh', 'en', 'ja'). Defaults to 'zh'. */
  targetLang?: string;
  /** Max texts per batch request (default: 25, LibreTranslate limit). */
  maxBatch?: number;
  /** Max retry attempts on 429 / 5xx. Default 3. */
  maxRetries?: number;
}

interface LibreTranslateResponse {
  translatedText?: string;
}

/**
 * Translator that calls a LibreTranslate-compatible server over HTTPS.
 * Implements ITranslator so it is a drop-in replacement for DeepLTranslator / GoogleTranslator.
 */
export class LibreTranslateTranslator implements ITranslator {
  private opts: Required<
    Pick<LibreTranslateOptions, 'maxBatch' | 'maxRetries' | 'targetLang' | 'endpoint'>
  > &
    LibreTranslateOptions;

  constructor(options: LibreTranslateOptions = {}) {
    this.opts = {
      endpoint: options.endpoint ?? process.env.LIBRETRANSLATE_URL ?? 'https://libretranslate.com',
      apiKey: options.apiKey ?? process.env.LIBRETRANSLATE_API_KEY,
      targetLang: options.targetLang ?? 'zh',
      maxBatch: options.maxBatch ?? 25,
      maxRetries: options.maxRetries ?? 3,
      sourceLang: options.sourceLang,
    };
  }

  /** Normalize language codes to LibreTranslate format (lowercase, e.g. "zh", "en"). */
  private normalizeLang(lang: string | undefined, fallback: string): string {
    const raw = (lang ?? fallback).trim().toLowerCase();
    // Map common variants to LibreTranslate's expected codes
    const map: Record<string, string> = {
      zh: 'zh', 'zh-cn': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh', 'zh-tw': 'zh',
      en: 'en', ja: 'ja', ko: 'ko', de: 'de', fr: 'fr', es: 'es',
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
   * Translate a batch of texts via LibreTranslate's /translate endpoint.
   * LibreTranslate accepts an array of "q" values for batch translation.
   */
  private async translateMany(texts: string[]): Promise<string[]> {
    const target = this.getTarget();
    const source = this.getSource();
    const out: string[] = [];

    for (let i = 0; i < texts.length; i += this.opts.maxBatch) {
      const chunk = texts.slice(i, i + this.opts.maxBatch);

      const body: Record<string, any> = {
        q: chunk.length === 1 ? chunk[0] : chunk,
        source: source ?? 'auto',
        target,
        format: 'text',
      };
      if (this.opts.apiKey) {
        body.api_key = this.opts.apiKey;
      }

      const results = await this.withRetry(() => this.callApi(body));

      // LibreTranslate returns either:
      //   single:  { translatedText: "..." }
      //   batch:   [{ translatedText: "..." }, ...]
      const arr = Array.isArray(results) ? results : [results];
      chunk.forEach((orig, idx) => {
        out.push(arr[idx]?.translatedText ?? orig);
      });
    }

    return out;
  }

  private async callApi(body: Record<string, any>): Promise<LibreTranslateResponse | LibreTranslateResponse[]> {
    const url = `${this.opts.endpoint.replace(/\/$/, '')}/translate`;

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };

    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err: any = new Error(`LibreTranslate API ${res.status}: ${text.slice(0, 500)}`);
      err.status = res.status;
      throw err;
    }

    return (await res.json()) as LibreTranslateResponse | LibreTranslateResponse[];
  }

  async translate(text: string, target?: string): Promise<string> {
    if (!text.trim()) return text;
    const result = await this.translateMany([text]);
    return result[0] ?? text;
  }

  async translateBatch(texts: string[], target?: string): Promise<string[]> {
    const validTexts = texts.filter(t => t.trim());
    if (validTexts.length === 0) return texts;

    // Dedupe while preserving order
    const uniq = Array.from(new Set(validTexts));
    const translated = await this.translateMany(uniq);
    const map = new Map(uniq.map((t, i) => [t, translated[i] ?? t]));

    return texts.map(t => (t.trim() ? (map.get(t) ?? t) : t));
  }

  /**
   * Retry on rate-limit (429) and 5xx errors.
   * Other errors (e.g. 400 invalid target language) are thrown immediately.
   */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let lastErr: any;
    for (let attempt = 0; attempt < this.opts.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const status = e?.status ?? e?.code;
        if (![429, 500, 502, 503].includes(Number(status))) throw e;
        const wait = Math.min(1000 * 2 ** attempt, 8000);
        await new Promise(r => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }
}
