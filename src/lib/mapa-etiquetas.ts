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
 * etiqueta. Então o filtro precisa de TRÊS "sem", porque são ações diferentes:
 * SEM_ETIQUETA (tem conversa, ninguém classificou), SEM_WHATSAPP (tem telefone,
 * nenhuma conversa sincronizada) e SEM_TELEFONE (não há o que procurar).
 * Medido em 03/09/2026 sobre 5.359 pinos: 1.053 com conversa, 3.785 com telefone
 * e sem conversa, 521 sem telefone utilizável (427 sem nada no cadastro + 94 com
 * fixo de 8 dígitos sem DDD). Enquanto os dois últimos eram um balde só, quem
 * clicava no filtro pra achar gente a abordar levava 521 clientes sem número.
 *
 * Puro (sem React, sem Supabase) pra ser testável — mesma razão de fone-canon.
 */
import { foneCanon } from './fone-canon'
import { canonico, corDaEtiqueta, ETIQUETAS_OCULTAS, ordemDe } from './wa-funil'

/** Tem conversa sincronizada, mas nenhuma etiqueta. */
export const SEM_ETIQUETA = '(sem etiqueta)'
/** Tem telefone utilizável, mas nenhuma conversa sincronizada. */
export const SEM_WHATSAPP = '(sem whatsapp)'
/** Nenhum telefone que vire canônico — não há conversa pra procurar. */
export const SEM_TELEFONE = '(sem telefone)'

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

/**
 * O que sabemos de um cliente do mapa quanto à conversa de WhatsApp.
 * `etiquetas: null` = não achamos conversa; `semFone` diz se havia o que procurar.
 */
export interface ConversaDoCliente {
  etiquetas: EtiquetasDoFone | null
  /** true = nenhum dos telefones do cliente vira canônico (sem número, ou fixo sem DDD). */
  semFone: boolean
}

/** Cliente sem conversa e com telefone válido — usado como padrão seguro. */
export const SEM_CONVERSA: ConversaDoCliente = { etiquetas: null, semFone: false }

/**
 * Nome como o funil enxerga: SEM ACENTO, caixa alta, sem espaço nas pontas, aliases.
 *
 * ⚠️ O acento não é detalhe de exibição, é o que parte a opção em duas. As
 * etiquetas que chegam pela matview do WhatsApp já vêm sem acento (medido em
 * 03/09/2026: zero acentuadas em 17.295 conversas), mas as da VISITA são
 * resolvidas no catálogo `wascript_etiquetas`, onde o vendedor digitou como quis
 * — "ORÇAMENTO ENVIADO" (3 vendedores, 183 contatos), "PROSPECÇÃO" (5
 * vendedores), "SÓ BASE DE PREÇO", "NÃO TEM INTERESSE", "2º TENTATIVA". Sem tirar
 * o acento o painel listaria PROSPECCAO e PROSPECÇÃO como duas etiquetas
 * diferentes, cada uma com metade dos clientes, e a acentuada cairia fora do
 * funil (ordem 900, cor cinza de fallback).
 *
 * NFKD e não NFD porque é o que converte o ordinal "2º" em "2O" e deixa o alias
 * `'2O TENTATIVA' -> '2A TENTATIVA'` pegar.
 */
