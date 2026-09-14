const MAX_VISIBLE_MESSAGE = 360

export function compactChatMessage(message: string): string {
  const text = message.trim()
  if (text.length <= MAX_VISIBLE_MESSAGE) return text
  const head = text.slice(0, 150).trimEnd()
  const tail = text.slice(-160).trimStart()
  return `${head}\n… conteúdo extenso ocultado …\n${tail}`
}
