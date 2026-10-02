# Kanban de consulta da produção da fábrica

Correção da apresentação na rota `/controle/producao/fabrica`: o catálogo paginado passou a oferecer Kanban como modo inicial e Lista como alternativa. O quadro agrupa o conjunto integral filtrado, sem aplicar o corte de 25 itens da lista. Contadores e rolagem independente por coluna mantêm todos os cards acessíveis, incluindo excluídos, cancelados e status adicionais. A ordem conhecida foi conferida no consumidor externo `ProducaoExterna.tsx` e na Edge Function `get-dashboard-producao`; estados adicionais conservam seu valor físico.

Cards exibem orçamento, cliente, vendedor, equipamento e prazo físico quando informados. O clique abre a ficha em modal de consulta com as coleções existentes. Fechar retorna o foco ao botão de origem se ele ainda estiver conectado e presente no recorte. Alteração de filtros, modo, identidade ou momento da consulta invalida a seleção. Negação, erro e carregamento retiram dados e modal sincronamente.

API, reader, permissões, autenticação, contratos de dados, variáveis privadas e bancos não foram alterados. O CRM continua usando a fábrica como fonte somente de leitura.

Verificação: três novos casos SSR, com duas falhas comportamentais antes da implementação e três passes depois; testes existentes de filtro, contexto, decoder e autoridade conservados. QA CUA com fixture sintética local confirmou filtro de etapa, modal e foco, nova consulta na mesma identidade, retirada integral em erro e lista com acesso ao card 32 na segunda página. As fixtures locais permanecem ignoradas e excluídas da publicação.

Os resultados finais de full suite/build e a verificação da publicação são registrados pelo root em `outputs/Unificacao-Branorte-kanban-publicado.txt` no workspace da tarefa. Erros anteriores do TypeScript fora desta alteração não são apresentados como resolvidos.
