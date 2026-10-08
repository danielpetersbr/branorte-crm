-- "Pode visitar" continua em visitar. Obrigatoriedade é uma marcação separada.
alter table public.cliente_dados_visita
  add column visita_obrigatoria boolean not null default false;

create function private.cliente_visita_normalizar()
returns trigger language plpgsql set search_path='' as $$
begin
  -- Clientes antigos só enviam visitar=false. A retirada dessa permissão limpa
  -- a obrigação mesmo quando o novo campo não fez parte do UPDATE/upsert.
  if tg_op='UPDATE' and old.visitar is true and new.visitar is false then
    new.visita_obrigatoria := false;
  elsif tg_op='INSERT' and new.visitar is false then
    new.visita_obrigatoria := false;
  elsif new.visita_obrigatoria is true then
    new.visitar := true;
  end if;
  return new;
end;
$$;

create trigger cliente_dados_visita_normalizar
  before insert or update of visitar,visita_obrigatoria on public.cliente_dados_visita
  for each row execute function private.cliente_visita_normalizar();

alter table public.cliente_dados_visita
  add constraint cliente_dados_visita_obrigatoria_pode
  check (not visita_obrigatoria or visitar);
