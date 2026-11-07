// Spese ed extra della giornata (con scontrino e cliente collegato).
import { totaleSpese } from "../services/calculations.js";
import { euro } from "../utils/formatters.js";
import { icona } from "../utils/dom.js";
import { comprimiImmagine } from "../services/immagini.js";
import { segnalaModifica } from "../core/eventi.js";

export function aggiungiRigaSpesa(desc, imp, allegato, clienteId){
  const riga = document.createElement("div");
  riga.className = "spesa-riga";
  riga.innerHTML =
    '<input type="text" class="s-desc" placeholder="Es. parcheggio, autostrada" autocomplete="off">' +
    '<input type="number" class="s-imp" placeholder="0,00" min="0" step="0.01" inputmode="decimal">' +
    '<button type="button" class="s-del" aria-label="Rimuovi spesa" onclick="this.parentElement.remove(); calcolaSpese(); salvaGiornata();">&times;</button>' +
    '<select class="s-cliente" aria-label="Cliente a cui collegare la spesa" onchange="this.closest(\'.spesa-riga\').dataset.cliente = this.value;"></select>' +
    '<div class="s-allegato">' +
      '<input type="file" class="s-file" accept="image/*" style="display:none" onchange="gestisciAllegatoSpesa(this)">' +
      '<input type="file" class="s-camera" accept="image/*" capture="environment" style="display:none" onchange="gestisciAllegatoSpesa(this)">' +
      '<div class="s-bottoni">' +
        '<button type="button" class="mat-add" onclick="this.closest(\'.spesa-riga\').querySelector(\'.s-file\').click()">' + icona("image") + 'Allega</button>' +
        '<button type="button" class="mat-add" onclick="this.closest(\'.spesa-riga\').querySelector(\'.s-camera\').click()">' + icona("camera") + 'Scatta</button>' +
      '</div>' +
      '<div class="s-anteprima nascosto">' +
        '<div class="foto-item">' +
          '<img class="s-img" alt="Allegato spesa" onclick="mostraFotoIntera(this.src)">' +
          '<button type="button" class="foto-del" aria-label="Rimuovi allegato" onclick="event.stopPropagation(); rimuoviAllegatoSpesa(this)">&times;</button>' +
        '</div>' +
        '<span>Allegato</span>' +
      '</div>' +
    '</div>';
  document.getElementById("spese").appendChild(riga);
  if(desc) riga.querySelector(".s-desc").value = desc;
  if(imp) riga.querySelector(".s-imp").value = imp;
  if(allegato) impostaAllegatoSpesa(riga, allegato);
  if(clienteId) riga.dataset.cliente = clienteId;
  costruisciOpzioniSpesa(riga);
}
// riempie la tendina "cliente" di una riga di spesa con i clienti attuali della giornata
export function costruisciOpzioniSpesa(riga){
  const sel = riga.querySelector(".s-cliente");
  const voluto = riga.dataset.cliente || "";
  sel.innerHTML = "";
  const vuota = document.createElement("option");
  vuota.value = "";
  vuota.textContent = "— Spesa non legata a un cliente —";
  sel.appendChild(vuota);
  document.querySelectorAll("#clienti .cliente").forEach((card, i)=>{
    const nome = card.querySelector(".c-nome").value.trim();
    const o = document.createElement("option");
    o.value = card.dataset.id;
    o.textContent = (i + 1) + ") " + (nome || "(senza nome)");
    sel.appendChild(o);
  });
  sel.value = voluto;                    // se il cliente non esiste piu' resta su "non legata"
  if(sel.value !== voluto) sel.value = "";
}
export function aggiornaSelectSpese(){
  document.querySelectorAll("#spese .spesa-riga").forEach(costruisciOpzioniSpesa);
}
// mostra/nasconde anteprima e bottoni in base alla presenza dell'allegato
export function impostaAllegatoSpesa(riga, foto){
  const img = riga.querySelector(".s-img");
  const f = (typeof foto === "string") ? {src: foto} : foto;
  if(f && f.src){
    img.src = f.src;
    img.dataset.w = f.w || "";
    img.dataset.h = f.h || "";
    riga.querySelector(".s-anteprima").classList.remove("nascosto");
    riga.querySelector(".s-bottoni").classList.add("nascosto");
  } else {
    img.removeAttribute("src");
    img.dataset.w = "";
    img.dataset.h = "";
    riga.querySelector(".s-anteprima").classList.add("nascosto");
    riga.querySelector(".s-bottoni").classList.remove("nascosto");
  }
}
export async function gestisciAllegatoSpesa(input){
  const riga = input.closest(".spesa-riga");
  const file = (input.files || [])[0];
  if(!file) return;
  try{
    const foto = await comprimiImmagine(file);
    impostaAllegatoSpesa(riga, foto);
  }catch(e){
    console.error(e);
    alert("Non sono riuscito a caricare l'allegato. Usa una foto o un'immagine (non un PDF).");
  }
  input.value = "";
  segnalaModifica();
}
export function rimuoviAllegatoSpesa(btn){
  impostaAllegatoSpesa(btn.closest(".spesa-riga"), null);
  segnalaModifica();
}
export function aggiungiSpesa(){
  aggiungiRigaSpesa();
  const r = document.querySelectorAll("#spese .spesa-riga");
  r[r.length-1].querySelector(".s-desc").focus();
}
export function elencoSpese(){
  const out = [];
  document.querySelectorAll("#spese .spesa-riga").forEach(r=>{
    const d = r.querySelector(".s-desc").value.trim();
    const i = parseFloat(r.querySelector(".s-imp").value) || 0;
    const img = r.querySelector(".s-img");
    const allegato = (img && img.getAttribute("src"))
      ? {src: img.src, w: +img.dataset.w || img.naturalWidth || 0, h: +img.dataset.h || img.naturalHeight || 0}
      : null;
    const clienteId = r.querySelector(".s-cliente").value || "";
    if(d || i || allegato){
      const voce = {d: d || "(senza descrizione)", i};
      if(allegato) voce.allegato = allegato;
      if(clienteId) voce.clienteId = clienteId;
      out.push(voce);
    }
  });
  return out;
}
export function calcolaSpese(){
  document.getElementById("totspese").textContent = euro(totaleSpese(elencoSpese()));
}
