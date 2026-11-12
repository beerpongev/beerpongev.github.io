import { escapeHTML as e, localDate } from './ui.js';
import { documentPages } from './documents.js';
export const membershipRecipient='beerpongacademy@gmail.com';
import {configured, saveMembershipPDF} from './firebase.js';
import {createMembershipPDF,membershipFilename} from './membership-pdf.js';
const field=(label,name,type='text',attrs='required')=>`<label>${label}<input name="${name}" type="${type}" ${attrs} maxlength="${type==='email'?254:120}"></label>`;
export function membershipView() {
  const returned=false; // Kein externer Versanddienst mehr.
  return `<div id="membership-root"><div class="section-head"><div><p class="eyebrow">MEHR ALS EIN TURNIER</p><h2>Mitgliedschaft.</h2><p>Teil der Beerpong Academy e. V. werden.</p></div></div>${returned?'<div class="notice" role="status">Du bist von der Versandseite zurückgekehrt. Maßgeblich ist deren Versandbestätigung. Die Aufnahme wird anschließend vom Vereinsvorstand geprüft.</div>':''}
  <details class="panel"><summary>Satzung vom 29.12.2017 lesen und durchsuchen</summary><label class="document-search-label">Satzung durchsuchen<input id="document-search" type="search" placeholder="Suchbegriff …" maxlength="100"></label><div id="document-pages">${documentPages('statutes')}</div></details>
  <section class="panel membership-panel"><h3>Dein Mitgliedsantrag</h3><p>Der Mitgliedsbeitrag beträgt <b>8 € pro Jahr</b>.</p>
  <form id="membership-form" class="form-stack" >
  <fieldset><legend>1. Persönliche Daten</legend><div class="form-columns">${field('Vorname','Vorname')}${field('Nachname','Nachname')}${field('Geburtsdatum (mindestens 16 Jahre)','Geburtsdatum','date','required id="membership-birth"')}${field('Beruf (optional)','Beruf','text','')}${field('Straße und Hausnummer','Straße und Hausnummer')}${field('Postleitzahl','Postleitzahl','text','required autocomplete="postal-code"')}${field('Wohnort','Wohnort')}${field('E-Mail','email','email','required autocomplete="email"')}${field('Telefon','Telefon','tel','required autocomplete="tel"')}</div></fieldset>
  <fieldset><legend>2. Antrag und Satzungsanerkennung</legend><p>Hiermit beantrage ich die Mitgliedschaft im Beerpongverein Beerpong Academy e.V.</p><p>Mit meiner Unterschrift erkenne ich die Satzung des Beerpong Academy e.V. in der aktuell gültigen Fassung an. Die Mitgliedschaft im Verein ist fortlaufend, ein Austritt kann nur zum Ende des Kalenderjahres unter Einhaltung einer Kündigungsfrist von 3 Monaten erfolgen.</p><p>Mit meiner Unterschrift bestätige ich zudem, die Satzung des Beerpong Academy e.V. in ihrer aktuell gültigen Fassung erhalten zu haben.</p><label class="checkbox-label"><input type="checkbox" name="Satzung anerkannt und erhalten" value="Ja" required>Ich habe die bereitgestellte Satzung gelesen und bestätige die vorstehenden Erklärungen.</label><div class="form-columns">${field('Ort','Antragsort')}${field('Datum','Antragsdatum','date',`required value="${localDate()}"`)}</div>${signature('application','Unterschrift zum Mitgliedsantrag')}</fieldset>
  <fieldset><legend>3. Einzugsermächtigung</legend><p>Hiermit ermächtige ich den Beerpong Academy e.V., den zu entrichtenden Mitgliedsbeitrag zu Lasten des unten angeführten Kontos bei Fälligkeit abzubuchen.</p><p>Der Beitrag beträgt 8€ im Jahr. Der erste Beitrag wird zum Anfang des Monats nach Antragsstellung fällig. Danach werden die Beiträge am Anfang jedes Jahres fällig.</p><p>Die Einzugsermächtigung kann jederzeit schriftlich widerrufen werden. Bei fehlender Deckung des Kontos besteht seitens des kontoführenden Kreditinstituts keine Verpflichtung zur Einlösung. Entstehende Gebühren gehen zu meinen Lasten.</p><div class="form-columns">${field('Kontoinhaber (falls abweichend)','Abweichender Kontoinhaber','text','')}${field('Kreditinstitut','Kreditinstitut')}${field('IBAN','IBAN','text','required id="membership-iban" autocomplete="off" spellcheck="false" inputmode="text"')}</div><label class="checkbox-label"><input type="checkbox" name="Einzugsermächtigung bestätigt" value="Ja" required>Ich bestätige die Einzugsermächtigung und unterschreibe als Kontoinhaber.</label><div class="form-columns">${field('Ort','Ort der Einzugsermächtigung')}${field('Datum','Datum der Einzugsermächtigung','date',`required value="${localDate()}"`)}</div>${signature('debit','Unterschrift zur Einzugsermächtigung')}</fieldset>
  <fieldset><legend>4. Antrag abgeben</legend><p>Dein unterschriebener PDF-Antrag wird geschützt gespeichert. Nur die Spielleitung kann ihn einsehen, herunterladen und nach der Bearbeitung löschen. Er wird nicht im öffentlichen Turnier angezeigt.</p><label class="checkbox-label"><input type="checkbox" name="Speicherung zugestimmt" value="Ja" required>Ich möchte meinen Antrag einschließlich Bankverbindung und Unterschriften zur Bearbeitung meiner Mitgliedschaft geschützt beim Verein speichern.</label><p>Der Verein verarbeitet die Angaben zur Bearbeitung des Antrags sowie zur Abrechnung und Betreuung der Mitgliedschaft. Kontakt: <b>${membershipRecipient}</b>.</p></fieldset><div class="form-error" id="membership-error" role="alert" hidden></div><button class="button red-button" type="submit">Mitgliedsantrag geschützt abgeben</button><p id="membership-status" role="status"></p></form></section></div>`;
}
function signature(id,label) {return `<div class="signature-block"><label for="signature-${id}">${label} – mit Finger oder Maus zeichnen</label><canvas id="signature-${id}" width="700" height="210" aria-label="${label}" tabindex="0"></canvas><button type="button" class="text-button" data-signature-clear="${id}">Unterschrift löschen</button></div>`;}
export function validIBAN(raw) {
  const iban=raw.replace(/\s/g,'').toUpperCase();if(!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban))return false;
  if(iban.startsWith('DE')&&iban.length!==22)return false;
  const digits=(iban.slice(4)+iban.slice(0,4)).replace(/[A-Z]/g,c=>String(c.charCodeAt(0)-55));
  let remainder=0;for(const digit of digits)remainder=(remainder*10+Number(digit))%97;
  return remainder===1;
}
export function bindMembership() {
  const form=document.querySelector('#membership-form');if(!form)return;
  const upper=form.elements.namedItem('Antragsort'),lower=form.elements.namedItem('Ort der Einzugsermächtigung');
  let manual=false;lower.addEventListener('input',()=>manual=!!lower.value&&lower.value!==upper.value);
  upper.addEventListener('input',()=>{if(!manual)lower.value=upper.value;});
  const signed={};
  for(const id of ['application','debit']){
    const canvas=document.querySelector(`#signature-${id}`),ctx=canvas.getContext('2d');let last=null,length=0;
    const clear=()=>{ctx.fillStyle='#fffdf7';ctx.fillRect(0,0,canvas.width,canvas.height);signed[id]=false;length=0;};clear();
    const point=ev=>{const r=canvas.getBoundingClientRect();return{x:(ev.clientX-r.left)*canvas.width/r.width,y:(ev.clientY-r.top)*canvas.height/r.height};};
    canvas.addEventListener('pointerdown',ev=>{ev.preventDefault();canvas.setPointerCapture(ev.pointerId);last=point(ev);});
    canvas.addEventListener('pointermove',ev=>{if(!last)return;const p=point(ev);ctx.strokeStyle='#011e35';ctx.lineWidth=2.5;ctx.lineCap='round';ctx.beginPath();ctx.moveTo(last.x,last.y);ctx.lineTo(p.x,p.y);ctx.stroke();length+=Math.hypot(p.x-last.x,p.y-last.y);signed[id]=length>25;last=p;});
    for(const event of ['pointerup','pointercancel'])canvas.addEventListener(event,()=>{last=null;});
    document.querySelector(`[data-signature-clear="${id}"]`).addEventListener('click',clear);
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();const error=document.querySelector('#membership-error');error.hidden=true;
    const fail=message=>{error.textContent=message;error.hidden=false;error.scrollIntoView({block:'center'});};
    if(!navigator.onLine)return fail('Zum Absenden wird eine Internetverbindung benötigt.');
    if(!form.reportValidity())return;
    const birth=new Date(document.querySelector('#membership-birth').value+'T00:00:00'),today=new Date();let age=today.getFullYear()-birth.getFullYear();if(today.getMonth()<birth.getMonth()||(today.getMonth()===birth.getMonth()&&today.getDate()<birth.getDate()))age--;
    if(!Number.isFinite(birth.getTime())||age<16||age>120)return fail('Gemäß der bereitgestellten Satzung ist eine Mitgliedschaft ab 16 Jahren vorgesehen. Bitte das Geburtsdatum prüfen.');
    const iban=document.querySelector('#membership-iban');if(!validIBAN(iban.value))return fail('Bitte eine gültige IBAN mit korrekter Prüfziffer eingeben.');iban.value=iban.value.replace(/\s/g,'').toUpperCase();
    if(!signed.application||!signed.debit)return fail('Bitte den Mitgliedsantrag und die Einzugsermächtigung jeweils im vorgesehenen Feld unterschreiben.');
    const button=form.querySelector('button[type=submit]');button.disabled=true;
    try{
      if(!configured)throw new Error('In der lokalen Demo werden keine Mitgliedsanträge gespeichert.');
      const f=new FormData(form),get=k=>String(f.get(k)??'').trim();
      const data={firstName:get('Vorname'),lastName:get('Nachname'),birthDate:get('Geburtsdatum'),occupation:get('Beruf'),street:get('Straße und Hausnummer'),postalCode:get('Postleitzahl'),city:get('Wohnort'),email:get('email'),phone:get('Telefon'),applicationPlace:get('Antragsort'),applicationDate:get('Antragsdatum'),accountHolder:get('Abweichender Kontoinhaber'),bank:get('Kreditinstitut'),iban:get('IBAN'),debitPlace:get('Ort der Einzugsermächtigung'),debitDate:get('Datum der Einzugsermächtigung')};
      const signatures=Object.fromEntries(['application','debit'].map(id=>[id,document.querySelector('#signature-'+id).toDataURL('image/png')]));
      const bytes=await createMembershipPDF(data,signatures);
      await saveMembershipPDF(bytes,membershipFilename(data));
      form.reset();form.querySelectorAll('[data-signature-clear]').forEach(x=>x.click());manual=false;
      document.querySelector('#membership-status').textContent='Dein Antrag wurde gespeichert und liegt der Spielleitung zur Bearbeitung vor.';
    }catch(error){fail(error.code==='auth/operation-not-allowed'?'Die anonyme Anmeldung muss in Firebase aktiviert werden. Bitte die Spielleitung informieren.':error.message||'Speichern fehlgeschlagen. Bitte erneut versuchen.');}
    finally{button.disabled=false;}
  });
}
