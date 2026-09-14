/* Planner service worker.
   Shell is cached so the app opens instantly and works with no signal.
   Data is never cached here; it lives in localStorage, written by app.js. */
var CACHE = "planner-v13";
var SHELL = [
  "./",
  "./index.html",
  "./app.js?v=9",
  "./desktop.html",
  "./desktop.js?v=4",
  "./manifest.webmanifest",
  "./desktop.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];

self.addEventListener("install", function(e){
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(function(c){ return c.addAll(SHELL); }).catch(function(){}));
});

self.addEventListener("activate", function(e){
  e.waitUntil(caches.keys().then(function(ks){
    return Promise.all(ks.map(function(k){ return k===CACHE?null:caches.delete(k); }));
  }).then(function(){ return self.clients.claim(); }));
});

self.addEventListener("fetch", function(e){
  var url = e.request.url;
  // Never touch the GitHub API. Those calls must always be live or fail honestly.
  if (url.indexOf("api.github.com") !== -1) return;
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request).then(function(r){
      if (r && r.status === 200 && r.type === "basic") {
        var copy = r.clone();
        caches.open(CACHE).then(function(c){ c.put(e.request, copy); }).catch(function(){});
      }
      return r;
    }).catch(function(){
      return caches.match(e.request).then(function(m){
        if (m) return m;
        // The desktop page falls back to itself, not to the phone shell.
        return caches.match(url.indexOf("desktop") !== -1 ? "./desktop.html" : "./index.html");
      });
    })
  );
});
