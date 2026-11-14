// Campo "cliente" con suggerimenti dall'anagrafica (rapportino e intervento).
// - Suggerimenti mentre si scrive, ognuno con NOME + INDIRIZZO (+ telefono) per distinguere gli omonimi.
// - Nessuna scelta automatica: con piu' clienti dallo stesso nome si avvisa e si sceglie la scheda giusta.
// - Scelta: si COPIANO nome, indirizzo e telefono nei campi del documento e si ricorda l'id della scheda.
//   I campi restano modificabili: le modifiche valgono solo per il documento (l'anagrafica non cambia).
// - Si puo' scrivere un cliente non in anagrafica, oppure crearlo al volo senza lasciare il documento.
// - "Aggiorna la scheda" (solo admin/company) copia indirizzo e telefono del documento nell'anagrafica,
//   solo su richiesta esplicita.
// Funziona offline con la copia dell'anagrafica sul telefono.
import { puo } from "../core/permessi.js";
import { su } from "../core/eventi.js";
import { elencoClienti, salvaCliente, statoAnagrafica } from "../services/clienti-archivio.js";
import { cercaClienti, datiPerDocumento, differenzeDocumento, etichettaCliente, omonimi, stessoNome } from "../services/clienti-logica.js";
import { esc } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";

let elenco = [];
const ricarica = ()=>elencoClienti().then(l=>{ elenco = l; }).catch(()=>{});
su("clienti-aggiornati", ricarica);
su("accesso", ricarica);
ricarica();

// apertura della scheda cliente (registrata da clienti.js per evitare dipendenze circolari)
let apriScheda = null;
export function registraSchedaCliente(fn){ apriScheda = fn; }

