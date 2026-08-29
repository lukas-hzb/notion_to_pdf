import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { createHash } from 'node:crypto';
import path from 'node:path';
import type { Block, BlockType, DocumentPage, IconFields, Inline, Issue } from '../domain/model';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
const isElement = (node: Node): node is Element => 'tagName' in node;
const nodes = (node: Node): Node[] => 'childNodes' in node ? node.childNodes : [];
const tag = (node: Node) => isElement(node) ? node.tagName : '';
const attr = (node: Node, name: string) => isElement(node) ? node.attrs.find(a => a.name === name)?.value : undefined;
const classes = (node: Node) => (attr(node, 'class') ?? '').split(/\s+/);
const has = (node: Node, name: string) => classes(node).includes(name);
const find = (node: Node, predicate: (node: Node) => boolean): Node | undefined => predicate(node) ? node : nodes(node).map(n => find(n, predicate)).find(Boolean);
const blocked = new Set(['script', 'style', 'noscript', 'link', 'meta', 'base', 'template']);
const text = (node: Node): string => blocked.has(tag(node)) ? '' : node.nodeName === '#text' ? (node as DefaultTreeAdapterMap['textNode']).value : nodes(node).map(text).join('');
const parent = (node: Node): Node | undefined => (node as Node & { parentNode?: Node | null }).parentNode ?? undefined;
const hasAncestor = (node: Node, predicate: (node: Node) => boolean): boolean => {
  for (let current = parent(node); current; current = parent(current)) if (predicate(current)) return true;
  return false;
};

// A regular Notion editor column is approximately 710 CSS pixels wide. The
// HTML export stores image widths in those editor pixels, while a PDF content
// column varies with paper and margins. Preserve the visual ratio for free
// images; images inside columns/tables keep their pixel width and are capped by
// their actual container instead.
const notionImageWidth = 710;

const colors: Record<string, string> = { gray: '#77766f', brown: '#906341', orange: '#c06b2c', yellow: '#aa861b', green: '#347953', teal: '#347953', blue: '#286ba5', purple: '#875da5', pink: '#c14c8a', red: '#b94c4c' };
const backgrounds: Record<string, string> = { gray: '#f7f6f5', brown: '#f1e9e1', orange: '#fbeddc', yellow: '#fbf3d5', green: '#e7f1e9', teal: '#e7f1e9', blue: '#e5eff8', purple: '#eee7f5', pink: '#f6e7ef', red: '#f9e5e5' };

function tone(node: Node): { color?: string; background?: string } {
  const result: { color?: string; background?: string } = {};
  for (const cls of classes(node)) {
    const match = /^(?:block-color-|highlight-)([a-z]+)(_background)?$/.exec(cls);
    if (match?.[1]) {
      if (match[2] && Object.hasOwn(backgrounds, match[1])) result.background = backgrounds[match[1]];
      else if (!match[2] && Object.hasOwn(colors, match[1])) result.color = colors[match[1]];
    }
  }
  return result;
}

export function safeLink(value: string | undefined): string | undefined {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) return undefined;
  const clean = value.trim();
  if (/^(https?:|mailto:|tel:)/i.test(clean)) {
    try { const url = new URL(clean); return url.username || url.password ? undefined : url.href; } catch { return undefined; }
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(clean) || clean.startsWith('//') || clean.includes('\\')) return undefined;
  return clean;
}

