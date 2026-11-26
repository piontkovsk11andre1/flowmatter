import { readFile } from 'node:fs/promises';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema, ListResourcesRequestSchema, ReadResourceRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { resources } from './operations.mjs';

const {version} = JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
const text = value => typeof value === 'string' ? value : JSON.stringify(value);
export function createMcp(service) {
  const server = new Server({name:'flowmatter',version},{capabilities:{tools:{},resources:{}}});
  server.setRequestHandler(ListToolsRequestSchema, async () => ({tools:service.tools}));
  server.setRequestHandler(CallToolRequestSchema, async ({params}) => {
    try {
      const result = await service.call(params.name,params.arguments);
      return {content:[{type:'text',text:text(result)}], ...(typeof result === 'object' ? {structuredContent:result} : {})};
    } catch (error) { return {isError:true,content:[{type:'text',text:error.message}]}; }
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({resources}));
  server.setRequestHandler(ReadResourceRequestSchema, async ({params:{uri}}) => {
    const resource = resources.find(r => r.uri === uri);
    if (!resource) throw new Error(`Unknown resource: ${uri}`);
    return {contents:[{uri,mimeType:resource.mimeType,text:text(await service.call(resource.name))}]};
  });
  return server;
}

export async function startStdio(service) {
  const server = createMcp(service);
  await server.connect(new StdioServerTransport());
  return server;
}
