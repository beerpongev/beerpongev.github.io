import {createClubStore} from './club-store.js';
import {normalizePrices} from './pricing.js';
import { firebaseConfig, tournamentId, useEmulators, appCheckSiteKey } from './config.js';
import { runStateTransaction } from './transaction.js';
import {memberInvitationPlan,memberInvitationSnapshot,defaultRegistrationSettings,normalizeRegistration,normalizeMember,reconcileSettings,validatePrivateImport,normalizeApplication,applicationMember,memberProfile,normalizeContact,profileValues,normalizeProfileChange} from './registration.js';
import {bankProfileChanged,profileTime} from './profile-review.js';
import {contributionReviewSnapshot,contributionFor,validYear,normalizeContribution,legacyContribution,applyBankPayment} from './contributions.js';
import {mandateYear,mandateSequence,nextMandate} from './debit-export.js';
import {cancelRegistrationTeam,resolvePlayerAccount} from './team-transfer.js';
import {boardInvitationIssues,boardRegistrationNotifications,cancellationPaymentReview} from './board-alerts.js';
import {createDebitWorkflowStore} from './debit-workflow-store.js';

export const firebaseProjectId=firebaseConfig.projectId;
export const configured = firebaseConfig.apiKey !== 'HIER_EINTRAGEN' && firebaseConfig.projectId !== 'DEIN-PROJEKT';
export const liveCacheKey = `beerpong-live-${firebaseConfig.projectId}`;
let api, authApi, apps, db, auth, secondary, ref,demoGateOnly=false;
export const {prepareDebitRun,resumeDebitRun,cancelDebitRun,confirmScheduledDebit,listDebitRunItems,listDebitSettlements,startDebitSettlement,resumeDebitSettlement}=createDebitWorkflowStore(()=>({api,db,auth,requireBoardAccount}));
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
export async function connect({ onState, onUser, onRole, onUsers, onConnection, onError, onCatalog, onRegistrationSettings, onAccessPending, initialTournamentId=tournamentId, demoGate=false }) {
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
    let userLoginRecorded=false;
    historyApproved=false;onAccessPending?.(true);stopRole(); stopUsers(); onUsers([]); onRole('guest',''); onUser(user);
    if (!user){onAccessPending?.(false);return;}
    stopRole = api.onSnapshot(api.doc(db, 'roles', user.uid), snap => {
      const role = snap.data()?.disabled?'guest':snap.data()?.role ?? 'guest';
      historyApproved=!!user&&!user.isAnonymous&&snap.exists()&&!snap.data()?.disabled&&['guest','player','admin','board'].includes(role);
      onRole(role,snap.data()?.teamId??'',snap.data()?.tournamentId??tournamentId); stopUsers();onUsers([]);onAccessPending?.(false);
      if(!demoGate&&historyApproved&&user.isAnonymous===false&&!userLoginRecorded){userLoginRecorded=true;void recordOwnAppLogin().then(recordOwnAppVisit).catch(onError);}
      if (!demoGate&&role==='board'){
       let directory=[],activity=new Map();const emit=()=>onUsers(directory.map(u=>({...u,lastAppLoginAt:activity.get(u.uid)?.lastLoginAt??null,lastAppSeenAt:activity.get(u.uid)?.lastSeenAt??null})));
       const stopDirectory=api.onSnapshot(api.collection(db,'roles'),list=>{directory=list.docs.map(d=>({uid:d.id,...d.data()}));emit();},onError);
       const stopActivity=api.onSnapshot(api.collection(db,'accountActivity'),list=>{activity=new Map(list.docs.map(d=>[d.id,d.data()]));emit();},onError);
       stopUsers=()=>{stopDirectory();stopActivity();};
      }
    }, error=>{onAccessPending?.(false);onError(error);});
  });
}

