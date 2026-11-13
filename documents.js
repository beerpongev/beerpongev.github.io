import { escapeHTML as e } from './ui.js';
let documents=[];
export async function loadDocuments() {
  const response=await fetch('./content/documents.json');
  if(!response.ok)throw new Error('Die Vereinsdokumente konnten nicht geladen werden.');
  documents=(await response.json()).documents;
}
export const documentById=id=>documents.find(d=>d.id===id);
export const documentLink=id=>{const d=documentById(id);return d?`./${d.source.split('/').map(encodeURIComponent).join('/')}`:'#';};
function highlight(text,query) {
  if(!query)return e(text);
  const pattern=query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return text.split(new RegExp(`(${pattern})`,'gi')).map((part,i)=>i%2?`<mark>${e(part)}</mark>`:e(part)).join('');
}
export function documentPages(id,query='') {
  if(id.startsWith('rules-'))return rulesReader(id,query);
  const doc=documentById(id);if(!doc)return '<p class="notice">Dokument wird geladen. Bei fehlender Verbindung bitte erneut versuchen.</p>';
  query=query.trim();const pages=doc.pages.filter(p=>!query||p.text.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));
  return `<p class="legend" role="status">${query?`${pages.length} von ${doc.pageCount} Seiten mit Suchtreffern`:`${doc.pageCount} Seiten · Text aus dem bereitgestellten Original`}. <a href="${e(documentLink(id))}" target="_blank" rel="noopener">Original-PDF öffnen ↗</a></p>${pages.length?pages.map(p=>`<article class="document-page panel"><h3>Seite ${p.number}</h3><div class="document-text">${highlight(p.text,query)}</div></article>`).join(''):'<div class="empty"><p>Keine Treffer. Bitte einen anderen Suchbegriff eingeben.</p></div>'}`;
}
export function rulesView() {
  return `<div id="rules-root"><div class="section-head"><div><p class="eyebrow">FAIR PLAY AM TISCH</p><h2>Regelwerk.</h2><p>Die richtige Regel. Mitten im Spiel.</p></div></div><aside class="rules-tournament"><div><span class="rules-kicker">REGELN FÜR DIESES TURNIER</span><h3>Biermenge pro Team & Tischseite</h3><p>Gleichmäßig auf die 10 Spielbecher verteilen. Diese Menge gilt unabhängig von abweichenden Angaben im Originalregelwerk.</p></div><div class="rules-filling"><div><b>4 × 0,33 l</b><span>Flaschenbier</span></div><span class="rules-or">oder</span><div><b>1,32 Liter</b><span>Fassbier</span></div></div><div class="rules-important"><section><span class="rules-kicker">TURNIERREGEL</span><h3>Kein Herauspusten</h3><p>Dreht sich der Ball im Becher, darf er nicht herausgepustet werden.</p></section><section><span class="rules-kicker">WICHTIG</span><h3>Ellenbogen hinter der Tischkante</h3><p>Beim Werfen darf der Ellenbogen die eigene Tischkante nicht überragen.</p></section></div></aside><aside class="rules-result-note"><h3>So wird gewertet</h3><p><b>Tabellenpunkte:</b> Der Sieger erhält 3 Punkte, der Verlierer 0 Punkte.</p><p><b>Becherdifferenz:</b> Es zählen die übrigen Becher des Verlierers. Der Sieger hat keine Becher übrig. Nach Verlängerung werden unabhängig von den tatsächlich übrigen Bechern <b>0 Restbecher für den Sieger und 1 Restbecher für den Verlierer</b> gewertet. Die Becherdifferenz beträgt damit +1 für den Sieger und −1 für den Verlierer.</p><p>Bei strittigen Fragen entscheidet die Spielleitung.</p></aside><div class="rules-tools"><div class="rules-editions" aria-label="Fassung auswählen"><button type="button" data-rule-edition="rules-short" aria-pressed="false"><b>Kurzfassung</b><span>Das Wichtigste am Tisch</span></button><button type="button" data-rule-edition="rules-long" aria-pressed="true"><b>Langfassung</b><span>Alle Regeln im Detail</span></button></div><select id="document-selector" aria-label="Fassung" hidden><option value="rules-long">Langfassung</option><option value="rules-short">Kurzfassung</option></select><label class="rules-search"><span>Was möchtest du nachschlagen?</span><input type="search" id="document-search" placeholder="Nachwurf, Re-Racks, Deathcup …" maxlength="100"></label></div><div id="document-pages">${rulesReader('rules-long')}</div></div>`;
}
export function bindDocumentSearch() {
  const search=document.querySelector('#document-search'),select=document.querySelector('#document-selector');
  const update=()=>{const target=document.querySelector('#document-pages');if(target)target.innerHTML=documentPages(select?.value??'statutes',search?.value??'');document.querySelectorAll('[data-rule-edition]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.ruleEdition===select?.value)));};
  search?.addEventListener('input',update);select?.addEventListener('change',update);
  document.querySelectorAll('[data-rule-edition]').forEach(b=>b.addEventListener('click',()=>{select.value=b.dataset.ruleEdition;update();}));
  document.querySelector('#rules-root')?.addEventListener('click',event=>{
    const toggle=event.target.closest('[data-rules-expand]');if(!toggle)return;
    const topics=[...document.querySelectorAll('details.rule-topic')],open=topics.some(d=>!d.open);
    topics.forEach(d=>d.open=open);toggle.textContent=open?'Alle Themen zuklappen':'Alle Themen aufklappen';
  });
}

// Ausschließlich Darstellung: PDF-Seiten zusammenführen, Umbrüche glätten und
// die vorhandenen Überschriften und Aufzählungen in semantisches HTML überführen.
const chapters={fair:'Fairplay',prepare:'Vorbereitung & Spielbeginn',play:'Würfe & Treffer',tactics:'Umstellen & Eingriffe',finish:'Nachwurf & Spielende',special:'Sonderregel'};
const longTopics={'Die Regeleinhaltung':'fair','Die Spieler':'prepare','Das Equipment':'prepare','Die Cup-Formation':'prepare','Aufteilung des Getränks':'prepare','Spielbeginn':'prepare','Das Werfen':'play','Punkten':'play','Deathcup':'play','Verteidigung':'play','Re-Racks':'tactics','Ablenkungsmanöver':'tactics','Spiel-Eingriffe':'tactics','Rebuttal / Nachwurf':'finish','Verlängerung / Overtime':'finish','Spielende':'finish','NBA Jam':'special'};
const shortTopics={'Regeleinhaltung':'fair','Vorbereitung':'prepare','Das Spiel':'play','Rebuttal / Nachwurf':'finish','Verlängerung / Overtime':'finish','Spielende':'finish'};
export function ruleSections(doc){
  const short=doc.id==='rules-short',titles=short?shortTopics:longTopics;
  const lines=doc.pages.map(p=>p.text.replace(/^Seite \d+ von \d+\s*/,'')).join('\n').replace(/-\n(?=\p{L})/gu,'-').split('\n');
  const sections=[];let current=null,parent=null,block=null,special=false;
  const addParagraph=line=>{if(!current)return;if(block?.type==='paragraph')block.text+=' '+line;else{block={type:'paragraph',text:line};current.blocks.push(block);}parent=null;};
  for(let i=0;i<lines.length;i++){
    const line=lines[i].trim();if(!line){block=null;continue;}
    if(line.startsWith('©')||line.startsWith('Stöckte,')||line.startsWith('Beerpong Reglement'))continue;
    if(!short&&['Vorbereitung','Das Spiel','Sonderregel'].includes(line)){if(line==='Sonderregel')special=true;block=null;continue;}
    if(!short&&line==='(Nur anzuwenden, wenn ausdrücklich erwähnt)')continue;
    // Der erste Titel „Spielende“ ist nur eine Kapitelüberschrift vor „Rebuttal“.
    if(!short&&line==='Spielende'&&lines.slice(i+1).find(x=>x.trim())?.trim()==='Rebuttal / Nachwurf')continue;
    if(titles[line]){current={title:line,chapter:titles[line],blocks:[]};sections.push(current);block=null;parent=null;if(special&&line==='NBA Jam')addParagraph('(Nur anzuwenden, wenn ausdrücklich erwähnt)');continue;}
    if(!current)continue;
    const bullet=line.match(/^(•|o)\s+(.*)$/);
    if(bullet){block={type:'bullet',text:bullet[2],children:[]};if(bullet[1]==='o'&&parent)parent.children.push(block);else{current.blocks.push(block);parent=block;}continue;}
    if(block)block.text+=' '+line;else addParagraph(line);
  }
  return sections;
}
const normalized=text=>text.toLocaleLowerCase('de');
const noBlowing='Für dieses Turnier: Dreht sich der Ball im Becher, darf er nicht herausgepustet werden. Herauspusten ist nicht erlaubt.';
const mentionsBlowing=text=>text.startsWith('Pusten:')||text.startsWith('Wenn ein Wurf in einen Cup geht, sich dort aber dreht');
const beerAmount='Pro Team und Tischseite: 4 Flaschen à 0,33 Liter oder 1,32 Liter Fassbier, gleichmäßig auf die 10 Spielbecher verteilt. Diese Turnierregel ersetzt abweichende Mengenangaben im Original.';
const hasBeerAmount=section=>['Aufteilung des Getränks','Vorbereitung'].includes(section.title);
function rulesReader(id,query=''){
  const doc=documentById(id);if(!doc)return '<p class="notice">Die Regeln werden geladen …</p>';
  const short=id==='rules-short',all=ruleSections(doc);query=query.trim();
  const plain=block=>block.text+' '+(block.children??[]).map(plain).join(' ');
  const sections=all.map((s,i)=>({...s,number:i+1})).filter(s=>!query||normalized(s.title+' '+chapters[s.chapter]+' '+s.blocks.map(plain).join(' ')+' '+(hasBeerAmount(s)?beerAmount:'')+' '+(['Punkten','Das Spiel'].includes(s.title)?noBlowing:'')).includes(normalized(query)));
  const groups=Object.entries(chapters).filter(([key])=>sections.some(s=>s.chapter===key));
  const blockHTML=blocks=>{let html='',list=false;for(const b of blocks){if(b.type==='bullet'){if(!list){html+='<ul>';list=true;}html+=`<li>${highlight(mentionsBlowing(b.text)?noBlowing:b.text,query)}${b.children?.length?blockHTML(b.children):''}</li>`;}else{if(list){html+='</ul>';list=false;}html+=`<p>${highlight(b.text,query)}</p>`;}}return html+(list?'</ul>':'');};
  const topicBody=s=>{
    const original=blockHTML(s.blocks);if(!hasBeerAmount(s))return original;
    const current=`<div class="rule-current-beer"><b>Aktuelle Turnierregel</b><p>${highlight(beerAmount,query)}</p></div>`;
    return current+(s.title==='Aufteilung des Getränks'?`<details class="rule-historical"><summary>Ältere Mengenangaben im Original (hier nicht maßgeblich)</summary>${original}</details>`:original);
  };
  return `<div class="rules-reader-head"><p role="status">${query?`${sections.length} von ${all.length} Themen gefunden`:`${all.length} Themen · Stand 19.12.2018`}</p><a href="${e(documentLink(id))}" target="_blank" rel="noopener">Original-PDF öffnen ↗</a></div>${sections.length?`<div class="rules-layout"><aside class="rules-index"><p class="rules-kicker">DIREKT ZUM THEMA</p><nav aria-label="Inhaltsverzeichnis der Regeln">${groups.map(([key,label])=>`<a href="#rules-${key}">${label}<span aria-hidden="true">↗</span></a>`).join('')}</nav>${!short?'<button type="button" class="text-button" data-rules-expand>Alle Themen '+(query?'zuklappen':'aufklappen')+'</button>':''}</aside><div class="rules-chapters">${groups.map(([key,label])=>`<section class="rule-chapter" id="rules-${key}"><h3>${label}</h3>${sections.filter(s=>s.chapter===key).map(s=>{const title=`<span class="rule-number">${String(s.number).padStart(2,'0')}</span><span class="rule-topic-title">${highlight(s.title,query)}</span>`;return short?`<article class="rule-topic rule-topic-short"><h4>${title}</h4><div class="rule-body">${topicBody(s)}</div></article>`:`<details class="rule-topic" ${query?'open':''}><summary>${title}<span class="rule-toggle" aria-hidden="true"></span></summary><div class="rule-body">${topicBody(s)}</div></details>`;}).join('')}</section>`).join('')}</div></div>`:'<div class="rules-no-results"><h3>Keine passende Regel gefunden.</h3><p>Versuche einen kürzeren Begriff wie „Wurf“, „Cup“ oder „Nachwurf“.</p></div>'}<p class="rules-source-note">Regeltexte der Beerpong Academy e. V. · Für die Bildschirmansicht nach Themen gegliedert. Turnierhinweise stehen oben.</p>`;
}
