import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hasBodyContent, type Snapshot, type Issue } from '../domain/model';
import type { ExportOptions } from '../domain/options';
import type { ExportResult, Progress, SkippedPage } from '../domain/results';
import { renderPdf } from '../rendering/pdf';

export function outputFilename(title: string, id: string): string {
  let safe = title.normalize('NFC').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
  // A character limit alone can exceed the filesystem byte limit for CJK/emoji titles.
  while (Buffer.byteLength(safe, 'utf8') > 160) safe = Array.from(safe).slice(0, -1).join('');
  safe = safe.replace(/[. ]+$/g, '');
  if (!safe || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(safe)) safe = 'Document';
  return `${safe}-${createHash('sha256').update(id).digest('hex').slice(0, 12)}.pdf`;
}

export async function exportPages(root: string, snapshot: Snapshot, ids: string[], options: ExportOptions, destination: string, signal?: AbortSignal, progress?: (value: Progress) => void): Promise<ExportResult> {
  const chosen = ids.map(id => snapshot.pages.find(page => page.id === id));
  if (!chosen.length || chosen.some(page => !page) || new Set(ids).size !== ids.length) throw new Error('Ungültige Seitenauswahl.');
  const skipped: SkippedPage[] = [];
  const pages = chosen.filter(page => {
    if (options.databasePages !== 'content' || !page!.properties?.length || hasBodyContent(page!)) return true;
    skipped.push({ id: page!.id, title: page!.title, sourcePath: page!.sourcePath, reason: 'properties-only' });
    return false;
  });
  if (!pages.length) throw new Error('Die Auswahl enthält nur Datenbankeinträge ohne eigenen Seiteninhalt. Mit --database-pages all werden ihre Eigenschaften exportiert.');
  await mkdir(destination, { recursive: true });
  const directory = await mkdtemp(path.join(destination, 'Notion-PDF-'));
  const files: string[] = [];
  const issues: Issue[] = [];
  const usedNames = new Set<string>();
  try {
    for (const [index, page] of pages.entries()) {
      signal?.throwIfAborted();
      progress?.({ phase: 'PDFs werden erstellt', completed: index, total: pages.length });
      const result = await renderPdf(root, snapshot, page!, options, signal);
      const proposed = outputFilename(page!.title, page!.id);
      let name = proposed;
      let suffix = 1;
      while (usedNames.has(name.toLowerCase())) name = `${proposed.slice(0, -4)}-${++suffix}.pdf`;
      usedNames.add(name.toLowerCase());
      const temp = path.join(directory, `${name}.partial`);
      await writeFile(temp, result.data, { flag: 'wx', mode: 0o600 });
      await rename(temp, path.join(directory, name));
      files.push(name);
      issues.push(...result.issues);
    }
    await writeFile(path.join(directory, 'export-report.json'), JSON.stringify({ version: 1, status: issues.some(issue => issue.severity !== 'info') ? 'completed-with-warnings' : 'completed', source: { id: snapshot.id, name: snapshot.name, importedAt: snapshot.importedAt }, exportedAt: new Date().toISOString(), options, files, skipped, issues, engine: process.versions.electron, chromium: process.versions.chrome }, null, 2), { flag: 'wx', mode: 0o600 });
    progress?.({ phase: 'Export abgeschlossen', completed: pages.length, total: pages.length });
    return { directory, files, skipped, issues };
  } catch (error) {
    // Remove only our newly created output directory, never source or user files.
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
