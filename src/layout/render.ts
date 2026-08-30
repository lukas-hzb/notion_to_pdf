import katex from 'katex';
import type { Block, DocumentPage, IconFields, Inline, Issue, Snapshot } from '../domain/model';
import type { ExportOptions } from '../domain/options';

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const esc = escapeHtml;
const bookmarkPreviewCharacters = 280;

function previewInline(items: Inline[], limit = bookmarkPreviewCharacters): Inline[] {
  const result: Inline[] = [];
  const sourceLength = items.reduce((sum, item) => sum + Array.from(item.text).length, 0);
  let used = 0;
  for (const item of items) {
    if (used >= limit) break;
    const characters = Array.from(item.text);
    const available = limit - used;
    if (characters.length <= available) {
      result.push({ ...item });
      used += characters.length;
      continue;
    }
    const candidate = characters.slice(0, available).join('');
    const boundary = candidate.search(/\s+\S*$/);
    const text = (boundary >= Math.floor(available * .6) ? candidate.slice(0, boundary) : candidate).trimEnd();
    result.push({ ...item, text: `${text}…`, equation: undefined });
    return result;
  }
  if (sourceLength > limit) {
    const last = result.at(-1);
    if (last) last.text = `${last.text.trimEnd()}…`;
  }
  return result;
}

export function normalizeDisplayEquation(expression: string): string {
  // Notion accepts bare line breaks in a block equation. KaTeX recognizes the
  // tokens but does not create vertical rows unless they live in an equation
  // layout. Exported multiline formulas place those breaks on separate source
  // lines, so matrices/cases with their own environments remain untouched.
  return /\\\\[ \t]*\r?\n/.test(expression) && !/\\begin\s*\{(?:gathered|aligned|alignedat|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|cases)\}/.test(expression)
    ? `\\begin{gathered}${expression}\\end{gathered}`
    : expression;
}

