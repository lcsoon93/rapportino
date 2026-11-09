// Rapportino della giornata: caricamento, raccolta dati, salvataggio automatico, data selezionata.
import { SINC_ATTIVA } from "../core/config.js";
import { dataIt, dataLunga, etichettaGiorno, isoDi, oggiIso } from "../utils/dates.js";
import { SPUNTE_ORE_CLIENTE, salvaPrefExtra, salvaPrefFoglioUnico, salvaPrefNascondiOre, salvaPrefNascondiOreMese, aggiornaSpunteOreCliente } from "../core/preferenze.js";
import { salvaImpostazione } from "../services/impostazioni.js";
import { avvisoArchivio, leggiDB, leggiTimbri, scriviDB, scriviTimbri } from "../core/storage.js";
import { cancellaGiornoRemoto, inviaGiorno, registraBase, statoSinc, versioneConfermata } from "../services/sync.js";
import { mostraVista } from "../core/navigation.js";
import { aggiungiCliente, elencoClienti } from "./interventi.js";
import { aggiungiOperaio, calcolaOreGiorno, elencoOperai } from "./operai.js";
import { aggiornaSelectSpese, aggiungiRigaSpesa, calcolaSpese, elencoSpese } from "./spese.js";
import { emetti, su } from "../core/eventi.js";

