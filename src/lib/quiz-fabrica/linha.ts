/**
 * A linha Branorte que o quiz público pode citar — SEM PREÇO.
 *
 * ── Por que é um snapshot no código, e não uma consulta ao banco ────────────
 * A página /monte-sua-fabrica roda DESLOGADA. Ler `precos_branorte` de lá
 * exigiria abrir SELECT pro papel `anon` na tabela de preços — a tabela que
 * guarda a margem da empresa inteira. Não vale a pena por um quiz. Então aqui
 * mora só o que o cliente pode ver de qualquer jeito (nome, capacidade, CV),
 * copiado de `precos_branorte` em 20/08/2026 com `ativo = true`.
 *
 * ── Como manter ────────────────────────────────────────────────────────────
 * Quando a fábrica mexer na escada de produtos, rodar:
 *
 *   select categoria, subcategoria, descricao, capacidade, motor_cv
 *     from precos_branorte where coalesce(ativo,true) order by 1,2,3;
 *
 * e conferir as listas abaixo. O motor arredonda SEMPRE pra cima na escada, o
 * que significa que uma escada desatualizada superdimensiona — erra pro lado
 * seguro, nunca entrega máquina pequena demais pro cliente.
 */

// ---------------------------------------------------------------------------
// Moagem
// ---------------------------------------------------------------------------

/**
 * Moinhos de martelo. `kgh` é a capacidade IMPRESSA na descrição do produto,
 * não uma derivação de CV.
 *
 * ⚠️ E é de propósito. "Produção = CV × 100" é a regra-mestra da fábrica e vale
 * em 9 dos 10 degraus abaixo — mas ela descreve o CHASSI MAIS LEVE de cada
 * potência, não a potência. O BNMM540 tem 40 CV e rende 4.500 kg/h (chassi 5),
 * 12% acima do que a regra preveria. A planilha oficial traz coluna literal de
 * capacidade; é dela que estes números saem. Derivar de CV entregaria menos
 * máquina do que o cliente pagou.
 *
 * ⚠️ BNMM315 (1.700 kg/h) e BNMM425 (2.200 kg/h) ficaram DE FORA de propósito.
 * Nos dois a descrição diz um CV e a coluna `motor_cv` diz outro (15 vs 20, e
 * 20 vs 30) — divergência conhecida e ainda não resolvida com a fábrica. Como
 * são degraus INTERMEDIÁRIOS (1.700 entre 1.500 e 2.000; 2.200 entre 2.000 e
 * 3.000), tirá-los só faz o quiz subir pro degrau seguinte. Ninguém recebe
 * máquina menor do que precisa por causa disso.
 */
export const MOINHOS: Array<{ codigo: string; cv: number; kgh: number }> = [
  { codigo: 'BNMM130',  cv: 3,   kgh: 300 },
  { codigo: 'BNMM175',  cv: 7.5, kgh: 750 },
  { codigo: 'BNMM210',  cv: 10,  kgh: 1000 },
  { codigo: 'BNMM215',  cv: 15,  kgh: 1500 },
  { codigo: 'BNMM320',  cv: 20,  kgh: 2000 },
  { codigo: 'BNMM440',  cv: 30,  kgh: 3000 },
  { codigo: 'BNMM540',  cv: 40,  kgh: 4500 },
  { codigo: 'BNMM550',  cv: 50,  kgh: 5000 },
  { codigo: 'BNMM675',  cv: 75,  kgh: 7500 },
  { codigo: 'BNMM7100', cv: 100, kgh: 10000 },
]

// ---------------------------------------------------------------------------
// Mistura
// ---------------------------------------------------------------------------

/** Misturador vertical, em kg de carga. CV fica fora: ver nota em MISTURADOR_HORIZONTAL. */
export const MISTURADOR_VERTICAL: number[] = [150, 300, 500, 1000, 1500, 2000, 2500, 3000, 3500, 4000]

