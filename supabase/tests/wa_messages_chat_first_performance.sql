-- Synthetic plan regression only. No production tables are written or copied.
-- Run as one transaction; all fixtures and indexes disappear at ROLLBACK.
begin;
set local statement_timeout = '8s';

create temporary table perf_messages (
  id bigint, msg_id text, chat_id text, vendedor_nome text,
  data_msg timestamptz, from_me boolean
) on commit drop;

insert into perf_messages
select n, 'msg-' || lpad(n::text, 6, '0'), 'chat-' || (n % 1200),
       'vendor-' || (n % 9), timestamptz '2026-01-01' + n * interval '1 minute',
       (n / 1200) % 4 <> 0
from generate_series(1, 12000) n;

-- Eligible supervision chats have only outbound messages. Same-timestamp
-- outbound messages must stay in one approach irrespective of tie ordering.
insert into perf_messages values
  (12001,'tie-1','tied-outbound','vendor-1','2026-01-01 00:00Z',true),
  (12002,'tie-2','tied-outbound','vendor-2','2026-01-01 00:00Z',true),
  (12003,'tie-3','tied-outbound','vendor-1','2026-01-02 00:00Z',true);

create index perf_vendor_timeline on perf_messages
  (vendedor_nome, chat_id, data_msg desc, id desc);
analyze perf_messages;

create temporary table perf_baseline on commit drop as
select msg_id from perf_messages where chat_id='chat-37' and from_me
order by data_msg desc, msg_id desc limit 1;

create temporary table perf_approaches_baseline on commit drop as
with m as (
  select from_me, data_msg, lag(data_msg) over (order by data_msg) ant,
         lag(from_me) over (order by data_msg) ant_from
  from perf_messages where chat_id='chat-37'
), saida as (
  select data_msg, case when ant is null or ant_from is false
    or data_msg-ant > interval '6 hours' then 1 else 0 end inicia
  from m where from_me is true
)
select coalesce(sum(inicia),0)::int n_abordagens, min(data_msg) primeira,
       max(data_msg) ultima,
       exists(select 1 from perf_messages where chat_id='chat-37'
              and from_me is false) houve_resposta from saida;

create temporary table perf_plans(label text, plan jsonb) on commit drop;
do $$ declare p jsonb; begin
  execute $q$explain (format json) select vendedor_nome from perf_messages
    where chat_id='chat-37' and from_me
    order by data_msg desc,msg_id desc limit 1$q$ into p;
  insert into perf_plans values ('vendor_first',p);
end $$;

-- Exactly the candidate production index, on synthetic fixtures only.
create index perf_chat_timeline on perf_messages
  (chat_id, data_msg desc, msg_id desc) include (from_me,vendedor_nome);
analyze perf_messages;

do $$
declare p jsonb; baseline jsonb; actual_msg text; expected_msg text;
  actual_approaches jsonb; expected_approaches jsonb;
begin
  execute $q$explain (format json) select vendedor_nome from perf_messages
    where chat_id='chat-37' and from_me
    order by data_msg desc,msg_id desc limit 1$q$ into p;
  insert into perf_plans values ('chat_first',p);
  select plan into baseline from perf_plans where label='vendor_first';
  if p::text not like '%perf_chat_timeline%' or p::text like '%"Node Type": "Sort"%' then
    raise exception 'Latest outbound must use chat-first index without sort: %',p;
  end if;
  if (p->0->'Plan'->>'Total Cost')::numeric >=
     (baseline->0->'Plan'->>'Total Cost')::numeric then
    raise exception 'Chat-first index must reduce latest-outbound estimated cost';
  end if;
  execute $q$explain (format json)
    select from_me,data_msg,lag(data_msg) over(order by data_msg) ant,
           lag(from_me) over(order by data_msg) ant_from
    from perf_messages where chat_id='chat-37'$q$ into p;
  insert into perf_plans values ('approach_window',p);
  if p::text not like '%perf_chat_timeline%' or p::text like '%"Node Type": "Sort"%' then
    raise exception 'Approach window must use chat-first index without sort: %',p;
  end if;
  select msg_id into actual_msg from perf_messages
    where chat_id='chat-37' and from_me order by data_msg desc,msg_id desc limit 1;
  select msg_id into expected_msg from perf_baseline;
  if actual_msg is distinct from expected_msg then
    raise exception 'Index changed latest-outbound result';
  end if;
  with m as (
    select from_me,data_msg,lag(data_msg) over(order by data_msg) ant,
           lag(from_me) over(order by data_msg) ant_from
    from perf_messages where chat_id='chat-37'
  ), saida as (
    select data_msg,case when ant is null or ant_from is false
      or data_msg-ant > interval '6 hours' then 1 else 0 end inicia
    from m where from_me is true
  ), result as (
    select coalesce(sum(inicia),0)::int n_abordagens,min(data_msg) primeira,
      max(data_msg) ultima,exists(select 1 from perf_messages
      where chat_id='chat-37' and from_me is false) houve_resposta from saida
  ) select to_jsonb(result) into actual_approaches from result;
  select to_jsonb(b) into expected_approaches from perf_approaches_baseline b;
  if actual_approaches is distinct from expected_approaches then
    raise exception 'Index changed approach grouping';
  end if;
  with m as (
    select data_msg,lag(data_msg) over(order by data_msg) ant
    from perf_messages where chat_id='tied-outbound'
  ) select sum(case when ant is null or data_msg-ant > interval '6 hours'
                    then 1 else 0 end) into actual_msg from m;
  if actual_msg is distinct from '2' then
    raise exception 'Same-timestamp outbound messages changed approach count';
  end if;
end $$;

select label,plan->0->'Plan'->>'Total Cost' estimated_cost,
       plan->0->'Plan'->'Plans'->0->>'Node Type' access,
       plan->0->'Plan'->'Plans'->0->>'Index Name' index_name
from perf_plans order by label;
rollback;
