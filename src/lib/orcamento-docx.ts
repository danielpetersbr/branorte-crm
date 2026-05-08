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
// no Word (ex: "ORÇAMENTO N° 202" + "5" + " – 0000   "). Estratégia robusta:
// 1) Acha range [ORÇAMENTO ... DATA:] no XML
// 2) Substitui texto do PRIMEIRO <w:t> contendo "ORÇAMENTO" pelo número completo
// 3) Limpa TUDO o que sobrar de número (single digits, "– 0000") nos runs seguintes
//    até DATA: — preserva os espaços de alinhamento
function substituirNumero(xml: string, numero: string): string {
  const escaped = xmlEscape(numero)

  // Acha primeiro <w:t> que contem ORÇAMENTO
  const orcRunRe = /<w:t(?:\s[^>]*)?>[^<]*?ORÇAMENTO\s+N[°º]\s+202[0-9]?[^<]*?<\/w:t>/i
  const orcMatch = orcRunRe.exec(xml)
  if (!orcMatch) {
    // Fallback simples — só tenta substituir num run só
    return xml.replace(
      /(<w:t(?:\s[^>]*)?>)([^<]*?ORÇAMENTO\s+N[°º]\s+)(202[0-9]\s*[\-–—]\s*[0-9]{1,4})([^<]*?)(<\/w:t>)/i,
      (_m, openT, prefix, _oldNum, suffix, closeT) => {
        const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
        return `${open}${prefix}${escaped}${suffix}${closeT}`
      },
    )
  }

  const startIdx = orcMatch.index
  const orcRunEnd = startIdx + orcMatch[0].length

  // Acha "DATA:" depois — define limite do range a limpar
  const dataIdx = xml.indexOf('DATA', orcRunEnd)
  const cutoff = dataIdx > 0 && dataIdx - orcRunEnd < 4000 ? dataIdx : orcRunEnd + 2000

  // Step 1: substitui texto do primeiro run pelo número completo
  const orcRunNova = orcMatch[0].replace(
    /(<w:t(?:\s[^>]*)?>)([^<]*?ORÇAMENTO\s+N[°º]\s+)(202[0-9]?)([^<]*?)(<\/w:t>)/i,
    (_m, openT, prefix, _digits, suffix, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${prefix}${escaped}${suffix}${closeT}`
    },
  )

  // Step 2: no intervalo entre fim do run de ORÇAMENTO e DATA:, limpa residuos
  const intervalo = xml.slice(orcRunEnd, cutoff)
  const intervaloLimpo = intervalo
    // Run com 1 digito sozinho (último dígito do ano em run separado)
    .replace(/<w:t(\s[^>]*)?>[0-9]<\/w:t>/g, (_m, attrs) => `<w:t${attrs || ''}></w:t>`)
    // Run com "– 0000" / "- 0000" tudo junto (zeros do placeholder) — preserva espaços
    .replace(
      /(<w:t(?:\s[^>]*)?>)([^<]*?)([\-–—]\s*0{2,5})([^<]*?)(<\/w:t>)/g,
      (_m, openT, prefixSpaces, _dashZeros, suffixSpaces, closeT) => {
        const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
        return `${open}${prefixSpaces}${suffixSpaces}${closeT}`
      },
    )
    // Runs com APENAS "0000" (sem dash)
    .replace(
      /(<w:t(?:\s[^>]*)?>)([^<]*?)(0{3,5})([^<]*?)(<\/w:t>)/g,
      (m, openT, prefixSpaces, _zeros, suffixSpaces, closeT) => {
        if (/[0-9]/.test(prefixSpaces) || /[0-9]/.test(suffixSpaces)) return m
        const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
        return `${open}${prefixSpaces}${suffixSpaces}${closeT}`
      },
    )
    // Runs com APENAS dash residual (ex: "<w:t> – </w:t>") — remove o dash, mantem espaços
    .replace(
      /(<w:t(?:\s[^>]*)?>)([^<\d\w]*?)([\-–—])([^<\d\w]*?)(<\/w:t>)/g,
      (m, openT, prefix, _dash, suffix, closeT) => {
        // Só limpa se NAO houver letras/digitos antes ou depois (= dash isolado)
        // Garantia extra: o conteudo total nao pode ter palavra util
        const conteudoSemDash = (prefix + suffix).trim()
        if (conteudoSemDash.length > 0) return m  // tem outra coisa, deixa
        const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
        return `${open}${prefix}${suffix}${closeT}`
      },
    )

  return xml.slice(0, startIdx) + orcRunNova + intervaloLimpo + xml.slice(cutoff)
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

// Compacta whitespace exagerada na linha do cabecalho (CLIENTE/A/C/FONE).
// Os templates Branorte tem 80+ espaços de "alinhamento" entre os labels que,
// quando os valores sao preenchidos, fazem a linha exceder a largura da pagina
// e o Word quebra "FONE: 48998313374" deixando o numero numa linha separada.
//
// Solucao: encontra o paragrafo que tem CLIENTE: + FONE: e substitui whitespace
// runs com >12 chars por exatamente 4 espacos (mantem separacao visual sem
// estourar a largura).
function compactarHeaderCliente(xml: string): string {
  const pRe = /<w:p[^>]*>(?:(?:(?!<\/w:p>)[\s\S])*?CLIENTE:(?:(?!<\/w:p>)[\s\S])*?FONE:(?:(?!<\/w:p>)[\s\S])*?)<\/w:p>/i
  const match = pRe.exec(xml)
  if (!match) return xml

  const compactado = match[0].replace(
    /(<w:t(?:\s[^>]*)?>)(\s{12,})(<\/w:t>)/g,
    (_m, openT, _ws, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}    ${closeT}`  // 4 espaços de separação
    },
  )
  return xml.slice(0, match.index) + compactado + xml.slice(match.index + match[0].length)
}

