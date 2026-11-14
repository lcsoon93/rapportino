// Stampa di un PDF sul computer (usata dall'app e dalla pagina di ricerca search.html).
// Nessuna dipendenza dall'interfaccia dell'app: si puo' importare da qualsiasi pagina.
// Stampa sul computer: il PDF in una cornice nascosta e la finestra di stampa del browser.
// Safari (macOS) non stampa bene un PDF in una cornice: lo apre in una nuova scheda (Cmd+P).
// Se il browser blocca anche quella, si scarica il file.
export function stampaPDF(doc, nome){
  const url = URL.createObjectURL(doc.output("blob"));
  const safari = /^((?!chrome|chromium|crios|edg|firefox|fxios).)*safari/i.test(navigator.userAgent);
  const libera = ()=>setTimeout(()=>URL.revokeObjectURL(url), 120000);
  if(safari){
    const w = window.open(url, "_blank");
    if(!w) doc.save(nome);
    libera();
    return "scheda";
  }
  const f = document.createElement("iframe");
  f.className = "cornice-stampa";
  f.setAttribute("aria-hidden", "true");
  f.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0";
  f.onload = ()=>{
    try{ f.contentWindow.focus(); f.contentWindow.print(); }
    catch(e){ if(!window.open(url, "_blank")) doc.save(nome); }
    setTimeout(()=>{ f.remove(); URL.revokeObjectURL(url); }, 120000);
  };
  f.src = url;
  document.body.appendChild(f);
  return "stampa";
}
