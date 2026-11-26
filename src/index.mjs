import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFlow, validateFlow } from "@p10i/flowjob";
import { glob } from "glob";
import globParent from "glob-parent";
import matter from "gray-matter";
import { marked } from "marked";

const PAGE_STYLE = `
:root { color-scheme: light dark; font-family: Aptos, "Segoe UI Variable", "Segoe UI", sans-serif; line-height: 1.55;
  --surface: #fcfeff; --text: #142236; --muted: #58708f; --border: #b9cde9; --tint: #e7f0ff; --link: #1855aa; }
@media (prefers-color-scheme: dark) { :root {
  --surface: #0a121f; --text: #e8f1ff; --muted: #9ab2d5; --border: #294266; --tint: #111d32; --link: #8ab9ff; } }
body { margin: 0; background: var(--surface); color: var(--text); }
main { box-sizing: border-box; width: 100%; min-height: 100vh; margin: 0; padding: calc(.5rem + 5px) calc(.75rem + 5px); overflow-wrap: anywhere; }
h1, h2, h3 { line-height: 1.25; }
h1 { font-size: clamp(1.5rem, 4vw, 2rem); margin: .5em 0; }
a { color: var(--link); text-underline-offset: .18em; }
a:focus-visible { outline: 2px solid var(--link); outline-offset: 2px; }
.eyebrow, .relations { font-size: .875rem; }
.eyebrow { color: var(--muted); font-weight: 600; }
.relations { border-top: 1px solid var(--border); margin-top: 2rem; padding-top: .75rem; }
.relations small, article :not(pre) > code { border-radius: .35rem; padding: .1em .4em; background: var(--tint); }
.relations small { color: var(--muted); }
.relations section { margin: .4rem 0; }
.relations h2 { font-size: inherit; margin: 0; }
.relations ul { margin: .15rem 0; padding-left: 1.25rem; }
article img { height: auto; max-width: 100%; }
article pre { overflow-x: auto; padding: .75rem; border: 1px solid var(--border); border-radius: .5rem; background: var(--tint); }
article table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
article th, article td { border: 1px solid var(--border); text-align: start; padding: .35rem .6rem; }
article th { background: var(--tint); }
article blockquote { margin-inline: 0; padding-inline: 1rem; border-inline-start: 3px solid var(--border); color: var(--muted); }
article code { font-family: "SFMono-Regular", Consolas, monospace; }
`;

