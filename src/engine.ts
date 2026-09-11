import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { ITranslator, DeepLTranslator, createTranslator } from './translator';
import { extractComments, cleanCommentText, restoreComments, ExtractedComment } from './parser';
import { parseJSDoc, extractTranslatableParts, applyTranslations, serializeJSDoc } from './jsdoc-parser';
import { TermProtector, TermProtectorOptions } from './term-protector';

export interface EngineConfig {
  /** Source directory or file */
  input: string;
  /** Output directory (optional, defaults to overwrite or add .translated suffix) */
  output?: string;
  /** Translator instance */
  translator: ITranslator;
  /** File extensions to process (default: ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']) */
  extensions?: string[];
  /** Whether to process recursively */
  recursive?: boolean;
  /** Skip node_modules and other common directories */
  skipCommonDirs?: boolean;
  /** Custom delimiter for translation segments (internal use) */
  /** Dry run - don't write files */
  dryRun?: boolean;
  /** Verbose logging */
  verbose?: boolean;
  /** Show a progress bar (default: true when not verbose) */
  progress?: boolean;
  /** Terminology protection options (see ./term-protector). */
  terms?: TermProtectorOptions;
  /** 翻译缓存配置（断点续跑）。省略则禁用缓存。 */
  cache?: {
    /** 缓存目录，默认 .comment-translator-cache */
    cacheDir?: string;
    /** 是否禁用缓存（默认 false） */
    disabled?: boolean;
  };
  /** 引擎标识（用于缓存文件命名） */
  backend?: string;
  /** 目标语言（缓存键的一部分） */
  targetLang?: string;
}

const DEFAULT_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.d.ts'];
const SKIP_DIRS = ['node_modules', 'dist', 'build', '.next', '.git', 'coverage', '__tests__'];

/* ------------------------------------------------------------------ */
/*  Lightweight progress bar (no extra dependencies — uses chalk only)  */
/* ------------------------------------------------------------------ */

class ProgressBar {
  private barWidth = 30;
  private lastLine = '';

  constructor(private total: number, private label: string) {}

  update(current: number, extra = ''): void {
    const ratio = this.total > 0 ? Math.min(current / this.total, 1) : 1;
    const filled = Math.round(this.barWidth * ratio);
    const bar =
      chalk.green('█'.repeat(filled)) + chalk.gray('░'.repeat(this.barWidth - filled));
    const percent = Math.round(ratio * 100).toString().padStart(3);
    const line = `\r${chalk.bold(this.label)} [${bar}] ${percent}%  (${current}/${this.total})${extra ? '  ' + chalk.gray(extra) : ''}`;
    process.stdout.write(line);
    this.lastLine = line;
  }

  done(extra = ''): void {
    // Final update (100%) with the summary detail, then move to the next line
    // so the statistics block below renders cleanly.
    this.update(this.total, extra);
    process.stdout.write('\n');
    this.lastLine = '';
  }

  /** Erase the bar line so other logs can be printed cleanly above it. */
  clearLine(): void {
    if (!this.lastLine) return;
    process.stdout.write('\r\x1b[K');
    this.lastLine = '';
  }
}

/* ------------------------------------------------------------------ */

export class TranslationEngine {
  private config: (Omit<Required<Omit<EngineConfig, 'output' | 'terms' | 'cache' | 'backend'>>, 'targetLang'> & {
    output?: string;
    terms?: TermProtectorOptions;
    cache?: { cacheDir?: string; disabled?: boolean };
    backend?: string;
    targetLang?: string;
  });
  private protector: TermProtector | null = null;
  private translator: ITranslator;
  private stats = {
    filesProcessed: 0,
    filesSkipped: 0,
    commentsTranslated: 0,
    errors: 0,
    termsProtected: 0,
  };

  constructor(config: EngineConfig) {
    this.config = {
      extensions: DEFAULT_EXTENSIONS,
      recursive: true,
      skipCommonDirs: true,
      dryRun: false,
      verbose: false,
      progress: true,
      ...config,
    };

    // Keep a reference to the (possibly cached) translator for later use.
    this.translator = config.translator;

    // Lazily created on first use; null when no protection is configured.
    this.protector = this.config.terms ? new TermProtector(this.config.terms) : null;

    // The translator passed in is expected to ALREADY include the cache
    // decorator — createTranslator() in translator.ts wraps the raw backend
    // with CachedTranslator when opts.cache is set. That single wrapping point
    // avoids double-caching (which would corrupt hit-rate stats and waste
    // lookups). We just keep a reference here and flush it on shutdown.
    this.translator = config.translator;
  }

