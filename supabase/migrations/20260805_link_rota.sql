-- LINK DE ROTEAMENTO
-- Um link curto (branorte-crm.vercel.app/l/<slug>) que pode ser colado em site,
-- formulario, bio, anuncio. No clique: sorteia o proximo vendedor pela MESMA
-- fila do quiz/ALP (public.funil_pick_vendedor) e joga o cliente no WhatsApp
-- DELE com um texto pronto e configuravel.
--
-- RASTREIO: cada clique ganha um codigo de 30 bits. O codigo vai escondido no
-- fim do texto em caracteres invisiveis (U+2061..U+2064 delimitados por U+2060).
-- Quando o cliente manda a mensagem, a extensao grava em wa_chat_messages e o
-- gatilho abaixo casa a conversa com o clique que a originou.
--
-- Por que U+2061..U+2064 (invisible times/plus/separator/function application) e
-- NAO o ZWSP/ZWJ: ZWJ e ZWNJ fazem parte de sequencias de emoji e podem colar
-- num emoji vizinho e mudar o desenho. Os "invisible math operators" nao entram
-- em nenhuma sequencia de grapheme, entao sao inertes no meio do texto.

-- ---------------------------------------------------------------------------
-- 1. TABELAS
-- ---------------------------------------------------------------------------

