/** Reine Turnierlogik: unabhängig von DOM, Firebase und Berechtigungsanzeige. */
import { dispatch,forgetDispatch } from './scheduler.js';
export const GROUPS = [..."ABCDEFGH"];
export const PHASES = ["setup", "group", "r16", "quarter", "semi", "final", "complete"];
export const LABELS = { setup: "Vorbereitung", group: "Gruppenphase", r16: "Achtelfinale", quarter: "Viertelfinale", semi: "Halbfinale", final: "Finalspiele", complete: "Turnier beendet" };
export const clone = value => structuredClone(value);
const assert = (condition, message) => { if (!condition) throw new Error(message); };

export function emptyTournament() {
  return { schema: 2, title: "BEERPONG", phase: "setup", tableCount: 6, activeTableCount: 6, tableStates: {}, allowSelfScoring: false, dispatchEvents: [],
    teams: [], matches: {}, results: {}, decisions: {}, revision: 0,
    lastMatch: "", updatedBy: "", updatedAt: null };
}

export function validateTeams(teams) {
  assert(teams.length === 32, "Es werden genau 32 Teams benötigt.");
  assert(new Set(teams.map(t => t.id)).size === 32, "Team-IDs müssen eindeutig sein.");
  assert(new Set(teams.map(t => t.name.trim().toLocaleLowerCase("de"))).size === 32, "Teamnamen müssen eindeutig sein.");
  for (const t of teams) {
    assert(t.name.trim() && t.name.length <= 60 && t.p1.trim() && t.p2.trim() && t.p1.length <= 60 && t.p2.length <= 60, "Jedes Team braucht einen Namen und zwei Personen (je maximal 60 Zeichen).");
    assert(GROUPS.includes(t.group), "Ungültige Gruppe.");
  }
  assert(GROUPS.every(g => teams.filter(t => t.group === g).length === 4), "Jede Gruppe muss genau vier Teams enthalten.");
}

export function startGroups(state) {
  assert(state.phase === "setup", "Die Gruppenphase wurde bereits gestartet.");
  validateTeams(state.teams);
  const pendingPlans=tablePlans(state).filter(p=>p.status==='pending');
  const s = clone(state);s.activeTableCount=activeTables(state);
  s.matches = {}; s.results = {}; s.decisions = {}; s.phase = "group";
  s.dispatchEvents = [];
  addEvent(s,{type:'phase',phase:'group',tables:s.activeTableCount});
  for(const p of pendingPlans)addEvent(s,{type:'plan',id:p.id,count:p.count,when:p.when});
  // Drei Runden, jedes Team einmal je Runde, insgesamt 48 Gruppenspiele.
  const pairs = [[[0,3],[1,2]], [[0,2],[3,1]], [[0,1],[2,3]]];
  let order = 0;
  pairs.forEach((round, ri) => GROUPS.forEach(group => {
    const teams = s.teams.filter(t => t.group === group);
    round.forEach(([a,b], pi) => {
      const id = `g-${group}-${ri + 1}-${pi + 1}`;
      s.matches[id] = { id, phase: "group", group, round: ri + 1, a: teams[a].id, b: teams[b].id, table: 0, status: "queued", queue: order, order: order++, label: `Gruppe ${group} · Spiel ${ri * 2 + pi + 1}` };
    });
  }));
  return s;
}

