/** Sparkassen-Vorlagenexport gemäß bereitgestellter CSV; löst keinen Bankauftrag aus. */
import {fullName} from './registration.js';
import {validYear,validDate,contributionFor} from './contributions.js';
import {joinedDate,beforeEntryYear} from './dates.js';
export {joinedDate} from './dates.js';
export const SPARKASSE_COLUMNS=['URSPRUNG','NAME','KONTO','IBAN','BLZ','BIC','BETRAG','VERW_ZWECK','MANDATS_REF','MANDATS_REF_DATUM'];
export const DEFAULT_DEBIT_PURPOSE='Beerpong Academy e.V. Mitgliedsbeitrag';
export function mandateYear(joined){const date=joinedDate(joined);if(!date||!validYear(date.slice(0,4)))throw Error('Für die automatische Mandatsreferenz wird ein gültiges Eintrittsdatum benötigt.');return date.slice(0,4);}
export function mandateSequence(members){
 return members.reduce((max,m)=>{const match=String(m.mandate??'').match(/^20\d{2}\/(\d+)$/),reference=match?Number(match[1]):0,number=/^\d+$/.test(String(m.number??''))?Number(m.number):0;return Math.max(max,Number.isSafeInteger(reference)?reference:0,Number.isSafeInteger(number)?number:0);},119);
}
export function nextMandate(year,seed,counter=0){
 if(!validYear(year))throw Error('Ungültiges Eintrittsjahr.');const number=Math.max(119,Number(seed)||0,Number(counter)||0)+1;if(!Number.isSafeInteger(number)||number>99999999)throw Error('Die fortlaufende Mandatsnummer ist zu groß.');return{year:String(year),number,reference:`${year}/${number}`};
}
const millis=value=>value?.toMillis?.()??(value?.seconds!==undefined?value.seconds*1000:typeof value==='number'?value:0);
export function bankRisk(member,returns=[]){
 const reviewed=millis(member.bankReviewedAt);return member.bankStatus==='unclear'||returns.some(r=>r.memberId===member.id&&(!reviewed||millis(r.createdAt)>reviewed));
}
export function validIBAN(value){
 const iban=String(value??'').replace(/\s+/g,'').toUpperCase();if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)||iban.startsWith('DE')&&iban.length!==22)return false;
 let remainder=0;for(const c of iban.slice(4)+iban.slice(0,4)){const digits=/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c;for(const n of digits)remainder=(remainder*10+Number(n))%97;}return remainder===1;
}
const dateDE=iso=>`${iso.slice(8,10)}.${iso.slice(5,7)}.${iso.slice(0,4)}`;
const csvCell=value=>/[;"\r\n]/.test(String(value))?'"'+String(value).replace(/"/g,'""')+'"':String(value);
export function debitPurpose(value,year){
 if(!validYear(year))throw Error('Bitte ein gültiges Beitragsjahr auswählen.');
 const base=String(value??'').trim().replace(/(?:\s*[-–/]?\s*)20\d{2}\s*$/,'').trim(),purpose=base+' '+year;
 if(!base||purpose.length>140||/[\r\n\x00-\x1f]/.test(base)||/^[=+@-]/.test(base))throw Error('Bitte einen Verwendungszweck mit höchstens 140 Zeichen einschließlich Jahreszusatz eingeben.');return purpose;
}
export function combinedDebitPurpose(value,years){
 const ordered=[...new Set(years.map(String))].sort();if(!ordered.length||ordered.some(y=>!validYear(y)))throw Error('Ungültige Beitragsjahre.');
 const base=String(value??'').trim().replace(/\s+(?:[-–]\s*)?20\d{2}(?:\s*\/\s*20\d{2})*\s*$/,'').trim(),purpose=base+' '+ordered.join('/');
 if(!base||purpose.length>140||/[\r\n\x00-\x1f]/.test(base)||/^[=+@-]/.test(base))throw Error('Verwendungszweck einschließlich aller Beitragsjahre darf höchstens 140 Zeichen haben.');return purpose;
}
/** Ein Mitglied pro Bankzeile, mit getrennt nachvollziehbaren offenen Jahresbeträgen. */
export function prepareCombinedDebitExport({members,byYear={},from,to,purpose=DEFAULT_DEBIT_PURPOSE,includeFormer=false,returns=[]}){
 if(!validYear(from)||!validYear(to)||+from>+to||+to-+from>30)throw Error('Bitte einen Zeitraum von höchstens 31 Jahren wählen.');
 const ids=new Set(),rows=[],issues=[],skipped=[],mandates=new Map(),states=[];
 for(const source of members.slice().sort((a,b)=>a.firstName.localeCompare(b.firstName,'de')||a.lastName.localeCompare(b.lastName,'de'))){
  if(!source.id||ids.has(source.id))throw Error('Mitgliedskennungen fehlen oder sind doppelt.');ids.add(source.id);
  const m={...source,bankStatus:bankRisk(source,returns)?'unclear':source.bankStatus};
  if(!m.active&&!includeFormer){skipped.push({id:m.id,name:fullName(m),reason:'Ehemaliges Mitglied'});continue;}
  const annual=[],errors=[];
  for(let y=+from;y<=+to;y++){
   const year=String(y),c=contributionFor(m,year,byYear[year]??[]),amount=c.dueCents-c.paidCents;states.push([m.id,year,c.revision??-1,c.status,c.dueCents,c.paidCents,m.bankStatus]);
   if(beforeEntryYear(m.joined,year)||['paid','waived','notdue'].includes(c.status)||amount<=0)continue;
   if(['pending','scheduled'].includes(c.status))continue;
   const report=prepareDebitExport({members:[m],entries:[c],year,purpose:DEFAULT_DEBIT_PURPOSE,includeFormer});
   if(report.issues.length)errors.push(...report.issues.flatMap(i=>i.errors.map(s=>year+': '+s)));
   annual.push(...report.rows.map(r=>({...r,year})));
  }
  if(!annual.length&&!errors.length){skipped.push({id:m.id,name:fullName(m),reason:'Keine offenen Beiträge im Zeitraum'});continue;}
  const mandate=String(m.mandate??'').trim();if(mandate){if(!mandates.has(mandate))mandates.set(mandate,[]);mandates.get(mandate).push(m.id);}
  let finalPurpose='';if(annual.length)try{finalPurpose=combinedDebitPurpose(purpose,annual.map(r=>r.year));}catch(error){errors.push(error.message);}
  const amountCents=annual.reduce((sum,r)=>sum+r.amountCents,0);if(annual.length&&(!Number.isSafeInteger(amountCents)||amountCents>100000))errors.push('Gesamtbetrag pro Mitglied überschreitet 1.000 €.');
  if(errors.length){issues.push({id:m.id,name:fullName(m),errors});continue;}
  const first=annual[0];rows.push({...first,years:annual.map(r=>r.year),allocations:annual.map(r=>({year:r.year,amountCents:r.amountCents})),amountCents,purpose:finalPurpose});
 }
 const duplicates=new Set([...mandates.values()].filter(ids=>ids.length>1).flat());
 const valid=rows.filter(r=>{if(!duplicates.has(r.memberId))return true;issues.push({id:r.memberId,name:r.memberName,errors:['Mandatsreferenz ist bei mehreren Mitgliedern in der Auswahl vergeben.']});return false;});
 const lines=[SPARKASSE_COLUMNS.join(';'),...valid.map(r=>['SEPA',r.name,'',r.iban,'','',reviewDebitAmount(r.amountCents),r.purpose,r.mandate,dateDE(r.mandateDate)].map(csvCell).join(';'))],csv='\uFEFF'+lines.join('\r\n')+'\r\n';
 return{year:String(to),from:String(from),to:String(to),includeFormer,purpose:combinedDebitPurpose(purpose,[to]).replace(new RegExp(' '+to+'$'),''),rows:valid,issues,skipped,totalCents:valid.reduce((sum,r)=>sum+r.amountCents,0),csv,filename:'Sparkasse_Lastschriften_'+from+'-'+to+'.csv',signature:JSON.stringify({csv,issues,skipped,states,includeFormer})};
}
const reviewDebitAmount=cents=>(cents/100).toFixed(2).replace('.',',');
export function debitExportYears(record){return[...new Set(record.items.flatMap(item=>item.years??[record.year]))].sort();}
export function overlappingDebitExports(records,report){
 return records.filter(record=>record.status!=='cancelled'&&record.items.some(item=>report.rows.some(row=>row.memberId===item.memberId&&(item.years??[record.year]).some(y=>(row.years??[report.year]).includes(y)))));
}
export function prepareDebitExport({members,entries=[],year,purpose=DEFAULT_DEBIT_PURPOSE,selectedIds=null,includeFormer=false}){
 const finalPurpose=debitPurpose(purpose,year),rows=[],issues=[],skipped=[],references=new Set();
 const chosen=selectedIds?new Set(selectedIds):null;
 for(const m of members){
  if(chosen&&!chosen.has(m.id))continue;const c=contributionFor(m,year,entries),amount=c.dueCents-c.paidCents;
  if(beforeEntryYear(m.joined,year)||!m.active&&!includeFormer||['paid','waived','notdue','pending','scheduled'].includes(c.status)||amount<=0){skipped.push({id:m.id,name:fullName(m),reason:beforeEntryYear(m.joined,year)?'Beitragsjahr liegt vor dem Eintrittsjahr':!m.active?'Ehemaliges Mitglied':'Beitrag erledigt, nicht fällig oder bereits im Einzug'});continue;}
  const errors=[],name=String(m.accountHolder||fullName(m)).trim(),iban=String(m.iban??'').replace(/\s+/g,'').toUpperCase(),mandate=String(m.mandate??'').trim(),date=joinedDate(m.joined);
  if(m.bankStatus==='unclear')errors.push('IBAN / Bankverbindung unklar: Export für alle Beitragsjahre gesperrt, bis der Vorstand die Bankverbindung geprüft und freigegeben hat.');
  if(!name||name.length>70||/[\r\n\x00-\x1f]/.test(name)||/^[=+@-]/.test(name))errors.push('Kontoinhaber fehlt oder ist nicht als Bankname verwendbar (maximal 70 Zeichen).');
  if(!validIBAN(iban))errors.push('IBAN fehlt oder Prüfziffer ist ungültig.');
  if(!mandate||mandate.length>35||!/^[A-Za-z0-9/+?:().,' -]+$/.test(mandate))errors.push('Mandatsreferenz fehlt oder ist ungültig (maximal 35 Zeichen).');
  if(mandate&&references.has(mandate))errors.push('Mandatsreferenz ist in der Auswahl doppelt.');if(mandate)references.add(mandate);
  if(!date)errors.push('Gültiges Eintrittsdatum für das Mandatsdatum fehlt.');
  if(c.status==='review')errors.push('Historischen Zahlungsstatus zuerst prüfen.');
  if(!Number.isInteger(amount)||amount<1||amount>100000)errors.push('Offener Beitrag ist ungültig.');
  if(errors.length){issues.push({id:m.id,name:fullName(m),errors});continue;}
  rows.push({memberId:m.id,memberName:fullName(m),name,iban,mandate,mandateDate:date,amountCents:amount,purpose:finalPurpose,status:c.status});
 }
 // Doppelte Referenzen dürfen auch den ersten Datensatz nicht im Export belassen.
 const duplicates=new Set(issues.filter(i=>i.errors.some(s=>s.includes('doppelt'))).map(i=>String(members.find(m=>m.id===i.id)?.mandate??'').trim()));
 const valid=rows.filter(r=>{if(!duplicates.has(r.mandate))return true;issues.push({id:r.memberId,name:r.memberName,errors:['Mandatsreferenz ist in der Auswahl doppelt.']});return false;});
 const lines=[SPARKASSE_COLUMNS.join(';'),...valid.map(r=>['SEPA',r.name,'',r.iban,'','',(r.amountCents/100).toFixed(2).replace('.',','),r.purpose,r.mandate,dateDE(r.mandateDate)].map(csvCell).join(';'))];
 return{year:String(year),includeFormer,purpose:finalPurpose,rows:valid,issues,skipped,totalCents:valid.reduce((n,r)=>n+r.amountCents,0),csv:'\uFEFF'+lines.join('\r\n')+'\r\n',filename:`Sparkasse_Lastschriftvorlagen_${year}.csv`};
}
