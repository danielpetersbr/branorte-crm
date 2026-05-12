import { useEffect, useMemo, useState } from 'react'
import { X, Check, Loader2, FileText, FileDown, FolderOpen, RefreshCw, Calendar, CreditCard } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import {
  useClientesOrcamento, obterProximoNumero, useCriarOrcamento,
  type ClienteDados, type OrcamentoItem, type OrcamentoMotor,
} from '@/hooks/useOrcamentoBuilder'
import { useAuth } from '@/hooks/useAuth'
import { gerarPdfDoPreview } from '@/lib/preview-to-pdf'
import { gerarDocxDoPreview } from '@/lib/preview-to-docx'
import {
  isFolderScanSupported, pickOrcamentoFolder, getStoredFolderHandle,
  scanFolderForLastNumber, formatarNumero, ensureWritePermission,
  resolverPastaDoMes, escreverArquivo,
} from '@/lib/orcamento-folder-scan'
import { construirFormaPagamento, type TipoPagamento, type FormaPagamentoConfig } from '@/lib/forma-pagamento'

export interface CarrinhoSnapshot {
  voltagem: 'monofasico' | 'trifasico'
  itens: Array<{
    nome: string
    qtd: number
    valor: number
    specs: string[]
    motor_cv: number | null
    motor_polos: number | null
    motor_qtd: number
    motor_valor_unit: number
    foto_url?: string | null
  }>
  motoresAgrupados: Array<{
    cv: number
    polos: number
    qtd: number
    valor_unit: number
    valor_total: number
  }>
  acessorios: { pct: number; items: string[]; valor: number } | null
  totalItems: number          // só os itens, sem acessórios
  totalMotores: number
  totalEquip: number          // itens + acessórios (= "VALOR TOTAL DE EQUIPAMENTOS")
  totalGeral: number          // totalEquip + totalMotores
  fotoPrincipal?: string | null
}

