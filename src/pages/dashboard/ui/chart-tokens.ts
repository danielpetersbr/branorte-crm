/**
 * Cores de gráfico — substitui o objeto COLORS do Dashboard antigo.
 *
 * Por que `hsl(var(--x))` e não um literal: o navegador resolve a variável na
 * hora de pintar, então o SVG do Recharts acompanha o tema claro/escuro sozinho.
 * O COLORS antigo tinha 47 tons fixos que NÃO respondiam ao dark mode — no tema
 * escuro várias linhas ficavam quase invisíveis contra o fundo.
 */
export const CHART = {
  s1: 'hsl(var(--chart-1))',
  s2: 'hsl(var(--chart-2))',
  s3: 'hsl(var(--chart-3))',
  s4: 'hsl(var(--chart-4))',
  s5: 'hsl(var(--chart-5))',
  grid: 'hsl(var(--chart-grid))',
  ink: 'hsl(var(--chart-ink))',
} as const

/** Série por ordem — use CHART_SERIE[i], nunca escolha cor "a olho". */
export const CHART_SERIE = [CHART.s1, CHART.s2, CHART.s3, CHART.s4, CHART.s5] as const

/**
 * Cor POR SIGNIFICADO — o mesmo conceito tem a mesma cor em toda a aplicação.
 * Antes, "orçamento" era roxo no KPI, verde no funil e âmbar no mapa.
 */
export const CHART_ETAPA = {
  leads:        CHART.s2,   // azul  — entrada, neutro
  qualificados: CHART.s1,   // verde — avanço
  propostas:    CHART.s3,   // âmbar — em jogo
  vendas:       CHART.s1,   // verde — resultado
  perdido:      CHART.s4,   // vermelho — perda
} as const

/** Estilo do tooltip do Recharts, tokenizado. */
export const TOOLTIP_STYLE = {
  background: 'hsl(var(--surface))',
  border: '1px solid hsl(var(--border))',
  borderRadius: 8,
  fontSize: 12,
  color: 'hsl(var(--ink))',
  boxShadow: '0 4px 12px hsl(240 10% 7% / 0.10)',
  padding: '8px 10px',
} as const

/** Eixo: 12px é o piso da escala tipográfica; abaixo disso não vai. */
export const AXIS_TICK = { fontSize: 12, fill: CHART.ink } as const
