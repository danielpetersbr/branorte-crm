-- AGENDA DE CLIENTES DO ORCAMENTO — 26/08/2026
--
-- Problema: a tabela orcamento_clientes existia, mas so era alimentada quando o
-- orcamento era FINALIZADO, e com INSERT cego. Resultado medido antes da mexida:
-- 1.469 linhas pra 795 clientes de verdade (o mesmo "Antonio", mesmo telefone,
-- gravado 2x com 8 minutos de diferenca) e nenhuma das copias completa.
--
-- Aqui: chaves canonicas de identidade, dedup do historico e um upsert que
-- RECONHECE quem ja existe. Depois: 819 linhas, zero orcamento orfao.

-- ---------------------------------------------------------------- 1. colunas
create table if not exists public.orcamento_clientes_backup_2026_08_26 as
  select * from public.orcamento_clientes;

alter table public.orcamento_clientes
  add column if not exists uf text,
  add column if not exists ie_tipo text,
  -- doc_canon: so os digitos do CPF/CNPJ. Chave FORTE de identidade.
  add column if not exists doc_canon text,
  -- fone_canon: mesma convencao do resto do CRM (public.fone_canon), pra a
  -- agenda reconhecer o cliente pelo mesmo telefone que casa o lead do WhatsApp.
  add column if not exists fone_canon text;

create or replace function public.trg_orcamento_cliente_canon()
returns trigger language plpgsql as $$
begin
  new.doc_canon := nullif(regexp_replace(coalesce(new.cnpj,''), '\D', '', 'g'), '');
  new.fone_canon := public.fone_canon(new.fone);
  -- Cidade pode chegar como "Campos Novos - SC" (formato que o orcamento grava).
  -- Guarda a UF separada e deixa cidade limpa, senao a agenda devolve a string
  -- inteira pro campo Cidade e o campo UF fica vazio na tela.
  if new.uf is null and new.cidade ~ '^(.+) - ([A-Za-z]{2})$' then
    new.uf     := upper((regexp_match(new.cidade, '^(.+) - ([A-Za-z]{2})$'))[2]);
    new.cidade := btrim((regexp_match(new.cidade, '^(.+) - ([A-Za-z]{2})$'))[1]);
  end if;
  -- So carimba a data quando o chamador NAO mandou uma explicita. Sem esta
  -- guarda o trigger atropela qualquer restauracao/merge de updated_at.
  if TG_OP = 'INSERT' then
    new.updated_at := coalesce(new.updated_at, now());
  elsif new.updated_at is not distinct from old.updated_at then
    new.updated_at := now();
  end if;
  return new;
end $$;

drop trigger if exists trg_orcamento_cliente_canon on public.orcamento_clientes;
create trigger trg_orcamento_cliente_canon
  before insert or update on public.orcamento_clientes
  for each row execute function public.trg_orcamento_cliente_canon();

update public.orcamento_clientes set nome = nome;  -- backfill (dispara o trigger)

create index if not exists idx_orc_clientes_doc_canon  on public.orcamento_clientes (doc_canon)  where doc_canon is not null;
create index if not exists idx_orc_clientes_fone_canon on public.orcamento_clientes (fone_canon) where fone_canon is not null;
create index if not exists idx_orc_clientes_nome_lower on public.orcamento_clientes (lower(btrim(nome)));

-- Dois clientes nao dividem o mesmo documento. O indice UNICO impede a agenda
-- de voltar a duplicar mesmo com dois vendedores salvando no mesmo segundo.
create unique index if not exists uq_orc_clientes_doc_canon
  on public.orcamento_clientes (doc_canon) where doc_canon is not null;

-- NOTA: a deduplicacao do historico (1.469 -> 819) foi rodada como script de
-- dados em 26/08/2026, agrupando por doc_canon / (nome+fone_canon) / nome,
-- mantendo o menor id, mesclando o valor mais recente nao-nulo de cada campo e
-- repontando orcamentos_gerados.cliente_id antes do delete. Backup integral em
-- public.orcamento_clientes_backup_2026_08_26.

