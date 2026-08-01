import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildFlow, validateFlow } from "@p10i/flowjob";
import { glob } from "glob";
import globParent from "glob-parent";
import matter from "gray-matter";
import { marked } from "marked";

const PAGE_STYLE = `
:root { color-scheme: light dark; font-family: Inter, ui-sans-serif, system-ui, sans-serif; line-height: 1.6; }
body { margin: 0; background: #f4f1ea; color: #27241f; }
main { width: min(52rem, calc(100% - 2rem)); margin: 0 auto; padding: 3rem 0 5rem; }
header { border-bottom: 1px solid #c9c1b3; margin-bottom: 2rem; padding-bottom: 1.25rem; }
h1, h2, h3 { font-family: Georgia, "Times New Roman", serif; line-height: 1.15; }
h1 { font-size: clamp(2.2rem, 7vw, 4.5rem); letter-spacing: -.04em; margin: .25rem 0; }
a { color: #9a3f22; text-underline-offset: .18em; }
.eyebrow { color: #70685d; font-size: .78rem; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; }
.relations { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(15rem, 1fr)); margin: 2.5rem 0; }
.relation-card { background: #fffaf0; border: 1px solid #d8cebd; border-radius: .35rem; padding: 1rem 1.2rem; }
.relation-card h2 { font-size: 1rem; margin: 0 0 .65rem; }
.relation-card ul { margin: 0; padding-left: 1.2rem; }
article img { height: auto; max-width: 100%; }
article pre { overflow-x: auto; padding: 1rem; background: #25231f; color: #f9f3e8; }
article code { font-family: "SFMono-Regular", Consolas, monospace; }
@media (prefers-color-scheme: dark) {
  body { background: #1d1b18; color: #eee7db; }
  header { border-color: #4b453c; }
  a { color: #ef9b7c; }
  .eyebrow { color: #aaa195; }
  .relation-card { background: #292620; border-color: #514a40; }
}
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
      ...(relation.relationType ? { relationType: relation.relationType.trim() } : {}),
    };
  });
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

async function readDocuments(input, cwd) {
  const { baseDir, files } = await resolveInput(input, cwd);
  const markdownFiles = [...new Set(files.map((file) => path.resolve(file)))]
    .filter((file) => /\.md$/i.test(file))
    .sort((left, right) => left.localeCompare(right));

  if (markdownFiles.length === 0) {
    throw new FlowmatterError(`No Markdown files matched "${input}"`, { code: "no_markdown_files", path: input });
  }

  const documents = await Promise.all(markdownFiles.map(async (sourcePath) => {
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
      title: title.trim(),
      module: describeModule(parsed.data.module, relativePath),
      relations: parseRelations(parsed.data.relations, relativePath),
      content: parsed.content,
      sourcePath,
      relativePath,
      outputRelativePath: relativePath.replace(/\.md$/i, ".html"),
    };
  }));
  return { baseDir, documents };
}

function compile(documents, title) {
  const byId = new Map();
  const modules = new Map();
  const flowIds = new Map();

  for (const document of documents) {
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
      || (existing.type && document.module.type && existing.type !== document.module.type)
    )) {
      throw new FlowmatterError(`${document.relativePath}: module "${document.module.id}" conflicts with an earlier definition`, {
        code: "conflicting_module",
        path: document.relativePath,
      });
    }
    if (!existing) modules.set(document.module.id, { ...document.module, submodules: [] });
    if (existing && !existing.type && document.module.type) existing.type = document.module.type;
    modules.get(document.module.id).submodules.push({ id: document.id, name: document.title });
  }

  const flows = [];
  for (const document of documents) {
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
    flows,
  };
  const validation = validateFlow(flow);
  if (!validation.valid) {
    const diagnostics = validation.errors.map((error) => error.message ?? String(error)).join("; ");
    throw new FlowmatterError(`Generated flow is invalid: ${diagnostics}`, { code: "invalid_flow" });
  }
  return { byId, flow };
}

export async function validateSite({ input, title, cwd = process.cwd() } = {}) {
  try {
    if (!isNonEmptyString(input)) throw new FlowmatterError("A folder or glob input is required");
    if (title !== undefined && !isNonEmptyString(title)) {
      throw new FlowmatterError("The title must be a non-empty string");
    }
    const { baseDir, documents } = await readDocuments(input, path.resolve(cwd));
    const siteTitle = title?.trim() ?? titleFromContent("", path.basename(baseDir));
    const { flow } = compile(documents, siteTitle);
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

function renderPage(document, documents, byId, flowPath) {
  const outgoing = document.relations.map((relation) => ({ document: byId.get(relation.to), type: relation.type }));
  const incoming = documents.flatMap((candidate) => candidate.relations
    .filter((relation) => relation.to === document.id)
    .map((relation) => ({ document: candidate, type: relation.type })));

  const sourceToOutput = new Map(documents.map((candidate) => [candidate.sourcePath, candidate.outputPath]));
  const body = marked.parse(document.content, {
    walkTokens(token) {
      if (token.type !== "link" || !isNonEmptyString(token.href)) return;
      const match = token.href.match(/^([^?#]+\.md)([?#].*)?$/i);
      if (!match || path.isAbsolute(match[1])) return;
      const targetOutput = sourceToOutput.get(path.resolve(path.dirname(document.sourcePath), match[1]));
      if (targetOutput) token.href = `${relativeHref(document.outputPath, targetOutput)}${match[2] ?? ""}`;
    },
  });
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
      <div class="eyebrow">${escapeHtml(document.module.name)} · <a href="${escapeHtml(relativeHref(document.outputPath, flowPath))}">Open flow</a></div>
      <h1>${escapeHtml(document.title)}</h1>
    </header>
    ${relations ? `<aside class="relations" aria-label="Relations">${relations}</aside>` : ""}
    <article>${body}</article>
  </main>
</body>
</html>
`;
}

export async function buildSite({
  input,
  outputDir = "flowmatter-dist",
  flowFile = "flow.html",
  title,
  force = false,
  cwd = process.cwd(),
} = {}) {
  if (!isNonEmptyString(input)) throw new FlowmatterError("A folder or glob input is required");
  if (!isNonEmptyString(outputDir)) throw new FlowmatterError("The output directory must be a non-empty string");
  if (!isNonEmptyString(flowFile) || path.basename(flowFile) !== flowFile || !/\.html?$/i.test(flowFile)) {
    throw new FlowmatterError("The flow filename must be an HTML filename without a directory");
  }
  if (title !== undefined && !isNonEmptyString(title)) {
    throw new FlowmatterError("The title must be a non-empty string");
  }

  const { baseDir, documents } = await readDocuments(input, path.resolve(cwd));
  const outputRoot = path.resolve(cwd, outputDir);
  const flowPath = path.join(outputRoot, flowFile);
  for (const document of documents) {
    document.outputPath = path.join(outputRoot, document.outputRelativePath);
    if (path.resolve(document.outputPath) === path.resolve(flowPath)) {
      throw new FlowmatterError(`${document.relativePath}: rendered page conflicts with ${flowFile}`);
    }
  }

  const siteTitle = title?.trim() ?? titleFromContent("", path.basename(baseDir));
  const { byId, flow } = compile(documents, siteTitle);
  const outputs = [
    { path: flowPath, content: buildFlow(flow, { title: siteTitle }) },
    ...documents.map((document) => ({
      path: document.outputPath,
      content: renderPage(document, documents, byId, flowPath),
    })),
  ];

  if (!force) {
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

  return {
    flow,
    flowPath,
    outputDir: outputRoot,
    pageCount: documents.length,
    pages: documents.map((document) => document.outputPath),
  };
}
