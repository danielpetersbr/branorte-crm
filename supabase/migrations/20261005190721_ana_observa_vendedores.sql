create table public.ana_vendedor_evidencias (
 id bigint generated always as identity primary key, origem_chave text not null unique,vendedor text not null,
 chat_id text not null, data timestamptz not null, mensagens_origem jsonb not null, tema text, citacao text,
 sugestao text, regra_comparada jsonb not null default '[]',tipo text, estado text not null default 'candidato',
 criado_em timestamptz not null default now()
);
alter table public.ana_vendedor_evidencias enable row level security;
revoke all on public.ana_vendedor_evidencias from anon,authenticated;
grant select on public.ana_vendedor_evidencias to authenticated;
grant all on public.ana_vendedor_evidencias to service_role;
grant usage,select on sequence public.ana_vendedor_evidencias_id_seq to service_role;
create policy admin_read on public.ana_vendedor_evidencias for select to authenticated using((select public.ana_painel_admin()));
create function public.ana_observa_sem_acento(text) returns text language sql immutable set search_path='' as $$
select lower(translate($1,'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ','aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC'))
$$;
revoke all on function public.ana_observa_sem_acento(text) from public,anon,authenticated;
create or replace function public.ana_observa_pares(p_desde timestamptz, p_ate timestamptz default now())
returns jsonb language sql stable security definer set search_path = public set statement_timeout = '25s' as $$
-- @@pares_inicio
with maquina as (
  select distinct left(lower(regexp_replace(btrim(a.payload ->> 'texto'), '\s+', ' ', 'g')), 80) as p
    from public.automation_runs a
   where a.regra_key = 'ia_atendente' and a.created_at >= p_desde - interval '2 days' and a.created_at < p_ate + interval '1 day'
     and length(btrim(coalesce(a.payload ->> 'texto', ''))) >= 20
  union
  select distinct left(lower(regexp_replace(btrim(s.body), '\s+', ' ', 'g')), 80)
    from public.wa_scheduled_messages s
   where s.created_at >= p_desde - interval '3 days' and s.created_at < p_ate + interval '1 day' and s.status = 'sent'
     and length(btrim(coalesce(s.body, ''))) >= 20
),
internos as (
  select distinct right(regexp_replace(coalesce(x.telefone, ''), '\D', '', 'g'), 8) as f8
    from (select telefone from public.ia_contatos_internos union all select telefone from public.vendors) x
   where length(regexp_replace(coalesce(x.telefone, ''), '\D', '', 'g')) >= 8
),
msgs as (
  select m.vendedor_nome as v, m.chat_id, m.msg_id, m.from_me, m.data_msg as t, m.phone,
         btrim(case
           when m.tipo in ('ptt', 'audio') then coalesce(m.transcricao, '')
           when m.tipo = 'chat' then coalesce(m.body, '')
           when m.tipo in ('image', 'video', 'document') and length(coalesce(m.body, '')) between 1 and 1000
                and m.body ~ '\s' then m.body
           else '' end) as txt
    from public.wa_chat_messages m
   where m.data_msg >= p_desde - interval '2 hours' and m.data_msg < p_ate
     and m.vendedor_nome <> 'ANA'
     and m.tipo in ('chat', 'ptt', 'audio', 'image', 'video', 'document')
     and m.chat_id ~ '@(c\.us|lid)$'
),
marcadas as (
  select x.*, left(lower(regexp_replace(x.txt, '\s+', ' ', 'g')), 80) as p80 from msgs x where x.txt <> ''
),
templ as (
  select p80 from marcadas where from_me and length(p80) >= 30 group by p80 having count(distinct chat_id) > 2
),
limpas as (
  select k.* from marcadas k
   where not (k.from_me and (k.p80 in (select p from maquina) or k.p80 in (select p80 from templ)
              or k.txt ~* '(consulta autom[^ ]*tica da ia|CONSULTA-\d{4,}|FRETE-\d{4,}|me responde aqui que eu passo pro cliente)'))
     and not exists (select 1 from internos i where i.f8 = right(regexp_replace(coalesce(k.phone, ''), '\D', '', 'g'), 8))
),
seq as (
  select l.*, case when l.from_me is distinct from lag(l.from_me) over w then 1 else 0 end as muda
    from limpas l window w as (partition by l.v, l.chat_id order by l.t, l.msg_id)
),
turnos as (
  select s.*, sum(s.muda) over (partition by s.v, s.chat_id order by s.t, s.msg_id) as turno from seq s
),
numerados as (
  select t.*, row_number() over (partition by t.v, t.chat_id, t.turno order by t.t, t.msg_id) as rn_ini,
              row_number() over (partition by t.v, t.chat_id, t.turno order by t.t desc, t.msg_id desc) as rn_fim
    from turnos t
),
cli as (
  select v, chat_id, turno, max(t) as fim,
         string_agg(txt, E'\n' order by t) filter (where rn_fim <= 3) as q,
         array_agg(msg_id order by t) filter (where rn_fim <= 3) as q_ids
    from numerados where not from_me group by v, chat_id, turno
),
ven as (
  select v, chat_id, turno, min(t) as ini,
         string_agg(txt, E'\n' order by t) filter (where rn_ini <= 3) as a,
         array_agg(msg_id order by t) filter (where rn_ini <= 3) as a_ids
    from numerados where from_me group by v, chat_id, turno
),
pares as (
  select c.v, c.chat_id, c.q, c.q_ids, c.fim as q_em, n.a, n.a_ids, n.ini as a_em
    from cli c join ven n on n.v = c.v and n.chat_id = c.chat_id and n.turno = c.turno + 1
   where c.fim >= p_desde and n.ini - c.fim <= interval '2 hours'
     and length(c.q) >= 10 and length(n.a) >= 25
     and (c.q ~ '\?' or public.ana_observa_sem_acento(c.q) ~ '(^|\n)\s*(como|qual|quais|quanto|quantos|quantas|onde|quando|porque|por que|tem|voces|vcs|faz|fazem|serve|pode|posso|da pra|da para|consegue|conseguem|precisa|funciona|aguenta|existe|vem|vai)\M')
     and not exists (select 1 from public.ana_vendedor_evidencias f where f.origem_chave = c.v || '|' || n.a_ids[1])
)
select coalesce(jsonb_agg(jsonb_build_object(
         'chave', p.v || '|' || p.a_ids[1], 'v', p.v, 'chat_id', p.chat_id, 'q', left(p.q, 600), 'q_ids', to_jsonb(p.q_ids),
         'q_em', p.q_em, 'a', left(p.a, 900), 'a_ids', to_jsonb(p.a_ids), 'a_em', p.a_em) order by p.a_em), '[]'::jsonb)
  from (select * from pares order by a_em desc limit 1500) p
