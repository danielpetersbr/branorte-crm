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

// Title Case respeitando regras pt-BR:
// - "FAZENDA SUSSUARANA" → "Fazenda Sussuarana"
// - "joão da silva" → "João da Silva" (preposições minúsculas no meio)
// - "RUA DAS FLORES, 123" → "Rua das Flores, 123" (números/pontuação mantidos)
// - "LTDA" → "Ltda" / "S.A." mantém
const PREPOSICOES_MINUSCULAS = new Set([
  'de', 'do', 'da', 'dos', 'das', 'e', 'o', 'a', 'em', 'na', 'no', 'nas', 'nos', 'para',
])
const SIGLAS_MAIUSCULAS = new Set([
  'SA', 'S.A.', 'EIRELI', 'ME', 'EPP', 'MEI', 'CIA', 'AS', 'ABNT', 'BR', 'BBA',
])
function titleCasePtBr(s: string): string {
  if (!s) return s
  // Se ja tem mistura de maiusculas/minusculas, presume que ja foi normalizado
  const letras = s.replace(/[^A-Za-zÀ-ÿ]/g, '')
  if (letras.length === 0) return s
  const upperCount = letras.replace(/[^A-ZÀ-Ý]/g, '').length
  const ratio = upperCount / letras.length
  // Se < 60% maiusculas, ja ta razoavel — nao mexe (preserva 'iPhone', 'McDonald')
  if (ratio < 0.6) return s

  return s
    .toLowerCase()
    .split(/(\s+|[,.])/)
    .map((tok, i, arr) => {
      if (/^\s+$/.test(tok) || /^[,.]$/.test(tok)) return tok
      const upper = tok.toUpperCase()
      if (SIGLAS_MAIUSCULAS.has(upper)) return upper
      // Preposicoes minusculas (so se NAO for a primeira palavra)
      const palavrasAntes = arr.slice(0, i).filter(t => !/^\s+$/.test(t) && !/^[,.]$/.test(t))
      if (palavrasAntes.length > 0 && PREPOSICOES_MINUSCULAS.has(tok)) return tok
      // Capitaliza
      return tok.charAt(0).toUpperCase() + tok.slice(1)
    })
    .join('')
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
  // (48) 99999-9999, 48 99999-9999, 48999999999, +55 48 99999-9999, 77 998382244
  // O 9 inicial do celular É parte do número, mantém na captura.
  const m = text.match(/(?:\+?55\s*)?\(?(\d{2})\)?\s*(9?\d{4,5})[-\s]?(\d{4})/)
  if (m) {
    const ddd = m[1]
    const p1 = m[2]
    const p2 = m[3]
    // Garante 5 dígitos no celular (DD 9XXXX-XXXX). Se vier "9838" + "2244" (8 dig só),
    // assume fixo "(DD) NNNN-NNNN". Senão "(DD) NNNNN-NNNN".
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

function extrairCidadeEstado(text: string): { cidade: string | null; estado: string | null; bairroSugerido: string | null } {
  // "Florianópolis - SC" / "Florianópolis/SC" / "Bairro - Cidade/UF" / "Zona Rural - Taguatinga/TO"
  for (const uf of ESTADOS_BR) {
    // Captura bairro opcional ANTES da cidade quando tem "Bairro - Cidade/UF"
    const reComBairro = new RegExp(`([A-ZÁ-Üa-zá-ü\\s]{3,40}?)\\s*[-]\\s*([A-ZÁ-Üa-zá-ü\\s]{3,40}?)\\s*[/]\\s*${uf}\\b`)
    const m1 = reComBairro.exec(text)
    if (m1) {
      const bairro = limpar(m1[1])
      const cidade = limpar(m1[2])
      if (bairro.length >= 3 && cidade.length >= 3 && !/CNPJ|CPF|RUA|AV\.|R\./i.test(cidade)) {
        return { cidade, estado: uf, bairroSugerido: bairro }
      }
    }
    // Fallback: só cidade/UF
    const re = new RegExp(`([A-ZÁ-Üa-zá-ü\\s]{2,40}?)\\s*[-/]?\\s*${uf}\\b`)
    const m = re.exec(text)
    if (m) {
      const cidade = limpar(m[1])
      if (cidade.length >= 3 && cidade.length <= 40 && !/CNPJ|CPF|RUA|AV\.|R\./i.test(cidade)) {
        return { cidade, estado: uf, bairroSugerido: null }
      }
    }
  }
  return { cidade: null, estado: null, bairroSugerido: null }
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

// Retorna nome + A/C (proprietário/responsável).
// Caso comum: empresa/fazenda ALL CAPS + nome próprio Mixed Case
// Ex: "FAZENDA SUSSUARANA\nRógeris Pedrazzi" → nome=FAZENDA, ac=Rógeris
function extrairNomeEAC(text: string, jaExtraido: Set<string>): { nome: string | null; acSugerido: string | null } {
  // Tenta labels primeiro
  const labelado = extrairLabelado(text, [
    'nome\\s+do\\s+cliente', 'razão\\s+social', 'razao\\s+social',
    'cliente', 'nome', 'fantasia', 'empresa',
  ])

  // Coleta TODAS as linhas candidatas a nome (sem dígitos, capitalizadas, sem labels)
  const candidatos: string[] = []
  for (const linha of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    if (jaExtraido.has(linha)) continue
    if (/\d/.test(linha)) continue
    if (linha.length < 3 || linha.length > 80) continue
    // Pula linhas que parecem labels com valor (com ":")
    if (/^[A-Za-zÀ-ÿ\s]+:\s*$/.test(linha)) continue
    if (/^(endere[çc]o|telefone|fone|email|e-mail|cep|cnpj|cpf|i\.?e\.?|inscri[çc][ãa]o)\s*[:.]?\s*$/i.test(linha)) continue
    // Pelo menos 2 palavras, primeira letra maiúscula
    const palavras = linha.split(/\s+/)
    if (palavras.length < 2) continue
    if (!/^[A-ZÁ-Ü]/.test(palavras[0])) continue
    candidatos.push(linha)
  }

  if (labelado && !candidatos.length) return { nome: labelado, acSugerido: null }

  if (candidatos.length === 0) return { nome: labelado, acSugerido: null }
  if (candidatos.length === 1) return { nome: labelado ?? candidatos[0], acSugerido: null }

  // 2+ candidatos: detecta padrão EMPRESA (ALL CAPS ou tem "FAZENDA"/"SITIO"/"LTDA"…) vs PESSOA (Mixed Case)
  const isEmpresa = (s: string) => {
    if (/\b(LTDA|S\.?A\.?|ME|EIRELI|EPP|FAZENDA|SITIO|S[ÍI]TIO|GRANJA|AGROPECU[ÁA]RIA|COMERCIO|COM[ÉE]RCIO|IND[ÚU]STRIA|INDUSTRIAL)\b/i.test(s)) return true
    // Heurística: maioria das letras é uppercase → empresa
    const letras = s.replace(/[^A-Za-zÀ-ÿ]/g, '')
    if (!letras) return false
    const upper = letras.replace(/[^A-ZÁ-Ü]/g, '').length
    return upper / letras.length > 0.7
  }

  const primeira = candidatos[0]
  const segunda = candidatos[1]
  if (isEmpresa(primeira) && !isEmpresa(segunda)) {
    // Empresa primeiro, proprietário depois
    return { nome: primeira, acSugerido: segunda }
  }
  if (!isEmpresa(primeira) && isEmpresa(segunda)) {
    return { nome: segunda, acSugerido: primeira }
  }
  // Ambíguo: fica com label se houver, senão primeira linha
  return { nome: labelado ?? primeira, acSugerido: candidatos[1] }
}

function extrairEndereco(text: string): string | null {
  // Tenta label "Endereço:" primeiro — captura tudo até ENTER (linha inteira)
  const labelado = extrairLabelado(text, ['endere[çc]o', 'logradouro'])
  if (labelado) return labelado
  // Senão linha contendo "Rua", "Av.", "Avenida", "R.", "Rod." + texto
  const m = text.match(/(?:^|\n)\s*((?:rua|av\.?|avenida|r\.|rod\.?|rodovia|estrada|alameda|al\.?|travessa|trav\.?|praça)\s+[^\n]+)/i)
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
  const { cidade: cidadeRaw, estado, bairroSugerido } = extrairCidadeEstado(text)
  const enderecoRaw = extrairEndereco(text)
  const bairroLabel = extrairBairro(text)
  const bairroRaw = bairroLabel ?? bairroSugerido
  const acLabel = extrairAC(text)

  // Normaliza casing (CAPS → Title Case)
  const cidade = cidadeRaw ? titleCasePtBr(cidadeRaw) : null
  const endereco = enderecoRaw ? titleCasePtBr(enderecoRaw) : null
  const bairro = bairroRaw ? titleCasePtBr(bairroRaw) : null
  const uf = estado // ja vem em UPPER (SC, TO, etc)

  // Marca o que já foi pego pra evitar usar como nome
  const jaExtraido = new Set<string>()
  if (cnpj) jaExtraido.add(cnpj)
  if (cpf) jaExtraido.add(cpf)
  if (fone) jaExtraido.add(fone)
  if (cep) jaExtraido.add(cep)
  if (email) jaExtraido.add(email)
  if (cidade) jaExtraido.add(cidade)
  if (endereco) jaExtraido.add(endereco)

  const { nome: nomeRaw, acSugerido } = extrairNomeEAC(text, jaExtraido)
  const nome = titleCasePtBr(nomeRaw ?? '')
  const acRaw = acLabel ?? acSugerido
  const ac = acRaw ? titleCasePtBr(acRaw) : null

  const dados: ClienteDados = {}
  if (ac) dados.ac = ac
  if (fone) dados.fone = fone
  if (cidade) dados.cidade = cidade
  if (uf) dados.uf = uf
  if (bairro) dados.bairro = bairro
  if (endereco) dados.endereco = endereco
  if (cep) dados.cep = cep
  if (cnpj) dados.cnpj = cnpj
  else if (cpf) dados.cnpj = cpf
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
