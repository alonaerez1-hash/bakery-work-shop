const CACHE='bakery-workspace-v1220';
const CORE=['./index.html','./styles.css?v=1220','./app.js?v=1220','./manifest.json?v=1220','./pako_inflate.min.js?v=1220'];

self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(CACHE);
    await Promise.all(CORE.map(async url=>{
      try{
        const response=await fetch(new Request(url,{cache:'reload'}));
        if(response.ok)await cache.put(url,response.clone());
      }catch(_e){}
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting();
});

async function networkFirst(request,fallback){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(new Request(request,{cache:'no-store'}));
    if(response.ok)await cache.put(request,response.clone());
    return response;
  }catch(_e){
    return (await cache.match(request))||(fallback?await cache.match(fallback):undefined)||Response.error();
  }
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  if(event.request.mode==='navigate'){
    event.respondWith(networkFirst(event.request,'./index.html'));
    return;
  }
  event.respondWith(networkFirst(event.request));
});
