/**
 * Etiquetas do WhatsApp no /mapa-visitas — filtro e modo "por etiqueta".
 *
 * A camada de orçamentos do mapa não sabia a etiqueta do cliente: o pino vinha
 * de `mapa_orcamentos_v2` (cliente, telefone, valor) e a etiqueta mora na
 * matview do WhatsApp, por telefone canônico. A RPC `mapa_etiquetas_wa_v2`
 * devolve TUDO numa linha JSON — `com` (conversas com etiqueta: fc, principal,
 * vendedor da principal, pares [etiqueta, VENDEDOR]) e `sem` (fcs com conversa e
 * sem etiqueta) — e aqui a gente casa com o cliente pelo MESMO canônico
 * (`foneCanon` espelha `fone_canon` do banco).
 *
 * ⚠️ Por que UMA linha e não uma tabela: o PostgREST corta qualquer resposta em
 * 10.000 linhas (db-max-rows) e a matview tem 17 mil conversas. A v1 devolvia
 * tabela — 7.236 conversas nunca chegavam e cliente etiquetado aparecia como
 * "Sem WhatsApp". Medido em produção em 02/09/2026.
 *
 * Medido em 01/09/2026: 5.354 clientes no mapa, 1.059 com conversa, 724 com
 * etiqueta. Então o filtro precisa de dois "sem": SEM_ETIQUETA (tem conversa,
 * ninguém classificou) e SEM_WHATSAPP (nem conversa tem) — juntar os dois num
 * cinza só esconderia a diferença entre "não trabalhado" e "desconhecido".
 *
 * Puro (sem React, sem Supabase) pra ser testável — mesma razão de fone-canon.
 */
import { foneCanon } from './fone-canon'
import { canonico, corDaEtiqueta, ETIQUETAS_OCULTAS, ordemDe } from './wa-funil'

/** Tem conversa sincronizada, mas nenhuma etiqueta. */
export const SEM_ETIQUETA = '(sem etiqueta)'
/** Não tem conversa sincronizada no WhatsApp de ninguém. */
export const SEM_WHATSAPP = '(sem whatsapp)'

export interface EtiquetasDoFone {
  /** A que a matview elegeu principal (canônica). null = conversa sem etiqueta. */
  principal: string | null
  /** Vendedor (CAIXA ALTA) que pôs a principal. */
  principalVendedor: string | null
  /** Todas as etiquetas da conversa, canônicas, sem repetição. */
  todas: string[]
  /** [etiqueta, VENDEDOR] — o mesmo número costuma estar etiquetado em vários WhatsApps. */
  porVendedor: [string, string][]
}
export type MapaEtiquetas = Map<string, EtiquetasDoFone>

/** Nome como o funil enxerga: caixa alta, sem espaço nas pontas, aliases. */
export function nomeCanonicoEtiqueta(nome: string): string {
  return canonico((nome ?? '').trim().toUpperCase())
}

/**
 * Etiquetas de um cliente do mapa. Tenta cada telefone na ordem (o ponto tem
 * `telefone` e `fone`, nem sempre iguais). null = sem conversa no WhatsApp.
 */
export function etiquetasDoCliente(
  mapa: MapaEtiquetas,
  fones: (string | null | undefined)[],
): EtiquetasDoFone | null {
  for (const f of fones) {
    const c = foneCanon(f)
    if (!c) continue
    const e = mapa.get(c)
    if (e) return e
  }
  return null
}

/**
 * Passa no filtro? Seleção vazia = passa tudo (o filtro está desligado).
 * Cliente com várias etiquetas passa se QUALQUER uma foi marcada — marcar várias
 * SOMA, não intersecta (é o que "ORCAMENTO ENVIADO + INTERESSE FUTURO" quer dizer
 * pra quem vai montar uma viagem).
 */
export function passaEtiqueta(sel: ReadonlySet<string>, e: EtiquetasDoFone | null): boolean {
  if (sel.size === 0) return true
  if (!e) return sel.has(SEM_WHATSAPP)
  if (e.todas.length === 0) return sel.has(SEM_ETIQUETA)
  return e.todas.some(t => sel.has(t))
}

// Estágio "mais adiantado" do funil vence: numa conversa com ORCAMENTO ENVIADO +
// NAO RESPONDEU MAIS, o desfecho diz mais que a etapa. Etiqueta fora do funil
// (ordem 900) só vale se não houver nenhuma do funil.
function maisAdiantada(nomes: string[]): string {
  const peso = (n: string) => { const o = ordemDe(n); return o === 900 ? -1 : o }
  return nomes.slice().sort((a, b) => peso(b) - peso(a) || a.localeCompare(b))[0]
}

