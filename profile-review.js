import {escapeHTML as e} from './ui.js';

export const profileLabels={firstName:'Vorname',lastName:'Nachname',birthDate:'Geburtsdatum',email:'Kontakt-E-Mail',phone:'Telefon',street:'Straße und Hausnummer',postalCode:'Postleitzahl',city:'Wohnort',occupation:'Beruf',iban:'IBAN',bank:'Kreditinstitut',accountHolder:'Kontoinhaber'};
const bankKeys=new Set(['iban','bank','accountHolder']);
const value=(key,input)=>key==='iban'?String(input??'').replace(/\s/g,'').toUpperCase():String(input??'');
export const profileChangeEntries=(before,after)=>Object.entries(profileLabels).map(([key,label])=>{const old=value(key,before?.[key]),next=value(key,after?.[key]);return{key,label,before:old,after:next,bank:bankKeys.has(key),kind:old===next?'unchanged':!old?'added':!next?'removed':'changed'};});
export const bankProfileChanged=(before,after)=>profileChangeEntries(before,after).some(f=>f.bank&&f.kind!=='unchanged');
export const profileTime=t=>t?.toMillis?.()??(typeof t==='number'?t:typeof t?.seconds==='number'?t.seconds*1000+(t.nanoseconds??0)/1000000:0);
const dateLabel=t=>profileTime(t)?new Intl.DateTimeFormat('de-DE',{timeZone:'Europe/Berlin',dateStyle:'medium',timeStyle:'short'}).format(new Date(profileTime(t))):'Zeitpunkt nicht hinterlegt';

/** Ein LCS-Vergleich markiert bei IBAN und langen Texten nur tatsächlich abweichende Zeichen. */
function characterChanges(old,next){
 const matrix=Array.from({length:old.length+1},()=>new Uint16Array(next.length+1)),a=new Set(),b=new Set();
 for(let i=old.length-1;i>=0;i--)for(let j=next.length-1;j>=0;j--)matrix[i][j]=old[i]===next[j]?matrix[i+1][j+1]+1:Math.max(matrix[i+1][j],matrix[i][j+1]);
 let i=0,j=0;while(i<old.length||j<next.length){if(i<old.length&&j<next.length&&old[i]===next[j]){i++;j++;}else if(i<old.length&&(j===next.length||matrix[i+1][j]>=matrix[i][j+1]))a.add(i++);else b.add(j++);}return[a,b];
}
function shown(key,text,changed=new Set(),old=false){
 if(!text)return'<span class="profile-empty">Nicht hinterlegt</span>';
 if(key==='birthDate'&&/^\d{4}-\d{2}-\d{2}$/.test(text))return e(text.split('-').reverse().join('.'));
 const tag=old?'del':'mark';let html=key==='iban'?'<span class="profile-iban-group">':'';
 for(let i=0;i<text.length;i++){if(key==='iban'&&i&&i%4===0)html+='</span> <span class="profile-iban-group">';html+=changed.has(i)?'<'+tag+' class="profile-char-change">'+e(text[i])+'</'+tag+'>':e(text[i]);}if(key==='iban')html+='</span>';
 return'<span'+(key==='iban'?' class="profile-iban"':'')+'>'+html+'</span>';
}
const typeLabels={added:'Neu ergänzt',changed:'Geändert',removed:'Wird entfernt'};
function changeCard(f,approved=false){
 const positional=(a,b)=>new Set([...a].flatMap((c,i)=>c!==b[i]?[i]:[]));
 const [oldChars,newChars]=f.key==='iban'?[positional(f.before,f.after),positional(f.after,f.before)]:f.before&&f.after&&Math.max(f.before.length,f.after.length)>=12?characterChanges(f.before,f.after):[new Set(),new Set()];
 return'<div class="profile-field-change profile-field-'+f.kind+'" data-profile-field="'+e(f.key)+'"><div class="profile-field-heading"><dt>'+e(f.label)+'</dt><span class="profile-change-badge">'+(approved&&f.kind==='removed'?'Entfernt':typeLabels[f.kind])+'</span></div><dd class="profile-value-pair"><div class="profile-value-old"><span class="profile-value-label">Bisher</span>'+shown(f.key,f.before,oldChars,true)+'</div><div class="profile-value-new"><span class="profile-value-label">'+(approved?'Übernommen':'Beantragt')+' · '+(f.kind==='removed'?'entfernen':'neuer Wert')+'</span>'+(f.kind==='removed'?'<strong>'+(approved?'Entfernt':'Wird entfernt')+'</strong>':shown(f.key,f.after,newChars))+'</div></dd></div>';
}
/** Gemeinsame Vergleichsansicht für Freigabe und dauerhaften Verlauf. */
export function profileComparisonHTML(before,after,{unchanged=true,approved=false}={}){
 const fields=profileChangeEntries(before,after),changed=fields.filter(f=>f.kind!=='unchanged'),bank=changed.filter(f=>f.bank),personal=changed.filter(f=>!f.bank),counts=['added','changed','removed'].map(kind=>({kind,count:changed.filter(f=>f.kind===kind).length})).filter(c=>c.count);
 const summary=changed.length+' '+(changed.length===1?'Änderung':'Änderungen')+': '+counts.map(c=>c.count+' '+({added:'neu ergänzt',changed:'geändert',removed:'entfernt'}[c.kind])).join(' · ');
 return'<p class="profile-change-summary">'+e(summary)+'</p>'+(personal.length?'<dl class="profile-change-grid">'+personal.map(f=>changeCard(f,approved)).join('')+'</dl>':'')+(bank.length?'<section class="profile-bank-changes"><h5>Bankverbindung geändert'+(approved?'':' – bitte prüfen')+'</h5><dl class="profile-change-grid">'+bank.map(f=>changeCard(f,approved)).join('')+'</dl></section>':'')+(unchanged?'<details class="profile-unchanged"><summary>Unveränderte Angaben ('+fields.filter(f=>f.kind==='unchanged').length+')</summary><dl>'+fields.filter(f=>f.kind==='unchanged').map(f=>'<div><dt>'+e(f.label)+'</dt><dd>'+shown(f.key,f.before)+'</dd></div>').join('')+'</dl></details>':'');
}
export function profileHistoryHTML(rows){
 return rows.length?rows.slice().sort((a,b)=>profileTime(b.reviewedAt)-profileTime(a.reviewedAt)).map(row=>'<details class="profile-history-entry"><summary>'+e(dateLabel(row.reviewedAt))+' · Datenänderungen freigegeben</summary>'+profileComparisonHTML(row.before,row.changes,{unchanged:false,approved:true})+(row.bankReleased?'<p class="profile-bank-released">Bankverbindung ausdrücklich geprüft und für weitere Einzüge freigegeben. Die bisherige Unklar-Markierung wurde aufgehoben.</p>'+(row.bankNoteBefore?'<p class="legend">Bisheriger Bankhinweis: '+e(row.bankNoteBefore)+'</p>':''):'')+'</details>').join(''):'<p class="legend">Noch keine freigegebenen Datenänderungen dokumentiert.</p>';
}
