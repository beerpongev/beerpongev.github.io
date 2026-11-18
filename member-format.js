/** Excel kann Telefonnummern als Dezimalzahl mit Exponent speichern. Ohne Rundung expandieren. */
export function expandExcelNumber(value){
 const s=String(value??'').trim(),m=s.match(/^([+-]?)(\d+)(?:\.(\d+))?[Ee]([+-]?\d+)$/);
 if(!m)return s;const exponent=Number(m[4]);if(!Number.isInteger(exponent)||Math.abs(exponent)>30)return s;
 const digits=m[2]+(m[3]??''),point=m[2].length+exponent;
 return m[1]+(point<=0?'0.'+'0'.repeat(-point)+digits:point>=digits.length?digits+'0'.repeat(point-digits.length):digits.slice(0,point)+'.'+digits.slice(point));
}
export function memberNumber(value){return expandExcelNumber(value).replace(/\.0+$/,'');}
export function phoneNumber(value){
 const s=String(value??'').trim(),scientific=/^[+\-]?\d+(?:\.\d+)?[Ee][+\-]?\d+$/.test(s);
 let expanded=expandExcelNumber(s).replace(/\.0+$/,'');
 // Eindeutig als deutsche Mobilfunknummer erkennbarer Excel-Wert: verlorene nationale 0 ergänzen.
 if(scientific&&/^1[567]\d{8,10}$/.test(expanded))expanded='0'+expanded;
 return expanded;
}
