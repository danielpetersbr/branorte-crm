-- Metrics are additive. Delivery identity comes from the extension's confirmed message ID.
create table public.ana_painel_eventos (
 id uuid primary key default gen_random_uuid(), origem text not null, origem_ref text not null,
 tipo text not null check(tipo in ('atendido','qualificado','finalizado','reaberto','erro_tecnico','alerta_revisor','recuperacao_erro')),
 cliente_ref text not null, chat_id text, atendimento_ref text,
 ocorrido_em timestamptz not null default now(), registrado_em timestamptz not null default now(),
 dados jsonb not null default '{}', unique(origem,origem_ref,tipo)
);
create index on public.ana_painel_eventos(tipo,ocorrido_em);
create index on public.ana_painel_eventos(cliente_ref,ocorrido_em);
create index on public.ana_painel_eventos(atendimento_ref,ocorrido_em);
create table public.ana_painel_operacoes (
 id uuid primary key, chat_id text not null, atendimento_ref text, criado_em timestamptz not null default now(),
 confirmado_em timestamptz, msg_id text, dados jsonb not null default '{}'
);
create table public.ana_painel_clientes (
 chat_id text primary key, cliente_ref text not null, contato_id uuid, nome text,
 etapa text not null, necessidade text, vendedor text, pendencia text,
 ultima_atividade timestamptz, atualizado_em timestamptz not null default now(), identidade_pendente boolean not null
);
create index on public.ana_painel_clientes(cliente_ref);
create table public.ana_painel_cobertura (
 indicador text primary key, inicio timestamptz not null default now(), observacao text not null
);
insert into public.ana_painel_cobertura(indicador,observacao) values
 ('atendidos','Confirmações identificadas da extensão a partir da ativação da captura; respostas antigas geradas não comprovam envio.'),
 ('qualificados','Decisão e critérios validados no runtime atual; marcas antigas do pool não são importadas.'),
 ('erros_tecnicos','Falhas explícitas de geração, consulta, envio e repasse. Histórico recuperado quando existe vínculo operacional.'),
 ('alertas_revisor','Achados do revisor são alertas para revisão, não erros confirmados.');

create function public.ana_painel_admin() returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.user_profiles u join public.profiles p on p.id=u.id
 where u.id=(select auth.uid()) and u.role='admin' and u.approved_at is not null and p.is_active is true)
$$;
revoke all on function public.ana_painel_admin() from public,anon;
grant execute on function public.ana_painel_admin() to authenticated,service_role;
alter table public.ana_painel_eventos enable row level security;
alter table public.ana_painel_operacoes enable row level security;
alter table public.ana_painel_clientes enable row level security;
alter table public.ana_painel_cobertura enable row level security;
create policy admin_read on public.ana_painel_eventos for select to authenticated using ((select public.ana_painel_admin()));
create policy admin_read on public.ana_painel_clientes for select to authenticated using ((select public.ana_painel_admin()));
create policy admin_read on public.ana_painel_cobertura for select to authenticated using ((select public.ana_painel_admin()));
revoke all on public.ana_painel_eventos,public.ana_painel_operacoes,public.ana_painel_clientes,public.ana_painel_cobertura from anon,authenticated;
grant select on public.ana_painel_eventos,public.ana_painel_clientes,public.ana_painel_cobertura to authenticated;
grant all on public.ana_painel_eventos,public.ana_painel_operacoes,public.ana_painel_clientes,public.ana_painel_cobertura to service_role;

