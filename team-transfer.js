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
