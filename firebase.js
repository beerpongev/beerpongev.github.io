import { firebaseConfig, tournamentId, useEmulators } from './config.js';
import { runStateTransaction } from './transaction.js';
import {defaultRegistrationSettings,normalizeRegistration,normalizeMember,reconcileSettings,validatePrivateImport,normalizeApplication,applicationMember,memberProfile,normalizeContact} from './registration.js';

export const configured = firebaseConfig.apiKey !== 'HIER_EINTRAGEN' && firebaseConfig.projectId !== 'DEIN-PROJEKT';
export const liveCacheKey = `beerpong-live-${firebaseConfig.projectId}`;
let api, authApi, apps, db, auth, secondary, ref,demoGateOnly=false;
let stopState=()=>{},stateCallbacks,stateGeneration=0;
function liveOnly(){if(demoGateOnly)throw new Error('Echte Daten und Kontovorgänge sind in der Online-Demo gesperrt.');}
async function requireBoardAccount(){
  liveOnly();
  if(!auth?.currentUser?.uid)throw new Error('Die Benutzerverwaltung ist dem Vorstand vorbehalten.');
  const own=await api.getDoc(api.doc(db,'roles',auth.currentUser.uid));
  if(own.data()?.role!=='board')throw new Error('Die Benutzerverwaltung ist dem Vorstand vorbehalten.');
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
    stopRole(); stopUsers(); onUsers([]); onRole('guest',''); onUser(user);
    if (!user) return;
    stopRole = api.onSnapshot(api.doc(db, 'roles', user.uid), snap => {
      const role = snap.data()?.role ?? 'guest';
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
  liveOnly();
  if(!db)throw new Error('Firebase ist noch nicht verbunden. Bitte kurz warten.');
  if(bytes.length>900000)throw new Error('Der Antrag ist zu groß (maximal 900 KB).');
  if(!auth.currentUser)await authApi.signInAnonymously(auth);
  await api.addDoc(api.collection(db,'membershipApplications'),{
    owner:auth.currentUser.uid,filename,pdf:api.Bytes.fromUint8Array(bytes),createdAt:api.serverTimestamp(),...(data?{data:normalizeApplication(data)}:{})
  });
}
export async function listMemberships(){
  await requireBoardAccount();
  const [rows,reviews]=await Promise.all([api.getDocs(api.collection(db,'membershipApplications')),api.getDocs(api.collection(db,'membershipReviews'))]);
  const byId=new Map(reviews.docs.map(d=>[d.id,d.data()]));
  return rows.docs.map(d=>({id:d.id,...d.data(),review:byId.get(d.id)??null})).sort((a,b)=>(b.createdAt?.seconds??0)-(a.createdAt?.seconds??0));
}
export async function deleteMembership(id){liveOnly();await api.deleteDoc(api.doc(db,'membershipApplications',id));}

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
    await api.setDoc(api.doc(db, 'roles', created.uid), { name: name.trim(), email: email.trim(), role, teamId:role==='player'?teamId:'',tournamentId:assignedTournament });
    roleCreated=true;
    await authApi.sendPasswordResetEmail(secondaryAuth,email.trim(),{url:new URL('./',location.href).href});
  } catch (error) {
    if (created) {
      if(roleCreated){try{await api.deleteDoc(api.doc(db,'roles',created.uid));}catch{/* Konto anschließend weiterhin löschen versuchen. */}}
      try { await authApi.deleteUser(created); }
      catch { throw new Error(`Kontoeinladung fehlgeschlagen. Konto ${email} und dessen Rolle bitte in Firebase prüfen; die automatische Bereinigung war nicht vollständig möglich.`); }
    }
    throw error;
  } finally { await authApi.signOut(secondaryAuth); }
  return created.uid;
}
export const inviteAccount=email=>{liveOnly();return requireBoardAccount().then(()=>authApi.sendPasswordResetEmail(auth,email.trim(),{url:new URL('./',location.href).href}));};

export async function setRole(uid, data) {
  liveOnly();
  await requireBoardAccount();
  if(uid.trim()===auth.currentUser.uid){const own=await api.getDoc(api.doc(db,'roles',uid.trim()));if(data.role!==own.data()?.role)throw new Error('Die eigene Leitungsrolle kann hier nicht geändert werden.');}
  await api.setDoc(api.doc(db, 'roles', uid.trim()), { name: data.name.trim(), email: data.email.trim(), role: data.role,teamId:data.role==='player'?data.teamId:'',tournamentId:data.tournamentId??tournamentId });
}

