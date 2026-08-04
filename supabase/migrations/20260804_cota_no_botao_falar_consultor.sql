-- ============================================================================
-- COTA no botão "FALAR COM CONSULTOR" — 04/08/2026
--
-- Achado ao investigar o lead do Otávio: o botão do site (/api/quiz/pick-vendedor,
-- e também alp-dispatch e quiz/handoff) escolhe vendedor por `funil_pick_vendedor`,
-- que é round-robin puro entre os online. Esse caminho NÃO escreve em
-- outbound_dispatch — logo o trigger `trg_outbound_rotear` nunca o vê, e a cota
-- de parados não valia ali.
--
-- Resultado prático: o JARDEL estava cortado pela cota (120 parados) e mesmo
-- assim seguia elegível pro botão do site.
--
-- Correção: tira do rodízio quem a cota ZEROU (fator = 0). Quem só está reduzido
-- continua no rodízio — round-robin não tem peso, e inventar peso aqui mudaria o
-- comportamento do botão além do pedido.
--
-- FAIL-OPEN em dois níveis (lead perdido é pior que lead mal distribuído):
--   • se a cota derrubar TODO mundo, ignora a cota e usa a lista original;
--   • se ninguém estiver elegível, mantém o fallback antigo (qualquer ativo).
-- Respeita o mesmo kill switch: `outbound_rota_config.cota_ativa`.
-- ============================================================================

create or replace function public.funil_pick_vendedor()
returns table (vendedor text, telefone text)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_names  text[];
  v_phones text[];
  v_names_cota  text[];
  v_phones_cota text[];
  v_n int;
  v_i bigint;
  v_pos int;
begin
  -- disponíveis pro funil: ativo + online + não bloqueado + funil_ativa + share>0 + com telefone
  select array_agg(x.name order by x.name), array_agg(x.telefone order by x.name)
    into v_names, v_phones
  from (
    select v.name, v.telefone
    from public.vendors v
    join public.vendor_dispatch_status s on upper(s.vendedor_nome) = upper(v.name)
    where v.ativo and v.telefone is not null
      and s.online and not s.bloqueado
      and coalesce(s.funil_ativa, false)
      and coalesce(s.share_percent, 0) > 0
  ) x;

  -- COTA DE PARADOS: tira quem está zerado. cota_fator() já devolve 1 quando a
  -- cota está desligada ou quando o sync do vendedor está velho.
  if v_names is not null then
    select array_agg(x.name order by x.name), array_agg(x.telefone order by x.name)
      into v_names_cota, v_phones_cota
    from (
      select v.name, v.telefone
      from public.vendors v
      join public.vendor_dispatch_status s on upper(s.vendedor_nome) = upper(v.name)
      where v.ativo and v.telefone is not null
        and s.online and not s.bloqueado
        and coalesce(s.funil_ativa, false)
        and coalesce(s.share_percent, 0) > 0
        and public.cota_fator(v.name) > 0
    ) x;

    -- Só aplica se sobrou alguém. Cota que zera todo mundo derrubaria o funil.
    if v_names_cota is not null then
      v_names  := v_names_cota;
      v_phones := v_phones_cota;
    end if;
  end if;

  -- fallback: qualquer vendedor ativo com telefone (não perde o lead)
  if v_names is null then
    select array_agg(v.name order by v.name), array_agg(v.telefone order by v.name)
      into v_names, v_phones
    from public.vendors v where v.ativo and v.telefone is not null;
  end if;

  if v_names is null then
    return;
  end if;

  v_n := array_length(v_names, 1);
  update public.funil_rr set idx = idx + 1 where id = 1 returning idx into v_i;
  v_pos := ((v_i - 1) % v_n) + 1;
  vendedor := v_names[v_pos];
  telefone := v_phones[v_pos];
  return next;
end;
$$;

comment on function public.funil_pick_vendedor() is
  'Round-robin do botão FALAR COM CONSULTOR. Desde 04/08/2026 exclui quem a cota de parados zerou (fail-open se zerar todos). Kill switch: outbound_rota_config.cota_ativa.';
