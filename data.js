import * as E from './engine.js';
export function parseTeamsCSV(text) {
  const rows=[];let row=[],cell='',quoted=false;text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
    else if(c===';'&&!quoted){row.push(cell);cell='';}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}
    else cell+=c;
  }
  if(quoted)throw new Error('Nicht geschlossene Anführungszeichen in der CSV-Datei.');
  row.push(cell);if(row.some(v=>v.trim()))rows.push(row);
  const head=rows.shift()?.map(v=>v.trim().toLowerCase()).join(';');
  if(!['team;person 1;person 2','team;person 1;person 2;gruppe'].includes(head))throw new Error('CSV-Kopfzeile: Team;Person 1;Person 2;Gruppe (Gruppe darf leer sein).');
  if(rows.length>32||!rows.length)throw new Error('Eine CSV-Datei muss 1 bis 32 Teams enthalten.');
  const teams=rows.map(cols=>{if(cols.length!==3&&cols.length!==4)throw new Error('Drei oder vier Spalten pro Zeile erwartet.');return{id:crypto.randomUUID(),name:cols[0].trim(),p1:cols[1].trim(),p2:cols[2].trim(),group:(cols[3]??'').trim().toUpperCase()};});
  validateDraftTeams(teams);return teams;
}
export function validateDraftTeams(teams) {
  if(!Array.isArray(teams)||teams.length>32||new Set(teams.map(t=>t.id)).size!==teams.length)throw new Error('Ungültige oder doppelte Teamdaten.');
  const names=new Set();
  for(const t of teams){
    if(typeof t.id!=='string'||!t.id||t.id.length>128||typeof t.name!=='string'||!t.name.trim()||t.name.length>60||typeof t.p1!=='string'||typeof t.p2!=='string'||t.p1.length>60||t.p2.length>60||!['',...E.GROUPS].includes(t.group))throw new Error('Ungültige Teamdaten oder Gruppe.');
    const key=t.name.trim().toLocaleLowerCase('de');if(names.has(key))throw new Error('Teamnamen müssen eindeutig sein.');names.add(key);
  }
}
export function validateBackup(parsed) {
  const s=parsed?.state;
  if(parsed?.format!=='beerpong-v2'||!s||s.schema!==2)throw new Error('Bitte eine Beerpong-Sicherung der neuen Version (v2) auswählen. Alte Sicherungen werden nicht ungeprüft übernommen.');
  if(!E.PHASES.includes(s.phase)||typeof s.title!=='string'||!s.title.trim()||s.title.length>60||!Number.isInteger(s.tableCount)||s.tableCount<1||s.tableCount>32||!Number.isInteger(s.activeTableCount)||s.activeTableCount<0||s.activeTableCount>s.tableCount||typeof s.allowSelfScoring!=='boolean'||!Array.isArray(s.dispatchEvents)||s.dispatchEvents.length>2048||!s.matches||!s.results||!s.decisions||!s.tableStates)throw new Error('Unvollständige Turniersicherung.');
  validateDraftTeams(s.teams);if(s.phase!=='setup')E.validateTeams(s.teams);
  const ids=new Set(s.teams.map(t=>t.id));
  if(Object.keys(s.matches).length>64||Object.keys(s.results).length>64)throw new Error('Zu viele Spiele in der Sicherung.');
  for(const [id,m] of Object.entries(s.matches))if(m.id!==id||!['group','r16','quarter','semi','final'].includes(m.phase)||!ids.has(m.a)||!ids.has(m.b)||m.a===m.b||typeof m.label!=='string'||!Number.isInteger(m.order))throw new Error('Ungültige Spielpaarung in der Sicherung.');
  for(const [id,r] of Object.entries(s.results)){if(!s.matches[id])throw new Error('Ergebnis ohne Spiel.');E.validateResult(r);}
  let lastAt=0;
  for(const ev of s.dispatchEvents){
    if(!Number.isInteger(ev.at)||ev.at<lastAt)throw new Error('Ungültige Reihenfolge der Tischereignisse.');lastAt=ev.at;
    if(!['phase','score','assign','release','start','status','tables','plan','cancel-plan'].includes(ev.type))throw new Error('Unbekannter Tischvorgang.');
    if(['score','assign','release','start'].includes(ev.type)&&!s.matches[ev.id])throw new Error('Tischvorgang ohne Spiel.');
    if(ev.type==='score'&&!s.results[ev.id])throw new Error('Tischvorgang ohne Ergebnis.');
    if(['tables','plan'].includes(ev.type)&&(!Number.isInteger(ev.count)||ev.count<0||ev.count>32))throw new Error('Ungültige Tischanzahl.');
    if(ev.type==='plan'&&(!Number.isFinite(ev.when)||typeof ev.id!=='string'))throw new Error('Ungültiger Tischzeitplan.');
    if(ev.type==='phase'&&(!E.PHASES.includes(ev.phase)||!Number.isInteger(ev.tables)||ev.tables<0||ev.tables>32))throw new Error('Ungültiger Phasenstart.');
    if(ev.type==='assign'&&(!Number.isInteger(ev.table)||ev.table<0||ev.table>32))throw new Error('Ungültige Tischzuweisung.');
    if(ev.type==='status'&&(!Number.isInteger(ev.table)||ev.table<1||ev.table>32||!['free','open','preparing'].includes(ev.status)))throw new Error('Ungültiger Tischstatus.');
  }
  if(Object.keys(s.results).some(id=>!s.dispatchEvents.some(ev=>ev.type==='score'&&ev.id===id)))throw new Error('Die Sicherung enthält unvollständige Tischereignisse.');
  if(s.phase==='complete'&&(!s.results['final-1']||!s.results['bronze-1']))throw new Error('Finalergebnisse fehlen.');
  for(const [group,d] of Object.entries(s.decisions))if(!E.GROUPS.includes(group)||!d||!Array.isArray(d.order)||d.order.length!==4||new Set(d.order).size!==4||d.order.some(id=>!s.teams.some(t=>t.id===id&&t.group===group))||typeof d.reason!=='string')throw new Error('Ungültige Gruppenentscheidung.');
  return s;
}
