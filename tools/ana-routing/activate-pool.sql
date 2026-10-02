-- Run ONLY after the three SQL functions and both compatible ANA Edge Functions are deployed.
-- No existing price/qualification/contingency fields are rewritten.
BEGIN;
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='5s';
DO $activate$
DECLARE cfg jsonb; item record;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('ana_pick_vendedor_restrito()', '276b2427ea4a6f72572e854a6c5818a6'),
    ('ana_transferir_duvida(text,text,text,text,text,text,jsonb,timestamp with time zone)', 'c31e13d1c3d96b0199571511316f6586'),
    ('outbound_rotear()', '4f422e473d9179e1d5cdc9e4e2b367fe')
  ) AS expected(signature, definition_md5)
  LOOP
    IF md5(pg_get_functiondef(to_regprocedure(item.signature))) IS DISTINCT FROM item.definition_md5 THEN
      RAISE EXCEPTION 'Compatible ANA transfer DDL missing or drifted: %',item.signature USING ERRCODE='55000';
    END IF;
  END LOOP;
  SELECT valor INTO cfg FROM public.ia_config WHERE chave='ana_contingencia_preco' FOR UPDATE;
  IF md5(cfg::text) IS DISTINCT FROM '23099300b987f9d75ab09d83620ddc4f' THEN
    RAISE EXCEPTION 'ANA configuration drift; review current settings before activation' USING ERRCODE='55000';
  END IF;
  IF cfg->'v'->'vendedores_repasse' IS DISTINCT FROM '["DANIEL","RAMON","GUSTAVO"]'::jsonb THEN
    RAISE EXCEPTION 'Unexpected ANA baseline transfer pool' USING ERRCODE='55000';
  END IF;
  IF (SELECT count(*) FROM public.vendors v WHERE upper(btrim(v.name))=ANY(ARRAY['DANIEL','RAMON','GUSTAVO','ALVARO','EDER','EDILSON JR','IGOR','JARDEL','LUCAS','PEDRO']) AND v.ativo IS TRUE AND coalesce(btrim(v.telefone),'')<>'' AND NOT EXISTS(SELECT 1 FROM public.vendor_dispatch_status s WHERE upper(btrim(s.vendedor_nome))=upper(btrim(v.name)) AND s.bloqueado IS TRUE) AND EXISTS(SELECT 1 FROM public.ia_contatos_internos i WHERE i.ativo IS TRUE AND i.papel='vendedor' AND upper(btrim(i.vendedor_nome))=upper(btrim(v.name)) AND public.fn_norm_fone_br(i.telefone)~'^[0-9]{10,15}$')) <> 10 THEN
    RAISE EXCEPTION 'An ANA transfer seller is no longer active, available or internally configured' USING ERRCODE='55000';
  END IF;
  UPDATE public.ia_config SET valor=jsonb_set(valor,'{v,vendedores_repasse}','["DANIEL","RAMON","GUSTAVO","ALVARO","EDER","EDILSON JR","IGOR","JARDEL","LUCAS","PEDRO"]'::jsonb), atualizado_em=clock_timestamp() WHERE chave='ana_contingencia_preco';
END $activate$;
COMMIT;
SELECT chave,valor->'v'->'vendedores_repasse' AS vendedores_repasse FROM public.ia_config WHERE chave='ana_contingencia_preco';
