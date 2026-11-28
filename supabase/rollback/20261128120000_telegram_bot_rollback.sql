-- Annulla 20261128120000_telegram_bot: elimina le bozze non confermate del bot e l'elenco degli
-- aggiornamenti ricevuti. I rapportini gia' creati dal bot restano (sono nella tabella "rapportini").
drop table if exists public.telegram_bozze;
drop table if exists public.telegram_aggiornamenti;
