import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Check, Loader2, FileText, FileDown, FolderOpen, RefreshCw, Calendar, CreditCard, ChevronRight } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import {
  useClientesOrcamento, obterProximoNumero, useCriarOrcamento, useAtualizarOrcamento, useCriarAlteracao,
  type ClienteDados, type OrcamentoItem, type OrcamentoMotor,
} from '@/hooks/useOrcamentoBuilder'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'
import { gerarPdfDoPreview } from '@/lib/preview-to-pdf'
import { gerarPdfServerSide } from '@/lib/pdf-server'
import { docxParaPdfServer } from '@/lib/docx-to-pdf-server'
import { gerarOrcamentoCustomDocx } from '@/lib/orcamento-custom-docx'
import { gerarDocxViaHtml } from '@/lib/preview-to-docx-html'
import {
  isFolderScanSupported, pickOrcamentoFolder, getStoredFolderHandle,
  scanFolderForLastNumber, formatarNumero, ensureWritePermission,
  resolverPastaDoMes, escreverArquivo,
} from '@/lib/orcamento-folder-scan'
import { construirFormaPagamento, type TipoPagamento, type FormaPagamentoConfig } from '@/lib/forma-pagamento'
import { montarNotaTxt } from '@/lib/orcamento-docx'
import { startGeneration, updateGeneration, finishGeneration } from '@/lib/generation-progress'
import { supabase } from '@/lib/supabase'
import { parseClienteText, titleCasePtBr } from '@/lib/parse-cliente-text'
import { uploadOrcamentoViaServer } from '@/lib/orcamento-upload'

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
    brinde?: boolean
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
  // Edições inline da preview — usadas pelo PDF/DOCX pra sair igual à preview.
  tensaoMotores?: 220 | 380 | 660 | null
  desconto?: { tipo: 'pct' | 'valor'; valor: number } | null
  termsInline?: {
    dataVenda?: string | null
    prazoEntrega?: string | null
    formaPagamento?: string | null
  }
  // Parcelas estruturadas (tabela DATA/MÉTODO/VALOR)
  parcelas?: Array<{
    id: string
    dataTipo: 'no_pedido' | 'na_nf' | 'apos_nf' | 'data_fixa'
    dias?: number
    dataFixa?: string
    metodo: 'PIX' | 'BOLETO' | 'DINHEIRO' | 'TRANSFERENCIA' | 'CARTAO' | ''
    pct?: number
    valor?: number
  }>
  // Componentes adicionais (não fabricados pela Branorte) — painel, balança, célula de carga…
  componentesExtras?: Array<{ id: string; nome: string; valor: number }>
}

