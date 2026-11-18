/** Reine Datenlogik für Anmeldung und private Mitgliederverwaltung. Beträge in Cent. */
import {memberNumber,phoneNumber} from './member-format.js';
export const euro=cents=>new Intl.NumberFormat('de-DE',{style:'currency',currency:'EUR'}).format(cents/100);
export const fullName=p=>`${p.firstName} ${p.lastName}`.trim();
export const nameKey=s=>String(s).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLocaleLowerCase('de').replace(/ß/g,'ss').replace(/[^a-z0-9]+/g,' ').trim();
const text=(value,max=120)=>String(value??'').replace(/\s+/g,' ').trim().slice(0,max);
const need=(condition,message)=>{if(!condition)throw Error(message);};
export const defaultRegistrationSettings=()=>({capacity:32,confirmedCount:0,waitlistCount:0,nextSequence:0,open:false,revision:0,lastEntry:''});
export function calculateFees(players,draftBeer){
 need(players.length===2&&players.every(p=>typeof p.member==='boolean'),'Bitte den Mitgliedsstatus für beide Personen angeben.');
 const entryCents=players.reduce((sum,p)=>sum+(p.member?0:1000),0),beerCents=draftBeer?players.reduce((sum,p)=>sum+(p.member?500:1000),0):0;
 return{entryCents,beerCents,totalCents:entryCents+beerCents};
}
export function normalizePlayer(p,{board=false}={}){
 const firstName=text(p.firstName,60),lastName=text(p.lastName,60),email=text(p.email,254).toLowerCase();
 need(firstName&&lastName,'Bitte Vor- und Nachname für beide Personen eintragen.');
 need(typeof p.member==='boolean','Bitte den Mitgliedsstatus für beide Personen auswählen.');
 need((board&&!email)||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Bitte eine gültige E-Mail-Adresse für beide Mitspieler eintragen.');
 return{firstName,lastName,email,member:p.member,claimedMember:board?!!p.claimedMember:p.member,verified:board?!!p.verified:false,memberId:board?text(p.memberId,80):''};
}
export function normalizeRegistration(data,{board=false,allowMissingEmail=false}={}){
 const teamName=text(data.teamName,60),email=text(board?data.email:data.players?.[0]?.email,254).toLowerCase();
 need(teamName,'Bitte einen Teamnamen eintragen.');
 need((allowMissingEmail&&!email)||/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email),'Bitte eine gültige Kontakt-E-Mail eintragen.');
 need(Array.isArray(data.players)&&data.players.length===2,'Ein Team besteht aus zwei Personen.');
 const players=data.players.map(p=>normalizePlayer(p,{board}));
 need(!players[0].email||!players[1].email||players[0].email!==players[1].email,'Bitte für jeden Mitspieler eine eigene E-Mail-Adresse verwenden.');
 need(nameKey(fullName(players[0]))!==nameKey(fullName(players[1])),'Bitte zwei unterschiedliche Personen eintragen.');
 need(typeof data.draftBeer==='boolean','Bitte die Bierauswahl angeben.');
 const paidCents=board?Number(data.paidCents??0):0;
 need(Number.isInteger(paidCents)&&paidCents>=0&&paidCents<=100000,'Der gezahlte Betrag ist ungültig.');
 return{teamName,email,players,draftBeer:data.draftBeer,fees:calculateFees(players,data.draftBeer),paidCents,notes:board?text(data.notes,1000):'',teamId:board?text(data.teamId,128):''};
}
export function normalizeMember(data){
 const firstName=text(data.firstName,60),lastName=text(data.lastName,60);need(firstName&&lastName,'Vor- und Nachname fehlen.');
 const feeHistory={};for(const [year,value]of Object.entries(data.feeHistory??{})){need(/^20\d{2}$/.test(year),'Ungültiges Beitragsjahr.');feeHistory[year]=text(value,120);}
 need(Object.keys(feeHistory).length<=50,'Zu viele Beitragsjahre.');
 const feeColors={};for(const[year,color]of Object.entries(data.feeColors??{})){need(/^20\d{2}$/.test(year)&&/^#[0-9A-Fa-f]{6}$/.test(color),'Ungültige Beitragsmarkierung.');feeColors[year]=color.toUpperCase();}need(Object.keys(feeColors).length<=50,'Zu viele Beitragsmarkierungen.');
 return{number:text(memberNumber(data.number),40),firstName,lastName,active:!!data.active,joined:text(data.joined,30),occupation:text(data.occupation,120),email:text(data.email,254),phone:text(phoneNumber(data.phone),80),iban:text(data.iban,80),mandate:text(data.mandate,80),notes:text(data.notes,1000),feeHistory,feeColors,birthDate:text(data.birthDate,10),street:text(data.street,120),postalCode:text(data.postalCode,20),city:text(data.city,100),bank:text(data.bank,120),accountHolder:text(data.accountHolder,120),accountUid:text(data.accountUid,128),applicationId:text(data.applicationId,128)};
}
export const contactFields=['email','phone','street','postalCode','city','occupation'];
export function normalizeContact(data){
 const values=Object.fromEntries(contactFields.map(k=>[k,text(data[k],{email:254,phone:80,street:120,postalCode:20,city:100,occupation:120}[k])]));values.email=values.email.toLowerCase();
 need(/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(values.email),'Bitte eine gültige Kontakt-E-Mail eingeben.');need(values.phone,'Bitte eine Telefonnummer eingeben.');return values;
}
export function memberProfile(member,revision=0){const m=normalizeMember(member);return{memberId:member.id,number:m.number,firstName:m.firstName,lastName:m.lastName,birthDate:m.birthDate,active:m.active,...Object.fromEntries(contactFields.map(k=>[k,m[k]])),revision};}
export function normalizeApplication(data){
 const keys=['firstName','lastName','birthDate','occupation','street','postalCode','city','email','phone','applicationPlace','applicationDate','accountHolder','bank','iban','debitPlace','debitDate'];
 const result=Object.fromEntries(keys.map(k=>[k,text(data[k],{email:254,phone:80,firstName:60,lastName:60,postalCode:20,birthDate:10,applicationDate:10,debitDate:10,iban:80}[k]??120)]));
 need(result.firstName&&result.lastName,'Vor- und Nachname fehlen.');normalizeContact(result);need(/^\d{4}-\d{2}-\d{2}$/.test(result.birthDate),'Das Geburtsdatum fehlt.');return result;
}
export function applicationMember(data,{id,existing,number,joined,applicationId}){
 const a=normalizeApplication(data),m=normalizeMember({...existing,...a,number:number??existing?.number??'',joined,active:true,accountUid:existing?.accountUid??'',applicationId});
 return{id,...m};
}
export function membershipSuggestions(person,members){
 const key=nameKey(fullName(person)),surname=nameKey(person.lastName),first=nameKey(person.firstName);
 return members.map(m=>({member:m,exact:nameKey(fullName(m))===key})).filter(x=>x.exact||(surname&&nameKey(x.member.lastName)===surname)||(first&&nameKey(x.member.firstName)===first&&nameKey(x.member.lastName).startsWith(surname.slice(0,3)))).sort((a,b)=>Number(b.exact)-Number(a.exact)||Number(b.member.active)-Number(a.member.active)).slice(0,6);
}
export function reconcileSettings(settings,before,after){
 const next={...settings,revision:settings.revision+1,lastEntry:after.id};
 for(const [status,key]of [['confirmed','confirmedCount'],['waitlist','waitlistCount']])next[key]+=(after.status===status?1:0)-(before?.status===status?1:0);
 if(!before)next.nextSequence++;
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
 return{format:data.format,tournamentId:data.tournamentId,members,registrations};
}
