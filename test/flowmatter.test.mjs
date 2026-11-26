import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { buildSite, FlowmatterError, querySite, validateSite } from "../src/index.mjs";

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

test("queries typed incoming relations across a cycle and reports omitted nodes", async () => {
  const cwd = await workspace();
  await put(cwd, 'docs/services/a.md', '---\nid: a\nrelations: [{to: b, type: invokes, relationType: uses}]\n---\n# Service A');
  await put(cwd, 'docs/b.md', '---\nrelations: [{to: a, type: uses}]\n---\n# B');
  await put(cwd, 'docs/c.md', '---\nrelations: [{to: a, type: uses}, {to: b, type: reads}]\n---\n# C');
  const options = { cwd, input: 'docs', from: 'b', direction: 'incoming', relation: 'uses', depth: 3 };
  const { stdout } = await execFileAsync(process.execPath, [cliPath, 'query', 'docs', '--from', 'b', '--direction', 'incoming', '--relation', 'uses', '--depth', '3', '--json'], { cwd });
  const result = JSON.parse(stdout);
  assert.deepEqual(result.nodes.map(n => [n.id, n.distance]), [['b', 0], ['a', 1], ['c', 2]]);
  assert.equal(result.nodes[1].path, 'services/a.md');
  assert.deepEqual(result.edges.map(e => [e.from, e.to]), [['a', 'b'], ['b', 'a'], ['c', 'a']]);
  assert.equal(result.truncated, false);
  const limited = await querySite({ ...options, limit: 2 });
  assert.equal(limited.nodes.length, 2);
  assert.equal(limited.truncated, true);
  assert.ok(limited.edges.every(e => e.from !== 'c'));
  assert.deepEqual((await querySite({ ...options, depth: 0 })).edges, []);
  await assert.rejects(querySite({ ...options, from: 'absent' }), { code: 'unknown_document_id' });
});

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
  assert.equal(Object.hasOwn(result.flow, "relationTypes"), false);
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
  assert.doesNotMatch(placePage, />Open flow<\/a>/);
  assert.match(capturePage, /Reached from/);
  assert.match(capturePage, /Place order/);
  assert.match(flowPage, /Checkout/);
});

test("a connection can open a mirrored Markdown page without adding a map item", async () => {
  const cwd = await workspace();
  await put(cwd, 'docs/items/a.md', '---\nid: a\nrelations:\n  - {to: a, type: retries, viewUrl: "../notes/Retry policy.md"}\n---\n# Task');
  await put(cwd, 'docs/notes/Retry policy.md', '# Retry policy\n\nKeep the failed attempt.');
  const site = await buildSite({ cwd, input: 'docs' });
  assert.equal(site.pageCount, 2);
  assert.deepEqual(site.flow.modules.flatMap(m => m.submodules.map(s => s.id)), ['a']);
  assert.equal(site.flow.flows[0].viewUrl, './notes/Retry%20policy.html');
  assert.match(await readFile(path.join(site.outputDir, 'notes/Retry policy.html'), 'utf8'), /Keep the failed attempt/);
  const missing = await validateSite({ cwd, input: 'docs/items/a.md' });
  assert.equal(missing.valid, false);
  assert.match(missing.errors[0].message, /relations\[0\].viewUrl/);
});

test("embeds merged declarations in Flowjob data and allows undeclared relation types alongside them", async () => {
  const cwd = await workspace();
  await put(cwd, "docs/start.md", `---
relationTypes:
  call: {label: Call, color: '#abc'}
relations:
  - {to: end, type: invoke, relationType: call}
  - {to: end, type: notify, relationType: legacy}
---\n`);
  await put(cwd, "docs/end.md", `---
relationTypes:
  call: {color: '#abc', previewColor: '#11223344'}
  event: {label: Event}
---\n`);
  const { flowPath } = await buildSite({ input: "docs", cwd });
  const html = await readFile(flowPath, "utf8");
  const payload = html.match(/^window\.MAP_DATA=(.+);$/m);
  assert.ok(payload, "Flowjob map payload is present");
  const data = JSON.parse(payload[1]);
  assert.deepEqual(data.relationTypes, {
    call: { label: "Call", color: "#abc", previewColor: "#11223344" }, event: { label: "Event" },
  });
  assert.deepEqual(data.flows.map(({ type, relationType }) => [type, relationType]), [["invoke", "call"], ["notify", "legacy"]]);
});

