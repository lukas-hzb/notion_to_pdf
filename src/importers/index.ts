import path from 'node:path';
import { createHash } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { openSource, readBounded, limits, within } from './files';
import { parseNotionHtml } from './html';
import { fetchOfficialNotionCover, ImageImportError, normalizeImage, officialNotionCoverUrl } from './images';
import type { Asset, Block, DocumentPage, Inline, Issue, Snapshot } from '../domain/model';

export { imageMime, isHeic, officialNotionCoverUrl } from './images';

export interface ImportOptions {
  fetchNotionCovers?: boolean;
}

function localReference(root: string, from: string, reference: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return undefined;
  try {
    const decoded = decodeURIComponent(reference.split(/[?#]/)[0] ?? '');
    if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return undefined;
    const resolved = path.resolve(path.dirname(from), decoded);
    return within(root, resolved) ? resolved : undefined;
  } catch { return undefined; }
}

export async function importNotion(source: string, signal?: AbortSignal, options: ImportOptions = {}): Promise<Snapshot> {
  const opened = await openSource(source, signal);
  try {
    const pages: DocumentPage[] = [];
    const pageFiles = new Map<string, DocumentPage>();
    const assets: Record<string, Asset> = {};
    type CachedAsset = { assetId: string } | { failure: { code: string; message: string } };
    const assetCache = new Map<string, CachedAsset>();
    let assetBytes = 0;
    for (const file of opened.htmlFiles) {
      signal?.throwIfAborted();
      const html = await readBounded(opened.root, file, limits.htmlBytes);
      const relative = path.relative(opened.root, file).split(path.sep).join('/');
      const page = parseNotionHtml(html.toString('utf8'), relative);
      if (pages.some(existing => existing.id === page.id)) {
        page.id = `${page.id}-${createHash('sha256').update(relative).digest('hex').slice(0, 8)}`;
        page.issues.push({ code: 'duplicate-page-id', severity: 'warning', message: 'Eine doppelte Seiten-ID wurde für diesen Import eindeutig gemacht.', pageId: page.id });
      }
      pages.push(page);
      pageFiles.set(path.resolve(file), page);
    }

    for (const page of pages) {
      signal?.throwIfAborted();
      const full = path.resolve(opened.root, page.sourcePath);
      const issue = (code: string, message: string, blockId?: string, severity: Issue['severity'] = 'warning') => page.issues.push({ code, message, pageId: page.id, blockId, severity });
      const storeImage = (normalized: Awaited<ReturnType<typeof normalizeImage>>, cacheKey: string, fail: (code: string, message: string) => undefined): string | undefined => {
        if (normalized.bytes.length > limits.fileBytes) return fail('image-too-large', `Das für die PDF aufbereitete Bild überschreitet das Größenlimit von ${Math.floor(limits.fileBytes / 1024 / 1024)} MB.`);
        const assetId = createHash('sha256').update(normalized.bytes).digest('hex');
        if (!assets[assetId]) {
          if (assetBytes + normalized.bytes.length > limits.totalBytes) return fail('image-too-large', 'Die Bilder überschreiten zusammen das erlaubte Größenlimit.');
          assetBytes += normalized.bytes.length;
          assets[assetId] = { id: assetId, mime: normalized.mime, dataUrl: `data:${normalized.mime};base64,${normalized.bytes.toString('base64')}` };
        }
        assetCache.set(cacheKey, { assetId });
        return assetId;
      };
      const loadImage = async (reference: string | undefined, blockId?: string, allowNotionCover = false): Promise<string | undefined> => {
        if (!reference) { issue('missing-image', 'Ein Bild hat keine lokale Quelldatei.', blockId); return undefined; }
        if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) {
          if (allowNotionCover && options.fetchNotionCovers && officialNotionCoverUrl(reference)) {
            const cached = assetCache.get(reference);
            if (cached) {
              if ('failure' in cached) { issue(cached.failure.code, cached.failure.message, blockId); return undefined; }
              return cached.assetId;
            }
            const fail = (code: string, message: string) => {
              assetCache.set(reference, { failure: { code, message } });
              issue(code, message, blockId);
              return undefined;
            };
            try {
              const assetId = storeImage(await fetchOfficialNotionCover(reference, signal), reference, fail);
              if (assetId) issue('notion-cover-fetched', 'Das offizielle Notion-Cover wurde auf ausdrückliche Anforderung geladen und lokal in die PDF eingebettet.', blockId, 'info');
              return assetId;
            } catch (error) {
              signal?.throwIfAborted();
              if (error instanceof ImageImportError) return fail(error.code, error.message);
              return fail('notion-cover-fetch-failed', 'Das offizielle Notion-Cover konnte nicht sicher geladen werden.');
            }
          }
          issue('external-image', 'Ein externes Bild wurde nicht geladen. Der Import arbeitet offline.', blockId);
          return undefined;
        }
        const filename = localReference(opened.root, full, reference);
        if (!filename) {
          issue('unsafe-image-reference', 'Ein unsicherer lokaler Bildverweis außerhalb des Importordners wurde nicht geöffnet.', blockId);
          return undefined;
        }
        const cached = assetCache.get(filename);
        if (cached) {
          if ('failure' in cached) { issue(cached.failure.code, cached.failure.message, blockId); return undefined; }
          return cached.assetId;
        }
        const fail = (code: string, message: string) => {
          assetCache.set(filename, { failure: { code, message } });
          issue(code, message, blockId);
          return undefined;
        };
        try {
          let stat;
          try { stat = await lstat(filename); }
          catch (error) {
            const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
            if (code === 'ENOENT' || code === 'ENOTDIR') return fail('missing-image', 'Die referenzierte lokale Bilddatei wurde nicht gefunden.');
            return fail('image-read-failed', 'Die lokale Bilddatei konnte nicht sicher gelesen werden.');
          }
          if (!stat.isFile() || stat.isSymbolicLink()) return fail('image-read-failed', 'Der lokale Bildverweis ist keine lesbare reguläre Datei.');
          if (stat.size > limits.fileBytes) return fail('image-too-large', `Die lokale Bilddatei überschreitet das Größenlimit von ${Math.floor(limits.fileBytes / 1024 / 1024)} MB.`);
          const bytes = await readBounded(opened.root, filename);
          return storeImage(await normalizeImage(bytes, filename), filename, fail);
        } catch (error) {
          if (error instanceof ImageImportError) return fail(error.code, error.message);
          return fail('image-read-failed', 'Die lokale Bilddatei konnte nicht sicher gelesen werden.');
        }
      };
      const rewriteLink = (href: string | undefined, blockId?: string): string | undefined => {
        if (!href || /^(https?:|mailto:)/i.test(href)) return href;
        const hash = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
        if (href.startsWith('#')) return `#${hash}`;
        const filename = localReference(opened.root, full, href);
        const target = filename ? pageFiles.get(filename) : undefined;
        if (target) {
          const subpages = path.resolve(opened.root, page.sourcePath.replace(/\.html?$/i, ''));
          if (!target.parentId && target.id !== page.id && within(subpages, path.dirname(filename!))) target.parentId = page.id;
          // Separate PDFs cannot rely on arbitrary file:// access in PDF viewers.
          if (target.id === page.id && hash) return `#${hash}`;
          if (/^[a-f\d-]{32,36}$/i.test(target.id)) return `https://www.notion.so/${target.id.replace(/-/g, '')}${hash ? `#${hash}` : ''}`;
          issue('local-link', 'Ein lokaler Seitenverweis bleibt als Text erhalten. PDF-übergreifende Links folgen in einer späteren Version.', blockId);
          return undefined;
        }
        issue('unresolved-link', 'Ein lokaler Verweis ist nicht Teil der importierten Seiten und bleibt als Text erhalten.', blockId);
        return undefined;
      };
      const rewriteInline = (items: Inline[], blockId?: string) => items.forEach(item => { if (item.href) item.href = rewriteLink(item.href, blockId); });
      const visit = async (blocks: Block[]) => {
        for (const block of blocks) {
          signal?.throwIfAborted();
          if (block.type === 'image') block.src = await loadImage(block.src, block.id);
          if (block.iconSrc) {
            if (block.type === 'bookmark' && /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(block.iconSrc)) {
              page.issues.push({ code: 'bookmark-icon-omitted', severity: 'info', pageId: page.id, blockId: block.id, message: 'Externes Website-Icon offline ausgelassen; der Link bleibt erhalten.' });
              block.iconSrc = undefined;
            } else block.iconSrc = await loadImage(block.iconSrc, block.id);
          }
          if (block.preview) {
            if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(block.preview)) {
              page.issues.push({ code: block.mediaKind ? 'media-preview-omitted' : 'bookmark-preview-omitted', severity: 'info', pageId: page.id, blockId: block.id, message: 'Externes Vorschaubild offline ausgelassen; Titel, Beschreibung und Link bleiben erhalten.' });
              block.preview = undefined;
            } else block.preview = await loadImage(block.preview, block.id);
          }
          if (block.href) block.href = rewriteLink(block.href, block.id);
          rewriteInline(block.content, block.id);
          if (block.description) rewriteInline(block.description, block.id);
          if (block.caption) rewriteInline(block.caption, block.id);
          await visit(block.children);
        }
      };
      if (page.cover) page.cover = await loadImage(page.cover, undefined, true);
      if (page.iconSrc) page.iconSrc = await loadImage(page.iconSrc);
      await visit(page.blocks);
      await visit(page.properties ?? []);
    }
    const issues: Issue[] = pages.flatMap(page => page.issues);
    const id = createHash('sha256').update(JSON.stringify({ pages, assets: Object.keys(assets).sort() })).digest('hex').slice(0, 24);
    return { version: 1, id, name: opened.name, importedAt: new Date().toISOString(), pages, assets, issues };
  } finally { await opened.cleanup(); }
}
