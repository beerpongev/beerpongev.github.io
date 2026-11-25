import {escapeHTML as e} from './ui.js';
import {dispatch} from './scheduler.js';
import {tableStatus} from './engine.js';
import {boardRegistrationNotifications} from './board-alerts.js';
export const notificationTime=t=>t?.toMillis?.()??(typeof t==='number'?t:(t?.seconds??0)*1000);
export function freeTableNotifications(state,tournamentId){
 if(!state||['setup','complete'].includes(state.phase))return[];
 const games=dispatch(state).matches,last=new Map();
 for(const [index,event]of (state.dispatchEvents??[]).entries())if(event.type==='score'){const game=games[event.id];if(game?.phase===state.phase&&game.table)last.set(game.table,{event,index});}
 return [...last].filter(([table])=>tableStatus(state,table)==='free').map(([table,{event,index}])=>({id:`table:${tournamentId}:${table}:${event.id}:${index}`,title:`Tisch ${table} ist frei`,detail:'Ergebnis eingetragen; noch kein nächstes Spiel zugewiesen.',time:event.at??0,view:'overview',tournamentId,table}));
}
/** Nur freigegebene Leitungsrollen; Inhalte bleiben im RAM. Gespeichert werden nur Gelesen-IDs. */
export function createNotifications(ctx){
 let key='',generation=0,stop=()=>{},inbox=[],items=[],seen=new Set(),known=new Set(),primed=false,demoLoading=false;
 const host=document.createElement('div');host.className='notification-control';host.hidden=true;document.querySelector('.account').prepend(host);
 function persist(){try{localStorage.setItem(key,JSON.stringify([...seen].slice(-500)));}catch{}}
 function paint(){
  const open=host.querySelector('details')?.open??false,unread=items.filter(i=>!seen.has(i.id)).length;
  host.innerHTML=`<details ${open?'open':''}><summary aria-label="Benachrichtigungen${unread?', '+unread+' ungelesen':''}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="M5 17h14l-2-3V9a5 5 0 0 0-10 0v5l-2 3m5 3h4"/></svg><span class="notification-count" ${unread?'':'hidden'}>${unread}</span></summary><section class="notification-panel"><div class="notification-panel-heading"><h2>Benachrichtigungen</h2><button type="button" class="text-button" data-notification-close aria-label="Benachrichtigungen schließen">×</button></div><p class="legend">Hinweise in dieser App. Gelesen gilt auf diesem Gerät.</p><button class="text-button" data-notification-read>Alle als gelesen markieren</button><div class="notification-items">${items.map(i=>`<button class="notification-item ${seen.has(i.id)?'':'notification-unread'}" data-notification-id="${e(i.id)}"><strong>${e(i.title)}</strong><span>${e(i.detail)}</span>${i.time?`<small>${e(new Date(i.time).toLocaleString('de-DE',{timeZone:'Europe/Berlin'}))}</small>`:''}</button>`).join('')||'<p>Keine aktuellen Meldungen.</p>'}</div><p class="legend">Kein E-Mail- oder Push-Versand. Neue Hinweise erscheinen bei geöffneter App.</p></section></details>`;
 }
 function refresh(announce=true){
  const tables=ctx.admin()&&!ctx.readOnly()?freeTableNotifications(ctx.state(),ctx.tournamentId()):[];
  items=[...tables,...inbox].sort((a,b)=>b.time-a.time).slice(0,100);
  const fresh=items.filter(i=>!known.has(i.id)&&!seen.has(i.id));known=new Set(items.map(i=>i.id));
  if(announce&&primed&&fresh.length)ctx.toast(fresh.length===1?fresh[0].title:`${fresh.length} neue Benachrichtigungen`);
  paint();
 }
 function stopAll(){generation++;stop();stop=()=>{};inbox=[];items=[];seen.clear();known.clear();primed=false;demoLoading=false;host.innerHTML='';host.hidden=true;key='';}
 async function demoInbox(g){
  if(demoLoading)return;demoLoading=true;
  try{
   const api=ctx.backend(),[applications,changes,groups,issues]=await Promise.all([api.listMemberships(),api.listProfileChanges(),Promise.all(ctx.eventIds().map(async id=>({id,rows:await api.listRegistrations(id),state:id===ctx.tournamentId()?ctx.state():null}))),api.listBoardInvitationIssues?api.listBoardInvitationIssues(ctx.eventIds()):[]]);
   if(g!==generation)return;
   inbox=[...changes.filter(r=>r.status==='pending').map(r=>({id:'profile-change:'+r.id+':'+notificationTime(r.submittedAt),title:'Neue Datenänderung',detail:'Ein Mitglied hat seine Daten geändert. Bitte zur Freigabe prüfen.',view:'applications',time:notificationTime(r.submittedAt)})),...applications.filter(a=>!a.review).map(a=>({id:'application:'+a.id,title:'Neuer Mitgliedsantrag',detail:'Mitgliedsantrag im Vorstand prüfen.',view:'applications',time:notificationTime(a.createdAt)})),...groups.flatMap(group=>boardRegistrationNotifications(group.rows,group.state,group.id)),...issues.map(r=>({id:'invitation-issue:'+r.id+':'+r.time,title:'Kontoeinladung fehlgeschlagen',detail:r.name,view:r.view,filter:r.filter,tournamentId:r.tournamentId,time:r.time}))];
   refresh();primed=true;
  }catch(err){if(g===generation)ctx.toast('Benachrichtigungen: '+err.message);}finally{if(g===generation)demoLoading=false;}
 }
 function update(){
  if(!ctx.ready()||!ctx.admin()){if(key)stopAll();return;}
  const next=`beerpong-notifications:${ctx.identity()}:${ctx.board()?'board':'admin'}:${ctx.eventIds().join(',')}`;
  if(next!==key){stopAll();key=next;host.hidden=false;try{const saved=JSON.parse(localStorage.getItem(key)??'[]');seen=new Set(Array.isArray(saved)?saved.filter(s=>typeof s==='string').slice(-500):[]);}catch{}const g=generation;
   if(ctx.board()&&!ctx.demo())void ctx.backend().watchNotificationInbox({tournamentIds:ctx.eventIds(),onItems:rows=>{if(g!==generation)return;inbox=rows;refresh();primed=true;},onError:err=>{if(g===generation){inbox=[];refresh(false);ctx.toast('Benachrichtigungen konnten nicht geladen werden: '+err.message);}}}).then(cancel=>{if(g===generation)stop=cancel;else cancel();}).catch(err=>{if(g===generation)ctx.toast('Benachrichtigungen: '+err.message);});
  }
  host.hidden=false;refresh();if(!ctx.board())primed=true;if(ctx.board()&&ctx.demo())void demoInbox(generation);
 }
 const close=()=>{const details=host.querySelector('details');if(details){details.open=false;details.querySelector('summary')?.focus();}};
 host.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close();}});
 host.addEventListener('click',event=>{if(event.target.closest('[data-notification-close]')){close();return;}if(event.target.closest('[data-notification-read]')){items.forEach(i=>seen.add(i.id));persist();paint();return;}const button=event.target.closest('[data-notification-id]'),item=items.find(i=>i.id===button?.dataset.notificationId);if(!item)return;seen.add(item.id);persist();host.querySelector('details').open=false;ctx.open(item);});
 document.addEventListener('click',event=>{if(!host.contains(event.target))host.querySelector('details')?.removeAttribute('open');});
 return{update,clear:stopAll};
}
