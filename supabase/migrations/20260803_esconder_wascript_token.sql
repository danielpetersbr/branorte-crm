-- vendors.wascript_token é a credencial da API de WhatsApp de cada vendedor.
-- A RLS de `vendors` libera SELECT pra qualquer autenticado, e RLS é por LINHA:
-- não esconde coluna. Resultado: qualquer conta logada — vendedor, marketing,
-- visualizador, papéis restritos e contas externas — lia os 8 tokens ativos
-- pela API REST (`/rest/v1/vendors?select=name,wascript_token`).
--
-- MECANISMO (a pegadinha): `revoke select (coluna)` NÃO desfaz um `grant select`
-- de tabela inteira — o grant de tabela já cobre toda coluna. Tem que tirar o
-- SELECT da tabela e reconceder coluna a coluna.
--
-- PRÉ-REQUISITO: nenhum cliente pode usar `select('*')` nesta tabela. O
-- PostgREST expande `*` pra todas as colunas e devolve 403 na consulta INTEIRA
-- se uma delas for negada. O useVendors.ts usava `*` e foi trocado por lista
-- explícita antes desta migration (commit a40e43c).
--
-- Quem realmente usa o token são as edge functions send-wascript,
-- briefing-send-wa e sync-health-alert, todas com SUPABASE_SERVICE_ROLE_KEY —
-- role service_role, que não depende destes grants. Verificado por grep:
-- nenhuma leitura no frontend, na extensão WA Sync, em api/, nem join
-- `vendors(*)` em lugar nenhum.
--
-- Rollback: grant select on public.vendors to authenticated;
revoke select on public.vendors from authenticated;
revoke select on public.vendors from anon;

grant select (
  id, key, name, ativo, telefone, email,
  replyagent_tag, aceita_transferencia, aceita_transferencia_at
) on public.vendors to authenticated;
