import { useEffect, useState } from 'react'
import { X, Search, Loader2, Check, Building2, User, Tractor } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import type { PreviewClienteDados } from './OrcamentoPreview'

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

interface BrasilApiCnpj {
  razao_social: string
  nome_fantasia: string
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
const CPFCNPJ_TOKEN = '670696c045158c1b8fd7e158bc13adcb'
const CPFCNPJ_PACOTE = '9' // pacote completo (nome, endereço, telefone)

interface CpfCnpjResult {
  status: number
  cpf: string
  nome: string
  nascimento: string
  endereco: string
  numero: string
  complemento: string
  bairro: string
  cep: string
  cidade: string
  uf: string
  mae: string
  genero: string
  situacao: string
  telefones: string[]
  emails: string[]
  saldo: number
}

async function buscarCpf(cpf: string): Promise<CpfCnpjResult | null> {
  const d = somenteDigitos(cpf)
  if (d.length !== 11) return null
  try {
    const res = await fetch(`https://api.cpfcnpj.com.br/${CPFCNPJ_TOKEN}/${CPFCNPJ_PACOTE}/${d}`)
    if (!res.ok) return null
    const data = await res.json() as CpfCnpjResult
    if (!data.status || !data.nome) return null
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
  }, [open, cliente])

  const [sucessoBusca, setSucessoBusca] = useState<string | null>(null)

  // Detecta tipo do documento pelo conteúdo
  type DocTipo = 'cpf' | 'cnpj' | 'ie'
  function detectarTipo(v: string): DocTipo {
    const d = somenteDigitos(v)
    if (d.length <= 11) return 'cpf'
    if (d.length === 14) return 'cnpj'
    return 'ie'
  }
  const docTipo = detectarTipo(cnpj)

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
      if (dados.nome) setNome(dados.nome)
      const endNum = dados.numero ? `${dados.endereco}, ${dados.numero}` : dados.endereco
      const endFull = dados.complemento ? `${endNum} - ${dados.complemento}` : endNum
      if (endFull) setEndereco(endFull)
      if (dados.bairro) setBairro(dados.bairro)
      if (dados.cidade) setCidade(dados.cidade)
      if (dados.uf) setUf(dados.uf)
      if (dados.cep) setCep(fmtCep(dados.cep))
      if (dados.telefones?.length) setFone(fmtFone(dados.telefones[0]))
      if (dados.emails?.length) setEmail(dados.emails[0])
      setSucessoBusca(`✓ Dados de "${dados.nome}" carregados com sucesso`)
      return
    }

    if (d.length === 14) {
      setBuscando(true)
      setErroBusca(null)
      const dados = await buscarCnpj(d)
      setBuscando(false)
      if (!dados) {
        setErroBusca('CNPJ não encontrado na Receita Federal ou API indisponível.')
        return
      }
      setNome(dados.nome_fantasia || dados.razao_social)
      const endNum = dados.numero ? `${dados.logradouro}, ${dados.numero}` : dados.logradouro
      const endFull = dados.complemento ? `${endNum} - ${dados.complemento}` : endNum
      setEndereco(endFull)
      setBairro(dados.bairro)
      setCidade(dados.municipio)
      setUf(dados.uf)
      setCep(fmtCep(dados.cep))
      setCnpj(fmtCnpj(d))
      if (dados.email) setEmail(dados.email)
      if (dados.ddd_telefone_1) setFone(fmtFone(dados.ddd_telefone_1))
      setSucessoBusca(`✓ Dados de "${dados.nome_fantasia || dados.razao_social}" carregados da Receita Federal`)
      return
    }

    if (d.length > 11 && d.length < 14) {
      setErroBusca('CNPJ incompleto — precisa ter 14 dígitos')
      return
    }

    if (d.length >= 8) {
      // IE / Inscrição de Produtor Rural: move pro campo IE
      setIe(cnpj.trim())
      setCnpj('')
      setErroBusca(null)
      setSucessoBusca('✓ Inscrição salva no campo I.E. Preencha os demais dados manualmente.')
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
    if (dados.logradouro) setEndereco(dados.logradouro)
    if (dados.bairro) setBairro(dados.bairro)
    if (dados.localidade) setCidade(dados.localidade)
    if (dados.uf) setUf(dados.uf)
    setCep(fmtCep(d))
  }

  function handleSalvar() {
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

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
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
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1"><X className="w-4 h-4" /></button>
        </div>

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
            <Input value={nome} onChange={e => setNome(e.target.value)} placeholder="Nome do cliente ou empresa" />
          </div>

          {/* A/C + Fone */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">A/C (contato)</label>
              <Input value={ac} onChange={e => setAc(e.target.value)} placeholder="Aos cuidados de..." />
            </div>
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">Telefone</label>
              <Input
                value={fone}
                onChange={e => setFone(fmtFone(e.target.value))}
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
