import { describe, expect, it, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseNotionHtml, safeLink } from '../src/importers/html';
import { importNotion, imageMime, isHeic } from '../src/importers';
import { limits, safeArchivePath, within } from '../src/importers/files';
import { hasBodyContent, type Block } from '../src/domain/model';
import { zip } from './helpers/zip';

const html = (content: string) => `<!doctype html><html><head><title>Test</title></head><body><article id="page"><header><h1 class="page-title">Test</h1></header><div class="page-body">${content}</div></article></body></html>`;
const flatten = (blocks: Block[]): Block[] => blocks.flatMap(block => [block, ...flatten(block.children)]);
const temporary: string[] = [];
afterEach(async () => { await Promise.all(temporary.splice(0).map(dir => rm(dir, { recursive: true, force: true }))); });
async function dir() { const value = await mkdtemp(path.join(os.tmpdir(), 'notion-pdf-test-')); temporary.push(value); return value; }

describe('Notion HTML semantics', () => {
  it('keeps unequal columns and all their contents', () => {
    const page = parseNotionHtml(html('<div class="column-list"><div class="column" style="width:62.5%"><p>Left</p></div><div class="column" style="width:37.5%"><p>Right</p></div></div>'), 'page.html');
    expect(page.blocks[0]?.type).toBe('columns');
    expect(page.blocks[0]?.children.map(col => col.width)).toEqual([62.5, 37.5]);
    expect(flatten(page.blocks).filter(block => block.type === 'paragraph').map(block => block.content[0]?.text)).toEqual(['Left', 'Right']);
  });
  it('retains closed toggle content and heading semantics', () => {
    const page = parseNotionHtml(html('<details><summary><h2>Heading</h2></summary><p>Hidden text</p><details><summary>Nested</summary><p>Deeper</p></details></details>'), 'page.html');
    expect(page.blocks[0]).toMatchObject({ type: 'toggle', level: 2, content: [{ text: 'Heading' }] });
    expect(flatten(page.blocks).filter(block => block.type === 'paragraph').map(block => block.content[0]?.text)).toEqual(['Hidden text', 'Deeper']);
  });
  it('keeps Notion task state and nested content without misclassifying parent lists', () => {
    const page = parseNotionHtml(html('<ul><li>Parent<ul class="to-do-list"><li><input type="checkbox" checked><span class="checkbox checkbox-on"></span>Done</li><li><span class="checkbox checkbox-off"></span>Open<div class="indented"><p>Notes</p></div></li></ul></li></ul>'), 'page.html');
    const blocks = flatten(page.blocks);
    expect(blocks.find(block => block.type === 'listItem')?.content[0]?.text).toBe('Parent');
    expect(blocks.filter(block => block.type === 'task').map(block => block.checked)).toEqual([true, false]);
    expect(blocks.some(block => block.content.some(item => item.text === 'Notes'))).toBe(true);
  });
  it('preserves formatting, line breaks, Unicode and numbered list starts', () => {
    const page = parseNotionHtml(html('<p>Über <strong>Größe</strong><br><em>café</em> <mark class="highlight-blue_background">text</mark></p><ol start="7"><li>Seven</li></ol>'), 'page.html');
    expect(page.blocks[0]?.content.some(item => item.bold && item.text === 'Größe')).toBe(true);
    expect(page.blocks[0]?.content.some(item => item.text === '\n')).toBe(true);
    expect(page.blocks[1]?.start).toBe(7);
  });
  it('preserves every exported text palette alias, telephone links, list formats and page fonts', () => {
    const page = parseNotionHtml('<body><article class="serif"><h1 class="page-title">Styled</h1><div class="page-body"><p><mark class="highlight-teal_background">Green alias</mark> <a href="tel:+491234567">Call</a></p><ol type="I" start="4"><li>Fourth</li></ol></div></article></body>', 'styled.html');
    expect(page.font).toBe('serif');
    expect(page.blocks[0]?.content).toEqual(expect.arrayContaining([
      expect.objectContaining({ text: 'Green alias', background: '#e7f1e9' }),
      expect.objectContaining({ text: 'Call', href: 'tel:+491234567' }),
    ]));
    expect(page.blocks[1]).toMatchObject({ type: 'list', ordered: true, start: 4, listStyle: 'I' });
  });
  it('does not lose bookmark text when the card contains a preview image', () => {
    const page = parseNotionHtml(html('<figure class="bookmark"><a href="https://example.com"><div>Important title</div><img src="https://example.com/preview.png"></a></figure>'), 'page.html');
    expect(page.blocks[0]?.type).toBe('bookmark');
    expect(page.blocks[0]?.content.some(item => item.text.includes('Important title'))).toBe(true);
  });
  it('recovers equations from KaTeX annotations without duplicating visual markup', () => {
    const page = parseNotionHtml(html('<p><span class="katex"><span>visual</span><annotation encoding="application/x-tex">x^2</annotation></span></p>'), 'page.html');
    expect(page.blocks[0]?.content).toEqual([{ text: 'x^2', equation: 'x^2' }]);
  });
  it('recognizes bookmarks marked on the nested anchor before preview images', () => {
    const page = parseNotionHtml(html('<figure><a class="bookmark source" href="https://example.com/lesson"><div class="bookmark-info"><div class="bookmark-title">Lesson title</div><div class="bookmark-description">Complete description</div><div class="bookmark-href"><img class="bookmark-icon" src="https://example.com/icon.svg">example.com</div></div><img class="bookmark-image" src="https://example.com/preview.jpg"></a></figure><a class="bookmark" href="https://example.com/other"><div class="bookmark-title">Other</div></a>'), 'page.html');
    expect(page.blocks.map(block => block.type)).toEqual(['bookmark', 'bookmark']);
    expect(page.blocks[0]).toMatchObject({ content: [{ text: 'Lesson title' }], description: [{ text: 'Complete description' }], preview: 'https://example.com/preview.jpg', href: 'https://example.com/lesson' });
    expect(page.issues).toEqual([]);
  });
  it('recovers a naked URL from a Notion source figure without auto-linking prose', () => {
    const url = 'https://drive.google.com/file/d/example/view?usp=sharing';
    const page = parseNotionHtml(html(`<figure><div class="source">${url}</div></figure><figure><div class="source">See ${url}</div></figure><figure><div class="source">javascript:alert(1)</div></figure>`), 'links.html');
    expect(page.blocks[0]).toMatchObject({ type: 'paragraph', content: [{ text: url, href: url }] });
    expect(page.blocks[1]?.content).toEqual([{ text: `See ${url}` }]);
    expect(page.blocks[2]?.content).toEqual([{ text: 'javascript:alert(1)' }]);
    expect(page.issues).toEqual([expect.objectContaining({ code: 'bare-link-recovered', severity: 'info' })]);
  });
  it('separates page links from bookmarks and callout icons from their body', () => {
    const page = parseNotionHtml(html('<figure class="link-to-page"><a href="child.html">Child page</a></figure><aside><div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div><div><p>Notice text</p><img src="actual-content.png"></div></aside><aside><div><p>No icon here</p></div></aside><aside><div><span class="icon">💡</span></div><div>Emoji notice</div></aside>'), 'page.html');
    expect(page.blocks[0]).toMatchObject({ type: 'pageLink', content: [{ text: 'Child page' }] });
    expect(page.blocks[1]).toMatchObject({ type: 'callout', iconSymbol: 'exclamation-mark' });
    expect(flatten(page.blocks).filter(block => block.type === 'image').map(block => block.src)).toEqual(['actual-content.png']);
    expect(page.blocks[2]?.icon).toBeUndefined();
    expect(page.blocks[3]?.icon).toBe('💡');
    expect(page.issues).toEqual([]);
  });
  it('keeps line breaks in bookmark descriptions instead of flattening source paragraphs', () => {
    const page = parseNotionHtml(html('<figure><a class="bookmark" href="https://example.com"><div class="bookmark-title">Title</div><div class="bookmark-description">First paragraph\n\nSecond paragraph</div></a></figure>'), 'page.html');
    expect(page.blocks[0]?.description).toEqual([{ text: 'First paragraph\n\nSecond paragraph' }]);
  });
  it('preserves bookmark captions and favicon references', () => {
    const page = parseNotionHtml(html('<figure><a class="bookmark" href="https://example.com"><div class="bookmark-title">Title</div><img class="bookmark-icon" src="icon.png"></a><figcaption>My <em>caption</em></figcaption></figure>'), 'page.html');
    expect(page.blocks[0]?.iconSrc).toBe('icon.png');
    expect(page.blocks[0]?.caption?.some(item => item.italic && item.text === 'caption')).toBe(true);
  });
  it('retains media titles, nested sources, posters and figure captions as static fallbacks', () => {
    const page = parseNotionHtml(html('<figure><video title="A lesson" poster="poster.png"><source src="https://example.com/lesson.mp4"></video><figcaption>Transcript available</figcaption></figure><audio><source src="javascript:evil()"><source src="https://example.com/lecture.mp3"></audio><iframe title="Interactive model" src="https://example.com/model"></iframe>'), 'media.html');
    expect(page.blocks.map(block => block.mediaKind)).toEqual(['video', 'audio', 'embed']);
    expect(page.blocks[0]).toMatchObject({ href: 'https://example.com/lesson.mp4', preview: 'poster.png', content: [{ text: 'A lesson' }], caption: [{ text: 'Transcript available' }] });
    expect(page.blocks[1]?.href).toBe('https://example.com/lecture.mp3');
    expect(page.blocks[2]?.content[0]?.text).toBe('Interactive model');
    expect(page.issues).toHaveLength(3);
    expect(JSON.stringify(page)).not.toContain('evil()');
  });
  it('distinguishes exported tabs from toggles and preserves every supplied tab', () => {
    const page = parseNotionHtml(html('<details class="tab-page" data-notion-tab-page><summary>One</summary><p>First panel</p></details><details class="tab-page"><summary>Two</summary><p>Second panel</p></details>'), 'tabs.html');
    expect(page.blocks.map(block => block.type)).toEqual(['tab', 'tab']);
    expect(flatten(page.blocks).map(block => block.content.map(i => i.text).join(''))).toEqual(['One', 'First panel', 'Two', 'Second panel']);
    expect(page.issues.every(issue => issue.code === 'tab-expanded' && issue.severity === 'info')).toBe(true);
  });
  it('preserves structured table cells instead of flattening lists, paragraphs and images', () => {
    const page = parseNotionHtml(html('<table><tr><td><p>First</p><p>Second</p><ul><li>List</li></ul><figure><img src="plot.png"></figure></td><td>Plain</td></tr></table>'), 'table.html');
    expect(page.blocks[0]?.children[0]?.children[0]?.children.map(block => block.type)).toEqual(['paragraph', 'paragraph', 'list', 'image']);
    expect(page.blocks[0]?.children[0]?.children[1]?.content).toEqual([{ text: 'Plain' }]);
  });
  it('recognizes direct page icons without confusing content icons with page icons', () => {
    const page = parseNotionHtml('<article><header><img class="page-icon" src="https://app.notion.com/icons/bookmark_pink.svg"><h1 class="page-title">Title</h1></header><aside><span class="icon">💡</span>Note</aside></article>', 'page.html');
    expect(page.iconSymbol).toBe('bookmark');
    expect(page.blocks[0]?.icon).toBe('💡');
  });
  it('preserves image widths and alignment without accepting arbitrary source styles', () => {
    const page = parseNotionHtml(html('<figure style="text-align:right"><img style="width:336px;background:url(https://example.com/track)" src="image.png"><figcaption>Caption</figcaption></figure>'), 'page.html');
    expect(page.blocks[0]).toMatchObject({ imageWidth: 336, imageWidthPercent: expect.closeTo(47.3239, 3), imageAlign: 'right', caption: [{ text: 'Caption' }] });
    expect(JSON.stringify(page.blocks)).not.toContain('track');
  });
  it('maps Notion editor image widths to the available PDF width but respects constrained containers', () => {
    const page = parseNotionHtml(html('<figure><img style="width:710px" src="full.png"></figure><figure><img style="width:355px" src="half.png"></figure><div class="column-list"><div class="column" style="width:50%"><figure><img style="width:336px" src="column.png"></figure></div></div>'), 'images.html');
    expect(page.blocks[0]).toMatchObject({ imageWidth: 710, imageWidthPercent: 100 });
    expect(page.blocks[1]).toMatchObject({ imageWidth: 355, imageWidthPercent: 50 });
    expect(page.blocks[2]?.children[0]?.children[0]).toMatchObject({ imageWidth: 336, imageWidthPercent: undefined });
  });
  it('keeps scientific scripts, property checkboxes and block equation attributes on paragraphs', () => {
    const page = parseNotionHtml(html('<p>H<sub>2</sub>O and x<sup>2</sup></p><table><tr><td><input type="checkbox" checked></td><td><span class="checkbox checkbox-off"></span></td></tr></table><p data-notion-equation="\\frac{a}{b}">presentation</p>'), 'page.html');
    expect(page.blocks[0]?.content.filter(item => item.script).map(item => item.script)).toEqual(['sub', 'sup']);
    expect(page.blocks[1]?.children[0]?.children.map(cell => cell.content[0]?.checkbox)).toEqual([true, false]);
    expect(page.blocks[2]).toMatchObject({ type: 'equation', content: [{ text: '\\frac{a}{b}' }] });
  });
  it('reads Notion equation attributes before flattened presentation glyphs', () => {
    const page = parseNotionHtml(html('<p><span data-notion-inline-equation="\\det(A)\\neq 0"><span class="katex">wrong visual text</span></span></p><figure class="equation" data-notion-equation="x^2 + y^2"><span>wrong visual text</span></figure>'), 'page.html');
    expect(page.blocks[0]?.content).toEqual([{ text: '\\det(A)\\neq 0', equation: '\\det(A)\\neq 0' }]);
    expect(page.blocks[1]).toMatchObject({ type: 'equation', content: [{ text: 'x^2 + y^2' }] });
    expect(page.issues).toEqual([]);
  });
  it('preserves database properties independently from an empty page body', () => {
    const page = parseNotionHtml('<article><header><h1 class="page-title">Record</h1><table class="properties"><tr><th>Status</th><td>Ready</td></tr></table></header><div class="page-body"><p></p></div></article>', 'record.html');
    expect(hasBodyContent(page)).toBe(false);
    expect(page.properties?.[0]?.children[0]?.children[1]?.content[0]?.text).toBe('Ready');
  });
  it('keeps table header and spanning cell information', () => {
    const page = parseNotionHtml(html('<table><thead><tr><th colspan="2">Head</th></tr></thead><tbody><tr><td>A</td><td>B</td></tr></tbody></table>'), 'page.html');
    const cells = flatten(page.blocks).filter(block => block.type === 'tableCell');
    expect(cells[0]).toMatchObject({ header: true, colspan: 2 });
    expect(cells.map(cell => cell.content[0]?.text)).toEqual(['Head', 'A', 'B']);
  });
  it('recognizes a Notion database title column and renders property icons offline', () => {
    const page = parseNotionHtml(html('<table><tr><th>Score</th><th><img src="https://app.notion.com/icons/font_gray.svg">Title</th><th><img src="https://app.notion.com/icons/description_gray.svg">Notes</th></tr><tr><td>100</td><td>Document</td><td>Text</td></tr></table>'), 'page.html');
    expect(page.blocks[0]?.keyColumn).toBe(1);
    expect(page.blocks[0]?.children[0]?.children[1]?.content[0]?.propertyIcon).toBe('title');
    expect(page.issues).toEqual([]);
  });
  it('reports unsupported content and discards executable source', () => {
    const page = parseNotionHtml(html('<script>steal()</script><iframe src="https://example.com">Widget</iframe><p onclick="steal()"><a href="javascript:steal()">Link</a></p>'), 'page.html');
    expect(page.issues.map(issue => issue.code)).toEqual(expect.arrayContaining(['active-content-removed', 'unsupported-block', 'unsafe-link']));
    expect(JSON.stringify(page.blocks)).not.toContain('steal()');
    expect(page.blocks[0]?.content[0]?.text).toBe('Widget');
  });
  it('does not treat inherited object keys as valid color names', () => {
    const page = parseNotionHtml(html('<p class="block-color-constructor"><span class="highlight-constructor_background">Safe text</span></p>'), 'page.html');
    expect(page.blocks[0]?.color).toBeUndefined();
    expect(page.blocks[0]?.content[0]?.background).toBeUndefined();
  });
});