interface Props {
  open: boolean
  snapshot: CarrinhoSnapshot
  onClose: () => void
  onSuccess: (info: { numero: string; baixouDocx: boolean; baixouPdf: boolean; salvouNaPasta: boolean }) => void
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function nomeBase(numero: string, cliente: string, isTest = false): string {
  const sanitize = (s: string) => s.replace(/[<>:"/\\|?*]/g, '').slice(0, 80).trim()
  if (isTest) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19)  // HH-MM-SS
    return `TESTE-${ts}-${sanitize(cliente || 'cliente')} (${numero})`
  }
  return `${numero} - ${sanitize(cliente || 'Sem cliente')} (Personalizado)`
}

function baixarBlob(blob: Blob, nome: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = nome
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function FinalizarMontarModal({ open, snapshot, onClose, onSuccess }: Props) {
  const { profile } = useAuth()
  const criar = useCriarOrcamento()

  // Cliente
  const [cliNome, setCliNome] = useState('')
  const [cliDados, setCliDados] = useState<ClienteDados>({})
  const [searchCli, setSearchCli] = useState('')
  const { data: clientesSugeridos } = useClientesOrcamento(searchCli)

  // Dados extras
  const [prazoEntrega, setPrazoEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')

  // Forma de pagamento
  const [pgTipo, setPgTipo] = useState<TipoPagamento>('avista')
  const [pgDataVenda, setPgDataVenda] = useState<string>('')
  const [pgAvistaMeio, setPgAvistaMeio] = useState<'pix' | 'transferencia' | 'boleto' | 'dinheiro' | ''>('pix')
  const [pgAvistaDesconto, setPgAvistaDesconto] = useState<number>(5)
  const [pgNumParcelas, setPgNumParcelas] = useState<number>(3)
  const [pgIntervalo, setPgIntervalo] = useState<number>(30)
  const [pgPrimeiraEm, setPgPrimeiraEm] = useState<string>('')
  const [pgEntradaPct, setPgEntradaPct] = useState<number>(50)
  const [pgParcelasApos, setPgParcelasApos] = useState<number>(1)
  const [pgCustom, setPgCustom] = useState<string>('')

  // Número (folder scan ou banco)
  const [numeroAtual, setNumeroAtual] = useState<string>('')
  const [numeroFonte, setNumeroFonte] = useState<'pasta' | 'banco' | null>(null)
  const [scanInfo, setScanInfo] = useState<{ ultimo: number; total: number; ano: number } | null>(null)
  const [scanLoading, setScanLoading] = useState(false)

  const [gerando, setGerando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Carrega número quando abre o modal
  useEffect(() => {
    if (!open) return
    if (numeroAtual) return
    ;(async () => {
      try {
        const handle = await getStoredFolderHandle()
        if (handle) {
          const scan = await scanFolderForLastNumber(handle)
          setScanInfo({ ultimo: scan.ultimoNumero, total: scan.total, ano: scan.ano })
          setNumeroAtual(formatarNumero(scan.ano, scan.proximoNumero))
          setNumeroFonte('pasta')
          return
        }
      } catch {}
      try {
        const r = await obterProximoNumero()
        setNumeroAtual(r.numero)
        setNumeroFonte('banco')
      } catch {
        setNumeroAtual('—')
        setNumeroFonte(null)
      }
    })()
  }, [open, numeroAtual])

  const formaPagamentoCfg: FormaPagamentoConfig = {
    tipo: pgTipo,
    data_venda: pgDataVenda || undefined,
    avista_meio: pgAvistaMeio || undefined,
    avista_desconto_pct: pgAvistaDesconto || undefined,
    num_parcelas: pgNumParcelas,
    intervalo_dias: pgIntervalo,
    primeira_em: pgPrimeiraEm || undefined,
    entrada_pct: pgEntradaPct,
    parcelas_apos_entrada: pgParcelasApos,
    texto_custom: pgCustom || undefined,
  }
  const formaPgOut = useMemo(() => construirFormaPagamento(formaPagamentoCfg), [
    pgTipo, pgDataVenda, pgAvistaMeio, pgAvistaDesconto,
    pgNumParcelas, pgIntervalo, pgPrimeiraEm,
    pgEntradaPct, pgParcelasApos, pgCustom,
  ])

  function aplicarCliente(c: NonNullable<typeof clientesSugeridos>[number]) {
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

  async function handleRescan() {
    setScanLoading(true)
    try {
      let handle = await getStoredFolderHandle()
      if (!handle) handle = await pickOrcamentoFolder()
      const scan = await scanFolderForLastNumber(handle)
      setScanInfo({ ultimo: scan.ultimoNumero, total: scan.total, ano: scan.ano })
      setNumeroAtual(formatarNumero(scan.ano, scan.proximoNumero))
      setNumeroFonte('pasta')
    } catch (e) {
      const msg = (e as Error).message
      if (!/abort|cancel/i.test(msg)) alert('Erro: ' + msg)
    } finally {
      setScanLoading(false)
    }
  }

  async function handlePickFolder() {
    setScanLoading(true)
    try {
      const handle = await pickOrcamentoFolder()
      const scan = await scanFolderForLastNumber(handle)
      setScanInfo({ ultimo: scan.ultimoNumero, total: scan.total, ano: scan.ano })
      setNumeroAtual(formatarNumero(scan.ano, scan.proximoNumero))
      setNumeroFonte('pasta')
    } catch (e) {
      const msg = (e as Error).message
      if (!/abort|cancel/i.test(msg)) alert('Erro: ' + msg)
    } finally {
      setScanLoading(false)
    }
  }

  async function handleGerar(opcoes: { salvarNaPasta: boolean }) {
    if (!cliNome.trim()) {
      setErro('Nome do cliente obrigatório')
      return
    }
    setGerando(true)
    setErro(null)
    try {
      const hoje = new Date()
      const dataEmissaoBR = hoje.toLocaleDateString('pt-BR')

      // 1) Re-scan pasta pra pegar número fresquinho se for salvar lá
      let numeroOverride: { ano: number; sequencial: number; numero: string } | null =
        (numeroFonte === 'pasta' && scanInfo)
          ? { ano: scanInfo.ano, sequencial: scanInfo.ultimo + 1, numero: formatarNumero(scanInfo.ano, scanInfo.ultimo + 1) }
          : null

      if (opcoes.salvarNaPasta && isFolderScanSupported()) {
        try {
          const handle = await getStoredFolderHandle(true)
          if (handle) {
            const fresh = await scanFolderForLastNumber(handle)
            numeroOverride = {
              ano: fresh.ano,
              sequencial: fresh.proximoNumero,
              numero: formatarNumero(fresh.ano, fresh.proximoNumero),
            }
            setScanInfo({ ultimo: fresh.ultimoNumero, total: fresh.total, ano: fresh.ano })
            setNumeroAtual(numeroOverride.numero)
            setNumeroFonte('pasta')
          }
        } catch {}
      }

      // 2) Mapeia carrinho pra formato do builder
      const itensDocx: CustomDocxItem[] = snapshot.itens.map((it, idx) => ({
        letra: String.fromCharCode(65 + idx),
        qtd: it.qtd,
        nome: it.nome,
        specs: it.specs,
        valor: it.valor,
        motor_cv: it.motor_cv,
        motor_polos: it.motor_polos,
        motor_qtd: it.motor_qtd,
        foto_url: it.foto_url ?? null,
      }))

      const motoresDocx: CustomDocxMotor[] = snapshot.motoresAgrupados.map(m => ({
        cv: m.cv,
        polos: m.polos,
        qtd: m.qtd,
        valor_unit: m.valor_unit,
        valor_total: m.valor_total,
      }))

      // 3) Cria registro no DB
      const itensDb: OrcamentoItem[] = snapshot.itens.map((it, idx) => ({
        letra: String.fromCharCode(65 + idx),
        qtd: it.qtd,
        nome: it.nome,
        specs: it.specs,
        valor: it.valor,
      }))
      const motoresDb: OrcamentoMotor[] = snapshot.motoresAgrupados.map(m => ({
        cv: m.cv,
        polos: m.polos,
        valor: m.valor_total,
      }))

      const orc = await criar.mutateAsync({
        vendedor_nome: profile?.display_name?.toUpperCase() || 'DESCONHECIDO',
        cliente_nome: cliNome.trim(),
        cliente_dados: cliDados,
        modelo_id: null,
        modelo_basename: 'PERSONALIZADO',
        voltagem: snapshot.voltagem,
        itens: itensDb,
        acessorios: snapshot.acessorios
          ? { items: snapshot.acessorios.items, valor: snapshot.acessorios.valor }
          : null,
        motores: motoresDb,
        total_equipamentos: snapshot.totalEquip,
        total_motores: snapshot.totalMotores,
        total_proposta: snapshot.totalGeral,
        observacoes: observacoes.trim() || null,
        forma_pagamento: formaPgOut.forma_pagamento || null,
        prazo_entrega: prazoEntrega.trim() || null,
        status: 'rascunho',
        numero_override: numeroOverride,
      })

      // 4) Gera .docx (mesma estrategia do PDF — captura preview HTML como imagem)
      const previewProps = {
        carrinho: snapshot.itens.map((it, idx) => ({
          uid: `pdf-${idx}`,
          categoria: '',
          nome: it.nome,
          specs: it.specs,
          qtd: it.qtd,
          valor: it.valor,
          motor_cv: it.motor_cv,
          motor_polos: it.motor_polos,
          motor_qtd: it.motor_qtd,
          motor_valor_unit: it.motor_valor_unit,
          foto_url: it.foto_url ?? null,
        })),
        motoresAgrupados: snapshot.motoresAgrupados,
        voltagem: snapshot.voltagem,
        totalItems: snapshot.totalItems,
        totalMotores: snapshot.totalMotores,
        totalEquip: snapshot.totalEquip,
        totalGeral: snapshot.totalGeral,
        acessorios: snapshot.acessorios
          ? { pct: snapshot.acessorios.pct, items: snapshot.acessorios.items }
          : null,
        valorAcessorios: snapshot.acessorios?.valor ?? 0,
        numero: orc.numero,
        dataEmissao: dataEmissaoBR,
        cliente: {
          nome: cliNome.trim(),
          ac: cliDados.ac,
          fone: cliDados.fone,
          cidade: cliDados.cidade,
          bairro: cliDados.bairro,
          endereco: cliDados.endereco,
          cep: cliDados.cep,
          cnpj: cliDados.cnpj,
          ie: cliDados.ie,
          email: cliDados.email,
        },
        terms: {
          dataVenda: pgDataVenda ? formaPgOut.data_venda : null,
          prazoEntrega: prazoEntrega.trim() || null,
          formaPagamento: formaPgOut.forma_pagamento || null,
        },
        observacoesExtra: observacoes.trim() || null,
        fotoPrincipal: snapshot.fotoPrincipal ?? null,
      }
      const docxBlob = await gerarDocxDoPreview(previewProps)

      // 5) Gera PDF a partir do MESMO previewProps que ja foi usado pro DOCX
      let pdfBlob: Blob | null = null
      let pdfErro: string | null = null
      try {
        pdfBlob = await gerarPdfDoPreview(previewProps)
      } catch (e) {
        pdfErro = (e as Error).message
        console.warn('Falha PDF:', pdfErro)
      }

      // Detecta modo teste: se rootHandle salvo tem 'teste' no nome
      let isTesteMode = false
      try {
        const h = await getStoredFolderHandle()
        if (h && (h as any).name && /teste/i.test((h as any).name)) isTesteMode = true
      } catch {}
      const base = nomeBase(orc.numero, cliNome, isTesteMode)
      let baixouDocx = false, baixouPdf = false, salvouNaPasta = false

      // 6a) Salvar na pasta Z: se solicitado
      if (opcoes.salvarNaPasta) {
        try {
          let handle = await getStoredFolderHandle(true)
          if (!handle) handle = await pickOrcamentoFolder(true)
          if (handle) {
            const ok = await ensureWritePermission(handle)
            if (!ok) throw new Error('Permissão de escrita negada')

            const resolved = await resolverPastaDoMes(handle, hoje)
            let pastaMes
            if (resolved.ok) {
              pastaMes = resolved.pastaMes
            } else if (resolved.sugestaoCriar) {
              pastaMes = await resolved.sugestaoCriar()
            } else {
              throw new Error(resolved.motivo)
            }
            await escreverArquivo(pastaMes, `${base}.docx`, docxBlob)
            if (pdfBlob) await escreverArquivo(pastaMes, `${base}.pdf`, pdfBlob)
            salvouNaPasta = true
          }
        } catch (e) {
          console.warn('Falha salvar pasta:', e)
          // Fallback: baixa direto
          baixarBlob(docxBlob, `${base}.docx`)
          baixouDocx = true
          if (pdfBlob) {
            baixarBlob(pdfBlob, `${base}.pdf`)
            baixouPdf = true
          }
        }
      } else {
        // 6b) Download direto
        baixarBlob(docxBlob, `${base}.docx`)
        baixouDocx = true
        if (pdfBlob) {
          baixarBlob(pdfBlob, `${base}.pdf`)
          baixouPdf = true
        }
      }

      onSuccess({ numero: orc.numero, baixouDocx, baixouPdf, salvouNaPasta })
      if (pdfErro) alert(`Orçamento gerado, mas PDF falhou: ${pdfErro}\n.docx foi gerado normalmente.`)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      setGerando(false)
    }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !gerando && onClose()}>
      <div
        className="bg-bg border border-border rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-bg z-10">
          <h2 className="text-[16px] font-semibold text-ink flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" />
            Finalizar orçamento personalizado
          </h2>
          <button onClick={onClose} disabled={gerando} className="text-ink-faint hover:text-ink p-1 disabled:opacity-30">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-4">
          {/* Resumo carrinho */}
          <div className="p-3 bg-surface-2/30 border border-border rounded-md text-[11px]">
            <div className="flex items-center justify-between mb-1">
              <span className="font-semibold text-ink">Resumo do orçamento</span>
              <span className="text-ink-muted">{snapshot.voltagem === 'monofasico' ? 'MONOFÁSICO' : 'TRIFÁSICO'}</span>
            </div>
            <div className="flex justify-between text-ink-muted">
              <span>{snapshot.itens.length} {snapshot.itens.length === 1 ? 'item' : 'items'}</span>
              <span>{formatBRL(snapshot.totalItems)}</span>
            </div>
            {snapshot.totalMotores > 0 && (
              <div className="flex justify-between text-ink-muted">
                <span>{snapshot.motoresAgrupados.length} {snapshot.motoresAgrupados.length === 1 ? 'motor' : 'motores'}</span>
                <span>{formatBRL(snapshot.totalMotores)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-ink mt-1 pt-1 border-t border-border">
              <span>TOTAL</span>
              <span className="text-accent">{formatBRL(snapshot.totalGeral)}</span>
            </div>
          </div>

          {/* Número */}
          <div className="p-3 border border-border rounded-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Número do orçamento</span>
              <span className={`text-[9px] px-1.5 py-0.5 rounded ${numeroFonte === 'pasta' ? 'bg-success-bg/30 text-success' : 'bg-warning-bg/30 text-warning'}`}>
                {numeroFonte === 'pasta' ? '📁 da pasta Z:' : '🗄️ do banco'}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="text-[18px] font-bold text-accent">{numeroAtual || '—'}</div>
              {isFolderScanSupported() && (
                <>
                  <button
                    onClick={handleRescan}
                    disabled={scanLoading}
                    className="text-[10px] text-ink-muted hover:text-ink flex items-center gap-1 ml-auto disabled:opacity-30"
                    title="Re-escanear pasta"
                  >
                    {scanLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                    Reler pasta
                  </button>
                  {!scanInfo && (
                    <button
                      onClick={handlePickFolder}
                      className="text-[10px] text-accent hover:underline flex items-center gap-1"
                    >
                      <FolderOpen className="h-3 w-3" />
                      Escolher pasta
                    </button>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Cliente */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Cliente *</label>
            <Input
              value={cliNome}
              onChange={e => { setCliNome(e.target.value); setSearchCli(e.target.value) }}
              placeholder="Nome do cliente..."
              className="mt-1"
            />
            {searchCli && (clientesSugeridos?.length ?? 0) > 0 && (
              <div className="mt-1 border border-border rounded-md max-h-40 overflow-y-auto bg-surface-2">
                {clientesSugeridos!.slice(0, 8).map(c => (
                  <button
                    key={c.id}
                    onClick={() => aplicarCliente(c)}
                    className="block w-full text-left px-2 py-1.5 hover:bg-surface-3 text-[11px] border-b border-border last:border-0"
                  >
                    <div className="font-medium text-ink">{c.nome}</div>
                    {c.cidade && <div className="text-[10px] text-ink-faint">{c.cidade}</div>}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Dados do cliente (compacto) */}
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="A/C" value={cliDados.ac ?? ''} onChange={e => setCliDados(d => ({ ...d, ac: e.target.value }))} className="text-[12px]" />
            <Input placeholder="Telefone" value={cliDados.fone ?? ''} onChange={e => setCliDados(d => ({ ...d, fone: e.target.value }))} className="text-[12px]" />
            <Input placeholder="Cidade" value={cliDados.cidade ?? ''} onChange={e => setCliDados(d => ({ ...d, cidade: e.target.value }))} className="text-[12px]" />
            <Input placeholder="Bairro" value={cliDados.bairro ?? ''} onChange={e => setCliDados(d => ({ ...d, bairro: e.target.value }))} className="text-[12px]" />
            <Input placeholder="Endereço" value={cliDados.endereco ?? ''} onChange={e => setCliDados(d => ({ ...d, endereco: e.target.value }))} className="text-[12px] col-span-2" />
            <Input placeholder="CEP" value={cliDados.cep ?? ''} onChange={e => setCliDados(d => ({ ...d, cep: e.target.value }))} className="text-[12px]" />
            <Input placeholder="CPF/CNPJ" value={cliDados.cnpj ?? ''} onChange={e => setCliDados(d => ({ ...d, cnpj: e.target.value }))} className="text-[12px]" />
            <Input placeholder="I.E." value={cliDados.ie ?? ''} onChange={e => setCliDados(d => ({ ...d, ie: e.target.value }))} className="text-[12px]" />
            <Input placeholder="E-mail" value={cliDados.email ?? ''} onChange={e => setCliDados(d => ({ ...d, email: e.target.value }))} className="text-[12px]" />
          </div>

          {/* Forma de pagamento */}
          <div className="p-3 border border-border rounded-md space-y-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-muted font-semibold">
              <CreditCard className="h-3 w-3" />
              Forma de pagamento
            </div>
            <div className="flex gap-1 flex-wrap">
              {([['avista', 'À vista'], ['parcelado', 'Parcelado'], ['entrada', 'Entrada+Parcelas'], ['personalizado', 'Personalizado']] as const).map(([t, l]) => (
                <button
                  key={t}
                  onClick={() => setPgTipo(t)}
                  className={`text-[10px] px-2 py-1 rounded font-semibold ${
                    pgTipo === t ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[9px] uppercase tracking-wider text-ink-muted">Data da venda</label>
                <Input type="date" value={pgDataVenda} onChange={e => setPgDataVenda(e.target.value)} className="text-[11px]" />
              </div>
              {pgTipo === 'avista' && (
                <div>
                  <label className="text-[9px] uppercase tracking-wider text-ink-muted">Desconto % (à vista)</label>
                  <Input type="number" value={pgAvistaDesconto} onChange={e => setPgAvistaDesconto(Number(e.target.value) || 0)} className="text-[11px]" />
                </div>
              )}
              {pgTipo === 'parcelado' && (
                <>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-ink-muted">Nº parcelas</label>
                    <Input type="number" value={pgNumParcelas} onChange={e => setPgNumParcelas(Number(e.target.value) || 1)} className="text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-ink-muted">Intervalo (dias)</label>
                    <Input type="number" value={pgIntervalo} onChange={e => setPgIntervalo(Number(e.target.value) || 30)} className="text-[11px]" />
                  </div>
                </>
              )}
              {pgTipo === 'entrada' && (
                <>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-ink-muted">Entrada %</label>
                    <Input type="number" value={pgEntradaPct} onChange={e => setPgEntradaPct(Number(e.target.value) || 50)} className="text-[11px]" />
                  </div>
                  <div>
                    <label className="text-[9px] uppercase tracking-wider text-ink-muted">Parcelas depois</label>
                    <Input type="number" value={pgParcelasApos} onChange={e => setPgParcelasApos(Number(e.target.value) || 1)} className="text-[11px]" />
                  </div>
                </>
              )}
              {pgTipo === 'personalizado' && (
                <div className="col-span-2">
                  <label className="text-[9px] uppercase tracking-wider text-ink-muted">Texto livre</label>
                  <Input value={pgCustom} onChange={e => setPgCustom(e.target.value)} placeholder="Descrever forma de pagamento..." className="text-[11px]" />
                </div>
              )}
            </div>
            {formaPgOut.forma_pagamento && (
              <div className="text-[10px] italic text-ink-faint border-t border-border pt-1.5">
                Pré-visualização: <span className="font-medium text-ink-muted">{formaPgOut.forma_pagamento}</span>
              </div>
            )}
          </div>

          {/* Prazo entrega + observações */}
          <div>
            <label className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Prazo de entrega</label>
            <Input value={prazoEntrega} onChange={e => setPrazoEntrega(e.target.value)} placeholder="Ex: 30 dias após confirmação do pagamento" className="mt-1" />
          </div>
          <div>
            <label className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Observações</label>
            <textarea
              value={observacoes}
              onChange={e => setObservacoes(e.target.value)}
              placeholder="Observações adicionais (opcional)..."
              rows={3}
              className="w-full mt-1 px-2 py-1.5 text-[12px] bg-surface-2 border border-border rounded-md focus:outline-none focus:border-accent"
            />
          </div>

          {snapshot.fotoPrincipal && (
            <div className="border border-border rounded p-2 bg-surface-2/30">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">Foto principal incluída</div>
              <img src={snapshot.fotoPrincipal} alt="preview" className="max-h-32 mx-auto" />
            </div>
          )}

          {erro && (
            <div className="p-3 bg-danger-bg/15 border border-danger/30 rounded-md text-[11px] text-danger">
              {erro}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 p-4 border-t border-border sticky bottom-0 bg-bg">
          <button
            onClick={onClose}
            disabled={gerando}
            className="text-[12px] px-4 py-2 rounded bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink font-semibold disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={() => handleGerar({ salvarNaPasta: false })}
            disabled={gerando || !cliNome.trim()}
            className="text-[12px] px-4 py-2 rounded bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink font-semibold disabled:opacity-50 flex items-center gap-1.5"
          >
            <FileDown className="h-3.5 w-3.5" />
            Baixar .docx + PDF
          </button>
          <button
            onClick={() => handleGerar({ salvarNaPasta: true })}
            disabled={gerando || !cliNome.trim() || !isFolderScanSupported()}
            className="text-[12px] px-5 py-2 rounded bg-accent hover:bg-accent-700 text-white font-semibold disabled:opacity-50 flex items-center gap-1.5"
            title={!isFolderScanSupported() ? 'Use Chrome/Edge pra salvar direto na pasta Z:' : ''}
          >
            {gerando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FolderOpen className="h-3.5 w-3.5" />}
            {gerando ? 'Gerando...' : 'Salvar na pasta Z:'}
          </button>
        </div>
      </div>
    </div>
  )
}
