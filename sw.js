const CACHE_NAME = "almani-auto-center-v2";
const BASE_URL = new URL("./", self.location).href;
const CORE_FILES = [
  BASE_URL,
  new URL("articles.html", BASE_URL).href,
  new URL("services.html", BASE_URL).href,
  new URL("manifest.json", BASE_URL).href,
  new URL("admin-manifest.json", BASE_URL).href,
  new URL("icons/app-192.png", BASE_URL).href,
  new URL("icons/app-512.png", BASE_URL).href,
  new URL("images/home-hero.jpg", BASE_URL).href
];
self.addEventListener("install", event => { event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", event => {
 const request=event.request;
 if(request.method!=="GET"||new URL(request.url).origin!==self.location.origin)return;
 if(request.mode==="navigate"){event.respondWith(fetch(request).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));return response;}).catch(async()=>(await caches.match(request))||caches.match(BASE_URL)));return;}
 event.respondWith(caches.match(request).then(cached=>cached||fetch(request).then(response=>{if(response.ok)caches.open(CACHE_NAME).then(cache=>cache.put(request,response.clone()));return response;})));
});

