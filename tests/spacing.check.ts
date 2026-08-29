// Executed by the PDF suite in the same Chromium engine as the exporter.
import assert from 'node:assert/strict';
import { app, BrowserWindow, session } from 'electron';
import { parseNotionHtml } from '../src/importers/html';
import { renderDocument } from '../src/layout/render';
import { printStyles } from '../src/rendering/pdf';
import { presetOptions } from '../src/domain/options';
import type { Snapshot } from '../src/domain/model';

const cases = [
  ['paragraph', '<p>Paragraph</p>', .55, .55],
  ['heading', '<h2>Heading</h2>', 1.367, .666],
  ['heading1', '<h1>Heading one</h1>', 1.5, .72],
  ['heading3', '<h3>Heading three</h3>', 1.18, .548],
  ['heading4', '<h4>Heading four</h4>', 1.1, .5],
  ['bullets', '<ul><li>First</li><li>Second</li></ul>', .55, .3],
  ['numbers', '<ol><li>First</li><li>Second</li></ol>', .55, .3],
  ['tasks', '<ul><li><input type="checkbox" checked>Task</li></ul>', .55, .3],
  ['callout', '<aside><p>Notice</p></aside>', 1, 1],
  ['quote', '<blockquote><p>Quotation</p></blockquote>', 1, 1],
  ['code', '<pre><code>const value = 1;</code></pre>', 1, 1],
  ['table', '<table><tr><th>Column</th></tr><tr><td><p>Value</p></td></tr></table>', 1, 1],
  ['equation', '<div data-notion-equation="x^2+1"></div>', 1, 1],
  ['image', '<figure><img src="pixel.png"><figcaption>Caption</figcaption></figure>', 1, 1],
  ['reference', '<figure class="link-to-page"><a href="https://example.com/page">Page</a></figure>', .25, .25],
  ['bookmark', '<figure><a class="bookmark" href="https://example.com"><div class="bookmark-title">Title</div><div class="bookmark-description">Description</div></a><figcaption>Caption</figcaption></figure>', 1, 1],
  ['toggle', '<details><summary>Details</summary><p>Body</p></details>', .65, .65],
  ['toggle-heading', '<details><summary><h2>Heading section</h2></summary><p>Body</p></details>', 1.5, .65],
  ['columns', '<div class="column-list"><div class="column"><p>Left</p></div><div class="column"><p>Right</p></div></div>', 1, 1],
  ['tab', '<details class="tab-page"><summary>Tab</summary><p>Body</p></details>', 1, 1],
  ['divider', '<hr>', .55, .55],
  ['file', '<figure><a href="https://example.com/file.pdf">Attachment</a></figure>', .65, .65],
  ['media', '<video title="Video" src="https://example.com/video.mp4"></video>', 1, 1],
  ['fallback', '<button>Unsupported control</button>', 1, 1],
] as const;
const pairs = cases.flatMap((before, i) => cases.map((after, j) => {
  const lists = ['bullets', 'numbers', 'tasks'];
  const headingAfter = before[0] === 'heading1' ? .72 : before[0] === 'heading' ? .666 : before[0] === 'heading3' ? .548 : .5;
  const top = before[0].startsWith('heading') && after[0] !== 'divider' ? after[0].startsWith('heading') ? .65 : headingAfter
    : lists.includes(before[0]) && lists.includes(after[0]) ? .3 : after[2];
  const previous = before[0].startsWith('heading') ? .5 : before[3];
  return { id: `pair-${i}-${j}`, before: before[0], after: after[0], expected: Math.max(previous, top),
    html: `<div class="column-list"><div class="column" id="pair-${i}-${j}">${before[1]}${after[1]}</div></div>` };
}));
const symbol = '<div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div>';
const calloutBodies = [
  '<p>One line</p>',
  '<p>Two lines<br>of text</p>',
  '<h2>Heading</h2><p>Text</p>',
  '<ul><li>Item</li><li>Another item<ul><li>Nested item</li></ul></li></ul>',
  '<p>Intro</p><ol><li>First</li><li>Second</li></ol>',
  '<details><summary>Nested section</summary><p>Full content</p></details>',
  '<table><tr><td><p>Cell content</p><p>Several paragraphs</p></td></tr></table>',
];
const body = pairs.map(pair => pair.html).join('') + calloutBodies.map((content, i) =>
  `<aside id="center-${i}">${symbol}<div>${content}</div></aside>`).join('') +
  '<ul id="nested-list"><li>Label<p>Details</p><ul><li>Child</li><li>Second child</li></ul></li><li>Sibling</li></ul>' +
  '<blockquote id="nested-quote"><p>Intro</p><ul><li>First</li><li>Second</li></ul></blockquote>' +
  '<div class="column-list"><div class="column" id="nested-file"><ul><li>Previous line<figure><a href="https://example.com/file.pdf">Attachment.pdf</a></figure></li></ul><ul><li>Following line</li></ul></div></div>' +
  '<div id="stacked-equation" data-notion-equation="\\boxed{1.\\quad 0\\in U} \\\\\n\\boxed{2.\\quad u,v\\in U} \\\\\n\\boxed{3.\\quad \\lambda u\\in U}"></div>' +
  '<figure id="full-image"><img style="width:710px" src="pixel.png"></figure>' +
  '<figure id="half-image" style="text-align:right"><img style="width:355px" src="pixel.png"></figure>';