// aggiorna le etichette che mostrano la giornata selezionata
export function aggiornaTestiData(){
  const iso = document.getElementById("data").value;
  if(!iso) return;
  document.getElementById("giorno-sottotitolo").textContent = dataLunga(iso);
  document.getElementById("home-giorno-etichetta").textContent = etichettaGiorno(iso);
  document.getElementById("home-data").value = iso;
  document.getElementById("home-btn-oggi").classList.toggle("nascosto", iso === oggiIso());
  document.getElementById("altro-data").textContent = dataLunga(iso);
}
export function spostaGiorno(delta){
  const el = document.getElementById("data");
  const d = new Date(el.value + "T12:00:00");
  d.setDate(d.getDate() + delta);
  el.value = isoDi(d);
  caricaGiornata(el.value);
}
export function vaiOggi(){
  const el = document.getElementById("data");
  el.value = oggiIso();
  caricaGiornata(el.value);
}
export function copiaIeri(){
  const iso = document.getElementById("data").value;
  const prec = new Date(iso + "T12:00:00");
  prec.setDate(prec.getDate() - 1);
  const isoPrec = isoDi(prec);
  const db = leggiDB();
  if(!db[isoPrec]){
    alert("Nessun rapporto salvato per " + dataIt(isoPrec) + ".");
    return;
  }
  if(db[iso] && !confirm("Sovrascrivere la giornata attuale con i dati di ieri?")) return;
  const copia = JSON.parse(JSON.stringify(db[isoPrec]));
  copia.clienti.forEach(c=>{ c.firma = ""; c.firmatario = ""; }); // firme e firmatari non si copiano
  copia.spese = [];                                               // le spese sono del giorno
  db[iso] = copia;
  scriviDB(db);
  caricaGiornata(iso);
}
export function svuotaGiornata(){
  const iso = document.getElementById("data").value;
  if(!confirm("Svuotare il rapporto del " + dataIt(iso) + "?")) return;
  const db = leggiDB();
  delete db[iso];
  scriviDB(db);
  cancellaGiornoRemoto(iso);
  caricaGiornata(iso);
}
export function datiGiornata(){
  return {
    tecnici: document.getElementById("tecnici").value.trim(),
    escludi: document.getElementById("escludi-monte").checked,
    operai: elencoOperai(),
    clienti: elencoClienti(),
    spese: elencoSpese()
  };
}
export let timerSalva = null;
export function salvaGiornata(){
  clearTimeout(timerSalva);
  timerSalva = setTimeout(()=>{
    timerSalva = null;
    const iso = document.getElementById("data").value;
    if(!iso) return;
    const db = leggiDB();
    const d = datiGiornata();
    if(d.clienti.length === 0 && d.spese.length === 0 && d.operai.length === 0){
      delete db[iso];
    } else {
      db[iso] = d;
    }
    const ok = scriviDB(db);
    emetti("giornata-salvata");
    const s = document.getElementById("statosalvataggio");
    if(ok){
      s.style.color = "";
      s.textContent = "Salvato ✓";
      setTimeout(()=>{ if(s.textContent === "Salvato ✓") s.textContent = ""; }, 1500);
    } else {
      // anche se il telefono non riesce a salvare, la modifica va comunque al server
      avvisoArchivio();
    }
    // invio al server condiviso
    if(SINC_ATTIVA()){
      const quando = new Date().toISOString();
      const timbri = leggiTimbri();
      timbri[iso] = quando;
      scriviTimbri(timbri);
      if(db[iso]){
        inviaGiorno(iso, db[iso])
          .then(()=>statoSinc(""))
          .catch(e=>statoSinc(e && (e.stato === 403 || e.stato === 409)
            ? "Non sei autorizzato a salvare questa giornata sul server: resta solo su questo telefono."
            : "In attesa di rete", e && (e.stato === 403 || e.stato === 409) ? "#B3413A" : "#C97B3D"));
      } else {
        cancellaGiornoRemoto(iso);
      }
    }
  }, 600);
}
export function caricaGiornata(iso){
  const db = leggiDB();
  const d = db[iso];
  document.getElementById("clienti").innerHTML = "";
  document.getElementById("spese").innerHTML = "";
  document.getElementById("operai").innerHTML = "";
  if(d){
    document.getElementById("tecnici").value = d.tecnici || "Luca / Francesco";
    document.getElementById("escludi-monte").checked = !!d.escludi;
    (d.spese || []).forEach(s=>aggiungiRigaSpesa(s.d, s.i, s.allegato, s.clienteId));
    if(d.operai && d.operai.length){
      d.operai.forEach(op=>aggiungiOperaio(op));
    } else if(d.dalle || d.alle){
      // migrazione dal vecchio formato (un solo orario condiviso per tutti)
      const nomi = (d.tecnici || "").split("/").map(s=>s.trim()).filter(Boolean);
      if(nomi.length){
        nomi.forEach(n=>aggiungiOperaio({nome:n, dalle:d.dalle, alle:d.alle}));
      } else {
        aggiungiOperaio({dalle:d.dalle, alle:d.alle});
      }
    } else if(d.pianificato && d.tecnici){
      // giornata preparata dalla pianificazione: gli operai proposti sono quelli assegnati
      d.tecnici.split("/").map(s=>s.trim()).filter(Boolean).forEach(n=>aggiungiOperaio({nome:n, dalle:"08:00", alle:"17:00"}));
    } else {
      aggiungiOperaio({nome:"Luca", dalle:"08:00", alle:"17:00"});
      aggiungiOperaio({nome:"Francesco", dalle:"08:00", alle:"17:00"});
    }
    if(d.clienti && d.clienti.length) d.clienti.forEach(c=>aggiungiCliente(c));
    else aggiungiCliente();
  } else {
    document.getElementById("tecnici").value = "Luca / Francesco";
    document.getElementById("escludi-monte").checked = false;
    aggiungiOperaio({nome:"Luca", dalle:"08:00", alle:"17:00"});
    aggiungiOperaio({nome:"Francesco", dalle:"08:00", alle:"17:00"});
    aggiungiCliente();
  }
  calcolaOreGiorno();
  calcolaSpese();
  aggiornaTestiData();
  // senza modifiche in sospeso, cio' che e' sullo schermo coincide con la versione del server:
  // diventa la versione di partenza per unire eventuali modifiche concorrenti
  const timbro = leggiTimbri()[iso];
  if(d && versioneConfermata(iso, timbro)) registraBase(iso, d, timbro);
  emetti("giornata-caricata");
}
document.addEventListener("input", e=>{
  if(e.target.closest("#vista-giorno")){
    if(e.target.closest(".op-riga")) calcolaOreGiorno();
    if(e.target.closest(".spesa-riga")) calcolaSpese();
    if(e.target.classList.contains("c-nome")) aggiornaSelectSpese();
    if(e.target.id === "data"){ caricaGiornata(e.target.value); return; }
    salvaGiornata();
  }
});
document.addEventListener("change", e=>{
  if(["stampa-extra","stampa-extra-sett","stampa-extra-mese"].includes(e.target.id)){
    const v = e.target.checked;
    ["stampa-extra","stampa-extra-sett","stampa-extra-mese"].forEach(id=>{
      document.getElementById(id).checked = v;
    });
    salvaPrefExtra(v);
    return;
  }
  if(SPUNTE_ORE_CLIENTE.includes(e.target.id)){
    const v = e.target.checked;
    SPUNTE_ORE_CLIENTE.forEach(id=>{ const el = document.getElementById(id); if(el) el.checked = v; });
    // impostazione condivisa: la decide l'admin e vale per le stampe di tutti
    salvaImpostazione("ore_per_cliente", v).catch(err=>{
      aggiornaSpunteOreCliente();            // torna com'era
      alert("Impostazione non salvata: " + err.message + "\nControlla la connessione e riprova.");
    });
    return;
  }
  if(e.target.id === "nascondi-ore-mese"){
    salvaPrefNascondiOreMese(e.target.checked);
    return;
  }
  if(e.target.id === "nascondi-ore-giorno"){
    salvaPrefNascondiOre(e.target.checked);
    return;
  }
  if(e.target.id === "pdf-foglio-unico"){
    salvaPrefFoglioUnico(e.target.checked);
    return;
  }
  if(e.target.closest("#vista-giorno") && e.target.id !== "data") salvaGiornata();
});
export function apriGiorno(iso){
  document.getElementById("data").value = iso;
  caricaGiornata(iso);
  mostraVista("giorno");
}

// le altre parti segnalano una modifica: si salva (con il solito ritardo)
su("giornata-modificata", salvaGiornata);
// archivio cambiato da sincronizzazione o importazione: si ricarica la giornata aperta
su("archivio-aggiornato", ()=>caricaGiornata(document.getElementById("data").value));
// un salvataggio ha unito le mie modifiche con quelle di altri: si ridisegna la giornata aperta,
// ma solo quando non si sta scrivendo e non ci sono salvataggi in attesa (per non perdere battute)
su("giornata-unita", function ridisegna(iso){
  if(document.getElementById("data").value !== iso) return;
  const editor = document.getElementById("vista-giorno");
  if(timerSalva !== null || editor.contains(document.activeElement) ||
     !document.getElementById("firma-overlay").classList.contains("nascosto")){
    setTimeout(()=>ridisegna(iso), 1500);
    return;
  }
  caricaGiornata(iso);
});
