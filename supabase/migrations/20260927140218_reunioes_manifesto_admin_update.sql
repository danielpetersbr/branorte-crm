-- A RLS existente de reunioes permite aos usuarios aprovados editar a pauta.
-- A apresentacao exige uma regra mais estreita sem bloquear essas edicoes.
create or replace function public.reunioes_guard_apresentacao_manifesto()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  alterou_manifesto boolean;
begin
  if tg_op = 'INSERT' then
    alterou_manifesto := new.apresentacao_manifesto is not null;
  else
    alterou_manifesto := new.apresentacao_manifesto is distinct from old.apresentacao_manifesto;
  end if;

  if alterou_manifesto
  and current_user not in ('postgres', 'service_role')
  and not coalesce(public.is_admin(), false)
  then
    raise exception 'Somente administradores podem alterar a apresentacao da reuniao.'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

drop trigger if exists reunioes_guard_apresentacao_manifesto on public.reunioes;

create trigger reunioes_guard_apresentacao_manifesto
before insert or update on public.reunioes
for each row execute function public.reunioes_guard_apresentacao_manifesto();
