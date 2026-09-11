#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import {
  DeepLTranslator,
  ITranslator,
  DeepLFormality,
  createTranslator,
  parseBackend,
  BackendName,
} from './translator';
import { TranslationEngine } from './engine';
import { MockTranslator } from './mock-translator';

const program = new Command();

program
  .name('comment-translator')
  .description(
    'Translate JSDoc and code comments using DeepL / Google Translate API\n' +
      'Supports: .js, .ts, .jsx, .tsx, .mjs, .cjs'
  )
  .version('2.3.0');

const BACKEND_CHOICES = ['deepl', 'google'] as const;

program
  .argument('<input>', 'Input file or directory to process')
  .option('-o, --output <path>', 'Output directory or file path')
  .option('-t, --target <lang>', 'Target language code (e.g. "ZH", "zh-CN", "EN", "JA")', 'ZH')
  .option('-s, --source <lang>', 'Source language code (optional, auto-detect if not set)')
  .option(
    '-b, --backend <name>',
    `Translation backend: ${BACKEND_CHOICES.join(' | ')} (default: deepl)`,
    'deepl'
  )
  .option('-k, --api-key <key>', 'API key (DeepL: DEEPL_API_KEY, Google: GOOGLE_API_KEY)')
  .option('--free', 'DeepL: force Free endpoint (api-free.deepl.com)')
  .option('--pro', 'DeepL: force Pro endpoint (api.deepl.com)')
  .option('--formality <level>', 'DeepL only: default | prefer_less | prefer_more | less | more')
  .option('--glossary <id>', 'DeepL only: glossary ID for consistent terminology')
  .option('--google-model <model>', 'Google only: base | nmt (default: nmt)')
  .option('--google-credentials <path>', 'Google only: service-account key.json path')
  .option('--mock', 'Use MockTranslator instead of real API (for testing)')
  .option('--extensions <exts>', 'Comma-separated file extensions', '.js,.ts,.jsx,.tsx,.mjs,.cjs,.d.ts')
  .option('--no-recursive', 'Disable recursive directory traversal')
  .option('--dry-run', 'Preview without writing files')
  .option('-v, --verbose', 'Verbose output')
  .option('--progress', 'Show a progress bar while translating (default: true unless -v is set)')
  .option('--no-progress', 'Hide the progress bar')
  .option('--glossary-file <path>', 'Path to a glossary JSON (terms to protect from translation)')
  .option('--term <term...>', 'Extra term(s) to protect (repeatable, e.g. --term DisplaySlotId --term scoreboard)')
  .option('--no-protect-identifiers', 'Disable auto-protection of code identifiers (camelCase/PascalCase/snake_case)')
  .option('--no-protect-urls', 'Do not protect URLs in comments')
  .option('--no-protect-code-spans', 'Do not protect `backtick` code spans')
  .action(async (input: string, options: any) => {
    try {
      // Validate input
      if (!fs.existsSync(input)) {
        console.error(chalk.red(`✗ Input path does not exist: ${input}`));
        process.exit(1);
      }

      const targetLang = options.target;
      const backend = parseBackend(options.backend as string | undefined, 'deepl');

      // Resolve which API key env var belongs to the selected backend.
      const apiKeyEnv = backend === 'google' ? 'GOOGLE_API_KEY' : 'DEEPL_API_KEY';
      const apiKey = options.apiKey || process.env[apiKeyEnv] || '';

      // Build translator
      let translator: ITranslator;
      const useMock =
        options.mock || (!apiKey && backend !== 'google' && !process.env.GOOGLE_APPLICATION_CREDENTIALS);

      if (useMock) {
        if (!options.mock) {
          console.warn(
            chalk.yellow(
              `⚠ No ${apiKeyEnv} provided. Falling back to MockTranslator.`
            )
          );
          console.warn(chalk.gray('  Set --api-key / ' + apiKeyEnv + ' for real translation.\n'));
        }
        translator = new MockTranslator({ targetLanguage: targetLang });
      } else {
        translator = createTranslator({
          backend,
          apiKey,
          targetLang,
          sourceLang: options.source,
          free: options.free ? true : options.pro ? false : undefined,
          formality: options.formality as DeepLFormality | undefined,
          glossaryId: options.glossary,
          credentialsPath: options.googleCredentials,
          googleModel: options.googleModel,
        });
      }

      // Parse extensions
      const extensions = options.extensions
        .split(',')
        .map((e: string) => e.trim())
        .map((e: string) => (e.startsWith('.') ? e : `.${e}`));

      // Build terminology-protection config (only created when actually used,
      // so projects without a glossary pay zero overhead).
      const termsOpts: Record<string, any> = {};
      let hasTerms = false;
      if (options.glossaryFile) { termsOpts.glossaryFile = options.glossaryFile; hasTerms = true; }
      if (options.term && options.term.length) { termsOpts.terms = options.term; hasTerms = true; }
      if (options.protectIdentifiers === false) termsOpts.protectIdentifiers = false;
      if (options.protectUrls === false) termsOpts.protectUrls = false;
      if (options.protectCodeSpans === false) termsOpts.protectCodeSpans = false;

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
        terms: hasTerms ? termsOpts : undefined,
      });

      console.log(chalk.bold(`🚀 Comment Translator (${backend === 'google' ? 'Google' : 'DeepL'})`));
      console.log(chalk.gray(`   Input:     ${input}`));
      console.log(chalk.gray(`   Backend:   ${useMock ? 'Mock' : backend}`));
      if (hasTerms) {
        console.log(chalk.gray(`   Glossary:  ${options.glossaryFile || '(inline terms)'}`));
      }
      console.log(chalk.gray(`   Target:    ${targetLang}`));
      if (options.source) console.log(chalk.gray(`   Source:    ${options.source}`));
      if (options.output) console.log(chalk.gray(`   Output:    ${options.output}`));
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
  console.log('  # Protect project terms / identifiers from being translated');
  console.log('  $ comment-translator ./src --mock --glossary-file ./glossary.json');
  console.log('  $ comment-translator ./src --mock --term DisplaySlotId --term WorldClock');
  console.log('');
  console.log('  # Dry run to preview');
  console.log('  $ comment-translator ./src --api-key KEY --target ZH --dry-run -v');
  console.log('');
  console.log('  # Mock mode (no API key required)');
  console.log('  $ comment-translator ./src --mock --target zh');
  console.log('');
  console.log('  # Use Google Translate instead of DeepL');
  console.log('  $ export GOOGLE_API_KEY="AIza..."');
  console.log('  $ comment-translator ./src --backend google --target zh-CN -o ./out');
  console.log('  # Google with a service-account key (recommended for production)');
  console.log('  $ export GOOGLE_APPLICATION_CREDENTIALS="./key.json"');
  console.log('  $ comment-translator ./src --backend google --target ja');
  console.log('');
  console.log('Environment variables:');
  console.log('  DEEPL_API_KEY              DeepL API key (:fx = Free, else Pro)');
  console.log('  GOOGLE_API_KEY             Google Cloud API key');
  console.log('  GOOGLE_APPLICATION_CREDENTIALS  Path to a Google service-account key.json');
  console.log('  DEEPL_FREE                 Set "true" to force DeepL Free endpoint');
  console.log('');
  console.log('Glossary file (JSON):');
  console.log('  { "terms": ["DisplaySlotId", "scoreboard"], "identifiers": true }');
  console.log('  See src/term-protector.ts for the full schema.');
});

program.parse(process.argv);
