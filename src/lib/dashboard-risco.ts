import { foraDoRanking } from './vendedores-fora-do-ranking'

/**
 * "Leads quentes sem resposta" — a régua do card CRÍTICO das Decisões do gerente
 * e da lista "Leads a resgatar" do Dashboard.
 *
 * Mora aqui, e não dentro do `useDashboard`, para poder ser testada: o arquivo do
 * hook importa o client do Supabase, que puxa `import.meta.env` e não roda fora do
 * Vite.
 *
 * ── O defeito que isto conserta (29/09/2026) ──────────────────────────────
 * A regra era só `ageH > 24` e a lista é ordenada por valor. Sem teto de idade, o
 * card "Cada hora esfria" ficava PRESO nos mesmos orçamentos grandes e antigos:
 * medido no banco em 28/09, eram 552 candidatos, 474 deles parados há mais de 30
 * dias, e o top 8 tinha 124 / 77 / 70 dias (o 1º, R$ 801k, parado há 124 dias).
 * Um lead que esfriou ONTEM com proposta menor nunca aparecia — e é esse que ainda
 * dá para salvar. Lead de 4 meses é outra conversa (reativação), não "cada hora".
 *
 * E o "sem resposta" era falso para a maioria: `last_message_at` vem só do canal da
 * IA (auditoria.atendimentos). 387 dos 552 tinham orçamento gerado DEPOIS da
 * "última mensagem" — o vendedor estava falando com o cliente pelo WhatsApp dele.
 * Por isso a última atividade é o MAIOR entre a última mensagem e o último
 * orçamento montado.
 */
export const RISCO_MIN_HORAS = 24
/** 14 dias. Além disso o lead não "está esfriando" — já esfriou. */
export const RISCO_MAX_HORAS = 14 * 24
/**
 * Quantos o hook devolve (os mais caros da janela). Constante única porque três
 * lugares falam dele: o corte no useDashboard, o "8+" do card Crítico e o rodapé
 * da lista "Leads a resgatar" ("pode haver outros abaixo do corte").
 */
export const RISCO_TOP = 8

/**
 * Horas desde a última atividade conhecida do lead: última mensagem no canal da IA
 * OU último orçamento montado para o telefone dele (o que for mais recente).
 * `null` quando não há nenhuma das duas datas válidas.
 */
export function horasSemAtividade(
  lastMessageAt: string | null | undefined,
  ultimoOrcamentoMs: number | null | undefined,
  agoraMs: number,
): number | null {
  const msg = lastMessageAt ? new Date(lastMessageAt).getTime() : NaN
  const datas = [msg, ultimoOrcamentoMs ?? NaN].filter(Number.isFinite)
  if (datas.length === 0) return null
  return (agoraMs - Math.max(...datas)) / 3_600_000
}

/** Quente (quer investir agora) OU com orçamento, parado entre 24h e 14 dias. */
export function entraEmRisco(momento: string | null, valor: number, horas: number | null): boolean {
  if (horas == null) return false
  if (momento !== 'Agora' && !(valor > 0)) return false
  return horas > RISCO_MIN_HORAS && horas <= RISCO_MAX_HORAS
}

/**
 * Quem o card aponta como responsável: o 1º da lista que tem vendedor E conta
 * como vendedor. O dono (ver vendedores-fora-do-ranking) monta proposta de verdade
 * e pode estar na lista, mas cobrar "responsável: DANIEL" do gerente não faz sentido.
 */
export function responsavelDoRisco(leads: { vendedor: string | null }[]): string | undefined {
  return leads.find(l => l.vendedor && !foraDoRanking(l.vendedor))?.vendedor ?? undefined
}
