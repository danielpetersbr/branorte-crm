-- Central de Roteamento: exceção individual da cota de parados.
-- Reutiliza a tabela privada e cota_fator já existentes. Não liga vendedores,
-- não muda fatias/bloqueios, não apaga parados/corte e não envia mensagens.
-- 'infinity' representa "até desativar"; a API devolve null para essa data.
-- Exceções temporárias existentes (como EDER) continuam com seu prazo original.

create or replace function public.roteamento_cota_excecoes()
returns table (
  vendedor_nome text,
  ignorar_parados boolean,
  expira_em timestamptz,
  temporario boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Somente administradores podem consultar exceções de roteamento.'
      using errcode = '42501';
  end if;

  return query
    select s.vendedor_nome,
      coalesce(e.inicio_em <= now() and e.expira_em > now(), false),
      case when e.inicio_em <= now() and e.expira_em > now()
                   and isfinite(e.expira_em) then e.expira_em else null end,
      coalesce(e.inicio_em <= now() and e.expira_em > now()
                   and isfinite(e.expira_em), false)
    from public.vendor_dispatch_status s
    join public.vendors v on upper(btrim(v.name)) = upper(btrim(s.vendedor_nome))
    left join private.outbound_cota_excecoes e
      on e.vendedor_nome = upper(split_part(btrim(s.vendedor_nome), ' ', 1))
    order by s.vendedor_nome;
end;
$$;

create or replace function public.roteamento_cota_definir(p_vendedor text, p_ignorar boolean)
returns table (
  vendedor_nome text,
  ignorar_parados boolean,
  expira_em timestamptz,
  temporario boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  nome_status text;
  nome_cota text;
  recebido text;
begin
  if auth.uid() is null or not coalesce(public.is_admin(), false) then
    raise exception 'Somente administradores podem alterar exceções de roteamento.'
      using errcode = '42501';
  end if;
  if p_ignorar is null then
    raise exception 'Informe se a cota deve ser ignorada.' using errcode = '22023';
  end if;

  recebido := upper(regexp_replace(btrim(coalesce(p_vendedor, '')), '\s+', ' ', 'g'));
  select s.vendedor_nome into nome_status
    from public.vendor_dispatch_status s
    join public.vendors v on upper(btrim(v.name)) = upper(btrim(s.vendedor_nome))
   where upper(btrim(s.vendedor_nome)) = recebido;
  if nome_status is null then
    raise exception 'Vendedor não encontrado na Central de Roteamento.' using errcode = '22023';
  end if;
  nome_cota := upper(split_part(btrim(nome_status), ' ', 1));

  -- cota_fator historicamente usa o primeiro nome. Recusa uma colisão futura
  -- em vez de liberar silenciosamente dois vendedores com nomes diferentes.
  if (select count(*) from public.vendor_dispatch_status s
       where upper(split_part(btrim(s.vendedor_nome), ' ', 1)) = nome_cota) > 1 then
    raise exception 'Nome ambíguo para a cota; ajuste o cadastro antes de liberar.'
      using errcode = '22023';
  end if;

  -- Serializa solicitações do mesmo vendedor, inclusive quando ainda não há
  -- linha para FOR UPDATE. UPSERT + chave única também impedem duplicação.
  perform pg_catalog.pg_advisory_xact_lock(17402026, pg_catalog.hashtext(nome_cota));
  if p_ignorar then
    insert into private.outbound_cota_excecoes as atual
      (vendedor_nome, inicio_em, expira_em, motivo)
    values (nome_cota, now(), 'infinity'::timestamptz,
            'Liberação manual pela Central de Roteamento: até desativar.')
    on conflict on constraint outbound_cota_excecoes_pkey do update
      set inicio_em = excluded.inicio_em,
          expira_em = excluded.expira_em,
          motivo = excluded.motivo
    where not (atual.inicio_em <= now() and atual.expira_em = 'infinity'::timestamptz);
  else
    -- Preserva o registro e seu motivo. Para uma exceção programada no futuro,
    -- ajusta somente o início mínimo necessário para cancelar sem violar o CHECK.
    update private.outbound_cota_excecoes e
       set inicio_em = least(e.inicio_em, now() - interval '1 microsecond'),
           expira_em = now()
     where e.vendedor_nome = nome_cota and e.expira_em > now();
  end if;

  return query
    select e.vendedor_nome, e.ignorar_parados, e.expira_em, e.temporario
      from public.roteamento_cota_excecoes() e
     where e.vendedor_nome = nome_status;
end;
$$;

-- Não expõe a tabela private, nem cria acesso anônimo/por chave de serviço.
-- Mesmo uma chamada com EXECUTE ainda precisa de auth.uid() e perfil admin.
revoke all on function public.roteamento_cota_excecoes() from public, anon, service_role;
revoke all on function public.roteamento_cota_definir(text, boolean) from public, anon, service_role;
grant execute on function public.roteamento_cota_excecoes() to authenticated;
grant execute on function public.roteamento_cota_definir(text, boolean) to authenticated;

comment on function public.roteamento_cota_excecoes() is
  'Admin: estado efetivo da exceção individual da cota; infinito é sem prazo, retornado como data nula.';
comment on function public.roteamento_cota_definir(text, boolean) is
  'Admin: ativa até desativar ou encerra a exceção; não altera vendedores, cotas globais, parados ou filas.';
