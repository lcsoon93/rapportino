// Immagini: compressione delle foto e visualizzazione a schermo intero.

// riduce dimensione/peso dell'immagine prima di salvarla (meno spazio sul telefono e sul server),
// mantenendo le proporzioni reali cosi' nel PDF non viene mai distorta
export function comprimiImmagine(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        const LATO_MAX = 1600;
        let w = img.width, h = img.height;
        if(w > h && w > LATO_MAX){ h = Math.round(h * LATO_MAX / w); w = LATO_MAX; }
        else if(h >= w && h > LATO_MAX){ w = Math.round(w * LATO_MAX / h); h = LATO_MAX; }
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        resolve({src: canvas.toDataURL("image/jpeg", 0.78), w, h});
      };
      img.onerror = ()=>reject(new Error("immagine non valida"));
      img.src = reader.result;
    };
    reader.onerror = ()=>reject(new Error("lettura file fallita"));
    reader.readAsDataURL(file);
  });
}
// foto a schermo intero: un tocco sulla foto la ingrandisce (dimensione reale, si scorre),
// un tocco sullo sfondo o su "Chiudi" la chiude
export function mostraFotoIntera(src){
  const overlay = document.createElement("div");
  overlay.className = "foto-vuoto-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-label", "Foto");
  overlay.innerHTML = '<img alt="Foto" title="Tocca per ingrandire"><button type="button" class="foto-chiudi" aria-label="Chiudi">&times;</button>';
  overlay.querySelector("img").src = src;
  overlay.onclick = e=>{
    if(e.target.tagName === "IMG"){ overlay.classList.toggle("zoom"); return; }
    overlay.remove();
  };
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------- foto dei rapportini (Storage)
// Tipi accettati in ingresso (poi l'app salva sempre JPEG). HEIC: il browser dell'iPhone di solito
// lo converte gia' in JPEG quando si sceglie la foto; se non riesce a leggerla risponde "non valida".
export const TIPI_FOTO = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "image/gif", "image/bmp"];
export const MAX_ORIGINALE = 25 * 1024 * 1024;     // file scelto: oltre non si prova nemmeno a leggerlo
export const MAX_FOTO = 3145728;                   // file salvato: come il limite del bucket (3 MB)
// impronta SHA-256 del file originale: la stessa foto scelta due volte viene riconosciuta
export async function improntaFile(file){
  const buf = await file.arrayBuffer();
  const h = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(h)].map(b=>b.toString(16).padStart(2, "0")).join("");
}
// controlla e comprime: lato lungo 1600 px, JPEG (stessa qualita' delle foto del foglio giornaliero);
// se il risultato superasse comunque il limite riprova con qualita' minore
export function preparaFoto(file){
  if(file.type && !TIPI_FOTO.includes(file.type.toLowerCase())) return Promise.reject(new Error("tipo di file non consentito (" + file.type + ")"));
  if(!file.type && !/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name || "")) return Promise.reject(new Error("tipo di file non consentito"));
  if(file.size > MAX_ORIGINALE) return Promise.reject(new Error("foto troppo grande (massimo 25 MB)"));
  return new Promise((resolve, reject)=>{
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = ()=>{
      URL.revokeObjectURL(url);
      const LATO_MAX = 1600;
      let w = img.naturalWidth, h = img.naturalHeight;
      if(!w || !h){ reject(new Error("immagine non valida")); return; }
      if(w > h && w > LATO_MAX){ h = Math.round(h * LATO_MAX / w); w = LATO_MAX; }
      else if(h >= w && h > LATO_MAX){ w = Math.round(w * LATO_MAX / h); h = LATO_MAX; }
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      canvas.getContext("2d").drawImage(img, 0, 0, w, h);
      const prova = q=>canvas.toBlob(b=>{
        if(!b){ reject(new Error("immagine non valida")); return; }
        if(b.size > MAX_FOTO && q > 0.5){ prova(q - 0.15); return; }
        if(b.size > MAX_FOTO){ reject(new Error("foto troppo grande anche dopo la compressione")); return; }
        resolve({ blob: b, w, h, mime: "image/jpeg" });
      }, "image/jpeg", q);
      prova(0.78);
    };
    img.onerror = ()=>{ URL.revokeObjectURL(url); reject(new Error("immagine non valida")); };
    img.src = url;
  });
}
export function blobInDataUrl(blob){
  return new Promise((ok, ko)=>{
    const r = new FileReader();
    r.onload = ()=>ok(r.result);
    r.onerror = ()=>ko(new Error("lettura della foto non riuscita"));
    r.readAsDataURL(blob);
  });
}
