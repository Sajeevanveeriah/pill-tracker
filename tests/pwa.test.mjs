/** Service-worker contracts only; not evidence of real device offline support. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import vm from 'node:vm';
const root=new URL('../',import.meta.url),source=readFileSync(new URL('sw.js',root),'utf8');
const manifest=JSON.parse(readFileSync(new URL('manifest.webmanifest',root),'utf8'));
const scope='https://example.test/pill-tracker/';
function fixture({cached=true,online=true}={}) {
  const handlers={},deleted=[],installed=[];let claimed=false,skipped=false;
  const prefix=`sv-pill-tracker:${scope}:`;
  const cache={addAll:async requests=>{installed.push(...requests.map(r=>r.url));},match:async url=>cached?new Response(`cached:${url}`):undefined};
  const caches={open:async()=>cache,keys:async()=>[prefix+'old',prefix+'20260909-r00','portfolio-cache','sv-pill-tracker:https://example.test/other/:old'],delete:async key=>{deleted.push(key);return true;}};
  const self={registration:{scope},addEventListener:(name,fn)=>{handlers[name]=fn;},clients:{claim:async()=>{claimed=true;}},skipWaiting:()=>{skipped=true;}};
  const fetch=async()=>{if(!online)throw new Error('offline fixture');return new Response('network');};
  vm.runInNewContext(source,{self,caches,Request,Response,URL,Set,fetch});
  return {handlers,deleted,installed,get claimed(){return claimed;},get skipped(){return skipped;}};
}
test('manifest identity distinguishes the app from the portfolio root',()=>assert.equal(new URL(manifest.id,new URL(scope).origin).pathname,'/pill-tracker/'));
test('start URL and scope stay inside the project',()=>{assert.equal(new URL(manifest.start_url,scope).href,scope);assert.equal(new URL(manifest.scope,scope).href,scope);assert.equal(manifest.display,'standalone');});
test('declared app icons exist at relative paths',()=>{for(const icon of manifest.icons)assert.ok(existsSync(new URL(icon.src,root)));assert.ok(manifest.icons.some(i=>i.sizes==='192x192'));assert.ok(manifest.icons.some(i=>i.sizes==='512x512'));});
test('offline install precaches the local shell files',async()=>{const f=fixture();let done;f.handlers.install({waitUntil:p=>{done=p;}});await done;assert.equal(f.installed.length,11);for(const url of f.installed){assert.ok(url.startsWith(scope));assert.ok(existsSync(new URL(url.slice(scope.length)||'index.html',root)));}});
test('activation preserves portfolio and other-app caches',async()=>{const f=fixture();let done;f.handlers.activate({waitUntil:p=>{done=p;}});await done;assert.deepEqual(f.deleted,[`sv-pill-tracker:${scope}:old`]);assert.equal(f.claimed,true);});
test('cached shell is served when the network is offline',async()=>{const f=fixture({online:false});let response;f.handlers.fetch({request:new Request(scope+'app.js'),respondWith:p=>{response=p;}});assert.match(await (await response).text(),/cached:/);});
test('missing offline resources report failure',async()=>{const f=fixture({cached:false,online:false});let response;f.handlers.fetch({request:new Request(scope+'app.js'),respondWith:p=>{response=p;}});assert.equal((await response).status,503);});
test('worker does not intercept requests outside its shell',()=>{const f=fixture();for(const url of ['https://example.test/','https://external.test/pill-tracker/app.js',scope+'private-backup.json'])f.handlers.fetch({request:new Request(url),respondWith:()=>assert.fail('Unexpected interception')});});
test('worker ignores writes rather than caching user input',()=>{const f=fixture();f.handlers.fetch({request:new Request(scope+'app.js',{method:'POST',body:'fixture'}),respondWith:()=>assert.fail('Unexpected write interception')});});
test('waiting update activates after the explicit message',()=>{const f=fixture();assert.equal(f.skipped,false);f.handlers.message({data:{type:'OTHER'}});assert.equal(f.skipped,false);f.handlers.message({data:{type:'SKIP_WAITING'}});assert.equal(f.skipped,true);});
