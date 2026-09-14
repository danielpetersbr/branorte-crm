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
  if (/\b(mono|monofasico|monofasica)\b/.test(text)) return 'monofasico'
  if (/\b(tri|trifasico|trifasica)\b/.test(text)) return 'trifasico'
  return undefined
}

function detectLine(text: string): 'MINI' | 'COMPACTA_01' | 'COMPACTA_02' | 'COMPACTA_03' | undefined {
  if (/\bcompacta\s*0?1\b/.test(text)) return 'COMPACTA_01'
  if (/\bcompacta\s*0?2\b/.test(text)) return 'COMPACTA_02'
  if (/\bcompacta\s*0?3\b/.test(text)) return 'COMPACTA_03'
  if (/\bmini(?:\s*fabrica)?\b/.test(text)) return 'MINI'
  return undefined
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
  const token = text.match(/\b(\d{4,6}\s*[-x]\s*\d{3,5}\s*[-x]\s*\d{3,5})\b/)?.[1]
    ?.replace(/\s+/g, '')
    .replace(/x/g, '-')

  return {
    operacao: input.operacao ?? 'novo',
    cliente: input.cliente ?? {},
    modeloPedido: line ? {
      linha: line,
      master: /\bmaster\b/.test(text),
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
