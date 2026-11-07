// Piccoli aiuti per il DOM: icone SVG e pulsante "Ora".
import { oraCorrente } from "./dates.js";

export function icona(nome, cls){ return '<svg class="i' + (cls ? " " + cls : "") + '" aria-hidden="true"><use href="#i-' + nome + '"/></svg>'; }
export function oraAdesso(btn){
  const input = btn.parentElement.querySelector("input");
  input.value = oraCorrente();
  input.dispatchEvent(new Event("input", {bubbles:true}));
}
