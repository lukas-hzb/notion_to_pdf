import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { exportPages, outputFilename } from '../src/jobs/export';
import { renderPdf } from '../src/rendering/pdf';
import { defaultOptions } from '../src/domain/options';
import type { Snapshot } from '../src/domain/model';
import { parseNotionHtml } from '../src/importers/html';

vi.mock('../src/rendering/pdf', () => ({ renderPdf: vi.fn() }));
const temporary: string[] = [];
const snapshot: Snapshot = { version: 1, id: 'snapshot', name: 'Sample', importedAt: '', assets: {}, issues: [], pages: ['aaa-same-end', 'bbb-same-end'].map(id => ({ id, title: 'Same title', sourcePath: `${id}.html`, blocks: [], issues: [] })) };
beforeEach(() => { vi.mocked(renderPdf).mockReset().mockResolvedValue({ data: new Uint8Array([1, 2, 3]), pageCount: 1, issues: [], durationMs: 1 }); });
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function destination() { const dir = await mkdtemp(path.join(os.tmpdir(), 'notion-export-test-')); temporary.push(dir); return dir; }

describe('safe export jobs', () => {
  it('produces portable, byte-bounded names for Unicode, reserved and hostile titles', () => {
    for (const title of ['CON', 'AUX.txt', '../outside/<script>', '👩‍💻漢字'.repeat(150)]) {
      const name = outputFilename(title, 'id');
      expect(Buffer.byteLength(name)).toBeLessThan(200);
      expect(name).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);
      expect(name).not.toMatch(/^(CON|AUX)(\.|-)/i);
    }
  });
  it('preserves pages whose titles and ID suffixes match and creates a report', async () => {
    const dir = await destination();
    const result = await exportPages('', snapshot, snapshot.pages.map(page => page.id), defaultOptions, dir);
    expect(new Set(result.files).size).toBe(2);
    for (const file of result.files) expect(await readFile(path.join(result.directory, file))).toEqual(Buffer.from([1, 2, 3]));
    const report = JSON.parse(await readFile(path.join(result.directory, 'export-report.json'), 'utf8'));
    expect(report.files).toEqual(result.files);
    expect(report.status).toBe('completed');
  });
  it('rolls back only its own incomplete directory on failure', async () => {
    const dir = await destination();
    await writeFile(path.join(dir, 'existing.pdf'), 'Keep me');
    vi.mocked(renderPdf).mockResolvedValueOnce({ data: new Uint8Array([1]), pageCount: 1, issues: [], durationMs: 1 }).mockRejectedValueOnce(new Error('Rendering failed'));
    await expect(exportPages('', snapshot, snapshot.pages.map(page => page.id), defaultOptions, dir)).rejects.toThrow('Rendering failed');
    expect(await readdir(dir)).toEqual(['existing.pdf']);
    expect(await readFile(path.join(dir, 'existing.pdf'), 'utf8')).toBe('Keep me');
  });
  it('honors cancellation without leaving a partial export', async () => {
    const dir = await destination();
    const controller = new AbortController(); controller.abort();
    await expect(exportPages('', snapshot, [snapshot.pages[0]!.id], defaultOptions, dir, controller.signal)).rejects.toThrow();
    expect(await readdir(dir)).toEqual([]);
    expect(renderPdf).not.toHaveBeenCalled();
  });
  it('rejects unknown and duplicate selections before creating output', async () => {
    const dir = await destination();
    for (const ids of [[], ['unknown'], [snapshot.pages[0]!.id, snapshot.pages[0]!.id]]) await expect(exportPages('', snapshot, ids, defaultOptions, dir)).rejects.toThrow('Seitenauswahl');
    expect(await readdir(dir)).toEqual([]);
  });
  it('can skip property-only records without dropping database pages that have body content', async () => {
    const record = (id: string, body: string) => parseNotionHtml(`<article id="${id}"><header><h1 class="page-title">Record</h1><table class="properties"><tr><th>Status</th><td>Ready</td></tr></table></header><div class="page-body">${body}</div></article>`, `${id}.html`);
    const sample: Snapshot = { ...snapshot, pages: [record('empty', ''), record('content', '<p>Keep these notes</p>')] };
    const dir = await destination();
    const result = await exportPages('', sample, ['empty', 'content'], { ...defaultOptions, databasePages: 'content' }, dir);
    expect(result.files).toHaveLength(1);
    expect(result.skipped).toEqual([{ id: 'empty', title: 'Record', sourcePath: 'empty.html', reason: 'properties-only' }]);
    expect(vi.mocked(renderPdf).mock.calls[0]?.[2].id).toBe('content');
    const report = JSON.parse(await readFile(path.join(result.directory, 'export-report.json'), 'utf8'));
    expect(report.skipped).toEqual(result.skipped);
    const all = await exportPages('', sample, ['empty', 'content'], defaultOptions, dir);
    expect(all.files).toHaveLength(2);
  });
});
