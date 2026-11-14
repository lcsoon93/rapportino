// Computer o telefono? Sul computer (mouse/trackpad, nessuno schermo touch) i PDF si STAMPANO
// (finestra di stampa del browser, da cui si puo' anche "Salva come PDF"); sul telefono si condividono.
export function sulComputer(){
  if(typeof window === "undefined" || !window.matchMedia) return false;
  const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return !mobile && matchMedia("(hover: hover) and (pointer: fine)").matches;
}
// sul computer le etichette dei pulsanti PDF diventano "Stampa…" (attributo data-testo-computer)
export function etichetteDispositivo(radice = document){
  if(!sulComputer()) return;
  document.body.classList.add("computer");
  radice.querySelectorAll("[data-testo-computer]").forEach(el=>{ el.textContent = el.dataset.testoComputer; });
}
