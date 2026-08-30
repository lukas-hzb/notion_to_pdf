import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { getDocument, OPS } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { build } from 'esbuild';
import electron from 'electron';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const launcher = path.resolve('scripts/export.mjs');
await mkdir('artifacts/pdf-tests', { recursive: true });
const root = await mkdtemp(path.resolve('artifacts/pdf-tests/run-'));
const execFileAsync = promisify(execFile);
const spacingRunner = path.join(root, 'spacing.cjs');
await build({ entryPoints: ['tests/spacing.check.ts'], outfile: spacingRunner, bundle: true, platform: 'node', format: 'cjs', target: 'node22', packages: 'external' });
const geometry = await execFileAsync(electron, [spacingRunner, path.resolve('.')], { env, timeout: 120000 });
process.stdout.write(geometry.stdout);
const input = path.join(root, 'input');
await mkdir(input);
const sentinels = [];
const paragraphs = (prefix, count) => Array.from({ length: count }, (_, index) => {
  const sentinel = `${prefix}${String(index).padStart(3, '0')}END`;
  sentinels.push(sentinel);
  return `<p id="${sentinel}">${sentinel} This paragraph must remain visible when a column continues onto another printed page. The layout keeps both columns and all their contents.</p>`;
}).join('');
const left = paragraphs('LEFT', 45);
const right = paragraphs('RIGHT', 65);
const rows = Array.from({ length: 70 }, (_, index) => { const sentinel = `ROW${String(index).padStart(3, '0')}END`; sentinels.push(sentinel); return `<tr><td>${sentinel}</td><td>Table continuation with a repeated heading.</td></tr>`; }).join('');
const wide = `<table><tr>${Array.from({ length: 13 }, (_, n) => `<th>Column ${n + 1}</th>`).join('')}</tr>${Array.from({ length: 4 }, (_, r) => `<tr>${Array.from({ length: 13 }, (_, c) => { const sentinel = `WIDE${r}COL${c}END`; sentinels.push(sentinel); return `<td>${sentinel}</td>`; }).join('')}</tr>`).join('')}</table>`;
await writeFile(path.join(input, 'stress.html'), `<article id="stress"><h1 class="page-title">Pagination stress test</h1><div class="page-body"><div class="column-list"><div class="column" style="width:60%">${left}</div><div class="column" style="width:40%">${right}</div></div><table><thead><tr><th>Identifier</th><th>Note</th></tr></thead><tbody>${rows}</tbody></table><details><summary>Toggle</summary><p>TOGGLECONTENTVISIBLE</p></details><ul><li><span class="checkbox checkbox-on"></span>COMPLETEDTASKVISIBLE</li></ul><p><a href="#LEFT000END">INTERNALREFERENCE</a><a href="https://example.com/">EXTERNALREFERENCE</a></p>${wide}</div></article>`);

async function run(source, destination, extra = []) {
  const output = await new Promise((resolve, reject) => {
    // Exercise the public launcher from outside the repository, including
    // argument forwarding and process lifetime after hidden windows close.
    const child = spawn(process.execPath, [launcher, '--input', source, '--out', destination, ...extra], { env, cwd: root });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('PDF integration test timed out.')); }, 120000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', reject);
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(stdout) : reject(new Error(stderr || stdout)); });
  });
  return JSON.parse(output.trim().split('\n').at(-1));
}

