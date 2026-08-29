# Development

## Setup

Use Node 24, or Node 22.13+. Run `npm ci`, `npm run setup` and `npm run build` from the repository root. The explicit setup step installs Electron's print runtime. Conversion does not need a Notion token, local server or running desktop interface.

`npm run build` regenerates `dist/`. Use `npm run demo` for a quick export from the synthetic examples. An installed Electron runtime and a desktop session are required for PDF tests. On Linux, use `xvfb-run --auto-servernum npm run test:pdf` when no display is available; do not disable Chromium's sandbox to work around host configuration.

## Architecture

```text
ZIP / folder / HTML
        │
        ▼
Bounded file access → parse5 → typed Snapshot + local assets + issues
        │
        ▼
Profile and block rendering → trusted print HTML + embedded fonts
        │
        ▼
Isolated Chromium → PDF.js sanity checks → atomic batch + report
```

| Location | Responsibility |
| --- | --- |
| `src/importers/files.ts` | Archive envelopes, path boundaries, quotas, CRC and temporary files |
| `src/importers/html.ts` | Recognized HTML structures and rich text; no source script execution |
| `src/importers/index.ts` | Page identity, references, local assets and snapshot construction |
| `src/domain/` | Document, settings and result types |
| `src/layout/` | Static transformations, table partitioning and print CSS |
| `src/rendering/pdf.ts` | Isolated print session, fonts, image readiness, overflow and PDF checks |
| `src/jobs/export.ts` | File naming, batch output, reports and rollback |
| `src/cli/`, `scripts/export.mjs` | Arguments, launcher, process lifetime and cancellation |

Electron is a replaceable print backend, not a UI framework in this project. The desktop prototype was removed. There are no React components, renderer IPC endpoints or app packaging scripts. A future Notion integration should feed the document model rather than couple capture, layout and UI together.

`src/cli/inspect.ts` is a separate Node entry point. `runCli` accepts an injected PDF exporter; only the Electron entry point imports it. Keep inspection, help and installation diagnostics free of browser startup. The PDF suite checks the inspection bundle and exercises listing and diagnostics from outside the repository.

### Rendering decisions

Keep import data intact and apply options during rendering. All toggle bodies remain visible. Selecting ordinary bullets (including the reading and print profiles) removes completion styling and records it in the report; `--keep-task-status` explicitly restores it. Checkbox mode preserves state by default. Explicit text strikethrough is independent of task state. The reading and print profiles preserve columns; `--columns stack` remains an explicit linearization option. Unknown or unsupported content needs a visible fallback and an issue; never silently mark it supported.

Database properties from the header are stored separately from page-body blocks. `databasePages: content` skips property-only records and writes their identities and reasons to the export report. It never removes rows from an existing database table. Do not infer that an omitted record has no information: its properties may include values hidden in a parent view. The `all` mode renders those properties. Empty trailing editor paragraphs are trimmed during rendering; internal spacing and image-only pages remain intact.

For equations, prefer Notion's `data-notion-inline-equation` / `data-notion-equation` attributes, then TeX annotations. Flattened KaTeX presentation markup is not a reliable mathematical source: it can lose operators, fractions or matrix layout. Bare display-equation line breaks exported on separate source lines are wrapped in a KaTeX `gathered` environment; existing matrix, cases, array and alignment environments remain untouched. Missing source data must produce a warning rather than an unsupported claim of formula fidelity. The print stylesheet embeds regular and italic faces for Inter and JetBrains Mono at weights 400, 600 and 700. With font synthesis disabled, omitting italic files silently renders emphasized text upright; the PDF regression checks that regular, italic and bold italic use distinct embedded faces.

Notion can mark a bookmark on the anchor inside an otherwise unclassified figure. Detect that structure before looking for images, or a favicon/thumbnail can replace the entire card and lose its text. Page references are a separate `pageLink` block. Bookmark metadata retains paragraph breaks; remote thumbnails are optional decoration and receive an informational omission entry. Do not mistake missing content images for optional decoration.

Some exports omit the anchor for a pasted URL and leave only a complete URL inside `figure > .source`. Recover a normal text link only for a safe absolute URL occupying that entire source wrapper. Do not auto-link arbitrary prose or reinterpret the block as a file/bookmark card. Ordinary links use Notion gray text with a subtle underline. Dedicated page references, file rows and bookmark cards retain their own darker block styling.

Bookmarks use one enclosing link, with independently linked captions outside it. Local thumbnails and favicons are embedded. The importer retains complete supplied metadata, while PDF cards render a bounded description preview, a two-line title and a one-line URL so arbitrary website metadata cannot create multi-page cards. Compact mode omits description and decoration entirely and records this in the report. Media detection precedes generic figure-image detection and retains nested source URLs and captions without emitting executable players.

Actual Notion `details.tab-page` exports are tabs, not toggles; render all supplied panels as named sections. Table cells containing block structure use child blocks instead of flattening paragraphs, lists and images into a single text run. Current support and unresolved cases are listed in [SUPPORT.md](SUPPORT.md).

Callout icons may live inside their own wrapper. Exclude only that icon wrapper, never the callout's body images. Iconless callouts remain iconless. Known static symbols use small locally authored vectors; no imported SVG is executed. Local raster icons use the same bounded asset loader as content images.

