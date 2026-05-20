import { useEffect, useState } from 'react'
import { X, Search, Loader2, Check, Building2, User } from 'lucide-react'
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

  async function handleBuscarCnpj() {
    const d = somenteDigitos(cnpj)
    if (d.length !== 14 && d.length !== 11) {
      setErroBusca('Digite um CNPJ (14 dígitos) ou CPF (11 dígitos)')
      return
    }
    if (d.length === 11) {
      // CPF: só formata, não tem API pública
      setCnpj(fmtCpf(cnpj))
      setErroBusca(null)
      return
    }
    setBuscando(true)
    setErroBusca(null)
    const dados = await buscarCnpj(d)
    setBuscando(false)
    if (!dados) {
      setErroBusca('CNPJ não encontrado ou API indisponível')
      return
    }
    // Preenche tudo
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

  const docDigitos = somenteDigitos(cnpj)
  const isCnpj = docDigitos.length > 11

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
            <p className="text-[11px] text-ink-faint">Preencha ou digite CNPJ/CPF pra buscar automaticamente</p>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1"><X className="w-4 h-4" /></button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-3">
          {/* CNPJ/CPF com busca */}
          <div>
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
              CPF / CNPJ
            </label>
            <div className="flex gap-2">
              <Input
                value={cnpj}
                onChange={e => setCnpj(fmtDocumento(e.target.value))}
                placeholder="Digite CNPJ ou CPF"
                onKeyDown={e => { if (e.key === 'Enter') handleBuscarCnpj() }}
              />
              <button
                onClick={handleBuscarCnpj}
                disabled={buscando || docDigitos.length < 11}
                className="shrink-0 px-3 rounded-md bg-accent hover:bg-accent/90 text-white text-[12px] font-semibold flex items-center gap-1.5 disabled:opacity-40 transition"
              >
                {buscando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />}
                Buscar
              </button>
            </div>
            {erroBusca && <p className="text-[10px] text-danger mt-1">{erroBusca}</p>}
            {!erroBusca && docDigitos.length > 0 && (
              <p className="text-[10px] text-ink-faint mt-1 flex items-center gap-1">
                {isCnpj ? <Building2 className="w-3 h-3" /> : <User className="w-3 h-3" />}
                {isCnpj ? 'CNPJ — busca automática via Receita Federal' : 'CPF — preencha os dados manualmente'}
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
