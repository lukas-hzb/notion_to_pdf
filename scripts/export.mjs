#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const args = process.argv.slice(2);
if (!args.length || args.includes('--help') || args.includes('-h')) {
  console.log(await readFile(path.join(root, 'scripts/help.txt'), 'utf8')); process.exit(0);
}
if (args.includes('--version')) {
  console.log(JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version); process.exit(0);
}
if (args.includes('--doctor')) {
  const checks = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  const nodeOk = major > 22 || major === 22 && minor >= 13;
  checks.push({ name: 'node', ok: nodeOk, detail: process.versions.node, ...(!nodeOk ? { remedy: 'Use Node.js 22.13+ or Node.js 24 LTS (see README installation).' } : {}) });
  for (const file of ['dist/main.cjs', 'dist/inspect.cjs', 'dist/print.css']) {
    try { await access(path.join(root, file)); checks.push({ name: file, ok: true }); }
    catch { checks.push({ name: file, ok: false, remedy: 'npm run build' }); }
  }
  try {
    const executable = (await import('electron')).default;
    await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    checks.push({ name: 'print-runtime', ok: true, detail: executable });
  } catch { checks.push({ name: 'print-runtime', ok: false, remedy: 'npm ci && npm run setup' }); }
  const ok = checks.every(check => check.ok);
  console.log(JSON.stringify({ ok, checks, note: 'Checks installation only; run npm run demo to verify actual PDF rendering.' }, null, 2));
  process.exit(ok ? 0 : 1);
}
const inspectOnly = args.includes('--list') || args.includes('--inspect-only');
const entry = path.join(root, inspectOnly ? 'dist/inspect.cjs' : 'dist/main.cjs');
try { await access(entry); }
catch { console.error('Build the exporter first: npm run build'); process.exit(1); }

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
let executable = process.execPath;
if (!inspectOnly) {
  try { executable = (await import('electron')).default; }
  catch { console.error('Install the print runtime first: npm run setup'); process.exit(1); }
}
const child = spawn(executable, inspectOnly ? [entry, ...args] : [root, '--export-cli', ...args], { stdio: 'inherit', env });
child.on('exit', code => process.exit(code ?? 1));
child.on('error', error => { console.error(error.message); process.exit(1); });
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
