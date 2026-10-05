alter table public.ana_painel_clientes add column conversa_id uuid;
create or replace function public.ana_pacote_congelar(p_id uuid,p_vendedor text,p_pacote jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.outbound_dispatch; frozen jsonb;
begin
 select * into r from public.outbound_dispatch where id=p_id for update;
 if r.id is null or r.status<>'sending' or r.vendedor_nome is distinct from p_vendedor or coalesce(r.raw_payload->'pacote_vendedor_v1'->>'v','')<>'1'
 or r.raw_payload->'pacote_vendedor_v1'->>'conta' is distinct from p_vendedor then raise exception 'pacote_fora_do_escopo'; end if;
 frozen:=r.raw_payload->'_super_ia_pacote';
 if frozen is not null then return frozen; end if;
 if coalesce(p_pacote->>'v','')<>'1' or p_pacote->>'vendedor' is distinct from p_vendedor
 or p_pacote->>'desde' is distinct from r.raw_payload->'pacote_vendedor_v1'->>'desde'
 or jsonb_typeof(p_pacote->'passos') is distinct from 'array' or jsonb_array_length(p_pacote->'passos') not between 1 and 4
 then raise exception 'reserva_invalida'; end if;
 update public.outbound_dispatch set raw_payload=jsonb_set(raw_payload,'{_super_ia_pacote}',p_pacote,true) where id=p_id;
 if jsonb_array_length(coalesce(p_pacote->'faltas','[]'::jsonb))>0 then
 insert into public.ana_catalogo_pendencias(dispatch_id,sku,configuracao,faltas)
 values(p_id,p_pacote->'vinculo'->>'sku',(p_pacote->'vinculo') - 'video' - 'foto' - 'arte',p_pacote->'faltas') on conflict do nothing;
 end if;
 return p_pacote;
end $$;
revoke all on function public.ana_pacote_congelar(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.ana_pacote_congelar(uuid,text,jsonb) to service_role;


create or replace function public.ana_painel_refresh(p_chat text) returns void language plpgsql security definer set search_path='' as $$
declare a public.ia_atendimentos; w public.wa_chat_labels; c public.crm_chat_conversations;
 ref text; fase text; anterior text; fechado boolean; ciclo text;
begin
 select * into a from public.ia_atendimentos where chat_id=p_chat and vendedor_nome='ANA';
 if not found then return; end if;
 select * into w from public.wa_chat_labels where chat_id=p_chat and vendedor_nome='ANA' order by updated_at desc limit 1;
 select * into c from public.crm_chat_conversations where wa_chat_id=p_chat order by updated_at desc limit 1;
 ref:=case when c.contact_id is not null then 'crm:'||c.contact_id else 'ana:'||p_chat end;
 ciclo:=a.id::text||':'||coalesce(a.ligado_em,a.estado_desde,a.atualizado_em)::text;
 select etapa into anterior from public.ana_painel_clientes where chat_id=p_chat;
 select exists(select 1 from public.ana_arquivar_candidatos() f where f.chat_id=p_chat) into fechado;
 fase:=case when a.bloqueado_em is not null or c.ana_blocked_at is not null then 'bloqueado'
 when a.assumido_por is not null or c.human_hold or c.ana_paused_at is not null or c.lock_until>now() or a.estado='HUMAN_TAKEOVER' then 'pausado'
 when a.estado='WAITING_INTERNAL_GUIDANCE' then 'aguardando_orientacao'
 when fechado then 'finalizado'
 when a.ativo then 'atendendo'
 when a.motivo_desligamento='vendedor_assumir' then 'repasse_pendente'
 else 'inconclusivo' end;
 insert into public.ana_painel_clientes(chat_id,cliente_ref,contato_id,conversa_id,nome,etapa,necessidade,vendedor,pendencia,ultima_atividade,identidade_pendente)
 values(p_chat,ref,c.contact_id,c.id,coalesce(nullif(c.name,''),nullif(a.nome_contato,''),w.contact_name,p_chat),fase,
 coalesce(a.dados_coletados->>'equipamento',a.dados_coletados->>'modelo',a.dados_coletados->>'animal'),
 coalesce(a.dados_coletados->'_repasse'->>'vendedor',a.assumido_por,a.vendedor_nome),
 case fase when 'inconclusivo' then 'Desligado sem evidência suficiente de conclusão'
 when 'repasse_pendente' then 'Primeiro contato do vendedor ou fechamento ainda não confirmado'
 when 'aguardando_orientacao' then 'Aguardando orientação interna' when 'bloqueado' then 'Bloqueio humano'
 when 'pausado' then 'Responsabilidade humana / pausa' else null end,
 greatest(a.atualizado_em,w.last_message_at),c.contact_id is null)
 on conflict(chat_id) do update set cliente_ref=excluded.cliente_ref,contato_id=excluded.contato_id,conversa_id=excluded.conversa_id,nome=excluded.nome,
 etapa=excluded.etapa,necessidade=excluded.necessidade,vendedor=excluded.vendedor,pendencia=excluded.pendencia,
 ultima_atividade=excluded.ultima_atividade,identidade_pendente=excluded.identidade_pendente,atualizado_em=now();
 if fase='finalizado' and anterior is distinct from fase then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,dados)
 values('fechamento',ciclo||':'||coalesce(w.last_message_at::text,''),'finalizado',ref,p_chat,ciclo,jsonb_build_object('motivo',a.motivo_desligamento,'regra','ana_arquivar_candidatos')) on conflict do nothing;
 elsif anterior='finalizado' and fase<>'finalizado' then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,dados)
 values('estado',ciclo||':'||coalesce(w.last_message_at::text,''),'reaberto',ref,p_chat,ciclo,'{}') on conflict do nothing;
 end if;
