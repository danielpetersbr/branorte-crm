-- Preserve existing layouts; require customer identity on every new cloud layout.
CREATE OR REPLACE FUNCTION public.tg_configurador_cliente_obrigatorio()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $function$
DECLARE client_name text;
BEGIN
  client_name := nullif(btrim(NEW.cliente_nome), '');
  IF TG_OP = 'INSERT' AND client_name IS NULL THEN
    RAISE EXCEPTION 'Informe o nome do cliente antes de criar o layout.' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND nullif(btrim(OLD.cliente_nome), '') IS NOT NULL AND client_name IS NULL THEN
    RAISE EXCEPTION 'O nome do cliente é obrigatório neste layout.' USING ERRCODE = '23514';
  END IF;
  NEW.cliente_nome := client_name;
  IF client_name IS NOT NULL AND jsonb_typeof(NEW.data) = 'object' THEN
    NEW.data := jsonb_set(NEW.data, '{clientName}', to_jsonb(client_name), true);
  END IF;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION public.tg_configurador_cliente_obrigatorio() FROM PUBLIC;
CREATE TRIGGER trg_configurador_cliente_obrigatorio
BEFORE INSERT OR UPDATE OF cliente_nome, data ON public.configurador_projetos
FOR EACH ROW EXECUTE FUNCTION public.tg_configurador_cliente_obrigatorio();
