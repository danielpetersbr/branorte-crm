import { useMemo, useState, useEffect, useCallback } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatNumber } from '@/lib/utils'
import {
  FileText, ArrowRight, ArrowLeft, Check, User, Package, ListChecks, Eye,
  Plus, Trash2, FileDown, Save, Search, Loader2,
} from 'lucide-react'
import {
  useOrcamentoModelos, useClientesOrcamento, useCriarOrcamento,
  obterProximoNumero, subirModeloCustomizado,
  type OrcamentoModelo, type OrcamentoItem, type OrcamentoMotor,
  type OrcamentoAcessorios, type ClienteDados,
} from '@/hooks/useOrcamentoBuilder'
import { useQueryClient } from '@tanstack/react-query'
import { UploadModeloModal } from '@/components/UploadModeloModal'
import { useAuth } from '@/hooks/useAuth'
import { baixarOrcamentoPdf } from '@/lib/orcamento-pdf'
import {
  baixarOrcamentoDocx, gerarOrcamentoDocx, prepararDocxParaPdf,
  nomeBaseArquivo, montarNotaTxt,
} from '@/lib/orcamento-docx'
import { docxParaPdf } from '@/lib/docx-to-pdf'
import { isGotenbergConfigured, gerarPdfDoDocxGotenberg } from '@/lib/gotenberg-pdf'
import {
  isFolderScanSupported, pickOrcamentoFolder, getStoredFolderHandle,
  scanFolderForLastNumber, formatarNumero, ensureWritePermission,
  resolverPastaDoMes, escreverArquivo,
} from '@/lib/orcamento-folder-scan'
import { FolderOpen, RefreshCw, Calendar, CreditCard, FolderPlus, Upload, X } from 'lucide-react'
import { construirFormaPagamento, type TipoPagamento, type FormaPagamentoConfig } from '@/lib/forma-pagamento'

type Step = 1 | 2 | 3 | 4