end $$;
revoke all on function public.ana_painel_refresh(text) from public,anon,authenticated;
grant execute on function public.ana_painel_refresh(text) to service_role;


create function public.ana_painel_confirmar_v2(p_operacao uuid,p_msg_id text,p_ok boolean,p_categoria text default 'envio',p_ocorrido_em timestamptz default null) returns void
language plpgsql security definer set search_path='' as $$
declare o public.ana_painel_operacoes; ref text; instante timestamptz;
begin
 select * into o from public.ana_painel_operacoes where id=p_operacao for update;
 if not found then raise exception 'operacao_desconhecida'; end if;
 select cliente_ref into ref from public.ana_painel_clientes where chat_id=o.chat_id;
 ref:=coalesce(ref,'ana:'||o.chat_id);
 instante:=coalesce(p_ocorrido_em,now());
 if instante<o.criado_em-interval '5 minutes' or instante>now()+interval '5 minutes' then raise exception 'hora_confirmacao_invalida'; end if;
 if p_ok then
 if nullif(btrim(p_msg_id),'') is null then raise exception 'msg_id_obrigatorio'; end if;
 if o.confirmado_em is not null and o.msg_id<>p_msg_id then raise exception 'confirmacao_conflitante'; end if;
 update public.ana_painel_operacoes set confirmado_em=coalesce(confirmado_em,instante),msg_id=p_msg_id where id=p_operacao;
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,ocorrido_em,dados)
 values('resposta_ana',p_msg_id,'atendido',ref,o.chat_id,o.atendimento_ref,instante,jsonb_build_object('operacao',p_operacao,'msg_id',p_msg_id)) on conflict do nothing;
 if exists(select 1 from public.ana_painel_eventos where origem='operacao' and origem_ref=p_operacao::text and tipo='erro_tecnico') then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,ocorrido_em,dados)
 values('operacao',p_operacao::text,'recuperacao_erro',ref,o.chat_id,o.atendimento_ref,instante,'{}') on conflict do nothing;
 end if;
 else
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,ocorrido_em,dados)
 values('operacao',p_operacao::text,'erro_tecnico',ref,o.chat_id,o.atendimento_ref,instante,
 jsonb_build_object('categoria',left(coalesce(p_categoria,'envio'),40),'resumo','Falha reportada pela extensão')) on conflict do nothing;
 end if;
end $$;
revoke all on function public.ana_painel_confirmar_v2(uuid,text,boolean,text,timestamptz) from public,anon,authenticated;
grant execute on function public.ana_painel_confirmar_v2(uuid,text,boolean,text,timestamptz) to service_role;