Block spacing is defined centrally in `print.css` through `data-block-type`. Each block gets a single leading gap, using the larger separation requested by itself and its previous neighbor. Do not rely on margin collapse: flex callouts can add margins that collapse between ordinary blocks. Ordinary block gaps scale with the body font through `rem`; the measured H1-H3 gaps use physical point values so compact presets retain Notion's whitespace. Headings have more space before than after, lists and page references stay compact, and visual blocks have a full body-font unit of separation. Structural children such as rows, cells, columns and list items keep their own layout rules.

Dividers use the ordinary text gap on both sides. Notion's exported stylesheet leaves the divider at the browser's roughly half-em block margins beside paragraphs; a section-sized gap makes the rule look detached from both neighboring blocks.

Callout content and icons share a vertical center. Strip only the first and last direct child margins inside callouts, quotes, columns, tables and expanded sections; do not strip margins from all descendant paragraphs. Labels in list items are wrapped separately so a following paragraph retains its spacing. Source-authored internal blank paragraphs remain untouched.

For a one-line callout, align the visible vector symbol to the optical center of Inter's glyphs rather than to the font line box. Apply that small lift only to the vector itself; multi-line and structured callouts keep their icon centered on the complete content box.

Small file rows stay together so their icon cannot be orphaned from the filename. A heading immediately followed by an image uses a shared pagination group, with space reserved for the title and caption; Chromium's heading `break-after` alone is insufficient for large indivisible figures. Free image widths are converted from Notion's approximately 710-pixel editor column into a percentage of the selected PDF column and centered; images in columns, tables, callouts, quotes and lists remain constrained by those containers. Oversized groups may still split when their complete content cannot fit on one page.

Notion HTML exports wrap file anchors in a padded `.source` figure, but the supplied live-editor reference uses an unboxed, indented row with an upload-document icon and a normally weighted filename. Render that compact row without inventing an `ANHANG` label, type badge or file size. Nested file rows use equal visual space above and below even when the surrounding list items arrive as separate list blocks.

Wide, rectangular tables are partitioned into groups based on physical page width and font size. The title property is repeated when its exported icon is recognized; otherwise the first column is repeated. Content lengths guide column widths within each partition. Merged/irregular cells use the unsplit fallback with a warning. This is a heuristic and still requires visual review for unusual tables.

Print styles embed Latin Inter and JetBrains Mono fonts and KaTeX font assets. No source stylesheets, JavaScript or remote fonts are executed or fetched. Only three recognized Notion property icons are redrawn from fixed local paths; arbitrary SVG is not trusted.

## Verification

```sh
npm run typecheck
npm test
npm run build
npm run test:pdf
npm audit --audit-level=moderate
```

Unit tests cover import semantics, hostile archives and links, local asset boundaries, settings, transformations, filename safety and rollback. PDF integration tests build a synthetic stress document and run the public launcher from another working directory. They verify text markers across pages, column placement, hyperlinks, bounds, table partitions, sample exports, CLI overrides and strict failure cleanup.

The same suite runs `tests/spacing.check.ts` inside Chromium with the actual renderer, styles and embedded fonts. It measures 576 block pairs at 10, 11 and 16 pt, seven callout structures, direct container edges, nested lists, centered full/half-width images and vertical multiline equations. Additional reading/print PDFs verify heading attachment and long callouts across page breaks. A 24-row fixture checks compact attachment filenames and page bounds; portrait and narrow landscape fixtures check large images with headings and captions. Geometry checks supplement visual inspection; neither alone establishes complete Notion fidelity.

The integration suite writes only synthetic material under `artifacts/pdf-tests/` and removes successful test runs by default. Set `NOTION_PDF_KEEP_TEST_ARTIFACTS=1` to retain a run for visual review. Formula regression coverage includes inline operators, Greek letters, fractions, matrices, aligned equations, cases, table formulas and scientific super/subscripts. Review representative pages as images after layout changes; extracted text alone cannot detect overlaps, bad contrast or all reading-order problems. For example, with Poppler installed:

```sh
pdftoppm -f 1 -singlefile -scale-to 1500 -png "path/to/output.pdf" artifacts/page-preview
```

The configured GitHub Actions matrix checks the source on macOS, Windows and Linux and runs actual PDF tests on macOS. A committed workflow is not evidence that those remote jobs have run. Windows/Linux PDF validation and native-export comparisons are release gates still to complete.

### Private exports

Import real exports locally with `--inspect-only` before bulk rendering. Inspect `export-report.json` afterwards and compare representative pages with the source. Do not commit exports, report contents, snapshots or screenshots from personal workspaces. When fixing a bug, create a small synthetic fixture that reproduces its structure without copying private text.

Runtime checks detect decodable images, known unsupported content, horizontal overflow and a basic PDF text layer. They do not guarantee completeness, visual parity or accessibility compliance. Distinguish these runtime checks from the stronger, synthetic content assertions in the integration suite.

## Contributing

Keep changes focused. Add regression coverage where behavior changes, run the checks above, and include a rendered example when altering pagination. Use concise English [Conventional Commits](https://www.conventionalcommits.org/) messages if committing changes.

The README follows [standard-readme](https://github.com/RichardLitt/standard-readme) as a structural guideline. Document implemented behavior, not roadmap promises. Related screenshots belong in Markdown tables with HTML `img` tags and meaningful alt text.
