import { app, protocol } from 'electron';
import { runCli } from './run';
import { exportPages } from '../jobs/export';

// Electron is only the isolated Chromium print runtime. No application UI,
// account, local HTTP server or visible browser window is created.
protocol.registerSchemesAsPrivileged([{ scheme: 'notion-pdf', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.setName('Notion to PDF');
app.enableSandbox();
const controller = new AbortController();
process.on('SIGINT', () => controller.abort());
process.on('SIGTERM', () => controller.abort());
const marker = process.argv.indexOf('--export-cli');
// The print window is destroyed after each page. Keep the runtime alive until
// the whole batch and its report have been written.
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  app.dock?.hide();
  try {
    await runCli(app.getAppPath(), marker >= 0 ? process.argv.slice(marker + 1) : process.argv.slice(2), controller.signal, exportPages);
    await new Promise<void>(resolve => process.stdout.write('', () => resolve()));
    app.exit(0);
  } catch (error) {
    console.error(controller.signal.aborted ? 'Export abgebrochen.' : error instanceof Error ? error.message : 'Export fehlgeschlagen.');
    app.exit(controller.signal.aborted ? 130 : 1);
  }
}).catch(error => { console.error(error); app.exit(1); });