create or replace function public.ana_painel_consultar(p_inicio timestamptz,p_fim timestamptz,p_filtro text default 'todos',p_cursor text default null,p_limite integer default 25)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare resposta jsonb; cur jsonb; cur_data timestamptz; cur_ref text;
begin
 if not public.ana_painel_admin() then raise exception 'Acesso administrativo necessário' using errcode='42501'; end if;
 if p_inicio is null or p_fim is null or p_fim<=p_inicio or p_fim-p_inicio>interval '366 days' then raise exception 'Intervalo inválido (máximo 366 dias)'; end if;
 if p_limite is null or p_limite not between 1 and 100 or p_filtro is null or p_filtro not in ('todos','atendidos','qualificados','erros','abertos','alertas') then raise exception 'Filtro ou limite inválido'; end if;
 if p_cursor is not null then
 cur:=p_cursor::jsonb; cur_data:=(cur->>'data')::timestamptz; cur_ref:=cur->>'ref';
 if cur_data is null or cur_ref is null then raise exception 'Cursor inválido'; end if;
 end if;
 with ev as (
 select e.*,coalesce(c.cliente_ref,e.cliente_ref) ref from public.ana_painel_eventos e left join public.ana_painel_clientes c on c.chat_id=e.chat_id
 where e.ocorrido_em>=p_inicio and e.ocorrido_em<p_fim
 ), clientes as (
 select distinct on(c.cliente_ref) c.* from public.ana_painel_clientes c
 where case p_filtro when 'abertos' then c.etapa<>'finalizado'
 when 'atendidos' then exists(select 1 from ev where ref=c.cliente_ref and tipo='atendido')
 when 'qualificados' then exists(select 1 from ev where ref=c.cliente_ref and tipo='qualificado')
 when 'todos' then c.etapa<>'finalizado' or exists(select 1 from ev where ref=c.cliente_ref)
 else false end
 order by c.cliente_ref,c.ultima_atividade desc nulls last,c.chat_id
 ), lista as (select * from clientes where cur_data is null or (coalesce(ultima_atividade,'epoch'::timestamptz),cliente_ref)<(cur_data,cur_ref)
 order by coalesce(ultima_atividade,'epoch'::timestamptz) desc,cliente_ref desc limit p_limite),
 incidentes as (
 select e.id,e.origem,e.origem_ref,e.tipo,e.chat_id,e.ocorrido_em,e.dados,
 exists(select 1 from public.ana_painel_eventos rec where rec.origem=e.origem and rec.origem_ref=e.origem_ref and rec.tipo='recuperacao_erro') recuperado
 from ev e where e.tipo=case p_filtro when 'erros' then 'erro_tecnico' when 'alertas' then 'alerta_revisor' else '' end
 and (cur_data is null or (e.ocorrido_em,e.id::text)<(cur_data,cur_ref))
 order by e.ocorrido_em desc,e.id::text desc limit p_limite
 )
 select jsonb_build_object('gerado_em',now(),'periodo',jsonb_build_object('inicio',p_inicio,'fim',p_fim),
 'cobertura',(select jsonb_object_agg(indicador,jsonb_build_object('inicio',inicio,'incompleta',p_inicio<inicio,'disponivel',(p_fim>inicio and p_inicio<now()) or exists(select 1 from ev where tipo=case indicador when 'atendidos' then 'atendido' when 'qualificados' then 'qualificado' when 'erros_tecnicos' then 'erro_tecnico' when 'alertas_revisor' then 'alerta_revisor' end),'parcial',p_inicio<inicio,'observacao',observacao)) from public.ana_painel_cobertura),
 'totais',jsonb_build_object('atendidos',(select count(distinct ref) from ev where tipo='atendido'),
 'qualificados',(select count(distinct ref) from ev where tipo='qualificado'),'erros_tecnicos',(select count(*) from ev where tipo='erro_tecnico'),
 'alertas_revisor',(select count(*) from ev where tipo='alerta_revisor'),'nao_finalizados_agora',(select count(distinct cliente_ref) from public.ana_painel_clientes where etapa<>'finalizado')),
 'clientes',coalesce((select jsonb_agg(to_jsonb(lista)) from lista),'[]'::jsonb),
 'incidentes',coalesce((select jsonb_agg(to_jsonb(incidentes)) from incidentes),'[]'::jsonb),
 'proximo_cursor',case when (case when p_filtro in ('erros','alertas') then (select count(*) from incidentes) else (select count(*) from lista) end)=p_limite
 then case when p_filtro in ('erros','alertas') then (select jsonb_build_object('data',ocorrido_em,'ref',id::text)::text from incidentes order by ocorrido_em,id::text limit 1)
 else (select jsonb_build_object('data',coalesce(ultima_atividade,'epoch'::timestamptz),'ref',cliente_ref)::text from lista order by coalesce(ultima_atividade,'epoch'::timestamptz),cliente_ref limit 1) end end)
 into resposta;
 return resposta;
end $$;
revoke all on function public.ana_painel_consultar(timestamptz,timestamptz,text,text,integer) from public,anon;
grant execute on function public.ana_painel_consultar(timestamptz,timestamptz,text,text,integer) to authenticated;

select public.ana_painel_snapshot();
