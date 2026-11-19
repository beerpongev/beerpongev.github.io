import {normalizeContribution} from './contributions.js';
/** Storno als Gegenbuchung. Original und spätere Zahlungen bleiben erhalten. */
export function reverseBankPayment(current,receipt){
 const delta=receipt.paidDelta??(receipt.kind==='evidence'?0:receipt.kind==='return'?-(receipt.originalCents||Math.abs(receipt.amountCents)):receipt.amountCents);
 const paidCents=current.paidCents-delta;
 if(paidCents<0||paidCents>100000)throw Error('Der aktuelle Beitragsstand erlaubt dieses Storno nicht. Bitte zuerst spätere Buchungen und manuelle Änderungen prüfen.');
 const status=current.dueCents<=0?'notdue':paidCents>=current.dueCents?'paid':'open';
 return normalizeContribution({...current,paidCents,status,note:current.note});
}
