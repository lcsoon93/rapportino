// Orario per operaio della giornata (dalle / alle e ore).
import { minutiOperaio, oreConStraordinario } from "../services/calculations.js";
import { segnalaModifica } from "../core/eventi.js";

export function aggiungiRigaOperaio(nome, dalle, alle){
  const div = document.createElement("div");
  div.className = "cliente op-riga";
  div.innerHTML =
    '<div class="testata">' +
      '<input type="text" class="op-nome" placeholder="Nome operaio" autocomplete="off">' +
      '<button type="button" class="togli" aria-label="Rimuovi operaio" onclick="togliOperaio(this)">&times;</button>' +
    '</div>' +
    '<div class="due">' +
      '<div><label>Dalle</label><div class="oranow">' +
        '<input type="time" class="op-dalle"><button type="button" class="btn-ora" onclick="oraAdesso(this)">Ora</button></div></div>' +
      '<div><label>Alle</label><div class="oranow">' +
        '<input type="time" class="op-alle"><button type="button" class="btn-ora" onclick="oraAdesso(this)">Ora</button></div></div>' +
    '</div>' +
    '<div class="totore" style="margin-top:8px;font-size:13.5px">Ore: <b class="op-ore">—</b></div>';
  document.getElementById("operai").appendChild(div);
  if(nome) div.querySelector(".op-nome").value = nome;
  if(dalle) div.querySelector(".op-dalle").value = dalle;
  if(alle) div.querySelector(".op-alle").value = alle;
  return div;
}
export function aggiungiOperaio(dati){
  const div = aggiungiRigaOperaio(
    dati && dati.nome, dati && dati.dalle, dati && dati.alle
  );
  calcolaRigaOperaio(div);
  return div;
}
export function togliOperaio(btn){
  btn.closest(".op-riga").remove();
  calcolaOreGiorno();
  segnalaModifica();
}
export function calcolaRigaOperaio(div){
  const op = {
    dalle: div.querySelector(".op-dalle").value,
    alle: div.querySelector(".op-alle").value
  };
  const min = minutiOperaio(op);
  div.querySelector(".op-ore").textContent = (op.dalle && op.alle) ? oreConStraordinario(min) : "—";
  return min;
}
export function calcolaOreGiorno(){
  document.querySelectorAll("#operai .op-riga").forEach(div=>{
    calcolaRigaOperaio(div);
  });
}
export function elencoOperai(){
  const out = [];
  document.querySelectorAll("#operai .op-riga").forEach(div=>{
    const nome = div.querySelector(".op-nome").value.trim();
    const dalle = div.querySelector(".op-dalle").value;
    const alle = div.querySelector(".op-alle").value;
    if(nome || dalle || alle){
      out.push({
        nome: nome || "(senza nome)",
        dalle, alle
      });
    }
  });
  return out;
}
