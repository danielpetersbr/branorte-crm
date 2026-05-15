// Smart parser de texto bagunçado → ClienteDados estruturado.
// Extrai nome, CPF/CNPJ, telefone, CEP, email, endereço, cidade, bairro, IE
// via regex pt-BR. Funciona offline, instantâneo, sem custo de API.
//
// Pra textos mais complexos (PDF de cadastro, nota fiscal scan), considere
// adicionar camada de IA depois — esse parser cobre ~80% dos casos comuns.

import type { ClienteDados } from '@/hooks/useOrcamentoBuilder'

export interface ParseResult {
  cliente_nome: string
  dados: ClienteDados
  // Campos não reconhecidos — vendedor pode ver e preencher manualmente
  naoReconhecido: string[]
}

const ESTADOS_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
]

function limpar(t: string): string {
  return t.replace(/\s+/g, ' ').trim()
}

function extrairCnpj(text: string): string | null {
  // 16.935.999/0001-09  ou  16935999000109
  const m = text.match(/(\d{2}[.\s]?\d{3}[.\s]?\d{3}\/?\d{4}[-\s]?\d{2})/)
  if (m) {
    const digits = m[1].replace(/\D/g, '')
    if (digits.length === 14) {
      return `${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`
    }
  }
  return null
}

function extrairCpf(text: string): string | null {
  // 123.456.789-01  ou  12345678901 (mas só se não for parte de CNPJ)
  const m = text.match(/(?<!\d)(\d{3}[.\s]?\d{3}[.\s]?\d{3}[-\s]?\d{2})(?!\d)/)
  if (m) {
    const digits = m[1].replace(/\D/g, '')
    if (digits.length === 11) {
      return `${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`
    }
  }
  return null
}

function extrairTelefone(text: string): string | null {
  // (48) 99999-9999, 48 99999-9999, 48999999999, +55 48 99999-9999
  const m = text.match(/(?:\+?55\s*)?\(?(\d{2})\)?\s*9?\s*(\d{4,5})[-\s]?(\d{4})/)
  if (m) {
    const ddd = m[1]
    const p1 = m[2]
    const p2 = m[3]
    return `(${ddd}) ${p1}-${p2}`
  }
  return null
}

function extrairCep(text: string): string | null {
  // 88890-000 ou 88890000
  const m = text.match(/(\d{5})[-\s]?(\d{3})(?!\d)/)
  if (m) return `${m[1]}-${m[2]}`
  return null
}

function extrairEmail(text: string): string | null {
  const m = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i)
  return m ? m[0] : null
}

function extrairIE(text: string): string | null {
  // I.E.: 256.847.320  ou  IE 256847320  (variável por estado)
  const m = text.match(/\b(?:I\s*\.?\s*E\s*\.?|inscri[çc][ãa]o\s+estadual)\s*:?\s*([\d.\-/]+)/i)
  if (m) {
    const v = m[1].trim()
    if (v.length >= 6) return v
  }
  return null
}

function extrairCidadeEstado(text: string): { cidade: string | null; estado: string | null } {
  // "Florianópolis - SC" / "Florianópolis/SC" / "Florianopolis SC"
  for (const uf of ESTADOS_BR) {
    const re = new RegExp(`([A-ZÁ-Üa-zá-ü\\s]{2,40}?)\\s*[-/]?\\s*${uf}\\b`, 'g')
    const m = re.exec(text)
    if (m) {
      const cidade = limpar(m[1])
      // Filtra falso positivo (ex: "ENDEREÇO XYZ - SC" → cidade seria "ENDEREÇO XYZ")
      if (cidade.length >= 3 && cidade.length <= 40 && !/CNPJ|CPF|RUA|AV\.|R\./i.test(cidade)) {
        return { cidade, estado: uf }
      }
    }
  }
  return { cidade: null, estado: null }
}

function extrairLabelado(text: string, labels: string[]): string | null {
  // Procura "Label: valor" ou "Label valor\n"
  for (const label of labels) {
    const re = new RegExp(`(?:^|\\n|\\s)${label}\\s*[:\\-]?\\s*([^\\n]+?)(?:\\n|$)`, 'i')
    const m = text.match(re)
    if (m) {
      const v = m[1].trim()
      if (v && v.length < 200) return v
    }
  }
  return null
}

