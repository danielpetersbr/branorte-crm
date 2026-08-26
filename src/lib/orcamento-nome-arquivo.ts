// Nome do arquivo do orçamento (Storage + pasta Z:\).
//
// Mora aqui, e não dentro do FinalizarMontarModal, porque tem teste: o corte
// silencioso do nome já custou um orçamento (roadmap #70 — o vendedor digitava
// a descrição inteira, a tela confirmava, e o arquivo saía sem o final).

// Teto do nome INTEIRO. Mesmo limite de orcamento-docx.ts (nomeBaseArquivo) —
// com a pasta Z:\ e a extensão, o caminho ainda cabe no MAX_PATH do Windows.
export const MAX_NOME_ARQUIVO = 180

// Quanto o vendedor pode digitar no campo Descrição. Fica abaixo do teto pra
// sobrar espaço pro número + nome do cliente.
export const MAX_DESCRICAO = 140

/**
 * Remove acentos/cedilha e os caracteres proibidos em nome de arquivo.
 *
 * Por que normalizar acentos: o Supabase Storage rejeita URLs com unicode no
 * path (o fastify quebra com FST_ERR_BAD_URL). "GRÃOS" → "GRAOS". Isso afeta
 * só o NOME DO ARQUIVO — o nome do cliente segue legível no banco.
 */
export function sanitizeNomeArquivo(s: string, max = 80): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '')  // tira diacríticos
    .replace(/[<>:"/\\|?*]/g, '')                            // proibidos Windows/Storage
    .slice(0, max).trim()
}

/**
 * Monta "2026 - 1946 - Cliente (descrição)".
 *
 * A descrição é o que o vendedor usa pra achar o arquivo depois. Ela vinha
 * cortada em 80 caracteres DENTRO do sanitize (o `.slice(0, 100)` de fora nunca
 * chegava a morder), e a prévia da tela mostrava o texto inteiro — ele digitava,
 * conferia e o arquivo saía sem o final. Agora o corte só acontece no que passa
 * do teto do nome COMPLETO, e sai sempre da descrição: número e cliente nunca
 * somem.
 */
export function nomeBase(numero: string, cliente: string, descricao: string, isTest = false, agora = new Date()): string {
  const desc = sanitizeNomeArquivo(descricao || 'Personalizado', MAX_NOME_ARQUIVO) || 'Personalizado'
  if (isTest) {
    const ts = agora.toISOString().replace(/[:.]/g, '-').slice(11, 19)
    return `TESTE-${ts}-${sanitizeNomeArquivo(cliente || 'cliente')} (${numero})`
  }
  // Se o número tem -ALT, o sufixo vai pro fim do nome do arquivo.
  const altMatch = numero.match(/(-ALT\d*)$/)
  const cli = sanitizeNomeArquivo(cliente || 'Sem cliente')
  const montar = (d: string) => altMatch
    ? `${numero.replace(altMatch[0], '')} - ${cli} (${d})${altMatch[0]}`
    : `${numero} - ${cli} (${d})`
  const nome = montar(desc)
  if (nome.length <= MAX_NOME_ARQUIVO) return nome
  // Estourou: corta SÓ a descrição, na medida exata do que sobrou.
  const sobra = MAX_NOME_ARQUIVO - montar('').length
  return montar(desc.slice(0, Math.max(0, sobra)).trim())
}

/** Nome curto pro arquivo enviado no WhatsApp: só número + cliente. */
export function nomeBaseWhatsApp(numero: string, cliente: string): string {
  return `${numero} - ${sanitizeNomeArquivo(cliente || 'Sem cliente')}`
}