/**
 * Misturador horizontal (linha MASTER). O catálogo nomeia em LITROS, o produtor
 * pensa em kg — então guardo os dois.
 *
 * A conversão litro→kg não é chute: 1.900 L = 1.000 kg é medida da fábrica, e
 * 2.700/3.500 L = 1.500/2.000 kg está em `precos_branorte`. Os três degraus de
 * baixo (300/600/1.000 L) saem dos códigos reais das Compactas MASTER, que
 * pareiam 75150 → misturador 150 kg, 75300 → 300 kg e 100500 → 500 kg.
 *
 * ⚠️ CV do misturador NÃO entra aqui. BNMV3000 e BNMV4000 já cobraram motor
 * errado por anos (12,5 CV onde é 7,5; 15 onde é 10) e o número consertado
 * ainda não é o mesmo em todos os lugares. Numa página que o cliente lê, um CV
 * errado vira discussão na hora do orçamento. Carga em kg basta.
 */
export const MISTURADOR_HORIZONTAL: Array<{ litros: number; kg: number }> = [
  { litros: 300,  kg: 150 },
  { litros: 600,  kg: 300 },
  { litros: 1000, kg: 500 },
  { litros: 1900, kg: 1000 },
  { litros: 2700, kg: 1500 },
  { litros: 3500, kg: 2000 },
]

// ---------------------------------------------------------------------------
// Dosagem, recebimento, armazenagem, expedição
// ---------------------------------------------------------------------------

/** Caçamba de pesagem, em kg. Motorredutor 2 CV incluso; balança é à parte. */
export const CACAMBAS: number[] = [500, 1000, 1500, 2000]

/** Caixa de recepção (moega), em m³. */
export const CAIXAS_RECEPCAO: Array<{ codigo: string; m3: number }> = [
  { codigo: 'BNCX33', m3: 25 },
  { codigo: 'BNCX36', m3: 50 },
  { codigo: 'BNCX39', m3: 75 },
]

/** Pré-limpeza, em ton/h. */
export const PRE_LIMPEZAS: Array<{ tonH: number; cv: number }> = [
  { tonH: 3,  cv: 0.75 },
  { tonH: 7,  cv: 2 },
  { tonH: 10, cv: 3 },
]

/**
 * Caixa de ração pronta (linha BNCX picados), em kg.
 *
 * REGRA DO DONO (10/06/2026): o padrão comercial é 2, 4 e 5 t — acima disso a
 * indicação é SILO DE RAÇÃO, não caixa. Os 6.000 kg entram porque é o que a
 * Compacta 03 realmente embarca (códigos "… - 6000/6000"). Passou de 6 t, o
 * motor manda pro silo.
 */
export const CAIXAS_RACAO: number[] = [1300, 2600, 4000, 5200, 6000]

/**
 * Silo de milho, em toneladas, com o ângulo do funil.
 *
 * REGRA DO DONO: milho e grãos escoam em qualquer funil. FARELO DE SOJA forma
 * ponte e exige 60° — por isso o motor nunca manda farelo pra um silo 45°.
 *
 * ⚠️ A escada tem que ir até o FIM do catálogo. Quando parava em 368 t, um
 * produtor que precisava de 503 t recebia "silo de 368,25 t — enche na safra e
 * atravessa a entressafra": o motor caía no maior degrau em silêncio e a tela
 * afirmava, na cara do cliente, uma coisa que o silo não faz.
 */
export const SILOS_MILHO: Array<{ ton: number; funil: '45' | '60' | 'PLANO' }> = [
  { ton: 28,      funil: '60' },
  { ton: 35.2,    funil: '60' },
  { ton: 42.5,    funil: '60' },
  { ton: 69,      funil: '45' },
  { ton: 120,     funil: '45' },
  { ton: 140,     funil: '45' },
  { ton: 196.5,   funil: '45' },
  { ton: 249.75,  funil: '45' },
  { ton: 298.5,   funil: '45' },
  { ton: 333.75,  funil: 'PLANO' },
  { ton: 368.25,  funil: '45' },
  { ton: 474.75,  funil: 'PLANO' },
  { ton: 961.5,   funil: 'PLANO' },
  { ton: 1008.75, funil: 'PLANO' },
  { ton: 1388.25, funil: 'PLANO' },
  { ton: 1415.25, funil: 'PLANO' },
  { ton: 1972.5,  funil: 'PLANO' },
  { ton: 1992.75, funil: 'PLANO' },
]

