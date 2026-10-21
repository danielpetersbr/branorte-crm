-- QUALIFICADO = a Ana passou pro vendedor (21/10/2026, Daniel: "considerados qualificados são os que a Ana entende que o cliente quer
-- algo que a gente fabrica e passa direto pro vendedor, porque a Ana só passa aqueles que respondem e que querem algo que realmente a
-- gente fabrica").
--
-- Antes, o "qualificado pela IA" lia os campos do quiz do robô antigo (motivo_contato, finalidade, animal, o_que_precisa), que quase
-- nunca vêm preenchidos nos leads da Ana: em outubro o cartão dizia 315 e a Ana tinha passado 625 dos 1.120 leads do mês.
-- Agora qualificado = repasse da Ana (outbound_dispatch com chat_ana; o de dúvida técnica, ana_qualificado = false, não conta; o de
-- antes da marca existir, até 30/09, conta) OU o critério antigo do robô OU etiqueta de conversa avançada (como antes). Quem a Ana
-- repassou também conta como "engajou" (respondeu).
--
-- Cópia da versão anterior: private._bak_dashboard_funil_union_20261021 (voltar = recriar a public com aquele corpo).

do $bak$
declare d text;
begin
  if to_regprocedure('private._bak_dashboard_funil_union_20261021(timestamptz, timestamptz)') is null then
    d := pg_get_functiondef('public.dashboard_funil_union(timestamptz, timestamptz)'::regprocedure);
    d := replace(d, 'FUNCTION public.dashboard_funil_union(', 'FUNCTION private._bak_dashboard_funil_union_20261021(');
    execute d;
    execute 'revoke all on function private._bak_dashboard_funil_union_20261021(timestamptz, timestamptz) from public, anon, authenticated';
  end if;
end
$bak$;

create or replace function public.dashboard_funil_union(p_from timestamp with time zone, p_to timestamp with time zone)
returns jsonb
language plpgsql
stable security definer
set search_path to 'auditoria', 'public'
as $function$
DECLARE v jsonb;
BEGIN
  WITH ana AS (
    -- clientes que a Ana passou pro vendedor como qualificados (repasse de dúvida técnica fica de fora)
    SELECT DISTINCT auditoria.wa_phone_strip9(CASE WHEN o.cliente_telefone_norm LIKE '55%' THEN o.cliente_telefone_norm
                                                   ELSE '55' || o.cliente_telefone_norm END) AS pm
    FROM public.outbound_dispatch o
    WHERE o.raw_payload ? 'chat_ana' AND coalesce(o.raw_payload->>'ana_qualificado', 'true') <> 'false'
      AND coalesce(o.cliente_telefone_norm, '') <> ''
  ),
  leads AS (
    SELECT nullif(auditoria.wa_phone_strip9(apc.telefone),'') AS pm,
      (coalesce(btrim(apc.motivo_contato),'')<>'' OR coalesce(btrim(apc.finalidade_fabrica),'')<>''
        OR coalesce(btrim(apc.qual_animal),'')<>'' OR coalesce(btrim(apc.quantos_animais),'')<>''
        OR apc.tocou_botao_em IS NOT NULL) AS engajou_ia,
      (CASE
        WHEN apc.motivo_contato IS NULL OR btrim(apc.motivo_contato)='' THEN false
        WHEN lower(apc.motivo_contato) ~ 'fab|fáb' THEN (coalesce(btrim(apc.finalidade_fabrica),'')<>'' AND coalesce(btrim(apc.qual_animal),'')<>'')
        WHEN lower(apc.motivo_contato) ~ 'equip' THEN (lower(coalesce(apc.o_que_precisa,'')) ~ '(aliment|balanc|brete|casquead|cacamb|caçamb|caixa|compact|fabric|fábric|descarga|elevador|caneca|sacaria|ensacad|helico|rosca|mistur|moega|moinho|martelo|passarela|peneira|limpeza|silo|big bag|bigbag|transporta|esteira)')
        ELSE false END) AS qualif_bot
    FROM auditoria.atendimentos_por_cliente apc
    WHERE coalesce(apc.is_internal,false)=false
      AND (p_from IS NULL OR apc.primeira_data >= p_from)
      AND (p_to IS NULL OR apc.primeira_data < p_to)
  ),
  etq AS (
    SELECT nullif(auditoria.wa_phone_strip9(wcl.phone),'') AS pm,
      bool_or(we.etiqueta_nome_normalizado NOT IN ('NUNCA RESPONDEU','PROSPECCAO','PROSPECCOES','2A TENTATIVA')
              AND public.etiqueta_categoria(we.etiqueta_nome_normalizado) NOT IN ('interno','outros')) AS has_resp,
      bool_or(public.etiqueta_categoria(we.etiqueta_nome_normalizado) IN ('lead_quente','orcamento','vendido')
              OR we.etiqueta_nome_normalizado IN ('FOLLOW UP','FOLLOWUP','FALLOW UP','AGENDAMENTO')) AS has_adv
    FROM public.wa_chat_labels wcl
    CROSS JOIN LATERAL unnest(wcl.label_ids::int[]) lid(id)
    JOIN public.wascript_etiquetas we ON we.etiqueta_id_wascript = lid.id AND we.vendedor_nome = wcl.vendedor_nome
    GROUP BY 1
  ),
  j AS (
    SELECT (l.engajou_ia OR a.pm IS NOT NULL) AS engajou_ia,
      (l.qualif_bot OR a.pm IS NOT NULL) AS qualif_ia,
      coalesce(e.has_resp,false) AS has_resp, coalesce(e.has_adv,false) AS has_adv
    FROM leads l LEFT JOIN etq e ON e.pm = l.pm LEFT JOIN ana a ON a.pm = l.pm
  )
  SELECT jsonb_build_object(
    'entrou',     (SELECT count(*) FROM j),
    'engajou',    (SELECT count(*) FROM j WHERE engajou_ia OR has_resp OR has_adv),
    'qualificou', (SELECT count(*) FROM j WHERE qualif_ia OR has_adv),
    'qualif_ia',  (SELECT count(*) FROM j WHERE qualif_ia)
  ) INTO v;
  RETURN v;
END
$function$;
