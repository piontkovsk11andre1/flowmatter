import http from 'node:http';
import path from 'node:path';
import {stat} from 'node:fs/promises';
import {renderSite, resolveMarkdownInputs} from './index.mjs';

// Re-resolve the input set on every poll so atomic saves, additions, and removals
// work for globs as well as directories on bind-mounted filesystems.
export async function serveSite({input, cwd = process.cwd(), title, flowFile = 'flow.html', port = 4173,
  interval = 500, log = console.error}) {
  async function fingerprint({markdownFiles}) {
    return JSON.stringify(await Promise.all(markdownFiles.map(async file => {
      const s = await stat(file, {bigint:true});
      return [file, String(s.ino), String(s.size), String(s.ctimeNs), String(s.mtimeNs)];
    })));
  }
  async function render(resolvedInputs) {
    const site = await renderSite({resolvedInputs,cwd,title,flowFile});
    return new Map(site.outputs.map(({path:file,content}) => ['/' + path.relative(site.outputDir,file).split(path.sep).join('/'),content]));
  }
  // The fingerprint and rendered pages must describe the same set of files.
  const initial = await resolveMarkdownInputs(input, cwd);
  let seen = await fingerprint(initial), pages = await render(initial), stopped = false, timer, lastError;
  async function poll() {
    try {
      const inputs = await resolveMarkdownInputs(input, cwd);
      const next = await fingerprint(inputs);
      if (next !== seen) {
        seen = next;
        pages = await render(inputs); // Publish the entire new generation together.
        log(`Rebuilt ${pages.size - 1} pages`);
      }
      lastError = undefined;
    } catch (error) {
      if (lastError !== error.message) log(`Preview rebuild failed: ${error.message}`);
      lastError = error.message;
    } finally {
      if (!stopped) timer = setTimeout(poll,interval);
    }
  }
  const server = http.createServer((req,res) => {
    if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405,{Allow:'GET, HEAD'}).end(); return;}
    let key;
    try {key = decodeURIComponent(req.url.split('?')[0]);} catch {res.writeHead(400).end(); return;}
    const page = pages.get(key === '/' ? '/' + flowFile : key);
    if (page === undefined) {res.writeHead(404).end(); return;}
    res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});
    res.end(req.method === 'HEAD' ? undefined : page);
  });
  await new Promise((resolve,reject) => {
    server.once('error',reject);
    server.listen(port,'127.0.0.1',resolve);
  });
  timer = setTimeout(poll,interval);
  return {url:`http://127.0.0.1:${server.address().port}/`, close() {
    stopped = true; clearTimeout(timer);
    return new Promise(resolve => server.close(resolve));
  }};
}
