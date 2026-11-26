import { operations } from './operations.mjs';
import { httpClient } from './client.mjs';

export async function runServiceCommand(command,args) {
  const config = {input:[]};
  let url, payload = {}, name;
  if (command === 'call') name = args.shift();
  for (let i=0; i<args.length; i++) {
    const key = args[i];
    const take = () => {
      const value = args[++i];
      if (!value || value.startsWith('--')) throw new Error(`${key} requires a value`);
      return value;
    };
    if (key === '--url' && command !== 'api') url = take();
    else if (key === '--args' && command === 'call') payload = JSON.parse(take());
    else if (key === '--json' && command === 'call') continue;
    else if (key === '--output' && command !== 'call') config.outputDir = take();
    else if (key === '--mcp' && command === 'api') config.mcp = true;
    else if (key === '--port' && command === 'api') {
      const port = take();
      if (!/^\d+$/.test(port) || Number(port)>65535) throw new Error('Expected port 0–65535');
      config.port = Number(port);
    } else if (key.startsWith('-') || command === 'call') throw new Error(`Unexpected ${key}`);
    else config.input.push(key);
  }
  if (command === 'call') {
    if (!url || !name || name.startsWith('-')) throw new Error('call requires an operation and --url');
    const result = await httpClient(url).call(name,payload);
    console.log(JSON.stringify(result));
    if (name === 'validate' && !result.valid) process.exitCode = 1;
    return;
  }
  if (url && (config.input.length || config.outputDir)) throw new Error('Remote MCP uses the service’s configured paths');
  if (!url && !config.input.length) throw new Error('At least one Markdown input is required');
  if (command === 'mcp') {
    const {startStdio} = await import('./mcp.mjs');
    const remote = url && httpClient(url);
    await startStdio(remote ? {tools:await remote.list(),call:remote.call} : operations(config));
  } else {
    const {serveApi} = await import('./api.mjs');
    const server = await serveApi(config);
    console.log(`Flowmatter API: ${server.url}`);
    for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => server.close());
  }
}
