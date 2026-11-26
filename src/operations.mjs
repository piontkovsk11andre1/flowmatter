import { readFile } from 'node:fs/promises';
import { buildSite, querySite, validateSite } from './index.mjs';

const files = { schema: '../schema/frontmatter.schema.json', example: '../examples/order-processing.json', skill: '../skills/flowmatter/SKILL.md' };
const descriptions = {
  query: 'Find related Markdown documents and the edges connecting them.',
  validate: 'Validate the configured documents and return diagnostics.',
  schema: 'Get the bundled frontmatter schema.', example: 'Get the bundled graph example.',
  skill: 'Read the Flowmatter agent skill.', build: 'Build HTML in the configured output directory.'
};
const properties = { from: {type:'string'}, direction:{enum:['incoming','outgoing','both']}, relation:{type:'string'}, depth:{type:'integer',minimum:0}, limit:{type:'integer',minimum:1} };
export function tools(build = false) {
  return Object.entries(descriptions).filter(([name]) => name !== 'build' || build).map(([name,description]) => ({ name, description,
    inputSchema: {type:'object', properties:name === 'query' ? properties : {}, ...(name === 'query' ? {required:['from']} : {}), additionalProperties:false} }));
}
export const resources = Object.keys(files).map(name => ({name, uri:`flowmatter://${name}`, mimeType:name === 'skill' ? 'text/markdown' : 'application/json'}));

export function operations({input, cwd = process.cwd(), outputDir}) {
  let building = false;
  return { tools:tools(Boolean(outputDir)), async call(name, args = {}) {
    if (!Object.hasOwn(descriptions,name) || (name === 'build' && !outputDir)) throw new Error(`Unavailable operation: ${name}`);
    if (!args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(k => name !== 'query' || !Object.hasOwn(properties,k))) throw new Error('Unexpected operation arguments');
    if (Object.hasOwn(files,name)) {
      const text = await readFile(new URL(files[name],import.meta.url),'utf8');
      return name === 'skill' ? text : JSON.parse(text);
    }
    if (name === 'query') {
      if (args.relation !== undefined && typeof args.relation !== 'string') throw new Error('Expected a string relation');
      return querySite({input,cwd,...args});
    }
    if (name === 'validate') {
      const {flow, ...report} = await validateSite({input,cwd});
      return report;
    }
    if (building) throw new Error('Build already in progress');
    building = true;
    try {
      const {flowPath,pageCount,pages} = await buildSite({input,cwd,outputDir});
      return {flowPath,pageCount,pages};
    } finally { building = false; }
  }};
}
