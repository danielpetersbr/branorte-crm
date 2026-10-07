// ───────────────────────────────────────────────────────────────────────────
// ORIGEM DA VENDA no Painel de Vendas (/controle) — roadmap #80 (29/09/2026).
//
// De onde vem: o campo `fonte_origem` do PRÓPRIO pedido — "Como o cliente
// encontrou a empresa?", obrigatório no PedidoForm pra pedido novo. É o mesmo
// campo que o controle.branorte.com usa no gráfico "Origem dos clientes"; não é
// regra nova. No espelho ele não virou coluna: mora em
// mirror_pedidos_venda.raw->>'fonte_origem'.
//
// ⚠️ É origem DECLARADA pelo vendedor, não rastreada. A comprovada (pedido →
// orçamento montado no CRM → telefone → lead com origem/criativo, a da RPC
// dashboard_vendas_periodo_detalhe) casava só 21 das 66 vendas de set/2026 com
// um lead, e só 12 com origem preenchida — ela só enxerga orçamento feito no CRM.
// A declarada tinha origem em 52 das 63 vendas do mesmo mês (fora garantia).
// Por isso o painel diz quanto tem origem informada e o balde "Origem não
// informada" nunca some — sem isso a soma das origens parece o total e não é.
//
// Diferenças DELIBERADAS em relação ao controle:
//  - lá facebook + instagram + nao_informado viram "Meta ADS". Aqui não: somar
//    "não informado" ao pago dava ao anúncio venda de origem desconhecida (23
//    pedidos até 29/09/2026). E Instagram fica separado do Facebook como o
//    vendedor marcou — pode ser perfil/bio orgânico, não anúncio.
//  - GARANTIA não é venda (valor 0, gerado pelo PedidoGarantia). O controle tira
//    esses pedidos de todas as somas; o painel também (ver ehPedidoGarantia).
// ───────────────────────────────────────────────────────────────────────────

//
// ── 07/10/2026: ORIGEM RASTREADA PELO TELEFONE (pedido do Daniel) ──────────
// A declarada deixou de ser a única. A RPC controle_vendas_rastreio casa o
// telefone do pedido E o do orçamento ligado a ele com os registros de chegada
// (lead, repasse a vendedor, clique em anúncio) e devolve os FATOS. A regra de
// qual origem vale é origemFinalVenda(), aqui embaixo:
//   1. chegada rastreada com origem identificada → vale o rastreio;
//   2. senão, o que o vendedor marcou;
//   3. senão, pedido anterior do mesmo cliente → "Já era cliente";
//   4. senão, a porta por onde ele entrou (WhatsApp da empresa), se houver;
//   5. senão, "Origem não informada".
// "WhatsApp 1144/4502/ANA" e "Link" dizem a PORTA, não como ele achou a
// empresa: por isso não passam por cima do vendedor (ficam no passo 4).
// Com isso "Meta ADS" voltou a existir como origem — mas só quando é rastreio
// de verdade, nunca somando o "não informado" como o controle fazia.
// ───────────────────────────────────────────────────────────────────────────

/** Filtro "sem recorte". Chave que nenhum `fonte_origem` real consegue ter. */
export const ORIGEM_TODAS = '__todas__'
/** Balde de quem não tem origem: vazio, "Não informado" ou "Não lembra". */
export const ORIGEM_NAO_INFORMADA = '__nao_informada__'

