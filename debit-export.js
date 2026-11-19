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
export function prepareDebitExport({members,entries=[],year,purpose=DEFAULT_DEBIT_PURPOSE,selectedIds=null,includeFormer=false}){
 const finalPurpose=debitPurpose(purpose,year),rows=[],issues=[],skipped=[],references=new Set();
 const chosen=selectedIds?new Set(selectedIds):null;
 for(const m of members){
  if(chosen&&!chosen.has(m.id))continue;const c=contributionFor(m,year,entries),amount=c.dueCents-c.paidCents;
  if(beforeEntryYear(m.joined,year)||!m.active&&!includeFormer||['paid','waived','notdue'].includes(c.status)||amount<=0){skipped.push({id:m.id,name:fullName(m),reason:beforeEntryYear(m.joined,year)?'Beitragsjahr liegt vor dem Eintrittsjahr':!m.active?'Ehemaliges Mitglied':'Beitrag erledigt oder nicht fällig'});continue;}
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
 return{year:String(year),purpose:finalPurpose,rows:valid,issues,skipped,totalCents:valid.reduce((n,r)=>n+r.amountCents,0),csv:'\uFEFF'+lines.join('\r\n')+'\r\n',filename:`Sparkasse_Lastschriftvorlagen_${year}.csv`};
}
