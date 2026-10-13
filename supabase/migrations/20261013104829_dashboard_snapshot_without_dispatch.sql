-- Aggregate only Dashboard fields; avoid dispatch lookups and repeated full-width windows.
-- Keep original journey ordering, representative selection, compact transport and invoker security.
CREATE OR REPLACE FUNCTION auditoria.dashboard_snapshot() RETURNS json LANGUAGE sql STABLE SECURITY INVOKER SET search_path='' AS $dashboard$
SELECT json_build_object('columns',array['id','nome','telefone','responsavel','criativo_codigo','origem','motivo_contato','finalidade_fabrica','qual_animal','quantos_animais','quando_investir','tocou_botao_em','o_que_precisa','data','last_message_at','is_internal','chegou_no_vendedor','orcamento_enviado','orcamento_valor','status_real','status_vendedor','finished_at'], 'rows',coalesce(json_agg(json_build_array(s.id,s.nome,s.telefone,s.responsavel,s.criativo_codigo,s.origem,s.motivo_contato,s.finalidade_fabrica,s.qual_animal,s.quantos_animais,s.quando_investir,s.tocou_botao_em,s.o_que_precisa,s.data,s.last_message_at,s.is_internal,s.chegou_no_vendedor,s.orcamento_enviado,s.orcamento_valor,s.status_real,s.status_vendedor,s.finished_at) ORDER BY s.data DESC NULLS LAST,s.id),'[]'::json)) FROM (
WITH journeys AS (
 SELECT COALESCE(NULLIF(a.telefone_norm,''),a.conversation_id_disparachat) AS group_key,
 (array_agg(a.id ORDER BY CASE WHEN a.responsavel IS NOT NULL AND a.responsavel<>'' THEN 0 ELSE 1 END,a.last_message_at DESC NULLS LAST,a.data DESC))[1] AS representative_id,
 max(a.last_message_at) AS ultima_msg,
 bool_or(a.responsavel IS NOT NULL AND a.responsavel<>'') AS chegou_no_vendedor,
 (array_agg(a.status_atendimento ORDER BY CASE a.status_atendimento WHEN 'Resolvido' THEN 0 WHEN 'Respondido' THEN 1 WHEN 'Sem-Resposta' THEN 2 WHEN 'Transferido' THEN 3 WHEN 'Pendente-IA' THEN 4 ELSE 5 END))[1] AS status_jornada,
 (array_agg(a.como_finalizou ORDER BY (a.como_finalizou IS NULL),a.last_message_at DESC NULLS LAST))[1] AS como_finalizou_jornada,
 (array_agg(a.criativo_codigo ORDER BY (a.criativo_codigo IS NULL),a.data))[1] AS criativo_codigo_jornada,
 (array_agg(a.finalidade_fabrica ORDER BY (a.finalidade_fabrica IS NULL),a.data DESC))[1] AS finalidade_fabrica_jornada,
 (array_agg(a.quantos_animais ORDER BY (a.quantos_animais IS NULL),a.data DESC))[1] AS quantos_animais_jornada,
 (array_agg(a.quando_investir ORDER BY (a.quando_investir IS NULL),a.data DESC))[1] AS quando_investir_jornada,
 (array_agg(a.motivo_contato ORDER BY (a.motivo_contato IS NULL),a.data DESC))[1] AS motivo_contato_jornada,
 (array_agg(a.origem ORDER BY (a.origem IS NULL),a.data DESC))[1] AS origem_jornada,
 (array_agg(a.tocou_botao_em ORDER BY (a.tocou_botao_em IS NULL),a.tocou_botao_em DESC))[1] AS tocou_botao_em_jornada,
 (array_agg(a.status_vendedor ORDER BY (a.status_vendedor IS NULL),a.last_message_at DESC NULLS LAST,a.data DESC))[1] AS status_vendedor_jornada,
 max(a.finished_at) AS finished_at_max,
 max(a.orcamento_valor) AS orcamento_valor_max,
 bool_or(a.orcamento_enviado) AS orcamento_enviado_any
 FROM auditoria.auditoria_atendimentos a
 WHERE ((a.telefone_norm IS NOT NULL AND a.telefone_norm<>'') OR a.conversation_id_disparachat IS NOT NULL)
 GROUP BY COALESCE(NULLIF(a.telefone_norm,''),a.conversation_id_disparachat)
),base AS (
 SELECT a.*,g.ultima_msg,g.chegou_no_vendedor,g.status_jornada,g.como_finalizou_jornada,g.criativo_codigo_jornada,g.finalidade_fabrica_jornada,g.quantos_animais_jornada,g.quando_investir_jornada,g.motivo_contato_jornada,g.origem_jornada,g.tocou_botao_em_jornada,g.status_vendedor_jornada,g.finished_at_max,g.orcamento_valor_max,g.orcamento_enviado_any
 FROM journeys g JOIN auditoria.auditoria_atendimentos a ON a.id=g.representative_id
)
SELECT b.id,
 b.nome,
 b.telefone,
 b.responsavel,
 b.criativo_codigo_jornada AS criativo_codigo,
 b.origem_jornada AS origem,
 b.motivo_contato_jornada AS motivo_contato,
 b.finalidade_fabrica_jornada AS finalidade_fabrica,
 b.qual_animal,
 b.quantos_animais_jornada AS quantos_animais,
 b.quando_investir_jornada AS quando_investir,
 b.tocou_botao_em_jornada AS tocou_botao_em,
 b.o_que_precisa,
 b.data,
 b.last_message_at,
 b.is_internal,
 b.chegou_no_vendedor,
 b.orcamento_enviado_any AS orcamento_enviado,
 b.orcamento_valor_max AS orcamento_valor,
 CASE
            WHEN b.como_finalizou_jornada = 'Venda'::auditoria.finalizou_enum THEN 'Vendido'::text
            WHEN b.como_finalizou_jornada = 'Perdido'::auditoria.finalizou_enum THEN 'Perdido'::text
            WHEN b.responsavel IS NOT NULL AND b.responsavel <> ''::text AND b.como_finalizou_jornada = 'Em-andamento'::auditoria.finalizou_enum THEN 'Em-andamento'::text
            WHEN b.responsavel IS NOT NULL AND b.responsavel <> ''::text AND b.como_finalizou_jornada IS NULL AND b.ultima_msg < (now() - '3 days'::interval) THEN 'Abandonado'::text
            WHEN b.responsavel IS NOT NULL AND b.responsavel <> ''::text AND (b.como_finalizou_jornada IS NULL OR b.como_finalizou_jornada = 'Em-andamento'::auditoria.finalizou_enum) THEN 'Em-andamento'::text
            WHEN (b.responsavel IS NULL OR b.responsavel = ''::text) AND b.respondeu_a_ia = true THEN 'Aguardando-Vendedor'::text
            WHEN (b.responsavel IS NULL OR b.responsavel = ''::text) AND b.status_jornada = 'Resolvido'::auditoria.status_enum THEN 'Sem-Resposta'::text
            WHEN (b.responsavel IS NULL OR b.responsavel = ''::text) AND b.status_jornada = 'Pendente-IA'::auditoria.status_enum THEN 'Aguardando-Vendedor'::text
            WHEN b.status_jornada = 'Sem-Resposta'::auditoria.status_enum THEN 'Sem-Resposta'::text
            ELSE b.status_jornada::text
        END AS status_real,
 b.status_vendedor_jornada AS status_vendedor,
 b.finished_at_max AS finished_at
 FROM base b WHERE b.is_internal=false
 ORDER BY b.data DESC NULLS LAST,b.id LIMIT 50000
) s;
$dashboard$;
NOTIFY pgrst,'reload schema';
