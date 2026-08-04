-- VIEW NOVA NASCE FURANDO A RLS — e reabriu o buraco em menos de 24h
--
-- Em 04/08 de manhã a base foi fechada pros papéis externos (`mapa`,
-- `consultor`): 133 tabelas legíveis viraram 7. Parte do trabalho foi pôr
-- `security_invoker` em TODAS as views de `public`, porque view no Postgres roda
-- com os direitos do DONO por padrão e por isso FURA a RLS das tabelas de baixo.
--
-- À tarde, uma conferência achou DUAS views novas sem `security_invoker`:
-- `vendor_parados_topo` e `vendor_roteamento_efetivo`, criadas depois da
-- varredura. Ou seja: a varredura conserta o passado e não segura o futuro.
--
-- O FURO É REAL, MEDIDO — não deduzido. Com a MESMA conta de consultor:
--     select count(*) from wa_chat_labels        ->      0 linhas (RLS pegando)
--     select count(*) from <view sem invoker>     ->  8.332 linhas (RLS furada)
-- A view exposta trazia o nome de cada vendedor e quantos leads ele tem parados
-- e devendo resposta — desempenho do time comercial, para um consultor externo
-- que só devia enxergar as telas de ração.
--
-- Fechar as duas não resolve: a PRÓXIMA view abre de novo. Por isso um gatilho
-- de DDL, e não uma varredura.
--
-- SÓ NO `CREATE VIEW`, de propósito. A primeira versão disparava no `ALTER VIEW`
-- também e desfazia na hora qualquer escolha deliberada — quem precisasse de uma
-- view com direitos de dono nunca conseguiria. Assim o padrão é seguro e o
-- escape existe:  alter view ... set (security_invoker = false)

-- ── as duas que escaparam ───────────────────────────────────────────────────
alter view public.vendor_parados_topo       set (security_invoker = true);
alter view public.vendor_roteamento_efetivo set (security_invoker = true);

-- ── o guarda ────────────────────────────────────────────────────────────────
create or replace function public.forca_security_invoker()
returns event_trigger
language plpgsql
security definer
as $$
declare r record;
begin
  for r in
    select objid, schema_name, object_identity
    from pg_event_trigger_ddl_commands()
    where command_tag in ('CREATE VIEW', 'ALTER VIEW') and schema_name = 'public'
  loop
    if coalesce((select option_value from pg_class c, pg_options_to_table(c.reloptions)
                 where c.oid = r.objid and option_name = 'security_invoker'), 'false') <> 'true' then
      execute format('alter view %s set (security_invoker = true)', r.object_identity);
      -- Fica no log: mudar em silêncio a semântica de uma view alheia seria pior
      -- que o problema que isto resolve.
      raise notice 'security_invoker forcado em %', r.object_identity;
    end if;
  end loop;
end $$;

comment on function public.forca_security_invoker() is
  'View no Postgres roda com direitos do DONO por padrao e FURA a RLS. Medido: conta restrita lia 0 linhas na tabela e 8.332 pela view. Este gatilho faz toda view nova de public nascer com security_invoker. Escape: alter view ... set (security_invoker = false).';

drop event trigger if exists trg_forca_security_invoker;
create event trigger trg_forca_security_invoker
  on ddl_command_end
  when tag in ('CREATE VIEW')
  execute function public.forca_security_invoker();

-- VERIFICADO em produção, nesta ordem:
--   view criada sem cuidado  -> nasce com security_invoker = true
--   consultor lendo essa view -> 0 linhas (antes do guarda: 8.332)
--   alter view ... = false    -> respeitado, o guarda não desfaz
--   admin nas duas views      -> 10 linhas, nada quebrou
