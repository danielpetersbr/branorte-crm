# Escritório — visão do gestor

## Objetivo

Transformar o bloco **Escritório** de `/disparos` em uma tela que permita ao gestor responder, em poucos segundos:

1. Quem está trabalhando agora?
2. O que cada vendedor produziu hoje?
3. Quem está impedido de receber leads ou precisa de intervenção?
4. Quem lidera cada indicador no dia ou no mês?

O mapa do escritório continua sendo a referência visual. A mudança organiza as informações ao redor dele e substitui os dois rankings estreitos por uma única leitura gerencial.

## Problemas observados

- Os indicadores individuais aparecem como uma faixa de emojis e números pequenos, sem rótulos visíveis.
- Produção do dia, estoque da carteira e presença operacional ficam misturados.
- O detalhe completo depende de hover, o que prejudica toque, acessibilidade e descoberta.
- Os rankings de dia e mês repetem estrutura, ocupam muita largura e não ajudam a identificar gargalos.
- A cota de clientes parados já existe em `/disparos`, mas o mapa não a recebe; por isso o gestor não vê no escritório quem está bloqueado para novos leads.
- “Vendido” e “conversão” no ranking diário vêm do estoque total do funil, não de vendas fechadas hoje. Eles não devem ser apresentados como produção diária.

## Direção aprovada

### 1. Cabeçalho e resumo do dia

O cabeçalho passa a dizer **Escritório do time**, com selo “Ao vivo” e horário da última atualização.

Logo abaixo, quatro indicadores grandes e nomeados:

- Atendimentos hoje
- Leads recebidos hoje
- Orçamentos hoje
- Pessoas que precisam de atenção

O quarto indicador soma apenas situações acionáveis: WhatsApp fechado/desconectado em horário comercial ou vendedor cortado pela cota de parados. Não usa cor de alerta para posições de ranking.

### 2. Mapa do escritório

O mapa, paredes, mesas, drag-and-drop e modos de edição permanecem funcionais.

Cada vendedor sentado mostra apenas três métricas visíveis e rotuladas:

- Atendimentos
- Leads
- Orçamentos

O status aparece com texto curto e cor: trabalhando, parado, lento ou offline. Um marcador de atenção aparece quando houver problema operacional ou corte pela cota.

Ao clicar ou tocar em um vendedor, o painel gerencial seleciona a mesma pessoa. O detalhe não depende de hover. O `FunilCard` atual pode continuar disponível durante a transição, mas o clique será a interação principal.

### 3. Leitura do gestor

À direita do mapa haverá uma única coluna com:

1. Alertas acionáveis, em ordem de gravidade.
2. Tabela comparativa dos vendedores.
3. Resumo da pessoa selecionada.

Alertas iniciais:

- vendedor cortado pela cota, com quantidade de clientes parados e limite;
- vendedor acima do limite, mesmo quando ainda recebe parcialmente;
- WhatsApp fechado ou desconectado durante o expediente;
- destaque positivo do líder de orçamentos, sem aparência de erro.

A tabela do período **Hoje** terá:

| Campo | Fonte |
|---|---|
| Vendedor | `vendedores` |
| Status | `live` |
| Atendimentos | `escritorio_funil_vivo.atendimentos` |
| Leads | `escritorio_leads_hoje` |
| Orçamentos | `orcamentos_gerados` do dia |
| Ligações atendidas | `escritorio_ligacoes_prospec_hoje` |
| Pendências | `vendor_roteamento_efetivo.parados_topo` |

A ordenação padrão será “precisa de atenção”. O usuário poderá ordenar pelas colunas principais.

### 4. Períodos

O painel comparativo terá dois períodos:

- **Hoje**: todas as métricas operacionais e de produção disponíveis.
- **Mês**: atendimentos, leads e orçamentos vindos de `escritorio_ranking_mes`.

Não será criado um seletor de 7 dias nesta entrega. A seção **Atividade Diária**, imediatamente acima do escritório, já atende essa análise. Adicionar 7 dias ao escritório exigiria agregar novas fontes para leads e orçamentos e poderia apresentar períodos incompletos como se fossem equivalentes.

### 5. Detalhe do vendedor

