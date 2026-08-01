#!/usr/bin/env node

import { buildSite, FlowmatterError } from "../src/index.mjs";

const HELP = `Usage: flowmatter <folder-or-glob> [options]

Generate a flowjob map and standalone HTML pages from Markdown files.

Options:
  -o, --output <directory>  Output directory (default: flowmatter-dist)
  --flow <filename>         Flow HTML filename (default: flow.html)
  --title <title>           Override the flow title
  -f, --force               Overwrite generated files
  -h, --help                Show this help
  -v, --version             Show the package version`;

function fail(message, exitCode = 2) {
  console.error(message);
  process.exitCode = exitCode;
}

function takeValue(args, index, option) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${option} requires a value`);
  }
  return value;
}

function parseArgs(args) {
  const options = { force: false };
  const inputs = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "-f" || argument === "--force") {
      options.force = true;
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
      throw new Error(`Unknown option: ${argument}`);
    } else {
      inputs.push(argument);
    }
  }

  if (inputs.length !== 1) {
    throw new Error("Exactly one folder or glob is required");
  }
  return { input: inputs[0], ...options };
}

const args = process.argv.slice(2);
if (args.includes("-h") || args.includes("--help")) {
  console.log(HELP);
} else if (args.includes("-v") || args.includes("--version")) {
  console.log("0.1.0");
} else {
  try {
    const result = await buildSite(parseArgs(args));
    console.log(
      `Generated ${result.pageCount} page${result.pageCount === 1 ? "" : "s"} and ${result.flowPath}`,
    );
  } catch (error) {
    if (error instanceof FlowmatterError) {
      fail(error.message, 1);
    } else if (error instanceof Error) {
      fail(error.message);
    } else {
      throw error;
    }
  }
}