create function public.ana_painel_refresh(p_chat text) returns void language plpgsql security definer set search_path='' as $$
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
 when a.assumido_por is not null or c.human_hold or a.estado='HUMAN_TAKEOVER' then 'pausado'
 when a.estado='WAITING_INTERNAL_GUIDANCE' then 'aguardando_orientacao'
 when fechado then 'finalizado'
 when a.ativo then 'atendendo'
 when a.motivo_desligamento='vendedor_assumir' then 'repasse_pendente'
 else 'inconclusivo' end;
 insert into public.ana_painel_clientes(chat_id,cliente_ref,contato_id,nome,etapa,necessidade,vendedor,pendencia,ultima_atividade,identidade_pendente)
 values(p_chat,ref,c.contact_id,coalesce(nullif(c.name,''),nullif(a.nome_contato,''),w.contact_name,p_chat),fase,
 coalesce(a.dados_coletados->>'equipamento',a.dados_coletados->>'modelo',a.dados_coletados->>'animal'),
 coalesce(a.dados_coletados->'_repasse'->>'vendedor',a.assumido_por,a.vendedor_nome),
 case fase when 'inconclusivo' then 'Desligado sem evidência suficiente de conclusão'
 when 'repasse_pendente' then 'Primeiro contato do vendedor ou fechamento ainda não confirmado'
 when 'aguardando_orientacao' then 'Aguardando orientação interna' when 'bloqueado' then 'Bloqueio humano'
 when 'pausado' then 'Responsabilidade humana / pausa' else null end,
 greatest(a.atualizado_em,w.last_message_at),c.contact_id is null)
 on conflict(chat_id) do update set cliente_ref=excluded.cliente_ref,contato_id=excluded.contato_id,nome=excluded.nome,
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

create function public.ana_painel_confirmar(p_operacao uuid,p_msg_id text,p_ok boolean,p_categoria text default 'envio') returns void
language plpgsql security definer set search_path='' as $$
declare o public.ana_painel_operacoes; ref text;
begin
 select * into o from public.ana_painel_operacoes where id=p_operacao for update;
 if not found then raise exception 'operacao_desconhecida'; end if;
 select cliente_ref into ref from public.ana_painel_clientes where chat_id=o.chat_id;
 ref:=coalesce(ref,'ana:'||o.chat_id);
 if p_ok then
 if nullif(btrim(p_msg_id),'') is null then raise exception 'msg_id_obrigatorio'; end if;
 if o.confirmado_em is not null and o.msg_id<>p_msg_id then raise exception 'confirmacao_conflitante'; end if;
 update public.ana_painel_operacoes set confirmado_em=coalesce(confirmado_em,now()),msg_id=p_msg_id where id=p_operacao;
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,dados)
 values('resposta_ana',p_msg_id,'atendido',ref,o.chat_id,o.atendimento_ref,jsonb_build_object('operacao',p_operacao,'msg_id',p_msg_id)) on conflict do nothing;
 if exists(select 1 from public.ana_painel_eventos where origem='operacao' and origem_ref=p_operacao::text and tipo='erro_tecnico') then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,dados)
 values('operacao',p_operacao::text,'recuperacao_erro',ref,o.chat_id,o.atendimento_ref,'{}') on conflict do nothing;
 end if;
 else
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,atendimento_ref,dados)
 values('operacao',p_operacao::text,'erro_tecnico',ref,o.chat_id,o.atendimento_ref,
 jsonb_build_object('categoria',left(coalesce(p_categoria,'envio'),40),'resumo','Falha reportada pela extensão')) on conflict do nothing;
 end if;
end $$;
revoke all on function public.ana_painel_confirmar(uuid,text,boolean,text) from public,anon,authenticated;
grant execute on function public.ana_painel_confirmar(uuid,text,boolean,text) to service_role;

create function public.ana_painel_trigger() returns trigger language plpgsql security definer set search_path='' as $$
declare chat text; ref text; r record;
begin
 if TG_TABLE_NAME in ('ia_atendimentos','wa_chat_labels') then
 if NEW.vendedor_nome='ANA' then perform public.ana_painel_refresh(NEW.chat_id); end if;
 elsif TG_TABLE_NAME='crm_chat_conversations' then
 perform public.ana_painel_refresh(NEW.wa_chat_id);
 elsif TG_TABLE_NAME='ana_revisor_achados' then
 select cliente_ref into ref from public.ana_painel_clientes where chat_id=NEW.chat_id;
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,ocorrido_em,dados)
 values('revisor',NEW.id::text,'alerta_revisor',coalesce(ref,'ana:'||NEW.chat_id),NEW.chat_id,NEW.criado_em,
 jsonb_build_object('categoria',NEW.tipo,'severidade',NEW.severidade,'resumo',left(NEW.explicacao,400),'referencia',NEW.id)) on conflict do nothing;
 elsif TG_TABLE_NAME='outbound_dispatch' then
 for r in select a.chat_id from public.ia_atendimentos a where a.vendedor_nome='ANA' and a.dados_coletados->'_repasse'->>'dispatch_id'=NEW.id::text loop
 perform public.ana_painel_refresh(r.chat_id);
 if NEW.status='failed' then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,dados)
 select 'dispatch',NEW.id::text,'erro_tecnico',cliente_ref,chat_id,jsonb_build_object('categoria','repasse','resumo','Primeiro contato falhou','referencia',NEW.id) from public.ana_painel_clientes where chat_id=r.chat_id on conflict do nothing;
 elsif NEW.status='sent' then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,dados)
 select 'dispatch',NEW.id::text,'recuperacao_erro',cliente_ref,chat_id,'{}' from public.ana_painel_clientes where chat_id=r.chat_id
 and exists(select 1 from public.ana_painel_eventos where origem='dispatch' and origem_ref=NEW.id::text and tipo='erro_tecnico') on conflict do nothing;
 end if; end loop;
 elsif TG_TABLE_NAME='wa_scheduled_messages' and NEW.vendedor_nome='ANA' and NEW.to_self is false and NEW.status='failed' then
 insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,dados)
 values('agendamento',NEW.id::text,'erro_tecnico','ana:'||NEW.chat_id,NEW.chat_id,jsonb_build_object('categoria','envio','resumo','Mensagem agendada falhou','referencia',NEW.id)) on conflict do nothing;
 end if;
 return NEW;
