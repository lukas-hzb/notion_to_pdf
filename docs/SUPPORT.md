# Notion support matrix

This document lists Notion page styles, rich-text forms, blocks, database views,
and database properties and describes their current static PDF representation.
It is a product-support reference, not a record of one test run and not a
promise of complete Notion compatibility.

Notion to PDF reads **HTML exports**, not the Notion API or a live workspace.
Features absent from exported HTML cannot be recovered. Interactive features
are represented statically where useful and safe.

Primary references:

- [Block objects](https://developers.notion.com/reference/block)
- [Rich text](https://developers.notion.com/reference/rich-text)
- [Types of content blocks](https://www.notion.com/help/guides/types-of-content-blocks)
- [Style and customize content](https://www.notion.com/help/customize-and-style-your-content)
- [Columns, headings, and dividers](https://www.notion.com/help/columns-headings-and-dividers)
- [Embeds, bookmarks, and link mentions](https://www.notion.com/help/embed-and-connect-other-apps)
- [Database views](https://www.notion.com/help/category/database-views/all)
- [Database properties](https://www.notion.com/help/database-properties)

## Status definitions

| Status | Meaning |
| :----: | :------ |
| ✅ | A deliberate, usable static representation is implemented. |
| ◐ | Partially supported; relevant information or fidelity can be lost. |
| ↻ | Intentionally converted from interactive behavior to static content. |
| — | Not reconstructed from a normal HTML export. |

“Implemented” describes current handling of recognized export markup. It does
not imply pixel-perfect output across every Notion release, page width, font,
or content combination.

## Pages and typography

| Element | Status | PDF representation or limitation |
| :------ | :----: | :------------------------------- |
| Page title | ✅ | Large document heading with controlled wrapping. |
| Emoji page icon | ✅ | Printed above the title or overlapping the cover edge. Appearance depends on available glyphs. |
| Native Notion icon | ◐ | Known symbols have safe local vectors; unknown remote or SVG icons fall back visibly. |
| Custom raster icon | ✅ | Local PNG, JPEG, GIF, or WebP is embedded. |
| Cover | ✅ | Local raster cover is cropped into a full-width banner. |
| Cover positioning | ◐ | Uses a fixed print crop; Notion's responsive browser crop cannot be reproduced exactly. |
| Default font | ✅ | Inter is embedded locally. |
| Serif page | ◐ | Export class is recognized and mapped to a serif stack; platform metrics may differ. |
| Mono page | ✅ | JetBrains Mono is embedded locally. |
| Small text | ◐ | Reproducible through `--font-size`; not every export exposes the original page setting. |
| Full width | ↻ | Represented through paper, orientation, and margin options. |
| Page properties | ✅ | Printed as a compact property table before page content. |
| Page description | ◐ | Retained only when present as exported page content. |
| Backlinks | — | Workspace relationships are unavailable in a normal HTML export. |
| Page comments | — | Comment threads outside the exported page body are unavailable. |

## Rich text and inline content

| Element | Status | PDF representation or limitation |
| :------ | :----: | :------------------------------- |
| Plain text | ✅ | Embedded Inter with print-oriented line height and spacing. |
| Bold | ✅ | Dedicated embedded bold face. |
| Italic | ✅ | Dedicated embedded italic face. |
| Bold italic | ✅ | Dedicated embedded bold-italic face. |
| Underline | ✅ | Preserved. |
| Strikethrough | ✅ | Explicit source formatting is preserved independently of task state. |
| Inline code | ✅ | Monospace inline capsule. |
| Line break | ✅ | Preserved inside the text block. |
| Superscript and subscript | ✅ | Scaled and aligned around the baseline. |
| Text color | ✅ | Gray, brown, orange, yellow, green/teal, blue, purple, pink, and red aliases. |
| Background color | ✅ | Corresponding restrained print backgrounds. |
| HTTP/HTTPS link | ✅ | Clickable gray text with a subtle underline. |
| Email link | ✅ | Safe `mailto:` targets remain clickable. |
| Phone link | ✅ | Safe `tel:` targets remain clickable. |
| Relative or internal page link | ◐ | Visible and safe, but not yet rewritten to generated PDF files. |
| Inline equation | ✅ | Rendered locally from original TeX with KaTeX; source text remains on failure. |
| User, date, page, or database mention | ↻ | Visible label and link remain; mention-specific live behavior is lost. |
| Link-preview mention | ↻ | Reduced to supplied static link information. |
| Template mention | ↻ | Visible export text remains; template actions are unavailable. |
| Text comment | — | Comment indicator and thread are not imported. |

## Basic and structural blocks

| Block | Status | PDF representation or limitation |
| :---- | :----: | :------------------------------- |
| Paragraph | ✅ | Flow text with block-specific spacing and pagination rules. |
| Intentional blank paragraph | ✅ | Internal blank space remains; empty trailing editor blocks are trimmed. |
| Heading 1–4 | ✅ | Distinct hierarchy with additional leading space and page-break protection. |
| Bulleted list | ✅ | Nested round markers with compact spacing. |
| Numbered list | ✅ | Start values and number, letter, or Roman HTML marker formats are retained. |
| To-do list | ✅ | Static checkbox or ordinary bullet according to the selected mode. |
| Completed task as bullet | ✅ | Ordinary text by default; no automatic gray or strikethrough styling. |
| Toggle | ↻ | All supplied content is visible, with a marker or as an ordinary section. |
| Toggle heading | ↻ | Printed as a heading with all nested content visible. |
| Tabs | ↻ | Every supplied tab panel becomes a labeled section. |
| Callout | ✅ | Subtle background, optional supplied icon, and structured content. |
| Quote | ✅ | Indented block with a left rule. |
| Divider | ✅ | Subtle horizontal rule with text-scale spacing on both sides. |
| Column list and column | ✅ | Relative exported widths are preserved or explicitly stacked. |
| Simple table | ✅ | Borders, headers, spans, wrapping, and structured cell content. |
| Very wide table | ↻ | Split into readable column groups with a repeated key column, or wrapped. |
| Irregular merged table | ◐ | Preserved unsplit when safe grouping cannot be inferred; manual review may be needed. |
| Child page / link to page | ✅ | Compact document row with a clickable target when supplied. |
| Child database | ◐ | Exported table or visible reference is retained; there is no dedicated live database block. |
| Breadcrumb | ◐ | Visible labels and links can pass through, but no breadcrumb trail is reconstructed. |
| Table of contents | ◐ | Exported links may remain; no page-number-aware PDF contents is generated. |
| Synced block | ↻ | Supplied content is printed normally; synchronization, permissions, and source identity are lost. |
| Template block | ◐ | Visible supplied content is retained; duplication behavior is unavailable. |

## Media, links, files, and executable blocks

| Block | Status | PDF representation or limitation |
| :---- | :----: | :------------------------------- |
| Local PNG/JPEG/GIF/WebP image | ✅ | Embedded proportionally with Notion's editor width mapped to the PDF column, centered alignment, and caption. GIF animation becomes a static frame. |
| SVG content image | — | Arbitrary SVG is not executed or embedded; safe rasterization is not implemented. |
| Remote image | ◐ | Not downloaded; a visible fallback and warning are produced. |
| Display equation | ✅ | Centered local KaTeX rendering, including bare Notion multiline expressions, with source fallback on failure. |
| Code | ✅ | Escaped monospace block with preserved indentation and language label. |
| Syntax highlighting | ◐ | Source remains readable, but token colors are not reconstructed. |
| Mermaid code | ↻ | Printed as source code; diagrams are not executed. |
| Plain link | ✅ | Gray underlined clickable text. Safe bare URLs in Notion's link wrapper are recovered. |
| Bookmark | ✅ | Clickable metadata card with supplied title, description, URL, local thumbnail, icon, and caption. |
| Compact bookmark | ✅ | Optional title-and-URL representation; intentionally omitted metadata is reported. |
| Link preview | ↻ | Static bookmark or link representation; live preview refresh is unavailable. |
| Audio | ↻ | Static media card with supplied title, source link, and caption. No playback. |
| Video | ↻ | Static media card with local poster, title, source link, and caption. No playback. |
| Embed / HTML block | ↻ | Static source card or visible fallback; remote applications and scripts are never run. |
| Embedded PDF | ↻ | Static file/source representation; pages are not recursively embedded. |
| File / attachment | ✅ | Unboxed icon-and-filename row with normal text weight and a link when resolvable. |
| Local unresolved attachment | ◐ | Filename remains visible; copying or embedding the target is not implemented. |
| Button | ↻ | Visible label or fallback; actions and automations are never executed. |
| Form | ↻ | Static fallback; fields, responses, and submission are unavailable. |
| Canvas or unknown SVG | ◐ | Visible fallback or warning; arbitrary active markup is rejected. |
| Unknown HTML structure | ◐ | Escaped text fallback and warning reduce silent data loss but cannot preserve unknown semantics. |
| Meeting notes / transcription | ↻ | Supplied text remains ordinary content; audio, speakers, and meeting logic are not reconstructed. |

## Database views

Notion databases are collections of pages. HTML exports often contain a table
plus separate record pages instead of the interactive view. Values can remain
readable while sorting, filtering, grouping, drag-and-drop, and view switching
necessarily disappear.

| View or behavior | Status | PDF representation or limitation |
| :--------------- | :----: | :------------------------------- |
| Full-page database | ↻ | Exported database content plus available record pages. |
| Inline database | ↻ | Exported table in normal document flow. |
| Linked database | ◐ | Only supplied HTML data; the workspace is not queried again. |
| Data source | ◐ | Supplied records and columns remain; source relationships are not reconstructed. |
| Table view | ✅ | Readable static table with optional wide-table partitioning. |
| List view | ◐ | Exported rows or pages can remain, but there is no view-specific renderer. |
| Board | — | No Kanban reconstruction. Visible exported values may survive in another structure. |
| Timeline | — | No time-axis reconstruction; date values may remain as text. |
| Calendar | — | No calendar grid reconstruction; date values may remain as text. |
| Gallery | — | No database-card grid reconstruction. Supplied images can remain separately. |
| Chart | — | No chart generation from database logic. A supplied raster image remains an image. |
| Dashboard | ◐ | Supplied individual blocks remain; dashboard modules and interaction do not. |
| Form | ↻ | Static fallback without fields or submission. |
| Feed | — | No feed renderer. |
| Map | — | No map renderer; place values may remain as text. |
| Filter | ↻ | The already filtered export result remains; rules are not reapplied. |
| Sort | ↻ | Exported order remains; sort rules are not reconstructed. |
| Group and subgroup | ◐ | Visible exported labels may remain; no grouping engine is applied. |
| Conditional color | ◐ | Exported Notion color classes are retained when recognizable; rules are not reconstructed. |
| Record page with body content | ✅ | Title, properties, and body are printed. |
| Property-only record page | ✅ | Included or deliberately skipped through `--database-pages`; every skip is reported. |

## Database properties

| Property | Status | Static PDF representation or limitation |
| :------- | :----: | :-------------------------------------- |
| Title / Name | ✅ | Visible text, supplied icon, and link. |
| Text | ✅ | Supplied formatted text. |
| Number | ✅ | Exported value and format text. |
| Select | ✅ | Label and exported color when recognizable. |
| Status | ✅ | Label and exported color when recognizable. |
| Multi-select | ✅ | Multiple supplied labels. |
| Date | ✅ | Exported formatted date or range. |
| Formula | ↻ | Already computed value; formulas are not recalculated. |
| Relation | ↻ | Visible related-page labels and supplied links; no generated-PDF target yet. |
| Rollup | ↻ | Already computed exported value; aggregation is not recalculated. |
| Person | ◐ | Visible name; avatar, group, and permission semantics may be lost. |
| Files and media | ◐ | Filename or local supported image; unresolved files remain visible without embedded bytes. |
| Checkbox | ✅ | Static checked or unchecked symbol. |
| URL | ✅ | Safe clickable gray link. |
| Email | ✅ | Safe clickable `mailto:` target when supplied. |
| Phone | ✅ | Safe clickable `tel:` target when supplied. |
| Created time | ✅ | Exported formatted text. |
| Created by | ✅ | Exported visible name. |
| Last edited time | ✅ | Exported formatted text. |
| Last edited by | ✅ | Exported visible name. |
| Button | ↻ | Visible label only; automation is unavailable. |
| Unique ID | ✅ | Exported identifier text when visible. |
| Place | ◐ | Exported place name or address; no map or geocoding. |
| AI autofill | ↻ | Materialized exported value only; no AI action is run. |

## Security and rendering guarantees

- Source scripts, iframes, forms, audio/video players, and arbitrary SVG DOMs
  are never executed.
- Remote resources are not fetched silently.
- Links are validated; active protocols, embedded credentials, and control
  characters are rejected.
- Regular, italic, bold, bold-italic, and monospace text use deliberate font
  faces rather than browser synthesis.
- Layout uses block-specific spacing and print rules rather than source CSS.
- Every unknown or deliberately reduced structure should remain visible or
  produce an issue; strict mode rejects known warnings.

These checks reduce known failures. They do not establish visual identity,
accessibility conformance, or complete recognition of future Notion markup.

## Current priorities

1. Copy or safely embed local attachments and rewrite internal page links to
   generated output.
2. Add static contents and breadcrumb renderers with meaningful PDF targets.
3. Improve property chips, people, place values, and tables in narrow columns.
4. Add safe opt-in SVG rasterization and remote-asset retrieval only with
   explicit URL, redirect, type, and size controls.
5. Validate the complete PDF pipeline on Windows and Linux.

When Notion changes its exports, review this file together with the document
model, HTML importer, renderer, print stylesheet, and synthetic regressions. A
feature should be marked supported only when recognition, static semantics,
visual treatment, loss reporting, and regression coverage agree.
