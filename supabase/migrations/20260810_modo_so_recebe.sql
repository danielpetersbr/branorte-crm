-- MODO "SO RECEBE" — o vendedor volta pro rodizio de ENTRADA sem que o WhatsApp
-- dele mande a primeira mensagem pra numero novo.
--
-- O PROBLEMA: GUSTAVO, LUCAS e ALVARO foram restringidos pelo WhatsApp e nao
-- conseguem mais ABRIR conversa com numero novo. Pra parar o disparo deles o
-- admin desligou os tres no /disparos (`online = false`). So que `online` e um
-- interruptor so pra duas coisas que nao sao a mesma:
--
--   SAIDA  — o WhatsApp DO VENDEDOR manda a 1a mensagem
--            (outbound_dispatch, prospeccao da extensao, fb/form-dispatch, Ana)
--   ENTRADA— o CLIENTE clica e chama o vendedor
--            (link /l/<slug>, botao FALAR COM CONSULTOR do quiz)
--
-- Desligar matou as duas. Este arquivo separa a segunda.
--
-- POR QUE COLUNA NOVA E NAO REAPROVEITAR `online`: `online` e lido por
-- ext-version (prospeccao automatica), leads/fb-dispatch, leads/form-dispatch,
-- leads/dispatch (vendedorLigadoNoPainel) e pelo trigger outbound_rotear —
-- TODOS caminhos em que quem envia e o vendedor. Religar `online` pra devolver
-- o cara ao link religaria junto a prospeccao dele. Seria o tiro no pe.

alter table public.vendor_dispatch_status
  add column if not exists so_recebe boolean not null default false;

comment on column public.vendor_dispatch_status.so_recebe is
  'Entra no rodizio de ENTRADA (link /l/, quiz) mesmo com online=false. '
  'Pro vendedor restringido no WhatsApp: RECEBE cliente que chama, nunca chama. '
  'Nao afeta disparo, prospeccao nem roteamento de lead frio — esses seguem em `online`.';

-- Contador proprio pro rodizio de entrada. Compartilhar o id=1 com a fila de
-- SAIDA daria enviesamento: os dois conjuntos tem tamanhos diferentes, entao um
-- unico contador girando sobre arrays de tamanhos distintos nao visita as duas
-- listas de forma pareja.
-- NOT EXISTS em vez de ON CONFLICT: `on conflict (id)` exige indice unico em
-- `id`, e essa tabela e de uma linha so — nao vale apostar no constraint.
insert into public.funil_rr (id, idx)
select 2, 0 where not exists (select 1 from public.funil_rr where id = 2);

-- ============================================================================
-- funil_pick_vendedor_inbound() — a fila de quem RECEBE cliente que chama.
--
-- Copia da funil_pick_vendedor() com UMA diferenca no criterio de elegibilidade.
-- As duas seguem existindo de proposito: a original continua servindo
-- quiz/handoff e leads/alp-dispatch, que INSEREM em outbound_dispatch (ou seja,
-- fazem o vendedor disparar). Se eu tivesse afrouxado a original, esses dois
-- passariam a sortear justamente quem nao pode abrir conversa.
-- ============================================================================
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
begin
  -- Elegivel pra ENTRADA:
  --   ligado normal = online + fatia > 0   (identico a funil_pick_vendedor)
  --   OU so_recebe  = entra sem olhar fatia
  --
  -- A fatia fica FORA do ramo `so_recebe` de proposito. Este rodizio e por
  -- POSICAO (funil_rr), nunca ponderado — a fatia so funciona como liga/desliga
  -- aqui. E o card de fatias do /disparos lista somente quem esta `online`,
  -- entao o numero de um vendedor "so recebe" ficaria invisivel pro admin: ele
  -- viraria um desligador escondido, capaz de tirar o cara do rodizio sem que
  -- ninguem consiga ver nem corrigir pela tela.
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

  -- COTA DE PARADOS: vale igual pra quem so recebe. Empurrar cliente novo pra
  -- quem ja tem pilha parada no topo do funil e ruim independente de quem tenha
  -- apertado o "enviar". cota_fator() devolve 1 quando a cota esta desligada.
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

    -- So aplica se sobrou alguem. Cota que zera todo mundo derrubaria o funil.
    if v_names_cota is not null then
      v_names  := v_names_cota;
      v_phones := v_phones_cota;
    end if;
  end if;

  -- Fallback: qualquer vendedor ativo com telefone. Cliente que clicou no link
  -- ja esta com o WhatsApp aberto — nao pode cair em lugar nenhum.
  if v_names is null then
    select array_agg(v.name order by v.name), array_agg(v.telefone order by v.name)
      into v_names, v_phones
    from public.vendors v where v.ativo and v.telefone is not null;
  end if;

  if v_names is null then
    return;
  end if;

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
  'NAO usar em caminho que insere em outbound_dispatch — pra isso e a funil_pick_vendedor().';

-- Mesmos grants da funil_pick_vendedor(): anon fica de fora.
revoke all on function public.funil_pick_vendedor_inbound() from public;
grant execute on function public.funil_pick_vendedor_inbound() to service_role, authenticated;