  /**
   * Run the translation process
   */
  async run(): Promise<void> {
    const { input } = this.config;
    const stat = fs.statSync(input);

    // Collect the full file list up-front so we can show a meaningful progress bar.
    const files = stat.isDirectory()
      ? this.collectFiles(input)
      : [input];

    if (this.shouldShowProgress()) {
      const bar = new ProgressBar(files.length, 'Files');
      (this as any)._fileBar = bar;
    }

    if (stat.isFile()) {
      await this.processFile(input, 0, files.length);
    } else if (stat.isDirectory()) {
      for (let i = 0; i < files.length; i++) {
        await this.processFile(files[i], i, files.length);
      }
    }

    this.finishProgress();
    this.printStats();

    // Flush pending cache writes to disk so nothing is lost after normal exit.
    // (Only relevant when the translator is cache-wrapped; harmless otherwise.)
    const t = this.translator as any;
    if (typeof t.flush === 'function') {
      t.flush();
    }
  }

  /** Walk the directory tree and return every file matching the configured extensions. */
  private collectFiles(dir: string): string[] {
    const out: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (this.config.skipCommonDirs && SKIP_DIRS.includes(entry.name)) continue;
        if (this.config.recursive) {
          out.push(...this.collectFiles(fullPath));
        }
      } else if (entry.isFile()) {
        if (matchesExtension(fullPath, this.config.extensions)) {
          out.push(fullPath);
        }
      }
    }
    return out;
  }

  private shouldShowProgress(): boolean {
    return this.config.progress && !this.config.verbose;
  }

  private updateFileProgress(current: number, total: number, extra: string): void {
    const bar: ProgressBar | undefined = (this as any)._fileBar;
    if (bar) bar.update(current, extra);
  }

  private finishProgress(): void {
    const bar: ProgressBar | undefined = (this as any)._fileBar;
    if (bar) bar.done(`${this.stats.commentsTranslated} comments translated`);
  }

  /**
   * Process all files in a directory
   */
  private async processDirectory(dir: string): Promise<void> {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (this.config.skipCommonDirs && SKIP_DIRS.includes(entry.name)) {
          if (this.config.verbose) {
            console.log(chalk.gray(`  Skipping directory: ${fullPath}`));
          }
          continue;
        }
        if (this.config.recursive) {
          await this.processDirectory(fullPath);
        }
      } else if (entry.isFile()) {
        await this.processFile(fullPath);
      }
    }
  }

  /**
   * Process a single file
   */
  private async processFile(
    filePath: string,
    index?: number,
    total?: number,
  ): Promise<void> {
    if (!matchesExtension(filePath, this.config.extensions)) {
      this.stats.filesSkipped++;
      return;
    }

    try {
      const source = fs.readFileSync(filePath, 'utf-8');
      const { comments } = extractComments(source, filePath);

      if (comments.length === 0) {
        if (this.config.verbose) {
          console.log(chalk.gray(`  No comments found: ${filePath}`));
        }
        this.stats.filesSkipped++;
        this.tickProgress(index, total, filePath);
        return;
      }

      if (this.config.verbose) {
        console.log(chalk.cyan(`\n📄 ${filePath}`) + chalk.gray(` (${comments.length} comments)`));
      }

      // Extract texts to translate
      const textsToTranslate: string[] = [];
      const commentMap = new Map<number, ExtractedComment>();

      for (const comment of comments) {
        const cleaned = cleanCommentText(comment);
        if (!cleaned.trim()) continue;

        if (comment.type === 'jsdoc') {
          // Use JSDoc-aware parsing
          const parsed = parseJSDoc(cleaned);
          const parts = extractTranslatableParts(parsed);
          if (parts.length > 0) {
            textsToTranslate.push(...parts);
            commentMap.set(comment.id, comment);
          }
        } else {
          // For block and line comments, translate the whole thing
          textsToTranslate.push(cleaned);
          commentMap.set(comment.id, comment);
        }
      }

      if (textsToTranslate.length === 0) {
        this.stats.filesSkipped++;
        this.tickProgress(index, total, filePath);
        return;
      }

      // Batch translate
      if (this.config.verbose) {
        console.log(chalk.gray(`  Translating ${textsToTranslate.length} text segment(s)...`));
      }

      // Protect terms/identifiers/URLs before sending to the API, then restore
      // the originals after translation. Backend-agnostic.
      let textsForApi = textsToTranslate;
      if (this.protector) {
        textsForApi = this.protector.protectBatch(textsToTranslate);
        this.stats.termsProtected += this.protector.protectedCount;
      }

      const translations = await this.config.translator.translateBatch(textsForApi);

      const finalTranslations = this.protector
        ? this.protector.restoreBatch(translations)
        : translations;

      // Apply translations back to comments
      const translationMap = new Map<number, string>();
      let transIdx = 0;

      for (const comment of comments) {
        if (!commentMap.has(comment.id)) continue;

        const cleaned = cleanCommentText(comment);

        if (comment.type === 'jsdoc') {
          const parsed = parseJSDoc(cleaned);
          const parts = extractTranslatableParts(parsed);

          if (parts.length > 0) {
            const translatedParts = finalTranslations.slice(transIdx, transIdx + parts.length);
            transIdx += parts.length;

            const updated = applyTranslations(parsed, translatedParts);
            const serialized = serializeJSDoc(updated);
            translationMap.set(comment.id, serialized);
            this.stats.commentsTranslated++;
          }
        } else {
          // For block/line comments
          const translated = finalTranslations[transIdx++] || cleaned;
          translationMap.set(comment.id, translated);
          this.stats.commentsTranslated++;
        }
      }

      // Restore comments in source
      const newSource = restoreComments(source, comments, translationMap);

      // Write output
      const outputPath = this.getOutputPath(filePath);
      if (!this.config.dryRun) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, newSource, 'utf-8');
      }

      if (this.config.verbose) {
        console.log(chalk.green(`  ✓ Translated → ${outputPath}`));
      }

      this.stats.filesProcessed++;
      this.tickProgress(index, total, filePath);
    } catch (error: any) {
      this.stats.errors++;
      // Errors should still be visible even when the progress bar is active.
      this.clearProgressLine();
      console.error(chalk.red(`  ✗ Error processing ${filePath}: ${error.message}`));
      this.tickProgress(index, total, filePath);
    }
  }

  /** Advance the file-level progress bar by one. */
  private tickProgress(index?: number, total?: number, filePath?: string): void {
    if (!this.shouldShowProgress()) return;
    if (index === undefined || total === undefined) return;
    const name = filePath ? path.basename(filePath) : '';
    this.updateFileProgress(index + 1, total, name);
  }

  private clearProgressLine(): void {
    if (this.shouldShowProgress()) {
      process.stdout.write('\r\x1b[K');
    }
  }

  /**
   * Determine output path for a file
   */
  private getOutputPath(filePath: string): string {
    if (this.config.output) {
      const inputStat = fs.statSync(this.config.input);
      if (inputStat.isFile()) {
        // Single file: output is the specified path
        return this.config.output;
      } else {
        // Directory: preserve relative structure
        const relative = path.relative(this.config.input, filePath);
        return path.join(this.config.output, relative);
      }
    }

    // Default: add .translated suffix before extension
    const ext = path.extname(filePath);
    const base = filePath.slice(0, -ext.length);
    return `${base}.translated${ext}`;
  }

  /**
   * Print summary statistics
   */
  private printStats(): void {
    console.log(chalk.bold('\n📊 Translation Summary'));
    console.log(chalk.gray('─'.repeat(40)));
    console.log(`  Files processed:    ${chalk.green(this.stats.filesProcessed)}`);
    console.log(`  Files skipped:      ${chalk.gray(this.stats.filesSkipped)}`);
    console.log(`  Comments translated: ${chalk.green(this.stats.commentsTranslated)}`);
    if (this.stats.termsProtected > 0) {
      console.log(`  Terms protected:    ${chalk.cyan(this.stats.termsProtected)}`);
    }
    if (this.stats.errors > 0) {
      console.log(`  Errors:             ${chalk.red(this.stats.errors)}`);
    }
    // Duck-type check: the translator may be a CachedTranslator (when caching
    // is enabled) or a plain backend. Both expose translate/translateBatch;
    // only the cached variant has flush/printStats.
    const t = this.translator as any;
    if (typeof t.printStats === 'function') {
      t.printStats();
    }
    console.log(chalk.gray('─'.repeat(40)));
  }
}

/**
 * Match a file path against supported extensions.
 * Handles double-suffix files like "index.d.ts" where path.extname() returns ".ts":
 * we check whether the path ends with any of the configured extensions.
 */
function matchesExtension(filePath: string, extensions: string[]): boolean {
  const lower = filePath.toLowerCase();
  return extensions.some(ext => lower.endsWith(ext.toLowerCase()));
}
