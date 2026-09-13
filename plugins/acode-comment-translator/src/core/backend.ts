/**
 * Backend factory for the plugin.
 *
 * Only the backends that work inside a WebView are offered here. Everything
 * reaches the network with `fetch`, so there is no SDK to bundle.
 *
 * Not yet supported (see readme): DeepL and Google. The CLI talks to DeepL
 * through the `deepl-node` SDK and signs Google service-account tokens with
 * node's `crypto`, neither of which exists in the WebView. Both can be added
 * later with plain REST calls — the REST endpoints are documented and the
 * translators already normalise their responses, but that is a separate change
 * and is deliberately not faked here.
 */
import { MockTranslator } from '@core/mock-translator';
import { LibreTranslateTranslator } from '@core/libretranslate-translator';

/** Minimal shape the engine needs — structurally matches core's `ITranslator`. */
export interface Translator {
  translate(text: string, target?: string): Promise<string>;
  translateBatch(texts: string[], target?: string): Promise<string[]>;
}

export type BackendName = 'mock' | 'libretranslate';

export const BACKEND_NAMES: readonly BackendName[] = ['mock', 'libretranslate'];

export interface BackendOptions {
  /** Target language tag, e.g. `zh`, `ja`. */
  targetLang: string;
  /** Source language tag (optional; auto-detected by the backend otherwise). */
  sourceLang?: string;
  /** LibreTranslate only. */
  libreUrl?: string;
  /** LibreTranslate only. */
  libreApiKey?: string;
  /** Per-request timeout in ms. */
  timeout?: number;
}

export function isBackendName(value: string): value is BackendName {
  return (BACKEND_NAMES as readonly string[]).includes(value);
}

/**
 * Create a translator for `name`.
 *
 * Unknown names throw rather than silently falling back — a typo in a settings
 * field must not quietly turn into "simulated output that looks successful".
 */
export function createBackend(name: BackendName, opts: BackendOptions): Translator {
  switch (name) {
    case 'mock':
      return new MockTranslator({ targetLanguage: opts.targetLang });

    case 'libretranslate':
      return new LibreTranslateTranslator({
        baseUrl: opts.libreUrl,
        apiKey: opts.libreApiKey,
        targetLang: opts.targetLang,
        sourceLang: opts.sourceLang,
        timeout: opts.timeout,
      });

    default: {
      // Exhaustiveness guard: adding a BackendName without a case fails to compile.
      const never: never = name;
      throw new Error(`Unsupported backend: ${String(never)}`);
    }
  }
}
