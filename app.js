import * as E from './engine.js';
import * as cloud from './firebase.js';
import {escapeHTML as e,localDate} from './ui.js';
import {parseTeamsCSV,validateBackup} from './data.js';
import {loadDocuments,rulesView,bindDocumentSearch,documentPages} from './documents.js';
import {membershipView,bindMembership} from './membership.js';

const $=s=>document.querySelector(s),localDemo=!cloud.configured,onlineDemoRequested=cloud.configured&&new URL(location.href).searchParams.get('demo')==='1';
const DEMO_KEY=onlineDemoRequested?'beerpong-board-demo-'+cloud.liveCacheKey:'beerpong-demo-v2';
let demo=localDemo,demoAuthorized=false,demoGateError='';
let state=null,role='guest',teamId='',user=null,users=[],synced=false,busy=false;
let view=new URL(location.href).searchParams.get('bereich')==='mitgliedschaft'?'membership':'overview';
let groupFilter='all',roundFilter='r16',gameFilter='open',tableFilter='all',search='',matchLimit=12,ownOnly=false,teamMode='teams';
let modal={},installEvent,toastTimer,privateApplications=[];
let playerCalloutMarkup='';
const admin=()=>['admin','board'].includes(role),board=()=>role==='board';
const writable=()=>!busy&&(demo||(synced&&navigator.onLine))&&['board','admin','player'].includes(role);
const team=id=>state?.teams.find(t=>t.id===id),own=id=>!!teamId&&id===teamId;
const name=id=>`<span class="${own(id)?'own-team-name':''}">${e(team(id)?.name??'Noch offen')}${own(id)?'<span class="own-badge">Dein Team</span>':''}</span>`;
const canScore=m=>!!m&&writable()&&(admin()||(role==='player'&&state.allowSelfScoring&&m.phase===state.phase&&[m.a,m.b].includes(teamId)));
const btn=(label,action,id='',extra='')=>`<button class="button light" data-action="${action}" data-id="${e(id)}" ${extra}>${label}</button>`;
const statusLabels={free:'Frei',open:'Zugewiesen · offen',preparing:'In Vorbereitung',playing:'Wird bespielt',disabled:'Nicht bespielbar',draining:'Läuft aus'};
const nextLabel=s=>({setup:'Gruppenphase starten',group:'Achtelfinale starten',r16:'Viertelfinale starten',quarter:'Halbfinale starten',semi:'Finalspiele starten',final:'Turnier abschließen',complete:'Turnier beendet'})[s.phase];
const roleLabel=r=>({guest:'Zuschauer',player:'Mitspieler',admin:'Spielleitung',board:'Vorstand'})[r]??'Zuschauer';
function toast(message){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>{$('#toast').hidden=true;},7000);}
function humanError(error){return({'auth/invalid-credential':'E-Mail oder Passwort stimmt nicht.','auth/invalid-email':'Bitte eine gültige E-Mail-Adresse eingeben.','auth/email-already-in-use':'Das Konto existiert bereits. Bitte dessen UID über „Vorhandenes Konto zuweisen“ verknüpfen.','auth/weak-password':'Bitte ein stärkeres Passwort verwenden.','auth/requires-recent-login':'Bitte erneut anmelden und die Aktion wiederholen.','auth/unauthorized-continue-uri':'Bitte beerpongev.github.io unter Firebase Authentication → Einstellungen → Autorisierte Domains hinzufügen.','auth/too-many-requests':'Zu viele Versuche. Bitte kurz warten.','permission-denied':'Keine Berechtigung. Bitte Teamzuordnung, Selbsteingabe und veröffentlichte Firestore-Regeln prüfen.','unavailable':'Keine Verbindung zu Firebase. Änderungen benötigen Internet.'})[error.code]??error.message??'Aktion fehlgeschlagen.';}
async function task(fn,message,close=true){
  if(busy)return;busy=true;document.body.classList.add('busy');document.querySelectorAll('dialog button[type=submit]').forEach(b=>b.disabled=true);
  try{await fn();if(close)$('#dialog').close();if(message)toast(message);}
  catch(error){const target=$('#dialog[open] .form-error');if(target){target.textContent=humanError(error);target.hidden=false;}else toast(humanError(error));}
  finally{busy=false;document.body.classList.remove('busy');document.querySelectorAll('dialog button[type=submit]').forEach(b=>b.disabled=false);render();}
}
async function commit(transform,options={}){
  if(onlineDemoRequested&&!demoAuthorized)throw new Error('Die Online-Demo ist nur für den eingeloggten Vorstand freigegeben.');
  if(!['board','admin','player'].includes(role))throw new Error('Bitte mit Schreibberechtigung anmelden.');
  if(!demo&&(!synced||!navigator.onLine))throw new Error('Änderungen benötigen eine bestätigte Live-Verbindung.');
  if(!demo)return cloud.mutate(transform,options.expectedRevision,options);
  if(options.expectedRevision!==undefined&&options.expectedRevision!==state?.revision)throw new Error('Der Stand wurde inzwischen geändert. Bitte erneut öffnen.');
  if(options.id&&(JSON.stringify(state.results[options.id]??null)!==options.baseline||JSON.stringify(state.matches[options.id])!==options.match))throw new Error('Dieses Spiel wurde inzwischen geändert. Bitte erneut öffnen.');
  const next=transform(state);next.revision=(state?.revision??-1)+1;next.updatedBy='demo';next.updatedAt=Date.now();state=next;
  localStorage.setItem(DEMO_KEY,JSON.stringify(state));render();
}
function adminCommit(transform,revision=state?.revision){if(!admin())throw new Error('Diese Aktion ist der Spielleitung vorbehalten.');return commit(transform,{expectedRevision:revision});}

