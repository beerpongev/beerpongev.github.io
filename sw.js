// Nur App-Dateien und SDK-Module cachen, niemals Auth-/Firestore-HTTP-Antworten.
const VERSION = 'beerpong-v4-staff-online-demo-20261113';
const LOCAL = ["./membership-pdf.js","./icons/academy-32.png","./icons/academy-192.png","./icons/academy-512.png","./vendor/fontkit.es.min.js","./vendor/fonts/NotoSans-Bold.ttf","./vendor/fonts/NotoSans-Regular.ttf","./vendor/pako.esm.js","./vendor/pdf-lib.esm.min.js",'./','./index.html','./style.css','./responsive.css','./app.js','./engine.js','./scheduler.js','./firebase.js','./transaction.js','./config.js','./ui.js','./data.js','./documents.js','./membership.js','./content/documents.json','./manifest.json','./icon.svg','./icons/icon-192.png','./icons/icon-512.png','./DATEN/Beerpong_Gesamt_Vektor.png'];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => cache.addAll(LOCAL)));
  // Eine neue Version übernimmt erst beim Schließen aller alten App-Fenster.
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('beerpong-') && key !== VERSION).map(key => caches.delete(key)))));
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && !(url.origin === 'https://www.gstatic.com' && url.pathname.startsWith('/firebasejs/'))) return;
  if (url.origin === self.location.origin && !LOCAL.some(path => new URL(path,self.registration.scope).pathname === url.pathname)) return;
  event.respondWith(fetch(event.request).then(response => {
    if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy));}
    return response;
  }).catch(async()=>{
    const cached=await caches.match(event.request) ?? (event.request.mode==='navigate'?await caches.match(new URL('./index.html',self.registration.scope)):null);
    return cached ?? new Response('Offline. Bitte die Verbindung wiederherstellen.', {status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
  }));
});
