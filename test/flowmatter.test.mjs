import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildSite, FlowmatterError, validateSite } from "../src/index.mjs";

const execFileAsync = promisify(execFile);
const cliPath = path.resolve("bin/flowmatter.mjs");

async function workspace() {
  return mkdtemp(path.join(os.tmpdir(), "flowmatter-test-"));
}

async function put(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content, "utf8");
}

test("builds a global flow and mirrored linked pages from a directory", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/orders/place.md", `---
id: place-order
title: Place order
module:
  id: orders
  name: Orders
  type: application
relations:
  - id: capture-call
    to: capture-payment
    type: capturePayment()
    relationType: call
---

Start at [payment](../payments/capture.md#details).
`);
  await put(cwd, "docs/payments/capture.md", `---
id: capture-payment
module: Payments
---

# Capture payment

## Details

Charge the card.
`);

  const result = await buildSite({ input: "docs", outputDir: "site", cwd, title: "Checkout" });

  assert.equal(result.pageCount, 2);
  assert.equal(result.flow.title, "Checkout");
  assert.deepEqual(result.flow.flows, [{
    id: "capture-call",
    type: "capturePayment()",
    relationType: "call",
    from: { module: "orders", submodule: "place-order" },
    to: { module: "payments", submodule: "capture-payment" },
  }]);
  assert.equal(result.flow.modules[0].type, "application");

  const placePage = await readFile(path.join(cwd, "site/orders/place.html"), "utf8");
  const capturePage = await readFile(path.join(cwd, "site/payments/capture.html"), "utf8");
  const flowPage = await readFile(path.join(cwd, "site/flow.html"), "utf8");
  assert.match(placePage, /href="\.\.\/payments\/capture\.html">Capture payment<\/a>/);
  assert.match(placePage, /href="\.\.\/payments\/capture\.html#details">payment<\/a>/);
  assert.match(placePage, /href="\.\.\/flow\.html">Open flow<\/a>/);
  assert.match(capturePage, /Reached from/);
  assert.match(capturePage, /Place order/);
  assert.match(flowPage, /Checkout/);
});

test("uses the glob root for mirrored paths and the default title", async () => {
  const cwd = await workspace();
  await put(cwd, "handbook/intro.md", "# Introduction\n");

  const result = await buildSite({ input: "handbook/**/*.md", outputDir: "site", cwd });

  assert.equal(result.flow.title, "Handbook");
  assert.deepEqual(result.pages, [path.join(cwd, "site/intro.html")]);
  assert.equal(result.flow.modules[0].id, "root");
  assert.equal(result.flow.modules[0].submodules[0].id, "intro");
});

test("fails before writing when a relation target is missing", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/source.md", `---
relations:
  - to: absent
    type: call
---
Source
`);

  await assert.rejects(
    buildSite({ input: "docs", outputDir: "site", cwd }),
    (error) => error instanceof FlowmatterError
      && error.message === 'source.md: relation target "absent" does not exist',
  );
});

test("rejects duplicate document IDs", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/one.md", "---\nid: duplicate\n---\nOne\n");
  await put(cwd, "docs/two.md", "---\nid: duplicate\n---\nTwo\n");

  await assert.rejects(
    buildSite({ input: "docs", outputDir: "site", cwd }),
    /two\.md: duplicate document id "duplicate" \(also used by one\.md\)/,
  );
});

test("does not overwrite generated files without force", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/page.md", "# Page\n");
  await buildSite({ input: "docs", outputDir: "site", cwd });

  await assert.rejects(
    buildSite({ input: "docs", outputDir: "site", cwd }),
    /already exists; use --force/,
  );
  await buildSite({ input: "docs", outputDir: "site", cwd, force: true });
});

test("rejects a rendered page that collides with the flow filename", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/flow.md", "# Flow\n");

  await assert.rejects(
    buildSite({ input: "docs", outputDir: "site", cwd }),
    /flow\.md: rendered page conflicts with flow\.html/,
  );
});

test("builds through the CLI", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/page.md", "# CLI page\n");

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, "docs", "--output", "site", "--title", "CLI flow"],
    { cwd },
  );

  assert.equal(stderr, "");
  assert.match(stdout, /Generated 1 page and .*site[\\/]flow\.html/);
  assert.match(await readFile(path.join(cwd, "site/page.html"), "utf8"), /CLI page/);
});

test("prints the bundled schema and multi-file example as JSON", async () => {
  const schemaResult = await execFileAsync(process.execPath, [cliPath, "schema"]);
  const exampleResult = await execFileAsync(process.execPath, [cliPath, "example"]);
  const schema = JSON.parse(schemaResult.stdout);
  const example = JSON.parse(exampleResult.stdout);

  assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  assert.deepEqual(schema.properties.relations.items.required, ["to", "type"]);
  assert.equal(Object.keys(example.files).length, 2);
  assert.match(example.files["orders/place.md"], /to: capture-payment/);
});

test("prints the bundled Agent Skill without decoration", async () => {
  const result = await execFileAsync(process.execPath, [cliPath, "skill"]);

  assert.equal(result.stderr, "");
  assert.match(result.stdout, /^---\nname: flowmatter\n/);
  assert.match(result.stdout, /flowmatter validate <folder-or-glob> --json/);
  assert.match(result.stdout, /flowmatter build <folder-or-glob>/);
});

test("validates through the library without writing output", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/page.md", "# Valid page\n");

  const validation = await validateSite({ input: "docs", cwd });

  assert.equal(validation.valid, true);
  assert.deepEqual(validation.errors, []);
  assert.deepEqual(validation.stats, { files: 1, modules: 1, relations: 0 });
  await assert.rejects(readFile(path.join(cwd, "flowmatter-dist/flow.html"), "utf8"), /ENOENT/);
});

test("prints structured JSON diagnostics for invalid input", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/source.md", `---
relations:
  - to: absent
    type: call
---
Source
`);

  const result = spawnSync(process.execPath, [cliPath, "validate", "docs", "--json"], {
    cwd,
    encoding: "utf8",
  });
  const validation = JSON.parse(result.stdout);

  assert.equal(result.status, 1);
  assert.equal(result.stderr, "");
  assert.deepEqual(validation, {
    valid: false,
    errors: [{
      code: "missing_relation_target",
      path: "source.md",
      message: 'source.md: relation target "absent" does not exist',
    }],
    warnings: [],
    stats: null,
  });
});

test("supports explicit build with a JSON result", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/page.md", "# Explicit build\n");

  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    [cliPath, "build", "docs", "--output", "site", "--json"],
    { cwd },
  );
  const result = JSON.parse(stdout);

  assert.equal(stderr, "");
  assert.equal(result.ok, true);
  assert.equal(result.pageCount, 1);
  assert.equal(result.flowPath, path.join(cwd, "site/flow.html"));
});