export function phaseMatches(state, phase = state.phase) {
  return allMatches(state).filter(m => m.phase === phase).sort((a,b) => a.order - b.order);
}
export function allMatches(state) { return Object.values(dispatch(state).matches); }
export function match(state,id) { return dispatch(state).matches[id]; }
export function activeTables(state) { return dispatch(state).count; }
export function tablePlans(state) { return dispatch(state).plans; }
function addEvent(state,event) {
  const at=Math.max(Date.now(),state.dispatchEvents.at(-1)?.at??0);
  state.dispatchEvents.push({...event,at});
  forgetDispatch(state);
  assert(state.dispatchEvents.length<=2048,'Zu viele Verwaltungsvorgänge. Bitte die Spielleitung kontaktieren.');
}
export function configureTables(state,total,count) {
  assert(Number.isInteger(total)&&total>=1&&total<=32&&Number.isInteger(count)&&count>=0&&count<=total,'Bitte 1–32 vorhandene und 0 bis maximal so viele bespielbare Tische angeben.');
  assert(!tablePlans(state).some(p=>p.status==='pending'&&p.count>total),'Bitte zuerst Zeitpläne entfernen, die mehr Tische als die neue Gesamtzahl benötigen.');
  const s=clone(state);s.tableCount=total;s.activeTableCount=count;addEvent(s,{type:'tables',count});return s;
}
export function planTables(state,count,when) {
  assert(Number.isInteger(count)&&count>=0&&count<=state.tableCount,'Ungültige Tischanzahl.');
  const time=new Date(when).getTime();assert(Number.isFinite(time)&&time>Date.now(),'Bitte einen Zeitpunkt in der Zukunft angeben.');
  const s=clone(state);addEvent(s,{type:'plan',id:crypto.randomUUID(),count,when:time});return s;
}
export function cancelTablePlan(state,id) {const s=clone(state);assert(tablePlans(s).some(p=>p.id===id&&p.status==='pending'),'Dieser Zeitplan ist bereits ausgeführt oder entfernt.');addEvent(s,{type:'cancel-plan',id});return s;}
export function validateResult(result) {
  assert(result && ["a", "b"].includes(result.winner), "Bitte das Siegerteam auswählen.");
  assert(Number.isInteger(result.cups) && result.cups >= 1 && result.cups <= 10, "Beim Verlierer müssen 1 bis 10 Becher übrig sein.");
  assert(typeof result.overtime === "boolean", "Verlängerung muss eindeutig angegeben werden.");
  assert(!result.overtime || result.cups === 1, "Ein Sieg nach Verlängerung wird immer mit einem Becher Differenz gewertet.");
}
export function winnerId(match, result) { return result ? match[result.winner] : null; }
export function loserId(match, result) { return result ? match[result.winner === "a" ? "b" : "a"] : null; }
export const cupMargin=result=>result.overtime?1:result.cups;
export const remainingCups=(result,side)=>result.winner===side?0:cupMargin(result);

