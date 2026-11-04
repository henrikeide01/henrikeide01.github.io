-- Hjemme (eidert.no/hjem): felles husstand på flere telefoner, lagret i Supabase.
-- Kjør hele filen én gang i Supabase → SQL Editor → New query → Run. Den kan trygt kjøres på nytt.
--
-- • Alt som lagres er kryptert på telefonen med husstandskoden (AES-GCM). Databasen ser bare uleselig tekst.
-- • Egen tabell med prefikset hjem_. Den rører ingen andre tabeller i prosjektet.
-- • Tabellen er stengt for direkte lesing og skriving. Den nås bare gjennom de to funksjonene under,
--   og bare for én husstand om gangen (id-en er en hash av husstandskoden, så den må man kjenne).

create table if not exists public.hjem_husstand (
  hus text primary key check (hus ~ '^[0-9a-f]{32}$'),
  data jsonb not null default '{}'::jsonb,
  opprettet timestamptz not null default now(),
  endret timestamptz not null default now()
);

alter table public.hjem_husstand enable row level security;
revoke all on table public.hjem_husstand from public, anon, authenticated;

-- Hjelper: setter en verdi på en sti (f.eks. {poster,abc}) og lager mellomnivåene som mangler
create or replace function public.hjem_sett(d jsonb, sti text[], v jsonb)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  under jsonb;
begin
  if coalesce(array_length(sti, 1), 0) = 0 then return v; end if;
  if jsonb_typeof(d) is distinct from 'object' then d := '{}'::jsonb; end if;
  if array_length(sti, 1) = 1 then return d || jsonb_build_object(sti[1], v); end if;
  under := d -> sti[1];
  return d || jsonb_build_object(sti[1], public.hjem_sett(under, sti[2:], v));
end $$;

-- Hjelper: {".sv":"timestamp"} byttes med servertid i millisekunder (også ett nivå ned)
create or replace function public.hjem_tid(v jsonb, naa bigint)
returns jsonb language plpgsql immutable set search_path = public as $$
declare
  k text;
  x jsonb;
  ut jsonb := '{}'::jsonb;
begin
  if v = '{".sv":"timestamp"}'::jsonb then return to_jsonb(naa); end if;
  if jsonb_typeof(v) is distinct from 'object' then return v; end if;
  for k, x in select * from jsonb_each(v) loop
    ut := ut || jsonb_build_object(k, case when x = '{".sv":"timestamp"}'::jsonb then to_jsonb(naa) else x end);
  end loop;
  return ut;
end $$;

-- Hent alt for én husstand (null hvis den ikke finnes)
create or replace function public.hjem_hent(p_hus text)
returns jsonb language sql stable security definer set search_path = public as $$
  select data from public.hjem_husstand where hus = p_hus;
$$;

-- Lagre endringer for én husstand: { "sti/til/verdi": verdi eller null (= slett) }
create or replace function public.hjem_lagre(p_hus text, p_endring jsonb)
returns bigint language plpgsql security definer set search_path = public as $$
declare
  d jsonb;
  k text;
  v jsonb;
  naa bigint := floor(extract(epoch from clock_timestamp()) * 1000)::bigint;
begin
  if p_hus !~ '^[0-9a-f]{32}$' then raise exception 'ugyldig husstand'; end if;
  if jsonb_typeof(p_endring) is distinct from 'object' then raise exception 'ugyldige endringer'; end if;
  if octet_length(p_endring::text) > 4000000 then raise exception 'endringen er for stor'; end if;

  insert into public.hjem_husstand (hus) values (p_hus) on conflict (hus) do nothing;
  select data into d from public.hjem_husstand where hus = p_hus for update;

  for k, v in select * from jsonb_each(p_endring) loop
    if k !~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+){0,3}$' then raise exception 'ugyldig sti: %', k; end if;
    if v is null or v = 'null'::jsonb then
      d := d #- string_to_array(k, '/');
    else
      d := public.hjem_sett(d, string_to_array(k, '/'), public.hjem_tid(v, naa));
    end if;
  end loop;

  if octet_length(d::text) > 20000000 then raise exception 'husstanden er for stor'; end if;
  update public.hjem_husstand set data = d, endret = now() where hus = p_hus;
  return naa;
end $$;

-- Bare de to funksjonene kan kalles fra appen (med den offentlige nøkkelen)
revoke all on function public.hjem_sett(jsonb, text[], jsonb) from public, anon, authenticated;
revoke all on function public.hjem_tid(jsonb, bigint) from public, anon, authenticated;
revoke all on function public.hjem_hent(text) from public;
revoke all on function public.hjem_lagre(text, jsonb) from public;
grant execute on function public.hjem_hent(text) to anon, authenticated;
grant execute on function public.hjem_lagre(text, jsonb) to anon, authenticated;

-- Be API-et lese inn de nye funksjonene med en gang
notify pgrst, 'reload schema';
