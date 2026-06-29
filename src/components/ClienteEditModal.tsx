import { useEffect, useState } from 'react'
import { X, Search, Loader2, Check, Building2, User, Tractor, ClipboardPaste } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import type { PreviewClienteDados } from './OrcamentoPreview'
import { parseClienteText, titleCasePtBr } from '@/lib/parse-cliente-text'
import { supabase } from '@/lib/supabase'

interface Props {
  open: boolean
  cliente: PreviewClienteDados
  onClose: () => void
  onSave: (dados: PreviewClienteDados) => void
}

// Limpa CNPJ/CPF: só dígitos
function somenteDigitos(v: string): string {
  return v.replace(/\D/g, '')
}

// Formata CNPJ: 12.345.678/0001-99
function fmtCnpj(v: string): string {
  const d = somenteDigitos(v)
  if (d.length <= 2) return d
  if (d.length <= 5) return `${d.slice(0, 2)}.${d.slice(2)}`
  if (d.length <= 8) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5)}`
  if (d.length <= 12) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8)}`
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`
}

// Formata CPF: 123.456.789-01
function fmtCpf(v: string): string {
  const d = somenteDigitos(v)
  if (d.length <= 3) return d
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9, 11)}`
}

// Formata CNPJ ou CPF baseado no tamanho
function fmtDocumento(v: string): string {
  const d = somenteDigitos(v)
  if (d.length <= 11) return fmtCpf(v)
  return fmtCnpj(v)
}

// Formata telefone: (48) 99999-9999
function fmtFone(v: string): string {
  const d = somenteDigitos(v)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}

// Formata CEP: 88890-000
function fmtCep(v: string): string {
  const d = somenteDigitos(v)
  if (d.length <= 5) return d
  return `${d.slice(0, 5)}-${d.slice(5, 8)}`
}

// Capitaliza texto que vem TUDO EM MAIÚSCULA da Receita Federal
// "RIO PEQUENO" → "Rio Pequeno", "BRA NORTE" → "Bra Norte"
const LOWERCASE_WORDS = new Set(['de', 'do', 'da', 'dos', 'das', 'e', 'em', 'com'])
function titleCase(s: string): string {
  if (!s) return s
  return s.toLowerCase().split(' ').map((w, i) =>
    i > 0 && LOWERCASE_WORDS.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)
  ).join(' ')
}

interface BrasilApiCnpj {
  razao_social: string
  nome_fantasia: string
  descricao_tipo_de_logradouro?: string
  logradouro: string
  numero: string
  complemento: string
  bairro: string
  municipio: string
  uf: string
  cep: string
  ddd_telefone_1: string
  email: string
}

async function buscarCnpj(cnpj: string): Promise<BrasilApiCnpj | null> {
  const d = somenteDigitos(cnpj)
  if (d.length !== 14) return null
  try {
    const res = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${d}`)
    if (!res.ok) return null
    return await res.json() as BrasilApiCnpj
  } catch {
    return null
  }
}

// CPF lookup via cpfcnpj.com.br
// CPF lookup via cpfcnpj.com.br
// Pacotes: 1=nome, 2=nome+nasc+mae, 3+=endereço (precisa créditos pagos)
const CPFCNPJ_TOKEN = '670696c045158c1b8fd7e158bc13adcb'
const CPFCNPJ_PACOTE = '2' // nome + nascimento + mãe + gênero

interface CpfCnpjResult {
  status: number
  cpf: string
  nome: string
  nascimento: string
  endereco?: string
  numero?: string
  complemento?: string
  bairro?: string
  cep?: string
  cidade?: string
  uf?: string
  mae?: string
  genero?: string
  situacao?: string
  telefones?: string[]
  emails?: string[]
  saldo: number
  erro?: string
}

async function buscarCpf(cpf: string): Promise<CpfCnpjResult | null> {
  const d = somenteDigitos(cpf)
  if (d.length !== 11) return null
  try {
    const res = await fetch(`https://api.cpfcnpj.com.br/${CPFCNPJ_TOKEN}/${CPFCNPJ_PACOTE}/${d}`)
    if (!res.ok) return null
    const data = await res.json() as CpfCnpjResult
    if (!data.status || !data.nome) {
      // Se créditos insuficientes, tentar pacote 1 (mais barato)
      if (data.erro?.includes('insuficientes')) {
        const res2 = await fetch(`https://api.cpfcnpj.com.br/${CPFCNPJ_TOKEN}/1/${d}`)
        if (!res2.ok) return null
        const data2 = await res2.json() as CpfCnpjResult
        if (!data2.status || !data2.nome) return null
        return data2
      }
      return null
    }
    return data
  } catch {
    return null
  }
}