/** Punkte, dann Differenz, dann direkter Vergleich (bei >2: Mini-Tabelle). */
export function standings(state, group) {
  const rows = state.teams.filter(t => t.group === group).map(t => ({ ...t, played: 0, won: 0, lost: 0, points: 0, plus: 0, minus: 0, diff: 0, hPoints: 0, hDiff: 0, tied: false, tieKey: "" }));
  const matches = phaseMatches(state, "group").filter(m => m.group === group);
  for (const m of matches) {
    const r = state.results[m.id]; if (!r) continue;
    const w = rows.find(t => t.id === winnerId(m,r)), l = rows.find(t => t.id === loserId(m,r));
    if (!w || !l) continue;
    w.played++; l.played++; w.won++; l.lost++; w.points += 3;
    // Gezählt werden die übrigen Becher des Verlierers: Sieger +n, Verlierer −n.
    const cups=cupMargin(r);w.plus += cups; l.minus += cups;
  }
  rows.forEach(t => { t.diff = t.plus - t.minus; });
  const buckets = new Map();
  for (const t of rows) {
    const key = `${t.points}/${t.diff}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(t);
  }
  for (const peers of buckets.values()) {
    if (peers.length < 2) continue;
    const ids = peers.map(t => t.id);
    for (const m of matches) {
      const r = state.results[m.id];
      if (!r || !ids.includes(m.a) || !ids.includes(m.b)) continue;
      const w = peers.find(t => t.id === winnerId(m,r)), l = peers.find(t => t.id === loserId(m,r));
      const cups=cupMargin(r);w.hPoints += 3; w.hDiff += cups; l.hDiff -= cups;
    }
  }
  for (const t of rows) t.tieKey = `${t.points}/${t.diff}/${t.hPoints}/${t.hDiff}`;
  const decision = state.decisions[group];
  const manual = id => decision?.order.indexOf(id) ?? -1;
  rows.sort((a,b) => b.points - a.points || b.diff - a.diff || b.hPoints - a.hPoints || b.hDiff - a.hDiff || (decision ? manual(a.id) - manual(b.id) : 0) || a.id.localeCompare(b.id));
  rows.forEach(t => { t.tied = !decision && rows.some(p => p.id !== t.id && p.tieKey === t.tieKey); });
  return rows;
}

export function decideGroup(state, group, order, reason) {
  assert(state.phase === "group", "Entscheidungen sind nur in der Gruppenphase möglich.");
  assert(phaseMatches(state,"group").filter(m => m.group === group).every(m => state.results[m.id]), "Zuerst alle Spiele dieser Gruppe abschließen.");
  const rows = standings({ ...state, decisions: {} }, group);
  assert(order.length === 4 && new Set(order).size === 4 && order.every(id => rows.some(t => t.id === id)), "Bitte alle vier Teams genau einmal auswählen.");
  assert(reason.trim().length >= 3 && reason.length <= 200, "Bitte eine Begründung mit 3 bis 200 Zeichen eintragen.");
  const arranged = order.map(id => rows.find(t => t.id === id));
  for (let i = 0; i < 4; i++) assert(arranged[i].tieKey === rows[i].tieKey, "Nur vollständig gleichplatzierte Teams dürfen umgeordnet werden.");
  const s = clone(state); s.decisions[group] = { order, reason: reason.trim() }; return s;
}

export function advancePhase(state) {
  const s = clone(state);
  const current = phaseMatches(s);
  assert(current.length > 0 && current.every(m => s.results[m.id]), "Zuerst alle Spiele der aktuellen Phase abschließen.");
  let next, entrants;
  if (s.phase === "group") {
    const ranks = Object.fromEntries(GROUPS.map(g => [g, standings(s,g)]));
    assert(GROUPS.every(g => !ranks[g].some(t => t.tied)), "Ein Gleichstand ist noch offen. Bitte die Gruppenentscheidung eintragen.");
    const seeds = ["A1","B2","C1","D2","E1","F2","G1","H2","B1","A2","D1","C2","F1","E2","H1","G2"];
    entrants = seeds.map(seed => ranks[seed[0]][Number(seed[1])-1].id); next = "r16";
  } else if (s.phase === "r16" || s.phase === "quarter") {
    entrants = current.map(m => winnerId(m,s.results[m.id]));
    next = s.phase === "r16" ? "quarter" : "semi";
  } else if (s.phase === "semi") {
    next = "final";
    const [a,b] = current;
    s.matches["bronze-1"] = { id: "bronze-1", phase: next, group: "", round: 1, a: loserId(a,s.results[a.id]), b: loserId(b,s.results[b.id]), table: 0, status: "queued", queue: 0, order: 0, label: "Spiel um Platz 3" };
    s.matches["final-1"] = { id: "final-1", phase: next, group: "", round: 1, a: winnerId(a,s.results[a.id]), b: winnerId(b,s.results[b.id]), table: 0, status: "queued", queue: 1, order: 1, label: "Finale" };
  } else if (s.phase === "final") { s.phase = "complete"; return s; }
  else throw new Error("Diese Phase kann nicht weitergeschaltet werden.");
  if (entrants) for (let i = 0; i < entrants.length; i += 2) {
    const id = `${next}-${i/2+1}`;
    s.matches[id] = { id, phase: next, group: "", round: 1, a: entrants[i], b: entrants[i+1], table: 0, status: "queued", queue: i/2, order: i/2, label: `${LABELS[next]} ${i/2+1}` };
  }
  s.phase = next; addEvent(s,{type:'phase',phase:next,tables:activeTables(state)}); return s;
}

/** Frühere Korrekturen entfernen atomar alle nachfolgenden KO-Runden. */
export function recordResult(state, id, result, isAdmin = false) {
  result = {...result, cups: result.overtime ? 1 : result.cups};
  validateResult(result);
  const m = state.matches[id]; assert(m, "Dieses Spiel existiert nicht mehr.");
  assert(isAdmin || m.phase === state.phase, "Diese Phase ist abgeschlossen.");
  const s = clone(state);
  if (isAdmin && PHASES.indexOf(m.phase) < PHASES.indexOf(s.phase)) {
    const capacity=activeTables(state),pending=tablePlans(state).filter(p=>p.status==='pending');
    for (const other of Object.values(s.matches)) if (PHASES.indexOf(other.phase) > PHASES.indexOf(m.phase)) {
      delete s.matches[other.id]; delete s.results[other.id];
    }
    s.phase = m.phase;
    const cut = s.dispatchEvents.findIndex(event => event.type==='phase' && PHASES.indexOf(event.phase)>PHASES.indexOf(m.phase));
    if(cut>=0)s.dispatchEvents=s.dispatchEvents.slice(0,cut);
    for(const p of pending)if(!s.dispatchEvents.some(ev=>ev.type==='plan'&&ev.id===p.id))addEvent(s,{type:'plan',id:p.id,count:p.count,when:p.when});
    addEvent(s,{type:'tables',count:capacity});
  }
  s.results[id] = clone(result); s.lastMatch = id;
  addEvent(s,{type:'score',id});
  if (m.phase === "group") delete s.decisions[m.group];
  return s;
}

export function assignTable(state, id, table) {
  const s = clone(state), m = s.matches[id];
  assert(m && m.phase === s.phase && !s.results[id], "Nur offene Spiele der aktuellen Phase können zugewiesen werden.");
  assert(Number.isInteger(table) && table >= 0 && table <= activeTables(state), "Dieser Tisch ist nicht bespielbar.");
  addEvent(s,{type:'assign',id,table});
  return s;
}

export function releaseMatch(state,id) {
  assert(state.matches[id]&&state.matches[id].phase===state.phase&&!state.results[id],'Nur offene Spiele können freigegeben werden.');
  const s=clone(state);addEvent(s,{type:'release',id});return s;
}
/** Unzugewiesene Partien für eine manuelle Tischwarteschlange vorschlagen.
 * Freie Teams zuerst, danach Spielplanreihenfolge. Gebundene Teams dürfen
 * vorgemerkt werden, bleiben beim Nachrücken aber durch dispatch gesperrt.
 */
export function tableCandidates(state){
  const matches=phaseMatches(state),busy=new Set(matches.filter(m=>['open','preparing','playing'].includes(m.status)&&!state.results[m.id]).flatMap(m=>[m.a,m.b]));
  return matches.filter(m=>!state.results[m.id]&&!m.table&&!m.held).map(m=>({...m,teamsReady:!busy.has(m.a)&&!busy.has(m.b)})).sort((a,b)=>Number(b.teamsReady)-Number(a.teamsReady)||a.order-b.order);
}
export function queueAtTable(state,table,ids){
  assert(Number.isInteger(table)&&table>=1&&table<=activeTables(state),'Dieser Tisch ist nicht mehr bespielbar.');
  assert(Array.isArray(ids)&&new Set(ids).size===ids.length,'Partien dürfen nicht doppelt vorgemerkt werden.');
  const available=new Set(tableCandidates(state).map(m=>m.id));
  assert(ids.every(id=>available.has(id)),'Eine ausgewählte Partie ist inzwischen zugewiesen, beendet oder zurückgestellt. Bitte die Tischverwaltung neu öffnen.');
  let next=state;for(const id of ids)next=assignTable(next,id,table);return next;
}
export function tableQueue(state, table) {
  return phaseMatches(state).filter(m => m.table === table && !state.results[m.id]).sort((a,b) => a.queue - b.queue);
}
export function teamTableInfo(state,teamId){
  if(!state||!teamId)return{current:null,upcoming:[]};
  const own=phaseMatches(state).filter(m=>!state.results[m.id]&&m.table&&[m.a,m.b].includes(teamId));
  const current=own.find(m=>['open','preparing','playing'].includes(m.status))??null;
  const upcoming=own.filter(m=>m.status==='queued').map(m=>({...m,position:tableQueue(state,m.table).filter(g=>g.status==='queued').findIndex(g=>g.id===m.id)+1})).sort((a,b)=>a.position-b.position||a.queue-b.queue);
  return{current,upcoming};
}
export function activeAtTable(state, table) { return tableQueue(state,table).find(m => ['open','preparing','playing'].includes(m.status)); }
export function tableStatus(state, table) { const active=activeAtTable(state,table);return active ? table>activeTables(state)?'draining':active.status : table>activeTables(state)?'disabled':'free'; }
export function startMatch(state, id) {
  const s = clone(state), m = match(state,id);
  assert(m && m.phase === s.phase && !s.results[id] && m.table, "Zuerst einen Tisch für das offene Spiel zuweisen.");
  assert(m.table<=activeTables(state),'Dieser Tisch ist nicht mehr bespielbar. Bitte das Spiel umsetzen.');
  const active = phaseMatches(s).filter(x => !s.results[x.id] && ['open','preparing','playing'].includes(x.status) && x.id !== id);
  assert(!active.some(x => x.table === m.table), "An diesem Tisch ist bereits ein Spiel an der Reihe. Zuerst beenden oder umsetzen.");
  assert(!active.some(x => [x.a,x.b].some(t => t === m.a || t === m.b)), "Ein Team spielt bereits an einem anderen Tisch.");
  addEvent(s,{type:'start',id}); return s;
}
export function setTableStatus(state, table, status) {
  assert(Number.isInteger(table) && table >= 1 && table <= state.tableCount, "Ungültige Tischnummer.");
  assert(["free","open","preparing","playing"].includes(status), "Ungültiger Tischstatus.");
  if (status === "playing") {
    const m = activeAtTable(state,table) || tableQueue(state,table)[0];
    assert(m, "Zuerst ein Spiel diesem Tisch zuweisen.");
    return startMatch(state,m.id);
  }
  if(status==='preparing'||status==='open')assert(activeAtTable(state,table),'Zuerst ein Spiel diesem Tisch zuweisen.');
  const s = clone(state);
  addEvent(s,{type:'status',table,status}); return s;
}

export function resetTournament(state) {
  const s = emptyTournament(); s.teams = clone(state.teams); s.title = state.title;
  s.tableCount = state.tableCount; s.activeTableCount=activeTables(state); s.allowSelfScoring=state.allowSelfScoring; return s;
}

export function demoTournament() {
  const names = ["Deichkinder","Becherbande","Wurfgewalt","Pegelhelden","Küstenkönige","Hopfen & Malz","Die Abräumer","Wellenbrecher","Red Cup Club","Deichverteidiger","Die Versenker","Letzter Becher","Nordlichter","Pong Patrol","Flutlicht","Treffsicher","Cup & Go","Doppelwurf","Küstengold","Pong Pioniere","Sturmflut","Wurfgeschwister","Becherhelden","Die Verlängerung","Möwenmodus","Deichkrone","Pong Pirates","Ballgefühl","Heimathafen","Die Durstigen","Cup Connection","Wurfanker"];
  let s = emptyTournament();
  s.teams = names.map((name,i) => ({ id: `t${String(i+1).padStart(2,"0")}`, name, p1: `Person ${i*2+1}`, p2: `Person ${i*2+2}`, group: GROUPS[Math.floor(i/4)] }));
  s.allowSelfScoring=true;
  s = startGroups(s);
  phaseMatches(s).slice(0,12).forEach((m,i) => { s = recordResult(s,m.id,{winner: i % 3 === 0 ? "b" : "a", cups: i % 6 + 1, overtime: i === 4}); });
  return s;
}
