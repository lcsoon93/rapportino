-- =====================================================================
-- Recupero dell'accesso (PIN e password dimenticati). Richiede 20261112090000_utenti_pin_ruoli.
--
-- La password temporanea data dall'admin (nuovo account o "Reimposta password") scade dopo 72 ore
-- se non viene cambiata; restano data e autore dell'ultimo reset. Valori gestiti SOLO dalle Edge
-- Functions (utenti, accesso, cambia-password): colonne non leggibili dal browser (nessun grant).
-- Non tocca dati esistenti: per gli account attuali la scadenza resta vuota (nessuna scadenza).
-- =====================================================================
alter table public.profili
  add column if not exists password_temporanea_scade timestamptz,
  add column if not exists password_reimpostata_il timestamptz,
  add column if not exists password_reimpostata_da uuid references auth.users(id) on delete set null;
