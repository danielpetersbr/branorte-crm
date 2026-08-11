-- Cada clique no /l/ varria 366 MB de tabela pra decidir quem atende.
--
-- A funil_pick_vendedor_inbound() chama cota_fator() UMA VEZ POR VENDEDOR, e a
-- cota_fator bate duas vezes na wa_chat_labels por vendedor: uma no
-- max(updated_at) (idade do sync) e outra dentro da view vendor_parados_topo
-- (contagem de parados). Com 8 vendedores elegiveis sao 16 varreduras.
--
-- Medido em 11/08/2026, com o cliente esperando o redirect:
--
--   EXPLAIN da metade do max(updated_at), UM vendedor:
--     Seq Scan on wa_chat_labels
--     Rows Removed by Filter: 9247
--     Buffers: shared hit=3137          (~24 MB)
--     Execution Time: 10.271 ms
--
--   cota_fator() x 8 vendedores: 148 ms numa rodada, 322 ms na outra --
--   mesmos 44.753 buffers nas duas (tudo cache hit), entao a diferenca e
--   CPU/contencao. O p95 do clique era MUITO pior que a media.
--
-- POR QUE O INDICE QUE JA EXISTIA NAO SERVIA:
-- wa_chat_labels_vendedor_idx e em `vendedor_nome` CRU. A cota_fator filtra por
--   upper(split_part(btrim(vendedor_nome),' ',1))
-- que e uma EXPRESSAO. Indice de coluna nao casa com filtro de expressao, entao
-- o planner nao tinha escolha a nao ser varrer a tabela inteira. A expressao
-- abaixo e copia exata da que esta na cota_fator -- conferida com
-- pg_get_functiondef antes de escrever. Mexeu la, mexe aqui, senao volta
-- silenciosamente pro Seq Scan (nao quebra nada; so fica lento de novo).
--
-- A tabela tem 9.247 linhas e ocupa 51 MB: ~5,5 KB por linha, com 21% de tuplas
-- mortas e 1.664 autovacuums. A frota escreve nela o tempo todo. Por isso
-- CONCURRENTLY -- indice normal pegaria lock de escrita e travaria a extensao
-- dos vendedores.
--
-- DEPOIS (mesma query, mesmo vendedor):
--     Index Scan using wa_chat_labels_vendedor1_idx
--     Buffers: shared hit=2             (era 3137)
--     Execution Time: 0.113 ms          (era 10.271 ms)
--
--   cota_fator() x 11 vendedores: 28,2 ms no total (2,57 ms cada).
--   Era 148-322 ms para 8. O mesmo indice atende as DUAS varreduras: a view
--   vendor_parados_topo passou a usar Bitmap Index Scan por cima dele.
--
-- O segundo indice e da TRAVA DO RALO do credito de vez: o resgate so vale se
-- houver wa_chat_messages.synced_at nos ultimos 60 min (extensao cega nao pode
-- gerar credito infinito). Esse subselect custava 35,7 ms e 1.394 buffers.
--
-- CONCURRENTLY nao roda dentro de transacao. Se o supabase CLI embrulhar esta
-- migration num BEGIN, rode as duas linhas na mao pelo SQL editor -- elas ja
-- estao aplicadas em producao desde 11/08/2026, o IF NOT EXISTS torna isto
-- idempotente.

create index concurrently if not exists wa_chat_labels_vendedor1_idx
  on public.wa_chat_labels (upper(split_part(btrim(vendedor_nome), ' ', 1)));

create index concurrently if not exists wa_chat_messages_synced_idx
  on public.wa_chat_messages (synced_at desc);
