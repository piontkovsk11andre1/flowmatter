---
name: flowmatter
description: Generate and validate interactive flow maps and linked standalone HTML pages from relationships in Markdown frontmatter. Use when creating, editing, checking, or rendering a set of Flowmatter Markdown documents.
license: ISC
compatibility: Requires Node.js 20 or newer and the @p10i/flowmatter package.
metadata:
  author: p10i
  version: "0.1.1"
---

# Flowmatter

Use Flowmatter to model directed relationships between Markdown documents and
render one interactive flowjob map plus linked standalone HTML pages.

## Workflow

1. Confirm the CLI is available with `flowmatter --version`. If it is not
   installed, use `npx --package @p10i/flowmatter flowmatter` as the command.
2. Run `flowmatter schema` and inspect the complete frontmatter schema.
3. Run `flowmatter example` and inspect both files in the returned `files`
   object. Relations require at least two documents unless they are self-links.
4. Inspect the target Markdown files before editing them.
5. Give documents stable `id` values when relations refer to them. Keep module
   IDs and definitions consistent across files.
6. Define each outgoing relation in its source document with non-empty `to`
   and `type` values. The `to` value must equal a target document ID.
7. Run `flowmatter validate <folder-or-glob> --json` before building.
8. Resolve every item in `errors` and repeat validation until `valid` is true.
9. Run `flowmatter build <folder-or-glob> --output <directory> --json`.
10. Report the generated `flowPath`, page count, and output directory.

Always quote glob inputs so Flowmatter receives the pattern. Do not use
`--force` unless overwriting existing generated files is explicitly intended.
Do not edit generated HTML when the source Markdown can be corrected instead.

## Minimal frontmatter

```yaml
---
id: place-order
title: Place order
module: Orders
relations:
  - to: capture-payment
    type: capturePayment()
    relationType: call
---
```

Fields may be inferred, but explicit stable IDs are preferable for documents
that participate in relations. Use the schema output as the authoritative
field reference and JSON validation diagnostics as the authoritative check.
