// Ausschließlich erfundene Beispieldaten im Arbeitsspeicher, keine echte Ablage.
import {defaultRegistrationSettings,normalizeMember,normalizeRegistration,reconcileSettings,validatePrivateImport,applicationMember,memberProfile,normalizeContact} from './registration.js';
export function createDemoRegistry(){
 const events=new Map(),entries=new Map(),members=new Map(),applications=[{id:'demo-application',filename:'Demo-Antrag.pdf',data:{firstName:'Mika',lastName:'Beispiel',birthDate:'2000-01-02',email:'mika@example.test',phone:'0123456789',street:'Beispielweg 1',postalCode:'21423',city:'Musterstadt',occupation:'',bank:'Beispielbank',iban:'DE89370400440532013000',accountHolder:'',applicationPlace:'Musterstadt',applicationDate:'2026-11-17',debitPlace:'Musterstadt',debitDate:'2026-11-17'}}];
 const getEvent=id=>{if(!events.has(id)){events.set(id,{...defaultRegistrationSettings(),open:true});entries.set(id,[]);}return events.get(id);};
 members.set('example-1',{id:'example-1',...normalizeMember({number:'D01',firstName:'Alex',lastName:'Beispiel',email:'alex@example.test',active:true})});
 members.set('example-2',{id:'example-2',...normalizeMember({number:'D02',firstName:'Kim',lastName:'Muster',email:'kim@example.test',active:false})});
 const copy=x=>structuredClone(x);
 const api={
  getSettings:id=>copy(getEvent(id)),
  initializeRegistration:async id=>{getEvent(id);},
  configureRegistration:async(id,patch)=>{const s=getEvent(id);if(patch.capacity<s.confirmedCount||patch.capacity<1||patch.capacity>32)throw Error('Ungültige Kapazität.');Object.assign(s,patch,{revision:s.revision+1});},
  submitRegistration:async(id,input)=>{const s=getEvent(id);if(!s.open)throw Error('Die Anmeldung ist geschlossen.');return api.saveRegistration(id,normalizeRegistration(input),{status:s.confirmedCount<s.capacity&&!s.waitlistCount?'confirmed':'waitlist',source:'online'});},
  listRegistrations:async id=>{getEvent(id);return copy(entries.get(id));},
  saveRegistration:async(id,input,{entryId,status='confirmed',source='board',sourceDate=''}={})=>{
   const s=getEvent(id),rows=entries.get(id),old=rows.find(r=>r.id===entryId),key=entryId??crypto.randomUUID();
   const row={...normalizeRegistration(input,{board:true,allowMissingEmail:true}),id:key,status,sequence:old?.sequence??s.nextSequence+1,source:old?.source??source,sourceDate:old?.sourceDate??sourceDate};
   events.set(id,reconcileSettings(s,old,row));if(old)Object.assign(old,row);else rows.push(row);return copy(row);
  },
  listMembers:async()=>copy([...members.values()]),
  listMemberships:async()=>copy(applications),
  deleteMembership:async id=>{const i=applications.findIndex(a=>a.id===id);if(i>=0)applications.splice(i,1);},
  acceptMembership:async(id,options)=>{const a=applications.find(a=>a.id===id);if(!a||a.review)throw Error('Antrag fehlt oder wurde bereits bearbeitet.');const key=options.memberId||'application-'+id,m=applicationMember(options.data??a.data,{id:key,existing:members.get(key),number:options.number,joined:options.joined,applicationId:id});members.set(key,m);a.review={status:'accepted',memberId:key};return key;},
  rejectMembership:async(id,note)=>{const a=applications.find(a=>a.id===id);if(!a||a.review)throw Error('Antrag fehlt oder wurde bereits bearbeitet.');a.review={status:'rejected',memberId:'',note};},
  linkMemberAccount:async(id,uid)=>{if([...members.values()].some(m=>m.id!==id&&m.accountUid===uid&&uid))throw Error('Konto bereits verknüpft.');members.get(id).accountUid=uid;},
  watchMyProfile:callback=>{const m=[...members.values()].find(m=>m.accountUid==='demo-member');callback(m?memberProfile(m,0):null);return()=>{};},
  saveMyProfile:async input=>{const m=[...members.values()].find(m=>m.accountUid==='demo-member');if(!m)throw Error('Kein verknüpftes Mitglied.');Object.assign(m,normalizeContact(input));},
  saveMember:async(id,input)=>{const key=id??crypto.randomUUID();members.set(key,{id:key,...normalizeMember(input)});return key;},
  importPrivateRecords:async(input,onProgress=()=>{})=>{const data=validatePrivateImport(input);let addedMembers=0,addedEntries=0;for(const m of data.members){if(!members.has(m.id)){await api.saveMember(m.id,m);addedMembers++;onProgress(addedMembers,addedEntries);}}for(const r of data.registrations){if((await api.listRegistrations(data.tournamentId)).some(x=>x.id===r.id))continue;const s=getEvent(data.tournamentId);await api.saveRegistration(data.tournamentId,r,{entryId:r.id,status:s.confirmedCount<s.capacity&&!s.waitlistCount?'confirmed':'waitlist',source:'import',sourceDate:r.sourceDate});addedEntries++;onProgress(addedMembers,addedEntries);}return{addedMembers,addedEntries};}
 };
 getEvent('main');api.saveRegistration('main',{teamName:'Demo-Duo',email:'alex@example.test',players:[{firstName:'Alex',lastName:'Beispiel',email:'alex@example.test',member:true,claimedMember:true,verified:false},{firstName:'Sam',lastName:'Test',email:'sam@example.test',member:false}],draftBeer:true},{entryId:'demo-entry'});
 return api;
}
