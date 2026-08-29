import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { crc32 } from 'node:zlib';
import yauzl from 'yauzl';

export const limits = { files: 3000, totalBytes: 256 * 1024 * 1024, fileBytes: 32 * 1024 * 1024, htmlBytes: 8 * 1024 * 1024, depth: 24 };

export function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

export function safeArchivePath(name: string): string {
  if (!name || /[\u0000-\u001f\u007f]/.test(name) || name.includes('\\') || name.startsWith('/') || /^[a-z]:/i.test(name)) throw new Error('Unsicherer Pfad im ZIP-Archiv.');
  const parts = name.replace(/\/$/, '').split('/');
  if (parts.length > limits.depth || parts.some(part => !part || part === '.' || part === '..' || /[<>:"|?*]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part))) {
    throw new Error('Das Archiv enthält einen ungültigen oder nicht portablen Dateipfad.');
  }
  return parts.join('/');
}

async function extractZip(source: string, destination: string, signal?: AbortSignal, budget = { files: 0, bytes: 0 }): Promise<void> {
  const zip = await new Promise<yauzl.ZipFile>((resolve, reject) => {
    yauzl.open(source, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true }, (error, value) => error || !value ? reject(error ?? new Error('Ungültiges ZIP.')) : resolve(value));
  });
  const seen = new Set<string>();
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let active: Promise<void> | undefined;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', abort);
      zip.close();
      const complete = () => { error ? reject(error) : resolve(); };
      // Wait for an aborted write to close before the caller removes the
      // temporary directory, so cancellation cannot recreate partial files.
      if (active) void active.then(complete, complete); else complete();
    };
    const abort = () => finish(new Error('Import abgebrochen.'));
    signal?.addEventListener('abort', abort, { once: true });
    zip.on('error', finish);
    zip.on('end', () => finish());
    zip.on('entry', (entry: yauzl.Entry) => { active = (async () => {
      try {
        signal?.throwIfAborted();
        if (++budget.files > limits.files) throw new Error('Das Archiv enthält zu viele Dateien.');
        const relative = safeArchivePath(entry.fileName);
        const key = relative.normalize('NFC').toLowerCase();
        if (seen.has(key)) throw new Error('Mehrdeutige Dateinamen im ZIP-Archiv.');
        seen.add(key);
        const mode = (entry.externalFileAttributes >>> 16) & 0o170000;
        if (mode === 0o120000 || (mode !== 0 && mode !== 0o100000 && mode !== 0o040000)) throw new Error('Verknüpfungen und spezielle Dateien sind im Import nicht erlaubt.');
        if (entry.generalPurposeBitFlag & 1) throw new Error('Verschlüsselte ZIP-Dateien werden nicht unterstützt.');
        const fileLimit = /\.zip$/i.test(entry.fileName) ? limits.totalBytes : limits.fileBytes;
        if (entry.uncompressedSize > fileLimit || budget.bytes + entry.uncompressedSize > limits.totalBytes) throw new Error('Das Archiv überschreitet die erlaubte Entpackgröße.');
        const target = path.join(destination, relative);
        if (!within(destination, target)) throw new Error('Pfad außerhalb des Importordners.');
        if (entry.fileName.endsWith('/')) {
          await mkdir(target, { recursive: true });
        } else {
          await mkdir(path.dirname(target), { recursive: true });
          const stream = await new Promise<NodeJS.ReadableStream>((res, rej) => zip.openReadStream(entry, (error, value) => error || !value ? rej(error) : res(value)));
          let fileBytes = 0;
          let checksum = 0;
          const bound = new Transform({ transform(chunk: Buffer, _encoding, callback) {
            fileBytes += chunk.length;
            budget.bytes += chunk.length;
            checksum = crc32(chunk, checksum);
            callback(fileBytes > fileLimit || budget.bytes > limits.totalBytes ? new Error('Entpacklimit überschritten.') : null, chunk);
          } });
          await pipeline(stream, bound, createWriteStream(target, { flags: 'wx', mode: 0o600 }), { signal });
          if (checksum !== entry.crc32) throw new Error('Die ZIP-Prüfsumme stimmt nicht. Bitte den Export erneut herunterladen.');
        }
        if (!settled) zip.readEntry();
      } catch (error) { finish(error); }
    })(); });
    if (signal?.aborted) abort(); else zip.readEntry();
  });
}

