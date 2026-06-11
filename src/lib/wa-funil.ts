// Taxonomia compartilhada do funil de etiquetas WhatsApp (Wascript).
// Fonte única para ordem oficial, aliases de typo, cores e ocultas —
// usada pelo Kanban /funil e alinhada com EtiquetasZap/PainelEtiquetas.

// Ordem oficial do funil de vendas Branorte. Etiquetas fora da lista vão pro final.
export const ORDEM_FUNIL: string[] = [
  // FUNIL DE VENDAS
  'PROSPECCAO',
  '2A TENTATIVA',
  'NOVO LEAD',
  'FOLLOW UP',
  'LEAD QUENTE',
  'ORCAMENTO ENVIADO',
  'INTERESSE FUTURO',
  'VENDIDO',
  // MOTIVO DE FECHAMENTO
  'NAO RESPONDEU MAIS',
  'NUNCA RESPONDEU',
  'NAO TEM INTERESSE',
  'COMPROU DO CONCORRENTE',
  'SO BASE DE PRECO',
  'FORA DO ORCAMENTO',
  'NAO FABRICAMOS',
  'OUTROS ASSUNTOS',
  'RESOLVIDO',
]

// Typos/variantes → nome canônico (corrige exibição sem alterar o dado)
export const ALIASES: Record<string, string> = {
  'FALLOW UP': 'FOLLOW UP',
  'FALLOWUP': 'FOLLOW UP',
  'FOLLOWUP': 'FOLLOW UP',
  'COMPROU DO COMCORRENTE': 'COMPROU DO CONCORRENTE',
  'PROSPECCOES': 'PROSPECCAO',
  'NOVOS LEADS': 'NOVO LEAD',
  'LEAD NOVO': 'NOVO LEAD',
  'VENDIDOS': 'VENDIDO',
  'RESOLVIDOS': 'RESOLVIDO',
  'QUENTE': 'LEAD QUENTE',
}

// Etiquetas internas/de organização que não são funil de cliente
export const ETIQUETAS_OCULTAS = new Set([
  'NAO LIDAS', 'FAVORITOS', 'GRUPOS', 'BRANORTE',
  'TRANSPORTADORAS', 'FUNCIONARIO', 'FUNCIONARIOS', 'PESSOAL',
])

export const ETIQUETA_COR: Record<string, string> = {
  'PROSPECCAO': '#3b82f6',
  '2A TENTATIVA': '#06b6d4',
  'NOVO LEAD': '#8b5cf6',
  'FOLLOW UP': '#f59e0b',
  'INTERESSE FUTURO': '#facc15',
  'VENDIDO': '#10b981',
  'LEAD QUENTE': '#ec4899',
  'ORCAMENTO ENVIADO': '#22d3ee',
  'RESOLVIDO': '#84cc16',
  'NAO RESPONDEU MAIS': '#94a3b8',
  'NUNCA RESPONDEU': '#64748b',
  'NAO TEM INTERESSE': '#a78bfa',
  'COMPROU DO CONCORRENTE': '#ef4444',
  'SO BASE DE PRECO': '#f97316',
  'FORA DO ORCAMENTO': '#fb7185',
  'NAO FABRICAMOS': '#0ea5e9',
  'OUTROS ASSUNTOS': '#71717a',
  'PENDENCIA': '#dc2626',
}

export const canonico = (nomeNormalizado: string): string =>
  ALIASES[nomeNormalizado.trim()] ?? nomeNormalizado.trim()

export const ordemDe = (nomeCanonico: string): number => {
  const idx = ORDEM_FUNIL.indexOf(nomeCanonico)
  return idx === -1 ? 900 : idx
}

export const corDaEtiqueta = (nomeCanonico: string): string =>
  ETIQUETA_COR[nomeCanonico] ?? '#9ca3af'

// Temperatura do chat pela última mensagem (igual ao painel do WhatsApp/Wascript)
export type Temperatura = 'fresco' | 'recente' | 'morno' | 'parado' | 'sem-dado'

export function temperaturaDe(iso: string | null): Temperatura {
  if (!iso) return 'sem-dado'
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return 'sem-dado'
  const dias = (Date.now() - t) / 86_400_000
  if (dias < 1) return 'fresco'
  if (dias < 3) return 'recente'
  if (dias < 7) return 'morno'
  return 'parado'
}

export const TEMP_META: Record<Temperatura, { cor: string; label: string }> = {
  fresco: { cor: '#22c55e', label: 'Hoje' },
  recente: { cor: '#3b82f6', label: 'Recente (1-3 dias)' },
  morno: { cor: '#eab308', label: 'Morno (3-7 dias)' },
  parado: { cor: '#ef4444', label: 'Parado (+7 dias)' },
  'sem-dado': { cor: '#6b7280', label: 'Sem data' },
}

export interface ResumoColuna {
  fresco: number
  recente: number
  morno: number
  parado: number
  semDado: number
  aguardando: number // cliente mandou por último (esperando resposta)
}

export function resumoColuna(
  chats: { last_message_at: string | null; last_message_from_me: boolean | null }[]
): ResumoColuna {
  const r: ResumoColuna = { fresco: 0, recente: 0, morno: 0, parado: 0, semDado: 0, aguardando: 0 }
  for (const c of chats) {
    const temp = temperaturaDe(c.last_message_at)
    if (temp === 'fresco') r.fresco++
    else if (temp === 'recente') r.recente++
    else if (temp === 'morno') r.morno++
    else if (temp === 'parado') r.parado++
    else r.semDado++
    if (c.last_message_from_me === false) r.aguardando++
  }
  return r
}

/** "há 5 min", "há 3 h", "ontem", "10/06" */
export function tempoRelativo(iso: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const diffMin = Math.floor((Date.now() - t) / 60000)
  if (diffMin < 1) return 'agora'
  if (diffMin < 60) return `há ${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `há ${diffH} h`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'ontem'
  if (diffD < 7) return `há ${diffD} dias`
  const d = new Date(t)
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
}
