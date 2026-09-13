/**
 * Bundle the test suite to `dist/test.cjs`.
 *
 * The tests import plugin code that uses the `@core/*` alias, which plain
 * `ts-node` cannot resolve. Bundling with esbuild applies the SAME alias as the
 * production build — so a broken alias fails the tests too, instead of only
 * failing at runtime inside Acode.
 */
import { build } from 'esbuild';
import * as path from 'path';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [path.join(here, 'test/plugin.test.ts')],
  outfile: path.join(here, 'dist/test.cjs'),
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: ['node18'],
  sourcemap: false,
  logLevel: 'warning',
  alias: {
    '@core': path.resolve(here, '..', '..', 'src'),
  },
  // `typescript` is an optional runtime dep reached through a guarded require.
  external: ['typescript'],
});