interface ViaCep {
  logradouro: string
  bairro: string
  localidade: string
  uf: string
}

async function buscarCep(cep: string): Promise<ViaCep | null> {
  const d = somenteDigitos(cep)
  if (d.length !== 8) return null
  try {
    const res = await fetch(`https://viacep.com.br/ws/${d}/json/`)
    if (!res.ok) return null
    const data = await res.json()
    if (data.erro) return null
    return data as ViaCep
  } catch {
    return null
  }
}

// Resultado normalizado da consulta de IE/Sintegra (espelha api/_lib/sintegra-client.ts)
interface SintegraApiResult {
  razao_social: string | null
  ie: string | null
  ie_uf: string | null
  situacao: string | null
  situacao_data: string | null
  endereco: string | null
  bairro: string | null
  municipio: string | null
  uf: string | null
  cep: string | null
}

interface SintegraApiResponse {
  ok: boolean
  resultado?: SintegraApiResult
  error?: string
  configurado?: boolean
}

// Consulta IE/Sintegra via função serverless /api/buscar-sintegra (esconde os tokens).
// Retorna null em falha de rede; nunca lança (o chamador trata o resultado).
async function buscarSintegra(params: {
  documento: string
  tipo: 'cnpj' | 'cpf' | 'ie'
  uf?: string
}): Promise<SintegraApiResponse | null> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const token = sess.session?.access_token
    const res = await fetch('/api/buscar-sintegra', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(params),
    })
    if (!res.ok) return null
    return (await res.json()) as SintegraApiResponse
  } catch {
    return null
  }
}

