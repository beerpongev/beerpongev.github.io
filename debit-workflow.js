/** Bankabgleich: Cent-Beträge, explizite Jahresaufteilung und keine Zuordnung anhand der Vereins-IBAN. */
import {amountCents,validDate,validYear,bankKind} from './contributions.js';
import {nameKey,fullName} from './registration.js';
export function debitAllocations(item,year){
 const list=(item.allocations??[{year:String(year),amountCents:item.amountCents}]).map(a=>({year:String(a.year),amountCents:a.amountCents}));
 if(!list.length||list.length>31||new Set(list.map(a=>a.year)).size!==list.length||list.some(a=>!validYear(a.year)||!Number.isInteger(a.amountCents)||a.amountCents<=0||a.amountCents>100000)||list.reduce((n,a)=>n+a.amountCents,0)!==item.amountCents)throw Error('Die Jahresaufteilung des Exports ist ungültig.');return list;
}
/** Geometrische Lesereihenfolge hält auch über Seiten umgebrochene Aufträge zusammen. */
export function parseScheduledDebitPages(pages){
 const orders=[],counts=new Set();let current=null,totalCents=null,summary=false;
 const finish=()=>{if(!current)return;if(!current.name||!validDate(current.date)||!Number.isInteger(current.amountCents)||current.amountCents<=0)throw Error('Auftrag '+(orders.length+1)+' wurde nicht vollständig erkannt (Name, Datum oder Betrag fehlt).');orders.push(current);current=null;};
 for(const page of pages){
  const lines=[];for(const item of [...page.items].filter(i=>i.text?.trim()&&i.y>25).sort((a,b)=>Math.abs(b.y-a.y)>2?b.y-a.y:a.x-b.x)){let line=lines.find(l=>Math.abs(l.y-item.y)<=2);if(!line){line={y:item.y,parts:[]};lines.push(line);}line.parts.push(item);}
  for(const line of lines.sort((a,b)=>b.y-a.y)){
   const text=line.parts.sort((a,b)=>a.x-b.x).map(i=>i.text).join(' ').replace(/\s+/g,' ').trim(),count=text.match(/^(\d+) Termin[- ]Aufträge\b/i);if(count)counts.add(+count[1]);
   if(/^Summe Gutschriften/i.test(text)){finish();summary=true;const m=text.match(/([\d.]+,\d{2})\s*EUR\b/);if(m)totalCents=amountCents(m[1]);continue;}
   if(summary){if(totalCents===null&&/^[\d.]+,\d{2}\s*EUR$/.test(text))totalCents=amountCents(text);continue;}
   const start=text.match(/^Basis[- ]Einzellastschrift\s+(.+)$/i);
   if(start){finish();current={name:start[1].trim(),date:'',amountCents:null,page:page.number};continue;}
   if(!current)continue;
   if(/^\d{2}\.\d{2}\.20\d{2}$/.test(text)){const [d,m,y]=text.split('.');if(current.date)throw Error('Mehrere Termine für denselben Auftrag erkannt.');current.date=`${y}-${m}-${d}`;}
   else if(/([\d.]+,\d{2})\s*EUR$/.test(text)){if(current.amountCents!==null)throw Error('Mehrere Beträge für denselben Auftrag erkannt.');current.amountCents=amountCents(text.match(/([\d.]+,\d{2})\s*EUR$/)[1]);}
  }
 }
 finish();if(!orders.length||counts.size!==1||!counts.has(orders.length))throw Error('Auftragszahl stimmt nicht mit der Druckansicht überein. Bitte eine vollständige Druckansicht mit Basis-Einzellastschriften wählen.');
 const sum=orders.reduce((n,r)=>n+r.amountCents,0);if(totalCents===null||sum!==totalCents)throw Error('Die Auftragssumme stimmt nicht mit „Summe Gutschriften“ überein. Es wurde nichts übernommen.');
 const seen=new Set();for(const order of orders){const key=JSON.stringify([nameKey(order.name),order.date,order.amountCents]);if(seen.has(key))throw Error('Gleicher Name, Termin und Betrag mehrfach in der PDF. Bitte mögliche doppelte Bankaufträge prüfen.');seen.add(key);}
 return{orders,totalCents,pageCount:pages.length};
}
export function scheduledDebitCandidates(order,runs,members,items=[]){
 return runs.filter(r=>!['cancelled','cancelling','preparing'].includes(r.status)).flatMap(run=>run.items.filter(item=>item.amountCents===order.amountCents).map(item=>{
  const member=members.find(m=>m.id===item.memberId),names=[item.bankName,item.name,member?.accountHolder,member&&fullName(member)].filter(Boolean),existing=items.find(i=>i.runId===run.id&&i.memberId===item.memberId);
  return{runId:run.id,memberId:item.memberId,name:item.name,amountCents:item.amountCents,allocations:debitAllocations(item,run.year),exact:names.some(n=>nameKey(n)===nameKey(order.name)),existing:existing?.bankOrder??null};
 })).sort((a,b)=>Number(b.exact)-Number(a.exact)||a.name.localeCompare(b.name,'de'));
}
export function debitSettlementSuggestions(row,items){
 const kind=row.amountCents<0?'return':'payment',principal=kind==='return'?(row.originalCents||Math.abs(row.amountCents)):row.amountCents;
 const eligible=items.filter(i=>kind==='return'?i.status==='paid':i.status==='scheduled'),match=i=>row.mandate&&row.mandate===i.mandate||row.iban&&row.iban===i.iban||[i.bankName,i.name].some(n=>nameKey(n)===nameKey(row.name));
 let proposals=eligible.filter(i=>i.amountCents===principal&&match(i)).map(i=>[i.id]);
 if(kind==='payment'&&['batch','payment'].includes(bankKind(row))){
  const near=eligible.filter(i=>{const days=(Date.parse(row.date)-Date.parse(i.bankOrder.date))/86400000;return days>=0&&days<=7;}),groups=new Map();
  for(const i of near){for(const key of ['all','date:'+i.bankOrder.date,'run:'+i.runId,'run-date:'+i.runId+':'+i.bankOrder.date]){if(!groups.has(key))groups.set(key,[]);groups.get(key).push(i);}}
  for(const group of groups.values())if(group.reduce((n,i)=>n+i.amountCents,0)===principal)proposals.push(group.map(i=>i.id));
 }
 const unique=[...new Map(proposals.map(ids=>[ids.slice().sort().join('|'),ids])).values()];return{kind,eligible,proposals:unique,selected:unique.length===1?unique[0]:[]};
}