export class FlowmatterError extends Error {
  constructor(message, { code = "invalid_input", path: errorPath = null } = {}) {
    super(message);
    this.name = "FlowmatterError";
    this.code = code;
    this.path = errorPath;
  }
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function toPosix(value) {
  return value.split(path.sep).join("/");
}

function slugify(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "root";
}

function titleFromContent(content, fallback) {
  const heading = content.match(/^#\s+(.+?)\s*$/m)?.[1];
  return heading || fallback.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function describeModule(value, relativePath) {
  const directory = path.posix.dirname(relativePath);
  const fallbackId = directory === "." ? "root" : directory;
  const fallbackName = directory === "." ? "Root" : titleFromContent("", path.posix.basename(directory));

  if (value === undefined) {
    return { id: fallbackId, name: fallbackName };
  }
  if (isNonEmptyString(value)) {
    return { id: slugify(value), name: value.trim() };
  }
  if (!isObject(value)) {
    throw new FlowmatterError(`${relativePath}: "module" must be a string or object`, {
      code: "invalid_module",
      path: relativePath,
    });
  }

  const id = value.id ?? (isNonEmptyString(value.name) ? slugify(value.name) : fallbackId);
  const name = value.name ?? (isNonEmptyString(value.id) ? value.id : fallbackName);
  if (!isNonEmptyString(id) || !isNonEmptyString(name)) {
    throw new FlowmatterError(`${relativePath}: module "id" and "name" must be non-empty strings`, {
      code: "invalid_module",
      path: relativePath,
    });
  }
  if (value.type !== undefined && !isNonEmptyString(value.type)) {
    throw new FlowmatterError(`${relativePath}: module "type" must be a non-empty string`, {
      code: "invalid_module",
      path: relativePath,
    });
  }
  return { id: id.trim(), name: name.trim(), ...(value.type ? { type: value.type.trim() } : {}) };
}

function mergeTypes(types, source, fieldName) {
  const { relativePath } = source;
  const relationTypes = source[fieldName];
  const modules = fieldName === 'moduleTypes';
  if (relationTypes === undefined) return;
  const isMapping = (value) => isObject(value) && Object.getPrototypeOf(value) === Object.prototype;
  const invalid = (message) => {
    throw new FlowmatterError(`${relativePath}: ${message}`, { code: modules ? 'invalid_module_types' : 'invalid_relation_types', path: relativePath });
  };
  const list = Array.isArray(relationTypes);
  if (!list && !isMapping(relationTypes)) invalid(`${fieldName} must be a mapping or a list of definitions`);

  for (const [index, definition] of Object.entries(relationTypes)) {
    const location = `${fieldName}[${list ? index : JSON.stringify(index)}]`;
    if (!isMapping(definition)) invalid(`${location} must be an object`);
    const key = list ? definition.id : index;
    if (!isNonEmptyString(key) || key !== key.trim()) invalid(`${location}${list ? '.id' : ''} needs a non-empty ID without surrounding whitespace`);
    if (!types.has(key)) types.set(key, { style: {}, sources: new Map() });
    const { style, sources } = types.get(key);
    for (const [field, value] of Object.entries(definition)) {
      if (list && field === "id") continue;
      if (field === "label" || (!modules && field === "hint")) {
        if (!isNonEmptyString(value)) invalid(`${location}.${field} must be a non-empty string`);
      } else if ((modules ? ['accent','surface','headerBg','headerFg','footerFg'] : ['color','previewColor']).includes(field)) {
        if (typeof value !== "string" || !/^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) {
          invalid(`${location}.${field} must be a hex color with 3, 4, 6, or 8 digits`);
        }
      } else {
        invalid(`${location}.${field} is not a supported property`);
      }
      if (sources.has(field) && style[field] !== value) {
        throw new FlowmatterError(`${relativePath}: ${location}.${field} (${key}) conflicts with the declaration in ${sources.get(field)}`, {
          code: modules ? 'conflicting_module_type' : 'conflicting_relation_type', path: relativePath,
        });
      }
      if (!sources.has(field)) {
        style[field] = value;
        sources.set(field, relativePath);
      }
    }
  }
}

function parseRelations(value, relativePath) {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new FlowmatterError(`${relativePath}: "relations" must be an array`, {
      code: "invalid_relations",
      path: relativePath,
    });
  }

  return value.map((relation, index) => {
    const location = `${relativePath}: relations[${index}]`;
    if (!isObject(relation)) {
      throw new FlowmatterError(`${location} must be an object`, { code: "invalid_relation", path: relativePath });
    }
    if (!isNonEmptyString(relation.to)) {
      throw new FlowmatterError(`${location}.to must be a non-empty string`, { code: "invalid_relation", path: relativePath });
    }
    if (!isNonEmptyString(relation.type)) {
      throw new FlowmatterError(`${location}.type must be a non-empty string`, { code: "invalid_relation", path: relativePath });
    }
    if (relation.id !== undefined && !isNonEmptyString(relation.id)) {
      throw new FlowmatterError(`${location}.id must be a non-empty string`, { code: "invalid_relation", path: relativePath });
    }
    if (relation.relationType !== undefined && !isNonEmptyString(relation.relationType)) {
      throw new FlowmatterError(`${location}.relationType must be a non-empty string`, {
        code: "invalid_relation",
        path: relativePath,
      });
    }
    return {
      ...(relation.id ? { id: relation.id.trim() } : {}),
      to: relation.to.trim(),
      type: relation.type.trim(),
      ...(relation.viewUrl !== undefined ? { viewPath: relation.viewUrl } : {}),
      ...(relation.relationType ? { relationType: relation.relationType.trim() } : {}),
    };
  });
}

function pageUrl(relativePath) {
  return `./${relativePath.split("/").map(encodeURIComponent).join("/")}`;
}

function resolveRelationViews(sources) {
  const bySource = new Map(sources.map(source => [source.relativePath, source]));
  const byPage = new Map();
  for (const source of sources) {
    if (source.config) continue;
    const page = source.outputRelativePath;
    if (byPage.has(page)) {
      throw new FlowmatterError(`${source.relativePath} and ${byPage.get(page).relativePath} both render to ${page}`, {
        code: "output_collision", path: source.relativePath,
      });
    }
    byPage.set(page, source);
  }
  for (const [page, source] of byPage) {
    for (let dir = path.posix.dirname(page); dir !== "."; dir = path.posix.dirname(dir)) {
      if (byPage.has(dir)) throw new FlowmatterError(`${source.relativePath}: output directory ${dir} conflicts with the page for ${byPage.get(dir).relativePath}`, {
        code: "output_collision", path: source.relativePath,
      });
    }
    function resolveView(ref, field, code) {
      if (ref === undefined) return;
      const fail = message => {
        throw new FlowmatterError(`${source.relativePath}: ${field} ${message}`, {
          code, path: source.relativePath,
        });
      };
      if (!isNonEmptyString(ref) || ref.startsWith("/") || /[\\:\x00-\x1f]/.test(ref) || !/\.(?:[mM][dD]|html)$/.test(ref)) {
        fail("must be a local relative .md path or generated .html path");
      }
      const key = path.posix.join(path.posix.dirname(source.relativePath), ref);
      if (key.startsWith("../")) fail(`points outside the input root: ${ref}`);
      const target = /\.md$/i.test(ref) ? bySource.get(key) : byPage.get(key);
      if (!target) fail(`does not match a page in the selected inputs: ${ref}`);
      if (target.config) fail(`references a configuration file: ${ref}`);
      if (/[\\:\x00-\x1f]/.test(target.outputRelativePath)) fail(`references a path Flowjob cannot display: ${key}`);
      if (!target.explicitGraph) target.pageOnly = true;
      return pageUrl(target.outputRelativePath);
    }
    if (source.moduleViewPath !== undefined) {
      source.module.viewUrl = resolveView(source.moduleViewPath, 'module.viewUrl', 'invalid_module_view_url');
    }
    source.relations.forEach((relation, index) => {
      if (relation.viewPath !== undefined) relation.viewUrl = resolveView(relation.viewPath, `relations[${index}].viewUrl`, 'invalid_relation_view_url');
    });
  }
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function resolveInput(input, cwd) {
  const resolved = path.resolve(cwd, input);
  try {
    const details = await stat(resolved);
    if (details.isDirectory()) {
      return {
        baseDir: resolved,
        files: await glob("**/*.md", { absolute: true, cwd: resolved, nodir: true }),
      };
    }
    if (details.isFile()) return { baseDir: path.dirname(resolved), files: [resolved] };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const baseDir = path.resolve(cwd, globParent(input));
  const files = await glob(input, { absolute: true, cwd, nodir: true });
  return { baseDir, files };
}

export async function resolveMarkdownInputs(input, cwd) {
  const inputs = Array.isArray(input) ? input : [input];
  if (!inputs.length || !inputs.every(isNonEmptyString)) throw new FlowmatterError("One or more Markdown paths or globs are required");
  const files = new Set();
  let baseDir;
  for (const spec of new Set(inputs)) {
    const resolved = await resolveInput(spec, cwd);
    const matches = resolved.files.filter((file) => /\.md$/i.test(file));
    if (!matches.length) throw new FlowmatterError(`No Markdown files matched "${spec}"`, { code: "no_markdown_files", path: spec });
    for (const file of matches) files.add(path.resolve(file));
    baseDir ??= resolved.baseDir;
    if (path.parse(baseDir).root !== path.parse(resolved.baseDir).root) throw new FlowmatterError("Inputs must share a filesystem root");
    while (true) {
      const relative = path.relative(baseDir, resolved.baseDir);
      if (relative !== ".." && !relative.startsWith(`..${path.sep}`)) break;
      baseDir = path.dirname(baseDir);
    }
  }
  const markdownFiles = [...files].sort((left, right) => left.localeCompare(right));
  return {baseDir, markdownFiles};
}

async function readDocuments(input, cwd, resolvedInputs) {
  const {baseDir, markdownFiles} = resolvedInputs ?? await resolveMarkdownInputs(input, cwd);

  const sources = await Promise.all(markdownFiles.map(async (sourcePath) => {
    const relativePath = toPosix(path.relative(baseDir, sourcePath));
    if (relativePath === ".." || relativePath.startsWith("../")) {
      throw new FlowmatterError(`${sourcePath}: matched file is outside the input root`, {
        code: "outside_input_root",
        path: sourcePath,
      });
    }

    let parsed;
    try {
      parsed = matter(await readFile(sourcePath, "utf8"));
    } catch (error) {
      throw new FlowmatterError(`${relativePath}: invalid frontmatter (${error.message})`, {
        code: "invalid_frontmatter",
        path: relativePath,
      });
    }

    if (!isObject(parsed.data)) {
      throw new FlowmatterError(`${relativePath}: frontmatter must be an object`, {
        code: "invalid_frontmatter",
        path: relativePath,
      });
    }

    if (parsed.data.flowmatter === "config") return { config: true, relativePath, relationTypes: parsed.data.relationTypes, moduleTypes: parsed.data.moduleTypes };

    const fallbackId = relativePath.replace(/\.md$/i, "");
    const id = parsed.data.id ?? fallbackId;
    const title = parsed.data.title ?? titleFromContent(parsed.content, path.posix.basename(fallbackId));
    if (!isNonEmptyString(id)) {
      throw new FlowmatterError(`${relativePath}: "id" must be a non-empty string`, {
        code: "invalid_document_id",
        path: relativePath,
      });
    }
    if (!isNonEmptyString(title)) {
      throw new FlowmatterError(`${relativePath}: "title" must be a non-empty string`, {
        code: "invalid_document_title",
        path: relativePath,
      });
    }

    return {
      id: id.trim(),
      explicitGraph: ["id", "title", "module", "relations", "relationTypes", "moduleTypes"].some(key => Object.hasOwn(parsed.data, key)),
      title: title.trim(),
      module: describeModule(parsed.data.module, relativePath),
      moduleViewPath: parsed.data.module?.viewUrl,
      relationTypes: parsed.data.relationTypes,
      moduleTypes: parsed.data.moduleTypes,
      relations: parseRelations(parsed.data.relations, relativePath),
      content: parsed.content,
      sourcePath,
      relativePath,
      outputRelativePath: relativePath.replace(/\.md$/i, ".html"),
    };
  }));
  const relationTypes = new Map();
  const moduleTypes = new Map();
  for (const source of sources) {
    mergeTypes(relationTypes, source, 'relationTypes');
    mergeTypes(moduleTypes, source, 'moduleTypes');
  }
  const documents = sources.filter((source) => !source.config);
  resolveRelationViews(sources);
  if (!documents.length) throw new FlowmatterError("Inputs contain only configuration; at least one document is required", { code: "no_documents" });
  return { baseDir, documents, relationTypes, moduleTypes };
}

function compile(documents, title, relationTypes, moduleTypes) {
  const byId = new Map();
  const modules = new Map();
  const flowIds = new Map();

  const graphDocuments = documents.filter(document => !document.pageOnly);
  for (const document of graphDocuments) {
    if (byId.has(document.id)) {
      throw new FlowmatterError(
        `${document.relativePath}: duplicate document id "${document.id}" (also used by ${byId.get(document.id).relativePath})`,
        { code: "duplicate_document_id", path: document.relativePath },
      );
    }
    byId.set(document.id, document);

    const existing = modules.get(document.module.id);
    if (existing && (
      existing.name !== document.module.name
      || (existing.viewUrl && document.module.viewUrl && existing.viewUrl !== document.module.viewUrl)
      || (existing.type && document.module.type && existing.type !== document.module.type)
    )) {
      throw new FlowmatterError(`${document.relativePath}: module "${document.module.id}" conflicts with an earlier definition`, {
        code: "conflicting_module",
        path: document.relativePath,
      });
    }
    if (!existing) modules.set(document.module.id, { ...document.module, submodules: [] });
    if (existing && !existing.type && document.module.type) existing.type = document.module.type;
    if (existing && !existing.viewUrl && document.module.viewUrl) existing.viewUrl = document.module.viewUrl;
    modules.get(document.module.id).submodules.push({ id: document.id, name: document.title, viewUrl: pageUrl(document.outputRelativePath) });
  }

  const flows = [];
  for (const document of graphDocuments) {
    document.relations.forEach((relation, index) => {
      const target = byId.get(relation.to);
      if (!target) {
        throw new FlowmatterError(`${document.relativePath}: relation target "${relation.to}" does not exist`, {
          code: "missing_relation_target",
          path: document.relativePath,
        });
      }
      const id = relation.id ?? `${document.id}:${index + 1}`;
      if (flowIds.has(id)) {
        throw new FlowmatterError(`${document.relativePath}: duplicate relation id "${id}" (also used by ${flowIds.get(id)})`, {
          code: "duplicate_relation_id",
          path: document.relativePath,
        });
      }
      flowIds.set(id, document.relativePath);
      flows.push({
        id,
        type: relation.type,
        ...(relation.viewUrl ? { viewUrl: relation.viewUrl } : {}),
        ...(relation.relationType ? { relationType: relation.relationType } : {}),
        from: { module: document.module.id, submodule: document.id },
        to: { module: target.module.id, submodule: target.id },
      });
    });
  }

  const flow = {
    schemaVersion: 1,
    title,
    modules: [...modules.values()],
    ...(moduleTypes.size ? { moduleTypes: Object.fromEntries([...moduleTypes].map(([key,{style}])=>[key,style])) } : {}),
    ...(relationTypes.size ? { relationTypes: Object.fromEntries([...relationTypes].map(([key, { style }]) => [key, style])) } : {}),
    flows,
  };
  const validation = validateFlow(flow);
  if (!validation.valid) {
    const diagnostics = validation.errors.map((error) => error.message ?? String(error)).join("; ");
    throw new FlowmatterError(`Generated flow is invalid: ${diagnostics}`, { code: "invalid_flow" });
  }
  return { byId, flow };
}

export async function querySite({ input, cwd = process.cwd(), from, direction = 'outgoing', depth = 1, relation, limit = 100 } = {}) {
  if (!isNonEmptyString(from)) throw new Error('query requires --from <document-id>');
  if (!['incoming', 'outgoing', 'both'].includes(direction)) throw new Error('Expected direction incoming, outgoing or both');
  if (!Number.isSafeInteger(depth) || depth < 0) throw new Error('Expected a non-negative integer depth');
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error('Expected a positive integer limit');
  const { baseDir, documents, relationTypes, moduleTypes } = await readDocuments(input, path.resolve(cwd));
  const { byId, flow } = compile(documents, 'Query', relationTypes, moduleTypes);
  if (!byId.has(from)) throw new FlowmatterError(`Unknown document id: ${from}`, { code: 'unknown_document_id' });

  const adjacent = new Map();
  function add(id, neighbor, edge) {
    if (!adjacent.has(id)) adjacent.set(id, []);
    adjacent.get(id).push({ neighbor, edge });
  }
  for (const { id, from: source, to: target, type, relationType } of flow.flows) {
    if (relation !== undefined && relation !== (relationType ?? type)) continue;
    const edge = { id, from: source.submodule, to: target.submodule, type, ...(relationType ? { relationType } : {}) };
    if (direction !== 'incoming') add(edge.from, edge.to, edge);
    if (direction !== 'outgoing') add(edge.to, edge.from, edge);
  }
  const queue = [from], distances = new Map([[from, 0]]), edges = new Map();
  let truncated = false;
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i], distance = distances.get(id);
    if (distance === depth) break;
    for (const { neighbor, edge } of adjacent.get(id) ?? []) {
      if (!distances.has(neighbor)) {
        if (queue.length === limit) { truncated = true; continue; }
        distances.set(neighbor, distance + 1);
        queue.push(neighbor);
      }
      edges.set(edge.id, edge);
    }
  }
  const nodes = queue.map(id => {
    const { title, relativePath } = byId.get(id);
    return { id, title, path: relativePath, distance: distances.get(id) };
  });
  return { baseDir, nodes, edges: [...edges.values()], truncated };
}

export async function validateSite({ input, title, cwd = process.cwd() } = {}) {
  try {
    if (title !== undefined && !isNonEmptyString(title)) {
      throw new FlowmatterError("The title must be a non-empty string");
    }
    const { baseDir, documents, relationTypes, moduleTypes } = await readDocuments(input, path.resolve(cwd));
    const siteTitle = title?.trim() ?? titleFromContent("", path.basename(baseDir));
    const { flow } = compile(documents, siteTitle, relationTypes, moduleTypes);
    return {
      valid: true,
      errors: [],
      warnings: [],
      stats: {
        files: documents.length,
        modules: flow.modules.length,
        relations: flow.flows.length,
      },
      flow,
    };
  } catch (error) {
    if (!(error instanceof FlowmatterError)) throw error;
    return {
      valid: false,
      errors: [{ code: error.code, path: error.path, message: error.message }],
      warnings: [],
      stats: null,
    };
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function relativeHref(fromPath, toPath) {
  return toPosix(path.relative(path.dirname(fromPath), toPath)) || path.basename(toPath);
}

function renderRelationList(title, relations, currentOutputPath) {
  if (relations.length === 0) return "";
  const items = relations.map(({ document, type }) => {
    const href = relativeHref(currentOutputPath, document.outputPath);
    return `<li><a href="${escapeHtml(href)}">${escapeHtml(document.title)}</a> <small>${escapeHtml(type)}</small></li>`;
  }).join("\n");
  return `<section class="relation-card"><h2>${escapeHtml(title)}</h2><ul>${items}</ul></section>`;
}

function renderPage(document, documents, byId) {
  const outgoing = document.relations.map((relation) => ({ document: byId.get(relation.to), type: relation.type }));
  const incoming = document.pageOnly ? [] : documents.flatMap((candidate) => candidate.relations
    .filter((relation) => relation.to === document.id)
    .map((relation) => ({ document: candidate, type: relation.type })));

  const sourceToOutput = new Map(documents.map((candidate) => [candidate.sourcePath, candidate.outputPath]));
  const tokens = marked.lexer(document.content);
  const first = tokens.find(token => token.type !== "space");
  const hasTitle = first?.type === "heading" && first.depth === 1;
  marked.walkTokens(tokens, token => {
      if (token.type !== "link" || !isNonEmptyString(token.href)) return;
      const match = token.href.match(/^([^?#]+\.md)([?#].*)?$/i);
      if (!match || path.isAbsolute(match[1])) return;
      const targetOutput = sourceToOutput.get(path.resolve(path.dirname(document.sourcePath), match[1]));
      if (targetOutput) token.href = `${relativeHref(document.outputPath, targetOutput)}${match[2] ?? ""}`;
  });
  const body = marked.parser(tokens);
  const relations = [
    renderRelationList("Leads to", outgoing, document.outputPath),
    renderRelationList("Reached from", incoming, document.outputPath),
  ].filter(Boolean).join("\n");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(document.title)}</title>
  <style>${PAGE_STYLE}</style>
</head>
<body>
  <main>
    <header>
      <div class="eyebrow">${escapeHtml(document.module.name)}</div>
    </header>
    <article>${hasTitle ? "" : `<h1>${escapeHtml(document.title)}</h1>`}${body}</article>
    ${relations ? `<footer class="relations" aria-label="Relations">${relations}</footer>` : ""}
  </main>
</body>
</html>
`;
}

export async function renderSite({
  input,
  resolvedInputs,
  outputDir = "flowmatter-dist",
  flowFile = "flow.html",
  title,
  cwd = process.cwd(),
} = {}) {
  if (!isNonEmptyString(outputDir)) throw new FlowmatterError("The output directory must be a non-empty string");
  if (!isNonEmptyString(flowFile) || path.basename(flowFile) !== flowFile || !/\.html?$/i.test(flowFile)) {
    throw new FlowmatterError("The flow filename must be an HTML filename without a directory");
  }
  if (title !== undefined && !isNonEmptyString(title)) {
    throw new FlowmatterError("The title must be a non-empty string");
  }

  const { baseDir, documents, relationTypes, moduleTypes } = await readDocuments(input, path.resolve(cwd), resolvedInputs);
  const outputRoot = path.resolve(cwd, outputDir);
  const flowPath = path.join(outputRoot, flowFile);
  for (const document of documents) {
    document.outputPath = path.join(outputRoot, document.outputRelativePath);
    if (document.outputRelativePath === flowFile || document.outputRelativePath.startsWith(`${flowFile}/`)) {
      throw new FlowmatterError(`${document.relativePath}: rendered page conflicts with ${flowFile}`, {
        code: "output_collision", path: document.relativePath,
      });
    }
  }

  const siteTitle = title?.trim() ?? titleFromContent("", path.basename(baseDir));
  const { byId, flow } = compile(documents, siteTitle, relationTypes, moduleTypes);
  const outputs = [
    { path: flowPath, content: buildFlow(flow, { title: siteTitle }) },
    ...documents.map((document) => ({
      path: document.outputPath,
      content: renderPage(document, documents, byId),
    })),
  ];

  return {flow, flowPath, outputDir: outputRoot, pageCount: documents.length, pages: documents.map(document => document.outputPath), outputs};
}

export async function buildSite(options = {}) {
  const {outputs, ...result} = await renderSite(options);
  if (!options.force) {
    for (const output of outputs) {
      if (await pathExists(output.path)) {
        throw new FlowmatterError(`${output.path} already exists; use --force to overwrite generated files`);
      }
    }
  }

  for (const output of outputs) {
    await mkdir(path.dirname(output.path), { recursive: true });
    await writeFile(output.path, output.content, "utf8");
  }

  return result;
}
