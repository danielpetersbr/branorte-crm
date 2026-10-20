# Vínculo automático da lista 3D ao catálogo

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox syntax for tracking.

**Goal:** Abrir a lista enviada pelo projeto já vinculada aos equipamentos correspondentes no catálogo comercial, com preço, descrição, foto e acionamento atuais.

**Architecture:** Resolver identidade comercial de forma determinística usando o catálogo ativo carregado no CRM. Reaproveitar o cálculo e a validação usados no vínculo manual; preservar identidade, sequência, quantidades e acessórios do projeto. Somente correspondências únicas recebem preço automaticamente; exceções continuam disponíveis para conferência.

**Tech Stack:** React, TypeScript, React Query, testes node:test/tsx, Vite, Vercel.

**Spec:** Pedido na conversa de 20/10/2026: vincular automaticamente equipamentos já cadastrados no orçamento. Regras de nomenclatura e variantes conferidas em `equipment-commercial-name-evidence.md` do configurador e no catálogo visível atual do CRM.

## Global Constraints

- Não atribuir FK comercial a partir do código do CAD; não usar preços históricos.
- Não converter dimensões externas em comprimento nominal nem litros em kg sem campo explícito do cadastro.
- Preservar variantes de material, tipo de transportador, capacidade e acionamento.
- Não sobrescrever linhas já vinculadas/manuais ou alterações recuperadas de acessórios.
- Manter edição e exclusão existentes; não emitir orçamento de teste no banco.

## Review Focus

- Homônimos e registros duplicados ficam pendentes.
- Cadastros não oficiais/inativos não entram no vínculo automático.
- Voltagem do rascunho recuperado orienta o preço e os motores.
- Falha de preço/motor em uma linha não impede os demais vínculos.
- Carregamento tardio do catálogo/preços não congela uma importação sem vínculos.

## Tasks

- [x] Criar testes que falham e matcher puro em `src/lib/projeto-3d-catalogo-match.ts`: nominal dos transportadores, moinho por potência e famílias com capacidades literais, preservando variantes e unicidade.
- [x] Criar testes que falham e orquestrador em `src/lib/projeto-3d-auto-vinculo.ts`: aplicar callback de preço às linhas pendentes correspondentes, preservando linhas sem match e erros locais.
- [x] Integrar hidratação nova e de rascunhos existentes em `OrcamentoMontar.tsx`, aguardando todas as fontes comerciais e usando voltagem explícita na factory; compartilhar validação com o vínculo manual.
- [x] Mostrar no painel o produto comercial vinculado e orientar somente exceções para conferência. Verificar integração real com testes da página, build e revisão independente.
- [x] Publicar no projeto CRM conferido, protegendo mudanças concorrentes, e verificar no navegador com projeto de validação, incluindo rascunho pendente anterior.

## Evidência final

- 92/92 testes focais passaram; depois de explicitar tipos, os 28 testes afetados de orquestração e página passaram novamente. Build local e remoto passaram. A checagem TypeScript geral mantém erros anteriores (incluindo `uf` em `PreviewClienteDados`); não restaram erros nos novos módulos ou trechos alterados.
- Suíte ampla: 2.084 testes, com 14 falhas na rodada anterior à atualização da fixture de hidratação. Essa fixture foi corrigida e passou no gate focal final. As outras 13 falhas foram reproduzidas no HEAD anterior `7169eb0`, em snapshot isolado: 66 testes, 53 passaram e as mesmas 13 falharam. Arquivos desses cinco testes e suas três páginas envolvidas são idênticos ao HEAD por SHA256.
- Revisão independente encontrou e confirmou a correção de três riscos: capacidades literais conflitantes nas especificações, variantes COM/SEM pulmão ou aquecimento, e preservação de preço/foto/descrição editados antes da confirmação da linha.
- Runtime publicado: `081c9d8104191609302fff3a346df0898e276e93`; deployment `dpl_DL57iU16r3rLvsRGU98Y2ZgFVUzg` READY, projeto `prj_DEmdYUBr3O0QHWiyVWPEvqkwVvnD`. Promoção guardada pela identidade da produção anterior. Os aliases `sistema.mbranorte.com.br` e `branorte-crm.vercel.app` apontaram para esse deployment e responderam HTTP 200.
- QA no navegador: um rascunho criado antes da publicação tinha três linhas pendentes. Após recarregar, o transportador nominal 160 × 3,5 m e o moinho de 20 CV receberam automaticamente seus cadastros; o transportador sem nominal, identificado apenas por medidas externas, continuou para conferência.
- Nova transferência com os dois equipamentos conhecidos abriu com **Itens precificados**, os dois vínculos, fotos, especificações e motores atuais; os dois acessórios descritivos continuaram separados e os excluídos ficaram fora. Não foi necessário clicar em Aplicar preço e nenhum orçamento de teste foi emitido ou gravado no banco.
- Captura nos outputs da conversa: `equipamentos-vinculados-automaticamente.png`.
