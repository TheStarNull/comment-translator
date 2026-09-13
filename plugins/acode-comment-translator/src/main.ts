/**
 * Acode plugin entry point.
 *
 * Registers the commands, hooks "translate on save", and wires the settings
 * page. All the actual work lives in `./core` — this file is only glue between
 * Acode's APIs and the translator.
 */
import plugin from '../plugin.json';
import { loadSettings, saveSettings, settingsDescriptor, DEFAULT_SETTINGS } from './settings';
import { createBackend } from './core/backend';
import { translateSource, TranslateSourceResult } from './core/translate-source';

/** Acode exposes these as globals inside its WebView. */
declare const acode: any;
declare const editorManager: any;
declare const toast: (message: string, duration?: number) => void;

class CommentTranslatorPlugin {
  /** Where Acode mounted this plugin (handy for loading assets later). */
  baseUrl = '';
  /** Files we already wrapped, so a re-load does not stack handlers. */
  private hooked = new WeakSet<object>();
  /** Files currently being translated on save — prevents a save/translate loop. */
  private inFlight = new Set<string>();

  async init(baseUrl: string): Promise<void> {
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
    this.registerCommands();
    this.hookOnSave();
  }

  destroy(): void {
    try {
      const commands = acode.require('commands');
      for (const name of [
        'comment-translator:translate',
        'comment-translator:toggle-on-save',
        'comment-translator:status',
      ]) {
        commands.removeCommand(name);
      }
    } catch {
      /* editor teardown: nothing useful to do */
    }
  }

  /* ---------------------------------------------------------------- */
  /* Commands                                                          */
  /* ---------------------------------------------------------------- */

  private registerCommands(): void {
    const commands = acode.require('commands');

    commands.addCommand({
      name: 'comment-translator:translate',
      description: 'Comment Translator: translate comments in the current file',
      exec: () => this.runCommand(() => this.translateActiveFile()),
    });

    commands.addCommand({
      name: 'comment-translator:toggle-on-save',
      description: 'Comment Translator: toggle translate-on-save',
      exec: () => this.runCommand(() => this.toggleOnSave()),
    });

    commands.addCommand({
      name: 'comment-translator:status',
      description: 'Comment Translator: show current settings',
      exec: () => this.runCommand(() => this.showStatus()),
    });
  }

  /** Run an async command, turning any failure into a toast instead of a crash. */
  private runCommand(action: () => Promise<void>): boolean {
    void action().catch(err => this.notify('✗ ' + describeError(err), 4000));
    return true;
  }

  /* ---------------------------------------------------------------- */
  /* Actions                                                           */
  /* ---------------------------------------------------------------- */

  private async translateActiveFile(): Promise<void> {
    const editor = editorManager.editor;
    const file = editorManager.activeFile;
    if (!editor) {
      this.notify('No file is open.');
      return;
    }

    const settings = loadSettings();
    const source: string = editor.getValue();

    const result = await this.translateText(source, file?.name ?? 'untitled.ts', settings);

    if (result.total === 0) {
      this.notify('No comments found in this file.');
      return;
    }

    if (result.unchanged) {
      this.notify(`Nothing to translate (${result.total} comment(s) already translated).`);
      return;
    }

    editor.setValue(result.output);
    this.notify(
      `✓ ${result.translated}/${result.total} comment(s) → ${settings.targetLang}` +
        (settings.backend === 'mock' ? ' (simulated)' : ''),
      3000
    );
  }

  private async toggleOnSave(): Promise<void> {
    const next = saveSettings({ onSave: !loadSettings().onSave });
    this.notify(`Translate on save: ${next.onSave ? 'ON' : 'OFF'}`);
  }

  private async showStatus(): Promise<void> {
    const s = loadSettings();
    const lines = [
      `Backend:   ${s.backend}${s.backend === 'mock' ? ' (simulated output)' : ''}`,
      `Target:    ${s.targetLang}`,
      `Source:    ${s.sourceLang || '(auto)'}`,
      `On save:   ${s.onSave ? 'ON' : 'OFF'}`,
      `Protect:   ${s.protect ? 'ON' : 'OFF'}`,
      s.backend === 'libretranslate' ? `URL:       ${s.libreUrl}` : '',
    ].filter(Boolean);
    this.notify(lines.join('\n'), 4000);
  }

  /* ---------------------------------------------------------------- */
  /* Shared translation step                                           */
  /* ---------------------------------------------------------------- */

  private async translateText(
    source: string,
    filename: string,
    settings = loadSettings()
  ): Promise<TranslateSourceResult> {
    const translator = createBackend(settings.backend, {
      targetLang: settings.targetLang,
      sourceLang: settings.sourceLang || undefined,
      libreUrl: settings.libreUrl,
      timeout: settings.timeout,
    });

    return translateSource(source, {
      filename,
      targetLang: settings.targetLang,
      translator,
      protect: settings.protect,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Translate on save                                                 */
  /* ---------------------------------------------------------------- */

  private hookOnSave(): void {
    const attach = (file: any) => {
      if (!file || this.hooked.has(file)) return;
      this.hooked.add(file);

      // Chain to any existing handler so we never steal another plugin's hook.
      const previous = file.onsave;
      file.onsave = (event: any) => {
        try {
          previous?.(event);
        } catch {
          /* a broken third-party hook must not stop us */
        }
        if (!loadSettings().onSave) return;
        void this.translateOnSave(file);
      };
    };

    try {
      editorManager.on('file-loaded', attach);
      editorManager.on('switch-file', () => attach(editorManager.activeFile));
      attach(editorManager.activeFile);
    } catch {
      // Older Acode builds may not emit these events; the command still works.
    }
  }

  private async translateOnSave(file: any): Promise<void> {
    const key = file?.uri ?? file?.name ?? 'active';
    if (this.inFlight.has(key)) return; // our own re-save: ignore

    this.inFlight.add(key);
    try {
      const editor = editorManager.editor;
      if (!editor) return;

      const settings = loadSettings();
      const result = await this.translateText(editor.getValue(), file?.name ?? 'untitled.ts', settings);
      if (result.unchanged) return;

      editor.setValue(result.output);
      await file.save(); // persists the translation; guarded by `inFlight`
      this.notify(
        `✓ Translated ${result.translated} comment(s) on save` +
          (settings.backend === 'mock' ? ' (simulated)' : ''),
        2500
      );
    } catch (err) {
      // A failed auto-translation must never lose the user's saved work.
      this.notify('✗ Translate on save failed: ' + describeError(err), 4000);
    } finally {
      this.inFlight.delete(key);
    }
  }

  /* ---------------------------------------------------------------- */

  private notify(message: string, duration = 2500): void {
    try {
      toast(message, duration);
    } catch {
      // `toast` is absent in some contexts (e.g. headless tests).
    }
  }
}

/** Human-readable message from anything that can be thrown. */
function describeError(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return String(err);
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

if (typeof window !== 'undefined' && (window as any).acode) {
  const instance = new CommentTranslatorPlugin();

  acode.setPluginInit(
    plugin.id,
    async (baseUrl: string) => {
      await instance.init(baseUrl);
    },
    settingsDescriptor()
  );

  acode.setPluginUnmount(plugin.id, () => {
    instance.destroy();
  });
}

export { CommentTranslatorPlugin, DEFAULT_SETTINGS, describeError };
