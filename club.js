/** Öffentliche Vereins- und Turnierdaten. Keine Mitgliederdaten in diesem Modul. */
import {annualFee} from './pricing.js';
import {escapeHTML as e,localDate} from './ui.js';
import {registrationTeaser} from './registration-ui.js';
export const DEFAULT_TOURNAMENTS=[
  {id:'main',edition:15,title:'15. offizielles Beerpong-Turnier',date:'2027-01-02',venue:'DGH Stöckte',archived:false,externalUrl:''},
  {id:'official-14-2025',edition:14,title:'14. offizielles Beerpong-Turnier',date:'2025-12-27',venue:'DGH Stöckte',archived:true,externalUrl:'https://www.meinspielplan.de/plan/PJc84F'},
  {id:'official-13-2024',edition:13,title:'13. offizielles Beerpong-Turnier',date:'2024-12-27',venue:'DGH Stöckte',archived:true,externalUrl:'https://www.meinspielplan.de/plan/CTPJrM'},
  {id:'official-12-2023',edition:12,title:'12. offizielles Beerpong-Turnier',date:'2023-12-29',venue:'DGH Stöckte',archived:true,externalUrl:'https://www.meinspielplan.de/plan/BJz9T1'},
  {id:'official-11-2022',edition:11,title:'11. offizielles Beerpong-Turnier',date:'2022-12-30',venue:'DGH Stöckte',archived:true,externalUrl:'https://www.meinspielplan.de/plan/f16PXx'}
];
const archives=new Map();let archiveGeneration=0;
export const getClubArchives=()=>[...archives.values()];
export function clearClubArchives(){archiveGeneration++;archives.clear();}
export async function loadClubArchive(loader){
 if(!loader)return;const generation=++archiveGeneration,data=await loader();if(generation!==archiveGeneration)return;archives.clear();for(const archive of data){if(!archive.id||!Array.isArray(archive.groups)||!Array.isArray(archive.knockout))throw Error('Ungültiges Archiv.');archives.set(archive.id,archive);}return data;
}
export const validTournamentId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id);
export function validateTournamentInfo(data){
  const d={title:String(data.title??'').trim(),edition:Number(data.edition),date:String(data.date??''),venue:String(data.venue??'').trim(),archived:data.archived===true,externalUrl:String(data.externalUrl??'').trim()};
  const date=new Date(d.date+'T12:00:00Z');
  if(!d.title||d.title.length>60||!Number.isInteger(d.edition)||d.edition<1||d.edition>999||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==d.date||!d.venue||d.venue.length>120||!['',...DEFAULT_TOURNAMENTS.map(t=>t.externalUrl).filter(Boolean)].includes(d.externalUrl))throw Error('Bitte einen Turniernamen, eine Nummer, ein gültiges Datum und einen Ort eintragen.');
  if(d.externalUrl&&!d.archived)throw Error('Externe Spielpläne werden als Archiv geführt.');
  return d;
}
export function mergeTournamentCatalog(remote=[]){
  const map=new Map(DEFAULT_TOURNAMENTS.map(t=>[t.id,{...t}]));
  for(const row of remote){try{if(validTournamentId(row.id))map.set(row.id,{id:row.id,...validateTournamentInfo(row)});}catch{/* Unbekannte Daten nicht als HTML/Links darstellen. */}}
  return [...map.values()].sort((a,b)=>b.date.localeCompare(a.date)||b.edition-a.edition);
}
export const tournamentDate=t=>new Date(t.date+'T12:00:00').toLocaleDateString('de-DE',{day:'2-digit',month:'long',year:'numeric'});
const openButton=(t,label='Turnier ansehen')=>`<button class="button ${t.archived?'light':''}" data-action="tournament-select" data-id="${e(t.id)}">${label} ↗</button>`;
export function tournamentCard(t,{canManage=false}={}){const open=openButton(t,t.archived?'Ergebnisse ansehen':'Zum Turnier');return `<article class="panel club-event-card"><div class="club-card-meta"><span class="tag ${t.archived?'':'red-tag'}">${t.archived?'ARCHIV':'TURNIER'}</span><span>${e(t.date.slice(0,4))}</span></div><h3>${e(t.title)}</h3><p class="club-event-detail">${e(tournamentDate(t))}<br>${e(t.venue)}</p>${t.externalUrl?'<p class="legend">Alle Spielergebnisse und Gruppentabellen aus dem Originalspielplan.</p>':''}${canManage&&!t.archived&&!t.externalUrl?`<div class="club-event-actions">${open}<button class="button light" data-action="tournament-registrations" data-id="${e(t.id)}">Anmeldungen verwalten</button></div>`:open}</article>`;}
export function homeView(catalog,registrationSettings={}){
  const future=catalog.filter(t=>!t.archived&&t.date>=localDate()).sort((a,b)=>a.date.localeCompare(b.date));
  const next=future[0]??catalog.find(t=>!t.archived),last=null;
  return `<section class="club-welcome"><p class="eyebrow">BEERPONG ACADEMY e. V.</p><h1>Gemeinsam<br>an den Tisch<span class="red">.</span></h1><p>Wir bringen Menschen beim Beerpong zusammen. Hier findest du unsere Turniere, Ergebnisse und alles rund um die Mitgliedschaft im Verein.</p></section>${next?`<section class="club-next-event"><div><p class="eyebrow">DAS NÄCHSTE TURNIER</p><h2>${e(next.title)}</h2><p class="club-event-date">${e(tournamentDate(next))}</p><p>${e(next.venue)}</p>${registrationTeaser(next,registrationSettings[next.id])}<div class="admin-actions">${openButton(next,'Turnier ansehen')}<button class="button ghost" data-view="membership">Mitglied werden ↗</button></div></div><div class="club-edition-art" aria-hidden="true"><span>${next.edition}</span><small>GEMEINSAM. AM TISCH.</small></div></section>`:''}<div class="club-section-title"><div><p class="eyebrow">GUTE SPIELE BLEIBEN</p><h2>Zuletzt am Tisch.</h2></div><button class="text-button" data-view="tournaments">Alle Turniere ansehen ↗</button></div><div class="club-home-grid">${last?tournamentCard(last):'<div class="panel"><h3>Unser Turnierarchiv wächst.</h3><p>Hier erscheinen die abgeschlossenen Turniere.</p></div>'}<section class="panel club-join"><p class="eyebrow">MEHR ALS EIN TURNIER</p><h3>Werde Teil der Academy.</h3><p>Mitglied werden, gemeinsam spielen und das Vereinsleben mitgestalten.</p><p class="legend">Mitgliedsbeitrag: ${new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(annualFee(localDate().slice(0,4))/100)} pro Jahr.</p><button class="button light" data-view="membership">Zur Mitgliedschaft ↗</button></section></div>`;
}
export function tournamentsView(catalog,canManage){
  const upcoming=catalog.filter(t=>!t.archived),archive=[];
  return `<div class="section-head"><div><p class="eyebrow">VOM ERSTEN WURF BIS INS ARCHIV</p><h2>Unsere Turniere.</h2><p>Das nächste Turnier planen. Vergangene Spiele wiederfinden.</p></div>${canManage?'<button class="button light" data-action="tournament-new">Turnier anlegen</button>':''}</div><h3 class="club-list-heading">Aktuelle & kommende Turniere</h3><div class="club-event-grid">${upcoming.map(t=>tournamentCard(t,{canManage})).join('')||'<p>Aktuell ist kein weiteres Turnier eingetragen.</p>'}</div>`;
}
export function externalArchiveView(t,view='overview'){
  const data=archives.get(t.id),qualified=new Set(data?.knockout.filter(m=>m.round==='Achtelfinale').flatMap(m=>[m.a,m.b])??[]);
  const source=`<div class="archive-source"><a href="${e(t.externalUrl)}" target="_blank" rel="noopener noreferrer">Originalspielplan öffnen ↗</a><p class="legend">Quelle: meinSpielplan.de · Alle Gruppentabellen sowie Gruppen- und KO-Ergebnisse sind direkt in der Anwendung einsehbar. Ergebnisse und Tabellen entsprechen der damaligen Wertung.</p></div>`;
  if(!data)return `<section class="panel external-archive"><h2>${e(t.title)}</h2><p>${e(tournamentDate(t))} · ${e(t.venue)}</p><p>Die Ergebnisse findest du auch im Originalspielplan.</p>${source}</section>`;
  const head=`<div class="section-head"><div><p class="eyebrow">ABGESCHLOSSEN · ${t.edition}. TURNIER</p><h2>${e(t.title)}</h2><p>${e(tournamentDate(t))} · ${e(t.venue)}</p></div></div>`;
  if(view==='games')return head+`<section id="archive-games-root" data-id="${e(t.id)}"><p class="notice">Originalergebnisse aus dem damaligen Turnier. Die historischen Zahlen werden unverändert übernommen.</p><div class="filter-bar"><label>Team suchen<input id="archive-game-search" type="search" maxlength="100" placeholder="Teamname …"></label><label>Turnierphase<select id="archive-game-phase"><option value="all">Alle Spiele</option><option value="group">Gruppenspiele</option><option value="ko">KO-Spiele</option></select></label><label>Gruppe<select id="archive-game-group"><option value="all">Alle Gruppen</option>${data.groups.map(g=>`<option value="${g.letter}">Gruppe ${g.letter}</option>`).join('')}</select></label></div><p id="archive-game-count" class="legend" role="status"></p><div id="archive-game-list" class="archive-results-grid"></div></section>`+source;
  if(view==='groups')return head+`<p class="legend">Markierte Teams haben die KO-Phase erreicht. Platzierungen und Wertung entsprechen dem Originalspielplan.</p><div class="group-grid">${data.groups.map(g=>`<section class="panel group-panel"><h3>Gruppe ${g.letter}</h3><table aria-label="Historische Tabelle Gruppe ${g.letter}"><thead><tr><th>TEAM</th><th>SP</th><th>DIFF</th><th>PKT</th></tr></thead><tbody>${g.teams.map(r=>`<tr class="${qualified.has(r.name)?'qualified':''}"><td><span class="position">${r.position}</span>${e(r.name)}</td><td>${r.played}</td><td>${r.diff>0?'+':''}${r.diff}</td><td class="points">${r.points}</td></tr>`).join('')}</tbody></table></section>`).join('')}</div>`+source;
  if(view==='teams')return head+`<div class="team-grid">${data.groups.flatMap(g=>g.teams.map(r=>`<article class="team-card"><span class="tag">GRUPPE ${g.letter}</span><h3>${e(r.name)}</h3><p>Gruppenplatz ${r.position} · ${r.points} Punkte</p></article>`)).join('')}</div>`+source;
  const ko=`<div class="archive-ko-grid">${[['Achtelfinale'],['Viertelfinale'],['Halbfinale'],['Finale','Spiel um Platz 3']].map((rounds,i)=>`<section class="archive-round"><h3>${['Achtelfinale','Viertelfinale','Halbfinale','Finalspiele'][i]}</h3>${data.knockout.filter(m=>rounds.includes(m.round)).map(m=>`<article class="match-card"><p class="legend">${e(m.round)}</p>${['a','b'].map((side,si)=>`<div class="match-team ${m.score[si]>m.score[1-si]?'winner':''}"><span class="name">${e(m[side])}${m.score[si]>m.score[1-si]?' ✓':''}</span><span class="score">${m.score[si]}</span></div>`).join('')}</article>`).join('')}</section>`).join('')}</div>`;
  if(view==='bracket')return head+`<p class="notice">Historische Ergebnisse laut Originalspielplan.</p>`+ko+source;
  return head+`<div class="archive-podium">${data.placements.slice(0,3).map(p=>`<article class="panel archive-place"><span class="archive-place-no">${p.position}</span><p>${p.position===1?'TURNIERSIEGER':p.position+'. PLATZ'}</p><h3>${e(p.name)}</h3></article>`).join('')}</div><div class="stats"><div class="stat"><strong>${data.teamCount}</strong><span>Teams</span></div><div class="stat"><strong>${data.groups.length}</strong><span>Gruppen</span></div><div class="stat"><strong>${data.totalMatches}</strong><span>Spiele ausgetragen</span></div><div class="stat"><strong>${e(t.date.slice(0,4))}</strong><span>Turnierjahr</span></div></div><div class="admin-actions"><button class="button light" data-view="games">Alle Spielergebnisse</button><button class="button light" data-view="groups">Gruppentabellen</button><button class="button light" data-view="bracket">KO-Ergebnisse</button></div><h3 class="club-list-heading">Der Weg ins Finale</h3>`+ko+source;
}
export function bindArchiveGames(t){
 const data=archives.get(t.id),root=document.querySelector('#archive-games-root');if(!data||!root)return;
 const games=[...(data.groupMatches??[]).map(m=>({...m,phase:'group',label:'Gruppe '+m.group})),...data.knockout.map(m=>({...m,phase:'ko',label:m.round}))];
 const paint=()=>{const search=root.querySelector('#archive-game-search').value.toLocaleLowerCase('de').trim(),phase=root.querySelector('#archive-game-phase').value,group=root.querySelector('#archive-game-group').value;
  const rows=games.filter(m=>(phase==='all'||m.phase===phase)&&(group==='all'||m.group===group)&&(!search||`${m.a} ${m.b}`.toLocaleLowerCase('de').includes(search)));
  root.querySelector('#archive-game-count').textContent=`${rows.length} von ${games.length} Spielen · ${data.groupMatches?.length??0} Gruppenspiele und ${data.knockout.length} KO-Spiele`;
  root.querySelector('#archive-game-list').innerHTML=rows.map(m=>`<article class="panel archive-game-card"><p class="legend">${e(m.label)}${m.table?' · Tisch '+m.table:''}</p>${['a','b'].map((side,i)=>`<div class="match-team ${m.score[i]>m.score[1-i]?'winner':''}"><span class="name">${e(m[side])}${m.score[i]>m.score[1-i]?' ✓':''}</span><span class="score">${m.score[i]}</span></div>`).join('')}</article>`).join('')||'<p>Keine passenden Spiele.</p>';
 };
 for(const id of ['archive-game-search','archive-game-phase','archive-game-group'])root.querySelector('#'+id).addEventListener(id.endsWith('search')?'input':'change',paint);paint();
}
