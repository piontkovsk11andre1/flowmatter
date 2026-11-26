import express from 'express';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcp } from './mcp.mjs';
import { operations } from './operations.mjs';

export async function serveApi({port = 4174, mcp = false, ...config}) {
  const service = operations(config);
  const app = express();
  app.disable('x-powered-by');
  app.use((req,res,next) => {
    if (!['127.0.0.1','localhost'].includes(req.hostname) || (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`)) return res.sendStatus(403);
    next();
  });
  app.use(express.json({limit:'64kb'}));
  app.get('/tools', (_req,res) => res.json({tools:service.tools}));
  app.post('/tools/:name', async (req,res) => {
    if (!req.is('application/json')) return res.sendStatus(415);
    if (!service.tools.some(t => t.name === req.params.name)) return res.status(404).json({error:{message:'Unknown tool'}});
    res.json({result:await service.call(req.params.name,req.body)});
  });
  if (mcp) app.post('/mcp', async (req,res) => {
    const server = createMcp(service);
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close', () => { void server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req,res,req.body);
  });
  if (mcp) app.all('/mcp', (_req,res) => res.set('Allow','POST').sendStatus(405));
  app.use((err,_req,res,next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 400).json({error:{code:err.code || 'invalid_request',message:err.message}});
  });
  const server = await new Promise((resolve,reject) => {
    const handle = app.listen(port,'127.0.0.1',() => resolve(handle));
    handle.once('error',reject);
  });
  return {url:`http://127.0.0.1:${server.address().port}`,close:() => new Promise((resolve,reject) => server.close(e => e ? reject(e) : resolve()))};
}
