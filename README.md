# flowmatter

`flowmatter` turns a folder or glob of Markdown files into one interactive
[flowjob](https://github.com/piontkovsk11andre1/flowjob) map and a mirrored tree
of linked, standalone HTML pages.

## Requirements

- Node.js 20 or newer

## Install

```sh
npm install @p10i/flowmatter
```

## Markdown schema

Each Markdown file is a flowjob submodule. Its frontmatter defines its stable
identity, parent module, and outgoing relations:

```markdown
---
id: place-order
title: Place order
module:
  id: orders
  name: Orders
  type: application
relations:
  - id: charge-card
    to: capture-payment
    type: capturePayment()
    relationType: call
---

# Place order

Validate the order and request payment.
```

`relations[].to` references another document's `id`. `relations[].type` is the
flow label. `relations[].id` and `relations[].relationType` are optional; an
omitted relation ID is generated as `<document-id>:<one-based-index>`.

The following values are inferred when omitted:

| Field | Default |
| --- | --- |
| `id` | Relative Markdown path without `.md` |
| `title` | First level-one heading, then filename |
| `module` | Parent directory, or `root` for top-level files |
| `module.id` | Slug of `module.name` |
| `module.name` | `module.id` or parent directory name |

A string module is shorthand for a named module with a slug-generated ID:

```yaml
module: Orders
```

## CLI

Build every Markdown file under a directory:

```sh
flowmatter docs --output site
```

Build a glob relative to the current directory:

```sh
flowmatter "docs/**/*.md" --output site --title "Order processing"
```

The default output directory is `flowmatter-dist`. It contains `flow.html`
and one `.html` page per source file with the same relative path. Existing
generated files are not overwritten unless `--force` is passed.

```text
Usage: flowmatter <folder-or-glob> [options]

Options:
  -o, --output <directory>  Output directory (default: flowmatter-dist)
  --flow <filename>         Flow HTML filename (default: flow.html)
  --title <title>           Override the flow title
  -f, --force               Overwrite generated files
  -h, --help                Show help
  -v, --version             Show the package version
```

Malformed frontmatter, duplicate IDs, conflicting module definitions, missing
relation targets, invalid generated flow data, and output collisions fail the
build with a nonzero exit code.

## Library

```js
import { buildSite } from "@p10i/flowmatter";

const result = await buildSite({
  input: "docs/**/*.md",
  outputDir: "site",
  title: "Order processing",
});

console.log(result.flowPath, result.pages);
```
