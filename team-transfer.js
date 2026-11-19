/** Abgleich vorhandener App-Konten; Login-Adresse und Mitgliedskontakt bleiben getrennt. */
export function resolvePlayerAccount(person,{directory=null,members=[],identities=[]}={}){
 if(!Array.isArray(directory))return{key:'loading'};
 const email=String(person.email??'').trim().toLowerCase(),identity=identities.find(p=>p.id===person.personId)||identities.find(p=>email&&p.email?.toLowerCase()===email),member=members.find(m=>m.id===person.memberId),uid=identity?.accountUid||member?.accountUid;
 const byEmail=directory.filter(u=>email&&u.email?.trim().toLowerCase()===email),linked=uid?directory.find(u=>u.uid===uid):null;
 if(byEmail.length>1||uid&&(!linked||byEmail.some(u=>u.uid!==uid)))return{key:'review',detail:'Kontoverknüpfung widersprüchlich oder Konto fehlt. Bitte Benutzerzuordnung prüfen.'};
 const account=linked||byEmail[0];if(account?.disabled)return{key:'review',detail:'Konto gesperrt / Kontobereinigung offen.'};
 return account?{key:'existing',account,member}:{key:'missing',member};
}
/** Nur nach ausdrücklichem Auftrag aus der Vorstandssicht aufrufen. */
export async function inviteRegistrationPlayers(cloud,row,{identities,members,directory,tournamentId,canInvite=()=>false}){
 const report={created:0,existing:0,recipients:[]};
 for(const [slot,person] of row.players.entries()){
  const requestId=globalThis.crypto.randomUUID();let recipient=person.email,started=false;
  try{
   if(!canInvite())throw Error('Vorstandsberechtigung fehlt.');
   const match=resolvePlayerAccount(person,{identities,members,directory});if(match.key==='review')throw Error(match.detail);
   const existing=match.account,member=match.member;
   recipient=existing?.email||person.email;
   const data={name:person.firstName+' '+person.lastName,email:recipient,role:existing?.role==='guest'?'player':existing?.role||'player',teamId:row.teamId,tournamentId};
   if(existing){
    await cloud.setRole(existing.uid,data);await cloud.linkParticipationAccount(tournamentId,row.teamId,slot+1,existing.uid);if(member)await cloud.linkMemberAccount(member.id,existing.uid);
    report.existing++;
   }else{
    await cloud.recordPlayerInvitation(tournamentId,row.id,slot+1,{email:recipient,status:'processing',requestId});started=true;
    const uid=await cloud.createAccount(data);report.created++;report.recipients.push(person.email);
    await cloud.linkParticipationAccount(tournamentId,row.teamId,slot+1,uid);if(member)await cloud.linkMemberAccount(member.id,uid);
   }
   if(started)await cloud.recordPlayerInvitation(tournamentId,row.id,slot+1,{email:recipient,status:'accepted',requestId});
  }catch(error){let logError='';if(started)try{await cloud.recordPlayerInvitation(tournamentId,row.id,slot+1,{email:recipient,status:'review',error:error.message||String(error),requestId});}catch{logError=' Der Protokollstand konnte nicht gespeichert werden; Versandstatus bitte prüfen.';}const failure=new Error('Einladung für '+person.firstName+' '+person.lastName+' fehlgeschlagen: '+(error.message||error)+'. Bis dahin von Firebase angenommene Versandaufträge: '+report.recipients.length+(report.recipients.length?' ('+report.recipients.join(', ')+')':'')+'. Bereits erfolgte Verknüpfungen bleiben erhalten. Bitte den Stand vor einem erneuten Versand prüfen.'+logError);failure.cause=error;throw failure;}
 }
 return{...report,notice:'Vorhandene Konten verknüpft: '+report.existing+' (ohne E-Mail). Neue Konten: '+report.created+'. '+(report.recipients.length?report.recipients.length+' Einladungsaufträge für neue Konten von Firebase angenommen: '+report.recipients.join(', ')+'. Das bestätigt keine Zustellung.':'Keine Einladungsmails notwendig oder angefordert.')};
}
/** Gemeinsame Transformation für Live-Transaktion und Demo; nie vertrauliche Nachnamen veröffentlichen. */
export function transferRegistrationTeam(state,row,targetId){
 if(state?.phase!=='setup'||row.status!=='confirmed')throw Error('Nur bestätigte Anmeldungen können vor Turnierbeginn übernommen werden.');
 const next=structuredClone(state);let existing=next.teams.find(t=>t.id===targetId);
 if(next.teams.some(t=>t.id!==targetId&&t.name.trim().toLocaleLowerCase('de')===row.teamName.trim().toLocaleLowerCase('de')))throw Error('Ein Team mit diesem Namen existiert bereits. Bitte zuerst zuordnen.');
 if(!existing){existing=next.teams.find(t=>!t.p1&&!t.p2);if(existing)targetId=existing.id;}
 const fields={id:targetId,name:row.teamName,p1:row.players[0].firstName,p2:row.players[1].firstName,group:existing?.group??''};
 if(existing)Object.assign(existing,fields);else{if(next.teams.length>=32)throw Error('Alle 32 Teamplätze sind belegt.');next.teams.push(fields);}
 return{state:next,teamId:targetId};
}
