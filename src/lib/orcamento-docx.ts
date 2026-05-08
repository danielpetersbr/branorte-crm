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
  forma_pagamento?: string | null  // ex: "À vista 5% desconto" — substitui "a combinar"
  prazo_entrega?: string | null    // override do default "90 dias (úteis)"
  data_venda?: string | null       // ex: "15/05/2026" — substitui "Data da venda – a combinar"
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

// Substitui ORÇAMENTO N° YYYY - NNNN — número fica quebrado em 2-3 runs
// no Word (ex: "ORÇAMENTO N° 202" + "5" + " – 0000   "). Estratégia:
// 1) Substitui "ORÇAMENTO N° 202" por "ORÇAMENTO N° {NUMERO}"
// 2) Limpa runs seguintes que tem "5" sozinho ou "– 0000" preservando os espaços
function substituirNumero(xml: string, numero: string): string {
  const escaped = xmlEscape(numero)
  let out = xml

  // Caso "tudo num run só" (templates simples)
  const reFull = /(<w:t(?:\s[^>]*)?>)([^<]*?ORÇAMENTO\s+N[°º]\s+)(202[0-9]\s*[\-–—]\s*[0-9]{1,4})([^<]*?)(<\/w:t>)/i
  if (reFull.test(out)) {
    return out.replace(reFull, (_m, openT, prefix, _oldNum, suffix, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${suffix}${closeT}`
    })
  }

  // Caso "número quebrado em runs" (Word real)
  // Step 1: <w:t>ORÇAMENTO N° 202</w:t> → <w:t>ORÇAMENTO N° {NUMERO_COMPLETO}</w:t>
  // Captura o início e troca pelo número completo
  out = out.replace(
    /(<w:t(?:\s[^>]*)?>)([^<]*?ORÇAMENTO\s+N[°º]\s+)202([0-9]?)(<\/w:t>)/i,
    (_m, openT, prefix, _digit, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${closeT}`
    },
  )

  // Step 2: zera o run isolado que tinha o último dígito do ano (ex: "5" sozinho)
  // Match conservador: <w:t>UM_DIGITO</w:t> imediatamente após posição do número
  // Identificamos pela proximidade ao "ORÇAMENTO" — limita a 200 chars depois
  const idxOrc = out.indexOf(escaped)
  if (idxOrc !== -1) {
    const before = out.slice(0, idxOrc + escaped.length + 50)
    const tail = out.slice(idxOrc + escaped.length + 50)
    const tailFixed = tail
      // Run "<w:t>5</w:t>" ou similar com 1 digito
      .replace(/^([\s\S]{0,400}?)(<w:t(?:\s[^>]*)?>[0-9]<\/w:t>)/, (_m, pre, _run) => {
        return pre + '<w:t></w:t>'
      })
      // Run "<w:t> – 0000   ...</w:t>" → "<w:t>   ...</w:t>" (mantém espaços p/ alinhamento)
      .replace(
        /(<w:t(?:\s[^>]*)?>)([^<]*?[\-–—]\s*0{2,4})([^<]*?)(<\/w:t>)/i,
        (_m, openT, _numPart, suffix, closeT) => {
          const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
          return `${open}${suffix}${closeT}`
        },
      )
    out = before + tailFixed
  }

  return out
}

// Substitui "Data da venda – a combinar" por data real
function substituirDataVenda(xml: string, valor: string): string {
  if (!valor) return xml
  const escaped = xmlEscape(valor)
  const re = /(<w:t(?:\s[^>]*)?>)([^<]*?[Dd]ata\s+da\s+venda\s*[\-–—]\s*)(a\s+combinar)([^<]*?)(<\/w:t>)/i
  if (re.test(xml)) {
    return xml.replace(re, (_m, openT, prefix, _old, suffix, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${suffix}${closeT}`
    })
  }
  // Fallback: procura "a combinar" perto de "Data da venda"
  const idx = xml.search(/Data\s+da\s+venda/i)
  if (idx >= 0) {
    const tail = xml.slice(idx)
    const replaced = tail.replace(
      /(<w:t(?:\s[^>]*)?>)([^<]*?)(a\s+combinar)([^<]*?)(<\/w:t>)/i,
      (_m, openT, prefix, _old, suffix, closeT) => {
        const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
        return `${open}${prefix}${escaped}${suffix}${closeT}`
      },
    )
    return xml.slice(0, idx) + replaced
  }
  return xml
}

// Substitui "Forma de pagamento – a combinar" por valor real
// O texto pode estar quebrado em runs (Word). Estratégia:
// match flexível em qualquer <w:t> que contenha "Forma de pagamento" + "combinar"
function substituirFormaPagamento(xml: string, valor: string): string {
  if (!valor) return xml
  const escaped = xmlEscape(valor)
  // Caso 1: tudo num run só
  const re1 = /(<w:t(?:\s[^>]*)?>)([^<]*?[Ff]orma\s+de\s+pagamento\s*[\-–—]\s*)(a\s+combinar)([^<]*?)(<\/w:t>)/i
  if (re1.test(xml)) {
    return xml.replace(re1, (_m, openT, prefix, _old, suffix, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${suffix}${closeT}`
    })
  }
  // Caso 2: só substitui "a combinar" próximo de "Forma de pagamento"
  const idxFP = xml.search(/Forma\s+de\s+pagamento/i)
  if (idxFP >= 0) {
    const tail = xml.slice(idxFP)
    const replaced = tail.replace(
      /(<w:t(?:\s[^>]*)?>)([^<]*?)(a\s+combinar)([^<]*?)(<\/w:t>)/i,
      (_m, openT, prefix, _old, suffix, closeT) => {
        const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
        return `${open}${prefix}${escaped}${suffix}${closeT}`
      },
    )
    return xml.slice(0, idxFP) + replaced
  }
  return xml
}

// Substitui prazo de entrega (default "90 dias (úteis)")
function substituirPrazoEntrega(xml: string, valor: string): string {
  if (!valor) return xml
  const escaped = xmlEscape(valor)
  const re = /(<w:t(?:\s[^>]*)?>)([^<]*?[Pp]razo\s+de\s+entrega\s*[\-–—]\s*)(90\s+dias\s*\([úu]teis\))([^<]*?)(<\/w:t>)/i
  if (re.test(xml)) {
    return xml.replace(re, (_m, openT, prefix, _old, suffix, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${suffix}${closeT}`
    })
  }
  // Fallback: procura "90 dias" perto de "Prazo de entrega"
  const idx = xml.search(/Prazo\s+de\s+entrega/i)
  if (idx >= 0) {
    const tail = xml.slice(idx)
    const replaced = tail.replace(
      /(<w:t(?:\s[^>]*)?>)([^<]*?)(90\s+dias\s*\([úu]teis\)|90\s+dias)([^<]*?)(<\/w:t>)/i,
      (_m, openT, prefix, _old, suffix, closeT) => {
        const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
        return `${open}${prefix}${escaped}${suffix}${closeT}`
      },
    )
    return xml.slice(0, idx) + replaced
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
  if (input.forma_pagamento) xml = substituirFormaPagamento(xml, input.forma_pagamento)
  if (input.prazo_entrega)   xml = substituirPrazoEntrega(xml, input.prazo_entrega)
  if (input.data_venda)      xml = substituirDataVenda(xml, input.data_venda)
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
