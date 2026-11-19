/** Preise in Cent. Gespeicherte Anmeldungen behalten ihren damaligen Preisstand. */
export const DEFAULT_PRICES=Object.freeze({entryMember:0,entryGuest:1000,beerMember:500,beerGuest:1000});
let contributionRates={},activePrices=DEFAULT_PRICES;
export function normalizePrices(input=DEFAULT_PRICES){
 const result={...DEFAULT_PRICES,...input};
 for(const key of Object.keys(DEFAULT_PRICES))if(!Number.isInteger(result[key])||result[key]<0||result[key]>25000)throw Error('Preise pro Person müssen zwischen 0 und 250 € liegen.');
 return Object.fromEntries(Object.keys(DEFAULT_PRICES).map(key=>[key,result[key]]));
}
export function setActivePrices(prices){activePrices=normalizePrices(prices);}
export const getActivePrices=()=>({...activePrices});
export function setContributionRates(rates={}){for(const[year,value]of Object.entries(rates))if(!/^20\d{2}$/.test(year)||!Number.isInteger(value)||value<0||value>100000)throw Error('Ungültiger Jahresbeitrag.');contributionRates={...rates};}
export const annualFee=year=>contributionRates[String(year)]??800;