async function readPdf(filename) {
  const task = getDocument({ data: new Uint8Array(await readFile(filename)), useSystemFonts: false });
  try {
    const pdf = await task.promise;
    let text = ''; const items = []; const imagePages = []; let links = 0; let images = 0;
    for (let index = 1; index <= pdf.numPages; index++) {
      const page = await pdf.getPage(index);
      const content = await page.getTextContent();
      assert(content.items.some(item => 'str' in item && /[A-Za-z]/.test(item.str)), `Unexpected blank page ${index}`);
      const viewport = page.getViewport({ scale: 1 });
      for (const item of content.items) {
        if (!('str' in item)) continue;
        text += item.str + ' ';
        items.push({ text: item.str, x: item.transform[4], y: item.transform[5], width: item.width, pageWidth: viewport.width, page: index, font: item.fontName });
        assert(item.transform[4] >= -2 && item.transform[4] + item.width <= viewport.width + 2, `Text outside page width: ${item.str.slice(0, 50)}`);
        assert(item.transform[5] >= -2 && item.transform[5] <= viewport.height + 2, `Text outside page height: ${item.str.slice(0, 50)}`);
      }
      links += (await page.getAnnotations()).filter(item => item.subtype === 'Link').length;
      const pageImages = (await page.getOperatorList()).fnArray.filter(op => [OPS.paintImageXObject, OPS.paintInlineImageXObject].includes(op)).length;
      images += pageImages;
      if (pageImages) imagePages.push(index);
    }
    return { text, items, pages: pdf.numPages, links, images, imagePages };
  } finally { await task.destroy(); }
}

