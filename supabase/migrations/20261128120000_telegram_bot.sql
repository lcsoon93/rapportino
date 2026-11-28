-- =====================================================================
-- Bot Telegram privato per creare rapportini (Edge Function "telegram").
--
-- Solo tabelle di servizio del bot: i rapportini si salvano nella tabella "rapportini" esistente con
-- salva_rapportino, usando la sessione dell'utente proprietario (RLS, autore e notifiche come nell'app).
--
-- * telegram_aggiornamenti: update_id gia' ricevuti (Telegram puo' rimandare lo stesso aggiornamento).
--   stato "in_corso" finche' l'elaborazione non finisce: se la funzione si interrompe, un nuovo invio
--   dopo 2 minuti viene rielaborato (nessun messaggio perso), altrimenti e' ignorato.
-- * telegram_bozze: una bozza per chat (solo il proprietario), con versione (modifiche concorrenti),
--   stato (aperta / salvataggio), id del rapportino deciso in anticipo (la conferma ripetuta non crea
--   doppioni) e scadenza.
-- Nessun accesso dall'app: RLS attiva senza policy, privilegi tolti ad anon e authenticated
-- (le usa solo la Edge Function con la service_role key).
--
-- Solo aggiunte. Ripetibile. Annullamento: supabase/rollback/20261128120000_telegram_bot_rollback.sql
-- =====================================================================

create table if not exists public.telegram_aggiornamenti (
  update_id bigint primary key,
  stato text not null default 'in_corso' check (stato in ('in_corso', 'fatto')),
  ricevuto_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now()
);
create index if not exists telegram_aggiornamenti_ricevuto on public.telegram_aggiornamenti (ricevuto_il);

create table if not exists public.telegram_bozze (
  chat_id bigint primary key,
  dati jsonb not null default '{}'::jsonb check (jsonb_typeof(dati) = 'object' and length(dati::text) <= 60000),
  stato text not null default 'aperta' check (stato in ('aperta', 'salvataggio')),
  versione integer not null default 1,
  rapportino_id uuid not null default gen_random_uuid(),
  creato_il timestamptz not null default now(),
  aggiornato_il timestamptz not null default now(),
  scade_il timestamptz not null default now() + interval '24 hours'
);

alter table public.telegram_aggiornamenti enable row level security;
alter table public.telegram_bozze enable row level security;
revoke all on public.telegram_aggiornamenti from anon, authenticated;
revoke all on public.telegram_bozze from anon, authenticated;
grant all on public.telegram_aggiornamenti, public.telegram_bozze to service_role;
