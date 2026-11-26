import {contributionFor,normalizeContribution,validDate,applyBankPayment} from './contributions.js';
import {fullName,nameKey} from './registration.js';
import {debitAllocations} from './debit-workflow.js';
import {validIBAN,joinedDate,SPARKASSE_COLUMNS} from './debit-export.js';
const hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text))),n=>n.toString(16).padStart(2,'0')).join('');
const cleanBank=row=>({id:row.id,date:row.date,amountCents:row.amountCents,name:String(row.name??'').slice(0,200),iban:String(row.iban??'').slice(0,80),purpose:String(row.purpose??'').slice(0,1000),reference:String(row.reference??'').slice(0,200),bookingText:String(row.bookingText??'').slice(0,200),mandate:String(row.mandate??'').slice(0,80),originalCents:row.originalCents??0});
const csvCell=value=>/[;"\r\n]/.test(String(value))?'"'+String(value).replace(/"/g,'""')+'"':String(value);
export const debitRunCSV=run=>'\uFEFF'+[SPARKASSE_COLUMNS.join(';'),...run.items.map(i=>['SEPA',i.bankName,'',i.iban,'','',(i.amountCents/100).toFixed(2).replace('.',','),i.purpose,i.mandate,i.mandateDate.split('-').reverse().join('.')].map(csvCell).join(';'))].join('\r\n')+'\r\n';
/** Journale bleiben bei Unterbrechungen bestehen. Je Mitglied/Jahresgruppe eine kleine Transaktion. */
export function createDebitWorkflowStore(environment){
 const board=async()=>{const e=environment();await e.requireBoardAccount();return e;};
 const list=async(e,name)=>{const s=await e.api.getDocs(e.api.collection(e.db,name));return s.docs.map(d=>({id:d.id,...d.data()}));};
 const ref=(e,name,id)=>e.api.doc(e.db,name,id),annual=(e,id,year)=>e.api.doc(e.db,'memberContributions',year,'entries',id);
 const ledger=(e,memberId,year,c,old)=>({...normalizeContribution(c),memberId,year,revision:(old?.revision??-1)+1,updatedBy:e.auth.currentUser.uid,updatedAt:e.api.serverTimestamp()});
 const api={
  listDebitRunItems:async()=>list(await board(),'debitRunItems'),
  listDebitSettlements:async()=>list(await board(),'debitSettlements'),
  prepareDebitRun:async report=>{
   const e=await board();if(!report.rows?.length||report.rows.length>1000)throw Error('Bitte 1 bis 1000 Mitglieder auswählen.');
   const items=report.rows.map(r=>{const allocations=debitAllocations(r,report.year);return{memberId:r.memberId,name:r.memberName,bankName:r.name,iban:r.iban,mandate:r.mandate,mandateDate:r.mandateDate,amountCents:r.amountCents,allocations,years:allocations.map(a=>a.year),purpose:r.purpose};});
   if(new Set(items.map(i=>i.memberId)).size!==items.length||items.reduce((n,i)=>n+i.amountCents,0)!==report.totalCents)throw Error('Exportauswahl ist nicht eindeutig.');
   const run={year:report.year,purpose:report.purpose,totalCents:report.totalCents,items,includeFormer:!!report.includeFormer,status:'preparing',revision:0,createdBy:e.auth.currentUser.uid,createdAt:e.api.serverTimestamp(),updatedAt:e.api.serverTimestamp()};
   if(JSON.stringify(run).length>750000)throw Error('Export ist zu groß. Bitte den Zeitraum verkleinern.');
   const id=crypto.randomUUID();await e.api.setDoc(ref(e,'debitExports',id),run);
   try{await api.resumeDebitRun(id);return id;}catch(error){throw Error(error.message+' Exportkennung '+id+'. Die Vorbereitung kann in den Exportnachweisen fortgesetzt oder verworfen werden.');}
  },
  resumeDebitRun:async id=>{
   const e=await board(),runRef=ref(e,'debitExports',id),run=await e.api.getDoc(runRef);if(!run.exists())throw Error('Export fehlt.');if(run.data().status!=='preparing')return;
   for(const item of run.data().items){const itemRef=ref(e,'debitRunItems',await hash(id+'|'+item.memberId));await e.api.runTransaction(e.db,async tx=>{
    const [fresh,old,member]=await Promise.all([tx.get(runRef),tx.get(itemRef),tx.get(ref(e,'members',item.memberId))]);if(old.exists())return;if(fresh.data()?.status!=='preparing'||!member.exists())throw Error('Export oder Mitglied wurde geändert.');const m={id:item.memberId,...member.data()};
    if(!m.active&&!fresh.data().includeFormer||m.bankStatus==='unclear'||String(m.iban).replace(/\s/g,'').toUpperCase()!==item.iban||!validIBAN(item.iban)||m.mandate!==item.mandate||joinedDate(m.joined)!==item.mandateDate||String(m.accountHolder||fullName(m)).trim()!==item.bankName)throw Error('Mitglied oder Bankverbindung wurde geändert: '+item.name);
    const before=[];for(const a of item.allocations){const old=await tx.get(annual(e,item.memberId,a.year)),c=contributionFor(m,a.year,old.exists()?[old.data()]:[]);if(!['open','returned'].includes(c.status)||c.dueCents-c.paidCents!==a.amountCents)throw Error('Beitrag '+a.year+' wurde geändert oder ist bereits vorgemerkt: '+item.name);before.push({year:a.year,data:normalizeContribution(c),revision:c.revision??-1});}
    for(const c of before)tx.set(annual(e,item.memberId,c.year),ledger(e,item.memberId,c.year,{...c.data,status:'pending',method:'debit'},c));
    tx.set(itemRef,{...item,runId:id,status:'prepared',before,createdBy:e.auth.currentUser.uid,createdAt:e.api.serverTimestamp(),updatedAt:e.api.serverTimestamp()});
   });}
   await e.api.runTransaction(e.db,async tx=>{const old=await tx.get(runRef);if(old.data()?.status==='preparing')tx.update(runRef,{status:'prepared',revision:old.data().revision+1,updatedAt:e.api.serverTimestamp()});});
  },
  cancelDebitRun:async id=>{
   const e=await board(),runRef=ref(e,'debitExports',id),run=await e.api.getDoc(runRef);if(!['preparing','prepared','cancelling'].includes(run.data()?.status))throw Error('Bereits bankbestätigte Einzüge können hier nicht verworfen werden.');
   await e.api.runTransaction(e.db,async tx=>{const old=await tx.get(runRef);if(!['preparing','prepared','cancelling'].includes(old.data()?.status))throw Error('Export wurde geändert.');tx.update(runRef,{status:'cancelling',revision:old.data().revision+1,updatedAt:e.api.serverTimestamp()});});
   for(const item of run.data().items){const itemRef=ref(e,'debitRunItems',await hash(id+'|'+item.memberId));await e.api.runTransaction(e.db,async tx=>{const [r,stored]=await Promise.all([tx.get(runRef),tx.get(itemRef)]);if(r.data()?.status!=='cancelling')throw Error('Export wurde geändert.');if(!stored.exists()||stored.data().status==='cancelled')return;if(stored.data().status!=='prepared')throw Error('Ein Auftrag ist bereits bei der Bank bestätigt.');const restore=[];
    for(const before of stored.data().before??[]){const current=await tx.get(annual(e,item.memberId,before.year));if(current.data()?.status!=='pending')continue;if(current.data().revision!==before.revision+1)throw Error('Beitrag '+before.year+' wurde seit der Vorbereitung bearbeitet. Bitte prüfen.');restore.push({before,current:current.data()});}
    for(const {before,current}of restore)tx.set(annual(e,item.memberId,before.year),ledger(e,item.memberId,before.year,before.data,current));tx.update(itemRef,{status:'cancelled',updatedAt:e.api.serverTimestamp()});
   });}
   await e.api.runTransaction(e.db,async tx=>{const old=await tx.get(runRef);tx.update(runRef,{status:'cancelled',revision:old.data().revision+1,updatedAt:e.api.serverTimestamp()});});
  },
  confirmScheduledDebit:async({runId,memberId,order,fileHash,manual=false})=>{
   const e=await board();if(!validDate(order.date)||!order.name||!Number.isInteger(order.amountCents)||order.amountCents<=0||!/^[a-f0-9]{64}$/.test(fileHash))throw Error('Ungültiger PDF-Auftrag.');
   const runRef=ref(e,'debitExports',runId),itemId=await hash(runId+'|'+memberId),itemRef=ref(e,'debitRunItems',itemId);
   return e.api.runTransaction(e.db,async tx=>{const [run,stored,member]=await Promise.all([tx.get(runRef),tx.get(itemRef),tx.get(ref(e,'members',memberId))]);if(!run.exists()||!member.exists()||['cancelled','cancelling','preparing'].includes(run.data().status))throw Error('Export oder Mitglied ist nicht mehr verfügbar.');
    const item=run.data().items.find(i=>i.memberId===memberId),m={id:memberId,...member.data()};if(!item||item.amountCents!==order.amountCents)throw Error('PDF-Betrag stimmt nicht mit dem Export überein.');
    const names=[item.bankName,item.name,m.accountHolder,fullName(m)].filter(Boolean);if(!manual&&!names.some(n=>nameKey(n)===nameKey(order.name)))throw Error('Abweichenden Namen bitte ausdrücklich manuell zuordnen.');
    if(stored.data()?.bankOrder){const old=stored.data().bankOrder;if(old.date===order.date&&old.amountCents===order.amountCents&&nameKey(old.name)===nameKey(order.name))return{already:true};throw Error('Dieser Exportauftrag wurde bereits mit einem anderen Termin bestätigt.');}
    const allocations=debitAllocations(item,run.data().year),updates=[];for(const a of allocations){const current=await tx.get(annual(e,memberId,a.year)),c=contributionFor(m,a.year,current.exists()?[current.data()]:[]);if(!['open','pending','returned','review'].includes(c.status)||c.dueCents-c.paidCents!==a.amountCents)throw Error('Beitrag '+a.year+' passt nicht mehr zum Bankauftrag.');updates.push({year:a.year,c});}
    for(const {year,c}of updates)tx.set(annual(e,memberId,year),ledger(e,memberId,year,{...c,status:'scheduled',method:'debit',date:order.date},c));
    tx.set(itemRef,{...item,bankName:item.bankName||order.name,iban:item.iban||String(m.iban??'').replace(/\s/g,'').toUpperCase(),allocations,runId,status:'scheduled',...(stored.exists()?{before:stored.data().before??[],createdAt:stored.data().createdAt,createdBy:stored.data().createdBy}:{createdAt:e.api.serverTimestamp(),createdBy:e.auth.currentUser.uid}),bankOrder:{name:order.name,date:order.date,amountCents:order.amountCents,fileHash,manual},updatedAt:e.api.serverTimestamp()});
    const scheduled=[...new Set([...(run.data().scheduledMemberIds??[]),memberId])];tx.update(runRef,{scheduledMemberIds:scheduled,status:scheduled.length===run.data().items.length?'submitted':'partial',revision:run.data().revision+1,updatedAt:e.api.serverTimestamp()});return{already:false,id:itemId};
   });
  },
  startDebitSettlement:async(row,itemIds,kind)=>{
   const e=await board();if(!/^[a-f0-9]{64}$/.test(row.id)||!validDate(row.date)||!Number.isInteger(row.amountCents)||Math.abs(row.amountCents)>10000000||!['payment','return'].includes(kind)||kind==='payment'&&row.amountCents<=0||kind==='return'&&row.amountCents>=0||!itemIds.length||itemIds.length>1000||itemIds.some(id=>!/^[a-f0-9]{64}$/.test(id))||new Set(itemIds).size!==itemIds.length)throw Error('Ungültiger Bankabgleich.');
   const groupRef=ref(e,'debitSettlements',row.id),ids=itemIds.slice().sort();
   await e.api.runTransaction(e.db,async tx=>{const [old,legacy]=await Promise.all([tx.get(groupRef),tx.get(ref(e,'contributionTransactions',row.id))]);if(legacy.exists())throw Error('Dieser Umsatz wurde bereits manuell zugeordnet.');if(old.exists()){if(old.data().kind!==kind||JSON.stringify(old.data().itemIds)!==JSON.stringify(ids)||JSON.stringify(old.data().bank)!==JSON.stringify(cleanBank(row)))throw Error('Dieser Umsatz wurde bereits anders zugeordnet.');return;}
    const items=await Promise.all(ids.map(id=>tx.get(ref(e,'debitRunItems',id))));if(items.some(i=>!i.exists()||i.data().status!==(kind==='payment'?'scheduled':'paid')))throw Error('Auswahl enthält bereits bearbeitete oder unbestätigte Aufträge.');const total=items.reduce((n,i)=>n+i.data().amountCents,0),principal=kind==='return'?(row.originalCents||Math.abs(row.amountCents)):row.amountCents;
    if(total!==principal||kind==='return'&&Math.abs(row.amountCents)<principal)throw Error('Bankbetrag und Summe der ausgewählten Aufträge stimmen nicht überein. Gebühren getrennt prüfen.');
    tx.set(groupRef,{bank:cleanBank(row),itemIds:ids,kind,totalCents:total,completedItemIds:[],status:'processing',createdBy:e.auth.currentUser.uid,createdAt:e.api.serverTimestamp(),updatedAt:e.api.serverTimestamp()});
   });return api.resumeDebitSettlement(row.id);
  },
  resumeDebitSettlement:async id=>{
   const e=await board(),groupRef=ref(e,'debitSettlements',id),group=await e.api.getDoc(groupRef);if(!group.exists())throw Error('Abgleich fehlt.');if(group.data().status==='complete')return{already:true};
   for(const itemId of group.data().itemIds){const itemRef=ref(e,'debitRunItems',itemId);await e.api.runTransaction(e.db,async tx=>{const [g,item]=await Promise.all([tx.get(groupRef),tx.get(itemRef)]);if(g.data().completedItemIds.includes(itemId))return;const d=item.data(),kind=g.data().kind,bank=g.data().bank;if(!d||d.status!==(kind==='payment'?'scheduled':'paid'))throw Error('Ein Auftrag wurde inzwischen anders bearbeitet. Abgleich '+id+' bitte prüfen.');
    const member=await tx.get(ref(e,'members',d.memberId));if(!member.exists())throw Error('Mitglied wurde gelöscht. Abgleich bitte prüfen.');const updates=[];
    for(const a of d.allocations){const contribution=await tx.get(annual(e,d.memberId,a.year)),c=contributionFor({id:d.memberId,...member.data()},a.year,contribution.exists()?[contribution.data()]:[]),receiptId=await hash(id+'|'+itemId+'|'+a.year),receiptRef=ref(e,'contributionTransactions',receiptId),old=await tx.get(receiptRef);if(old.exists())throw Error('Widersprüchlicher Teilbeleg. Bitte den Abgleich prüfen.');if(kind==='return'&&c.paidCents<a.amountCents)throw Error('Die Rücklastschrift übersteigt den aktuellen Zahlungsstand '+a.year+'.');
     if(kind==='payment'&&(c.status!=='scheduled'||c.dueCents-c.paidCents!==a.amountCents))throw Error('Der Zahlungsstand '+a.year+' wurde seit der Bankbestätigung geändert. Bitte prüfen; es wurde nichts zusätzlich gutgeschrieben.');
     const portion={...bank,amountCents:kind==='return'?-a.amountCents:a.amountCents,originalCents:kind==='return'?a.amountCents:0},next=applyBankPayment(c,portion,kind);updates.push({year:a.year,c,next,receiptRef,portion});
    }
    for(const u of updates){tx.set(annual(e,d.memberId,u.year),ledger(e,d.memberId,u.year,u.next,u.c));const {id:unused,...bankData}=u.portion;tx.set(u.receiptRef,{...bankData,memberId:d.memberId,year:u.year,kind,paidDelta:u.next.paidCents-u.c.paidCents,settlementId:id,bankAmountCents:bank.amountCents,recordedBy:e.auth.currentUser.uid,createdAt:e.api.serverTimestamp()});}
    if(kind==='return')tx.update(ref(e,'members',d.memberId),{bankStatus:'unclear',bankNote:'Rücklastschrift vom '+bank.date+' · Bankverbindung vor weiteren Einzügen prüfen.',updatedAt:e.api.serverTimestamp()});
    tx.update(itemRef,{status:kind==='payment'?'paid':'returned',...(kind==='payment'?{paymentSettlementId:id}:{returnSettlementId:id}),updatedAt:e.api.serverTimestamp()});const completed=[...g.data().completedItemIds,itemId];tx.update(groupRef,{completedItemIds:completed,status:completed.length===g.data().itemIds.length?'complete':'processing',updatedAt:e.api.serverTimestamp()});
   });}return{already:false};
  }
 };return api;
}

/** Dieselben Abläufe mit In-Memory-Dokumenten für die getrennte Demo. */
export function createMemoryDebitWorkflow({members,contributions,exports,transactions,changed=()=>{}}){
 const extra=new Map(),snapshot=data=>({exists:()=>data!==undefined,data:()=>data===undefined?undefined:structuredClone(data)});
 const all=()=>new Map([...extra,...[...members].map(([id,m])=>['members/'+id,m]),...[...contributions].map(([key,c])=>{const [year,id]=key.split('/');return['memberContributions/'+year+'/entries/'+id,c];}),...[...exports].map(([id,r])=>['debitExports/'+id,r]),...[...transactions].map(([id,r])=>['contributionTransactions/'+id,r])]);
 const put=(path,data)=>{const p=path.split('/');if(p[0]==='members')members.set(p[1],{id:p[1],...data});else if(p[0]==='memberContributions')contributions.set(p[1]+'/'+p[3],data);else if(p[0]==='debitExports')exports.set(p[1],{id:p[1],...data});else if(p[0]==='contributionTransactions')transactions.set(p[1],data);else extra.set(path,data);};
 const api={doc:(_db,...p)=>p.join('/'),collection:(_db,...p)=>p.join('/'),serverTimestamp:()=>Date.now(),getDoc:async path=>snapshot(all().get(path)),getDocs:async path=>({docs:[...all()].filter(([key])=>key.startsWith(path+'/')&&key.split('/').length===path.split('/').length+1).map(([key,data])=>({id:key.split('/').at(-1),data:()=>structuredClone(data)}))}),setDoc:async(path,data)=>put(path,data),runTransaction:async(_db,fn)=>{const pending=[];const result=await fn({get:async path=>snapshot(all().get(path)),set:(path,data)=>pending.push([path,data]),update:(path,data)=>pending.push([path,{...all().get(path),...data}])});for(const[path,data]of pending)put(path,data);changed();return result;}};
 return createDebitWorkflowStore(()=>({api,db:{},auth:{currentUser:{uid:'demo'}},requireBoardAccount:async()=>{}}));
}