export function nomeCanonicoEtiqueta(nome: string): string {
  const semAcento = (nome ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
  return canonico(semAcento.trim().toUpperCase())
}

/**
 * Etiquetas de um cliente do mapa. Tenta cada telefone na ordem (o ponto tem
 * `telefone` e `fone`, nem sempre iguais). Devolve também `semFone`, que separa
 * "procurei e não achei" de "não havia telefone pra procurar".
 */
export function etiquetasDoCliente(
  mapa: MapaEtiquetas,
  fones: (string | null | undefined)[],
): ConversaDoCliente {
  let semFone = true
  for (const f of fones) {
    const c = foneCanon(f)
    if (!c) continue
    semFone = false
    const e = mapa.get(c)
    if (e) return { etiquetas: e, semFone: false }
  }
  return { etiquetas: null, semFone }
}

/**
 * Passa no filtro? Seleção vazia = passa tudo (o filtro está desligado).
 * Cliente com várias etiquetas passa se QUALQUER uma foi marcada — marcar várias
 * SOMA, não intersecta (é o que "ORCAMENTO ENVIADO + INTERESSE FUTURO" quer dizer
 * pra quem vai montar uma viagem).
 */
export function passaEtiqueta(sel: ReadonlySet<string>, c: ConversaDoCliente): boolean {
  if (sel.size === 0) return true
  const e = c.etiquetas
  if (!e) return sel.has(c.semFone ? SEM_TELEFONE : SEM_WHATSAPP)
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
  c: ConversaDoCliente,
  vendedorPino: string | null | undefined,
  sel: ReadonlySet<string>,
): string {
  const e = c.etiquetas
  if (!e) return c.semFone ? SEM_TELEFONE : SEM_WHATSAPP
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
  if (valor === SEM_WHATSAPP) return 'Tem telefone, sem conversa'
  if (valor === SEM_TELEFONE) return 'Sem telefone no cadastro'
  return valor
}

/**
 * Opções do filtro com contagem. Ordem: funil oficial primeiro (ORDEM_FUNIL),
 * depois as demais por volume, as internas no fim, e por último os dois "sem".
 * Cliente com 2 etiquetas conta nas 2 — a contagem é "quantos aparecem se eu
 * marcar só esta", não uma partição.
 */
export function opcoesEtiqueta(clientes: Iterable<ConversaDoCliente>): OpcaoEtiqueta[] {
  const cont = new Map<string, number>()
  let semEtq = 0, semWa = 0, semFone = 0
  for (const c of clientes) {
    const e = c.etiquetas
    if (!e) { if (c.semFone) semFone++; else semWa++; continue }
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
  if (semFone > 0) lista.push({ valor: SEM_TELEFONE, rotulo: rotuloEtiquetaOpcao(SEM_TELEFONE), n: semFone, interna: false })
  return lista
}

/** Um cliente vindo de UMA camada do mapa (orçamentos ou visitas). */
export interface ClienteDeCamada {
  /** Identidade entre camadas — telefone canônico. null = não tem par possível. */
  chave: string | null
  conversa: ConversaDoCliente
}

/** O que as duas camadas sabem do MESMO cliente, somado. */
function fundirConversas(a: ConversaDoCliente, b: ConversaDoCliente): ConversaDoCliente {
  if (!a.etiquetas) return b.etiquetas ? b : { etiquetas: null, semFone: a.semFone && b.semFone }
  if (!b.etiquetas) return a
  return {
    etiquetas: {
      principal: a.etiquetas.principal ?? b.etiquetas.principal,
      principalVendedor: a.etiquetas.principal ? a.etiquetas.principalVendedor : b.etiquetas.principalVendedor,
      todas: [...new Set([...a.etiquetas.todas, ...b.etiquetas.todas])],
      porVendedor: [...a.etiquetas.porVendedor, ...b.etiquetas.porVendedor],
    },
    semFone: false,
  }
}

/**
 * Opções do filtro considerando as DUAS camadas do mapa, sem contar em dobro.
 *
 * ⚠️ Antes de 03/09/2026 as visitas só entravam na lista quando a camada de
 * orçamentos estava DESLIGADA — e ela vem ligada. Efeito medido: 78 pinos de
 * visita em FOLLOW UP (7 vendedores), 62 em ORCAMENTO ENVIADO e 12 em LEAD
 * QUENTE estavam no mapa sem nenhuma opção correspondente no painel. Pior que
 * invisível: `visFiltradas` FILTRA a visita por etiqueta, então marcar qualquer
 * etiqueta sumia com esses pinos e não havia como trazê-los de volta.
 *
 * O medo que gerou a regra antiga era real (o mesmo cliente contado duas vezes),
 * mas a resposta é deduplicar pelo telefone canônico, não descartar a camada.
 * Quando o cliente está nas duas, as etiquetas se somam: marcar a da visita ou a
 * do orçamento mostra o cliente, porque existe um pino em cada camada.
 */
export function opcoesEtiquetaDeCamadas(itens: Iterable<ClienteDeCamada>): OpcaoEtiqueta[] {
  const porChave = new Map<string, ConversaDoCliente>()
  const semChave: ConversaDoCliente[] = []
  for (const { chave, conversa } of itens) {
    if (!chave) { semChave.push(conversa); continue }
    const atual = porChave.get(chave)
    porChave.set(chave, atual ? fundirConversas(atual, conversa) : conversa)
  }
  return opcoesEtiqueta([...porChave.values(), ...semChave])
}

// ── cores ────────────────────────────────────────────────────────────────────
// ETIQUETA_COR foi calibrada como TEXTO sobre branco (escura). Sobre o MAPA ela
// serve como está — e o mapa é claro nos DOIS temas (os tiles do Google não
// seguem o tema do app). Clarear só vale pro swatch da legenda/painel, que fica
// sobre a superfície escura do app. A v1 clareava o PINO no tema escuro e ele
// perdia contraste justamente sobre o tile claro.
const SEM_WA_CLARO = '#cbd5e1', SEM_WA_ESCURO = '#4b5563'
const SEM_ETQ_CLARO = '#6b7280', SEM_ETQ_ESCURO = '#a1a1aa'
// "sem telefone" é falta de CADASTRO, não de conversa: tom quente (stone) pra não
// virar mais um cinza-azulado igual aos outros dois na legenda.
const SEM_FONE_CLARO = '#b7b0a8', SEM_FONE_ESCURO = '#57534e'

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
  if (valor === SEM_TELEFONE) return escuro ? SEM_FONE_ESCURO : SEM_FONE_CLARO
  if (valor === SEM_ETIQUETA) return escuro ? SEM_ETQ_ESCURO : SEM_ETQ_CLARO
  const hex = corDaEtiqueta(valor)
  return escuro ? clarear(hex, 0.35) : hex
}

/** Cor do PINO: sempre a paleta clara, porque o mapa é claro em qualquer tema. */
export function corDoPinoEtiqueta(valor: string): string {
  return corDaOpcaoEtiqueta(valor, false)
}
