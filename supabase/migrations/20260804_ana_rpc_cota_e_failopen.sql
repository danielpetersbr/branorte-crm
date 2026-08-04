-- Cota + fail-open fechado na RPC que a Ana/ReplyAgent/n8n usam pra transferir.
-- 1) o sorteio ponderado passa a usar share * cota_fator (quem estourou vale 0);
-- 2) o fallback nao trata mais "vendedor sem linha no painel" como ligado.
create or replace function public.wa_atribuir_vendedor_ana(
  p_cliente_phone text, p_cliente_nome text, p_interesse text default null,
  p_dados jsonb default '{}'::jsonb, p_first_message text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $fn$
DECLARE
  v_nome_clean text; v_phone_norm text; v_ddd int;
  v_duplicate_card_id uuid; v_vendedor_id uuid; v_vendedor_nome text;
  v_vendedor_telefone text; v_vendedor_key text;
  v_stage_novo_lead uuid := '7c151f2e-5b3c-4118-9cc1-c0d65287696f';
  v_card_id uuid; v_subject text;
  v_total_share numeric; v_random_share numeric; v_acc numeric; v_vendor_row record;
BEGIN
  v_nome_clean := trim(coalesce(p_cliente_nome, ''));
  IF length(v_nome_clean) < 2 THEN
    RETURN jsonb_build_object('success', false, 'error', 'nome_faltando',
      'message', 'Pergunte o nome do cliente antes de transferir.'); END IF;
  IF v_nome_clean ~* '^(cliente|teste|test|x|xx|xxx|usuario|user|null|none|nada|n/a|n/d)$' THEN
    RETURN jsonb_build_object('success', false, 'error', 'nome_invalido',
      'message', 'Nome generico - peca o nome real.'); END IF;
  IF v_nome_clean !~ '[a-zA-Z]' THEN
    RETURN jsonb_build_object('success', false, 'error', 'nome_invalido',
      'message', 'Nome invalido (sem letras).'); END IF;
  IF v_nome_clean ~* '\m(ltda|me|eireli|s\.?a\.?|s/a|agropecuaria|comercial|industria|fabrica|distribuidora)\M' THEN
    RETURN jsonb_build_object('success', false, 'error', 'nome_eh_empresa',
      'message', 'Nome parece empresa - peca o nome da PESSOA.'); END IF;

  v_phone_norm := regexp_replace(coalesce(p_cliente_phone, ''), '[^0-9]', '', 'g');
  IF length(v_phone_norm) IN (10, 11) THEN v_phone_norm := '55' || v_phone_norm; END IF;
  IF length(v_phone_norm) >= 12 AND v_phone_norm LIKE '55%' THEN
    v_ddd := substr(v_phone_norm, 3, 2)::int;
    IF length(v_phone_norm) = 13 AND substr(v_phone_norm, 5, 1) = '9' AND v_ddd >= 31 THEN
      v_phone_norm := substr(v_phone_norm, 1, 4) || substr(v_phone_norm, 6);
    ELSIF length(v_phone_norm) = 12 AND v_ddd BETWEEN 11 AND 30 THEN
      v_phone_norm := substr(v_phone_norm, 1, 4) || '9' || substr(v_phone_norm, 5);
    END IF;
  END IF;
  IF length(v_phone_norm) < 10 THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_phone'); END IF;

  -- CONTINUIDADE: cliente que ja tem card nos 30 dias volta pro mesmo dono.
  SELECT c.id, c.owner_id INTO v_duplicate_card_id, v_vendedor_id
  FROM public.cards c
  WHERE c.contact_phone = v_phone_norm AND c.is_archived = false
    AND c.ia_handled = true AND c.created_at > now() - interval '30 days'
  ORDER BY c.created_at DESC LIMIT 1;

  IF v_vendedor_id IS NULL THEN
    -- Peso = share * cota_fator. Quem a cota zerou sai do sorteio.
    SELECT sum(share_percent * public.cota_fator(vendedor_nome)) INTO v_total_share
    FROM public.vendor_dispatch_status WHERE online = true AND bloqueado = false;

    IF v_total_share IS NOT NULL AND v_total_share > 0 THEN
      v_random_share := random() * v_total_share; v_acc := 0;
      FOR v_vendor_row IN
        SELECT vds.vendedor_nome,
               (vds.share_percent * public.cota_fator(vds.vendedor_nome)) AS peso
        FROM public.vendor_dispatch_status vds
        WHERE vds.online = true AND vds.bloqueado = false
          AND (vds.share_percent * public.cota_fator(vds.vendedor_nome)) > 0
        ORDER BY vds.vendedor_nome
      LOOP
        v_acc := v_acc + v_vendor_row.peso;
        IF v_acc >= v_random_share THEN
          SELECT id, name, telefone, key INTO v_vendedor_id, v_vendedor_nome, v_vendedor_telefone, v_vendedor_key
          FROM public.vendors
          WHERE (key = v_vendor_row.vendedor_nome OR lower(name) = lower(v_vendor_row.vendedor_nome))
            AND ativo = true LIMIT 1;
          EXIT;
        END IF;
      END LOOP;
    END IF;

    -- Fallback: menos carregado entre os LIGADOS. Antes era coalesce(online,true),
    -- o que fazia vendedor SEM linha no painel contar como ligado.
    IF v_vendedor_id IS NULL THEN
      SELECT v.id, v.name, v.telefone, v.key
        INTO v_vendedor_id, v_vendedor_nome, v_vendedor_telefone, v_vendedor_key
      FROM public.vendors v
      JOIN public.vendor_dispatch_status vds
        ON upper(split_part(btrim(vds.vendedor_nome),' ',1)) = upper(split_part(btrim(v.name),' ',1))
      WHERE v.ativo = true AND v.telefone IS NOT NULL
        AND vds.online = true AND vds.bloqueado = false
      ORDER BY coalesce(vds.enviados_hoje, 0) ASC, random() LIMIT 1;
    END IF;
  END IF;

  IF v_vendedor_nome IS NULL THEN
    SELECT name, telefone, key INTO v_vendedor_nome, v_vendedor_telefone, v_vendedor_key
    FROM public.vendors WHERE id = v_vendedor_id; END IF;

  IF v_vendedor_id IS NULL OR v_vendedor_telefone IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'no_vendor_available',
      'message', 'Nenhum vendedor disponivel no momento.'); END IF;

  v_subject := CASE WHEN p_interesse = 'fabrica_racao' THEN 'Fabrica de racao'
                    WHEN p_interesse = 'equipamento' THEN 'Equipamento avulso'
                    ELSE 'Lead via Ana' END;
  IF p_dados ? 'equipamento' THEN v_subject := v_subject || ' - ' || (p_dados->>'equipamento');
  ELSIF p_dados ? 'animal' THEN
    v_subject := v_subject || ' - ' || (p_dados->>'animal');
    IF p_dados ? 'quantidade' THEN v_subject := v_subject || ' (' || (p_dados->>'quantidade') || ')'; END IF;
  END IF;

  INSERT INTO public.cards (
    id, pipeline_stage_id, owner_id, contact_name, contact_phone,
    contact_phone_formatted, subject, first_message, raw_data,
    ia_handled, ia_transferred_to, ia_transfer_at, created_at, last_message_at
  ) VALUES (
    gen_random_uuid(), v_stage_novo_lead, v_vendedor_id, v_nome_clean, v_phone_norm, v_phone_norm,
    v_subject, coalesce(p_first_message, p_dados->>'contexto', v_subject),
    jsonb_build_object('origem','ana','interesse',p_interesse,'dados',p_dados),
    true, v_vendedor_nome, now(), now(), now()
  ) RETURNING id INTO v_card_id;

  UPDATE public.vendor_dispatch_status
     SET enviados_hoje = enviados_hoje + 1, ultimo_envio_em = now(), atualizado_em = now()
   WHERE vendedor_nome = v_vendedor_key OR lower(vendedor_nome) = lower(v_vendedor_nome);

  BEGIN
    PERFORM net.http_post(
      url := 'https://branorte-auditoria.vercel.app/api/leads/dispatch',
      headers := jsonb_build_object('Content-Type','application/json',
        'x-dispatch-secret','S06xx9CXKB76oPZWaHVcdpEWC7-dUeEqyjklMVEoPX0'),
      body := jsonb_strip_nulls(jsonb_build_object(
        'whatsapp','+'||v_phone_norm,'nome',v_nome_clean,'motivo_contato',p_interesse,
        'vendedor',v_vendedor_nome,'qual_animal',p_dados->>'animal',
        'quantos_animais',coalesce(p_dados->>'quantidade',p_dados->>'quantos_animais'),
        'finalidade',p_dados->>'finalidade',
        'capacidade',coalesce(p_dados->>'capacidade',p_dados->>'capacidade_producao'),
        'quando_investir',coalesce(p_dados->>'quando_investir',p_dados->>'temperatura'),
        'origem',p_dados->>'origem','criativo',p_dados->>'criativo')),
      timeout_milliseconds := 8000);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'wa_atribuir_vendedor_ana: dispatch HTTP failed: % %', SQLSTATE, SQLERRM;
  END;

  RETURN jsonb_build_object('success', true, 'vendedor_nome', v_vendedor_nome,
    'vendedor_telefone', v_vendedor_telefone,
    'vendedor_wa_url','https://wa.me/'||v_vendedor_telefone,
    'card_id', v_card_id,'phone_normalizado', v_phone_norm,
    'cliente_recorrente', (v_duplicate_card_id IS NOT NULL));
END; $fn$;
