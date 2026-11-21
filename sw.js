// Nur öffentliche App-Dateien; niemals Auth-/Firestore-Antworten cachen.
const VERSION='beerpong-v12-contribution-review-20261121';
const CORE=["./","./index.html","./style.css","./responsive.css","./club.css","./registration.css","./app.js","./engine.js","./scheduler.js","./firebase.js","./transaction.js","./config.js","./ui.js","./data.js","./documents.js","./membership.js","./club.js","./registration.js","./registration-demo.js","./registration-ui.js","./member-ui.js","./member-finance.js","./member-format.js","./contributions.js","./debit-export.js","./dates.js","./pricing.js","./team-transfer.js","./bank-corrections.js","./club-store.js","./club-admin-ui.js","./history.js","./finance-tools.js","./updates.js","./club-features.css","./manifest.json","./icons/academy-32.png","./icons/academy-192.png","./icons/academy-512.png"];
const OPTIONAL=["./membership-pdf.js","./vendor/fontkit.es.min.js","./vendor/fonts/NotoSans-Bold.ttf","./vendor/fonts/NotoSans-Regular.ttf","./vendor/pako.esm.js","./vendor/pdf-lib.esm.min.js","./content/documents.json"];
self.addEventListener('install',event=>event.waitUntil(caches.open(VERSION).then(cache=>cache.addAll(CORE))));
self.addEventListener('message',event=>{if(event.data?.type==='ACTIVATE_UPDATE')self.skipWaiting();});
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('beerpong-')&&key!==VERSION).map(key=>caches.delete(key))))));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET')return;
 const url=new URL(event.request.url),local=url.origin===self.location.origin;
 if(local&&![...CORE,...OPTIONAL].some(path=>new URL(path,self.registration.scope).pathname===url.pathname))return;
 if(!local&&!(url.origin==='https://www.gstatic.com'&&url.pathname.startsWith('/firebasejs/')))return;
 event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(VERSION).then(cache=>cache.put(event.request,copy)).catch(()=>{});}return response;}).catch(async()=>await caches.match(event.request)??(event.request.mode==='navigate'?await caches.match(new URL('./index.html',self.registration.scope)):null)??new Response('Offline. Bitte die Verbindung wiederherstellen.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}})));
});
