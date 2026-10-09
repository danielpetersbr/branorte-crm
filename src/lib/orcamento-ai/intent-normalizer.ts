import type { IntencaoOrcamento, ItemPedido, VoltagemOrcamento } from './types.js'

export interface RawIntentInput {
  texto: string
  operacao?: IntencaoOrcamento['operacao']
  cliente?: IntencaoOrcamento['cliente']
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
}

function detectVoltage(text: string): VoltagemOrcamento | undefined {
  const matches = [
    ...Array.from(text.matchAll(/\b(mono|monofasico|monofasica)\b/g), (match) => ({ index: match.index ?? -1, value: 'monofasico' as const })),
    ...Array.from(text.matchAll(/\b(tri|trifasico|trifasica)\b/g), (match) => ({ index: match.index ?? -1, value: 'trifasico' as const })),
  ]
  return matches.sort((left, right) => right.index - left.index)[0]?.value
}

function detectLine(text: string): 'MINI' | 'COMPACTA_01' | 'COMPACTA_02' | 'COMPACTA_03' | undefined {
  const matches = [
    ...Array.from(text.matchAll(/\bcompacta\s*0?1\b/g), (match) => ({ index: match.index ?? -1, value: 'COMPACTA_01' as const })),
    ...Array.from(text.matchAll(/\bcompacta\s*0?2\b/g), (match) => ({ index: match.index ?? -1, value: 'COMPACTA_02' as const })),
    ...Array.from(text.matchAll(/\bcompacta\s*0?3\b/g), (match) => ({ index: match.index ?? -1, value: 'COMPACTA_03' as const })),
    ...Array.from(text.matchAll(/\bmini(?:\s*fabrica)?\b/g), (match) => ({ index: match.index ?? -1, value: 'MINI' as const })),
  ]
  return matches.sort((left, right) => right.index - left.index)[0]?.value
}

function detectModelToken(text: string): string | undefined {
  const mentions = Array.from(text.matchAll(/\b(?:compacta\s*0?[123]|mini(?:\s*fabrica)?)\b/g))
  const lastMention = mentions[mentions.length - 1]
  if (!lastMention) return undefined
  return text
    .slice(lastMention.index ?? 0)
    .match(/^(?:compacta\s*0?[123]|mini(?:\s*fabrica)?)\b[\s:–—-]*(?:(?:master|standard|padrao|normal)\b[\s:–—-]*)?(\d{4,7}(?:\s*[-x]\s*\d{3,5}){0,2})\b/)?.[1]
    ?.replace(/\s+/g, '')
    .replace(/x/g, '-')
}

function detectMaster(text: string): boolean | undefined {
  const masterMatches = Array.from(text.matchAll(/\bmaster\b/g))
  const standardMatches = Array.from(text.matchAll(/\b(?:standard|padrao|normal)\b/g))
  const master = masterMatches[masterMatches.length - 1]?.index ?? -1
  const standard = standardMatches[standardMatches.length - 1]?.index ?? -1
  if (master < 0 && standard < 0) return undefined
  return master > standard
}

function parseItems(raw: string, text: string): ItemPedido[] {
  const items: ItemPedido[] = []
  if (/\b(suporte|parque)\s+(?:para\s+)?(?:big\s*)?bag\b/.test(text)) {
    items.push({
      textoOriginal: raw,
      categoria: 'SUPORTE_BAG',
      quantidade: 1,
      semFunil: /\bsem\s+funil\b/.test(text),
    })
  }
  return items
}

export function normalizeIntent(input: RawIntentInput): IntencaoOrcamento {
  const text = fold(input.texto.trim())
  const line = detectLine(text)
  const token = detectModelToken(text)

  return {
    operacao: input.operacao ?? 'novo',
    cliente: input.cliente ?? {},
    modeloPedido: line ? {
      linha: line,
      master: detectMaster(text),
      voltagem: detectVoltage(text),
      basenameToken: token,
      textoOriginal: input.texto,
    } : undefined,
    itensPedidos: parseItems(input.texto, text),
    instrucoesExplicitas: {
      preservarAcessoriosDoModelo: /\b(manter|preservar).{0,30}\bacessorios?\b/.test(text),
      alterarAcessorios: /\b(alterar|trocar|mudar).{0,30}\bacessorios?\b/.test(text),
      percentualAcessorios: (() => {
        const match = text.match(/\bacessorios?.{0,20}?(\d+(?:[.,]\d+)?)\s*%|\b(\d+(?:[.,]\d+)?)\s*%.{0,20}?acessorios?\b/)
        const value = Number((match?.[1] ?? match?.[2] ?? '').replace(',', '.'))
        return Number.isFinite(value) && value >= 0 && value <= 50 ? value : undefined
      })(),
      enviarWhatsapp: /\b(enviar|mandar).{0,20}\bwhats(?:app)?\b/.test(text),
    },
    ambiguidades: [],
  }
}
