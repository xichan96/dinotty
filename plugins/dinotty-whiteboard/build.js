import { build, context } from 'esbuild';
import { readFileSync } from 'fs';

const isWatch = process.argv.includes('--watch');

const opts = {
  entryPoints: ['src/main.js'],
  bundle: true,
  format: 'esm',
  outfile: 'main.js',
  target: 'es2020',
  minify: false,
  sourcemap: false,
};

if (isWatch) {
  const ctx = await context(opts);
  await ctx.watch();
  console.log('Watching for changes...');
} else {
  await build(opts);
  console.log('Build complete: main.js');
}