-- ------------------------------------------------------------------ 2. upsert
-- Ordem de identidade (da mais forte pra mais fraca):
--   1. CPF/CNPJ (doc_canon)
--   2. telefone canonico + mesmo nome — so o telefone nao basta: fone_canon
--      funde fixo com celular do mesmo DDD
--   3. mesmo nome, quando nao ha documento NEM telefone dos dois lados
-- NUNCA apaga campo ja preenchido: quem tem endereco e recebe orcamento novo
-- sem endereco mantem o endereco.
create or replace function public.fn_upsert_cliente_orcamento(p jsonb)
returns bigint
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_nome   text := nullif(btrim(coalesce(p->>'nome','')), '');
  v_cidade text := nullif(btrim(coalesce(p->>'cidade','')), '');
  v_uf     text := nullif(btrim(upper(coalesce(p->>'uf',''))), '');
  v_doc    text := nullif(regexp_replace(coalesce(p->>'cnpj',''), '\D', '', 'g'), '');
  v_fc     text := public.fone_canon(p->>'fone');
  v_id     bigint;
begin
  if v_nome is null then return null; end if;

  if v_uf is null and v_cidade ~ '^(.+) - ([A-Za-z]{2})$' then
    v_uf     := upper((regexp_match(v_cidade, '^(.+) - ([A-Za-z]{2})$'))[2]);
    v_cidade := btrim((regexp_match(v_cidade, '^(.+) - ([A-Za-z]{2})$'))[1]);
  end if;

  if v_doc is not null then
    select id into v_id from public.orcamento_clientes
     where doc_canon = v_doc order by id limit 1;
  end if;

  if v_id is null and v_fc is not null then
    select id into v_id from public.orcamento_clientes
     where fone_canon = v_fc and lower(btrim(nome)) = lower(v_nome)
     order by id limit 1;
  end if;

  if v_id is null and v_doc is null and v_fc is null then
    select id into v_id from public.orcamento_clientes
     where lower(btrim(nome)) = lower(v_nome)
       and doc_canon is null and fone_canon is null
     order by id limit 1;
  end if;

  if v_id is null then
    insert into public.orcamento_clientes
      (nome, ac, fone, cidade, uf, bairro, endereco, cep, cnpj, ie, ie_tipo, email, created_by)
    values (
      v_nome,
      nullif(btrim(coalesce(p->>'ac','')), ''),
      nullif(btrim(coalesce(p->>'fone','')), ''),
      v_cidade, v_uf,
      nullif(btrim(coalesce(p->>'bairro','')), ''),
      nullif(btrim(coalesce(p->>'endereco','')), ''),
      nullif(btrim(coalesce(p->>'cep','')), ''),
      nullif(btrim(coalesce(p->>'cnpj','')), ''),
      nullif(btrim(coalesce(p->>'ie','')), ''),
      nullif(btrim(coalesce(p->>'ie_tipo','')), ''),
      nullif(btrim(lower(coalesce(p->>'email',''))), ''),
      auth.uid()
    )
    returning id into v_id;
  else
    update public.orcamento_clientes set
      nome     = v_nome,
      ac       = coalesce(nullif(btrim(coalesce(p->>'ac','')), ''), ac),
      fone     = coalesce(nullif(btrim(coalesce(p->>'fone','')), ''), fone),
      cidade   = coalesce(v_cidade, cidade),
      uf       = coalesce(v_uf, uf),
      bairro   = coalesce(nullif(btrim(coalesce(p->>'bairro','')), ''), bairro),
      endereco = coalesce(nullif(btrim(coalesce(p->>'endereco','')), ''), endereco),
      cep      = coalesce(nullif(btrim(coalesce(p->>'cep','')), ''), cep),
      cnpj     = coalesce(nullif(btrim(coalesce(p->>'cnpj','')), ''), cnpj),
      ie       = coalesce(nullif(btrim(coalesce(p->>'ie','')), ''), ie),
      ie_tipo  = coalesce(nullif(btrim(coalesce(p->>'ie_tipo','')), ''), ie_tipo),
      email    = coalesce(nullif(btrim(lower(coalesce(p->>'email',''))), ''), email)
    where id = v_id;
  end if;

  return v_id;
end $$;

revoke all on function public.fn_upsert_cliente_orcamento(jsonb) from public, anon;
grant execute on function public.fn_upsert_cliente_orcamento(jsonb) to authenticated;
