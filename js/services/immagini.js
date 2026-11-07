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
export function mostraFotoIntera(src){
  const overlay = document.createElement("div");
  overlay.className = "foto-vuoto-overlay";
  overlay.innerHTML = '<img src="' + src + '">';
  overlay.onclick = ()=>overlay.remove();
  document.body.appendChild(overlay);
}
