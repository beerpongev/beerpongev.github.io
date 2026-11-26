import {parseScheduledDebitPages} from './debit-workflow.js';
/** Die ausgewählte Bankdatei bleibt im Browser; nur bestätigte Zuordnungen gehen nach Firestore. */
export async function readScheduledDebitPDF(file){
 if(!file||file.size>15000000)throw Error('Bitte eine Bank-PDF mit höchstens 15 MB wählen.');
 const bytes=new Uint8Array(await file.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,5))!=='%PDF-')throw Error('Das ist keine PDF-Datei.');
 const fileHash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),n=>n.toString(16).padStart(2,'0')).join('');
 const pdfjs=await import('./vendor/pdfjs/pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./vendor/pdfjs/pdf.worker.mjs',import.meta.url).href;
 const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,enableXfa:false,useWasm:false,useSystemFonts:true,disableFontFace:true,stopAtErrors:true,verbosity:0});
 const timer=setTimeout(()=>void task.destroy(),60000);try{const doc=await task.promise;if(doc.numPages>50)throw Error('Bitte höchstens 50 PDF-Seiten importieren.');const pages=[];for(let n=1;n<=doc.numPages;n++){const page=await doc.getPage(n),text=await page.getTextContent();pages.push({number:n,items:text.items.filter(i=>i.str!==undefined).map(i=>({text:i.str,x:i.transform[4],y:i.transform[5]}))});}return{...parseScheduledDebitPages(pages),fileHash};}finally{clearTimeout(timer);await task.destroy();}
}
