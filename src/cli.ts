#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import { DeepLTranslator, ITranslator, DeepLFormality } from './translator';
import { TranslationEngine } from './engine';
import { MockTranslator } from './mock-translator';

const program = new Command();

program
  .name('comment-translator')
  .description('Translate JSDoc and code comments using DeepL (Free/Pro) API\nSupports: .js, .ts, .jsx, .tsx, .mjs, .cjs')
  .version('2.1.1');

program
  .argument('<input>', 'Input file or directory to process')
  .option('-o, --output <path>', 'Output directory or file path')
  .option('-t, --target <lang>', 'Target language code (e.g. "ZH", "EN", "JA", "KO", "zh")', 'ZH')
  .option('-s, --source <lang>', 'Source language code (optional, auto-detect if not set)')
  .option('-k, --api-key <key>', 'DeepL API key (or set DEEPL_API_KEY env var)')
  .option('--free', 'Force use of DeepL Free endpoint (api-free.deepl.com)')
  .option('--pro', 'Force use of DeepL Pro endpoint (api.deepl.com)')
  .option('--formality <level>', 'Formality: default | prefer_less | prefer_more | less | more')
  .option('--glossary <id>', 'DeepL glossary ID for consistent terminology')
  .option('--mock', 'Use MockTranslator instead of real API (for testing)')
  .option('--extensions <exts>', 'Comma-separated file extensions', '.js,.ts,.jsx,.tsx,.mjs,.cjs,.d.ts')
  .option('--no-recursive', 'Disable recursive directory traversal')
  .option('--dry-run', 'Preview without writing files')
  .option('-v, --verbose', 'Verbose output')
  .option('--progress', 'Show a progress bar while translating (default: true unless -v is set)')
  .option('--no-progress', 'Hide the progress bar')
  .action(async (input: string, options: any) => {
    try {
      // Validate input
      if (!fs.existsSync(input)) {
        console.error(chalk.red(`✗ Input path does not exist: ${input}`));
        process.exit(1);
      }

      const targetLang = options.target;

      // Build translator
      let translator: ITranslator;
      const useMock = options.mock || (!options.apiKey && !process.env.DEEPL_API_KEY);

      if (useMock) {
        if (!options.mock) {
          console.warn(chalk.yellow('⚠ No DEEPL_API_KEY provided. Falling back to MockTranslator.'));
          console.warn(chalk.gray('  Set --api-key or DEEPL_API_KEY for real translation.\n'));
        }
        translator = new MockTranslator({ targetLanguage: targetLang });
      } else {
        const freeFlag = options.free ? true : (options.pro ? false : undefined);
        const deeplOpts: any = {
          apiKey: options.apiKey || process.env.DEEPL_API_KEY,
          targetLang,
          sourceLang: options.source,
          free: freeFlag,
        };
        if (options.formality) deeplOpts.formality = options.formality as DeepLFormality;
        if (options.glossary) deeplOpts.glossaryId = options.glossary;
        translator = new DeepLTranslator(deeplOpts);
      }

      // Parse extensions
      const extensions = options.extensions
        .split(',')
        .map((e: string) => e.trim())
        .map((e: string) => (e.startsWith('.') ? e : `.${e}`));

      // Create and run engine
      const engine = new TranslationEngine({
        input,
        output: options.output,
        translator,
        extensions,
        recursive: options.recursive !== false,
        dryRun: options.dryRun || false,
        verbose: options.verbose || false,
        // Default to showing the bar; --verbose implies structured logs instead.
        progress: options.progress !== false && !options.verbose,
      });

      console.log(chalk.bold('🚀 Comment Translator (DeepL)'));
      console.log(chalk.gray(`   Input:     ${input}`));
      console.log(chalk.gray(`   Target:    ${targetLang}`));
      if (options.source) console.log(chalk.gray(`   Source:    ${options.source}`));
      if (options.output) console.log(chalk.gray(`   Output:    ${options.output}`));
      console.log(chalk.gray(`   Backend:   ${useMock ? 'Mock' : 'DeepL API'}`));
      if (options.dryRun) console.log(chalk.yellow('   Mode:      DRY RUN (no files written)'));
      console.log('');

      await engine.run();
    } catch (error: any) {
      console.error(chalk.red(`\n✗ Fatal error: ${error.message}`));
      if (options.verbose) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  });

// Add help examples
program.on('--help', () => {
  console.log('');
  console.log('Examples:');
  console.log('');
  console.log('  # Translate a single file to Chinese (DeepL Free)');
  console.log('  $ comment-translator ./src/index.ts --api-key YOUR_KEY:fx --target ZH');
  console.log('');
  console.log('  # Translate an entire directory to Japanese (env var)');
  console.log('  $ export DEEPL_API_KEY="xxxx:fx"');
  console.log('  $ comment-translator ./src --target JA -o ./output');
  console.log('');
  console.log('  # Use a glossary for consistent terminology');
  console.log('  $ comment-translator ./lib --api-key KEY --glossary abc123 --target ZH');
  console.log('');
  console.log('  # Dry run to preview');
  console.log('  $ comment-translator ./src --api-key KEY --target ZH --dry-run -v');
  console.log('');
  console.log('  # Mock mode (no API key required)');
  console.log('  $ comment-translator ./src --mock --target zh');
  console.log('');
  console.log('Environment variables:');
  console.log('  DEEPL_API_KEY   DeepL API authentication key (:fx = Free, else Pro)');
  console.log('  DEEPL_FREE       Set "true" to force Free endpoint');
});

program.parse(process.argv);