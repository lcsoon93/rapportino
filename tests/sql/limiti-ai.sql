-- Limiti dell'assistente AI: riusa public.limite_tentativi (migrazione 20261112090000), chiavi
-- "ai-min:<utente>" (60 s) e "ai-giorno:<utente>" (86400 s). Ogni controllo fallito interrompe lo script.
\set ON_ERROR_STOP 1
set role service_role;
do $$
declare esiti text;
begin
  select string_agg(public.limite_tentativi('ai-min:u1', 3, 60)::text, ',' order by g) into esiti from generate_series(1, 4) g;
  if esiti <> 'true,true,true,false' then raise exception 'limite al minuto errato: %', esiti; end if;
  if not public.limite_tentativi('ai-min:u2', 3, 60) then raise exception 'utenti diversi non devono condividere il limite'; end if;
  if not public.limite_tentativi('ai-giorno:u1', 1, 86400) then raise exception 'limite giornaliero indipendente da quello al minuto'; end if;
  if public.limite_tentativi('ai-giorno:u1', 1, 86400) then raise exception 'limite giornaliero non applicato'; end if;
end $$;
reset role;
-- richieste di piu' di un giorno fa: non contano e vengono cancellate
insert into public.tentativi_accesso (chiave, momento) select 'ai-giorno:u3', now() - interval '25 hours' from generate_series(1, 5);
set role service_role;
do $$ begin
  if not public.limite_tentativi('ai-giorno:u3', 2, 86400) then raise exception 'le richieste di ieri non devono contare'; end if;
end $$;
reset role;
do $$ begin
  if exists (select 1 from public.tentativi_accesso where chiave = 'ai-giorno:u3' and momento < now() - interval '1 day') then
    raise exception 'righe vecchie non cancellate'; end if;
end $$;
-- dal browser (anon / authenticated) ne' la funzione ne' la tabella sono accessibili
set role authenticated;
do $$ begin perform public.limite_tentativi('ai-min:x', 100, 60); raise exception 'authenticated non deve poter chiamare limite_tentativi';
exception when insufficient_privilege then null; end $$;
do $$ begin perform 1 from public.tentativi_accesso; raise exception 'authenticated non deve leggere tentativi_accesso';
exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin perform public.limite_tentativi('ai-min:x', 100, 60); raise exception 'anon non deve poter chiamare limite_tentativi';
exception when insufficient_privilege then null; end $$;
reset role;
select 'limiti-ai: ok' as esito;