export interface SourceFiles { root: string; htmlFiles: string[]; name: string; cleanup(): Promise<void> }

export async function openSource(source: string, signal?: AbortSignal): Promise<SourceFiles> {
  signal?.throwIfAborted();
  const selected = path.resolve(source);
  const stat = await lstat(selected);
  if (stat.isSymbolicLink()) throw new Error('Bitte die Originaldatei statt einer Verknüpfung auswählen.');
  let root: string;
  let temporary: string | undefined;
  let single: string | undefined;
  if (stat.isDirectory()) root = await realpath(selected);
  else if (/\.zip$/i.test(selected)) {
    if (stat.size > limits.totalBytes) throw new Error('Die ZIP-Datei ist zu groß (maximal 256 MB).');
    temporary = await mkdtemp(path.join(os.tmpdir(), 'notion-pdf-import-'));
    root = temporary;
    try {
      const budget = { files: 0, bytes: 0 };
      await extractZip(selected, root, signal, budget);
      // Notion wraps multipart exports in an outer ZIP. Only unpack these
      // top-level ZIP-only envelopes, never arbitrary archives attached to pages.
      let unpackRoot = root;
      let envelopeBytes = 0;
      for (let depth = 0; depth < 2; depth++) {
        const entries = (await readdir(unpackRoot, { withFileTypes: true })).filter(entry => !entry.name.startsWith('.') && entry.name !== '__MACOSX');
        if (!entries.length || !entries.every(entry => entry.isFile() && /\.zip$/i.test(entry.name))) break;
        if (entries.length > 8) throw new Error('Zu viele Teilarchive.');
        const next = path.join(unpackRoot, 'unpacked');
        await mkdir(next);
        for (let index = 0; index < entries.length; index++) {
          const nested = path.join(unpackRoot, entries[index]!.name);
          envelopeBytes += (await lstat(nested)).size;
          if (envelopeBytes > limits.totalBytes) throw new Error('Die verschachtelten Archive sind zu groß.');
          const part = entries.length === 1 ? next : path.join(next, `part-${index + 1}`);
          await mkdir(part, { recursive: true });
          await extractZip(nested, part, signal, budget);
        }
        unpackRoot = next;
      }
      root = unpackRoot;
    }
    catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  } else if (/\.html?$/i.test(selected)) { root = await realpath(path.dirname(selected)); single = await realpath(selected); }
  else throw new Error('Bitte einen Notion-HTML-Export, einen Ordner oder eine ZIP-Datei auswählen.');

  const cleanup = async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); };
  try {
    root = await realpath(root);
    const htmlFiles: string[] = [];
    let count = 0;
    let bytes = 0;
    const walk = async (directory: string, depth: number) => {
      if (depth > limits.depth) throw new Error('Der Import ist zu tief verschachtelt.');
      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of entries) {
        signal?.throwIfAborted();
        if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
        if (++count > limits.files) throw new Error('Zu viele Dateien im Importordner.');
        if (entry.isSymbolicLink()) throw new Error('Verknüpfungen im Importordner sind nicht erlaubt.');
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await walk(full, depth + 1);
        else if (entry.isFile()) {
          const info = await lstat(full);
          bytes += info.size;
          if (info.size > limits.fileBytes || bytes > limits.totalBytes) throw new Error('Der Import überschreitet das Größenlimit.');
          if (/\.html?$/i.test(entry.name)) htmlFiles.push(full);
        }
      }
    };
    if (single) htmlFiles.push(single); else await walk(root, 0);
    if (!htmlFiles.length) throw new Error('Keine HTML-Dateien gefunden. Bitte in Notion das Exportformat HTML wählen.');
    return { root, htmlFiles, name: path.basename(selected).replace(/\.zip$/i, ''), cleanup };
  } catch (error) { await cleanup(); throw error; }
}

export async function readBounded(root: string, filename: string, maximum = limits.fileBytes): Promise<Buffer> {
  const resolved = await realpath(filename);
  if (!within(root, resolved)) throw new Error('Dateiverweis außerhalb des Importordners.');
  const stat = await lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maximum) throw new Error('Datei ist nicht lesbar oder überschreitet das Größenlimit.');
  // Bound the stream as well: a file can change after stat().
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of createReadStream(resolved)) {
    const value = Buffer.from(chunk);
    size += value.length;
    if (size > maximum) throw new Error('Dateigröße hat sich während des Imports geändert.');
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}
