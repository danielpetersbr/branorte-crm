-- CREDITO DE VEZ — clique que morreu devolve a vez pro vendedor.
--
-- O PROBLEMA (relatado pelo Daniel, 11/08/2026): cliente clica no link, cai no
-- vendedor X e NAO manda mensagem. O rodizio anda mesmo assim, entao o proximo
-- cliente vai pro Y — e o X perdeu a vez sem ter recebido ninguem.
--
-- POR QUE NAO E SO "segurar a fila ate converter": entre o clique e a mensagem
-- passam minutos. Se a posicao ficasse travada, TODOS os cliques da janela
-- cairiam no mesmo vendedor — uma rajada de 20 viraria 20 pro X. Fica pior.
--
-- A SOLUCAO: a fila anda normal, e a vez e DEVOLVIDA depois.
--   1. clique -> vendedor X, ponteiro anda (ninguem espera)
--   2. passaram JANELA_MIN e o cliente nao escreveu -> o clique morreu, X ganha
--      um credito
--   3. o proximo clique vai pro dono do credito mais antigo, SEM mover o
--      ponteiro — so depois a fila volta ao normal
--
-- Assim a vez so e gasta de verdade quando chegou cliente de verdade.
--
-- A JANELA saiu do dado, nao do chute. Nos 46 casamentos de 30 dias:
-- mediana 1,7 min, 61% em ate 5 min, 70% em ate 30 min. Quem vai escrever,
-- escreve quase na hora. 15 min da folga larga sem ressuscitar clique velho.

alter table public.link_rota_click
  add column if not exists credito_em timestamptz;

comment on column public.link_rota_click.credito_em is
  'Quando a vez deste clique foi DEVOLVIDA ao vendedor (o cliente nunca escreveu). '
  'Null = ainda nao devolvida (ou o clique virou conversa, e ai nao ha o que devolver).';

-- Busca do credito: clique morto mais antigo. Parcial, porque a esmagadora
-- maioria das linhas ja tem credito_em ou matched_at preenchido.
create index if not exists idx_link_rota_click_credito_pendente
  on public.link_rota_click (created_at)
  where matched_at is null and credito_em is null and vendedor_nome is not null;

create or replace function public.funil_pick_vendedor_inbound()
 returns table(vendedor text, telefone text)
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_names  text[];
  v_phones text[];
  v_names_cota  text[];
  v_phones_cota text[];
  v_n int;
  v_i bigint;
  v_pos int;
  v_credito text;
  -- Tempo sem mensagem apos o qual o clique e considerado morto.
  JANELA_MIN    constant int := 15;
  -- Nao ressuscita clique de ontem: credito velho demais nao representa mais
  -- uma vez perdida, representa historico.
  VALIDADE_H    constant int := 24;
  -- Idade maxima do sync de mensagens do vendedor pra ele PODER ganhar credito.
  SYNC_MAX_MIN  constant int := 60;
