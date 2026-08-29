import { describe, expect, it } from 'vitest';
import { parseNotionHtml } from '../src/importers/html';
import { renderDocument } from '../src/layout/render';
import { defaultOptions, optionsSchema, presetOptions } from '../src/domain/options';
import type { Snapshot } from '../src/domain/model';

function setup() {
  const page = parseNotionHtml('<article id="page"><h1 class="page-title">Document</h1><div class="page-body"><div class="column-list"><div class="column" style="width:60%"><details><summary>Title</summary><p>Hidden content</p></details></div><div class="column" style="width:40%"><ul><li><span class="checkbox checkbox-on"></span>Finished</li><li><span class="checkbox checkbox-off"></span>Open</li></ul></div></div></div></article>', 'doc.html');
  const snapshot: Snapshot = { version: 1, id: 'snapshot', importedAt: '', name: 'test', pages: [page], assets: {}, issues: [] };
  return { page, snapshot };
}

describe('print transformations', () => {
  it('expands all toggles and retains column widths', () => {
    const { page, snapshot } = setup();
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('Hidden content');
    expect(html).not.toContain('<details');
    expect(html).toContain('minmax(0,60fr) minmax(0,40fr)');
    expect(html).toContain('checkbox checked');
  });
  it('renders Notion page fonts and ordered-list marker formats', () => {
    const page = parseNotionHtml('<body class="mono"><article><ol type="a" start="3"><li>Third letter</li></ol></article></body>', 'styled.html');
    const snapshot: Snapshot = { version: 1, id: 'snapshot', importedAt: '', name: 'test', pages: [page], assets: {}, issues: [] };
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('notion-font-mono');
    expect(html).toContain('start="3" type="a"');
  });
  it('converts checklists into ordinary unstruck lists without modifying the source', () => {
    const { page, snapshot } = setup();
    const before = JSON.stringify(snapshot);
    const { html } = renderDocument(snapshot, page, presetOptions('reading'), '');
    expect(html).toContain('toggle-section');
    expect(html).not.toContain('toggle-marker');
    expect(html).not.toContain('class="checkbox');
    expect(html).not.toContain('task-done');
    expect(JSON.stringify(snapshot)).toBe(before);
  });
  it('separates list labels and callout bodies so nested blocks retain their own spacing', () => {
    const page = parseNotionHtml('<article><ul><li>Label<p>Details</p><ul><li>Child</li></ul></li></ul><aside><h2>Notice</h2><ul><li>Item</li></ul></aside><details><summary><h2>Section</h2></summary><p>Body</p></details></article>', 'spacing.html');
    const snapshot: Snapshot = { version: 1, id: 'snapshot', importedAt: '', name: 'test', pages: [page], assets: {}, issues: [] };
    const { html } = renderDocument(snapshot, page, presetOptions('reading'), '');
    expect(html).toContain('<span class="list-item-label">Label</span><p');
    expect(html).toContain('<div class="callout-content"><h2');
    expect(html).toContain('class="toggle toggle-section toggle-heading"');
  });
  it('can explicitly retain task status in bullets and defaults checkbox mode to retained status', () => {
    const { page, snapshot } = setup();
    expect(optionsSchema.parse({ tasks: 'bullets' }).preserveTaskStatus).toBe(false);
    expect(optionsSchema.parse({ tasks: 'checkboxes' }).preserveTaskStatus).toBe(true);
    const { html } = renderDocument(snapshot, page, { ...presetOptions('reading'), preserveTaskStatus: true }, '');
    expect(html).toContain('task-done'); expect(html).not.toContain('class="checkbox');
  });
  it('records deliberate information removal', () => {
    const { page, snapshot } = setup();
    const { html, issues } = renderDocument(snapshot, page, { ...presetOptions('reading'), preserveTaskStatus: false }, '');
    expect(html).not.toContain('task-done');
    expect(issues.map(issue => issue.code)).toContain('task-status-removed');
  });
  it('stacks columns only when requested and keeps both contents', () => {
    const { page, snapshot } = setup();
    const { html } = renderDocument(snapshot, page, { ...defaultOptions, columns: 'stack' }, '');
    expect(html).toContain('columns stacked');
    expect(html).toContain('Hidden content');
    expect(html).toContain('Finished');
  });
  it('escapes titles and code and sets a restrictive document policy', () => {
    const { page, snapshot } = setup();
    page.title = '<script>alert(1)</script>';
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain("default-src 'none'");
  });
  it('keeps cover, filled page icon and title in one header', () => {
    const { snapshot, page } = setup();
    page.cover = 'cover'; page.iconSymbol = 'bookmark'; page.iconColor = '#c14c8a';
    snapshot.assets.cover = { id: 'cover', mime: 'image/png', dataUrl: 'data:image/png;base64,AA==' };
    const { html } = renderDocument(snapshot, page, presetOptions('reading'), '');
    const header = html.match(/<header[^>]*>(.*?)<\/header>/)![1]!;
    expect(html).toContain('class="document-header with-cover with-icon"');
    expect(header.indexOf('class="page-cover"')).toBeLessThan(header.indexOf('class="page-icon"'));
    expect(header.indexOf('class="page-icon"')).toBeLessThan(header.indexOf('class="document-title"'));
    expect(header).toContain('fill="#c14c8a"');
    expect(header).not.toContain('stroke=');
  });
  it('does not apply icon overlap when the cover is disabled, missing or suppressed for print', () => {
    const { snapshot, page } = setup();
    page.cover = 'cover'; page.icon = '📖';
    snapshot.assets.cover = { id: 'cover', mime: 'image/png', dataUrl: 'data:image/png;base64,AA==' };
    for (const options of [{ ...defaultOptions, includeCover: false }, presetOptions('print')]) {
      const { html } = renderDocument(snapshot, page, options, '');
      expect(html).not.toContain('with-cover'); expect(html).not.toContain('class="page-cover"');
      expect(html).toContain('class="page-icon">📖');
    }
    delete snapshot.assets.cover;
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).not.toContain('with-cover'); expect(html).not.toContain('missing-media');
  });
  it('does not invent a page icon when a cover has no icon', () => {
    const { snapshot, page } = setup();
    page.cover = 'cover';
    snapshot.assets.cover = { id: 'cover', mime: 'image/png', dataUrl: 'data:image/png;base64,AA==' };
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('class="document-header with-cover"');
    expect(html).not.toContain('class="page-icon"');
  });
  it('reports invalid equations instead of dropping the original expression', () => {
    const { page, snapshot } = setup();
    page.blocks = [{ type: 'equation', id: 'eq', content: [{ text: '\\notACommand{x}' }], children: [] }];
    const { html, issues } = renderDocument(snapshot, page, defaultOptions, '');
    expect(issues[0]?.code).toBe('equation-fallback');
    expect(html).toContain('notACommand');
  });
  it('validates all user settings at the process boundary', () => {
    expect(() => optionsSchema.parse({ margin: -1 })).toThrow();
    expect(() => optionsSchema.parse({ fontSize: 0 })).toThrow();
    expect(() => optionsSchema.parse({ arbitraryScript: 'evil' })).toThrow();
    expect(optionsSchema.parse({}).paper).toBe('A4');
  });
  it('splits wide tables, repeats the key column, and preserves every cell without duplicate IDs', () => {
    const { snapshot } = setup();
    const row = (tag: string, prefix: string) => `<tr>${Array.from({ length: 13 }, (_, i) => `<${tag} id="${prefix}${i}">${prefix}${i}</${tag}>`).join('')}</tr>`;
    const page = parseNotionHtml(`<article><h1 class="page-title">Table</h1><table>${row('th', 'Header')}${row('td', 'Cell')}</table></article>`, 'wide.html');
    const before = JSON.stringify(page);
    const { html, issues } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html.match(/<table>/g)).toHaveLength(3);
    expect(html.match(/>Cell0</g)).toHaveLength(3);
    for (let i = 1; i < 13; i++) expect(html.match(new RegExp(`>Cell${i}<`, 'g'))).toHaveLength(1);
    const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(issues.some(issue => issue.code === 'table-split' && issue.severity === 'info')).toBe(true);
    expect(JSON.stringify(page)).toBe(before);
  });
  it('warns rather than silently making a wide spanning table unreadable', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><table><tr><th colspan="15">Wide merged heading</th></tr></table></article>', 'wide.html');
    const { html, issues } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('Wide merged heading');
    expect(issues.some(issue => issue.code === 'wide-table')).toBe(true);
  });
  it('reserves space for long headers when splitting tables with short numeric values', () => {
    const { snapshot } = setup();
    const titles = ['Szenenüberschrift', 'Wahrscheinlichkeit', 'Abgeschlossenheit', 'Kontextbedarf', 'Interpretierbarkeit', 'Repräsentativität', 'Wiedererkennung'];
    const page = parseNotionHtml(`<article><table><tr>${titles.map(t => `<th>${t}</th>`).join('')}</tr><tr>${titles.map(() => '<td>1</td>').join('')}</tr></table></article>`, 'headers.html');
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    const parts = [...html.matchAll(/<colgroup>(.*?)<\/colgroup>/g)].map(match => [...match[1]!.matchAll(/width:([\d.]+)%/g)].map(value => Number(value[1])));
    expect(parts.length).toBeGreaterThanOrEqual(2);
    for (const widths of parts) expect(Math.min(...widths)).toBeGreaterThan(19);
    for (const title of titles) expect(html).toContain(title);
    const cells = page.blocks[0]!.children[1]!.children;
    cells[2]!.content = [{ text: 'A longer explanation that needs space for readable sentences. '.repeat(3) }];
    const withProse = renderDocument(snapshot, page, defaultOptions, '').html;
    const first = /<colgroup>(.*?)<\/colgroup>/.exec(withProse)![1]!;
    const widths = [...first.matchAll(/width:([\d.]+)%/g)].map(value => Number(value[1]));
    expect(widths[2]).toBeGreaterThan(widths[1]!);
    cells[2]!.children = [{ id: 'nested-prose', type: 'paragraph', content: cells[2]!.content, children: [] }];
    cells[2]!.content = [];
    const nested = renderDocument(snapshot, page, defaultOptions, '').html;
    const nestedWidths = [.../<colgroup>(.*?)<\/colgroup>/.exec(nested)![1]!.matchAll(/width:([\d.]+)%/g)].map(value => Number(value[1]));
    expect(nestedWidths[2]).toBeGreaterThan(nestedWidths[1]!);
  });
  it('prints database properties as key/value rows, not a repeating first-row header', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><header><h1 class="page-title">Record</h1><table class="properties"><tr><th>Status</th><td>Ready</td></tr><tr><th>Priority</th><td>High</td></tr></table></header><div class="page-body"></div></article>', 'record.html');
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('Eigenschaften'); expect(html).toContain('Ready');
    expect(html).not.toContain('<thead>');
  });
  it('trims trailing editor paragraphs while preserving gaps within content', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><div class="page-body"><p>First</p><p id="gap"></p><p>Last</p><p id="trailing"></p></div></article>', 'spacing.html');
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('id="gap"'); expect(html).not.toContain('id="trailing"');
    expect(page.blocks).toHaveLength(4);
  });
  it('renders callouts without invented arrows and page links without oversized cards or nested anchors', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><aside><div><p>No icon</p></div></aside><aside><div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div><div>Notice</div></aside><figure class="link-to-page"><a href="https://example.com/page">Page</a></figure><figure><a class="bookmark" href="https://example.com/lesson"><div class="bookmark-title">Lesson</div><div class="bookmark-description">Detailed lesson description</div><img class="bookmark-image" src="https://example.com/preview.jpg"></a></figure></article>', 'cards.html');
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).not.toContain('↗'); expect(html).not.toContain('missing-media');
    expect(html).toContain('class="page-link"'); expect(html).not.toContain('>LINK<');
    expect(html).toContain('Detailed lesson description');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html.match(/class="callout-icon"/g)).toHaveLength(1);
  });
  it('makes bookmark cards clickable without nested anchors and preserves local decoration and caption links', () => {
    const { snapshot } = setup();
    snapshot.assets.local = { id: 'local', mime: 'image/png', dataUrl: 'data:image/png;base64,AA==' };
    const page = parseNotionHtml('<article><figure><a class="bookmark" href="https://example.com"><div class="bookmark-title">Title</div><div class="bookmark-description">Full description</div><img class="bookmark-icon" src="local"><img class="bookmark-image" src="local"></a><figcaption><a href="https://example.org">Caption</a></figcaption></figure></article>', 'cards.html');
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('class="bookmark-card has-preview"');
    expect(html.match(/src="data:image\/png/g)).toHaveLength(2);
    expect(html).toContain('Full description');
    expect(html).toContain('</a><div class="bookmark-caption"><a href="https://example.org/">Caption</a>');
    const compact = renderDocument(snapshot, page, { ...defaultOptions, bookmarks: 'compact' }, '');
    expect(compact.html).toContain('class="bookmark-compact"'); expect(compact.html).not.toContain('Full description');
    expect(compact.html).toContain('Caption'); expect(compact.html).not.toContain('data:image');
    expect(compact.issues.map(issue => issue.code)).toContain('bookmark-compacted');
  });
  it('renders file attachments as compact unboxed rows without invented labels', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><figure><div class="source"><a href="https://example.com/notes.pdf">notes.pdf</a></div></figure></article>', 'files.html');
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('class="file-attachment"');
    expect(html).toContain('M10 16V9m-3 3 3-3 3 3');
    expect(html).toContain('href="https://example.com/notes.pdf"');
    expect(html).not.toContain('ANHANG'); expect(html).not.toContain('file-attachment-kind');
  });
  it('renders static media as labelled cards and never emits executable players', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><video title="Lecture"><source src="https://example.com/video.mp4"></video><iframe title="Widget" src="https://example.com"></iframe></article>', 'media.html');
    const { html, issues } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('VIDEO'); expect(html).toContain('Lecture'); expect(html).toContain('Original öffnen');
    expect(html).not.toContain('<video'); expect(html).not.toContain('<iframe');
    expect(issues.filter(issue => issue.code === 'unsupported-block')).toHaveLength(2);
  });
  it('prints tabs as named sections even when ordinary toggles retain their triangle', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><details class="tab-page"><summary>First tab</summary><p>Panel content</p></details></article>', 'tabs.html');
    const { html } = renderDocument(snapshot, page, defaultOptions, '');
    expect(html).toContain('class="tab-title">First tab'); expect(html).toContain('Panel content');
    expect(html).not.toContain('toggle-marker');
  });
  it('sets inline and display math once, preserving scripts, task status choices and explicit strikethrough', () => {
    const { snapshot } = setup();
    const page = parseNotionHtml('<article><p>Inline <span data-notion-inline-equation="x^2+1">wrong</span> then H<sub>2</sub>O.</p><div data-notion-equation="\\begin{pmatrix}1&amp;2\\\\3&amp;4\\end{pmatrix}"></div><ul><li><input type="checkbox" checked><s>Explicit deletion</s></li></ul></article>', 'math.html');
    const { html, issues } = renderDocument(snapshot, page, { ...presetOptions('reading'), preserveTaskStatus: false }, '');
    expect(html.match(/class="katex"/g)).toHaveLength(2);
    expect(html.match(/class="katex-display"/g)).toHaveLength(1);
    expect(html).toContain('<sub>2</sub>'); expect(html).toContain('<s>Explicit deletion</s>');
    expect(html).not.toContain('task-done'); expect(html).not.toContain('wrong');
    expect(issues.filter(issue => issue.severity !== 'info')).toEqual([]);
  });
});
