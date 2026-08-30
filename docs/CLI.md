# CLI reference

Notion to PDF accepts a Notion HTML export ZIP, an extracted export directory,
or one HTML file. Commands shown with `npm run export --` can also be invoked as
`notion-to-pdf` after a local `npm link`.

## Synopsis

```text
notion-to-pdf --input <ZIP|HTML|folder> --out <directory> [options]
npm run export -- --input <ZIP|HTML|folder> --out <directory> [options]
```

`--input` is required for importing or exporting. `--out` is required unless
the command only prints help, a version, diagnostics, or a page list.

## Layout options

| Option | Values | Default | Effect |
| :----- | :----- | :------ | :----- |
| `--preset` | `original`, `reading`, `print` | `original` | Applies a coordinated group of layout choices. |
| `--paper` | `A4`, `Letter` | `A4` | Selects paper size. |
| `--landscape` | flag | off | Uses landscape orientation. |
| `--margin` | `8`–`35` mm | `16` | Sets all page margins. |
| `--font-size` | `9`–`16` pt | `11` | Sets the base body size; spacing scales with it. |
| `--columns` | `preserve`, `stack` | `preserve` | Keeps exported column widths or linearizes columns. |
| `--tables` | `split`, `wrap` | `split` | Splits wide tables into groups or keeps one wrapping table. |
| `--bookmarks` | `card`, `compact` | `card` | Shows a bounded metadata preview or reduces the card to title and URL. |
| `--toggles` | `expanded`, `sections` | `expanded` | Prints open toggle markers or converts toggles into sections. |
| `--tasks` | `checkboxes`, `bullets` | `checkboxes` | Keeps static checkboxes or creates ordinary bullet points. |
| `--no-task-status` | flag | off | Removes completion state from the chosen task representation. |
| `--keep-task-status` | flag | off | Retains completion styling even when tasks become bullets. |
| `--no-page-numbers` | flag | off | Hides footer page numbers. |
| `--continuous` | flag | off | Renders every document as one dynamically sized page and disables the footer. |
| `--no-cover` | flag | off | Omits the page cover and its reserved space. Covers are otherwise retained in every preset. |

Explicit source strikethrough remains visible regardless of task settings.
Bullet mode removes completion styling by default; `--keep-task-status` opts
back into that distinction.

## Selection and validation

| Option | Values | Effect |
| :----- | :----- | :----- |
| `--database-pages` | `all`, `content` | Includes all database record pages or only records with page-body content. |
| `--list` | flag | Lists zero-based page indices without creating PDFs. |
| `--page-index` | non-negative integer | Exports one page; repeat the option to select several pages. |
| `--inspect-only` | flag | Writes an import report without creating PDFs. |
| `--strict` | flag | Stops the run when known import or layout warnings occur. |
| `--doctor` | flag | Checks Node.js, build output, and the installed print executable. |
| `--help`, `-h` | flag | Prints command help. |
| `--version` | flag | Prints the package version. |

`--doctor` verifies installation, not rendering quality. Use `npm run demo` for
a small real export and `npm run test:pdf` for the complete synthetic PDF suite.

## Presets

Presets establish defaults before individual options are applied.

| Setting | `original` | `reading` | `print` |
| :------ | :--------- | :-------- | :------ |
| Toggles | expanded | sections | sections |
| Tasks | checkboxes | bullets | bullets |
| Task status | retained | removed | removed |
| Columns | preserved | preserved | preserved |
| Font size | 11 pt | 11 pt | 10 pt |
| Database record pages | all | content only | content only |

## Examples

Export a ZIP with the reading preset:

```sh
npm run export -- \
  --input "/path/to/notion-export.zip" \
  --out "./output" \
  --preset reading
```

Export each document as one long, screen-oriented page:

```sh
npm run export -- \
  --input "/path/to/notion-export.zip" \
  --out "./output" \
  --continuous
```

The continuous mode keeps the selected paper width, determines the height from
the rendered content, and always suppresses the page-number footer. A document
may be up to 20,000 mm high; larger documents fail explicitly instead of being
silently split or reduced.

Keep every database record while using reading layout:

```sh
npm run export -- \
  --input "/path/to/notion-export.zip" \
  --out "./output" \
  --preset reading \
  --database-pages all
```

List pages, then export selected indices:

```sh
npm run export -- --input "/path/to/notion-export.zip" --list
npm run export -- \
  --input "/path/to/notion-export.zip" \
  --out "./output" \
  --page-index 0 \
  --page-index 2
```

Inspect import warnings without starting Electron:

```sh
npm run export -- \
  --input "/path/to/notion-export.zip" \
  --out "./output" \
  --inspect-only
```

## Output and reports

Each export or inspection creates a new `Notion-PDF-*` directory. A successful
PDF export contains separate PDF files and `export-report.json`; an inspection
contains only the report. Output names include a stable page-ID suffix to avoid
collisions.

The report records:

- source and runtime versions;
- generated files;
- deliberately skipped database record pages;
- informational transformations;
- import and layout warnings;
- errors that prevented completion.

A successful non-strict export may still contain warnings. Strict mode rejects
warnings known to the importer or renderer, but cannot prove that every unknown
Notion feature was detected.

## Process behavior

Progress is written to standard error. The final JSON command summary is
written to standard output, which allows automation to capture it without
mixing it with progress messages.

| Exit code | Meaning |
| :-------- | :------ |
| `0` | Command completed successfully. |
| `1` | Validation, import, rendering, or output failed. |
| `130` | A handled cancellation was received. |

For scripts, invoke the launcher directly:

```sh
node scripts/export.mjs --input "/path/to/export.zip" --out "./output"
```

Help, version, `--doctor`, `--list`, and `--inspect-only` do not start Electron.
PDF conversion starts Electron's isolated Chromium runtime without opening an
application window.

## Offline behavior

Conversion does not fetch remote assets. Local supported raster images and
bookmark decoration are embedded; external content images produce warnings and
external bookmark thumbnails or icons are omitted while retaining supplied text
and links. HEIC/HEIF images are converted locally to JPEG without changing the
source. The report distinguishes missing files, unsupported formats, failed
HEIC conversion, unsafe references, size limits, and PDF decoding failures. Use
the report to identify every omission.

## Related documentation

- [README](../README.md)
- [Notion support matrix](SUPPORT.md)
- [Development guide](DEVELOPMENT.md)
