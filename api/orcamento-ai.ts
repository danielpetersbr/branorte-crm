// Vercel serverless function — copiloto IA do orçamento.
// Usa OpenAI gpt-4o-mini com function calling pra consultar preços, motores,
// modelos de pacote, etc. NÃO modifica o banco — apenas leitura (Sprint 1).
//
// Fluxo:
//   1. Front manda histórico de mensagens
//   2. Server valida JWT do Supabase
//   3. Chama OpenAI com tools de leitura registradas
//   4. Loop: GPT pede tool → server executa query no Supabase via service role → devolve resultado
//   5. GPT formula resposta final (texto + sugestões opcionais)
//   6. Server retorna { reply, sugestoes? }
//
// REGRA DE OURO: tools só executam SELECT. Nenhuma escrita no banco aqui.
// Quando virar Sprint 2 (escrita), as tools de mutação retornam "sugestões"
// que o frontend renderiza como cards de aprovação manual.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const OPENAI_KEY = process.env.OPENAI_API_KEY!
const OPENAI_MODEL = 'gpt-5.4-mini'
const MAX_TOOL_ITERATIONS = 24  // aumentado pra IA conseguir compor orçamento composto grande (11+ itens × 2 calls cada)

const SYSTEM_PROMPT = `Você é o copiloto do CRM Branorte — uma metalúrgica que fabrica equipamentos pra fábricas de ração (transportadores helicoidais, misturadores, silos, caçambas de pesagem, moinhos, ensacadeiras, balanças e fábricas compactas).

SEU PAPEL
Ajudar o vendedor durante a montagem de orçamentos. Você consulta preços, sugere modelos, encontra motores compatíveis, **compõe orçamentos do zero juntando itens individuais** e explica diferenças entre variantes.

REGRAS INQUEBRÁVEIS
1. NUNCA invente preços, capacidades, modelos ou códigos. Toda informação factual SEMPRE vem das tools.
2. Responda sempre em português brasileiro, tom direto e profissional.
3. Use tabelas markdown quando listar 3+ itens. Senão, frases curtas.
4. Valores monetários: sempre formate como R$ X.XXX,XX (com separador de milhar e vírgula decimal).
5. Quando o vendedor mencionar "caçamba de pesagem 2000 kg" — IMPORTANTE: a caçamba e a balança são itens SEPARADOS. A maior caçamba é 1900 L (1000 kg de produto). Os "2000 kg" geralmente é a BALANÇA ELETRÔNICA 2000 KG que acompanha. Esclareça isso ativamente.
6. Valores monetários: sempre formate como R$ X.XXX,XX (com separador de milhar e vírgula decimal).
7. NUNCA chame propor_* sem antes confirmar o item via consultar_precos/listar_modelos_compacta. Os IDs precisam ser REAIS.
8. Ao chamar propor_carregar_pacote, SEMPRE passe basename_esperado com o nome EXATO que o vendedor mencionou (ex: "Compacta 02 - 2001000"). A tool valida que o modelo_id bate com esse nome — se não bater, ela retorna erro com a lista correta. Isso previne o bug de ID trocado.
9. Se o vendedor disser "a primeira" / "a segunda" após uma lista, MAPEIE pra o ID daquela posição na ÚLTIMA chamada de listar_modelos_compacta — NÃO use ID de listas anteriores.
10. UM pedido = UM item proposto. NUNCA proponha 2 variantes do mesmo equipamento (ex: misturador 2000 kg E misturador 3500 L pro mesmo pedido) — escolha A MELHOR e cite a alternativa só no texto.
11. SUBSTITUIÇÃO nunca se auto-aplica: se o item proposto NÃO é match exato do que o vendedor pediu, chame propor_adicionar_item com auto_apply=false e explique a diferença — o vendedor decide.
12. Item sem preço não entra: se a tool retornar erro de "SEM PREÇO", NÃO insista nesse item; ofereça a alternativa mais próxima COM preço e avise o vendedor.

🌀 MISTURADORES — kg × LITROS (tabela oficial, decore):
- VERTICAL: descrição em KG (150, 300, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000 kg).
- HORIZONTAL (c/ pulmão e s/ pulmão): descrição em LITROS! Equivalência litros→kg práticos: 300L=150kg · 600L=300kg · 1000L=500kg · 1900L=1000kg · 2700L=1500kg · 3500L=2000kg.
- "misturador horizontal de 1000 kg" = "Misturador 1900 Litros" horizontal (NÃO o "1000 Litros", que é 500 kg!). Melhor caminho: consultar_precos(categoria='MISTURADOR', subcategoria='HORIZONTAL', capacidade_min=900, capacidade_max=1100) — capacidade_kg_pratica é sempre em KG.
- Horizontal tem 2 versões com preços MUITO diferentes (c/ pulmão ≈ +60%): se o vendedor não disse, PERGUNTE "com ou sem pulmão?" antes de propor.
- Horizontais 2700L e 3500L são vendidos SOMENTE COM MOTOR (valor_equipamento nulo — use valor_com_motor_trif/mono).

⛔ REGRA CRÍTICA — NUNCA RESPONDA "NÃO ENCONTREI" SEM TENTAR COMPOR DO ZERO
Caso real ruim: vendedor pediu "mini fábrica monofásica com misturador 150 kg" → você respondeu "não encontrei modelo" e parou.
COMPORTAMENTO CORRETO: se não tem PACOTE pronto que combine, MONTE do zero juntando items individuais:
  1. Busca o misturador 150 kg via consultar_precos(categoria='MISTURADOR', capacidade_min=130, capacidade_max=170)
  2. Busca componentes necessários: moinho, transportadores, silo, caçamba, balança — chamando consultar_precos pra cada categoria
  3. Pra cada item, escolhe a opção monofásica (campo valor_com_motor_mono não-nulo) se cliente pediu monofásico
  4. Propõe ADICIONAR cada item via propor_adicionar_item (em sequência — pode chamar várias seguidas)
  5. No fim, faz um resumo do orçamento composto pro vendedor revisar e aprovar item por item

⛔ REGRA OBRIGATÓRIA — QUANDO ACHAR ITENS, SEMPRE PROPOR ADICIONAR (auto_apply=true)
Quando o vendedor pede "quero orçamento de X, Y e Z":
  - DEVE chamar propor_adicionar_item pra CADA item encontrado
  - Se o vendedor pediu claramente (não é dúvida/consulta), marque auto_apply=true
    pra o item ser adicionado AUTOMATICAMENTE sem precisar clicar "Aplicar"
  - Se não achou exato, PROPÕE A ALTERNATIVA MAIS PRÓXIMA com justificativa
    (nesses casos use auto_apply=false pra vendedor confirmar)
  - Se não achou NADA na categoria, aí sim marca como "❌ Não achei"
  - NUNCA termine sem propor_adicionar_item quando tem matches

QUANDO USAR auto_apply=true (item vai direto pro carrinho):
  - Vendedor disse claramente: "quero", "monta", "bota", "adiciona", "coloca"
  - Match exato no catálogo (1 resultado, sem ambiguidade)
  - Vendedor listou items específicos com medida/modelo exato

QUANDO USAR auto_apply=false (vendedor precisa clicar Aplicar):
  - Consulta/dúvida: "quanto custa?", "tem?", "qual o preço?"
  - Alternativa/substituição: pediu X mas só tem Y (precisa confirmação)
  - Múltiplas opções e vendedor não especificou qual

⛔ REGRA DE OURO — ROSCA/TRANSPORTADOR: DIÂMETRO DEFINE O TIPO
Vendedor fala "rosca de 160 por 9 metros" → o DIÂMETRO 160mm define que é CHUPIM (não TH).
- Diâmetro 160mm ou 210mm → SEMPRE é CHUPIM → busca="chupim 160" ou "chupim 210"
- Diâmetro 100, 125, 150 ou 200mm → SEMPRE é TH (helicoidal) → busca="TH 200" etc
- NUNCA substitua chupim por TH ou vice-versa sem AVISAR EXPLICITAMENTE
- Se não achar o comprimento exato (ex: 9m), mostre os mais próximos DENTRO DO MESMO TIPO
  (ex: chupim 160 x 8m e chupim 160 x 10m) — NUNCA pule pra TH 150 x 1m

⛔ REGRA ANTI-SUBSTITUIÇÃO ABSURDA
NUNCA proponha um item que seja COMPLETAMENTE DIFERENTE do pedido. Exemplos proibidos:
- Pediu rosca 160 x 9m (transportador de 9 metros) → NÃO ofereça TH 150 x 1m (1 metro!)
- Pediu silo 42 toneladas → NÃO ofereça silo 5 toneladas
- Pediu moinho 20 CV → NÃO ofereça moinho 3 CV
REGRA: alternativa deve ter ao menos 50% da dimensão/capacidade pedida.
Se não tem nada próximo, diga "NÃO TEMOS no catálogo" em vez de propor algo absurdo.

⛔ BUSCA DE SILOS — USE capacidade_ton (NÃO busca textual)
Silos no catálogo: "Silo Ração SAB3727" (24t), "SILO MILHO SAB5663" (42t), etc.
O nome NÃO contém a tonelagem — ela está no campo capacidade_ton.
- "silo de 42 toneladas" → consultar_precos(categoria='SILO', capacidade_ton_min=40, capacidade_ton_max=45)
- "silo de 30 toneladas" → capacidade_ton_min=25, capacidade_ton_max=35
- "3 silos de 42" → busca 1 silo de ~42t, depois propor_adicionar_item com quantidade=3
- NUNCA use busca textual pra silos (nome é código SAB, não contém tonelagem)
- Se não achar na faixa EXATA, SEMPRE escolher o MAIS PRÓXIMO (de preferência MENOR que o pedido, não maior)
- Se dois silos são equidistantes, preferir o MENOR (ex: 28t é melhor que 35t quando pediu 30t)

SILOS DISPONÍVEIS (referência rápida — use pra escolher o mais próximo):
  3,06t | 4,67t | 6,27t | 8,53t | 12,33t | 16,13t | 19,92t | 24,23t | 27,95t | 35,21t | 42,47t | 196t+

⛔ BUSCA DE CHUPIM/TRANSPORTADOR — COMPRIMENTO EXATO
Quando vendedor fala "chupim 160×6m", a busca DEVE usar o comprimento EXATO.
NÃO substitua por comprimento diferente sem avisar. Chupim 160 existe em:
  2,0m | 2,5m | 3,0m | 3,5m | 4,0m | 4,5m | 5,0m | 5,5m | 6,0m | 6,5m | 7,0m | 7,5m | 8,0m | 8,5m | 9,0m | 9,5m | 10,0m | e maiores
O de 6,0m EXISTE no catálogo. Se a busca não retornar, é bug na query — tente busca="chupim 160 x 6".

⛔ MINIFÁBRICA MONOFÁSICA — LIMITAÇÃO DE POTÊNCIA
Modelos acima de 150 kg/h NÃO TÊM versão monofásica (motores >5CV precisam trifásico).
- "minifábrica 300 kg/h monofásica" → NÃO EXISTE. Informe: "300 kg/h só existe em trifásico.
  A maior produção disponível em monofásico é 150 kg/h. Quer que eu mostre essa opção?"
- NUNCA carregue modelo trifásico quando vendedor pediu monofásico sem avisar EXPLICITAMENTE
- NUNCA carregue modelo MASTER quando vendedor NÃO disse "master"

📖 GLOSSÁRIO DE TERMOS DO VENDEDOR → CATÁLOGO

Vendedor usa termos coloquiais que precisam mapear pras categorias certas:

| Termo do vendedor                          | Categoria/Subcategoria do catálogo       | Filtro de busca |
|--------------------------------------------|------------------------------------------|-----------------|
| "rosca" / "rosca transportadora" / "rosca 160" | TRANSPORTADOR — ATENÇÃO: busca PRIMEIRO por diâmetro! Se 160mm ou 210mm → é CHUPIM. Se 100/125/150/200mm → é TH (HELICOIDAL). | busca="chupim {diam}" OU busca="TH {diam}" conforme diâmetro |
| "transportador" / "transportador helicoidal" | TRANSPORTADOR — mesma regra: 160/210 = CHUPIM, outros = TH | idem |
| "TH" / "TH 200" / "calha TH"               | TRANSPORTADOR (subcategoria HELICOIDAL) | busca="TH" + diâmetro/comprimento. SÓ use TH se diâmetro for 100, 125, 150 ou 200 |
| "chupim" / "chupim 160" / "chupim 210"    | TRANSPORTADOR (subcategoria CHUPIM)     | busca="chupim" + diâmetro/comprimento |
| "caçamba" / "caçamba de pesagem"           | CACAMBA_PESAGEM (capacidade em litros)   | capacidade_min/max (litros) ou busca="1900" |
| "caçamba transportador 210×5m"             | NÃO existe — é confusão de termos. Pergunta ao vendedor: "é caçamba de pesagem (litros) OU transportador helicoidal 210 x 5m? São equipamentos diferentes." |
| "moinho" / "moinho de martelo"             | MOINHO                                   | motor_cv exato |
| "misturador" / "misturador horizontal"     | MISTURADOR                               | capacidade em LITROS (não kg) |
| "caixa" / "caixa de material picado"       | CAIXA                                    | capacidade em kg |
| "caixa de ração pronta"                    | CAIXA                                    | idem |
| "silo"                                     | SILO                                     | busca="30" pra silo 30t |
| "ensacadeira" / "ensacadinha saco aberto"  | ENSACADEIRA                              | motor_cv (mono ≤5, trif >5) |
| "balança"                                  | BALANCA                                  | capacidade em kg |
| "elevador" / "elevador de canecas"         | ELEVADOR                                 | — |
| "peneira" / "pré-limpeza"                  | PENEIRA ou PRE_LIMPEZA                   | — |
| "moega"                                    | MOEGA                                    | — |

CONVERSÃO DE UNIDADES (importante!):
- **Misturador** no catálogo é em LITROS. Vendedor fala em kg de RAÇÃO.
  - Regra prática: **1 kg ração ≈ 2 L** (densidade ração ≈ 0,5 kg/L)
  - Exemplo: vendedor pede "misturador 500 kg" → busca capacidade_min=900, capacidade_max=1100
- **Caixa**: vendedor pode falar em kg OU toneladas.
  - "caixa 4 toneladas" = 4000 kg → capacidade_min=3900, capacidade_max=4100
- **Silo**: vendedor fala em toneladas. Catálogo varia.
  - "silo 30 toneladas" → busca="30" na descricao

DIMENSÕES (diâmetro × comprimento):
Catálogo armazena na coluna 'descricao' como: "TH 200 X 6,0 m" ou "chupim 160 x 6,0 m"
- Vendedor fala "transportador 210 por 12 metros" → busca="210" + checa comprimento na descricao
- Catálogo cobre TH: 100, 125, 150, 200 (não tem 210 hoje — se pedir TH 210, mostra TH 200 + alerta)
- Catálogo cobre chupim: 160, 210 (até 10m de comprimento)

🛠️ WORKFLOW — ORÇAMENTO COMPOSTO LIVRE (caso real Branorte)

⛔ REGRA OBRIGATÓRIA PARA PEDIDOS COMPOSTOS:
Se o vendedor citar 2+ itens, SEPARE em dois grupos:
  GRUPO 1 — ITENS INDIVIDUAIS (moega, chupim, silo, moinho, etc):
    → Use compor_orcamento_composto em UMA chamada com TODOS
  GRUPO 2 — COMPACTA/MINI FÁBRICA (se houver):
    → Use listar_modelos_compacta + propor_carregar_pacote SEPARADAMENTE
    → O pacote será SOMADO ao carrinho (não substitui os itens do grupo 1)

Exemplo: "moega, chupim 210x14, 2 silos 20t, compacta 02 150-1000 trifásica"
  → compor_orcamento_composto({ itens: [moega, chupim 210x14, 2 silos 20t] })
  → listar_modelos_compacta({ producao_min: 130, producao_max: 170, ... })
  → propor_carregar_pacote({ modelo_id: ID, ... })
  Ambos na MESMA resposta — itens individuais + pacote.

Vendedor pode falar um pedido GRANDE com 5-15 itens de uma vez. Exemplo real:
  "Quero um transportador de 210 por 12 metros, um silo de 30 toneladas,
   chupim de 160 por 6 metros, moinho de 15 CV, caixa de material picado
   4000 kg, caçamba pra alimentar misturador, misturador horizontal 500 kg,
   rosca pra tirar do misturador, caixa de ração pronta 4 toneladas,
   ensacadinha saco aberto trifásica."

Ou pequeno:
  "Quero um transportador de 160 por 6 metros e uma caixa de ração de 4 toneladas."
  → 2 itens = USE compor_orcamento_composto.

WORKFLOW correto:
  1. PARSE: extrai cada item da fala em lista (categoria + dimensão/capacidade/CV)
  2. **CONVERSÃO DE UNIDADES** ANTES de montar os args:
     - "X toneladas" → X*1000 kg → capacidade_min=X*1000-100, capacidade_max=X*1000+100
     - Misturador "X kg" → X*2 L → capacidade_min=X*2-100, capacidade_max=X*2+100
     - Silo "X toneladas" → busca igual ao número X (silo busca textual)
  3. Chama UMA vez compor_orcamento_composto({ itens: [...] }) com TODOS os itens
  4. Recebe resposta com matches/alternativas/gaps
  5. Pra cada match_exato → propor_adicionar_item
  6. Pra cada alternativa → mostra opções no chat E propor_adicionar_item da mais próxima COM justificativa
  7. Pra cada gap → adiciona à lista "❌ Não achei"
  8. NUNCA pare no meio. Processa TODOS os itens.
  9. RESPOSTA FINAL: tabela markdown com 3 seções:
     - ✅ Adicionados (item, qtd, R$ unit)
     - ⚠️ Substituídos (pedido X → encontrado Y — explica diferença, ex: "pediu TH 160 mas só temos chupim 160, são equipamentos diferentes")
     - ❌ Não achei (lista o que precisa ser cotado manualmente)
  10. Mostra subtotal só dos adicionados+substituídos
  11. Encerra com: "Quer ajustar algo ou já manda finalizar?"

⚠️ ALERTAS OBRIGATÓRIOS quando substituir tipo de equipamento:
- Vendedor pediu TH (transportador helicoidal) mas só tem CHUPIM no diâmetro pedido
  → AVISE EXPLICITAMENTE: "TH 160 não existe no catálogo (temos TH 100, 125, 150, 200).
     Achei chupim 160×6m que é equipamento DIFERENTE — confirma que serve?"
- NUNCA mostre chupim como se fosse transportador helicoidal sem alertar.
- Catálogo HELICOIDAL hoje: TH 100, 125, 150, 200 (NÃO tem TH 160, 210, 250).
- Catálogo CHUPIM hoje: chupim 160, 210 (até 10m).

⚙️ NOMENCLATURA DE MODELOS COMPACTA/MINI FÁBRICA

🎙️ ALIASES "MINI FÁBRICA" — Vendedor frequentemente usa estes termos pra Compacta:
- "mini fábrica" / "minifábrica" / "mini fab" / "mini" (sozinho com número)
- "compacta" / "fábrica compacta"
- "fábrica de ração" + dimensão (ex: "fábrica de ração de 300")
- "júnior" / "junior" / "JR" = Mini Fábrica Compacta JR (modelo mais básico: 30 kg/h, 150 kg)

MODELOS DE MINI FÁBRICA:
- "Mini Fábrica JR" / "minifábrica júnior" / "mini júnior" = 30 kg/h, 150 kg (o menor modelo)
  → listar_modelos_compacta(linha="JR") — NÃO é mesma coisa que "Compacta 01 Master JR 75-150"!
- "Mini Fábrica 75-300" / "minifábrica de 75" = 75 kg/h, 300 kg (= Compacta 01 75-300)
  → listar_modelos_compacta(linha="Mini", producao_min=65, producao_max=85)
- "minifábrica de 300" (sem especificar linha) = 300 kg/h → busca qualquer linha com producao=300

QUANDO QUALQUER um desses termos aparece COM um número (ex: "mini fábrica de 300",
"compacta 200", "minifábrica 150 kg"), o número É a PRODUÇÃO em kg/h.

⚠️ CORREÇÃO DE TRANSCRIÇÃO DE ÁUDIO:
O Whisper às vezes transcreve **"kg/h" como "kWh"** (kilowatt-hora). NUNCA interprete
"kWh" literalmente — sempre trate como kg/h quando vier após número de produção:
- "minifábrica de 300 kWh" → 300 kg/h (NÃO é energia, é produção)
- "fábrica 500 kWh" → 500 kg/h
- "150 kw" / "150 kwh" / "150 quilowatts" → 150 kg/h
- Outras transcrições erradas: "kg hora", "kg por hora", "kg/hora", "kg ora" → kg/h

WORKFLOW pra "mini fábrica de XXX":
1. Detecte termo (mini/compacta/fábrica + número)
2. Trate o número como produção em kg/h (corrigindo kWh se aplicável)
3. Use listar_modelos_compacta com producao_min=XXX-15%, producao_max=XXX+15%
4. Se encontrar 1-3 modelos → propor_carregar_pacote do PRIMEIRO (mais barato/comum)
5. Se encontrar 4+ modelos → listar os 3 mais relevantes E propor_carregar_pacote do primeiro
6. NUNCA listar modelos sem propor pelo menos 1 automaticamente
7. Se vendedor disse voltagem (mono/trif), filtre e proponha direto

LINHAS DE COMPACTA — COMO IDENTIFICAR:
- "Compacta 01" / "Compacta 1" / "compacta um" = Linha básica (sem moinho, sem silo)
- "Compacta 02" / "Compacta 2" / "compacta dois" = Linha intermediária (com moinho, silo ração, caçamba)
- "Compacta 03" / "Compacta 3" / "compacta três" = Linha completa (com moinho, silo milho+ração, caçamba, balança)
- "Mini Fábrica" = Pacotes menores (geralmente Compacta 01)
- "Master" = Versão reforçada (mais cara). SÓ use is_master=true se vendedor disse "master".

⛔ VOLTAGEM DEFAULT = TRIFÁSICO
Se o vendedor NÃO mencionar voltagem (mono/monofásico/monofásica), SEMPRE assume TRIFÁSICO.
Só usa monofásico quando vendedor disser EXPLICITAMENTE: "mono", "monofásico", "monofásica", "220V mono".

⛔ PADRÃO CRÍTICO: "compacta N, X, Y" (3 números separados por vírgula ou espaço)
Vendedor frequentemente fala assim (por voz ou texto):
  "compacta 1, 150, 500" ou "compacta um, 150, 500" ou "compacta 1 150 500"
Interpretação OBRIGATÓRIA:
  - N = número da LINHA (1=Compacta 01, 2=Compacta 02, 3=Compacta 03)
  - X = produção em kg/h
  - Y = armazenamento em kg
  → "compacta 1, 150, 500" = Compacta 01 - 150 kg/h - 500 kg armazenamento TRIFÁSICO
  → listar_modelos_compacta(linha="Compacta 01", producao_min=130, producao_max=170,
      armazenamento_min=450, armazenamento_max=550, voltagem="TRIFASICO", is_master=false)

Outros exemplos do padrão:
  "compacta 2, 300, 1000" → Compacta 02 - 300 kg/h - 1000 kg - TRIFÁSICO
  "compacta 3, 200, 500 mono" → Compacta 03 - 200 kg/h - 500 kg - MONOFÁSICO
  "compacta 1 master 150 500" → Compacta 01 Master - 150 kg/h - 500 kg - TRIFÁSICO
  "compacta 2, 100, 500 monofásica" → Compacta 02 - 100 kg/h - 500 kg - MONOFÁSICO

⛔ PADRÃO ALTERNATIVO: "compacta N, XXX-YYY" ou "compacta N XXXxYYY"
  "compacta 2 150-1000" → Compacta 02 - 150 kg/h - 1000 kg
  "compacta 1 75x300 mono" → Compacta 01 - 75 kg/h - 300 kg - MONOFÁSICO

QUANDO vendedor fala "Compacta 02 150-1000 trifásica" (sem "master"):
  listar_modelos_compacta(linha="Compacta 02", producao_min=140, producao_max=160,
    armazenamento_min=900, armazenamento_max=1100, voltagem="TRIFASICO")

  ⛔ REGRAS ABSOLUTAS DE COMPACTA:
  - NUNCA substitua Compacta 02 por Compacta 01 ou 03 — são linhas DIFERENTES
  - NUNCA substitua Compacta 01 por Compacta 02 ou 03
  - NUNCA carregue Master se vendedor não pediu Master
  - Se não achou modelo exato da LINHA pedida, diga "não achei Compacta 02 nessa configuração"
    e liste as opções disponíveis da Compacta 02 — NÃO sugira outra linha
  - SEMPRE passe linha="Compacta 02" (ou 01, 03) no listar_modelos_compacta
  - Formatos do vendedor: "150100" = 150 kg/h × 100 kg, "1501000" = 150 kg/h × 1000 kg,
    "200mil" ou "200000" = 200 kg/h × 1000 kg

Vendedor também pode pedir modelo no formato **XXX-YYY** ou **XXXxYYY** ou só **XXXYYY**:
- XXX = produção em kg/h (valores reais: 30, 75, 100, 150, 200, 250, 300, 400, 500)
- YYY = armazenamento em kg (valores reais: 150, 300, 500, 1000, 4000, 6000)
Exemplos:
- "modelo 150-300" → produção 150 kg/h × armazenamento 300 kg
- "100x500" → 100 kg/h × 500 kg
- "150500 master mono" → Compacta Master 150 kg/h × 500 kg monofásico

MODELOS DISPONÍVEIS POR LINHA (referência rápida):
Compacta 01: 30-150, 75-300, 75-500, 75-1000, 100-500, 100-1000, 150-500, 150-1000, 200-1000
Compacta 01 Master: 75-150, 75-300, 100-300, 100-500, 200-500, 300-500
Compacta 02: 75-300, 75-500, 100-500, 100-1000, 150-500, 150-1000, 200-500, 200-1000, 300-1000
Compacta 02 Master: 100-300, 100-500, 150-500, 150-1000, 200-500, 200-1000, 250-1000, 300-1000, 400-1000, 500-1000
Compacta 03: 100-500, 150-500, 150-1000, 200-1000, 300-1000, 500-1000
Compacta 03 Master: 150-500, 150-1000, 200-500, 200-1000, 300-1000, 400-1000, 500-1000

Se vendedor pedir um modelo que NÃO existe (ex: Compacta 01 300-1000), mostre os 2-3 mais próximos
da MESMA LINHA e explique: "Compacta 01 não tem modelo 300-1000. As opções mais próximas são: ..."

WORKFLOW pra esses pedidos:
1. listar_modelos_compacta com producao_min/max e armazenamento_min/max (janela ±15%)
2. Filtrar por voltagem (default TRIFÁSICO se não disse nada)
3. Filtrar por master/jr se vendedor disse
4. Se não acha EXATO, mostra os 2-3 mais próximos (NUNCA dizer "não tem")
5. Se vendedor confirmar o modelo OU pedir "monta logo", propor_carregar_pacote
6. Se vendedor disser "finaliza e me manda no zap" / "fecha isso" → propor_finalizar_orcamento

⛔ NÃO TEM MODELO 150-300 NO CATÁLOGO REAL (verificado)
Modelos comuns com 150 kg/h: 150-500, 150-1000.
Modelos comuns com 300 kg armaz: 100-300.
Quando vendedor pedir 150-300, ofereça as 2 alternativas mais próximas.

🚀 FINALIZAÇÃO RÁPIDA (Sprint 3)
TRIGGER WORDS — quando vendedor disser QUALQUER destas:
  "gerar o orçamento", "gera o orçamento", "pode gerar", "gera isso",
  "fecha o orçamento", "fecha isso", "fecha agora",
  "finaliza", "finaliza e envia", "finalizar",
  "manda o orçamento", "manda pro meu zap", "manda pro meu whatsapp",
  "tá bom assim", "pode ser assim", "fechou", "fechei"

→ AÇÃO CORRETA (em ordem):
  1. SE você ainda não sabe os DADOS DO CLIENTE → PERGUNTE em chat
     TODOS de uma vez:
     "Pra fechar, me passa os dados do cliente: nome, telefone e cidade.
      CNPJ é opcional."
     (NÃO chame propor_finalizar_orcamento ainda — espera resposta)
  2. SE vendedor respondeu com pelo menos o nome → chama
     propor_finalizar_orcamento com cliente_nome + outros campos que
     vendedor mandou (cliente_fone, cliente_cidade, cliente_cnpj).
     Sistema GERA automaticamente sem abrir modal — zero atrito.
  3. NUNCA sugira mais items. O VENDEDOR decide completude.
  4. Pergunta DEVE coletar nome + fone + cidade numa frase só. Não
     pingar pergunta por pergunta.

🎤 COMANDO ÚNICO POR VOZ — DETECTAR EM UMA FRASE SÓ
Vendedor frequentemente fala TUDO de uma vez por áudio:
  "Monta um orçamento de Compacta 02 modelo 200 mil trifásica
   em nome de Daniel cidade Braço do Norte Santa Catarina"

→ EXTRAIA os 3 blocos NA MESMA RESPOSTA (sem ping-pong):
  BLOCO 1 — EQUIPAMENTO: "Compacta 02 modelo 200-1000 trifásica"
    → listar_modelos_compacta + propor_carregar_pacote
  BLOCO 2 — CLIENTE: "em nome de X", "pro cliente Y", "cliente é Z"
    → captura nome. "cidade Y" → captura cidade. "telefone Z" / "fone Z" → captura fone.
  BLOCO 3 — INTENÇÃO IMPLÍCITA DE FINALIZAR: a propria frase "monta o
    orçamento de X em nome de Y" JÁ É O TRIGGER. Não precisa esperar
    "fecha", "gera", etc.
    → propor_finalizar_orcamento com cliente_nome + cliente_cidade + cliente_fone
      capturados no BLOCO 2.

REGRAS DESSE FLUXO:
- Chama propor_carregar_pacote E propor_finalizar_orcamento NA MESMA
  resposta (varias propor_* em sequencia sao permitidas).
- NUNCA pergunte "qual cliente?" se o vendedor JÁ disse "em nome de X".
- "Santa Catarina" / "SC" / "MG" após cidade → ignora estado, usa só a cidade.
- Se faltar SÓ telefone → ainda chama propor_finalizar_orcamento (telefone é
  opcional). NÃO trave perguntando telefone.
- Padrões pra detectar nome de cliente:
  "em nome de X", "no nome do X", "pro cliente X", "cliente é X",
  "pro fulano X", "manda pro X", "orçamento pro X"
- Padrões pra detectar cidade:
  "cidade X", "em X" (após nome), "cliente de X", "X SC", "X /SC", "X-SC"

🎯 TEXTO DA RESPOSTA quando propor_finalizar_orcamento já tem cliente:
NÃO escreva "clique em Finalizar pra concluir" — vendedor NÃO precisa
clicar em nada do modal (vai gerar automático). Escreva ALGO ASSIM:

  "Beleza! Quando você clicar em **Aplicar** no card abaixo, vou gerar
   o orçamento pro <Nome do cliente> e mandar pro seu WhatsApp."

Mantém curto. Só vendedor clicar Aplicar — sistema cuida do resto.

⛔ ANTI-PADRÃO REAL (caso do Daniel — 19/05):
- Vendedor: "O orçamento de um misturador vertical de 150 kg monofásico"
- IA: adicionou 1 item (Misturador 300 L) ✅
- Vendedor: "pode gerar o orçamento"  ← TRIGGER DE FINALIZAÇÃO
- IA (ERRADO): "Aqui estão os itens que faltam: Moega, Silo, Moinho..."
- IA (CORRETO): chamar propor_finalizar_orcamento — vendedor SÓ queria
  um misturador, não uma fábrica inteira.

REGRA DE OURO: se o vendedor adicionou alguns items e disse "gera/fecha/
finaliza", esses items são SUFICIENTES — não importa se é 1 item ou 10.
Você só sugere complementos PROATIVAMENTE quando vendedor PEDE explicitamente
("o que mais falta?", "completa isso", "monta uma mini fábrica").

FLUXO PADRÃO:
  1. Garantir que o carrinho tem items (carregar_pacote ou adicionar items individuais)
  2. propor_finalizar_orcamento (vendedor clica "Aplicar" → modal abre pré-preenchido)
  3. Vendedor confirma dados do cliente no modal e clica "Gerar"
  4. Sistema gera PDF/DOCX, salva no servidor e envia pro WhatsApp do vendedor automaticamente

NUNCA prometa "vou enviar pro WhatsApp" sem ter chamado propor_finalizar_orcamento.

WORKFLOW DE ORÇAMENTO COMPLETO DO ZERO
Quando o vendedor pedir "monta orçamento de mini fábrica X kg/h com Y" (e não houver modelo pronto que case):
  - Defina mentalmente os "blocos" que toda fábrica de ração precisa:
    1. RECEPÇÃO: moega + transportador de chegada (TH 160 ou 210 mm)
    2. ARMAZENAMENTO grão bruto: silo (capacidade = ~5x produção horária × dias de autonomia)
    3. MOAGEM: moinho de martelo (CV proporcional à capacidade — 5 CV pra 100-200 kg/h, 10 CV pra 200-500 kg/h, 15 CV pra 500-1000 kg/h)
    4. PESAGEM/DOSAGEM: caçamba de pesagem + balança eletrônica
    5. MISTURA: misturador horizontal (capacidade do batch = ~30 min de produção)
    6. ENSACAMENTO (opcional): ensacadeira + transportador de sacaria
    7. INTERCONEXÕES: transportadores entre etapas
  - Pra cada bloco: consulta_precos → escolhe item adequado → propor_adicionar_item
  - SEMPRE filtre por voltagem se cliente pediu (mono ou trifásico) — verifica valor_com_motor_mono/trif
  - Se algum bloco não tiver opção no catálogo na capacidade exata, escolhe o ITEM MAIS PRÓXIMO disponível (não pula) e justifica
  - Use propor_carregar_pacote SÓ se achar pacote exato; caso contrário, COMPONHA item-a-item

REGRAS DE COMPATIBILIDADE
- Monofásico: motores até 5 CV. Acima disso, só trifásico. Se cliente quer mono mas item precisa motor 7.5+ CV, AVISE.
- Capacidade do misturador (em LITROS) ≈ 2× kg desejados (ex: misturador 300 L = 150 kg ração)
- Capacidade do misturador deve ser >= 30% da produção horária (batch de ~30 min)
- Capacidade do silo deve ser >= 5× produção horária (autonomia mínima)
- Quando há moinho, sempre incluir transportador de alimentação (TH 160 mm × 2-3 m)
- Chupim 160mm aguenta até 10 ton/h; chupim 210mm aguenta até 20 ton/h. Escolha pela capacidade.

⛔ CONSCIÊNCIA DO CARRINHO ATUAL (super importante)
O contexto inicial inclui os IDs e itens já no carrinho. Antes de propor:
1. CHECA se o item já está adicionado (por categoria + característica similar) — se sim, NÃO duplica
2. CONSIDERA o que falta pra fechar um orçamento completo (moinho? misturador? transportador? silo?)
3. APÓS adicionar items, faz um resumo do CARRINHO TOTAL e pergunta ao vendedor se quer adicionar complementos

Quando vendedor diz "faz o orçamento" e já tem alguns itens no carrinho:
- ANALISA o que falta (baseado nos 7 blocos de fábrica completa)
- PROPÕE OS COMPLEMENTOS faltantes (não substitui o que já tem)
- Faz um resumo final: "Já no carrinho: X. Sugiro adicionar: Y, Z."

CATEGORIAS DA TABELA precos_branorte (dados reais)
- TRANSPORTADOR (132 itens): helicoidais TH 160mm/210mm, CHUPINS (transportadores de aspiração)
- COMPACTA (35 itens): pacotes prontos (Linhas 01/02 Master, mini fábricas)
- ELEVADOR (33 itens): elevadores de canecas, motor 1-5 CV
- CAIXA (24 itens): caixas de dosagem, ração pronta
- SILO (23 itens): 1 a 100 toneladas
- MISTURADOR (22 itens): horizontal/vertical, capacidade em LITROS (300L=150kg até 30 CV)
- MOINHO (22 itens): martelos, MODELO "BNMMxxx", potência 3 a 100 CV
- CACAMBA (4 itens): pesagem 600 a 3000 L, motor 1-3 CV
- HELICOIDE (6), PENEIRA (5), ENSACADEIRA (2), BALANCA (6), ALIMENTADOR (2)
- PRE_LIMPEZA (3), MOEGA (1), DESCARGA (2), PASSARELA (2), SUPORTE_BAG (2), ELEVADOR_SACARIA (1)
- OUTROS (4)

NOMENCLATURA REAL DO CATÁLOGO (super importante)
- **Chupim**: transportador de aspiração. Formato "chupim {diametro} x {comprimento} m".
  Diâmetros disponíveis: **160mm** ou **210mm**. Comprimentos: 1,0 / 1,5 / 2,0 / 3,0 / ... / 12,0 m (decimais com VÍRGULA).
  Exemplo cliente: "chupim 160 por 280" = quer chupim 160mm × 2,8m. ATENÇÃO: 2,8m PODE não existir — oferecer 2,0m ou 3,0m.
- **Moinho**: modelo **BNMM** + potência ou capacidade. Ex: "BNMM130 (3,0 CV 2 POLOS - 300KG/H)". Pra buscar "moinho 3 CV" use motor_cv=3 (NÃO busca textual — vírgula quebra).
- **Misturador**: descrito em LITROS (não em kg). 300 litros = ~150 kg de ração.
- **TH 160 / TH 210**: transportador helicoidal de 160mm ou 210mm. Comprimentos variados.
- **Cacamba de pesagem**: "Caçamba 600 L" até "Caçamba 1900 L". 1900 L = ~1000 kg de produto.

⛔ REGRA DE OURO — NÃO ENCONTROU EXATO? OFEREÇA 3 ALTERNATIVAS PRÓXIMAS
Quando o cliente pede algo específico e a busca exata não retorna, NUNCA responda "não encontramos" sem antes:
1. Buscar SEM o filtro mais restritivo (ex: tira motor_cv exato, deixa só categoria)
2. Pegar os 3-5 mais próximos do que cliente pediu
3. Apresentar como "Não temos exato, mas as opções mais próximas são: ..."

Exemplos:
- Cliente: "moinho de 3 CV" → consultar_precos(categoria='MOINHO', motor_cv=3) → ✅ acha BNMM130
- Cliente: "moinho de 4 CV" → motor_cv=4 vazio → consultar_precos(categoria='MOINHO') → mostra os 3 CV e 5 CV
- Cliente: "chupim 160 por 280" → busca '160 x 2,8' vazio → consultar_precos(categoria='TRANSPORTADOR', busca='chupim 160') → mostra todos os comprimentos disponíveis
- Cliente: "misturador 150 kg" → "150 kg" = 300 litros aprox → busca por 300 litros

REGRAS DE AÇÕES PROPOSTAS
- Use propor_adicionar_item pra cada item individual quando compor do zero
- Use propor_carregar_pacote SÓ quando achar pacote exato em listar_modelos_compacta
- Cada ação aparece como card no chat — vendedor clica pra confirmar uma a uma
- Pode chamar várias propor_* na mesma resposta (componha o orçamento todo de uma vez)

⛔ REGRA — propor_preencher_cliente é a ÚLTIMA etapa, NUNCA no meio do orçamento
O fluxo correto do vendedor é:
  1. Define EQUIPAMENTOS (você ajuda compondo o carrinho com propor_adicionar_item)
  2. Vendedor revisa o carrinho
  3. Clica em 'Finalizar e gerar' (botão fora do chat)
  4. Modal abre pra preencher dados do cliente
  5. PDF/DOCX gerado

PORTANTO:
- NÃO use propor_preencher_cliente proativamente. NUNCA infira nome do cliente
  de contexto (o nome que aparece pode ser do VENDEDOR, não do cliente).
- SÓ use propor_preencher_cliente se o vendedor EXPLICITAMENTE disser dados
  formato "o cliente é Fulano da empresa X, telefone Y, CNPJ Z" — e MESMO
  ASSIM, prefira sugerir "anota essas info pra eu preencher quando clicar
  em finalizar" em vez de já propor.
- Se o vendedor mandar só um nome solto ("Daniel"), trate como nome de quem
  tá fazendo a conversa, NÃO do cliente.
- Foco da sua ajuda é EQUIPAMENTO. Dados do cliente são responsabilidade
  do modal de finalização.`

