// Piccolo bus di eventi: permette ai moduli di avvisarsi senza importarsi a vicenda
// (evita le dipendenze circolari). Gli ascoltatori vengono chiamati subito, nell'ordine
// in cui si sono registrati.
//
// Eventi usati:
//   "giornata-modificata"  una scheda/operaio/spesa/firma e' cambiata -> il rapportino salva
//   "giornata-salvata"     il rapportino e' stato scritto in archivio
//   "giornata-caricata"    la giornata selezionata e' stata (ri)disegnata nel modulo
//   "firma-chiusa"         il pad della firma e' stato chiuso
//   "archivio-aggiornato"  dati arrivati da sincronizzazione o importazione backup
//   "vista-cambiata"       si sta passando a un'altra schermata (dato: nome della vista)
const ascoltatori = {};

export function su(evento, fn){
  (ascoltatori[evento] || (ascoltatori[evento] = [])).push(fn);
}
export function emetti(evento, dato){
  (ascoltatori[evento] || []).forEach(fn=>fn(dato));
}
// scorciatoia usata dalle schede: "salva il rapportino"
export function segnalaModifica(){ emetti("giornata-modificata"); }
