# flowmatter

`flowmatter` turns Markdown files selected by path, folder, or glob into one interactive
[flowjob](https://github.com/piontkovsk11andre1/flowjob) map and a mirrored tree
of linked, standalone HTML pages.

## Requirements

- Node.js 20 or newer

## Install

```sh
npm install @p10i/flowmatter
```

## Markdown schema

Each non-config Markdown file is a flowjob submodule. Its frontmatter defines its stable
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

To give a connection its own **View** page, set `viewUrl: ../notes/retry-policy.md` on the relation. The path is relative to the declaring document; include the target in the build inputs. A referenced plain Markdown file needs no frontmatter: it renders once in the output directory without becoming a graph item. Multiple connections can share the page.

Any input document can define map-wide styles in its frontmatter:

```yaml
relationTypes:
  call: { label: Call, color: "#1565c0" }
```

A relation with `relationType: call` uses that style; its `type` remains the individual connection label. Definitions merge by type and property across documents. Identical values are allowed, and conflicting values report both paths. An undeclared type keeps the default style. Optional `color` and `previewColor` accept quoted hex colors (3, 4, 6 or 8 digits).

For a shared palette, include a Markdown file such as `styles.md`:

```yaml
---
flowmatter: config
relationTypes:
  - { id: call, label: Call, color: "#1565c0" }
  - { id: event, label: Event, color: "#c60" }
---
```

Either declaration form works in ordinary documents and config files. Lists are read in declaration order. A config contributes only definitions: it has no node, page, or target ID. Include at least one ordinary document.

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

### Preview while editing

`flowmatter serve docs --port 4173` serves the map at `http://127.0.0.1:4173/` and watches the same files, directories and quoted globs accepted by `build`. Refresh the browser after editing. New and removed pages are reflected together with the rebuilt map. Invalid edits are reported in the terminal; after startup, the last successful preview stays available until the inputs are valid again. The preview is in memory. Use `build` to write a distributable site, and Ctrl+C to stop serving.

### Module colors

A module can open its own documentation: set `module: {name: Orders, viewUrl: ./Overview.md}` on any one of its items. Include the overview in the build inputs. Plain Markdown overviews render as pages without becoming map items. Declarations for the same module must resolve to the same page.

Use `module.type` to select a graph card palette. The definition can live on the same page or in a shared config document. Like `relationTypes`, `moduleTypes` accepts a mapping or a list and merges declarations across pages.

```yaml
module: {name: Orders, type: domain}
moduleTypes:
  domain: {accent: '#287768', headerBg: '#D9F0EA', headerFg: '#123D36'}
```

Dark mode derives the card tint from `accent`.

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
flowmatter build styles.md "docs/**/*.md" --output site --title "Order processing"
```

The default output directory is `flowmatter-dist`. It contains `flow.html`
and one `.html` page per non-config document. Each input must match Markdown;
overlapping paths are processed once. Mirrored paths, inferred IDs, and the
default title use the common ancestor of the input roots (a file's parent,
the selected directory, or the directory before a glob's first wildcard). Existing
generated files are not overwritten unless `--force` is passed.

```text
Usage: flowmatter build <path-or-glob>... [options]
       flowmatter <path-or-glob>... [options]
       flowmatter validate <path-or-glob>... [--json]
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

## Query the document graph

```sh
flowmatter query docs --from payment-service --direction incoming --relation uses --depth 2 --limit 20 --json
```

`query` reads the same files, directories or quoted globs as `validate` and prints JSON without building HTML. Start at a **document ID**. By default it follows outgoing relations for one hop; use `incoming` to find documents referring to the start, or `both` to walk either way. `--relation` matches `relationType` when present, otherwise `type`.

`nodes` are in breadth-first order, with `id`, `title`, Markdown `path` relative to `baseDir`, and shortest `distance` from the start. `edges` are the matching relations traversed, in their original direction. `--depth 0` returns only the start. `--limit` caps nodes including the start (default 100); `truncated` is true if that limit omitted a reachable node within the requested depth.

## Agent discovery

### HTTP and MCP

Run `flowmatter api docs --mcp` to serve the graph on `http://127.0.0.1:4174`. The input paths or quoted globs belong to the server and are resolved on each operation. Discover tools with `GET /tools`; call one with `POST /tools/<name>` and a JSON argument object. Success responses contain `result`. The CLI can call the same service:

```sh
flowmatter call validate --url http://127.0.0.1:4174
flowmatter call query --url http://127.0.0.1:4174 --args '{"from":"payment-service","direction":"incoming"}'
```

For MCP, choose the transport supported by your client:

| Transport | Configuration |
| --- | --- |
| Local stdio | Launch `flowmatter mcp /absolute/path/to/docs`. |
| Native Streamable HTTP | Connect to `http://127.0.0.1:4174/mcp` after starting `api` with `--mcp`. |
| Stdio proxy to HTTP | Launch `flowmatter mcp --url http://127.0.0.1:4174`. The proxy uses the HTTP API and never falls back to local files. |

All three offer `query`, `validate`, `schema`, `example`, and `skill`. The last three are also MCP resources (`flowmatter://schema`, `flowmatter://example`, `flowmatter://skill`). Set `--output <directory>` at server startup to enable the `build` tool; existing outputs are protected against overwrites. The API binds only to loopback. `flowmatter serve` remains the separate HTML preview.

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

const input = ["styles.md", "docs/**/*.md"]; // A single string also works.
const validation = await validateSite({ input });
if (!validation.valid) console.error(validation.errors);

const result = await buildSite({
  input,
  outputDir: "site",
  title: "Order processing",
});

console.log(result.flowPath, result.pages);
```
