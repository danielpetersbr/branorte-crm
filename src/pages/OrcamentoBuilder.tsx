import { useMemo, useState, useEffect } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import {
  FileText, ArrowRight, ArrowLeft, Check, User, Package, ListChecks, Eye,
  Plus, Trash2, FileDown, Save, Search,
} from 'lucide-react'
import {
  useOrcamentoModelos, useClientesOrcamento, useCriarOrcamento,
  obterProximoNumero,
  type OrcamentoModelo, type OrcamentoItem, type OrcamentoMotor,
  type OrcamentoAcessorios, type ClienteDados,
} from '@/hooks/useOrcamentoBuilder'
import { useAuth } from '@/hooks/useAuth'
import { baixarOrcamentoPdf } from '@/lib/orcamento-pdf'
import { baixarOrcamentoDocx } from '@/lib/orcamento-docx'
import {
  isFolderScanSupported, pickOrcamentoFolder, getStoredFolderHandle,
  scanFolderForLastNumber, formatarNumero,
} from '@/lib/orcamento-folder-scan'
import { FolderOpen, RefreshCw } from 'lucide-react'

type Step = 1 | 2 | 3 | 4

const PACOTES = ['COMPACTA 01', 'COMPACTA 02', 'COMPACTA 03', 'MINI FABRICA']

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function StepIndicator({ current }: { current: Step }) {
  const steps = [
    { n: 1, label: 'Cliente', icon: User },
    { n: 2, label: 'Modelo', icon: Package },
    { n: 3, label: 'Items', icon: ListChecks },
    { n: 4, label: 'Gerar', icon: Eye },
  ] as const
  return (
    <div className="flex items-center gap-2 mb-4">
      {steps.map((s, i) => {
        const active = current === s.n
        const done = current > s.n
        return (
          <div key={s.n} className="flex items-center gap-2 flex-1">
            <div
              className={`flex items-center gap-2 px-3 py-2 rounded-md transition-all ${
                active
                  ? 'bg-accent-bg text-accent border border-accent/40'
                  : done
                    ? 'bg-success-bg/30 text-success'
                    : 'bg-surface-2 text-ink-faint'
              }`}
            >
              {done ? <Check className="h-4 w-4" /> : <s.icon className="h-4 w-4" />}
              <span className="text-[12px] font-semibold uppercase tracking-wider">{s.label}</span>
            </div>
            {i < steps.length - 1 && (
              <div className={`flex-1 h-0.5 ${done ? 'bg-success/40' : 'bg-border'}`} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function OrcamentoBuilder() {
  const { profile } = useAuth()
  const { data: modelos, isLoading: loadingMods } = useOrcamentoModelos()
  const criar = useCriarOrcamento()

  const [step, setStep] = useState<Step>(1)

  // Step 1 — Cliente
  const [cliNome, setCliNome] = useState('')
  const [cliDados, setCliDados] = useState<ClienteDados>({})
  const [searchCli, setSearchCli] = useState('')
  const { data: clientesSugeridos } = useClientesOrcamento(searchCli)

  // Step 2 — Modelo
  const [filtroPacote, setFiltroPacote] = useState<string | null>(null)
  const [filtroVoltagem, setFiltroVoltagem] = useState<'monofasico' | 'trifasico' | null>(null)
  const [modeloId, setModeloId] = useState<number | null>(null)

  // Step 3 — Itens (cópia editável do modelo)
  const [itens, setItens] = useState<OrcamentoItem[]>([])
  const [acessorios, setAcessorios] = useState<OrcamentoAcessorios | null>(null)
  const [motores, setMotores] = useState<OrcamentoMotor[]>([])

  // Step 4 — Gerar
  const [observacoes, setObservacoes] = useState('')
  const [formaPagamento, setFormaPagamento] = useState('')
  const [prazoEntrega, setPrazoEntrega] = useState('')
  const [numeroAtual, setNumeroAtual] = useState<string>('')
  const [gerando, setGerando] = useState(false)
  const [orcamentoSalvo, setOrcamentoSalvo] = useState<{ numero: string; id: number } | null>(null)
  const [scanInfo, setScanInfo] = useState<{ ultimo: number; total: number; ano: number } | null>(null)
  const [scanLoading, setScanLoading] = useState(false)

  const modeloSelecionado = useMemo(
    () => modelos?.find(m => m.id === modeloId) ?? null,
    [modelos, modeloId],
  )

  const totalEquip = useMemo(
    () => itens.reduce((s, i) => s + (i.valor * i.qtd), 0) + (acessorios?.valor ?? 0),
    [itens, acessorios],
  )
  const totalMotores = useMemo(
    () => motores.reduce((s, m) => s + m.valor, 0),
    [motores],
  )
  const totalProposta = totalEquip + totalMotores

  // Quando seleciona modelo, copia para state editável
  useEffect(() => {
    if (modeloSelecionado) {
      setItens(JSON.parse(JSON.stringify(modeloSelecionado.itens)))
      setAcessorios(modeloSelecionado.acessorios ? JSON.parse(JSON.stringify(modeloSelecionado.acessorios)) : null)
      setMotores(JSON.parse(JSON.stringify(modeloSelecionado.motores)))
    }
  }, [modeloSelecionado])

  // Pre-busca próximo número quando entra no step 4 (prefere folder scan)
  useEffect(() => {
    if (step === 4 && !numeroAtual) {
      ;(async () => {
        try {
          const handle = await getStoredFolderHandle()
          if (handle) {
            const scan = await scanFolderForLastNumber(handle)
            setScanInfo({ ultimo: scan.ultimoNumero, total: scan.total, ano: scan.ano })
            setNumeroAtual(formatarNumero(scan.ano, scan.proximoNumero))
            return
          }
        } catch {}
        // Fallback: usa banco
        try {
          const r = await obterProximoNumero()
          setNumeroAtual(r.numero)
        } catch {
          setNumeroAtual('—')
        }
      })()
    }
  }, [step, numeroAtual])

  async function handlePickFolder() {
    setScanLoading(true)
    try {
      const handle = await pickOrcamentoFolder()
      const scan = await scanFolderForLastNumber(handle)
      setScanInfo({ ultimo: scan.ultimoNumero, total: scan.total, ano: scan.ano })
      setNumeroAtual(formatarNumero(scan.ano, scan.proximoNumero))
    } catch (e) {
      alert('Erro: ' + (e as Error).message)
    } finally {
      setScanLoading(false)
    }
  }

  async function handleRescanFolder() {
    setScanLoading(true)
    try {
      let handle = await getStoredFolderHandle()
      if (!handle) {
        // Não tem pasta salva — abre picker direto (sem alert)
        handle = await pickOrcamentoFolder()
      }
      const scan = await scanFolderForLastNumber(handle)
      setScanInfo({ ultimo: scan.ultimoNumero, total: scan.total, ano: scan.ano })
      setNumeroAtual(formatarNumero(scan.ano, scan.proximoNumero))
    } catch (e) {
      // Usuário cancelou o picker — silencioso
      const msg = (e as Error).message
      if (!/abort|cancel/i.test(msg)) {
        alert('Erro: ' + msg)
      }
    } finally {
      setScanLoading(false)
    }
  }

  const modelosFiltrados = useMemo(() => {
    if (!modelos) return []
    return modelos.filter(m => {
      if (filtroPacote && m.pacote !== filtroPacote) return false
      if (filtroVoltagem && m.voltagem !== filtroVoltagem) return false
      return true
    })
  }, [modelos, filtroPacote, filtroVoltagem])

  function aplicarCliente(c: typeof clientesSugeridos extends (infer T)[] | undefined ? T : never) {
    if (!c) return
    setCliNome(c.nome)
    setCliDados({
      ac: c.ac ?? undefined,
      fone: c.fone ?? undefined,
      cidade: c.cidade ?? undefined,
      bairro: c.bairro ?? undefined,
      endereco: c.endereco ?? undefined,
      cep: c.cep ?? undefined,
      cnpj: c.cnpj ?? undefined,
      ie: c.ie ?? undefined,
      email: c.email ?? undefined,
    })
    setSearchCli('')
  }

  async function handleGerar(opcoes: { formato: 'docx' | 'pdf' | 'nenhum'; status: 'rascunho' | 'enviado' }) {
    if (!modeloSelecionado || !cliNome.trim()) return
    setGerando(true)
    try {
      const orc = await criar.mutateAsync({
        vendedor_nome: profile?.display_name?.toUpperCase() || 'DESCONHECIDO',
        cliente_nome: cliNome.trim(),
        cliente_dados: cliDados,
        modelo_id: modeloSelecionado.id,
        modelo_basename: modeloSelecionado.basename,
        voltagem: modeloSelecionado.voltagem,
        itens,
        acessorios,
        motores,
        total_equipamentos: totalEquip,
        total_motores: totalMotores,
        total_proposta: totalProposta,
        observacoes: observacoes.trim() || null,
        forma_pagamento: formaPagamento.trim() || null,
        prazo_entrega: prazoEntrega.trim() || null,
        status: opcoes.status,
      })
      setOrcamentoSalvo({ numero: orc.numero, id: orc.id })

      if (opcoes.formato === 'docx' && modeloSelecionado.template_path) {
        await baixarOrcamentoDocx({
          template_path: modeloSelecionado.template_path,
          numero: orc.numero,
          data: new Date().toLocaleDateString('pt-BR'),
          cliente_nome: cliNome,
          cliente_dados: cliDados,
          forma_pagamento: formaPagamento.trim() || null,
          prazo_entrega: prazoEntrega.trim() || null,
        })
      } else if (opcoes.formato === 'pdf') {
        baixarOrcamentoPdf({
          numero: orc.numero,
          data: new Date().toLocaleDateString('pt-BR'),
          cliente_nome: cliNome,
          cliente_dados: cliDados,
          voltagem: modeloSelecionado.voltagem,
          itens,
          acessorios,
          motores,
          total_equipamentos: totalEquip,
          total_motores: totalMotores,
          total_proposta: totalProposta,
          observacoes: observacoes.trim() || null,
        })
      }
    } catch (e) {
      alert('Erro ao salvar orçamento: ' + (e as Error).message)
    } finally {
      setGerando(false)
    }
  }

  function novoOrcamento() {
    setStep(1)
    setCliNome('')
    setCliDados({})
    setModeloId(null)
    setItens([])
    setMotores([])
    setAcessorios(null)
    setObservacoes('')
    setNumeroAtual('')
    setOrcamentoSalvo(null)
  }

  if (loadingMods) return <PageLoading />

  // Tela de sucesso
  if (orcamentoSalvo) {
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-8 text-center border-success/40 bg-success-bg/10">
          <Check className="h-16 w-16 text-success mx-auto mb-4" />
          <h2 className="text-[24px] font-bold text-ink mb-2">Orçamento gerado!</h2>
          <p className="text-[16px] text-ink-muted mb-1">
            Número: <span className="font-mono font-bold text-accent">{orcamentoSalvo.numero}</span>
          </p>
          <p className="text-[14px] text-ink-muted mb-6">
            Cliente: <strong>{cliNome}</strong> · Total: <strong>{formatBRL(totalProposta)}</strong>
          </p>
          <div className="flex gap-3 justify-center">
            <button
              className="bg-accent hover:bg-accent-700 text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
              onClick={novoOrcamento}
            >
              <Plus className="h-4 w-4" />
              Novo orçamento
            </button>
            <button
              className="bg-surface-2 hover:bg-surface-3 text-ink font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
              onClick={() => modeloSelecionado?.template_path && baixarOrcamentoDocx({
                template_path: modeloSelecionado.template_path,
                numero: orcamentoSalvo.numero,
                data: new Date().toLocaleDateString('pt-BR'),
                cliente_nome: cliNome,
                cliente_dados: cliDados,
              })}
            >
              <FileDown className="h-4 w-4" />
              Baixar .docx de novo
            </button>
          </div>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-4">
      <header>
        <h1 className="text-[20px] font-semibold text-ink flex items-center gap-2">
          <FileText className="h-5 w-5 text-accent" />
          Novo Orçamento Branorte
        </h1>
        <p className="text-[12px] text-ink-muted mt-0.5">
          Wizard pra montar orçamento padrão Branorte com PDF gerado automaticamente
        </p>
      </header>

      <StepIndicator current={step} />

      {/* ============== STEP 1 — Cliente ============== */}
      {step === 1 && (
        <Card className="p-5 space-y-4">
          <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2">
            <User className="h-4 w-4" /> Dados do Cliente
          </h2>

          {/* Busca cliente existente */}
          <div className="space-y-2">
            <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Buscar cliente já cadastrado (opcional)</label>
            <div className="relative">
              <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
              <input
                type="text"
                value={searchCli}
                onChange={e => setSearchCli(e.target.value)}
                placeholder="Digite nome do cliente..."
                className="w-full pl-9 pr-3 py-2 rounded-md bg-surface-2 border border-border text-ink text-[13px] focus:border-accent outline-none"
              />
            </div>
            {searchCli && clientesSugeridos && clientesSugeridos.length > 0 && (
              <div className="border border-border rounded-md max-h-40 overflow-y-auto">
                {clientesSugeridos.slice(0, 5).map(c => (
                  <button
                    key={c.id}
                    onClick={() => aplicarCliente(c)}
                    className="w-full text-left p-2 hover:bg-surface-2 border-b border-border last:border-b-0"
                  >
                    <div className="text-[13px] font-medium text-ink">{c.nome}</div>
                    <div className="text-[10px] text-ink-faint">{[c.cidade, c.cnpj].filter(Boolean).join(' · ')}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Nome do cliente *</label>
              <Input value={cliNome} onChange={e => setCliNome(e.target.value)} placeholder="Razão social ou nome" className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">A/C</label>
              <Input value={cliDados.ac ?? ''} onChange={e => setCliDados({ ...cliDados, ac: e.target.value })} placeholder="Aos cuidados de" className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Fone</label>
              <Input value={cliDados.fone ?? ''} onChange={e => setCliDados({ ...cliDados, fone: e.target.value })} placeholder="(00) 0 0000-0000" className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Cidade</label>
              <Input value={cliDados.cidade ?? ''} onChange={e => setCliDados({ ...cliDados, cidade: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Bairro</label>
              <Input value={cliDados.bairro ?? ''} onChange={e => setCliDados({ ...cliDados, bairro: e.target.value })} className="mt-1" />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Endereço</label>
              <Input value={cliDados.endereco ?? ''} onChange={e => setCliDados({ ...cliDados, endereco: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">CEP</label>
              <Input value={cliDados.cep ?? ''} onChange={e => setCliDados({ ...cliDados, cep: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">CPF/CNPJ</label>
              <Input value={cliDados.cnpj ?? ''} onChange={e => setCliDados({ ...cliDados, cnpj: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">I.E.</label>
              <Input value={cliDados.ie ?? ''} onChange={e => setCliDados({ ...cliDados, ie: e.target.value })} className="mt-1" />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">E-mail</label>
              <Input value={cliDados.email ?? ''} onChange={e => setCliDados({ ...cliDados, email: e.target.value })} className="mt-1" />
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              disabled={!cliNome.trim()}
              onClick={() => setStep(2)}
              className="bg-accent hover:bg-accent-700 disabled:bg-surface-3 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
            >
              Próximo: Modelo
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Card>
      )}

      {/* ============== STEP 2 — Modelo ============== */}
      {step === 2 && (
        <Card className="p-5 space-y-4">
          <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2">
            <Package className="h-4 w-4" /> Escolher Modelo
            <span className="text-[11px] text-ink-faint font-normal ml-2">{modelosFiltrados.length} de {modelos?.length ?? 0}</span>
          </h2>

          {/* Filtros */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => setFiltroPacote(null)}
              className={`text-[11px] px-3 py-1.5 rounded-full font-medium ${
                filtroPacote === null ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >
              Todos pacotes
            </button>
            {PACOTES.map(p => (
              <button
                key={p}
                onClick={() => setFiltroPacote(filtroPacote === p ? null : p)}
                className={`text-[11px] px-3 py-1.5 rounded-full font-medium ${
                  filtroPacote === p ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
              >
                {p}
              </button>
            ))}
            <div className="w-px h-6 bg-border self-center mx-1" />
            <button
              onClick={() => setFiltroVoltagem(filtroVoltagem === 'monofasico' ? null : 'monofasico')}
              className={`text-[11px] px-3 py-1.5 rounded-full font-medium ${
                filtroVoltagem === 'monofasico' ? 'bg-info text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >
              Monofásico
            </button>
            <button
              onClick={() => setFiltroVoltagem(filtroVoltagem === 'trifasico' ? null : 'trifasico')}
              className={`text-[11px] px-3 py-1.5 rounded-full font-medium ${
                filtroVoltagem === 'trifasico' ? 'bg-info text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >
              Trifásico
            </button>
          </div>

          {/* Lista de modelos */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 max-h-[500px] overflow-y-auto pr-1">
            {modelosFiltrados.map(m => {
              const selected = m.id === modeloId
              return (
                <button
                  key={m.id}
                  onClick={() => setModeloId(m.id)}
                  className={`text-left p-3 rounded-md border transition-all ${
                    selected
                      ? 'border-accent bg-accent-bg/20 ring-2 ring-accent/30'
                      : 'border-border bg-surface-2 hover:border-accent/40'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-[12px] font-bold text-ink truncate flex-1">{m.basename}</div>
                    {selected && <Check className="h-4 w-4 text-accent shrink-0" />}
                  </div>
                  <div className="flex flex-wrap gap-1 text-[10px] mb-2">
                    <span className="px-1.5 py-0.5 rounded bg-accent-bg/30 text-accent font-bold">{m.pacote}</span>
                    <span className={`px-1.5 py-0.5 rounded font-bold ${
                      m.voltagem === 'trifasico' ? 'bg-info-bg/30 text-info' : 'bg-warning-bg/30 text-warning'
                    }`}>
                      {m.voltagem}
                    </span>
                    {m.is_master && <span className="px-1.5 py-0.5 rounded bg-warning-bg/30 text-warning font-bold">MASTER</span>}
                    {m.is_jr && <span className="px-1.5 py-0.5 rounded bg-info-bg/30 text-info font-bold">JR</span>}
                    {m.com_balanca && <span className="px-1.5 py-0.5 rounded bg-surface-3 text-ink-muted">+balança</span>}
                    {m.com_ensacadeira && <span className="px-1.5 py-0.5 rounded bg-surface-3 text-ink-muted">+ensacadeira</span>}
                  </div>
                  <div className="flex items-baseline justify-between gap-2 text-[11px]">
                    <span className="text-ink-faint">
                      {m.producao_kgh ? `${m.producao_kgh} kg/h` : ''}
                      {m.armazenamento_kg ? ` · ${m.armazenamento_kg} kg` : ''}
                    </span>
                    <span className="font-bold text-success tabular-nums">{formatBRL(m.total_proposta)}</span>
                  </div>
                  <div className="text-[10px] text-ink-faint mt-1">
                    {m.itens.length} items + {m.motores.length} motores
                  </div>
                </button>
              )
            })}
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(1)}
              className="bg-surface-2 hover:bg-surface-3 text-ink font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
            <button
              disabled={!modeloId}
              onClick={() => setStep(3)}
              className="bg-accent hover:bg-accent-700 disabled:bg-surface-3 disabled:cursor-not-allowed text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
            >
              Próximo: Editar items
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Card>
      )}

      {/* ============== STEP 3 — Editar items ============== */}
      {step === 3 && modeloSelecionado && (
        <Card className="p-5 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2">
                <ListChecks className="h-4 w-4" /> Editar Items do Orçamento
              </h2>
              <p className="text-[11px] text-ink-muted mt-0.5">
                Modelo: <strong className="text-ink">{modeloSelecionado.basename}</strong> · Pode ajustar quantidades, valores ou remover items
              </p>
            </div>
            <div className="text-right">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted">Total Proposta</div>
              <div className="text-[20px] font-bold text-success tabular-nums">{formatBRL(totalProposta)}</div>
            </div>
          </div>

          {/* Items */}
          <div className="space-y-2">
            <div className="text-[11px] uppercase tracking-wider text-ink-muted font-bold">Equipamentos</div>
            {itens.map((it, i) => (
              <div key={i} className="p-3 bg-surface-2 rounded-md border border-border">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    <span className="text-[14px] font-bold text-accent shrink-0">{it.letra}</span>
                    <input
                      type="number"
                      min={1}
                      value={it.qtd}
                      onChange={e => {
                        const v = [...itens]
                        v[i].qtd = parseInt(e.target.value) || 1
                        setItens(v)
                      }}
                      className="w-12 text-center px-1 py-0.5 bg-bg border border-border rounded text-[12px]"
                    />
                    <input
                      type="text"
                      value={it.nome}
                      onChange={e => {
                        const v = [...itens]
                        v[i].nome = e.target.value
                        setItens(v)
                      }}
                      className="flex-1 px-2 py-0.5 bg-bg border border-border rounded text-[12px] font-bold text-ink"
                    />
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-[10px] text-ink-faint">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={it.valor}
                      onChange={e => {
                        const v = [...itens]
                        v[i].valor = parseFloat(e.target.value) || 0
                        setItens(v)
                      }}
                      className="w-24 text-right px-2 py-0.5 bg-bg border border-border rounded text-[12px] tabular-nums font-bold"
                    />
                    <button
                      onClick={() => setItens(itens.filter((_, j) => j !== i))}
                      className="text-danger hover:text-danger-700 p-1"
                      title="Remover item"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {it.specs.length > 0 && (
                  <ul className="text-[10px] text-ink-faint space-y-0.5 ml-6">
                    {it.specs.slice(0, 4).map((s, j) => (
                      <li key={j}>• {s}</li>
                    ))}
                    {it.specs.length > 4 && <li>... +{it.specs.length - 4} specs</li>}
                  </ul>
                )}
              </div>
            ))}
          </div>

          {/* Acessórios */}
          {acessorios && acessorios.items.length > 0 && (
            <div className="p-3 bg-surface-2 rounded-md border border-border">
              <div className="flex items-center justify-between gap-3 mb-2">
                <span className="text-[11px] uppercase tracking-wider text-accent font-bold">Acessórios</span>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] text-ink-faint">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={acessorios.valor}
                    onChange={e => setAcessorios({ ...acessorios, valor: parseFloat(e.target.value) || 0 })}
                    className="w-24 text-right px-2 py-0.5 bg-bg border border-border rounded text-[12px] tabular-nums font-bold"
                  />
                  <button
                    onClick={() => setAcessorios(null)}
                    className="text-danger hover:text-danger-700 p-1"
                    title="Remover acessórios"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <ul className="text-[11px] text-ink-muted space-y-0.5">
                {acessorios.items.map((s, j) => <li key={j}>• {s}</li>)}
              </ul>
            </div>
          )}

          {/* Motores */}
          {motores.length > 0 && (
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-ink-muted font-bold">
                Motores ({modeloSelecionado.voltagem})
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {motores.map((m, i) => (
                  <div key={i} className="p-2.5 bg-surface-2 rounded-md border border-border flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      value={m.cv}
                      onChange={e => {
                        const v = [...motores]
                        v[i].cv = parseFloat(e.target.value) || 0
                        setMotores(v)
                      }}
                      className="w-14 text-center px-1 py-0.5 bg-bg border border-border rounded text-[12px]"
                    />
                    <span className="text-[11px] text-ink-faint">CV</span>
                    <input
                      type="number"
                      value={m.polos}
                      onChange={e => {
                        const v = [...motores]
                        v[i].polos = parseInt(e.target.value) || 0
                        setMotores(v)
                      }}
                      className="w-12 text-center px-1 py-0.5 bg-bg border border-border rounded text-[12px]"
                    />
                    <span className="text-[11px] text-ink-faint">polos</span>
                    <span className="flex-1" />
                    <span className="text-[10px] text-ink-faint">R$</span>
                    <input
                      type="number"
                      step="0.01"
                      value={m.valor}
                      onChange={e => {
                        const v = [...motores]
                        v[i].valor = parseFloat(e.target.value) || 0
                        setMotores(v)
                      }}
                      className="w-20 text-right px-2 py-0.5 bg-bg border border-border rounded text-[12px] tabular-nums font-bold"
                    />
                    <button
                      onClick={() => setMotores(motores.filter((_, j) => j !== i))}
                      className="text-danger hover:text-danger-700 p-1"
                      title="Remover motor"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Resumo */}
          <div className="border-t border-border pt-3 space-y-1">
            <div className="flex justify-between text-[12px] text-ink-muted">
              <span>Total Equipamentos</span>
              <span className="tabular-nums">{formatBRL(totalEquip)}</span>
            </div>
            <div className="flex justify-between text-[12px] text-ink-muted">
              <span>Total Motores</span>
              <span className="tabular-nums">{formatBRL(totalMotores)}</span>
            </div>
            <div className="flex justify-between text-[16px] font-bold text-success border-t border-border pt-2">
              <span>TOTAL DA PROPOSTA</span>
              <span className="tabular-nums">{formatBRL(totalProposta)}</span>
            </div>
          </div>

          <div className="flex justify-between pt-2">
            <button
              onClick={() => setStep(2)}
              className="bg-surface-2 hover:bg-surface-3 text-ink font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
            <button
              onClick={() => setStep(4)}
              className="bg-accent hover:bg-accent-700 text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
            >
              Próximo: Gerar PDF
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </Card>
      )}

      {/* ============== STEP 4 — Gerar ============== */}
      {step === 4 && modeloSelecionado && (
        <Card className="p-5 space-y-4">
          <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2">
            <Eye className="h-4 w-4" /> Conferir e Gerar
          </h2>

          {/* Sincronizar com pasta Z: */}
          {isFolderScanSupported() ? (
            <div className="p-3 bg-info-bg/15 border border-info/30 rounded-md space-y-2">
              <div className="flex items-center gap-2 flex-wrap">
                <FolderOpen className="h-4 w-4 text-info shrink-0" />
                <span className="text-[12px] font-semibold text-info">Próximo número</span>
                <span className="flex-1" />
                {scanInfo ? (
                  <button
                    type="button"
                    disabled={scanLoading}
                    onClick={handleRescanFolder}
                    title="Reler pasta atual"
                    className="text-[11px] px-2.5 py-1 rounded bg-info/20 hover:bg-info/30 text-info font-semibold flex items-center gap-1"
                  >
                    <RefreshCw className={`h-3 w-3 ${scanLoading ? 'animate-spin' : ''}`} />
                    {scanLoading ? 'Lendo...' : 'Reler pasta'}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={scanLoading}
                    onClick={handlePickFolder}
                    className="text-[11px] px-2.5 py-1 rounded bg-info/20 hover:bg-info/30 text-info font-semibold flex items-center gap-1"
                  >
                    <FolderOpen className="h-3 w-3" />
                    {scanLoading ? 'Lendo...' : 'Escolher pasta Z:'}
                  </button>
                )}
              </div>
              {scanInfo ? (
                <div className="text-[11px] text-ink-muted">
                  Pasta lida: <strong className="text-ink">{scanInfo.total} arquivos</strong> de {scanInfo.ano}
                  {' · '}último: <strong className="text-ink font-mono">{formatarNumero(scanInfo.ano, scanInfo.ultimo)}</strong>
                  {' · '}próximo: <strong className="text-success font-mono">{formatarNumero(scanInfo.ano, scanInfo.ultimo + 1)}</strong>
                </div>
              ) : (
                <div className="text-[11px] text-ink-muted">
                  Número atual vem do banco. Pra ler direto da pasta Z:, clique em "Escolher pasta Z:" e selecione <code className="bg-surface-3 px-1 rounded">Z:\1 - Comercial\3 - Orçamento\2026</code>. O navegador lembra a permissão.
                </div>
              )}
            </div>
          ) : (
            <div className="p-2 bg-warning-bg/15 border border-warning/30 rounded-md text-[11px] text-warning">
              Seu navegador não suporta leitura da pasta Z: (use Chrome ou Edge). Número está vindo do banco.
            </div>
          )}

          {/* Resumo do orçamento */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
            <div className="p-3 bg-surface-2 rounded-md">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Número</div>
              <div className="font-mono font-bold text-accent text-[16px]">{numeroAtual || 'carregando...'}</div>
            </div>
            <div className="p-3 bg-surface-2 rounded-md">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Cliente</div>
              <div className="font-bold text-ink truncate">{cliNome}</div>
              {cliDados.cidade && <div className="text-[10px] text-ink-faint">{cliDados.cidade}</div>}
            </div>
            <div className="p-3 bg-surface-2 rounded-md">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted mb-1">Modelo</div>
              <div className="font-bold text-ink truncate">{modeloSelecionado.basename}</div>
              <div className="text-[10px] text-ink-faint">{itens.length} items + {motores.length} motores</div>
            </div>
            <div className="p-3 bg-success-bg/15 border border-success/30 rounded-md">
              <div className="text-[10px] uppercase tracking-wider text-success mb-1">Total Proposta</div>
              <div className="font-bold text-success text-[20px] tabular-nums">{formatBRL(totalProposta)}</div>
            </div>
          </div>

          {/* Forma de pagamento + prazo de entrega */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Forma de pagamento
              </label>
              <Input
                value={formaPagamento}
                onChange={e => setFormaPagamento(e.target.value)}
                placeholder='Ex: "À vista 5% desconto" ou "30/60/90 dias"'
                className="mt-1"
              />
              <div className="text-[10px] text-ink-faint mt-1">
                Substitui "a combinar" no .docx. Sugestões:
                {' '}
                {['À vista 5% desconto', '50% entrada + 50% no envio', '30/60/90 dias', 'Boleto à vista', 'PIX 7% desconto'].map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setFormaPagamento(s)}
                    className="inline-block mx-0.5 px-1.5 py-0.5 rounded bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">
                Prazo de entrega
              </label>
              <Input
                value={prazoEntrega}
                onChange={e => setPrazoEntrega(e.target.value)}
                placeholder="Padrão: 90 dias (úteis)"
                className="mt-1"
              />
              <div className="text-[10px] text-ink-faint mt-1">Deixe em branco pra usar o padrão.</div>
            </div>
          </div>

          {/* Observações */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Observações (opcional)</label>
            <textarea
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
              placeholder="Notas adicionais..."
              rows={3}
              className="mt-1 w-full p-2 bg-surface-2 border border-border rounded-md text-[12px] text-ink focus:border-accent outline-none"
            />
          </div>

          <div className="text-[11px] text-ink-muted bg-info-bg/15 border border-info/30 rounded-md p-3">
            <strong>Como funciona:</strong> o orçamento é gerado a partir do <strong>.docx oficial Branorte</strong> (mesmo arquivo que vocês usam hoje), só preenchendo os campos do cliente. O resultado é IDÊNTICO ao formato atual — pode abrir no Word e salvar como PDF.
          </div>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            <button
              onClick={() => setStep(3)}
              className="bg-surface-2 hover:bg-surface-3 text-ink font-semibold px-4 py-2 rounded-md flex items-center gap-2"
            >
              <ArrowLeft className="h-4 w-4" />
              Voltar
            </button>
            <span className="flex-1" />
            <button
              disabled={gerando}
              onClick={() => handleGerar({ formato: 'nenhum', status: 'rascunho' })}
              className="bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-ink font-semibold px-4 py-2 rounded-md flex items-center gap-2"
            >
              <Save className="h-4 w-4" />
              Salvar rascunho
            </button>
            <button
              disabled={gerando}
              onClick={() => handleGerar({ formato: 'docx', status: 'enviado' })}
              className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
            >
              <FileDown className="h-4 w-4" />
              {gerando ? 'Gerando…' : 'Gerar .docx Branorte'}
            </button>
          </div>
        </Card>
      )}
    </div>
  )
}
