import { firebaseConfig, tournamentId, useEmulators } from './config.js';
import { runStateTransaction } from './transaction.js';

export const configured = firebaseConfig.apiKey !== 'HIER_EINTRAGEN' && firebaseConfig.projectId !== 'DEIN-PROJEKT';
export const liveCacheKey = `beerpong-live-${firebaseConfig.projectId}`;
let api, authApi, apps, db, auth, secondary, ref,demoGateOnly=false;
function liveOnly(){if(demoGateOnly)throw new Error('Echte Daten und Kontovorgänge sind in der Online-Demo gesperrt.');}
async function requireBoardAccount(){
  liveOnly();
  if(!auth?.currentUser?.uid)throw new Error('Die Benutzerverwaltung ist dem Vorstand vorbehalten.');
  const own=await api.getDoc(api.doc(db,'roles',auth.currentUser.uid));
  if(own.data()?.role!=='board')throw new Error('Die Benutzerverwaltung ist dem Vorstand vorbehalten.');
}

/** Die Online-Demo verwendet Firebase nur für Anmeldung und Prüfung der eigenen Rolle. */
export async function connect({ onState, onUser, onRole, onUsers, onConnection, onError, demoGate=false }) {
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
  if(!demoGate)api.onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
    onConnection(!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites);
    if (snapshot.exists()) onState(snapshot.data());
    else if (!snapshot.metadata.fromCache) onState(null);
  }, error => { onConnection(false); onError(error); });
  let stopRole = () => {}, stopUsers = () => {};
  authApi.onAuthStateChanged(auth, user => {
    stopRole(); stopUsers(); onUsers([]); onRole('guest',''); onUser(user);
    if (!user) return;
    stopRole = api.onSnapshot(api.doc(db, 'roles', user.uid), snap => {
      const role = snap.data()?.role ?? 'guest';
      onRole(role,snap.data()?.teamId??''); stopUsers();onUsers([]);
      if (!demoGate&&role==='board') stopUsers = api.onSnapshot(api.collection(db, 'roles'), list => onUsers(list.docs.map(d => ({ uid: d.id, ...d.data() }))), onError);
    }, onError);
  });
}

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
export async function saveMembershipPDF(bytes, filename) {
  liveOnly();
  if(!db)throw new Error('Firebase ist noch nicht verbunden. Bitte kurz warten.');
  if(bytes.length>900000)throw new Error('Der Antrag ist zu groß (maximal 900 KB).');
  if(!auth.currentUser)await authApi.signInAnonymously(auth);
  await api.addDoc(api.collection(db,'membershipApplications'),{
    owner:auth.currentUser.uid,filename,pdf:api.Bytes.fromUint8Array(bytes),createdAt:api.serverTimestamp()
  });
}
export async function listMemberships(){
  liveOnly();
  const rows=await api.getDocs(api.collection(db,'membershipApplications'));
  return rows.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds??0)-(a.createdAt?.seconds??0));
}
export async function deleteMembership(id){liveOnly();await api.deleteDoc(api.doc(db,'membershipApplications',id));}

/** Optimistische Konkurrenzkontrolle plus Firestore-Transaktion: kein Lost Update. */
export async function mutate(transform, expectedRevision, { id, baseline, match } = {}) {
  liveOnly();
  return runStateTransaction(api, db, ref, auth.currentUser.uid, transform, expectedRevision, { id, baseline, match });
}

/** Zweite Auth-Instanz: das Vorstandskonto bleibt beim Anlegen angemeldet.
 * Kontenerstellung in Auth ist öffentlich erreichbar; Rechte gibt es nur über /roles.
 * Auth und Firestore haben keine gemeinsame Transaktion: bei Fehler zurückrollen.
 */
export async function createAccount({ email, name, role, teamId = '' }) {
  liveOnly();
  await requireBoardAccount();
  const secondaryAuth = authApi.getAuth(secondary);
  // Dieses zufällige Geheimnis wird weder angezeigt noch gespeichert oder verschickt.
  // Der Empfänger erhält ausschließlich den Firebase-Link zum eigenen Passwort.
  const bytes=crypto.getRandomValues(new Uint8Array(32)),secret='Aa1!'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  let created,roleCreated=false;
  try {
    created = (await authApi.createUserWithEmailAndPassword(secondaryAuth, email.trim(), secret)).user;
    await api.setDoc(api.doc(db, 'roles', created.uid), { name: name.trim(), email: email.trim(), role, teamId:role==='player'?teamId:'' });
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
}
export const inviteAccount=email=>{liveOnly();return requireBoardAccount().then(()=>authApi.sendPasswordResetEmail(auth,email.trim(),{url:new URL('./',location.href).href}));};

export async function setRole(uid, data) {
  liveOnly();
  await requireBoardAccount();
  if(uid.trim()===auth.currentUser.uid){const own=await api.getDoc(api.doc(db,'roles',uid.trim()));if(data.role!==own.data()?.role)throw new Error('Die eigene Leitungsrolle kann hier nicht geändert werden.');}
  await api.setDoc(api.doc(db, 'roles', uid.trim()), { name: data.name.trim(), email: data.email.trim(), role: data.role,teamId:data.role==='player'?data.teamId:'' });
}