create table if not exists public.link_rota (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  nome              text not null,
  -- Texto que ja aparece escrito no WhatsApp do cliente. Aceita {vendedor}
  -- (primeiro nome de quem recebeu o lead).
  mensagem          text not null,
  -- Vira o "origem" do atendimento / rotulo do relatorio.
  origem            text not null default 'Link',
  ativo             boolean not null default true,
  -- Pra onde manda quando NINGUEM esta ligado no painel. Null = central.
  fallback_telefone text,
  criado_em         timestamptz not null default now(),
  atualizado_em     timestamptz not null default now(),
  constraint link_rota_slug_ck check (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$')
);

comment on table public.link_rota is
  'Links de roteamento: /l/<slug> sorteia vendedor e abre o WhatsApp dele com texto pronto.';

create table if not exists public.link_rota_click (
  id                bigserial primary key,
  link_id           uuid not null references public.link_rota(id) on delete cascade,
  -- codigo_num = os 30 bits que viajam invisiveis no texto.
  -- codigo       = a mesma coisa em base32 legivel, so pra humano conferir.
  codigo_num        bigint not null,
  codigo            text   not null,
  vendedor_nome     text,
  vendedor_telefone text,
  -- true = ninguem elegivel, caiu no telefone de fallback.
  fallback          boolean not null default false,
  ip                text,
  user_agent        text,
  referer           text,
  utm_source        text,
  utm_medium        text,
  utm_campaign      text,
  utm_content       text,
  utm_term          text,
  created_at        timestamptz not null default now(),
  -- conciliacao (preenchida pelo gatilho quando o cliente manda a 1a msg)
  matched_at          timestamptz,
  match_via           text,  -- 'codigo' (certeza) | 'janela' (aproximado)
  cliente_telefone    text,
  msg_id              bigint,
  vendedor_confirmado text,
  constraint link_rota_click_via_ck check (match_via is null or match_via in ('codigo','janela'))
);

comment on table public.link_rota_click is
  'Um registro por clique no link. matched_at preenchido = o clique virou conversa.';

create unique index if not exists link_rota_click_codigo_num_key
  on public.link_rota_click (codigo_num);

create index if not exists link_rota_click_link_idx
  on public.link_rota_click (link_id, created_at desc);

-- Indice do PLANO B: so os cliques que ainda nao viraram conversa.
-- Fica minusculo (orfaos expiram em 60 min de uso pratico).
create index if not exists link_rota_click_orfao_idx
  on public.link_rota_click (upper(vendedor_nome), created_at desc)
  where matched_at is null;

-- ---------------------------------------------------------------------------
-- 2. DECODIFICADOR DO CODIGO INVISIVEL
-- ---------------------------------------------------------------------------
-- Payload = U+2060 + 15 digitos base-4 (U+2061..U+2064) + U+2060.
-- 15 digitos base-4 = 30 bits = exatamente o range de codigo_num.

create or replace function public.link_rota_decode(p_body text)
returns bigint
language plpgsql
immutable
as $$
declare
  v_start  int;
  v_raw    text;
  v_dig    text;
  v_num    bigint := 0;
  i        int;
begin
  if p_body is null then return null; end if;

  v_start := position(chr(8288) in p_body);          -- U+2060 (word joiner)
  if v_start = 0 then return null; end if;

  v_raw := substring(p_body from v_start + 1 for 15);
  if length(v_raw) <> 15 then return null; end if;

  v_dig := translate(
    v_raw,
    chr(8289) || chr(8290) || chr(8291) || chr(8292),  -- U+2061..U+2064
    '0123'
  );
  if v_dig !~ '^[0-3]{15}$' then return null; end if;  -- veio lixo, ignora

  for i in 1..15 loop
    v_num := v_num * 4 + substring(v_dig from i for 1)::int;
  end loop;
  return v_num;
end;
$$;

comment on function public.link_rota_decode(text) is
  'Le o codigo invisivel embutido no texto que o cliente mandou. NULL se nao tiver.';

-- ---------------------------------------------------------------------------
-- 3. CONCILIACAO — gatilho na mensagem RECEBIDA
-- ---------------------------------------------------------------------------
-- Roda so em from_me = false. A PRIMEIRA coisa e um position() de um caractere:
-- se nao tem o marcador, sai sem consultar tabela nenhuma. Custo ~zero.
--
-- Tudo dentro de um bloco com EXCEPTION: conciliacao NUNCA pode derrubar o sync
-- da extensao. Se der qualquer erro aqui, a mensagem entra do mesmo jeito.

create or replace function public.link_rota_casar_msg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_num      bigint;
  v_click_id bigint;
begin
  begin
    -- (1) CAMINHO DO CODIGO — certeza absoluta de qual clique foi.
    if new.body is not null and position(chr(8288) in new.body) > 0 then
      v_num := public.link_rota_decode(new.body);
      if v_num is not null then
        update public.link_rota_click
           set matched_at          = now(),
               match_via           = 'codigo',
               cliente_telefone    = new.phone,
               msg_id              = new.id,
               vendedor_confirmado = new.vendedor_nome
         where codigo_num = v_num
           and matched_at is null;
        if found then return null; end if;
      end if;
    end if;

    -- (2) PLANO B — o WhatsApp comeu os invisiveis.
    -- Barato de proposito: primeiro pergunta se existe clique orfao daquele
    -- vendedor na ultima hora (tabela minuscula, indice parcial). Se nao tem,
    -- acabou aqui. So depois e que olha o historico do contato.
    select c.id into v_click_id
      from public.link_rota_click c
     where c.matched_at is null
       and c.vendedor_nome is not null
       and upper(c.vendedor_nome) = upper(new.vendedor_nome)
       and c.created_at > now() - interval '60 minutes'
     order by c.created_at desc
     limit 1;
    if v_click_id is null then return null; end if;

    -- So casa se for a PRIMEIRA mensagem daquele contato com aquele vendedor.
    -- Contato que ja conversava antes nao nasceu do link. Usa o indice
    -- wa_chat_messages_chat_idx (vendedor_nome, chat_id, data_msg).
    if exists (
      select 1 from public.wa_chat_messages m
       where m.vendedor_nome = new.vendedor_nome
         and m.chat_id       = new.chat_id
         and m.id            < new.id
    ) then
      return null;
    end if;

    update public.link_rota_click
       set matched_at          = now(),
           match_via           = 'janela',
           cliente_telefone    = new.phone,
           msg_id              = new.id,
           vendedor_confirmado = new.vendedor_nome
     where id = v_click_id;

  exception when others then
    return null;  -- silencio: o sync da extensao vem primeiro
  end;

  return null;
end;
$$;

drop trigger if exists trg_link_rota_casar_msg on public.wa_chat_messages;
create trigger trg_link_rota_casar_msg
  after insert on public.wa_chat_messages
  for each row
  when (new.from_me = false)
  execute function public.link_rota_casar_msg();

-- ---------------------------------------------------------------------------
-- 4. RLS — espelha vendor_dispatch_status
-- ---------------------------------------------------------------------------
-- Ler: qualquer usuario aprovado que nao seja papel restrito.
-- Escrever: admin ou quem tem menu.disparos (mesma regra do painel de Roteamento).
-- Os INSERTs de clique vem do endpoint com service role (ignora RLS).

alter table public.link_rota       enable row level security;
alter table public.link_rota_click enable row level security;

drop policy if exists link_rota_select on public.link_rota;
create policy link_rota_select on public.link_rota
  for select to authenticated
  using (not papel_restrito());

drop policy if exists link_rota_write on public.link_rota;
create policy link_rota_write on public.link_rota
  for all to authenticated
  using (
    exists (
      select 1 from user_profiles up
        left join role_permissions rp on rp.role = up.role
       where up.id = auth.uid()
         and up.approved_at is not null
         and (up.role = 'admin' or coalesce((rp.permissions ->> 'menu.disparos')::boolean, false))
    )
  )
  with check (
    exists (
      select 1 from user_profiles up
        left join role_permissions rp on rp.role = up.role
       where up.id = auth.uid()
         and up.approved_at is not null
         and (up.role = 'admin' or coalesce((rp.permissions ->> 'menu.disparos')::boolean, false))
    )
  );

drop policy if exists link_rota_click_select on public.link_rota_click;
create policy link_rota_click_select on public.link_rota_click
  for select to authenticated
  using (not papel_restrito());

-- Nenhuma policy de escrita em link_rota_click de proposito: clique so nasce
-- pelo endpoint (service role). Cliente nao inventa clique.

-- ---------------------------------------------------------------------------
-- 5. VISAO PRO PAINEL
-- ---------------------------------------------------------------------------

-- security_invoker OBRIGATORIO: view sem isso roda como dona e fura a RLS das
-- tabelas de baixo (ja aconteceu neste banco).
create or replace view public.link_rota_resumo
with (security_invoker = true) as
select
  l.id,
  l.slug,
  l.nome,
  l.origem,
  l.ativo,
  count(c.id)                                        as cliques,
  count(c.id) filter (where c.matched_at is not null) as conversas,
  count(c.id) filter (where c.created_at > now() - interval '7 days') as cliques_7d,
  max(c.created_at)                                  as ultimo_clique
from public.link_rota l
left join public.link_rota_click c on c.link_id = l.id
group by l.id;

comment on view public.link_rota_resumo is
  'Cliques x conversas por link. conversas = cliques que viraram mensagem de verdade.';
