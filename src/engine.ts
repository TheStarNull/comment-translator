import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { ITranslator, DeepLTranslator } from './translator';
import { extractComments, cleanCommentText, restoreComments, ExtractedComment } from './parser';
import { parseJSDoc, extractTranslatableParts, applyTranslations, serializeJSDoc } from './jsdoc-parser';

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
  /** Show a progress bar while translating (default: true) */
  progress?: boolean;
}

const DEFAULT_EXTENSIONS = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.d.ts'];
const SKIP_DIRS = ['node_modules', 'dist', 'build', '.next', '.git', 'coverage', '__tests__'];

/**
 * Match a file path against supported extensions.
 * Handles double-suffix files like "index.d.ts" where path.extname() returns ".ts":
 * we check whether the path ends with any of the configured extensions.
 */
function matchesExtension(filePath: string, extensions: string[]): boolean {
  const lower = filePath.toLowerCase();
  return extensions.some(ext => lower.endsWith(ext.toLowerCase()));
}

export class TranslationEngine {
  private config: Required<Omit<EngineConfig, 'output'>> & { output?: string };
  private stats = {
    filesProcessed: 0,
    filesSkipped: 0,
    commentsTranslated: 0,
    errors: 0,
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
  }

  /**
   * Collect every file that will be processed, so we can show an accurate
   * progress bar (total count is known up front).
   */
  private collectFiles(dir: string): string[] {
    const out: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (this.config.skipCommonDirs && SKIP_DIRS.includes(entry.name)) continue;
        if (this.config.recursive) out.push(...this.collectFiles(full));
      } else if (entry.isFile() && matchesExtension(full, this.config.extensions)) {
        out.push(full);
      }
    }
    return out;
  }

  /**
   * Run the translation process
   */
  async run(): Promise<void> {
    const { input } = this.config;
    const stat = fs.statSync(input);

    // Build a progress bar (file-level) if enabled and we have a directory.
    let bar: { update: (n: number, ctx?: any) => void; stop: () => void } | null = null;
    let totalFiles = 0;
    let doneFiles = 0;

    const showProgress = this.config.progress && !this.config.verbose;
    if (showProgress) {
      if (stat.isDirectory()) {
        try { totalFiles = this.collectFiles(input).length; } catch { totalFiles = 0; }
      } else {
        totalFiles = 1;
      }
    }

    if (showProgress && totalFiles > 0) {
      bar = createProgressBar(totalFiles);
    }

    const tick = (filePath: string) => {
      if (bar) {
        doneFiles++;
        bar.update(doneFiles, { file: path.basename(filePath) });
      }
    };

    if (stat.isFile()) {
      await this.processFile(input, tick);
    } else if (stat.isDirectory()) {
      await this.processDirectory(input, tick);
    }

    if (bar) bar.stop();
    this.printStats();
  }

  /**
   * Process all files in a directory
   */
  private async processDirectory(
    dir: string,
    tick: (filePath: string) => void = () => {},
  ): Promise<void> {
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
          await this.processDirectory(fullPath, tick);
        }
      } else if (entry.isFile()) {
        await this.processFile(fullPath, tick);
      }
    }
  }

  /**
   * Process a single file
   */
  private async processFile(
    filePath: string,
    tick: (filePath: string) => void = () => {},
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
        return;
      }

      // Batch translate
      if (this.config.verbose) {
        console.log(chalk.gray(`  Translating ${textsToTranslate.length} text segment(s)...`));
      }

      const translations = await this.config.translator.translateBatch(textsToTranslate);

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
            const translatedParts = translations.slice(transIdx, transIdx + parts.length);
            transIdx += parts.length;

            const updated = applyTranslations(parsed, translatedParts);
            const serialized = serializeJSDoc(updated);
            translationMap.set(comment.id, serialized);
            this.stats.commentsTranslated++;
          }
        } else {
          // For block/line comments
          const translated = translations[transIdx++] || cleaned;
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
      tick(filePath);
    } catch (error: any) {
      this.stats.errors++;
      console.error(chalk.red(`  ✗ Error processing ${filePath}: ${error.message}`));
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
    if (this.stats.errors > 0) {
      console.log(`  Errors:             ${chalk.red(this.stats.errors)}`);
    }
    console.log(chalk.gray('─'.repeat(40)));
  }
}

/**
 * Lightweight single-line progress bar rendered with chalk (no extra deps).
 * Usage:
 *   const bar = createProgressBar(100);
 *   bar.update(1, { file: 'a.ts' });  // 1-based
 *   ...
 *   bar.stop();
 */
function createProgressBar(total: number) {
  const columns = (process.stdout.columns && process.stdout.columns > 20)
    ? Math.min(process.stdout.columns - 30, 40)
    : 30;
  let lastRatio = -1;

  const render = (current: number, ctx: { file?: string } = {}) => {
    const ratio = total > 0 ? Math.min(current / total, 1) : 0;
    const filled = Math.round(ratio * columns);
    const bar = chalk.cyan('█'.repeat(filled)) + chalk.gray('░'.repeat(columns - filled));
    const pct = Math.round(ratio * 100);
    const file = ctx.file ? chalk.gray(` ${ctx.file}`) : '';
    // carriage return so it stays on one line, then clear-to-end
    process.stdout.write(`\r${chalk.bold('Files')} [${bar}] ${chalk.cyan(`${pct}%`)}  (${current}/${total})${file}${' '.repeat(20)}`);
  };

  render(0);

  return {
    update(current: number, ctx?: { file?: string }) {
      if (current < 0) current = 0;
      const ratio = current / total;
      // Throttle: only re-render when the visible bar changes or file changes
      if (ratio - lastRatio >= 1 / columns || current === total) {
        render(current, ctx);
        lastRatio = ratio;
      } else {
        render(current, ctx);
      }
    },
    stop() {
      render(total, {});
      process.stdout.write('\n');
    },
  };
}
