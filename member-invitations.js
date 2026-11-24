import {escapeHTML as e} from './ui.js';
import {nameKey} from './registration.js';

const labels={invite:'Neue Einladung',link:'Nur verknüpfen · ohne Mail',existing:'Zugang vorhanden',done:'Bereits eingeladen',review:'Bitte prüfen'};
const tones={invite:'pending',link:'pending',existing:'paid',done:'paid',review:'returned'};

/** Private Vorschau bleibt im RAM. Erst ein bestätigter Klick startet den Versand. */
export function createMemberInvitations(ctx){
 let root=null,key='',generation=0,plan=null,opened=false,query='',filter='open',working=false,stopRequested=false,progress=0,total=0,message='',error='';
 const selected=new Set(),results=new Map();
 const allowed=()=>ctx.isBoard()&&ctx.isActive();
 const active=g=>g===generation&&allowed()&&root?.isConnected&&key===ctx.identity();
 function clear(){generation++;stopRequested=true;root?.replaceChildren();root=null;key='';plan=null;opened=false;query='';filter='open';working=false;progress=total=0;message=error='';selected.clear();results.clear();}
 function mount(element){
  if(!allowed()){clear();return;}if(key&&key!==ctx.identity())clear();key=ctx.identity();root=element;paint();
 }
 function chosen(){return(plan??[]).filter(p=>p.eligible&&selected.has(p.memberId));}
 function visible(){const text=nameKey(query);return(plan??[]).filter(p=>(!text||nameKey(p.name+' '+p.email+' '+p.loginEmail+' '+p.number).includes(text))&&(filter==='all'||filter==='open'&&p.eligible||filter==='existing'&&['existing','done'].includes(p.kind)||filter===p.kind));}
 function reconcile(){for(const id of selected)if(!plan?.some(p=>p.memberId===id&&p.eligible))selected.delete(id);}
 function paint(){
  if(!root||!allowed())return;
  const focus=root.querySelector('#member-invitation-search')===document.activeElement,position=focus?[document.activeElement.selectionStart,document.activeElement.selectionEnd]:null;
  const counts=Object.fromEntries(Object.keys(labels).map(k=>[k,(plan??[]).filter(p=>p.kind===k).length])),selection=chosen(),invitations=selection.filter(p=>p.kind==='invite'),links=selection.length-invitations.length;
  root.innerHTML=`<details class="panel member-invitation-panel" ${opened?'open':''}><summary>Mitglieder ohne Zugang einladen</summary><p>Aktive Mitglieder prüfen. Nur neue Konten erhalten eine Passwort-Mail. Bestehende Konten werden bei Bedarf ohne E-Mail verknüpft.</p>${ctx.demo()?'<p class="notice">DEMO · Nur Beispieldaten. Konten und Versand werden simuliert.</p>':''}<div class="admin-actions"><button type="button" class="button light" data-member-invite-action="preview" ${working?'disabled':''}>${plan?'Vorschau aktualisieren':'Mitglieder prüfen'}</button>${working?'<button type="button" class="button light" data-member-invite-action="stop" '+(stopRequested?'disabled':'')+'>Nach aktuellem Mitglied stoppen</button>':''}</div><p class="form-error" role="alert" ${error?'':'hidden'}>${e(error)}</p><p class="member-invitation-progress" role="status">${e(working?total===0?'Mitglieder und vorhandene Zugänge werden geprüft …':progress+' von '+total+' bearbeitet'+(stopRequested?' · wird angehalten …':' …'):message)}</p>${plan?`<p class="member-invitation-counts"><span><b>${counts.invite}</b> neue Zugänge</span><span><b>${counts.link}</b> verknüpfen</span><span><b>${counts.existing+counts.done}</b> bereits vorhanden</span><span><b>${counts.review}</b> prüfen</span></p><div class="form-columns member-invitation-filters"><label>Mitglied suchen<input id="member-invitation-search" type="search" value="${e(query)}" placeholder="Vorname, Nachname, E-Mail oder Nummer" ${working?'disabled':''}></label><label>Anzeige<select id="member-invitation-filter" ${working?'disabled':''}>${[['open','Einladungen & Verknüpfungen offen'],['invite','Nur neue Einladungen'],['link','Nur Verknüpfungen'],['existing','Bereits vorhandene Zugänge'],['review','Manuell prüfen'],['all','Alle aktiven Mitglieder']].map(([v,l])=>'<option value="'+v+'" '+(v===filter?'selected':'')+'>'+l+'</option>').join('')}</select></label></div><div class="admin-actions"><button type="button" class="text-button" data-member-invite-action="select" ${working?'disabled':''}>Sichtbare offene Einträge auswählen</button><button type="button" class="text-button" data-member-invite-action="clear" ${working?'disabled':''}>Auswahl aufheben</button></div><p>${invitations.length} neue Einladungen · ${links} Verknüpfungen ohne Mail ausgewählt.</p><button type="button" class="button" data-member-invite-action="send" ${working||!selection.length?'disabled':''}>Auswahl bestätigen & bearbeiten (${selection.length})</button><p class="legend">Der Durchlauf arbeitet nacheinander. Bitte die Seite geöffnet lassen. Bei einem Fehler wird angehalten; bereits erledigte Vorgänge werden beim nächsten Prüfen ausgelassen.</p><div class="member-invitation-list">${visible().map(p=>`<article class="member-invitation-row">${p.eligible?`<input type="checkbox" data-member-invite-id="${e(p.memberId)}" aria-label="${e(p.name)} auswählen" ${selected.has(p.memberId)?'checked':''} ${working?'disabled':''}>`:'<span aria-hidden="true"></span>'}<div><strong>${e(p.name)}</strong>${p.number?'<small>Nr. '+e(p.number)+'</small>':''}<small>${e(p.email||'Keine Kontakt-E-Mail')}</small>${p.uid&&p.loginEmail!==p.email?'<small>Login: '+e(p.loginEmail)+'</small>':''}<p>${e(p.detail)}</p>${results.get(p.memberId)?.message?'<p class="notice">'+e(results.get(p.memberId).message)+'</p>':''}</div><span class="contribution-tag contribution-${tones[p.kind]}">${e(labels[p.kind])}</span></article>`).join('')||'<p>Keine Einträge für diese Auswahl.</p>'}</div><p class="legend">Unklare Zuordnungen zuerst unter „Mitglieder“ bzw. „Benutzerkonten“ prüfen. Eine noch nicht erfasste Anmeldung allein löst hier keine neue Passwort-Mail aus.</p>`:''}</details>`;
  root.querySelector('details').ontoggle=event=>{opened=event.currentTarget.open;};
  root.onclick=event=>{const action=event.target.closest('[data-member-invite-action]')?.dataset.memberInviteAction;if(!action)return;if(action==='stop'){stopRequested=true;paint();return;}if(working)return;if(action==='preview')void preview();if(action==='select'){visible().filter(p=>p.eligible).forEach(p=>selected.add(p.memberId));paint();}if(action==='clear'){selected.clear();paint();}if(action==='send')void send();};
  root.onchange=event=>{if(working)return;if(event.target.dataset.memberInviteId){const id=event.target.dataset.memberInviteId;event.target.checked?selected.add(id):selected.delete(id);paint();}if(event.target.id==='member-invitation-filter'){filter=event.target.value;paint();}};
  root.oninput=event=>{if(event.target.id==='member-invitation-search'&&!working){query=event.target.value;paint();}};
  if(focus){const input=root.querySelector('#member-invitation-search');input?.focus({preventScroll:true});input?.setSelectionRange(...position);}
 }
 async function preview(){
  const g=generation;opened=true;working=true;progress=total=0;error='';message='';paint();
  try{const next=await ctx.backend().previewMemberInvitations();if(!active(g))return;plan=next;reconcile();message='Vorschau bereit. Noch keine Konten angelegt oder E-Mails angefordert.';}
  catch(err){if(active(g))error=err.message??String(err);}
  finally{if(active(g)){working=false;paint();}}
 }
 async function send(){
  const rows=chosen();if(!rows.length)return;
  const invites=rows.filter(p=>p.kind==='invite'),links=rows.filter(p=>p.kind==='link');
  const question=(ctx.demo()?'DEMO simulieren: ':'')+invites.length+' neue Konten mit Passwort-Mail und '+links.length+' Verknüpfungen ohne E-Mail bearbeiten?\n\n'+rows.map(p=>p.name+' · '+p.loginEmail+' · '+(p.kind==='invite'?'NEUE EINLADUNG':'OHNE E-MAIL')).join('\n')+'\n\nBestehende Konten erhalten keine neue Passwort-Mail.';
  if(!confirm(question))return;
  const g=generation;working=true;stopRequested=false;progress=0;total=rows.length;error='';message='';paint();
  let sent=0,linked=0,skipped=0,review=0;
  try{
   for(let offset=0;offset<rows.length;offset+=20){
    if(!active(g)||stopRequested)break;const batch=rows.slice(offset,offset+20);
    await ctx.backend().sendMemberInvitations(batch.map(p=>p.memberId),{expectedSnapshots:Object.fromEntries(batch.map(p=>[p.memberId,p.snapshot])),canContinue:()=>active(g)&&!stopRequested,onProgress:result=>{
     if(!active(g))return;results.set(result.id,result);selected.delete(result.id);progress++;
     if(result.status==='sent')sent++;else if(result.status==='linked')linked++;else if(result.status==='skipped')skipped++;else{review++;stopRequested=true;}
     paint();
    }});
   }
   if(!active(g))return;plan=await ctx.backend().previewMemberInvitations();if(!active(g))return;reconcile();
   message=(ctx.demo()?'DEMO · ':'')+sent+' neue Einladungen '+(ctx.demo()?'simuliert':'von Firebase angenommen')+' · '+linked+' Konten ohne Mail verknüpft · '+skipped+' übersprungen · '+review+' prüfen.'+(progress<total?' Durchlauf angehalten; verbleibende Auswahl kann nach Prüfung fortgesetzt werden.':' Durchlauf abgeschlossen.');
   ctx.toast(ctx.demo()?'Demo-Durchlauf abgeschlossen.':sent+' Einladungen angefordert · '+linked+' Konten verknüpft.');
  }catch(err){if(active(g)){error=err.message??String(err);message='Durchlauf angehalten. Vorschau aktualisieren und protokollierte Vorgänge prüfen, bevor erneut gestartet wird.';}}
  finally{if(active(g)){working=false;paint();}}
 }
 return{mount,clear};
}
