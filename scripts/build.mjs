import { build } from 'esbuild';
import { mkdir, copyFile, rm } from 'node:fs/promises';

await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/cli/main.ts'], outfile: 'dist/main.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', sourcemap: true });
await build({ entryPoints: ['src/cli/inspect.ts'], outfile: 'dist/inspect.cjs', bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external', sourcemap: true });
await copyFile('src/layout/print.css', 'dist/print.css');
console.log('Built local PDF exporter. Try: npm run demo');
