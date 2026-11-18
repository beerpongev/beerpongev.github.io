/** Private Beitragslogik. Keine Bankverbindung, kein Zahlungsauftrag; Beträge immer in Cent. */
import {fullName,nameKey} from './registration.js';
export const contributionStates={open:'Offen',pending:'Einzug vorgemerkt',paid:'Bezahlt',returned:'Rücklastschrift',review:'Prüfen',waived:'Beitragsfrei',notdue:'Nicht fällig'};
export const contributionMethods={manual:'Manuell',debit:'Lastschrift',transfer:'Überweisung',cash:'Bar',excel:'Excel-Übernahme'};
export const validYear=year=>/^20\d{2}$/.test(String(year));
export const currentFeeYear=()=>String(new Date().getFullYear());
const greens=new Set(['#B6D7A8','#00FF00','#93C47D']),reds=new Set(['#FF0000','#F4CCCC']);
export function amountCents(value){
 let s=String(value??'').trim().replace(/[€\s\u00a0]/g,'').replace(/EUR/ig,'').replace(/−/g,'-');
 if(!s)return null;if(s.includes(','))s=s.replace(/\./g,'').replace(',','.');
 if(!/^[+-]?\d+(?:\.\d{1,2})?$/.test(s))return null;const n=Math.round(Number(s)*100);return Number.isSafeInteger(n)?n:null;
}
export function legacyContribution(member,year){
 if(!validYear(year))throw Error('Ungültiges Beitragsjahr.');
 const value=String(member.feeHistory?.[year]??''),color=String(member.feeColors?.[year]??'').toUpperCase(),has=Object.hasOwn(member.feeHistory??{},year)||Object.hasOwn(member.feeColors??{},year),amount=amountCents(value);
 const joined=String(member.joined??'').match(/^((?:19|20)\d{2})-/)?.[1];
 let status=!member.active||joined&&Number(year)<Number(joined)?'notdue':'open';
 if(has)status=greens.has(color)?'paid':reds.has(color)?'open':'review';
 return{memberId:member.id,year:String(year),dueCents:status==='notdue'?0:800,paidCents:status==='paid'?Math.max(800,amount??0):0,status,method:has?'excel':'manual',date:'',note:has?`Excel: ${value||'leer'}${color?' · '+color:''}`:'',revision:-1,legacy:has,value,color};
}
export function contributionFor(member,year,entries=[]){return entries.find(r=>r.memberId===member.id)??legacyContribution(member,year);}
export function normalizeContribution(input){
 const dueCents=Number(input.dueCents),paidCents=Number(input.paidCents),status=String(input.status),method=String(input.method??'manual'),date=String(input.date??'');
 if(!Number.isInteger(dueCents)||dueCents<0||dueCents>100000||!Number.isInteger(paidCents)||paidCents<0||paidCents>100000||!Object.hasOwn(contributionStates,status)||!Object.hasOwn(contributionMethods,method))throw Error('Beitragsdaten sind ungültig.');
 if(status==='paid'&&(dueCents<=0||paidCents<dueCents))throw Error('Für „Bezahlt“ muss mindestens der Jahresbeitrag erfasst sein.');
 if(['waived','notdue'].includes(status)&&(dueCents!==0||paidCents!==0))throw Error('Bei beitragsfrei oder nicht fällig müssen Soll und Zahlung 0 € sein.');
 if(['open','pending','returned','review'].includes(status)&&(dueCents<=0||paidCents>=dueCents))throw Error('Offene Beiträge benötigen ein positives Rest-Soll.');
 if(date&&!validDate(date))throw Error('Bitte ein gültiges Buchungsdatum eingeben.');
 return{dueCents,paidCents,status,method,date,note:String(input.note??'').trim().slice(0,1000)};
}
export function validDate(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const d=new Date(value+'T12:00:00Z');return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value;}
export function bankDate(value){const s=String(value??'').trim(),m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);const date=m?`${m[3].length===2?'20'+m[3]:m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:s;return validDate(date)?date:null;}
export function parseCSV(text,delimiter){
 const rows=[];let row=[],cell='',quoted=false;const s=String(text).replace(/^\uFEFF/,'');
 for(let i=0;i<s.length;i++){const c=s[i];if(c==='"'){if(quoted&&s[i+1]==='"'){cell+='"';i++;}else if(!quoted&&cell==='')quoted=true;else if(quoted)quoted=false;else cell+=c;}
  else if(c===delimiter&&!quoted){row.push(cell);cell='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&s[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell='';}else cell+=c;
 }if(quoted)throw Error('Die CSV-Datei enthält ein nicht geschlossenes Anführungszeichen.');row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
export function readBankCSV(text){
 const choices=[';','\t',','].map(delimiter=>({delimiter,rows:parseCSV(text,delimiter)}));
 const score=c=>c.rows.slice(0,30).reduce((n,r)=>Math.max(n,r.length),0);choices.sort((a,b)=>score(b)-score(a));const best=choices[0];if(!best.rows.length||score(best)<2)throw Error('Keine CSV-Tabelle mit mehreren Spalten erkannt.');
 const header=best.rows.findIndex(r=>r.some(v=>/betrag|amount/i.test(v))&&r.some(v=>/buchung|datum|date/i.test(v)));return{...best,header:Math.max(0,header)};
}
export function suggestBankColumns(headers){
 const pick=pattern=>headers.findIndex(v=>pattern.test(nameKey(v)));return{date:pick(/buchungstag|buchungsdatum|booking date|^datum$|^date$/),amount:pick(/^betrag$|^amount$/),name:pick(/zahlungspflichtig|beg.*nstigt|auftraggeber|empfanger|name|counterparty/),iban:pick(/iban|kontonummer/),purpose:pick(/verwendungszweck|beschreibung|purpose|reference text/),reference:pick(/kundenreferenz|end to end|transaktions id|transaction id|buchungsreferenz/),currency:pick(/waehrung|wahrung|currency/),bookingText:pick(/^buchungstext$|booking text/),mandate:pick(/mandatsreferenz|mandate/),original:pick(/ursprungsbetrag/),info:pick(/^info$/)};
}
export async function bankRows(rows,header,mapping){
 if(Number(mapping.date)<0||Number(mapping.amount)<0)throw Error('Bitte Datum und Betrag zuordnen.');const result=[];
 for(const [index,row]of rows.slice(header+1).entries()){
  const get=key=>Number(mapping[key])>=0?String(row[Number(mapping[key])]??'').trim():'';if(row.every(v=>!v.trim()))continue;
  const date=bankDate(get('date')),amount=amountCents(get('amount'));if(!date||amount===null){result.push({line:header+index+2,error:'Datum oder Betrag nicht lesbar.'});continue;}
  if(get('currency')&&!/^(EUR|€)$/i.test(get('currency'))){result.push({line:header+index+2,error:'Nur EUR-Buchungen sind unterstützt.'});continue;}
  if(get('info')&&!/gebucht|booked/i.test(get('info'))){result.push({line:header+index+2,error:'Kein gebuchter Umsatz.'});continue;}
  if(amount===0)continue;
  const entry={date,amountCents:amount,name:get('name').slice(0,200),iban:get('iban').replace(/\s+/g,'').toUpperCase().slice(0,80),purpose:get('purpose').slice(0,1000),reference:get('reference').slice(0,200),bookingText:get('bookingText').slice(0,200),mandate:get('mandate').slice(0,80),originalCents:Math.abs(amountCents(get('original'))??0)};
  const canonical=JSON.stringify(entry),hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical));entry.id=Array.from(new Uint8Array(hash),n=>n.toString(16).padStart(2,'0')).join('');result.push({...entry,line:header+index+2});
 }return result;
}
export function paymentSuggestions(row,members){
 const purpose=nameKey(row.purpose),name=nameKey(row.name),iban=String(row.iban??'').replace(/\s/g,'').toUpperCase();
 return members.map(member=>{const full=nameKey(fullName(member)),reversed=nameKey(`${member.lastName} ${member.firstName}`),memberIban=String(member.iban??'').replace(/\s/g,'').toUpperCase();const match=row.mandate&&member.mandate===row.mandate?'Mandat':iban&&memberIban===iban?'IBAN':name===full||name===reversed?'Name':purpose.includes(full)&&full.length>5?'Verwendungszweck':'';return{member,match};}).filter(x=>x.match).sort((a,b)=>Number(['Mandat','IBAN'].includes(b.match))-Number(['Mandat','IBAN'].includes(a.match)));
}
export function bankKind(row){const text=nameKey(row.bookingText??'');return/sammel|sammler/.test(text)?'batch':/entgelt|gebuhr|zins/.test(text)?'other':row.amountCents<0&&/rueck|ruck|return/.test(text)?'return':row.amountCents>0?'payment':'other';}
export function applyBankPayment(current,row,kind){
 if(!['payment','return','evidence'].includes(kind)||!Number.isInteger(row.amountCents)||row.amountCents===0||Math.abs(row.amountCents)>10000000||!validDate(row.date))throw Error('Ungültige Buchung.');
 if(['payment','evidence'].includes(kind)&&row.amountCents<=0||kind==='return'&&row.amountCents>=0)throw Error('Zahlungseingänge müssen positiv, Rücklastschriften negativ sein.');
 if(kind==='evidence'){if(current.status!=='paid')throw Error('Ein Zahlungsnachweis ohne neue Gutschrift benötigt einen bereits bezahlten Beitrag.');return normalizeContribution({...current,date:current.date>row.date?current.date:row.date});}
 if(current.date&&row.date<current.date)throw Error('Diese Buchung liegt vor dem letzten Beitragsstand. Bitte zuerst die Reihenfolge und das Beitragsjahr prüfen.');
 if(current.dueCents<=0)throw Error('Für dieses Mitglied ist kein Beitrag fällig. Bitte zuerst das Jahres-Soll prüfen.');
 const paidCents=kind==='return'?Math.max(0,current.paidCents-(row.originalCents||Math.abs(row.amountCents))):current.paidCents+row.amountCents;
 return normalizeContribution({...current,paidCents,status:kind==='return'?'returned':paidCents>=current.dueCents?'paid':'open',method:kind==='return'||/lastschrift/i.test(row.bookingText??'')?'debit':'transfer',date:row.date});
}