// Rótulos = as opções do select do PedidoForm (mesma ordem de ideia, texto curto).
const ROTULOS: Record<string, string> = {
  facebook: 'Facebook',
  instagram: 'Instagram',
  google: 'Google',
  youtube: 'YouTube',
  site: 'Site',
  indicacao: 'Indicação',
  ja_era_cliente: 'Já era cliente',
  representante: 'Representante',
  feira: 'Feira',
  lp_mini_fabrica: 'LP Mini Fábrica',
  lp_compacta_01: 'LP Compacta 01',
  lp_compacta_01_master: 'LP Compacta 01 Master',
  lp_compacta_02: 'LP Compacta 02',
  lp_compacta_03: 'LP Compacta 03',
  // Só existem como origem RASTREADA (o form do pedido não oferece):
  meta_ads: 'Meta ADS (anúncio)',
  bio_instagram: 'Bio do Instagram',
  instagram_formulario: 'Formulário do Instagram',
  facebook_formulario: 'Formulário do Facebook',
  lp_plastico: 'LP Plástico',
  whatsapp_empresa: 'WhatsApp da empresa',
  link_rota: 'Link de atendimento',
}

// "Não lembra" e "Não informado" são respostas do form, mas dizem a mesma coisa
// pro marketing: não se sabe de onde veio. Ficam no mesmo balde que o vazio.
const SEM_ORIGEM = new Set(['', '-', 'n/d', 'nao_informado', 'não informado', 'nao informado', 'nao_lembra', 'não lembra', 'nao lembra'])

function limpa(fonte: string | null | undefined): string {
  return (fonte ?? '').trim().toLowerCase()
}

/** Pedido de garantia (PedidoGarantia grava fonte_origem = 'GARANTIA'). Não é venda. */
export function ehPedidoGarantia(fonte: string | null | undefined): boolean {
  return limpa(fonte) === 'garantia'
}

/** fonte_origem crua → chave do filtro. Sem origem cai em ORIGEM_NAO_INFORMADA. */
export function chaveOrigemVenda(fonte: string | null | undefined): string {
  const k = limpa(fonte)
  return SEM_ORIGEM.has(k) ? ORIGEM_NAO_INFORMADA : k
}

