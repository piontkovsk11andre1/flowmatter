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
7. Run `flowmatter validate <path-or-glob>... --json` with all inputs, including shared configs. Overlapping paths count once. Inferred document IDs are relative to the common input root.
8. Resolve every item in `errors` and repeat validation until `valid` is true.
9. Run `flowmatter build <path-or-glob>... --output <directory> --json` with the same inputs.
10. Report the generated `flowPath`, page count, and output directory.

Always quote glob inputs so Flowmatter receives the pattern. Do not use
`serve` as a replacement for the final build: `flowmatter serve <inputs> --port 4173` is a loopback editing preview; refresh after changes. Do not use
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

For a colored map, declare `relationTypes` in ordinary document frontmatter, e.g. `call: {label: Call, color: "#1565c0"}` under that key. Declarations merge across the input set; do not assign conflicting values to the same property.

Alternatively, use an ordered list such as `relationTypes: [{id: call, label: Call, color: "#1565c0"}]`. For a shared palette, put either form in Markdown frontmatter with `flowmatter: config`. Config files create no node or page; never use them as relation targets.

## View pages and module colors

Each graph item opens its own generated page. To give a module header and a connection their own **View** pages, use frontmatter like this in `orders/place.md`:

```yaml
module: {name: Orders, type: domain, viewUrl: ./Overview.md}
moduleTypes:
  domain: {accent: '#287768', headerBg: '#D9F0EA', headerFg: '#123D36'}
relations:
  - to: capture-payment
    type: requests payment
    relationType: call
    viewUrl: ../notes/payment-handoff.md
```

- **Module:** Declare `module.viewUrl` on one item in the module. If repeated, the declarations must resolve to the same page. `module.type` selects the card palette; `moduleTypes` can also live in a shared config and merges by ID and property like `relationTypes`.
- **Connection:** `to` is the destination item's ID; `viewUrl` is the document explaining the connection. For grouped connections, use the same view URL on every member if the group should offer **View**.
- **Inputs:** Resolve view paths relative to the declaring Markdown file. Include both the overview and the connection note in validation and build inputs. Use plain Markdown without graph frontmatter for these pages: Flowmatter renders them once without adding map items. Use `flowmatter: config` only for declarations that should produce no page.