end $$;
revoke all on function public.ana_painel_trigger() from public,anon,authenticated;
create trigger ana_painel_a after insert or update on public.ia_atendimentos for each row execute function public.ana_painel_trigger();
create trigger ana_painel_w after insert or update on public.wa_chat_labels for each row execute function public.ana_painel_trigger();
create trigger ana_painel_c after insert or update on public.crm_chat_conversations for each row execute function public.ana_painel_trigger();
create trigger ana_painel_r after insert on public.ana_revisor_achados for each row execute function public.ana_painel_trigger();
create trigger ana_painel_d after update of status,msg_id on public.outbound_dispatch for each row execute function public.ana_painel_trigger();
create trigger ana_painel_s after update of status on public.wa_scheduled_messages for each row execute function public.ana_painel_trigger();
-- The archive guard has a two-minute quiet window. Refresh it even when no new row arrives.
create function public.ana_painel_snapshot() returns void language plpgsql security definer set search_path='' as $$
declare r record; begin
 for r in select chat_id from public.ia_atendimentos where vendedor_nome='ANA' loop perform public.ana_painel_refresh(r.chat_id); end loop;
end $$;
revoke all on function public.ana_painel_snapshot() from public,anon,authenticated;
grant execute on function public.ana_painel_snapshot() to service_role;
select cron.schedule('ana-painel-snapshot','*/2 * * * *','select public.ana_painel_snapshot()');
do $$ declare r record; begin for r in select chat_id from public.ia_atendimentos where vendedor_nome='ANA' loop perform public.ana_painel_refresh(r.chat_id); end loop; end $$;
insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,ocorrido_em,dados)
select 'revisor',r.id::text,'alerta_revisor',coalesce(c.cliente_ref,'ana:'||r.chat_id),r.chat_id,r.criado_em,
jsonb_build_object('categoria',r.tipo,'severidade',r.severidade,'resumo',left(r.explicacao,400),'referencia',r.id)
from public.ana_revisor_achados r left join public.ana_painel_clientes c on c.chat_id=r.chat_id on conflict do nothing;
insert into public.ana_painel_eventos(origem,origem_ref,tipo,cliente_ref,chat_id,ocorrido_em,dados)
select 'agendamento',s.id::text,'erro_tecnico',coalesce(c.cliente_ref,'ana:'||s.chat_id),s.chat_id,s.created_at,
jsonb_build_object('categoria','envio','resumo','Mensagem agendada falhou','referencia',s.id)
from public.wa_scheduled_messages s left join public.ana_painel_clientes c on c.chat_id=s.chat_id
where s.vendedor_nome='ANA' and s.to_self is false and s.status='failed' on conflict do nothing;

create function public.ana_painel_consultar(p_inicio timestamptz,p_fim timestamptz,p_filtro text default 'todos',p_cursor text default null,p_limite integer default 25)
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
 'cobertura',(select jsonb_object_agg(indicador,jsonb_build_object('inicio',inicio,'incompleta',p_inicio<inicio,'observacao',observacao)) from public.ana_painel_cobertura),
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
