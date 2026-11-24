// Utilità condivise per il modulo giornata.
export { icona } from "../utils/dom.js";
export { esc } from "../utils/formatters.js";
import { isoDi } from "../utils/dates.js";

// giorno locale (toISOString darebbe il giorno UTC: sbagliato tra mezzanotte e le 2)
export function iso(d) { return isoDi(d); }

const GIORNI = ["Domenica", "Lunedì", "Martedì", "Mercoledì", "Giovedì", "Venerdì", "Sabato"];
const MESI = ["gennaio", "febbraio", "marzo", "aprile", "maggio", "giugno", "luglio", "agosto", "settembre", "ottobre", "novembre", "dicembre"];

export function formattaData(isoStr) {
  if (!isoStr) return "";
  const d = new Date(isoStr + "T12:00:00");
  return GIORNI[d.getDay()] + " " + d.getDate() + " " + MESI[d.getMonth()];
}

export function formattaOra(timeStr) {
  if (!timeStr) return "";
  return timeStr.slice(0, 5);
}

export function minutiAOre(min) {
  if (!min) return "0h";
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? h + "h " + m + "m" : h + "h";
}
