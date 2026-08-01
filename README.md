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

The explicit `build` command is equivalent and is preferable in automation:

```sh
flowmatter build "docs/**/*.md" --output site --title "Order processing"
```

The default output directory is `flowmatter-dist`. It contains `flow.html`
and one `.html` page per source file with the same relative path. Existing
generated files are not overwritten unless `--force` is passed.

```text
Usage: flowmatter build <folder-or-glob> [options]
       flowmatter <folder-or-glob> [options]
       flowmatter validate <folder-or-glob> [--json]
       flowmatter schema
       flowmatter example
       flowmatter skill

Build options:
  -o, --output <directory>  Output directory (default: flowmatter-dist)
  --flow <filename>         Flow HTML filename (default: flow.html)
  --title <title>           Override the flow title
  -f, --force               Overwrite generated files
  --json                    Print the build result as JSON
  -h, --help                Show help
  -v, --version             Show the package version
```

Malformed frontmatter, duplicate IDs, conflicting module definitions, missing
relation targets, invalid generated flow data, and output collisions fail the
build with a nonzero exit code.

## Agent discovery

Agents can inspect the supported frontmatter, retrieve a complete multi-file
example, and validate their work without creating output files:

```sh
flowmatter --help
flowmatter schema
flowmatter example
flowmatter skill
flowmatter validate "docs/**/*.md" --json
flowmatter build "docs/**/*.md" --output site --json
```

`schema` and `example` print only formatted JSON. `skill` prints the bundled
standards-compliant Agent Skill. The example has a `files`
object whose keys are relative paths and whose values are complete Markdown
documents. JSON validation reports have this shape:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "missing_relation_target",
      "path": "orders/place.md",
      "message": "orders/place.md: relation target \"capture-payment\" does not exist"
    }
  ],
  "warnings": [],
  "stats": null
}
```

The schema and example can also be imported from the package:

```js
import schema from "@p10i/flowmatter/schema/frontmatter.schema.json" with { type: "json" };
import example from "@p10i/flowmatter/examples/order-processing.json" with { type: "json" };
```

The skill is exported as `@p10i/flowmatter/skills/flowmatter/SKILL.md` for
agent tooling that installs skills from package resources.

The recommended agent loop is: inspect help, inspect the schema and example,
generate Markdown, run JSON validation until it succeeds, then build.

## Library

```js
import { buildSite, validateSite } from "@p10i/flowmatter";

const validation = await validateSite({ input: "docs/**/*.md" });
if (!validation.valid) console.error(validation.errors);

const result = await buildSite({
  input: "docs/**/*.md",
  outputDir: "site",
  title: "Order processing",
});

console.log(result.flowPath, result.pages);
```
