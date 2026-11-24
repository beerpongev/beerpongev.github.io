export const escapeHTML = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const localDate = (date=new Date()) => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
export const formatAppLogin=seconds=>Number.isSafeInteger(seconds)&&seconds>0?new Date(seconds*1000).toLocaleString('de-DE',{timeZone:'Europe/Berlin',dateStyle:'short',timeStyle:'short'}):'Noch nicht erfasst';
export function accountUsageStats(accounts,now=Date.now()){
 const day=t=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(t)),today=day(now),date=new Date(today+'T00:00:00Z');date.setUTCDate(date.getUTCDate()-((date.getUTCDay()+6)%7));const monday=date.toISOString().slice(0,10),active=accounts.filter(u=>!u.disabled);
 const times=active.map(u=>u.lastAppSeenAt?.toMillis?.()??(u.lastAppSeenAt?.seconds?u.lastAppSeenAt.seconds*1000:typeof u.lastAppSeenAt==='number'?u.lastAppSeenAt:(u.lastAppLoginAt??0)*1000)).filter(t=>Number.isFinite(t)&&t>0&&t<=now).map(day);
 const logged=active.filter(u=>Number.isSafeInteger(u.lastAppLoginAt)&&u.lastAppLoginAt>0).length;
 return{total:accounts.length,active:active.length,logged,unknown:active.length-logged,disabled:accounts.length-active.length,withoutTeam:active.filter(u=>u.role==='player'&&!u.teamId).length,today:times.filter(d=>d===today).length,week:times.filter(d=>d>=monday&&d<=today).length,month:times.filter(d=>d.slice(0,7)===today.slice(0,7)).length,year:times.filter(d=>d.slice(0,4)===today.slice(0,4)).length,used:times.length};
}
