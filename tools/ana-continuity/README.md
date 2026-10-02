# Continuidade de equipamentos da Ana — baseline v256

Correção da conversa em que a resposta direta sobre energia acabava no texto genérico de continuidade: na contingência da Ana, equipamento comercial identificado e aplicação declarada podem qualificar sem animal/cabeças. Cidade/UF continuam obrigatórias quando `anaSemCidade` está desligada. A identificação reaproveita `alvoEquipAna(..., false)`, sem inferir tipo, capacidade ou compatibilidade. A constante de qualificação geral permanece desligada.

A energia só é recuperada de uma declaração curta do cliente após uma pergunta de energia da Ana. Perguntas, negativas e duas alternativas não confirmam a rede; valores extraídos apenas pelo modelo não substituem a memória confirmada. A persistência nova é limitada à porteira da Ana. Quando falta uma pergunta de qualificação, a continuação reconhece a energia e pergunta o dado pendente. A confirmação de destino e as travas de atendimento humano, consultas, encerramento, configuração e deduplicação permanecem no caminho existente.

O pós-pacote passa a transportar o valor de qualificação calculado para os dados atuais; `pos` sozinho não autoriza repasse. Tipos ambíguos, equipamento genérico, aplicação ausente, peças e materiais fora do escopo não recebem a nova qualificação.

## Reconstrução e revisão

As fontes completas ficam fora do Git, em `outputs/ana-continuity-baseline/ia-atendente` e `outputs/ana-continuity-candidate/ia-atendente`, na raiz da tarefa. Somente `index.ts` é alterado; `crm-gate.ts` deve ser copiado sem alterações.

`transformations.json` contém o slug, a versão esperada e todas as substituições exatas. Para reconstruir, validar os hashes do baseline, exigir `countExpected` em cada substituição sequencial, aplicar os pares `before`/`after` e comparar byte a byte com o candidato. Preservar LF e a quebra de linha final; não retransmitir fontes completas em logs. O patch usa os caminhos relativos `a/index.ts` e `b/index.ts` e pode ser conferido com `git apply --check` na pasta do baseline. A aplicação parte da v256; em outra versão, refazer a comparação com a fonte ativa antes de aplicar.

| Arquivo | SHA-256 |
| --- | --- |
| Baseline v256 `index.ts` | `177cbe19e5b017ddd079b1d3127e34dab59226909a0f600729682b7e3e731ae6` |
| Candidato `index.ts` | `984421c7cf221e77fec3930913c24d32c02f07f002a2eb49e6d07f952a11c842` |
| `crm-gate.ts`, ambos | `66f423d70c999720046e0cd23faa93b782ec6a715f51a26b97aea671b7b5e794` |

## Verificação local

Os testes compilam e executam funções, expressões e blocos reais da fonte privada com TypeScript/VM. Não carregam o entrypoint Edge nem enviam mensagens. `ANA_CONTINUITY_SOURCE` permite apontar para o baseline e observar RED.

```powershell
node --test tools/ana-continuity/continuity.test.cjs tools/ana-continuity/continuity-regression.test.cjs
```

Também executar as proteções existentes, apontando ambas as variáveis abaixo ao candidato de `index.ts`:

```powershell
$env:CRM_ANA_EDGE_SOURCE = '<caminho absoluto do candidato index.ts>'
$env:ANA_ROUTING_IA_SOURCE = $env:CRM_ANA_EDGE_SOURCE
node --test tools/ana-routing/repasse-allowlist.test.cjs tools/vps/cloud-ana-gate.test.cjs
```

Evidência inicial: baseline RED por bloqueio de qualificação, energia ausente, persistência ausente e fallback genérico. Candidato: 20/20 testes de continuidade e 13/13 proteções passaram; parser TypeScript sem diagnósticos, reconstrução exata e `crm-gate.ts` idêntico. A suíte do CRM passou inicialmente com 1.430/1.430 testes; após integrar a versão atual de `main`, a nova execução passou com 1.488/1.488 testes e as 33 verificações direcionadas permaneceram verdes. Logs `outputs/ana-continuity-red.log`, `ana-continuity-green.log`, `ana-continuity-protections.log`, `ana-continuity-independent-full-suite.log`, `ana-continuity-final-targeted.log` e `ana-continuity-final-merged-suite.log`.

## Publicação e acompanhamento

A função `ia-atendente` foi publicada como v257 em 02/10/2026 às 16:34:07 BRT. A leitura posterior, às 16:37:32 BRT, confirmou `ACTIVE`, `verify_jwt=false` e os dois arquivos idênticos byte a byte ao candidato revisado. O SHA-256 do pacote retornado pelo Supabase é `d6819f3a75b985e89f1c71a4a8d764ac6df855465f8a770dcfa3349b57293178`; o hash da fonte `index.ts` permanece o da tabela acima.

A configuração de contingência manteve o MD5 `df2169ad4e793643ea400505e336d99c` e o pool autorizado de RAMON, GUSTAVO, ALVARO, EDER, EDILSON JR, IGOR, JARDEL, LUCAS e PEDRO. Não houve alteração de SQL, `dispatch-poll` ou VPS nesta correção.

Os testes e a conferência da publicação validam o código. A confirmação de envio dos próximos repasses depende de `outbound_dispatch.sent_at`; a entrega ao destinatário requer confirmação própria. O vigia continua fazendo consultas de leitura, sem reenviar filas legadas ou disparar mensagens de teste.