export function parseNotionHtml(html: string, sourcePath: string): DocumentPage {
  const document = parse(html);
  const article = find(document, node => tag(node) === 'article');
  const body = find(document, node => tag(node) === 'body') ?? document;
  const titleNode = find(article ?? body, node => has(node, 'page-title'));
  const documentTitle = find(document, node => tag(node) === 'title');
  const title = text(titleNode ?? documentTitle ?? { nodeName: '#text', value: path.basename(sourcePath, path.extname(sourcePath)) } as Node).trim() || 'Ohne Titel';
  const id = attr(article ?? body, 'id') || createHash('sha256').update(sourcePath).digest('hex').slice(0, 24);
  const contentRoot = find(article ?? body, node => has(node, 'page-body')) ?? article ?? body;
  const propertiesNode = find(article ?? body, node => tag(node) === 'table' && has(node, 'properties'));
  const issues: Issue[] = [];
  const usedIds = new Set<string>();
  let counter = 0;
  let visited = 0;
  const issue = (code: string, message: string, blockId?: string, severity: Issue['severity'] = 'warning') => issues.push({ code, severity, message, pageId: id, blockId });
  if (!article) issue('generic-html', 'Kein Notion-Seitencontainer erkannt. Allgemeines HTML wird mit eingeschränkter Layouttreue importiert.');

  function block(type: BlockType, node: Node, extra: Partial<Block> = {}): Block {
    const candidate = attr(node, 'id') || `${id}-${++counter}`;
    const blockId = usedIds.has(candidate) ? `${candidate}-${++counter}` : candidate;
    usedIds.add(blockId);
    return { id: blockId, type, content: [], children: [], ...tone(node), ...extra };
  }

  function inline(node: Node, inherited: Partial<Inline> = {}, depth = 0, preserveWhitespace = false): Inline[] {
    if (depth > 100 || ++visited > 150000) throw new Error('Das HTML-Dokument ist zu komplex.');
    if (node.nodeName === '#text') return [{ ...inherited, text: preserveWhitespace ? text(node) : text(node).replace(/\s+/g, ' ') }];
    const name = tag(node);
    if (blocked.has(name)) return [];
    if (has(node, 'checkbox') || (name === 'input' && attr(node, 'type') === 'checkbox')) return [{ ...inherited, text: '', checkbox: has(node, 'checkbox-on') || attr(node, 'checked') !== undefined }];
    if (name === 'input') return [];
    if (name === 'br') return [{ ...inherited, text: '\n' }];
    const notionEquation = attr(node, 'data-notion-inline-equation');
    if (notionEquation !== undefined) return [{ ...inherited, text: notionEquation, equation: notionEquation }];
    if (has(node, 'katex') || has(node, 'katex-display') || name === 'math') {
      const annotation = find(node, child => tag(child) === 'annotation' && attr(child, 'encoding') === 'application/x-tex');
      if (annotation) return [{ ...inherited, text: text(annotation), equation: text(annotation) }];
      issue('math-source-missing', 'Eine gerenderte Formel enthält keinen TeX-Quelltext. Die Textdarstellung muss geprüft werden.');
      return [{ ...inherited, text: text(node) }];
    }
    if (name === 'img') {
      if (has(node, 'bookmark-icon') || has(node, 'bookmark-image')) return [];
      const property = /^https:\/\/app\.notion\.com\/icons\/(font|formula|description)_gray\.svg$/.exec(attr(node, 'src') ?? '')?.[1];
      if (property) return [{ ...inherited, text: '', propertyIcon: property === 'font' ? 'title' : property === 'formula' ? 'formula' : 'text' }];
      issue('inline-image-fallback', 'Ein Bild innerhalb eines Textblocks wird durch seinen Alternativtext ersetzt.');
      return [{ ...inherited, text: attr(node, 'alt') || ' [Bild] ' }];
    }
    const marks: Partial<Inline> = { ...inherited, ...tone(node) };
    if (['strong', 'b'].includes(name)) marks.bold = true;
    if (['em', 'i'].includes(name)) marks.italic = true;
    if (['del', 's', 'strike'].includes(name)) marks.strike = true;
    if (name === 'sub' || name === 'sup') marks.script = name;
    if (name === 'u') marks.underline = true;
    if (name === 'code') marks.code = true;
    if (name === 'a') {
      marks.href = safeLink(attr(node, 'href'));
      if (attr(node, 'href') && !marks.href) issue('unsafe-link', 'Ein unsicheres Linkziel wurde entfernt.', undefined, 'info');
    }
    return nodes(node).flatMap(child => inline(child, marks, depth + 1, preserveWhitespace));
  }

  const inlines = (node: Node, preserveWhitespace = false): Inline[] => {
    const result = inline(node, {}, 0, preserveWhitespace);
    if (result[0]) result[0] = { ...result[0], text: result[0].text.trimStart() };
    const last = result.length - 1;
    if (result[last]) result[last] = { ...result[last], text: result[last].text.trimEnd() };
    return result.filter(item => item.text || item.equation !== undefined || item.propertyIcon || item.checkbox !== undefined);
  };
  function iconFields(node: Node | undefined, blockId?: string): IconFields {
    if (!node) return {};
    const image = find(node, child => tag(child) === 'img');
    if (!image) return { icon: text(node).trim() || undefined };
    const src = attr(image, 'src');
    const symbol = /^https:\/\/app\.notion\.com\/icons\/(bookmark|exclamation-mark)_([a-z]+)\.svg$/.exec(src ?? '');
    if (symbol && Object.hasOwn(colors, symbol[2]!)) return { iconSymbol: symbol[1] as IconFields['iconSymbol'], iconColor: colors[symbol[2]!] };
    if (src && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(src)) return { iconSrc: src };
    issue('icon-unavailable', 'Ein externes Symbol ist offline nicht verfügbar. Der Text bleibt erhalten.', blockId);
    return { icon: attr(image, 'alt') || undefined };
  }
  function bookmark(node: Node, anchor: Node): Block {
    const title = find(anchor, child => has(child, 'bookmark-title'));
    const description = find(anchor, child => has(child, 'bookmark-description'));
    const preview = find(node, child => has(child, 'bookmark-image'));
    const favicon = find(anchor, child => has(child, 'bookmark-icon'));
    const caption = find(node, child => tag(child) === 'figcaption');
    const withoutLinks = (items: Inline[]) => items.map(({ href: _href, ...item }) => item);
    return block('bookmark', node, {
      href: safeLink(attr(anchor, 'href')), content: withoutLinks(inlines(title ?? anchor)),
      description: description ? withoutLinks(inlines(description, true)) : [], preview: preview ? attr(preview, 'src') : undefined,
      iconSrc: favicon ? attr(favicon, 'src') : undefined, caption: caption ? inlines(caption) : [],
    });
  }
  const mediaTags = new Set(['iframe', 'video', 'audio', 'embed', 'object']);
  function media(node: Node, container = node): Block {
    const source = find(node, child => tag(child) === 'source' && !!safeLink(attr(child, 'src')));
    const href = safeLink(attr(node, 'src') || attr(node, 'data')) || (source ? safeLink(attr(source, 'src')) : undefined);
    const name = tag(node);
    const kind = name === 'video' || name === 'audio' ? name : attr(node, 'type') === 'application/pdf' || /\.pdf(?:[?#]|$)/i.test(href ?? '') ? 'pdf' : 'embed';
    const caption = find(container, child => tag(child) === 'figcaption');
    const preview = find(container, child => tag(child) === 'img');
    const label = attr(node, 'title') || text(node).trim() || { video: 'Video', audio: 'Audio', embed: 'Eingebetteter Inhalt', pdf: 'PDF-Dokument' }[kind];
    const result = block('unsupported', container, {
      mediaKind: kind, href, content: [{ text: label }],
      preview: attr(node, 'poster') || (preview ? attr(preview, 'src') : undefined),
      caption: caption ? inlines(caption) : [],
    });
    issue('unsupported-block', `„${name}“ wird als statische Medienkarte dargestellt; interaktive Inhalte sind im PDF nicht verfügbar.`, result.id);
    return result;
  }
  const nestedTags = new Set(['ul', 'ol', 'details', 'div', 'p', 'blockquote', 'table', 'figure', 'pre', 'h1', 'h2', 'h3', 'h4']);

  function children(node: Node, depth: number, exclude?: (node: Node) => boolean): Block[] {
    if (depth > 80) throw new Error('Die Blockstruktur ist zu tief verschachtelt.');
    const result: Block[] = [];
    let run: Node[] = [];
    const flush = () => {
      const content = run.flatMap(n => inline(n));
      if (content.some(i => i.text.trim() || i.equation !== undefined || i.checkbox !== undefined)) result.push(block('paragraph', node, { content }));
      run = [];
    };
    for (const child of nodes(node)) {
      if (exclude?.(child)) continue;
      if (child.nodeName === '#text' || ['span', 'strong', 'b', 'em', 'i', 'a', 'code', 'mark', 'br', 'u', 's', 'sub', 'sup'].includes(tag(child)) && !has(child, 'bookmark') && !has(child, 'bookmark-link')) run.push(child);
      else { flush(); result.push(...convert(child, depth + 1)); }
    }
    flush();
    return result;
  }

  function convert(node: Node, depth: number, propertyRoot = false): Block[] {
    if (depth > 80 || ++visited > 150000) throw new Error('Das Dokument überschreitet die erlaubte Komplexität.');
    if (!isElement(node)) return [];
    if (node === propertiesNode && !propertyRoot) return [];
    const name = tag(node);
    if (blocked.has(name)) { if (name === 'script') issue('active-content-removed', 'Importierter JavaScript-Code wurde nicht ausgeführt.', undefined, 'info'); return []; }
    if (node === titleNode || name === 'header' || name === 'figcaption' || has(node, 'page-header-icon') || has(node, 'page-cover') || has(node, 'page-cover-image')) return [];
    if (attr(node, 'data-notion-equation') !== undefined || has(node, 'equation') || has(node, 'katex-display')) {
      const annotation = find(node, child => tag(child) === 'annotation' && attr(child, 'encoding') === 'application/x-tex');
      const presentation = find(node, child => has(child, 'katex') || tag(child) === 'math');
      const expression = attr(node, 'data-notion-equation') ?? (annotation ? text(annotation) : !presentation ? text(node) : undefined);
      if (expression !== undefined) return [block('equation', node, { content: [{ text: expression }] })];
      const fallback = block('paragraph', node, { content: [{ text: text(node) }] });
      issue('math-source-missing', 'Eine Blockformel enthält keinen TeX-Quelltext. Die Textdarstellung muss geprüft werden.', fallback.id);
      return [fallback];
    }
    if (has(node, 'column-list')) return [block('columns', node, { children: children(node, depth) })];
    if (has(node, 'column')) {
      const width = /(?:^|;)\s*width\s*:\s*([\d.]+)%\s*(?:;|$)/i.exec(attr(node, 'style') ?? '');
      return [block('column', node, { width: width ? Math.max(1, Math.min(100, Number(width[1]))) : undefined, children: children(node, depth) })];
    }
    if (name === 'details') {
      const summary = nodes(node).find(child => tag(child) === 'summary');
      const heading = summary && find(summary, child => /^h[1-4]$/.test(tag(child)));
      const tab = has(node, 'tab-page') || attr(node, 'data-notion-tab-page') !== undefined;
      const result = block(tab ? 'tab' : 'toggle', node, { content: summary ? inlines(summary) : [{ text: tab ? 'Tab' : 'Details' }], level: heading ? Number(tag(heading).slice(1)) : undefined, children: children(node, depth, child => child === summary) });
      if (tab) issue('tab-expanded', 'Exportierter Tab wird als beschrifteter Abschnitt vollständig ausgegeben.', result.id, 'info');
      return [result];
    }
    if (/^h[1-4]$/.test(name)) return [block('heading', node, { level: Number(name.slice(1)), content: inlines(node) })];
    if (name === 'p') return [block('paragraph', node, { content: inlines(node) })];
    if (name === 'ul' || name === 'ol') {
      const listStyle = name === 'ol' && ['1', 'a', 'A', 'i', 'I'].includes(attr(node, 'type') ?? '') ? attr(node, 'type') as Block['listStyle'] : undefined;
      return [block('list', node, { ordered: name === 'ol', start: Math.max(1, Math.min(999999, Number(attr(node, 'start')) || 1)), listStyle, children: children(node, depth) })];
    }
    if (name === 'li') {
      const checkbox = nodes(node).find(child => has(child, 'checkbox') || (tag(child) === 'input' && attr(child, 'type') === 'checkbox'));
      const direct = nodes(node).filter(child => !nestedTags.has(tag(child)) && !has(child, 'checkbox') && !(tag(child) === 'input' && attr(child, 'type') === 'checkbox'));
      const nested = nodes(node).filter(child => nestedTags.has(tag(child)) && !has(child, 'checkbox'));
      return [block(checkbox ? 'task' : 'listItem', node, {
        checked: checkbox ? has(checkbox, 'checkbox-on') || attr(checkbox, 'checked') !== undefined : undefined,
        content: direct.flatMap(n => inline(n)), children: nested.flatMap(n => convert(n, depth + 1)),
      })];
    }
    if (name === 'aside' || has(node, 'callout')) {
      // Notion wraps icons in a separate div. Do not traverse that wrapper as
      // body content, or its image becomes a spurious full-size missing image.
      const iconContainer = nodes(node).find(child => has(child, 'icon') || (tag(child) === 'div' && nodes(child).filter(n => isElement(n) || text(n).trim()).every(n => has(n, 'icon'))));
      const result = block('callout', node);
      return [{ ...result, ...iconFields(iconContainer, result.id), children: children(node, depth, child => child === iconContainer) }];
    }
    if (name === 'blockquote') return [block('quote', node, { children: children(node, depth) })];
    if (name === 'hr') return [block('divider', node)];
    if (name === 'pre') {
      const code = find(node, child => tag(child) === 'code');
      const language = classes(code ?? node).find(cls => cls.startsWith('language-'))?.slice(9);
      return [block('code', node, { content: [{ text: text(code ?? node) }], language })];
    }
    if (name === 'img') return [block('image', node, { src: attr(node, 'src'), alt: attr(node, 'alt') || '' })];
    if (name === 'figure') {
      if (has(node, 'link-to-page')) {
        const anchor = find(node, child => tag(child) === 'a');
        return [block('pageLink', node, { href: anchor ? safeLink(attr(anchor, 'href')) : undefined, content: inlines(node).map(({ href: _href, ...item }) => item) })];
      }
      const bookmarkAnchor = find(node, child => tag(child) === 'a' && (has(child, 'bookmark') || has(child, 'bookmark-link') || has(node, 'bookmark')));
      if (bookmarkAnchor) return [bookmark(node, bookmarkAnchor)];
      const embedded = find(node, child => mediaTags.has(tag(child)));
      if (embedded) return [media(embedded, node)];
      const image = find(node, child => tag(child) === 'img');
      const caption = find(node, child => tag(child) === 'figcaption');
      if (image) {
        const width = /(?:^|;)\s*width\s*:\s*([\d.]+)px\s*(?:;|$)/i.exec(attr(image, 'style') ?? '');
        const align = /(?:^|;)\s*text-align\s*:\s*(left|center|right)\s*(?:;|$)/i.exec(attr(node, 'style') ?? '');
        const imageWidth = width ? Math.max(1, Math.min(10000, Number(width[1]))) : undefined;
        const constrained = hasAncestor(node, ancestor => has(ancestor, 'column') || ['td', 'th', 'aside', 'blockquote', 'li'].includes(tag(ancestor)));
        const imageWidthPercent = imageWidth && !constrained ? Math.min(100, imageWidth / notionImageWidth * 100) : undefined;
        return [block('image', node, { src: attr(image, 'src'), alt: attr(image, 'alt') || '', imageWidth, imageWidthPercent, imageAlign: align?.[1]?.toLowerCase() as Block['imageAlign'], caption: caption ? inlines(caption) : [] })];
      }
      const anchor = find(node, child => tag(child) === 'a');
      if (anchor) return [block('file', node, { href: safeLink(attr(anchor, 'href')), content: inlines(anchor).map(({ href: _href, ...item }) => item), caption: caption ? inlines(caption) : [] })];
      // Some Notion exports wrap a pasted URL in a figure/source container but
      // omit the anchor altogether. Recover only a complete, absolute URL from
      // that specific structure so ordinary prose is never auto-linked.
      const source = find(node, child => has(child, 'source'));
      const sourceText = source ? text(source).trim() : '';
      const sourceHref = /^(?:https?:\/\/|mailto:)[^\s]+$/i.test(sourceText) ? safeLink(sourceText) : undefined;
      if (sourceHref) {
        const result = block('paragraph', node, { content: [{ text: sourceText, href: sourceHref }] });
        issue('bare-link-recovered', 'Eine rohe URL in einem Notion-Linkblock wurde als normaler Link wiederhergestellt.', result.id, 'info');
        return [result];
      }
      return children(node, depth);
    }
    if (name === 'table') {
      const rows = children(node, depth);
      const hasTitle = (cell: Block): boolean => cell.content.some(item => item.propertyIcon === 'title') || cell.children.some(hasTitle);
      const titleColumn = rows[0]?.children.findIndex(hasTitle) ?? -1;
      return [block('table', node, { children: rows, keyColumn: Math.max(0, titleColumn) })];
    }
    if (name === 'tr') return [block('tableRow', node, { children: children(node, depth) })];
    if (name === 'td' || name === 'th') {
      const structured = nodes(node).some(child => !!find(child, n => ['p', 'ul', 'ol', 'details', 'figure', 'pre', 'table', 'blockquote'].includes(tag(n))));
      return [block('tableCell', node, {
      header: name === 'th', content: structured ? [] : inlines(node), children: structured ? children(node, depth) : [],
      colspan: Math.max(1, Math.min(100, Number(attr(node, 'colspan')) || 1)),
      rowspan: Math.max(1, Math.min(100, Number(attr(node, 'rowspan')) || 1)),
      })];
    }
    if (name === 'a' && (has(node, 'bookmark') || has(node, 'bookmark-link'))) return [bookmark(node, node)];
    if (mediaTags.has(name)) return [media(node)];
    if (['button', 'form', 'svg', 'canvas'].includes(name)) {
      const result = block('unsupported', node, { content: [{ text: text(node).trim() || `Interaktives Element: ${name}` }], href: safeLink(attr(node, 'src') || attr(node, 'data')) });
      issue('unsupported-block', `„${name}“ wird als statischer Hinweis dargestellt.`, result.id);
      return [result];
    }
    if (['div', 'section', 'article', 'main', 'body', 'tbody', 'thead', 'tfoot', 'nav', 'summary', 'dl', 'dt', 'dd'].includes(name)) return children(node, depth);
    if (['input', 'source', 'wbr', 'col', 'colgroup'].includes(name)) return [];
    const result = block('unsupported', node, { content: inlines(node) });
    issue('unknown-element', `Unbekanntes HTML-Element „${name}“: Text wird als Ersatz übernommen.`, result.id);
    return [result];
  }

  const header = nodes(article ?? body).find(node => tag(node) === 'header');
  const icon = find(article ?? body, node => has(node, 'page-header-icon')) ?? (header ? find(header, node => has(node, 'page-icon')) : undefined);
  const cover = find(article ?? body, node => has(node, 'page-cover') || has(node, 'page-cover-image'));
  const blocks = children(contentRoot, 0);
  const properties = propertiesNode ? convert(propertiesNode, 0, true) : [];
  const font = has(article ?? body, 'serif') || has(body, 'serif') ? 'serif' : has(article ?? body, 'mono') || has(body, 'mono') ? 'mono' : 'sans';
  return { id, title, sourcePath, blocks, properties, ...iconFields(icon), cover: cover ? attr(cover, 'src') : undefined, font, issues };
}