const page = parseNotionHtml(`<article><h1 class="page-title">Spacing geometry</h1><div class="page-body">${body}</div></article>`, 'geometry.html');
const snapshot: Snapshot = { version: 1, id: 'spacing', name: 'spacing', importedAt: '', pages: [page], issues: [], assets: {
  'pixel.png': { id: 'pixel.png', mime: 'image/png', dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=' },
} };

// This function runs only in the isolated renderer; do not reference Node state.
function measure() {
  const box = (el: Element) => el.getBoundingClientRect();
  const center = (el: Element) => { const b = box(el); return (b.top + b.bottom) / 2; };
  const titleStyle = getComputedStyle(document.querySelector('.document-title')!);
  const gaps = Array.from(document.querySelectorAll('[id^="pair-"]')).map(el => {
    const blocks = el.querySelectorAll(':scope > [data-block], :scope > .heading-media > [data-block]');
    return { id: el.id, gap: box(blocks[1]!).top - box(blocks[0]!).bottom };
  });
  const callouts = Array.from(document.querySelectorAll('[id^="center-"]')).map(el => {
    const content = el.querySelector('.callout-content')!;
    const icon = el.querySelector('.callout-icon')!;
    return { id: el.id, contentOffset: center(content) - center(el), iconOffset: center(icon) - center(el),
      firstGap: box(content.firstElementChild!).top - box(content).top,
      lastGap: box(content).bottom - box(content.lastElementChild!).bottom };
  });
  const edgeErrors = Array.from(document.querySelectorAll('.column, .callout-content, .toggle-content, blockquote, td, th')).flatMap(el => {
    const first = el.firstElementChild, last = el.lastElementChild;
    if (!first || !last) return [];
    return parseFloat(getComputedStyle(first).marginTop) > .1 || parseFloat(getComputedStyle(last).marginBottom) > .1 ? [el.id || el.tagName] : [];
  });
  const list = document.getElementById('nested-list')!;
  const firstItem = list.firstElementChild!;
  const details = firstItem.querySelector('p')!;
  const nested = firstItem.querySelector('ul')!;
  const nestedFile = document.getElementById('nested-file')!;
  const fileBefore = nestedFile.querySelector('.list-item-label')!;
  const attachment = nestedFile.querySelector('.file-attachment-name')!;
  const fileAfter = nestedFile.querySelectorAll('.list-item-label')[1]!;
  const equationRows = Array.from(document.querySelectorAll('#stacked-equation .fbox')).map(el => box(el).top);
  const image = (id: string) => { const figure = document.getElementById(id)!; const media = figure.querySelector('img')!; return {
    ratio: box(media).width / box(figure).width, offset: center(media) - center(figure),
  }; };
  return { rem: parseFloat(getComputedStyle(document.documentElement).fontSize),
    bodyLineHeight: parseFloat(getComputedStyle(document.body).lineHeight),
    titleFontSize: parseFloat(titleStyle.fontSize), titleWeight: titleStyle.fontWeight,
    titleLetterSpacing: parseFloat(titleStyle.letterSpacing), gaps, callouts, edgeErrors,
    detailsGap: parseFloat(getComputedStyle(details).marginTop),
    nestedItemGap: box(nested.children[1]!).top - box(nested.children[0]!).bottom,
    nestedBottom: box(firstItem).bottom - box(nested).bottom,
    quoteParagraphGap: box(document.querySelector('#nested-quote > ul')!).top - box(document.querySelector('#nested-quote > p')!).bottom,
    nestedFileOffset: center(attachment) - (center(fileBefore) + center(fileAfter)) / 2,
    equationRows, fullImage: image('full-image'), halfImage: image('half-image'),
  };
}

async function main() {
  await app.whenReady();
  const printSession = session.fromPartition('spacing-regression', { cache: false });
  const url = 'spacing-test://document/';
  let renderedHtml = '';
  printSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !details.url.startsWith(url) && !details.url.startsWith('data:') }));
  printSession.protocol.handle('spacing-test', () => new Response(renderedHtml, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }));
  printSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  const window = new BrowserWindow({ show: false, webPreferences: { session: printSession, sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    const style = await printStyles(process.argv[2]!);
    for (const options of [presetOptions('reading'), presetOptions('print'), { ...presetOptions('reading'), fontSize: 16, paper: 'Letter' as const, landscape: true, margin: 35 }]) {
      renderedHtml = renderDocument(snapshot, page, options, style).html;
      await window.loadURL(`${url}${options.preset}-${options.fontSize}`);
      await window.webContents.executeJavaScript('document.fonts.ready.then(() => Promise.all(Array.from(document.images, image => image.decode())))');
      const result = await window.webContents.executeJavaScript(`(${measure.toString()})()`) as ReturnType<typeof measure>;
      assert(Math.abs(result.bodyLineHeight - 1.5 * result.rem) < .1, 'Body line height must match Notion.');
      assert(Math.abs(result.titleFontSize - 2.5 * result.rem) < .1, 'Page title size must match Notion.');
      assert.equal(result.titleWeight, '700', 'Page title weight must match Notion.');
      assert(Math.abs(result.titleLetterSpacing + .025 * result.rem) < .1, 'Page title tracking must match Notion.');
      assert.equal(result.gaps.length, pairs.length);
      for (const pair of pairs) {
        const actual = result.gaps.find(gap => gap.id === pair.id)!.gap;
        assert(Math.abs(actual - pair.expected * result.rem) < .8, `${options.preset}/${options.fontSize}: ${pair.before} -> ${pair.after}: ${actual.toFixed(2)}px, expected ${(pair.expected * result.rem).toFixed(2)}px`);
      }
      assert.equal(result.callouts.length, calloutBodies.length);
      for (const callout of result.callouts) {
        for (const key of ['contentOffset', 'iconOffset', 'firstGap', 'lastGap'] as const) {
          assert(Math.abs(callout[key]) < .8, `${options.fontSize}pt ${callout.id} ${key}: ${callout[key]}`);
        }
      }
      assert.deepEqual(result.edgeErrors, [], 'Only direct container edges should lose their outer margins.');
      assert(Math.abs(result.detailsGap - .55 * result.rem) < .1, 'List label must not absorb the following paragraph gap.');
      assert(Math.abs(result.nestedItemGap - .3 * result.rem) < .8, 'Nested list items retain their compact gaps.');
      assert(Math.abs(result.nestedBottom) < .8, 'Last nested list must not inflate its parent item.');
      assert(result.quoteParagraphGap > 0, 'Inner paragraph-to-list spacing must remain intact.');
      assert(Math.abs(result.nestedFileOffset) < .8, `${options.fontSize}pt nested attachment optical offset: ${result.nestedFileOffset.toFixed(2)}px`);
      assert.equal(new Set(result.equationRows.map(top => Math.round(top))).size, 3, 'Bare Notion equation line breaks must create three vertical rows.');
      assert(Math.abs(result.fullImage.ratio - 1) < .01 && Math.abs(result.fullImage.offset) < .8, 'A 710px Notion image must fill and center in the PDF column.');
      assert(Math.abs(result.halfImage.ratio - .5) < .01 && Math.abs(result.halfImage.offset) < .8, 'A half-width Notion image must remain half-width and centered.');
      console.log(`PASS spacing ${options.preset}/${options.fontSize}pt: ${pairs.length} block pairs, ${calloutBodies.length} centered callouts, nested lists and container edges.`);
    }
  } finally { window.destroy(); }
}
main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