export function collegaSceltaCliente({ campo, indirizzo, telefono, onCambio }){
  const box = document.createElement("div");
  box.className = "cs-sugg nascosto";
  box.setAttribute("role", "listbox");
  box.id = campo.id + "-suggerimenti";
  const stato = document.createElement("div");
  stato.className = "cs-stato";
  stato.setAttribute("aria-live", "polite");
  campo.insertAdjacentElement("afterend", box);
  box.insertAdjacentElement("afterend", stato);
  campo.setAttribute("aria-autocomplete", "list");
  campo.setAttribute("aria-controls", box.id);
  campo.setAttribute("autocomplete", "off");

  let scelto = null;            // scheda collegata (come era al momento della scelta, o letta dall'anagrafica)
  let idCollegato = null;
  let nomeCollegato = "";       // nome scritto nel documento al momento del collegamento
  let voci = [], attiva = -1, timer = null, inScrittura = false;

  const notifica = ()=>{ disegnaStato(); if(onCambio) onCambio(); };
  const chiudi = ()=>{ box.classList.add("nascosto"); box.innerHTML = ""; voci = []; attiva = -1; campo.setAttribute("aria-expanded", "false"); };
  const imposta = (el, v)=>{ if(el){ el.value = v; el.dispatchEvent(new Event("input", { bubbles: true })); } };

  function seleziona(c){
    const d = datiPerDocumento(c);
    inScrittura = true;
    imposta(campo, d.cliente); imposta(indirizzo, d.indirizzo); imposta(telefono, d.telefono);
    inScrittura = false;
    scelto = c; idCollegato = c.id; nomeCollegato = d.cliente;
    chiudi();
    notifica();
  }
  function scollega(){ scelto = null; idCollegato = null; notifica(); }

  function mostra(){
    if(campo.disabled || campo.readOnly || !statoAnagrafica.attiva) return chiudi();
    const q = campo.value.trim();
    if(!q){ return chiudi(); }
    const trovati = cercaClienti(elenco, q, { massimo: 8 });
    const stessi = omonimi(elenco, q);
    voci = trovati.map(c=>({ tipo: "cliente", c }));
    voci.push({ tipo: "manuale" });
    if(puo("clienti.crea")) voci.push({ tipo: "nuovo" });
    let html = "";
    if(stessi.length > 1) html += '<div class="cs-avviso">' + icona("users", "i-sm") + stessi.length + ' clienti si chiamano «' + esc(stessi[0].nome) + '»: scegli quello giusto dall\'indirizzo.</div>';
    else if(!trovati.length) html += '<div class="cs-avviso neutro">Nessun cliente in anagrafica con «' + esc(q) + '».</div>';
    html += voci.map((v, i)=>{
      if(v.tipo === "cliente"){
        const c = v.c;
        return '<button type="button" class="cs-voce' + (c.id === idCollegato ? " scelto" : "") + '" role="option" data-i="' + i + '" id="' + box.id + '-' + i + '">' +
          '<span class="cs-nome">' + esc(c.nome) + (c._stato ? ' <span class="badge neutro">da inviare</span>' : '') + '</span>' +
          '<span class="cs-ind">' + icona("pin", "i-sm") + esc(c.indirizzo || "indirizzo non indicato") + '</span>' +
          (c.telefono ? '<span class="cs-tel">' + icona("phone", "i-sm") + esc(c.telefono) + '</span>' : '') + '</button>';
      }
      if(v.tipo === "manuale") return '<button type="button" class="cs-voce cs-azione" role="option" data-i="' + i + '" id="' + box.id + '-' + i + '">Usa «' + esc(q) + '» senza anagrafica</button>';
      return '<button type="button" class="cs-voce cs-azione cs-nuovo" role="option" data-i="' + i + '" id="' + box.id + '-' + i + '">' + icona("plus", "i-sm") + 'Nuovo cliente «' + esc(q) + '»</button>';
    }).join("");
    box.innerHTML = html;
    box.classList.remove("nascosto");
    campo.setAttribute("aria-expanded", "true");
    attiva = -1;
  }
  function esegui(i){
    const v = voci[i];
    if(!v) return;
    if(v.tipo === "cliente") return seleziona(v.c);
    if(v.tipo === "manuale"){ scollega(); return chiudi(); }
    chiudi();
    creaDaDocumento();
  }
  function creaDaDocumento(){
    if(!apriScheda) return;
    apriScheda({ nuovo: { nome: campo.value.trim(), indirizzo: indirizzo ? indirizzo.value.trim() : "", telefono: telefono ? telefono.value.trim() : "" },
      onSalvato: c=>{ elenco = elenco.filter(x=>x.id !== c.id).concat(c); seleziona(c); } });
  }

  // riga sotto il campo: collegamento all'anagrafica e azioni esplicite
  function disegnaStato(){
    if(!statoAnagrafica.attiva || campo.disabled && !idCollegato){ stato.innerHTML = ""; return; }
    if(idCollegato){
      const c = elenco.find(x=>x.id === idCollegato) || scelto;
      const doc = { indirizzo: indirizzo ? indirizzo.value : "", telefono: telefono ? telefono.value : "" };
      const diff = c && c.nome ? differenzeDocumento(c, doc) : [];
      stato.innerHTML = '<span class="cs-collegato">' + icona("check", "i-sm") + 'In anagrafica: ' + esc(c && c.nome ? etichettaCliente(c) : "scheda non disponibile") + '</span>' +
        (campo.disabled ? "" :
          '<button type="button" class="link-btn" data-az="scollega">Scollega</button>' +
          (diff.length && c && c.versione && puo("clienti.gestisci") ? '<button type="button" class="link-btn" data-az="aggiorna">Aggiorna la scheda (' + esc(diff.join(" e ")) + ')</button>' : '') +
          (c && c.nome && apriScheda ? '<button type="button" class="link-btn" data-az="scheda">Scheda</button>' : ''));
    } else if(campo.value.trim() && !campo.disabled){
      stato.innerHTML = '<span class="cs-libero">Cliente non in anagrafica</span>' +
        (puo("clienti.crea") && apriScheda ? '<button type="button" class="link-btn" data-az="crea">Aggiungi all\'anagrafica</button>' : '');
    } else stato.innerHTML = "";
  }
  stato.addEventListener("click", async e=>{
    const az = e.target.closest("[data-az]");
    if(!az) return;
    if(az.dataset.az === "scollega") scollega();
    else if(az.dataset.az === "crea") creaDaDocumento();
    else if(az.dataset.az === "scheda" && apriScheda) apriScheda({ id: idCollegato });
    else if(az.dataset.az === "aggiorna"){
      const c = elenco.find(x=>x.id === idCollegato);
      if(!c) return;
      const nuovi = { indirizzo: indirizzo ? indirizzo.value.trim() : c.indirizzo, telefono: telefono ? telefono.value.trim() : c.telefono };
      if(!confirm("Aggiornare la scheda di " + etichettaCliente(c) + " con i dati di questo documento?\n\nIndirizzo: " + (nuovi.indirizzo || "—") +
        "\nTelefono: " + (nuovi.telefono || "—") + "\n\nI documenti già salvati non cambiano.")) return;
      try{ await salvaCliente({ ...c, ...nuovi }, c); await ricarica(); disegnaStato(); }
      catch(err){ alert(err.message); }
    }
  });

  campo.addEventListener("input", ()=>{
    if(inScrittura) return;
    // il nome scritto non e' piu' quello della scheda: il documento non e' piu' collegato
    if(idCollegato && !stessoNome(campo.value, nomeCollegato)){ scelto = null; idCollegato = null; if(onCambio) onCambio(); }
    disegnaStato();
    clearTimeout(timer);
    timer = setTimeout(mostra, 120);
  });
  [indirizzo, telefono].forEach(el=>el && el.addEventListener("input", ()=>{ if(!inScrittura) disegnaStato(); }));
  campo.addEventListener("focus", ()=>{ if(campo.value.trim()) { clearTimeout(timer); timer = setTimeout(mostra, 150); } });
  campo.addEventListener("keydown", e=>{
    if(box.classList.contains("nascosto")) return;
    if(e.key === "ArrowDown" || e.key === "ArrowUp"){
      e.preventDefault();
      attiva = (attiva + (e.key === "ArrowDown" ? 1 : -1) + voci.length) % voci.length;
      box.querySelectorAll(".cs-voce").forEach((b, i)=>b.classList.toggle("attiva", i === attiva));
      campo.setAttribute("aria-activedescendant", box.id + "-" + attiva);
    } else if(e.key === "Enter" && attiva >= 0){ e.preventDefault(); esegui(attiva); }
    else if(e.key === "Escape"){ chiudi(); }
  });
  // tocco su un suggerimento: il campo non perde il fuoco prima del click (iPhone)
  box.addEventListener("pointerdown", e=>{ if(e.target.closest(".cs-voce")) e.preventDefault(); });
  box.addEventListener("click", e=>{ const b = e.target.closest(".cs-voce"); if(b) esegui(+b.dataset.i); });
  campo.addEventListener("blur", ()=>setTimeout(()=>{ if(document.activeElement !== campo) chiudi(); }, 200));

  return {
    id: ()=>idCollegato,
    // apertura di un documento: collegamento salvato (se c'e'); i campi li riempie il modulo
    imposta(cliente_id){
      idCollegato = cliente_id || null;
      scelto = idCollegato ? (elenco.find(x=>x.id === idCollegato) || { id: idCollegato, nome: campo.value }) : null;
      nomeCollegato = campo.value;
      chiudi(); disegnaStato();
    },
    aggiorna: disegnaStato,
    seleziona,
  };
}
