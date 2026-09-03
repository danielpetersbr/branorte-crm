/**
 * Limpeza dos textos que a coluna MOTIVO do /atendimentos exibe.
 *
 * Os dois problemas que isto resolve foram medidos no banco em 03/09/2026:
 *
 * 1. `last_message_text` carrega "Lead chegou via webhook" em 100% dos 6.462 leads dos
 *    últimos 30 dias. O campo é lido como "resumo do que o cliente quer", mas nunca teve
 *    fala de gente dentro — o texto de sistema ocupava a célula em toda linha.
 * 2. `o_que_precisa` chega com a string "null" grudada quando o cliente não completou a
 *    frase, e a tela mostrava "moinho null" (46 casos em 30 dias).
 */

/** Frases que o sistema grava fingindo ser mensagem do cliente. */
const RESUMO_DE_SISTEMA =
  /^(lead chegou via|lead recebido|mensagem autom[aá]tica|sem mensagem|conversa iniciada pelo sistema)\b/i

/** Valores que chegam como texto e significam "vazio". */
const VAZIO_ESCRITO = /^(null|undefined|nan)$/i

/**
 * Devolve o resumo só quando é fala de verdade.
 * Texto de sistema, vazio e "null" escrito viram `null`.
 */
export function resumoUtil(v: string | null | undefined): string | null {
  const s = (v ?? '').trim()
  if (!s) return null
  if (RESUMO_DE_SISTEMA.test(s)) return null
  if (VAZIO_ESCRITO.test(s)) return null
  return s
}

/**
 * Limpa o nome do equipamento tirando "null"/"undefined" grudado e parênteses que
 * sobraram vazios. Devolve `null` quando não sobra nada aproveitável.
 */
export function limparEquipamento(v: string | null | undefined): string | null {
  const s = (v ?? '')
    .replace(/\b(null|undefined|nan)\b/gi, ' ')
    .replace(/\(\s*\)/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return s || null
}
