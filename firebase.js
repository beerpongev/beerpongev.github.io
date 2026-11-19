import {createClubStore} from './club-store.js';
import {normalizePrices} from './pricing.js';
import { firebaseConfig, tournamentId, useEmulators, appCheckSiteKey } from './config.js';
import { runStateTransaction } from './transaction.js';
import {memberInvitationPlan,defaultRegistrationSettings,normalizeRegistration,normalizeMember,reconcileSettings,validatePrivateImport,normalizeApplication,applicationMember,memberProfile,normalizeContact} from './registration.js';
import {validYear,normalizeContribution,legacyContribution,applyBankPayment} from './contributions.js';
import {mandateYear,mandateSequence,nextMandate} from './debit-export.js';

export const firebaseProjectId=firebaseConfig.projectId;
export const configured = firebaseConfig.apiKey !== 'HIER_EINTRAGEN' && firebaseConfig.projectId !== 'DEIN-PROJEKT';
export const liveCacheKey = `beerpong-live-${firebaseConfig.projectId}`;
let api, authApi, apps, db, auth, secondary, ref,demoGateOnly=false;
export let historyApproved=false;
let stopState=()=>{},stateCallbacks,stateGeneration=0;
export const {transferRegistration,rebuildRegistrationClaims,reconcileExistingTeamPeople,listPersons,listPublicPlayers,savePublicPlayer,savePerson,linkMemberPerson,syncMemberParticipationAccount,listParticipations,listOwnParticipations,linkParticipationAccount,watchMyTeam,importHistoricalLineups,correctContributionPayment,listContributionTransactions,listBankReturnRisks,listDebitExports,recordDebitExport,setDebitExportStatus,getMembershipPDF,migrateMembershipPDFs,watchClubSettings,saveClubSettings}=createClubStore(()=>({api,db,auth,requireBoardAccount,liveOnly,linkMemberAccount}));
function liveOnly(){if(demoGateOnly)throw new Error('Echte Daten und Kontovorgänge sind in der Online-Demo gesperrt.');}
async function requireBoardAccount(){
  liveOnly();
  if(!auth?.currentUser?.uid)throw new Error('Die Benutzerverwaltung ist dem Vorstand vorbehalten.');
  const own=await api.getDoc(api.doc(db,'roles',auth.currentUser.uid));
  if(own.data()?.role!=='board'||own.data()?.disabled)throw new Error('Die Benutzerverwaltung ist dem Vorstand vorbehalten.');
}

