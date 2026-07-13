// Remove valores monetários (R$ > 0) do XML de um DOCX, preservando a estrutura.
// Usado pelo pdf-to-docx-producao: o DOCX convertido de PDF vai pra fábrica,
// e produção NUNCA pode ver preço. "R$ 0,00" é mantido (não revela margem e
// evita esvaziar células tipo motor por conta do cliente).
//
// Ordem dos passes (IMPORTANTE): primeiro o passe por parágrafo com os runs
// concatenados (PDF convertido fragmenta "R$ 12.617,63" em vários runs — um
// passe por nó isolado ANTES mutilaria o prefixo e deixaria resíduo invisível
// pro gate), depois o passe por nó isolado (parágrafos de run único).
//
// O GATE de verificação é deliberadamente MAIS paranoico que o scrub: decimal
// monetário sem "R$", resíduo órfão em linha de dinheiro, parágrafo terminando
// em "R$" e valor por extenso derrubam o documento (melhor sem doc que com preço).
// Imagens também são removidas: preço rasterizado em imagem passaria pelo gate.
import JSZip from 'jszip'

// "R " opcional entre R e $; dígitos corridos (1234,56) e milhar com ponto/
// NBSP/espaço. Preferimos remover DEMAIS a remover de menos.
const MONEY_RX = /R\s?\$\s*\d+(?:[.\s]\d{3})*(?:,\d{1,2})?/g

const KW_DINHEIRO = /TOTAL|VALOR|PRE[ÇC]O|UNIT|SUBTOTAL|DESCONTO|ENTRADA|PARCELA|SALDO|PAGAMENTO|BOLETO/i

/** Gate anti-vazamento sobre o texto visível de um parágrafo. */
function textoVazaPreco(l: string): boolean {
  const rs = l.match(/R\s?\$[^0-9A-Za-z]{0,6}([\d.,\s]*)/)
  if (rs && /[1-9]/.test(rs[1] ?? '')) return true
  const dec = l.match(/\d{1,3}(?:[.\s]\d{3})+,\d{2}/)
  if (dec && /[1-9]/.test(dec[0])) return true
  if (KW_DINHEIRO.test(l) && /\d*[1-9]\d*,\d{2}\b/.test(l)) return true
  if (/R\s?\$\s*[.:]?\s*$/.test(l)) return true
  if (KW_DINHEIRO.test(l) && /\breais\b/i.test(l)) return true
  return false
}

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
  // fragmentado PRIMEIRO (vê a string inteira do parágrafo), nós isolados depois
  let out = xml.replace(/<w:p\b[\s\S]*?<\/w:p>/g, (para) => scrubFragmentedParagraph(para, onRemove))
  out = scrubSingleNodes(out, onRemove)
  return out
}

/** Texto visível por parágrafo, com os runs concatenados. */
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
    /^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/.test(p)
  )
  if (!parts.includes('word/document.xml')) throw new Error('DOCX sem word/document.xml')

  for (const p of parts) {
    let xml = await zip.file(p)!.async('string')
    xml = scrubXml(xml, () => removed++)
    // imagens fora: preço rasterizado passaria pelo gate de texto
    xml = xml.replace(/<w:drawing\b[\s\S]*?<\/w:drawing>/g, '')
    xml = xml.replace(/<w:pict\b[\s\S]*?<\/w:pict>/g, '')
    zip.file(p, xml)
  }
  for (const p of Object.keys(zip.files)) {
    if (/^word\/media\//.test(p)) zip.remove(p)
  }

  const leaks: string[] = []
  for (const p of parts) {
    const xml = await zip.file(p)!.async('string')
    for (const text of joinedParagraphTexts(xml)) {
      if (textoVazaPreco(text)) leaks.push(text.slice(0, 40).replace(/\d/g, '#'))
    }
  }

  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }) as Buffer
  return { out, removed, leaks }
}