interface Props {
  open: boolean
  snapshot: CarrinhoSnapshot
  onClose: () => void
  onSuccess: (info: { numero: string; baixouDocx: boolean; baixouPdf: boolean; salvouNaPasta: boolean; pdfBlob: Blob | null; cliente: string; erro?: string | null; pdfErro?: string | null }) => void
  /** Sprint 3: quando vem do copiloto IA com cliente pré-preenchido, dispara
   *  contagem regressiva de 3s e auto-clica Gerar (zero atrito).
   *  Vendedor vê o botão "Cancelar countdown" pra interromper se quiser editar. */
  autoSubmitOnOpen?: boolean
  // Modo edição: se setado, faz UPDATE em orcamentos_gerados[editingId] em vez de INSERT.
  editingId?: number | null
  // Modo de salvamento: 'new' (default), 'update' (sobrescreve), 'alt' (cria versão alternativa)
  saveMode?: 'update' | 'alt' | 'new'
  // Dados do orçamento pai para criação de ALT
  parentOrcamento?: { id: number; numero: string; numero_base: string } | null
  // Valores iniciais carregados do orçamento sendo editado (pra pre-popular cliente/observacoes/etc)
  initialModal?: {
    cliente_nome: string
    cliente_dados: any
    observacoes: string | null
    forma_pagamento: string | null
    prazo_entrega: string | null
  } | null
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function sanitizeNomeArquivo(s: string): string {
  // Sanitize: remove acentos/cedilha + chars proibidos.
  // Por que normalizar acentos: Supabase Storage rejeita URLs com chars
  // unicode no path (fastify quebra com FST_ERR_BAD_URL: "is not a valid url
  // component"). "GRÃOS" → "GRAOS". Mantém o nome do cliente legível no DB
  // (esse sanitize só afeta o NOME DO ARQUIVO no storage/pasta Z:\).
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip diacritics
   .replace(/[<>:"/\\|?*]/g, '')                       // chars proibidos Windows/Storage
   .slice(0, 80).trim()
}

function nomeBase(numero: string, cliente: string, descricao: string, isTest = false): string {
  const desc = sanitizeNomeArquivo(descricao || 'Personalizado').slice(0, 100) || 'Personalizado'
  if (isTest) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(11, 19)
    return `TESTE-${ts}-${sanitizeNomeArquivo(cliente || 'cliente')} (${numero})`
  }
  // Se numero contém -ALT, move o ALT pro final do nome do arquivo
  const altMatch = numero.match(/(-ALT\d*)$/)
  if (altMatch) {
    const numSemAlt = numero.replace(altMatch[0], '')
    return `${numSemAlt} - ${sanitizeNomeArquivo(cliente || 'Sem cliente')} (${desc})${altMatch[0]}`
  }
  return `${numero} - ${sanitizeNomeArquivo(cliente || 'Sem cliente')} (${desc})`
}

// Nome curto pro filename enviado no WhatsApp: só numero + cliente (sem descricao).
// O arquivo salvo localmente em Z:\ mantém o nome completo via nomeBase().
function nomeBaseWhatsApp(numero: string, cliente: string): string {
  return `${numero} - ${sanitizeNomeArquivo(cliente || 'Sem cliente')}`
}

// Auto-sugere descrição curta a partir dos itens do carrinho.
// Ex: "Transportador 6m + Painel" / "Moinho + Misturador" / "Silo Pulmão 5T"
function sugerirDescricao(snapshot: CarrinhoSnapshot): string {
  const nomes = snapshot.itens.map(it => it.nome.trim()).filter(Boolean)
  if (nomes.length === 0) return 'Personalizado'

  // Pega palavra-chave principal de cada item (primeira palavra significativa)
  const palavrasChave = nomes.map(n => {
    // Remove medidas (6m, 10m), números soltos, parênteses
    const limpo = n.replace(/\([^)]*\)/g, '').replace(/\d+\s*[mt]\b/gi, '').trim()
    // Pega ate 3 primeiras palavras com >2 chars
    const palavras = limpo.split(/\s+/).filter(p => p.length > 2).slice(0, 3)
    return palavras.join(' ').trim()
  }).filter(Boolean)

  // Dedup mantendo ordem
  const unicas = Array.from(new Set(palavrasChave))

  if (unicas.length === 0) return 'Personalizado'
  if (unicas.length === 1) return unicas[0]
  if (unicas.length === 2) return unicas.join(' + ')
  return `${unicas[0]} + ${unicas[1]} +${unicas.length - 2}`
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

export function FinalizarMontarModal({ open, snapshot, onClose, onSuccess, editingId, initialModal, autoSubmitOnOpen, saveMode = 'new', parentOrcamento }: Props) {
  const { profile } = useAuth()
  const { data: vendorsAtivos } = useVendors()
  const vendedoresContato = useMemo(() => {
    if (!vendorsAtivos) return []
    return vendorsAtivos
      .filter(v => v.telefone && v.name && !/^branorte$/i.test(v.name))
      .map(v => {
        const d = String(v.telefone).replace(/\D/g, '')
        let tel = v.telefone || ''
        if (d.length === 12 && d.startsWith('55')) tel = `(${d.slice(2,4)}) 9 ${d.slice(4,8)}-${d.slice(8)}`
        else if (d.length === 13 && d.startsWith('55')) tel = `(${d.slice(2,4)}) ${d.slice(4,5)} ${d.slice(5,9)}-${d.slice(9)}`
        const nome = v.name.charAt(0).toUpperCase() + v.name.slice(1).toLowerCase()
        return { nome, telefone: tel }
      })
  }, [vendorsAtivos])
  const criar = useCriarOrcamento()
  const atualizar = useAtualizarOrcamento()
  const criarAlteracao = useCriarAlteracao()

  // Cliente
  const [cliNome, setCliNome] = useState('')
  const [cliDados, setCliDados] = useState<ClienteDados>({})
  const [searchCli, setSearchCli] = useState('')
  const { data: clientesSugeridos } = useClientesOrcamento(searchCli)

  // Dados extras
  const [prazoEntrega, setPrazoEntrega] = useState('')
  const [observacoes, setObservacoes] = useState('')
  // Descrição curta — vai pro nome do arquivo em vez de "Personalizado"
  // Auto-sugere a partir dos itens do carrinho, mas vendedor pode editar.
  const [descricao, setDescricao] = useState('')
  const [descricaoTocada, setDescricaoTocada] = useState(false)
  const sugestao = useMemo(() => sugerirDescricao(snapshot), [snapshot])
  // Atualiza sugestao automatica quando carrinho muda (se vendedor nao editou ainda)
  useEffect(() => {
    if (!descricaoTocada && open) {
      const prefix = saveMode === 'alt' ? '(Alteração) ' : ''
      setDescricao(prefix + sugestao)
    }
  }, [sugestao, descricaoTocada, open, saveMode])

  const [pdfAltaQualidade, setPdfAltaQualidade] = useState(false)

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
  // True quando vendedor TEM pasta Z: configurada e acessivel localmente.
  // Se false, o botao 'Salvar' vai pro servidor (PC do escritorio sincroniza).
  const [temPastaLocal, setTemPastaLocal] = useState<boolean>(false)

  const [gerando, setGerando] = useState(false)
  const [gerandoStep, setGerandoStep] = useState<string>('')
  // Progresso 0-100 pra barra. Cada etapa do handleGerar empurra o valor.
  // Setado junto com gerandoStep via setStep(label, pct).
  const [gerandoProgress, setGerandoProgress] = useState<number>(0)
  const [erro, setErro] = useState<string | null>(null)
  // Status do envio WhatsApp (mostra feedback ao vendedor)
  const [waStatus, setWaStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [waMsg, setWaMsg] = useState<string>('')

  // Atualiza step + percentual. Garante que o pct nunca anda pra trás
  // (uploadOrcamentoViaServer chama onProgress várias vezes — manteria a barra
  // estável mesmo se mensagens chegarem fora de ordem).
  // Também atualiza o store global (overlay persiste entre navegações).
  function setStep(label: string, pct: number) {
    setGerandoStep(label)
    setGerandoProgress(p => Math.max(p, Math.min(99, pct)))
    updateGeneration(label, pct)
  }

  // Reseta status WhatsApp ao reabrir
  useEffect(() => {
    if (open) { setWaStatus('idle'); setWaMsg(''); setErro(null); setGerandoProgress(0); setGerandoStep('') }
  }, [open])

  // Sprint 3: Auto-submit IMEDIATO quando vem do copiloto IA com cliente preenchido.
  // Modal fica invisível (headless) e dispara handleGerar direto. Progresso aparece
  // como toast no fim (onSuccess do parent).
  const [headlessMode, setHeadlessMode] = useState(false)
  // Flag pra disparar UMA ÚNICA vez por abertura do modal. Evita doublefire
  // quando o cliNome atualiza (re-renders).
  const autoSubmitFiredRef = useRef(false)

  // Reseta o flag toda vez que o modal abre/fecha
  useEffect(() => {
    autoSubmitFiredRef.current = false
    if (!open) setHeadlessMode(false)
  }, [open])

  // Watcher: quando modal abre + autoSubmitOnOpen=true + cliNome preenchido → dispara
  useEffect(() => {
    if (!open || !autoSubmitOnOpen || autoSubmitFiredRef.current) return
    if (!cliNome.trim()) return  // aguarda initialModal preencher
    // Dispara UMA ÚNICA vez
    autoSubmitFiredRef.current = true
    setHeadlessMode(true)
    // Wrap em IIFE async pra desligar headless mode no final (sucesso OU erro).
    // Sem isso, em caso de falha o toast 'Gerando...' fica eterno.
    // Inicia overlay global (persiste entre navegações)
    startGeneration(cliNome)
    ;(async () => {
      try {
        // Decide rota: se tem handle da pasta Z:\ (PC do Daniel/escritório),
        // salva DIRETO lá — pula bucket inteiro. Daemon nem precisa correr.
        // Vendedores mobile (sem File System Access) caem pro server upload.
        let temFolderHandle = false
        if (isFolderScanSupported()) {
          try {
            const h = await getStoredFolderHandle()
            temFolderHandle = !!h
          } catch { /* sem permissão / handle perdido — cai pro server */ }
        }
        await handleGerar({
          salvarNaPasta: temFolderHandle,
          salvarNoServidor: !temFolderHandle,
          pdfQuality: pdfAltaQualidade ? 'high' : 'normal',
        })
      } catch (e) {
        console.error('[autoSubmit] handleGerar erro:', e)
      } finally {
        finishGeneration()
        // Sai do modo headless. O toast de erro/sucesso do parent (OrcamentoMontar)
        // assume daqui. O modal mostra o estado normal pra ele tentar de novo.
        setHeadlessMode(false)
        // Fecha o modal — toast do parent já tem todas as info que precisa
        onClose()
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, autoSubmitOnOpen, cliNome])

  // Modo edição: pré-popula campos do modal com dados do orçamento sendo editado.
  // Roda toda vez que o modal abre, populando com dados do initialModal.
  useEffect(() => {
    if (!open) return
    if (!initialModal) return
    setCliNome(initialModal.cliente_nome ?? '')
    setCliDados(initialModal.cliente_dados ?? {})
    setObservacoes(initialModal.observacoes ?? '')
    setPrazoEntrega(initialModal.prazo_entrega ?? '')
    // forma_pagamento vira free-text no campo custom (mais simples que tentar reverter pra TipoPagamento)
    if (initialModal.forma_pagamento) {
      setPgTipo('personalizado')
      setPgCustom(initialModal.forma_pagamento)
    }
  }, [open, initialModal])

  // Reseta número quando modal abre (pra não reusar número de abertura anterior)
  useEffect(() => {
    if (open) setNumeroAtual('')
  }, [open])

  // Carrega número quando abre o modal.
  // Em modo UPDATE, usa o número do orçamento existente (não gera novo).
  useEffect(() => {
    if (!open) return
    if (numeroAtual) return
    // Modo update: manter número original do orçamento
    if (saveMode === 'update' && editingId && parentOrcamento) {
      setNumeroAtual(parentOrcamento.numero)
      setNumeroFonte('banco')
      ;(async () => {
        try {
          const handle = await getStoredFolderHandle()
          if (handle) setTemPastaLocal(true)
        } catch { /* sem pasta */ }
      })()
      return
    }
    // Modo ALT: mostra número base + ALT (o número real é gerado no save)
    if (saveMode === 'alt' && parentOrcamento) {
      setNumeroAtual(`${parentOrcamento.numero_base || parentOrcamento.numero}-ALT`)
      setNumeroFonte('banco')
      ;(async () => {
        try {
          const handle = await getStoredFolderHandle()
          if (handle) setTemPastaLocal(true)
        } catch { /* sem pasta */ }
      })()
      return
    }
    ;(async () => {
      try {
        const handle = await getStoredFolderHandle()
        if (handle) {
          const scan = await scanFolderForLastNumber(handle)
          setScanInfo({ ultimo: scan.ultimoNumero, total: scan.total, ano: scan.ano })
          setNumeroAtual(formatarNumero(scan.ano, scan.proximoNumero))
          setNumeroFonte('pasta')
          setTemPastaLocal(true)
          return
        }
      } catch {
        // Pasta esta configurada mas nao acessivel (ex: Z:\ desconectado, vendedor mudou de PC)
        // Cai pro banco automaticamente
      }
      setTemPastaLocal(false)
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
      uf: (c as any).uf ?? undefined,
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
      setTemPastaLocal(true)
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
      setTemPastaLocal(true)
    } catch (e) {
      const msg = (e as Error).message
      if (!/abort|cancel/i.test(msg)) alert('Erro: ' + msg)
    } finally {
      setScanLoading(false)
    }
  }

  async function handleGerar(opcoes: { salvarNaPasta: boolean; salvarNoServidor?: boolean; pdfQuality?: 'normal' | 'high' }) {
    // Validações antes de gravar — evita orçamento órfão (sem cliente, vazio, R$ 0)
    if (!cliNome.trim()) {
      setErro('Nome do cliente é obrigatório')
      return
    }
    if (!snapshot.itens || snapshot.itens.length === 0) {
      setErro('Adicione pelo menos um item ao carrinho antes de gerar')
      return
    }
    if (!snapshot.totalGeral || snapshot.totalGeral <= 0) {
      setErro('Valor total do orçamento está zerado — confira os preços dos itens')
      return
    }
    // Avisa se item tem valor zerado (vendedor esqueceu de cotar)
    const itemSemValor = snapshot.itens.find(it => !it.valor || it.valor <= 0)
    if (itemSemValor) {
      const ok = confirm(`O item "${itemSemValor.nome}" está com R$ 0,00. Gerar mesmo assim?`)
      if (!ok) return
    }
    setGerando(true)
    setErro(null)
    setGerandoProgress(0)
    setStep('Preparando orçamento...', 3)
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
          setStep('Conferindo número na pasta...', 6)
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

      // 2) (removido) — antes mapeava pro gerador docx-lib, hoje gerarDocxDoPreview
      //   reusa previewProps direto, nao precisa de transformacao intermediaria.

      // 3) Cria registro no DB
      const itensDb: OrcamentoItem[] = snapshot.itens.map((it, idx) => ({
        letra: String.fromCharCode(65 + idx),
        qtd: it.qtd,
        nome: it.nome,
        specs: it.specs,
        valor: it.valor,
        ...(it.brinde ? { brinde: true } : {}),
      }))
      // BUGFIX v1.4.1: salva valor UNITÁRIO do motor (não o total já multiplicado).
      // Antes salvava valor_total (= valor_unit * qtdMotor), e no próximo load
      // motor.valor virava "unit" e o save multiplicava DE NOVO — corrupção exponencial
      // (4724 → 18896 → 75584 → 302336…). Contract: motores[].valor = preço de UMA unidade.
      const motoresDb: OrcamentoMotor[] = snapshot.motoresAgrupados.map(m => ({
        cv: m.cv,
        polos: m.polos,
        valor: m.valor_unit,
      }))

      // Upload da foto principal pro Storage (se for dataURL, converte pra blob e sobe)
      let fotoPrincipalUrl: string | null = null
      if (snapshot.fotoPrincipal) {
        if (snapshot.fotoPrincipal.startsWith('data:')) {
          try {
            setStep('Subindo foto principal...', 8)
            const res = await fetch(snapshot.fotoPrincipal)
            const blob = await res.blob()
            const ext = blob.type.includes('png') ? 'png' : 'jpg'
            // Usa timestamp pra evitar cache e colisão
            const storagePath = `orcamentos/foto-principal-${Date.now()}.${ext}`
            const { error: upErr } = await supabase.storage
              .from('catalogo-fotos')
              .upload(storagePath, blob, { contentType: blob.type, upsert: true })
            if (upErr) {
              console.warn('Falha upload foto principal:', upErr.message)
            } else {
              const { data: pubData } = supabase.storage.from('catalogo-fotos').getPublicUrl(storagePath)
              fotoPrincipalUrl = pubData?.publicUrl ?? null
            }
          } catch (e) {
            console.warn('Falha upload foto principal:', (e as Error).message)
          }
        } else {
          // Já é uma URL pública — salva direto
          fotoPrincipalUrl = snapshot.fotoPrincipal
        }
      }

      const stepLabel = saveMode === 'alt' ? 'Criando alteração...' : saveMode === 'update' && editingId ? 'Atualizando orçamento no banco...' : 'Salvando orçamento no banco...'
      setStep(stepLabel, 10)
      // Modo edição vs criação: 'update'+editingId → UPDATE (mantém numero/sequencial), 'alt' → ALT, senão INSERT
      // Modo alt: cria nova versão (ALT) vinculada ao pai
      const payloadComum = {
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
        parcelas: snapshot.parcelas?.length ? snapshot.parcelas : null,
        componentes_extras: snapshot.componentesExtras ?? null,
        foto_principal_url: fotoPrincipalUrl,
      }
      // Status: SEMPRE cria como 'rascunho'. O /api/orcamento-confirm muda
      // pra 'enviado' SE o upload realmente chegou no Storage. Isso evita
      // 'status mentindo' (bug: 0793-0795 ficaram 'enviado' sem arquivo).
      // Pra salvarNaPasta (FileSystem local) tambem mantem rascunho — ja que
      // ali a gente tambem nao tem garantia 100% sem ler de volta.
      const orc = saveMode === 'alt' && parentOrcamento
        ? await criarAlteracao.mutateAsync({
            ...payloadComum,
            status: 'rascunho',
            parent_id: parentOrcamento.id,
            parent_numero: parentOrcamento.numero,
            parent_numero_base: parentOrcamento.numero_base,
          })
        : saveMode === 'update' && editingId
        ? await atualizar.mutateAsync({ id: editingId, ...payloadComum })
        : await criar.mutateAsync({
            ...payloadComum,
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
          brinde: it.brinde,
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
          // Modal vence se preenchido, senão usa o que foi editado inline na preview
          dataVenda: (pgDataVenda ? formaPgOut.data_venda : null) || snapshot.termsInline?.dataVenda || null,
          prazoEntrega: prazoEntrega.trim() || snapshot.termsInline?.prazoEntrega || null,
          formaPagamento: formaPgOut.forma_pagamento || snapshot.termsInline?.formaPagamento || null,
        },
        observacoesExtra: observacoes.trim() || null,
        fotoPrincipal: snapshot.fotoPrincipal ?? null,
        // Edições inline da preview — mantém PDF/DOCX idênticos à preview
        tensaoMotores: snapshot.tensaoMotores ?? null,
        desconto: snapshot.desconto ?? null,
        parcelas: snapshot.parcelas ?? [],
        componentesExtras: snapshot.componentesExtras ?? [],
        vendedoresContato,
        vendedorResponsavelNome: profile?.display_name || null,
      }
      // ESTRATEGIA: PDF eh o produto principal (perfeito via Puppeteer).
      // DOCX eh fallback editavel — html-to-docx atinge ~85% e nao gasta
      // conversoes ConvertAPI (250 grátis/mes ficam pra outras coisas).
      //
      // Cascade DOCX:
      //   1. html-to-docx (~85%, gratis ilimitado)
      //   2. custom docx lib (~70%, fallback se HTML falhar)
      //   ConvertAPI removido — text boxes nao agregam fidelidade real

      // FLUXO NOVO: DOCX primeiro (layout nativo Word, perfeito) → PDF via
      // ConvertAPI. Evita o html2canvas frágil que tinha vários bugs (canvas
      // em branco, fotos sumidas, cortes errados, footer sobreposto).
      // Mantém html2canvas como fallback se ConvertAPI falhar.

      // 4a) DOCX primeiro — produto base que serve tanto como editável quanto fonte do PDF
      setStep('Gerando Word...', 25)
      let docxBlob: Blob = null as any
      let docxFonte: 'html-to-docx' | 'custom' = 'custom'

      // Tier 1: custom docx (tabelas nativas Word, layout correto)
      try {
        docxBlob = await gerarOrcamentoCustomDocx({
          numero: orc.numero,
          dataEmissao: dataEmissaoBR,
          cliente: {
            nome: cliNome.trim(), ac: cliDados.ac, fone: cliDados.fone,
            cidade: cliDados.cidade, bairro: cliDados.bairro, endereco: cliDados.endereco,
            cep: cliDados.cep, cnpj: cliDados.cnpj, ie: cliDados.ie, email: cliDados.email,
          },
          voltagem: snapshot.voltagem,
          itens: snapshot.itens.map((it, idx) => ({
            letra: String.fromCharCode(65 + idx),
            qtd: it.qtd, nome: it.nome, specs: it.specs,
            valor: it.valor, brinde: it.brinde,
            motor_cv: it.motor_cv, motor_polos: it.motor_polos,
            motor_qtd: it.motor_qtd, foto_url: it.foto_url ?? null,
          })),
          motores: snapshot.motoresAgrupados,
          acessorios: snapshot.acessorios
            ? { pct: snapshot.acessorios.pct, items: snapshot.acessorios.items, valor: snapshot.acessorios.valor }
            : null,
          totalEquip: snapshot.totalEquip,
          totalMotores: snapshot.totalMotores,
          totalProposta: snapshot.totalGeral,
          formaPagamento: formaPgOut.forma_pagamento || snapshot.termsInline?.formaPagamento || null,
          dataVenda: (pgDataVenda ? formaPgOut.data_venda : null) || snapshot.termsInline?.dataVenda || null,
          prazoEntrega: prazoEntrega.trim() || snapshot.termsInline?.prazoEntrega || null,
          observacoes: observacoes.trim() || null,
          vendedorNome: profile?.display_name || 'Vendedor',
        })
        docxFonte = 'custom'
        console.log(`[gerar] docx (custom) OK (${docxBlob.size} bytes)`)
      } catch (customErr) {
        console.warn('[gerar] custom-docx falhou, tentando html-to-docx:', customErr)
      }
      // Tier 2: html-to-docx (fallback)
      if (!docxBlob) {
        try {
          docxBlob = await gerarDocxViaHtml(previewProps)
          docxFonte = 'html-to-docx'
          console.log(`[gerar] docx (html-to-docx fallback) OK (${docxBlob.size} bytes)`)
        } catch (e) {
          console.error('[gerar] ERRO docx (todos os tiers falharam):', e)
          docxBlob = new Blob([(e as Error).message], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
          setErro(`Aviso: falha ao gerar Word (${(e as Error).message}).`)
        }
      }
      console.log(`[gerar] docx fonte final: ${docxFonte}`)

      // 4b) PDF — cascata de 3 estratégias:
      //   Tier 1: Puppeteer server-side (gerar-pdf.ts) — renderiza HTML/CSS
      //     exato da prévia, Chrome faz paginação NATIVA. Layout idêntico ao
      //     que o usuário vê na tela. Vetorial, texto selecionável.
      //   Tier 2: DOCX→ConvertAPI — fallback se Puppeteer cair (cold start
      //     longo, quota Vercel). Layout Word (tabelas).
      //   Tier 3: html2canvas legacy — último recurso (offline, etc).
      setStep('Gerando PDF (renderização HTML)...', 45)
      let pdfBlob: Blob | null = null
      let pdfErro: string | null = null
      let pdfFonte: 'puppeteer' | 'convertapi' | 'html2canvas' = 'puppeteer'
      try {
        const t0 = Date.now()
        pdfBlob = await gerarPdfServerSide(previewProps)
        pdfFonte = 'puppeteer'
        console.log(`[gerar] pdf via Puppeteer OK em ${Date.now() - t0}ms (${pdfBlob.size} bytes)`)
      } catch (pupErr) {
        console.warn('[gerar] Puppeteer falhou, tentando DOCX→ConvertAPI:', pupErr)
        setStep('Convertendo Word em PDF...', 50)
        try {
          const t0 = Date.now()
          pdfBlob = await docxParaPdfServer(docxBlob, `orcamento-${orc.numero}.docx`)
          pdfFonte = 'convertapi'
          console.log(`[gerar] pdf via DOCX→ConvertAPI OK em ${Date.now() - t0}ms`)
        } catch (convertErr) {
          console.warn('[gerar] DOCX→PDF ConvertAPI falhou, fallback html2canvas:', convertErr)
          setStep('Gerando PDF local...', 55)
          try {
            pdfBlob = await gerarPdfDoPreview(previewProps, { quality: opcoes.pdfQuality })
            pdfFonte = 'html2canvas'
          } catch (e) {
            pdfErro = (e as Error).message
            console.warn('Falha PDF (todos os caminhos):', pdfErro)
          }
        }
      }
      console.log(`[gerar] pdf fonte final: ${pdfFonte}`)

      // Detecta modo teste: se rootHandle salvo tem 'teste' no nome
      let isTesteMode = false
      try {
        const h = await getStoredFolderHandle()
        if (h && (h as any).name && /teste/i.test((h as any).name)) isTesteMode = true
      } catch {}
      const base = nomeBase(orc.numero, cliNome, descricao || sugestao, isTesteMode)
      // Filename curto pro WhatsApp (sem descricao do produto)
      const baseWhatsApp = nomeBaseWhatsApp(orc.numero, cliNome)
      let baixouDocx = false, baixouPdf = false, salvouNaPasta = false

      setStep('Preparando para salvar...', 70)
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
            // .txt com data de envio (igual modelo pronto). Usado p/ rastrear
            // quando o vendedor enviou o orçamento pro cliente.
            try {
              const vendedorNome = profile?.display_name || 'Vendedor'
              const notaTxt = montarNotaTxt(vendedorNome, hoje)
              const txtBlob = new Blob([notaTxt], { type: 'text/plain;charset=utf-8' })
              await escreverArquivo(pastaMes, `${base} - ${vendedorNome}.txt`, txtBlob)
            } catch (txtErr) { console.warn('Falha .txt:', txtErr) }
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
      } else if (opcoes.salvarNoServidor) {
        // 6c) Upload via /api/orcamento-presign + /api/orcamento-confirm
        // (server-side, bypassa RLS/session stale, dispara WhatsApp atomicamente).
        setStep('Enviando pro servidor...', 75)
        const vendedorNome = profile?.display_name || 'Vendedor'
        const notaTxt = montarNotaTxt(vendedorNome, hoje)
        const txtBlob = new Blob([notaTxt], { type: 'text/plain;charset=utf-8' })
        const ano = String(hoje.getFullYear())
        const mes = String(hoje.getMonth() + 1).padStart(2, '0')

        try {
          const upRes = await uploadOrcamentoViaServer({
            orcamentoId: orc.id,
            numero: orc.numero,
            ano, mes, base,
            vendedorNome,
            clienteNome: cliNome.trim(),
            docxBlob,
            pdfBlob,
            txtBlob,
            sendWhatsApp: !!pdfBlob,
            whatsAppFilename: `${baseWhatsApp}.pdf`,
            whatsAppCaption: `📄 Orçamento ${orc.numero} — ${cliNome.trim()}\n\nPersonalizado: ${descricao || sugestao}\nGerado em ${dataEmissaoBR}\n\n👇 Encaminhe pro cliente`,
            onProgress: (s) => {
              // Heurística: cada update do upload empurra +3% (cap em 92%).
              // Mensagem do server vence o label local.
              setGerandoStep(s)
              setGerandoProgress(p => Math.min(92, Math.max(p, p + 3)))
            },
          })
          baixouDocx = true
          if (pdfBlob) baixouPdf = true
          salvouNaPasta = true
          // WhatsApp status (vem do server)
          if (pdfBlob) {
            if (upRes.whatsapp?.ok) {
              setWaStatus('sent')
              setWaMsg(upRes.whatsapp.msg || 'PDF enviado pro seu WhatsApp.')
            } else if (upRes.whatsapp?.error) {
              setWaStatus('error')
              setWaMsg(`WhatsApp falhou: ${upRes.whatsapp.error}`)
            }
          }
          if (upRes.detalhes) {
            console.warn('[salvar-pasta]', upRes.detalhes)
          }
        } catch (e) {
          console.error('Falha upload via server:', e)
          // Fallback: baixa local pra nao perder trabalho + erro visivel
          baixarBlob(docxBlob, `${base}.docx`)
          baixouDocx = true
          if (pdfBlob) {
            baixarBlob(pdfBlob, `${base}.pdf`)
            baixouPdf = true
          }
          setErro(`Upload pro servidor FALHOU: ${(e as Error).message}. Arquivos baixados localmente como fallback. Tente de novo ou peça ajuda.`)
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

      // 7) Enviar PDF pro WhatsApp do proprio vendedor (sempre automático)
      // Se foi salvarNoServidor, o WhatsApp ja foi disparado pelo helper /api/orcamento-confirm.
      // Esse bloco serve so pros casos salvarNaPasta (FileSystem local) ou download direto.
      if (pdfBlob && !opcoes.salvarNoServidor) {
        setStep('Enviando pro seu WhatsApp...', 95)
        setWaStatus('sending')
        setWaMsg('Enviando pro seu WhatsApp...')
        try {
          const ano = String(hoje.getFullYear())
          const mes = String(hoje.getMonth() + 1).padStart(2, '0')
          const envioPath = `_envios/${ano}/${mes}/${base}.pdf`
          const { error: upErr } = await supabase.storage
            .from('orcamentos-pendentes')
            .upload(envioPath, pdfBlob, { contentType: 'application/pdf', upsert: true })
          if (upErr) throw new Error('upload envio: ' + upErr.message)

          const { data: signed, error: sErr } = await supabase.storage
            .from('orcamentos-pendentes')
            .createSignedUrl(envioPath, 60 * 60 * 24 * 7)
          if (sErr || !signed?.signedUrl) throw new Error('signed_url: ' + (sErr?.message ?? 'sem url'))

          // Passa SÓ o primeiro nome em UPPERCASE (vendors.name eh 'DANIEL' nao 'DANIEL PETERS')
          const primeiroNome = profile?.display_name?.trim().split(/\s+/)[0]?.toUpperCase() || undefined
          const { data: fnData, error: fnErr } = await supabase.functions.invoke('orcamento-enviar-meu-zap', {
            body: {
              vendedor_nome: primeiroNome,
              pdf_url: signed.signedUrl,
              filename: `${baseWhatsApp}.pdf`,
              cliente_nome: cliNome.trim(),
              caption: `📄 Orçamento ${orc.numero} — ${cliNome.trim()}\n\nPersonalizado: ${descricao || sugestao}\nGerado em ${dataEmissaoBR}\n\n👇 Encaminhe pro cliente`,
            },
          })
          if (fnErr) throw new Error(fnErr.message)
          if (fnData?.error) throw new Error(fnData.detail || fnData.error)
          setWaStatus('sent')
          setWaMsg(fnData?.msg || `PDF enviado pro seu WhatsApp. Chega em até 30s.`)
        } catch (e) {
          const m = (e as Error).message
          console.warn('Falha enviar pro WhatsApp do vendedor:', m)
          setWaStatus('error')
          setWaMsg(`Não consegui enviar pro seu WhatsApp: ${m}`)
        }
      }

      setGerandoStep('Pronto!')
      setGerandoProgress(100)
      onSuccess({ numero: orc.numero, baixouDocx, baixouPdf, salvouNaPasta, pdfBlob, cliente: cliNome.trim(), erro, pdfErro })
      if (pdfErro) alert(`Orçamento gerado, mas PDF falhou: ${pdfErro}\n.docx foi gerado normalmente.`)
    } catch (e) {
      setErro((e as Error).message)
    } finally {
      // Mantém barra cheia visível por meio segundo antes de liberar o modal —
      // sensação de "concluído" pro vendedor (senão a barra some no meio).
      setTimeout(() => {
        setGerando(false)
        setGerandoProgress(0)
        setGerandoStep('')
      }, 500)
    }
  }

  if (!open) return null

  // Headless mode: overlay global (GenerationOverlay no Layout) mostra progresso.
  // Este componente não renderiza nada — a lógica roda em background.
  if (headlessMode) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !gerando && onClose()}>
      <div
        className="bg-bg border border-border rounded-lg max-w-3xl w-full max-h-[100dvh] sm:max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-4 border-b border-border sticky top-0 bg-bg z-10">
          <h2 className="text-[16px] font-semibold text-ink flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" />
            {saveMode === 'update' ? 'Atualizar orçamento' : saveMode === 'alt' ? 'Criar versão alternativa' : 'Finalizar orçamento personalizado'}
          </h2>
          <button onClick={onClose} disabled={gerando} className="text-ink-faint hover:text-ink p-1 disabled:opacity-30">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Barra de progresso — sticky logo abaixo do header. Aparece só durante
            o salvamento. Mostra etapa atual + % pra vendedor saber que está
            rolando (especialmente útil em mobile/3G onde os PDFs demoram). */}
        {gerando && (
          <div className="sticky top-[57px] z-10 bg-bg border-b border-border px-4 py-3">
            <div className="flex items-center justify-between mb-1.5 gap-3">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0 text-accent" />
                <span className="text-[12px] font-semibold text-ink truncate">
                  {gerandoStep || 'Salvando...'}
                </span>
              </div>
              <span className="text-[11px] font-bold text-accent tabular-nums shrink-0">
                {Math.round(gerandoProgress)}%
              </span>
            </div>
            <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
              <div
                className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
                style={{ width: `${gerandoProgress}%` }}
              />
            </div>
            <div className="text-[10px] text-ink-faint mt-1.5 leading-snug">
              Não feche essa janela. Arquivos sobem pro servidor e o PC do escritório sincroniza pra pasta <span className="font-mono">Z:\</span> automaticamente.
            </div>
          </div>
        )}

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

          {/* Número — sempre vem da pasta Z: do PC do escritorio (via Realtime broadcast).
              Independe de qual vendedor/dispositivo: PC do Daniel e a unica fonte de verdade. */}
          <div className="p-3 border border-border rounded-md">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Número do orçamento</span>
              <span
                className="text-[9px] px-1.5 py-0.5 rounded bg-success-bg/30 text-success"
                title="Próximo número disponível na pasta Z:\1 - Comercial\3 - Orçamento (consultado em tempo real)"
              >
                ✅ pasta Z: (escritório)
              </span>
            </div>
            <div className="text-[18px] font-bold text-accent">{numeroAtual || '—'}</div>
            <div className="text-[10px] text-ink-faint mt-1.5 leading-relaxed">
              📁 Salvo automaticamente em <span className="font-mono">Z:\1 - Comercial\3 - Orçamento</span> pelo PC do escritório.
            </div>
          </div>

          {/* Descrição (vai pro nome do arquivo) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">
                Descrição do orçamento
              </label>
              {descricaoTocada && descricao !== sugestao && (
                <button
                  type="button"
                  onClick={() => { setDescricao(sugestao); setDescricaoTocada(false) }}
                  className="text-[10px] text-accent hover:underline"
                  title="Voltar para sugestão automática"
                >
                  ↺ Auto: {sugestao}
                </button>
              )}
            </div>
            {/* Atalhos rápidos — modelos mais comuns */}
            <div className="flex flex-wrap gap-1.5 mb-2">
              {[
                'Mini Fábrica 300',
                'Mini Fábrica 600',
                'Compacta 01',
                'Compacta 01 Master',
                'Compacta 02',
                'Compacta 02 Master',
                'Compacta 03',
                'Compacta 03 Master',
                'Equipamento Avulso',
              ].map(modelo => (
                <button
                  key={modelo}
                  type="button"
                  onClick={() => { setDescricao(modelo); setDescricaoTocada(true) }}
                  className={`px-2 py-1 text-[11px] rounded-md border transition-colors ${
                    descricao === modelo
                      ? 'bg-accent/20 border-accent text-accent font-semibold'
                      : 'bg-surface-2/50 border-border text-ink-muted hover:border-ink-faint hover:text-ink'
                  }`}
                >
                  {modelo}
                </button>
              ))}
            </div>
            <Input
              value={descricao}
              onChange={e => { setDescricao(e.target.value); setDescricaoTocada(true) }}
              placeholder={sugestao}
              maxLength={100}
            />
            <div className="text-[10px] text-ink-faint mt-1">
              Vai pro nome do arquivo: <span className="font-mono text-ink-muted">{numeroAtual || '...'} - {cliNome || 'Cliente'} ({descricao || sugestao})</span>
            </div>
          </div>

          {/* Auto-preencher cliente */}
          <AutoPreencherCliente
            onApply={(r) => {
              if (r.cliente_nome) setCliNome(r.cliente_nome)
              setCliDados(d => ({ ...d, ...r.dados }))
            }}
          />

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

          {/* Dados do cliente (compacto) — basicos visiveis, avancados em accordion */}
          <div className="grid grid-cols-2 gap-2">
            <Input placeholder="A/C (contato)" autoComplete="name" value={cliDados.ac ?? ''} onChange={e => setCliDados(d => ({ ...d, ac: e.target.value }))} />
            <Input placeholder="Telefone" type="tel" inputMode="tel" autoComplete="tel" value={cliDados.fone ?? ''} onChange={e => setCliDados(d => ({ ...d, fone: e.target.value }))} />
            <Input placeholder="Endereço" autoComplete="street-address" value={cliDados.endereco ?? ''} onChange={e => setCliDados(d => ({ ...d, endereco: e.target.value }))} className="col-span-2" />
            <Input placeholder="Bairro" value={cliDados.bairro ?? ''} onChange={e => setCliDados(d => ({ ...d, bairro: e.target.value }))} />
            <Input placeholder="CEP" inputMode="numeric" autoComplete="postal-code" value={cliDados.cep ?? ''} onChange={e => setCliDados(d => ({ ...d, cep: e.target.value }))} />
            <div className="col-span-2 flex gap-2">
              <Input placeholder="Cidade" autoComplete="address-level2" value={cliDados.cidade ?? ''} onChange={e => setCliDados(d => ({ ...d, cidade: e.target.value }))} className="flex-1" />
              <Input placeholder="UF" autoComplete="address-level1" value={cliDados.uf ?? ''} onChange={e => setCliDados(d => ({ ...d, uf: e.target.value.toUpperCase().slice(0, 2) }))} className="w-16 uppercase text-center" maxLength={2} />
            </div>
          </div>
          <details
            className="group rounded-md border border-border bg-surface-2/20"
            // Abre auto se vendedor ja preencheu algum desses campos
            open={!!(cliDados.cnpj || cliDados.ie || cliDados.email)}
          >
            <summary className="cursor-pointer flex items-center gap-2 px-3 py-2 text-[11px] uppercase tracking-wider text-ink-muted font-semibold hover:text-ink select-none">
              <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
              Mais dados do cliente (CPF, IE, e-mail)
            </summary>
            <div className="grid grid-cols-2 gap-2 px-3 pb-3">
              <Input placeholder="CPF / CNPJ" inputMode="numeric" value={cliDados.cnpj ?? ''} onChange={e => setCliDados(d => ({ ...d, cnpj: e.target.value }))} />
              <Input placeholder="Inscrição Estadual" inputMode="numeric" value={cliDados.ie ?? ''} onChange={e => setCliDados(d => ({ ...d, ie: e.target.value }))} />
              <Input placeholder="E-mail" type="email" inputMode="email" autoComplete="email" value={cliDados.email ?? ''} onChange={e => setCliDados(d => ({ ...d, email: e.target.value }))} className="col-span-2" />
            </div>
          </details>

          {/* Forma de pagamento — accordion (abre default em rascunho novo,
              fica fechado se ja tem prazo/forma preenchidos pra economizar scroll) */}
          <details
            className="group rounded-md border border-border bg-surface-2/20"
            open={!formaPgOut.forma_pagamento}
          >
            <summary className="cursor-pointer flex items-center justify-between gap-2 px-3 py-2 select-none hover:text-ink">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-muted font-semibold">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                <CreditCard className="h-3 w-3" />
                Forma de pagamento
              </div>
              {formaPgOut.forma_pagamento && (
                <span className="text-[10px] text-ink-faint truncate max-w-[55%]" title={formaPgOut.forma_pagamento}>
                  {formaPgOut.forma_pagamento}
                </span>
              )}
            </summary>
            <div className="px-3 pb-3 space-y-2">
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
            </div>
          </details>

          {/* Prazo + observacoes — accordion (opcional, vendedor abre se precisar) */}
          <details
            className="group rounded-md border border-border bg-surface-2/20"
            open={!!(prazoEntrega || observacoes)}
          >
            <summary className="cursor-pointer flex items-center justify-between gap-2 px-3 py-2 select-none hover:text-ink">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-ink-muted font-semibold">
                <ChevronRight className="h-3 w-3 transition-transform group-open:rotate-90" />
                Prazo de entrega e observações
              </div>
              {(prazoEntrega || observacoes) && (
                <span className="text-[10px] text-ink-faint">{[prazoEntrega && 'prazo', observacoes && 'obs'].filter(Boolean).join(' + ')}</span>
              )}
            </summary>
            <div className="px-3 pb-3 space-y-2">
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Prazo de entrega</label>
                <Input value={prazoEntrega} onChange={e => setPrazoEntrega(e.target.value)} placeholder="Ex: 30 dias após confirmação do pagamento" className="mt-1" />
              </div>
              <div>
                <label className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Observações</label>
                <textarea
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  placeholder="Observações adicionais (opcional)..."
                  rows={3}
                  className="w-full mt-1 px-2 py-1.5 text-[12px] bg-surface-2 border border-border rounded-md focus:outline-none focus:border-accent"
                />
              </div>
            </div>
          </details>

          {snapshot.fotoPrincipal && (
            <div className="border border-border rounded p-2 bg-surface-2/30">
              <div className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold mb-1">Foto principal incluída</div>
              <img src={snapshot.fotoPrincipal} alt="preview" className="max-h-32 mx-auto" />
            </div>
          )}

          {/* PDF sempre enviado pro WhatsApp do vendedor automaticamente */}
          <div className="flex items-start gap-2 p-3 border border-emerald-300 rounded-md bg-emerald-50/40">
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-emerald-700 flex items-center gap-1.5">
                📲 PDF será enviado pro seu WhatsApp automaticamente
              </div>
              <div className="text-[10px] text-emerald-600/70 mt-0.5">
                Chega em até 30s após gerar. Você só encaminha pro cliente.
              </div>
            </div>
          </div>

          {/* PDF vetorial: tenta server-side (Puppeteer/Chrome), fallback scale 8 client. */}
          <label className="flex items-start gap-2 p-3 border border-border rounded-md bg-surface-2/30 cursor-pointer hover:bg-surface-2/50 transition-colors">
            <input
              type="checkbox"
              checked={pdfAltaQualidade}
              onChange={e => setPdfAltaQualidade(e.target.checked)}
              className="mt-0.5 h-4 w-4 accent-accent"
            />
            <div className="flex-1">
              <div className="text-[12px] font-semibold text-ink flex items-center gap-1.5">
                🎨 PDF alta qualidade (vetorial)
              </div>
              <div className="text-[10px] text-ink-faint mt-0.5">
                Renderiza no servidor (Chrome real) — texto selecionável, zoom infinito, ideal pra impressão. Demora ~5-10s a mais. Se o servidor falhar, cai pro modo local em alta resolução.
              </div>
            </div>
          </label>

          {/* Status do envio WhatsApp */}
          {waStatus !== 'idle' && (
            <div
              className={`p-3 rounded-md text-[11px] flex items-start gap-2 border ${
                waStatus === 'sending' ? 'bg-warning-bg/15 border-warning/30 text-warning' :
                waStatus === 'sent' ? 'bg-success-bg/15 border-success/30 text-success' :
                'bg-danger-bg/15 border-danger/30 text-danger'
              }`}
            >
              {waStatus === 'sending' && <Loader2 className="h-3.5 w-3.5 animate-spin mt-0.5 shrink-0" />}
              {waStatus === 'sent' && <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              {waStatus === 'error' && <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />}
              <div className="flex-1">{waMsg}</div>
            </div>
          )}

          {erro && (
            <div className="p-3 bg-danger-bg/15 border border-danger/30 rounded-md text-[11px] text-danger">
              {erro}
            </div>
          )}

          {/* Indicador de progresso movido pro topo (barra sticky abaixo do header). */}
        </div>

        {/* Footer: empilha em mobile, lado-a-lado em desktop. CTA principal
            em cima (mais touch-friendly) e ocupa largura total. */}
        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-border sticky bottom-0 bg-bg">
          <button
            onClick={onClose}
            disabled={gerando}
            className="text-[13px] px-4 py-2.5 rounded bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink font-semibold disabled:opacity-50 min-h-[44px]"
          >
            Cancelar
          </button>
          {/* UM unico botao: sempre salva no servidor (que sincroniza com Z:\)
              + manda pro WhatsApp do vendedor se checkbox marcada.
              Removido botao 'Só baixar' que causava confusao — user clicava
              nele por engano e o arquivo nao ia pra pasta. */}
          <button
            onClick={() => handleGerar({ salvarNaPasta: temPastaLocal, salvarNoServidor: !temPastaLocal, pdfQuality: pdfAltaQualidade ? 'high' : 'normal' })}
            disabled={gerando || !cliNome.trim()}
            className="text-[13px] px-5 py-2.5 rounded bg-accent hover:bg-accent/90 text-white font-bold disabled:opacity-50 flex items-center justify-center gap-1.5 min-h-[44px] shadow-sm flex-1 sm:flex-initial"
            title="Salva pra pasta Z:\1 - Comercial\3 - Orçamento — sincronizado pelo PC do escritório"
          >
            {gerando ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderOpen className="h-4 w-4" />}
            {gerando ? 'Salvando...' : saveMode === 'update' ? 'Atualizar e salvar' : saveMode === 'alt' ? 'Criar ALT e salvar' : 'Salvar na pasta'}
          </button>
        </div>
      </div>
    </div>
  )
}


// ─── AUTO-PREENCHER CLIENTE ─────────────────────────────────────────────
// Cola texto bagunçado (CNPJ, nome, fone, endereço…) e extrai os campos.
// MODO RÁPIDO (regex local): offline, instantâneo, 80% dos casos.
// MODO IA (Gemini Flash via Edge Function): pra textos complexos / conversacionais.
function AutoPreencherCliente({ onApply }: { onApply: (r: ReturnType<typeof parseClienteText>) => void }) {
  const [aberto, setAberto] = useState(false)
  const [texto, setTexto] = useState('')
  const [resultado, setResultado] = useState<ReturnType<typeof parseClienteText> | null>(null)
  const [carregandoIA, setCarregandoIA] = useState(false)
  const [erroIA, setErroIA] = useState<string | null>(null)

  function processarRegex() {
    setErroIA(null)
    const r = parseClienteText(texto)
    setResultado(r)
    onApply(r)
  }

  async function processarIA() {
    setErroIA(null)
    setCarregandoIA(true)
    try {
      const { data, error } = await supabase.functions.invoke('parse-cliente-ia', {
        body: { texto },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      const p = data?.parsed
      if (!p) throw new Error('resposta vazia')
      // Converte pra ParseResult (compatível com regex)
      // Normaliza casing antes de aplicar (Gemini retorna meio aleatorio)
      const tc = (v: string | null | undefined) => v ? titleCasePtBr(v) : undefined
      const r: ReturnType<typeof parseClienteText> = {
        cliente_nome: tc(p.cliente_nome) ?? '',
        dados: {
          ac: tc(p.ac),
          fone: p.fone ?? undefined,
          cidade: tc(p.cidade),
          uf: p.uf ? String(p.uf).toUpperCase().slice(0, 2) : undefined,
          bairro: tc(p.bairro),
          endereco: tc(p.endereco),
          cep: p.cep ?? undefined,
          cnpj: p.cnpj ?? undefined,
          ie: p.ie ?? undefined,
          email: p.email ?? undefined,
        },
        naoReconhecido: [],
      }
      // Limpa undefined pra não sobrescrever campos com vazio
      Object.keys(r.dados).forEach(k => {
        if ((r.dados as any)[k] == null) delete (r.dados as any)[k]
      })
      setResultado(r)
      onApply(r)
    } catch (e) {
      setErroIA('Falha na IA: ' + ((e as Error).message || 'erro desconhecido') + '. Tente o modo rápido.')
    } finally {
      setCarregandoIA(false)
    }
  }

  if (!aberto) {
    return (
      <button
        type="button"
        onClick={() => setAberto(true)}
        className="text-[11px] px-2.5 py-1.5 rounded-md border border-accent/40 text-accent bg-accent-bg/50 hover:bg-accent-bg/80 font-semibold transition flex items-center gap-1.5"
        title="Cola dados do cliente (qualquer formato) e preenche automaticamente"
      >
        ✨ Auto-preencher
      </button>
    )
  }

  const camposPreenchidos = resultado
    ? Object.values(resultado.dados).filter(Boolean).length + (resultado.cliente_nome ? 1 : 0)
    : 0

  return (
    <div className="rounded-md border border-border bg-surface-2/30 overflow-hidden">
      {/* Header compacto */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-[11px] uppercase tracking-wider font-semibold text-ink-muted flex items-center gap-1.5">
          ✨ Auto-preencher
        </span>
        <button
          onClick={() => { setAberto(false); setTexto(''); setResultado(null); setErroIA(null) }}
          className="text-ink-faint hover:text-ink text-[16px] leading-none px-1"
          title="Fechar"
        >×</button>
      </div>

      <div className="p-3 space-y-2.5">
        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          placeholder="Cola qualquer texto com dados do cliente — nome, CNPJ, endereço, telefone, email…"
          rows={3}
          className="w-full text-[12px] px-2.5 py-2 border border-border rounded-md bg-surface text-ink placeholder:text-ink-faint outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 resize-none"
        />

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={processarRegex}
            disabled={!texto.trim() || carregandoIA}
            className="text-[12px] px-3 py-2 rounded-md bg-surface border border-border text-ink-muted font-semibold hover:text-ink hover:border-border-strong disabled:opacity-50 flex items-center justify-center gap-1.5"
            title="Extração local instantânea (regex). Ideal pra texto estruturado."
          >
            ⚡ Rápido
          </button>
          <button
            type="button"
            onClick={processarIA}
            disabled={!texto.trim() || carregandoIA}
            className="text-[12px] px-3 py-2 rounded-md bg-accent text-white font-semibold hover:bg-accent/90 disabled:opacity-50 flex items-center justify-center gap-1.5 shadow-sm"
            title="IA Gemini — melhor pra textos complexos. ~2s."
          >
            {carregandoIA ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : '🧠'}
            {carregandoIA ? 'pensando...' : 'IA'}
          </button>
        </div>

        {resultado && (
          <div className="flex items-center gap-1.5 text-[11px] px-2 py-1.5 bg-success-bg/30 text-success border border-success/30 rounded">
            <Check className="h-3 w-3" />
            <span className="font-semibold">{resultado.cliente_nome || 'Cliente'}</span>
            <span className="text-ink-muted">· {camposPreenchidos} campo(s)</span>
            {resultado.naoReconhecido.length > 0 && (
              <span className="text-warning ml-auto">{resultado.naoReconhecido.length} ignorada(s)</span>
            )}
          </div>
        )}

        {erroIA && (
          <div className="text-[11px] text-danger bg-danger-bg/15 border border-danger/30 rounded px-2 py-1.5">{erroIA}</div>
        )}

        {resultado && resultado.naoReconhecido.length > 0 && (
          <details className="text-[10px] text-ink-faint">
            <summary className="cursor-pointer hover:text-ink-muted">Linhas ignoradas (preencha manualmente)</summary>
            <ul className="mt-1 pl-3 space-y-0.5 list-disc list-inside">
              {resultado.naoReconhecido.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          </details>
        )}
      </div>
    </div>
  )
}
