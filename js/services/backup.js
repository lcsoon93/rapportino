// Backup: esportazione e importazione dell'archivio in JSON.
import { leggiDB, scriviDB } from "../core/storage.js";
import { emetti } from "../core/eventi.js";

export function esportaBackup(){
  const db = leggiDB();
  const blob = new Blob([JSON.stringify(db, null, 2)], {type:"application/json"});
  const oggi = new Date().toISOString().slice(0,10);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "backup_rapporti_" + oggi + ".json";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
}
export function importaBackup(input){
  const file = input.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ()=>{
    try{
      const nuovo = JSON.parse(reader.result);
      if(typeof nuovo !== "object" || Array.isArray(nuovo)) throw new Error();
      const db = leggiDB();
      let n = 0;
      Object.keys(nuovo).forEach(k=>{
        if(/^\d{4}-\d{2}-\d{2}$/.test(k)){ db[k] = nuovo[k]; n++; }
      });
      scriviDB(db);
      emetti("archivio-aggiornato", "importazione");
      alert("Importati " + n + " giorni dal backup.");
    }catch(e){
      alert("File non valido: seleziona un backup esportato da questa app.");
    }
    input.value = "";
  };
  reader.readAsText(file);
}
