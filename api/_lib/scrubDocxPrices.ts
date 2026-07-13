// Remove valores monetários (R$ > 0) do XML de um DOCX, preservando a estrutura.
// Usado pelo pdf-to-docx-producao: o DOCX convertido de PDF vai pra fábrica,
// e produção NUNCA pode ver preço. "R$ 0,00" é mantido (não revela margem e
// evita esvaziar células tipo motor por conta do cliente).
//
// Dois passes: (A) dentro de cada <w:t> isolado; (B) por parágrafo com o texto
// dos runs concatenado — PDFs convertidos fragmentam "R$ 1.234,56" em vários
// runs e o passe A sozinho vazaria preço.
import JSZip from 'jszip'

const MONEY_RX = /R\$[\s ]*\d{1,3}(?:[.  ]?\d{3})*(?:,\d{1,2})?/g
// pós-scrub: qualquer "R$" seguido de dígito 1-9 por perto = vazamento
const LEAK_RX = /R\$[^0-9A-Za-z]{0,6}[\d.,\s ]*[1-9]/

const WT_RX = /(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g

function scrubSingleNodes(xml: string, onRemove: () => void): string {
  return xml.replace(WT_RX, (_m, open: string, text: string, close: string) => {
    const scrubbed = text.replace(MONEY_RX, (v) => {
      if (/[1-9]/.test(v)) { onRemove(); return '' }
      return v
    })
    return open + scrubbed + close
  })
}

function scrubFragmentedParagraph(para: string, onRemove: () => void): string {
  type Node = { start: number; len: number; open: string; text: string; close: string; joinedStart: number }
  const nodes: Node[] = []
  let joined = ''
  const re = new RegExp(WT_RX.source, 'g')
  let m: RegExpExecArray | null
  while ((m = re.exec(para))) {
    nodes.push({ start: m.index, len: m[0].length, open: m[1], text: m[2], close: m[3], joinedStart: joined.length })
    joined += m[2]
  }
  if (nodes.length < 2) return para

  const ranges: Array<[number, number]> = []
  const money = new RegExp(MONEY_RX.source, 'g')
  let mm: RegExpExecArray | null
  while ((mm = money.exec(joined))) {
    if (/[1-9]/.test(mm[0])) ranges.push([mm.index, mm.index + mm[0].length])
  }
  if (!ranges.length) return para

  for (const _ of ranges) onRemove()
  let out = para
  for (let i = nodes.length - 1; i >= 0; i--) {
    const n = nodes[i]
    const chars = n.text.split('')
    for (const [a, b] of ranges) {
      const s = Math.max(a - n.joinedStart, 0)
      const e = Math.min(b - n.joinedStart, n.text.length)
      for (let k = s; k < e; k++) chars[k] = ''
    }
    out = out.slice(0, n.start) + n.open + chars.join('') + n.close + out.slice(n.start + n.len)
  }
  return out
}

function scrubXml(xml: string, onRemove: () => void): string {
  let out = scrubSingleNodes(xml, onRemove)
  out = out.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (para) => scrubFragmentedParagraph(para, onRemove))
  return out
}

/** Texto visível de um trecho XML, com runs do mesmo parágrafo concatenados. */
function joinedParagraphTexts(xml: string): string[] {
  const paras = xml.match(/<w:p\b[\s\S]*?<\/w:p>/g) || []
  return paras.map((p) =>
    (p.match(WT_RX) || []).map((t) => t.replace(/<[^>]+>/g, '')).join('')
  )
}

export interface ScrubResult {
  out: Buffer
  removed: number
  /** Trechos com preço residual (dígitos mascarados). Vazio = seguro pra produção. */
  leaks: string[]
}

export async function scrubDocxPrices(docx: Buffer): Promise<ScrubResult> {
  const zip = await JSZip.loadAsync(docx)
  let removed = 0
  const parts = Object.keys(zip.files).filter((p) =>
    /^word\/(document|header\d*|footer\d*)\.xml$/.test(p)
  )
  if (!parts.includes('word/document.xml')) throw new Error('DOCX sem word/document.xml')

  for (const p of parts) {
    const xml = await zip.file(p)!.async('string')
    zip.file(p, scrubXml(xml, () => removed++))
  }

  const leaks: string[] = []
  for (const p of parts) {
    const xml = await zip.file(p)!.async('string')
    for (const text of joinedParagraphTexts(xml)) {
      const leak = text.match(LEAK_RX)
      if (leak) leaks.push(leak[0].slice(0, 30).replace(/\d/g, '#'))
    }
  }

  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
  return { out, removed, leaks }
}
