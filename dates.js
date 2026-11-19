/** Kalenderdaten ohne Uhrzeit: Mitgliedschaft und Beiträge richten sich nach dem ganzen Kalenderjahr. */
export function validDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value??'')))return false;
 const date=new Date(value+'T12:00:00Z');
 return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;
}
export function joinedDate(value){
 const s=String(value??'').trim(),m=s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
 const iso=m?`${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`:s;
 return validDate(iso)?iso:null;
}
export const beforeEntryYear=(joined,year)=>{const date=joinedDate(joined);return !!date&&Number(year)<Number(date.slice(0,4));};
