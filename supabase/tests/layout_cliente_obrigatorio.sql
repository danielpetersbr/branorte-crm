-- Domain integration tests: no test layout or legacy change survives ROLLBACK.
BEGIN;
DO $test$
DECLARE fixture_id uuid; legacy_id uuid; fixture_data jsonb;
BEGIN
  BEGIN
    INSERT INTO public.configurador_projetos(nome, cliente_nome, data)
    VALUES ('Teste com rollback', '   ', '{"id":"teste-sem-cliente","floors":[]}');
    RAISE EXCEPTION 'Novo layout sem cliente foi aceito';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  INSERT INTO public.configurador_projetos(nome, cliente_nome, data)
  VALUES ('Teste com rollback', '  Fazenda Boa Vista  ', '{"id":"teste-com-cliente","floors":[]}')
  RETURNING id, data INTO fixture_id, fixture_data;
  IF fixture_data->>'clientName' <> 'Fazenda Boa Vista' THEN
    RAISE EXCEPTION 'Nome do cliente não foi normalizado e associado ao JSON';
  END IF;
  BEGIN
    UPDATE public.configurador_projetos SET cliente_nome = NULL WHERE id = fixture_id;
    RAISE EXCEPTION 'Nome do cliente obrigatório foi apagado';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  UPDATE public.configurador_projetos SET cliente_nome = 'Cliente corrigido' WHERE id = fixture_id
  RETURNING data INTO fixture_data;
  IF fixture_data->>'clientName' <> 'Cliente corrigido' THEN RAISE EXCEPTION 'Metadados divergentes'; END IF;

  SELECT id INTO legacy_id FROM public.configurador_projetos
  WHERE cliente_nome IS NULL AND id <> fixture_id ORDER BY id LIMIT 1;
  IF legacy_id IS NULL THEN RAISE EXCEPTION 'Fixture legado ausente'; END IF;
  UPDATE public.configurador_projetos SET data = data WHERE id = legacy_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Layout legado deixou de ser editável'; END IF;
END
$test$;
SELECT true AS blank_insert_rejected, true AS named_insert_accepted,
  true AS client_trim_and_json_synced, true AS removing_known_client_rejected,
  true AS renaming_client_synced, true AS legacy_update_preserved;
ROLLBACK;
