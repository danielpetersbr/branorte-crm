-- Espelho do /whatsapp (só o admin vê): TEXTO das conversas dos vendedores que estão FORA do funil
-- (Orçamento enviado sozinho, Resolvido, Nunca respondeu...). Fica SEPARADO de wa_chat_messages de propósito:
-- ~80 funções (atendidos, placar, supervisão, dono do cliente, roteamento) leem aquela tabela e não podem
-- mudar de comportamento por causa do espelho. Sem mídia: foto/áudio continuam só do funil (decisão do Daniel, 21/10/2026).
-- Escrita: edge wa-sync-messages v19 (campo mensagens_espelho), extensão 1.70.65+.
create table public.wa_chat_messages_espelho (
  id bigint generated always as identity primary key,
  vendedor_nome text not null,
  chat_id text not null,
  phone text,
  msg_id text not null,
  from_me boolean,
  tipo text not null default 'chat',
  body text,
  duracao_seg integer,
  filename text,
  data_msg timestamptz,
  synced_at timestamptz not null default now(),
  -- por conta: a mesma mensagem entre dois vendedores tem o mesmo id nas duas contas
  constraint wa_chat_messages_espelho_vendedor_msg_uk unique (vendedor_nome, msg_id)
);
create index wa_chat_messages_espelho_chat_idx on public.wa_chat_messages_espelho (vendedor_nome, chat_id, data_msg desc);

alter table public.wa_chat_messages_espelho enable row level security;
revoke all on public.wa_chat_messages_espelho from anon, authenticated;
grant select on public.wa_chat_messages_espelho to authenticated;
create policy wa_chat_messages_espelho_admin_le on public.wa_chat_messages_espelho
  for select to authenticated using ((select public.is_admin()));

-- Leitura do espelho: as duas fontes juntas. security_invoker = a RLS de cada tabela vale pra quem consulta.
-- origem: 'funil' = wa_chat_messages (texto + mídia); 'espelho' = só texto, conversa fora do funil.
create view public.wa_chat_messages_espelho_todas with (security_invoker = true) as
  select msg_id, vendedor_nome, chat_id, from_me, tipo, body, duracao_seg, media_url, data_msg, transcricao, transcricao_em, 'funil'::text as origem
    from public.wa_chat_messages
  union all
  select msg_id, vendedor_nome, chat_id, from_me, tipo, body, duracao_seg, null::text, data_msg, null::text, null::timestamptz, 'espelho'::text
    from public.wa_chat_messages_espelho;
revoke all on public.wa_chat_messages_espelho_todas from anon, authenticated;
grant select on public.wa_chat_messages_espelho_todas to authenticated;
