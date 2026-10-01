# Auditoria de desempenho — 01/10/2026

O maior consumidor de tempo SQL identificado foi a supervisão de chats sem filtro de vendedor. Um índice iniciado por `chat_id` reduziu a execução natural da supervisão de **57,38 s para 7,26 s**, mantendo os contadores de negócio. O snapshot compacto do dashboard preservou integralmente os dados de **18.175 linhas e 22 campos**, com aproximadamente metade do JSON anterior. O carregamento por rota reduz o JavaScript de entrada em aproximadamente **57%**; a extensão na VPS deixou de consultar a instância central a cada segundo com o popup aberto.

## Janela e método

- Banco de produção observado depois da recuperação da API e do reinício do projeto. PostgreSQL e `pg_stat_statements` reiniciaram em **01/10/2026, 20:29:56 UTC**.
- Estatísticas principais coletadas entre **23:16 e 23:22 UTC**. Comparação do cron: execuções naturais de **23:16 e 23:26 UTC**. Horários em UTC; subtrair três horas para Brasília.
- Leituras limitadas de `pg_stat_statements`, atividade, índices, definições e catálogos de cron. Planos de produção obtidos com `EXPLAIN`, sem `ANALYZE`.
- Testes de plano usaram tabela temporária e dados sintéticos dentro de `BEGIN/ROLLBACK`. Nenhuma rotina de negócio foi disparada manualmente.
- Não houve alteração de RLS, regras comerciais, intervalos de cron ou dados persistentes de clientes nesta investigação. A alteração aplicada foi um índice, seguido do registro canonical da migration.

## Carga observada antes do índice

Os totais abaixo representam tempo de execução SQL acumulado desde o reinício das estatísticas. Não são porcentagens de CPU nem tempo percebido pelo navegador. Estatísticas de chamadas externas e internas podem se sobrepor; não devem ser somadas indiscriminadamente.

| Operação | Chamadas | Média | Tempo acumulado |
|---|---:|---:|---:|
| `supervisao_varrer_tudo` | 17 | 54,07 s | 919,18 s |
| `refresh_pool_prospeccao` | 33 | 19,41 s | 640,68 s |
| `recompute_contact_status` | 34 | 9,93 s | 337,61 s |
| Refresh de `mv_wa_contato_resumo` | 168 | 1,28 s | 215,10 s |
| Duas consultas recorrentes de `atendimentos_por_cliente` | 743 | 0,36 s, média conjunta | 264,06 s |

Às 23:22 UTC, o banco acumulava **4,08 GB de arquivos temporários**, em unidades decimais. As duas variantes da visão de atendimentos haviam escrito aproximadamente **2,41 GB** de blocos temporários; o refresh do pool, aproximadamente **1,08 GB**. As configurações observadas eram `work_mem=3500kB`, `shared_buffers=256MB` e `max_connections=60`. Não foi feito aumento global de memória ou de conexões.

O serviço também havia registrado cerca de 137 mil preparações de contexto de requisição, aproximadamente 13,8 por segundo na janela correspondente. Consultas de polling de IA apareciam cerca de dez mil vezes cada, mas com média individual inferior a 0,1 ms. Esse volume pode pressionar a API; ele não era o principal consumidor de tempo SQL medido.

Nas amostras de atividade não havia sessões bloqueadoras. A supervisão apareceu ativa por dezenas de segundos, sem espera de lock. Isso sustenta a investigação do trabalho executado pelas consultas; não demonstra que toda lentidão anterior da API tinha essa mesma causa.

## Correção da supervisão e medição real

`supervisao_varrer_segunda_tentativa` consulta mensagens por chat, considerando todos os vendedores. `supervisao_abordagens` também lê o histórico desse chat e calcula janelas sobre as mensagens. Os índices existentes começavam por `vendedor_nome`; as buscas apenas por chat percorriam um índice muito maior e precisavam ordenar os resultados, repetidamente.

Foi criado `wa_chat_messages_chat_timeline_idx` em `(chat_id, data_msg DESC, msg_id DESC)`, com `INCLUDE (from_me, vendedor_nome)`. A criação em produção usou `CONCURRENTLY`; o registro canonical é [20261001232731_wa_messages_chat_first_performance.sql](../supabase/migrations/20261001232731_wa_messages_chat_first_performance.sql). O índice foi confirmado como válido, pronto e ativo, com **10 MB**.

| Execução natural | Antes: 23:16 UTC | Depois: 23:26 UTC | Redução |
|---|---:|---:|---:|
| Supervisão completa | 57.377 ms | 7.264 ms | 87,3% |
| Segunda tentativa | 47.634 ms | 4.199 ms | 91,2% |
| Cliente aguardando | 9.376 ms | 2.763 ms | 70,5% |
| Orçamento sem retorno | 293 ms | 280 ms | 4,4% |