/** Genau ein Live-Spielplan pro Gerät; verspätete Antworten alter Listener verwerfen. */
export async function recordOwnAppLogin(){
 liveOnly();const current=auth?.currentUser;if(!current||current.isAnonymous)throw Error('Bitte zuerst anmelden.');
 const token=await authApi.getIdTokenResult(current),seconds=Number(token.claims.auth_time);if(!Number.isSafeInteger(seconds)||seconds<=0)throw Error('Anmeldezeitpunkt konnte nicht ermittelt werden.');
 if(auth.currentUser?.uid!==current.uid)throw Error('Die Anmeldung wurde inzwischen gewechselt.');
 const ref=api.doc(db,'accountActivity',current.uid);
 await api.runTransaction(db,async tx=>{const previous=await tx.get(ref);if((previous.data()?.lastLoginAt??0)>=seconds)return;tx.set(ref,{...previous.data(),lastLoginAt:seconds,updatedAt:api.serverTimestamp()});});
}
/** Ein Nutzungsnachweis pro angemeldetem Konto und Berliner Kalendertag, keine Gäste. */
export async function recordOwnAppVisit(){
 liveOnly();const current=auth?.currentUser;if(!current||current.isAnonymous)throw Error('Bitte zuerst anmelden.');const token=await authApi.getIdTokenResult(current),seconds=Number(token.claims.auth_time);if(!Number.isSafeInteger(seconds)||seconds<=0)throw Error('Anmeldezeit fehlt.');if(auth.currentUser?.uid!==current.uid)throw Error('Anmeldung gewechselt.');
 const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t)),ref=api.doc(db,'accountActivity',current.uid);
 await api.runTransaction(db,async tx=>{const old=await tx.get(ref),last=old.data()?.lastSeenAt?.toMillis?.()??(old.data()?.lastSeenAt?.seconds??0)*1000;if(last&&day(last)===day(Date.now()))return;tx.set(ref,{...old.data(),lastLoginAt:old.data()?.lastLoginAt??seconds,lastSeenAt:api.serverTimestamp(),updatedAt:api.serverTimestamp()});});
}
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
/** Private Inbox: ausschließlich Vorstand, keine PDFs oder Antragsdaten in die UI-Meldungen übernehmen. */
export async function watchNotificationInbox({tournamentIds=[],onItems,onError}){
 await requireBoardAccount();tournamentIds=[...new Set(tournamentIds)];tournamentIds.forEach(checkRegistrationId);const values=new Map(),cancels=[],required=['applications','reviews','profile-changes','members','accounts','member-invitations',...tournamentIds.flatMap(id=>['registrations:'+id,'state:'+id,'invitations:'+id])];let watching=true,failed=false;
 const publish=()=>{if(!watching||failed||required.some(k=>!values.has(k)))return;const reviewed=new Set(values.get('reviews').map(r=>r.id)),groups=tournamentIds.map(id=>({id,rows:values.get('registrations:'+id),state:values.get('state:'+id),invitations:values.get('invitations:'+id)})),issues=boardInvitationIssues({members:values.get('members'),accounts:values.get('accounts').map(a=>({...a,uid:a.id})),memberInvitations:values.get('member-invitations'),groups});onItems([
  ...values.get('applications').filter(a=>!reviewed.has(a.id)).map(a=>({id:'application:'+a.id,title:'Neuer Mitgliedsantrag',detail:'Mitgliedsantrag im Vorstand prüfen.',view:'applications',time:a.createdAt?.toMillis?.()??0})),
  ...values.get('profile-changes').filter(r=>r.status==='pending').map(r=>{const time=r.submittedAt?.toMillis?.()??(r.submittedAt?.seconds??0)*1000;return{id:'profile-change:'+r.id+':'+time,title:'Neue Datenänderung',detail:'Ein Mitglied hat seine Daten geändert. Bitte zur Freigabe prüfen.',view:'applications',time};}),
  ...groups.flatMap(group=>boardRegistrationNotifications(group.rows,group.state,group.id)),
  ...issues.map(r=>({id:'invitation-issue:'+r.id+':'+r.time,title:'Kontoeinladung fehlgeschlagen',detail:r.name,view:r.view,filter:r.filter,tournamentId:r.tournamentId,time:r.time}))
 ]);};
 const watch=(key,ref,document=false)=>cancels.push(api.onSnapshot(ref,s=>{if(!watching||failed)return;values.set(key,document?(s.exists()?s.data():null):s.docs.map(d=>({id:d.id,...d.data()})));publish();},err=>{failed=true;if(watching)onError?.(err);}));
 watch('applications',api.query(api.collection(db,'membershipApplications'),api.orderBy('createdAt','desc'),api.limit(30)));
 watch('reviews',api.collection(db,'membershipReviews'));
 watch('profile-changes',api.query(api.collection(db,'memberProfileChanges'),api.where('status','==','pending')));
 watch('members',api.collection(db,'members'));watch('accounts',api.collection(db,'roles'));watch('member-invitations',api.collection(db,'memberInvitations'));
 for(const id of tournamentIds){checkRegistrationId(id);watch('registrations:'+id,api.collection(db,'tournamentRegistrations',id,'entries'));watch('state:'+id,api.doc(db,'tournaments',id),true);watch('invitations:'+id,api.collection(db,'playerInvitations',id,'entries'));}
 return()=>{watching=false;cancels.forEach(cancel=>cancel());values.clear();};
}
export async function deleteMembership(id){await requireBoardAccount();await api.runTransaction(db,async tx=>{tx.delete(api.doc(db,'membershipApplications',id));tx.delete(api.doc(db,'membershipApplicationPDFs',id));});}

export async function listBoardInvitationIssues(tournamentIds=[tournamentId]){
 await requireBoardAccount();tournamentIds=[...new Set(tournamentIds)];tournamentIds.forEach(checkRegistrationId);
 const [members,accounts,logs,groups]=await Promise.all([listMembers(),listAccounts(),api.getDocs(api.collection(db,'memberInvitations')),Promise.all(tournamentIds.map(async id=>({id,rows:await listRegistrations(id),invitations:(await api.getDocs(api.collection(db,'playerInvitations',id,'entries'))).docs.map(d=>({id:d.id,...d.data()}))}))) ]);
 return boardInvitationIssues({members,accounts,memberInvitations:logs.docs.map(d=>({id:d.id,...d.data()})),groups});
}
export async function reviewCancellationPayment(id,entryId,{paidCents,note}){
 await requireBoardAccount();checkRegistrationId(id);if(typeof entryId!=='string'||!/^[a-zA-Z0-9_-]{1,128}$/.test(entryId))throw Error('Ungültige Anmeldung.');const ref=entryRef(id,entryId);
 await api.runTransaction(db,async tx=>{const old=await tx.get(ref);const review=cancellationPaymentReview(old.data(),paidCents,note);tx.update(ref,{paymentReview:{...review,reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()},updatedAt:api.serverTimestamp()});});
}