export function renderDocument(snapshot: Snapshot, page: DocumentPage, options: ExportOptions, style: string): { html: string; issues: Issue[] } {
  const issues: Issue[] = [...page.issues];
  const report = (code: string, message: string, blockId?: string) => issues.push({ code, message, blockId, pageId: page.id, severity: 'warning' });
  const math = (expression: string, displayMode = false, blockId?: string) => {
    try { return katex.renderToString(displayMode ? normalizeDisplayEquation(expression) : expression, { displayMode, throwOnError: true, trust: false, strict: 'error', maxExpand: 500, maxSize: 20, output: 'htmlAndMathml' }); }
    catch { report('equation-fallback', 'Eine Formel konnte nicht gesetzt werden; der Originalausdruck wird angezeigt.', blockId); return `<code>${esc(expression)}</code>`; }
  };
  function inline(items: Inline[], blockId?: string, links = true): string {
    return items.map(item => {
      if (item.propertyIcon) {
        const paths = { title: 'm3 16 5-12 5 12M5 11h6m2 5 3-8 3 8m-5-3h4', formula: 'M17 4H5l6 6-6 6h12', text: 'M4 5h12M4 10h12M4 15h8' };
        return `<svg class="property-icon" viewBox="0 0 20 20" aria-label="${item.propertyIcon}" fill="none" stroke="currentColor" stroke-width="1.5"><path d="${paths[item.propertyIcon]}"/></svg>`;
      }
      if (item.checkbox !== undefined) return `<span class="property-checkbox" aria-label="${item.checkbox ? 'Erledigt' : 'Offen'}">${item.checkbox ? '☑' : '☐'}</span>`;
      const plain = esc(item.text).replace(/\n/g, '<br>');
      let value = item.equation !== undefined ? math(item.equation, false, blockId) : item.code ? plain : plain.replace(/→/g, '<span class="notion-arrow">→</span>');
      if (item.code) value = `<code>${value}</code>`;
      if (item.bold) value = `<strong>${value}</strong>`;
      if (item.italic) value = `<em>${value}</em>`;
      if (item.underline) value = `<u>${value}</u>`;
      if (item.strike) value = `<s>${value}</s>`;
      if (item.script) value = `<${item.script}>${value}</${item.script}>`;
      if (item.color || item.background) value = `<span style="${item.color ? `color:${esc(item.color)};` : ''}${item.background ? `background:${esc(item.background)};` : ''}">${value}</span>`;
      if (links && item.href) value = `<a href="${esc(item.href)}">${value}</a>`;
      return value;
    }).join('');
  }
  function icon(fields: IconFields): string {
    if (fields.iconSrc && snapshot.assets[fields.iconSrc]) return `<img class="notion-icon" src="${snapshot.assets[fields.iconSrc]!.dataUrl}" alt="">`;
    // Locally authored vectors for recognized built-in symbols, never source SVG.
    const symbols = { bookmark: 'M7 2a2 2 0 0 0-2 2v18l7-6 7 6V4a2 2 0 0 0-2-2z', 'exclamation-mark': 'M10 3h4l-.6 12h-2.8zM10 18h4v4h-4z' };
    if (fields.iconSymbol) return `<svg class="notion-icon" viewBox="0 0 24 24" fill="${esc(fields.iconColor || 'currentColor')}" aria-hidden="true"><path d="${symbols[fields.iconSymbol]}"/></svg>`;
    return fields.icon ? esc(fields.icon) : '';
  }
  const renderAll = (blocks: Block[]) => {
    // Empty editor paragraphs after the last block can push a finished column
    // onto an otherwise blank page. Preserve intentional gaps inside content.
    let end = blocks.length;
    while (end > 0 && blocks[end - 1]!.type === 'paragraph' && blocks[end - 1]!.content.every(item => !item.text.trim() && item.equation === undefined && !item.propertyIcon && item.checkbox === undefined)) end--;
    const output: string[] = [];
    for (let index = 0; index < end; index++) {
      const block = blocks[index]!;
      const next = blocks[index + 1];
      // Chromium can ignore break-after:avoid before an indivisible image.
      // Give the heading and figure a shared pagination boundary instead.
      if (block.type === 'heading' && next?.type === 'image') {
        output.push(`<section class="heading-media heading-level-${Math.min(4, Math.max(1, block.level || 2))}" data-block-type="image">${render(block)}${render(next)}</section>`);
        index++;
      } else output.push(render(block));
    }
    return output.join('');
  };
  const paper = options.paper === 'A4' ? [210, 297] : [215.9, 279.4];
  const width = options.landscape ? paper[1]! : paper[0]!;
  const height = options.landscape ? paper[0]! : paper[1]!;
  const maxTableColumns = Math.max(2, Math.floor((width - options.margin * 2) / (28 * options.fontSize / 11)));
  const tableWidth = width - options.margin * 2;
  const blockText = (block: Block | undefined): string => block ? [...block.content.map(item => item.text), ...block.children.map(blockText)].join(' ') : '';
  function columnMinimum(rows: Block[], index: number, key = false): number {
    const heading = blockText(rows[0]?.children[index]);
    const longest = Math.max(0, ...heading.split(/[\s/()-]+/).map(word => word.length));
    const lengths = rows.slice(1, 201).map(row => blockText(row.children[index]).length);
    const average = lengths.reduce((sum, n) => sum + n, 0) / Math.max(1, lengths.length);
    // Reserve room for header words as well as prose. Short numeric values
    // must not squeeze a long heading into a few characters per line.
    return Math.max(key ? 40 : 26, Math.min(58, longest * 1.9 + 6), average > 60 ? 60 : average > 35 ? 44 : 0) * options.fontSize / 11;
  }
  function tableRows(rows: Block[]): string {
    const head = rows[0]?.children.length && rows[0].children.every(cell => cell.header) ? rows[0] : undefined;
    return `${head ? `<thead>${render(head)}</thead>` : ''}<tbody>${renderAll(head ? rows.slice(1) : rows)}</tbody>`;
  }
  function tableWidths(rows: Block[]): string {
    const count = rows[0]?.children.length ?? 0;
    const minimums = Array.from({ length: count }, (_, index) => columnMinimum(rows, index, index === 0));
    const free = Math.max(0, tableWidth - minimums.reduce((sum, n) => sum + n, 0));
    const weights = Array.from({ length: count }, (_, index) => {
      const lengths = rows.slice(1, 201).map(row => blockText(row.children[index]).length);
      const average = lengths.reduce((sum, length) => sum + length, 0) / Math.max(1, lengths.length);
      const heading = blockText(rows[0]?.children[index]).length;
      return Math.max(3, Math.min(12, Math.sqrt(Math.max(average, heading * .4))));
    });
    const sum = weights.reduce((sum, weight) => sum + weight, 0);
    const widths = weights.map((weight, index) => minimums[index]! + free * weight / sum);
    const total = widths.reduce((sum, n) => sum + n, 0);
    return `<colgroup>${widths.map(value => `<col style="width:${(value / total * 100).toFixed(3)}%">`).join('')}</colgroup>`;
  }
  function renderTable(block: Block, attrs: string): string {
    const rows = block.children;
    const columnCount = Math.max(0, ...rows.map(row => row.children.reduce((sum, cell) => sum + (cell.colspan || 1), 0)));
    if (columnCount <= maxTableColumns) return `<table ${attrs}>${tableRows(rows)}</table>`;
    const splittable = rows.every(row => row.type === 'tableRow' && row.children.length === columnCount && row.children.every(cell => (cell.colspan || 1) === 1 && (cell.rowspan || 1) === 1));
    if (options.tables === 'wrap' || !splittable) {
      report('wide-table', splittable ? 'Eine breite Tabelle wird auf die Seitenbreite umgebrochen. Für bessere Lesbarkeit --tables split verwenden.' : 'Eine breite Tabelle mit verbundenen oder unregelmäßigen Zellen konnte nicht in Spaltengruppen geteilt werden. Querformat prüfen.', block.id);
      return `<table ${attrs}>${tableRows(rows)}</table>`;
    }
    const groups: number[][] = [];
    const keyColumn = Math.min(columnCount - 1, Math.max(0, block.keyColumn ?? 0));
    const remaining = Array.from({ length: columnCount }, (_, index) => index).filter(index => index !== keyColumn);
    let group = [keyColumn];
    let required = columnMinimum(rows, keyColumn, true);
    for (const index of remaining) {
      const minimum = columnMinimum(rows, index);
      if (group.length > 1 && (group.length >= maxTableColumns || required + minimum > tableWidth)) {
        groups.push(group); group = [keyColumn]; required = columnMinimum(rows, keyColumn, true);
      }
      group.push(index); required += minimum;
    }
    if (group.length > 1) groups.push(group);
    issues.push({ code: 'table-split', severity: 'info', pageId: page.id, blockId: block.id, message: `Eine breite Tabelle wurde in ${groups.length} Spaltengruppen geteilt. Spalte ${keyColumn + 1} wird zur Orientierung wiederholt.` });
    const used = new Set<string>();
    const copy = (item: Block, part: number): Block => {
      const id = used.has(item.id) ? `${item.id}-table-part-${part}` : item.id;
      used.add(item.id);
      return { ...item, id, children: item.children.map(child => copy(child, part)) };
    };
    return `<section ${attrs} class="split-table">${groups.map((columns, part) => {
      const selected = rows.map(row => copy({ ...row, children: columns.map(index => row.children[index]!) }, part));
      return `<section class="table-part"><p class="table-part-label">Tabelle · Teil ${part + 1}/${groups.length} · Spalten ${columns.map(index => index + 1).join(', ')}</p><table>${tableWidths(selected)}${tableRows(selected)}</table></section>`;
    }).join('')}</section>`;
  }
  function render(block: Block): string {
    const attrs = `id="${esc(block.id)}" data-block="${esc(block.id)}" data-block-type="${block.type}"${block.background || block.color ? ` style="${block.background ? `background:${esc(block.background)};` : ''}${block.color ? `color:${esc(block.color)};` : ''}"` : ''}`;
    const content = inline(block.content, block.id);
    const children = () => renderAll(block.children);
    switch (block.type) {
      case 'paragraph': return `<p ${attrs}>${content || '<br>'}</p>`;
      case 'heading': { const level = Math.min(4, Math.max(1, block.level || 2)); return `<h${level} ${attrs}>${content}</h${level}>`; }
      case 'list': {
        const name = block.ordered ? 'ol' : 'ul';
        const tasksOnly = block.children.length > 0 && block.children.every(item => item.type === 'task');
        return `<${name} ${attrs} class="${tasksOnly && options.tasks === 'checkboxes' ? 'task-list' : ''}"${block.ordered ? ` start="${block.start || 1}"${block.listStyle ? ` type="${block.listStyle}"` : ''}` : ''}>${children()}</${name}>`;
      }
      case 'listItem': return `<li ${attrs}>${content ? `<span class="list-item-label">${content}</span>` : ''}${children()}</li>`;
      case 'task': {
        const checked = !!block.checked;
        const strike = checked && options.preserveTaskStatus ? ' task-done' : '';
        if (!options.preserveTaskStatus && checked) issues.push({ code: 'task-status-removed', severity: 'info', message: 'Der Erledigt-Status wurde auf ausdrücklichen Wunsch entfernt.', pageId: page.id, blockId: block.id });
        const marker = options.tasks === 'checkboxes' ? `<span class="checkbox ${checked && options.preserveTaskStatus ? 'checked' : ''}" aria-label="${!options.preserveTaskStatus ? 'Aufgabe' : checked ? 'Erledigt' : 'Offen'}">${checked && options.preserveTaskStatus ? '✓' : ''}</span>` : '';
        return `<li ${attrs} class="task ${options.tasks === 'checkboxes' ? 'with-checkbox' : ''}">${marker}<span class="task-label${strike}">${content}</span>${children()}</li>`;
      }
      case 'toggle': {
        const heading = block.level ? `h${Math.min(4, block.level)}` : 'div';
        return `<section ${attrs} class="toggle ${options.toggles === 'sections' ? 'toggle-section' : ''}${block.level ? ' toggle-heading' : ''}"><${heading} class="toggle-title">${options.toggles === 'expanded' ? '<span class="toggle-marker" aria-hidden="true">▾</span>' : ''}${content}</${heading}><div class="toggle-content">${children()}</div></section>`;
      }
      case 'tab': return `<section ${attrs} class="tab-section"><h2 class="tab-title">${content}</h2>${children()}</section>`;
      case 'columns': {
        const cols = block.children.filter(child => child.type === 'column');
        if (options.columns === 'stack') return `<section ${attrs} class="columns stacked">${children()}</section>`;
        const weights = cols.map(col => col.width ?? (100 / Math.max(cols.length, 1)));
        return `<section ${attrs} class="columns" style="grid-template-columns:${weights.map(weight => `minmax(0,${weight}fr)`).join(' ')}">${children()}</section>`;
      }
      case 'column': return `<div ${attrs} class="column">${children()}</div>`;
      case 'callout': { const symbol = icon(block); return `<aside ${attrs} class="callout">${symbol ? `<span class="callout-icon" aria-hidden="true">${symbol}</span>` : ''}<div class="callout-content">${content ? `<p>${content}</p>` : ''}${children()}</div></aside>`; }
      case 'quote': return `<blockquote ${attrs}>${content ? `<p>${content}</p>` : ''}${children()}</blockquote>`;
      case 'divider': return `<hr ${attrs}>`;
      case 'image': {
        const asset = block.src ? snapshot.assets[block.src] : undefined;
        const imageWidth = block.imageWidthPercent ? `${Number(block.imageWidthPercent.toFixed(4))}%` : block.imageWidth ? `${block.imageWidth}px` : undefined;
        const picture = asset ? `<img src="${asset.dataUrl}" alt="${esc(block.alt || '')}"${imageWidth ? ` style="width:${imageWidth}"` : ''}>` : `<div class="missing-media">Bild nicht verfügbar${block.alt ? `: ${esc(block.alt)}` : ''}</div>`;
        return `<figure ${attrs} class="image-block align-center">${picture}${block.caption?.length ? `<figcaption>${inline(block.caption, block.id)}</figcaption>` : ''}</figure>`;
      }
      case 'table': return renderTable(block, attrs);
      case 'tableRow': return `<tr ${attrs}>${children()}</tr>`;
      case 'tableCell': { const name = block.header ? 'th' : 'td'; return `<${name} ${attrs} colspan="${block.colspan || 1}" rowspan="${block.rowspan || 1}">${content}${children()}</${name}>`; }
      case 'code': return `<div ${attrs} class="code-block">${block.language ? `<div class="code-language">${esc(block.language)}</div>` : ''}<pre><code>${esc(block.content.map(item => item.text).join(''))}</code></pre></div>`;
      case 'equation': return `<div ${attrs} class="equation">${math(block.content.map(item => item.text).join(''), true, block.id)}</div>`;
      case 'pageLink': {
        const label = inline(block.content, block.id, false);
        return `<div ${attrs} class="page-link"><svg class="page-link-icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><path d="M4 2h8l4 4v12H4zM12 2v4h4M7 10h6M7 13h6"/></svg><span>${block.href ? `<a href="${esc(block.href)}">${label || esc(block.href)}</a>` : label}</span></div>`;
      }
      case 'bookmark': {
        const label = inline(block.content, block.id, false) || esc(block.href || 'Lesezeichen');
        const caption = block.caption?.length ? `<div class="bookmark-caption">${inline(block.caption, block.id)}</div>` : '';
        if (options.bookmarks === 'compact') {
          issues.push({ code: 'bookmark-compacted', severity: 'info', pageId: page.id, blockId: block.id, message: 'Lesezeichen auf ausdrücklichen Wunsch auf Titel und URL reduziert.' });
          return `<section ${attrs} class="bookmark-compact">${block.href ? `<a href="${esc(block.href)}">${label}</a><div class="link-card-url">${esc(block.href)}</div>` : label}${caption}</section>`;
        }
        const preview = block.preview ? snapshot.assets[block.preview] : undefined;
        const symbol = icon(block);
        const name = block.href ? 'a' : 'div';
        return `<section ${attrs} class="bookmark"><${name}${block.href ? ` href="${esc(block.href)}"` : ''} class="bookmark-card${preview ? ' has-preview' : ''}">${preview ? `<img class="bookmark-preview" src="${preview.dataUrl}" alt="">` : ''}<div class="bookmark-body">${symbol ? `<div class="bookmark-icon" aria-hidden="true">${symbol}</div>` : ''}<div class="link-card-title">${label}</div>${block.description?.length ? `<div class="link-card-description">${inline(previewInline(block.description), block.id, false)}</div>` : ''}${block.href ? `<div class="link-card-url">${esc(block.href)}</div>` : ''}</div></${name}>${caption}</section>`;
      }
      case 'file': {
        const label = inline(block.content, block.id, false);
        const filename = block.content.map(item => item.text).join('').trim() || block.href || 'Datei';
        const preview = block.preview ? snapshot.assets[block.preview] : undefined;
        const name = block.href ? `<a href="${esc(block.href)}">${label || esc(block.href)}</a>` : label || esc(filename);
        return `<div ${attrs} class="file-attachment"><span class="file-attachment-icon" aria-hidden="true"><svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.35"><path d="M4 2h8l4 4v12H4zM12 2v4h4M10 16V9m-3 3 3-3 3 3"/></svg></span><div class="file-attachment-body"><div class="file-attachment-name">${name}</div>${block.description?.length ? `<div class="file-attachment-description">${inline(block.description, block.id, false)}</div>` : ''}${preview ? `<img class="bookmark-preview" src="${preview.dataUrl}" alt="">` : ''}${block.caption?.length ? `<div class="file-attachment-caption">${inline(block.caption)}</div>` : ''}</div></div>`;
      }
      case 'unsupported': {
        const preview = block.preview ? snapshot.assets[block.preview] : undefined;
        if (block.mediaKind) return `<aside ${attrs} class="media-card"><div class="link-card-label">${{ video: 'VIDEO', audio: 'AUDIO', embed: 'EINBETTUNG', pdf: 'PDF-DOKUMENT' }[block.mediaKind]}</div><div class="link-card-title">${content}</div>${preview ? `<img class="media-preview" src="${preview.dataUrl}" alt="">` : ''}<p class="media-note">Statische Darstellung · im PDF nicht interaktiv</p>${block.href ? `<a href="${esc(block.href)}">Original öffnen</a><div class="link-card-url">${esc(block.href)}</div>` : ''}${block.caption?.length ? `<div class="bookmark-caption">${inline(block.caption, block.id)}</div>` : ''}</aside>`;
        return `<aside ${attrs} class="unsupported"><strong>Statische Ersatzdarstellung</strong><div>${content}</div>${block.href ? `<a href="${esc(block.href)}">Original öffnen</a>` : ''}</aside>`;
      }
    }
  }
  // Resolve visibility before adding overlap spacing. Missing or explicitly
  // disabled covers must never pull the icon above the page; presets do not
  // override the dedicated includeCover option.
  const cover = options.includeCover && page.cover ? snapshot.assets[page.cover] : undefined;
  const pageIcon = icon(page);
  const header = `<header class="document-header${cover ? ' with-cover' : ''}${pageIcon ? ' with-icon' : ''}">${cover ? `<img class="page-cover" src="${cover.dataUrl}" alt="">` : ''}${pageIcon ? `<div class="page-icon">${pageIcon}</div>` : ''}<h1 class="document-title">${esc(page.title)}</h1></header>`;
  const content = renderAll(page.blocks);
  const properties = page.properties?.length ? `<section class="page-properties"><h2>Eigenschaften</h2>${renderAll(page.properties)}</section>` : '';
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>${esc(page.title)}</title><style>${style}\n@page{size:${width}mm ${height}mm;margin:${options.margin}mm}html{font-size:${options.fontSize}pt}body{width:${width - options.margin * 2}mm;--content-height:${height - options.margin * 2}mm;}</style></head><body class="preset-${options.preset} notion-font-${page.font || 'sans'}${options.continuousPage ? ' continuous-page' : ''}"><article>${header}${properties}${content}</article></body></html>`;
  return { html, issues };
}
