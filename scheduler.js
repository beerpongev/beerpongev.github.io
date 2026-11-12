/** Deterministische Tischvergabe aus unveränderlichen Paarungen + Ereignissen.
 * Mitspieler dürfen nur ein geprüftes Ergebnisereignis anhängen. Sie erhalten
 * dadurch keine Schreibrechte auf Tische oder fremde Paarungen. Alle Geräte
 * berechnen aus denselben Ereignissen dieselbe Belegung, auch nach Neuladen.
 */
const cache = new WeakMap();
export const forgetDispatch=state=>cache.delete(state);
export function dispatch(state) {
  const remembered=cache.get(state);
  if (remembered && Date.now()<remembered.expires) return remembered.value;
  const matches = Object.fromEntries(Object.values(state.matches).map(m => [m.id, { ...m, table: 0, status: 'queued', queue: m.order, held: false }]));
  const finished = new Set(), statuses = {};
  let phase = 'setup', count = state.activeTableCount ?? state.tableCount, sequence = 0;
  const plans=[];
  const current = () => Object.values(matches).filter(m => m.phase === phase && !finished.has(m.id));
  const active = () => current().filter(m => m.status === 'playing');
  const eligible = m => !active().some(a => [a.a,a.b].some(t => t === m.a || t === m.b));
  function fill() {
    if (phase === 'setup' || phase === 'complete') return;
    const free = () => Array.from({length:count},(_,i)=>i+1).filter(t => statuses[t] !== 'preparing' && !active().some(m=>m.table===t));
    // Explizite Vormerkungen haben Vorrang vor noch nicht zugewiesenen Spielen.
    for (const table of free()) {
      const m = current().filter(m => m.table===table && m.status==='queued' && eligible(m)).sort((a,b)=>a.queue-b.queue)[0];
      if (m) m.status='playing';
    }
    for (const table of free()) {
      const m = current().filter(m => !m.table && !m.held && eligible(m)).sort((a,b)=>a.order-b.order)[0];
      if (m) { m.table=table; m.status='playing'; m.queue=++sequence; }
    }
  }
  function resize(next) {
    count=next;
    // Laufende Spiele dürfen auslaufen. Vormerkungen entfallender Tische gehen
    // zurück in die automatische Vergabe an weiterhin bespielbaren Tischen.
    for(const m of current())if(m.table>count && m.status!=='playing'){m.table=0;m.held=false;}
    fill();
  }
  function timers(now) {
    for(const plan of plans.filter(p=>p.status==='pending'&&p.when<=now).sort((a,b)=>a.when-b.when||a.sequence-b.sequence)){
      plan.status='executed';resize(plan.count);
    }
  }
  for (const event of state.dispatchEvents ?? []) {
    timers(event.at ?? 0);
    const m = matches[event.id];
    if (event.type === 'phase') {
      phase=event.phase; count=event.tables;
      for (let t=1;t<=32;t++) statuses[t]='free';
    } else if (event.type === 'tables') resize(event.count);
    else if (event.type === 'plan') plans.push({id:event.id,when:event.when,count:event.count,status:'pending',sequence:sequence++});
    else if (event.type === 'cancel-plan') {const p=plans.find(p=>p.id===event.id&&p.status==='pending');if(p)p.status='cancelled';}
    else if (event.type === 'score' && m) { finished.add(m.id); m.status='finished'; }
    else if (event.type === 'assign' && m && !finished.has(m.id)) {
      m.table=event.table; m.status='queued'; m.queue=++sequence; m.held=!event.table;
    } else if (event.type === 'release' && m && !finished.has(m.id)) {
      m.table=0;m.status='queued';m.held=false;
    } else if (event.type === 'start' && m && !finished.has(m.id)) {
      m.status='playing'; statuses[m.table]='free';
    } else if (event.type === 'status') {
      statuses[event.table]=event.status;
      for (const game of active()) if (game.table===event.table) game.status='queued';
    }
    fill();
  }
  timers(Date.now());
  const expires=Math.min(Infinity,...plans.filter(p=>p.status==='pending').map(p=>p.when));
  const value={matches,statuses,count,plans}; cache.set(state,{value,expires}); return value;
}
