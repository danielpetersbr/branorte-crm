# Acessórios dos projetos 3D: padrão de 15%

Solicitação de 20/10/2026: novas transferências do projeto 3D com peças auxiliares criam o bloco Acessórios em 15%, com `valorFixo: null`. O percentual acompanha o valor e a quantidade dos equipamentos e continua editável no modal existente. Sem coleção de acessórios, não é criado um bloco vazio.

A base segue a regra já utilizada pelo montador: soma os equipamentos cobrados, excluindo brindes, itens inclusos, fornecimento do cliente e linhas desmarcadas na base de acessórios; não soma a tabela separada de motores nem componentes extras. Motor já embutido no preço de um equipamento permanece nesse preço. O resultado é arredondado para cima, sem centavos.

As peças continuam descritas no bloco próprio, sem virar equipamentos nem serem cobradas individualmente por cima do percentual. Prévia, persistência e DOCX recebem o mesmo valor calculado; FINAME incorpora os acessórios uma vez nos equipamentos.

Rascunhos recuperados e orçamentos salvos conservam percentuais e valores ajustados, inclusive o zero legado. O novo padrão não altera retroativamente propostas existentes. Os avisos agora distinguem percentual a calcular de um bloco legado sem cobrança.

## Verificação

- Teste de contrato confirmou RED (0 em vez de 15) antes da implementação.
- 109 testes focais passaram, cobrindo contrato 3D, vínculos automáticos, base e quantidades, exclusões, recálculo, arredondamento, recuperação de percentuais/valores editados e zero legado, FINAME e Word sem duplicação.
- Build local passou; checagem TypeScript geral permanece com os erros anteriores fora desta alteração, sem novo erro nos arquivos alterados.
- Build remoto e publicação confirmados: fonte `b937156f70b5bf61c8c0fae7c9b5ab701392d415`, deployment `dpl_9DVQs6UWE3zHm4EEoq8psqSoX8N8`, projeto CRM `prj_DEmdYUBr3O0QHWiyVWPEvqkwVvnD`. Guarda dos dois aliases confirmou a produção anterior antes de promover. `sistema.mbranorte.com.br` e `branorte-crm.vercel.app` apontaram para a nova versão e responderam HTTP 200.
- QA no endereço canônico: nova transferência com um moinho 20 CV e uma descarga acessória abriu automaticamente em 15%; base R$ 20.118,00, acessórios R$ 3.018,00, motor separado R$ 10.888,00 e proposta R$ 34.024,00. O modal abriu com percentual 15 e modo percentual, sem qualquer edição manual ou congelamento de valor.
- Nenhum orçamento de teste foi emitido ou gravado no banco. Captura nos outputs da conversa: `acessorios-padrao-15-porcento.png`.
