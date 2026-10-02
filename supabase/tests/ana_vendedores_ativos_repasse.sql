BEGIN;
-- Candidate integration proof. Run with the migration in one BEGIN/ROLLBACK transaction.
-- Synthetic chats/phones only. Workers cannot see these uncommitted rows.
-- pg_net requests are dispatched only after COMMIT; this file never commits.
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='15s';
CREATE TEMP TABLE ana_repasse_results(case_name text PRIMARY KEY, pass boolean NOT NULL) ON COMMIT DROP;
CREATE TEMP TABLE ana_repasse_fixture(vendor text,chat text,phone text,dispatch_id uuid,queue_id uuid) ON COMMIT DROP;
CREATE TEMP TABLE ana_repasse_test_dispatch(LIKE public.outbound_dispatch INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TRIGGER ana_repasse_test_router BEFORE INSERT ON ana_repasse_test_dispatch FOR EACH ROW EXECUTE FUNCTION public.outbound_rotear();
DO $test$
DECLARE
 names constant text[] := ARRAY['DANIEL','RAMON','GUSTAVO','ALVARO','EDER','EDILSON JR','IGOR','JARDEL','LUCAS','PEDRO'];
 who text; picked record; payload jsonb; result jsonb; before_at timestamptz; chat text; phone text;
 i integer:=0; status_text text; routed text; saved_cfg jsonb; before_queues integer; after_queues integer;
 blocked_before boolean; active_before boolean; phone_before text; sentinel text;
BEGIN
 SELECT valor INTO saved_cfg FROM public.ia_config WHERE chave='ana_contingencia_preco' FOR UPDATE;
 IF saved_cfg->'v'->'vendedores_repasse' <> '["DANIEL","RAMON","GUSTAVO"]'::jsonb THEN
  RAISE EXCEPTION 'Migration must not activate config before compatible edges';
 END IF;
 INSERT INTO ana_repasse_results VALUES('migration leaves activation for the final rollout step',true);
 FOR who IN SELECT unnest(names) LOOP
  i:=i+1;
  UPDATE public.ia_config SET valor=jsonb_set(saved_cfg,'{v,vendedores_repasse}',jsonb_build_array(who)) WHERE chave='ana_contingencia_preco';
  SELECT * INTO picked FROM public.ana_pick_vendedor_restrito();
  IF picked.vendedor IS DISTINCT FROM who OR nullif(btrim(picked.telefone),'') IS NULL THEN
   RAISE EXCEPTION 'Configured active seller % was not selected',who;
  END IF;
  INSERT INTO ana_repasse_results VALUES('picker accepts configured active '||who,true);
  payload:=jsonb_build_object('origem','WhatsApp ANA','ana_repasse_restrito',true,'ana_qualificado',true);
  INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
   VALUES(who,'559900009000','Synthetic rollback routing test',payload)
   RETURNING status,vendedor_nome INTO status_text,routed;
  IF status_text IS DISTINCT FROM 'pending' OR routed IS DISTINCT FROM who THEN
   RAISE EXCEPTION 'Restricted qualified routing rejected or reassigned %: %/%',who,status_text,routed;
  END IF;
  INSERT INTO ana_repasse_results VALUES('restricted qualified routing preserves '||who,true);

  chat:='990021026'||lpad(i::text,3,'0')||'@lid';
  phone:='559900021'||lpad(i::text,3,'0');
  IF EXISTS(SELECT 1 FROM public.ia_atendimentos WHERE chat_id=chat) OR EXISTS(SELECT 1 FROM public.outbound_dispatch WHERE cliente_telefone_norm=public.fn_norm_fone_br(phone)) THEN
   RAISE EXCEPTION 'Synthetic fixture namespace collision';
  END IF;
  INSERT INTO public.ia_atendimentos(chat_id,vendedor_nome,ativo,estado,dados_coletados)
   VALUES(chat,'ANA',true,'AI_ACTIVE','{}') RETURNING atualizado_em INTO before_at;
  result:=public.ana_transferir_duvida(chat,phone,'Synthetic rollback lead','Synthetic technical question','Synthetic input','Synthetic rollback context','{}',before_at);
  IF result->'ok' IS DISTINCT FROM 'true'::jsonb OR result->>'vendedor' IS DISTINCT FROM who THEN
   RAISE EXCEPTION 'Doubt transfer failed for %: %',who,result;
  END IF;
  INSERT INTO ana_repasse_fixture VALUES(who,chat,phone,(result->>'dispatch_id')::uuid,(result->>'fila_id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM public.outbound_dispatch d WHERE d.id=(result->>'dispatch_id')::uuid AND d.vendedor_nome=who AND d.status='pending' AND d.raw_payload->'ana_duvida_repasse'='true'::jsonb)
   OR NOT EXISTS(SELECT 1 FROM public.wa_scheduled_messages q JOIN public.ia_contatos_internos c ON c.ativo AND c.papel='vendedor' AND upper(btrim(c.vendedor_nome))=who AND q.chat_id=public.fn_norm_fone_br(c.telefone)||'@c.us' WHERE q.id=(result->>'fila_id')::uuid AND q.status='pending' AND q.vendedor_nome='ANA')
   OR NOT EXISTS(SELECT 1 FROM public.ia_atendimentos a WHERE a.chat_id=chat AND a.ativo=false AND a.motivo_desligamento='vendedor_assumir' AND a.dados_coletados->'_repasse'->>'vendedor'=who) THEN
   RAISE EXCEPTION 'Transfer did not preserve same seller, internal destination and paused Ana';
  END IF;
  INSERT INTO ana_repasse_results VALUES('doubt transaction targets real internal contact and pauses Ana: '||who,true);
  SELECT count(*) INTO before_queues FROM public.outbound_dispatch WHERE cliente_telefone_norm=public.fn_norm_fone_br(phone);
  result:=public.ana_transferir_duvida(chat,phone,'Synthetic rollback lead','Synthetic technical question','Synthetic input','Synthetic context','{}',before_at);
  SELECT count(*) INTO after_queues FROM public.outbound_dispatch WHERE cliente_telefone_norm=public.fn_norm_fone_br(phone);
  IF result->'ok'='true'::jsonb OR after_queues<>before_queues THEN RAISE EXCEPTION 'Repeated transfer produced duplicate queue'; END IF;
 END LOOP;
 INSERT INTO ana_repasse_results VALUES('repeated stale transfer never duplicates dispatch',true);

 UPDATE public.ia_config SET valor=jsonb_set(saved_cfg,'{v,vendedores_repasse}','["DANIEL"]') WHERE chave='ana_contingencia_preco';
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('ALVARO','559900009000','Synthetic rollback routing test',payload) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Config allowlist was bypassed'; END IF;
 INSERT INTO ana_repasse_results VALUES('seller absent from configured allowlist remains rejected',true);

 UPDATE public.ia_config SET valor=jsonb_set(saved_cfg,'{v,vendedores_repasse}','["PATRICK"]') WHERE chave='ana_contingencia_preco';
 SELECT * INTO picked FROM public.ana_pick_vendedor_restrito();
 IF picked.vendedor IS NOT NULL THEN RAISE EXCEPTION 'PATRICK without phone was selected'; END IF;
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('PATRICK','559900009000','Synthetic rollback routing test',payload) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Excluded seller was routed'; END IF;
 result:=public.ana_transferir_duvida('990021026999@lid','559900021999','Synthetic','Question','Input','Context','{}',now());
 IF result->>'motivo' IS DISTINCT FROM 'pool_invalido' THEN RAISE EXCEPTION 'Doubt transfer did not reject excluded pool'; END IF;
 INSERT INTO ana_repasse_results VALUES('PATRICK and arbitrary names remain outside explicit pool',true);

 UPDATE public.ia_config SET valor=jsonb_set(saved_cfg,'{v,vendedores_repasse}','["ALVARO"]') WHERE chave='ana_contingencia_preco';
 SELECT bloqueado INTO blocked_before FROM public.vendor_dispatch_status WHERE vendedor_nome='ALVARO';
 UPDATE public.vendor_dispatch_status SET bloqueado=true WHERE vendedor_nome='ALVARO';
 SELECT * INTO picked FROM public.ana_pick_vendedor_restrito();
 IF picked.vendedor IS NOT NULL THEN RAISE EXCEPTION 'Blocked seller selected'; END IF;
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('ALVARO','559900009000','Synthetic rollback routing test',payload) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Blocked seller routed'; END IF;
 UPDATE public.vendor_dispatch_status SET bloqueado=blocked_before WHERE vendedor_nome='ALVARO';
 INSERT INTO ana_repasse_results VALUES('blocked seller cannot receive ANA transfers',true);

 SELECT ativo,telefone INTO active_before,phone_before FROM public.vendors WHERE name='ALVARO';
 UPDATE public.vendors SET ativo=false WHERE name='ALVARO';
 SELECT * INTO picked FROM public.ana_pick_vendedor_restrito();
 IF picked.vendedor IS NOT NULL THEN RAISE EXCEPTION 'Inactive seller selected'; END IF;
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('ALVARO','559900009000','Synthetic rollback routing test',payload) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Inactive seller routed'; END IF;
 UPDATE public.vendors SET ativo=active_before,telefone='' WHERE name='ALVARO';
 SELECT * INTO picked FROM public.ana_pick_vendedor_restrito();
 IF picked.vendedor IS NOT NULL THEN RAISE EXCEPTION 'Seller without phone selected'; END IF;
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('ALVARO','559900009000','Synthetic rollback routing test',payload) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Seller without phone routed'; END IF;
 UPDATE public.vendors SET telefone=phone_before WHERE name='ALVARO';
 INSERT INTO ana_repasse_results VALUES('active status and phone are required at selection and routing',true);

 UPDATE public.ia_config SET valor=jsonb_set(jsonb_set(saved_cfg,'{v,vendedores_repasse}','["ALVARO"]'),'{v,repasse_qualificados}','false') WHERE chave='ana_contingencia_preco';
 SELECT * INTO picked FROM public.ana_pick_vendedor_restrito();
 IF picked.vendedor IS NOT NULL THEN RAISE EXCEPTION 'Disabled qualification gate selected a seller'; END IF;
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('ALVARO','559900009000','Synthetic rollback routing test',payload) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Disabled qualified routing still routed'; END IF;
 INSERT INTO ana_repasse_results VALUES('qualification gate is preserved',true);

 UPDATE public.ia_config SET valor=jsonb_set(jsonb_set(saved_cfg,'{v,vendedores_repasse}','["ALVARO"]'),'{v,ativo}','false') WHERE chave='ana_contingencia_preco';
 SELECT * INTO picked FROM public.ana_pick_vendedor_restrito();
 IF picked.vendedor IS NOT NULL THEN RAISE EXCEPTION 'Disabled contingency selected a seller'; END IF;
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('ALVARO','559900009000','Synthetic rollback routing test',payload) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Disabled contingency routed a seller'; END IF;
 INSERT INTO ana_repasse_results VALUES('contingency master gate is preserved',true);

 UPDATE public.ia_config SET valor=jsonb_set(jsonb_set(saved_cfg,'{v,vendedores_repasse}','["ALVARO"]'),'{v,repasse_duvidas}','false') WHERE chave='ana_contingencia_preco';
 result:=public.ana_transferir_duvida('990021026999@lid','559900021999','Synthetic','Question','Input','Context','{}',now());
 IF result->>'motivo' IS DISTINCT FROM 'repasse_duvidas_desligado' THEN RAISE EXCEPTION 'Doubt toggle was bypassed'; END IF;
 INSERT INTO ana_repasse_test_dispatch(vendedor_nome,cliente_telefone,mensagem,raw_payload)
  VALUES('ALVARO','559900009000','Synthetic rollback routing test',jsonb_build_object('origem','WhatsApp ANA','ana_repasse_restrito',true,'ana_duvida_repasse',true)) RETURNING status INTO status_text;
 IF status_text IS DISTINCT FROM 'skipped' THEN RAISE EXCEPTION 'Disabled doubt gate routed'; END IF;
 INSERT INTO ana_repasse_results VALUES('doubt gate is preserved independently',true);

 UPDATE public.ia_config SET valor=saved_cfg WHERE chave='ana_contingencia_preco';
 IF EXISTS(SELECT 1 FROM public.outbound_dispatch WHERE cliente_telefone LIKE '559900021%' AND status='sent')
  OR EXISTS(SELECT 1 FROM public.wa_scheduled_messages WHERE body LIKE '%Synthetic rollback%' AND status IN('sending','sent')) THEN
  RAISE EXCEPTION 'Fixture became externally deliverable';
 END IF;
 INSERT INTO ana_repasse_results VALUES('all fixture queues remain uncommitted and unsent',true);
END $test$;
SELECT count(*) AS passed, bool_and(pass) AS all_passed, array_agg(case_name ORDER BY case_name) AS cases FROM ana_repasse_results;
ROLLBACK;

