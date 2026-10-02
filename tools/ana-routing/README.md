# Repasse da Ana para vendedores autorizados

Os patches têm como base os snapshots completos de produção de `ia-atendente` versão 255 e `dispatch-poll` versão 30. Não usar os entrypoints antigos deste repositório para reconstruir as funções.

O delta amplia somente a lista explícita para DANIEL, RAMON, GUSTAVO, ALVARO, EDER, EDILSON JR, IGOR, JARDEL, LUCAS e PEDRO e remove a promessa dos três nomes nos dois trechos do prompt. Contingência, catálogo/preços, qualificação, fila restrita da Ana e consulta de dúvidas continuam com os controles existentes. A disponibilidade real e os destinos são validados pelas funções de roteamento no banco, revisadas separadamente.

## Reconstrução e conferência

1. Recuperar os snapshots completos e conferir as versões e hashes abaixo. Se a produção avançou, revisar/rebasear; não sobrescrever a versão nova.
2. Aplicar `transformations.json` (array com uma entrada por função) aos arquivos indicados, exigindo `countExpected` para cada substituição. Alternativamente, aplicar o patch correspondente no diretório da função. Os snippets não contêm credenciais.
3. Manter todos os módulos e arquivos do snapshot, inclusive `crm-gate.ts`, sem alterações. Conferir SHA-256 e sintaxe do candidato. As cópias completas ficam fora do Git em `outputs/ana-routing-candidate`, com `source-metadata.json`.
4. Executar `node --test tools/ana-routing/repasse-allowlist.test.cjs`, apontando `ANA_ROUTING_IA_SOURCE` e `ANA_ROUTING_POLL_SOURCE` para os entrypoints reconstruídos. Para regressão do gate CRM, apontar `CRM_ANA_EDGE_SOURCE` para o mesmo candidato da IA e executar `node --test tools/vps/cloud-ana-gate.test.cjs`.
5. Publicar somente após revisão e alinhamento das funções/configuração do banco. Estes testes usam código real extraído dos candidatos e banco simulado; não enviam mensagens nem reivindicam filas reais.

| Arquivo | SHA-256 base | SHA-256 candidato |
| --- | --- | --- |
| ia-atendente/index.ts | 412ae8432ff2d1c496e635c8a78c3e92c36cf0c29fb2badd700449d1e05d85f3 | 177cbe19e5b017ddd079b1d3127e34dab59226909a0f600729682b7e3e731ae6 |
| dispatch-poll/index.ts | d1b9c6463a49f702b820e2e495150713eeaab0b66558ff386d5743a5181ba2d4 | 542a7f2266b564d0a7ab646da6f0fbc18fe1eae9fc3d2eb7fbc38047d9db1aaa |
| ia-atendente/crm-gate.ts (inalterado) | 66f423d70c999720046e0cd23faa93b782ec6a715f51a26b97aea671b7b5e794 | 66f423d70c999720046e0cd23faa93b782ec6a715f51a26b97aea671b7b5e794 |

Os hashes são dos arquivos UTF-8 com LF da cópia preservada, incluindo seu newline final. Se o snapshot retornado pela API só diferir nesse newline final, documentar a diferença e normalizar somente esse término antes da comparação; não normalizar o corpo da função.

## Publicação em 02/10/2026

Publicados `ia-atendente` v256 e `dispatch-poll` v31, com conteúdo conferido após deploy. A migração `20261002180644_ana_vendedores_ativos_repasse.sql` ampliou somente seis listas nas três funções existentes, preservando permissões e verificações. O nome do arquivo acompanha a versão efetivamente registrada pelo Supabase.

Após conferir ambas as Edges e os três hashes SQL, a ativação condicionada em `activate-pool.sql` mudou somente `ia_config.ana_contingencia_preco.valor.v.vendedores_repasse` e seu timestamp às 15:07:52 BRT. O arquivo é uma evidência do rollout único e rejeita reexecução/drift. Os sete novos destinos são Álvaro, Eder, Edilson Jr, Igor, Jardel, Lucas e Pedro; os três anteriores permanecem. Patrick não tem telefone/configuração interna e ficou fora. Flags dos vendedores, prospecção, preços e contingência foram preservados.

Validação: 13 testes das Edges/gate CRM, 40 verificações SQL com rollback e 1.410 testes Node passaram. Os testes SQL usam a configuração de três nomes antes da ativação, em transação com a migração; não são uma instrução para redefinir a configuração atual. Fixtures não persistiram nem produziram envios. Revisão independente, sintaxe e reconstrução dos patches passaram. Advisors de segurança mantiveram os mesmos oito grupos, sem achado novo.