const retryTime=t=>t?.toMillis?.()??(typeof t==='number'?t:(t?.seconds??0)*1000);
const retryTargetSnapshot=(kind,target)=>JSON.stringify(kind==='member'?[memberInvitationSnapshot(target)]:[target.status,target.teamId,target.players]);
const retryLogSnapshot=log=>JSON.stringify([log.status,log.email,log.uid??'',log.requestId??'',retryTime(log.updatedAt)]);
/** Read-only: Adresse, Person und bestehende Konten vor der ausdrücklichen Bestätigung neu prüfen. */
export async function previewInvitationRetry(issue){
 await requireBoardAccount();if(!issue||!['member','player'].includes(issue.kind))throw Error('Ungültiger Einladungsversuch.');
 const member=issue.kind==='member',key=member?issue.memberId:issue.entryId;
 if(typeof key!=='string'||!key||key.length>128||key.includes('/'))throw Error('Ungültiger Einladungsversuch.');
 if(!member){checkRegistrationId(issue.tournamentId);if(![1,2].includes(issue.slot))throw Error('Ungültiger Spielerplatz.');}
 const logRef=member?api.doc(db,'memberInvitations',key):api.doc(db,'playerInvitations',issue.tournamentId,'entries',key+'__'+issue.slot),targetRef=member?api.doc(db,'members',key):entryRef(issue.tournamentId,key);
 const [logDoc,targetDoc,members,accounts,persons]=await Promise.all([api.getDoc(logRef),api.getDoc(targetRef),listMembers(),listAccounts(),listPersons()]);
 if(!logDoc.exists()||logDoc.data().status!=='review')throw Error('Dieser Versuch wurde bereits bearbeitet oder läuft gerade. Bitte Aufgaben aktualisieren.');
 if(!targetDoc.exists())throw Error('Mitglied oder Anmeldung ist nicht mehr vorhanden.');
 const log=logDoc.data(),target={id:key,...targetDoc.data()},person=member?target:target.players?.[issue.slot-1],address=String(person?.email??'').trim().toLowerCase();
 if(!person||member&&!target.active||!member&&(target.status!=='confirmed'||!target.teamId))throw Error('Bitte ein aktives Mitglied beziehungsweise ein bestätigtes Spielplanteam verwenden.');
 if(!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(address)||address!==String(log.email??'').trim().toLowerCase())throw Error('Die persönliche E-Mail wurde geändert oder fehlt. Bitte die Zuordnung zuerst in der Verwaltung prüfen.');
 let match,memberId=member?key:'';
 if(member){
  const profiles=await api.getDocs(api.collection(db,'memberProfiles')),row=memberInvitationPlan(members,accounts,[],{persons,profiles:profiles.docs.map(d=>({id:d.id,...d.data()}))}).find(p=>p.memberId===key);
  if(!row||row.kind==='review')throw Error(row?.detail||'Mitglied bitte prüfen.');match=row.uid?{key:'existing',account:accounts.find(a=>a.uid===row.uid)}:{key:'missing'};
 }else{
  const state=await api.getDoc(api.doc(db,'tournaments',issue.tournamentId));if(!state.data()?.teams?.some(t=>t.id===target.teamId))throw Error('Das Spielplanteam fehlt. Bitte zuerst die Teamübernahme prüfen.');
  match=resolvePlayerAccount(person,{directory:accounts,members,identities:persons});if(match.key==='review')throw Error(match.detail);memberId=match.member?.id??'';
 }
 const account=match.account,action=account?'link':'invite',name=member?target.firstName+' '+target.lastName:person.firstName+' '+person.lastName;
 const snapshot=JSON.stringify([retryLogSnapshot(log),retryTargetSnapshot(issue.kind,target),action,account?[account.uid,account.email,account.role,account.teamId??'',account.tournamentId??'',!!account.disabled]:null,memberId]);
 return{kind:issue.kind,memberId,entryId:member?'':key,slot:member?0:issue.slot,tournamentId:member?'':issue.tournamentId,name,email:account?.email||address,action,uid:account?.uid||'',snapshot};
}
/** Genau ein bestätigter Fehlversuch; kein automatischer Wiederholungs- oder Sammelversand. */
export async function retryInvitation(issue,{expectedSnapshot}={}){
 const plan=await previewInvitationRetry(issue);if(typeof expectedSnapshot!=='string'||plan.snapshot!==expectedSnapshot)throw Error('Der Stand wurde seit der Vorschau geändert. Bitte neu prüfen.');
 const member=plan.kind==='member',key=member?issue.memberId:issue.entryId,ref=member?api.doc(db,'memberInvitations',key):api.doc(db,'playerInvitations',plan.tournamentId,'entries',key+'__'+plan.slot),targetRef=member?api.doc(db,'members',key):entryRef(plan.tournamentId,key),requestId=crypto.randomUUID();
 const [logSnapshot,targetSnapshot]=JSON.parse(plan.snapshot);
 await api.runTransaction(db,async tx=>{
  const [old,target]=await Promise.all([tx.get(ref),tx.get(targetRef)]);
  if(!old.exists()||!target.exists()||old.data().status!=='review'||retryLogSnapshot(old.data())!==logSnapshot||retryTargetSnapshot(plan.kind,{id:key,...target.data()})!==targetSnapshot)throw Error('Der Versuch wurde inzwischen bearbeitet. Kein erneuter Versand.');
  tx.set(ref,{...old.data(),status:'processing',requestId,retryCount:(old.data().retryCount??0)+1,requestedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});
 });
 const finish=async(status,uid,error='')=>api.runTransaction(db,async tx=>{const old=await tx.get(ref);if(old.data()?.requestId!==requestId||old.data()?.status!=='processing')throw Error('Der Einladungsstand wurde inzwischen geändert. Bitte prüfen.');tx.set(ref,{...old.data(),status,...(member?{message:error,...(uid?{uid}:{})}:{error}),updatedAt:api.serverTimestamp()});});
 let uid=plan.uid;
 try{
  // Noch einmal lesen: Ein zwischenzeitlich angelegtes Konto darf keine zweite Mail erhalten.
  const accounts=await listAccounts(),existing=accounts.find(a=>plan.uid?a.uid===plan.uid:a.email?.trim().toLowerCase()===plan.email.toLowerCase());
  if(existing?.disabled)throw Error('Das Konto ist gesperrt. Bitte die Zuordnung prüfen.');
  const target=await api.getDoc(targetRef);if(!target.exists()||retryTargetSnapshot(plan.kind,{id:key,...target.data()})!==targetSnapshot)throw Error('Person oder Anmeldung wurde inzwischen geändert. Bitte prüfen.');
  const row=target.data();
  if(existing){uid=existing.uid;if(!member)await setRole(uid,{...existing,role:existing.role==='guest'?'player':existing.role,teamId:row.teamId,tournamentId:plan.tournamentId});}
  else{if(plan.uid)throw Error('Das vorhandene Konto fehlt inzwischen. Bitte prüfen.');uid=await createAccount({email:plan.email,name:plan.name,role:member?'guest':'player',teamId:member?'':row.teamId,...(member?{}:{tournamentId:plan.tournamentId})});}
  const freshTarget=await api.getDoc(targetRef);if(!freshTarget.exists()||retryTargetSnapshot(plan.kind,{id:key,...freshTarget.data()})!==targetSnapshot)throw Error('Person oder Anmeldung wurde während der Kontoeinrichtung geändert. Verknüpfung bitte prüfen.');
  if(!member)await linkParticipationAccount(plan.tournamentId,row.teamId,plan.slot,uid);
  if(plan.memberId)await linkMemberAccount(plan.memberId,uid,member?{expectedInvitationMember:memberInvitationSnapshot({id:key,...row})}:{});
  await finish(member?'sent':'accepted',uid);
  return{uid,sent:!existing,notice:existing?'Vorhandenes Konto verknüpft. Keine neue Passwort-Mail versendet.':'Einladung von Firebase zum Versand angenommen.'};
 }catch(error){const message=String(error.message??error).slice(0,600);try{await finish('review',uid,message);}catch{throw Error(message+' Der Protokollstand muss geprüft werden; bitte nicht blind erneut versenden.');}throw error;}
}

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
  for(const slot of [1,2])tx.delete(api.doc(db,'playerInvitations',id,'entries',entryId+'__'+slot));
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
  if(status==='cancelled'&&old?.status==='cancelled'&&old.paymentReview?.paidCents===row.paidCents)row.paymentReview=old.paymentReview;
  let cancelled=null,stateRef=null;
  if(status==='cancelled')row.teamId=old?.teamId??'';
  if(status==='cancelled'&&old?.teamId){
   stateRef=api.doc(db,'tournaments',id);const [state,info]=await Promise.all([tx.get(stateRef),tx.get(api.doc(db,'tournamentCatalog',id))]);
   cancelled=cancelRegistrationTeam(state.data()??null,old.teamId,{readOnly:!!info.data()?.archived||!!info.data()?.externalUrl});
   if(cancelled.teamRemoval==='removed'){
    // Die Abfrage wird bei jedem Transaktionsversuch wiederholt; alle normalen
    // Zuordnungswege ändern zugleich den bereits gelesenen Spielplan/Eventstand.
    const links=await api.getDocs(api.query(api.collection(db,'tournamentRegistrations',id,'entries'),api.where('teamId','==',old.teamId)));
    const others=await Promise.all(links.docs.filter(d=>d.id!==key).map(d=>tx.get(entryRef(id,d.id))));
    if(others.some(s=>s.exists()&&s.data().teamId===old.teamId&&s.data().status!=='cancelled'))cancelled={state:state.data(),teamRemoval:'shared'};
   }
   row.teamId=cancelled.teamRemoval==='retained'?old.teamId:'';
  }
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
  if(cancelled?.teamRemoval==='removed')tx.set(stateRef,{...cancelled.state,revision:cancelled.state.revision+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});
  tx.set(entryRef(id,key),row);tx.set(eventRef(id),{...reconcileSettings(settings,old,{...row,id:key}),updatedAt:api.serverTimestamp()});return{id:key,...row,...(cancelled?{teamRemoval:cancelled.teamRemoval}:{})};
 });
}
export async function listContributions(year){await requireBoardAccount();if(!validYear(year))throw Error('Ungültiges Beitragsjahr.');const s=await api.getDocs(api.collection(db,'memberContributions',String(year),'entries'));return s.docs.map(d=>({id:d.id,...d.data()}));}
/** Direkte Dokumentabrufe finden auch alte Jahre ohne angelegtes Eltern-Dokument. */
export async function listMemberContributions(memberId){
 await requireBoardAccount();contributionRef(memberId,'2000');
 const snapshots=await Promise.all(Array.from({length:100},(_,i)=>api.getDoc(contributionRef(memberId,String(2000+i)))));
 return snapshots.flatMap((s,i)=>s.exists()?[{...s.data(),memberId,year:String(2000+i)}]:[]);
}
/** Alle geänderten Jahre gemeinsam prüfen und atomar speichern: kein halber Zwischenstand. */
export async function saveMemberContributions(memberId,updates){
 await requireBoardAccount();if(!Array.isArray(updates)||!updates.length||updates.length>100||new Set(updates.map(r=>String(r.year))).size!==updates.length)throw Error('Bitte eindeutige Beitragsjahre auswählen.');
 const rows=updates.map(row=>({ref:contributionRef(memberId,row.year),year:String(row.year),data:normalizeContribution(row.data),snapshot:row.snapshot}));
 return api.runTransaction(db,async tx=>{const [member,previous]=await Promise.all([tx.get(api.doc(db,'members',memberId)),Promise.all(rows.map(r=>tx.get(r.ref)))]);if(!member.exists())throw Error('Das Mitglied ist nicht mehr vorhanden.');
  const m={id:memberId,...member.data()};for(const [i,row]of rows.entries()){const c=contributionFor(m,row.year,previous[i].exists()?[previous[i].data()]:[]);if(contributionReviewSnapshot(m,c)!==row.snapshot)throw Error('Beitrag '+row.year+' oder Mitglied wurde inzwischen geändert. Es wurde nichts gespeichert. Bitte neu öffnen und prüfen.');}
  for(const [i,row]of rows.entries())tx.set(row.ref,{...row.data,memberId,year:row.year,revision:(previous[i].data()?.revision??-1)+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});return rows.length;
 });
}
export async function listMembers(){await requireBoardAccount();const snapshot=await api.getDocs(api.collection(db,'members'));return snapshot.docs.map(d=>({id:d.id,...d.data()}));}
function contributionRef(memberId,year){if(!validYear(year)||!/^[a-zA-Z0-9_-]{1,128}$/.test(memberId))throw Error('Ungültige Mitglieds-ID oder Beitragsjahr.');return api.doc(db,'memberContributions',String(year),'entries',memberId);}
export async function watchContributions(year,onRows,onError){await requireBoardAccount();if(!validYear(year))throw Error('Ungültiges Beitragsjahr.');return api.onSnapshot(api.collection(db,'memberContributions',String(year),'entries'),s=>onRows(s.docs.map(d=>({id:d.id,...d.data()}))),onError);}
/** CSV-Abgleich prüft Mitglied und Jahresstand zusammen innerhalb der Transaktion. */
export async function saveReviewedContribution(memberId,year,input,snapshot){
 await requireBoardAccount();if(!validYear(year)||!/^[a-zA-Z0-9_-]{1,128}$/.test(memberId)||typeof snapshot!=='string'||snapshot.length>10000)throw Error('Ungültiger Beitrags-Prüfstand.');
 const ref=api.doc(db,'memberContributions',String(year),'entries',memberId),desired=normalizeContribution(input);
 return api.runTransaction(db,async tx=>{
  const [member,old]=await Promise.all([tx.get(api.doc(db,'members',memberId)),tx.get(ref)]);if(!member.exists())throw Error('Mitglied nicht mehr vorhanden.');
  const m={id:memberId,...member.data()},current=contributionFor(m,String(year),old.exists()?[{...old.data(),memberId}]:[]);
  if(JSON.stringify(normalizeContribution(current))===JSON.stringify(desired))return{already:true};
  if(contributionReviewSnapshot(m,current)!==snapshot)throw Error('Beitrag oder Mitglied wurde inzwischen geändert. Bitte neu exportieren und prüfen.');
  tx.set(ref,{...desired,memberId,year:String(year),revision:(old.data()?.revision??-1)+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});return{already:false};
 });
}
export async function saveContribution(memberId,year,input,expectedRevision){
 await requireBoardAccount();const ref=contributionRef(memberId,year),data=normalizeContribution(input);
 await api.runTransaction(db,async tx=>{const [member,old]=await Promise.all([tx.get(api.doc(db,'members',memberId)),tx.get(ref)]);if(!member.exists())throw Error('Mitglied nicht mehr vorhanden.');if((old.data()?.revision??-1)!==expectedRevision)throw Error('Der Beitrag wurde inzwischen geändert. Bitte neu öffnen.');tx.set(ref,{...data,memberId,year:String(year),revision:(old.data()?.revision??-1)+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});});
}
/** Genau eine bestätigte Buchung; derselbe CSV-Umsatz wird auch bei erneuter Datei nicht doppelt gezählt. */
export async function recordContributionPayment(memberId,year,row,kind){
 await requireBoardAccount();if(!/^[a-f0-9]{64}$/.test(row.id))throw Error('Ungültige Buchungskennung.');const ref=contributionRef(memberId,year),receipt=api.doc(db,'contributionTransactions',row.id);
 return api.runTransaction(db,async tx=>{const [member,old,previous,workflow]=await Promise.all([tx.get(api.doc(db,'members',memberId)),tx.get(ref),tx.get(receipt),tx.get(api.doc(db,'debitSettlements',row.id))]);if(previous.exists()||workflow.exists())return{duplicate:true};if(!member.exists())throw Error('Mitglied nicht mehr vorhanden.');
  const current=old.exists()?old.data():legacyContribution({id:memberId,...member.data()},year),next=applyBankPayment(current,row,kind);
  tx.set(ref,{...next,memberId,year:String(year),revision:(old.data()?.revision??-1)+1,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});
  if(kind==='return')tx.update(api.doc(db,'members',memberId),{bankStatus:'unclear',bankNote:'Rücklastschrift vom '+row.date+' · Bankverbindung vor weiterem Einzug prüfen.',updatedAt:api.serverTimestamp()});
  const bank={date:row.date,amountCents:row.amountCents,name:String(row.name??'').slice(0,200),iban:String(row.iban??'').slice(0,80),purpose:String(row.purpose??'').slice(0,1000),reference:String(row.reference??'').slice(0,200),bookingText:String(row.bookingText??'').slice(0,200),mandate:String(row.mandate??'').slice(0,80),originalCents:row.originalCents??0};
  tx.set(receipt,{...bank,memberId,year:String(year),kind,paidDelta:next.paidCents-current.paidCents,recordedBy:auth.currentUser.uid,createdAt:api.serverTimestamp()});return{duplicate:false};
 });
}