/** Die Online-Demo verwendet Firebase nur für Anmeldung und Prüfung der eigenen Rolle. */
export async function connect({ onState, onUser, onRole, onUsers, onConnection, onError, onCatalog, onRegistrationSettings, initialTournamentId=tournamentId, demoGate=false }) {
  demoGateOnly=demoGate;
  const version = '12.6.0';
  [apps, authApi, api] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${version}/firebase-firestore.js`)
  ]);
  const app = apps.initializeApp(firebaseConfig);
  if(appCheckSiteKey&&!useEmulators&&!demoGate){const check=await import(`https://www.gstatic.com/firebasejs/${version}/firebase-app-check.js`);check.initializeAppCheck(app,{provider:new check.ReCaptchaV3Provider(appCheckSiteKey),isTokenAutoRefreshEnabled:true});}
  db = api.getFirestore(app); auth = authApi.getAuth(app);
  secondary = apps.initializeApp(firebaseConfig, 'account-creation');
  const secondaryAuth = authApi.initializeAuth(secondary, { persistence: authApi.inMemoryPersistence });
  auth.languageCode='de';secondaryAuth.languageCode='de';
  if (useEmulators) {
    api.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    authApi.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    authApi.connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  ref = api.doc(db, 'tournaments', tournamentId);
  stateCallbacks={onState,onConnection,onError};
  if(!demoGate){
    selectTournament(initialTournamentId);
    if(onCatalog)api.onSnapshot(api.collection(db,'tournamentCatalog'),list=>onCatalog(list.docs.map(d=>({id:d.id,...d.data()}))),onError);
    if(onRegistrationSettings)api.onSnapshot(api.collection(db,'registrationEvents'),list=>onRegistrationSettings(Object.fromEntries(list.docs.map(d=>[d.id,d.data()]))),onError);
  }
  let stopRole = () => {}, stopUsers = () => {};
  authApi.onAuthStateChanged(auth, user => {
    historyApproved=false;stopRole(); stopUsers(); onUsers([]); onRole('guest',''); onUser(user);
    if (!user) return;
    stopRole = api.onSnapshot(api.doc(db, 'roles', user.uid), snap => {
      const role = snap.data()?.disabled?'guest':snap.data()?.role ?? 'guest';
      historyApproved=!!user&&!user.isAnonymous&&snap.exists()&&!snap.data()?.disabled&&['guest','player','admin','board'].includes(role);
      onRole(role,snap.data()?.teamId??'',snap.data()?.tournamentId??tournamentId); stopUsers();onUsers([]);
      if (!demoGate&&role==='board') stopUsers = api.onSnapshot(api.collection(db, 'roles'), list => onUsers(list.docs.map(d => ({ uid: d.id, ...d.data() }))), onError);
    }, onError);
  });
}

/** Genau ein Live-Spielplan pro Gerät; verspätete Antworten alter Listener verwerfen. */
export function selectTournament(id){
  liveOnly();
  if(id===null){stopState();++stateGeneration;ref=null;stateCallbacks.onConnection(false);return;}
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Ungültige Turnier-ID.');
  stopState();const generation=++stateGeneration;ref=api.doc(db,'tournaments',id);
  stateCallbacks.onConnection(false);
  stopState=api.onSnapshot(ref,{includeMetadataChanges:true},snapshot=>{
    if(generation!==stateGeneration)return;
    stateCallbacks.onConnection(!snapshot.metadata.fromCache&&!snapshot.metadata.hasPendingWrites);
    if(snapshot.exists())stateCallbacks.onState(snapshot.data(),id);else if(!snapshot.metadata.fromCache)stateCallbacks.onState(null,id);
  },error=>{if(generation===stateGeneration){stateCallbacks.onConnection(false);stateCallbacks.onError(error);}});
}
export async function createTournament(id,info,state){
  await requireBoardAccount();
  if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Ungültige Turnier-ID.');
  const stateRef=api.doc(db,'tournaments',id),metaRef=api.doc(db,'tournamentCatalog',id);
  await api.runTransaction(db,async tx=>{
    const [oldState,oldInfo]=await Promise.all([tx.get(stateRef),tx.get(metaRef)]);
    if(oldState.exists()||oldInfo.exists())throw Error('Diese Turnier-ID ist bereits vergeben.');
    tx.set(metaRef,info);tx.set(stateRef,{...state,revision:0,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});
  });
}
export async function saveTournamentInfo(id,info){await requireBoardAccount();await api.setDoc(api.doc(db,'tournamentCatalog',id),info);}

export const login = (email, password) => authApi.signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => {liveOnly();return authApi.signOut(auth);};
export async function changePassword(currentPassword,newPassword){
  liveOnly();
  const user=auth.currentUser;
  if(!user?.email||user.isAnonymous)throw new Error('Bitte zuerst mit deinem Benutzerkonto anmelden.');
  await authApi.reauthenticateWithCredential(user,authApi.EmailAuthProvider.credential(user.email,currentPassword));
  await authApi.updatePassword(user,newPassword);
}
export const resetPassword=email=>{liveOnly();return authApi.sendPasswordResetEmail(auth,email.trim());};

// Private PDF-Ablage, getrennt vom öffentlich lesbaren Turnierdokument.
export async function saveMembershipPDF(bytes, filename, data) {
 liveOnly();if(!db)throw Error('Firebase ist noch nicht verbunden.');
 if(bytes.length>900000)throw Error('Der Antrag ist zu groß (maximal 900 KB).');
 if(!auth.currentUser)await authApi.signInAnonymously(auth);
 const id=crypto.randomUUID(),owner=auth.currentUser.uid;
 await api.runTransaction(db,async tx=>{
  tx.set(api.doc(db,'membershipApplications',id),{owner,filename,pdfStored:true,data:normalizeApplication(data),createdAt:api.serverTimestamp()});
  tx.set(api.doc(db,'membershipApplicationPDFs',id),{owner,pdf:api.Bytes.fromUint8Array(bytes),createdAt:api.serverTimestamp()});
 });
}
export async function listMemberships(){
  await requireBoardAccount();
  const [rows,reviews]=await Promise.all([api.getDocs(api.collection(db,'membershipApplications')),api.getDocs(api.collection(db,'membershipReviews'))]);
  const byId=new Map(reviews.docs.map(d=>[d.id,d.data()]));
  return rows.docs.map(d=>{const {pdf,...metadata}=d.data();return{id:d.id,...metadata,hasLegacyPDF:!!pdf,review:byId.get(d.id)??null};}).sort((a,b)=>(b.createdAt?.seconds??0)-(a.createdAt?.seconds??0));
}
export async function deleteMembership(id){await requireBoardAccount();await api.runTransaction(db,async tx=>{tx.delete(api.doc(db,'membershipApplications',id));tx.delete(api.doc(db,'membershipApplicationPDFs',id));});}

/** Optimistische Konkurrenzkontrolle plus Firestore-Transaktion: kein Lost Update. */
export async function mutate(transform, expectedRevision, { id, baseline, match } = {}) {
  liveOnly();
  if(!ref)throw Error('Bitte ein aktives Turnier auswählen.');
  return runStateTransaction(api, db, ref, auth.currentUser.uid, transform, expectedRevision, { id, baseline, match });
}

/** Zweite Auth-Instanz: das Vorstandskonto bleibt beim Anlegen angemeldet.
 * Kontenerstellung in Auth ist öffentlich erreichbar; Rechte gibt es nur über /roles.
 * Auth und Firestore haben keine gemeinsame Transaktion: bei Fehler zurückrollen.
 */
export async function createAccount({ email, name, role, teamId = '', tournamentId:assignedTournament=tournamentId }) {
  liveOnly();
  await requireBoardAccount();
  const secondaryAuth = authApi.getAuth(secondary);
  // Dieses zufällige Geheimnis wird weder angezeigt noch gespeichert oder verschickt.
  // Der Empfänger erhält ausschließlich den Firebase-Link zum eigenen Passwort.
  const bytes=crypto.getRandomValues(new Uint8Array(32)),secret='Aa1!'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  let created,roleCreated=false;
  try {
    created = (await authApi.createUserWithEmailAndPassword(secondaryAuth, email.trim(), secret)).user;
    await api.setDoc(api.doc(db, 'roles', created.uid), { name: name.trim(), email: email.trim(), role, teamId,tournamentId:assignedTournament });
    roleCreated=true;
    if(teamId)await api.setDoc(api.doc(db,'accountTeams',created.uid,'events',assignedTournament),{teamId,personId:'',updatedAt:api.serverTimestamp()});
    await authApi.sendPasswordResetEmail(secondaryAuth,email.trim(),{url:new URL('./',location.href).href});
  } catch (error) {
    if (created) {
      if(roleCreated){try{if(teamId)await api.deleteDoc(api.doc(db,'accountTeams',created.uid,'events',assignedTournament));await api.deleteDoc(api.doc(db,'roles',created.uid));}catch{/* Konto anschließend weiterhin löschen versuchen. */}}
      try { await authApi.deleteUser(created); }
      catch { throw new Error(`Kontoeinladung fehlgeschlagen. Konto ${email} und dessen Rolle bitte in Firebase prüfen; die automatische Bereinigung war nicht vollständig möglich.`); }
    }
    throw error;
  } finally { await authApi.signOut(secondaryAuth); }
  return created.uid;
}
export const inviteAccount=email=>{liveOnly();return requireBoardAccount().then(()=>authApi.sendPasswordResetEmail(auth,email.trim(),{url:new URL('./',location.href).href}));};
export async function listAccounts(){await requireBoardAccount();const s=await api.getDocs(api.collection(db,'roles'));return s.docs.map(d=>({uid:d.id,...d.data()}));}

export async function setRole(uid,data){
 await requireBoardAccount();uid=uid.trim();
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'roles',uid),old=await tx.get(ref);
  if(uid===auth.currentUser.uid&&data.role!==old.data()?.role)throw Error('Die eigene Leitungsrolle kann hier nicht geändert werden.');
  const previous=old.data(),id=data.tournamentId??tournamentId;
  if(previous?.disabled)throw Error('Das Konto ist gesperrt. Bitte die Bereinigung zuerst abschließen.');
  if(previous?.teamId&&(previous.tournamentId??tournamentId)!==id)tx.set(api.doc(db,'accountTeams',uid,'events',previous.tournamentId??tournamentId),{teamId:previous.teamId,personId:'',updatedAt:api.serverTimestamp()});
  tx.set(ref,{name:data.name.trim(),email:data.email.trim(),role:data.role,teamId:data.teamId??'',tournamentId:id});
  tx.set(api.doc(db,'accountTeams',uid,'events',id),{teamId:data.teamId??'',personId:'',updatedAt:api.serverTimestamp()});
 });
}