test("conflicts identify the documents declaring the property, not just the type", async () => {
  const cwd = await workspace();
  for (const [name, properties] of [["a", "label: Call"], ["b", "color: '#abc'"], ["c", "color: '#def'"]]) {
    await put(cwd, `docs/${name}.md`, `---\nrelationTypes:\n  call: {${properties}}\n---\n`);
  }
  const { valid, errors: [error] } = await validateSite({ input: "docs", cwd });
  assert.equal(valid, false);
  assert.equal(error.code, "conflicting_relation_type");
  assert.equal(error.path, "c.md");
  assert.match(error.message, /c\.md: .*call.*\.color.*b\.md/);
});

test("malformed relation styles report their source and invalid field", async () => {
  const cwd = await workspace();
  for (const [value, location] of [
    ["false", "relationTypes"], ["{call: null}", 'relationTypes["call"]'],
    ["[null]", "relationTypes[0]"], ["[{label: Call}]", "relationTypes[0].id"],
    ["[{id: 123}]", "relationTypes[0].id"], ["[{id: call, color: red}]", "relationTypes[0].color"],
    ['{" ": {}}', 'relationTypes[" "]'], ['{call: {label: " "}}', '.label'],
    ["{call: {color: 123}}", '.color'], ["{call: {previewColor: '#abcdef;display:none'}}", '.previewColor'],
    ["{call: {colour: '#abc'}}", '.colour'],
  ]) {
    await put(cwd, "docs/page.md", `---\nrelationTypes: ${value}\n---\n`);
    const { valid, errors: [error] } = await validateSite({ input: "docs", cwd });
    assert.equal(valid, false, value);
    assert.equal(error.code, "invalid_relation_types");
    assert.equal(error.path, "page.md");
    assert.ok(error.message.includes(location), error.message);
  }
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

test("overlapping files, directories and globs share one root and config palette", async () => {
  const cwd = await workspace();
  const input = ["book/steps/*.md", "book/flow.md", "book/steps", "book/steps/start.md"];
  await put(cwd, "book/flow.md", `---
flowmatter: config
relationTypes:
  - {id: notify, label: Notify}
  - {id: call, color: '#123'}
---\n`);
  await put(cwd, "book/steps/start.md", `---
relationTypes: {call: {label: Call}}
relations: [{to: steps/end, type: invoke, relationType: call}]
---\n`);
  await put(cwd, "book/steps/end.md", "# End\n");
  const { flow, pages } = await buildSite({ cwd, input });
  assert.equal(flow.title, "Book");
  assert.deepEqual(Object.keys(flow.relationTypes), ["notify", "call"]);
  assert.deepEqual(flow.relationTypes.call, { label: "Call", color: "#123" });
  assert.deepEqual(flow.modules.map(m => m.id), ["steps"]);
  assert.deepEqual(pages.map(p => path.relative(cwd, p)), ["flowmatter-dist/steps/end.html", "flowmatter-dist/steps/start.html"].map(path.normalize));
  const { stdout } = await execFileAsync(process.execPath, [cliPath, "validate", ...input, "--json"], { cwd });
  assert.deepEqual(JSON.parse(stdout).stats, { files: 2, modules: 1, relations: 1 });

  await put(cwd, "book/steps/end.md", "---\nrelationTypes: {call: {color: '#456'}}\n---\n");
  const { errors: [error] } = await validateSite({ cwd, input });
  assert.equal(error.code, "conflicting_relation_type");
  assert.equal(error.path, "steps/end.md");
  assert.match(error.message, /call.*color.*flow\.md/);
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
  assert.match(result.stdout, /flowmatter validate <path-or-glob>\.\.\. --json/);
  assert.match(result.stdout, /flowmatter build <path-or-glob>/);
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
