import path from 'node:path';
import { createHash } from 'node:crypto';
import { openSource, readBounded, limits, within } from './files';
import { parseNotionHtml } from './html';
import type { Asset, Block, DocumentPage, Inline, Issue, Snapshot } from '../domain/model';

function localReference(root: string, from: string, reference: string): string | undefined {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(reference)) return undefined;
  try {
    const decoded = decodeURIComponent(reference.split(/[?#]/)[0] ?? '');
    if (!decoded || decoded.includes('\0') || decoded.includes('\\')) return undefined;
    const resolved = path.resolve(path.dirname(from), decoded);
    return within(root, resolved) ? resolved : undefined;
  } catch { return undefined; }
}

export function imageMime(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (data[0] === 255 && data[1] === 216 && data[2] === 255) return 'image/jpeg';
  if (['GIF87a', 'GIF89a'].includes(data.subarray(0, 6).toString())) return 'image/gif';
  if (data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  return undefined;
}

export async function importNotion(source: string, signal?: AbortSignal): Promise<Snapshot> {
  const opened = await openSource(source, signal);
  try {
    const pages: DocumentPage[] = [];
    const pageFiles = new Map<string, DocumentPage>();
    const assets: Record<string, Asset> = {};
    const assetCache = new Map<string, string | undefined>();
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
      const issue = (code: string, message: string, blockId?: string) => page.issues.push({ code, message, pageId: page.id, blockId, severity: 'warning' });
      const loadImage = async (reference: string | undefined, blockId?: string): Promise<string | undefined> => {
        if (!reference) { issue('missing-image', 'Ein Bild hat keine lokale Quelldatei.', blockId); return undefined; }
        const filename = localReference(opened.root, full, reference);
        if (!filename) { issue('external-image', 'Ein externes oder unsicheres Bild wurde nicht geladen. Der Import arbeitet offline.', blockId); return undefined; }
        if (assetCache.has(filename)) {
          const cached = assetCache.get(filename);
          if (!cached) issue('missing-image', 'Ein Bild fehlt oder hat ein nicht unterstütztes Format.', blockId);
          return cached;
        }
        try {
          const bytes = await readBounded(opened.root, filename);
          assetBytes += bytes.length;
          if (assetBytes > limits.totalBytes) throw new Error('Asset-Limit überschritten.');
          const mime = imageMime(bytes);
          if (!mime) throw new Error('Bildformat wird nicht unterstützt.');
          const assetId = createHash('sha256').update(bytes).digest('hex');
          assets[assetId] = { id: assetId, mime, dataUrl: `data:${mime};base64,${bytes.toString('base64')}` };
          assetCache.set(filename, assetId);
          return assetId;
        } catch {
          assetCache.set(filename, undefined);
          issue('missing-image', 'Ein Bild fehlt, ist zu groß oder hat ein nicht unterstütztes Format (PNG, JPEG, GIF, WebP).', blockId);
          return undefined;
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
      if (page.cover) page.cover = await loadImage(page.cover);
      if (page.iconSrc) page.iconSrc = await loadImage(page.iconSrc);
      await visit(page.blocks);
      await visit(page.properties ?? []);
    }
    const issues: Issue[] = pages.flatMap(page => page.issues);
    const id = createHash('sha256').update(JSON.stringify({ pages, assets: Object.keys(assets).sort() })).digest('hex').slice(0, 24);
    return { version: 1, id, name: opened.name, importedAt: new Date().toISOString(), pages, assets, issues };
  } finally { await opened.cleanup(); }
}
