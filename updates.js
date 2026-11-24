/** Aktualisierung erst nach bewusster Aktion; Eingaben und Unterschriften berücksichtigen. */
export async function installUpdates(){
const version=document.querySelector('#app-version');if(version)version.textContent='Version 12.23';
 if(!('serviceWorker'in navigator)||!(location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname)))return;
 const dirty=new WeakSet();let changing=false;
 document.addEventListener('input',event=>{const form=event.target.closest('form');if(form)dirty.add(form);},true);
 document.addEventListener('pointerdown',event=>{if(event.target.tagName==='CANVAS'){const form=event.target.closest('form');if(form)dirty.add(form);}},true);
 document.addEventListener('reset',event=>dirty.delete(event.target),true);
 const registration=await navigator.serviceWorker.register('./sw.js');
 const show=()=>{
  if(!registration.waiting||!navigator.serviceWorker.controller||document.querySelector('#app-update'))return;
  const banner=document.createElement('aside');banner.id='app-update';banner.className='app-update';banner.setAttribute('role','status');banner.innerHTML='<span>Eine neue App-Version ist bereit.</span><button class="button light" type="button">Jetzt aktualisieren</button>';
  banner.querySelector('button').onclick=()=>{
   if([...document.querySelectorAll('form')].some(form=>dirty.has(form))&&!confirm('Es gibt eingegebene Formulardaten oder Unterschriften. Ungespeicherte Eingaben verwerfen und die App aktualisieren?'))return;
   if(!registration.waiting)return;changing=true;registration.waiting.postMessage({type:'ACTIVATE_UPDATE'});
  };document.body.append(banner);
 };
 show();registration.addEventListener('updatefound',()=>registration.installing?.addEventListener('statechange',show));
 navigator.serviceWorker.addEventListener('controllerchange',()=>{if(changing)location.reload();});
}