begin
  -- Elegivel pra ENTRADA:
  --   ligado normal = online + fatia > 0
  --   OU so_recebe  = entra sem olhar fatia
  select array_agg(x.name order by x.name), array_agg(x.telefone order by x.name)
    into v_names, v_phones
  from (
    select v.name, v.telefone
    from public.vendors v
    join public.vendor_dispatch_status s on upper(s.vendedor_nome) = upper(v.name)
    where v.ativo and v.telefone is not null
      and not s.bloqueado
      and coalesce(s.funil_ativa, false)
      and (
        (s.online and coalesce(s.share_percent, 0) > 0)
        or coalesce(s.so_recebe, false)
      )
  ) x;

  -- COTA DE PARADOS
  if v_names is not null then
    select array_agg(x.name order by x.name), array_agg(x.telefone order by x.name)
      into v_names_cota, v_phones_cota
    from (
      select v.name, v.telefone
      from public.vendors v
      join public.vendor_dispatch_status s on upper(s.vendedor_nome) = upper(v.name)
      where v.ativo and v.telefone is not null
        and not s.bloqueado
        and coalesce(s.funil_ativa, false)
        and (
          (s.online and coalesce(s.share_percent, 0) > 0)
          or coalesce(s.so_recebe, false)
        )
        and public.cota_fator(v.name) > 0
    ) x;
    if v_names_cota is not null then
      v_names  := v_names_cota;
      v_phones := v_phones_cota;
    end if;
  end if;

  -- Fallback: qualquer vendedor ativo com telefone.
  if v_names is null then
    select array_agg(v.name order by v.name), array_agg(v.telefone order by v.name)
      into v_names, v_phones
    from public.vendors v where v.ativo and v.telefone is not null;
  end if;

  if v_names is null then
    return;
  end if;

  -- ==========================================================================
  -- CREDITO DE VEZ — antes de girar o rodizio, devolve a vez de quem tomou um
  -- clique que morreu.
  --
  -- UPDATE ... where id = (select ... for update skip locked) num passo so:
  -- dois cliques simultaneos nao podem resgatar o MESMO credito. Sem isso, uma
  -- rajada daria o mesmo credito pra varios cliques e o vendedor levaria todos.
  -- ==========================================================================
  update public.link_rota_click c
     set credito_em = now()
   where c.id = (
     select cl.id
       from public.link_rota_click cl
      where cl.matched_at is null              -- o cliente nunca escreveu
        and cl.credito_em is null              -- a vez ainda nao foi devolvida
        and cl.vendedor_nome is not null       -- clique que caiu no fallback nao
                                               -- pertence a vendedor nenhum
        and cl.created_at < now() - make_interval(mins => JANELA_MIN)
        and cl.created_at > now() - make_interval(hours => VALIDADE_H)
        -- so vendedor que esta elegivel AGORA (desligou no meio? perde o credito)
        and exists (select 1 from unnest(v_names) n where upper(n) = upper(cl.vendedor_nome))
        -- TRAVA DO RALO: se a extensao do vendedor nao esta sincronizando
        -- mensagem, nenhuma conversa dele e registrada — ele pareceria nunca
        -- converter e ganharia credito INFINITO, puxando todo clique pra uma
        -- caixa que ninguem le. Foi exatamente o estado de ALVARO e GUSTAVO em
        -- 11/08/2026 (extensao pingando, zero mensagem lida por ~17h).
        -- Sem sync recente => sem credito => cai no rodizio normal. O lado
        -- seguro do erro.
        and exists (
          select 1 from public.wa_chat_messages m
           where upper(m.vendedor_nome) = upper(cl.vendedor_nome)
             and m.synced_at > now() - make_interval(mins => SYNC_MAX_MIN)
        )
      order by cl.created_at
      limit 1
      for update skip locked
   )
  returning c.vendedor_nome into v_credito;

  if v_credito is not null then
    -- Devolve a vez SEM mover o ponteiro: o rodizio continua de onde parou
    -- assim que os creditos acabarem.
    select v.name, v.telefone into vendedor, telefone
      from public.vendors v
     where upper(v.name) = upper(v_credito) and v.ativo and v.telefone is not null
     limit 1;
    if telefone is not null then
      return next;
      return;
    end if;
    -- Sumiu do cadastro entre uma coisa e outra: ignora o credito e segue.
  end if;

  -- Rodizio normal, por posicao.
  v_n := array_length(v_names, 1);
  update public.funil_rr set idx = idx + 1 where id = 2 returning idx into v_i;
  v_pos := ((v_i - 1) % v_n) + 1;
  vendedor := v_names[v_pos];
  telefone := v_phones[v_pos];
  return next;
end;
$function$;

comment on function public.funil_pick_vendedor_inbound() is
  'Rodizio de ENTRADA (cliente chama): link /l/ e quiz/pick-vendedor. '
  'Inclui quem esta com so_recebe=true mesmo offline. '
  'Devolve a vez (credito) de clique que nao virou conversa em 15 min. '
  'NAO usar em caminho que insere em outbound_dispatch — pra isso e a funil_pick_vendedor().';

revoke all on function public.funil_pick_vendedor_inbound() from public;
grant execute on function public.funil_pick_vendedor_inbound() to service_role, authenticated;