export async function recordPlayerInvitation(id,entryId,slot,{email,status,error='',requestId}){
 await requireBoardAccount();checkRegistrationId(id);
 if(!/^[a-zA-Z0-9_-]{1,128}$/.test(entryId)||![1,2].includes(slot)||!['processing','accepted','review'].includes(status)||!requestId)throw Error('Ungültiger Einladungsnachweis.');
 const ref=api.doc(db,'playerInvitations',id,'entries',entryId+'__'+slot);
 await api.runTransaction(db,async tx=>{const old=await tx.get(ref);if(status!=='processing'&&old.data()?.requestId!==requestId)throw Error('Der Einladungsstand wurde inzwischen geändert. Bitte prüfen.');tx.set(ref,{entryId,slot,email,status,error:String(error).slice(0,1000),requestId,requestedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});});
}
export async function watchPrivateRegistry(id,{onEntries,onMembers,onInvitations,onAccounts,onError}){
 await requireBoardAccount();checkRegistrationId(id);
 const stopEntries=typeof onEntries==='function'?api.onSnapshot(api.collection(db,'tournamentRegistrations',id,'entries'),s=>onEntries(s.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.sequence-b.sequence)),onError):()=>{};
 const stopMembers=typeof onMembers==='function'?api.onSnapshot(api.collection(db,'members'),s=>onMembers(s.docs.map(d=>({id:d.id,...d.data()}))),onError):()=>{};
 const stopInvitations=typeof onInvitations==='function'?api.onSnapshot(api.collection(db,'playerInvitations',id,'entries'),s=>onInvitations(s.docs.map(d=>({id:d.id,...d.data()}))),onError):()=>{};
 const stopAccounts=typeof onAccounts==='function'?api.onSnapshot(api.collection(db,'roles'),s=>onAccounts(s.docs.map(d=>({uid:d.id,...d.data()}))),onError):()=>{};
 return()=>{stopEntries();stopMembers();stopInvitations();stopAccounts();};
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
/** Fehlerhafte Verzeichniseinträge entfernen; Konten, Sport- und Finanznachweise bleiben erhalten. */
export async function deleteMember(id,{expectedUpdatedAt}={}){
 await requireBoardAccount();if(typeof id!=='string'||!id||id.length>128||id.includes('/'))throw Error('Ungültige Mitglieds-ID.');
 const filter=async(collection,field,value)=>{const s=await api.getDocs(api.query(api.collection(db,collection),api.where(field,'==',value)));return s.docs.map(d=>({path:[collection,d.id],data:d.data()}));};
 const [profiles,changes,persons,events,allMembers,history]=await Promise.all([filter('memberProfiles','memberId',id),filter('memberProfileChanges','memberId',id),filter('persons','memberId',id),api.getDocs(api.collection(db,'registrationEvents')),listMembers(),filter('memberChangeHistory','memberId',id)]);
 const registrations=(await Promise.all(events.docs.map(async event=>{const s=await api.getDocs(api.collection(db,'tournamentRegistrations',event.id,'entries'));return s.docs.filter(d=>d.data().players?.some(p=>p.memberId===id)).map(d=>({path:['tournamentRegistrations',event.id,'entries',d.id]}));}))).flat();
 const bindings=[...profiles.map(r=>({...r,kind:'private'})),...changes.map(r=>({...r,kind:'private'})),...history.map(r=>({...r,kind:'private'})),...persons.map(r=>({...r,kind:'person'})),...registrations.map(r=>({...r,kind:'registration'}))];
 if(bindings.length>400)throw Error('Zu viele Verknüpfungen für eine einzelne Löschung. Bitte die Zuordnungen zuerst getrennt bereinigen.');
 return api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'members',id),counterRef=api.doc(db,'mandateCounters','global');
  const [member,counter,snapshots]=await Promise.all([tx.get(ref),tx.get(counterRef),Promise.all(bindings.map(r=>tx.get(api.doc(db,...r.path))))]);
  if(!member.exists())return{already:true,registrations:0};
  if(expectedUpdatedAt!==undefined&&(member.data().updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Das Mitglied wurde inzwischen geändert. Bitte neu öffnen und prüfen.');
  let count=0;
  for(const [i,binding]of bindings.entries()){
   const s=snapshots[i],data=s.data();if(!s.exists())continue;const target=api.doc(db,...binding.path);
   if(binding.kind==='private'&&data.memberId===id)tx.delete(target);
   if(binding.kind==='person'&&data.memberId===id)tx.update(target,{memberId:'',updatedAt:api.serverTimestamp()});
   if(binding.kind==='registration'&&data.players.some(p=>p.memberId===id)){
    tx.update(target,{players:data.players.map(p=>p.memberId===id?{...p,memberId:'',verified:false,membershipFingerprint:''}:p),updatedAt:api.serverTimestamp()});count++;
   }
  }
  const high=Math.max(mandateSequence(allMembers),mandateSequence([normalizeMember(member.data())]));
  if(high>=120&&high>(counter.data()?.lastNumber??0))tx.set(counterRef,{lastNumber:high,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});
  tx.delete(ref);return{already:false,registrations:count};
 });
}
/** Aufnahme erfolgt ausschließlich nach Vorstandsentscheidung, atomar und einmalig. */
export async function acceptMembership(id,{data,memberId,number,joined,expectedUpdatedAt,accountUid}={}){
 await requireBoardAccount();const target=memberId||'application-'+id,seed=!memberId?mandateSequence(await listMembers()):null;
 const result=await api.runTransaction(db,async tx=>{
  const [application,review,old]=await Promise.all([tx.get(api.doc(db,'membershipApplications',id)),tx.get(api.doc(db,'membershipReviews',id)),tx.get(api.doc(db,'members',target))]);
  if(!application.exists())throw Error('Der Antrag ist nicht mehr vorhanden.');if(review.exists())throw Error('Dieser Antrag wurde bereits bearbeitet.');
  if(!memberId&&old.exists())throw Error('Der Mitgliedsdatensatz existiert bereits. Bitte zuordnen.');
  if(memberId&&!old.exists())throw Error('Das ausgewählte Mitglied existiert nicht mehr.');
  if(expectedUpdatedAt!==undefined&&(old.data()?.updatedAt?.toMillis?.()??null)!==expectedUpdatedAt)throw Error('Das Mitglied wurde inzwischen geändert. Bitte neu prüfen.');
  const member=applicationMember(data??application.data().data,{id:target,existing:old.data(),number,joined,applicationId:id});
  if(accountUid!==undefined){
   if(member.accountUid&&member.accountUid!==accountUid)throw Error('Das Mitglied hat bereits ein Konto. Bitte dieses beibehalten oder später ausdrücklich ändern.');
   if(accountUid){const role=await tx.get(api.doc(db,'roles',accountUid));if(!role.exists()||role.data().disabled)throw Error('Das ausgewählte Konto ist nicht verfügbar.');}
   member.accountUid=accountUid;
  }
  const allocation=!old.exists()?await allocateMandate(tx,member.joined,seed):null,profileRef=member.accountUid?api.doc(db,'memberProfiles',member.accountUid):null,profile=profileRef?await tx.get(profileRef):null;
  if(profile?.exists()&&profile.data().memberId!==target)throw Error('Dieses Konto ist bereits mit einem anderen Mitglied verknüpft.');
  if(allocation){member.mandate=allocation.reference;member.number=String(allocation.number);writeMandateCounter(tx,allocation);}
  const {id:unused,...fields}=member;tx.set(api.doc(db,'members',target),{...fields,updatedAt:api.serverTimestamp()});
  if(profileRef)tx.set(profileRef,{...memberProfile(member,(profile?.data()?.revision??-1)+1),updatedAt:api.serverTimestamp()});
  tx.set(api.doc(db,'membershipReviews',id),{status:'accepted',memberId:target,note:'',reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});return target;
 });
 // Die Aufnahme ist bereits gespeichert; Teilnahmen können anschließend separat verknüpft werden.
 return result;
}
export async function rejectMembership(id,note){
 await requireBoardAccount();if(!String(note).trim())throw Error('Bitte eine interne Begründung angeben.');
 await api.runTransaction(db,async tx=>{const ref=api.doc(db,'membershipReviews',id),[app,review]=await Promise.all([tx.get(api.doc(db,'membershipApplications',id)),tx.get(ref)]);if(!app.exists()||review.exists())throw Error('Antrag fehlt oder wurde bereits bearbeitet.');tx.set(ref,{status:'rejected',memberId:'',note:String(note).trim().slice(0,1000),reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});});
}
/** Globaler Zähler: 120 folgt auf den bisherigen Bestand 119, auch über Jahreswechsel. */
async function allocateMandate(tx,joined,seed){const ref=api.doc(db,'mandateCounters','global'),old=await tx.get(ref);return{...nextMandate(mandateYear(joined),seed,old.data()?.lastNumber??0),ref};}
function writeMandateCounter(tx,allocation){tx.set(allocation.ref,{lastNumber:allocation.number,updatedBy:auth.currentUser.uid,updatedAt:api.serverTimestamp()});}
export async function linkMemberAccount(memberId,uid,{expectedInvitationMember}={}){
 await requireBoardAccount();
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'members',memberId),profileRef=uid?api.doc(db,'memberProfiles',uid):null;
  const [member,role,profile]=await Promise.all([tx.get(ref),uid?tx.get(api.doc(db,'roles',uid)):null,profileRef?tx.get(profileRef):null]);
  if(!member.exists())throw Error('Mitglied nicht gefunden.');if(uid&&(!role.exists()||role.data()?.disabled))throw Error('Bitte ein vorhandenes, nicht gesperrtes Benutzerkonto auswählen.');
  if(expectedInvitationMember!==undefined&&memberInvitationSnapshot({id:memberId,...member.data()})!==expectedInvitationMember)throw Error('Das Mitglied wurde seit der Vorschau geändert. Bitte neu prüfen.');
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
/** Für die Navigation nur den aktiven Status des eigenen verknüpften Profils weitergeben. */
export function watchMyMembership(onActive,onError){
 liveOnly();const user=auth?.currentUser;if(!historyApproved||!user||user.isAnonymous){onActive(false);return()=>{};}
 let watching=true;const stop=api.onSnapshot(api.doc(db,'memberProfiles',user.uid),s=>{if(watching&&auth.currentUser?.uid===user.uid)onActive(s.exists()&&s.data()?.active===true);},error=>{if(watching&&auth.currentUser?.uid===user.uid){onActive(false);onError?.(error);}});
 return()=>{watching=false;stop();};
}
/** Eigenes Profil enthält nur eigene Stammdaten, keine Beiträge oder Vorstandsnotizen. */
export function watchMyProfile(onProfile,onError){
 liveOnly();const user=auth?.currentUser;if(!user||user.isAnonymous){onProfile(null);return()=>{};}
 let profile=null,changeRequest=null;const paint=()=>onProfile(profile?{...profile,changeRequest}:null);
 const a=api.onSnapshot(api.doc(db,'memberProfiles',user.uid),s=>{profile=s.exists()?s.data():null;paint();},onError);
 const b=api.onSnapshot(api.doc(db,'memberProfileChanges',user.uid),s=>{changeRequest=s.exists()?s.data():null;paint();},onError);
 return()=>{a();b();};
}
/** Keine direkten Mitgliedsänderungen: ein Antrag pro verknüpftem Konto. */
export async function saveMyProfile(input,expectedRevision){
 liveOnly();const user=auth?.currentUser;if(!user||user.isAnonymous)throw Error('Bitte mit deinem Mitgliedskonto anmelden.');
 const changes=normalizeProfileChange(input);
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'memberProfiles',user.uid),requestRef=api.doc(db,'memberProfileChanges',user.uid);
  const [old,request]=await Promise.all([tx.get(ref),tx.get(requestRef)]);
  if(!old.exists())throw Error('Dein Konto ist noch nicht verknüpft.');const p=old.data();
  if(p.revision!==expectedRevision)throw Error('Die Daten wurden inzwischen geändert. Bitte neu öffnen.');
  if(!Object.hasOwn(p,'iban'))throw Error('Der Vorstand muss dein Mitgliederprofil einmal aktualisieren. Bitte den Vorstand bitten, „Mitgliedsanträge & Datenänderungen“ zu öffnen.');
  if(request.data()?.status==='pending')throw Error('Deine vorige Änderung wird noch vom Vorstand geprüft.');
  const before=profileValues(p);
  if(JSON.stringify(before)===JSON.stringify(changes))throw Error('Es wurden keine Daten geändert.');
  tx.set(requestRef,{memberId:p.memberId,baseRevision:p.revision,before,changes,status:'pending',submittedAt:api.serverTimestamp(),reviewedAt:null,reviewedBy:'',note:''});
 });
}
/** Beim ersten Öffnen werden ältere private Profile um die eigenen Bankdaten ergänzt. */
export async function listProfileChanges(){
 await requireBoardAccount();const [profiles,members]=await Promise.all([api.getDocs(api.collection(db,'memberProfiles')),listMembers()]);
 for(const row of profiles.docs){if(Object.hasOwn(row.data(),'iban'))continue;const member=members.find(m=>m.accountUid===row.id&&m.id===row.data().memberId);if(!member)continue;
  await api.runTransaction(db,async tx=>{const ref=api.doc(db,'memberProfiles',row.id),m=await tx.get(api.doc(db,'members',member.id)),p=await tx.get(ref);if(m.data()?.accountUid===row.id&&p.exists()&&!Object.hasOwn(p.data(),'iban'))tx.set(ref,{...memberProfile({id:member.id,...m.data()},p.data().revision+1),updatedAt:api.serverTimestamp()});});
 }
 const requests=await api.getDocs(api.collection(db,'memberProfileChanges'));return requests.docs.map(s=>({id:s.id,...s.data()}));
}
export async function listMemberChangeHistory(id){
 await requireBoardAccount();
 const read=async name=>{const data=await api.getDocs(api.query(api.collection(db,name),api.where('memberId','==',id)));return data.docs.map(d=>({id:d.id,...d.data()}));};
 const [history,requests]=await Promise.all([read('memberChangeHistory'),read('memberProfileChanges')]);
 // Bereits freigegebene ältere Anfragen anzeigen, solange sie noch vorhanden sind.
 return [...history,...requests.filter(r=>r.status==='accepted'&&!history.some(h=>h.requestUid===r.id&&h.baseRevision===r.baseRevision)).map(r=>({...r,bankReleased:false}))].sort((a,b)=>profileTime(b.reviewedAt)-profileTime(a.reviewedAt));
}
export async function reviewProfileChange(uid,{status,note='',expectedSubmittedAt,bankReviewConfirmed=false,expectedUpdatedAt}={}){
 await requireBoardAccount();if(!['accepted','rejected'].includes(status))throw Error('Ungültige Entscheidung.');
 if(status==='rejected'&&!note.trim())throw Error('Bitte die Ablehnung kurz begründen.');
 if(bankReviewConfirmed&&(status!=='accepted'||expectedUpdatedAt===undefined))throw Error('Bitte die neue Bankverbindung anhand des aktuellen Mitgliedseintrags ausdrücklich prüfen.');
 const historyId=crypto.randomUUID();
 await api.runTransaction(db,async tx=>{
  const ref=api.doc(db,'memberProfileChanges',uid),request=await tx.get(ref),r=request.data();
  if(!r||r.status!=='pending'||expectedSubmittedAt!==undefined&&(r.submittedAt?.toMillis?.()??null)!==expectedSubmittedAt)throw Error('Die Anfrage wurde inzwischen bearbeitet.');
  if(status==='accepted'){
   const mRef=api.doc(db,'members',r.memberId),pRef=api.doc(db,'memberProfiles',uid),[m,p]=await Promise.all([tx.get(mRef),tx.get(pRef)]);
   if(!m.exists()||m.data().accountUid!==uid||!p.exists()||p.data().memberId!==r.memberId)throw Error('Die Kontoverknüpfung hat sich geändert. Bitte zuerst prüfen.');
   if(p.data().revision!==r.baseRevision||JSON.stringify(profileValues(m.data()))!==JSON.stringify(profileValues(r.before)))throw Error('Die Stammdaten wurden inzwischen geändert. Bitte die Anfrage ablehnen und eine neue Änderung anfordern.');
   const changes=normalizeProfileChange(r.changes),member={...m.data(),...changes};
   if(bankReviewConfirmed){
    if(!bankProfileChanged(r.before,changes)||!changes.iban)throw Error('Die Freigabe benötigt eine geänderte Bankverbindung mit gültiger IBAN.');
    if((profileTime(m.data().updatedAt)||null)!==expectedUpdatedAt)throw Error('Der Mitgliedseintrag oder Bankhinweis wurde inzwischen geändert. Bitte neu laden und prüfen.');
    member.bankStatus='ok';member.bankReviewedAt=api.serverTimestamp();member.bankNote='';
   }
   // Ohne ausdrücklichen Haken bleiben Sperre und frühere Rücklastschrift-Hinweise erhalten.
   tx.update(mRef,{...changes,...(bankReviewConfirmed?{bankStatus:'ok',bankReviewedAt:api.serverTimestamp(),bankNote:''}:{}),updatedAt:api.serverTimestamp()});
   tx.set(pRef,{...memberProfile({id:r.memberId,...member},p.data().revision+1),updatedAt:api.serverTimestamp()});
   tx.set(api.doc(db,'memberChangeHistory',historyId),{memberId:r.memberId,requestUid:uid,baseRevision:r.baseRevision,before:profileValues(r.before),changes,bankReleased:!!bankReviewConfirmed,...(bankReviewConfirmed?{bankNoteBefore:String(m.data().bankNote??'')}:{}),reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});
  }
  tx.update(ref,{status,note:note.trim().slice(0,1000),reviewedBy:auth.currentUser.uid,reviewedAt:api.serverTimestamp()});
 });
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
 await requireBoardAccount();const [members,accounts,log,profiles,persons,events]=await Promise.all([listMembers(),listAccounts(),api.getDocs(api.collection(db,'memberInvitations')),api.getDocs(api.collection(db,'memberProfiles')),listPersons(),api.getDocs(api.collection(db,'registrationEvents'))]);
 const previous=await Promise.all(events.docs.map(d=>api.getDocs(api.collection(db,'playerInvitations',d.id,'entries'))));
 return memberInvitationPlan(members,accounts,log.docs.map(d=>({id:d.id,...d.data()})),{profiles:profiles.docs.map(d=>({id:d.id,...d.data()})),persons,playerInvitations:previous.flatMap(s=>s.docs.map(d=>d.data()))});
}
/** Nur neue Konten erhalten E-Mails. Verknüpfen vorhandener Konten ist ein eigener Schritt. */
export async function sendMemberInvitations(memberIds,{expectedSnapshots=null,canContinue=()=>true,onProgress=()=>{}}={}){
 await requireBoardAccount();if(!Array.isArray(memberIds)||memberIds.length>20)throw Error('Bitte höchstens 20 Einladungen pro Durchlauf.');
 const plan=await previewMemberInvitations(),results=[];
 for(const id of [...new Set(memberIds)]){
  if(!canContinue())break;await requireBoardAccount();
  const item=plan.find(p=>p.memberId===id);
  if(expectedSnapshots&&(!Object.hasOwn(expectedSnapshots,id)||expectedSnapshots[id]!==item?.snapshot)){const result={id,status:'changed',message:'Mitglied oder Konto wurde seit der Vorschau geändert. Kein Versand.'};results.push(result);onProgress(result);break;}
  if(!item?.eligible){const result={id,status:'skipped',message:item?.detail||'Nicht mehr verfügbar.'};results.push(result);onProgress(result);continue;}
  if(item.kind==='link'){
   try{await linkMemberAccount(id,item.uid,{expectedInvitationMember:item.memberSnapshot});const result={id,status:'linked',uid:item.uid};results.push(result);onProgress(result);}
   catch(error){const result={id,status:'review',message:String(error.message??error)};results.push(result);onProgress(result);break;}
   continue;
  }
  const ref=api.doc(db,'memberInvitations',id);
  const claimed=await api.runTransaction(db,async tx=>{const [old,member]=await Promise.all([tx.get(ref),tx.get(api.doc(db,'members',id))]);if(old.exists()||!member.exists()||memberInvitationSnapshot({id,...member.data()})!==item.memberSnapshot)return false;tx.set(ref,{status:'processing',email:item.loginEmail,updatedAt:api.serverTimestamp()});return true;});
  if(!claimed){const result={id,status:'changed',message:'Vorgang bereits begonnen oder Mitglied geändert. Kein erneuter Versand.'};results.push(result);onProgress(result);break;}
  let uid='';
  try{
   uid=await createAccount({email:item.email,name:item.name,role:'guest',teamId:''});await linkMemberAccount(id,uid,{expectedInvitationMember:item.memberSnapshot});
   await api.runTransaction(db,async tx=>{const old=await tx.get(ref);tx.set(ref,{...old.data(),status:'sent',uid,updatedAt:api.serverTimestamp()});});const result={id,status:'sent',uid};results.push(result);onProgress(result);
  }catch(error){const message=String(error.message??error).slice(0,600);await api.runTransaction(db,async tx=>{const old=await tx.get(ref);tx.set(ref,{...old.data(),status:'review',...(uid?{uid}:{}),message,updatedAt:api.serverTimestamp()});});const result={id,status:'review',message};results.push(result);onProgress(result);break;}
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
 bindings.push({ref:api.doc(db,'memberProfiles',uid),unlink:false},{ref:api.doc(db,'memberProfileChanges',uid),unlink:false},{ref:api.doc(db,'accountActivity',uid),unlink:false});
 for(let offset=0;offset<bindings.length;offset+=100){const batch=bindings.slice(offset,offset+100);await api.runTransaction(db,async tx=>{const records=await Promise.all(batch.map(b=>tx.get(b.ref)));for(let i=0;i<batch.length;i++){const b=batch[i],old=records[i];if(!old.exists())continue;if(b.unlink){if(old.data().accountUid===uid)tx.update(b.ref,{accountUid:'',updatedAt:api.serverTimestamp()});}else tx.delete(b.ref);}});}
 await api.deleteDoc(roleRef);return{uid,authDeletionRequired:true};
}

