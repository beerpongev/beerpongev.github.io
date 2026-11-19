/** Nur nach ausdrücklichem Auftrag aus der Vorstandssicht aufrufen. */
export async function inviteRegistrationPlayers(cloud,row,{identities,members,directory,tournamentId,canInvite=()=>false}){
 const report={created:0,existing:0,recipients:[]};
 for(const [slot,person] of row.players.entries()){
  const requestId=globalThis.crypto.randomUUID();let recipient=person.email,started=false;
  try{
   if(!canInvite())throw Error('Vorstandsberechtigung fehlt.');
   const identity=identities.find(p=>p.id===person.personId)||identities.find(p=>p.email?.toLowerCase()===person.email.toLowerCase()),member=members.find(m=>m.id===person.memberId);
   const linkedUid=identity?.accountUid||member?.accountUid,existing=directory.find(u=>u.uid===linkedUid)||directory.find(u=>u.email.toLowerCase()===person.email.toLowerCase());
   if(linkedUid&&!existing)throw Error('Das zugeordnete Benutzerkonto fehlt. Bitte die Benutzer-/Personenverknüpfung prüfen.');
   if(existing?.disabled)throw Error('Das Konto wird entfernt. Bitte die Kontobereinigung zuerst abschließen.');
   recipient=existing?.email||person.email;
   await cloud.recordPlayerInvitation(tournamentId,row.id,slot+1,{email:recipient,status:'processing',requestId});started=true;
   const data={name:person.firstName+' '+person.lastName,email:recipient,role:existing?.role==='guest'?'player':existing?.role||'player',teamId:row.teamId,tournamentId};
   if(existing){
    await cloud.setRole(existing.uid,data);await cloud.linkParticipationAccount(tournamentId,row.teamId,slot+1,existing.uid);if(member)await cloud.linkMemberAccount(member.id,existing.uid);
    await cloud.inviteAccount(existing.email);report.existing++;report.recipients.push(existing.email);
   }else{
    const uid=await cloud.createAccount(data);report.created++;report.recipients.push(person.email);
    await cloud.linkParticipationAccount(tournamentId,row.teamId,slot+1,uid);if(member)await cloud.linkMemberAccount(member.id,uid);
   }
   await cloud.recordPlayerInvitation(tournamentId,row.id,slot+1,{email:recipient,status:'accepted',requestId});
  }catch(error){let logError='';if(started)try{await cloud.recordPlayerInvitation(tournamentId,row.id,slot+1,{email:recipient,status:'review',error:error.message||String(error),requestId});}catch{logError=' Der Protokollstand konnte nicht gespeichert werden; Versandstatus bitte prüfen.';}const failure=new Error('Einladung für '+person.firstName+' '+person.lastName+' fehlgeschlagen: '+(error.message||error)+'. Bis dahin von Firebase angenommene Versandaufträge: '+report.recipients.length+(report.recipients.length?' ('+report.recipients.join(', ')+')':'')+'. Bereits erfolgte Verknüpfungen bleiben erhalten. Bitte den Stand vor einem erneuten Versand prüfen.'+logError);failure.cause=error;throw failure;}
 }
 return{...report,notice:report.recipients.length+' Passwortlink-Versandaufträge von Firebase angenommen: '+report.recipients.join(', ')+'. Neue Konten: '+report.created+'; bestehende Konten: '+report.existing+'. Das bestätigt keine Zustellung. Gegebenenfalls Spamordner prüfen.'};
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