describe('untrusted files and links', () => {
  it.each(['../outside', '/etc/passwd', 'C:/secret', 'a\\b', 'a/../../b', 'a//b', 'a\0b', 'CON.txt', 'a./b'])('rejects unsafe archive path %s', value => expect(() => safeArchivePath(value)).toThrow());
  it('accepts portable Unicode archive names', () => expect(safeArchivePath('Übersicht/Seite 01.html')).toBe('Übersicht/Seite 01.html'));
  it('uses path boundaries rather than a prefix match', () => {
    expect(within('/tmp/root', '/tmp/root/page')).toBe(true);
    expect(within('/tmp/root', '/tmp/root-evil/file')).toBe(false);
    expect(within('/tmp/root', '/tmp/outside')).toBe(false);
  });
  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'data:text/html,bad', '//example.com', 'https://user:pass@example.com', 'https:\n//example.com'])('removes unsafe URL %s', value => expect(safeLink(value)).toBeUndefined());
  it('preserves safe and internal links', () => {
    expect(safeLink('https://example.com')).toBe('https://example.com/');
    expect(safeLink('#part')).toBe('#part');
    expect(safeLink('Sibling%20page.html')).toBe('Sibling%20page.html');
  });
  it('detects raster image signatures and refuses SVG', () => {
    expect(imageMime(Buffer.from([137,80,78,71,13,10,26,10]))).toBe('image/png');
    expect(imageMime(Buffer.from('<svg onload="alert(1)"></svg>'))).toBeUndefined();
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmif1'), Buffer.alloc(4), Buffer.from('heicmif1')]);
    expect(isHeic(heic)).toBe(true);
  });
  it('keeps source files unchanged and reports missing and external images', async () => {
    const root = await dir();
    const file = path.join(root, 'page.html');
    const original = html('<img src="missing.png"><img src="https://example.com/x.png"><p>Keep this</p>');
    await writeFile(file, original);
    const snapshot = await importNotion(file);
    expect(await readFile(file, 'utf8')).toBe(original);
    expect(snapshot.issues.map(issue => issue.code)).toEqual(['missing-image', 'external-image']);
  });
  it('does not read an image outside the chosen directory', async () => {
    const root = await dir();
    await mkdir(path.join(root, 'inside'));
    await writeFile(path.join(root, 'secret.png'), Buffer.from([137,80,78,71,13,10,26,10]));
    const file = path.join(root, 'inside/page.html');
    await writeFile(file, html('<img src="../secret.png">'));
    const snapshot = await importNotion(file);
    expect(Object.keys(snapshot.assets)).toHaveLength(0);
    expect(snapshot.issues).toEqual([expect.objectContaining({ code: 'unsafe-image-reference' })]);
  });
  it('distinguishes unsupported, oversized and corrupt HEIC images', async () => {
    const root = await dir();
    const file = path.join(root, 'page.html');
    await writeFile(path.join(root, 'drawing.svg'), '<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await writeFile(path.join(root, 'broken.heic'), Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypmif1'), Buffer.alloc(4), Buffer.from('heicmif1')]));
    await writeFile(path.join(root, 'large.png'), Buffer.alloc(128, 1));
    await writeFile(file, html('<img src="drawing.svg"><img src="broken.heic"><img src="large.png">'));
    const previous = limits.fileBytes;
    try {
      limits.fileBytes = 64;
      const snapshot = await importNotion(file);
      expect(snapshot.issues.map(issue => issue.code)).toEqual(['unsupported-image-format', 'image-conversion-failed', 'image-too-large']);
      expect(snapshot.issues.map(issue => issue.message).join(' ')).toContain('HEIC/HEIF');
    } finally { limits.fileBytes = previous; }
  });
  it('omits remote bookmark decoration without misreporting missing content images', async () => {
    const root = await dir();
    const file = path.join(root, 'page.html');
    await writeFile(file, html('<figure><a class="bookmark" href="https://example.com"><div class="bookmark-title">Title</div><div class="bookmark-description">Description</div><img class="bookmark-image" src="https://example.com/preview.jpg"></a></figure>'));
    const snapshot = await importNotion(file);
    expect(snapshot.pages[0]?.blocks[0]).toMatchObject({ type: 'bookmark', content: [{ text: 'Title' }], description: [{ text: 'Description' }] });
    expect(snapshot.issues).toEqual([expect.objectContaining({ code: 'bookmark-preview-omitted', severity: 'info' })]);
    expect(Object.values(snapshot.assets)).toHaveLength(0);
  });
  it.skipIf(process.platform === 'win32')('rejects symlinks in a folder import', async () => {
    const root = await dir();
    await writeFile(path.join(root, 'page.html'), html('<p>Safe</p>'));
    await symlink('/tmp', path.join(root, 'linked'));
    await expect(importNotion(root)).rejects.toThrow('Verknüpfungen');
  });
  it('imports the bundled example consistently', async () => {
    const a = await importNotion(path.resolve('examples/field-notes'));
    const b = await importNotion(path.resolve('examples/field-notes'));
    expect(a.pages).toHaveLength(3);
    expect(a.id).toBe(b.id);
    expect(a.issues).toEqual([]);
  });
  it('opens a Notion ZIP envelope containing another export ZIP', async () => {
    const root = await dir();
    const nested = zip([{ name: 'Export/Page.html', data: html('<p>Nested ZIP content</p>') }]);
    const file = path.join(root, 'export.zip');
    await writeFile(file, zip([{ name: 'Export-part-1.zip', data: nested }]));
    const snapshot = await importNotion(file);
    expect(snapshot.pages).toHaveLength(1);
    expect(snapshot.pages[0]?.blocks[0]?.content[0]?.text).toBe('Nested ZIP content');
    expect((await readFile(file)).length).toBeGreaterThan(0);
  });
  it('rejects ZIP path traversal without creating an escaped file', async () => {
    const root = await dir();
    const file = path.join(root, 'export.zip');
    await writeFile(file, zip([{ name: '../outside.html', data: html('<p>Unsafe</p>') }]));
    await expect(importNotion(file)).rejects.toThrow();
  });
  it('rejects a ZIP symlink and case-colliding names', async () => {
    const root = await dir();
    const file = path.join(root, 'export.zip');
    await writeFile(file, zip([{ name: 'link', data: '/etc', mode: 0o120777 }]));
    await expect(importNotion(file)).rejects.toThrow('Verknüpfungen');
    await writeFile(file, zip([{ name: 'Page.html', data: html('One') }, { name: 'page.html', data: html('Two') }]));
    await expect(importNotion(file)).rejects.toThrow('Mehrdeutige');
  });
  it('loads local raster assets into the snapshot so cleanup cannot break rendering', async () => {
    const root = await dir();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const file = path.join(root, 'export.zip');
    await writeFile(file, zip([{ name: 'page.html', data: html('<figure><img src="image.png"><figcaption>Caption</figcaption></figure>') }, { name: 'image.png', data: bytes }]));
    const snapshot = await importNotion(file);
    expect(Object.values(snapshot.assets)).toHaveLength(1);
    expect(Object.values(snapshot.assets)[0]?.dataUrl).toBe(`data:image/png;base64,${bytes.toString('base64')}`);
    expect(snapshot.issues).toEqual([]);
  });
  it('loads raster images from nested Notion subpages', async () => {
    const root = await dir();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const file = path.join(root, 'subpage.zip');
    await writeFile(file, zip([
      { name: 'Parent.html', data: html('<figure class="link-to-page"><a href="Parent/Child.html">Child</a></figure>').replace('id="page"', 'id="aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"') },
      { name: 'Parent/Child.html', data: html('<figure><img src="Child/photo.png"><figcaption>Nested image</figcaption></figure>').replace('id="page"', 'id="bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"') },
      { name: 'Parent/Child/photo.png', data: bytes },
    ]));
    const snapshot = await importNotion(file);
    const child = snapshot.pages.find(page => page.sourcePath === 'Parent/Child.html');
    expect(child).toMatchObject({ parentId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
    expect(child?.blocks[0]).toMatchObject({ type: 'image', caption: [{ text: 'Nested image' }] });
    expect(child?.blocks[0]?.src).toBeTruthy();
    expect(Object.values(snapshot.assets)).toHaveLength(1);
    expect(snapshot.issues).toEqual([]);
  });
  it('loads bookmark thumbnails and icons offline without duplicating asset bytes', async () => {
    const root = await dir();
    const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    const file = path.join(root, 'cards.zip');
    await writeFile(file, zip([{ name: 'page.html', data: html('<figure><a class="bookmark" href="https://example.com"><div class="bookmark-title">Title</div><img class="bookmark-icon" src="local.png"><img class="bookmark-image" src="local.png"></a></figure>') }, { name: 'local.png', data: bytes }]));
    const snapshot = await importNotion(file);
    const card = snapshot.pages[0]!.blocks[0]!;
    expect(card.preview).toBe(card.iconSrc); expect(card.preview).toBeTruthy();
    expect(Object.keys(snapshot.assets)).toHaveLength(1); expect(snapshot.issues).toEqual([]);
  });
  it('rejects corrupted ZIP contents instead of importing altered text', async () => {
    const root = await dir();
    const file = path.join(root, 'corrupt.zip');
    const data = zip([{ name: 'page.html', data: html('<p>IntegrityMarker</p>') }]);
    data[data.indexOf(Buffer.from('IntegrityMarker'))] = 88;
    await writeFile(file, data);
    await expect(importNotion(file)).rejects.toThrow('Prüfsumme');
  });
  it('enforces per-file extraction limits before accepting archive contents', async () => {
    const root = await dir();
    const file = path.join(root, 'large.zip');
    await writeFile(file, zip([{ name: 'page.html', data: html('x'.repeat(100)) }]));
    const previous = limits.fileBytes;
    try { limits.fileBytes = 64; await expect(importNotion(file)).rejects.toThrow('Entpackgröße'); }
    finally { limits.fileBytes = previous; }
  });
  it('does not begin importing an already cancelled source', async () => {
    const controller = new AbortController(); controller.abort();
    await expect(importNotion('does-not-exist.zip', controller.signal)).rejects.toThrow();
  });
});
