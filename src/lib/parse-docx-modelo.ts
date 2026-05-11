// Parser de .docx Branorte → extrai items + motores + acessórios + total.
// Versão browser do script Node que usei pra parsear os 65 modelos originais.
//
// Estratégia: abre o zip via pizzip, lê word/document.xml, aplica regex baseado
// nos padrões do template Branorte:
//   A - 01 - NOME (specs)... VALOR R$ X.XXX,XX

import PizZip from 'pizzip'

export interface ParsedItem {
  letra: string
  qtd: number
  nome: string
  specs: string[]
  valor: number
}

export interface ParsedMotor {
  cv: number
  polos: number
  valor: number
}

export interface ParsedAcessorios {
  items: string[]
  valor: number
}

export interface ParsedModelo {
  itens: ParsedItem[]
  motores: ParsedMotor[]
  acessorios: ParsedAcessorios | null
  total_equipamentos: number
  total_motores: number
  total_proposta: number | null
}

// Extrai texto bruto do .docx (concatenando todos os <w:t>)
function extractText(xml: string): string {
  // Pega o conteúdo de todos os <w:t>...</w:t>, junta com newlines em <w:p>
  // Substitui <w:p> por newline e remove demais tags
  const out = xml
    .replace(/<w:p[^>]*>/g, '\n')
    .replace(/<w:br[^/]*\/?>/g, '\n')
    .replace(/<w:tab[^/]*\/?>/g, '\t')
    .replace(/<[^>]+>/g, '')
    // decodifica entidades
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
  return out
}

export async function parseDocxModelo(file: File | Blob): Promise<ParsedModelo> {
  const arrayBuffer = await file.arrayBuffer()
  const zip = new PizZip(arrayBuffer)
  const docXmlFile = zip.file('word/document.xml')
  if (!docXmlFile) throw new Error('Arquivo não é um .docx válido (sem word/document.xml)')

  const xml = docXmlFile.asText()
  const texto = extractText(xml)

  // Items: começa com letra A-G + " - QTD - " + nome + specs + VALOR R$ X
  const ITEM_RE = /(?:^|\n)([A-G])\s*[\-–—]\s*(\d{1,2})\s*[\-–—]\s*([^\n]+)\n([\s\S]*?)\n\s*VALOR\s+R\$\s*([\d.]+,\d{2})/g
  const itens: ParsedItem[] = []
  let m: RegExpExecArray | null
  while ((m = ITEM_RE.exec(texto)) !== null) {
    const [, letra, qtd, nome, body, valorStr] = m
    const valor = parseFloat(valorStr.replace(/\./g, '').replace(',', '.'))
    const specs = body.split('\n')
      .map(s => s.replace(/^[\-\s•·:]+/, '').trim())
      .filter(s => s.length > 3 && !/^valor/i.test(s) && !/Imagem/i.test(s))
    itens.push({
      letra: letra.trim(),
      qtd: parseInt(qtd, 10) || 1,
      nome: nome.trim().replace(/\s+/g, ' '),
      specs,
      valor,
    })
  }

  // Acessórios
  let acessorios: ParsedAcessorios | null = null
  const acSec = texto.match(/-?\s*ACESS[ÓO]RIOS([\s\S]*?)VALOR\s+R\$\s*([\d.]+,\d{2})/i)
  if (acSec) {
    const items = acSec[1].split('\n')
      .map(s => s.replace(/^[\-\s•·:]+/, '').trim())
      .filter(s => s.length > 3 && !/^valor/i.test(s))
    const valor = parseFloat(acSec[2].replace(/\./g, '').replace(',', '.'))
    acessorios = { items, valor }
  }

  // Motores
  const motores: ParsedMotor[] = []
  const MOT_RE = /-?\s*(\d+(?:[,.]?\d+)?)\s*CV\s+(\d+)\s*polos?\b[\s\S]{0,200}?R\$\s*([\d.]+,\d{2})/gi
  const seen = new Set<string>()
  let m2: RegExpExecArray | null
  while ((m2 = MOT_RE.exec(texto)) !== null) {
    const cv = parseFloat(m2[1].replace(',', '.'))
    const polos = parseInt(m2[2], 10)
    const valor = parseFloat(m2[3].replace(/\./g, '').replace(',', '.'))
    const key = `${cv}-${polos}-${valor}`
    if (seen.has(key)) continue
    seen.add(key)
    motores.push({ cv, polos, valor })
  }

  // Total
  const totaisMatches = [...texto.matchAll(/VALOR\s+TOTAL\s+(?:DA\s+PROPOSTA(?:\s+COM\s+MOTOR\s+NOVO)?|DE\s+EQUIPAMENTOS)\s+R\$\s*([\d.]+,\d{2})/gi)]
  const totalProposta = totaisMatches.length > 0
    ? parseFloat(totaisMatches[totaisMatches.length - 1][1].replace(/\./g, '').replace(',', '.'))
    : null

  const totalEquip = itens.reduce((s, i) => s + i.valor, 0) + (acessorios?.valor || 0)
  const totalMotores = motores.reduce((s, m) => s + m.valor, 0)

  return {
    itens,
    motores,
    acessorios,
    total_equipamentos: Math.round(totalEquip * 100) / 100,
    total_motores: Math.round(totalMotores * 100) / 100,
    total_proposta: totalProposta,
  }
}

export function slugifyModelo(s: string): string {
  return s.toLowerCase()
    .replace(/[áàâã]/g, 'a').replace(/[éèê]/g, 'e').replace(/[íì]/g, 'i')
    .replace(/[óòôõ]/g, 'o').replace(/[úù]/g, 'u').replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
