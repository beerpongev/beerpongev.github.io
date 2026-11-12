import { firebaseConfig, tournamentId, useEmulators } from './config.js';
import { runStateTransaction } from './transaction.js';

export const configured = firebaseConfig.apiKey !== 'HIER_EINTRAGEN' && firebaseConfig.projectId !== 'DEIN-PROJEKT';
export const liveCacheKey = `beerpong-live-${firebaseConfig.projectId}`;
let api, authApi, apps, db, auth, secondary, ref;

/** SDK nur im Livebetrieb laden; die lokale Demo funktioniert auch ohne CDN. */
export async function connect({ onState, onUser, onRole, onUsers, onConnection, onError }) {
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
  if (useEmulators) {
    api.connectFirestoreEmulator(db, '127.0.0.1', 8080);
    authApi.connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    authApi.connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  }
  ref = api.doc(db, 'tournaments', tournamentId);
  api.onSnapshot(ref, { includeMetadataChanges: true }, snapshot => {
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
      if (role === 'admin') stopUsers = api.onSnapshot(api.collection(db, 'roles'), list => onUsers(list.docs.map(d => ({ uid: d.id, ...d.data() }))), onError);
    }, onError);
  });
}

export const login = (email, password) => authApi.signInWithEmailAndPassword(auth, email.trim(), password);
export const logout = () => authApi.signOut(auth);

// Private PDF-Ablage, getrennt vom öffentlich lesbaren Turnierdokument.
export async function saveMembershipPDF(bytes, filename) {
  if(!db)throw new Error('Firebase ist noch nicht verbunden. Bitte kurz warten.');
  if(bytes.length>900000)throw new Error('Der Antrag ist zu groß (maximal 900 KB).');
  if(!auth.currentUser)await authApi.signInAnonymously(auth);
  await api.addDoc(api.collection(db,'membershipApplications'),{
    owner:auth.currentUser.uid,filename,pdf:api.Bytes.fromUint8Array(bytes),createdAt:api.serverTimestamp()
  });
}
export async function listMemberships(){
  const rows=await api.getDocs(api.collection(db,'membershipApplications'));
  return rows.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds??0)-(a.createdAt?.seconds??0));
}
export async function deleteMembership(id){await api.deleteDoc(api.doc(db,'membershipApplications',id));}

/** Optimistische Konkurrenzkontrolle plus Firestore-Transaktion: kein Lost Update. */
export async function mutate(transform, expectedRevision, { id, baseline, match } = {}) {
  return runStateTransaction(api, db, ref, auth.currentUser.uid, transform, expectedRevision, { id, baseline, match });
}

/** Zweite Auth-Instanz: das Admin-Konto bleibt beim Anlegen angemeldet.
 * Kontenerstellung in Auth ist öffentlich erreichbar; Rechte gibt es nur über /roles.
 * Auth und Firestore haben keine gemeinsame Transaktion: bei Fehler zurückrollen.
 */
export async function createAccount({ email, password, name, role, teamId = '' }) {
  const secondaryAuth = authApi.getAuth(secondary);
  let created;
  try {
    created = (await authApi.createUserWithEmailAndPassword(secondaryAuth, email.trim(), password)).user;
    await api.setDoc(api.doc(db, 'roles', created.uid), { name: name.trim(), email: email.trim(), role, teamId:role==='player'?teamId:'' });
  } catch (error) {
    if (created) {
      try { await authApi.deleteUser(created); }
      catch { throw new Error(`Rollenvergabe fehlgeschlagen. Konto ${email} wurde eventuell ohne Rechte angelegt. In Firebase Authentication prüfen und anschließend dessen UID im Panel zuweisen.`); }
    }
    throw error;
  } finally { await authApi.signOut(secondaryAuth); }
}

export async function setRole(uid, data) {
  if (uid === auth.currentUser.uid && data.role !== 'admin') throw new Error('Die eigene Admin-Rolle kann hier nicht entfernt werden.');
  await api.setDoc(api.doc(db, 'roles', uid.trim()), { name: data.name.trim(), email: data.email.trim(), role: data.role,teamId:data.role==='player'?data.teamId:'' });
}
