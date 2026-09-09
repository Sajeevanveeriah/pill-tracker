/* Cache only this app's static shell. No medication data enters Cache Storage. */
const RELEASE = '20260909-r00';
const PREFIX = `sv-pill-tracker:${self.registration.scope}:`;
const CACHE = PREFIX + RELEASE;
const FILES = ['./','./index.html','./styles.css','./app.js','./inventory.mjs','./storage.mjs','./manifest.webmanifest','./assets/SV-Monogram.png','./assets/Icon-192.png','./assets/Icon-512.png','./assets/Apple-Touch-Icon.png'];
const URLS = new Set(FILES.map(path=>new URL(path,self.registration.scope).href));
self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES.map(path=>new Request(new URL(path,self.registration.scope),{cache:'reload'})))));
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    for(const key of await caches.keys())if(key.startsWith(PREFIX)&&key!==CACHE)await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{if(event.data?.type==='SKIP_WAITING')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);url.search='';url.hash='';
  if(!URLS.has(url.href))return;
  event.respondWith((async()=>{
    const cache=await caches.open(CACHE),cached=await cache.match(url.href);
    if(cached)return cached;
    try{return await fetch(event.request);}catch{return new Response('Offline copy unavailable. Open Pill-Tracker online once.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});}
  })());
});
