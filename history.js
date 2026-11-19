/** Sporthistorie: alte Ergebniszahlen unverändert; aktuelle Ergebnisse sind Restbecher. */
import * as E from './engine.js';
import {escapeHTML as e} from './ui.js';
import {nameKey,fullName} from './registration.js';

export function historyAppearances(catalog,archives,native=[]){
 const appearances=[];
 for(const archive of archives){
  const meta=catalog.find(t=>t.id===archive.id);if(!meta)continue;
  for(const group of archive.groups)for(const team of group.teams){
   const games=[...(archive.groupMatches??[]).map(m=>({...m,round:'Gruppe '+m.group})),...archive.knockout].filter(m=>m.a===team.name||m.b===team.name).map(m=>{
    const index=m.a===team.name?0:1;return{round:m.round,opponent:index===0?m.b:m.a,score:m.score,teamSide:index,won:m.score[index]>m.score[1-index],draw:m.score[0]===m.score[1],mode:'historic'};
   });
   const place=archive.placements.find(p=>p.name===team.name)?.position;
   const reached=archive.knockout.filter(m=>[m.a,m.b].includes(team.name)).at(-1)?.round??'Gruppenphase';
   appearances.push({tournamentId:meta.id,year:meta.date.slice(0,4),date:meta.date,edition:meta.edition,teamName:team.name,group:group.letter,place,reached,games});
  }
 }
 for(const {meta,state}of native){
  for(const team of state.teams){
   const games=E.allMatches(state).filter(m=>[m.a,m.b].includes(team.id)&&state.results[m.id]).map(m=>{
    const r=state.results[m.id],index=m.a===team.id?0:1;return{round:m.phase==='group'?'Gruppe '+m.group:E.LABELS[m.phase],opponent:state.teams.find(t=>t.id===(index===0?m.b:m.a))?.name??'Team',score:[E.remainingCups(r,'a'),E.remainingCups(r,'b')],teamSide:index,won:E.winnerId(m,r)===team.id,draw:false,mode:'remaining'};
   });
   const final=E.match(state,'final-1'),bronze=E.match(state,'bronze-1');let place;
   if(final&&state.results['final-1']&&[final.a,final.b].includes(team.id))place=E.winnerId(final,state.results['final-1'])===team.id?1:2;
   if(bronze&&state.results['bronze-1']&&[bronze.a,bronze.b].includes(team.id))place=E.winnerId(bronze,state.results['bronze-1'])===team.id?3:4;
   if(games.length)appearances.push({tournamentId:meta.id,teamId:team.id,year:meta.date.slice(0,4),date:meta.date,edition:meta.edition,teamName:team.name,group:team.group,place,reached:games.at(-1).round,games});
  }
 }
 return appearances.sort((a,b)=>b.date.localeCompare(a.date)||a.teamName.localeCompare(b.teamName,'de'));
}
export function mountHistory(root,{catalog,archives,native=[],participations=[],persons=[],publicPlayers=[],isBoard=false,own=false}){
 const publicParts=publicPlayers.flatMap(p=>(p.appearances??[]).map(a=>({...a,personId:p.id,firstName:p.displayName,lastName:'',publicAliases:p.aliases??[]})));
 if(!isBoard)participations=[...participations,...publicParts.filter(p=>!participations.some(own=>own.personId===p.personId&&own.tournamentId===p.tournamentId&&own.teamName===p.teamName))];
 const all=historyAppearances(catalog,archives,native);
 const archiveCards=catalog.filter(t=>t.archived).map(t=>'<button class="button light" data-action="tournament-select" data-id="'+e(t.id)+'">'+e(t.title)+' · '+e(t.date.slice(0,4))+'</button>').join('');
 root.innerHTML=`<div class="section-head"><div><p class="eyebrow">GUTE SPIELE BLEIBEN</p><h2>Ergebnishistorie.</h2><p>Teams über mehrere Turniere verfolgen${isBoard?' und bestätigte Spielerzuordnungen durchsuchen':''}.</p></div></div><section class="panel"><h3>Vergangene Turniere</h3><div class="admin-actions">${archiveCards}</div></section><div class="filter-bar"><label>${isBoard?'Team oder Spieler':publicPlayers.length?'Team oder freigegebener Spielername':own&&participations.length?'Team oder eigener Spielername':'Team suchen'}<input id="history-search" type="search" placeholder="Teamname${isBoard?' oder Spielername':''} …"></label><label>Turnierjahr<select id="history-year"><option value="all">Alle Jahre</option>${[...new Set(all.map(a=>a.year))].sort().reverse().map(y=>`<option>${y}</option>`).join('')}</select></label>${participations.length?`<label>Person<select id="history-person"><option value="">Alle Teams</option>${[...new Map(participations.map(p=>[p.personId,p])).values()].map(p=>`<option value="${e(p.personId)}">${e(persons.find(x=>x.id===p.personId)?fullName(persons.find(x=>x.id===p.personId)):fullName(p))}</option>`).join('')}</select></label>`:''}</div><p class="notice">Gleiche Teamnamen können in verschiedenen Jahren andere Besetzungen haben. Historische Ergebniszahlen bleiben erhalten; heutige Ergebnisse zeigen übrige Becher. Becherdifferenzen verschiedener Regelstände werden nicht addiert.</p>${own&&participations.length?'<p class="legend">Deine bestätigten Teilnahmen stehen im Personenfilter zur Verfügung.</p>':''}${isBoard?'<p class="legend">Alle freigegebenen Konten sehen dieselbe Ergebnishistorie. Unbekannte Besetzungen sind ausdrücklich als Spieler 1 und Spieler 2 gekennzeichnet.</p>':''}<p id="history-count" role="status"></p><div id="history-results"></div>`;
 if(root.dataset.currentTeam){const section=document.createElement('section');section.className='panel';let players=[];try{players=JSON.parse(root.dataset.currentPlayers??'[]');}catch{}section.innerHTML='<h3>'+e(root.dataset.currentTeam)+'</h3><p>Aktuelle Besetzung: '+players.map(label=>{const candidates=persons.filter(p=>nameKey(fullName(p))===nameKey(label)||nameKey(p.firstName)===nameKey(label));return candidates.length===1?'<button class="text-button" data-person-history="'+e(candidates[0].id)+'">'+e(label)+'</button>':e(label);}).join(' · ')+'</p>';root.prepend(section);}
 const paint=()=>{
  const query=nameKey(root.querySelector('#history-search').value),year=root.querySelector('#history-year').value,person=root.querySelector('#history-person')?.value??'';
  const matches=all.filter(a=>{
   const ps=participations.filter(p=>p.tournamentId===a.tournamentId&&p.teamName===a.teamName);
   const privateNames=ps.map(p=>fullName(p)+' '+(isBoard?persons.find(x=>x.id===p.personId)?.aliases??[]:p.publicAliases??[]).join(' ')).join(' ');
   return(year==='all'||a.year===year)&&(!person||ps.some(p=>p.personId===person))&&(!query||nameKey(a.teamName+' '+privateNames).includes(query));
  });
  const wins=matches.reduce((n,a)=>n+a.games.filter(g=>g.won).length,0),losses=matches.reduce((n,a)=>n+a.games.filter(g=>!g.won&&!g.draw).length,0);
  root.querySelector('#history-count').textContent=`${matches.length} Teamteilnahmen · ${wins} Siege · ${losses} Niederlagen`;
  root.querySelector('#history-results').innerHTML=matches.map(a=>{
   const lineup=participations.filter(p=>p.tournamentId===a.tournamentId&&p.teamName===a.teamName);
   const previous=all.filter(old=>old.teamName===a.teamName&&old.date<a.date).sort((x,y)=>y.date.localeCompare(x.date))[0];
   const previousLineup=previous?participations.filter(p=>p.tournamentId===previous.tournamentId&&p.teamName===previous.teamName):[];
   const unknown=[...lineup,...previousLineup].some(p=>p.firstName==='Spieler'&&/^[12]$/.test(p.lastName));
   const changeNote=previous&&lineup.length===2&&previousLineup.length===2&&!unknown
    ?`<p class="legend">${lineup.every(p=>previousLineup.some(old=>old.personId===p.personId))?'Gleiche Besetzung wie':'Andere bestätigte Besetzung als'} ${previous.year}.</p>`:'';
   return `<article class="panel history-appearance"><span class="tag">${a.year} · ${a.edition}. Turnier</span><h3>${e(a.teamName)}</h3><p>${a.place?a.place+'. Platz':e(a.reached)} · ${a.games.filter(g=>g.won).length} Siege · ${a.games.filter(g=>!g.won&&!g.draw).length} Niederlagen</p>${lineup.length?`<p class="legend">${isBoard?'Bestätigte Besetzung':'Spielerzuordnung'}: ${lineup.map(p=>'<button class="text-button" data-person-history="'+e(p.personId)+'">'+e(fullName(p))+'</button>').join(' · ')}</p>`:''}${changeNote}<details><summary>${a.games.length} Spiele ansehen</summary>${a.games.map(g=>`<div class="history-game"><span>${e(g.round)}<br><b>${e(a.teamName)} gegen ${e(g.opponent)}</b></span><span>${g.score[g.teamSide]} : ${g.score[1-g.teamSide]}<br><small>${g.won?'Sieg':g.draw?'Unentschieden':'Niederlage'} · ${g.mode==='remaining'?'übrige Becher':'Originalwertung'}</small></span></div>`).join('')}</details><button class="text-button" data-action="tournament-select" data-id="${e(a.tournamentId)}">Turnier öffnen ↗</button></article>`;
  }).join('')||'<p>Keine passenden Ergebnisse gefunden.</p>';
 };
 root.querySelector('#history-search').value=root.dataset.query??'';if([...root.querySelector('#history-year').options].some(o=>o.value===root.dataset.year))root.querySelector('#history-year').value=root.dataset.year;
 root.onclick=event=>{const button=event.target.closest('[data-person-history]');if(!button)return;root.querySelector('#history-search').value='';root.querySelector('#history-year').value='all';root.querySelector('#history-person').value=button.dataset.personHistory;paint();};
 root.querySelector('#history-search').oninput=paint;root.querySelector('#history-year').onchange=paint;const person=root.querySelector('#history-person');if(person)person.onchange=paint;paint();
}
