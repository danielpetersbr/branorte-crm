-- Card "Qualificados" da aba Geral (19/10/2026): mostrava 505 contra 255 do funil logo abaixo.
--
-- A RPC contava como "avanço do vendedor" as categorias `novo` e `quente` de
-- etiqueta_categoria(). Nelas caem etiquetas de ETAPA/CADÊNCIA, não de qualificação:
-- NOVO LEAD, PROSPECÇÃO (aplicada sozinha em quem está sem etiqueta), 2ª TENTATIVA
-- (cliente que não respondeu), INTERESSE FUTURO, AGUARDANDO. Em outubro, 250 leads
-- entravam só por elas; 72 nem tinham respondido a IA.
--
-- Avanço agora = etiqueta que só existe depois de conversa real com o vendedor:
-- LEAD QUENTE, ORÇAMENTO*, VENDIDO/CLIENTE, FOLLOW UP, AGENDAMENTO.
-- (etiqueta_categoria não muda: `quente` também alimenta "lead em aberto" em outras RPCs.)
--
-- Também:
-- * lead sem telefone volta a contar em `entrou`/`qualif_ia` (não casa etiqueta, mas existe):
--   o card dividia pelos 1.016 da tela e a RPC contava 1.005.
-- * `engajou` deixa de contar quem só tem NUNCA RESPONDEU, PROSPECÇÃO ou 2ª TENTATIVA.
-- * telefone vazio vira NULL antes do join: wa_phone_strip9(NULL) devolve '' e casaria
--   qualquer etiqueta gravada com telefone vazio.
CREATE OR REPLACE FUNCTION public.dashboard_funil_union(p_from timestamp with time zone, p_to timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'auditoria', 'public'
AS $function$
DECLARE v jsonb;
BEGIN
  WITH leads AS (
    SELECT nullif(auditoria.wa_phone_strip9(apc.telefone),'') AS pm,
      (coalesce(btrim(apc.motivo_contato),'')<>'' OR coalesce(btrim(apc.finalidade_fabrica),'')<>''
        OR coalesce(btrim(apc.qual_animal),'')<>'' OR coalesce(btrim(apc.quantos_animais),'')<>''
        OR apc.tocou_botao_em IS NOT NULL) AS engajou_ia,
      (CASE
        WHEN apc.motivo_contato IS NULL OR btrim(apc.motivo_contato)='' THEN false
        WHEN lower(apc.motivo_contato) ~ 'fab|fáb' THEN (coalesce(btrim(apc.finalidade_fabrica),'')<>'' AND coalesce(btrim(apc.qual_animal),'')<>'')
        WHEN lower(apc.motivo_contato) ~ 'equip' THEN (lower(coalesce(apc.o_que_precisa,'')) ~ '(aliment|balanc|brete|casquead|cacamb|caçamb|caixa|compact|fabric|fábric|descarga|elevador|caneca|sacaria|ensacad|helico|rosca|mistur|moega|moinho|martelo|passarela|peneira|limpeza|silo|big bag|bigbag|transporta|esteira)')
        ELSE false END) AS qualif_ia
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
    SELECT l.engajou_ia, l.qualif_ia,
      coalesce(e.has_resp,false) AS has_resp, coalesce(e.has_adv,false) AS has_adv
    FROM leads l LEFT JOIN etq e ON e.pm = l.pm
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
