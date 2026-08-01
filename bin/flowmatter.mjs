#!/usr/bin/env node

import { readFile } from "node:fs/promises";
import { buildSite, FlowmatterError, validateSite } from "../src/index.mjs";

const HELP = `Usage: flowmatter build <folder-or-glob> [options]
       flowmatter <folder-or-glob> [options]
       flowmatter validate <folder-or-glob> [--json]
       flowmatter schema
       flowmatter example
       flowmatter skill

Generate a flowjob map and standalone HTML pages from Markdown files.

Build options:
  -o, --output <directory>  Output directory (default: flowmatter-dist)
  --flow <filename>         Flow HTML filename (default: flow.html)
  --title <title>           Override the flow title
  -f, --force               Overwrite generated files
  --json                    Print the build result as JSON
  -h, --help                Show this help
  -v, --version             Show the package version`;

function fail(message, exitCode = 2) {
  console.error(`flowmatter: ${message}`);
  process.exitCode = exitCode;
}

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${option} requires a value`);
  return value;
}

function parseInputOptions(args) {
  const options = { force: false, json: false };
  const inputs = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-f" || argument === "--force") {
      options.force = true;
    } else if (argument === "--json") {
      options.json = true;
    } else if (argument === "-o" || argument === "--output") {
      options.outputDir = takeValue(args, index, argument);
      index += 1;
    } else if (argument === "--flow") {
      options.flowFile = takeValue(args, index, argument);
      index += 1;
    } else if (argument === "--title") {
      options.title = takeValue(args, index, argument);
      index += 1;
    } else if (argument.startsWith("-")) {
      throw new Error(`unknown option ${argument}`);
    } else {
      inputs.push(argument);
    }
  }

  if (inputs.length !== 1) throw new Error("exactly one folder or glob is required");
  return { input: inputs[0], ...options };
}

async function printBundledJson(relativePath) {
  const value = JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));
  console.log(JSON.stringify(value, null, 2));
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) {
    console.log(HELP);
    return;
  }
  if (args.includes("-v") || args.includes("--version")) {
    const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
    console.log(manifest.version);
    return;
  }

  const command = args[0];
  if (["schema", "example", "skill"].includes(command)) {
    if (args.length !== 1) throw new Error(`${command} does not accept arguments or options`);
    if (command === "skill") {
      process.stdout.write(await readFile(new URL("../skills/flowmatter/SKILL.md", import.meta.url), "utf8"));
      return;
    }
    await printBundledJson(command === "schema"
      ? "../schema/frontmatter.schema.json"
      : "../examples/order-processing.json");
    return;
  }

  if (command === "validate") {
    const parsed = parseInputOptions(args.slice(1));
    if (parsed.force || parsed.outputDir || parsed.flowFile) {
      throw new Error("validate only accepts --title and --json");
    }
    const validation = await validateSite(parsed);
    if (parsed.json) {
      const { flow, ...report } = validation;
      console.log(JSON.stringify(report));
    }
    else if (validation.valid) {
      console.log(`${parsed.input} is valid (${validation.stats.files} files, ${validation.stats.relations} relations)`);
    } else {
      console.log(validation.errors.map((error) => error.message).join("\n"));
    }
    if (!validation.valid) process.exitCode = 1;
    return;
  }

  const parsed = parseInputOptions(command === "build" ? args.slice(1) : args);
  const { json, ...buildOptions } = parsed;
  const result = await buildSite(buildOptions);
  if (json) {
    console.log(JSON.stringify({
      ok: true,
      flowPath: result.flowPath,
      outputDir: result.outputDir,
      pageCount: result.pageCount,
      pages: result.pages,
    }));
  } else {
    console.log(`Generated ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} and ${result.flowPath}`);
  }
}

main().catch((error) => {
  if (process.argv.includes("--json")) {
    console.error(JSON.stringify({
      ok: false,
      error: {
        code: error instanceof FlowmatterError ? error.code : "runtime_error",
        path: error instanceof FlowmatterError ? error.path : null,
        message: error instanceof Error ? error.message : String(error),
      },
    }));
  } else {
    fail(error instanceof Error ? error.message : String(error), error instanceof FlowmatterError ? 1 : 2);
  }
  process.exitCode ||= error instanceof FlowmatterError ? 1 : 2;
});
