-- =====================================================================
-- Rapportini "fuori programma" (richiede 20261108090000).
--
-- Un rapportino senza intervento collegato era sempre mostrato come "imprevisto". Ora puo' essere
-- segnato come lavoro FUORI PROGRAMMA (non previsto in agenda ma non un imprevisto): lo fa il bot
-- Telegram quando si crea un rapportino nuovo senza scegliere un intervento programmato.
--   fuori_programma = false (predefinito): comportamento di prima (senza intervento = imprevisto).
-- salva_rapportino non lo modifica: le modifiche dall'app lo lasciano com'e'.
-- Solo aggiunte: nessun dato esistente modificato. Ripetibile.
-- Annullamento: supabase/rollback/20261129090000_rapportini_fuori_programma_rollback.sql
-- =====================================================================
alter table public.rapportini add column if not exists fuori_programma boolean not null default false;
comment on column public.rapportini.fuori_programma is 'Lavoro fuori programma (non un imprevisto); significativo solo senza intervento collegato';
