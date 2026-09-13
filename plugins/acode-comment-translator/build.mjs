/**
 * Bundle the plugin into a single `dist/main.js`.
 *
 * Acode loads plugins as one CommonJS-ish script inside a WebView, so the
 * output must be a self-contained IIFE — no `require`, no node built-ins.
 *
 * The plugin deliberately REUSES the CLI's core (`../../src`) instead of
 * copying it, so the comment lexer / JSDoc handling / term protection can never
 * drift between the CLI and the plugin. `@core/*` is the alias that makes those
 * imports readable.
 *
 * Node-only modules are marked `external`: they are only ever reached through
 * guarded `require()` calls (e.g. `typescript` for JSX parsing, `fs` for
 * glossary files) that already fall back gracefully. In the WebView they throw
 * and the caller degrades to the dependency-free path.
 */
import { build } from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes('--production');

const result = await build({
  entryPoints: [path.join(here, 'src/main.ts')],
  outfile: path.join(here, 'dist/main.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: !production,
  minify: production,
  legalComments: 'none',
  charset: 'utf8',
  alias: {
    '@core': path.resolve(here, '..', '..', 'src'),
  },
  external: [
    // Optional / Node-only, always reached through a guarded require().
    'typescript',
    'deepl-node',
    'fs',
    'path',
    'crypto',
    'os',
  ],
  logLevel: 'info',
});

if (result.errors.length) {
  console.error('build failed');
  process.exit(1);
}
