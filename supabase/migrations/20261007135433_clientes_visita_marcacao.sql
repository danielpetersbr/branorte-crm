-- Só a intenção de visita é editável. Não abre UPDATE geral na tabela.
create or replace function public.cliente_visita_definir(p_id uuid, p_visitar boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
  v_nome text;
  v_count integer;
begin
  if auth.uid() is null or p_visitar is null then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;
  select p.role, upper(trim(coalesce(v.name, p.display_name, '')))
  into v_role, v_nome
  from public.user_profiles p
  left join public.vendors v on v.id = p.vendor_id
  where p.id = auth.uid() and p.approved_at is not null;
  if v_role is null or v_role not in ('admin', 'vendor') then
    raise exception 'Acesso não autorizado' using errcode = '42501';
  end if;
  update public.cliente_dados_visita c
  set visitar = p_visitar, updated_at = now()
  where c.id = p_id and (v_role = 'admin' or
    (v_nome <> '' and upper(trim(c.vendedor_nome)) = v_nome));
  get diagnostics v_count = row_count;
  if v_count <> 1 then
    raise exception 'Cliente não encontrado ou pertence a outro vendedor' using errcode = '42501';
  end if;
  return true;
end;
$$;
revoke all on function public.cliente_visita_definir(uuid, boolean) from public, anon;
grant execute on function public.cliente_visita_definir(uuid, boolean) to authenticated;
