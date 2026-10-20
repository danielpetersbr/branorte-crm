# Acessórios dos projetos 3D: padrão de 15%

Solicitação de 20/10/2026: novas transferências do projeto 3D com peças auxiliares criam o bloco Acessórios em 15%, com `valorFixo: null`. O percentual acompanha o valor e a quantidade dos equipamentos e continua editável no modal existente. Sem coleção de acessórios, não é criado um bloco vazio.

A base segue a regra já utilizada pelo montador: soma os equipamentos cobrados, excluindo brindes, itens inclusos, fornecimento do cliente e linhas desmarcadas na base de acessórios; não soma a tabela separada de motores nem componentes extras. Motor já embutido no preço de um equipamento permanece nesse preço. O resultado é arredondado para cima, sem centavos.

As peças continuam descritas no bloco próprio, sem virar equipamentos nem serem cobradas individualmente por cima do percentual. Prévia, persistência e DOCX recebem o mesmo valor calculado; FINAME incorpora os acessórios uma vez nos equipamentos.

Rascunhos recuperados e orçamentos salvos conservam percentuais e valores ajustados, inclusive o zero legado. O novo padrão não altera retroativamente propostas existentes. Os avisos agora distinguem percentual a calcular de um bloco legado sem cobrança.
