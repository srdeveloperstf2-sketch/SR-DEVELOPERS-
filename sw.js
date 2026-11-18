const C='sr-crm-v36';
const ASSETS=['./','./index.html','./styles.css','./staff-control.css','./staff-control.js','./partner-admin.js','./cloud-sync.js','./auth.js','./app.js','./emi.js','./manifest.webmanifest','./icon.svg','./notifications.js','./crm-insights.js'];
self.addEventListener('install',e=>e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  const isAppAsset=u.origin===self.location.origin&&(/\\.(?:html|js|css)$/.test(u.pathname));
  if(e.request.method!=='GET')return;
  if(isAppAsset){
    e.respondWith(fetch(e.request).then(response=>{
      if(response&&response.ok){const copy=response.clone();caches.open(C).then(cache=>cache.put(e.request,copy));}
      return response;
    }).catch(()=>caches.match(e.request).then(cached=>cached||caches.match('./index.html'))));
  }else{
    e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request)));
  }
});