function liveAppURL(){const url=new URL(location.href);url.search='';url.hash='';return url.href;}
// Eigener Browserspeicher: Online-Demo schreibt niemals in den Live-Cache.
function loadDemoState(){
  try{const saved=JSON.parse(localStorage.getItem(DEMO_KEY));state=saved?validateBackup({format:'beerpong-v2',state:saved}):E.demoTournament();}
  catch{state=E.demoTournament();}
  localStorage.setItem(DEMO_KEY,JSON.stringify(state));
}
// Die echte Firebase-Rolle prüft den Zugang; der Rollenwähler simuliert nur die Demo.
function setDemoAccess(realRole){
  if(realRole==='board'){
    if(!demoAuthorized){loadDemoState();role='board';teamId='';view='overview';}
    demoAuthorized=true;demo=true;demoGateError='';
  }else{
    demoAuthorized=false;demo=false;state=null;role='guest';teamId='';users=[];privateApplications=[];
    if($('#dialog').open)$('#dialog').close();
  }
  render(true);
}
function renderDemoGate(){
  document.body.classList.remove('online-demo');document.body.style.setProperty('--demo-toolbar-height','0px');
  $('.tabs').hidden=true;$('#admin-tab').hidden=true;$('#board-tab').hidden=true;$('#phase-badge').hidden=true;$('#mode-banner').hidden=true;$('#mode-banner').innerHTML='';
  $('#connection').textContent='Online-Demo · Vorstandszugang';$('#connection').classList.remove('online');
  $('#login-button').textContent=user&&!user.isAnonymous?'Konto ↗':'Anmelden ↗';
  renderPlayerCallout();
  $('#main').innerHTML=`<section class="panel demo-gate"><p class="eyebrow">GESCHÜTZTER TESTBEREICH</p><h2>Online-Demo für den Vorstand.</h2><p>Die Demo verwendet ausschließlich lokale Beispieldaten. Bitte mit einem Vorstandskonto anmelden; der Zugang wird über die Rolle im Firebase-Projekt geprüft.</p>${user&&!user.isAnonymous?`<p>Angemeldet: <b>${e(user.email)}</b>. Für den Testbereich wird die Rolle „Vorstand“ benötigt.</p>`:btn('Mit Vorstandskonto anmelden','login')}${demoGateError?`<p class="notice error">${e(demoGateError)}</p>`:''}<p><a href="${e(liveAppURL())}">Zum Live-Turnier ↗</a></p></section>`;
}
function updateDemoToolbarHeight(){const banner=$('#mode-banner');document.body.style.setProperty('--demo-toolbar-height',onlineDemoRequested&&demoAuthorized?`${Math.ceil(banner.getBoundingClientRect().height)}px`:'0px');}
function render(force=false){
  if(onlineDemoRequested&&!demoAuthorized){renderDemoGate();return;}
  $('.tabs').hidden=false;
  $('#connection').textContent=demo?(onlineDemoRequested?'Online-Demo':'Lokale Demo'):synced&&navigator.onLine?'Live verbunden':'Verbindung unterbrochen';$('#connection').classList.toggle('online',!demo&&synced&&navigator.onLine);
  $('#login-button').textContent=user&&!user.isAnonymous?'Konto ↗':'Anmelden ↗';$('#admin-tab').hidden=!admin();$('#board-tab').hidden=!board();
  if(view==='admin'&&!admin()||view==='board'&&!board())view='overview';
  document.querySelectorAll('[data-view]').forEach(b=>{if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  const phase=state?E.LABELS[state.phase]:'';
  $('#phase-badge').textContent=phase??'';
  $('#phase-badge').hidden=!phase;
  $('#mode-banner').hidden=!demo&&synced&&navigator.onLine;
  document.body.classList.toggle('online-demo',onlineDemoRequested&&demoAuthorized);
  $('#mode-banner').innerHTML=demo?`DEMO · Beispieldaten nur in diesem Browser. ${onlineDemoRequested?`<a class="demo-exit" href="${e(liveAppURL())}">Zum Live-Turnier ↗</a>`:''}<label>Ansicht testen <select id="demo-role"><option value="guest" ${role==='guest'?'selected':''}>Zuschauer</option><option value="player" ${role==='player'?'selected':''}>Mitspieler</option><option value="admin" ${role==='admin'?'selected':''}>Spielleitung</option><option value="board" ${board()?'selected':''}>Vorstand</option></select></label>${role==='player'&&state?`<label>Dein Team <select id="demo-team">${state.teams.map(t=>`<option value="${e(t.id)}" ${teamId===t.id?'selected':''}>${e(t.name)}</option>`).join('')}</select></label>`:''}`:'Verbindung wird hergestellt oder ist unterbrochen. Der Stand kann veraltet sein; Änderungen sind gesperrt.';
  // Live-Updates dürfen keine Unterschriften oder ungesendeten Antragsdaten löschen.
  renderPlayerCallout();
  updateDemoToolbarHeight();
  if(!force&&view==='membership'&&$('#membership-root'))return;
  if(!force&&view==='rules'&&$('#document-selector'))return;
  const details=[...document.querySelectorAll('#main details[open][data-detail]')].map(d=>d.dataset.detail);
  const searchField=$('#search-form input'),draft=searchField?.value,focused=document.activeElement===searchField,selection=focused?[searchField.selectionStart,searchField.selectionEnd]:null;
  if(view==='rules'){$('#main').innerHTML=rulesView();bindDocumentSearch();return;}
  if(view==='membership'){$('#main').innerHTML=membershipView();bindMembership({demo});bindDocumentSearch();return;}
  if(view==='board'){$('#main').innerHTML=boardView();return;}
  if(!state){$('#main').innerHTML=`<div class="empty"><p class="eyebrow">BEREIT FÜR DEN ERSTEN WURF</p><h2>${synced?'Hier entsteht euer Turnier.':'Verbindung zum Turnier …'}</h2><p>${synced?'Die Spielleitung kann jetzt das Turnier anlegen.':'Für den Live-Spielplan wird eine Internetverbindung benötigt. Regelwerk und Mitgliedschaft sind unabhängig davon zugänglich.'}</p>${admin()?btn('Turnier anlegen','initialize'):''}</div>`;return;}
  $('#main').innerHTML=({overview:overviewView,groups:groupsView,bracket:bracketView,teams:teamsView,admin:adminView})[view]();
  for(const d of document.querySelectorAll('#main details[data-detail]'))if(details.includes(d.dataset.detail))d.open=true;
  const nextSearch=$('#search-form input');if(nextSearch&&draft!==undefined){nextSearch.value=draft;if(focused){nextSearch.focus({preventScroll:true});nextSearch.setSelectionRange(...selection);}}
}
function matchCard(m,compact=false){
  const r=state.results[m.id],isOwn=[m.a,m.b].some(own);
  const score=side=>!r?'—':String(E.remainingCups(r,side));
  return `<article class="match-card ${isOwn?'own-match':''}"><div class="match-top"><span>${e(m.label)}</span><span>${m.table?`Tisch ${m.table}`:m.held?'Zurückgestellt':'Automatische Vergabe'}</span></div>${['a','b'].map(side=>`<div class="match-team ${r?.winner===side?'winner':''}"><span class="name">${name(m[side])}${r?.winner===side?' <span aria-label="Sieger">✓</span>':''}</span><span class="score ${r&&r.winner!==side?'score-emphasis':''}">${score(side)}</span></div>`).join('')}${r?`<div class="match-note">${r.overtime?'Nach Verlängerung · gewertete Restbecher: Sieger 0, Verlierer 1':'Übrige Becher · Sieger: 3 Punkte, Verlierer: 0 Punkte'}</div>`:['open','preparing','playing'].includes(m.status)?`<div class="match-note"><span class="tag table-status status-${m.status}">${statusLabels[m.status]}</span></div>`:''}<div class="match-actions">${canScore(m)?btn(r?'Ergebnis korrigieren':'Ergebnis eintragen','score',m.id):''}${admin()&&writable()&&!r&&m.phase===state.phase?btn(m.table?'Tisch ändern':'Tisch zuweisen','assign',m.id):''}</div></article>`;
}
function overviewView(){
  const all=E.allMatches(state),current=E.phaseMatches(state),done=Object.keys(state.results).length,phaseDone=current.filter(m=>state.results[m.id]).length;
  const pct=current.length?Math.round(phaseDone/current.length*100):0,open=current.filter(m=>!state.results[m.id]);
  const recent=all.filter(m=>state.results[m.id]).sort((a,b)=>(state.results[b.id].at??b.order)-(state.results[a.id].at??a.order)).slice(0,4);
  let filtered=all.filter(m=>gameFilter==='all'||(gameFilter==='done'?state.results[m.id]:!state.results[m.id]&&m.phase===state.phase));
  if(tableFilter!=='all')filtered=filtered.filter(m=>m.table===Number(tableFilter));
  if(ownOnly&&teamId)filtered=filtered.filter(m=>[m.a,m.b].includes(teamId));
  if(search)filtered=filtered.filter(m=>`${team(m.a)?.name} ${team(m.b)?.name}`.toLocaleLowerCase('de').includes(search.toLocaleLowerCase('de')));
  const visibleTables=Math.max(state.tableCount,...current.filter(m=>!state.results[m.id]&&m.status==='playing').map(m=>m.table));
  return `${podium()}<div class="section-head"><div><p class="eyebrow">ALLES IM BLICK</p><h2>Euer Turnier. Wurf für Wurf.</h2><p>${e(E.LABELS[state.phase])} · Fortlaufende Tischvergabe ohne Spieltage</p></div><span class="tag ${synced?'live':''}">${demo?'DEMO':synced?'LIVE':'OFFLINE'}</span></div>${teamId?`<div class="own-banner">Du spielst für ${name(teamId)}. ${btn('Meine Spiele','my-games')}</div>${role==='player'&&!state.allowSelfScoring?'<p class="legend">Die Selbsteingabe ist derzeit gesperrt. Bitte melde Ergebnisse der Spielleitung.</p>':''}`:''}<div class="stats"><div class="stat"><strong>${state.teams.length}<small>/32</small></strong><span>Teams am Start</span></div><div class="stat"><strong>8</strong><span>Gruppen</span></div><div class="stat"><strong>${done}<small>/64</small></strong><span>Spiele beendet</span></div><div class="stat"><strong>${E.activeTables(state)}<small>/${state.tableCount}</small></strong><span>Tische bespielbar</span></div></div>${state.phase!=='setup'&&state.phase!=='complete'?`<div class="progress-line" role="progressbar" aria-label="Phasenfortschritt" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div><div class="progress-meta"><span>${e(E.LABELS[state.phase])}</span><span>${phaseDone} von ${current.length} Spielen</span></div>`:''}<div class="panel-head"><h3>An den Tischen</h3><span class="legend">${open.length} Spiele offen</span></div><div class="table-status-legend" aria-label="Tischstatus-Farben"><span class="table-status status-open">Rot: Teams zum Tisch</span><span class="table-status status-preparing">Gelb: Aufbau</span><span class="table-status status-playing">Grün: Spiel läuft</span></div><div class="grid tables-grid">${Array.from({length:visibleTables},(_,i)=>tableCard(i+1)).join('')}</div><div class="two-column"><section class="panel"><div class="panel-head"><h3>Spielplan</h3><span class="tag">${filtered.length} SPIELE</span></div><div class="filter-bar"><label><span class="filters-label">Spiele</span><select id="game-filter">${[['open','Aktuelle, offene'],['done','Beendete Spiele'],['all','Alle Spiele']].map(([v,l])=>`<option value="${v}" ${gameFilter===v?'selected':''}>${l}</option>`).join('')}</select></label><label><span class="filters-label">Tisch</span><select id="table-filter"><option value="all">Alle Tische</option><option value="0" ${tableFilter==='0'?'selected':''}>Ohne Tisch</option>${Array.from({length:visibleTables},(_,i)=>`<option value="${i+1}" ${tableFilter===String(i+1)?'selected':''}>Tisch ${i+1}</option>`).join('')}</select></label></div>${teamId?`<label class="checkbox-label own-filter"><input id="own-filter" type="checkbox" ${ownOnly?'checked':''}>Nur meine Spiele</label>`:''}<form id="search-form" class="filter-bar"><label><span class="filters-label">Team suchen</span><input type="search" name="search" maxlength="60" value="${e(search)}" placeholder="Teamname …"></label><button type="submit" class="button light" style="align-self:end">Suchen</button></form>${filtered.slice(0,matchLimit).map(m=>matchCard(m)).join('')||'<div class="empty"><p>Hier sind gerade keine Spiele.</p></div>'}${filtered.length>matchLimit?`<div class="admin-actions">${btn(`Weitere Spiele (${filtered.length-matchLimit})`,'more-games')}</div>`:''}</section><aside><section class="panel"><h3>Zuletzt abgeräumt</h3>${recent.map(m=>matchCard(m,true)).join('')||'<p class="legend">Die ersten Ergebnisse erscheinen hier.</p>'}</section><div class="notice">Sieg: <b>3 Punkte</b>, Niederlage: <b>0 Punkte</b>. Nach Verlängerung zählen <b>0 Restbecher beim Sieger und 1 beim Verlierer</b>. Sonst zählt die Anzahl übriger Becher des Verlierers für die Differenz.</div></aside></div>`;
}
function tableCard(n){
  const queue=E.tableQueue(state,n),active=E.activeAtTable(state,n),status=E.tableStatus(state,n);
  return `<article id="table-${n}" tabindex="-1" class="table-card table-state-${status} ${active?'occupied':''} ${status==='disabled'?'table-disabled':''}"><header><span class="table-no">TISCH ${String(n).padStart(2,'0')}</span><span class="tag table-status status-${status}">${statusLabels[status]}</span></header>${active?`<div class="team-name">${name(active.a)}</div><div class="versus">GEGEN</div><div class="team-name">${name(active.b)}</div><div class="match-meta">${e(active.label)}</div>${active.status==='open'?'<p class="match-note">Bitte zum Tisch kommen. Das Spiel ist noch nicht gestartet.</p>':active.status==='preparing'?'<p class="match-note">Die Teams bauen auf. Das Spiel ist noch nicht gestartet.</p>':''}${canScore(active)?btn('Ergebnis →','score',active.id):''}`:`<div class="empty-table">${status==='disabled'?'Für neue Spiele deaktiviert.':'Bereit für den nächsten Wurf.'}</div>`}${tableNextGames(queue,active)}${admin()&&writable()&&n<=E.activeTables(state)?btn('Tisch verwalten','table',String(n)):''}</article>`;
}
function tableNextGames(queue,active){
  const next=queue.filter(m=>m.id!==active?.id);if(!next.length)return '';
  return `<section class="table-next-games"><h4>${next.length===1?'Nächstes Spiel':'Nächste Spiele'}</h4><ol>${next.map((m,i)=>`<li class="${[m.a,m.b].some(own)?'own-next-game':''}"><span class="next-game-order">${i===0?'Als Nächstes':'Danach'}</span><div><b>${name(m.a)}</b><span class="queue-vs">gegen</span><b>${name(m.b)}</b></div>${admin()&&writable()?btn('Ändern','assign',m.id):''}</li>`).join('')}</ol></section>`;
}
function renderPlayerCallout(){
  const dock=$('#player-callout');if(!dock)return;
  const info=role==='player'?E.teamTableInfo(state,teamId):{current:null,upcoming:[]};
  const current=info.current&&['open','preparing'].includes(info.current.status)?info.current:null,m=current??info.upcoming[0];
  if(!m){dock.hidden=true;dock.innerHTML='';playerCalloutMarkup='';document.body.style.setProperty('--player-callout-space','0px');return;}
  const live=demo||synced&&navigator.onLine,urgent=m.status==='open',building=m.status==='preparing';
  const title=urgent?`Du bist dran: Tisch ${m.table}`:building?`Aufbau für dein Spiel: Tisch ${m.table}`:`Dein nächstes Spiel: Tisch ${m.table}`;
  const opponent=team(m.a===teamId?m.b:m.a)?.name??'Team',extras=info.upcoming.filter(g=>g.id!==m.id);
  const message=urgent?'Bitte komm jetzt zum Tisch. Deine Partie wartet auf den Start.':building?'Bitte komm zum Tisch und mach dich für dein Spiel bereit.':'Deine Partie ist vorgemerkt. Bitte halte dich bereit.';
  const html=`<div class="player-callout-copy"><span class="player-callout-label">${!live?'LETZTER GESPEICHERTER STAND':urgent?'JETZT ZUM TISCH':building?'DEIN TEAM WIRD ERWARTET':'DU BIST VORGEMERKT'}</span><h2>${e(title)}</h2><p><b>${e(team(teamId)?.name??'Dein Team')}</b> gegen <b>${e(opponent)}</b></p><p>${live?message:'Die Verbindung wird aktualisiert. Prüfe den aktuellen Stand, sobald du wieder verbunden bist.'}</p>${extras.length?`<p class="player-callout-next">Außerdem vorgemerkt: ${[...new Set(extras.map(g=>`Tisch ${g.table}`))].join(', ')}.</p>`:''}</div>${btn(`Tisch ${m.table} anzeigen`,'show-player-table',String(m.table))}`;
  dock.className=`player-callout ${!live?'player-callout-stale':urgent?'player-callout-urgent':'player-callout-upcoming'}`;
  if(html!==playerCalloutMarkup){dock.innerHTML=html;playerCalloutMarkup=html;}
  dock.hidden=false;updatePlayerCalloutSpace();
}
function updatePlayerCalloutSpace(){const dock=$('#player-callout');document.body.style.setProperty('--player-callout-space',!dock||dock.hidden?'0px':`${Math.ceil(dock.getBoundingClientRect().height)+36}px`);}
function tableDialog(n){
  if(!admin()||!writable())return;
  const head=E.activeAtTable(state,n),status=E.tableStatus(state,n),waiting=E.tableQueue(state,n).filter(m=>m.id!==head?.id),candidates=E.tableCandidates(state);
  const line=m=>`${team(m.a)?.name??'Team'} gegen ${team(m.b)?.name??'Team'} ${m.label}`;
  openDialog(`Tisch ${n} verwalten`,`${head?`<div class="table-current"><span class="tag table-status status-${status}">${statusLabels[status]}</span><p><b>${name(head.a)}</b> gegen <b>${name(head.b)}</b></p></div><label>Status<select name="status">${[['open','Zugewiesen · offen – Teams kommen zum Tisch'],['preparing','In Vorbereitung – Teams bauen auf'],['playing','Wird bespielt – Spiel gestartet']].map(([value,label])=>`<option value="${value}" ${status===value?'selected':''}>${label}</option>`).join('')}</select></label><p class="legend">„In Vorbereitung“ kann übersprungen werden. Vormerkungen verändern die aktuelle Partie nicht.</p>`:'<p>Aktuell ist keine Partie zugewiesen.</p><input type="hidden" name="status" value="free">'}<section class="table-queue-section"><h3>Danach an diesem Tisch</h3>${waiting.length?`<ol class="table-queue-list">${waiting.map(m=>`<li><div><b>${name(m.a)}</b> gegen <b>${name(m.b)}</b><small>${e(m.label)}</small></div>${btn('Ändern','assign',m.id)}</li>`).join('')}</ol>`:'<p class="legend">Noch keine Begegnung vorgemerkt.</p>'}</section><fieldset class="queue-picker"><legend>Nächste Begegnungen vormerken</legend>${candidates.length?`<p class="legend">Wähle eine oder mehrere Partien. Teams, die aktuell frei sind, stehen zuerst. Die Vormerkungen werden beim Speichern in der angezeigten Reihenfolge hinter vorhandene Vormerkungen gesetzt.</p><label>Team oder Gruppe suchen<input type="search" id="table-queue-search" placeholder="Teamname oder z. B. Gruppe A" maxlength="100" autocomplete="off"></label><p class="legend" id="table-queue-count" role="status">${candidates.length} mögliche Begegnungen</p><div class="queue-candidates">${candidates.map(m=>`<label class="queue-candidate" data-queue-search="${e(line(m).toLocaleLowerCase('de'))}"><input type="checkbox" name="queueIds" value="${e(m.id)}"><span><b>${name(m.a)}</b><span class="queue-vs">gegen</span><b>${name(m.b)}</b><small>${e(m.label)} · ${m.teamsReady?'Teams aktuell frei':'Mindestens ein Team ist noch an einem Tisch gebunden'}</small></span></label>`).join('')}</div><p class="legend">Eine vorgemerkte Partie rückt erst nach, wenn beide Teams verfügbar sind. Bereits zugewiesene und zurückgestellte Partien werden hier nicht angeboten.</p>`:'<p class="legend">Aktuell sind keine weiteren unzugewiesenen Begegnungen verfügbar.</p>'}</fieldset>`,'table',{table:n});
}
document.addEventListener('input',event=>{
  if(event.target.id!=='table-queue-search'&&event.target.name!=='queueIds')return;
  const query=($('#table-queue-search')?.value??'').trim().toLocaleLowerCase('de');let visible=0;
  document.querySelectorAll('[data-queue-search]').forEach(row=>{row.hidden=!row.dataset.queueSearch.includes(query);if(!row.hidden)visible++;});
  const selected=document.querySelectorAll('input[name=queueIds]:checked').length;
  $('#table-queue-count').textContent=`${visible} mögliche Begegnungen · ${selected} ausgewählt`;
});
function groupsView(){const gs=groupFilter==='all'?E.GROUPS:[groupFilter];return `<div class="section-head"><div><p class="eyebrow">DER WEG IN DIE KO-PHASE</p><h2>Acht Gruppen. Sechzehn Tickets.</h2><p>Die ersten zwei jeder Gruppe kommen weiter.</p></div></div><div class="chips">${['all',...E.GROUPS].map(g=>`<button class="chip ${groupFilter===g?'active':''}" data-action="filter-group" data-id="${g}">${g==='all'?'Alle':g}</button>`).join('')}</div><div class="group-grid">${gs.map(g=>groupPanel(g)).join('')}</div><p class="legend">Punkte → Becherdifferenz → direkter Vergleich. Bei mehr als zwei gleichen Teams zählt eine Mini-Tabelle ihrer direkten Spiele (Punkte, dann Differenz). Platzierungen sind bis Gruppenabschluss vorläufig.</p>`;}
function groupPanel(g){
  const rows=E.standings(state,g),matches=E.phaseMatches(state,'group').filter(m=>m.group===g),done=matches.filter(m=>state.results[m.id]).length;
  return `<section class="panel group-panel"><div class="group-title"><h3><span class="group-letter">${g}</span>Gruppe ${g}</h3><span class="tag">${done}/6 SPIELE</span></div><table aria-label="Tabelle Gruppe ${g}"><thead><tr><th>TEAM</th><th title="Spiele">SP</th><th title="Siege">S</th><th title="Becherdifferenz">DIFF</th><th title="Punkte">PKT</th></tr></thead><tbody>${rows.map((t,i)=>`<tr class="${i<2?'qualified':''} ${own(t.id)?'own-row':''}"><td><span class="position">${i+1}</span>${name(t.id)}${t.tied&&done===6?' *':''}</td><td>${t.played}</td><td>${t.won}</td><td>${t.diff>0?'+':''}${t.diff}</td><td class="points">${t.points}</td></tr>`).join('')}</tbody></table>${done===6&&rows.some(t=>t.tied)?`<div class="notice">* Gleichstand nach direktem Vergleich. ${admin()&&state.phase==='group'?btn('Entscheidung eintragen','decision',g):'Die Spielleitung entscheidet.'}</div>`:''}${state.decisions[g]?`<div class="notice">Entscheidung: ${e(state.decisions[g].reason)}</div>`:''}<details data-detail="group-${g}" ${groupFilter!=='all'?'open':''}><summary>Gruppenspiele ansehen</summary>${matches.map(m=>matchCard(m)).join('')||'<p class="legend">Paarungen entstehen beim Start der Gruppenphase.</p>'}</details></section>`;
}
function bracketView(){
  const rounds=['r16','quarter','semi','final'],seeds=['A1 gegen B2','C1 gegen D2','E1 gegen F2','G1 gegen H2','B1 gegen A2','D1 gegen C2','F1 gegen E2','H1 gegen G2'];
  return `${podium()}<div class="section-head"><div><p class="eyebrow">BIS ZUM LETZTEN BECHER</p><h2>Der Weg zum Pokal.</h2><p>Achtelfinale bis Finale und Spiel um Platz 3.</p></div></div><div class="round-tabs">${rounds.map(r=>`<button class="chip ${roundFilter===r?'active':''}" data-action="filter-round" data-id="${r}">${e(E.LABELS[r])}</button>`).join('')}</div><div class="bracket">${rounds.map((r,i)=>{const matches=E.phaseMatches(state,r),count=[8,4,2,2][i];return `<section class="bracket-round" ${r!==roundFilter?'hidden':''}><h3>${e(E.LABELS[r])}</h3><div class="bracket-games">${matches.length?matches.map(m=>matchCard(m,true)).join(''):Array.from({length:count},(_,n)=>`<div class="placeholder-game">${r==='r16'?seeds[n]:r==='final'?n?'Finale: Sieger beider Halbfinals':'Platz 3: Verlierer beider Halbfinals':`Sieger ${n*2+1} gegen Sieger ${n*2+2}`}</div>`).join('')}</div></section>`;}).join('')}</div>`;
}
function podium(){if(state.phase!=='complete')return '';const f=state.matches['final-1'],b=state.matches['bronze-1'];return `<div class="podium"><p class="eyebrow">EURE CHAMPIONS STEHEN FEST</p><h2>★ ${name(E.winnerId(f,state.results[f.id]))} ★</h2><p>2. Platz: ${name(E.loserId(f,state.results[f.id]))}<br>3. Platz: ${name(E.winnerId(b,state.results[b.id]))}</p></div>`;}
function groupSelect(t){return `<select data-group-team="${e(t.id)}" aria-label="Gruppe für ${e(t.name)}" ${!writable()?'disabled':''}><option value="">Ohne Gruppe</option>${E.GROUPS.map(g=>`<option value="${g}" ${t.group===g?'selected':''} ${t.group!==g&&state.teams.filter(x=>x.group===g).length>=4?'disabled':''}>Gruppe ${g}</option>`).join('')}</select>`;}
function teamsView(){
  const manager=admin()&&state.phase==='setup';
  return `<div class="section-head"><div><p class="eyebrow">ZUSAMMEN AN DEN TISCH</p><h2>Teams & Gruppen.</h2><p>${state.teams.length}/32 Teams · ${state.teams.filter(t=>!t.group).length} noch ohne Gruppe</p></div>${admin()&&writable()?btn('Team hinzufügen','team-add','',state.teams.length>=32?'disabled':''):''}</div>${manager?`<div class="chips"><button class="chip ${teamMode==='teams'?'active':''}" data-action="team-mode" data-id="teams">1. Teams anlegen</button><button class="chip ${teamMode==='groups'?'active':''}" data-action="team-mode" data-id="groups">2. Gruppen zuweisen</button></div>`:''}${manager&&teamMode==='groups'?`<p class="notice">Teams direkt zuweisen. Für einen Tausch zunächst ein Team auf „Ohne Gruppe“ stellen. Maximal vier Teams pro Gruppe.</p><div class="group-grid">${['',...E.GROUPS].map(g=>{const ts=state.teams.filter(t=>t.group===g);return `<section class="panel"><h3>${g?`Gruppe ${g} · ${ts.length}/4`:`Noch ohne Gruppe · ${ts.length}`}</h3>${ts.map(t=>`<div class="group-assignment"><b>${name(t.id)}</b>${groupSelect(t)}</div>`).join('')||'<p class="legend">Noch keine Teams.</p>'}</section>`;}).join('')}</div>`:`<div class="team-grid">${state.teams.map(t=>`<article class="team-card ${own(t.id)?'own-match':''}"><span class="tag">${t.group?`GRUPPE ${e(t.group)}`:'NOCH OHNE GRUPPE'}</span><h3>${name(t.id)}</h3><p>${e(t.p1)||'Person 1 noch offen'}<br>${e(t.p2)||'Person 2 noch offen'}</p>${admin()&&writable()?`<button class="text-button" data-action="team-edit" data-id="${e(t.id)}">Teamdaten bearbeiten ↗</button>`:''}</article>`).join('')}</div>`}`;
}
function adminView(){
  const plans=E.tablePlans(state).filter(p=>p.status==='pending');
  return `<div class="section-head"><div><p class="eyebrow">DU HAST DEN ÜBERBLICK</p><h2>Spielleitung.</h2><p>Aktuell: ${e(E.LABELS[state.phase])} · ${E.activeTables(state)} von ${state.tableCount} Tischen bespielbar</p></div><span class="tag red-tag">SPIELLEITUNG</span></div><div class="admin-grid"><section class="panel"><h3>Ablauf & Ergebnisse</h3><p class="legend">Fortlaufender Spielbetrieb. Freie Tische erhalten automatisch das nächste geeignete Spiel. Hier steuerst du nur die Übergänge zwischen den Turnierphasen.</p><div class="admin-actions">${state.phase!=='complete'?btn(nextLabel(state),'advance'):''}</div><label class="checkbox-label admin-toggle"><input id="self-scoring" type="checkbox" ${state.allowSelfScoring?'checked':''} ${!writable()?'disabled':''}>Mitspieler dürfen Ergebnisse ihrer eigenen Spiele eintragen und korrigieren</label><p class="legend">Gilt für alle Teams in der aktuellen Phase. Andere Spiele bleiben immer gesperrt.</p><div class="admin-actions">${btn('Turnier zurücksetzen','reset')}</div></section><section class="panel"><h3>Tische & Uhrzeiten</h3><p class="legend">Reduzieren ist auch während laufender Spiele möglich: Betroffene Spiele laufen zu Ende, danach bleibt der Tisch geschlossen. Vormerkungen werden neu verteilt.</p><div class="admin-actions">${btn('Tische jetzt einstellen','settings')}${btn('Umstellung planen','table-plan')}</div>${plans.map(p=>`<div class="user-row"><div><b>${p.count} Tische ab ${e(new Date(p.when).toLocaleString('de-DE'))}</b><small>Uhrzeit dieses Geräts</small></div><button class="text-button" data-action="cancel-plan" data-id="${e(p.id)}">Entfernen</button></div>`).join('')||'<p class="legend">Keine zeitgesteuerten Umstellungen geplant.</p>'}</section><section class="panel"><h3>Teams & Gruppenzuweisung</h3><p class="legend">Zuerst Teams unabhängig von Gruppen anlegen, anschließend die Gruppen A–H füllen. Namen bleiben im Turnier korrigierbar.</p><div class="admin-actions">${btn('Teams verwalten','show-teams')}${state.phase==='setup'?btn('Gruppen auslosen','shuffle'):''}</div>${state.phase==='setup'?`<div class="admin-actions">${!state.teams.length?btn('32 Teamplätze anlegen','slots'):''}${btn('Teams als CSV importieren','import')}</div>`:''}</section><section class="panel"><h3>Benutzer & Teamzuordnung</h3>${demo?'<p class="notice">Echte Konten sind in der Demo deaktiviert. Oben lassen sich Rolle und eigenes Team testen.</p>':`<p class="legend">Mitspieler benötigen ein zugeordnetes Team. Mehrere Personen können demselben Team angehören.</p><div class="admin-actions">${btn('Konto anlegen','account-add')}${btn('Vorhandenes Konto zuweisen','role-add')}</div>${users.map(u=>`<div class="user-row"><div><b>${e(u.name)}</b><small>${e(u.email)} · ${roleLabel(u.role)}${u.teamId?` · ${e(team(u.teamId)?.name??'Team fehlt')}`:''}</small></div><button class="text-button" data-action="role-edit" data-id="${e(u.uid)}">Bearbeiten</button><button class="text-button" data-action="account-invite" data-id="${e(u.uid)}">Passwortlink senden</button></div>`).join('')}`}</section><section class="panel"><h3>Sicherung & Ausgabe</h3><div class="admin-actions">${btn('Sicherung herunterladen','export')}${btn('Sicherung wiederherstellen','restore')}${btn('Ansicht drucken','print')}${demo?btn('Beispieldaten neu laden','demo-reset'):''}</div></section></div>`;
}

function openDialog(title,content,form='',data={},submitLabel='Speichern'){
  modal={revision:state?.revision,...data};$('#dialog-body').innerHTML=`<div class="dialog-head"><h2 id="dialog-title">${e(title)}</h2><button class="close" data-action="close" aria-label="Dialog schließen">×</button></div>${form?`<form id="modal-form" data-form="${form}" class="form-stack">`:''}${content}<div class="form-error" role="alert" hidden></div>${form?`<button class="button" type="submit">${e(submitLabel)}</button></form>`:''}`;if(!$('#dialog').open)$('#dialog').showModal();
}
function input(label,key,value='',type='text',attrs=''){return `<label>${label}<input name="${key}" type="${type}" value="${e(value)}" ${attrs}></label>`;}
function confirmation(title,text,action,data={}){openDialog(title,`<p>${text}</p><div class="dialog-actions"><button class="button light" data-action="close">Abbrechen</button><button class="button red-button" data-action="confirmed" data-id="${action}">Bestätigen</button></div>`,'',data);}
function roleFields(r='player',id=''){return `<label>Rolle<select name="role" id="account-role"><option value="player" ${r==='player'?'selected':''}>Mitspieler</option><option value="admin" ${r==='admin'?'selected':''}>Spielleitung</option>${board()?`<option value="board" ${r==='board'?'selected':''}>Vorstand</option>`:''}<option value="guest" ${r==='guest'?'selected':''}>Zuschauer (Schreibrechte entziehen)</option></select></label><label id="account-team-label" ${r!=='player'?'hidden':''}>Team des Mitspielers<select name="teamId" id="account-team" ${r==='player'?'required':''}><option value="">Bitte Team wählen</option>${state.teams.map(t=>`<option value="${e(t.id)}" ${id===t.id?'selected':''}>${e(t.name)}</option>`).join('')}</select></label>`;}
function scoreDialog(id){
  const m=E.match(state,id);if(!canScore(m))return toast('Für dieses Spiel hast du keine Eingabeberechtigung oder die Selbsteingabe ist gesperrt.');
  const r=state.results[id],reset=admin()&&E.PHASES.indexOf(m.phase)<E.PHASES.indexOf(state.phase);
  openDialog('Ergebnis eintragen',`<p>${e(m.label)} · ${m.table?`Tisch ${m.table}`:'Ohne Tisch'}</p>${reset?'<div class="notice error">Diese Korrektur öffnet die frühere Phase erneut und löscht alle nachfolgenden KO-Paarungen und Ergebnisse. Bitte vorher sichern.</div>':''}<fieldset><legend>Welches Team hat gewonnen?</legend><div class="winner-options">${['a','b'].map(side=>`<label class="winner-option"><input type="radio" name="winner" value="${side}" required ${r?.winner===side?'checked':''}><span>${name(m[side])}</span></label>`).join('')}</div></fieldset><label class="checkbox-label overtime-toggle"><input name="overtime" type="checkbox" ${r?.overtime?'checked':''}>Nach Verlängerung entschieden – Verlierer wird mit 1 Restbecher gewertet</label><fieldset id="cups-fieldset"><legend>Übrige Becher des Verlierers</legend><p class="cup-help">Die gewünschte Anzahl roter Becher antippen.</p><div id="cup-picker" class="cup-picker"></div><div class="cup-count"><strong id="cup-number">${r?.cups??1}</strong> von 10 Bechern</div></fieldset><input type="hidden" name="cups" id="cup-value" value="${r?.cups??1}"><p id="score-help"></p>${reset?'<label class="checkbox-label"><input type="checkbox" name="confirm" required>Folgerunden löschen und Ergebnis korrigieren</label>':''}`,'score',{id,baseline:JSON.stringify(r??null),match:JSON.stringify(state.matches[id]),reset,normalCups:r?.overtime?1:r?.cups??1});renderCups(r?.cups??1);syncOvertime();
}
function renderCups(count){let n=0;$('#cup-picker').innerHTML=[1,2,3,4].map(size=>`<div class="cup-row">${Array.from({length:size},()=>{const i=++n;return `<button type="button" class="cup ${i<=count?'on':''}" data-action="cup" data-id="${i}" aria-label="${i} übrige Becher" aria-pressed="${i<=count}"><svg viewBox="0 0 40 44" aria-hidden="true"><path d="M4 9L9 38Q20 43 31 38L36 9Z" fill="#cf0214" stroke="#011e35" stroke-width="1.5"/><ellipse cx="20" cy="9" rx="16" ry="5" fill="#cf0214" stroke="#fdf7e7" stroke-width="2"/><path d="M7 17Q20 22 33 17M8 24Q20 29 32 24" fill="none" stroke="#fdf7e7" stroke-width="2"/></svg></button>`;}).join('')}</div>`).join('');$('#cup-number').textContent=count;$('#cup-value').value=count;}
function syncOvertime(){const checked=$('input[name=overtime]').checked;$('#cups-fieldset').disabled=checked;$('#cups-fieldset').classList.toggle('cups-disabled',checked);if(checked){modal.normalCups=Number($('#cup-value').value);renderCups(1);}else renderCups(modal.normalCups??1);$('#score-help').textContent=checked?'Gewertete Restbecher: Sieger 0, Verlierer 1. Becherdifferenz: Sieger +1, Verlierer −1. Sieger: 3 Punkte, Verlierer: 0 Punkte. Die tatsächlichen Restbecher spielen keine Rolle.':'Der Sieger hat 0 Restbecher und erhält 3 Punkte; der Verlierer 0 Punkte. Die Restbecher bestimmen die Becherdifferenz.';}
function teamDialog(id){const t=team(id)??{id:crypto.randomUUID(),name:'',p1:'',p2:'',group:''};openDialog(id?'Teamdaten bearbeiten':'Neues Team',`${input('Teamname','name',t.name,'text','required maxlength="60"')}${input('Person 1','p1',t.p1,'text','required maxlength="60"')}${input('Person 2','p2',t.p2,'text','required maxlength="60"')}<p>Die Gruppenzuweisung erfolgt getrennt unter „Teams → Gruppen zuweisen“.</p>${id&&state.phase==='setup'?`<button type="button" class="button danger" data-action="team-delete" data-id="${e(id)}">Team entfernen</button>`:''}`,'team',{teamId:t.id});}

document.addEventListener('click',event=>{
  const b=event.target.closest('[data-view],[data-action]');if(!b||b.disabled)return;
  if(b.dataset.view){view=b.dataset.view;render(true);return;}
  if(busy&&b.dataset.action!=='close')return;
  try{handleAction(b.dataset.action,b.dataset.id);}catch(error){toast(humanError(error));}
});
function handleAction(action,id){
  switch(action){
    case 'close':$('#dialog').close();break;
    case 'filter-group':groupFilter=id;render();break;
    case 'filter-round':roundFilter=id;render();break;
    case 'team-mode':teamMode=id;render();break;
    case 'show-teams':view='teams';render(true);break;
    case 'more-games':matchLimit+=12;render();break;
    case 'show-player-table':if(role==='player'){view='overview';render(true);requestAnimationFrame(()=>{const card=document.getElementById('table-'+Number(id));if(card){card.focus({preventScroll:true});card.scrollIntoView({block:'start',behavior:'auto'});}});}break;
    case 'my-games':view='overview';ownOnly=true;gameFilter='open';render(true);break;
    case 'print':window.print();break;
    case 'cup':{if($('#cups-fieldset').disabled)return;const current=Number($('#cup-value').value),clicked=Number(id);renderCups(clicked===current?Math.max(1,current-1):clicked);modal.normalCups=Number($('#cup-value').value);break;}
    case 'score':scoreDialog(id);break;
    case 'open-demo':if(!demo&&board()){const url=new URL(liveAppURL());url.searchParams.set('demo','1');window.open(url.href,'_blank','noopener,noreferrer');}break;
    case 'login':
      if(demo)return openDialog('Demo ausprobieren',`<p>Im gelben Banner kannst du Rollen und eigenes Team testen. Änderungen betreffen nur die Beispieldaten dieses Browsers. Konten und Mitgliedsanträge sind in der Demo deaktiviert.</p>${onlineDemoRequested?`<a class="button light" href="${e(liveAppURL())}">Zum Live-Turnier</a>`:''}`);
      if(onlineDemoRequested&&user&&!user.isAnonymous)return openDialog('Vorstandszugang erforderlich',`<p>Angemeldet: ${e(user.email)}. Für die Online-Demo wird die Rolle „Vorstand“ benötigt. Konto und Passwort verwaltest du im Live-Turnier.</p><a class="button light" href="${e(liveAppURL())}">Zum Live-Turnier</a>`);
      if(user&&!user.isAnonymous)return openDialog('Dein Konto',`<p>${e(user.email)} · ${roleLabel(role)}</p>${teamId?`<p>Dein Team: ${name(teamId)}</p>`:''}<p class="legend">UID: ${e(user.uid)}</p>${role==='guest'?'<p>Die Spielleitung kann dir Rolle und Team zuweisen.</p>':''}<div class="admin-actions">${btn('Passwort ändern','password-change')}<button class="button" data-action="logout">Abmelden</button></div><p class="legend">Passwörter sind weder für Spielleitung noch Vorstand einsehbar.</p>`);
      openDialog('Willkommen zurück.',`${input('E-Mail','email','','email','required autocomplete="username"')}${input('Passwort','password','','password','required autocomplete="current-password"')}<button type="button" class="text-button" data-action="password-reset">Passwort vergessen?</button><p>Nutze deine E-Mail-Adresse und dein selbst festgelegtes Passwort. Neue Nutzer erhalten einen Passwortlink. Zuschauer benötigen kein Konto.</p>`,'login',{},'Anmelden');break;
    case 'password-change':if(demo)return toast('Echte Passwörter werden in der Demo nicht geändert.');if(user&&!user.isAnonymous)openDialog('Passwort ändern',`${input('Aktuelles Passwort','currentPassword','','password','required autocomplete="current-password"')}${input('Neues Passwort','newPassword','','password','required minlength="8" autocomplete="new-password"')}${input('Neues Passwort wiederholen','repeatPassword','','password','required minlength="8" autocomplete="new-password"')}`,'password-change',{},'Passwort ändern');break;
    case 'password-reset':if(demo)return toast('Echte E-Mails werden in der Demo nicht versendet.');openDialog('Passwort zurücksetzen',`${input('Deine E-Mail','email','','email','required autocomplete="email"')}<p>Du erhältst einen Link zum Festlegen eines neuen Passworts, sofern ein passendes Konto besteht.</p>`,'password-reset',{},'Link anfordern');break;
    case 'logout':if(demo)return toast('Zum Abmelden bitte zum Live-Turnier wechseln.');task(()=>cloud.logout(),'Abgemeldet.');break;
    case 'initialize':task(()=>adminCommit(()=>E.emptyTournament()),'Turnier angelegt.');break;
    case 'team-add':if(admin()&&state.teams.length<32)teamDialog();break;
    case 'team-edit':if(admin())teamDialog(id);break;
    case 'team-delete':confirmation('Team entfernen?',`${name(id)} wird aus der Vorbereitung entfernt.`,'delete-team',{teamId:id});break;
    case 'advance':confirmation(`${nextLabel(state)}?`,state.phase==='setup'?'Alle 32 Teams müssen vollständig sein und auf acht Gruppen verteilt sein. Beim Start werden freie Tische automatisch belegt.':'Alle Spiele der aktuellen Phase müssen abgeschlossen sein. Frühere Ergebnisse sind danach nur durch die Spielleitung korrigierbar.','advance');break;
    case 'reset':confirmation('Turnier zurücksetzen – Schritt 1 von 2','Alle Ergebnisse, Paarungen, Tischwarteschlangen und Tischzeitpläne werden gelöscht. Teams, Gruppen und Benutzer bleiben erhalten. Vorher eine Sicherung herunterladen.','reset-first');break;
    case 'shuffle':confirmation('Gruppen neu auslosen?','Die 32 Teams werden neu auf A–H verteilt. Vorhandene Gruppenzuordnungen werden ersetzt.','shuffle');break;
    case 'slots':task(()=>adminCommit(s=>{if(s.phase!=='setup'||s.teams.length)throw new Error('Nur in einer leeren Vorbereitung möglich.');return{...s,teams:Array.from({length:32},(_,i)=>({id:crypto.randomUUID(),name:`Team ${String(i+1).padStart(2,'0')}`,p1:'',p2:'',group:''}))};}),'32 unzugeordnete Teamplätze angelegt.',false);break;
    case 'settings':openDialog('Tische jetzt einstellen',`${input('Turniername','title',state.title,'text','required maxlength="60"')}${input('Vorhandene, nummerierte Tische','tableCount',state.tableCount,'number','required min="1" max="32"')}${input('Davon jetzt bespielbar (ab Tisch 1)','activeTableCount',E.activeTables(state),'number','required min="0" max="32"')}<p>Bei 3 bespielbaren Tischen bleiben Tisch 1–3 aktiv. Laufende Spiele auf höheren Nummern laufen zu Ende. 0 pausiert die Vergabe an allen Tischen.</p>`,'settings');break;
    case 'table-plan':openDialog('Tischanzahl nach Uhrzeit umstellen',`${input('Bespielbare Tische ab diesem Zeitpunkt','count',E.activeTables(state),'number',`required min="0" max="${state.tableCount}"`)}${input('Datum und Uhrzeit dieses Geräts','when','','datetime-local','required')}<p>Ab dem Zeitpunkt erhalten höhere Tischnummern keine neuen Spiele mehr. Laufende Spiele können zu Ende gespielt werden. Die Systemuhren der Geräte müssen stimmen.</p>`,'table-plan');break;
    case 'cancel-plan':task(()=>adminCommit(s=>E.cancelTablePlan(s,id)),'Zeitplan entfernt.',false);break;
    case 'assign':{const m=E.match(state,id);openDialog('Tisch zuweisen',`<p>${name(m.a)} gegen ${name(m.b)}</p><label>Zuweisung<select name="table"><option value="auto">Automatisch nächster freier Tisch</option><option value="0" ${m.held?'selected':''}>Zurückstellen, vorerst nicht automatisch zuweisen</option>${Array.from({length:E.activeTables(state)},(_,i)=>`<option value="${i+1}" ${m.table===i+1?'selected':''}>Tisch ${i+1} · ${statusLabels[E.tableStatus(state,i+1)]}</option>`).join('')}</select></label><p>Auch belegte Tische sind möglich. Das Spiel wird dort vorgemerkt und bei Verfügbarkeit als offen zugewiesen. Die Spielleitung setzt es bei Aufbau auf „In Vorbereitung“ und bei Beginn auf „Wird bespielt“. Beim Umsetzen wird die Partie wieder als offen eingeordnet.</p>`,'assign',{id});break;}
    case 'table':tableDialog(Number(id));break;
    case 'decision':{const rows=E.standings(state,id);openDialog(`Gleichstand in Gruppe ${id}`,`<p>Nur nach allen Kriterien gleiche Teams dürfen untereinander getauscht werden.</p>${rows.map((t,i)=>`<label>Platz ${i+1}<select name="place${i}">${rows.map(x=>`<option value="${e(x.id)}" ${x.id===t.id?'selected':''}>${e(x.name)}${x.tied?' *':''}</option>`).join('')}</select></label>`).join('')}${input('Öffentliche Begründung','reason','','text','required minlength="3" maxlength="200"')}`,'decision',{group:id});break;}
    case 'account-invite':if(!demo&&admin()){const recipient=users.find(u=>u.uid===id);if(recipient)task(()=>cloud.inviteAccount(recipient.email),'Passwortlink angefordert.',false);}break;
    case 'account-add':if(!demo)openDialog('Konto anlegen',`${input('Anzeigename','name','','text','required maxlength="80"')}${input('E-Mail','email','','email','required maxlength="254"')}${roleFields()}<p>Nach dem Anlegen wird eine Firebase-E-Mail mit Passwortlink angefordert. Der Empfänger legt vor seiner ersten Anmeldung sein eigenes Passwort fest. Bitte eine erreichbare E-Mail-Adresse verwenden.</p>`,'account');break;
    case 'role-add':case 'role-edit':{if(demo)return;const u=users.find(x=>x.uid===id);openDialog('Rolle und Team zuweisen',`${input('Firebase Authentication UID','uid',u?.uid??'','text',`required maxlength="128" ${u?'readonly':''}`)}${input('Anzeigename','name',u?.name??'','text','required maxlength="80"')}${input('E-Mail','email',u?.email??'','email','required maxlength="254"')}${roleFields(u?.role??'player',u?.teamId??'')}`,'role');break;}
    case 'export':{const blob=new Blob([JSON.stringify({format:'beerpong-v2',exportedAt:new Date().toISOString(),state},null,2)],{type:'application/json'}),a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`beerpong-${localDate()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);break;}
    case 'restore':openDialog('Sicherung wiederherstellen','<div class="notice error">Ersetzt den gesamten Turnierstand einschließlich Teams. Benutzerkonten und Rollen bleiben erhalten. Nach einer Wiederherstellung die Teamzuordnungen prüfen.</div><label>JSON-Sicherung v2<input name="backup" type="file" accept=".json,application/json" required></label><label class="checkbox-label"><input type="checkbox" name="confirm" required>Gesamten Turnierstand ersetzen</label>','restore');break;
    case 'import':openDialog('Teams als CSV importieren','<p>UTF-8, Semikolon als Trennzeichen. Kopfzeile: <b>Team;Person 1;Person 2;Gruppe</b>. Die Gruppe darf leer sein; 1–32 Teams. Ersetzt die bisherigen Teams in der Vorbereitung.</p><label>CSV-Datei<input type="file" name="csv" accept=".csv,text/csv" required></label>','import');break;
    case 'demo-reset':confirmation('Demo neu laden?','Ersetzt nur die lokalen Beispieldaten.','demo-reset');break;
    case 'confirmed':performConfirmed(id);break;
    case 'rules':view='rules';render(true);break;
    case 'membership-inbox':void openMembershipInbox();break;
    case 'membership-download-all':void downloadMemberships();break;
    case 'membership-download':if(board())downloadPrivatePDF(privateApplications.find(a=>a.id===id));break;
    case 'membership-delete':if(board()&&confirm('Diesen Mitgliedsantrag endgültig löschen?'))void cloud.deleteMembership(id).then(openMembershipInbox).catch(error=>toast(humanError(error)));break;
    case 'install':if(installEvent){installEvent.prompt();installEvent.userChoice.then(()=>installEvent=null);}else openDialog('App auf dem Startbildschirm','<p>iPhone/iPad in Safari: Teilen → Zum Home-Bildschirm. Android: Browser-Menü → App installieren oder Zum Startbildschirm hinzufügen.</p><p>HTTPS oder localhost erforderlich. Geladene Inhalte bleiben offline lesbar. Ergebnisse und Anträge benötigen Internet.</p>');break;
  }
}
function performConfirmed(action){
  const info={...modal};
  if(action==='reset-first')return openDialog('Endgültig zurücksetzen – Schritt 2 von 2',`${input('Zur Bestätigung ZURÜCKSETZEN eingeben','resetText','','text','required pattern="ZURÜCKSETZEN" autocomplete="off"')}<p>Ergebnisse, Paarungen und Tischzeitpläne werden gelöscht. Team- und Benutzerdaten bleiben erhalten.</p>`,'reset-final',info,'Endgültig zurücksetzen');
  task(()=>adminCommit(s=>{
    if(action==='advance')return s.phase==='setup'?E.startGroups(s):E.advancePhase(s);
    if(action==='demo-reset')return E.demoTournament();
    if(action==='delete-team'){if(s.phase!=='setup')throw new Error('Teams sind bereits im Turnier.');return{...s,teams:s.teams.filter(t=>t.id!==info.teamId)};}
    if(action==='shuffle'){if(s.phase!=='setup'||s.teams.length!==32)throw new Error('Auslosung benötigt 32 Teams vor Turnierstart.');const next=E.clone(s),order=[...next.teams];for(let i=order.length-1;i>0;i--){const j=Math.floor(crypto.getRandomValues(new Uint32Array(1))[0]/4294967296*(i+1));[order[i],order[j]]=[order[j],order[i]];}order.forEach((t,i)=>t.group=E.GROUPS[Math.floor(i/4)]);return next;}
    throw new Error('Unbekannte Aktion.');
  },info.revision),'Änderung gespeichert.');
}
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.id==='demo-role'&&demo){role=target.value;teamId=role==='player'?(state?.teams[0]?.id??''):'';render();}
  if(target.id==='demo-team'&&demo){teamId=target.value;render();}
  if(target.id==='game-filter'){gameFilter=target.value;matchLimit=12;render();}
  if(target.id==='table-filter'){tableFilter=target.value;matchLimit=12;render();}
  if(target.id==='own-filter'){ownOnly=target.checked;render();}
  if(target.name==='overtime'&&target.closest('#modal-form'))syncOvertime();
  if(target.id==='account-role'){$('#account-team-label').hidden=target.value!=='player';$('#account-team').required=target.value==='player';}
  if(target.id==='self-scoring'){const enabled=target.checked;task(()=>adminCommit(s=>({...s,allowSelfScoring:enabled})),enabled?'Selbsteingabe für eigene Spiele erlaubt.':'Selbsteingabe gesperrt.',false);}
  if(target.dataset.groupTeam){const id=target.dataset.groupTeam,g=target.value;task(()=>adminCommit(s=>{if(s.phase!=='setup')throw new Error('Gruppen sind bereits gesperrt.');if(g&&s.teams.filter(t=>t.group===g&&t.id!==id).length>=4)throw new Error('Diese Gruppe ist voll.');const next=E.clone(s),t=next.teams.find(t=>t.id===id);if(!t)throw new Error('Team wurde inzwischen entfernt.');t.group=g;return next;}),'Gruppe zugewiesen.',false);}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='search-form'){event.preventDefault();search=new FormData(event.target).get('search').trim();matchLimit=12;render();return;}
  if(event.target.id!=='modal-form')return;
  event.preventDefault();const form=event.target,formData=new FormData(form),data=Object.fromEntries(formData),queueIds=formData.getAll('queueIds'),kind=form.dataset.form,info={...modal};
  task(async()=>{
    if(demo&&['login','account','role','password-change','password-reset'].includes(kind))throw new Error('Echte Kontovorgänge sind in der Demo deaktiviert.');
    if(kind==='login')return cloud.login(data.email,data.password);
    if(kind==='password-change'){if(data.newPassword!==data.repeatPassword)throw new Error('Die neuen Passwörter stimmen nicht überein.');await cloud.changePassword(data.currentPassword,data.newPassword);form.reset();return;}
    if(kind==='password-reset'){await cloud.resetPassword(data.email);return;}
    if(kind==='score')return commit(s=>{const m=s.matches[info.id];if(!(admin()||(role==='player'&&s.allowSelfScoring&&m?.phase===s.phase&&[m.a,m.b].includes(teamId))))throw new Error('Keine Berechtigung für dieses Spiel.');const needsReset=admin()&&E.PHASES.indexOf(m.phase)<E.PHASES.indexOf(s.phase);if(needsReset&&(!info.reset||data.confirm!=='on'))throw new Error('Inzwischen wurde eine Folgerunde gestartet. Bitte den Dialog erneut öffnen.');return E.recordResult(s,info.id,{winner:data.winner,cups:data.overtime==='on'?1:Number(data.cups),overtime:data.overtime==='on'},admin());},{id:info.id,baseline:info.baseline,match:info.match});
    if(kind==='account'||kind==='role'){if(data.role==='board'&&!board())throw new Error('Vorstandsrechte darf nur der Vorstand vergeben.');if(!admin())throw new Error('Nur für die Spielleitung.');if(data.role==='player'&&!state.teams.some(t=>t.id===data.teamId))throw new Error('Bitte ein vorhandenes Team wählen.');return kind==='account'?cloud.createAccount(data):cloud.setRole(data.uid,data);}
    if(kind==='restore'){const file=new FormData(form).get('backup');if(file.size>800000)throw new Error('Die Sicherung ist zu groß.');const restored=validateBackup(JSON.parse(await file.text()));return adminCommit(()=>restored,info.revision);}
    if(kind==='import'){const file=new FormData(form).get('csv');if(file.size>100000)throw new Error('Die CSV-Datei ist zu groß.');const teams=parseTeamsCSV(await file.text());return adminCommit(s=>{if(s.phase!=='setup')throw new Error('Import nur vor Turnierstart möglich.');return{...s,teams};},info.revision);}
    return adminCommit(s=>{
      if(kind==='reset-final'){if(data.resetText!=='ZURÜCKSETZEN')throw new Error('Bestätigung stimmt nicht.');return E.resetTournament(s);}
      if(kind==='team'){const next=E.clone(s),existing=next.teams.find(t=>t.id===info.teamId);if(!existing&&(s.phase!=='setup'||s.teams.length>=32))throw new Error('Neue Teams nur vor Turnierstart, maximal 32.');const t={id:info.teamId,name:data.name.trim(),p1:data.p1.trim(),p2:data.p2.trim(),group:existing?.group??''};if(!t.name||!t.p1||!t.p2)throw new Error('Bitte Namen und beide Personen eintragen.');if(s.teams.some(x=>x.id!==t.id&&x.name.toLocaleLowerCase('de')===t.name.toLocaleLowerCase('de')))throw new Error('Diesen Teamnamen gibt es bereits.');if(existing)Object.assign(existing,t);else next.teams.push(t);return next;}
      if(kind==='settings'){const next=E.configureTables(s,Number(data.tableCount),Number(data.activeTableCount));next.title=data.title.trim();if(!next.title)throw new Error('Bitte einen Turniernamen angeben.');return next;}
      if(kind==='table-plan')return E.planTables(s,Number(data.count),data.when);
      if(kind==='assign')return data.table==='auto'?E.releaseMatch(s,info.id):E.assignTable(s,info.id,Number(data.table));
      if(kind==='table')return E.queueAtTable(E.setTableStatus(s,info.table,data.status),info.table,queueIds);
      if(kind==='decision')return E.decideGroup(s,info.group,[data.place0,data.place1,data.place2,data.place3],data.reason);
      throw new Error('Unbekanntes Formular.');
    },info.revision);
  },kind==='password-reset'?'Falls ein passendes Konto besteht, wurde der Link angefordert.':kind==='password-change'?'Passwort geändert.':kind==='login'?'Angemeldet.':kind==='account'?'Konto angelegt. Die E-Mail zum Festlegen des eigenen Passworts wurde angefordert.':'Gespeichert.');
});
window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();installEvent=event;});
window.addEventListener('online',()=>render());window.addEventListener('offline',()=>{synced=false;render();});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')render();});
if($('#player-callout'))new ResizeObserver(updatePlayerCalloutSpace).observe($('#player-callout'));
new ResizeObserver(updateDemoToolbarHeight).observe($('#mode-banner'));
window.addEventListener('storage',event=>{if(demo&&event.key===DEMO_KEY&&event.newValue){try{state=validateBackup({format:'beerpong-v2',state:JSON.parse(event.newValue)});render();}catch{/* ungültigen Fremdstand ignorieren */}}});
// Zeitgesteuerte Wechsel benötigen keinen offenen Admin-Browser; alle Clients
// leiten die Belegung aus denselben Ereignissen und Zeitplänen ab.
let dispatchTick='';
setInterval(()=>{if(state&&E.tablePlans(state).length){const tick=JSON.stringify([state.revision,E.activeTables(state),E.tablePlans(state).map(p=>p.status)]);if(tick!==dispatchTick){dispatchTick=tick;render();}}},1000);
async function start(){
  loadDocuments().then(()=>{if(view==='rules')render(true);if(view==='membership'&&$('#document-pages'))$('#document-pages').innerHTML=documentPages('statutes');}).catch(error=>toast(humanError(error)));
  if(localDemo){loadDemoState();render();}
  else if(onlineDemoRequested){render();try{await cloud.connect({demoGate:true,onState:()=>{},onUsers:()=>{},onConnection:()=>{},onUser:u=>{user=u;render();},onRole:r=>{setDemoAccess(r);},onError:error=>{demoGateError=humanError(error);if(error.code==='permission-denied')setDemoAccess('guest');else render();}});}catch(error){demoGateError=humanError(error);render();}}
  else{try{const saved=JSON.parse(localStorage.getItem(cloud.liveCacheKey));if(saved?.schema===2)state=validateBackup({format:'beerpong-v2',state:saved});}catch{/* Cache ist nur Lesehilfe */}render();try{await cloud.connect({onState:s=>{if(s&&s.schema!==2){toast('Dieser Turnierstand stammt aus einer älteren Version. Bitte die Spielleitung kontaktieren.');return;}state=s;try{if(s)localStorage.setItem(cloud.liveCacheKey,JSON.stringify(s));else localStorage.removeItem(cloud.liveCacheKey);}catch{/* voller lokaler Speicher */}render();},onUser:u=>{user=u;render();},onRole:(r,id)=>{if(r!=='board'){privateApplications=[];if($('#dialog-title')?.textContent==='Mitgliedsanträge')$('#dialog').close();}role=r;teamId=r==='player'?id:'';render();},onUsers:list=>{users=list;render();},onConnection:connected=>{synced=connected;render();},onError:error=>toast(humanError(error))});}catch(error){toast(`Firebase konnte nicht geladen werden: ${humanError(error)}`);}}
  if('serviceWorker'in navigator&&(location.protocol==='https:'||['localhost','127.0.0.1'].includes(location.hostname)))navigator.serviceWorker.register('./sw.js').catch(()=>toast('Die Offline-Ansicht konnte nicht eingerichtet werden.'));
}
start();


async function openMembershipInbox(){
  if(!board())return;
  if(demo){toast('Der geschützte Eingang ist nur im Livebetrieb verfügbar.');return;}
  try{const received=await cloud.listMemberships();if(!board())return;privateApplications=received;openDialog('Mitgliedsanträge',`<p>${privateApplications.length} Anträge gespeichert. Diese Daten sind ausschließlich für den Vorstand sichtbar.</p><div class="admin-actions">${btn('Alle als eine PDF herunterladen','membership-download-all')}</div>${privateApplications.map(a=>`<div class="user-row"><div><b>${e(a.filename)}</b><small>${e(a.createdAt?.toDate().toLocaleString('de-DE')??'')}</small></div><button class="text-button" data-action="membership-download" data-id="${e(a.id)}">PDF</button><button class="text-button" data-action="membership-delete" data-id="${e(a.id)}">Löschen</button></div>`).join('')}`);}catch(error){toast(humanError(error));}
}
async function downloadMemberships(){
  if(!board()||!privateApplications.length)return;
  try{const {PDFDocument}=await import('./vendor/pdf-lib.esm.min.js'),out=await PDFDocument.create();
    for(const item of privateApplications){const input=await PDFDocument.load(item.pdf.toUint8Array());for(const p of await out.copyPages(input,input.getPageIndices()))out.addPage(p);}
    const url=URL.createObjectURL(new Blob([await out.save()],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download='Beerpong-Academy-Mitgliedsantraege.pdf';a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);
  }catch(error){toast(humanError(error));}
}

document.querySelector('#dialog').addEventListener('close',()=>{privateApplications=[];});

function downloadPrivatePDF(item){if(!item)return;const url=URL.createObjectURL(new Blob([item.pdf.toUint8Array()],{type:'application/pdf'})),a=document.createElement('a');a.href=url;a.download=item.filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}

function boardView(){return `<div class="section-head"><div><p class="eyebrow">NUR FÜR DEN VORSTAND</p><h2>Vorstand.</h2><p>Geschützte Vereinsverwaltung.</p></div><span class="tag red-tag">VORSTAND</span></div><section class="panel demo-entry"><h3>Turnier ausprobieren</h3><p>${demo?'Du arbeitest mit lokalen Beispieldaten. Echte Konten und Anträge sind gesperrt.':'Teste den vollständigen Turnierablauf mit Beispieldaten in einem separaten Tab. Das Live-Turnier bleibt davon unberührt.'}</p>${!demo?btn('Online-Demo öffnen ↗','open-demo'):''}</section><section class="panel"><h3>Mitgliedsanträge</h3><p>Unterschriebene PDF-Anträge einsehen, einzeln oder gemeinsam herunterladen und nach Bearbeitung löschen.</p><div class="admin-actions">${btn('Anträge öffnen','membership-inbox')}</div></section>`;}
