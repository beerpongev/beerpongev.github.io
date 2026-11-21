/** Private Beitragslogik. Keine Bankverbindung, kein Zahlungsauftrag; Beträge immer in Cent. */
import {annualFee} from './pricing.js';
import {fullName,nameKey} from './registration.js';
import {validDate,joinedDate,beforeEntryYear} from './dates.js';
export {validDate} from './dates.js';
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
 const fee=has?800:annualFee(year),beforeEntry=beforeEntryYear(member.joined,year);
 let status=!member.active||beforeEntry?'notdue':'open';
 if(!has&&member.active&&!beforeEntry&&fee===0)status='waived';
 if(has&&!beforeEntry)status=greens.has(color)?'paid':reds.has(color)?'open':'review';
 return{memberId:member.id,year:String(year),dueCents:['notdue','waived'].includes(status)?0:fee,paidCents:status==='paid'?Math.max(fee,amount??0):0,status,method:has?'excel':'manual',date:'',note:has?`Excel: ${value||'leer'}${color?' · '+color:''}`:'',revision:-1,legacy:has,value,color};
}
export function contributionFor(member,year,entries=[]){return entries.find(r=>r.memberId===member.id)??legacyContribution(member,year);}
export const REVIEW_COLUMNS=['Format','Mitglied-ID','Mitgliedsnummer','Vorname','Nachname','Beitragsjahr','Status bisher','Soll EUR','Bezahlt bisher EUR','Offen EUR','Excel-Original','Excel-Farbe','Neuer Status','Bezahlt EUR','Zahlungsdatum','Zahlungsart','Neue Notiz','Pruefstand'];
const reviewAmount=cents=>(cents/100).toFixed(2).replace('.',',');
const reviewSafe=value=>/^[=+\-@'\t\r]/.test(String(value??''))?"'"+value:String(value??'');
const reviewCell=value=>'"'+reviewSafe(value).replace(/"/g,'""')+'"';
export function contributionReviewSnapshot(member,c){
 return JSON.stringify({memberId:member.id,year:c.year,revision:c.revision,member:[member.number,member.firstName,member.lastName,member.active,member.joined,member.feeHistory?.[c.year]??'',member.feeColors?.[c.year]??''],contribution:normalizeContribution(c)});
}
function reviewOriginal(member,c){return['beerpong-contributions-v1',member.id,member.number,member.firstName,member.lastName,c.year,contributionStates[c.status],reviewAmount(c.dueCents),reviewAmount(c.paidCents),reviewAmount(Math.max(0,c.dueCents-c.paidCents)),c.value??'',c.color??''];}
/** Private Arbeitsdatei: kein Bankauftrag, keine Bank- oder Kontaktdaten. */
export function exportContributionReview(members,byYear,{from,to}){
 if(!validYear(from)||!validYear(to)||+from>+to||+to-+from>30)throw Error('Bitte einen Zeitraum von höchstens 31 Beitragsjahren wählen.');
 const lines=[REVIEW_COLUMNS.map(reviewCell).join(';')];let count=0;
 for(let y=+from;y<=+to;y++)for(const m of members.slice().sort((a,b)=>a.firstName.localeCompare(b.firstName,'de')||a.lastName.localeCompare(b.lastName,'de'))){
  const c=contributionFor(m,String(y),byYear[String(y)]??[]),documented=c.revision>=0||Object.hasOwn(m.feeHistory??{},y)||Object.hasOwn(m.feeColors??{},y);
  if(!documented&&!joinedDate(m.joined))continue;
  if(!['open','review','returned','pending'].includes(c.status)||c.dueCents<=c.paidCents)continue;
  lines.push([...reviewOriginal(m,c),'','','','','',contributionReviewSnapshot(m,c)].map(reviewCell).join(';'));count++;
 }
 return{csv:'\uFEFF'+lines.join('\r\n')+'\r\n',count,filename:'BEITRAEGE-PRUEFEN-'+from+'-'+to+'.csv'};
}
export function readContributionReview(text){
 const table=String(text).includes(';')?parseCSV(text,';'):parseCSV(text,','),decode=v=>v.startsWith("'")?v.slice(1):v;
 if(!table.length||table[0].length!==REVIEW_COLUMNS.length||table[0].some((h,i)=>h!==REVIEW_COLUMNS[i]))throw Error('Bitte die exportierte Beitrags-Prüfdatei mit unveränderten Spalten hochladen.');
 if(table.length>10001)throw Error('Höchstens 10.000 Beitragszeilen pro Datei.');
 const seen=new Set();let duplicate=false;const parsed=table.slice(1).map((values,index)=>{
  const line=index+2;try{
   const v=values.map(decode);if(v.length!==REVIEW_COLUMNS.length)throw Error('Spaltenzahl stimmt nicht.');
   const snapshot=JSON.parse(v[17]),key=v[1]+'/'+v[5];if(v[0]!=='beerpong-contributions-v1'||snapshot.memberId!==v[1]||snapshot.year!==v[5]||!validYear(v[5])||!Number.isInteger(snapshot.revision)||snapshot.revision< -1||!Array.isArray(snapshot.member)||snapshot.member.length!==7)throw Error('Prüfstand oder Kennung ungültig.');
   if(seen.has(key)){duplicate=true;throw Error('Mitglied und Jahr sind doppelt enthalten.');}seen.add(key);
   const before=normalizeContribution(snapshot.contribution),m={id:v[1],number:snapshot.member[0],firstName:snapshot.member[1],lastName:snapshot.member[2]};
   const originals=reviewOriginal(m,{...before,year:v[5],value:v[10],color:v[11]});
   if(v.slice(0,12).some((cell,i)=>cell!==String(originals[i]??'')))throw Error('Originalspalten bitte unverändert lassen.');
   const action=v[12].trim(),edits=v.slice(13,17).some(s=>s.trim());if(!action&&!edits)return{line,memberId:v[1],year:v[5],skip:true};
   const status=Object.keys(contributionStates).find(k=>nameKey(k)===nameKey(action)||nameKey(contributionStates[k])===nameKey(action));if(!status)throw Error('Neuer Status: Bezahlt, Offen, Prüfen, Rücklastschrift, Einzug vorgemerkt, Beitragsfrei oder Nicht fällig eintragen.');
   const zero=['waived','notdue'].includes(status),paid=v[13].trim()?amountCents(v[13]):zero?0:status==='paid'?Math.max(before.dueCents,before.paidCents):before.paidCents;
   if(paid===null)throw Error('Bezahlt EUR ist kein gültiger Betrag.');
   const date=v[14].trim()?bankDate(v[14]):before.date;if(date===null)throw Error('Zahlungsdatum nicht erkannt.');
   const method=v[15].trim()?Object.keys(contributionMethods).find(k=>nameKey(k)===nameKey(v[15])||nameKey(contributionMethods[k])===nameKey(v[15])):'manual';
   if(!method)throw Error('Zahlungsart: Manuell, Lastschrift, Überweisung, Bar oder Excel-Übernahme.');
   const extra=v[16].trim(),note=extra?[before.note,extra].filter(Boolean).join('\n'):before.note;if(note.length>1000)throw Error('Die kombinierte Notiz ist länger als 1000 Zeichen.');
   const desired=normalizeContribution({...before,status,paidCents:paid,dueCents:zero?0:before.dueCents,date,method,note});
   return{line,memberId:v[1],year:v[5],name:m.firstName+' '+m.lastName,snapshot:v[17],desired};
  }catch(error){return{line,error:'Zeile '+line+': '+error.message};}
 });if(duplicate)throw Error('Mitglied und Beitragsjahr sind doppelt enthalten. Bitte die Dubletten in der Datei entfernen.');return parsed;
}
export function planContributionReview(rows,members,byYear){
 return rows.map(row=>{if(row.error||row.skip)return row;const member=members.find(m=>m.id===row.memberId);if(!member)return{...row,error:'Mitglied nicht mehr vorhanden.'};
  const current=contributionFor(member,row.year,byYear[row.year]??[]);
  if(JSON.stringify(normalizeContribution(current))===JSON.stringify(row.desired))return{...row,already:true};
  return contributionReviewSnapshot(member,current)===row.snapshot?{...row,before:current}:{...row,error:'Zwischenzeitlich geändert. Bitte aktuellen Stand neu exportieren und prüfen.'};
 });
}
export function normalizeContribution(input){
 const dueCents=Number(input.dueCents),paidCents=Number(input.paidCents),status=String(input.status),method=String(input.method??'manual'),date=String(input.date??'');
 if(!Number.isInteger(dueCents)||dueCents<0||dueCents>100000||!Number.isInteger(paidCents)||paidCents<0||paidCents>100000||!Object.hasOwn(contributionStates,status)||!Object.hasOwn(contributionMethods,method))throw Error('Beitragsdaten sind ungültig.');
 if(status==='paid'&&(dueCents<=0||paidCents<dueCents))throw Error('Für „Bezahlt“ muss mindestens der Jahresbeitrag erfasst sein.');
 if(['waived','notdue'].includes(status)&&(dueCents!==0||paidCents!==0))throw Error('Bei beitragsfrei oder nicht fällig müssen Soll und Zahlung 0 € sein.');
 if(['open','pending','returned','review'].includes(status)&&(dueCents<=0||paidCents>=dueCents))throw Error('Offene Beiträge benötigen ein positives Rest-Soll.');
 if(date&&!validDate(date))throw Error('Bitte ein gültiges Buchungsdatum eingeben.');
 return{dueCents,paidCents,status,method,date,note:String(input.note??'').trim().slice(0,1000)};
}
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
 return normalizeContribution({...current,paidCents,status:paidCents>=current.dueCents?'paid':kind==='return'?'returned':'open',method:kind==='return'||/lastschrift/i.test(row.bookingText??'')?'debit':'transfer',date:row.date});
}
