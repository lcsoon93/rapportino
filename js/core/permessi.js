// Autorizzazioni dell'interfaccia: UNICO punto in cui si decide cosa vede ciascun ruolo.
// E' solo comodita' per l'utente: la protezione vera sono le policy RLS e i trigger su Supabase.
//
// Negli elementi HTML basta scrivere data-permesso="nome": vengono nascosti (anche quelli
// generati dopo) se il ruolo collegato non ha quel permesso.
import { profilo } from "./sessione.js";

const PERMESSI = {
  admin: [
    "vista.home", "vista.giorno", "vista.calgiorno", "vista.sett", "vista.mese", "vista.cerca", "vista.altro",
    "vista.utenti", "vista.interventi", "vista.rapporti", "vista.lavoro", "vista.rapportino", "vista.storico",
    "rapportino.compila", "rapportino.elimina", "interventi.gestisci", "interventi.elimina", "utenti.gestisci",
    "rapportini.compila", "rapportini.consulta", "rapportini.riapri", "giornate.consulta",
    "backup.esporta", "backup.importa", "report", "pdf", "pdf.opzioni",
  ],
  company: [
    "vista.interventi", "vista.rapporti", "vista.rapportino", "vista.altro",
    "vista.calgiorno", "vista.sett", "vista.mese",          // Calendario degli interventi (consultazione)
    "vista.storico",                                         // Storico (consultazione)
    "interventi.gestisci", "rapportini.consulta", "giornate.consulta", "pdf.consulta",
  ],
  worker: [
    "vista.lavoro", "vista.rapportino", "vista.rapporti", "vista.altro",
    "vista.calgiorno", "vista.sett", "vista.mese",          // Calendario: solo gli interventi che le policy gli mostrano
    "rapportini.compila",
  ],
};

// navigazione in basso per ruolo: [id, etichetta, icona, vista]
const NAV = {
  admin:   [["home", "Home", "home", "home"], ["interventi", "Interventi", "file", "interventi"], ["cal", "Calendario", "cal", "cal"], ["clienti", "Clienti", "users", "cerca"], ["altro", "Altro", "grid", "altro"]],
  company: [["interventi", "Interventi", "sliders", "interventi"], ["cal", "Calendario", "cal", "cal"], ["rapporti", "Rapportini", "file", "rapporti"], ["altro", "Altro", "grid", "altro"]],
  worker:  [["lavoro", "Lavoro", "home", "lavoro"], ["cal", "Calendario", "cal", "cal"], ["rapporti", "Rapportini", "file", "rapporti"], ["altro", "Altro", "grid", "altro"]],
};
const VISTA_INIZIALE = { admin: "home", company: "interventi", worker: "lavoro" };

export function ruolo(){ return profilo ? profilo.ruolo : null; }
export function puo(permesso){
  const r = ruolo();
  return !!r && PERMESSI[r].includes(permesso);
}
export function vocinav(){ return NAV[ruolo()] || []; }
export function vistaIniziale(){ return VISTA_INIZIALE[ruolo()] || "home"; }

function applica(radice){
  const elementi = radice.querySelectorAll ? radice.querySelectorAll("[data-permesso]") : [];
  const tutti = radice.matches && radice.matches("[data-permesso]") ? [radice, ...elementi] : [...elementi];
  tutti.forEach(el=>{
    const serve = el.getAttribute("data-permesso").split(/\s+/);   // basta uno dei permessi indicati
    el.classList.toggle("vietato", !serve.some(puo));
  });
}
export function applicaPermessi(){
  applica(document.body);
  document.body.dataset.ruolo = ruolo() || "";
}
// anche l'HTML generato in seguito (elenchi, schede) rispetta i permessi
new MutationObserver(mutazioni=>{
  mutazioni.forEach(m=>m.addedNodes.forEach(n=>{ if(n.nodeType === 1) applica(n); }));
}).observe(document.documentElement, { childList: true, subtree: true });
