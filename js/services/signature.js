// Firma del cliente: pad a schermo intero, ritaglio e anteprima nella scheda.
import { emetti, segnalaModifica } from "../core/eventi.js";

export let clienteFirmaCorrente = null; // scheda cliente per cui e' aperto il pad in questo momento
export function aggiornaAnteprimaFirma(clienteDiv, dataURL){
  const img = clienteDiv.querySelector(".firma-img");
  const placeholder = clienteDiv.querySelector(".firma-placeholder");
  const bottoneCancella = clienteDiv.querySelector(".firma-clear-btn");
  if(dataURL){
    img.src = dataURL;
    img.classList.remove("nascosto");
    placeholder.classList.add("nascosto");
    bottoneCancella.classList.remove("nascosto");
  } else {
    img.src = "";
    img.classList.add("nascosto");
    placeholder.classList.remove("nascosto");
    bottoneCancella.classList.add("nascosto");
  }
}
// la firma puo' stare nel foglio giornaliero (si salva la giornata) o in un altro modulo, es. il
// rapportino: in quel caso si avvisa solo con l'evento "firma-cambiata" e salva chi la contiene
function avvisaCambio(scheda){
  if(scheda && scheda.closest("#vista-giorno")) segnalaModifica();
  else emetti("firma-cambiata", scheda);
}
export function pulisciFirma(btn){
  const clienteDiv = btn.closest(".cliente");
  clienteDiv.querySelector(".c-firma-dato").value = "";
  aggiornaAnteprimaFirma(clienteDiv, "");
  avvisaCambio(clienteDiv);
}
// adatta il canvas alla superficie disponibile (nitido su schermi ad alta densita').
// Con conserva=true (rotazione del telefono) ridisegna la firma gia' fatta, centrata e senza deformarla.
export function dimensionaPadFirma(conserva){
  const overlay = document.getElementById("firma-overlay");
  const canvas = document.getElementById("firma-overlay-canvas");
  const pad = overlay.querySelector(".firma-overlay-pad");
  const rectW = pad.clientWidth, rectH = pad.clientHeight;
  const dpr = window.devicePixelRatio || 1;
  if(!rectW || !rectH) return;
  if(canvas.width === Math.round(rectW * dpr) && canvas.height === Math.round(rectH * dpr)) return;
  let copia = null;
  if(conserva && canvas.dataset.pieno === "1" && canvas.width && canvas.height){
    copia = document.createElement("canvas");
    copia.width = canvas.width; copia.height = canvas.height;
    copia.getContext("2d").drawImage(canvas, 0, 0);
  }
  canvas.width = Math.round(rectW * dpr);
  canvas.height = Math.round(rectH * dpr);
  const ctx = canvas.getContext("2d");
  if(copia){
    const s = Math.min(canvas.width / copia.width, canvas.height / copia.height);
    const dw = copia.width * s, dh = copia.height * s;
    ctx.drawImage(copia, (canvas.width - dw) / 2, (canvas.height - dh) / 2, dw, dh);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.lineWidth = 4;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#14213D";
}
// rotazione / ridimensionamento mentre il pad e' aperto
export function suCambioDimensioniFirma(){
  if(document.getElementById("firma-overlay").classList.contains("nascosto")) return;
  // aspetto che il browser abbia finito di ruotare prima di misurare
  setTimeout(()=>dimensionaPadFirma(true), 250);
}
window.addEventListener("resize", suCambioDimensioniFirma);
window.addEventListener("orientationchange", suCambioDimensioniFirma);
export function apriFirmaOverlay(triggerEl){
  clienteFirmaCorrente = triggerEl.closest(".cliente");
  const overlay = document.getElementById("firma-overlay");
  const hint = document.getElementById("firma-overlay-hint");
  const canvas = document.getElementById("firma-overlay-canvas");
  overlay.classList.remove("nascosto");

  dimensionaPadFirma(false);
  const pad = overlay.querySelector(".firma-overlay-pad");
  const rectW = pad.clientWidth, rectH = pad.clientHeight;
  const ctx = canvas.getContext("2d");
  canvas.dataset.pieno = "";
  canvas.dataset.modificata = "";
  hint.style.display = "";
  aggiornaPulsantiFirma();

  // se il cliente ha gia' una firma salvata, la ricarico per permettere di rifarla/integrarla
  const dato = clienteFirmaCorrente.querySelector(".c-firma-dato").value;
  if(dato){
    const img = new Image();
    img.onload = ()=>{
      const dpr = window.devicePixelRatio || 1;
      const s = Math.min(rectW / img.width, rectH / img.height, 1 / dpr);
      const dw = img.width * s, dh = img.height * s;
      ctx.drawImage(img, (rectW - dw) / 2, (rectH - dh) / 2, dw, dh);
      canvas.dataset.pieno = "1";
      hint.style.display = "none";
      aggiornaPulsantiFirma();
    };
    img.src = dato;
  }
}
// "Salva" e "Cancella" attivi solo quando c'e' qualcosa di disegnato
export function aggiornaPulsantiFirma(){
  const piena = document.getElementById("firma-overlay-canvas").dataset.pieno === "1";
  document.getElementById("fo-conferma").disabled = !piena;
  document.getElementById("fo-cancella").disabled = !piena;
}
// "Indietro": se la firma e' stata modificata chiedo conferma prima di perderla
export function annullaFirmaOverlay(){
  const canvas = document.getElementById("firma-overlay-canvas");
  if(canvas.dataset.modificata === "1" && !confirm("Uscire senza salvare la firma?")) return;
  chiudiFirmaOverlay(false);
}
export function pulisciFirmaOverlay(){
  const canvas = document.getElementById("firma-overlay-canvas");
  canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  canvas.dataset.pieno = "";
  canvas.dataset.modificata = "1";
  document.getElementById("firma-overlay-hint").style.display = "";
  aggiornaPulsantiFirma();
}
// ritaglia la firma attorno al tratto (il pad e' grande quanto lo schermo, la firma ne occupa una parte):
// cosi' nel PDF la firma riempie il suo spazio invece di diventare minuscola
export function ritagliaFirma(sorgente){
  const w = sorgente.width, h = sorgente.height;
  let tela = sorgente;
  if(!(sorgente instanceof HTMLCanvasElement)){
    tela = document.createElement("canvas");
    tela.width = w; tela.height = h;
    tela.getContext("2d").drawImage(sorgente, 0, 0);
  }
  const px = tela.getContext("2d").getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for(let y = 0; y < h; y++){
    for(let x = 0; x < w; x++){
      if(px[(y * w + x) * 4 + 3] > 20){
        if(x < x0) x0 = x;
        if(x > x1) x1 = x;
        if(y < y0) y0 = y;
        if(y > y1) y1 = y;
      }
    }
  }
  if(x1 < 0) return tela.toDataURL("image/png");      // vuota: lascio com'e'
  const margine = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04) + 4;
  x0 = Math.max(0, x0 - margine); y0 = Math.max(0, y0 - margine);
  x1 = Math.min(w - 1, x1 + margine); y1 = Math.min(h - 1, y1 + margine);
  const lw = x1 - x0 + 1, lh = y1 - y0 + 1;
  const scala = Math.min(1, 1200 / lw);                // non serve piu' di 1200 px di larghezza
  const out = document.createElement("canvas");
  out.width = Math.round(lw * scala); out.height = Math.round(lh * scala);
  out.getContext("2d").drawImage(tela, x0, y0, lw, lh, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}
// firme salvate prima del ritaglio: le ritaglio al caricamento della scheda
export function ritagliaFirmaSalvata(clienteDiv, dataURL){
  const img = new Image();
  img.onload = ()=>{
    try{
      const nuova = ritagliaFirma(img);
      if(clienteDiv.querySelector(".c-firma-dato").value === dataURL){
        clienteDiv.querySelector(".c-firma-dato").value = nuova;
        aggiornaAnteprimaFirma(clienteDiv, nuova);
      }
    }catch(e){ console.error(e); }
  };
  img.src = dataURL;
}
export function chiudiFirmaOverlay(conferma){
  const canvas = document.getElementById("firma-overlay-canvas");
  if(conferma && clienteFirmaCorrente && canvas.dataset.pieno === "1"){
    const dataURL = ritagliaFirma(canvas);
    clienteFirmaCorrente.querySelector(".c-firma-dato").value = dataURL;
    aggiornaAnteprimaFirma(clienteFirmaCorrente, dataURL);
    avvisaCambio(clienteFirmaCorrente);
  }
  document.getElementById("firma-overlay").classList.add("nascosto");
  clienteFirmaCorrente = null;
  emetti("firma-chiusa");
}
// gestori touch/penna sul pad, collegati una sola volta al canvas condiviso
(function allestisciPadFirma(){
  const canvas = document.getElementById("firma-overlay-canvas");
  const hint = document.getElementById("firma-overlay-hint");
  let giu = false;
  function xy(e){
    const r = canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  }
  canvas.addEventListener("pointerdown", e=>{
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    giu = true;
    const [x,y] = xy(e);
    const ctx = canvas.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(x,y);
  });
  canvas.addEventListener("pointermove", e=>{
    if(!giu) return;
    e.preventDefault();
    const [x,y] = xy(e);
    const ctx = canvas.getContext("2d");
    ctx.lineTo(x,y);
    ctx.stroke();
    if(canvas.dataset.pieno !== "1"){
      canvas.dataset.pieno = "1";
      hint.style.display = "none";
      aggiornaPulsantiFirma();
    }
    canvas.dataset.modificata = "1";
  });
  function fine(){ giu = false; }
  canvas.addEventListener("pointerup", fine);
  canvas.addEventListener("pointercancel", fine);
})();
