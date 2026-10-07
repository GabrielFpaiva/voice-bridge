import { context, build } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';

const entries = {
  background: 'src/background/index.ts',
  page: 'src/page/inject.ts',
  relay: 'src/content/relay.ts',
  offscreen: 'src/offscreen/index.ts',
  popup: 'src/popup/index.ts',
};

const options = {
  entryPoints: entries,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  outdir: 'dist',
  logLevel: 'info',
};

rmSync('dist', { recursive: true, force: true });
mkdirSync('dist');
cpSync('public', 'dist', { recursive: true });

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
} else {
  await build(options);
}