/**
 * Caixa de recepção por porte da carga que encosta — a moega precisa engolir UMA
 * ENTREGA sem o caminhão esperar, e o que manda é o veículo, não o consumo do mês.
 *
 * Dimensionar pelo consumo mensal mandava 75 m³ (56 t) pra quem recebe carreta
 * de 36 t: moega de sobra, dinheiro parado em chapa.
 *
 * `ateTonMes` é o consumo de MILHO por mês que ainda cabe nesse porte de entrega.
 */
export const RECEPCAO_POR_PORTE: Array<{ ateTonMes: number; codigo: string; m3: number; veiculo: string }> = [
  { ateTonMes: 20,       codigo: 'BNCX33', m3: 25, veiculo: 'caminhão truck (~14 t)' },
  { ateTonMes: 100,      codigo: 'BNCX36', m3: 50, veiculo: 'carreta (~36 t)' },
  { ateTonMes: Infinity, codigo: 'BNCX39', m3: 75, veiculo: 'bitrem ou rodotrem (~50 t)' },
]

/**
 * Pré-limpeza por porte da moega. Ela limpa o grão NA DESCARGA, então quem manda
 * é a vazão de recebimento — não a de moagem.
 *
 * Dimensionar pelo moinho dava pré-limpeza de 3 t/h numa fábrica com moega de
 * 56 t: dezoito horas pra limpar uma carga, com o motorista parado no pátio.
 */
export const PRELIMPEZA_POR_RECEPCAO: Record<number, number> = { 25: 3, 50: 7, 75: 10 }

/** Silo de ração pronta, em toneladas. Todos funil 60° — ração empedra. */
export const SILOS_RACAO: number[] = [3, 4.7, 6.3, 8.5, 12.3, 16.1, 20, 24.2, 66, 114, 131]

/** Esteira de sacaria, em metros. Motorredutor 2 CV incluso. */
export const ESTEIRAS_SACARIA: number[] = [5.5, 7.5]

// ---------------------------------------------------------------------------
// Compactas (fábricas prontas)
// ---------------------------------------------------------------------------

/**
 * ⚠️ O CÓDIGO DA COMPACTA NÃO É A CAPACIDADE.
 *
 * O código é `[CV do moinho × 10][kg do misturador]`. Então `30150` = moinho de
 * 3 CV + misturador de 150 kg, e a produção sai da REGRA-MESTRA da fábrica:
 * **produção kg/h = CV do moinho × 100**. Logo 30150 = 300 kg/h, e 5001000 =
 * 5.000 kg/h.
 *
 * Ler o prefixo como se fosse produção dá capacidade 10× menor — foi o erro que
 * circulou entre 08/06 e 18/08/2026 e contaminou quem consultou a tabela nesse
 * período.
 *
 * ⚠️ E é por isso que a produção está FIXADA aqui em vez de vir de
 * `precos_branorte.capacidade`: aquela coluna está meio migrada. Hoje convivem
 * linhas certas ("1000 kg/h · misturador 500 kg") com linhas na leitura antiga
 * e errada ("100 kg/h · 300 kg armaz." pro código 100300, que é 1.000 kg/h).
 * Confiar nela publicaria o número errado pro cliente.
 *
 * `caixas` só existe na 03/03 MASTER — é o sufixo "- 4000/4000" do código, as
 * duas caixas de ração pronta que a linha industrial embarca.
 */
export interface CompactaSku {
  linha: 'MINI' | '01' | '01 MASTER' | '02' | '02 MASTER' | '03' | '03 MASTER'
  codigo: string
  producaoKgH: number
  misturadorKg: number
  caixas: number[]
}