Ambas as execuções terminaram com status `ok`, sem truncamento. Os contadores foram iguais: segunda tentativa avaliou 1.132 chats, sem criar, atualizar ou encerrar achados; cliente aguardando avaliou 1.932 chats e atualizou 136 achados; orçamento sem retorno avaliou 465 chats, sem mudanças.

Os planos também confirmaram a mudança de acesso:

- Busca da última saída em produção: custo estimado **1.996,73 → 1,04**, eliminando o `Sort` e usando `Index Only Scan`.
- Janela de abordagens: `Index Only Scan Backward`, sem `Sort`, com custo total estimado 8,85 após o índice.
- Fixtures sintéticas: custo da última saída **198,18 → 2,04**, mantendo os resultados de última mensagem e de agrupamento das abordagens.

**Custos de `EXPLAIN` são unidades do planejador, não milissegundos.** O ganho real em tempo veio da execução natural do cron. Trata-se de uma primeira comparação após a alteração; a estabilidade ao longo de mais execuções ainda deve ser acompanhada.

O teste [wa_messages_chat_first_performance.sql](../supabase/tests/wa_messages_chat_first_performance.sql) também cobre saídas com timestamps empatados. O catálogo identificou apenas `supervisao_varrer_segunda_tentativa` como chamador de `supervisao_abordagens`. Seu filtro de detecção exige ausência de mensagens recebidas; na fase de encerramento, a existência de resposta do cliente é verificada primeiro. A função e seus critérios permaneceram intactos.

## Dashboard: equivalência e tamanho do snapshot

A leitura anterior fazia oito páginas sequenciais de até 2.500 linhas sobre uma visão com várias funções de janela e ordenações. `auditoria.dashboard_snapshot()` usa a mesma visão, filtro `is_internal=false`, 22 campos e limite de 50 mil linhas, retornando colunas uma vez e valores em arrays. A ordenação possui desempate por ID.

O teste [dashboard_compact_snapshot.sql](../supabase/tests/dashboard_compact_snapshot.sql) comparou **todas as 18.175 linhas, todos os 22 campos e sua ordem** com uma leitura independente da visão. A comparação incluiu valores nulos e booleanos falsos. Passou sob `SET ROLE authenticated` e claims reais de administrador aprovado e vendedor ativo aprovado, dentro de transação revertida.

| Medida | Resultado |
|---|---:|
| Snapshot SQL, administrador | 985,41 ms |
| Snapshot SQL, vendedor | 884,43 ms |
| JSON anterior com objetos | aproximadamente 10,94 MB |
| JSON compacto | aproximadamente 5,35 MB |
| Redução de tamanho | aproximadamente 51% |

Esses tempos foram medidos no SQL; não incluem rede, download, decodificação ou renderização no navegador. A função permanece `SECURITY INVOKER`; seus grants permitem `authenticated` e `service_role` e negam `anon`. A invocação anônima via REST foi negada com SQLSTATE `42501`. Essa equivalência confirma preservação do comportamento anterior sob as roles testadas; não é uma auditoria completa das políticas existentes.

Referência da implementação: [20261001232334_dashboard_compact_snapshot.sql](../supabase/migrations/20261001232334_dashboard_compact_snapshot.sql). A verificação de interface autenticada após publicação ainda estava pendente no fechamento desta auditoria.

## Carregamento do navegador

Quatorze páginas antes importadas diretamente agora carregam pela rota, incluindo dashboard, leads, login, páginas públicas, impressão e portal de transportadoras. A boundary de `Suspense` externa cobre também as rotas que retornam antes do layout autenticado. Gates de perfil, aprovação e permissões continuam no mesmo lugar. As páginas de impressão continuam sinalizando prontidão depois de fontes, imagens e dados.

O build local concluiu em 21,57 s. O JavaScript de entrada caiu de aproximadamente **1.464 KB para 633 KB**; comprimido com gzip, de **422 KB para 184 KB**. Isso mede o arquivo de entrada, não a soma de todos os chunks visitados durante uma sessão. Bibliotecas de gráficos e páginas saíram do caminho estático de entrada. Os grandes módulos de 3D continuam disponíveis sob demanda.

O snapshot do dashboard reduz oito consultas sequenciais para uma, mantendo agregação e filtro de período no cliente. As consultas grandes usam o sinal de cancelamento do React Query; trocar de tela não deixa a sequência inteira de leitura rodando desnecessariamente.

## Polling da extensão na VPS

Na janela de 24 h encerrada em 01/10 às 23:16 UTC foram observadas aproximadamente 1,58 milhão de invocações de API e 30,5 mil respostas 5xx. Esses totais são da janela anterior à correção, não uma medição da queda posterior. `instancia-central` recebeu 80.019 chamadas, das quais 69.840 vieram da VPS. O código do popup consultava esse endpoint em cada atualização local de um segundo.

