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
  const doc=documentById(id);if(!doc)return '<p class="notice">Dokument wird geladen. Bei fehlender Verbindung bitte erneut versuchen.</p>';
  query=query.trim();const pages=doc.pages.filter(p=>!query||p.text.toLocaleLowerCase('de').includes(query.toLocaleLowerCase('de')));
  return `<p class="legend" role="status">${query?`${pages.length} von ${doc.pageCount} Seiten mit Suchtreffern`:`${doc.pageCount} Seiten · Text aus dem bereitgestellten Original`}. <a href="${e(documentLink(id))}" target="_blank" rel="noopener">Original-PDF öffnen ↗</a></p>${pages.length?pages.map(p=>`<article class="document-page panel"><h3>Seite ${p.number}</h3><div class="document-text">${highlight(p.text,query)}</div></article>`).join(''):'<div class="empty"><p>Keine Treffer. Bitte einen anderen Suchbegriff eingeben.</p></div>'}`;
}
export function rulesView() {
  return `<div class="section-head"><div><p class="eyebrow">FAIR PLAY AM TISCH</p><h2>Regelwerk.</h2><p>Lang- und Kurzfassung der Beerpong Academy direkt nachlesen.</p></div></div><div class="notice"><b>Für dieses Turnier:</b> Es gibt keine Schiedsrichterrolle; bei Fragen entscheidet die Spielleitung. Siege nach Verlängerung werden mit 1:0 gewertet, bei 3 Punkten für den Sieger und 0 Punkten für den Verlierer. Die folgenden Originaltexte von 2018 bleiben unverändert.</div><div class="filter-bar"><label><span class="filters-label">Fassung</span><select id="document-selector"><option value="rules-long">Langfassung</option><option value="rules-short">Kurzfassung</option></select></label><label><span class="filters-label">Regeln durchsuchen</span><input type="search" id="document-search" placeholder="z. B. Nachwurf, Re-Rack …" maxlength="100"></label></div><div id="document-pages">${documentPages('rules-long')}</div>`;
}
export function bindDocumentSearch() {
  const search=document.querySelector('#document-search'),select=document.querySelector('#document-selector');
  const update=()=>{const target=document.querySelector('#document-pages');if(target)target.innerHTML=documentPages(select?.value??'statutes',search?.value??'');};
  search?.addEventListener('input',update);select?.addEventListener('change',update);
}