/**
 * ═══ A ESCADA COMERCIAL — REGRA DO DONO, ditada em 20/08/2026 ═══
 *
 *   até 600 kg/h ......... MINI FÁBRICA
 *   600 a 1.500 kg/h ..... COMPACTA 01
 *   1.500 a 2.200 kg/h ... COMPACTA 02
 *   acima de 2.200 ....... COMPACTA 03
 *
 * Palavras dele: *"Até 600 quilo hora tu indica a mini fábrica. De mais de 600
 * até 1500, Compacta 1. Mais de 1500 até [2] toneladas a hora, Compacta 2.
 * [Acima] daí indica a Compacta 3."*
 *
 * ⚠️ BANDA e TETO são coisas DIFERENTES, e confundi-las trava a escada. A BANDA
 * é a DEMANDA que cai naquela família ("quem precisa de 2.100 kg/h é 02"). O
 * TETO é a maior MÁQUINA que a família pode oferecer. Um produtor de 2.100 cai
 * na banda da 02 e leva a máquina de 2.500 — que é o degrau que atende.
 *
 * ⚠️ O teto da 02 andou três vezes num dia só (2.000 → "12 toneladas" → 2.200).
 * Vale o último: **2.200**. Mas o número sozinho não muda nada — o que decide é
 * que MÁQUINA existe naquela faixa. Ver a nota das 2.500 em COMPACTAS.
 *
 * ⚠️ QUEM DECIDE A LINHA É A CAPACIDADE, e só ela. Ensacar e querer pesagem
 * automática NÃO mudam de família — viram equipamento dentro da linha
 * escolhida. Antes disso, dizer "quero ensacar" pulava direto pra 03.
 *
 * ⚠️ E isto NÃO sai do código do SKU. A tabela de preços tem
 * `COMPACTA 02 - 3001000`, cujo código decodifica 3.000 kg/h — derivar a escada
 * do código fazia o quiz oferecer uma 02 desse porte pra quem precisava de
 * 2.049. O teto comercial não está no dado; está na cabeça de quem vende.
 */
export const BANDA_FAMILIA: Array<{ familia: string; ateKgH: number }> = [
  { familia: 'MINI', ateKgH: 600 },
  { familia: '01', ateKgH: 1500 },
  { familia: '02', ateKgH: 2200 },
  { familia: '03', ateKgH: Infinity },
]

/**
 * Maior SKU que cada família pode oferecer, em kg/h.
 *
 * Difere da BANDA porque os degraus de máquina não caem exatamente nos limites
 * comerciais: a Mini atende "até 600", mas o degrau real acima de 300 é o de
 * 750 — não existe máquina de 600. Quem precisa de 500 leva a Mini de 750,
 * dentro da família que a regra manda.
 */
export const TETO_FAMILIA: Record<string, number> = {
  MINI: 750,
  '01': 1500,
  '01 MASTER': 1500,
  // A ficha oficial da 02 VERTICAL para em 2.000 kg/h (tabela impressa na
  // própria ficha: 750 · 1000 · 1000 · 1500 · 1500 · 2000). A MASTER vai a
  // 2.500 — é o que a ficha `Compacta 02 Master - 2501000` mostra.
  '02': 2000,
  '02 MASTER': 2500,
  '03': 5000,
  '03 MASTER': 5000,
}

/** true quando a linha usa misturador HORIZONTAL. É isso que "MASTER" quer dizer. */
export function ehMaster(linha: string): boolean {
  return linha.endsWith('MASTER')
}

/** true quando a linha traz caçamba de pesagem de fábrica (02 em diante). */
export function temCacamba(linha: string): boolean {
  return linha.startsWith('02') || linha.startsWith('03')
}

/** true quando a linha é industrial e já vem com ensacadeira (só a 03). */
export function temEnsacadeira(linha: string): boolean {
  return linha.startsWith('03')
}

function c(
  linha: CompactaSku['linha'], codigo: string, producaoKgH: number,
  misturadorKg: number, caixas: number[] = [],
): CompactaSku {
  return { linha, codigo, producaoKgH, misturadorKg, caixas }
}