const PACOTES_PADRAO = ['COMPACTA 01', 'COMPACTA 02', 'COMPACTA 03', 'MINI FABRICA']

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
  const queryClient = useQueryClient()

  // Modal de upload de modelo customizado
  const [uploadOpen, setUploadOpen] = useState(false)

  const [step, setStep] = useState<Step>(1)

  // Step 1 — Cliente (pré-preenche de ?nome=&phone= se vier da extensão WA)
  const _qsParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '')
  const _initNome = _qsParams.get('nome') || ''
  const _initPhone = _qsParams.get('phone') || ''
  const _fromExt = _qsParams.get('from') === 'ext'  // veio embedado pela extensão Branorte
  const _chatId = _qsParams.get('chat_id') || ''
  const [cliNome, setCliNome] = useState(_initNome)
  const [cliDados, setCliDados] = useState<ClienteDados>(_initPhone ? { fone: _initPhone } : {})
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
  const [prazoEntrega, setPrazoEntrega] = useState('')
  // Forma de pagamento estruturada
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
  const [numeroAtual, setNumeroAtual] = useState<string>('')
  const [gerando, setGerando] = useState(false)
  const [orcamentoSalvo, setOrcamentoSalvo] = useState<{ numero: string; id: number } | null>(null)
  // PDF blob mantido em memória pra enviar pro próprio WhatsApp do vendedor
  const [pdfBlobAtual, setPdfBlobAtual] = useState<Blob | null>(null)
  const [enviandoWA, setEnviandoWA] = useState<'idle' | 'enviando' | 'enviado' | 'erro'>('idle')
  const [enviandoWAMsg, setEnviandoWAMsg] = useState<string>('')

  // Aviso antes de fechar popup do orçamento se tiver dados não-salvos
  useEffect(() => {
    if (!_fromExt) return
    const handler = (e: BeforeUnloadEvent) => {
      if (cliNome.trim() && !orcamentoSalvo) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [cliNome, orcamentoSalvo, _fromExt])
  const [scanInfo, setScanInfo] = useState<{ ultimo: number; total: number; ano: number } | null>(null)
  const [scanLoading, setScanLoading] = useState(false)
  const [numeroFonte, setNumeroFonte] = useState<'pasta' | 'banco' | null>(null)

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

  // Constrói a string de forma de pagamento
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
  const formaPagamentoOut = useMemo(() => construirFormaPagamento(formaPagamentoCfg), [
    pgTipo, pgDataVenda, pgAvistaMeio, pgAvistaDesconto,
    pgNumParcelas, pgIntervalo, pgPrimeiraEm,
    pgEntradaPct, pgParcelasApos, pgCustom,
  ])

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
            setNumeroFonte('pasta')
            return
          }
        } catch {}
        // Fallback: usa banco
        try {
          const r = await obterProximoNumero()
          setNumeroAtual(r.numero)
          setNumeroFonte('banco')
        } catch {
          setNumeroAtual('—')
          setNumeroFonte(null)
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
      setNumeroFonte('pasta')
    } catch (e) {
      const msg = (e as Error).message
      if (!/abort|cancel/i.test(msg)) alert('Erro: ' + msg)
    } finally {
      setScanLoading(false)
    }
  }

  async function handleRescanFolder() {
    setScanLoading(true)
    try {
      let handle = await getStoredFolderHandle()
      if (!handle) {
        handle = await pickOrcamentoFolder()
      }
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

  const modelosFiltrados = useMemo(() => {
    if (!modelos) return []
    return modelos.filter(m => {
      if (filtroPacote && m.pacote !== filtroPacote) return false
      if (filtroVoltagem && m.voltagem !== filtroVoltagem) return false
      return true
    })
  }, [modelos, filtroPacote, filtroVoltagem])

  // Pacotes disponiveis: junta os padrao + custom (uploads dos usuarios)
  const pacotesDisponiveis = useMemo(() => {
    const dosModelos = new Set((modelos ?? []).map(m => m.pacote))
    // Ordena: padrao primeiro, custom depois (alfabético)
    const padrao = PACOTES_PADRAO.filter(p => dosModelos.has(p))
    const custom = [...dosModelos].filter(p => !PACOTES_PADRAO.includes(p)).sort()
    return [...padrao, ...custom]
  }, [modelos])

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

  // Resultado do salvamento — usado no success message
  const [arquivosSalvos, setArquivosSalvos] = useState<{ docx: boolean; pdf: boolean; txt: boolean; caminho: string; pdfErro?: string } | null>(null)

  async function salvarNaPasta(orc: { numero: string }): Promise<void> {
    if (!modeloSelecionado?.template_path) return
    // 1) Garante handle com permissão de escrita
    let handle = await getStoredFolderHandle(true)
    if (!handle) {
      handle = await pickOrcamentoFolder(true)
      if (!handle) throw new Error('Pasta não selecionada')
    }
    const ok = await ensureWritePermission(handle)
    if (!ok) throw new Error('Permissão de escrita negada — Chrome/Edge tem que pedir permissão pra escrever na pasta')

    // 2) Resolve a pasta do mês
    const hoje = new Date()
    const resolved = await resolverPastaDoMes(handle, hoje)
    let pastaMes
    let caminhoUsado: string
    if (resolved.ok) {
      pastaMes = resolved.pastaMes
      caminhoUsado = resolved.caminho || 'pasta selecionada'
    } else if (resolved.sugestaoCriar) {
      pastaMes = await resolved.sugestaoCriar()
      caminhoUsado = `(pasta criada) ${resolved.motivo}`
    } else {
      throw new Error(
        `Pasta selecionada errada. ${resolved.motivo}\n\n` +
        `Use "Reler pasta" e selecione: Z:\\1 - Comercial\\3 - Orçamento\\${hoje.getFullYear()}`
      )
    }

    // 3) Gera o .docx
    const docxBlob = await gerarOrcamentoDocx({
      template_path: modeloSelecionado.template_path,
      numero: orc.numero,
      data: hoje.toLocaleDateString('pt-BR'),
      cliente_nome: cliNome,
      cliente_dados: cliDados,
      forma_pagamento: formaPagamentoOut.forma_pagamento || null,
      prazo_entrega: prazoEntrega.trim() || null,
      data_venda: pgDataVenda ? formaPagamentoOut.data_venda : null,
    })

    // 4) Gera o PDF via Gotenberg (se configurado)
    //    Usa versão "limpa" do docx (sem bordas extras) só pro PDF —
    //    o .docx salvo na pasta é o original.
    let pdfBlob: Blob | null = null
    let pdfErro: string | undefined
    if (isGotenbergConfigured()) {
      try {
        const docxParaPdf = await prepararDocxParaPdf(docxBlob)
        pdfBlob = await gerarPdfDoDocxGotenberg(docxParaPdf)
        if (pdfBlob) setPdfBlobAtual(pdfBlob)
      } catch (e) {
        pdfErro = (e as Error).message || 'erro desconhecido'
        console.warn('Falha gerar PDF via Gotenberg:', pdfErro)
      }
    }

    const vendedor = profile?.display_name || 'Vendedor'
    const nota = montarNotaTxt(vendedor, hoje)
    const base = nomeBaseArquivo({
      numero: orc.numero,
      cliente_nome: cliNome,
      modelo_basename: modeloSelecionado.basename,
    })

    // 5) Escreve cada arquivo, rastreando o resultado individual
    const resultado = { docx: false, pdf: false, txt: false, caminho: caminhoUsado, pdfErro }
    try {
      await escreverArquivo(pastaMes, `${base}.docx`, docxBlob)
      resultado.docx = true
    } catch (e) {
      console.error('Falha .docx:', e)
      throw new Error(`.docx não pôde ser salvo: ${(e as Error).message}`)
    }
    try {
      await escreverArquivo(pastaMes, `${base} - ${vendedor}.txt`, nota)
      resultado.txt = true
    } catch (e) {
      console.warn('Falha .txt:', e)
    }
    if (pdfBlob) {
      try {
        await escreverArquivo(pastaMes, `${base}.pdf`, pdfBlob)
        resultado.pdf = true
      } catch (e) {
        console.warn('Falha .pdf:', e)
        resultado.pdfErro = (e as Error).message
      }
    }
    setArquivosSalvos(resultado)
  }

  async function handleGerar(opcoes: { formato: 'docx' | 'pdf' | 'nenhum' | 'pasta'; status: 'rascunho' | 'enviado' }) {
    if (!modeloSelecionado || !cliNome.trim()) return
    setGerando(true)
    try {
      // RESCAN da pasta SEMPRE antes de salvar — pega o numero REAL do ultimo arquivo
      // (evita usar numero velho do scan inicial que pode ter ficado desatualizado)
      let numeroOverride = (numeroFonte === 'pasta' && scanInfo)
        ? {
            ano: scanInfo.ano,
            sequencial: scanInfo.ultimo + 1,
            numero: formatarNumero(scanInfo.ano, scanInfo.ultimo + 1),
          }
        : null

      if (opcoes.formato === 'pasta' && isFolderScanSupported()) {
        try {
          const handle = await getStoredFolderHandle(true)
          if (handle) {
            const fresh = await scanFolderForLastNumber(handle)
            numeroOverride = {
              ano: fresh.ano,
              sequencial: fresh.proximoNumero,
              numero: formatarNumero(fresh.ano, fresh.proximoNumero),
            }
            // Atualiza UI também
            setScanInfo({ ultimo: fresh.ultimoNumero, total: fresh.total, ano: fresh.ano })
            setNumeroAtual(numeroOverride.numero)
            setNumeroFonte('pasta')
          }
        } catch {
          // Se falhar, mantém o numeroOverride anterior (do scan inicial)
        }
      }

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
        forma_pagamento: formaPagamentoOut.forma_pagamento || null,
        prazo_entrega: prazoEntrega.trim() || null,
        status: opcoes.status,
        numero_override: numeroOverride,
      })
      setOrcamentoSalvo({ numero: orc.numero, id: orc.id })

      if (opcoes.formato === 'pasta') {
        try {
          await salvarNaPasta(orc)
        } catch (e) {
          alert('Erro salvando na pasta Z: ' + (e as Error).message + '\n\nVou baixar o .docx aqui pra você.')
          await baixarOrcamentoDocx({
            template_path: modeloSelecionado.template_path!,
            numero: orc.numero,
            data: new Date().toLocaleDateString('pt-BR'),
            cliente_nome: cliNome,
            cliente_dados: cliDados,
            forma_pagamento: formaPagamentoOut.forma_pagamento || null,
            prazo_entrega: prazoEntrega.trim() || null,
            data_venda: pgDataVenda ? formaPagamentoOut.data_venda : null,
          })
        }
      } else if (opcoes.formato === 'docx' && modeloSelecionado.template_path) {
        await baixarOrcamentoDocx({
          template_path: modeloSelecionado.template_path,
          numero: orc.numero,
          data: new Date().toLocaleDateString('pt-BR'),
          cliente_nome: cliNome,
          cliente_dados: cliDados,
          forma_pagamento: formaPagamentoOut.forma_pagamento || null,
          prazo_entrega: prazoEntrega.trim() || null,
          data_venda: pgDataVenda ? formaPagamentoOut.data_venda : null,
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
    setArquivosSalvos(null)
    setPdfBlobAtual(null)
    setEnviandoWA('idle')
    setEnviandoWAMsg('')
  }

  // Envia o PDF DIRETO pro chat aberto via postMessage pra extensão Branorte
  async function enviarPdfProClienteViaExt() {
    if (!pdfBlobAtual) {
      setEnviandoWA('erro')
      setEnviandoWAMsg('PDF não disponível em memória. Gere o orçamento novamente.')
      return
    }
    setEnviandoWA('enviando')
    setEnviandoWAMsg('Fazendo upload do PDF...')
    try {
      const { supabase } = await import('@/lib/supabase')
      const filename = `${orcamentoSalvo?.numero || Date.now()}-${cliNome.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`
      const path = `orcamentos/${new Date().toISOString().slice(0,7)}/${filename}`
      const { error: upErr } = await supabase.storage
        .from('qr-media')
        .upload(path, pdfBlobAtual, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error('Upload falhou: ' + upErr.message)
      const { data: pub } = supabase.storage.from('qr-media').getPublicUrl(path)
      if (!pub?.publicUrl) throw new Error('URL não gerada')

      setEnviandoWAMsg('Enviando pelo seu WhatsApp...')
      // Listener pra resposta da extensão
      const resultPromise = new Promise<{ ok: boolean; erro?: string }>((resolve) => {
        const onMsg = (ev: MessageEvent) => {
          if (ev.data?.type === 'branorte:send-pdf-result') {
            window.removeEventListener('message', onMsg)
            resolve(ev.data)
          }
        }
        window.addEventListener('message', onMsg)
        setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ ok: false, erro: 'timeout' }) }, 30000)
      })
      window.parent.postMessage({
        type: 'branorte:send-pdf-to-chat',
        pdfUrl: pub.publicUrl,
        filename,
        caption: `📄 Orçamento ${orcamentoSalvo?.numero || ''} — ${cliNome}`,
      }, '*')
      const result = await resultPromise
      if (result.ok) {
        setEnviandoWA('enviado')
        setEnviandoWAMsg('✅ Enviado pro chat aberto do WhatsApp!')
        // Fecha modal automático em 2s
        setTimeout(() => { try { window.parent.postMessage({ type: 'branorte:close-orc-modal' }, '*') } catch {} }, 2000)
      } else {
        setEnviandoWA('erro')
        setEnviandoWAMsg('Erro no envio: ' + (result.erro || 'falhou'))
      }
    } catch (e: any) {
      setEnviandoWA('erro')
      setEnviandoWAMsg(e?.message || 'erro')
    }
  }

  // Pede o telefone do vendedor pra extensão Branorte (capturado via WPP)
  async function getTelefoneVendedorDaExtensao(): Promise<{ telefone: string; vendedor: string }> {
    return new Promise((resolve) => {
      const onMsg = (ev: MessageEvent) => {
        if (ev.data?.type === 'branorte:vendor-info') {
          window.removeEventListener('message', onMsg)
          resolve({ telefone: ev.data.telefone || '', vendedor: ev.data.vendedor_nome || '' })
        }
      }
      window.addEventListener('message', onMsg)
      try { window.opener?.postMessage({ type: 'branorte:request-vendor-info' }, '*') } catch {}
      try { window.parent?.postMessage({ type: 'branorte:request-vendor-info' }, '*') } catch {}
      setTimeout(() => { window.removeEventListener('message', onMsg); resolve({ telefone: '', vendedor: '' }) }, 3000)
    })
  }

  // Envia o PDF gerado pro próprio WhatsApp do vendedor logado
  async function enviarPdfProMeuWhatsApp() {
    if (!pdfBlobAtual) {
      setEnviandoWA('erro')
      setEnviandoWAMsg('PDF não disponível em memória. Gere o orçamento novamente.')
      return
    }
    setEnviandoWA('enviando')
    setEnviandoWAMsg('Detectando vendedor logado no WhatsApp...')
    try {
      const { supabase } = await import('@/lib/supabase')
      const { data: { session } } = await supabase.auth.getSession()

      // 1) Pega telefone do vendedor via extensão (WID capturado pelo WhatsApp Web)
      const { telefone: telefoneExt, vendedor: vendedorExt } = await getTelefoneVendedorDaExtensao()
      if (!telefoneExt) {
        throw new Error('Não consegui detectar seu telefone. Abra o WhatsApp Web em outra aba e tente novamente.')
      }
      setEnviandoWAMsg('Fazendo upload do PDF...')
      const vendedor = vendedorExt.toUpperCase().trim()

      // Upload PDF pro bucket público
      const filename = `${orcamentoSalvo?.numero || Date.now()}-${cliNome.replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`
      const path = `orcamentos/${new Date().toISOString().slice(0,7)}/${filename}`
      const { error: upErr } = await supabase.storage
        .from('qr-media')
        .upload(path, pdfBlobAtual, { contentType: 'application/pdf', upsert: true })
      if (upErr) throw new Error('Upload falhou: ' + upErr.message)
      const { data: pub } = supabase.storage.from('qr-media').getPublicUrl(path)
      if (!pub?.publicUrl) throw new Error('URL pública não gerada')

      setEnviandoWAMsg('Agendando envio pro seu WhatsApp...')
      const r = await fetch('https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/orcamento-enviar-meu-zap', {
        method: 'POST',
        headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          vendedor_nome: vendedor,
          telefone_destino: telefoneExt,
          pdf_url: pub.publicUrl,
          filename,
          cliente_nome: cliNome,
        }),
      })
      const j = await r.json()
      if (!j.ok) throw new Error(j.error + ': ' + (j.detail || ''))
      setEnviandoWA('enviado')
      setEnviandoWAMsg(j.msg || 'Agendado!')
    } catch (e: any) {
      setEnviandoWA('erro')
      setEnviandoWAMsg(e?.message || 'erro')
    }
  }

  if (loadingMods) return <PageLoading />

  // Tela de sucesso
  if (orcamentoSalvo) {
    const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' })
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <Card className="p-8 text-center border-success/40 bg-success-bg/10">
          <Check className="h-16 w-16 text-success mx-auto mb-4" />
          <h2 className="text-[24px] font-bold text-ink mb-2">Orçamento gerado!</h2>
          <p className="text-[16px] text-ink-muted mb-1">
            Número: <span className="font-mono font-bold text-accent">{orcamentoSalvo.numero}</span>
          </p>
          <p className="text-[14px] text-ink-muted mb-3">
            Cliente: <strong>{cliNome}</strong> · Total: <strong>{formatBRL(totalProposta)}</strong>
          </p>
          {gerando ? (
            <div className="text-[13px] text-ink-muted mb-4 flex items-center justify-center gap-2 py-2">
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
              <span>Gerando arquivos…</span>
            </div>
          ) : arquivosSalvos ? (
            <div className="text-[12px] text-ink-faint mb-4 space-y-1">
              <p>📁 <strong>Pasta:</strong> <code className="bg-surface-3 px-1 rounded">{arquivosSalvos.caminho}</code></p>
              <ul className="space-y-0.5 mt-2">
                <li className={arquivosSalvos.docx ? 'text-success' : 'text-danger'}>
                  {arquivosSalvos.docx ? '✅' : '❌'} .docx (formato Branorte)
                </li>
                <li className={arquivosSalvos.txt ? 'text-success' : 'text-danger'}>
                  {arquivosSalvos.txt ? '✅' : '❌'} .txt (data de envio)
                </li>
                {isGotenbergConfigured() && (
                  <li className={arquivosSalvos.pdf ? 'text-success' : 'text-warning'}>
                    {arquivosSalvos.pdf ? '✅ .pdf (idêntico ao Word)' : `⚠️ .pdf falhou${arquivosSalvos.pdfErro ? ': ' + arquivosSalvos.pdfErro.slice(0, 80) : ''}`}
                  </li>
                )}
              </ul>
              {!arquivosSalvos.pdf && (
                <p className="text-[11px] text-warning mt-2">
                  📑 PDF não foi gerado. Abra o .docx no Word e use Ctrl+P → "Microsoft Print to PDF" → salve na mesma pasta.
                  {arquivosSalvos.pdfErro?.toLowerCase().includes('timeout') && (
                    <span> (Render dorme com inatividade — primeira chamada após 15min idle leva 30-60s. Tenta de novo.)</span>
                  )}
                </p>
              )}
            </div>
          ) : (
            <p className="text-[12px] text-ink-faint mb-4">
              📁 Salvo em <code className="bg-surface-3 px-1 rounded">Orçamentos 2026 / {mes}</code>
            </p>
          )}
          {/* Bloco enviar PDF — botões variam se veio da extensão (from=ext) */}
          {pdfBlobAtual && enviandoWA !== 'enviado' && (
            <div className="mb-4 p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg">
              <div className="flex flex-wrap gap-2 justify-center">
                {_fromExt && (
                  <button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2 disabled:opacity-50"
                    onClick={enviarPdfProClienteViaExt}
                    disabled={enviandoWA === 'enviando' || gerando}
                  >
                    {enviandoWA === 'enviando'
                      ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</>
                      : <>💬 Enviar pro cliente ({_initNome || 'chat aberto'})</>}
                  </button>
                )}
                <button
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2 disabled:opacity-50"
                  onClick={enviarPdfProMeuWhatsApp}
                  disabled={enviandoWA === 'enviando' || gerando}
                >
                  {enviandoWA === 'enviando'
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> Enviando...</>
                    : <>📲 Enviar pro meu WhatsApp</>}
                </button>
              </div>
              {enviandoWAMsg && (
                <div className={`text-[12px] mt-2 text-center ${enviandoWA === 'erro' ? 'text-red-400' : 'text-emerald-300'}`}>
                  {enviandoWAMsg}
                </div>
              )}
            </div>
          )}
          {enviandoWA === 'enviado' && (
            <div className="mb-4 p-3 bg-emerald-500/20 border border-emerald-500/40 rounded-lg text-emerald-300 text-[13px]">
              ✅ {enviandoWAMsg || 'Enviado! Confere o WhatsApp.'}
            </div>
          )}
          <div className="flex gap-3 justify-center">
            <button
              className="bg-accent hover:bg-accent-700 text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={novoOrcamento}
              disabled={gerando}
            >
              <Plus className="h-4 w-4" />
              Novo orçamento
            </button>
            <button
              className="bg-surface-2 hover:bg-surface-3 text-ink font-semibold px-5 py-2.5 rounded-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={gerando}
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
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2 flex-1">
              <Package className="h-4 w-4" /> Escolher Modelo
              <span className="text-[11px] text-ink-faint font-normal ml-2">{modelosFiltrados.length} de {modelos?.length ?? 0}</span>
            </h2>
            <button
              onClick={() => setUploadOpen(true)}
              className="text-[12px] px-3 py-1.5 rounded bg-info-bg/30 hover:bg-info-bg/50 text-info border border-info/40 font-semibold flex items-center gap-1.5"
              title="Subir um novo .docx pro catálogo (ex: orçamento só de martelos e peneiras)"
            >
              <Upload className="h-3.5 w-3.5" />
              Subir modelo
            </button>
          </div>

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
            {pacotesDisponiveis.map(p => (
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
            numeroFonte === 'banco' ? (
              <div className="p-4 bg-danger-bg/15 border-2 border-danger/40 rounded-md space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-[18px]">⚠️</span>
                  <span className="text-[13px] font-bold text-danger">Número provisório do banco</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    disabled={scanLoading}
                    onClick={handlePickFolder}
                    className="text-[12px] px-3 py-1.5 rounded bg-danger hover:bg-danger-700 disabled:opacity-50 text-white font-bold flex items-center gap-1.5"
                  >
                    <FolderOpen className="h-3.5 w-3.5" />
                    {scanLoading ? 'Lendo...' : 'Escolher pasta Z: (correto)'}
                  </button>
                </div>
                <div className="text-[11px] text-ink-muted">
                  O número exibido vem do banco do CRM (que pode estar atrás dos arquivos reais). Pra ler direto da pasta Z:, clique no botão e selecione:
                </div>
                <code className="block text-[11px] bg-surface-3 px-2 py-1 rounded font-mono text-ink">Z:\1 - Comercial\3 - Orçamento\2026</code>
                <div className="text-[10px] text-ink-faint">O navegador lembra essa permissão e usa o número correto da próxima vez.</div>
              </div>
            ) : (
              <div className="p-3 bg-success-bg/15 border border-success/30 rounded-md space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <FolderOpen className="h-4 w-4 text-success shrink-0" />
                  <span className="text-[12px] font-semibold text-success">Lido direto da pasta Z:</span>
                  <span className="flex-1" />
                  <button
                    type="button"
                    disabled={scanLoading}
                    onClick={handleRescanFolder}
                    title="Reler pasta"
                    className="text-[11px] px-2.5 py-1 rounded bg-success/20 hover:bg-success/30 text-success font-semibold flex items-center gap-1"
                  >
                    <RefreshCw className={`h-3 w-3 ${scanLoading ? 'animate-spin' : ''}`} />
                    {scanLoading ? 'Lendo...' : 'Reler pasta'}
                  </button>
                </div>
                {scanInfo && (
                  <div className="text-[11px] text-ink-muted">
                    {scanInfo.total} arquivos de {scanInfo.ano}
                    {' · '}último: <strong className="text-ink font-mono">{formatarNumero(scanInfo.ano, scanInfo.ultimo)}</strong>
                    {' · '}próximo: <strong className="text-success font-mono">{formatarNumero(scanInfo.ano, scanInfo.ultimo + 1)}</strong>
                  </div>
                )}
              </div>
            )
          ) : (
            <div className="p-2 bg-warning-bg/15 border border-warning/30 rounded-md text-[11px] text-warning">
              Seu navegador não suporta leitura da pasta Z: (use Chrome ou Edge). Número está vindo do banco.
            </div>
          )}

          {/* Resumo do orçamento */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-[12px]">
            <div className={`p-3 rounded-md ${numeroFonte === 'banco' ? 'bg-danger-bg/20 border border-danger/30' : 'bg-surface-2'}`}>
              <div className={`text-[10px] uppercase tracking-wider mb-1 ${numeroFonte === 'banco' ? 'text-danger' : 'text-ink-muted'}`}>
                Número {numeroFonte === 'pasta' ? '(da pasta Z:)' : numeroFonte === 'banco' ? '(provisório do banco ⚠️)' : ''}
              </div>
              <div className={`font-mono font-bold text-[16px] ${numeroFonte === 'banco' ? 'text-danger' : 'text-success'}`}>
                {numeroAtual || 'carregando...'}
              </div>
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

          {/* Condição de Pagamento (builder estruturado) */}
          <div className="p-4 bg-surface-2 rounded-md border border-border space-y-3">
            <h3 className="text-[12px] font-bold text-ink uppercase tracking-wider flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-accent" />
              Condição de Pagamento
            </h3>

            {/* Linha 1: Data da venda */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  Data prevista da venda
                </label>
                <input
                  type="date"
                  value={pgDataVenda}
                  onChange={e => setPgDataVenda(e.target.value)}
                  className="mt-1 w-full px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                />
                <div className="text-[10px] text-ink-faint mt-0.5">Vazio = "a combinar"</div>
              </div>
              <div>
                <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Prazo de entrega</label>
                <Input
                  value={prazoEntrega}
                  onChange={e => setPrazoEntrega(e.target.value)}
                  placeholder="Padrão: 90 dias (úteis)"
                  className="mt-1"
                />
              </div>
            </div>

            {/* Tipo de pagamento — segmentado */}
            <div>
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Tipo</label>
              <div className="mt-1 grid grid-cols-4 gap-1 bg-bg border border-border rounded-md p-1">
                {([
                  { v: 'avista', l: 'À vista' },
                  { v: 'parcelado', l: 'Parcelado' },
                  { v: 'entrada', l: 'Entrada + Parcelas' },
                  { v: 'personalizado', l: 'Personalizado' },
                ] as const).map(t => (
                  <button
                    key={t.v}
                    type="button"
                    onClick={() => setPgTipo(t.v)}
                    className={`text-[11px] py-1.5 px-2 rounded font-semibold transition-all ${
                      pgTipo === t.v
                        ? 'bg-accent text-white shadow-sm'
                        : 'text-ink-muted hover:bg-surface-3 hover:text-ink'
                    }`}
                  >
                    {t.l}
                  </button>
                ))}
              </div>
            </div>

            {/* Campos condicionais */}
            {pgTipo === 'avista' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Meio</label>
                  <select
                    value={pgAvistaMeio}
                    onChange={e => setPgAvistaMeio(e.target.value as any)}
                    className="mt-1 w-full px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                  >
                    <option value="pix">PIX</option>
                    <option value="transferencia">Transferência</option>
                    <option value="boleto">Boleto</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="">Não especificar</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Desconto</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      min={0} max={20}
                      value={pgAvistaDesconto}
                      onChange={e => setPgAvistaDesconto(parseFloat(e.target.value) || 0)}
                      className="flex-1 px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                    />
                    <span className="text-[12px] text-ink-faint">%</span>
                  </div>
                </div>
              </div>
            )}

            {pgTipo === 'parcelado' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Nº de parcelas</label>
                  <input
                    type="number" min={2} max={12}
                    value={pgNumParcelas}
                    onChange={e => setPgNumParcelas(parseInt(e.target.value) || 3)}
                    className="mt-1 w-full px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                  />
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Intervalo</label>
                  <select
                    value={pgIntervalo}
                    onChange={e => setPgIntervalo(parseInt(e.target.value))}
                    className="mt-1 w-full px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                  >
                    <option value={30}>A cada 30 dias</option>
                    <option value={45}>A cada 45 dias</option>
                    <option value={60}>A cada 60 dias</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">1ª parcela em</label>
                  <input
                    type="date"
                    value={pgPrimeiraEm}
                    onChange={e => setPgPrimeiraEm(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                  />
                </div>
              </div>
            )}

            {pgTipo === 'entrada' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Entrada</label>
                  <div className="mt-1 flex items-center gap-2">
                    <input
                      type="number" min={10} max={90} step={5}
                      value={pgEntradaPct}
                      onChange={e => setPgEntradaPct(parseFloat(e.target.value) || 50)}
                      className="flex-1 px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                    />
                    <span className="text-[12px] text-ink-faint">%</span>
                  </div>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Parcelas restantes</label>
                  <input
                    type="number" min={1} max={12}
                    value={pgParcelasApos}
                    onChange={e => setPgParcelasApos(parseInt(e.target.value) || 1)}
                    className="mt-1 w-full px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                  />
                  <div className="text-[10px] text-ink-faint mt-0.5">1 = pagamento no envio</div>
                </div>
                <div>
                  <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Intervalo</label>
                  <select
                    value={pgIntervalo}
                    onChange={e => setPgIntervalo(parseInt(e.target.value))}
                    className="mt-1 w-full px-2 py-1.5 bg-bg border border-border rounded text-[12px] text-ink focus:border-accent outline-none"
                  >
                    <option value={30}>30 dias</option>
                    <option value={45}>45 dias</option>
                    <option value={60}>60 dias</option>
                  </select>
                </div>
              </div>
            )}

            {pgTipo === 'personalizado' && (
              <div>
                <label className="text-[11px] uppercase tracking-wider text-ink-muted font-medium">Texto livre</label>
                <Input
                  value={pgCustom}
                  onChange={e => setPgCustom(e.target.value)}
                  placeholder="Ex: 70% no aceite + 30% após teste"
                  className="mt-1"
                />
              </div>
            )}

            {/* Preview */}
            <div className="border-t border-border pt-3 space-y-1.5">
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-wider text-ink-faint font-bold w-32 shrink-0">Data da venda:</span>
                <span className="text-[12px] font-mono text-ink">{formaPagamentoOut.data_venda}</span>
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-[10px] uppercase tracking-wider text-ink-faint font-bold w-32 shrink-0">Forma de pagamento:</span>
                <span className="text-[12px] font-mono font-bold text-accent">{formaPagamentoOut.forma_pagamento}</span>
              </div>
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

          <div className="text-[11px] text-ink-muted bg-info-bg/15 border border-info/30 rounded-md p-3 space-y-1">
            <p><strong>"Salvar na pasta Z:"</strong> grava em <code className="bg-surface-3 px-1 rounded">Z:\1 - Comercial\3 - Orçamento\2026\Orçamentos 2026\{`{mês}`}\</code>:</p>
            <ul className="ml-4 space-y-0.5 text-[10px]">
              <li>📄 <code>{`{numero}`} - Cliente.docx</code> (formato oficial Branorte)</li>
              {isGotenbergConfigured() && (
                <li>📑 <code>{`{numero}`} - Cliente.pdf</code> (idêntico ao Word — gerado por LibreOffice)</li>
              )}
              <li>📝 <code>{`{numero}`} - Cliente - {profile?.display_name || 'Vendedor'}.txt</code> (data de envio)</li>
            </ul>
            {!isGotenbergConfigured() && (
              <p className="text-[10px] mt-2">📑 <strong>PDF não configurado.</strong> Pra gerar PDF automaticamente igual ao Word, faça deploy do Gotenberg no Render (gratuito) e configure <code className="bg-surface-3 px-1 rounded">VITE_GOTENBERG_URL</code> no Vercel. Enquanto isso: abra o .docx no Word e use Ctrl+P → "Microsoft Print to PDF".</p>
            )}
            <p className="text-[10px]">Se a pasta do mês não existir, é criada automaticamente.</p>
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
              Rascunho
            </button>
            <button
              disabled={gerando}
              onClick={() => handleGerar({ formato: 'docx', status: 'enviado' })}
              className="bg-surface-2 hover:bg-surface-3 disabled:opacity-50 text-ink font-semibold px-4 py-2 rounded-md flex items-center gap-2"
              title="Baixar .docx pro computador (sem salvar na pasta Z:)"
            >
              <FileDown className="h-4 w-4" />
              Só baixar .docx
            </button>
            <button
              disabled={gerando}
              onClick={() => handleGerar({ formato: 'pasta', status: 'enviado' })}
              className="bg-accent hover:bg-accent-700 disabled:opacity-50 text-white font-semibold px-5 py-2.5 rounded-md flex items-center gap-2"
            >
              <FolderPlus className="h-4 w-4" />
              {gerando ? 'Salvando…' : 'Salvar na pasta Z:'}
            </button>
          </div>
        </Card>
      )}

      {/* Modal de upload de modelo customizado (acessivel do Step 2) */}
      <UploadModeloModal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onSuccess={async (novoId) => {
          await queryClient.invalidateQueries({ queryKey: ['orcamento-modelos'] })
          setModeloId(novoId)
          setUploadOpen(false)
        }}
      />
    </div>
  )
}
