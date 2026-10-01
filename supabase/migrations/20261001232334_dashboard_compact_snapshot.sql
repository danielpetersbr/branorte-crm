-- Same view, filters, limits and permissions; one pass instead of eight offset reads.
create or replace function auditoria.dashboard_snapshot() returns json
language sql stable security invoker set search_path='' as $$
 select json_build_object('columns',array['id','nome','telefone','responsavel','criativo_codigo','origem','motivo_contato','finalidade_fabrica','qual_animal','quantos_animais','quando_investir','tocou_botao_em','o_que_precisa','data','last_message_at','is_internal','chegou_no_vendedor','orcamento_enviado','orcamento_valor','status_real','status_vendedor','finished_at'],
   'rows',coalesce(json_agg(json_build_array(s.id,s.nome,s.telefone,s.responsavel,s.criativo_codigo,s.origem,s.motivo_contato,s.finalidade_fabrica,s.qual_animal,s.quantos_animais,s.quando_investir,s.tocou_botao_em,s.o_que_precisa,s.data,s.last_message_at,s.is_internal,s.chegou_no_vendedor,s.orcamento_enviado,s.orcamento_valor,s.status_real,s.status_vendedor,s.finished_at) order by s.data desc nulls last,s.id),'[]'::json))
 from (select id,nome,telefone,responsavel,criativo_codigo,origem,motivo_contato,finalidade_fabrica,qual_animal,quantos_animais,quando_investir,tocou_botao_em,o_que_precisa,data,last_message_at,is_internal,chegou_no_vendedor,orcamento_enviado,orcamento_valor,status_real,status_vendedor,finished_at from auditoria.atendimentos_por_cliente
       where is_internal=false order by data desc nulls last,id limit 50000) s;
$$;
revoke all on function auditoria.dashboard_snapshot() from public,anon;
grant execute on function auditoria.dashboard_snapshot() to authenticated,service_role;
notify pgrst,'reload schema';