const eventRef=id=>api.doc(db,'registrationEvents',id);
const entryRef=(id,key)=>api.doc(db,'tournamentRegistrations',id,'entries',key);
function checkRegistrationId(id){if(!/^[a-zA-Z0-9_-]{1,80}$/.test(id))throw Error('Ungültiges Turnier.');}
export async function initializeRegistration(id){
 await requireBoardAccount();checkRegistrationId(id);
 await api.runTransaction(db,async tx=>{const ref=eventRef(id),old=await tx.get(ref);if(!old.exists())tx.set(ref,{...defaultRegistrationSettings(),updatedAt:api.serverTimestamp()});});
}
export async function configureRegistration(id,{open,capacity}){
 await requireBoardAccount();checkRegistrationId(id);
 await api.runTransaction(db,async tx=>{const ref=eventRef(id),old=await tx.get(ref);if(!old.exists())throw Error('Bitte zuerst die Anmeldung einrichten.');const s=old.data();if(!Number.isInteger(capacity)||capacity<1||capacity>32||capacity<s.confirmedCount)throw Error('Die Kapazität darf bestehende Startplätze nicht unterschreiten (maximal 32).');tx.set(ref,{...s,open:!!open,capacity,revision:s.revision+1,updatedAt:api.serverTimestamp()});});
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
  const s=event.data(),status=s.confirmedCount<s.capacity&&s.waitlistCount===0?'confirmed':'waitlist';
  const row={...data,owner:uid,status,sequence:s.nextSequence+1,source:'online',sourceDate:'',consent:true,createdAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()};
  tx.set(ref,row);tx.set(eventRef(id),{...reconcileSettings(s,null,{...row,id:uid}),updatedAt:api.serverTimestamp()});return{id:uid,...row};
 });
}
export async function listRegistrations(id){await requireBoardAccount();checkRegistrationId(id);const snapshot=await api.getDocs(api.collection(db,'tournamentRegistrations',id,'entries'));return snapshot.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.sequence-b.sequence);}
export async function saveRegistration(id,input,{entryId,status='confirmed',source='board',sourceDate='',expectedUpdatedAt}={}){
 await requireBoardAccount();checkRegistrationId(id);const key=entryId??crypto.randomUUID(),data=normalizeRegistration(input,{board:true,allowMissingEmail:true});
 if(!['confirmed','waitlist','cancelled'].includes(status))throw Error('Ungültiger Anmeldestatus.');
 return api.runTransaction(db,async tx=>{
  const [event,existing]=await Promise.all([tx.get(eventRef(id)),tx.get(entryRef(id,key))]);
  if(!event.exists())throw Error('Bitte zuerst die Anmeldung einrichten.');const settings=event.data(),old=existing.exists()?existing.data():null;
  if(expectedUpdatedAt!==undefined&&(old?.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Die Anmeldung wurde inzwischen geändert. Bitte neu öffnen.');
  const row={...data,owner:old?.owner??auth.currentUser.uid,status,sequence:old?.sequence??settings.nextSequence+1,source:old?.source??source,sourceDate:old?.sourceDate??sourceDate,consent:old?.consent??false,createdAt:old?.createdAt??api.serverTimestamp(),updatedAt:api.serverTimestamp()};
  tx.set(entryRef(id,key),row);tx.set(eventRef(id),{...reconcileSettings(settings,old,{...row,id:key}),updatedAt:api.serverTimestamp()});return{id:key,...row};
 });
}
export async function listMembers(){await requireBoardAccount();const snapshot=await api.getDocs(api.collection(db,'members'));return snapshot.docs.map(d=>({id:d.id,...d.data()}));}
export async function watchPrivateRegistry(id,{onEntries,onMembers,onError}){
 await requireBoardAccount();checkRegistrationId(id);
 const stopEntries=api.onSnapshot(api.collection(db,'tournamentRegistrations',id,'entries'),s=>onEntries(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.sequence-b.sequence)),onError);
 const stopMembers=api.onSnapshot(api.collection(db,'members'),s=>onMembers(s.docs.map(d=>({id:d.id,...d.data()}))),onError);
 return()=>{stopEntries();stopMembers();};
}
export async function saveMember(id,input,{expectedUpdatedAt}={}){
 await requireBoardAccount();const key=id??crypto.randomUUID();
 await api.runTransaction(db,async tx=>{const ref=api.doc(db,'members',key),old=await tx.get(ref),previous=old.data();
  if(expectedUpdatedAt!==undefined&&(previous?.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Das Mitglied wurde inzwischen geändert. Bitte neu öffnen.');
  const member=normalizeMember({...input,accountUid:previous?.accountUid??''}),profileRef=member.accountUid?api.doc(db,'memberProfiles',member.accountUid):null,profile=profileRef?await tx.get(profileRef):null;
  tx.set(ref,{...member,updatedAt:api.serverTimestamp()});if(profileRef)tx.set(profileRef,{...memberProfile({id:key,...member},(profile?.data()?.revision??-1)+1),updatedAt:api.serverTimestamp()});
 });return key;
}
/** Aufnahme erfolgt ausschließlich nach Vorstandsentscheidung, atomar und einmalig. */
export async function acceptMembership(id,{data,memberId,number,joined,expectedUpdatedAt}={}){
 await requireBoardAccount();const target=memberId||'application-'+id;
 return api.runTransaction(db,async tx=>{
  const [application,review,old]=await Promise.all([tx.get(api.doc(db,'membershipApplications',id)),tx.get(api.doc(db,'membershipReviews',id)),tx.get(api.doc(db,'members',target))]);
  if(!application.exists())throw Error('Der Antrag ist nicht mehr vorhanden.');if(review.exists())throw Error('Dieser Antrag wurde bereits bearbeitet.');
  if(!memberId&&old.exists())throw Error('Der Mitgliedsdatensatz existiert bereits. Bitte zuordnen.');
  if(memberId&&!old.exists())throw Error('Das ausgewählte Mitglied existiert nicht mehr.');
  if(expectedUpdatedAt!==undefined&&(old.data()?.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Das Mitglied wurde inzwischen geändert. Bitte neu prüfen.');
  const member=applicationMember(data??application.data().data,{id:target,existing:old.data(),number,joined,applicationId:id}),profileRef=member.accountUid?api.doc(db,'memberProfiles',member.accountUid):null,profile=profileRef?await tx.get(profileRef):null;
  const {id:unused,...fields}=member;tx.set(api.doc(db,'members',target),{...fields,updatedAt:api.serverTimestamp()});
  if(profileRef)tx.set(profileRef,{...memberProfile(member,(profile?.data()?.revision??-1)+1),updatedAt:api.serverTimestamp()});
  tx.set(api.doc(db,'membershipReviews',id),{status:'accepted',memberId:target,note:'',reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});return target;
 });
}
export async function rejectMembership(id,note){
 await requireBoardAccount();if(!String(note).trim())throw Error('Bitte eine interne Begründung angeben.');
 await api.runTransaction(db,async tx=>{const ref=api.doc(db,'membershipReviews',id),[app,review]=await Promise.all([tx.get(api.doc(db,'membershipApplications',id)),tx.get(ref)]);if(!app.exists()||review.exists())throw Error('Antrag fehlt oder wurde bereits bearbeitet.');tx.set(ref,{status:'rejected',memberId:'',note:String(note).trim().slice(0,1000),reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});});
}
export async function linkMemberAccount(memberId,uid){
 await requireBoardAccount();
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'members',memberId),profileRef=uid?api.doc(db,'memberProfiles',uid):null;
  const [member,role,profile]=await Promise.all([tx.get(ref),uid?tx.get(api.doc(db,'roles',uid)):null,profileRef?tx.get(profileRef):null]);
  if(!member.exists())throw Error('Mitglied nicht gefunden.');if(uid&&!role.exists())throw Error('Bitte ein vorhandenes Benutzerkonto auswählen.');
  if(profile?.exists()&&profile.data().memberId!==memberId)throw Error('Das Konto gehört bereits zu einem anderen Mitglied.');
  const old=member.data(),next=normalizeMember({...old,accountUid:uid});
  if(old.accountUid&&old.accountUid!==uid)tx.delete(api.doc(db,'memberProfiles',old.accountUid));
  tx.set(ref,{...next,updatedAt:api.serverTimestamp()});if(profileRef)tx.set(profileRef,{...memberProfile({id:memberId,...next},(profile?.data()?.revision??-1)+1),updatedAt:api.serverTimestamp()});
 });
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
 await requireBoardAccount();const data=validatePrivateImport(input);await initializeRegistration(data.tournamentId);
 const existingMembers=new Set((await listMembers()).map(m=>m.id)),existingEntries=new Set((await listRegistrations(data.tournamentId)).map(r=>r.id));
 let addedMembers=0,addedEntries=0;
 for(const member of data.members){if(existingMembers.has(member.id))continue;const{id,...fields}=member;await saveMember(id,fields);addedMembers++;onProgress(addedMembers,addedEntries);}
 for(const row of data.registrations){if(existingEntries.has(row.id))continue;const{id,sourceDate,...fields}=row;const event=await api.getDoc(eventRef(data.tournamentId)),s=event.data();await saveRegistration(data.tournamentId,fields,{entryId:id,status:s.confirmedCount<s.capacity&&s.waitlistCount===0?'confirmed':'waitlist',source:'import',sourceDate});addedEntries++;onProgress(addedMembers,addedEntries);}
 return{addedMembers,addedEntries};
}
