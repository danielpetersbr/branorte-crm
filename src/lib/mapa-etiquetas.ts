/**
 * Etiquetas do WhatsApp no /mapa-visitas — filtro e modo "por etiqueta".
 *
 * A camada de orçamentos do mapa não sabia a etiqueta do cliente: o pino vinha
 * de `mapa_orcamentos_v2` (cliente, telefone, valor) e a etiqueta mora na
 * matview do WhatsApp, por telefone canônico. A RPC `mapa_etiquetas_wa` devolve
 * (fc, principal, todas[]) de cada conversa e aqui a gente casa com o cliente
 * pelo MESMO canônico (`foneCanon` espelha `fone_canon` do banco).
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
  /** Todas as etiquetas da conversa, canônicas, sem repetição. */
  todas: string[]
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

// ── cores do modo "por etiqueta" ─────────────────────────────────────────────
// ETIQUETA_COR foi calibrada como TEXTO sobre branco (escura). Sobre o mapa claro
// serve como está; no tema escuro clareia um passo, senão o pino some no fundo.
const SEM_WA_CLARO = '#cbd5e1', SEM_WA_ESCURO = '#4b5563'
const SEM_ETQ_CLARO = '#6b7280', SEM_ETQ_ESCURO = '#a1a1aa'

function clarear(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16)
  if (Number.isNaN(n) || hex.length !== 7) return hex
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map(c => Math.round(c + (255 - c) * k).toString(16).padStart(2, '0'))
    .join('')
}

export function corPorEtiqueta(e: EtiquetasDoFone | null, escuro: boolean): string {
  if (!e) return escuro ? SEM_WA_ESCURO : SEM_WA_CLARO
  if (!e.principal) return escuro ? SEM_ETQ_ESCURO : SEM_ETQ_CLARO
  const hex = corDaEtiqueta(e.principal)
  return escuro ? clarear(hex, 0.35) : hex
}

/** Cor do swatch de uma OPÇÃO do filtro/legenda (inclui os dois "sem"). */
export function corDaOpcaoEtiqueta(valor: string, escuro: boolean): string {
  if (valor === SEM_WHATSAPP) return corPorEtiqueta(null, escuro)
  if (valor === SEM_ETIQUETA) return corPorEtiqueta({ principal: null, todas: [] }, escuro)
  return corPorEtiqueta({ principal: valor, todas: [valor] }, escuro)
}
