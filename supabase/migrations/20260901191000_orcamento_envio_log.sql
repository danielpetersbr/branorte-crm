-- Log de TENTATIVA de envio do orcamento pro WhatsApp do vendedor.
-- Ate aqui o unico registro era o SUCESSO (a linha em wa_scheduled_messages). Falha nao
-- gravava nada: a edge devolvia 400 e sumia, e o /api/orcamento-confirm devolve HTTP 200
-- mesmo com whatsapp.ok=false. Por isso um defeito de envio ficou semanas invisivel e
-- medir a taxa real exigia cruzar storage.objects com wa_scheduled_messages na mao.
create table if not exists public.orcamento_envio_log (
  id                  uuid primary key default gen_random_uuid(),
  criado_em           timestamptz not null default now(),
  numero              text,
  vendedor_recebido   text,
  vendedor_resolvido  text,
  via                 text,
  telefone            text,
  origem              text not null default 'edge',
  resultado           text not null,
  erro                text,
  scheduled_id        uuid
);

create index if not exists orcamento_envio_log_criado_em_idx
  on public.orcamento_envio_log (criado_em desc);
-- indice parcial: a pergunta do dia a dia e "o que NAO chegou"
create index if not exists orcamento_envio_log_falhas_idx
  on public.orcamento_envio_log (criado_em desc)
  where resultado <> 'ok';

alter table public.orcamento_envio_log enable row level security;

-- GRANT explicito: policy sem grant deixa o app com permission denied, e o MCP
-- (service_role) da verde falso porque bypassa RLS.
grant select on public.orcamento_envio_log to authenticated;

-- (select ...) envolvendo a funcao: sem isso o Postgres chama papel_conhecido() POR LINHA.
drop policy if exists oel_select_interno on public.orcamento_envio_log;
create policy oel_select_interno on public.orcamento_envio_log
  for select to authenticated
  using ((select public.papel_conhecido()));

comment on table public.orcamento_envio_log is
  'Tentativas de envio do orcamento pro WhatsApp do vendedor (sucesso E falha). Escrita pela edge orcamento-enviar-meu-zap com service_role. "Quantos nao chegaram hoje": select resultado, count(*) from orcamento_envio_log where criado_em > current_date and resultado <> ''ok'' group by 1;';
