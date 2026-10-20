-- Gasto do Meta por anúncio e por dia (20/10/2026) — a peça que faltava para a aba Marketing
-- dizer custo por orçamento. Vem do Gerenciador de Anúncios da conta act_315635643399004,
-- puxado pelo Chrome que tem acesso (C:\temp\meta-gasto-branorte.mjs) e gravado por
-- C:\temp\meta_gasto_carga.py. Sem RLS aberta: a tela lê só agregado, pela RPC.
set lock_timeout = '5s';
create table if not exists public.meta_gasto_anuncio_dia (
  data date not null,
  ad_id text not null,
  anuncio text,
  conjunto text,
  campanha text,
  objetivo text,
  codigo text generated always as (substring(anuncio from '&[0-9]+')) stored,
  gasto numeric(12,2) not null default 0,
  impressoes integer not null default 0,
  cliques integer not null default 0,
  conversas integer not null default 0,
  leads_form integer not null default 0,
  atualizado_em timestamptz not null default now(),
  primary key (data, ad_id)
);
create index if not exists meta_gasto_anuncio_dia_codigo_idx on public.meta_gasto_anuncio_dia (codigo, data);
alter table public.meta_gasto_anuncio_dia enable row level security;
revoke all on public.meta_gasto_anuncio_dia from anon, authenticated;