function extrairNome(text: string, jaExtraido: Set<string>): string | null {
  // Tenta labels primeiro
  const labelado = extrairLabelado(text, [
    'nome\\s+do\\s+cliente', 'razão\\s+social', 'razao\\s+social',
    'cliente', 'nome', 'fantasia', 'empresa',
  ])
  if (labelado) return labelado

  // Senão pega a primeira linha que pareça nome (palavras capitalizadas, sem dígitos)
  for (const linha of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (jaExtraido.has(linha)) continue
    if (/\d/.test(linha)) continue
    if (linha.length < 3 || linha.length > 80) continue
    // Heurística: pelo menos 2 palavras, primeira letra maiúscula
    const palavras = linha.split(/\s+/)
    if (palavras.length < 2) continue
    if (!/^[A-ZÁ-Ü]/.test(palavras[0])) continue
    return linha
  }
  return null
}

function extrairEndereco(text: string): string | null {
  // Linha contendo "Rua", "Av.", "Avenida", "R.", "Rod." + texto
  const m = text.match(/(?:^|\n)\s*((?:rua|av\.?|avenida|r\.|rod\.?|rodovia|estrada|alameda|al\.?|travessa|trav\.?|praça)\s+[^\n,]+(?:,\s*\d+[^\n]*)?)/i)
  if (m) return limpar(m[1])
  return null
}

function extrairBairro(text: string): string | null {
  return extrairLabelado(text, ['bairro'])
}

function extrairAC(text: string): string | null {
  // "A/C: João" ou "AC João" ou "Aos cuidados de João"
  return extrairLabelado(text, ['a/c', 'aos\\s+cuidados\\s+de', 'aos\\s+cuidados', 'ac'])
}

export function parseClienteText(raw: string): ParseResult {
  const text = raw.trim()
  if (!text) {
    return { cliente_nome: '', dados: {}, naoReconhecido: [] }
  }

  const cnpj = extrairCnpj(text)
  const cpf = !cnpj ? extrairCpf(text) : null
  const fone = extrairTelefone(text)
  const cep = extrairCep(text)
  const email = extrairEmail(text)
  const ie = extrairIE(text)
  const { cidade } = extrairCidadeEstado(text)
  const endereco = extrairEndereco(text)
  const bairro = extrairBairro(text)
  const ac = extrairAC(text)

  // Marca o que já foi pego pra evitar usar como nome
  const jaExtraido = new Set<string>()
  if (cnpj) jaExtraido.add(cnpj)
  if (cpf) jaExtraido.add(cpf)
  if (fone) jaExtraido.add(fone)
  if (cep) jaExtraido.add(cep)
  if (email) jaExtraido.add(email)
  if (cidade) jaExtraido.add(cidade)
  if (endereco) jaExtraido.add(endereco)

  const nome = extrairNome(text, jaExtraido) ?? ''

  const dados: ClienteDados = {}
  if (ac) dados.ac = ac
  if (fone) dados.fone = fone
  if (cidade) dados.cidade = cidade
  if (bairro) dados.bairro = bairro
  if (endereco) dados.endereco = endereco
  if (cep) dados.cep = cep
  if (cnpj) dados.cnpj = cnpj
  else if (cpf) dados.cnpj = cpf  // ClienteDados tem só "cnpj", aceita CPF tb pra PF
  if (ie) dados.ie = ie
  if (email) dados.email = email

  // Linhas não reconhecidas (pra debug visual)
  const naoReconhecido: string[] = []
  for (const linha of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (linha === nome) continue
    if (jaExtraido.has(linha)) continue
    let reconhecido = false
    if (cnpj && linha.includes(cnpj.replace(/\D/g, ''))) reconhecido = true
    if (cnpj && linha.includes(cnpj)) reconhecido = true
    if (fone && linha.includes(fone)) reconhecido = true
    if (email && linha.includes(email)) reconhecido = true
    if (cep && linha.includes(cep)) reconhecido = true
    if (endereco && linha.includes(endereco)) reconhecido = true
    if (bairro && linha.toLowerCase().includes(bairro.toLowerCase())) reconhecido = true
    if (cidade && linha.toLowerCase().includes(cidade.toLowerCase())) reconhecido = true
    if (ie && linha.includes(ie)) reconhecido = true
    if (ac && linha.toLowerCase().includes(ac.toLowerCase())) reconhecido = true
    if (!reconhecido) naoReconhecido.push(linha)
  }

  return { cliente_nome: nome, dados, naoReconhecido }
}
