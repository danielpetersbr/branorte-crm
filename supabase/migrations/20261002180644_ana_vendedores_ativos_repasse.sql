-- Extend only the existing explicit ANA transfer allowlist. Configuration remains unchanged.
-- Deploy compatible Edge Functions before running the separate guarded config activation.
SET LOCAL lock_timeout='500ms';
SET LOCAL statement_timeout='15s';
DO $migration$
DECLARE
  item record;
  definition text;
  actual_md5 text;
  old_list constant text := $old$'DANIEL','RAMON','GUSTAVO'$old$;
  new_list constant text := $new$'DANIEL','RAMON','GUSTAVO','ALVARO','EDER','EDILSON JR','IGOR','JARDEL','LUCAS','PEDRO'$new$;
BEGIN
  FOR item IN SELECT * FROM (VALUES
    ('ana_pick_vendedor_restrito()', '76406e900429c9ccdb0baf8eb0920a5f', 3),
    ('ana_transferir_duvida(text,text,text,text,text,text,jsonb,timestamp with time zone)', '824688da4538eae97f9a0666ac789847', 2),
    ('outbound_rotear()', 'e55572b1d0e06ffaba0eb3bb416b6f76', 1)
  ) AS baseline(signature, expected_md5, expected_replacements)
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(item.signature)) INTO definition;
    actual_md5 := md5(definition);
    IF definition IS NULL OR actual_md5 IS DISTINCT FROM item.expected_md5 THEN
      RAISE EXCEPTION 'ANA transfer function drift: %', item.signature USING ERRCODE='55000';
    END IF;
    IF (length(definition)-length(replace(definition,old_list,'')))/length(old_list) <> item.expected_replacements THEN
      RAISE EXCEPTION 'Unexpected ANA allowlist occurrences: %', item.signature USING ERRCODE='55000';
    END IF;
  END LOOP;
  -- All definitions are verified before replacing any of them; ownership/ACL are preserved.
  FOR item IN SELECT * FROM (VALUES
    ('ana_pick_vendedor_restrito()'),
    ('ana_transferir_duvida(text,text,text,text,text,text,jsonb,timestamp with time zone)'),
    ('outbound_rotear()')
  ) AS functions(signature)
  LOOP
    SELECT pg_get_functiondef(to_regprocedure(item.signature)) INTO definition;
    EXECUTE replace(definition,old_list,new_list);
  END LOOP;
END $migration$;
