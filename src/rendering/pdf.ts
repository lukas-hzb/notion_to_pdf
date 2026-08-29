import { BrowserWindow, session } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { renderDocument } from '../layout/render';
import type { Snapshot, DocumentPage, Issue } from '../domain/model';
import type { ExportOptions } from '../domain/options';
import type { PdfResult } from '../domain/results';

let styleCache: string | undefined;
export async function printStyles(root: string): Promise<string> {
  if (styleCache) return styleCache;
  let css = await readFile(path.join(root, 'dist/print.css'), 'utf8');
  for (const [family, directory, basename, weights] of [
    ['Inter', 'inter', 'inter-latin', [400, 600, 700]],
    ['JetBrains Mono', 'jetbrains-mono', 'jetbrains-mono-latin', [400, 600, 700]],
  ] as const) {
    for (const weight of weights) {
      for (const fontStyle of ['normal', 'italic']) {
        const bytes = await readFile(path.join(root, 'node_modules/@fontsource', directory, 'files', `${basename}-${weight}-${fontStyle}.woff2`));
        css += `\n@font-face{font-family:'${family}';font-style:${fontStyle};font-weight:${weight};src:url(data:font/woff2;base64,${bytes.toString('base64')}) format('woff2');font-display:block}`;
      }
    }
  }
  const katexRoot = path.join(root, 'node_modules/katex/dist');
  let katexCss = await readFile(path.join(katexRoot, 'katex.min.css'), 'utf8');
  const fontRefs = [...new Set(katexCss.match(/fonts\/[\w.-]+\.(?:woff2?|ttf)/g) ?? [])];
  for (const ref of fontRefs) {
    const bytes = await readFile(path.join(katexRoot, ref));
    const mime = ref.endsWith('.woff2') ? 'font/woff2' : ref.endsWith('.woff') ? 'font/woff' : 'font/ttf';
    katexCss = katexCss.split(ref).join(`data:${mime};base64,${bytes.toString('base64')}`);
  }
  styleCache = css + katexCss;
  return styleCache;
}

export async function renderPdf(root: string, snapshot: Snapshot, page: DocumentPage, options: ExportOptions, signal?: AbortSignal): Promise<PdfResult> {
  signal?.throwIfAborted();
  const started = Date.now();
  const rendered = renderDocument(snapshot, page, options, await printStyles(root));
  if (options.strict && rendered.issues.some(issue => issue.severity !== 'info')) throw new Error('Strenger Modus: Diese Seite enthält bekannte Importlücken. Bitte Hinweise prüfen.');
  const id = randomUUID();
  const printSession = session.fromPartition(`print-${id}`, { cache: false });
  const url = `notion-pdf://document/${id}`;
  printSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  printSession.setPermissionCheckHandler(() => false);
  printSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: details.url !== url && !details.url.startsWith('data:') }));
  printSession.protocol.handle('notion-pdf', request => request.url === url ? new Response(rendered.html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }) : new Response('', { status: 403 }));
  const win = new BrowserWindow({ show: false, width: 1000, height: 1200, webPreferences: { session: printSession, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false, spellcheck: false } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  const abort = () => { if (!win.isDestroyed()) win.destroy(); };
  signal?.addEventListener('abort', abort, { once: true });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; abort(); }, 45000);
  try {
    await win.loadURL(url);
    const findings = await win.webContents.executeJavaScript(`(async()=>{
      await document.fonts.ready;
      const badImages=[];
      await Promise.all(Array.from(document.images).map(async image=>{try{await image.decode();if(image.naturalWidth*image.naturalHeight>40000000)badImages.push(image.closest('[data-block]')?.id||'');}catch{badImages.push(image.closest('[data-block]')?.id||'');}}));
      await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
      const right=document.body.getBoundingClientRect().right;
      const overflow=Array.from(document.querySelectorAll('[data-block]')).filter(el=>el.getBoundingClientRect().right>right+2||el.scrollWidth>el.clientWidth+3).map(el=>el.id);
      return {badImages,overflow:[...new Set(overflow)].slice(0,40)};
    })()` ) as { badImages: string[]; overflow: string[] };
    signal?.throwIfAborted();
    const issues: Issue[] = [...rendered.issues];
    for (const blockId of findings.badImages) issues.push({ code: 'image-decode', severity: 'error', pageId: page.id, blockId, message: 'Ein Bild konnte nicht sicher dargestellt werden.' });
    for (const blockId of findings.overflow) issues.push({ code: 'layout-overflow', severity: 'warning', pageId: page.id, blockId, message: 'Dieser Block ist breiter als der verfügbare Platz. Querformat oder einspaltige Ausgabe prüfen.' });
    if (issues.some(issue => issue.severity === 'error') || (options.strict && issues.some(issue => issue.severity !== 'info'))) throw new Error('Das Layout enthält ungelöste Probleme. Bitte die Darstellung anpassen oder den strengen Modus deaktivieren.');
    const buffer = await win.webContents.printToPDF({
      printBackground: true, preferCSSPageSize: true,
      generateTaggedPDF: true, generateDocumentOutline: true,
      displayHeaderFooter: options.pageNumbers,
      headerTemplate: '<span></span>',
      footerTemplate: `<div style="width:100%;text-align:center;font-size:8px;font-family:Arial;color:#8b8b85"><span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    signal?.throwIfAborted();
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
    try {
      const pdf = await task.promise;
      if (!pdf.numPages) throw new Error('Die erzeugte PDF-Datei enthält keine Seiten.');
      const first = await pdf.getPage(1);
      const content = await first.getTextContent();
      if (!content.items.length) issues.push({ code: 'pdf-text-empty', severity: 'warning', pageId: page.id, message: 'Die erste PDF-Seite enthält keinen auswählbaren Text.' });
      if (options.strict && issues.some(issue => issue.severity !== 'info')) throw new Error('Die PDF-Prüfung hat ein Problem gefunden.');
      return { data: new Uint8Array(buffer), pageCount: pdf.numPages, issues, durationMs: Date.now() - started };
    } finally { await task.destroy(); }
  } catch (error) {
    if (signal?.aborted) throw new Error('Export abgebrochen.');
    if (timedOut) throw new Error('Die PDF-Erzeugung hat das Zeitlimit überschritten.');
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
    if (!win.isDestroyed()) win.destroy();
    printSession.protocol.unhandle('notion-pdf');
    await printSession.clearStorageData();
  }
}
