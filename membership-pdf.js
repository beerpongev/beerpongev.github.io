// Vollständig lokale PDF-Erstellung: keine Antragsdaten verlassen dabei das Gerät.
import { PDFDocument, rgb } from './vendor/pdf-lib.esm.min.js';
import fontkit from './vendor/fontkit.es.min.js';

const W=595.28,H=841.89,M=44,CW=W-2*M;
const ink=rgb(.004,.118,.208),muted=rgb(.36,.43,.48),red=rgb(.82,0,.08),cream=rgb(.985,.965,.915),line=rgb(.83,.85,.83);
let assets;
const read=async path=>{const r=await fetch(new URL(path,import.meta.url));if(!r.ok)throw new Error('PDF-Datei konnte nicht geladen werden: '+path);return new Uint8Array(await r.arrayBuffer());};
export function preloadMembershipPDF(){return assets??=Promise.all([read('./vendor/fonts/NotoSans-Regular.ttf'),read('./vendor/fonts/NotoSans-Bold.ttf'),read('./icons/academy-512.png')]).catch(error=>{assets=null;throw error;});}
export const pdfDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value??'')?value.split('-').reverse().join('.'):String(value??'');
export function membershipFilename(data){return 'Mitgliedsantrag-'+[data.firstName,data.lastName].join('-').normalize('NFKC').replace(/[^\p{L}\p{N}_-]+/gu,'-').slice(0,100)+'.pdf';}