export function ClienteEditModal({ open, cliente, onClose, onSave }: Props) {
  const [nome, setNome] = useState('')
  const [ac, setAc] = useState('')
  const [fone, setFone] = useState('')
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState('')
  const [bairro, setBairro] = useState('')
  const [endereco, setEndereco] = useState('')
  const [cep, setCep] = useState('')
  const [cnpj, setCnpj] = useState('')
  const [ie, setIe] = useState('')
  const [email, setEmail] = useState('')

  const [buscando, setBuscando] = useState(false)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setNome(cliente.nome || '')
    setAc(cliente.ac || '')
    setFone(cliente.fone || '')
    setCidade(cliente.cidade || '')
    setUf('')
    setBairro(cliente.bairro || '')
    setEndereco(cliente.endereco || '')
    setCep(cliente.cep || '')
    setCnpj(cliente.cnpj || '')
    setIe(cliente.ie || '')
    setEmail(cliente.email || '')
    setErroBusca(null)
    setErroSalvar(null)
  }, [open, cliente])

  const [sucessoBusca, setSucessoBusca] = useState<string | null>(null)

  // Detecta tipo do documento pelo conteúdo
  type DocTipo = 'cpf' | 'cnpj' | 'ie'
  function detectarTipo(v: string): DocTipo {
    const d = somenteDigitos(v)
    if (d.length <= 11) return 'cpf'
    if (d.length === 14) return 'cnpj'
    // CNPJ colado com dígitos extras (ex: "12345678000199" + lixo) — tenta CNPJ
    if (d.length > 14 && d.length <= 16 && d.slice(8, 12) === '0001') return 'cnpj'
    return 'ie'
  }
  const docTipo = detectarTipo(cnpj)

  // Tenta extrair CNPJ válido de um texto que pode ter dígitos extras
  function extrairCnpj(d: string): string | null {
    // Exatamente 14 → CNPJ direto
    if (d.length === 14) return d
    // >14: tenta os primeiros 14 se parecem CNPJ (tem /0001 na posição 8-12)
    if (d.length > 14 && d.slice(8, 12) === '0001') return d.slice(0, 14)
    return null
  }

  // Busca por Inscrição Estadual (produtor rural / contribuinte) no Sintegra via Infosimples.
  // Precisa da UF preenchida ao lado. Preenche nome/endereço/situação se encontrar.
  async function tentarSintegraPorIe(ieVal: string) {
    const ufAtual = uf.trim().toUpperCase()
    setBuscando(true)
    const sint = await buscarSintegra({ documento: ieVal, tipo: 'ie', uf: ufAtual || undefined })
    setBuscando(false)
    if (sint?.ok && sint.resultado) {
      const r = sint.resultado
      if (r.razao_social) setNome(titleCase(r.razao_social))
      if (r.endereco) setEndereco(titleCase(r.endereco))
      if (r.bairro) setBairro(titleCase(r.bairro))
      if (r.municipio) setCidade(titleCase(r.municipio))
      if (r.uf) setUf(r.uf)
      if (r.cep) setCep(fmtCep(r.cep))
      setSucessoBusca(`✓ Dados de "${titleCase(r.razao_social || ieVal)}" carregados do Sintegra${r.situacao ? ` (${r.situacao})` : ''}`)
    } else if (sint?.error === 'uf_obrigatoria') {
      // Tokens configurados, mas falta a UF pra consultar a SEFAZ certa
      setSucessoBusca('✓ Inscrição salva. Informe a UF ao lado e clique em Buscar de novo pra puxar do Sintegra.')
    } else {
      // Sem tokens / não encontrado / falha de rede → comportamento neutro de sempre
      setSucessoBusca('✓ Inscrição salva no campo I.E. Preencha os demais dados manualmente.')
    }
  }

  async function handleBuscarDocumento() {
    const d = somenteDigitos(cnpj)
    setSucessoBusca(null)

    if (d.length === 11) {
      // CPF: busca dados cadastrais via cpfcnpj.com.br
      setBuscando(true)
      setErroBusca(null)
      setCnpj(fmtCpf(cnpj))
      const dados = await buscarCpf(d)
      setBuscando(false)
      if (!dados) {
        setErroBusca('CPF não encontrado ou API indisponível. Preencha manualmente.')
        return
      }
      if (dados.nome) setNome(titleCase(dados.nome))
      if (dados.endereco) {
        const endNum = dados.numero ? `${dados.endereco}, ${dados.numero}` : dados.endereco
        const endFull = dados.complemento ? `${endNum} - ${dados.complemento}` : endNum
        setEndereco(titleCase(endFull))
      }
      if (dados.bairro) setBairro(titleCase(dados.bairro))
      if (dados.cidade) setCidade(titleCase(dados.cidade))
      if (dados.uf) setUf(dados.uf)
      if (dados.cep) setCep(fmtCep(dados.cep))
      if (dados.telefones?.length) setFone(fmtFone(dados.telefones[0]))
      if (dados.emails?.length) setEmail(dados.emails[0].toLowerCase())
      const temEndereco = !!dados.endereco
      setSucessoBusca(temEndereco
        ? `✓ Dados de "${titleCase(dados.nome)}" carregados com sucesso`
        : `✓ Nome "${titleCase(dados.nome)}" encontrado. Endereço requer plano pago — preencha manualmente.`)
      return
    }

    // Tenta extrair CNPJ (funciona pra 14 dígitos exatos ou >14 com padrão 0001)
    const cnpj14 = extrairCnpj(d)
    if (cnpj14) {
      setBuscando(true)
      setErroBusca(null)
      const dados = await buscarCnpj(cnpj14)
      setBuscando(false)
      if (!dados) {
        // CNPJ não encontrado — se tinha dígitos extras, pode ser IE
        if (d.length > 14) {
          setIe(cnpj.trim())
          setCnpj('')
          setSucessoBusca('✓ Inscrição salva no campo I.E. Preencha os demais dados manualmente.')
          return
        }
        setErroBusca('CNPJ não encontrado na Receita Federal ou API indisponível.')
        return
      }
      setNome(titleCase(dados.razao_social || dados.nome_fantasia))
      // Rua: tipo + logradouro da Receita; se vier vazia, completa via ViaCEP pelo CEP
      let rua = [dados.descricao_tipo_de_logradouro, dados.logradouro].filter(Boolean).join(' ').trim()
      if (!rua && dados.cep) {
        try { const c = await buscarCep(dados.cep); if (c?.logradouro) rua = c.logradouro } catch { /* enriquecimento opcional */ }
      }
      const endNum = dados.numero ? `${rua}, ${dados.numero}` : rua
      const endFull = dados.complemento ? `${endNum} - ${dados.complemento}` : endNum
      setEndereco(titleCase(endFull.trim()))
      setBairro(titleCase(dados.bairro))
      setCidade(titleCase(dados.municipio))
      setUf(dados.uf)
      setCep(fmtCep(dados.cep))
      setCnpj(fmtCnpj(cnpj14))
      // Sobra dos dígitos (ex: IE veio colada junto) → salva no campo IE
      if (d.length > 14) {
        const sobra = d.slice(14)
        if (sobra.length >= 8) setIe(sobra)
      }
      if (dados.email) setEmail(dados.email.toLowerCase())
      if (dados.ddd_telefone_1) setFone(fmtFone(dados.ddd_telefone_1))
      // Enriquece com IE + situação de contribuinte (Sintegra), sem bloquear o fluxo
      let ieMsg = ''
      try {
        setBuscando(true)
        const sint = await buscarSintegra({ documento: cnpj14, tipo: 'cnpj', uf: dados.uf })
        if (sint?.ok && sint.resultado?.ie) {
          setIe(sint.resultado.ie)
          ieMsg = ` · IE ${sint.resultado.ie}${sint.resultado.situacao ? ` (${sint.resultado.situacao})` : ''}`
        }
      } catch {
        /* enriquecimento é opcional — ignora falha */
      } finally {
        setBuscando(false)
      }
      setSucessoBusca(`✓ Dados de "${titleCase(dados.razao_social || dados.nome_fantasia)}" carregados da Receita Federal${ieMsg}`)
      return
    }

    if (d.length > 11 && d.length < 14) {
      setErroBusca('CNPJ incompleto — precisa ter 14 dígitos')
      return
    }

    if (d.length >= 8) {
      // IE / Inscrição de Produtor Rural (8-10 dígitos ou >14 não-CNPJ).
      // Mantém o valor no campo pra permitir re-buscar depois de preencher a UF.
      const ieVal = cnpj.trim()
      setIe(ieVal)
      setErroBusca(null)
      await tentarSintegraPorIe(ieVal)
      return
    }

    setErroBusca('Digite um documento válido (CPF, CNPJ ou Inscrição)')
  }

  async function handleBuscarCep() {
    const d = somenteDigitos(cep)
    if (d.length !== 8) return
    setBuscando(true)
    const dados = await buscarCep(d)
    setBuscando(false)
    if (!dados) return
    if (dados.logradouro) setEndereco(titleCase(dados.logradouro))
    if (dados.bairro) setBairro(titleCase(dados.bairro))
    if (dados.localidade) setCidade(titleCase(dados.localidade))
    if (dados.uf) setUf(dados.uf)
    setCep(fmtCep(d))
  }

  function handleSalvar() {
    // Validação: Nome e Telefone são obrigatórios. O telefone é o que amarra o
    // orçamento ao lead (match por fone_canon no dashboard/atendimentos) — sem ele,
    // a venda não rastreia origem. Exige DDD + número (>=10 dígitos).
    if (!nome.trim()) {
      setErroSalvar('Preencha o Nome / Razão Social.')
      return
    }
    if (somenteDigitos(fone).length < 10) {
      setErroSalvar('Telefone é obrigatório (com DDD) — é o que amarra o orçamento ao cliente/lead.')
      return
    }
    setErroSalvar(null)
    onSave({
      nome: nome.trim() || undefined,
      ac: ac.trim() || null,
      fone: fone.trim() || null,
      cidade: cidade.trim() ? `${cidade.trim()}${uf.trim() ? ` - ${uf.trim().toUpperCase()}` : ''}` : null,
      bairro: bairro.trim() || null,
      endereco: endereco.trim() || null,
      cep: cep.trim() || null,
      cnpj: cnpj.trim() || null,
      ie: ie.trim() || null,
      email: email.trim() || null,
    })
    onClose()
  }

  const [colando, setColando] = useState(false)
  const [textoColado, setTextoColado] = useState('')

  function handleColar() {
    if (!textoColado.trim()) return
    const { cliente_nome, dados } = parseClienteText(textoColado)
    if (cliente_nome) setNome(titleCasePtBr(cliente_nome))
    if (dados.ac) setAc(dados.ac)
    if (dados.fone) setFone(dados.fone)
    if (dados.cidade) setCidade(dados.cidade)
    if (dados.uf) setUf(dados.uf)
    if (dados.bairro) setBairro(dados.bairro)
    if (dados.endereco) setEndereco(dados.endereco)
    if (dados.cep) setCep(dados.cep)
    if (dados.cnpj) setCnpj(dados.cnpj)
    if (dados.ie) setIe(dados.ie)
    if (dados.email) setEmail(dados.email)
    setTextoColado('')
    setColando(false)
    setSucessoBusca('✓ Dados extraídos do texto colado')
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
      <div
        className="bg-bg border border-border rounded-xl max-w-lg w-full shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Dados do Cliente</h2>
            <p className="text-[11px] text-ink-faint">Preencha ou digite CNPJ/CPF/IE pra buscar automaticamente</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setColando(!colando)}
              className={`flex items-center gap-1 px-2 py-1 rounded text-[11px] font-semibold transition ${
                colando
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-ink-muted hover:bg-accent/10 hover:text-accent border border-border'
              }`}
              title="Colar dados do cliente (texto bagunçado → auto-preenche)"
            >
              <ClipboardPaste className="w-3.5 h-3.5" />
              Colar
            </button>
            <button onClick={onClose} className="text-ink-faint hover:text-ink p-1"><X className="w-4 h-4" /></button>
          </div>
        </div>

        {/* Área de colar texto */}
        {colando && (
          <div className="px-5 py-3 bg-accent/5 border-b border-border">
            <p className="text-[11px] text-ink-muted mb-1.5">Cole os dados do cliente abaixo (nome, CNPJ, endereço, etc. — em qualquer formato):</p>
            <textarea
              autoFocus
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              value={textoColado}
              onChange={e => setTextoColado(e.target.value)}
              onPaste={e => {
                // Auto-processa ao colar: pega o texto colado e preenche direto
                const pasted = e.clipboardData.getData('text')
                if (pasted && pasted.trim().length > 5) {
                  e.preventDefault()
                  const { cliente_nome, dados } = parseClienteText(pasted)
                  if (cliente_nome) setNome(titleCasePtBr(cliente_nome))
                  if (dados.ac) setAc(dados.ac)
                  if (dados.fone) setFone(dados.fone)
                  if (dados.cidade) setCidade(dados.cidade)
                  if (dados.uf) setUf(dados.uf)
                  if (dados.bairro) setBairro(dados.bairro)
                  if (dados.endereco) setEndereco(dados.endereco)
                  if (dados.cep) setCep(dados.cep)
                  if (dados.cnpj) setCnpj(dados.cnpj)
                  if (dados.ie) setIe(dados.ie)
                  if (dados.email) setEmail(dados.email)
                  setTextoColado('')
                  setColando(false)
                  setSucessoBusca('✓ Dados extraídos automaticamente do texto colado')
                }
              }}
              onKeyDown={e => { if (e.key === 'Enter' && e.ctrlKey) handleColar() }}
              placeholder={"Cole aqui (Ctrl+V) — preenche automaticamente\n\nEx:\nFAZENDA SUSSUARANA\nCNPJ 12.345.678/0001-99\nRua das Flores, 123\nCidade - UF\n(48) 99999-9999"}
              className="w-full bg-surface-2 border border-border rounded-md px-3 py-2 text-[12px] text-ink resize-none outline-none focus:border-accent"
              rows={5}
            />
            <div className="flex justify-end gap-2 mt-2">
              <button onClick={() => { setColando(false); setTextoColado('') }} className="text-[11px] text-ink-muted hover:text-ink px-2 py-1">Cancelar</button>
              <button
                onClick={handleColar}
                disabled={!textoColado.trim()}
                className="text-[11px] font-semibold bg-accent text-white px-3 py-1 rounded hover:bg-accent/90 disabled:opacity-40 transition"
              >
                Preencher campos
              </button>
            </div>
          </div>
        )}

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-3">
          {/* CPF / CNPJ / IE / Produtor Rural com busca */}
          <div>
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
              CPF / CNPJ / Inscrição Estadual
            </label>
            <div className="flex gap-2">
              <Input
                value={cnpj}
                onChange={e => {
                  const raw = e.target.value
                  const d = somenteDigitos(raw)
                  setSucessoBusca(null)
                  setErroBusca(null)
                  // Formata automaticamente se CPF ou CNPJ (≤14 dígitos puros)
                  if (d.length <= 14 && d.length === raw.replace(/[\s.-/]/g, '').length) {
                    setCnpj(fmtDocumento(raw))
                  } else {
                    setCnpj(raw) // IE pode ter formatos variados
                  }
                }}
                placeholder="Digite CNPJ, CPF ou Inscrição"
                onKeyDown={e => { if (e.key === 'Enter') handleBuscarDocumento() }}
              />
              <button
                onClick={handleBuscarDocumento}
                disabled={buscando || somenteDigitos(cnpj).length < 8}
                className="shrink-0 px-3 rounded-md bg-accent hover:bg-accent/90 text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition"
              >
                {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Buscar
              </button>
            </div>
            {erroBusca && <p className="text-[11px] text-danger mt-1">{erroBusca}</p>}
            {sucessoBusca && <p className="text-[11px] text-success mt-1">{sucessoBusca}</p>}
            {!erroBusca && !sucessoBusca && somenteDigitos(cnpj).length > 0 && (
              <p className="text-[10px] text-ink-faint mt-1 flex items-center gap-1">
                {docTipo === 'cnpj' && <><Building2 className="w-3 h-3" /> CNPJ — busca automática via Receita Federal</>}
                {docTipo === 'cpf' && <><User className="w-3 h-3" /> CPF — busca automática de nome e endereço</>}
                {docTipo === 'ie' && <><Tractor className="w-3 h-3" /> IE / Produtor Rural — será salvo no campo Inscrição Estadual</>}
              </p>
            )}
          </div>

          {/* Nome */}
          <div>
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
              Nome / Razão Social <span className="text-danger">*</span>
            </label>
            <Input value={nome} onChange={e => { setNome(e.target.value); if (erroSalvar) setErroSalvar(null) }} placeholder="Nome do cliente ou empresa" />
          </div>

          {/* A/C + Fone */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">A/C (contato)</label>
              <Input value={ac} onChange={e => setAc(e.target.value)} placeholder="Aos cuidados de..." />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                Telefone <span className="text-danger">*</span>
              </label>
              <Input
                value={fone}
                onChange={e => { setFone(fmtFone(e.target.value)); if (erroSalvar) setErroSalvar(null) }}
                placeholder="(48) 99999-9999"
              />
            </div>
          </div>

          {/* CEP + busca */}
          <div>
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">CEP</label>
            <div className="flex gap-2">
              <div className="w-40">
                <Input
                  value={cep}
                  onChange={e => setCep(fmtCep(e.target.value))}
                  placeholder="88890-000"
                  onBlur={handleBuscarCep}
                  onKeyDown={e => { if (e.key === 'Enter') handleBuscarCep() }}
                />
              </div>
              <p className="text-[10px] text-ink-faint self-center">Digite o CEP e o endereço preenche sozinho</p>
            </div>
          </div>

          {/* Endereço */}
          <div>
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">Endereço</label>
            <Input value={endereco} onChange={e => setEndereco(e.target.value)} placeholder="Rua, número, complemento" />
          </div>

          {/* Bairro + Cidade + UF */}
          <div className="grid grid-cols-[1fr_1fr_60px] gap-2">
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">Bairro</label>
              <Input value={bairro} onChange={e => setBairro(e.target.value)} placeholder="Bairro" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">Cidade</label>
              <Input value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Cidade" />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">UF</label>
              <Input value={uf} onChange={e => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="SC" />
            </div>
          </div>

          {/* I.E. + Email */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">Inscrição Estadual</label>
              <Input value={ie} onChange={e => setIe(e.target.value)} placeholder="I.E." />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">E-mail</label>
              <Input value={email} onChange={e => setEmail(e.target.value)} placeholder="email@empresa.com" />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3 border-t border-border flex items-center justify-end gap-2">
          {erroSalvar && <p className="text-[11px] text-danger mr-auto self-center leading-snug">{erroSalvar}</p>}
          <button
            onClick={onClose}
            className="text-[12px] px-4 py-2 rounded border border-border bg-surface-2 hover:bg-surface-3 text-ink-muted font-semibold transition"
          >
            Cancelar
          </button>
          <button
            onClick={handleSalvar}
            className="text-[12px] px-4 py-2 rounded bg-accent hover:bg-accent/90 text-white font-semibold flex items-center gap-1.5 transition"
          >
            <Check className="w-3.5 h-3.5" />
            Aplicar no orçamento
          </button>
        </div>
      </div>
    </div>
  )
}