-- @@pares_fim
$$;
revoke all on function public.ana_observa_pares(timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.ana_observa_pares(timestamptz,timestamptz) to service_role;
create table public.ana_observa_reservas(dia date primary key, execucao bigint not null references public.ana_revisor_execucoes(id));
alter table public.ana_observa_reservas enable row level security;
revoke all on public.ana_observa_reservas from anon,authenticated;
grant all on public.ana_observa_reservas to service_role;
create function public.ana_observa_reservar() returns jsonb language plpgsql security definer set search_path='' as $$
declare cfg jsonb; custo numeric; exec_id bigint; dia date:=current_date;
begin
 perform pg_advisory_xact_lock(hashtext('ana-observa-budget'));
 select valor->'v' into cfg from public.ia_config where chave='ana_revisor';
 if cfg->>'ativo'<>'true' or cfg->>'llm'<>'true' or nullif(cfg->>'modelo','') is null then return jsonb_build_object('ok',false,'motivo','revisor_indisponivel'); end if;
 if exists(select 1 from public.ana_observa_reservas where ana_observa_reservas.dia=current_date) then return jsonb_build_object('ok',false,'motivo','rodada_diaria_registrada'); end if;
 select coalesce(sum(custo_usd),0) into custo from public.ana_revisor_execucoes where iniciado_em>=date_trunc('day',now());
 if custo+0.05>least(1,(cfg->>'teto_usd_dia')::numeric) then return jsonb_build_object('ok',false,'motivo','teto_compartilhado'); end if;
 if exists(select 1 from public.ana_revisor_execucoes where terminado_em is null and iniciado_em>now()-interval '10 minutes') then return jsonb_build_object('ok',false,'motivo','revisor_em_execucao'); end if;
 insert into public.ana_revisor_execucoes(modo,iniciado_em,custo_usd,detalhe) values('vendedores_observacao',now(),0.05,jsonb_build_object('reserva',true,'sem_publicacao',true)) returning id into exec_id;
 insert into public.ana_observa_reservas values(dia,exec_id);
 return jsonb_build_object('ok',true,'id',exec_id,'modelo',cfg->>'modelo','preco_in_mtok',cfg->'preco_in_mtok','preco_out_mtok',cfg->'preco_out_mtok','teto_rodada',0.05);
end $$;
revoke all on function public.ana_observa_reservar() from public,anon,authenticated;
grant execute on function public.ana_observa_reservar() to service_role;
