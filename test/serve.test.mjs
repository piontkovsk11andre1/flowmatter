import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, unlink, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {serveSite} from '../src/serve.mjs';

test('preview publishes successful rebuilds and retains the previous site during invalid edits',async t=>{
  const cwd = await mkdtemp(path.join(os.tmpdir(),'flowmatter-serve-'));
  t.after(()=>rm(cwd,{recursive:true,force:true}));
  const doc=path.join(cwd,'a.md'), extra=path.join(cwd,'b.md');
  await writeFile(doc,'# First');
  const messages=[];
  const preview=await serveSite({cwd,input:'.',port:0,interval:30,log:m=>messages.push(m)});
  t.after(()=>preview.close());
  const get=p=>fetch(new URL(p,preview.url));
  async function until(fn){for(let i=0;i<150;i++){if(await fn())return;await delay(30);}assert.fail('Preview did not update');}
  assert.equal((await get('/')).status,200);
  await writeFile(doc,'---\nrelations: [{to: missing, type: reads}]\n---\n# Invalid');
  await until(()=>messages.some(m=>m.includes('missing_relation_target')||m.includes('does not exist')));
  assert.match(await (await get('a.html')).text(),/<h1>First/);
  await writeFile(doc,'# Revised');
  await writeFile(extra,'# Extra');
  await until(async()=> (await get('b.html')).ok);
  assert.match(await (await get('a.html')).text(),/<h1>Revised/);
  await unlink(extra);
  await until(async()=> (await get('b.html')).status===404);
});