for (const preset of ['original', 'reading', 'print']) {
  const result = await run(input, path.join(root, preset), ['--preset', preset, '--strict']);
  const report = JSON.parse(await readFile(path.join(result.directory, 'export-report.json'), 'utf8'));
  assert.equal(report.options.preserveTaskStatus, preset === 'original');
  const files = (await readdir(result.directory)).filter(file => file.endsWith('.pdf'));
  assert.equal(files.length, 1);
  const pdf = await readPdf(path.join(result.directory, files[0]));
  const compact = pdf.text.replace(/\s+/g, '');
  for (const sentinel of [...sentinels, 'TOGGLECONTENTVISIBLE', 'COMPLETEDTASKVISIBLE']) assert(compact.includes(sentinel), `Missing content in ${preset}: ${sentinel}`);
  assert(pdf.pages >= 3, 'The stress document should span multiple pages.');
  assert(pdf.links >= 2, 'Internal and external PDF links should be present.');
  const leftFirst = pdf.items.find(item => item.text.includes('LEFT000'));
  const rightFirst = pdf.items.find(item => item.text.includes('RIGHT000'));
  assert(leftFirst && rightFirst && leftFirst.page === rightFirst.page && rightFirst.x > leftFirst.x + 100, 'Columns must stay side by side.');
  for (let pageNumber = 1; pageNumber <= pdf.pages; pageNumber++) {
    const footer = pdf.items.filter(item => item.page === pageNumber && item.y < 30);
    const position = footer.find(item => new RegExp(`^${pageNumber}\\s*/\\s*${pdf.pages}$`).test(item.text.trim()));
    assert(position, `Missing page position in footer on page ${pageNumber}.`);
    assert(Math.abs(position.x + position.width / 2 - position.pageWidth / 2) < 1, `Page position is not centered on page ${pageNumber}.`);
  }
  console.log(`PASS ${preset}: ${pdf.pages} pages, ${sentinels.length + 2} content markers, ${pdf.links} links, bounds checked.`);
}
const continuous = await run(input, path.join(root, 'continuous'), ['--preset', 'reading', '--continuous', '--strict']);
const continuousReport = JSON.parse(await readFile(path.join(continuous.directory, 'export-report.json'), 'utf8'));
const continuousPdf = await readPdf(path.join(continuous.directory, continuousReport.files[0]));
const continuousText = continuousPdf.text.replace(/\s+/g, '');
assert.equal(continuousReport.options.continuousPage, true);
assert.equal(continuousReport.options.pageNumbers, false);
assert.equal(continuousPdf.pages, 1);
assert(continuousPdf.items[0].pageWidth > 590, 'Continuous output must retain normal A4 reading width.');
for (const sentinel of [...sentinels, 'TOGGLECONTENTVISIBLE', 'COMPLETEDTASKVISIBLE']) assert(continuousText.includes(sentinel), `Missing continuous content: ${sentinel}`);
assert(!continuousPdf.items.some(item => item.y < 30 && /^1\s*\/\s*1$/.test(item.text.trim())), 'Continuous output must not contain a page footer.');
console.log('PASS continuous: one long page, all content retained, normal reading width and no footer.');
const sample = await run(path.resolve('examples/field-notes'), path.join(root, 'examples'), ['--preset', 'reading', '--strict']);
assert.equal(sample.files, 3);
console.log('PASS bundled examples: all three PDFs exported in strict mode.');
const inspected = await run(input, path.join(root, 'inspect'), ['--inspect-only']);
assert.equal(inspected.pages, 1);
assert.equal(JSON.parse(await readFile(inspected.report, 'utf8')).pages.length, 1);
const listed = await execFileAsync(process.execPath, [launcher, '--input', input, '--list'], { env, cwd: root });
assert.equal(JSON.parse(listed.stdout)[0].title, 'Pagination stress test');
const inspectionBundle = await readFile(path.resolve('dist/inspect.cjs'), 'utf8');
assert(!/require\(["']electron["']\)/.test(inspectionBundle), 'Import-only commands must not load Electron.');
const diagnosis = JSON.parse((await execFileAsync(process.execPath, [launcher, '--doctor'], { env, cwd: root })).stdout);
assert(diagnosis.ok && diagnosis.checks.some(check => check.name === 'print-runtime' && check.ok));
const selected = await run(path.resolve('examples/field-notes'), path.join(root, 'selected'), ['--page-index', '1', '--paper', 'Letter', '--landscape', '--toggles', 'sections', '--tasks', 'bullets', '--font-size', '12', '--margin', '20']);
assert.equal(selected.files, 1);
const selectedReport = JSON.parse(await readFile(path.join(selected.directory, 'export-report.json'), 'utf8'));
assert.equal(selectedReport.options.landscape, true);
assert.equal(selectedReport.options.paper, 'Letter');
assert.equal(selectedReport.options.preserveTaskStatus, false);
await assert.rejects(() => run(input, path.join(root, 'conflicting-status'), ['--no-task-status', '--keep-task-status']), /können nicht kombiniert/);
await assert.rejects(() => run(input, path.join(root, 'rejected'), ['--tables', 'wrap', '--strict']), /Strenger Modus/);
assert.deepEqual(await readdir(path.join(root, 'rejected')), []);
console.log('PASS CLI: source inspection, selection, layout overrides, strict rejection and cleanup.');
const records = path.join(root, 'records'); await mkdir(records);
await writeFile(path.join(records, '01-notes.html'), '<article id="notes"><h1 class="page-title">Notes</h1><div class="page-body"><p>RETAINEDBODYCONTENT</p></div></article>');
await writeFile(path.join(records, '02-record.html'), '<article id="record"><header><h1 class="page-title">Record</h1><table class="properties"><tr><th>Status</th><td>RETAINEDPROPERTYVALUE</td></tr></table></header><div class="page-body"></div></article>');
const contentOnly = await run(records, path.join(root, 'content-only'), ['--preset', 'reading', '--strict']);
assert.equal(contentOnly.files, 1); assert.equal(contentOnly.skipped, 1);
const allRecords = await run(records, path.join(root, 'all-records'), ['--preset', 'reading', '--database-pages', 'all', '--strict']);
assert.equal(allRecords.files, 2);
const recordsReport = JSON.parse(await readFile(path.join(allRecords.directory, 'export-report.json'), 'utf8'));
const propertyPdf = await readPdf(path.join(allRecords.directory, recordsReport.files[1]));
assert(propertyPdf.text.includes('RETAINEDPROPERTYVALUE'));
console.log('PASS database records: property-only filtering, explicit inclusion and property text in PDF.');
const mathFile = path.join(root, 'math.html');
await writeFile(mathFile, String.raw`<article id="math"><h1 class="page-title">Formula and block regression</h1><div class="page-body">
<h2>Inline mathematics</h2><p>INLINESTART Let <span data-notion-inline-equation="\det(A)\neq 0">WRONGGLYPHS</span> and <span data-notion-inline-equation="x_i^2+\frac{1}{2}">WRONGGLYPHS</span>. The surrounding text stays on its baseline. INLINEEND</p>
<p>GREEKSTART <span data-notion-inline-equation="\alpha+\beta=\gamma,\quad x\in\mathbb{R}">WRONGGLYPHS</span> GREEKEND. H<sub>2</sub>O, 10<sup>3</sup>, <strong>bold</strong>, <em>italic</em>, <u>underlined</u> and <s>explicit deletion</s>.</p><p>REGULARFONT <em>ITALICFONT</em> <strong><em>BOLDITALICFONT</em></strong></p>
<h2>Display mathematics</h2><div data-notion-equation="\frac{d}{dx}\left[\frac{f(x)}{g(x)}\right]=\frac{f'(x)g(x)-f(x)g'(x)}{g(x)^2}"></div>
<figure class="equation" data-notion-equation="\int_a^b f(x)\,dx = F(b)-F(a)"></figure>
<div class="equation" data-notion-equation="A=\begin{pmatrix}1&amp;2\\3&amp;4\end{pmatrix},\quad \begin{aligned}x+y&amp;=3\\2x-y&amp;=0\end{aligned}"></div>
<div class="equation" data-notion-equation="f(x)=\begin{cases}x^2 &amp; x\geq 0\\-x &amp; x&lt;0\end{cases}"></div>
<h2>Blocks and references</h2><aside class="block-color-purple_background"><div><p>ICONLESSCALLOUT No invented arrow.</p></div></aside><aside><div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div><div>ICONCALLOUT Local symbol without a missing-image box.</div></aside>
<figure class="link-to-page"><a href="https://example.com/page">PAGELINKVISIBLE</a></figure>
<figure><a class="bookmark source" href="https://example.com/lesson"><div class="bookmark-title">BOOKMARKTITLEVISIBLE</div><div class="bookmark-description">BOOKMARKDESCRIPTIONVISIBLE All source text survives even when a preview cannot be fetched offline.</div><img class="bookmark-image" src="https://example.com/preview.jpg"></a></figure>
<figure><div class="source">https://example.com/recovered-link</div></figure>
<ul><li><input class="checkbox checkbox-on" type="checkbox" checked>CHECKEDVISIBLE</li><li><input class="checkbox checkbox-off" type="checkbox">UNCHECKEDVISIBLE</li></ul>
<table><tr><th>Value</th><th>Formula</th><th>Done</th></tr><tr><td>TABLEMATHVISIBLE</td><td><span data-notion-inline-equation="\sqrt{2}+1"></span></td><td><input type="checkbox" checked></td></tr></table>
<p>MATHDOCUMENTEND</p></div></article>`);
const mathResult = await run(mathFile, path.join(root, 'math'), ['--preset', 'reading', '--strict']);
const mathReport = JSON.parse(await readFile(path.join(mathResult.directory, 'export-report.json'), 'utf8'));
assert.equal(mathResult.warnings, 0);
const mathPdf = await readPdf(path.join(mathResult.directory, mathReport.files[0]));
const mathText = mathPdf.text.replace(/\s+/g, '');
for (const marker of ['INLINESTART', 'INLINEEND', 'GREEKSTART', 'GREEKEND', 'ICONLESSCALLOUT', 'ICONCALLOUT', 'PAGELINKVISIBLE', 'BOOKMARKTITLEVISIBLE', 'BOOKMARKDESCRIPTIONVISIBLE', 'https://example.com/recovered-link', 'CHECKEDVISIBLE', 'UNCHECKEDVISIBLE', 'TABLEMATHVISIBLE', 'MATHDOCUMENTEND']) assert(mathText.includes(marker), `Missing formula regression content: ${marker}`);
assert(!mathText.includes('WRONGGLYPHS') && !mathText.includes('Bildnichtverfügbar'));
assert(mathPdf.links >= 3);
assert.equal(mathReport.issues.filter(issue => issue.code === 'bare-link-recovered').length, 1);
assert(mathText.includes('α') && mathText.includes('β') && mathText.includes('γ'), 'Greek math glyphs must be embedded and extractable.');
const fontFor = label => mathPdf.items.find(item => item.text.trim() === label)?.font;
assert(fontFor('REGULARFONT') && fontFor('ITALICFONT') && fontFor('BOLDITALICFONT'));
assert.equal(new Set(['REGULARFONT', 'ITALICFONT', 'BOLDITALICFONT'].map(fontFor)).size, 3, 'Regular, italic and bold italic text must use distinct embedded font faces.');
console.log(`PASS mathematics and block regressions: ${mathPdf.pages} pages, inline/display formulas, scripts, callouts, bookmarks, links and bounds.`);
const coverFile = path.join(root, 'cover.html');
await writeFile(path.join(root, 'cover.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
await writeFile(coverFile, `<article id="cover"><header><img class="page-cover-image" src="cover.png"><img class="page-icon" src="https://app.notion.com/icons/bookmark_pink.svg"><h1 class="page-title">COVERREGRESSION</h1></header><div class="page-body"><aside class="block-color-gray_background"><div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div><div>CALLOUTCONTENT</div></aside><p class="block-color-pink">PINKREFERENCE</p><hr>${Array.from({ length: 6 }, (_, i) => `<figure class="link-to-page"><a href="https://example.com/page-${i}">PAGEREFERENCE${i}</a></figure>`).join('')}</div></article>`);
const coverResults = {};
for (const [name, flags] of [
  ['cover', ['--preset', 'reading']],
  ['no-cover', ['--preset', 'reading', '--no-cover']],
  ['print', ['--preset', 'print']],
  ['landscape', ['--preset', 'reading', '--paper', 'Letter', '--landscape', '--font-size', '16', '--margin', '35']],
]) {
  const result = await run(coverFile, path.join(root, name), [...flags, '--strict']);
  const report = JSON.parse(await readFile(path.join(result.directory, 'export-report.json'), 'utf8'));
  const pdf = await readPdf(path.join(result.directory, report.files[0]));
  assert.equal(pdf.images, name === 'no-cover' ? 0 : 1, `Cover visibility in ${name}`);
  assert.equal(pdf.links, 6, `All six page references must stay clickable in ${name}`);
  for (const marker of ['COVERREGRESSION', 'CALLOUTCONTENT', 'PINKREFERENCE', 'PAGEREFERENCE5']) assert(pdf.text.includes(marker), `Missing header content in ${name}: ${marker}`);
  assert(pdf.items.filter(item => /COVERREGRESSION|CALLOUTCONTENT/.test(item.text)).every(item => item.page === 1), 'Cover/title/callout must fit together on the first page.');
  coverResults[name] = pdf;
}
const titleY = pdf => pdf.items.find(item => item.text === 'COVERREGRESSION').y;
assert(titleY(coverResults['no-cover']) > titleY(coverResults.cover) + 60, 'Removing the cover must reclaim its layout space.');
console.log('PASS cover layout: cover/icon/title grouping, no-cover and print profiles, narrow landscape layout, six clickable page references, bounds.');
const blocksFile = path.join(root, 'blocks.html');
const description = Array.from({ length: 90 }, (_, i) => `DESCRIPTION${String(i).padStart(3, '0')}END Website metadata remains in the importer but the PDF card shows only a useful preview.`).join('\n\n');
const card = (id, description) => `<figure><a class="bookmark" href="https://example.com/${id}"><div class="bookmark-title">${id}</div><div class="bookmark-description">${description}</div><img class="bookmark-icon" src="cover.png"><img class="bookmark-image" src="cover.png"></a><figcaption><a href="https://example.org/caption">CAPTION${id}</a></figcaption></figure>`;
await writeFile(blocksFile, `<article id="blocks"><h1 class="page-title">Link cards, media and tabs</h1><div class="page-body">${card('LOCALCARD', 'LOCALDESCRIPTION Complete bookmark metadata.')}<div class="column-list"><div class="column" style="width:30%">${card('NARROWCARD', 'NARROWDESCRIPTION Card in a small column.')}</div><div class="column" style="width:70%"><p>RIGHTCOLUMNCONTENT</p></div></div><figure><video title="VIDEOTITLE" poster="cover.png"><source src="https://example.com/lesson.mp4"></video><figcaption>VIDEOCAPTION</figcaption></figure><audio title="AUDIOTITLE"><source src="https://example.com/lesson.mp3"></audio><iframe title="EMBEDTITLE" src="https://example.com/widget"></iframe><details class="tab-page"><summary>TABONE</summary><p>TABONECONTENT</p></details><details class="tab-page"><summary>TABTWO</summary><p>TABTWOCONTENT</p></details><table><tr><td><p>CELLPARAGRAPHONE</p><p>CELLPARAGRAPHTWO</p><ul><li>CELLLISTITEM</li></ul></td></tr></table>${card('LONGCARD', description)}<p>BLOCKSDOCUMENTEND</p></div></article>`);
for (const mode of ['card', 'compact']) {
  const result = await run(blocksFile, path.join(root, `blocks-${mode}`), ['--preset', 'reading', '--bookmarks', mode]);
  const report = JSON.parse(await readFile(path.join(result.directory, 'export-report.json'), 'utf8'));
  assert.deepEqual(report.issues.filter(issue => issue.severity !== 'info').map(issue => issue.code), ['unsupported-block', 'unsupported-block', 'unsupported-block']);
  const pdf = await readPdf(path.join(result.directory, report.files[0]));
  const compact = pdf.text.replace(/\s+/g, '');
  for (const marker of ['LOCALCARD', 'NARROWCARD', 'RIGHTCOLUMNCONTENT', 'VIDEOTITLE', 'VIDEOCAPTION', 'AUDIOTITLE', 'EMBEDTITLE', 'TABONECONTENT', 'TABTWOCONTENT', 'CELLPARAGRAPHONE', 'CELLPARAGRAPHTWO', 'CELLLISTITEM', 'CAPTIONLOCALCARD', 'CAPTIONLONGCARD', 'BLOCKSDOCUMENTEND']) assert(compact.includes(marker), `Missing block content in ${mode}: ${marker}`);
  assert(pdf.links >= 9, 'Card, caption and media targets must be clickable.');
  if (mode === 'card') {
    assert(compact.includes('DESCRIPTION000END'), 'Bookmark preview must retain its beginning.');
    assert(!compact.includes('DESCRIPTION089END'), 'Bookmark preview must not paint the complete website description.');
    const cardPage = pdf.items.find(item => item.text === 'LONGCARD')?.page;
    const captionPage = pdf.items.find(item => item.text.includes('CAPTIONLONGCARD'))?.page;
    assert(cardPage && cardPage === captionPage, 'A bounded bookmark card and its caption must stay together.');
    assert(pdf.images >= 7, 'Three thumbnails, three icons and the video poster must be embedded.');
  } else {
    assert(!compact.includes('DESCRIPTION000END'));
    assert.equal(report.issues.filter(issue => issue.code === 'bookmark-compacted').length, 3);
    assert.equal(pdf.images, 1, 'Compact bookmarks omit decoration but keep the video poster.');
  }
  console.log(`PASS ${mode} bookmarks/media/tabs: ${pdf.pages} pages, bounded previews, local images, captions, source URLs and table structure.`);
}
const spacingFile = path.join(root, 'spacing.html');
const attachmentsFile = path.join(root, 'attachments.html');
await writeFile(attachmentsFile, `<article><h1 class="page-title">Attachment pagination</h1><div class="page-body">${Array.from({ length: 24 }, (_, i) => `<p>${'Notes before the attachment. '.repeat(i % 4 + 1)}</p><figure><a href="https://example.com/file-${i}.pdf">ATTACHMENT${i}END.pdf</a></figure>`).join('')}</div></article>`);
const attachmentsResult = await run(attachmentsFile, path.join(root, 'attachments'), ['--preset', 'reading', '--strict']);
const attachmentsReport = JSON.parse(await readFile(path.join(attachmentsResult.directory, 'export-report.json'), 'utf8'));
const attachmentsPdf = await readPdf(path.join(attachmentsResult.directory, attachmentsReport.files[0]));
for (let i = 0; i < 24; i++) assert.equal(attachmentsPdf.items.filter(item => item.text.includes(`ATTACHMENT${i}END.pdf`)).length, 1, `Attachment ${i} must appear exactly once.`);
console.log(`PASS attachment pagination: 24 compact rows across ${attachmentsPdf.pages} pages, all filenames retained.`);
await writeFile(path.join(root, 'portrait.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAACAAAAAwCAIAAAD/zu84AAAAR0lEQVR4nO3RMRHAMAwEQTv8KaZNYxKBcG7U7QJ4zZz2+5016RldXw5c8IMkUZIoSZQkShIliZJESaIkUZIoSZQkShKl8UQ/NXIDDhsfCTMAAAAASUVORK5CYII=', 'base64'));
const portraitFile = path.join(root, 'portrait.html');
await writeFile(portraitFile, `<article><h1 class="page-title">Heading and image pagination</h1><div class="page-body">${Array.from({ length: 30 }, (_, i) => `<p>BEFOREIMAGE${i} Text leading up to the illustrated section.</p>`).join('')}<h1>IMAGESECTION</h1><figure><img src="portrait.png" style="width:1000px"><figcaption>IMAGECAPTION</figcaption></figure></div></article>`);
for (const [name, flags] of [['portrait', []], ['narrow-landscape', ['--paper', 'Letter', '--landscape', '--font-size', '16', '--margin', '35']]]) {
  const result = await run(portraitFile, path.join(root, `heading-image-${name}`), ['--preset', 'reading', '--strict', ...flags]);
  const report = JSON.parse(await readFile(path.join(result.directory, 'export-report.json'), 'utf8'));
  const pdf = await readPdf(path.join(result.directory, report.files[0]));
  const heading = pdf.items.find(item => item.text === 'IMAGESECTION');
  const caption = pdf.items.find(item => item.text === 'IMAGECAPTION');
  assert(heading && caption && heading.page === caption.page && pdf.imagePages.includes(heading.page), 'A heading and its large image/caption must share a page.');
  console.log(`PASS heading/image ${name}: shared page for heading, image and caption.`);
}
await writeFile(spacingFile, `<article id="spacing"><h1 class="page-title">Block spacing and alignment</h1><div class="page-body">
<h2>Text and lists</h2><p>PARAGRAPHONE Body paragraphs use a smaller gap than independent visual blocks.</p><p>PARAGRAPHTWO A heading belongs to the following content.</p>
<ul><li>LISTONE A normal list item</li></ul><ul><li>LISTTWO The next exported list item<ul><li>NESTEDONE A nested item</li><li>NESTEDTWO Another nested item</li></ul></li></ul><ul><li>LISTTHREE Back at the outer level</li></ul>
<h2>Centered callouts</h2><aside><div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div><p>SHORTCALLOUT Text and icon share the vertical center.</p></aside>
<aside><div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div><div><h3>LISTCALLOUT A structured note</h3><p>Spacing remains visible inside the note.</p><ul><li>FIRSTNOTE A compact list</li><li>LASTNOTE No extra margin under the last item</li></ul></div></aside>
<h2>Quotation and section</h2><blockquote><p>QUOTEONE A quoted paragraph.</p><p>QUOTETWO The second paragraph retains its own gap.</p></blockquote>
<details><summary><h3>SECTIONHEADING Expanded section</h3></summary><p>SECTIONBODY Starts close to its heading.</p><ul><li>SECTIONLAST Last item of the section.</li></ul></details><p>AFTERSECTION A new paragraph outside the section.</p>
<hr><h2>Tables, formulas and code</h2><table><tr><th>Type</th><th>Content</th></tr><tr><td><p>TABLELABEL</p></td><td><p>TABLEFIRST First paragraph</p><p>TABLESECOND Second paragraph</p><ul><li>TABLELAST A list inside the cell</li></ul></td></tr></table>
<div data-notion-equation="E=mc^2"></div><pre><code>CODEMARKER const spacing = 'consistent';</code></pre>
<details class="tab-page"><summary>TABHEADING Tab section</summary><p>TABBODY No accumulated title margins.</p></details>
<h2>Columns and references</h2><div class="column-list"><div class="column" style="width:50%"><h3>COLUMNONE</h3><p>First paragraph.</p><p>Second paragraph.</p></div><div class="column" style="width:50%"><h3>COLUMNTWO</h3><ul><li>First item</li><li>Last item</li></ul></div></div><figure class="link-to-page"><a href="https://example.com/page">PAGEREFERENCE A compact page link</a></figure>
<figure><a class="bookmark" href="https://example.com/bookmark"><div class="bookmark-title">BOOKMARKREFERENCE A distinct link card</div><div class="bookmark-description">The card has more space around it than successive page links.</div></a><figcaption>BOOKMARKCAPTION Caption stays close to its card.</figcaption></figure>
<h2>Pagination</h2><aside><div><img class="icon" src="https://app.notion.com/icons/exclamation-mark_gray.svg"></div><div>${Array.from({ length: 25 }, (_, i) => `<p>LONGNOTE${i}END This paragraph stays visible when a long callout continues on another page. The layout must preserve text and the callout background.</p>`).join('')}</div></aside><p>SPACINGDOCUMENTEND All content retained.</p>
</div></article>`);
for (const preset of ['reading', 'print']) {
  const result = await run(spacingFile, path.join(root, `spacing-${preset}`), ['--preset', preset, '--strict']);
  const report = JSON.parse(await readFile(path.join(result.directory, 'export-report.json'), 'utf8'));
  const pdf = await readPdf(path.join(result.directory, report.files[0]));
  const text = pdf.text.replace(/\s+/g, '');
  for (const marker of ['PARAGRAPHONE', 'PARAGRAPHTWO', 'LISTONE', 'LISTTWO', 'LISTTHREE', 'NESTEDONE', 'NESTEDTWO', 'SHORTCALLOUT', 'LISTCALLOUT', 'FIRSTNOTE', 'LASTNOTE', 'QUOTEONE', 'QUOTETWO', 'SECTIONHEADING', 'SECTIONBODY', 'SECTIONLAST', 'AFTERSECTION', 'TABLELABEL', 'TABLEFIRST', 'TABLESECOND', 'TABLELAST', 'CODEMARKER', 'TABHEADING', 'TABBODY', 'COLUMNONE', 'COLUMNTWO', 'PAGEREFERENCE', 'BOOKMARKREFERENCE', 'BOOKMARKCAPTION', 'SPACINGDOCUMENTEND', ...Array.from({ length: 25 }, (_, i) => `LONGNOTE${i}END`)]) assert(text.includes(marker), `Missing spacing fixture content: ${marker}`);
  const heading = pdf.items.find(item => item.text.includes('SECTIONHEADING'));
  const content = pdf.items.find(item => item.text.includes('SECTIONBODY'));
  assert(heading && content && heading.page === content.page, 'Expanded heading must remain with its content.');
  console.log(`PASS spacing PDF ${preset}: ${pdf.pages} pages, centered callouts, nested lists, long callout pagination and all content retained.`);
}
if (process.env.NOTION_PDF_KEEP_TEST_ARTIFACTS === '1') console.log(`Artifacts: ${root}`);
else { await rm(root, { recursive: true, force: true }); console.log('Temporary test PDFs removed.'); }