const eventRef=id=>api.doc(db,'registrationEvents',id);
const entryRef=(id,key)=>api.doc(db,'tournamentRegistrations',id,'entries',key);
function checkRegistrationId(id){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Ungültiges Turnier.');}
export async function initializeRegistration(id){
 await requireBoardAccount();checkRegistrationId(id);
 await api.runTransaction(db,async tx=>{const ref=eventRef(id),old=await tx.get(ref);if(!old.exists())tx.set(ref,{...defaultRegistrationSettings(),updatedAt:api.serverTimestamp()});});
}
export async function configureRegistration(id,{open,capacity,prices}){
 await requireBoardAccount();checkRegistrationId(id);
 await api.runTransaction(db,async tx=>{const ref=eventRef(id),old=await tx.get(ref);if(!old.exists())throw Error('Bitte zuerst die Anmeldung einrichten.');const s=old.data();if(!Number.isInteger(capacity)||capacity<1||capacity>32||capacity<s.confirmedCount)throw Error('Die Kapazität darf bestehende Startplätze nicht unterschreiten (maximal 32).');tx.set(ref,{...s,open:!!open,capacity,prices:normalizePrices(prices??s.prices),revision:s.revision+1,updatedAt:api.serverTimestamp()});});
}
/** Startplatz und laufende Wartelistennummer werden atomar vergeben. */
export async function submitRegistration(id,input){
 liveOnly();checkRegistrationId(id);if(!db)throw Error('Die Verbindung wird noch hergestellt. Bitte kurz warten.');
 const data=normalizeRegistration(input);if(!auth.currentUser)await authApi.signInAnonymously(auth);
 const uid=auth.currentUser.uid,ref=entryRef(id,uid);
 return api.runTransaction(db,async tx=>{
  const [event,existing]=await Promise.all([tx.get(eventRef(id)),tx.get(ref)]);
  if(existing.exists())return{id:uid,...existing.data(),already:true};
  if(!event.exists()||!event.data().open)throw Error('Die Anmeldung ist derzeit geschlossen.');
  const s=event.data();const checked=normalizeRegistration({...input,prices:s.prices});
  if(input.website)throw Error('Die Anmeldung konnte nicht verarbeitet werden.');
  const claimRefs=checked.players.map(p=>api.doc(db,'registrationClaims',id,'emails',p.email));
  // Blind schreiben: vorhandene Zuordnungen lassen sich ohne Vorstandsrecht nicht überschreiben.
  // Dadurch können Gäste auch nicht durch Abfragen feststellen, ob fremde E-Mails registriert sind.
  const status=s.confirmedCount<s.capacity&&s.waitlistCount===0?'confirmed':'waitlist';
  const row={...checked,owner:uid,status,sequence:s.nextSequence+1,source:'online',sourceDate:'',consent:true,createdAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()};
  for(const claim of claimRefs)tx.set(claim,{entryId:uid,owner:uid,createdAt:api.serverTimestamp()});
  tx.set(ref,row);tx.set(eventRef(id),{...reconcileSettings(s,null,{...row,id:uid}),updatedAt:api.serverTimestamp()});return{id:uid,...row};
 });
}
export async function listRegistrations(id){await requireBoardAccount();checkRegistrationId(id);const snapshot=await api.getDocs(api.collection(db,'tournamentRegistrations',id,'entries'));return snapshot.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.sequence-b.sequence);}
/** Entfernt nur die private Anmeldung; Mitglied, Konto und Spielplan bleiben erhalten. */
export async function deleteRegistration(id,entryId,{expectedUpdatedAt}={}){
 await requireBoardAccount();checkRegistrationId(id);
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(entryId))throw Error('Ungültige Anmelde-ID.');
 return api.runTransaction(db,async tx=>{
  const ref=entryRef(id,entryId),[event,existing]=await Promise.all([tx.get(eventRef(id)),tx.get(ref)]);
  if(!existing.exists())return;
  if(!event.exists())throw Error('Anmeldeeinstellungen fehlen. Bitte zuerst prüfen.');
  const row=existing.data();
  if(expectedUpdatedAt!==undefined&&(row.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Die Anmeldung wurde inzwischen geändert. Bitte neu öffnen.');
  const claims=await Promise.all([...new Set(row.players.map(p=>p.email).filter(Boolean))].map(async email=>{const ref=api.doc(db,'registrationClaims',id,'emails',email);return{ref,snap:await tx.get(ref)};}));
  const settings=reconcileSettings(event.data(),{...row,id:entryId},null);
  for(const claim of claims)if(claim.snap.exists()&&claim.snap.data().entryId===entryId)tx.delete(claim.ref);
  tx.delete(ref);tx.set(eventRef(id),{...settings,updatedAt:api.serverTimestamp()});
 });
}
export async function saveRegistration(id,input,{entryId,status='confirmed',source='board',sourceDate='',expectedUpdatedAt,contactEmailUpdates=[]}={}){
 await requireBoardAccount();checkRegistrationId(id);const key=entryId??crypto.randomUUID(),data=normalizeRegistration(input,{board:true,allowMissingEmail:true});
 if(!['confirmed','waitlist','cancelled'].includes(status))throw Error('Ungültiger Anmeldestatus.');
 return api.runTransaction(db,async tx=>{
  const [event,existing]=await Promise.all([tx.get(eventRef(id)),tx.get(entryRef(id,key))]);
  if(!event.exists())throw Error('Bitte zuerst die Anmeldung einrichten.');const settings=event.data(),old=existing.exists()?existing.data():null;
  if(expectedUpdatedAt!==undefined&&(old?.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Die Anmeldung wurde inzwischen geändert. Bitte neu öffnen.');
  const row={...normalizeRegistration({...input,prices:input.prices??settings.prices},{board:true,allowMissingEmail:true}),owner:old?.owner??auth.currentUser.uid,status,sequence:old?.sequence??settings.nextSequence+1,source:old?.source??source,sourceDate:old?.sourceDate??sourceDate,consent:old?.consent??false,createdAt:old?.createdAt??api.serverTimestamp(),updatedAt:api.serverTimestamp()};
  const emails=new Set([...(old?.players??[]),...row.players].map(p=>p.email).filter(Boolean));
  const claims=await Promise.all([...emails].map(async email=>({email,ref:api.doc(db,'registrationClaims',id,'emails',email),snap:await tx.get(api.doc(db,'registrationClaims',id,'emails',email))})));
  if(!Array.isArray(contactEmailUpdates)||contactEmailUpdates.length>2||new Set(contactEmailUpdates.map(u=>u.memberId)).size!==contactEmailUpdates.length)throw Error('Bitte die Kontaktübernahmen prüfen.');
  const contacts=[];
  for(const update of contactEmailUpdates){
   const person=row.players.find(p=>p.verified&&p.member&&p.memberId===update.memberId);if(!person||!person.email)throw Error('Kontakt-E-Mail nur für ein ausdrücklich bestätigtes Mitglied übernehmen.');
   const memberRef=api.doc(db,'members',update.memberId),member=await tx.get(memberRef);if(!member.exists()||!member.data().active)throw Error('Das ausgewählte Mitglied ist nicht mehr aktiv.');
   if(member.data().email!==update.expectedEmail)throw Error('Die Kontaktadresse wurde inzwischen geändert. Bitte neu öffnen.');
   const profileRef=member.data().accountUid?api.doc(db,'memberProfiles',member.data().accountUid):null,profile=profileRef?await tx.get(profileRef):null;
   contacts.push({memberRef,email:person.email,profileRef,profile});
  }
  for(const contact of contacts){tx.update(contact.memberRef,{email:contact.email,updatedAt:api.serverTimestamp()});if(contact.profile?.exists())tx.update(contact.profileRef,{email:contact.email,revision:contact.profile.data().revision+1,updatedAt:api.serverTimestamp()});}
  for(const claim of claims){
   const needed=status!=='cancelled'&&row.players.some(p=>p.email===claim.email);
   if(needed&&claim.snap.exists()&&claim.snap.data().entryId!==key)throw Error('Eine Person ist bereits in einer anderen Anmeldung eingetragen. Bitte die Dublette zuerst prüfen.');
   if(needed)tx.set(claim.ref,{entryId:key,owner:row.owner,createdAt:claim.snap.data()?.createdAt??api.serverTimestamp()});
   else if(claim.snap.data()?.entryId===key)tx.delete(claim.ref);
  }
  tx.set(entryRef(id,key),row);tx.set(eventRef(id),{...reconcileSettings(settings,old,{...row,id:key}),updatedAt:api.serverTimestamp()});return{id:key,...row};
 });
}
export async function listContributions(year){await requireBoardAccount();if(!validYear(year))throw Error('Ungültiges Beitragsjahr.');const s=await api.getDocs(api.collection(db,'memberContributions',String(year),'entries'));return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function listMembers(){await requireBoardAccount();const snapshot=await api.getDocs(api.collection(db,'members'));return snapshot.docs.map(d=>({id:d.id,...d.data()}));}
function contributionRef(memberId,year){if(!validYear(year)||!/^[a-zA-Z0-9_-]{1,128}$/.test(memberId))throw Error('Ungültige Mitglieds-ID oder Beitragsjahr.');return api.doc(db,'memberContributions',String(year),'entries',memberId);}
export async function watchContributions(year,onRows,onError){await requireBoardAccount();if(!validYear(year))throw Error('Ungültiges Beitragsjahr.');return api.onSnapshot(api.collection(db,'memberContributions',String(year),'entries'),s=>onRows(s.docs.map(d=>({id:d.id,...d.data()}))),onError);}
export async function saveContribution(memberId,year,input,expectedRevision){
 await requireBoardAccount();const ref=contributionRef(memberId,year),data=normalizeContribution(input);
 await api.runTransaction(db,async tx=>{const [member,old]=await Promise.all([tx.get(api.doc(db,'members',memberId)),tx.get(ref)]);if(!member.exists())throw Error('Mitglied nicht mehr vorhanden.');if((old.data()?.revision??-1)!==expectedRevision)throw Error('Der Beitrag wurde inzwischen geändert. Bitte neu öffnen.');tx.set(ref,{...data,memberId,year:String(year),revision:(old.data()?.revision??-1)+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});});
}
/** Genau eine bestätigte Buchung; derselbe CSV-Umsatz wird auch bei erneuter Datei nicht doppelt gezählt. */
export async function recordContributionPayment(memberId,year,row,kind){
 await requireBoardAccount();if(!/^[a-f0-9]{64}$/.test(row.id))throw Error('Ungültige Buchungskennung.');const ref=contributionRef(memberId,year),receipt=api.doc(db,'contributionTransactions',row.id);
 return api.runTransaction(db,async tx=>{const [member,old,previous]=await Promise.all([tx.get(api.doc(db,'members',memberId)),tx.get(ref),tx.get(receipt)]);if(previous.exists())return{duplicate:true};if(!member.exists())throw Error('Mitglied nicht mehr vorhanden.');
  const current=old.exists()?old.data():legacyContribution({id:memberId,...member.data()},year),next=applyBankPayment(current,row,kind);
  tx.set(ref,{...next,memberId,year:String(year),revision:(old.data()?.revision??-1)+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});
  if(kind==='return')tx.update(api.doc(db,'members',memberId),{bankStatus:'unclear',bankNote:'Rücklastschrift vom '+row.date+' · Bankverbindung vor weiterem Einzug prüfen.',updatedAt:api.serverTimestamp()});
  const bank={date:row.date,amountCents:row.amountCents,name:String(row.name??'').slice(0,200),iban:String(row.iban??'').slice(0,80),purpose:String(row.purpose??'').slice(0,1000),reference:String(row.reference??'').slice(0,200),bookingText:String(row.bookingText??'').slice(0,200),mandate:String(row.mandate??'').slice(0,80),originalCents:row.originalCents??0};
  tx.set(receipt,{...bank,memberId,year:String(year),kind,paidDelta:next.paidCents-current.paidCents,recordedBy:auth.currentUser.uid,createdAt:api.serverTimestamp()});return{duplicate:false};
 });
}

export async function watchPrivateRegistry(id,{onEntries,onMembers,onError}){
 await requireBoardAccount();checkRegistrationId(id);
 const stopEntries=typeof onEntries==='function'?api.onSnapshot(api.collection(db,'tournamentRegistrations',id,'entries'),s=>onEntries(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.sequence-b.sequence)),onError):()=>{};
 const stopMembers=typeof onMembers==='function'?api.onSnapshot(api.collection(db,'members'),s=>onMembers(s.docs.map(d=>({id:d.id,...d.data()}))),onError):()=>{};
 return()=>{stopEntries();stopMembers();};
}
export async function saveMember(id,input,{expectedUpdatedAt}={}){
 await requireBoardAccount();const key=id??crypto.randomUUID(),seed=!id?mandateSequence(await listMembers()):null;
 await api.runTransaction(db,async tx=>{const ref=api.doc(db,'members',key),old=await tx.get(ref),previous=old.data();
  if(expectedUpdatedAt!==undefined&&(previous?.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Das Mitglied wurde inzwischen geändert. Bitte neu öffnen.');
  const member=normalizeMember({...input,accountUid:previous?.accountUid??'',bankReviewedAt:previous?.bankReviewedAt??null}),allocation=!id?await allocateMandate(tx,member.joined,seed):null,profileRef=member.accountUid?api.doc(db,'memberProfiles',member.accountUid):null,profile=profileRef?await tx.get(profileRef):null;
  if(previous?.bankStatus==='unclear'&&member.bankStatus==='ok'&&!input.bankReviewConfirmed)throw Error('Bitte die geprüfte Bankverbindung ausdrücklich für weitere Einzüge freigeben.');
  if(input.bankReviewConfirmed&&member.bankStatus==='ok')member.bankReviewedAt=api.serverTimestamp();
  if(allocation){member.mandate=allocation.reference;member.number=String(allocation.number);writeMandateCounter(tx,allocation);}
  tx.set(ref,{...member,updatedAt:api.serverTimestamp()});if(profileRef)tx.set(profileRef,{...memberProfile({id:key,...member},(profile?.data()?.revision??-1)+1),updatedAt:api.serverTimestamp()});
 });return key;
}
/** Aufnahme erfolgt ausschließlich nach Vorstandsentscheidung, atomar und einmalig. */
export async function acceptMembership(id,{data,memberId,number,joined,expectedUpdatedAt}={}){
 await requireBoardAccount();const target=memberId||'application-'+id,seed=!memberId?mandateSequence(await listMembers()):null;
 return api.runTransaction(db,async tx=>{
  const [application,review,old]=await Promise.all([tx.get(api.doc(db,'membershipApplications',id)),tx.get(api.doc(db,'membershipReviews',id)),tx.get(api.doc(db,'members',target))]);
  if(!application.exists())throw Error('Der Antrag ist nicht mehr vorhanden.');if(review.exists())throw Error('Dieser Antrag wurde bereits bearbeitet.');
  if(!memberId&&old.exists())throw Error('Der Mitgliedsdatensatz existiert bereits. Bitte zuordnen.');
  if(memberId&&!old.exists())throw Error('Das ausgewählte Mitglied existiert nicht mehr.');
  if(expectedUpdatedAt!==undefined&&(old.data()?.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Das Mitglied wurde inzwischen geändert. Bitte neu prüfen.');
  const member=applicationMember(data??application.data().data,{id:target,existing:old.data(),number,joined,applicationId:id}),allocation=!old.exists()?await allocateMandate(tx,member.joined,seed):null,profileRef=member.accountUid?api.doc(db,'memberProfiles',member.accountUid):null,profile=profileRef?await tx.get(profileRef):null;
  if(allocation){member.mandate=allocation.reference;member.number=String(allocation.number);writeMandateCounter(tx,allocation);}
  const {id:unused,...fields}=member;tx.set(api.doc(db,'members',target),{...fields,updatedAt:api.serverTimestamp()});
  if(profileRef)tx.set(profileRef,{...memberProfile(member,(profile?.data()?.revision??-1)+1),updatedAt:api.serverTimestamp()});
  tx.set(api.doc(db,'membershipReviews',id),{status:'accepted',memberId:target,note:'',reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});return target;
 });
}
export async function rejectMembership(id,note){
 await requireBoardAccount();if(!String(note).trim())throw Error('Bitte eine interne Begründung angeben.');
 await api.runTransaction(db,async tx=>{const ref=api.doc(db,'membershipReviews',id),[app,review]=await Promise.all([tx.get(api.doc(db,'membershipApplications',id)),tx.get(ref)]);if(!app.exists()||review.exists())throw Error('Antrag fehlt oder wurde bereits bearbeitet.');tx.set(ref,{status:'rejected',memberId:'',note:String(note).trim().slice(0,1000),reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});});
}
/** Globaler Zähler: 120 folgt auf den bisherigen Bestand 119, auch über Jahreswechsel. */
async function allocateMandate(tx,joined,seed){const ref=api.doc(db,'mandateCounters','global'),old=await tx.get(ref);return{...nextMandate(mandateYear(joined),seed,old.data()?.lastNumber??0),ref};}
function writeMandateCounter(tx,allocation){tx.set(allocation.ref,{lastNumber:allocation.number,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});}
export async function linkMemberAccount(memberId,uid){
 await requireBoardAccount();
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'members',memberId),profileRef=uid?api.doc(db,'memberProfiles',uid):null;
  const [member,role,profile]=await Promise.all([tx.get(ref),uid?tx.get(api.doc(db,'roles',uid)):null,profileRef?tx.get(profileRef):null]);
  if(!member.exists())throw Error('Mitglied nicht gefunden.');if(uid&&(!role.exists()||role.data()?.disabled))throw Error('Bitte ein vorhandenes, nicht gesperrtes Benutzerkonto auswählen.');
  if(profile?.exists()&&profile.data().memberId!==memberId)throw Error('Das Konto gehört bereits zu einem anderen Mitglied.');
  const old=member.data(),next=normalizeMember({...old,accountUid:uid});
  const personRef=uid&&old.personId?api.doc(db,'persons',old.personId):null,person=personRef?await tx.get(personRef):null;
  if(person?.data()?.accountUid&&person.data().accountUid!==uid)throw Error('Die Person ist bereits mit einem anderen Konto verbunden.');
  if(person?.exists())tx.update(personRef,{accountUid:uid,updatedAt:api.serverTimestamp()});
  if(old.accountUid&&old.accountUid!==uid)tx.delete(api.doc(db,'memberProfiles',old.accountUid));
  tx.set(ref,{...next,updatedAt:api.serverTimestamp()});if(profileRef)tx.set(profileRef,{...memberProfile({id:memberId,...next},(profile?.data()?.revision??-1)+1),updatedAt:api.serverTimestamp()});
 });
 if(uid)await syncMemberParticipationAccount(memberId,uid);
}
export function watchMyProfile(onProfile,onError){
 liveOnly();const user=auth?.currentUser;if(!user||user.isAnonymous){onProfile(null);return()=>{};}
 return api.onSnapshot(api.doc(db,'memberProfiles',user.uid),s=>onProfile(s.exists()?s.data():null),onError);
}
export async function saveMyProfile(input,expectedRevision){
 liveOnly();const user=auth?.currentUser;if(!user||user.isAnonymous)throw Error('Bitte mit deinem Mitgliedskonto anmelden.');const contact=normalizeContact(input);
 await api.runTransaction(db,async tx=>{const ref=api.doc(db,'memberProfiles',user.uid),old=await tx.get(ref);if(!old.exists())throw Error('Dein Konto ist noch nicht verknüpft.');const p=old.data();if(p.revision!==expectedRevision)throw Error('Die Daten wurden inzwischen geändert. Bitte neu öffnen.');tx.update(api.doc(db,'members',p.memberId),{...contact,updatedAt:api.serverTimestamp()});tx.set(ref,{...p,...contact,revision:p.revision+1,updatedAt:api.serverTimestamp()});});
}
export async function importPrivateRecords(input,onProgress=()=>{}){
 await requireBoardAccount();const data=validatePrivateImport(input);
 const knownPeople=data.archiveSnapshots.length?await listPersons():[];
 if(data.archiveSnapshots?.length)for(const snapshot of data.archiveSnapshots){
  // Ausschließlich Sportdaten teilen; keine mitgelieferten Kontakt-/Bankfelder übernehmen.
  const pick=(row,keys)=>Object.fromEntries(keys.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
  const sport=pick(snapshot,['id','sourceUrl','checkedOn','teamCount','totalMatches']);
  sport.groups=snapshot.groups.map(g=>({letter:g.letter,teams:g.teams.map(t=>pick(t,['position','name','played','won','drawn','lost','score','diff','points']))}));
  sport.placements=(snapshot.placements??[]).map(p=>pick(p,['position','name']));
  sport.knockout=snapshot.knockout.map(m=>pick(m,['id','round','a','b','score']));
  sport.groupMatches=(snapshot.groupMatches??[]).map(m=>pick(m,['id','group','round','a','b','score']));
  sport.lineups=snapshot.lineups.map(p=>{const safe=pick(p,['personId','firstName','lastName','tournamentId','teamId','teamName','year','date','edition','slot']);const matches=knownPeople.filter(person=>(person.firstName+' '+person.lastName).trim().toLocaleLowerCase('de')===(p.firstName+' '+p.lastName).trim().toLocaleLowerCase('de'));if(p.firstName!=='Spieler'&&matches.length===1)safe.personId=matches[0].id;return safe;});
  await api.setDoc(api.doc(db,'sportArchives',snapshot.id),{...sport,updatedAt:api.serverTimestamp()});
 }
 if((data.archiveLineups.length||data.archiveSnapshots.length)&&!data.members.length&&!data.registrations.length)return{addedMembers:0,addedEntries:0,addedArchiveSlots:data.archiveLineups.length?await importHistoricalLineups(data.archiveLineups):0};
 await initializeRegistration(data.tournamentId);
 const existingMembers=new Set((await listMembers()).map(m=>m.id)),existingEntries=new Set((await listRegistrations(data.tournamentId)).map(r=>r.id));
 let addedMembers=0,addedEntries=0;
 for(const member of data.members){if(existingMembers.has(member.id))continue;const{id,...fields}=member;await saveMember(id,fields);addedMembers++;onProgress(addedMembers,addedEntries);}
 for(const row of data.registrations){if(existingEntries.has(row.id))continue;const{id,sourceDate,...fields}=row;const event=await api.getDoc(eventRef(data.tournamentId)),s=event.data();await saveRegistration(data.tournamentId,fields,{entryId:id,status:s.confirmedCount<s.capacity&&s.waitlistCount===0?'confirmed':'waitlist',source:'import',sourceDate});addedEntries++;onProgress(addedMembers,addedEntries);}
 return{addedMembers,addedEntries,...(data.archiveLineups.length?{addedArchiveSlots:await importHistoricalLineups(data.archiveLineups)}:{})};
}

export async function loadHistoryStates(catalog){liveOnly();if(!api||!db)return[];return Promise.all(catalog.filter(t=>t.archived&&!t.externalUrl).map(async t=>{const s=await api.getDoc(api.doc(db,'tournaments',t.id));return s.exists()?{meta:t,state:s.data()}:null;})).then(rows=>rows.filter(Boolean));}

export async function listSportArchives(){liveOnly();if(!historyApproved)throw Error('Bitte mit einem freigegebenen persönlichen Konto anmelden.');const result=await api.getDocs(api.collection(db,'sportArchives'));return result.docs.map(d=>d.data());}
export async function publishSportLineups(id){
 await requireBoardAccount();
 const current=(await api.getDoc(api.doc(db,'tournaments',id))).data();
 const parts=(await listParticipations()).filter(p=>p.tournamentId===id);
 const lineups=parts.map(p=>({...Object.fromEntries(['personId','firstName','lastName','tournamentId','teamId','teamName','year','date','edition','slot'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]])),teamName:current?.teams?.find(t=>t.id===p.teamId)?.name??p.teamName}));
 await api.setDoc(api.doc(db,'sportArchives',id),{id,groups:[],knockout:[],placements:[],lineups,updatedAt:api.serverTimestamp()});
}

export async function previewMemberInvitations(){
 await requireBoardAccount();const [members,accounts,log]=await Promise.all([listMembers(),listAccounts(),api.getDocs(api.collection(db,'memberInvitations'))]);
 return memberInvitationPlan(members,accounts.map(a=>({...a,uid:a.uid??a.id})),log.docs.map(d=>({id:d.id,...d.data()})));
}
export async function sendMemberInvitations(memberIds){
 await requireBoardAccount();if(!Array.isArray(memberIds)||memberIds.length>20)throw Error('Bitte höchstens 20 Einladungen pro Durchlauf.');
 const plan=await previewMemberInvitations(),results=[];
 for(const id of [...new Set(memberIds)]){
  const item=plan.find(p=>p.memberId===id&&p.eligible);if(!item)continue;
  const ref=api.doc(db,'memberInvitations',id);
  const claimed=await api.runTransaction(db,async tx=>{const old=await tx.get(ref);if(old.exists())return false;tx.set(ref,{status:'processing',email:item.loginEmail,updatedAt:api.serverTimestamp()});return true;});if(!claimed)continue;
  try{
   let uid=item.uid;if(uid){await linkMemberAccount(id,uid);await inviteAccount(item.loginEmail);}else{uid=await createAccount({email:item.email,name:item.name,role:'guest',teamId:''});await linkMemberAccount(id,uid);}
   await api.runTransaction(db,async tx=>{const old=await tx.get(ref);tx.set(ref,{...old.data(),status:'sent',uid,updatedAt:api.serverTimestamp()});});results.push({id,status:'sent'});
  }catch(error){await api.runTransaction(db,async tx=>{const old=await tx.get(ref);tx.set(ref,{...old.data(),status:'review',message:String(error.message??error).slice(0,600),updatedAt:api.serverTimestamp()});});results.push({id,status:'review'});break;}
 }
 return results;
}

export async function removeAccountAccess(uid){
 await requireBoardAccount();if(typeof uid!=='string'||uid.length<1||uid.length>128||uid.includes('/')||uid===auth.currentUser.uid)throw Error('Das eigene Vorstandskonto kann hier nicht entfernt werden.');
 const roleRef=api.doc(db,'roles',uid);
 await api.runTransaction(db,async tx=>{const old=await tx.get(roleRef);if(!old.exists())throw Error('Konto fehlt.');tx.set(roleRef,{...old.data(),disabled:true});});
 // Erst sperren. Bei einem Abbruch bleibt die Sperre bestehen und die Bereinigung kann fortgesetzt werden.
 const bindings=[];
 for(const collection of ['members','persons','participations']){const result=await api.getDocs(api.query(api.collection(db,collection),api.where('accountUid','==',uid)));for(const d of result.docs)bindings.push({ref:api.doc(db,collection,d.id),unlink:true});}
 const teams=await api.getDocs(api.collection(db,'accountTeams',uid,'events'));for(const d of teams.docs)bindings.push({ref:api.doc(db,'accountTeams',uid,'events',d.id),unlink:false});
 bindings.push({ref:api.doc(db,'memberProfiles',uid),unlink:false});
 for(let offset=0;offset<bindings.length;offset+=100){const batch=bindings.slice(offset,offset+100);await api.runTransaction(db,async tx=>{const records=await Promise.all(batch.map(b=>tx.get(b.ref)));for(let i=0;i<batch.length;i++){const b=batch[i],old=records[i];if(!old.exists())continue;if(b.unlink){if(old.data().accountUid===uid)tx.update(b.ref,{accountUid:'',updatedAt:api.serverTimestamp()});}else tx.delete(b.ref);}});}
 await api.deleteDoc(roleRef);return{uid,authDeletionRequired:true};
}

