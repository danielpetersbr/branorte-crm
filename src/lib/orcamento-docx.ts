// Gera orçamento .docx PARTINDO DO TEMPLATE Branorte original.
// Estratégia: baixa o .docx do Supabase Storage, faz string-replacement
// na document.xml interna pra preencher os campos vazios (CLIENTE, A/C,
// FONE, CIDADE, etc.) e devolve o blob pra download.
//
// Resultado: arquivo IDÊNTICO ao .docx oficial — sem reconstrução, sem
// perda de formatação, fontes, imagens ou layouts.

import PizZip from 'pizzip'
import { supabase } from '@/lib/supabase'
import type { ClienteDados } from '@/hooks/useOrcamentoBuilder'

const BUCKET = 'orcamento-templates'

interface DocxInput {
  template_path: string          // ex: 'v1/compacta-01-100500-trifasico.docx'
  numero: string                 // ex: '2026 - 0691'
  data: string                   // dd/mm/yyyy
  cliente_nome: string
  cliente_dados: ClienteDados
}

// Escapa pra XML (& < > " ')
function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// Substitui placeholder dentro do document.xml.
// Estratégia: encontra `<w:t...>LABEL<\/w:t>` e injeta o valor logo depois,
// dentro de um novo run identico ao anterior. Como os campos do template
// estão vazios (CLIENTE: ___), basta concatenar o valor na string do label.
function preencherCampo(xml: string, label: string, valor: string): string {
  if (!valor) return xml
  const escaped = xmlEscape(valor)
  // Padrão: <w:t xml:space="preserve">LABEL: <\/w:t>  → injeta valor no proximo run vazio
  // OU: <w:t>LABEL:<\/w:t>...<w:t><\/w:t> → preenche o w:t vazio que vier depois
  // Estratégia simplificada: tenta substituir "LABEL: " seguido de <\/w:t> ou whitespace
  // por "LABEL: VALOR" preservando o resto do XML.
  // Match flexível: "LABEL:" seguido por qualquer combinação de espaços e tab até o <\/w:t>
  const labelEsc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  // Caso 1: "<w:t...>LABEL: <\/w:t>" (label tem trailing spaces)
  const re1 = new RegExp(
    `(<w:t(?:\\s[^>]*)?>)([^<]*?${labelEsc})(\\s*)(<\/w:t>)`,
    'i',
  )
  if (re1.test(xml)) {
    return xml.replace(re1, (_m, openT, before, _spaces, closeT) => {
      // Mantem o conteudo + adiciona valor (com space preservado)
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${before} ${escaped}${closeT}`
    })
  }
  return xml
}

// Substitui ORÇAMENTO N° YYYY - NNNN com novo número
function substituirNumero(xml: string, numero: string): string {
  const escaped = xmlEscape(numero)
  // Match flexível: "ORÇAMENTO N°" + qualquer texto até "<\/w:t>" (ou pode estar quebrado em runs)
  // Caso 1: tudo em 1 run: <w:t>ORÇAMENTO N° 2025 - 0000<\/w:t>
  const re1 = /(<w:t(?:\s[^>]*)?>)([^<]*?ORÇAMENTO\s+N[°º]\s+)([0-9]{4}\s*[\-–—]\s*[0-9]{1,4})(\s*<\/w:t>)/i
  if (re1.test(xml)) {
    return xml.replace(re1, (_m, openT, prefix, _oldNum, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${closeT}`
    })
  }
  // Caso 2: número quebrado em runs separados (mais comum no Word real)
  // Tenta substituir só o "2025 - 0000" onde quer que esteja
  const re2 = /(<w:t(?:\s[^>]*)?>)\s*(202[0-9]\s*[\-–—]\s*[0-9]{4})\s*(<\/w:t>)/i
  if (re2.test(xml)) {
    return xml.replace(re2, (_m, openT, _old, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${escaped}${closeT}`
    })
  }
  return xml
}

// Substitui DATA: ___ por DATA: dd/mm/yyyy
function substituirData(xml: string, data: string): string {
  const escaped = xmlEscape(data)
  const re = /(<w:t(?:\s[^>]*)?>)([^<]*?DATA:\s*)(\s*)(<\/w:t>)/i
  if (re.test(xml)) {
    return xml.replace(re, (_m, openT, prefix, _spaces, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${closeT}`
    })
  }
  return xml
}

export async function gerarOrcamentoDocx(input: DocxInput): Promise<Blob> {
  // 1) Baixa template do Supabase Storage
  const { data: blob, error } = await supabase.storage
    .from(BUCKET)
    .download(input.template_path)
  if (error) throw new Error(`Falha baixando template: ${error.message}`)
  if (!blob) throw new Error('Template não encontrado no bucket')

  const arrayBuffer = await blob.arrayBuffer()

  // 2) Abre o .docx (zip)
  const zip = new PizZip(arrayBuffer)
  const docXmlFile = zip.file('word/document.xml')
  if (!docXmlFile) throw new Error('document.xml não encontrado no .docx')

  let xml = docXmlFile.asText()

  // 3) Substitui campos
  xml = substituirNumero(xml, input.numero)
  xml = substituirData(xml, input.data)
  xml = preencherCampo(xml, 'CLIENTE:', input.cliente_nome)

  const c = input.cliente_dados
  if (c.ac)       xml = preencherCampo(xml, 'A/C:',      c.ac)
  if (c.fone)     xml = preencherCampo(xml, 'FONE:',     c.fone)
  if (c.cidade)   xml = preencherCampo(xml, 'CIDADE:',   c.cidade)
  if (c.bairro)   xml = preencherCampo(xml, 'BAIRRO:',   c.bairro)
  if (c.endereco) xml = preencherCampo(xml, 'ENDEREÇO:', c.endereco)
  if (c.cep)      xml = preencherCampo(xml, 'CEP:',      c.cep)
  if (c.cnpj)     xml = preencherCampo(xml, 'CPF/CNPJ:', c.cnpj)
  if (c.ie)       xml = preencherCampo(xml, 'I.E.:',     c.ie)
  if (c.email)    xml = preencherCampo(xml, 'E-MAIL:',   c.email)

  // 4) Reescreve document.xml e gera novo .docx
  zip.file('word/document.xml', xml)
  const out = zip.generate({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  })

  return out
}

export async function baixarOrcamentoDocx(input: DocxInput): Promise<void> {
  const blob = await gerarOrcamentoDocx(input)
  const safeNome = input.cliente_nome.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 50).trim()
  const filename = `${input.numero} - ${safeNome || 'orcamento'}.docx`

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
