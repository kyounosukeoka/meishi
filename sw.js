'use strict';

const scope = self.registration.scope;
const prefix = 'meishi-techo:' + scope + ':';
const cacheName = prefix + '1.9.0';
const entry = new URL('./index.html', scope).href;
const assets = ['index.html', 'manifest.webmanifest', 'tie-180.png', 'storage.js?v=13', 'exports.js?v=14', 'visit-csv.js?v=19',
 'visit-workflow.js?v=19', 'visits.js?v=19', 'screens.js?v=16', 'visit-sync.js?v=17',
 'card-text.js?v=12', 'tie-192.png', 'tie-512.png', 'tie-maskable-512.png'];

self.addEventListener('install', event => {
 event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(assets.map(asset => new Request(new URL(asset, scope), {cache:'reload'})))));
});

self.addEventListener('activate', event => {
 event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith(prefix) && key !== cacheName).map(key => caches.delete(key)))));
});

self.addEventListener('fetch', event => {
 const {request} = event;
 if(request.method !== 'GET')return;
 const url = new URL(request.url);
 url.search = '';
 url.hash = '';
 if(request.mode === 'navigate' && (url.href === scope || url.href === entry)){
  event.respondWith(fetch(request).catch(async () => (await caches.open(cacheName)).match(entry)));
 }else if(assets.some(asset => new URL(asset,scope).href === request.url)){
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(request)) || fetch(request)));
 }
});
