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

/** Recorta os pedidos pela origem escolhida. ORIGEM_TODAS devolve a lista inteira. */
export function filtrarPorOrigem<T extends { fonte_origem?: string | null }>(pedidos: T[], origem: string): T[] {
  if (origem === ORIGEM_TODAS) return pedidos
  return pedidos.filter(p => chaveOrigemVenda(p.fonte_origem) === origem)
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
}

/**
 * Soma vendas/valor por origem numa janela que quem chama define (`medir`).
 * Ordem: maior valor, depois mais vendas, depois nome; "Origem não informada"
 * sempre por último (é o resto, não um canal).
 */
export function resumirOrigens<T extends { fonte_origem?: string | null }>(
  pedidos: T[],
  medir: (p: T) => { vendas: number; valor: number },
): ResumoOrigens {
  const mapa = new Map<string, OrigemResumo>()
  const total = { vendas: 0, valor: 0 }
  const informada = { vendas: 0, valor: 0 }
  for (const p of pedidos) {
    const chave = chaveOrigemVenda(p.fonte_origem)
    const m = medir(p)
    let r = mapa.get(chave)
    if (!r) { r = { chave, rotulo: rotuloOrigemVenda(chave), vendas: 0, valor: 0 }; mapa.set(chave, r) }
    r.vendas += m.vendas
    r.valor += m.valor
    total.vendas += m.vendas
    total.valor += m.valor
    if (chave !== ORIGEM_NAO_INFORMADA) { informada.vendas += m.vendas; informada.valor += m.valor }
  }
  const origens = Array.from(mapa.values()).sort((a, b) => {
    const aSem = a.chave === ORIGEM_NAO_INFORMADA, bSem = b.chave === ORIGEM_NAO_INFORMADA
    if (aSem !== bSem) return aSem ? 1 : -1
    return b.valor - a.valor || b.vendas - a.vendas || a.rotulo.localeCompare(b.rotulo, 'pt-BR')
  })
  return { origens, total, informada }
}
