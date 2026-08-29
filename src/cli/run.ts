import { parseArgs } from 'node:util';
import { writeFile, mkdir, mkdtemp, readFile } from 'node:fs/promises';
import path from 'node:path';
import { importNotion } from '../importers';
import { defaultOptions, optionsSchema, presetOptions } from '../domain/options';
import { summarize } from '../domain/model';
import type { exportPages } from '../jobs/export';

export async function runCli(root: string, args: string[], signal?: AbortSignal, print?: typeof exportPages): Promise<void> {
  const { values } = parseArgs({ args, options: {
    input: { type: 'string' }, out: { type: 'string' }, preset: { type: 'string', default: 'original' },
    columns: { type: 'string' }, tables: { type: 'string' }, bookmarks: { type: 'string' }, landscape: { type: 'boolean' }, strict: { type: 'boolean' },
    'database-pages': { type: 'string' },
    paper: { type: 'string' }, margin: { type: 'string' }, 'font-size': { type: 'string' },
    toggles: { type: 'string' }, tasks: { type: 'string' }, 'no-task-status': { type: 'boolean' }, 'keep-task-status': { type: 'boolean' },
    'no-page-numbers': { type: 'boolean' }, 'no-cover': { type: 'boolean' },
    'page-index': { type: 'string', multiple: true }, 'inspect-only': { type: 'boolean' }, list: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) { console.log(await readFile(path.join(root, 'scripts/help.txt'), 'utf8')); return; }
  if (!values.input || (!values.out && !values.list)) throw new Error('Bitte --input und --out angeben. Hilfe: npm run export -- --help');
  if (!['original', 'reading', 'print'].includes(values.preset!)) throw new Error('Unbekanntes Exportprofil.');
  if (values['no-task-status'] && values['keep-task-status']) throw new Error('--no-task-status und --keep-task-status können nicht kombiniert werden.');
  const profile = presetOptions(values.preset as typeof defaultOptions.preset);
  const options = optionsSchema.parse({
    ...profile,
    preserveTaskStatus: values['keep-task-status'] ? true : values['no-task-status'] ? false : (values.tasks ?? profile.tasks) === 'checkboxes',
    ...(values.columns ? { columns: values.columns } : {}), ...(values.landscape ? { landscape: true } : {}),
    ...(values.tables ? { tables: values.tables } : {}),
    ...(values.bookmarks ? { bookmarks: values.bookmarks } : {}),
    ...(values['database-pages'] ? { databasePages: values['database-pages'] } : {}),
    ...(values.strict ? { strict: true } : {}), ...(values.paper ? { paper: values.paper } : {}),
    ...(values.margin !== undefined ? { margin: Number(values.margin) } : {}),
    ...(values['font-size'] !== undefined ? { fontSize: Number(values['font-size']) } : {}),
    ...(values.toggles ? { toggles: values.toggles } : {}), ...(values.tasks ? { tasks: values.tasks } : {}),
    ...(values['no-task-status'] ? { preserveTaskStatus: false } : {}),
    ...(values['no-page-numbers'] ? { pageNumbers: false } : {}), ...(values['no-cover'] ? { includeCover: false } : {}),
  });
  const snapshot = await importNotion(values.input, signal);
  if (values.list) {
    console.log(JSON.stringify(summarize(snapshot).pages.map((page, index) => ({ index, id: page.id, title: page.title, hasBodyContent: page.hasBodyContent, propertyCount: page.propertyCount, issues: page.issues.length })), null, 2));
    return;
  }
  const destination = path.resolve(values.out!);
  await mkdir(destination, { recursive: true });
  if (values['inspect-only']) {
    const directory = await mkdtemp(path.join(destination, 'Notion-Import-'));
    const report = path.join(directory, 'import-report.json');
    await writeFile(report, JSON.stringify(summarize(snapshot), null, 2), { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ report, pages: snapshot.pages.length, assets: Object.keys(snapshot.assets).length, warnings: snapshot.issues.filter(issue => issue.severity !== 'info').length }));
    return;
  }
  let ids = snapshot.pages.map(page => page.id);
  if (values['page-index'] !== undefined) {
    ids = values['page-index'].map(value => {
      const index = Number(value);
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(index) || !snapshot.pages[index]) throw new Error('Ungültiger Seitenindex.');
      return snapshot.pages[index]!.id;
    });
  }
  if (!print) throw new Error('Für den PDF-Export wird die Chromium-Drucklaufzeit benötigt. Bitte scripts/export.mjs verwenden.');
  const result = await print(root, snapshot, ids, options, destination, signal, progress => console.error(`${progress.completed}/${progress.total} ${progress.phase}`));
  console.log(JSON.stringify({ directory: result.directory, files: result.files.length, skipped: result.skipped.length, warnings: result.issues.filter(issue => issue.severity !== 'info').length }));
}
