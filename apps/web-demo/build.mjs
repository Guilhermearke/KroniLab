/**
 * Build da demo. Sem framework: esbuild empacota o core (TypeScript puro) e o
 * navegador recebe um arquivo so.
 *
 * O ponto da demo e esse: a mesma logica testada em packages/core roda aqui,
 * sem reimplementacao. Se o salto quantizado funciona nesta pagina, funciona no
 * app.
 */
import { build, context } from 'esbuild';
import { cp, mkdir } from 'node:fs/promises';

const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: 'dist/app.js',
  minify: !process.argv.includes('--watch'),
  sourcemap: true,
  alias: { '@kronilab/core': '../../packages/core/src/index.ts' },
};

await mkdir('dist', { recursive: true });
await cp('index.html', 'dist/index.html');
await cp('styles.css', 'dist/styles.css');
await cp('samples', 'dist/samples', { recursive: true });

if (process.argv.includes('--watch')) {
  const ctx = await context(options);
  await ctx.watch();
  console.log('watching...');
} else {
  await build(options);
  console.log('build ok -> dist/');
}
