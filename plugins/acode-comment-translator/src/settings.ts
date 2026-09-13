/**
 * Plugin settings: defaults, persistence and the descriptor list Acode renders.
 *
 * Persistence uses `localStorage` rather than Acode's app-settings store,
 * because these are *plugin* settings and must not leak into (or be reset by)
 * the editor's own settings. API keys are intentionally NOT stored here — they
 * belong in `ctx.setSecret()`, which keeps them out of the settings blob.
 */
import { BackendName, isBackendName } from './core/backend';

const STORAGE_KEY = 'acode.comment-translator.settings.v1';

export interface PluginSettings {
  backend: BackendName;
  targetLang: string;
  sourceLang: string;
  /** Translate automatically every time a file is saved. */
  onSave: boolean;
  /** Protect identifiers / URLs / code spans / placeholders. */
  protect: boolean;
  /** LibreTranslate instance URL. */
  libreUrl: string;
  /** Per-request timeout in ms. */
  timeout: number;
}

/**
 * Defaults. `backend: 'mock'` is deliberate: it lets the whole flow be
 * exercised offline before any key is configured, and — since simulated output
 * is clearly marked `[zh] …` — it can never be mistaken for a real translation.
 */
export const DEFAULT_SETTINGS: PluginSettings = {
  backend: 'mock',
  targetLang: 'zh',
  sourceLang: '',
  onSave: false,
  protect: true,
  libreUrl: 'http://localhost:5000',
  timeout: 30000,
};

let cache: PluginSettings | null = null;

/** Coerce whatever was persisted into a valid settings object. */
function sanitize(raw: unknown): PluginSettings {
  const input = (raw ?? {}) as Partial<Record<keyof PluginSettings, unknown>>;
  const out: PluginSettings = { ...DEFAULT_SETTINGS };

  if (typeof input.backend === 'string' && isBackendName(input.backend)) {
    out.backend = input.backend;
  }
  if (typeof input.targetLang === 'string' && input.targetLang.trim()) {
    out.targetLang = input.targetLang.trim();
  }
  if (typeof input.sourceLang === 'string') {
    out.sourceLang = input.sourceLang.trim();
  }
  if (typeof input.onSave === 'boolean') out.onSave = input.onSave;
  if (typeof input.protect === 'boolean') out.protect = input.protect;
  if (typeof input.libreUrl === 'string' && input.libreUrl.trim()) {
    out.libreUrl = input.libreUrl.trim();
  }
  if (typeof input.timeout === 'number' && Number.isFinite(input.timeout) && input.timeout > 0) {
    out.timeout = input.timeout;
  }

  return out;
}

export function loadSettings(): PluginSettings {
  if (cache) return cache;
  let raw: unknown = null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) raw = JSON.parse(stored);
  } catch {
    // Corrupt or unavailable storage → fall back to defaults rather than crash.
    raw = null;
  }
  cache = sanitize(raw);
  return cache;
}

export function saveSettings(patch: Partial<PluginSettings>): PluginSettings {
  const next = sanitize({ ...loadSettings(), ...patch });
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full/unavailable: settings stay in memory for this session.
  }
  return next;
}

/** Reset to defaults (used by the "reset" entry in the settings page). */
export function resetSettings(): PluginSettings {
  cache = { ...DEFAULT_SETTINGS };
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
  return cache;
}

/**
 * Descriptors for Acode's plugin settings page.
 *
 * Rebuilt on every call so the current values are reflected; pass it to
 * `acode.setPluginInit(id, init, settings)`.
 */
export function settingsDescriptor(): Acode.PluginSettings {
  const s = loadSettings();
  return {
    list: [
      {
        key: 'backend',
        text: 'Backend',
        info: 'Translated with a simulated backend until a real one is configured.',
        value: s.backend,
        select: [
          ['mock', 'Mock (offline, simulated)'],
          ['libretranslate', 'LibreTranslate'],
        ],
      },
      {
        key: 'targetLang',
        text: 'Target language',
        prompt: 'Target language',
        promptType: 'text',
        value: s.targetLang,
      },
      {
        key: 'onSave',
        text: 'Translate on save',
        info: 'Automatically translate comments whenever a file is saved.',
        checkbox: true,
        value: s.onSave,
      },
      {
        key: 'protect',
        text: 'Protect code terms',
        info: 'Keep identifiers, URLs, `code spans` and %s placeholders verbatim.',
        checkbox: true,
        value: s.protect,
      },
      {
        key: 'libreUrl',
        text: 'LibreTranslate URL',
        prompt: 'LibreTranslate URL',
        promptType: 'text',
        value: s.libreUrl,
      },
    ],
    cb(key: string, value: unknown) {
      saveSettings({ [key]: value } as Partial<PluginSettings>);
    },
  };
}