A correção mantém os contadores locais a cada segundo, consulta a função central ao abrir ou trocar de vendedor e reconcilia a cada minuto. Leituras simultâneas compartilham a requisição; requisições têm prazo de aborto de dez segundos. Marcar/liberar a central força uma leitura nova, e respostas atrasadas não sobrescrevem o vendedor ou a ação corrente. A titularidade da central e o background não mudaram.

Um popup aberto continuamente passa de aproximadamente 86.400 para 1.440 consultas diárias, mais abertura e ações explícitas: cerca de **98% menos nesse caminho**. Não é uma medição de redução de 98% no total da frota. O patch foi publicado nas **11 cópias existentes da VPS**, com hash confirmado e backups em `/opt/branorte/backups/crm-performance-20261001/<seller>/popup.js`.

Popups já abertos precisam fechar e abrir para carregar o novo script. Nenhum container foi reiniciado. A instalação do Windows não foi alterada; o pacote de correção e a validação estão em [popup-central-throttle.md](../tools/vps/popup-central-throttle.md). Os arquivos completos legados contêm credenciais e não foram adicionados ao Git.

## Verificação da implementação

- Suíte do CRM: **1.116 testes, todos passaram**.
- Extensão: **8 testes de concorrência, timeout, troca de vendedor e ações manuais passaram**; sintaxe verificada.
- Banco: comparação integral do snapshot em papéis reais; anonimato negado; fixtures do índice em transação revertida; índice válido/pronto/ativo.
- Build de produção concluído e revisão independente sem bloqueadores.
- Verificação de interface na prévia e produção ainda pendente neste registro inicial.

## Gargalos restantes e próximas correções candidatas

### Refresh do pool de prospecção

`refresh_pool_prospeccao` atualiza duas materialized views a cada cinco minutos. A definição de `mv_contato_fora_do_pool` examina cerca de 213.650 contatos estimados, recalcula normalizações e critérios, e repete conjuntos de existência para classificação e filtragem. Seu plano apresentou custo estimado de 2.329.147,59. Os índices dos vínculos principais já existem, incluindo orçamento por contato, telefone de contato com dono, resumo WhatsApp e atendimento ativo.

Próxima candidata: reduzir avaliações repetidas com conjuntos calculados uma vez, mantendo exatamente a precedência dos motivos e a elegibilidade atual. Exige teste de equivalência antes de substituir a consulta. Não foi alterada nesta auditoria. O cron do pool coincide com o refresh de `mv_mapa_orcamentos` nos minutos `4-59/5`, criando concorrência periódica de trabalho; nenhum intervalo foi modificado.

### Recálculo de status de contatos

`recompute_contact_status` percorre contatos, junta etiquetas e chama `wa_status_do_contato` para derivar o status, atualizando apenas diferenças. Os índices dos joins principais estão presentes. A próxima investigação deve medir avaliações repetidas da expressão de status e avaliar cálculo único ou processamento incremental, com equivalência dos resultados. Não foi executado manualmente nem alterado.

### Visão de atendimentos

`atendimentos_por_cliente` usa muitas janelas `first_value` com ordens diferentes. Um único índice de agrupamento não elimina todas essas ordenações. O vínculo lateral com disparos já usa `idx_outbound_dispatch_strip9_sent`, com a expressão de telefone e data correta; um índice duplicado não resolveria os arquivos temporários observados.

O snapshot reduz passagens repetidas e tamanho da resposta. Uma futura reescrita da visão precisará preservar a escolha da conversa representativa e todos os valores agregados; não foi feita nesta etapa.

### Volume histórico

O catálogo estimava `wa_sync_debug` em 2,55 milhões de registros e 1,62 GB totais; `audit_events`, em aproximadamente 725 mil registros e 1,03 GB totais, incluindo índices e armazenamento associado. São candidatos a uma revisão específica de retenção e das consultas sobre histórico. Nenhum dado foi excluído. Estimativas do catálogo não substituem contagens exatas, e nenhuma contagem ampla foi executada para confirmá-las.

## Limites e referências

Esta auditoria não executou carga artificial contra endpoints de clientes, não enviou mensagens e não fez `EXPLAIN ANALYZE` em jobs ou atualizações. Os ganhos de cron e a equivalência do snapshot estão medidos; a latência completa da interface e a estabilidade prolongada exigem observação após publicação. O índice acrescenta armazenamento e manutenção nas escritas; não altera permissões ou filtros.

O desenho segue as orientações do PostgreSQL sobre [índices multicoluna](https://www.postgresql.org/docs/current/indexes-multicolumn.html) e [criação concorrente de índices](https://www.postgresql.org/docs/current/sql-createindex.html). Índices iniciados pelo predicado de igualdade permitem limitar a faixa percorrida; `CONCURRENTLY` evita bloquear as escritas durante a construção e deve ser executado fora de uma transação explícita.
