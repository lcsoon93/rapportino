// Schede cliente (interventi) del rapportino: fasce orarie, materiale, foto, urgenze, riordino.
import { oraCorrente } from "../utils/dates.js";
import { icona } from "../utils/dom.js";
import { comprimiImmagine } from "../services/immagini.js";
import { aggiornaAnteprimaFirma, ritagliaFirmaSalvata } from "../services/signature.js";
import { aggiornaSelectSpese } from "./spese.js";
import { segnalaModifica } from "../core/eventi.js";

export function aggiungiCliente(dati){
  const div = document.createElement("div");
  div.className = "cliente";
  // identificativo stabile: serve a collegare le spese al cliente anche dopo riordini/cancellazioni
  div.dataset.id = (dati && dati.id) ? dati.id : ("c" + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
  // nota della pianificazione ("cosa fare"): non si mostra nella scheda ma si conserva al salvataggio
  if(dati && dati.richiesta) div.dataset.richiesta = dati.richiesta;
  div.innerHTML =
    '<div class="testata">' +
      '<span class="num"></span>' +
      '<div class="riordina">' +
        '<button type="button" class="riord-btn" aria-label="Sposta su" onclick="spostaCliente(this,-1)">&#9650;</button>' +
        '<button type="button" class="riord-btn" aria-label="Sposta giù" onclick="spostaCliente(this,1)">&#9660;</button>' +
      '</div>' +
      '<span class="badge">' + icona("zap") + 'Urgenza</span>' +
      '<input type="text" class="c-nome" placeholder="Cliente / luogo" autocomplete="off">' +
      '<button type="button" class="riprendi" title="Riprendi questo lavoro dopo un\'interruzione" onclick="riprendiLavoro(this)">Riprendi</button>' +
      '<button type="button" class="togli" aria-label="Rimuovi cliente" onclick="togliCliente(this)">&times;</button>' +
    '</div>' +
    '<label>Indirizzo / posizione</label>' +
    '<input type="text" class="c-indirizzo" placeholder="Via, numero, citta" autocomplete="off">' +
    '<label>Orari (una riga per ogni fascia)</label>' +
    '<div class="fasce"></div>' +
    '<button type="button" class="fasce-add" onclick="aggiungiFascia(this)">' + icona("plus") + 'Fascia oraria</button>' +
    '<label>Fatturare a / Rif. commessa (facoltativo)</label>' +
    '<input type="text" class="c-fatturare" placeholder="Es. Studio Amm. Rossi — commessa 26-114" autocomplete="off">' +
    '<label>Importo da fatturare (facoltativo)</label>' +
    '<input type="number" class="c-importo" placeholder="0,00" min="0" step="0.01" inputmode="decimal">' +
    '<div class="orari" style="margin-top:10px">' +
      '<div><label>Tipologia</label><select class="c-tipologia">' +
        '<option value="">—</option>' +
        '<option>Manutenzione ordinaria</option>' +
        '<option>Guasto / straordinaria</option>' +
        '<option>Nuovo impianto</option>' +
        '<option>Garanzia</option>' +
      '</select></div>' +
      '<div><label>Stato</label><select class="c-stato">' +
        '<option>Completato</option>' +
        '<option>Da ultimare</option>' +
      '</select></div>' +
    '</div>' +
    '<label>Dettagli lavoro eseguito</label>' +
    '<textarea class="c-dettagli" placeholder="Cosa avete fatto da questo cliente"></textarea>' +
    '<label>Materiale utilizzato</label>' +
    '<div class="materiali"></div>' +
    '<button type="button" class="mat-add" onclick="aggiungiMateriale(this)">' + icona("plus") + 'Riga materiale</button>' +
    '<label>Foto (facoltative)</label>' +
    '<div class="foto-galleria"></div>' +
    '<input type="file" class="foto-file" accept="image/*" multiple style="display:none" onchange="gestisciFoto(this)">' +
    '<input type="file" class="foto-camera" accept="image/*" capture="environment" style="display:none" onchange="gestisciFoto(this)">' +
    '<div class="foto-bottoni">' +
      '<button type="button" class="mat-add" style="flex:1" onclick="this.closest(\'.cliente\').querySelector(\'.foto-file\').click()">' + icona("image") + 'Carica foto</button>' +
      '<button type="button" class="mat-add" style="flex:1" onclick="this.closest(\'.cliente\').querySelector(\'.foto-camera\').click()">' + icona("camera") + 'Scatta foto</button>' +
    '</div>' +
    '<label>Firma cliente (facoltativa)</label>' +
    '<div class="firma-anteprima" onclick="apriFirmaOverlay(this)">' +
      '<img class="firma-img nascosto" alt="Firma cliente">' +
      '<span class="firma-placeholder">' + icona("pen") + 'Tocca per far firmare</span>' +
    '</div>' +
    '<button type="button" class="mat-add firma-clear-btn nascosto" onclick="if(confirm(\'Cancellare la firma del cliente?\')) pulisciFirma(this)">' + icona("trash") + 'Cancella firma</button>' +
    '<input type="hidden" class="c-firma-dato" value="">' +
    '<label>Nome firmatario (stampatello)</label>' +
    '<input type="text" class="c-firmatario" placeholder="Nome e cognome di chi firma" autocomplete="off">' +
    '<input type="hidden" class="c-urgente" value="">';
  document.getElementById("clienti").appendChild(div);

  if(dati){
    div.querySelector(".c-nome").value = dati.nome || "";
    div.querySelector(".c-indirizzo").value = dati.indirizzo || "";

    div.querySelector(".c-fatturare").value = dati.fatturare || "";
    div.querySelector(".c-importo").value = dati.importo || "";
    div.querySelector(".c-tipologia").value = dati.tipologia || "";
    div.querySelector(".c-stato").value = dati.stato || "Completato";
    div.querySelector(".c-dettagli").value = dati.dettagli || "";
    div.querySelector(".c-firmatario").value = dati.firmatario || "";
    if(dati.urgente){
      div.querySelector(".c-urgente").value = "1";
      div.classList.add("urgente");
    }
    // materiali: nuovo formato a righe, o vecchio formato testo unico
    if(dati.materiali && dati.materiali.length){
      dati.materiali.forEach(m=>aggiungiRigaMateriale(div, m.a, m.q));
    } else if(dati.materiale){
      aggiungiRigaMateriale(div, dati.materiale, "");
    }
    if(dati.foto && dati.foto.length){
      dati.foto.forEach(src=>aggiungiFotoThumbnail(div, src));
    }
    if(dati.firma){
      div.querySelector(".c-firma-dato").value = dati.firma;
      aggiornaAnteprimaFirma(div, dati.firma);
      ritagliaFirmaSalvata(div, dati.firma);
    }
    // fasce orarie: nuovo formato a lista, oppure vecchio formato dalle/alle
    if(dati.fasce && dati.fasce.length){
      dati.fasce.forEach(f=>aggiungiRigaFascia(div, f.d, f.a));
    } else if(dati.dalle || dati.alle){
      aggiungiRigaFascia(div, dati.dalle, dati.alle);
    } else {
      aggiungiRigaFascia(div);
    }
  } else {
    aggiungiRigaFascia(div);
  }
  rinumera();
}
// ---- fasce orarie di un cliente ----
export function aggiungiRigaFascia(clienteDiv, dalle, alle){
  const riga = document.createElement("div");
  riga.className = "fascia";
  riga.innerHTML =
    '<div class="fcampo"><label>Dalle</label><div class="oranow">' +
      '<input type="time" class="f-dalle">' +
      '<button type="button" class="btn-ora" onclick="oraAdesso(this)">Ora</button></div></div>' +
    '<div class="fcampo"><label>Alle</label><div class="oranow">' +
      '<input type="time" class="f-alle">' +
      '<button type="button" class="btn-ora" onclick="oraAdesso(this)">Ora</button></div></div>' +
    '<button type="button" class="f-del" aria-label="Rimuovi fascia" onclick="togliFascia(this)">&times;</button>';
  clienteDiv.querySelector(".fasce").appendChild(riga);
  if(dalle) riga.querySelector(".f-dalle").value = dalle;
  if(alle) riga.querySelector(".f-alle").value = alle;
  return riga;
}
export function aggiungiFascia(btn){
  const div = btn.closest(".cliente");
  const riga = aggiungiRigaFascia(div);
  riga.querySelector(".f-dalle").focus();
}
export function togliFascia(btn){
  const cliente = btn.closest(".cliente");
  btn.parentElement.remove();
  if(!cliente.querySelector(".fascia")) aggiungiRigaFascia(cliente);
  segnalaModifica();
}
export function aggiungiUrgenza(){
  aggiungiCliente({tipologia:"Guasto / straordinaria", urgente:true});
  const schede = document.querySelectorAll("#clienti .cliente");
  const nuova = schede[schede.length-1];
  // l'urgenza parte adesso
  nuova.querySelector(".f-dalle").value = oraCorrente();
  nuova.querySelector(".c-nome").focus();
  segnalaModifica();
}
// riprende lo stesso lavoro dopo un'interruzione: nuova fascia nella stessa scheda
export function riprendiLavoro(btn){
  const scheda = btn.closest(".cliente");
  const fasce = scheda.querySelectorAll(".fascia");
  const ultima = fasce[fasce.length-1];
  // chiudo la fascia in corso se era aperta
  if(ultima && ultima.querySelector(".f-dalle").value && !ultima.querySelector(".f-alle").value){
    ultima.querySelector(".f-alle").value = oraCorrente();
  }
  const riga = aggiungiRigaFascia(scheda);
  riga.querySelector(".f-dalle").value = oraCorrente();
  segnalaModifica();
}
export function togliCliente(btn){
  btn.closest(".cliente").remove();
  rinumera();
  segnalaModifica();
}
export function rinumera(){
  document.querySelectorAll("#clienti .cliente .num").forEach((n,i)=>n.textContent = i+1);
  aggiornaSelectSpese(); // numeri/ordine dei clienti cambiati: riallinea le tendine delle spese
}
// ---- riordino clienti (sposta su/giù) ----
export function spostaCliente(btn, direzione){
  const card = btn.closest(".cliente");
  const contenitore = card.parentElement;
  if(direzione < 0){
    const prec = card.previousElementSibling;
    if(prec) contenitore.insertBefore(card, prec);
  } else {
    const succ = card.nextElementSibling;
    if(succ) contenitore.insertBefore(succ, card);
  }
  rinumera();
  segnalaModifica();
}
export function aggiungiRigaMateriale(clienteDiv, articolo, qta){
  const riga = document.createElement("div");
  riga.className = "mat-riga";
  riga.innerHTML =
    '<input type="text" class="m-art" placeholder="Articolo (es. cavo 3x2,5)" autocomplete="off">' +
    '<input type="text" class="m-qta" placeholder="Q.tà" autocomplete="off">' +
    '<button type="button" class="m-del" aria-label="Rimuovi materiale" onclick="this.parentElement.remove(); salvaGiornata();">&times;</button>';
  clienteDiv.querySelector(".materiali").appendChild(riga);
  if(articolo) riga.querySelector(".m-art").value = articolo;
  if(qta) riga.querySelector(".m-qta").value = qta;
}
export function aggiungiMateriale(btn){
  const div = btn.closest(".cliente");
  aggiungiRigaMateriale(div);
  const righe = div.querySelectorAll(".mat-riga");
  righe[righe.length-1].querySelector(".m-art").focus();
}
export function aggiungiFotoThumbnail(clienteDiv, foto){
  // compatibile sia con {src,w,h} (nuovo formato) sia con una stringa dataURL (vecchio formato)
  const f = (typeof foto === "string") ? {src: foto} : foto;
  const galleria = clienteDiv.querySelector(".foto-galleria");
  const item = document.createElement("div");
  item.className = "foto-item";
  const attrW = f.w ? ' data-w="' + f.w + '"' : '';
  const attrH = f.h ? ' data-h="' + f.h + '"' : '';
  item.innerHTML =
    '<img src="' + f.src + '"' + attrW + attrH + ' alt="Foto cliente" onclick="mostraFotoIntera(this.src)">' +
    '<button type="button" class="foto-del" aria-label="Rimuovi foto" onclick="event.stopPropagation(); this.parentElement.remove(); salvaGiornata();">&times;</button>';
  galleria.appendChild(item);
}
export async function gestisciFoto(input){
  const clienteDiv = input.closest(".cliente");
  const files = Array.from(input.files || []);
  for(const file of files){
    try{
      const foto = await comprimiImmagine(file);
      aggiungiFotoThumbnail(clienteDiv, foto);
    }catch(e){
      console.error(e);
      alert("Non sono riuscito a caricare una delle foto.");
    }
  }
  input.value = "";
  segnalaModifica();
}
export function elencoClienti(){
  const out = [];
  document.querySelectorAll("#clienti .cliente").forEach(c=>{
    const nome = c.querySelector(".c-nome").value.trim();
    const indirizzo = c.querySelector(".c-indirizzo").value.trim();
    const fasce = [];
    c.querySelectorAll(".fascia").forEach(f=>{
      const d = f.querySelector(".f-dalle").value;
      const a = f.querySelector(".f-alle").value;
      if(d || a) fasce.push({d, a});
    });
    const fatturare = c.querySelector(".c-fatturare").value.trim();
    const importo = parseFloat(c.querySelector(".c-importo").value) || 0;
    const tipologia = c.querySelector(".c-tipologia").value;
    const stato = c.querySelector(".c-stato").value;
    const firmatario = c.querySelector(".c-firmatario").value.trim();
    const urgente = c.querySelector(".c-urgente").value === "1";
    const dettagli = c.querySelector(".c-dettagli").value.trim();
    const materiali = [];
    c.querySelectorAll(".mat-riga").forEach(r=>{
      const a = r.querySelector(".m-art").value.trim();
      const q = r.querySelector(".m-qta").value.trim();
      if(a) materiali.push({a, q});
    });
    const foto = [];
    c.querySelectorAll(".foto-item img").forEach(img=>{
      if(!img.src) return;
      const w = +img.dataset.w || img.naturalWidth || 0;
      const h = +img.dataset.h || img.naturalHeight || 0;
      foto.push({src: img.src, w, h});
    });
    const firma = c.querySelector(".c-firma-dato").value || "";
    if(nome || indirizzo || fasce.length || dettagli || materiali.length || firma || importo || foto.length){
      const scheda = {id: c.dataset.id, nome: nome || "(senza nome)", indirizzo, fasce, fatturare, importo, tipologia, stato, firmatario, dettagli, materiali, foto, firma, urgente};
      if(c.dataset.richiesta) scheda.richiesta = c.dataset.richiesta;
      out.push(scheda);
    }
  });
  return out;
}
