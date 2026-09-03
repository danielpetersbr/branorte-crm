-- Financeiro do vendedor — as marcas que a tela ainda não tinha.
-- Aplicada em 03/09/2026 no projeto crm-branorte (flwbeevtvjiouxdjmziv).
--
-- Contexto: a tela /controle/financeiro tem tudo pra cobrar, mas quase ninguém
-- alimenta — em 09/2026 eram 66 parcelas pagas de 1.416, e R$ 1,2 mi lançado
-- contra R$ 23,6 mi vendidos. Dois buracos explicavam boa parte disso:
--
--   1) 269 pedidos JÁ ENTREGUES sem um centavo lançado (R$ 7,1 mi). Boa parte
--      foi paga na vida real anos atrás, sem comprovante que alguém guardou.
--      Não havia caminho nenhum pra resolver isso — então ninguém resolvia, e o
--      "A Receber" do topo virava um número em que ninguém acreditava.
--      → fin_regularizacoes: o vendedor PROPÕE, o gestor CONFIRMA. Nunca vira
--        "quitado": fica com status próprio, separado do dinheiro conferido.
--
--   2) A produção marca quando o equipamento SAI da fábrica (producao_cards no
--      projeto controle-producao). Ninguém marcava quando o cliente RECEBEU.
--      → fin_entregas: marca do vendedor, que é quem sabe. Não briga com o
--        kanban da produção — complementa.
--
-- Acesso: mesmo padrão das outras fin_* — RLS ligado, nenhuma policy, nenhum
-- grant pra anon/authenticated. Só o service_role entra, pelas funções em
-- api/_lib/financeiro-core.ts (crmAdmin).

create table if not exists public.fin_regularizacoes (
  order_id            uuid primary key,
  status              text not null default 'PROPOSTA'
                        check (status in ('PROPOSTA', 'CONFIRMADA', 'RECUSADA')),
  motivo              text,
  valor_referencia    numeric,
  proposto_por        uuid,
  proposto_por_nome   text,
  proposto_em         timestamptz not null default now(),
  decidido_por        uuid,
  decidido_por_nome   text,
  decidido_em         timestamptz,
  motivo_recusa       text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.fin_regularizacoes is
  'Pedido antigo dado como pago sem comprovante. Vendedor propoe, gestor confirma. Nunca conta como dinheiro conferido.';

create index if not exists fin_regularizacoes_status_idx on public.fin_regularizacoes (status);

create table if not exists public.fin_entregas (
  order_id            uuid primary key,
  entregue_em         date not null,
  observacao          text,
  confirmado_por      uuid,
  confirmado_por_nome text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.fin_entregas is
  'Vendedor confirma que o CLIENTE recebeu o equipamento. Complementa (nao substitui) o status de expedicao da producao.';

alter table public.fin_regularizacoes enable row level security;
alter table public.fin_entregas       enable row level security;

revoke all on public.fin_regularizacoes from anon, authenticated;
revoke all on public.fin_entregas       from anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- NO OUTRO PROJETO (controle-producao, yyfosrvlpsaycjnxcnkj) — já aplicado.
-- Fica registrado aqui porque o CRM depende dela: é o que faz a coluna
-- "Fábrica" existir. Privilégio mínimo de propósito — só pedido_id, status e
-- data. Sem nome de cliente, sem valor. Por isso a anon key basta e não foi
-- preciso levar a service_role do app de produção pro Vercel do CRM.
--
--   create or replace view public.vw_producao_status
--   with (security_invoker = false) as
--   select pc.pedido_id, pc.status, pc.updated_at as atualizado_em
--   from public.producao_cards pc
--   where pc.excluido = false and pc.pedido_id is not null;
--
--   revoke all on public.vw_producao_status from anon, authenticated;
--   grant select on public.vw_producao_status to anon, authenticated;
--
-- ⚠️ NÃO trocar essa leitura por `mirror_producao_pedidos` (que existe aqui no
-- CRM e sincroniza todo dia): os 500 pedidos dela estão parados em "EM PROJETO"
-- — é o espelho de um kanban antigo que ninguém move. Conferido em 03/09/2026.
-- ───────────────────────────────────────────────────────────────────────────