export function rotuloOrigemVenda(chave: string): string {
  if (chave === ORIGEM_TODAS) return 'Todas'
  if (chave === ORIGEM_NAO_INFORMADA) return 'Origem não informada'
  const conhecido = ROTULOS[chave]
  if (conhecido) return conhecido
  // Valor que o form não oferece (digitado em outra época/app): mostra como veio,
  // só trocando "_" por espaço — igual o controle faz. Não some da lista.
  const t = chave.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ── Origem rastreada ───────────────────────────────────────────────────────

function semAcento(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')
}

// Texto que os registros de chegada gravam (auditoria.origem, origem do repasse) → chave do painel.
// Onde o form do pedido já tem a opção, usa a MESMA chave: rastreio e vendedor caem no mesmo chip.
const RASTREADA_PARA_CHAVE: Record<string, string> = {
  'meta ads': 'meta_ads',
  'meta teste 1': 'meta_ads',
  facebook: 'facebook',
  'facebook formulario': 'facebook_formulario',
  instagram: 'instagram',
  'instagram formulario': 'instagram_formulario',
  'bio instagram': 'bio_instagram',
  google: 'google',
  'google ads': 'google',
  youtube: 'youtube',
  site: 'site',
  quiz_site: 'site',
  'lp mini fabrica': 'lp_mini_fabrica',
  'lp compacta 01': 'lp_compacta_01',
  'lp compacta 1': 'lp_compacta_01',
  'lp compacta 02': 'lp_compacta_02',
  'lp compacta 2': 'lp_compacta_02',
  'lp compacta 03': 'lp_compacta_03',
  'lp compacta 3': 'lp_compacta_03',
  'lp plastico': 'lp_plastico',
  'whatsapp 1144': 'whatsapp_empresa',
  'whatsapp 4502': 'whatsapp_empresa',
  'whatsapp ana': 'whatsapp_empresa',
  link: 'link_rota',
  indicacao: 'indicacao',
  'ja era cliente': 'ja_era_cliente',
}

const RASTREIO_SEM_ORIGEM = new Set(['', 'nao identificou', 'nao identificado', 'nao informado', '-'])

/** A porta por onde o cliente entrou, não como ele achou a empresa. Não passa por cima do vendedor. */
const PORTAS_DE_ENTRADA = new Set(['whatsapp_empresa', 'link_rota'])

/**
 * Origem gravada no registro de chegada → chave do painel. `null` quando o registro existe mas
 * não diz de onde veio ("Não identificou", vazio): isso é contato, não origem.
 * Texto que o mapa não conhece vira chave própria e aparece como veio — nunca some.
 */
export function chaveOrigemRastreada(origem: string | null | undefined): string | null {
  const k = semAcento(limpa(origem)).replace(/\s+/g, ' ')
  if (RASTREIO_SEM_ORIGEM.has(k)) return null
  if (RASTREADA_PARA_CHAVE[k]) return RASTREADA_PARA_CHAVE[k]
  if (k.startsWith('whatsapp')) return 'whatsapp_empresa'
  return k.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || null
}

// Rastreio e vendedor "conferem" quando falam do mesmo canal, mesmo com nomes diferentes:
// o vendedor só tem "Facebook"/"Instagram" pra marcar um anúncio da Meta, e "Site" pra uma LP.
const FAMILIA: Record<string, string> = {
  facebook: 'meta', instagram: 'meta', meta_ads: 'meta', bio_instagram: 'meta',
  instagram_formulario: 'meta', facebook_formulario: 'meta',
  site: 'site', lp_mini_fabrica: 'site', lp_compacta_01: 'site', lp_compacta_01_master: 'site',
  lp_compacta_02: 'site', lp_compacta_03: 'site', lp_plastico: 'site',
}
function mesmoCanal(a: string, b: string): boolean {
  return a === b || (FAMILIA[a] !== undefined && FAMILIA[a] === FAMILIA[b])
}

/** O que a RPC controle_vendas_rastreio devolve e que decide a origem (o resto é só pra tela). */
export interface EvidenciaOrigem {
  fonte_declarada?: string | null
  /** Origem do registro de chegada que vale (a 1ª com origem forte do ciclo; sem ela, a 1ª que houver). */
  chegada_origem?: string | null
  /** Data do pedido anterior do mesmo cliente (telefone ou CPF/CNPJ). */
  pedido_anterior_data?: string | null
}

/** De onde saiu a origem que o painel mostra. */
export type BaseOrigem = 'rastreio' | 'vendedor' | 'historico' | 'porta' | 'nenhuma'
/** Como o rastreio e o vendedor se comparam nesta venda. */
export type ConferenciaOrigem = 'confere' | 'diverge' | 'so_rastreio' | 'so_vendedor' | 'nenhum'

export interface OrigemFinal {
  chave: string
  rotulo: string
  base: BaseOrigem
  conferencia: ConferenciaOrigem
  /** Chave do rastreio quando ele identificou origem (inclui porta de entrada); senão null. */
  rastreada: string | null
  /** Chave do que o vendedor marcou (ORIGEM_NAO_INFORMADA quando não marcou). */
  declarada: string
}

/**
 * A regra da origem da venda. Rastreio com origem identificada vale; sem ele, o que o vendedor
 * marcou; sem os dois, o que os dados ainda conseguem dizer (recompra, porta de entrada).
 */
export function origemFinalVenda(e: EvidenciaOrigem): OrigemFinal {
  const declarada = chaveOrigemVenda(e.fonte_declarada)
  const temDeclarada = declarada !== ORIGEM_NAO_INFORMADA
  const rastreada = chaveOrigemRastreada(e.chegada_origem)
  const rastreioForte = rastreada !== null && !PORTAS_DE_ENTRADA.has(rastreada)

  let chave: string, base: BaseOrigem
  if (rastreioForte) { chave = rastreada as string; base = 'rastreio' }
  else if (temDeclarada) { chave = declarada; base = 'vendedor' }
  else if (e.pedido_anterior_data) { chave = 'ja_era_cliente'; base = 'historico' }
  else if (rastreada !== null) { chave = rastreada; base = 'porta' }
  else { chave = ORIGEM_NAO_INFORMADA; base = 'nenhuma' }

  let conferencia: ConferenciaOrigem
  if (rastreioForte && temDeclarada) conferencia = mesmoCanal(rastreada as string, declarada) ? 'confere' : 'diverge'
  else if (rastreioForte) conferencia = 'so_rastreio'
  else if (temDeclarada) conferencia = 'so_vendedor'
  else conferencia = 'nenhum'

  return { chave, rotulo: rotuloOrigemVenda(chave), base, conferencia, rastreada, declarada }
}

/**
 * Chave de origem de um pedido já no painel: a FINAL quando o rastreio foi aplicado
 * (`origem_chave`), senão a declarada. É por ela que os chips filtram e somam.
 */
export function chaveDoPedido(p: { fonte_origem?: string | null; origem_chave?: string | null }): string {
  return p.origem_chave ?? chaveOrigemVenda(p.fonte_origem)
}

/** Recorta os pedidos pela origem escolhida. ORIGEM_TODAS devolve a lista inteira. */
export function filtrarPorOrigem<T extends { fonte_origem?: string | null; origem_chave?: string | null }>(pedidos: T[], origem: string): T[] {
  if (origem === ORIGEM_TODAS) return pedidos
  return pedidos.filter(p => chaveDoPedido(p) === origem)
}

export interface OrigemResumo {
  chave: string
  rotulo: string
  vendas: number
  valor: number
}

export interface ResumoOrigens {
  /** Toda origem que aparece nos pedidos (mesmo com 0 na janela: a lista de chips não pula). */
  origens: OrigemResumo[]
  total: { vendas: number; valor: number }
  /** Só o que tem origem informada — o "quanto dá pra atribuir". */
  informada: { vendas: number; valor: number }
  /** Das vendas com origem, quantas saíram do rastreio pelo telefone (base 'rastreio'). */
  rastreada: { vendas: number; valor: number }
}

/**
 * Soma vendas/valor por origem numa janela que quem chama define (`medir`).
 * Ordem: maior valor, depois mais vendas, depois nome; "Origem não informada"
 * sempre por último (é o resto, não um canal).
 */
export function resumirOrigens<T extends { fonte_origem?: string | null; origem_chave?: string | null; origem_base?: BaseOrigem | null }>(
  pedidos: T[],
  medir: (p: T) => { vendas: number; valor: number },
): ResumoOrigens {
  const mapa = new Map<string, OrigemResumo>()
  const total = { vendas: 0, valor: 0 }
  const informada = { vendas: 0, valor: 0 }
  const rastreada = { vendas: 0, valor: 0 }
  for (const p of pedidos) {
    const chave = chaveDoPedido(p)
    const m = medir(p)
    let r = mapa.get(chave)
    if (!r) { r = { chave, rotulo: rotuloOrigemVenda(chave), vendas: 0, valor: 0 }; mapa.set(chave, r) }
    r.vendas += m.vendas
    r.valor += m.valor
    total.vendas += m.vendas
    total.valor += m.valor
    if (chave !== ORIGEM_NAO_INFORMADA) { informada.vendas += m.vendas; informada.valor += m.valor }
    if (p.origem_base === 'rastreio') { rastreada.vendas += m.vendas; rastreada.valor += m.valor }
  }
  const origens = Array.from(mapa.values()).sort((a, b) => {
    const aSem = a.chave === ORIGEM_NAO_INFORMADA, bSem = b.chave === ORIGEM_NAO_INFORMADA
    if (aSem !== bSem) return aSem ? 1 : -1
    return b.valor - a.valor || b.vendas - a.vendas || a.rotulo.localeCompare(b.rotulo, 'pt-BR')
  })
  return { origens, total, informada, rastreada }
}
