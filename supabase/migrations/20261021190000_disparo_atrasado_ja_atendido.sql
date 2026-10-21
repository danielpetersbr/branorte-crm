-- Disparo atrasado não sai se OUTRO vendedor já pegou o cliente (21/10/2026, Daniel: "acha esse bug e resolve pra não
-- acontecer mais").
--
-- Caso "Paulo" (final 3718): o lead foi pro EDER pela roleta em 20/10 16:26, mas a fila do Eder estava travando e o
-- disparo ficou 'pending' até 21/10 11:52. Nesse meio tempo o cliente escreveu no WhatsApp do DANIEL (16:29), a IA dele
-- atendeu, o Daniel transferiu pelo 📤 pro IGOR (16:33, contato_transferencias), o Igor conversou e mandou orçamento
-- (17:00, 2026-3163). Quase 20 h depois a fila do Eder soltou o "Olá, aqui é o Eder…" pra um cliente que o Igor já
-- atendia → dois vendedores no mesmo cliente, Eder achou que "a Ana fez arte".
--
-- Ninguém conferia isso: o guarda trg_outbound_ana_owner_guard só olha repasse da ANA contra disparo ENVIADO, e a
-- dispatch-poll só confere se o PRÓPRIO vendedor já conhece o cliente. Agora, no momento em que a fila pega o disparo
-- (pending → sending), se DEPOIS que ele foi criado o cliente foi transferido pra outro vendedor, ganhou orçamento de
-- outro vendedor, recebeu disparo enviado de outro vendedor ou outro vendedor conversou com ele, o disparo vira 'skipped'
-- com o motivo — e a dispatch-poll, que só envia se o claim voltar 'sending', segue pra o próximo da fila.
-- ANA e DANIEL não contam como "outro vendedor" (a IA da Ana e a do Daniel conversam antes de passar; o Daniel passa
-- por transferência, e transferência conta). Disparo pego em até 2 min da criação não é conferido (não deu tempo).
-- Backtest 30 dias (1.354 enviados, 491 com mais de 2 min de espera): pegaria só o caso do Paulo.
-- Desfazer: drop trigger trg_outbound_ja_atendido_guard on public.outbound_dispatch;

set local lock_timeout = '3s';

create or replace function private.dispatch_ja_atendido_por_outro(
  p_id uuid, p_vendedor text, p_fone text, p_desde timestamptz, p_ate timestamptz default now()
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with alvo as (
    select public.fn_norm_fone_br(p_fone) fone, split_part(upper(coalesce(p_vendedor, '')), ' ', 1) eu
  ),
  provas as (
    select t.created_at em, upper(t.para_vendedor) quem, 'transferência' como
      from public.contato_transferencias t, alvo
     where public.fn_norm_fone_br(t.telefone) = alvo.fone
       and t.created_at > p_desde and t.created_at < p_ate
       and t.para_vendedor is not null
       and split_part(upper(t.para_vendedor), ' ', 1) not in (alvo.eu, 'ANA', 'DANIEL')
    union all
    select g.created_at, upper(g.vendedor_nome), 'orçamento'
      from public.orcamentos_gerados g, alvo
     where public.fn_norm_fone_br(g.cliente_dados->>'fone') = alvo.fone
       and g.created_at > p_desde and g.created_at < p_ate
       and coalesce(g.status, '') <> 'rascunho'
       and split_part(upper(coalesce(g.vendedor_nome, '')), ' ', 1) not in ('', alvo.eu, 'ANA', 'DANIEL')
    union all
    select x.sent_at, upper(x.vendedor_nome), 'disparo'
      from public.outbound_dispatch x, alvo
     where public.fn_norm_fone_br(x.cliente_telefone_norm) = alvo.fone
       and x.id is distinct from p_id and x.status = 'sent'
       and x.sent_at > p_desde and x.sent_at < p_ate
       and split_part(upper(coalesce(x.vendedor_nome, '')), ' ', 1) not in ('', alvo.eu, 'ANA', 'DANIEL')
       and coalesce(x.raw_payload->>'_teste', '') <> 'true'
    union all
    select m.data_msg, upper(m.vendedor_nome), 'conversa'
      from public.wa_chat_messages m, alvo
     where public.fn_norm_fone_br(m.phone) = alvo.fone and m.from_me
       and m.data_msg > p_desde and m.data_msg < p_ate
       and split_part(upper(coalesce(m.vendedor_nome, '')), ' ', 1) not in ('', alvo.eu, 'ANA', 'DANIEL')
       and m.tipo in ('chat','ptt','audio','image','video','document','sticker','location','vcard')
  )
  select jsonb_build_object('vendedor', quem, 'como', como, 'em', em)
    from provas, alvo
   where alvo.fone is not null and length(alvo.fone) >= 12
   order by em
   limit 1
$$;

revoke all on function private.dispatch_ja_atendido_por_outro(uuid, text, text, timestamptz, timestamptz) from public, anon, authenticated;

create or replace function private.dispatch_guard_ja_atendido()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  prova jsonb;
begin
  -- só no momento em que a fila PEGA o disparo; outro gatilho que já tenha mudado o status ganha
  if old.status is distinct from 'pending' or new.status is distinct from 'sending' then return new; end if;
  if coalesce(new.raw_payload->>'_teste', '') = 'true' then return new; end if;
  if old.created_at > now() - interval '2 minutes' then return new; end if;

  prova := private.dispatch_ja_atendido_por_outro(new.id, new.vendedor_nome, coalesce(new.cliente_telefone_norm, new.cliente_telefone), old.created_at, now());
  if prova is not null then
    new.status := 'skipped';
    new.erro := 'ja_atendido_por_outro: ' || (prova->>'vendedor') || ' (' || (prova->>'como') || ' em '
      || to_char((prova->>'em')::timestamptz at time zone 'America/Sao_Paulo', 'DD/MM HH24:MI')
      || ') depois que este disparo foi criado; não sai atrasado';
    new.raw_payload := coalesce(new.raw_payload, '{}'::jsonb)
      || jsonb_build_object('_ja_atendido_por_outro', prova || jsonb_build_object('barrado_em', now()));
  end if;
  return new;
end
$$;

revoke all on function private.dispatch_guard_ja_atendido() from public, anon, authenticated;

drop trigger if exists trg_outbound_ja_atendido_guard on public.outbound_dispatch;
create trigger trg_outbound_ja_atendido_guard
  before update of status on public.outbound_dispatch
  for each row
  when (old.status = 'pending' and new.status = 'sending')
  execute function private.dispatch_guard_ja_atendido();
