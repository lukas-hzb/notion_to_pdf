import path from 'node:path';
import { runCli } from './run';

// This entry point deliberately has no Electron import, even indirectly.
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
runCli(path.resolve(__dirname, '..'), process.argv.slice(2), controller.signal).catch(error => {
  console.error(controller.signal.aborted ? 'Prüfung abgebrochen.' : error instanceof Error ? error.message : 'Prüfung fehlgeschlagen.');
  process.exitCode = controller.signal.aborted ? 130 : 1;
});