// Preenche o nome do cliente na assinatura (lado direito, ao lado de "Metalúrgica BBA LTDA")
// IMPORTANTE: precisa pegar a ULTIMA ocorrencia de BBA+LTDA (a assinatura no fim do doc),
// nao a primeira (que é "BRANORTE - Metalúrgica BBA Ltda" na secao DADOS DO FABRICANTE).
function preencherAssinaturaCliente(xml: string, cliente: string): string {
  if (!cliente) return xml
  const escaped = xmlEscape(cliente.toUpperCase().slice(0, 60))

  // Busca todas as ocorrencias de BBA + LTDA proximas (assinatura é a ultima)
  // Pattern flexivel: aceita "BBA" + ate 50 chars (whitespace + tags) + "LTDA"
  const pairRe = /<w:t(?:\s[^>]*)?>[^<]*?BBA\s*<\/w:t>(?:[\s\S]{0,200}?)<w:t(?:\s[^>]*)?>[^<]*?LTDA[^<]*?<\/w:t>/gi
  const todas = [...xml.matchAll(pairRe)]
  if (todas.length === 0) return xml

  // Pega a ULTIMA (= assinatura, a primeira é DADOS DO FABRICANTE)
  const ultima = todas[todas.length - 1]
  const afterLtda = (ultima.index ?? 0) + ultima[0].length

  // Acha o fim do paragrafo da assinatura
  const endP = xml.indexOf('</w:p>', afterLtda)
  if (endP < 0 || endP - afterLtda > 3000) return xml

  const between = xml.slice(afterLtda, endP)

  // Acha a ULTIMA run com APENAS whitespace dentro do paragrafo
  const wsRuns: { index: number; full: string; ws: string }[] = []
  const wsRe = /<w:t(?:\s[^>]*)?>(\s+)<\/w:t>/g
  let m
  while ((m = wsRe.exec(between)) !== null) {
    wsRuns.push({ index: m.index, full: m[0], ws: m[1] })
  }
  if (wsRuns.length === 0) return xml

  const lastWs = wsRuns[wsRuns.length - 1]
  const total = lastWs.ws.length
  const left = Math.max(1, Math.floor((total - escaped.length) / 2))
  const right = Math.max(1, total - escaped.length - left)
  const novoConteudo = ' '.repeat(left) + escaped + ' '.repeat(right)
  const newWsRun = lastWs.full.replace(
    /(<w:t(?:\s[^>]*)?>)(\s+)(<\/w:t>)/,
    (_m, openT, _ws, closeT) => {
      const open = openT.includes('xml:space') ? openT : openT.replace('<w:t', '<w:t xml:space="preserve"')
      return `${open}${novoConteudo}${closeT}`
    },
  )
  const betweenNovo = between.slice(0, lastWs.index) + newWsRun + between.slice(lastWs.index + lastWs.full.length)
  return xml.slice(0, afterLtda) + betweenNovo + xml.slice(endP)
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
  xml = preencherAssinaturaCliente(xml, input.cliente_nome)
  // Compacta whitespace exagerada antes de preencher CLIENTE/A/C/FONE (evita line wrap)
  xml = compactarHeaderCliente(xml)
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

// Helpers pra montar nome de arquivo + .txt note
export function nomeBaseArquivo(input: { numero: string; cliente_nome: string; modelo_basename?: string | null; voltagem?: string }): string {
  const safeNome = input.cliente_nome.replace(/[^a-zA-Z0-9À-ÿ ]/g, '').trim().slice(0, 60)
  // Padrão Branorte: "2026 - 0686 - Cliente (Compacta XX) trifásico"
  let base = `${input.numero} - ${safeNome || 'cliente'}`
  if (input.modelo_basename) {
    // modelo_basename já tem "(Compacta 01 - ...) trifásico"
    base += ` ${input.modelo_basename.replace(/[\\/:*?"<>|]/g, '').trim()}`
  }
  return base.slice(0, 180)  // limite seguro pra Windows
}

export function montarNotaTxt(vendedor: string, data: Date): string {
  // Padrão observado: "Gustavo envio para o cliente dia 04/05/2026"
  const dia = String(data.getDate()).padStart(2, '0')
  const mes = String(data.getMonth() + 1).padStart(2, '0')
  const ano = data.getFullYear()
  const nomeBonito = vendedor.charAt(0).toUpperCase() + vendedor.slice(1).toLowerCase()
  return `${nomeBonito} envio para o cliente dia ${dia}/${mes}/${ano}`
}
