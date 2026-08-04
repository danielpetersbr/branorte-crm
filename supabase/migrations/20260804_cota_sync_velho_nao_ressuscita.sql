-- ============================================================================
-- CORREÇÃO 04/08/2026 — o fail-open de sync velho estava RESSUSCITANDO cortado.
--
-- Como estava: se a extensão do vendedor não sincronizava etiqueta há mais de
-- `cota_sync_max_min`, `cota_fator` devolvia 1 ("dado velho não pune").
--
-- O que aconteceu na prática: o JARDEL parou de sincronizar às 13:56. Passados
-- 120 min, o fator dele voltou pra 1 e ele voltou a receber 15% dos leads — COM
-- 124 PARADOS. Ou seja: quem tem o WhatsApp travado, que é justamente quem menos
-- deveria receber cliente novo, ganhava a cota de volta por causa do travamento.
--
-- Regra certa: dado velho não CRIA punição nova, mas não APAGA a que já existe.
--   • sync velho + já cortado  -> continua cortado (0)
--   • sync velho + não cortado -> 1 (não pune com base em dado que não confio)
-- Quando a extensão voltar a sincronizar, a conta volta a valer sozinha e ele
-- sai do corte assim que limpar de verdade.
-- ============================================================================

create or replace function public.cota_fator(p_vendedor text)
returns numeric
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  cfg      record;
  n        int;
  primeiro text;
  est      record;
  limite   int;
  idade    int;
begin
  select cota_ativa, cota_verde, cota_zero, cota_volta, cota_sync_max_min into cfg
    from outbound_rota_config where id = 1;
  if cfg is null or cfg.cota_ativa is not true then
    return 1;  -- cota desligada: ninguém é limitado
  end if;

  primeiro := upper(split_part(btrim(coalesce(p_vendedor,'')), ' ', 1));

  -- Estado de corte ANTES de olhar o sync: ele decide o que fazer com dado velho.
  select cortado into est from outbound_cota_estado
   where upper(split_part(btrim(vendedor_nome),' ',1)) = primeiro;

  -- Idade do último sync de etiqueta desse vendedor.
  select round(extract(epoch from now() - max(updated_at))/60)::int into idade
    from wa_chat_labels
   where upper(split_part(btrim(vendedor_nome),' ',1)) = primeiro;

  if idade is null or idade > coalesce(cfg.cota_sync_max_min, 120) then
    -- Dado velho: não pune quem não estava punido, mas NÃO solta quem já estava.
    -- Extensão parada não apaga 124 leads parados.
    if coalesce(est.cortado, false) then return 0; end if;
    return 1;
  end if;

  select coalesce(parados, 0) into n
    from vendor_parados_topo
   where upper(split_part(btrim(vendedor_nome),' ',1)) = primeiro;
  n := coalesce(n, 0);

  -- HISTERESE: quem já está cortado precisa cair BEM abaixo do teto pra voltar.
  limite := case when coalesce(est.cortado, false)
                 then floor(cfg.cota_zero * cfg.cota_volta)::int
                 else cfg.cota_zero end;

  if n >= limite then return 0; end if;
  if n <= cfg.cota_verde then return 1; end if;
  return round(((cfg.cota_zero - n)::numeric / nullif(cfg.cota_zero - cfg.cota_verde, 0)), 3);
end;
$$;

revoke all on function public.cota_fator(text) from anon;
grant execute on function public.cota_fator(text) to authenticated;
