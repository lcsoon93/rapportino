-- Annulla 20261129090000_rapportini_fuori_programma: i rapportini fuori programma tornano "imprevisti".
alter table public.rapportini drop column if exists fuori_programma;
