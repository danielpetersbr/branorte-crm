-- Authorized by Daniel on 2026-10-02: photo and official price from the vendor's WhatsApp this weekend.
-- Run only after the reviewed ia-atendente sender selection is deployed and read back exactly.
-- Only inserts this new configuration. The nine-vendor pool and operational queues are not modified.
DO $activate$
DECLARE current_routing jsonb;
BEGIN
  SELECT valor INTO current_routing
    FROM public.ia_config WHERE chave='ana_contingencia_preco' FOR SHARE;
  IF md5(current_routing::text) IS DISTINCT FROM 'df2169ad4e793643ea400505e336d99c'
     OR current_routing->'v'->'vendedores_repasse' IS DISTINCT FROM
       '["RAMON","GUSTAVO","ALVARO","EDER","EDILSON JR","IGOR","JARDEL","LUCAS","PEDRO"]'::jsonb THEN
    RAISE EXCEPTION 'Routing configuration changed; recheck before activating sender selection';
  END IF;
  IF EXISTS (SELECT 1 FROM public.ia_config WHERE chave='ana_pacote_vendedor') THEN
    RAISE EXCEPTION 'Sender selection already exists; do not overwrite';
  END IF;
  IF clock_timestamp() >= timestamptz '2026-10-05 03:00:00+00' THEN
    RAISE EXCEPTION 'The authorized weekend has already ended';
  END IF;
  INSERT INTO public.ia_config(chave,valor,atualizado_em)
  VALUES ('ana_pacote_vendedor', jsonb_build_object('v',jsonb_build_object(
    'ativo',true,'inicio',clock_timestamp(),'fim','2026-10-05T03:00:00.000Z',
    'motivo','Daniel: foto e preço pelo WhatsApp do vendedor neste fim de semana'
  )),clock_timestamp());
END $activate$;

SELECT chave,valor,atualizado_em FROM public.ia_config WHERE chave='ana_pacote_vendedor';
