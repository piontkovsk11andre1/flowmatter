import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {serveApi} from '../src/api.mjs';
import {httpClient} from '../src/client.mjs';

test('HTTP, remote CLI and three MCP transports share the configured graph', async t => {
  const root = await mkdtemp(join(tmpdir(),'flowmatter-api-'));
  t.after(() => rm(root,{recursive:true,force:true}));
  await writeFile(join(root,'order.md'),'---\nrelations: [{to: payment, type: uses}]\n---\n# Order');
  await writeFile(join(root,'payment.md'),'# Payment');
  const api = await serveApi({input:root,port:0,mcp:true});
  t.after(() => api.close());
  const remote = httpClient(api.url), args = {from:'payment',direction:'incoming'};
  const expected = await remote.call('query',args);
  assert.deepEqual(expected.nodes.map(n=>n.id),['payment','order']);
  await assert.rejects(remote.call('query',{...args,cwd:'/'}),/Unexpected/);
  await assert.rejects(remote.call('build'),/Unknown tool/);
  const cli = resolve('bin/flowmatter.mjs');
  const result = await promisify(execFile)(process.execPath,[cli,'call','query','--url',api.url,'--args',JSON.stringify(args)]);
  assert.deepEqual(JSON.parse(result.stdout),expected);
  for (const transport of [new StreamableHTTPClientTransport(new URL('/mcp',api.url)),
    ...[[root],['--url',api.url]].map(argv => new StdioClientTransport({command:process.execPath,args:[cli,'mcp',...argv]}))]) {
    const client = new Client({name:'test',version:'1'});
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map(t=>t.name),(await remote.list()).map(t=>t.name));
      assert.deepEqual((await client.callTool({name:'query',arguments:args})).structuredContent,expected);
      assert.equal((await client.readResource({uri:'flowmatter://skill'})).contents[0].text,await remote.call('skill'));
    } finally { await client.close(); }
  }
});