/**
 * QUAL etiqueta pinta o pino (e entra na legenda do modo "por etiqueta").
 * Devolve o nome, ou os sentinelas SEM_ETIQUETA / SEM_WHATSAPP.
 *
 * Ordem de preferência, medida em 02/09/2026 sobre 708 clientes com etiqueta:
 *  1. Com filtro ligado, a etiqueta PEDIDA — quem filtrou VENDIDO quer ver
 *     verde, não a cor de outra etiqueta que o cliente também tem.
 *  2. A do VENDEDOR DO PINO, se ele etiquetou. 159 clientes estão etiquetados
 *     por 2+ vendedores e em 41 a principal da conversa era de OUTRO vendedor
 *     apesar do dono do orçamento ter etiquetado — mesma regra da /contatos: o
 *     dono manda.
 *  3. A principal da conversa (o que a matview elegeu).
 */
export function etiquetaQuePinta(
  e: EtiquetasDoFone | null,
  vendedorPino: string | null | undefined,
  sel: ReadonlySet<string>,
): string {
  if (!e) return SEM_WHATSAPP
  if (e.todas.length === 0) return SEM_ETIQUETA
  if (sel.size > 0) {
    const pedidas = e.todas.filter(t => sel.has(t))
    if (pedidas.length) return maisAdiantada(pedidas)
  }
  const v = (vendedorPino ?? '').trim().toUpperCase()
  if (v) {
    const dele = e.porVendedor.filter(([, vend]) => vend === v).map(([t]) => t)
    if (dele.length) return e.principal && dele.includes(e.principal) && e.principalVendedor === v ? e.principal : maisAdiantada(dele)
  }
  return e.principal ?? maisAdiantada(e.todas)
}

export interface OpcaoEtiqueta {
  valor: string
  rotulo: string
  n: number
  /** Etiqueta interna (BRANORTE, TRANSPORTADORAS...): fica no fim, mais apagada. */
  interna: boolean
}

export function rotuloEtiquetaOpcao(valor: string): string {
  if (valor === SEM_ETIQUETA) return 'Sem etiqueta (tem conversa)'
  if (valor === SEM_WHATSAPP) return 'Sem WhatsApp sincronizado'
  return valor
}

/**
 * Opções do filtro com contagem. Ordem: funil oficial primeiro (ORDEM_FUNIL),
 * depois as demais por volume, as internas no fim, e por último os dois "sem".
 * Cliente com 2 etiquetas conta nas 2 — a contagem é "quantos aparecem se eu
 * marcar só esta", não uma partição.
 */
export function opcoesEtiqueta(clientes: Iterable<EtiquetasDoFone | null>): OpcaoEtiqueta[] {
  const cont = new Map<string, number>()
  let semEtq = 0, semWa = 0
  for (const e of clientes) {
    if (!e) { semWa++; continue }
    if (e.todas.length === 0) { semEtq++; continue }
    for (const t of e.todas) cont.set(t, (cont.get(t) ?? 0) + 1)
  }
  const lista: OpcaoEtiqueta[] = [...cont.entries()]
    .map(([valor, n]) => ({ valor, rotulo: valor, n, interna: ETIQUETAS_OCULTAS.has(valor) }))
    .sort((a, b) =>
      Number(a.interna) - Number(b.interna)
      || ordemDe(a.valor) - ordemDe(b.valor)
      || b.n - a.n
      || a.valor.localeCompare(b.valor))
  if (semEtq > 0) lista.push({ valor: SEM_ETIQUETA, rotulo: rotuloEtiquetaOpcao(SEM_ETIQUETA), n: semEtq, interna: false })
  if (semWa > 0) lista.push({ valor: SEM_WHATSAPP, rotulo: rotuloEtiquetaOpcao(SEM_WHATSAPP), n: semWa, interna: false })
  return lista
}

// ── cores ────────────────────────────────────────────────────────────────────
// ETIQUETA_COR foi calibrada como TEXTO sobre branco (escura). Sobre o MAPA ela
// serve como está — e o mapa é claro nos DOIS temas (os tiles do Google não
// seguem o tema do app). Clarear só vale pro swatch da legenda/painel, que fica
// sobre a superfície escura do app. A v1 clareava o PINO no tema escuro e ele
// perdia contraste justamente sobre o tile claro.
const SEM_WA_CLARO = '#cbd5e1', SEM_WA_ESCURO = '#4b5563'
const SEM_ETQ_CLARO = '#6b7280', SEM_ETQ_ESCURO = '#a1a1aa'

function clarear(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  if (Number.isNaN(n) || hex.length !== 7) return hex
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(c => Math.round(c + (255 - c) * k).toString(16).padStart(2, '0'))
    .join('')
}

/** Cor de uma opção/valor (nome de etiqueta ou sentinela) — `escuro` = sobre superfície escura do app. */
export function corDaOpcaoEtiqueta(valor: string, escuro: boolean): string {
  if (valor === SEM_WHATSAPP) return escuro ? SEM_WA_ESCURO : SEM_WA_CLARO
  if (valor === SEM_ETIQUETA) return escuro ? SEM_ETQ_ESCURO : SEM_ETQ_CLARO
  const hex = corDaEtiqueta(valor)
  return escuro ? clarear(hex, 0.35) : hex
}

/** Cor do PINO: sempre a paleta clara, porque o mapa é claro em qualquer tema. */
export function corDoPinoEtiqueta(valor: string): string {
  return corDaOpcaoEtiqueta(valor, false)
}