export const COMPACTAS: CompactaSku[] = [
  // ---- MINI FÁBRICA — a entrada da linha, até 600 kg/h pela regra do dono
  //
  // ⚠️ As máquinas da Mini NÃO estão em `precos_branorte` — só os PAINÉIS dela:
  // "Painel Elétrico Mini Fábrica Compacta JR (30150)" e "... Compacta 01
  // (75300)". Ninguém cadastra painel de produto que não vende, então a Mini
  // existe e o que falta é cadastro de máquina — a mesma situação em que a
  // Compacta 03 esteve até agosto/2026. Os dois códigos abaixo saem desses
  // painéis, lidos pela regra [CV×10][kg do misturador].
  c('MINI', 'MINI FÁBRICA COMPACTA JR - 30150', 300, 150),
  c('MINI', 'MINI FÁBRICA COMPACTA 01 - 75300', 750, 300),

  // ---- 01 — vertical, sem caçamba, sem ensacadeira
  c('01', 'COMPACTA 01 - 30150',    300,  150),
  c('01', 'COMPACTA 01 - 75300',    750,  300),
  c('01', 'COMPACTA 01 - 75500',    750,  500),
  c('01', 'COMPACTA 01 - 100500',   1000, 500),
  c('01', 'COMPACTA 01 - 1001000',  1000, 1000),
  c('01', 'COMPACTA 01 - 150500',   1500, 500),
  c('01', 'COMPACTA 01 - 1501000',  1500, 1000),
  c('01', 'COMPACTA 01 - 2001000',  2000, 1000),

  // ---- 01 MASTER — misturador horizontal
  c('01 MASTER', 'COMPACTA 01 MASTER - 75150',  750,  150),
  c('01 MASTER', 'COMPACTA 01 MASTER - 75300',  750,  300),
  c('01 MASTER', 'COMPACTA 01 MASTER - 100300', 1000, 300),
  c('01 MASTER', 'COMPACTA 01 MASTER - 100500', 1000, 500),
  c('01 MASTER', 'COMPACTA 01 MASTER - 200500', 2000, 500),
  c('01 MASTER', 'COMPACTA 01 MASTER - 300500', 3000, 500),

  // ---- 02 — vertical + caçamba de pesagem
  c('02', 'COMPACTA 02 - 75300',    750,  300),
  c('02', 'COMPACTA 02 - 75500',    750,  500),
  c('02', 'COMPACTA 02 - 100500',   1000, 500),
  c('02', 'COMPACTA 02 - 1001000',  1000, 1000),
  c('02', 'COMPACTA 02 - 150500',   1500, 500),
  c('02', 'COMPACTA 02 - 1501000',  1500, 1000),
  c('02', 'COMPACTA 02 - 200500',   2000, 500),
  c('02', 'COMPACTA 02 - 2001000',  2000, 1000),
  c('02', 'COMPACTA 02 - 3001000',  3000, 1000),

  // ---- 02 MASTER — horizontal + caçamba
  c('02 MASTER', 'COMPACTA 02 MASTER - 100300',  1000, 300),
  c('02 MASTER', 'COMPACTA 02 MASTER - 100500',  1000, 500),
  c('02 MASTER', 'COMPACTA 02 MASTER - 150500',  1500, 500),
  c('02 MASTER', 'COMPACTA 02 MASTER - 200500',  2000, 500),
  c('02 MASTER', 'COMPACTA 02 MASTER - 2001000', 2000, 1000),
  // ⚠️ Estas duas de 2.500 kg/h NÃO estão em `precos_branorte` — vêm das fichas
  // oficiais do marketing (`Compacta 02 Master - 250500` e `- 2501000`, na pasta
  // "Sem preço"). É a mesma lacuna que a Compacta 03 teve até agosto/2026:
  // o produto é vendido e o cadastro de máquina não existe.
  //
  // Sem elas o teto de 2.200 da banda 02 seria letra morta: o maior degrau da
  // família na tabela de preços é 2.000, então quem precisasse de 2.100 caía
  // direto na 03 de 3.000 — uma fábrica inteira acima do que precisa.
  c('02 MASTER', 'COMPACTA 02 MASTER - 250500',  2500, 500),
  c('02 MASTER', 'COMPACTA 02 MASTER - 2501000', 2500, 1000),
  c('02 MASTER', 'COMPACTA 02 MASTER - 300500',  3000, 500),
  c('02 MASTER', 'COMPACTA 02 MASTER - 3001000', 3000, 1000),
  c('02 MASTER', 'COMPACTA 02 MASTER - 400500',  4000, 500),
  c('02 MASTER', 'COMPACTA 02 MASTER - 4001000', 4000, 1000),
  c('02 MASTER', 'COMPACTA 02 MASTER - 500500',  5000, 500),
  c('02 MASTER', 'COMPACTA 02 MASTER - 5001000', 5000, 1000),

  // ---- 03 — industrial: vertical + caçamba + caixas + ENSACADEIRA
  c('03', 'COMPACTA 03 - 100500 - 4000/4000',   1000, 500,  [4000, 4000]),
  c('03', 'COMPACTA 03 - 1001000 - 4000/4000',  1000, 1000, [4000, 4000]),
  c('03', 'COMPACTA 03 - 1001000 - 6000/6000',  1000, 1000, [6000, 6000]),
  c('03', 'COMPACTA 03 - 150500 - 4000/4000',   1500, 500,  [4000, 4000]),
  c('03', 'COMPACTA 03 - 1501000 - 4000/4000',  1500, 1000, [4000, 4000]),
  c('03', 'COMPACTA 03 - 200500 - 4000/4000',   2000, 500,  [4000, 4000]),
  c('03', 'COMPACTA 03 - 2001000 - 4000/4000',  2000, 1000, [4000, 4000]),
  c('03', 'COMPACTA 03 - 2001000 - 6000/6000',  2000, 1000, [6000, 6000]),
  c('03', 'COMPACTA 03 - 3001000 - 4000/4000',  3000, 1000, [4000, 4000]),
  c('03', 'COMPACTA 03 - 3001000 - 6000/6000',  3000, 1000, [6000, 6000]),
  c('03', 'COMPACTA 03 - 4001000 - 6000/6000',  4000, 1000, [6000, 6000]),
  c('03', 'COMPACTA 03 - 5001000 - 6000/6000',  5000, 1000, [6000, 6000]),

  // ---- 03 MASTER — industrial com misturador horizontal
  c('03 MASTER', 'COMPACTA 03 MASTER - 100500 - 4000/4000',  1000, 500,  [4000, 4000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 1001000 - 4000/4000', 1000, 1000, [4000, 4000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 1001000 - 6000/6000', 1000, 1000, [6000, 6000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 150500 - 4000/4000',  1500, 500,  [4000, 4000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 1501000 - 4000/4000', 1500, 1000, [4000, 4000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 200500 - 4000/4000',  2000, 500,  [4000, 4000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 2001000 - 4000/4000', 2000, 1000, [4000, 4000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 2001000 - 6000/6000', 2000, 1000, [6000, 6000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 3001000 - 6000/6000', 3000, 1000, [6000, 6000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 4001000 - 6000/6000', 4000, 1000, [6000, 6000]),
  c('03 MASTER', 'COMPACTA 03 MASTER - 5001000 - 6000/6000', 5000, 1000, [6000, 6000]),
]

// ---------------------------------------------------------------------------
// Foto do modelo
// ---------------------------------------------------------------------------

const STORAGE = 'https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1'

/**
 * Modelos que têm foto PRÓPRIA no bucket, por `{linha}-{produção}-{misturador}`.
 *
 * As imagens saem de `Z:\4 - Marketing\Lista de Preço\Sem preço\Fábricas sem
 * preço` — a pasta que o marketing mantém SEM PREÇO. Isso não é detalhe: a
 * pasta de cima tem as mesmas fábricas com o preço estampado, e esta página é
 * pública. Subir a errada publicaria a tabela de preços da empresa.
 *
 * ⚠️ Os nomes de arquivo do marketing usam DUAS convenções para o mesmo número:
 * `Compacta 01 - 100500` é [CV×10][misturador] (10 CV → 1.000 kg/h), e
 * `Compacta 01 - 750300` é [produção][misturador] (750 kg/h). Convivem na mesma
 * pasta. O que separa as duas leituras é a razão produção/misturador: a certa
 * cai entre 1 e 10, a errada dá 20 ou 0,1. Aqui já está tudo normalizado para
 * produção em kg/h — se subir imagem nova, normalizar antes.
 *
 * A cobertura é PARCIAL (37 de ~60 configurações). Quem não tem foto própria
 * cai na foto da família, que é sempre melhor que caixa vazia.
 */
const FOTOS_POR_MODELO = new Set([
  '01-300-150', '01-750-300', '01-1000-500', '01-1000-1000', '01-1500-500',
  '01-1500-1000', '01-2000-1000',
  '01-master-750-150', '01-master-750-300', '01-master-1000-300',
  '01-master-1000-500', '01-master-1500-500', '01-master-2000-500',
  '02-1000-500', '02-1000-1000', '02-1500-500', '02-1500-1000', '02-2000-1000',
  '02-master-1000-500', '02-master-1500-500', '02-master-1500-1000',
  '02-master-2000-500', '02-master-2000-1000', '02-master-2500-500',
  '02-master-2500-1000',
  '03-1000-500', '03-1000-1000', '03-1500-500', '03-1500-1000', '03-2000-1000',
  '03-3000-1000', '03-5000-1000',
  '03-master-1500-500', '03-master-2000-500', '03-master-3000-500',
  '03-master-3000-1000', '03-master-5000-1000',
])

/** Foto da FAMÍLIA — o fallback de quem não tem imagem própria. */
const FOTO_DA_FAMILIA: Record<string, string> = {
  MINI: 'mini-fabrica/foto.jpeg',
  '01': 'compacta-01/foto.jpg',
  '01 MASTER': 'compacta-01/foto-master.jpg',
  '02': 'compacta-02/foto.jpg',
  '02 MASTER': 'compacta-02/foto-master.jpg',
  '03': 'compacta-03/foto.jpg',
  '03 MASTER': 'compacta-03/foto-master.jpg',
}

/**
 * URL da foto do modelo, já redimensionada pelo Supabase.
 *
 * ⚠️ `resize=contain` NÃO é opcional. O padrão do endpoint é `cover`, que
 * RECORTA — e como estas imagens são fichas em pé, o corte come o nome do
 * modelo e metade dos equipamentos. Com `contain` a ficha inteira cabe, e de
 * quebra o arquivo cai de 872 kB para 118 kB, que é o que faz a página abrir
 * no 3G do interior.
 *
 * ⚠️ O caminho é montado AQUI e não lido de `fabrica_midia`. Aquela tabela
 * existe e é pública, mas as colunas de URL dela são o liga/desliga da IA
 * atendente: zerar `foto_url` é como o time desliga o envio no WhatsApp. Se o
 * quiz lesse de lá, um ajuste na IA apagaria a foto desta página sem ninguém
 * perceber.
 */
export function fotoDoModelo(linha: string, producaoKgH: number, misturadorKg: number): string {
  const familia = linha === 'MINI' ? '01' : linha.toLowerCase().replace(' ', '-')
  const proprio = `${familia}-${producaoKgH}-${misturadorKg}`
  const caminho = FOTOS_POR_MODELO.has(proprio)
    ? `modelos/${proprio}.png`
    : FOTO_DA_FAMILIA[linha] ?? FOTO_DA_FAMILIA['01']
  return `${STORAGE}/render/image/public/fabricas-midia/${caminho}?width=900&quality=72&resize=contain`
}

// ---------------------------------------------------------------------------
// Escolha na escada
// ---------------------------------------------------------------------------

/**
 * Primeiro degrau que atende. SEMPRE arredonda pra CIMA — máquina apertada é
 * cliente insatisfeito, máquina folgada é cliente que cresce dentro dela.
 * Devolve o maior degrau quando nada atende (quem lê decide o que fazer com o
 * `acimaDaLinha`).
 */
export function degrau(escada: number[], alvo: number): number {
  for (const v of escada) if (v >= alvo) return v
  return escada[escada.length - 1]
}
