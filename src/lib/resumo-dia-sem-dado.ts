/**
 * Quando uma coluna do "Resumo por vendedor" (ResumoDiaVendedores) vira "· · ·"
 * — "o sistema não sabe" — em vez de mostrar número.
 *
 * Mora aqui, e não no componente, para poder ser testada: o componente importa o
 * useResumoDia, que importa o client do Supabase (`import.meta.env`, só roda no Vite).
 *
 * Cada coluna vem de UMA das três RPCs do useResumoDia, e zero só pode aparecer
 * quando a fonte daquela coluna respondeu. Zero num painel de gestão é lido como
 * "ninguém trabalhou", não como "não carregou" — e vai assim pro grupo do WhatsApp.
 *
 * ── O furo que isto fecha (29/09/2026) ────────────────────────────────────
 * `escritorio_fluxo_periodo` (Leads, Orçamentos, Ligações e, fora de Hoje/Tudo,
 * Atendidos) não tinha flag nenhuma: o hook descartava o `error`, a query "dava
 * certo" com mapa vazio e o time inteiro aparecia com Leads 0, Orçamentos 0, Score
 * 0% — e o refetch de 30 s trocava dado bom por esses zeros sem aviso.
 */
export type ColunaResumo =
  | 'leads' | 'atendimentos' | 'ligacoes' | 'orcamentos'
  | 'negociacao' | 'quente' | 'carteira' | 'score'

/** Qual fonte do useResumoDia NÃO tem dado confiável agora. */
export type FontesFora = {
  /** escritorio_funil_vivo — Negociando, Quentes; Atendidos em Hoje/Tudo. */
  funil: boolean
  /** escritorio_carteira_funil — Carteira. */
  carteira: boolean
  /** escritorio_fluxo_periodo — Leads, Orçamentos, Ligações; Atendidos nos demais períodos. */
  fluxo: boolean
  /** Hoje/Tudo: Atendidos (e por isso o Score) vem do funil vivo, não do fluxo. */
  liveHoje: boolean
}

/** Vale para a coluna INTEIRA (KPI do topo, total do rodapé, linha do time no WhatsApp). */
export function colunaSemDado(c: { key: ColunaResumo; snapshot: boolean }, fora: FontesFora): boolean {
  // Atendidos troca de fonte conforme o período — cai junto com a fonte que está valendo.
  const atendidosFora = fora.liveHoje ? fora.funil : fora.fluxo
  switch (c.key) {
    case 'carteira':
      return fora.carteira
    // Score é atendidos ÷ carteira: cai junto com QUALQUER um dos dois lados.
    case 'score':
      return fora.carteira || atendidosFora
    case 'atendimentos':
      return atendidosFora
    case 'leads':
    case 'orcamentos':
    case 'ligacoes':
      return fora.fluxo
    default:
      return c.snapshot && fora.funil
  }
}

const MEDALHAS = ['🥇', '🥈', '🥉']

/**
 * Marca de cada vendedor no "Copiar pro WhatsApp": 🥇🥈🥉 no top 3, "•" no resto.
 *
 * A lista vem ordenada por Atendidos. Quando ESSA coluna não tem dado (fonte fora
 * ou, fora de Hoje/Tudo, o fluxo do período ainda carregando), todo mundo tem
 * atendimentos = 0 e a ordem vira alfabética — e o grupo recebia um pódio
 * inventado (29/09/2026). Sem a métrica do ranking, ninguém ganha medalha.
 */
export function marcaNoRanking(posicao: number, fora: FontesFora): string {
  if (colunaSemDado({ key: 'atendimentos', snapshot: false }, fora)) return '•'
  return MEDALHAS[posicao] ?? '•'
}
