// Classificação semântica das etiquetas WhatsApp dos vendedores Branorte.
// O nome da etiqueta vem do WhatsApp do próprio vendedor — cada um cria as
// suas. Tem variação de grafia (VENDIDO/VENDIDOS, COM/SEM acento). Aqui
// agrupamos por intenção pra calcular saúde do funil.

import type { WascriptEtiqueta } from '@/hooks/useEtiquetas'

export type EtiquetaCategoria =
  | 'novo'      // ainda não trabalhado
  | 'quente'    // em andamento, quente
  | 'orcamento' // orçamento enviado, esperando decisão
  | 'vendido'   // fechou
  | 'morto'     // não respondeu / sem interesse / perdido
  | 'outros'    // BRANORTE, transportadoras, custom

interface CatMeta {
  label: string
  emoji: string
  colorVar: string  // CSS var (sem o "var(--)")
  textClass: string
  bgClass: string
}

export const CATEGORIA_META: Record<EtiquetaCategoria, CatMeta> = {
  novo:      { label: 'Novos',     emoji: '🆕', colorVar: '--info',    textClass: 'text-info',    bgClass: 'bg-info-bg' },
  quente:    { label: 'Quentes',   emoji: '🔥', colorVar: '--warning', textClass: 'text-warning', bgClass: 'bg-warning-bg' },
  orcamento: { label: 'Orçamento', emoji: '📄', colorVar: '--accent',  textClass: 'text-accent',  bgClass: 'bg-accent-bg' },
  vendido:   { label: 'Vendidos',  emoji: '✅', colorVar: '--success', textClass: 'text-success', bgClass: 'bg-success-bg' },
  morto:     { label: 'Perdidos',  emoji: '💀', colorVar: '--danger',  textClass: 'text-danger',  bgClass: 'bg-danger-bg' },
  outros:    { label: 'Outros',    emoji: '·',  colorVar: '--ink-faint', textClass: 'text-ink-muted', bgClass: 'bg-surface-2' },
}

// Match por nome normalizado (UPPER, sem acento) — mesma normalização do banco
function classify(nomeNormalizado: string): EtiquetaCategoria {
  const n = nomeNormalizado.trim()

  // VENDIDO / VENDIDOS
  if (n === 'VENDIDO' || n === 'VENDIDOS' || n === 'CLIENTE' || n.startsWith('CLIENTES ')) return 'vendido'

  // ORÇAMENTO ENVIADO
  if (n.startsWith('ORCAMENTO')) return 'orcamento'

  // QUENTE / EM ANDAMENTO
  if (n === 'PROSPECCAO' || n === 'FOLLOW UP' || n === 'FOLLOWUP' || n === 'INTERESSE FUTURO'
      || n === '2A TENTATIVA' || n === 'LEAD QUENTE' || n === 'QUENTE'
      || n === 'AGUARDANDO' || n === 'AGUARDANDO RESPOSTA') return 'quente'

  // MORTO / PERDIDO
  if (n === 'NUNCA RESPONDEU' || n === 'NAO RESPONDEU MAIS' || n === 'NAO TEM INTERESSE'
      || n === 'COMPROU DO CONCORRENTE' || n === 'NAO FABRICAMOS' || n === 'FORA DO ORCAMENTO'
      || n === 'SO BASE DE PRECO' || n === 'RESOLVIDO' || n === 'RESOLVIDOS') return 'morto'

  // NOVO LEAD
  if (n === 'NOVO LEAD' || n === 'NOVOS LEADS' || n === 'LEAD NOVO') return 'novo'

  // Catch-all
  return 'outros'
}

export interface EtiquetaResumo {
  /** Categoria semântica */
  categoria: EtiquetaCategoria
  /** Nome canônico (junta VENDIDO+VENDIDOS) */
  nome: string
  /** Soma de contatos do grupo */
  total: number
  /** Etiquetas individuais que compõem este grupo */
  origem: WascriptEtiqueta[]
}

export interface FunilEtiquetasResumo {
  /** Total geral de contatos no WA do vendedor */
  totalContatos: number
  /** Por categoria */
  porCategoria: Record<EtiquetaCategoria, number>
  /** Score de saúde 0-100. (vivos+vendidos) / total */
  scoreSaude: number
  /** Etiquetas agregadas, ordenadas por total DESC */
  etiquetas: EtiquetaResumo[]
}

const HIDDEN = new Set(['NAO LIDAS', 'FAVORITOS', 'GRUPOS', 'BRANORTE'])

export function classificarEtiquetas(items: WascriptEtiqueta[] | undefined): FunilEtiquetasResumo {
  const visiveis = (items ?? []).filter(
    e => !HIDDEN.has(e.etiqueta_nome_normalizado) && (e.total_contatos ?? 0) > 0
  )

  // Dedup: mesma categoria + mesma "intenção" colapsam (VENDIDO + VENDIDOS)
  const grupos = new Map<string, EtiquetaResumo>()
  for (const e of visiveis) {
    const cat = classify(e.etiqueta_nome_normalizado)
    // Chave: categoria + nome canônico. Para "vendido", colapsa tudo num grupo.
    let key: string
    let nomeCanonico: string
    if (cat === 'vendido') {
      key = 'vendido:VENDIDO'
      nomeCanonico = 'Vendido'
    } else if (cat === 'orcamento') {
      key = 'orcamento:ORCAMENTO ENVIADO'
      nomeCanonico = 'Orçamento enviado'
    } else if (cat === 'quente' && (e.etiqueta_nome_normalizado === 'LEAD QUENTE' || e.etiqueta_nome_normalizado === 'QUENTE')) {
      key = 'quente:QUENTE'
      nomeCanonico = 'Lead quente'
    } else {
      key = `${cat}:${e.etiqueta_nome_normalizado}`
      nomeCanonico = e.etiqueta_nome
    }

    const atual = grupos.get(key)
    if (atual) {
      atual.total += e.total_contatos
      atual.origem.push(e)
    } else {
      grupos.set(key, {
        categoria: cat,
        nome: nomeCanonico,
        total: e.total_contatos,
        origem: [e],
      })
    }
  }

  const etiquetas = Array.from(grupos.values()).sort((a, b) => b.total - a.total)

  const porCategoria: Record<EtiquetaCategoria, number> = {
    novo: 0, quente: 0, orcamento: 0, vendido: 0, morto: 0, outros: 0,
  }
  for (const g of etiquetas) porCategoria[g.categoria] += g.total

  const totalContatos = etiquetas.reduce((acc, g) => acc + g.total, 0)
  const vivos = porCategoria.novo + porCategoria.quente + porCategoria.orcamento + porCategoria.vendido
  const scoreSaude = totalContatos > 0 ? Math.round((vivos / totalContatos) * 100) : 0

  return { totalContatos, porCategoria, scoreSaude, etiquetas }
}
