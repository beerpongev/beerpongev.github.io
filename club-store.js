/** Zusätzliche Vereinsabläufe. Das Firebase-SDK wird erst nach connect() übergeben. */
import {normalizeMember,memberProfile,fullName} from './registration.js';
import {legacyContribution,normalizeContribution,applyBankPayment,validYear} from './contributions.js';
import {transferRegistrationTeam} from './team-transfer.js';
import {reverseBankPayment} from './bank-corrections.js';
import {normalizePrices} from './pricing.js';

export const digest=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');
export function createClubStore(environment){
 const env=()=>environment();
 const board=async()=>{const e=env();await e.requireBoardAccount();return e;};
 const rows=async(api,db,path)=>{const s=await api.getDocs(api.collection(db,...path.split('/')));return s.docs.map(d=>({id:d.id,...d.data()}));};
 const filteredRows=async(api,db,path,field,value)=>{const s=await api.getDocs(api.query(api.collection(db,path),api.where(field,'==',value)));return s.docs.map(d=>({id:d.id,...d.data()}));};
 const ledgerData=(e,memberId,year,current,next)=>({...normalizeContribution(next),memberId,year:String(year),revision:(current?.revision??-1)+1,updatedBy:e.auth.currentUser.uid,updatedAt:e.api.serverTimestamp()});

 async function transferRegistration(id,entryId,targetId,{expectedRevision,expectedUpdatedAt,privateOnly=false}={}){
  const e=await board(),{api,db,auth}=e;
  const regRef=api.doc(db,'tournamentRegistrations',id,'entries',entryId),stateRef=api.doc(db,'tournaments',id);
  const initial=await api.getDoc(regRef);if(!initial.exists())throw Error('Anmeldung fehlt.');
  const hashes=await Promise.all(initial.data().players.map(p=>p.email?digest(p.email.trim().toLowerCase()):null));
  const newIds=hashes.map(()=>crypto.randomUUID());
  return api.runTransaction(db,async tx=>{
   const [reg,state,info]=await Promise.all([tx.get(regRef),tx.get(stateRef),tx.get(api.doc(db,'tournamentCatalog',id))]);
   if(!reg.exists()||!state.exists())throw Error('Anmeldung oder Spielplan fehlt.');
   const row=reg.data(),s=state.data();
   if((row.updatedAt?.toMillis?.()??null)!==(initial.data().updatedAt?.toMillis?.()??null)||expectedUpdatedAt!==undefined&&(row.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Die Anmeldung wurde geändert. Bitte erneut öffnen.');
   if(!privateOnly&&s.revision!==expectedRevision)throw Error('Der Spielplan wurde geändert. Bitte die Übernahme erneut aufrufen.');
   const currentTeam=s.teams.find(t=>t.id===row.teamId);
   if(privateOnly&&(row.status!=='confirmed'||!currentTeam))throw Error('Bitte die bestätigte Anmeldung zuerst einem vorhandenen Spielplanteam zuordnen.');
   const result=privateOnly?{state:s,teamId:row.teamId}:transferRegistrationTeam(s,row,row.teamId||targetId),publicTeamName=privateOnly?currentTeam.name:row.teamName;
   const links=await Promise.all(row.players.map(async(p,i)=>{
    const indexRef=hashes[i]?api.doc(db,'personEmails',hashes[i]):null,index=indexRef?await tx.get(indexRef):null;
    const memberRef=p.memberId?api.doc(db,'members',p.memberId):null,member=memberRef?await tx.get(memberRef):null;
    const key=p.personId||index?.data()?.personId||member?.data()?.personId||newIds[i];
    const ref=api.doc(db,'persons',key),old=await tx.get(ref),publicRef=api.doc(db,'publicPlayers',key),published=await tx.get(publicRef);
    const previousEmailRef=old.data()?.email&&old.data().email!==p.email?api.doc(db,'personEmails',await digest(old.data().email.toLowerCase())):null,previousEmail=previousEmailRef?await tx.get(previousEmailRef):null;
    if(p.personId&&index?.exists()&&index.data().personId!==p.personId)throw Error('Diese E-Mail ist einer anderen Person zugeordnet. Bitte die Personenverknüpfung prüfen.');
    if(old.data()?.memberId&&p.memberId&&old.data().memberId!==p.memberId)throw Error('Diese Person ist bereits einem anderen Mitglied zugeordnet. Bitte den Mitgliedsabgleich prüfen.');
    return{key,p,indexRef,memberRef,member,ref,old:old.data(),previousEmailRef,previousEmail:previousEmail?.data(),publicRef,published:published.data(),slot:i+1};
   }));
   if(links[0].key===links[1].key)throw Error('Beide Teamplätze sind derselben Person zugeordnet. Bitte die Personen prüfen.');
   const meta=info.data()??{edition:15,date:'2027-01-02'};
   for(const link of links){
    const {key,p,indexRef,memberRef,member,ref,old,slot}=link;
    const aliases=[...new Set([...(old?.aliases??[]),...(old&&fullName(old)!==fullName(p)?[fullName(old)]:[])])].slice(-30);
    tx.set(ref,{firstName:p.firstName,lastName:p.lastName,email:p.email,memberId:p.memberId||old?.memberId||'',accountUid:old?.accountUid||member?.data()?.accountUid||'',aliases,updatedAt:api.serverTimestamp()});
    if(indexRef)tx.set(indexRef,{personId:key,updatedAt:api.serverTimestamp()});
    if(link.previousEmail?.personId===key)tx.delete(link.previousEmailRef);
    if(member?.exists())tx.update(memberRef,{personId:key,updatedAt:api.serverTimestamp()});
    tx.set(api.doc(db,'participations',`${id}__${result.teamId}__${slot}`),{personId:key,firstName:p.firstName,lastName:p.lastName,accountUid:old?.accountUid||member?.data()?.accountUid||'',tournamentId:id,teamId:result.teamId,teamName:publicTeamName,slot,year:meta.date.slice(0,4),date:meta.date,edition:meta.edition,source:'registration',updatedAt:api.serverTimestamp()});
    if(link.published)tx.set(link.publicRef,{...link.published,appearances:[...link.published.appearances.filter(a=>a.tournamentId!==id),{tournamentId:id,teamName:publicTeamName,year:meta.date.slice(0,4)}],updatedAt:api.serverTimestamp()});
   }
   tx.set(regRef,{...row,teamId:result.teamId,players:row.players.map((p,i)=>({...p,personId:links[i].key})),updatedAt:api.serverTimestamp()});
   if(!privateOnly)tx.set(stateRef,{...result.state,revision:s.revision+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});
   return{teamId:result.teamId,state:{...result.state,revision:s.revision+(privateOnly?0:1)}};
  });
 }
 async function listPersons(){const {api,db}=await board();return rows(api,db,'persons');}
 async function listPublicPlayers(){const {api,db,liveOnly}=env();liveOnly();return api&&db?rows(api,db,'publicPlayers'):[];}
 async function savePublicPlayer(id,{published,displayName='',aliases=[]}={}){
  const {api,db}=await board(),ref=api.doc(db,'publicPlayers',id);
  if(!published){await api.deleteDoc(ref);return;}
  displayName=String(displayName).trim();aliases=aliases.map(s=>String(s).trim()).filter(Boolean);
  if(!displayName||displayName.length>80||aliases.length>30||aliases.some(s=>s.length>80))throw Error('Öffentlichen Anzeigenamen und Namensvarianten prüfen.');
  const appearances=(await listParticipations()).filter(p=>p.personId===id).map(p=>({tournamentId:p.tournamentId,teamName:p.teamName,year:p.year}));
  await api.setDoc(ref,{displayName,aliases,appearances,consentConfirmed:true,updatedAt:api.serverTimestamp()});
 }
 async function linkMemberPerson(memberId,personId){
  const {api,db}=await board();
  await api.runTransaction(db,async tx=>{
   const memberRef=api.doc(db,'members',memberId),personRef=api.doc(db,'persons',personId);
   const [member,person]=await Promise.all([tx.get(memberRef),tx.get(personRef)]);
   if(!member.exists()||!person.exists())throw Error('Mitglied oder Person fehlt.');
   if(member.data().personId&&member.data().personId!==personId||person.data().memberId&&person.data().memberId!==memberId)throw Error('Es besteht bereits eine andere Personen-/Mitgliedszuordnung. Bitte diese zuerst prüfen.');
   if(person.data().accountUid&&member.data().accountUid&&person.data().accountUid!==member.data().accountUid)throw Error('Person und Mitglied haben unterschiedliche Konten. Bitte die Kontoverknüpfung zuerst prüfen.');
   tx.update(memberRef,{personId,updatedAt:api.serverTimestamp()});tx.update(personRef,{memberId,accountUid:person.data().accountUid||member.data().accountUid||'',updatedAt:api.serverTimestamp()});
  });
  const member=await api.getDoc(api.doc(db,'members',memberId));if(member.data()?.accountUid)await syncMemberParticipationAccount(memberId,member.data().accountUid);
 }
 async function syncMemberParticipationAccount(memberId,uid){
  const {api,db}=await board(),member=await api.getDoc(api.doc(db,'members',memberId)),id=member.data()?.personId;if(!id||!uid)return;
  const person=await api.getDoc(api.doc(db,'persons',id));if(!person.exists())return;
  if(person.data().accountUid&&person.data().accountUid!==uid)throw Error('Die Person ist mit einem anderen Konto verbunden. Bitte die Personenverknüpfung prüfen.');
  await api.setDoc(api.doc(db,'persons',id),{...person.data(),accountUid:uid,updatedAt:api.serverTimestamp()});
  for(const part of await listParticipations())if(part.personId===id&&part.accountUid!==uid){
   const {id:partId,...data}=part;await api.setDoc(api.doc(db,'participations',partId),{...data,accountUid:uid,updatedAt:api.serverTimestamp()});
   if(part.source==='registration')await api.setDoc(api.doc(db,'accountTeams',uid,'events',part.tournamentId),{personId:id,teamId:part.teamId,updatedAt:api.serverTimestamp()});
  }
 }
 async function savePerson(id,data){
  const {api,db}=await board();if(!/^[a-zA-Z0-9_-]{1,128}$/.test(id))throw Error('Ungültige Personenkennung.');
  const aliases=(data.aliases??[]).map(s=>String(s).trim()).filter(Boolean);
  if(aliases.length>30||aliases.some(s=>s.length>120))throw Error('Namensvarianten prüfen.');
  await api.runTransaction(db,async tx=>{const ref=api.doc(db,'persons',id),old=await tx.get(ref);if(!old.exists())throw Error('Person fehlt.');tx.update(ref,{aliases,updatedAt:api.serverTimestamp()});});
 }
 async function listParticipations(){const {api,db}=await board();return rows(api,db,'participations');}
 async function rebuildRegistrationClaims(id){
  const {api,db}=await board(),eventRef=api.doc(db,'registrationEvents',id),event=await api.getDoc(eventRef);
  if(!event.exists())throw Error('Bitte zuerst die Anmeldung einrichten.');
  const [entries,claims]=await Promise.all([rows(api,db,`tournamentRegistrations/${id}/entries`),rows(api,db,`registrationClaims/${id}/emails`)]),byEmail=new Map(),duplicates=new Set();
  for(const row of entries.filter(r=>r.status!=='cancelled').sort((a,b)=>a.sequence-b.sequence))for(const p of row.players)if(p.email){const email=p.email.toLowerCase();if(byEmail.has(email)&&byEmail.get(email).id!==row.id){duplicates.add(row.id);duplicates.add(byEmail.get(email).id);}else byEmail.set(email,row);}
  if(new Set([...byEmail.keys(),...claims.map(c=>c.id)]).size>450)throw Error('Mehr als 450 E-Mail-Zuordnungen. Bitte den Datenbestand zunächst prüfen.');
  await api.runTransaction(db,async tx=>{
   const current=await tx.get(eventRef);if(current.data()?.revision!==event.data().revision)throw Error('Anmeldungen wurden inzwischen geändert. Bitte erneut starten.');
   for(const [email,row]of byEmail)tx.set(api.doc(db,'registrationClaims',id,'emails',email),{owner:row.owner,entryId:row.id,createdAt:api.serverTimestamp()});
   for(const old of claims)if(!byEmail.has(old.id))tx.delete(api.doc(db,'registrationClaims',id,'emails',old.id));
  });return{emails:byEmail.size,duplicates:duplicates.size};
 }
 async function reconcileExistingTeamPeople(id){
  const {api,db}=await board(),[entries,accounts]=await Promise.all([rows(api,db,`tournamentRegistrations/${id}/entries`),rows(api,db,'roles')]);
  let teams=0,linked=0,unmatched=0;
  for(const row of entries.filter(r=>r.status==='confirmed'&&r.teamId)){
   await transferRegistration(id,row.id,row.teamId,{privateOnly:true});teams++;
   for(const [i,p]of row.players.entries()){
    const matches=accounts.filter(a=>p.email&&a.email?.toLowerCase()===p.email.toLowerCase());
    if(matches.length===1){await linkParticipationAccount(id,row.teamId,i+1,matches[0].id);linked++;}else unmatched++;
   }
  }return{teams,linked,unmatched};
 }
 async function listOwnParticipations(){
  const {api,db,auth,liveOnly}=env();liveOnly();if(!auth?.currentUser||auth.currentUser.isAnonymous)return[];
  const result=await api.getDocs(api.query(api.collection(db,'participations'),api.where('accountUid','==',auth.currentUser.uid)));
  return result.docs.map(d=>({id:d.id,...d.data()}));
 }
 async function linkParticipationAccount(id,teamId,slot,uid){
  const {api,db}=await board(),ref=api.doc(db,'participations',`${id}__${teamId}__${slot}`);
  await api.runTransaction(db,async tx=>{
   const [part,role]=await Promise.all([tx.get(ref),tx.get(api.doc(db,'roles',uid))]);
   if(!part.exists()||!role.exists())throw Error('Bitte Team zuerst erneut übernehmen und ein vorhandenes Konto auswählen.');
   const p=part.data(),personRef=api.doc(db,'persons',p.personId),person=await tx.get(personRef);
   if(person.data()?.accountUid&&person.data().accountUid!==uid)throw Error('Diese Person hat bereits ein anderes Konto. Bitte zuerst die Personenverknüpfung prüfen.');
   tx.update(ref,{accountUid:uid,updatedAt:api.serverTimestamp()});tx.update(personRef,{accountUid:uid,updatedAt:api.serverTimestamp()});
   tx.set(api.doc(db,'accountTeams',uid,'events',id),{teamId,personId:p.personId,updatedAt:api.serverTimestamp()});
  });
  // Alle vergangenen Teilnahmen dieser bestätigten Person ebenfalls dem Konto zugänglich machen.
  const part=await api.getDoc(ref),all=await listParticipations();
  for(const row of all.filter(r=>r.personId===part.data().personId&&r.accountUid!==uid))await api.setDoc(api.doc(db,'participations',row.id),{...Object.fromEntries(Object.entries(row).filter(([k])=>k!=='id')),accountUid:uid,updatedAt:api.serverTimestamp()});
  const person=await api.getDoc(api.doc(db,'persons',part.data().personId));
  if(person.data()?.memberId&&env().linkMemberAccount)await env().linkMemberAccount(person.data().memberId,uid);
 }
 function watchMyTeam(id,onTeam,onError){
  const {api,db,auth,liveOnly}=env();liveOnly();if(!auth?.currentUser||auth.currentUser.isAnonymous){onTeam(null);return()=>{};}
  return api.onSnapshot(api.doc(db,'accountTeams',auth.currentUser.uid,'events',id),s=>onTeam(s.exists()?s.data():null),onError);
 }
 async function importHistoricalLineups(items){
  const {api,db}=await board();if(!Array.isArray(items)||items.length>500)throw Error('Ungültige Spielerzuordnung.');
  // Wiederholungen und eindeutige bestehende Personen verwenden dieselbe Kennung.
  const known=await listPersons(),existingSlots=await listParticipations();
  let count=0;
  for(const item of items){
   if(!/^hist-[a-f0-9]{20}$/.test(item.assignmentId)||!/^official-(11|12|13|14)-20\d{2}$/.test(item.tournamentId)||![1,2].includes(item.slot))throw Error('Unbekannte Turnierzuordnung.');
   const key=`${item.assignmentId}__${item.slot}`,sameName=known.filter(p=>fullName(p).toLocaleLowerCase('de')===fullName(item).toLocaleLowerCase('de'));
   const previous=existingSlots.find(p=>p.id===key),unknown=item.firstName==='Spieler'&&/^[12]$/.test(item.lastName);
   if(previous&&fullName(previous)!==fullName(item))throw Error('Bestehender historischer Teamplatz enthält einen anderen Namen. Bitte zuerst prüfen.');
   if(!previous&&!unknown&&sameName.length>1&&!known.some(p=>p.id===item.personId))throw Error('Mehrere Personen mit gleichem Namen. Bitte zuerst die Personenverwaltung prüfen.');
   const person=previous?.personId??(!unknown&&sameName.length===1?sameName[0].id:item.personId||crypto.randomUUID());
   await api.runTransaction(db,async tx=>{
    const ref=api.doc(db,'participations',key),old=await tx.get(ref),personRef=api.doc(db,'persons',person),existing=await tx.get(personRef),publicRef=api.doc(db,'publicPlayers',person),published=await tx.get(publicRef);
    if(old.exists()&&old.data().personId!==person)throw Error('Eine Besetzung ist bereits anders zugeordnet. Bitte zuerst den bestehenden Datensatz prüfen.');
    if(!existing.exists())tx.set(personRef,{firstName:item.firstName,lastName:item.lastName,email:'',memberId:'',accountUid:'',aliases:[],updatedAt:api.serverTimestamp()});
    tx.set(ref,{personId:person,firstName:item.firstName,lastName:item.lastName,accountUid:existing.data()?.accountUid??'',tournamentId:item.tournamentId,teamId:item.assignmentId,teamName:item.teamName,slot:item.slot,year:item.year,date:item.date,edition:item.edition,source:'archive',updatedAt:api.serverTimestamp()});
    if(published.exists()){const p=published.data(),appearance={tournamentId:item.tournamentId,teamName:item.teamName,year:item.year};tx.set(publicRef,{...p,appearances:p.appearances.some(a=>a.tournamentId===item.tournamentId&&a.teamName===item.teamName)?p.appearances:[...p.appearances,appearance],updatedAt:api.serverTimestamp()});}
   });count++;
  }return count;
 }
 async function correctContributionPayment(receiptId,{reason,targetMemberId='',targetYear='',effectiveCents}={}){
  const e=await board(),{api,db,auth}=e;
  if(!String(reason??'').trim()||String(reason).length>1000)throw Error('Bitte eine Begründung für die Korrektur eingeben.');
  const ref=api.doc(db,'contributionTransactions',receiptId),correctionRef=api.doc(db,'contributionCorrections',receiptId),replacementId=await digest(receiptId+':reassigned');
  // Rücklastschriften bleiben bis zur bewussten Bankprüfung gesperrt; Storno hebt keine anderen Warnungen auf.
  return api.runTransaction(db,async tx=>{
   const [receipt,correction]=await Promise.all([tx.get(ref),tx.get(correctionRef)]);
   if(!receipt.exists()||correction.exists())throw Error('Buchung fehlt oder wurde bereits korrigiert.');
   const r=receipt.data();if(targetMemberId===r.memberId&&targetYear===r.year)throw Error('Die neue Zuordnung entspricht der bisherigen.');
   const oldRef=api.doc(db,'memberContributions',r.year,'entries',r.memberId),old=await tx.get(oldRef);
   if(!old.exists())throw Error('Der zugehörige Jahresstand fehlt.');
   if(r.kind==='return'&&r.paidDelta===undefined&&(!Number.isInteger(effectiveCents)||effectiveCents<0||effectiveCents>(r.originalCents||Math.abs(r.amountCents))))throw Error('Bei älteren Rücklastschriften bitte den damals tatsächlich verminderten Beitragsbetrag bestätigen.');
   const reverse=reverseBankPayment(old.data(),r.kind==='return'&&r.paidDelta===undefined?{...r,paidDelta:-effectiveCents}:r);
   let target=null;
   if(targetMemberId){
    if(!validYear(targetYear))throw Error('Gültiges neues Beitragsjahr angeben.');
    const member=await tx.get(api.doc(db,'members',targetMemberId)),nextRef=api.doc(db,'memberContributions',targetYear,'entries',targetMemberId),next=await tx.get(nextRef),replacement=await tx.get(api.doc(db,'contributionTransactions',replacementId));
    if(!member.exists()||replacement.exists())throw Error('Neue Zuordnung ist nicht möglich.');
    const current=next.exists()?next.data():legacyContribution({id:targetMemberId,...member.data()},targetYear);
    // Eine berichtigte ältere Buchung verändert den letzten bekannten Buchungstag nicht rückwärts.
    // Der neue Banknachweis behält weiter das tatsächliche ursprüngliche Buchungsdatum.
    target={member,nextRef,next,current,after:applyBankPayment(current,{...r,date:current.date>r.date?current.date:r.date},r.kind)};
   }
   tx.set(oldRef,ledgerData(e,r.memberId,r.year,old.data(),reverse));
   if(target){
    tx.set(target.nextRef,ledgerData(e,targetMemberId,targetYear,target.next.data(),target.after));
    const {createdAt,recordedBy,paidDelta,...bank}=r;
    tx.set(api.doc(db,'contributionTransactions',replacementId),{...bank,memberId:targetMemberId,year:targetYear,paidDelta:target.after.paidCents-target.current.paidCents,recordedBy:auth.currentUser.uid,createdAt:api.serverTimestamp()});
    if(r.kind==='return')tx.update(api.doc(db,'members',targetMemberId),{bankStatus:'unclear',bankNote:'Rücklastschrift vom '+r.date+' · Bankverbindung vor weiterem Einzug prüfen.',updatedAt:api.serverTimestamp()});
   }
   tx.set(correctionRef,{memberId:r.memberId,year:r.year,paidDelta:old.data().paidCents-reverse.paidCents,reason:String(reason).trim(),replacementId:target?replacementId:'',targetMemberId:target?targetMemberId:'',targetYear:target?targetYear:'',recordedBy:auth.currentUser.uid,createdAt:api.serverTimestamp()});
  });
 }
 async function listContributionTransactions(memberId){
  const {api,db}=await board();const [transactions,corrections]=await Promise.all([filteredRows(api,db,'contributionTransactions','memberId',memberId),filteredRows(api,db,'contributionCorrections','memberId',memberId)]);
  const map=new Map(corrections.map(c=>[c.id,c]));return transactions.filter(r=>r.memberId===memberId).map(r=>({...r,correction:map.get(r.id)??null})).sort((a,b)=>b.date.localeCompare(a.date));
 }
 async function listBankReturnRisks(){
  const {api,db}=await board();const [transactions,corrections]=await Promise.all([filteredRows(api,db,'contributionTransactions','kind','return'),rows(api,db,'contributionCorrections')]);
  const voided=new Set(corrections.map(c=>c.id));return transactions.filter(r=>r.kind==='return'&&!voided.has(r.id));
 }
 async function listDebitExports(){const {api,db}=await board();return(await rows(api,db,'debitExports')).sort((a,b)=>(b.createdAt?.seconds??0)-(a.createdAt?.seconds??0));}
 async function recordDebitExport(report){
  const {api,db,auth}=await board();if(!validYear(report.year)||!report.rows?.length||report.rows.length>2000)throw Error('Ungültige Lastschriftauswahl.');
  const id=crypto.randomUUID(),items=report.rows.map(r=>({memberId:r.memberId,name:r.memberName,amountCents:r.amountCents,mandate:r.mandate,mandateDate:r.mandateDate}));
  await api.setDoc(api.doc(db,'debitExports',id),{year:report.year,purpose:report.purpose,totalCents:report.totalCents,items,status:'prepared',revision:0,createdBy:auth.currentUser.uid,createdAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()});return id;
 }
 async function setDebitExportStatus(id,status,expectedRevision){
  const {api,db}=await board();if(!['submitted','cancelled'].includes(status))throw Error('Ungültiger Exportstatus.');
  await api.runTransaction(db,async tx=>{const ref=api.doc(db,'debitExports',id),old=await tx.get(ref);if(!old.exists()||old.data().revision!==expectedRevision||old.data().status!=='prepared')throw Error('Der Export wurde inzwischen bearbeitet.');tx.update(ref,{status,revision:expectedRevision+1,updatedAt:api.serverTimestamp()});});
 }
 async function getMembershipPDF(id){const {api,db}=await board();let row=await api.getDoc(api.doc(db,'membershipApplicationPDFs',id));if(!row.exists())row=await api.getDoc(api.doc(db,'membershipApplications',id));if(!row.data()?.pdf)throw Error('Die PDF-Datei ist nicht mehr vorhanden.');return row.data().pdf;}
 async function migrateMembershipPDFs(){
  const {api,db}=await board();let count=0;
  for(const a of await rows(api,db,'membershipApplications'))if(a.pdf){
   await api.runTransaction(db,async tx=>{const ref=api.doc(db,'membershipApplications',a.id),old=await tx.get(ref),pdfRef=api.doc(db,'membershipApplicationPDFs',a.id),pdf=await tx.get(pdfRef);if(!old.data()?.pdf)return;const {pdf:bytes,...metadata}=old.data();if(!pdf.exists())tx.set(pdfRef,{owner:metadata.owner,pdf:bytes,createdAt:metadata.createdAt});tx.set(ref,{...metadata,pdfStored:true});});count++;
  }return count;
 }
 function watchClubSettings(onSettings,onError){const {api,db,liveOnly}=env();liveOnly();return api.onSnapshot(api.doc(db,'clubSettings','public'),s=>onSettings(s.data()??{}),onError);}
 async function saveClubSettings(input,{expectedRevision}={}){
  const {api,db}=await board(),legal=input.legal??{},rates=input.contributionRates??{};
  for(const[year,fee]of Object.entries(rates))if(!validYear(year)||!Number.isInteger(fee)||fee<0||fee>100000)throw Error('Ungültiger Jahresbeitrag.');
  const values=Object.fromEntries(['address','representatives','registerCourt','registerNumber'].map(k=>[k,String(legal[k]??'').trim().slice(0,1000)]));
  return api.runTransaction(db,async tx=>{
   const ref=api.doc(db,'clubSettings','public'),old=await tx.get(ref),revision=old.data()?.revision??-1;
   if(expectedRevision!==undefined&&revision!==expectedRevision)throw Error('Die Vereinsangaben wurden inzwischen geändert. Bitte die Vorstandsansicht erneut öffnen.');
   const next={legal:values,contributionRates:rates,revision:revision+1,updatedAt:api.serverTimestamp()};tx.set(ref,next);return next;
  });
 }
 return{transferRegistration,rebuildRegistrationClaims,reconcileExistingTeamPeople,listPersons,listPublicPlayers,savePublicPlayer,savePerson,linkMemberPerson,syncMemberParticipationAccount,listParticipations,listOwnParticipations,linkParticipationAccount,watchMyTeam,importHistoricalLineups,correctContributionPayment,listContributionTransactions,listBankReturnRisks,listDebitExports,recordDebitExport,setDebitExportStatus,getMembershipPDF,migrateMembershipPDFs,watchClubSettings,saveClubSettings};
}
