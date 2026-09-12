#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import {
  ITranslator,
  DeepLFormality,
  createTranslator,
  parseBackend,
} from './translator';
import { TranslationEngine } from './engine';
import { MockTranslator } from './mock-translator';
import { PolishStyle } from './polisher';
import { TermProtectorOptions } from './term-protector';

const program = new Command();

program
  .name('comment-translator')
  .description(
    'Translate JSDoc and code comments using DeepL / Google Translate API\n' +
      'Supports: .js, .ts, .jsx, .tsx, .mjs, .cjs'
  )
  .version('2.5.0');

const BACKEND_CHOICES = ['deepl', 'google', 'libretranslate'] as const;

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
  .option('--libre-url <url>', 'LibreTranslate only: base URL (e.g. "http://localhost:5000"). Defaults to $LIBRETRANSLATE_URL or http://localhost:5000')
  .option('--libre-key <key>', 'LibreTranslate only: API key for protected instances ($LIBRETRANSLATE_API_KEY)')
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
  .option('--no-protect-placeholders', 'Do not protect printf-style placeholders (%s, %d, {0}, ${name})')
  .option('--no-protection', 'Disable terminology protection entirely (identifiers/URLs/code spans are translated literally)')
  .option('--cache-dir <path>', 'Translation cache directory (default: .comment-translator-cache)', '.comment-translator-cache')
  .option('--no-cache', 'Disable translation cache (each run re-translates everything)')
  .option('--clear-cache', 'Clear the cache before running (starts fresh)')
  // ---- Semantic polishing -------------------------------------------------
  .option('--polish', 'Enable semantic polishing (LLM prompt + post-translation rule cleanup)')
  .option('--polish-style <style>', 'Polish style: formal | tech-writing | concise | friendly (default: tech-writing)')
  .option('--rules-only', 'Skip the LLM call; run only the local rule cleanup (zero extra API cost)')
  .option('--no-polish-cache', 'Disable the polish-result cache (re-polish every run)')
  .option('--llm-provider <name>', 'LLM provider for polishing: openai | ollama (default: openai)')
  .option('--llm-base-url <url>', 'LLM base URL (OpenAI: https://api.openai.com/v1, Ollama: http://localhost:11434)')
  .option('--llm-api-key <key>', 'LLM API key ($OPENAI_API_KEY / $OLLAMA_API_KEY)')
  .option('--llm-model <name>', 'LLM model name (OpenAI: gpt-4o-mini, Ollama: qwen2.5)')
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
      // LibreTranslate typically needs no key for self-hosted/local instances,
      // so it is intentionally excluded from the "must have a key" check below.
      const apiKeyEnv =
        backend === 'google' ? 'GOOGLE_API_KEY'
        : backend === 'libretranslate' ? 'LIBRETRANSLATE_API_KEY'
        : 'DEEPL_API_KEY';
      const apiKey = options.apiKey || process.env[apiKeyEnv] || '';

      // Build translator
      let translator: ITranslator;
      // Mock when explicitly requested, OR when no credentials are available.
      // LibreTranslate at "localhost:5000" counts as configured even without a key,
      // so we don't force-mock it (unlike DeepL/Google which always need auth).
      const hasLibreConfig =
        backend === 'libretranslate' &&
        (apiKey || process.env.LIBRETRANSLATE_URL || options.libreUrl);
      const useMock =
        options.mock ||
        (!apiKey &&
          backend !== 'google' &&
          !process.env.GOOGLE_APPLICATION_CREDENTIALS &&
          !hasLibreConfig);

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
          // LibreTranslate-specific options
          libreTranslateUrl: options.libreUrl,
          libreTranslateApiKey: apiKey || undefined,
          // Cache (resume-after-interruption). When --no-cache is passed,
          // engine.config.cache is { disabled: true } and we skip it here too.
          cache: options.cache === false
            ? { disabled: true }
            : { cacheDir: options.cacheDir || '.comment-translator-cache', clear: !!options.clearCache },
          // Surface cache hit/miss logs only in verbose mode (--verbose).
          verbose: options.verbose || false,
        });
      }

      // Parse extensions
      const extensions = options.extensions
        .split(',')
        .map((e: string) => e.trim())
        .map((e: string) => (e.startsWith('.') ? e : `.${e}`));

      // Build terminology-protection config. Protection is ON BY DEFAULT:
      // TermProtector already defaults every category to true, so we always
      // hand the engine an options object (an empty object is enough to make
      // the engine create the protector). Passing `undefined` would silently
      // disable protection entirely — which is how the `--no-protect-*` flags
      // used to become no-ops. `--no-protection` is the explicit kill switch.
      const protectionEnabled = options.protection !== false;
      const termsOpts: TermProtectorOptions = {};
      if (options.glossaryFile) termsOpts.glossaryFile = options.glossaryFile;
      if (options.term && options.term.length) termsOpts.terms = options.term;
      if (options.protectIdentifiers === false) termsOpts.protectIdentifiers = false;
      if (options.protectUrls === false) termsOpts.protectUrls = false;
      if (options.protectCodeSpans === false) termsOpts.protectCodeSpans = false;
      if (options.protectPlaceholders === false) termsOpts.protectPlaceholders = false;

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
        terms: protectionEnabled ? termsOpts : undefined,
        cache: options.cache === false
          ? { disabled: true }
          : { cacheDir: options.cacheDir || '.comment-translator-cache' },
        backend,
        // Semantic polishing (optional, off by default). When --polish is set,
        // runs after translation + term restoration: LLM rewrite + rules.
        polish: options.polish
          ? {
              enabled: true,
              style: (options.polishStyle as PolishStyle | undefined) ?? 'tech-writing',
              llm: !options.rulesOnly,
              rules: true,
              fallbackOnError: true,
              provider: options.llmProvider,
              baseUrl: options.llmBaseUrl,
              apiKey: options.llmApiKey,
              model: options.llmModel,
              targetLang,
              cacheDir: options.cacheDir || '.comment-translator-cache',
              noCache: options.polishCache === false,
            }
          : undefined,
      });

      // --clear-cache: wipe cache directory before running
      if (options.clearCache) {
        const cacheDir = options.cacheDir || '.comment-translator-cache';
        if (fs.existsSync(cacheDir)) {
          fs.rmSync(cacheDir, { recursive: true, force: true });
        }
        console.log(chalk.yellow(`   Cleared cache: ${cacheDir}\n`));
      }

      console.log(chalk.bold(`🚀 Comment Translator (${backend === 'google' ? 'Google' : backend === 'libretranslate' ? 'LibreTranslate' : 'DeepL'})`));
      console.log(chalk.gray(`   Input:     ${input}`));
      console.log(chalk.gray(`   Backend:   ${useMock ? 'Mock' : backend}`));
      if (options.glossaryFile || (options.term && options.term.length)) {
        console.log(chalk.gray(`   Glossary:  ${options.glossaryFile || '(inline terms)'}`));
      }
      if (!protectionEnabled) {
        console.log(chalk.gray('   Protect:   disabled (--no-protection)'));
      } else {
        const off: string[] = [];
        if (options.protectIdentifiers === false) off.push('identifiers');
        if (options.protectUrls === false) off.push('urls');
        if (options.protectCodeSpans === false) off.push('code-spans');
        if (options.protectPlaceholders === false) off.push('placeholders');
        console.log(
          chalk.gray(
            `   Protect:   ${off.length ? 'on, except ' + off.join(', ') : 'identifiers, urls, code-spans, placeholders'}`
          )
        );
      }
      console.log(chalk.gray(`   Target:    ${targetLang}`));
      if (options.source) console.log(chalk.gray(`   Source:    ${options.source}`));
      if (options.output) console.log(chalk.gray(`   Output:    ${options.output}`));
      if (options.dryRun) console.log(chalk.yellow('   Mode:      DRY RUN (no files written)'));
      if (options.cache === false) console.log(chalk.gray('   Cache:     disabled (--no-cache)'));
      else console.log(chalk.gray(`   Cache:     ${options.cacheDir || '.comment-translator-cache'}`));
      if (options.polish) {
        console.log(chalk.magenta(`   Polish:    ${options.rulesOnly ? 'rules-only' : 'LLM + rules'} (style: ${options.polishStyle || 'tech-writing'})`));
        console.log(chalk.gray(`              llm: ${options.llmProvider || 'openai'} / ${options.llmModel || '(default)'}`));
      }
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
  console.log('  # LibreTranslate — local (no key needed) + translation cache');
  console.log('  $ docker run -d -p 5000:5000 libretranslate/libretranslate');
  console.log('  $ comment-translator ./src --backend libretranslate --target zh --cache-dir .cache');
  console.log('  # LibreTranslate — public/protected instance');
  console.log('  $ export LIBRETRANSLATE_API_KEY="..."');
  console.log('  $ comment-translator ./src --backend libretranslate --libre-url https://libretranslate.com --target en');
  console.log('');
  console.log('Environment variables:');
  console.log('  DEEPL_API_KEY              DeepL API key (:fx = Free, else Pro)');
  console.log('  GOOGLE_API_KEY             Google Cloud API key');
  console.log('  GOOGLE_APPLICATION_CREDENTIALS  Path to a Google service-account key.json');
  console.log('  DEEPL_FREE                 Set "true" to force DeepL Free endpoint');
  console.log('');
  console.log('Translation cache (resume after interruption):');
  console.log('  --cache-dir <path>         Cache directory (default: .comment-translator-cache)');
  console.log('  --no-cache                 Disable cache (re-translate everything)');
  console.log('  --clear-cache              Clear cache before running (start fresh)');
  console.log('');
  console.log('  # Resumable run: translate once, interrupt, re-run → cache hits');
  console.log('  $ comment-translator ./src --backend libretranslate --target zh --cache-dir .cache');
  console.log('  $ comment-translator ./src --backend libretranslate --target zh --cache-dir .cache');
  console.log('  # Force re-translation (ignore existing cache)');
  console.log('  $ comment-translator ./src --no-cache --target zh');
  console.log('  # Start fresh (clear cache + translate everything)');
  console.log('  $ comment-translator ./src --clear-cache --target zh');
  console.log('');
  console.log('  # Semantic polishing — OpenAI-compatible (needs OPENAI_API_KEY)');
  console.log('  $ comment-translator ./src --backend deepl --target zh --polish');
  console.log('  $ comment-translator ./src --target zh --polish --polish-style concise');
  console.log('  # Use DeepSeek / 兼容接口');
  console.log('  $ comment-translator ./src --target zh --polish \\');
  console.log('      --llm-provider openai --llm-base-url https://api.deepseek.com/v1 --llm-model deepseek-chat');
  console.log('  # Local Ollama (fully offline, e.g. qwen2.5)');
  console.log('  $ ollama pull qwen2.5 && ollama serve');
  console.log('  $ comment-translator ./src --target zh --polish \\');
  console.log('      --llm-provider ollama --llm-base-url http://localhost:11434 --llm-model qwen2.5');
  console.log('  # Rules-only (no LLM call, zero extra cost)');
  console.log('  $ comment-translator ./src --target zh --polish --rules-only');
  console.log('');
  console.log('Polish options:');
  console.log('  --polish                  Enable semantic polishing');
  console.log('  --polish-style <s>        formal | tech-writing | concise | friendly');
  console.log('  --rules-only              Skip LLM, run local cleanup only');
  console.log('  --llm-provider <p>        openai | ollama');
  console.log('  --llm-base-url <url>      LLM endpoint base URL');
  console.log('  --llm-api-key <key>       LLM API key');
  console.log('  --llm-model <name>         Model (gpt-4o-mini / deepseek-chat / qwen2.5 ...)');
  console.log('  --no-polish-cache          Re-polish every run');
  console.log('');
  console.log('Terminology protection (ON by default):');
  console.log('  --glossary-file <path>     JSON file with extra terms to protect');
  console.log('  --term <t...>              Extra term(s) to protect (repeatable)');
  console.log('  --no-protect-identifiers   Do not protect camelCase/PascalCase/snake_case identifiers');
  console.log('  --no-protect-urls          Do not protect URLs');
  console.log('  --no-protect-code-spans    Do not protect `backtick` code spans');
  console.log('  --no-protect-placeholders  Do not protect %s / {0} / ${name}');
  console.log('  --no-protection            Disable protection entirely');
  console.log('  $ comment-translator ./src --mock --target zh            # protects by default');
  console.log('  $ comment-translator ./src --mock --target zh --no-protect-urls');
  console.log('');
  console.log('Glossary file (JSON):');
  console.log('  { "terms": ["DisplaySlotId", "scoreboard"], "identifiers": true }');
  console.log('  See src/term-protector.ts for the full schema.');
});

program.parse(process.argv);