Selecionar uma mesa ou linha mostra:

- status atual e tempo desde o último sinal;
- atendimentos, leads, orçamentos e ligações do dia;
- follow-ups, leads quentes e clientes parados;
- motivo explícito quando não recebe leads;
- resumo do funil atual.

O conteúdo essencial será visível por clique e por teclado. Tooltips ficam apenas para explicar definições, como a limitação da direção das ligações.

## Arquitetura

`EscritorioMapa.tsx` já concentra consulta, regras, desenho da planta e rankings em mais de 1.200 linhas. A mudança deve separar apresentação gerencial sem reescrever o mapa.

### Componentes

- `EscritorioMapa.tsx`
  - mantém consultas, edição de paredes/mesas e desenho da planta;
  - monta um modelo normalizado por vendedor;
  - sincroniza a seleção entre mesa e painel.
- `EscritorioGestor.tsx` (novo)
  - renderiza KPIs, alertas, período, tabela e detalhe selecionado;
  - recebe dados prontos por propriedades, sem consultar Supabase diretamente.
- `escritorio-gestor.ts` (novo)
  - tipos e funções puras para normalizar vendedores, gerar alertas, ordenar linhas e calcular KPIs.
- `Disparos.tsx`
  - passa `vendor_roteamento_efetivo`, ativação e limite da cota para `EscritorioMapa`.

As funções puras isolam regras de negócio e permitem testes sem renderizar React ou acessar Supabase.

## Estados e falhas

- Enquanto uma fonte carrega, exibir `—` na métrica correspondente; não converter ausência em zero silenciosamente.
- Se o ranking mensal falhar, a visão “Hoje” continua disponível e “Mês” mostra mensagem de indisponibilidade.
- Vendedores administrativos continuam visíveis nas mesas, mas não entram em métricas ou ranking.
- Sem vendedor selecionado, selecionar automaticamente o primeiro alerta; se não houver alerta, selecionar o líder de atendimentos.
- Em telas menores, mapa e painel ficam empilhados; a tabela aceita rolagem horizontal sem vazar a página.

## Acessibilidade e linguagem

- Métricas importantes terão ícone, nome e valor; nunca depender apenas de emoji ou cor.
- Estados usarão texto além da cor.
- Mesas e linhas serão acionáveis por teclado e terão `aria-label` descritivo.
- Alertas serão escritos como ação: “Ramon não recebe novos leads: 109 clientes parados; limite 60”.
- O termo “ligações atendidas” será preservado, pois a direção da chamada não é confiável.

## Testes e validação

### Testes unitários

- KPIs somam apenas vendedores elegíveis.
- Alertas respeitam horário comercial, status e configuração da cota.
- Corte total e redução parcial geram textos diferentes.
- Ordenação por atenção coloca bloqueios antes de destaques positivos.
- Ranking diário não trata estoque de vendidos como vendas do dia.
- Ausência de dados produz `null`/`—`, não zero enganoso.

### Verificação visual e funcional

- Desktop largo: mapa e painel lado a lado sem sobreposição.
- Tablet e celular: blocos empilhados e tabela contida.
- Tema claro e escuro.
- Clique em mesa seleciona a linha e atualiza o detalhe.
- Clique/teclado na linha destaca a mesa correspondente.
- Drag-and-drop, edição de paredes e edição de mesas continuam funcionando.
- Build de produção e suíte de testes existentes passam.

## Fora de escopo

- Novas metas comerciais configuráveis.
- Notificações por WhatsApp ou e-mail.
- Novo RPC de agregação para sete dias.
- Alteração das regras de roteamento ou da cota de parados.
- Mudança das fontes usadas para atendimentos, leads, orçamentos ou ligações.

## Critérios de aceite

1. O gestor identifica quem está ativo, o total produzido hoje e os bloqueios sem depender de hover.
2. Todos os números visíveis têm rótulo ou cabeçalho legível.
3. Produção do dia e estoque da carteira são visualmente distintos.
4. Os rankings duplicados são substituídos por um painel único com períodos Hoje/Mês.
5. O mapa e seus controles atuais continuam funcionais.
6. A interface permanece utilizável a partir de 360 px e nos temas claro e escuro.
