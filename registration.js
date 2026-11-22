/** Reine Datenlogik für Anmeldung und private Mitgliederverwaltung. Beträge in Cent. */
import {memberNumber,phoneNumber} from './member-format.js';
import {DEFAULT_PRICES,normalizePrices,getActivePrices} from './pricing.js';
import {joinedDate,validDate} from './dates.js';
export const euro=cents=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
export const fullName=p=>`${p.firstName} ${p.lastName}`.trim();
export const nameKey=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();
const text=(value,max=120)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const need=(condition,message)=>{if(!condition)throw Error(message);};
export const defaultRegistrationSettings=()=>({capacity:32,confirmedCount:0,waitlistCount:0,nextSequence:0,open:false,revision:0,lastEntry:''});
export function calculateFees(players,draftBeer,prices=getActivePrices()){
 prices=normalizePrices(prices);
 need(players.length===2&&players.every(p=>typeof p.member==='boolean'),'Bitte den Mitgliedsstatus für beide Personen angeben.');
 const entryCents=players.reduce((sum,p)=>sum+(p.member?prices.entryMember:prices.entryGuest),0),beerCents=draftBeer?players.reduce((sum,p)=>sum+(p.member?prices.beerMember:prices.beerGuest),0):0;
 return{entryCents,beerCents,totalCents:entryCents+beerCents};
}
export function normalizePlayer(p,{board=false}={}){
 const firstName=text(p.firstName,60),lastName=text(p.lastName,60),email=text(p.email,254).toLowerCase();
 need(firstName&&lastName,'Bitte Vor- und Nachname für beide Personen eintragen.');
 need(typeof p.member==='boolean','Bitte den Mitgliedsstatus für beide Personen auswählen.');
 need(!email.includes('/'),'Bitte eine gültige E-Mail-Adresse ohne Schrägstrich verwenden.');
 need((board&&!email)||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Bitte eine gültige E-Mail-Adresse für beide Mitspieler eintragen.');
 return{firstName,lastName,email,member:p.member,claimedMember:board?!!p.claimedMember:p.member,verified:board?!!p.verified:false,memberId:board?text(p.memberId,80):'',...(board&&p.membershipFingerprint?{membershipFingerprint:text(p.membershipFingerprint,2000)}:{}),...(board&&p.personId?{personId:text(p.personId,128)}:{})};
}
export function normalizeRegistration(data,{board=false,allowMissingEmail=false}={}){
 const teamName=text(data.teamName,60),email=text(board?data.email:data.players?.[0]?.email,254).toLowerCase();
 need(teamName,'Bitte einen Teamnamen eintragen.');
 need((allowMissingEmail&&!email)||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Bitte eine gültige Kontakt-E-Mail eintragen.');
 need(Array.isArray(data.players)&&data.players.length===2,'Ein Team besteht aus zwei Personen.');
 const prices=normalizePrices(data.prices??getActivePrices());
 const players=data.players.map(p=>normalizePlayer(p,{board}));
 need(!players[0].email||!players[1].email||players[0].email!==players[1].email,'Bitte für jeden Mitspieler eine eigene E-Mail-Adresse verwenden.');
 need(nameKey(fullName(players[0]))!==nameKey(fullName(players[1])),'Bitte zwei unterschiedliche Personen eintragen.');
 need(typeof data.draftBeer==='boolean','Bitte die Bierauswahl angeben.');
 const paidCents=board?Number(data.paidCents??0):0;
 need(Number.isInteger(paidCents)&&paidCents>=0&&paidCents<=100000,'Der gezahlte Betrag ist ungültig.');
 return{teamName,email,players,draftBeer:data.draftBeer,prices,fees:calculateFees(players,data.draftBeer,prices),paidCents,notes:board?text(data.notes,1000):'',teamId:board?text(data.teamId,128):''};
}
export function normalizeMember(data){
 const firstName=text(data.firstName,60),lastName=text(data.lastName,60);need(firstName&&lastName,'Vor- und Nachname fehlen.');
 const feeHistory={};for(const [year,value]of Object.entries(data.feeHistory??{})){need(/^20\d{2}$/.test(year),'Ungültiges Beitragsjahr.');feeHistory[year]=text(value,120);}
 need(Object.keys(feeHistory).length<=50,'Zu viele Beitragsjahre.');
 const feeColors={};for(const[year,color]of Object.entries(data.feeColors??{})){need(/^20\d{2}$/.test(year)&&/^#[0-9A-Fa-f]{6}$/.test(color),'Ungültige Beitragsmarkierung.');feeColors[year]=color.toUpperCase();}need(Object.keys(feeColors).length<=50,'Zu viele Beitragsmarkierungen.');
 return{number:text(memberNumber(data.number),40),firstName,lastName,active:!!data.active,joined:joinedDate(data.joined)??text(data.joined,30),occupation:text(data.occupation,120),email:text(data.email,254),phone:text(phoneNumber(data.phone),80),iban:text(data.iban,80),mandate:text(data.mandate,80),notes:text(data.notes,1000),feeHistory,feeColors,birthDate:text(data.birthDate,10),street:text(data.street,120),postalCode:text(data.postalCode,20),city:text(data.city,100),bank:text(data.bank,120),accountHolder:text(data.accountHolder,120),accountUid:text(data.accountUid,128),applicationId:text(data.applicationId,128),...(data.personId?{personId:text(data.personId,128)}:{}),bankStatus:data.bankStatus==='unclear'?'unclear':'ok',bankNote:text(data.bankNote,1000),...(data.bankReviewedAt!=null?{bankReviewedAt:data.bankReviewedAt}:{})};
}
export const contactFields=['email','phone','street','postalCode','city','occupation'];
export function normalizeContact(data){
 const values=Object.fromEntries(contactFields.map(k=>[k,text(data[k],{email:254,phone:80,street:120,postalCode:20,city:100,occupation:120}[k])]));values.email=values.email.toLowerCase();
 need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email),'Bitte eine gültige Kontakt-E-Mail eingeben.');need(values.phone,'Bitte eine Telefonnummer eingeben.');return values;
}
export const profileFields=['firstName','lastName','birthDate',...contactFields,'iban','bank','accountHolder'];
export function profileValues(data){return Object.fromEntries(profileFields.map(k=>[k,String(data[k]??'')]));}
export function normalizeProfileChange(data){
 const member=normalizeMember(data),values={...profileValues(member),...normalizeContact(data)};
 values.iban=values.iban.replace(/\s/g,'').toUpperCase();
 need(!values.birthDate||validDate(values.birthDate),'Bitte ein gültiges Geburtsdatum eingeben.');
 if(values.iban){let rest=0;need(/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(values.iban),'Bitte eine gültige IBAN eingeben.');for(const c of values.iban.slice(4)+values.iban.slice(0,4))for(const digit of (/[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c))rest=(rest*10+Number(digit))%97;need(rest===1,'Die IBAN-Prüfziffer stimmt nicht.');}
 return values;
}
export function memberProfile(member,revision=0){const m=normalizeMember(member);return{memberId:member.id,number:m.number,active:m.active,...profileValues(m),revision};}
export function normalizeApplication(data){
 const keys=['firstName','lastName','birthDate','occupation','street','postalCode','city','email','phone','applicationPlace','applicationDate','accountHolder','bank','iban','debitPlace','debitDate'];
 const result=Object.fromEntries(keys.map(k=>[k,text(data[k],{email:254,phone:80,firstName:60,lastName:60,postalCode:20,birthDate:10,applicationDate:10,debitDate:10,iban:80}[k]??120)]));
 if(data.requestedJoined){need(validDate(data.requestedJoined),'Bitte ein gültiges gewünschtes Eintrittsdatum eingeben.');result.requestedJoined=data.requestedJoined;}
 need(result.firstName&&result.lastName,'Vor- und Nachname fehlen.');normalizeContact(result);need(/^\d{4}-\d{2}-\d{2}$/.test(result.birthDate),'Das Geburtsdatum fehlt.');return result;
}
export function applicationMember(data,{id,existing,number,joined,applicationId}){
 const a=normalizeApplication(data),m=normalizeMember({...existing,...a,number:number??existing?.number??'',joined,active:true,accountUid:existing?.accountUid??'',applicationId});
 return{id,...m};
}
export function membershipSuggestions(person,members){
 const key=nameKey(fullName(person)),surname=nameKey(person.lastName),first=nameKey(person.firstName);
 const email=String(person.email??'').trim().toLowerCase();
 return members.map(m=>{const exact=!!key&&nameKey(fullName(m))===key,mail=!!email&&email===String(m.email??'').trim().toLowerCase(),linked=!!person.memberId&&person.memberId===m.id;return{member:m,exact,score:linked?110:mail?100:exact?90:surname&&nameKey(m.lastName)===surname?60:first&&nameKey(m.firstName)===first&&surname&&nameKey(m.lastName).startsWith(surname.slice(0,3))?40:0,reason:linked?'Bereits zugeordnet':mail?'Gleiche E-Mail-Adresse':exact?'Gleicher Vor- und Nachname':'Ähnlicher Name'};}).filter(x=>x.score>0).sort((a,b)=>Number(b.member.active)-Number(a.member.active)||b.score-a.score||a.member.firstName.localeCompare(b.member.firstName,'de')||a.member.lastName.localeCompare(b.member.lastName,'de')).slice(0,6);
}
export function membershipReviewSignature(person,members){
 return members.filter(m=>m.active&&((person.email&&m.email&&m.email.toLowerCase()===person.email.toLowerCase())||nameKey(fullName(m))===nameKey(fullName(person)))).map(m=>m.id).sort().join('|');
}
export function needsMembershipReview(person,members){
 if(!person.verified)return true;
 if(person.member)return !person.memberId||!members.some(m=>m.id===person.memberId&&m.active);
 return membershipReviewSignature(person,members)!==(person.membershipFingerprint??'');
}
export function reconcileSettings(settings,before,after){
 const next={...settings,revision:settings.revision+1,lastEntry:after?.id??''};
 for(const [status,key]of [['confirmed','confirmedCount'],['waitlist','waitlistCount']])next[key]+=(after?.status===status?1:0)-(before?.status===status?1:0);
 if(!before&&after)next.nextSequence++;
 need(next.confirmedCount>=0&&next.confirmedCount<=next.capacity,'Alle Startplätze sind vergeben.');
 need(next.waitlistCount>=0,'Die Warteliste wurde inzwischen geändert.');
 return next;
}
export function validatePrivateImport(data){
 need(data?.format==='beerpong-private-import-v1'&&data.tournamentId==='main','Bitte die vorbereitete private Importdatei für das 15. Turnier auswählen.');
 need(Array.isArray(data.members)&&data.members.length<=2000&&Array.isArray(data.registrations)&&data.registrations.length<=500,'Die Importdatei ist ungültig oder zu groß.');
 const ids=new Set(),regIds=new Set();
 const members=data.members.map(m=>{need(/^[a-zA-Z0-9_-]{1,80}$/.test(m.id)&&!ids.has(m.id),'Doppelte oder ungültige Mitglieds-ID.');ids.add(m.id);return{id:m.id,...normalizeMember(m)};});
 const registrations=data.registrations.map(r=>{need(/^[a-zA-Z0-9_-]{1,128}$/.test(r.id)&&!regIds.has(r.id),'Doppelte oder ungültige Anmelde-ID.');regIds.add(r.id);return{id:r.id,...normalizeRegistration(r,{board:true,allowMissingEmail:true}),sourceDate:text(r.sourceDate,30)};});
 need(Array.isArray(data.archiveLineups??[])&&(data.archiveLineups??[]).length<=500,'Zu viele historische Spielerplätze.');
 const seenSlots=new Set();
 const archiveLineups=(data.archiveLineups??[]).map(p=>{
  const dates={'2022':'2022-12-30','2023':'2023-12-29','2024':'2024-12-27','2025':'2025-12-27'},edition=Number(p.year)-2011;
  need(/^hist-[a-f0-9]{20}$/.test(p.assignmentId)&&p.tournamentId===`official-${edition}-${p.year}`&&p.date===dates[p.year]&&p.edition===edition&&[1,2].includes(p.slot),'Ungültige historische Zuordnung.');
  need(typeof p.personId==='string'&&/^[a-zA-Z0-9_-]{1,128}$/.test(p.personId)&&typeof p.teamName==='string'&&p.teamName.length>0&&p.teamName.length<=100,'Ungültige Person oder historisches Team.');
  need([p.firstName,p.lastName].every(s=>typeof s==='string'&&s.trim().length>0&&s.length<=60),'Historischer Spielername fehlt.');
  const key=p.assignmentId+'__'+p.slot;need(!seenSlots.has(key),'Doppelter historischer Teamplatz.');seenSlots.add(key);
  return{assignmentId:p.assignmentId,tournamentId:p.tournamentId,teamName:p.teamName,year:p.year,date:p.date,edition,slot:p.slot,firstName:p.firstName.trim(),lastName:p.lastName.trim(),personId:p.personId};
 });
 need(Array.isArray(data.archiveLineups??[])&&archiveLineups.length<=500,'Zu viele historische Spielerplätze.');
 const archiveSnapshots=data.archiveSnapshots??[];
 need(Array.isArray(archiveSnapshots)&&archiveSnapshots.length<=50,'Ungültiges Archivpaket.');
 for(const a of archiveSnapshots)need(/^official-(11|12|13|14)-20[0-9]{2}$/.test(a.id)&&Array.isArray(a.groups)&&Array.isArray(a.knockout)&&Array.isArray(a.lineups)&&a.lineups.length<=100,'Ungültiges Sportarchiv.');
 return{format:data.format,tournamentId:data.tournamentId,members,registrations,archiveLineups,archiveSnapshots};
}
export function memberInvitationPlan(members,accounts,logs=[]){
 const email=x=>String(x??'').trim().toLowerCase();
 return members.filter(m=>m.active).map(m=>{
  const old=logs.find(l=>l.id===m.id),matches=accounts.filter(a=>a.uid===m.accountUid||email(a.email)===email(m.email));
  const account=m.accountUid?accounts.find(a=>a.uid===m.accountUid):matches.length===1?matches[0]:null;
  const issue=old?'Bereits bearbeitet: '+old.status+(old.message?' · '+old.message:''):account?.disabled?'Benutzerkonto ist gesperrt; Bereinigung zuerst abschließen':!m.email||!/^[^ @]+@[^ @]+\.[^ @]+$/.test(m.email)?'E-Mail fehlt oder ungültig':members.some(other=>other.id!==m.id&&other.active&&email(other.email)===email(m.email))?'E-Mail wird von mehreren Mitgliedern verwendet':m.accountUid&&!account?'Verknüpftes Konto fehlt':matches.length>1&&!m.accountUid?'Mehrere Konten gefunden':'';
  return{memberId:m.id,name:fullName(m),email:m.email,uid:account?.uid??'',loginEmail:account?.email??m.email,eligible:!issue,issue,action:account?'Vorhandenes Konto verknüpfen und Zugangsmail senden':'Konto anlegen, verknüpfen und einladen'};
 });
}
