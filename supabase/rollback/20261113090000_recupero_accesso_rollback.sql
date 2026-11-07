-- Rollback di 20261113090000_recupero_accesso.sql: toglie scadenza della password temporanea e
-- traccia dell'ultimo reset. Prima ripristinare le Edge Functions accesso, cambia-password e utenti
-- precedenti (leggono e scrivono queste colonne). Nessun altro dato viene toccato.
alter table public.profili
  drop column if exists password_temporanea_scade,
  drop column if exists password_reimpostata_il,
  drop column if exists password_reimpostata_da;
