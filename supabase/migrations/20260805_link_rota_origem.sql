-- O clique do link agora CARIMBA A ORIGEM no atendimento.
--
-- Antes: o gatilho casava o clique com a conversa na tabela do link, mas o
-- atendimento em /atendimentos nao dizia de onde o lead veio. Quem olhasse a
-- tela nao tinha como saber que aquele contato nasceu da LP.
--
-- Politica (decidida pelo Daniel em 05/08/2026): SO CARIMBA SE ESTIVER VAZIA.
-- Contato que ja tem origem de verdade (Meta ADS, Facebook...) e preservado --
-- reescrever apagaria de onde ele veio da primeira vez. 'Nao identificou' conta
-- como vazio, que e justamente o caso que o link resolve.
--
-- NAO depende de ler "&CODIGO" do texto: o selo invisivel ja diz exatamente de
-- qual link o clique veio. O parser de & que existe hoje e guloso (ja gravou
-- '&79oi', '&88cade', '&utm_source') e nao serve de base pra nada.

create or replace function public.link_rota_casar_msg()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_num      bigint;
  v_click_id bigint;
  v_link_id  uuid;
  v_origem   text;
  v_atend_id uuid;
  v_origem_atual text;
  v_tinha_codigo boolean := false;
begin
  begin
    -- (1) CAMINHO DO CODIGO — certeza absoluta de qual clique foi.
    if new.body is not null and position(chr(8288) in new.body) > 0 then
      v_num := public.link_rota_decode(new.body);
      if v_num is not null then
        v_tinha_codigo := true;
        update public.link_rota_click
           set matched_at          = now(),
               match_via           = 'codigo',
               cliente_telefone    = new.phone,
               msg_id              = new.id,
               vendedor_confirmado = new.vendedor_nome
         where codigo_num = v_num
           and matched_at is null
        returning id, link_id into v_click_id, v_link_id;
      end if;
    end if;

    -- (2) PLANO B — o WhatsApp comeu os invisiveis.
    -- Barato de proposito: primeiro pergunta se existe clique orfao daquele
    -- vendedor na ultima hora (tabela minuscula, indice parcial). Se nao tem,
    -- acabou aqui. So depois e que olha o historico do contato.
    -- Mensagem que TINHA codigo valido nunca cai no plano B: se o clique dela ja
    -- estava casado (re-sync da mesma msg), chutar um clique orfao de outro
    -- cliente seria pior que nao atribuir nada.
    if v_click_id is null and not v_tinha_codigo then
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
       where id = v_click_id
      returning link_id into v_link_id;
    end if;

    if v_link_id is null then return null; end if;

    -- (3) CARIMBA A ORIGEM NO ATENDIMENTO -----------------------------------
    select nullif(btrim(origem), '') into v_origem
      from public.link_rota where id = v_link_id;
    if v_origem is null then return null; end if;

    -- Mesmo criterio de dedup do wa_set_lead_fields: telefone sem o 9, row mais
    -- recente. Nao inventar comparacao de telefone na mao.
    select a.id, nullif(btrim(a.origem), '')
      into v_atend_id, v_origem_atual
      from auditoria.auditoria_atendimentos a
     where auditoria.wa_phone_strip9(a.telefone_norm) = auditoria.wa_phone_strip9(new.phone)
     order by a.created_at desc
     limit 1;

    if v_atend_id is null then
      -- Atendimento ainda nao existe (a mensagem chegou antes de quem costuma
      -- cria-lo). Cria pela RPC canonica, que dedupa por telefone -- quem vier
      -- depois atualiza esta mesma linha em vez de duplicar.
      -- p_external_id explicito NAO e enfeite: wa_set_lead_fields tem 7
      -- sobrecargas e so esta tem external_id. Sem ele a chamada por nome fica
      -- ambigua entre a de 12 e a de 13 argumentos e o Postgres recusa.
      perform auditoria.wa_set_lead_fields(
        p_lead_phone  := new.phone,
        p_responsavel := new.vendedor_nome,
        p_origem      := v_origem,
        p_external_id := null
      );
    elsif v_origem_atual is null or v_origem_atual = 'Não identificou' then
      -- Vazia ou "nao identificou" = exatamente o buraco que o link preenche.
      update auditoria.auditoria_atendimentos
         set origem = v_origem, updated_at = now()
       where id = v_atend_id;
    end if;
    -- Origem de verdade ja preenchida: NAO mexe. O clique fica registrado na
    -- tabela do link de qualquer jeito.

  exception when others then
    return null;  -- silencio: o sync da extensao vem primeiro
  end;

  return null;
end;
$$;