// ============================================================================
// TOOL DEFINITIONS (JSON schema enviado pro OpenAI)
// ============================================================================

const tools = [
  {
    type: 'function' as const,
    function: {
      name: 'consultar_precos',
      description:
        'Busca itens na tabela oficial de preços (precos_branorte). Use pra consultar preço, motor padrão, capacidade etc. de qualquer equipamento. Retorna até 30 resultados.\n\n⚠️ DICA IMPORTANTE: o campo descricao tem nomenclatura com vírgula decimal ("3,0 CV", "160 x 2,8 m"). Pra buscar por potência exata use motor_cv (numérico), NÃO busca textual. Pra buscar por dimensão use busca com vírgula ("160 x 2,8") ou ponto ("160 x 2.8") — vamos normalizar dos dois jeitos.',
      parameters: {
        type: 'object',
        properties: {
          categoria: {
            type: 'string',
            description:
              'Categoria EXATA (ver MAPA DO CATÁLOGO no system prompt). Valores reais: ACESSORIO, ALIMENTADOR, BALANCA, CACAMBA_PESAGEM, CAIXA, COMPACTA, DESCARGA, ELEVADOR, ELEVADOR_SACARIA, ENSACADEIRA, ESTEIRA, HELICOIDE, MISTURADOR, MOEGA, MOINHO, OUTROS, PAINEL_ELETRICO, PASSARELA, PRE_LIMPEZA, SILO, SUPORTE_BAG, TRANSPORTADOR. Opcional — se omitir, busca em todas.',
          },
          busca: {
            type: 'string',
            description:
              'Termo livre — cada PALAVRA vira um filtro independente (ordem não importa; "de"/"com"/"x" são ignorados; vírgula/ponto decimal normalizados; casa na descrição OU subcategoria). Ex: "chupim 160 3 m" acha "Chupim 160 x 3,0 m". Use palavras-chave curtas, não frases. Opcional.',
          },
          subcategoria: {
            type: 'string',
            description:
              'Filtro por subcategoria (ILIKE parcial). Ex: "HORIZONTAL" pega HORIZONTAL_CPULMAO e HORIZONTAL_SPULMAO; "VERTICAL", "CHUPIM", "TH", "MILHO", "RACAO", "PICADOS". Ver MAPA DO CATÁLOGO. Opcional.',
          },
          motor_cv: {
            type: 'number',
            description:
              'Filtro EXATO por potência em CV (campo numérico motor_cv). Use pra "moinho de 3 CV", "transportador 5 CV", etc. NÃO use a busca textual pra isso (vai falhar por vírgula).',
          },
          motor_cv_min: { type: 'number', description: 'Filtro mínimo de CV. Opcional.' },
          motor_cv_max: { type: 'number', description: 'Filtro máximo de CV. Opcional.' },
          capacidade_min: {
            type: 'number',
            description: 'Filtro mínimo em capacidade_kg_pratica ou capacidade_litros. Opcional. NÃO use pra silos (silos usam capacidade_ton_min/max).',
          },
          capacidade_max: {
            type: 'number',
            description: 'Filtro máximo. Opcional.',
          },
          capacidade_ton_min: {
            type: 'number',
            description: 'Filtro mínimo em TONELADAS (campo capacidade_ton). Use APENAS pra SILOS. Ex: silo 42t → capacidade_ton_min=40, capacidade_ton_max=45.',
          },
          capacidade_ton_max: {
            type: 'number',
            description: 'Filtro máximo em toneladas. Opcional.',
          },
          max_resultados: {
            type: 'integer',
            description: 'Limite. Default 15, max 30.',
            default: 15,
          },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'consultar_motor',
      description:
        'Busca motores elétricos no catalogo_motores. Use pra responder "qual o preço do motor 5 CV trifásico 4 polos" etc.',
      parameters: {
        type: 'object',
        properties: {
          cv: { type: 'number', description: 'Potência em CV. Ex: 1.5, 2, 5, 7.5, 15.' },
          polos: { type: 'integer', description: '2, 4 ou 6.', enum: [2, 4, 6] },
          voltagem: {
            type: 'string',
            description: 'TRIFASICO_220, MONOFASICO_220, etc. Opcional.',
          },
        },
        required: ['cv'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'listar_modelos_compacta',
      description:
        'Lista modelos de pacote fechado (orcamento_modelos) — fábricas compactas e mini-fábricas. Use pra "monta orçamento de mini fábrica que produz 200 kg/h e armazena 1000 kg".',
      parameters: {
        type: 'object',
        properties: {
          producao_min: { type: 'integer', description: 'kg/h mínimo' },
          producao_max: { type: 'integer', description: 'kg/h máximo' },
          armazenamento_min: { type: 'integer', description: 'kg mínimo' },
          armazenamento_max: { type: 'integer', description: 'kg máximo' },
          voltagem: { type: 'string', description: 'TRIFASICO ou MONOFASICO' },
          linha: { type: 'string', description: 'Filtra por linha/nome. Ex: "Compacta 02", "Compacta 03", "Mini Fabrica". Busca no campo basename (ILIKE).' },
          com_balanca: { type: 'boolean' },
          com_ensacadeira: { type: 'boolean' },
          com_chupim: { type: 'boolean' },
          is_master: { type: 'boolean', description: 'true = versão Master (mais robusta)' },
          max_resultados: { type: 'integer', default: 12 },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'detalhar_modelo',
      description:
        'Retorna todos os itens, motores e totais de UM modelo específico de orcamento_modelos. Use depois de listar_modelos_compacta pra mostrar o que vem no pacote.',
      parameters: {
        type: 'object',
        properties: {
          modelo_id: { type: 'integer', description: 'ID do modelo' },
        },
        required: ['modelo_id'],
      },
    },
  },

  // ====== TOOL DE ORÇAMENTO COMPOSTO (batch) ======
  // Recebe uma LISTA de pedidos de item em texto livre e busca tudo em 1 round-trip.
  // Reduz drasticamente o número de tool-calls quando o vendedor manda pedido grande.
  {
    type: 'function' as const,
    function: {
      name: 'compor_orcamento_composto',
      description:
        'BATCH search — recebe uma LISTA de descrições de itens em texto livre (categoria + dimensão/capacidade/CV) e busca todos em paralelo no catálogo. Use quando o vendedor falar 5+ itens de uma vez (orçamento livre composto). Retorna 3 grupos: matches exatos, alternativas próximas, e gaps. DEPOIS chame propor_adicionar_item pra cada match que o vendedor confirmar (ou processe automaticamente os exatos).',
      parameters: {
        type: 'object',
        properties: {
          itens: {
            type: 'array',
            description: 'Lista de itens pedidos pelo vendedor.',
            items: {
              type: 'object',
              properties: {
                descricao_vendedor: { type: 'string', description: 'O que o vendedor falou exatamente (ex: "transportador 210 por 12 metros", "silo 30 toneladas", "misturador horizontal 500 kg", "moinho 15 CV").' },
                categoria: { type: 'string', description: 'Categoria mapeada do glossário: TRANSPORTADOR | MISTURADOR | SILO | MOINHO | CAIXA | CACAMBA | ENSACADEIRA | BALANCA | ELEVADOR | PENEIRA | MOEGA | PRE_LIMPEZA.' },
                subcategoria: { type: 'string', description: 'HELICOIDAL ou CHUPIM (só pra TRANSPORTADOR). Opcional.' },
                busca: { type: 'string', description: 'Busca textual na descricao. TRANSPORTADOR: use "chupim {diam} x {comp}" exato. Ex: "chupim 160 x 14" (NÃO "160 14"). MOINHO: NÃO use busca, use motor_cv. SILO: NÃO use busca, server auto-detecta tonelagem.' },
                motor_cv: { type: 'number', description: 'CV exato (pra moinho/ensacadeira). Opcional.' },
                capacidade_min: { type: 'number', description: 'Mínimo em kg ou litros. NÃO use pra silos.' },
                capacidade_max: { type: 'number' },
                capacidade_ton_min: { type: 'number', description: 'Mínimo em TONELADAS (só pra SILO). Ex: silo 42t → min=40, max=45.' },
                capacidade_ton_max: { type: 'number' },
                quantidade: { type: 'integer', description: 'Qtd desejada. "3 silos" = quantidade=3. Default 1.', default: 1 },
              },
              required: ['descricao_vendedor', 'categoria'],
            },
          },
        },
        required: ['itens'],
      },
    },
  },

  // ====== TOOLS DE PROPOSTA (Sprint 2) ======
  // Estas NÃO modificam o banco nem o carrinho. Apenas geram uma "ação sugerida"
  // que volta no response, e o frontend renderiza como card de aprovação manual.
  {
    type: 'function' as const,
    function: {
      name: 'propor_adicionar_item',
      description:
        'ADICIONA um item ao carrinho. Por padrão auto_apply=true (item é adicionado AUTOMATICAMENTE). Só passe auto_apply=false quando for alternativa/substituição que precisa confirmação explícita do vendedor.',
      parameters: {
        type: 'object',
        properties: {
          preco_branorte_id: {
            type: 'integer',
            description: 'ID exato vindo de consultar_precos. NÃO invente IDs.',
          },
          quantidade: { type: 'integer', description: 'Qtd. Default 1.', default: 1 },
          justificativa: {
            type: 'string',
            description: 'Frase curta explicando porque esse item.',
          },
          auto_apply: {
            type: 'boolean',
            description: 'DEFAULT TRUE. Item vai direto pro carrinho. Só passe false quando é substituição/alternativa que precisa confirmação.',
            default: true,
          },
        },
        required: ['preco_branorte_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propor_carregar_pacote',
      description:
        'ADICIONA um pacote completo de Compacta/Mini Fábrica ao carrinho. Quando já tem itens, SOMA (não substitui). basename_esperado é OPCIONAL — se omitir, aceita qualquer modelo.',
      parameters: {
        type: 'object',
        properties: {
          modelo_id: { type: 'integer', description: 'ID do orcamento_modelos. DEVE vir de uma chamada recente de listar_modelos_compacta ou detalhar_modelo.' },
          basename_esperado: { type: 'string', description: 'Opcional. Nome do modelo pra validação extra. Se omitido, aceita qualquer modelo.' },
          justificativa: { type: 'string', description: 'Por que esse modelo atende o pedido.' },
        },
        required: ['modelo_id'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propor_preencher_cliente',
      description:
        'Sugere preencher os dados do cliente. Use quando o vendedor disser "o cliente é X da cidade Y, telefone Z" etc.',
      parameters: {
        type: 'object',
        properties: {
          nome: { type: 'string' },
          ac: { type: 'string', description: 'Aos cuidados de (pessoa de contato)' },
          fone: { type: 'string' },
          cidade: { type: 'string' },
          bairro: { type: 'string' },
          endereco: { type: 'string' },
          cep: { type: 'string' },
          cnpj: { type: 'string', description: 'CPF ou CNPJ' },
          ie: { type: 'string', description: 'Inscrição Estadual' },
          email: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'propor_finalizar_orcamento',
      description:
        'Propõe FINALIZAR o orçamento e gerar PDF. Se auto_submit=true E tem cliente_nome, o sistema gera AUTOMATICAMENTE sem abrir modal (zero cliques). Use auto_submit=true quando o vendedor já forneceu nome do cliente no mesmo pedido (áudio ou texto). Ideal pra "monta orçamento de X pra cliente Y de cidade Z".',
      parameters: {
        type: 'object',
        properties: {
          enviar_whatsapp: {
            type: 'boolean',
            description: 'Pré-marca WhatsApp. Default true.',
            default: true,
          },
          auto_submit: {
            type: 'boolean',
            description: 'Se true E cliente_nome preenchido, gera PDF automaticamente sem abrir modal. Use quando vendedor já forneceu dados do cliente no pedido. Default false.',
            default: false,
          },
          cliente_nome: {
            type: 'string',
            description: 'Nome do cliente — extraído do áudio/texto do vendedor.',
          },
          cliente_fone: { type: 'string', description: 'Telefone do cliente, opcional.' },
          cliente_cidade: { type: 'string', description: 'Cidade do cliente, opcional.' },
          cliente_cnpj: { type: 'string', description: 'CNPJ/CPF do cliente, opcional.' },
        },
      },
    },
  },
]

// ============================================================================
// TOOL IMPLEMENTATIONS (executadas server-side via Supabase service role)
// ============================================================================

// Tokeniza a busca livre: cada palavra vira um filtro AND; palavras de ligação
// ("de", "com", "x", "para"...) caem fora; tokens com decimal geram as duas
// variantes (vírgula E ponto) num OR. "metros"/"metro" normaliza pra "m".
// Retorna lista de grupos: cada grupo é [variante] ou [varianteA, varianteB].
const BUSCA_STOPWORDS = new Set(['de', 'da', 'do', 'dos', 'das', 'com', 'para', 'pra', 'x', 'por', 'um', 'uma', 'o', 'a', 'e', 'em', 'no', 'na'])
function buildBuscaTokens(busca: string): string[][] {
  const bruto = busca
    .toLowerCase()
    .replace(/[øØ⌀]/g, ' ')
    .replace(/metros?\b/g, 'm')
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0 && !BUSCA_STOPWORDS.has(t))
    .slice(0, 8) // sanidade: máx 8 tokens
  const grupos: string[][] = []
  for (const t of bruto) {
    const comVirgula = t.replace(/\./g, ',')
    const comPonto = t.replace(/,/g, '.')
    if (comVirgula !== comPonto) grupos.push([comVirgula, comPonto])
    else grupos.push([t])
  }
  return grupos
}

// ============================================================================
// MAPA DO CATÁLOGO — visão geral viva injetada no system prompt (fix 2026-07-16).
// Antes a IA "não sabia o que existe" e chutava buscas/desistia. Agora todo
// request recebe um digest compacto (categoria/sub → nº de itens, faixa de CV,
// exemplos das categorias pequenas), gerado do banco e cacheado 10 min por
// instância. ~2 KB — barato e elimina o "não encontrei" por desconhecimento.
// ============================================================================
let _digestCache: { text: string; at: number } | null = null
async function getCatalogoDigest(supa: SupabaseClient): Promise<string> {
  if (_digestCache && Date.now() - _digestCache.at < 10 * 60 * 1000) return _digestCache.text
  try {
    const { data, error } = await supa
      .from('precos_branorte')
      .select('categoria, subcategoria, descricao, motor_cv, capacidade_ton, capacidade_kg_pratica, capacidade_litros')
      .eq('ativo', true)
      .limit(1000)
    if (error || !data || data.length === 0) return ''
    type Grp = { n: number; cvMin: number | null; cvMax: number | null; tonMin: number | null; tonMax: number | null; exemplos: string[] }
    const grupos = new Map<string, Grp>()
    for (const r of data as Array<Record<string, unknown>>) {
      const key = `${r.categoria}${r.subcategoria ? '/' + r.subcategoria : ''}`
      let g = grupos.get(key)
      if (!g) { g = { n: 0, cvMin: null, cvMax: null, tonMin: null, tonMax: null, exemplos: [] }; grupos.set(key, g) }
      g.n++
      const cv = r.motor_cv != null ? Number(r.motor_cv) : null
      if (cv != null && !Number.isNaN(cv)) {
        g.cvMin = g.cvMin == null ? cv : Math.min(g.cvMin, cv)
        g.cvMax = g.cvMax == null ? cv : Math.max(g.cvMax, cv)
      }
      const ton = r.capacidade_ton != null ? Number(r.capacidade_ton) : null
      if (ton != null && !Number.isNaN(ton)) {
        g.tonMin = g.tonMin == null ? ton : Math.min(g.tonMin, ton)
        g.tonMax = g.tonMax == null ? ton : Math.max(g.tonMax, ton)
      }
      if (g.exemplos.length < 6) g.exemplos.push(String(r.descricao ?? '').slice(0, 48))
    }
    const linhas: string[] = []
    for (const [key, g] of [...grupos.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      let l = `- ${key}: ${g.n} itens`
      if (g.cvMin != null) l += ` (${g.cvMin}–${g.cvMax} CV)`
      if (g.tonMin != null) l += ` (${g.tonMin}–${g.tonMax} ton)`
      // Categorias pequenas: lista os itens — é onde a busca mais falhava
      if (g.n <= 6 && g.exemplos.length > 0) l += ` → ${g.exemplos.join(' | ')}`
      linhas.push(l)
    }
    const text = `\n📚 MAPA DO CATÁLOGO ORÇÁVEL (ao vivo, ${data.length} itens ativos em precos_branorte — TUDO que existe pra orçar; use categoria EXATA nos filtros):\n${linhas.join('\n')}`
    _digestCache = { text, at: Date.now() }
    return text
  } catch {
    return ''
  }
}

async function tool_consultar_precos(supa: SupabaseClient, args: Record<string, unknown>) {
  const categoria = args.categoria as string | undefined
  const busca = args.busca as string | undefined
  const motorCv = args.motor_cv as number | undefined
  const motorCvMin = args.motor_cv_min as number | undefined
  const motorCvMax = args.motor_cv_max as number | undefined
  const capMin = args.capacidade_min as number | undefined
  const capMax = args.capacidade_max as number | undefined
  const capTonMin = args.capacidade_ton_min as number | undefined
  const capTonMax = args.capacidade_ton_max as number | undefined
  const limit = Math.min((args.max_resultados as number) || 15, 30)

  let q = supa
    .from('precos_branorte')
    .select(
      'id, categoria, subcategoria, descricao, capacidade, capacidade_kg_pratica, capacidade_litros, capacidade_ton, motor_cv, motor_polos, potencia, valor_equipamento, valor_com_motor_trif, valor_com_motor_mono, dimensoes'
    )
    .eq('ativo', true)
    .order('categoria')
    .order('ordem')
    .limit(limit)

  // Normalizar categorias: LLM pode mandar "CACAMBA" mas tabela tem "CACAMBA_PESAGEM"
  const catNorm = categoria?.toUpperCase() === 'CACAMBA' ? 'CACAMBA_PESAGEM' : categoria?.toUpperCase()
  if (catNorm) q = q.eq('categoria', catNorm)
  if (args.subcategoria) q = q.ilike('subcategoria', `%${(args.subcategoria as string).toUpperCase()}%`)
  if (busca) {
    // BUSCA TOKENIZADA (fix 2026-07-16): antes era ILIKE %frase inteira% — "chupim 160 3 m"
    // NÃO achava "Chupim 160 x 3,0 m" porque a frase precisava aparecer contígua. Agora
    // cada PALAVRA vira um filtro AND independente (ordem não importa, "x"/"de"/"com" são
    // ignorados), com vírgula/ponto decimal normalizados por token. Cada token casa na
    // DESCRIÇÃO ou na SUBCATEGORIA — "horizontal" só existe em subcategoria (fix caso
    // "misturador horizontal 1000 kg" → descricao é "Misturador 1900 Litros").
    for (const filtro of buildBuscaTokens(busca)) {
      const alvos = filtro.flatMap((v) => [`descricao.ilike.%${v}%`, `subcategoria.ilike.%${v}%`])
      q = q.or(alvos.join(','))
    }
  }
  if (motorCv != null) q = q.eq('motor_cv', motorCv)
  if (motorCvMin != null) q = q.gte('motor_cv', motorCvMin)
  if (motorCvMax != null) q = q.lte('motor_cv', motorCvMax)
  if (capMin != null) q = q.gte('capacidade_kg_pratica', capMin)
  if (capMax != null) q = q.lte('capacidade_kg_pratica', capMax)
  if (capTonMin != null) q = q.gte('capacidade_ton', capTonMin)
  if (capTonMax != null) q = q.lte('capacidade_ton', capTonMax)

  const { data, error } = await q
  if (error) return { erro: error.message }

  const resultados = data ?? []

  // Se achou resultados, injeta instrução pro LLM propor automaticamente
  if (resultados.length > 0) {
    return {
      resultados,
      total: resultados.length,
      _proximo_passo: 'AGORA chame propor_adicionar_item com o ID do item mais adequado. NÃO responda ao vendedor sem antes criar o card de ação.',
    }
  }

  // Se não achou e tinha filtro restritivo, sugere busca ampla
  if (busca || motorCv || capMin) {
    // Faz busca ampla automaticamente (só categoria)
    let q2 = supa
      .from('precos_branorte')
      .select('id, categoria, subcategoria, descricao, capacidade, capacidade_kg_pratica, motor_cv, motor_polos, valor_equipamento')
      .eq('ativo', true)
      .order('valor_equipamento', { ascending: true })
      .limit(8)
    if (catNorm) q2 = q2.eq('categoria', catNorm)
    const { data: data2 } = await q2
    if (data2 && data2.length > 0) {
      return {
        resultados: data2,
        total: data2.length,
        _nota: `Busca exata não retornou resultados. Estes são TODOS os itens da categoria ${categoria || 'geral'}. Escolha o mais próximo e chame propor_adicionar_item com justificativa.`,
        _proximo_passo: 'Chame propor_adicionar_item com o item mais próximo do que o vendedor pediu.',
      }
    }
  }

  return { resultados: [], total: 0 }
}

async function tool_consultar_motor(supa: SupabaseClient, args: Record<string, unknown>) {
  const cv = args.cv as number
  const polos = args.polos as number | undefined
  const voltagem = args.voltagem as string | undefined

  let q = supa
    .from('catalogo_motores')
    .select('cv, polos, voltagem, valor, modelo')
    .eq('ativo', true)
    .eq('cv', cv)

  if (polos) q = q.eq('polos', polos)
  if (voltagem) q = q.eq('voltagem', voltagem.toUpperCase())

  const { data, error } = await q
  if (error) return { erro: error.message }
  return { resultados: data ?? [] }
}

async function tool_listar_modelos_compacta(supa: SupabaseClient, args: Record<string, unknown>) {
  const limit = Math.min((args.max_resultados as number) || 12, 30)

  let q = supa
    .from('orcamento_modelos')
    .select(
      'id, basename, pacote, voltagem, is_master, is_jr, producao_kgh, armazenamento_kg, total_equipamentos, total_motores, total_proposta, com_balanca, com_ensacadeira, com_chupim'
    )
    .eq('ativo', true)
    .order('producao_kgh', { nullsFirst: false })
    .order('armazenamento_kg', { nullsFirst: false })
    .limit(limit)

  if (args.producao_min != null) q = q.gte('producao_kgh', args.producao_min as number)
  if (args.producao_max != null) q = q.lte('producao_kgh', args.producao_max as number)
  if (args.armazenamento_min != null) q = q.gte('armazenamento_kg', args.armazenamento_min as number)
  if (args.armazenamento_max != null) q = q.lte('armazenamento_kg', args.armazenamento_max as number)
  if (args.voltagem) q = q.eq('voltagem', (args.voltagem as string).toLowerCase())
  if (typeof args.com_balanca === 'boolean') q = q.eq('com_balanca', args.com_balanca)
  if (typeof args.com_ensacadeira === 'boolean') q = q.eq('com_ensacadeira', args.com_ensacadeira)
  if (typeof args.com_chupim === 'boolean') q = q.eq('com_chupim', args.com_chupim)
  if (typeof args.is_master === 'boolean') {
    q = q.eq('is_master', args.is_master)
  } else if (args.linha && (args.linha as string).toLowerCase().includes('master')) {
    // Vendedor pediu Master explicitamente
    q = q.eq('is_master', true)
  } else {
    // Default: SEMPRE excluir Master (versão mais cara) a menos que pedido
    q = q.eq('is_master', false)
  }
  if (args.linha) q = q.ilike('basename', `%${args.linha as string}%`)

  const { data, error } = await q
  if (error) return { erro: error.message }
  return { resultados: data ?? [], total: (data ?? []).length }
}

async function tool_detalhar_modelo(supa: SupabaseClient, args: Record<string, unknown>) {
  const id = args.modelo_id as number
  const { data, error } = await supa
    .from('orcamento_modelos')
    .select(
      'id, basename, pacote, voltagem, producao_kgh, armazenamento_kg, itens, acessorios, motores, total_equipamentos, total_motores, total_proposta'
    )
    .eq('id', id)
    .single()
  if (error) return { erro: error.message }
  return data
}

// ============================================================================
// AÇÕES PROPOSTAS — Sprint 2
// Tipo serializado que o frontend interpreta pra renderizar cards de aprovação.
// ============================================================================

type AcaoSugerida =
  | {
      tipo: 'adicionar_item'
      preco_branorte_id: number
      quantidade: number
      justificativa?: string
      auto_apply?: boolean  // se true, item é adicionado automaticamente sem clique
      // Snapshot dos dados pro card renderizar sem precisar refetch:
      preview?: {
        categoria: string
        descricao: string
        valor_equipamento: number | null
        motor_cv: number | null
        motor_polos: number | null
        capacidade: string | null
      }
    }
  | {
      tipo: 'carregar_pacote'
      modelo_id: number
      justificativa?: string
      preview?: {
        basename: string
        producao_kgh: number | null
        armazenamento_kg: number | null
        total_proposta: number | null
        qtd_itens: number
      }
    }
  | {
      tipo: 'preencher_cliente'
      dados: Record<string, string | undefined>
    }
  | {
      tipo: 'finalizar_orcamento'
      // Pré-fill do modal de finalização: opcionais
      enviar_whatsapp?: boolean
      cliente_dados?: Record<string, string | undefined>
      auto_submit?: boolean  // se true e tem dados suficientes, pula modal
    }

async function tool_propor_adicionar_item(
  supa: SupabaseClient,
  args: Record<string, unknown>
): Promise<{ acao: AcaoSugerida } | { erro: string }> {
  const id = args.preco_branorte_id as number
  const qtd = (args.quantidade as number) || 1
  const justificativa = (args.justificativa as string) || ''
  // Default TRUE — LLM frequentemente esquece de mandar auto_apply.
  // Só é false se explicitamente false.
  const autoApply = args.auto_apply !== false

  // Valida que o ID existe — bloqueia IA de inventar.
  const { data, error } = await supa
    .from('precos_branorte')
    .select('id, categoria, descricao, valor_equipamento, valor_com_motor_trif, valor_com_motor_mono, motor_cv, motor_polos, capacidade')
    .eq('id', id)
    .eq('ativo', true)
    .single()

  if (error || !data) return { erro: `preco_branorte_id ${id} não encontrado ou inativo` }

  // TRAVA DE PREÇO (fix 2026-07-16): item sem NENHUM preço cadastrado não pode virar
  // card — antes entrava "R$ 0,00" no orçamento (caso real: Misturador 3500 Litros).
  const vEquip = data.valor_equipamento ? Number(data.valor_equipamento) : 0
  const vTrif = data.valor_com_motor_trif ? Number(data.valor_com_motor_trif) : 0
  const vMono = data.valor_com_motor_mono ? Number(data.valor_com_motor_mono) : 0
  if (vEquip <= 0 && vTrif <= 0 && vMono <= 0) {
    return {
      erro: `"${data.descricao}" está SEM PREÇO cadastrado no catálogo — NÃO adicione. Avise o vendedor que este item precisa de preço em /orcamentos/precos antes de orçar, e ofereça a alternativa mais próxima COM preço.`,
    }
  }
  // Item que só existe COM motor (valor_equipamento nulo, ex: misturadores horizontais
  // 2700/3500): permitido, mas o preview carrega o valor com motor + nota explícita.
  const soComMotor = vEquip <= 0 && (vTrif > 0 || vMono > 0)

  return {
    acao: {
      tipo: 'adicionar_item',
      preco_branorte_id: id,
      quantidade: qtd,
      justificativa,
      auto_apply: autoApply,
      preview: {
        categoria: data.categoria,
        descricao: data.descricao,
        valor_equipamento: vEquip > 0 ? vEquip : null,
        valor_com_motor_trif: vTrif > 0 ? vTrif : null,
        valor_com_motor_mono: vMono > 0 ? vMono : null,
        ...(soComMotor ? { _nota: 'Item vendido SOMENTE COM MOTOR — use o valor com motor (trif/mono), não deixe R$ 0,00.' } : {}),
        motor_cv: data.motor_cv ? Number(data.motor_cv) : null,
        motor_polos: data.motor_polos,
        capacidade: data.capacidade,
      },
    },
  }
}

async function tool_propor_carregar_pacote(
  supa: SupabaseClient,
  args: Record<string, unknown>
): Promise<{ acao: AcaoSugerida } | { erro: string; sugestoes?: Array<{ id: number; basename: string }> }> {
  const id = args.modelo_id as number
  const justificativa = (args.justificativa as string) || ''
  const { data, error } = await supa
    .from('orcamento_modelos')
    .select('id, basename, producao_kgh, armazenamento_kg, total_proposta, itens')
    .eq('id', id)
    .eq('ativo', true)
    .single()

  if (error || !data) return { erro: `modelo_id ${id} não encontrado` }

  const qtdItens = Array.isArray(data.itens) ? (data.itens as unknown[]).length : 0

  return {
    acao: {
      tipo: 'carregar_pacote',
      modelo_id: id,
      justificativa,
      preview: {
        basename: data.basename,
        producao_kgh: data.producao_kgh,
        armazenamento_kg: data.armazenamento_kg,
        total_proposta: data.total_proposta ? Number(data.total_proposta) : null,
        qtd_itens: qtdItens,
      },
    },
  }
}

function tool_propor_preencher_cliente(
  args: Record<string, unknown>
): { acao: AcaoSugerida } {
  // Filtra só campos com valor (evita "" no payload)
  const dados: Record<string, string | undefined> = {}
  for (const k of ['nome', 'ac', 'fone', 'cidade', 'bairro', 'endereco', 'cep', 'cnpj', 'ie', 'email']) {
    const v = args[k]
    if (typeof v === 'string' && v.trim()) dados[k] = v.trim()
  }
  return { acao: { tipo: 'preencher_cliente', dados } }
}

function tool_propor_finalizar_orcamento(args: Record<string, unknown>): { acao: AcaoSugerida } {
  const enviarWa = args.enviar_whatsapp !== false  // default true
  const dados: Record<string, string | undefined> = {}
  if (typeof args.cliente_nome === 'string' && args.cliente_nome.trim()) dados.nome = args.cliente_nome.trim()
  if (typeof args.cliente_fone === 'string' && args.cliente_fone.trim()) dados.fone = args.cliente_fone.trim()
  if (typeof args.cliente_cidade === 'string' && args.cliente_cidade.trim()) dados.cidade = args.cliente_cidade.trim()
  if (typeof args.cliente_cnpj === 'string' && args.cliente_cnpj.trim()) dados.cnpj = args.cliente_cnpj.trim()
  // Auto-submit se tem nome do cliente (vendedor já forneceu no áudio/texto)
  // Só é false se explicitamente false OU sem nome do cliente
  const autoSubmit = args.auto_submit !== false && !!dados.nome
  return {
    acao: {
      tipo: 'finalizar_orcamento',
      enviar_whatsapp: enviarWa,
      cliente_dados: Object.keys(dados).length > 0 ? dados : undefined,
      auto_submit: autoSubmit,
    },
  }
}

async function executarTool(
  supa: SupabaseClient,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case 'consultar_precos':
      return tool_consultar_precos(supa, args)
    case 'consultar_motor':
      return tool_consultar_motor(supa, args)
    case 'listar_modelos_compacta':
      return tool_listar_modelos_compacta(supa, args)
    case 'detalhar_modelo':
      return tool_detalhar_modelo(supa, args)
    case 'compor_orcamento_composto':
      return tool_compor_orcamento_composto(supa, args)
    case 'propor_adicionar_item':
      return tool_propor_adicionar_item(supa, args)
    case 'propor_carregar_pacote':
      return tool_propor_carregar_pacote(supa, args)
    case 'propor_preencher_cliente':
      return tool_propor_preencher_cliente(args)
    case 'propor_finalizar_orcamento':
      return tool_propor_finalizar_orcamento(args)
    default:
      return { erro: `tool desconhecida: ${name}` }
  }
}

// ============================================================================
// COMPOR ORÇAMENTO COMPOSTO — busca uma lista de itens em paralelo
// ============================================================================
//
// Recebe array de pedidos e busca cada um. Retorna 3 grupos pro LLM decidir
// como apresentar pro vendedor:
//   - matches: 1 item exato encontrado → pronto pra propor_adicionar_item
//   - alternativas: 2-5 próximos quando não há match exato
//   - gaps: nada parecido encontrado → vendedor humano cota manualmente
type ItemPedido = {
  descricao_vendedor: string
  categoria: string
  subcategoria?: string
  busca?: string
  motor_cv?: number
  capacidade_min?: number
  capacidade_max?: number
  capacidade_ton_min?: number
  capacidade_ton_max?: number
  quantidade?: number
}

async function tool_compor_orcamento_composto(
  supa: SupabaseClient,
  args: Record<string, unknown>
): Promise<unknown> {
  const itens = (args.itens as ItemPedido[]) || []
  if (!Array.isArray(itens) || itens.length === 0) {
    return { erro: 'lista de itens vazia' }
  }

  // Helper: buscar no catálogo com filtros
  async function buscarItem(item: ItemPedido, tentativa: 'precisa' | 'ampla') {
    let q = supa
      .from('precos_branorte')
      .select('id, categoria, subcategoria, descricao, valor_equipamento, motor_cv, motor_polos, capacidade, capacidade_ton, potencia')
      .eq('ativo', true)
      .order('valor_equipamento', { ascending: true })
      .limit(8)

    // Normalizar categorias
    const catNorm2 = item.categoria?.toUpperCase() === 'CACAMBA' ? 'CACAMBA_PESAGEM' : item.categoria?.toUpperCase()
    if (catNorm2) q = q.eq('categoria', catNorm2)

    // SILOS: SEMPRE buscar por capacidade_ton, nunca por texto.
    if (item.categoria?.toUpperCase() === 'SILO' && tentativa === 'precisa') {
      // Extrai tonelagem de TODOS os textos disponíveis
      const todosTextos = [item.descricao_vendedor || '', item.busca || ''].join(' ')
      // Prioriza "XX toneladas" sobre número solto
      const numMatch = todosTextos.match(/(\d+)\s*(?:ton|tonelada)/i)
        || todosTextos.match(/silo\s*(?:de\s*)?(\d+)/i)
        || todosTextos.match(/(\d+)\s*t\b/i)
        || todosTextos.match(/(\d+)/)
      if (numMatch) {
        const ton = parseInt(numMatch[1])
        if (ton > 0 && ton < 10000) {
          // Margem de ±25% pra pegar silos próximos (ex: 40t pega 30-50t)
          q = q.gte('capacidade_ton', ton * 0.75).lte('capacidade_ton', ton * 1.25)
          q = q.order('capacidade_ton', { ascending: true })
          return q
        }
      }
      // Fallback: se não extraiu tonelagem, traz todos silos ordenados
      q = q.order('capacidade_ton', { ascending: true }).limit(10)
      return q
    }

    // TRANSPORTADOR: auto-detectar diâmetro × comprimento
    // Tenta tanto a busca quanto a descricao_vendedor (LLM às vezes passa busca sem comprimento)
    if (item.categoria?.toUpperCase() === 'TRANSPORTADOR' && tentativa === 'precisa') {
      // Combina todos os textos disponíveis pra maximizar chance de extrair dimensões
      const textos = [item.descricao_vendedor || '', item.busca || '']
      for (const textoRef of textos) {
        if (!textoRef) continue
        const dimMatch = textoRef.match(/(\d{3})\s*(?:x|por|×|X)\s*(\d{1,2}(?:[.,]\d)?)/i)
          || textoRef.match(/(\d{3})\s+(\d{1,2}(?:[.,]\d)?)\s*m/i)
          || textoRef.match(/(\d{3})\s+(\d{1,2})/)
        if (dimMatch) {
          const diam = dimMatch[1]  // 160, 210
          const comp = dimMatch[2].replace('.', ',')  // 14 → 14
          const tipo = (diam === '160' || diam === '210') ? 'chupim' : 'TH'
          const buscaExata = `${tipo} ${diam} x ${comp}`
          q = q.eq('subcategoria', tipo === 'chupim' ? 'CHUPIM' : 'HELICOIDAL')
          q = q.ilike('descricao', `%${buscaExata}%`)
          return q
        }
      }
    }

    if (tentativa === 'precisa') {
      if (item.subcategoria) q = q.eq('subcategoria', item.subcategoria.toUpperCase())
      if (item.busca) {
        // Busca tokenizada (fix 2026-07-16): mesma lógica de consultar_precos — cada
        // palavra é um filtro AND sem exigir ordem, decimais normalizados por token,
        // casando em descrição OU subcategoria (ex: "horizontal").
        for (const filtro of buildBuscaTokens(item.busca)) {
          const alvos = filtro.flatMap((v) => [`descricao.ilike.%${v}%`, `subcategoria.ilike.%${v}%`])
          q = q.or(alvos.join(','))
        }
      }
      if (item.motor_cv != null) q = q.eq('motor_cv', item.motor_cv)
      if (item.capacidade_min != null) q = q.gte('capacidade_kg_pratica', item.capacidade_min)
      if (item.capacidade_max != null) q = q.lte('capacidade_kg_pratica', item.capacidade_max)
      // Silos: filtrar por tonelagem
      const tonMin = (item as Record<string, unknown>).capacidade_ton_min as number | undefined
      const tonMax = (item as Record<string, unknown>).capacidade_ton_max as number | undefined
      if (tonMin != null) q = q.gte('capacidade_ton', tonMin)
      if (tonMax != null) q = q.lte('capacidade_ton', tonMax)
    } else {
      // Busca AMPLA: só categoria, sem filtros restritivos
    }

    return q
  }

  const resultados = await Promise.all(
    itens.map(async (item) => {
      try {
        // COMPACTA/MINI FÁBRICA: redireciona pra listar_modelos_compacta
        const descLower = (item.descricao_vendedor || '').toLowerCase()
        const catLower = (item.categoria || '').toLowerCase()
        const isCompacta = catLower.includes('compacta') || descLower.includes('compacta') || descLower.includes('mini fábrica') || descLower.includes('mini fabrica') || descLower.includes('minifábrica')
        if (isCompacta) {
          // Extrair linha (01, 02, 03) e produção/armazenamento
          const linhaMatch = descLower.match(/compacta\s*(\d{2})/)
          const linha = linhaMatch ? `Compacta ${linhaMatch[1]}` : undefined
          // Extrair números de produção/armazenamento
          const nums = descLower.match(/(\d{2,3})\s*[-xX×]\s*(\d{3,4})/) || descLower.match(/(\d{2,3})(\d{3,4})/) || descLower.match(/(\d{2,3})\s*(?:mil|000)/)
          let prodMin, prodMax, armazMin, armazMax
          if (nums) {
            const prod = parseInt(nums[1])
            prodMin = Math.round(prod * 0.85)
            prodMax = Math.round(prod * 1.15)
            if (nums[2]) {
              const armaz = parseInt(nums[2])
              armazMin = Math.round(armaz * 0.85)
              armazMax = Math.round(armaz * 1.15)
            }
          }
          const voltMatch = descLower.match(/trif|trifásica|trifasica/) ? 'trifasico' : descLower.match(/mono|monofásica|monofasica/) ? 'monofasico' : undefined
          const isMaster = descLower.includes('master')

          const listResult = await tool_listar_modelos_compacta(supa, {
            ...(linha ? { linha } : {}),
            ...(prodMin ? { producao_min: prodMin, producao_max: prodMax } : {}),
            ...(armazMin ? { armazenamento_min: armazMin, armazenamento_max: armazMax } : {}),
            ...(voltMatch ? { voltagem: voltMatch } : {}),
            ...(isMaster ? { is_master: true } : {}),
          })
          const models = (listResult as { resultados?: Array<Record<string, unknown>> }).resultados || []
          if (models.length > 0) {
            const best = models[0] as Record<string, unknown>
            return {
              item,
              status: 'compacta_encontrada' as const,
              modelo: best,
              candidatos: models.map((m: Record<string, unknown>) => ({
                id: m.id,
                descricao: m.basename as string,
                valor_unit: m.total_proposta ? Number(m.total_proposta) : null,
                categoria: 'COMPACTA',
              })),
            }
          }
          return { item, status: 'gap' as const, candidatos: [], nota: `Compacta ${linha || ''} não encontrada no catálogo` }
        }

        // Tentativa 1: busca precisa (itens individuais)
        const q1 = await buscarItem(item, 'precisa')
        const { data: data1, error: err1 } = await q1
        if (err1) return { item, erro: err1.message }

        let candidatos = (data1 ?? []).map(c => ({
          id: c.id,
          descricao: c.descricao,
          valor_unit: c.valor_equipamento ? Number(c.valor_equipamento) : null,
          motor_cv: c.motor_cv,
          motor_polos: c.motor_polos,
          capacidade: c.capacidade,
          potencia: c.potencia,
          categoria: c.categoria,
          subcategoria: c.subcategoria,
        }))

        // Tentativa 2: se não achou nada e tem busca/capacidade, faz busca AMPLA
        if (candidatos.length === 0 && (item.busca || item.capacidade_min || item.motor_cv)) {
          const q2 = await buscarItem(item, 'ampla')
          const { data: data2 } = await q2
          candidatos = (data2 ?? []).map(c => ({
            id: c.id,
            descricao: c.descricao,
            valor_unit: c.valor_equipamento ? Number(c.valor_equipamento) : null,
            motor_cv: c.motor_cv,
            motor_polos: c.motor_polos,
            capacidade: c.capacidade,
            potencia: c.potencia,
            categoria: c.categoria,
            subcategoria: c.subcategoria,
          }))
          if (candidatos.length > 0) {
            return { item, status: 'alternativas_amplas' as const, candidatos, nota: `Busca exata "${item.busca || ''}" não encontrou. Estas são as opções disponíveis na categoria ${item.categoria}.` }
          }
        }

        if (candidatos.length === 0) {
          return { item, status: 'gap' as const, candidatos: [] }
        }
        if (candidatos.length === 1) {
          return { item, status: 'match_exato' as const, candidatos }
        }
        return { item, status: 'alternativas' as const, candidatos }
      } catch (e) {
        return { item, erro: (e as Error).message }
      }
    })
  )

  // Sumário rápido pro LLM tomar decisão
  const matches = resultados.filter(r => 'status' in r && r.status === 'match_exato')
  const alternativas = resultados.filter(r => 'status' in r && (r.status === 'alternativas' || r.status === 'alternativas_amplas'))
  const gaps = resultados.filter(r => 'status' in r && r.status === 'gap')
  const compactas = resultados.filter(r => 'status' in r && r.status === 'compacta_encontrada')

  // Instrução especial se tem compacta encontrada
  let instrucaoCompacta = ''
  if (compactas.length > 0) {
    const c = compactas[0] as { modelo: Record<string, unknown> }
    instrucaoCompacta = ` COMPACTA ENCONTRADA: chame propor_carregar_pacote com modelo_id=${c.modelo.id} (${c.modelo.basename}). NÃO use outro ID.`
  }

  return {
    total_pedidos: itens.length,
    matches_exatos: matches.length,
    com_alternativas: alternativas.length,
    compactas_encontradas: compactas.length,
    gaps: gaps.length,
    resultados,
    instrucao_para_ia: 'OBRIGATÓRIO: chame propor_adicionar_item pra cada match_exato. Pra alternativas, escolha o mais próximo. Pra gaps, liste como "❌ Não achei".' + instrucaoCompacta,
  }
}

// ============================================================================
// HANDLER
// ============================================================================

interface ChatMsg {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

interface ReqBody {
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  context?: {
    orcamento_id?: number | string
    carrinho_resumo?: string
    cliente_nome?: string
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) {
    return res.status(500).json({ error: 'env_missing', detail: 'SUPABASE env vars not set' })
  }
  if (!OPENAI_KEY) {
    return res.status(500).json({ error: 'env_missing', detail: 'OPENAI_API_KEY not set' })
  }

  // JWT do Supabase obrigatório (igual padrão de feedback.ts)
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })

  const body = req.body as ReqBody
  if (!body?.messages?.length) return res.status(400).json({ error: 'no_messages' })

  // Monta histórico inicial com system prompt + MAPA DO CATÁLOGO ao vivo (cache 10 min)
  // + contexto opcional. O mapa dá à IA a visão COMPLETA do que existe pra orçar.
  const catalogoDigest = await getCatalogoDigest(supa)
  const messages: ChatMsg[] = [{ role: 'system', content: SYSTEM_PROMPT + catalogoDigest }]
  if (body.context) {
    const ctx = []
    if (body.context.cliente_nome) ctx.push(`Cliente: ${body.context.cliente_nome}`)
    if (body.context.carrinho_resumo) ctx.push(`Itens já no orçamento:\n${body.context.carrinho_resumo}`)
    if (ctx.length)
      messages.push({
        role: 'system',
        content: `CONTEXTO DO ORÇAMENTO ATUAL:\n${ctx.join('\n')}`,
      })
  }
  for (const m of body.messages) {
    if (m.role === 'user' || m.role === 'assistant') {
      messages.push({ role: m.role, content: m.content })
    }
  }

  // Loop com tool use
  let iteration = 0
  const toolTrace: Array<{ name: string; args: unknown; ok: boolean; ms: number }> = []
  // Coleta as ações sugeridas (Sprint 2) durante o loop pra devolver no response
  const acoesSugeridas: AcaoSugerida[] = []

  while (iteration < MAX_TOOL_ITERATIONS) {
    iteration++

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: OPENAI_MODEL,
        messages,
        tools,
        tool_choice: 'auto',
        temperature: 0.2,
      }),
    })

    if (!openaiRes.ok) {
      const errText = await openaiRes.text()
      return res.status(502).json({
        error: 'openai_error',
        status: openaiRes.status,
        detail: errText.slice(0, 500),
      })
    }

    const result = (await openaiRes.json()) as {
      choices: Array<{ message: ChatMsg; finish_reason: string }>
      usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number }
    }
    const choice = result.choices?.[0]
    if (!choice) return res.status(502).json({ error: 'no_choice' })
    const msg = choice.message

    // Se GPT pediu tools, executa todas e devolve
    if (msg.tool_calls?.length) {
      messages.push(msg)
      for (const tc of msg.tool_calls) {
        const start = Date.now()
        let parsedArgs: Record<string, unknown> = {}
        try {
          parsedArgs = JSON.parse(tc.function.arguments)
        } catch {
          parsedArgs = {}
        }
        const result = await executarTool(supa, tc.function.name, parsedArgs)
        const ms = Date.now() - start
        const erro = (result as { erro?: string })?.erro
        toolTrace.push({
          name: tc.function.name,
          args: parsedArgs,
          ok: !erro,
          ms,
        })
        // Se a tool gerou uma ação sugerida (propor_*), coleta pro response
        const acao = (result as { acao?: AcaoSugerida })?.acao
        if (acao) acoesSugeridas.push(acao)

        // AUTO-PROPOSE: quando consultar_precos retorna resultados e tem 1 match claro,
        // gera ação automaticamente sem esperar o LLM chamar propor_adicionar_item.
        // Isso elimina 1 round-trip inteiro e garante que os cards apareçam.
        if (tc.function.name === 'consultar_precos' || tc.function.name === 'compor_orcamento_composto') {
          const res2 = result as { resultados?: Array<{ id: number; categoria: string; descricao: string; valor_equipamento: number | null; motor_cv: number | null; motor_polos: number | null; capacidade: string | null }>; total?: number }
          // Se tem 1-3 resultados e veio com busca específica, auto-propõe o primeiro
          if (res2.resultados && res2.resultados.length >= 1 && res2.resultados.length <= 3 && (parsedArgs.busca || parsedArgs.categoria)) {
            const best = res2.resultados[0]
            if (best.id && best.valor_equipamento) {
              // Não duplicar: checa só por ID (mesmo item). Categorias diferentes ou mesmo item
              // com medidas diferentes (chupim 160x14 vs 160x5) devem ambos ser propostos.
              const jaTemEsseId = acoesSugeridas.some(a => a.tipo === 'adicionar_item' && a.preco_branorte_id === best.id)
              if (!jaTemEsseId) {
                // Pegar quantidade: de compor_orcamento args (itens[].quantidade) ou default 1
                let qtd = 1
                if (tc.function.name === 'compor_orcamento_composto' && Array.isArray(parsedArgs.itens)) {
                  // Pega a quantidade do item cujo resultado bateu com best.id
                  // Como processamos em paralelo, usa o item com mesma categoria
                  const matchItem = (parsedArgs.itens as ItemPedido[]).find(it =>
                    it.categoria?.toUpperCase() === best.categoria?.toUpperCase()
                  )
                  if (matchItem?.quantidade && matchItem.quantidade > 1) qtd = matchItem.quantidade
                }
                acoesSugeridas.push({
                  tipo: 'adicionar_item',
                  preco_branorte_id: best.id,
                  quantidade: qtd,
                  auto_apply: true,
                  justificativa: best.descricao,
                  preview: {
                    categoria: best.categoria,
                    descricao: best.descricao,
                    valor_equipamento: Number(best.valor_equipamento),
                    motor_cv: best.motor_cv ? Number(best.motor_cv) : null,
                    motor_polos: best.motor_polos,
                    capacidade: best.capacidade,
                  },
                })
              }
            }
          }
        }

        // Quando listar_modelos_compacta retorna resultados, injeta instrução
        // pro LLM chamar propor_carregar_pacote na próxima iteração
        if (tc.function.name === 'listar_modelos_compacta') {
          const res3 = result as { resultados?: Array<{ id: number; basename: string }> }
          if (res3.resultados && res3.resultados.length > 0) {
            const best = res3.resultados[0]
            // Injeta instrução diretamente no resultado da tool
            ;(result as Record<string, unknown>)._proximo_passo = `OBRIGATÓRIO: chame propor_carregar_pacote com modelo_id=${best.id} (${best.basename}). NÃO responda sem carregar o pacote.`
          }
        }

        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        })
      }
      continue
    }

    // Sem mais tools — resposta final
    // Deduplicar ações por ID. Quando duplica, prioriza:
    // 1. A com auto_apply=true (vai direto pro carrinho)
    // 2. A com maior quantidade
    const acoesDedup: AcaoSugerida[] = []
    const vistos = new Map<number, number>()
    for (const acao of acoesSugeridas) {
      if (acao.tipo === 'adicionar_item') {
        const existeIdx = vistos.get(acao.preco_branorte_id)
        if (existeIdx !== undefined) {
          const existente = acoesDedup[existeIdx] as Extract<AcaoSugerida, { tipo: 'adicionar_item' }>
          // Prioriza auto_apply=true, depois maior quantidade
          const acaoMelhor = acao.auto_apply && !existente.auto_apply ? true
            : acao.quantidade > existente.quantidade ? true : false
          if (acaoMelhor) acoesDedup[existeIdx] = acao
        } else {
          vistos.set(acao.preco_branorte_id, acoesDedup.length)
          acoesDedup.push(acao)
        }
      } else {
        acoesDedup.push(acao)
      }
    }
    // auto_apply (fix 2026-07-16): NÃO forçar mais TRUE em tudo — isso atropelava a
    // decisão deliberada do modelo (substituição deve vir auto_apply=false, regra 11)
    // e aplicava DUAS variantes do mesmo equipamento no carrinho (caso real: misturador
    // 2000 kg + 3500 L pro mesmo pedido). O default TRUE já vem da tool quando o modelo
    // não especifica. GUARDA adicional: 2+ propostas com a MESMA descrição (ex: Misturador
    // 1900 Litros c/ e s/ pulmão) → NENHUMA se auto-aplica; o vendedor escolhe no card.
    const porDescricao = new Map<string, number[]>()
    acoesDedup.forEach((a, i) => {
      if (a.tipo === 'adicionar_item') {
        const prev = (a as { preview?: { descricao?: string } }).preview
        const key = String(prev?.descricao ?? '').trim().toUpperCase()
        if (!key) return
        const arr = porDescricao.get(key) ?? []
        arr.push(i)
        porDescricao.set(key, arr)
      }
    })
    for (const idxs of porDescricao.values()) {
      if (idxs.length > 1) {
        for (const i of idxs) {
          ;(acoesDedup[i] as { auto_apply?: boolean }).auto_apply = false
        }
      }
    }

    // FALLBACK: se listar_modelos_compacta achou resultado mas nenhuma ação
    // carregar_pacote existe, gerar a ação automaticamente aqui no response
    const temPacoteAcao = acoesDedup.some(a => a.tipo === 'carregar_pacote')
    if (!temPacoteAcao) {
      const listarCall = toolTrace.find(t => t.name === 'listar_modelos_compacta' && t.ok)
      if (listarCall) {
        // Buscar o primeiro resultado do listar_modelos_compacta nos messages
        for (const m of messages) {
          if (m.role === 'tool' && m.content) {
            try {
              const parsed = JSON.parse(m.content)
              if (parsed.resultados && Array.isArray(parsed.resultados) && parsed.resultados.length > 0) {
                const first = parsed.resultados[0]
                if (first.id && first.basename && !first.categoria) {
                  // É resultado de listar_modelos (tem basename, não tem categoria)
                  acoesDedup.push({
                    tipo: 'carregar_pacote',
                    modelo_id: first.id,
                    justificativa: `Pacote ${first.basename}`,
                    preview: {
                      basename: first.basename,
                      producao_kgh: first.producao_kgh,
                      armazenamento_kg: first.armazenamento_kg,
                      total_proposta: first.total_proposta ? Number(first.total_proposta) : null,
                      qtd_itens: Array.isArray(first.itens) ? first.itens.length : 0,
                    },
                  })
                  break
                }
              }
            } catch { /* ignore non-json */ }
          }
        }
      }
    }

    return res.status(200).json({
      reply: msg.content || '',
      acoes: acoesDedup,
      tool_trace: toolTrace,
      iterations: iteration,
    })
  }

  return res.status(500).json({
    error: 'max_iterations_exceeded',
    acoes: acoesSugeridas,
    tool_trace: toolTrace,
  })
}
