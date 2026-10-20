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

- [ ] Criar testes que falham e matcher puro em `src/lib/projeto-3d-catalogo-match.ts`: nominal dos transportadores, moinho por potência e famílias com capacidades literais, preservando variantes e unicidade.
- [ ] Criar testes que falham e orquestrador em `src/lib/projeto-3d-auto-vinculo.ts`: aplicar callback de preço às linhas pendentes correspondentes, preservando linhas sem match e erros locais.
- [ ] Integrar hidratação nova e de rascunhos existentes em `OrcamentoMontar.tsx`, aguardando todas as fontes comerciais e usando voltagem explícita na factory; compartilhar validação com o vínculo manual.
- [ ] Mostrar no painel o produto comercial vinculado e orientar somente exceções para conferência. Verificar integração real com testes da página, build e revisão independente.
- [ ] Publicar no projeto CRM conferido, protegendo mudanças concorrentes, e verificar no navegador com projeto de validação, incluindo rascunho pendente anterior.