export async function createMembershipPDF(data,signatures){
  const [regular,bold,logoBytes]=await preloadMembershipPDF();
  const pdf=await PDFDocument.create();pdf.registerFontkit(fontkit);
  const font=await pdf.embedFont(regular,{subset:true}),strong=await pdf.embedFont(bold,{subset:true}),logo=await pdf.embedPng(logoBytes);
  pdf.setTitle('Mitgliedsantrag – Beerpong Academy e. V.');pdf.setAuthor('Beerpong Academy e. V.');pdf.setSubject('Mitgliedsantrag und Einzugsermächtigung');pdf.setCreator('Beerpong Academy Turnier-App');pdf.setLanguage('de-DE');
  let page,y,title,subtitle;
  const text=(value,x,top,size=10,f=font,color=ink)=>page.drawText(String(value),{x,y:top-size,size,font:f,color});
  // Bricht auch lange E-Mail-Adressen und Namen um; Angaben werden nie abgeschnitten.
  const wrap=(value,width,size=10,f=font)=>{
    const result=[];for(const paragraph of String(value??'').split('\n')){let row='';for(const word of paragraph.split(/\s+/)){if(!word)continue;const candidate=row?row+' '+word:word;if(f.widthOfTextAtSize(candidate,size)<=width){row=candidate;continue;}if(row){result.push(row);row='';}for(const char of word){if(row&&f.widthOfTextAtSize(row+char,size)>width){result.push(row);row='';}row+=char;}}result.push(row);}return result;
  };
  const newPage=()=>{page=pdf.addPage([W,H]);page.drawRectangle({x:0,y:H-132,width:W,height:132,color:cream});page.drawImage(logo,{x:W-M-84,y:H-112,width:84,height:84});text('BEERPONG ACADEMY e. V.',M,H-31,10,strong);text(title,M,H-56,23,strong);text(subtitle,M,H-94,10,font,muted);page.drawRectangle({x:M,y:H-133,width:48,height:3,color:red});y=H-159;};
  const space=height=>{if(y-height<58)newPage();};
  const paragraph=(value,size=10)=>{for(const row of wrap(value,CW,size)){space(size*1.5);text(row,M,y,size);y-=size*1.5;}y-=9;};
  const heading=value=>{space(38);text(value,M,y,13,strong);y-=25;};
  const fields=items=>{const gap=18,width=(CW-gap*(items.length-1))/items.length;const rows=items.map(([,v])=>wrap(v||'—',width-16,10));const height=Math.max(...rows.map(r=>r.length))*15+33;space(height+9);items.forEach(([label],i)=>{const x=M+i*(width+gap);page.drawRectangle({x,y:y-height,width,height,color:cream});text(label,x+8,y-7,8,strong,muted);rows[i].forEach((row,j)=>text(row,x+8,y-23-j*15,10));});y-=height+9;};
  const signature=async(label,place,date,png)=>{
    space(154);fields([['Ort',place],['Datum',pdfDate(date)]]);text(label,M,y,9,strong);y-=17;
    const image=await pdf.embedPng(png),boxW=280,boxH=78,scale=Math.min(boxW/image.width,boxH/image.height);
    page.drawImage(image,{x:M,y:y-boxH,width:image.width*scale,height:image.height*scale});y-=boxH+3;page.drawLine({start:{x:M,y},end:{x:M+boxW,y},thickness:.7,color:line});y-=22;
  };
  title='Mitgliedsantrag';subtitle='Persönliche Angaben und Satzungsanerkennung';newPage();
  heading('01  Persönliche Angaben');
  fields([['Vorname',data.firstName],['Nachname',data.lastName]]);
  fields([['Geburtsdatum',pdfDate(data.birthDate)],['Beruf (optional)',data.occupation]]);
  fields([['Straße und Hausnummer',data.street]]);
  fields([['Postleitzahl',data.postalCode],['Wohnort',data.city]]);
  fields([['E-Mail',data.email],['Telefon',data.phone]]);
  heading('02  Mitgliedschaft');
  paragraph('Der Mitgliedsbeitrag beträgt 8 € pro Jahr.',11);
  paragraph('Hiermit beantrage ich die Mitgliedschaft im Beerpongverein Beerpong Academy e.V. Mit meiner Unterschrift erkenne ich die Satzung des Beerpong Academy e.V. in der aktuell gültigen Fassung an. Die Mitgliedschaft im Verein ist fortlaufend, ein Austritt kann nur zum Ende des Kalenderjahres unter Einhaltung einer Kündigungsfrist von 3 Monaten erfolgen.');
  paragraph('Mit meiner Unterschrift bestätige ich zudem, die Satzung des Beerpong Academy e.V. in ihrer aktuell gültigen Fassung erhalten und die vorstehenden Erklärungen bestätigt zu haben.');
  await signature('Unterschrift zum Mitgliedsantrag',data.applicationPlace,data.applicationDate,signatures.application);

  title='Einzugsermächtigung';subtitle='Mitgliedsbeitrag · 8 € pro Jahr';newPage();
  fields([['Antragstellende Person',[data.firstName,data.lastName].join(' ')]]);
  heading('03  Bankverbindung');
  fields([['Kontoinhaber',data.accountHolder||[data.firstName,data.lastName].join(' ')]]);
  fields([['Kreditinstitut',data.bank]]);
  fields([['IBAN',data.iban.replace(/\s/g,'').toUpperCase().match(/.{1,4}/g)?.join(' ')??'']]);
  heading('04  Ermächtigung');
  paragraph('Hiermit ermächtige ich den Beerpong Academy e.V., den zu entrichtenden Mitgliedsbeitrag zu Lasten des oben angeführten Kontos bei Fälligkeit abzubuchen.');
  paragraph('Der Beitrag beträgt 8 € im Jahr. Der erste Beitrag wird zum Anfang des Monats nach Antragstellung fällig. Danach werden die Beiträge am Anfang jedes Jahres fällig.');
  paragraph('Die Einzugsermächtigung kann jederzeit schriftlich widerrufen werden. Bei fehlender Deckung des Kontos besteht seitens des kontoführenden Kreditinstituts keine Verpflichtung zur Einlösung. Entstehende Gebühren gehen zu meinen Lasten.');
  paragraph('Ich bestätige die Einzugsermächtigung und unterschreibe als Kontoinhaber.');
  await signature('Unterschrift zur Einzugsermächtigung',data.debitPlace,data.debitDate,signatures.debit);
  const pages=pdf.getPages();pages.forEach((p,i)=>{page=p;page.drawLine({start:{x:M,y:43},end:{x:W-M,y:43},thickness:.6,color:line});text('Beerpong Academy e. V. · beerpongacademy@gmail.com',M,33,8,font,muted);const label=`${i+1} / ${pages.length}`;text(label,W-M-font.widthOfTextAtSize(label,8),33,8,font,muted);});
  return pdf.save();
}
