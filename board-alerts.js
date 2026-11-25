/** Reine Vorstandsaufgaben: keine Bankdaten, keine automatischen Konto- oder Geldaktionen. */
const time=x=>x?.toMillis?.()??(typeof x==='number'?x:(x?.seconds??0)*1000);
const email=x=>String(x??'').trim().toLowerCase();
export function transferOutstanding(row,state){return row.status==='confirmed'&&(!row.teamId||!!state&&!state.teams?.some(t=>t.id===row.teamId));}
export function cancellationPaymentOutstanding(row){return row.status==='cancelled'&&row.paidCents>0&&row.paymentReview?.paidCents!==row.paidCents;}
export function cancellationPaymentReview(row,expectedPaidCents,note){
 if(!row||row.status!=='cancelled'||row.paidCents<=0||row.paidCents!==expectedPaidCents)throw Error('Absage oder Zahlung wurde inzwischen geändert. Bitte neu prüfen.');
 note=String(note??'').trim();if(!note||note.length>500)throw Error('Bitte das Prüfergebnis in höchstens 500 Zeichen festhalten.');
 return{paidCents:row.paidCents,note};
}
export function boardInvitationIssues({members=[],accounts=[],memberInvitations=[],groups=[]}={}){
 accounts=accounts??[];
 const known=(address,uid)=>accounts.some(a=>!a.disabled&&(uid?a.uid===uid:email(a.email)===email(address)));
 const memberIssues=memberInvitations.filter(r=>r.status==='review').flatMap(r=>{const m=members.find(m=>m.id===r.id);return !m||known('',m.accountUid||'@missing')?[]:[{id:'member:'+r.id,kind:'member',memberId:m.id,name:m.firstName+' '+m.lastName,email:r.email,error:r.message||'Kontoeinrichtung oder Einladung prüfen.',time:time(r.updatedAt),view:'accounts'}];});
 return [...memberIssues,...groups.flatMap(group=>(group.invitations??[]).filter(r=>r.status==='review').flatMap(r=>{
  const row=group.rows.find(e=>e.id===r.entryId),p=row?.players?.[r.slot-1],m=p?.memberId?members.find(m=>m.id===p.memberId):null;
  if(!row||row.status==='cancelled'||!p||email(p.email)!==email(r.email)||known(r.email)||m?.accountUid&&known('',m.accountUid))return[];
  return[{id:'player:'+group.id+':'+r.id,kind:'player',tournamentId:group.id,entryId:row.id,name:row.teamName,email:r.email,error:r.error||'Kontoeinrichtung oder Einladung prüfen.',time:time(r.updatedAt),view:'registrations',filter:'invitation-review'}];
 }))].sort((a,b)=>b.time-a.time);
}
export function boardRegistrationNotifications(rows,state,tournamentId){
 return rows.flatMap(r=>{
  const base={tournamentId,view:'registrations',detail:r.teamName,time:time(r.updatedAt)||time(r.createdAt)};
  if(cancellationPaymentOutstanding(r))return[{...base,id:`cancel-payment:${tournamentId}:${r.id}:${base.time}`,title:'Zahlung nach Absage prüfen',filter:'cancel-payment'}];
  if(r.status==='cancelled')return[];
  if(transferOutstanding(r,state))return[{...base,id:`transfer:${tournamentId}:${r.id}:${r.teamId||'new'}`,title:r.teamId?'Spielplanteam fehlt':'Neue Turnieranmeldung – Teamübernahme offen',filter:'transfer-open'}];
  if(r.status==='confirmed')return[];
  return[{...base,id:`registration:${tournamentId}:${r.id}`,title:r.status==='waitlist'?'Neue Anmeldung auf der Warteliste':'Neue Turnieranmeldung',time:time(r.createdAt)}];
 });
}
