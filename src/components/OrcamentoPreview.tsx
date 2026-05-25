// Preview do orçamento personalizado.
// Usado em 2 contextos:
//  1) Modo edit (default) — dentro de OrcamentoMontar com botões de remover/editar acessórios
//  2) Modo render — usado pelo gerador de PDF (preview-to-pdf.ts) com renderMode=true
//     e cliente/numero/data/terms preenchidos. Esconde os botões interativos.

import { Search, X } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { BRLInput } from '@/components/ui/BRLInput'

export interface PreviewItem {
  uid?: string
  catalogo_id?: number
  categoria: string
  nome: string
  nome_custom?: string | null  // se preenchido, sobrescreve nome no display
  specs: string[]
  qtd: number
  valor: number
  valor_original?: number
  motor_cv: number | null
  motor_polos: number | null
  motor_qtd: number
  motor_valor_unit?: number
  foto_url: string | null
  inox?: '304' | '316' | false
  tungstenio?: boolean
  brinde?: boolean
}

export interface PreviewMotor {
  cv: number
  polos: number
  qtd: number
  valor_unit: number
  valor_total: number
  item_nome?: string  // se vier, mostra "de qual item" o motor é
  item_uid?: string   // uid do CarrinhoItem origem — usado pelo onTrocarMotor
  motorIndex?: number // 0=principal, 1=secundário (quando item tem 2 motores)
}

// Motor do catálogo central (catalogo_motores). Passado pra o picker de troca.
export interface MotorCatalogoOption {
  id: number
  cv: number
  polos: number
  voltagem: string
  valor: number
}

export interface PreviewClienteDados {
  nome?: string
  ac?: string | null
  fone?: string | null
  cidade?: string | null
  bairro?: string | null
  endereco?: string | null
  cep?: string | null
  cnpj?: string | null
  ie?: string | null
  email?: string | null
}

export interface PreviewTerms {
  dataVenda?: string | null
  prazoEntrega?: string | null
  formaPagamento?: string | null
}

// Parcela estruturada de pagamento
export interface ParcelaPagamento {
  id: string
  dataTipo: 'no_pedido' | 'na_nf' | 'apos_nf' | 'data_fixa'
  dias?: number          // usado quando dataTipo='apos_nf'
  dataFixa?: string      // usado quando dataTipo='data_fixa' (formato BR DD/MM/AAAA)
  metodo: 'PIX' | 'BOLETO' | 'DINHEIRO' | 'TRANSFERENCIA' | 'CARTAO' | ''
  // Apenas UM dos dois: pct ou valor manual
  pct?: number
  valor?: number
}

// Componente extra (não fabricado pela Branorte)
export interface PreviewComponenteExtra {
  id: string
  nome: string
  valor: number
}

export interface OrcamentoPreviewProps {
  carrinho: PreviewItem[]
  motoresAgrupados: PreviewMotor[]
  voltagem: 'monofasico' | 'trifasico'
  totalItems: number
  totalMotores: number
  totalEquip: number
  totalGeral: number
  acessorios: { pct: number; items: string[]; valorFixo?: number | null } | null
  valorAcessorios: number
  componentesExtras?: PreviewComponenteExtra[]
  onUpdateComponentesExtras?: (items: PreviewComponenteExtra[]) => void
  // Sugestões puxadas do cadastro (precos_branorte) — apresentadas no popover "+ Adicionar"
  // com valor já preenchido. Vendedor pode editar depois. Se vazio, usa só presets fixos.
  componentesAdicionaisCatalogo?: Array<{ id: string; nome: string; valorSugerido: number | null }>

  // Render-mode overrides (opcional). Quando passados, usa em vez dos placeholders.
  numero?: string
  dataEmissao?: string
  cliente?: PreviewClienteDados
  terms?: PreviewTerms
  observacoesExtra?: string | null
  fotoPrincipal?: string | null  // dataURL ou URL — renderiza foto grande antes dos items

  // Modo render: esconde botões interativos (pra capturar pra PDF limpo)
  renderMode?: boolean

  // Tensão dos motores (global pra todos). null = "a confirmar".
  tensaoMotores?: 220 | 380 | 660 | null
  onUpdateTensaoMotores?: (tensao: 220 | 380 | 660 | null) => void

  // Desconto opcional (mostra valor com desconto abaixo do total)
  desconto?: { tipo: 'pct' | 'valor'; valor: number } | null
  onUpdateDesconto?: (d: { tipo: 'pct' | 'valor'; valor: number } | null) => void

  // Callbacks (apenas no modo edit)
  onAddAcessorios?: () => void
  /** Callback pra abrir o catálogo (ou modal de pickers) e adicionar mais um item.
   *  Aparece como botão "+ Adicionar mais um item" abaixo do último item. */
  onAddItem?: () => void
  onEditAcessorios?: () => void
  onRemoveAcessorios?: () => void
  onRemove?: (uid: string) => void
  onFotoChange?: (dataURL: string | null) => void
  onUpdateNome?: (uid: string, novoNome: string) => void
  onUpdateSpec?: (uid: string, idx: number, valor: string) => void
  onUpdateValor?: (uid: string, novoValor: number) => void
  onToggleInox?: (uid: string, tipo?: '304' | '316' | false) => void
  onToggleTungstenio?: (uid: string) => void
  onUpdateQtd?: (uid: string, novaQtd: number) => void
  onUpdateTerm?: (key: 'dataVenda' | 'prazoEntrega' | 'formaPagamento', valor: string) => void
  onMoverItem?: (uid: string, direcao: 'cima' | 'baixo') => void
  onToggleBrinde?: (uid: string) => void

  // Parcelas estruturadas (alternativa ao texto livre de formaPagamento)
  parcelas?: ParcelaPagamento[]
  onUpdateParcelas?: (p: ParcelaPagamento[]) => void

  // Troca de motor: lista de motores do catálogo central + callback ao escolher
  motoresDisponiveis?: MotorCatalogoOption[]
  onTrocarMotor?: (itemUid: string, novoMotor: MotorCatalogoOption, motorIndex?: number) => void

  // Vendedores Branorte pra grid de contatos no rodape. Quando passado, renderiza
  // dinamicamente em vez do hardcoded antigo (que so tinha 3 vendedores).
  // O vendedorResponsavelNome destaca quem ta vendendo esse orcamento.
  vendedoresContato?: Array<{ nome: string; telefone: string }>
  vendedorResponsavelNome?: string | null

  // Callback pra abrir editor de dados do cliente direto no preview
  onEditCliente?: () => void
}

function formatBRLBare(v: number): string {
  return Math.round(v).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Encontra posicao de quebra que NAO corta blocos atomicos.
// Estrategia:
//  1) Se idealY cai dentro de algum [data-no-break], move pra ANTES dele (top - margem)
//  2) Repete ate nenhum no-break ser atingido
//  3) Refina: pega o bottom de algum elemento entre (Y-15%, Y) pra colar a quebra no fim de bloco
function findBreakNear(container: HTMLElement, idealY: number, tolerance: number): number {
  const containerTop = container.getBoundingClientRect().top + window.scrollY
  const noBreakEls = Array.from(container.querySelectorAll('[data-no-break]')) as HTMLElement[]

  const localTop = (el: HTMLElement) => {
    const r = el.getBoundingClientRect()
    return { top: r.top + window.scrollY - containerTop, bottom: r.bottom + window.scrollY - containerTop }
  }

  // Helper: retorna o bloco no-break que contém o Y (ou null).
  // Expande o limite superior em 24px pra capturar a margin-top do SectionHeader
  // (mt-5 = 20px), que tecnicamente fica fora do bbox mas visualmente faz parte da seção.
  const findContaining = (y: number): HTMLElement | null => {
    for (const el of noBreakEls) {
      const { top, bottom } = localTop(el)
      if (y > top - 24 && y < bottom + 2) return el
    }
    return null
  }

  // 1) Se idealY cai dentro de algum no-break, tenta mover pra antes (margem 30px
  // pra dar respiro suficiente — borda/sombra/padding do box nao sao cortados)
  let y = idealY
  for (let iter = 0; iter < 8; iter++) {
    const hit = findContaining(y)
    if (!hit) break
    const { top } = localTop(hit)
    y = top - 30
  }

  // Se foi movido pra MUITO antes (perdemos > 30% da pagina), eh melhor empurrar pra DEPOIS do no-break original
  if (idealY - y > tolerance * 3) {
    // Pega o bloco originalmente atingido (em idealY) e move pra seu bottom
    const originalHit = findContaining(idealY)
    if (originalHit) {
      const { bottom } = localTop(originalHit)
      return bottom + 16
    }
  }

  // Garantia final: se ainda está dentro de algum bloco apos os 8 iters,
  // empurra pro fim do bloco (preferimos pagina mais cheia a quebra ruim)
  const stillIn = findContaining(y)
  if (stillIn) {
    const { bottom } = localTop(stillIn)
    return bottom + 16
  }

  // 2) Refino: cola no fim de algum elemento entre (y-tolerance, y) pra ficar limpo
  const minRefine = y - tolerance
  let bestBottom = y
  let bestDist = Infinity
  const allBlocks: HTMLElement[] = []
  for (const child of Array.from(container.children) as HTMLElement[]) {
    allBlocks.push(child)
    for (const g of Array.from(child.children) as HTMLElement[]) {
      allBlocks.push(g)
    }
  }
  for (const el of allBlocks) {
    const { bottom } = localTop(el)
    if (bottom >= minRefine && bottom <= y + 4) {
      const d = Math.abs(y - bottom)
      if (d < bestDist) {
        bestDist = d
        bestBottom = bottom
      }
    }
  }
  return bestBottom
}

export function OrcamentoPreview(props: OrcamentoPreviewProps) {
  const {
    carrinho, motoresAgrupados, voltagem,
    totalItems, totalMotores, totalEquip, totalGeral,
    acessorios, valorAcessorios,
    numero, dataEmissao, cliente, terms, observacoesExtra, fotoPrincipal,
    renderMode = false,
    tensaoMotores = null, onUpdateTensaoMotores,
    desconto, onUpdateDesconto,
    onAddAcessorios, onAddItem, onEditAcessorios, onRemoveAcessorios, onRemove, onFotoChange, onUpdateNome, onUpdateSpec, onUpdateValor, onToggleInox, onToggleTungstenio, onUpdateQtd, onUpdateTerm, onMoverItem, onToggleBrinde,
    componentesExtras = [], onUpdateComponentesExtras, componentesAdicionaisCatalogo = [],
    parcelas, onUpdateParcelas,
    motoresDisponiveis, onTrocarMotor,
    vendedoresContato, vendedorResponsavelNome,
    onEditCliente,
  } = props
  const [editingNomeUid, setEditingNomeUid] = useState<string | null>(null)
  const [editingNomeValor, setEditingNomeValor] = useState<string>('')
  // Edição inline de spec (bullet) — duplo-click ativa
  const [editingSpecKey, setEditingSpecKey] = useState<string | null>(null) // formato "uid|idx"
  const [editingSpecValor, setEditingSpecValor] = useState<string>('')
  // Edição inline de quantidade (o "01" no header do item)
  const [editingQtdUid, setEditingQtdUid] = useState<string | null>(null)
  const [editingQtdValor, setEditingQtdValor] = useState<string>('')
  // Edição inline de valor (duplo-click no "VALOR R$ X.XXX")
  const [editingValorUid, setEditingValorUid] = useState<string | null>(null)
  const [editingValorStr, setEditingValorStr] = useState<string>('')
  // Modal de senha pra editar valor
  const [senhaModalUid, setSenhaModalUid] = useState<string | null>(null)
  const [senhaInput, setSenhaInput] = useState('')
  const [senhaErro, setSenhaErro] = useState(false)
  // Menu de escolha Inox (304 vs 316)
  const [inoxMenuOpen, setInoxMenuOpen] = useState<string | null>(null)
  // Picker de componente extra (modal do "+ Adicionar")
  const [extraPickerOpen, setExtraPickerOpen] = useState(false)
  const [extraPickerBusca, setExtraPickerBusca] = useState('')
  // Estado do picker de troca de motor (qual linha tem o dropdown aberto)
  const [trocarMotorIdx, setTrocarMotorIdx] = useState<number | null>(null)
  const [motorBusca, setMotorBusca] = useState('')
  void totalItems  // mostrado no footer do builder, não no preview

  // Total com desconto (se houver). Usado nas parcelas de pagamento.
  const _descontoVal = desconto
    ? (desconto.tipo === 'pct' ? totalGeral * (desconto.valor / 100) : desconto.valor)
    : 0
  const totalComDesconto = Math.max(0, totalGeral - _descontoVal)

  const motoresTitle = voltagem === 'monofasico' ? 'Motores Monofásicos:' : 'Motores Trifásicos:'
  const mostrarTotalEquip = carrinho.length > 1 || acessorios !== null
  const hoje = dataEmissao || new Date().toLocaleDateString('pt-BR')
  const numeroExibido = numero || '[a definir]'
  const numeroIsPlaceholder = !numero

  const cli = cliente || {}

  // Helper pra renderizar valor ou placeholder cinza
  const valOrPlaceholder = (v: string | null | undefined, ph = '—') => {
    if (v && v.trim()) return <span className="text-gray-700 font-semibold ml-1">{v}</span>
    return <span className="text-gray-400 font-semibold ml-1">{ph}</span>
  }

  const camposEmpilhados: Array<[string, string | null | undefined]> = [
    ['CIDADE', cli.cidade],
    ['BAIRRO', cli.bairro],
    ['ENDEREÇO', cli.endereco],
    ['CEP', cli.cep],
    ['CPF/CNPJ', cli.cnpj],
    ['I.E.', cli.ie],
    ['E-MAIL', cli.email],
  ]

  // Termos
  const dataVendaTxt = terms?.dataVenda || ''
  const dataVendaIsPlaceholder = !dataVendaTxt
  const prazoEntregaTxt = terms?.prazoEntrega || '90 dias (úteis)'
  const formaPagamentoTxt = terms?.formaPagamento || ''
  const formaPgIsPlaceholder = !formaPagamentoTxt

  // Helper: cabeçalho de seção
  const SectionHeader = ({ children }: { children: React.ReactNode }) => (
    <div className="mt-5 mb-2">
      <div className="text-[15px] font-bold tracking-wider uppercase text-gray-700 pb-1.5 border-b-2 border-gray-800">
        {children}
      </div>
    </div>
  )

  // Page break visualization (so em modo edit, nao no PDF render)
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [pageBreaks, setPageBreaks] = useState<number[]>([])
  const [pageHeight, setPageHeight] = useState<number>(0)
  // Folhas calculadas: cada uma tem top/bottom em CSS px relativos ao innerRef
  // Usadas pra desenhar moldura preta INDEPENDENTE em volta de cada folha
  const [folhas, setFolhas] = useState<Array<{ top: number; bottom: number }>>([])
  // Em MOBILE nao mostra marcadores de quebra A4 — eles sobrepoem o conteudo
  // (spacers DOM injetados ficam por cima do texto/logo) e nao agregam valor
  // no celular onde o user nao esta editando layout pra impressao
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 768
  )
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 767px)')
    const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useLayoutEffect(() => {
    // Skip em mobile — marcadores poluem visual sem agregar valor
    if (renderMode || isMobile || !containerRef.current || !innerRef.current) return

    let isInternalMutation = false
    let lastWidth = 0
    let pendingTimer: any = null

    const cleanGaps = () => {
      innerRef.current?.querySelectorAll('.page-gap-spacer').forEach(el => el.remove())
    }

    const recalc = () => {
      if (!innerRef.current) return
      isInternalMutation = true
      cleanGaps()
      const w = innerRef.current.offsetWidth
      const h = innerRef.current.offsetHeight
      lastWidth = w
      const A4_H = w * (297 / 210)
      setPageHeight(A4_H)

      const breaks: number[] = []
      let y = A4_H
      let safety = 0
      while (y < h && safety++ < 20) {
        const adjusted = findBreakNear(innerRef.current, y, A4_H * 0.10)
        breaks.push(adjusted)
        y = adjusted + A4_H
      }
      setPageBreaks(breaks)

      // Insere SPACERS reais entre folhas
      const containerTop = innerRef.current.getBoundingClientRect().top + window.scrollY
      const allEls = Array.from(innerRef.current.querySelectorAll('div, table')) as HTMLElement[]
      const spacerHeight = 80  // px — gap visual entre folhas (incluindo respiro topo/baixo)
      // Posicoes Y atuais de cada spacer DEPOIS de inserido (acumulam offset)
      const spacerYs: number[] = []
      let acumOffset = 0
      for (let i = 0; i < breaks.length; i++) {
        const breakY = breaks[i]
        let bestEl: HTMLElement | null = null
        let bestBottom = -1
        for (const el of allEls) {
          if (el.classList.contains('page-gap-spacer')) continue
          const noBreakParent = el.closest('[data-no-break]')
          if (noBreakParent && noBreakParent !== el) continue
          const r = el.getBoundingClientRect()
          const bottom = r.bottom + window.scrollY - containerTop
          if (bottom <= breakY + 4 && bottom > bestBottom) {
            bestBottom = bottom
            bestEl = el
          }
        }
        if (bestEl && bestEl.parentNode) {
          const gap = document.createElement('div')
          gap.className = 'page-gap-spacer'
          gap.style.cssText = [
            `height: ${spacerHeight}px`,
            'box-sizing: border-box',
            'background: transparent',  // deixa o BG da app aparecer (gap real entre folhas)
            'margin: 0 -28px',  // estende ALEM da moldura
            'padding: 28px 0',  // ↑ desgruda o texto do conteudo da folha (28 acima + 28 abaixo + ~24 do texto)
            'display: flex',
            'align-items: center',
            'justify-content: center',
            'font-size: 10px',
            'font-weight: bold',
            'color: #6b7280',
            'letter-spacing: 0.15em',
            'text-transform: uppercase',
          ].join(';')
          gap.textContent = `↓ Folha ${i + 2} / ${breaks.length + 1} ↓`
          bestEl.parentNode.insertBefore(gap, bestEl.nextSibling)
          // Calcula Y do spacer (posicao top apos insert) — sera usada pra desenhar moldura
          spacerYs.push(bestBottom + acumOffset)
          acumOffset += spacerHeight
        }
      }
      // Calcula folhas (top, bottom) LENDO POSICAO REAL dos spacers no DOM
      // (depois do reflow os spacers ja estao na posicao final)
      requestAnimationFrame(() => {
        if (!innerRef.current) return
        void spacerYs  // valores antigos calculados pre-insert ficam pra reference
        const containerTopReal = innerRef.current.getBoundingClientRect().top + window.scrollY
        const totalH = innerRef.current.offsetHeight
        const spacersReal = Array.from(innerRef.current.querySelectorAll('.page-gap-spacer')) as HTMLElement[]
        const novasFolhas: Array<{ top: number; bottom: number }> = []
        let prevBottom = 0
        for (const sp of spacersReal) {
          const r = sp.getBoundingClientRect()
          const spTop = r.top + window.scrollY - containerTopReal
          const spBot = r.bottom + window.scrollY - containerTopReal
          novasFolhas.push({ top: prevBottom, bottom: spTop })
          prevBottom = spBot
        }
        // Ultima folha (apos ultimo spacer ate o fim)
        novasFolhas.push({ top: prevBottom, bottom: totalH })
        setFolhas(novasFolhas)
      })
      // Libera observer DEPOIS do paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { isInternalMutation = false })
      })
    }

    const debouncedRecalc = () => {
      clearTimeout(pendingTimer)
      pendingTimer = setTimeout(recalc, 50)
    }

    // Observer SO reage a mudanca de LARGURA (nao altura — altura muda quando inserimos spacers)
    const ro = new ResizeObserver(() => {
      if (isInternalMutation) return
      const newW = innerRef.current?.offsetWidth ?? 0
      if (Math.abs(newW - lastWidth) < 2) return  // ignora pequenas variacoes
      debouncedRecalc()
    })
    ro.observe(innerRef.current)
    recalc()
    return () => {
      ro.disconnect()
      clearTimeout(pendingTimer)
      cleanGaps()
    }
  }, [renderMode, isMobile, carrinho, motoresAgrupados, acessorios])

  return (
    <div ref={containerRef} className={`text-gray-900 leading-relaxed font-sans bg-white ${renderMode ? 'text-[19px]' : 'text-[15px]'}`}>
      {/* Em mobile, padding menor pra ganhar espaço lateral. Tabelas internas
          (motores, parcelas, componentes) já têm overflow-x próprio quando precisam. */}
      {/* Borda UNICA envolvendo o orcamento inteiro (nao mais por folha — molduras
          por folha estavam riscando os cards no meio). Linhas pontilhadas indicam
          quebra de pagina A4 sem ficar visualmente intrusivo. */}
      <div ref={innerRef} className={`m-1 sm:m-2 lg:m-4 px-2 sm:px-3 lg:px-6 pt-3 sm:pt-4 lg:pt-5 pb-4 sm:pb-5 lg:pb-6 relative ${renderMode ? '' : 'border border-gray-900'}`}>
        {/* Marcadores de quebra de pagina (so linha pontilhada horizontal) */}
        {!renderMode && !isMobile && folhas.length > 1 && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true" style={{ zIndex: 0 }}>
            {folhas.slice(0, -1).map((f, i) => (
              <div
                key={i}
                className="absolute left-4 right-4"
                style={{
                  top: `${f.bottom}px`,
                  height: 0,
                  borderTop: '1px dashed #d1d5db',
                  zIndex: 0,
                }}
                aria-label={`Quebra folha ${i + 1}`}
              />
            ))}
          </div>
        )}
        {/* Badges de folhas A4 — so em desktop (em mobile ficam poluindo) */}
        {!renderMode && !isMobile && pageHeight > 0 && pageBreaks.length === 0 && carrinho.length > 0 && (
          <div className="absolute top-2 right-2 bg-green-600 text-white text-[14px] font-bold px-2 py-0.5 rounded shadow z-10 pointer-events-none">
            ✓ 1 folha A4
          </div>
        )}
        {!renderMode && !isMobile && pageBreaks.length > 0 && (
          <div className="absolute top-2 right-2 bg-blue-600 text-white text-[14px] font-bold px-2 py-0.5 rounded shadow z-10 pointer-events-none">
            {pageBreaks.length + 1} folhas A4
          </div>
        )}
        {/* Logo — dimensoes EXPLICITAS pra evitar bug do html2canvas com width:auto
            Logo natural eh 2715x427 (ratio 6.36). Forco 305x48 pra renderizar consistente */}
        <div className="text-center mb-5" style={{ textAlign: 'center', marginBottom: 20 }}>
          <img
            src="/branorte-logo.png"
            alt="BRANORTE"
            width={305}
            height={48}
            style={{ display: 'inline-block', width: 305, height: 48, maxWidth: '100%' }}
            crossOrigin="anonymous"
          />
        </div>

        {/* ORÇAMENTO N° | DATA */}
        <div className="flex justify-between items-baseline text-[16px] font-bold text-gray-900 mb-1.5">
          <div>
            ORÇAMENTO N°{' '}
            <span className={numeroIsPlaceholder ? 'text-gray-400 font-semibold' : 'text-gray-700 font-semibold'}>
              {numeroExibido}
            </span>
          </div>
          <div>DATA: <span className="text-gray-700 font-semibold">{hoje}</span></div>
        </div>

        {/* CLIENTE | A/C | FONE */}
        <div
          className={`${!renderMode && onEditCliente ? 'cursor-pointer hover:bg-blue-50/60 -mx-2 px-2 rounded transition-colors' : ''}`}
          onClick={!renderMode && onEditCliente ? onEditCliente : undefined}
          title={!renderMode && onEditCliente ? 'Clique pra preencher dados do cliente' : undefined}
        >
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-1 sm:gap-4 text-[13px] sm:text-[16px] font-bold text-gray-900 mb-1">
            <div>
              CLIENTE:{' '}
              {cli.nome
                ? <span className="text-gray-700 font-semibold ml-1">{cli.nome}</span>
                : <span className="text-gray-400 italic font-semibold ml-1">[preencher]</span>}
            </div>
            <div className="text-center">A/C: {valOrPlaceholder(cli.ac)}</div>
            <div className="text-right">FONE: {valOrPlaceholder(cli.fone)}</div>
          </div>

          {/* Demais campos do cliente empilhados */}
          <div className="text-[16px] font-bold text-gray-900 space-y-0.5">
            {camposEmpilhados.map(([label, val]) => (
              <div key={label}>{label}: {valOrPlaceholder(val)}</div>
            ))}
          </div>
        </div>

        {/* Conteúdo */}
        <div className="mt-5">
          <SectionHeader>Itens orçados abaixo</SectionHeader>

          {fotoPrincipal ? (
            <div data-no-break className="group relative mb-3 border border-gray-700 rounded-md p-2 bg-white shadow-sm" style={{ zIndex: 1, pageBreakAfter: 'always' }}>
              <div
                className="w-full flex items-center justify-center bg-white"
                // Hero shot: ocupa a página inteira no PDF. Itens começam na página 2.
                // 1024px container ÷ 210mm A4 = ~4.87px/mm. Página = 297mm = ~1449px.
                // Header+título ≈ 250px. Então foto precisa de ~1100px pra preencher pág 1.
                style={{ minHeight: 1050, overflow: 'hidden' }}
              >
                <img
                  src={fotoPrincipal}
                  alt="Foto da fábrica"
                  style={{
                    maxWidth: '100%',
                    maxHeight: 1000,
                    width: 'auto',
                    height: 'auto',
                    objectFit: 'contain',
                    display: 'block',
                  }}
                  crossOrigin="anonymous"
                />
              </div>
              <div className="text-right text-[11px] italic text-gray-500 mt-0.5">Imagem ilustrativa</div>
              {/* Botoes Trocar/Remover — so DESKTOP (hover funciona).
                  Em mobile o iOS Safari forca hover-state ao tocar e os botoes
                  ficavam permanentemente sobrepostos a foto. Mobile usa o
                  bloco "Foto Principal" no carrinho/catalogo pra trocar. */}
              {!renderMode && !isMobile && onFotoChange && (
                <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition flex gap-1">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      const inp = document.createElement('input')
                      inp.type = 'file'
                      inp.accept = 'image/*'
                      inp.onchange = () => {
                        const f = inp.files?.[0]
                        if (!f) return
                        const r = new FileReader()
                        r.onload = () => onFotoChange(r.result as string)
                        r.readAsDataURL(f)
                      }
                      inp.click()
                    }}
                    className="text-[12px] bg-blue-600/90 text-white px-2 py-1 rounded shadow hover:bg-blue-700"
                  >
                    Trocar
                  </button>
                  <button
                    onClick={() => onFotoChange(null)}
                    className="text-[12px] bg-red-600/90 text-white px-2 py-1 rounded shadow hover:bg-red-700"
                  >
                    ✕ Remover
                  </button>
                </div>
              )}
            </div>
          ) : (!renderMode && onFotoChange) && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                const inp = document.createElement('input')
                inp.type = 'file'
                inp.accept = 'image/*'
                inp.onchange = () => {
                  const f = inp.files?.[0]
                  if (!f) return
                  const r = new FileReader()
                  r.onload = () => onFotoChange(r.result as string)
                  r.readAsDataURL(f)
                }
                inp.click()
              }}
              className="block w-full mb-3 py-2 text-center border border-dashed border-blue-300 rounded text-blue-700 hover:bg-blue-50 hover:border-blue-500 transition cursor-pointer text-[15px] font-semibold print:hidden"
            >
              📷 + Adicionar Foto Principal (opcional)
            </button>
          )}

          <div className="space-y-3">
            {carrinho.map((it, idx) => {
              const letra = String.fromCharCode(65 + idx)
              const subtotal = it.valor * it.qtd
              return (
                <div key={it.uid || idx} {...(!it.foto_url ? { 'data-no-break': true } : {})} className="group relative border border-gray-700 rounded-md p-3 bg-white shadow-sm" style={{ zIndex: 1, ...(!it.foto_url ? { breakInside: 'avoid', pageBreakInside: 'avoid' } : {}) }}>
                  <div className="flex justify-between items-start gap-2 mb-1.5">
                    <div className="font-bold text-[15.5px] flex-1 min-w-0 text-gray-900">
                      <span className="text-gray-900">{letra} - </span>
                      {!renderMode && onUpdateQtd && editingQtdUid === it.uid ? (
                        <input
                          autoFocus
                          type="number" min={1} max={99} step={1}
                          value={editingQtdValor}
                          onChange={(e) => setEditingQtdValor(e.target.value)}
                          onBlur={() => {
                            const n = Math.max(1, Math.min(99, parseInt(editingQtdValor, 10) || 1))
                            if (n !== it.qtd && it.uid) onUpdateQtd(it.uid, n)
                            setEditingQtdUid(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                            if (e.key === 'Escape') setEditingQtdUid(null)
                          }}
                          className="w-12 text-[15.5px] font-bold text-gray-900 bg-yellow-50 border border-blue-400 rounded px-1 py-0 outline-none text-center tabular-nums"
                          onFocus={(e) => e.currentTarget.select()}
                        />
                      ) : (
                        <span
                          className={`tabular-nums ${!renderMode && onUpdateQtd ? 'cursor-text hover:bg-yellow-50 rounded px-1' : ''}`}
                          title={!renderMode && onUpdateQtd ? 'Click pra alterar quantidade' : undefined}
                          onClick={() => {
                            if (!renderMode && onUpdateQtd && it.uid) {
                              setEditingQtdValor(String(it.qtd))
                              setEditingQtdUid(it.uid)
                            }
                          }}
                        >{String(it.qtd).padStart(2, '0')}</span>
                      )}
                      <span className="text-gray-400 mx-1">–</span>
                      {!renderMode && onUpdateNome && editingNomeUid === it.uid ? (
                        <input
                          autoFocus
                          value={editingNomeValor}
                          onChange={(e) => setEditingNomeValor(e.target.value)}
                          onBlur={() => {
                            const v = editingNomeValor.trim()
                            if (v && v !== (it.nome_custom || it.nome)) {
                              onUpdateNome(it.uid!, v)
                            }
                            setEditingNomeUid(null)
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                            if (e.key === 'Escape') { setEditingNomeUid(null) }
                          }}
                          className="uppercase text-[15.5px] font-bold text-gray-900 bg-yellow-50 border border-blue-400 rounded px-1 py-0 outline-none w-[80%]"
                        />
                      ) : (
                        <span
                          className={`uppercase ${!renderMode && onUpdateNome ? 'cursor-text hover:bg-yellow-50 rounded px-0.5' : ''}`}
                          title={!renderMode && onUpdateNome ? 'Click pra editar nome' : undefined}
                          onClick={() => {
                            if (!renderMode && onUpdateNome && it.uid) {
                              setEditingNomeValor(it.nome_custom || it.nome)
                              setEditingNomeUid(it.uid)
                            }
                          }}
                        >
                          {it.nome_custom || it.nome}
                        </span>
                      )}
                      {/* Badge da voltagem do motor — visivel ao lado de cada item.
                          Mono = laranja, Tri = azul. Compacto pra nao ocupar muito espaco. */}
                      {!renderMode && it.motor_cv != null && (
                        <span
                          className={`inline-flex items-center gap-0.5 ml-2 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider align-middle ${
                            voltagem === 'monofasico'
                              ? 'bg-orange-100 text-orange-700 border border-orange-300'
                              : 'bg-blue-100 text-blue-700 border border-blue-300'
                          }`}
                          title={`Motor ${voltagem === 'monofasico' ? 'monofásico (220V)' : 'trifásico (220/380/660V)'}`}
                        >
                          ⚡{voltagem === 'monofasico' ? 'Mono' : 'Trif'}
                        </span>
                      )}
                      {!renderMode && onToggleInox && it.uid && (() => {
                        const inoxMenuId = `inox-menu-${it.uid}`
                        const isOpen = inoxMenuOpen === it.uid
                        return (
                          <div className="relative inline-flex ml-2">
                            <button
                              onClick={() => {
                                if (it.inox) {
                                  onToggleInox(it.uid!, false)
                                  setInoxMenuOpen(null)
                                } else {
                                  setInoxMenuOpen(isOpen ? null : it.uid!)
                                }
                              }}
                              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider align-middle cursor-pointer transition-all ${
                                it.inox === '316'
                                  ? 'bg-purple-100 text-purple-700 border border-purple-400 ring-1 ring-purple-300'
                                  : it.inox === '304'
                                    ? 'bg-emerald-100 text-emerald-700 border border-emerald-400 ring-1 ring-emerald-300'
                                    : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-300'
                              }`}
                              title={
                                it.inox ? `Inox ${it.inox} ativo. Clique pra voltar ao galvanizado.`
                                : 'Clique pra cotar em Inox'
                              }
                            >
                              {it.inox ? `✦ ${it.inox}` : 'Inox'}
                            </button>
                            {isOpen && !it.inox && (
                              <>
                                <div className="fixed inset-0 z-40" onClick={() => setInoxMenuOpen(null)} />
                                <div id={inoxMenuId} className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-3 min-w-[180px]">
                                  <p className="text-[11px] text-gray-500 font-semibold mb-2 uppercase tracking-wide">Qual inox?</p>
                                  <button
                                    onClick={() => { onToggleInox(it.uid!, '304'); setInoxMenuOpen(null) }}
                                    className="w-full text-left px-3 py-2 rounded-md hover:bg-emerald-50 transition-colors flex items-center justify-between group"
                                  >
                                    <span className="text-sm font-semibold text-gray-700 group-hover:text-emerald-700">Inox 304</span>
                                    <span className="text-[10px] text-gray-400 group-hover:text-emerald-600">valor ×2,5</span>
                                  </button>
                                  <button
                                    onClick={() => { onToggleInox(it.uid!, '316'); setInoxMenuOpen(null) }}
                                    className="w-full text-left px-3 py-2 rounded-md hover:bg-purple-50 transition-colors flex items-center justify-between group"
                                  >
                                    <span className="text-sm font-semibold text-gray-700 group-hover:text-purple-700">Inox 316</span>
                                    <span className="text-[10px] text-gray-400 group-hover:text-purple-600">valor ×3,5</span>
                                  </button>
                                </div>
                              </>
                            )}
                          </div>
                        )
                      })()}
                      {/* Toggle Tungstênio — só pra jogos de martelo */}
                      {!renderMode && onToggleTungstenio && it.uid && /jogo.*martelo/i.test(it.nome) && (
                        <button
                          onClick={() => onToggleTungstenio(it.uid!)}
                          className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ml-1 cursor-pointer transition-all ${
                            it.tungstenio
                              ? 'bg-amber-100 text-amber-700 border border-amber-400 ring-1 ring-amber-300'
                              : 'bg-gray-100 text-gray-400 border border-gray-200 hover:bg-amber-50 hover:text-amber-600 hover:border-amber-300'
                          }`}
                          title={it.tungstenio ? 'Tungstênio ativo (R$ 99/un). Clique pra voltar ao aço tratado.' : 'Clique pra cotar em Tungstênio (R$ 99/un)'}
                        >
                          {it.tungstenio ? '⬡ Tungstênio' : 'Ativar Tungstênio'}
                        </button>
                      )}
                    </div>
                    {!renderMode && it.uid && (
                      <div className="flex items-center gap-0.5 shrink-0 print:hidden">
                        {onMoverItem && (
                          <button
                            onClick={() => onMoverItem(it.uid!, 'cima')}
                            disabled={idx === 0}
                            className="text-gray-400 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed bg-gray-50 hover:bg-blue-50 border border-gray-200 rounded px-1.5 py-0.5 text-[14px] leading-none font-bold transition-all"
                            title="Subir item"
                            type="button"
                          >▲</button>
                        )}
                        {onMoverItem && (
                          <button
                            onClick={() => onMoverItem(it.uid!, 'baixo')}
                            disabled={idx === carrinho.length - 1}
                            className="text-gray-400 hover:text-blue-600 disabled:opacity-30 disabled:cursor-not-allowed bg-gray-50 hover:bg-blue-50 border border-gray-200 rounded px-1.5 py-0.5 text-[14px] leading-none font-bold transition-all"
                            title="Descer item"
                            type="button"
                          >▼</button>
                        )}
                        {onRemove && (
                          <button
                            onClick={() => onRemove(it.uid!)}
                            className="text-red-500 hover:text-white hover:bg-red-600 bg-red-50 border border-red-200 rounded p-1 transition-all"
                            title="Remover item"
                            type="button"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="pl-3 text-[14.5px] text-gray-700 space-y-0.5">
                      {it.specs.filter(s => !/c[oó]digo\s*finame/i.test(s)).length > 0
                        ? it.specs.filter(s => !/c[oó]digo\s*finame/i.test(s)).map((s, i) => {
                            const key = `${it.uid ?? idx}|${i}`
                            const editavel = !renderMode && !!onUpdateSpec && !!it.uid
                            const editando = editingSpecKey === key
                            return (
                              <div key={i} className="flex gap-1.5">
                                <span className="text-gray-400">•</span>
                                {editando ? (
                                  <input
                                    autoFocus
                                    value={editingSpecValor}
                                    onChange={(e) => setEditingSpecValor(e.target.value)}
                                    onBlur={() => {
                                      const v = editingSpecValor.trim()
                                      if (v && v !== s && onUpdateSpec && it.uid) {
                                        onUpdateSpec(it.uid, i, v)
                                      }
                                      setEditingSpecKey(null)
                                    }}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                                      if (e.key === 'Escape') setEditingSpecKey(null)
                                    }}
                                    className="flex-1 bg-yellow-50 border border-blue-400 rounded px-1 py-0 outline-none text-[14.5px] text-gray-700"
                                  />
                                ) : (
                                  <span
                                    className={editavel ? 'cursor-text hover:bg-yellow-50 rounded px-0.5' : ''}
                                    title={editavel ? 'Duplo-click para editar' : undefined}
                                    onDoubleClick={() => {
                                      if (!editavel) return
                                      setEditingSpecValor(s)
                                      setEditingSpecKey(key)
                                    }}
                                  >{/\*\*/.test(s) ? s.split(/(\*\*[^*]+\*\*)/).map((part, pi) =>
                                    part.startsWith('**') && part.endsWith('**')
                                      ? <strong key={pi} className="font-bold">{part.slice(2, -2)}</strong>
                                      : <span key={pi}>{part}</span>
                                  ) : s}</span>
                                )}
                              </div>
                            )
                          })
                        : it.motor_cv && (
                            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Acionamento: motor {it.motor_cv} CV {it.motor_polos} polos{it.motor_qtd > 1 && ` (qtd ${it.motor_qtd})`}</span></div>
                          )
                      }
                    </div>
                  </div>
                  {/* Foto + Valor agrupados — quebra de página cai ANTES da foto, nunca entre foto e valor */}
                  <div data-no-break>
                    {it.foto_url && (
                      <div className="w-full flex flex-col items-center mt-1">
                        <div
                          style={{
                            width: '100%',
                            maxWidth: 540,
                            maxHeight: 280,
                            background: '#fff',
                            border: '1px solid #d1d5db',
                            borderRadius: 4,
                            padding: 8,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            overflow: 'hidden',
                            boxSizing: 'border-box',
                          }}
                        >
                          <img
                            src={it.foto_url}
                            alt={it.nome}
                            style={{
                              maxWidth: '100%',
                              maxHeight: 264,
                              width: 'auto',
                              height: 'auto',
                              objectFit: 'contain',
                              display: 'block',
                            }}
                            loading="lazy"
                            crossOrigin="anonymous"
                          />
                        </div>
                        <div className="text-[12px] text-gray-400 italic mt-0.5 tracking-wide">Imagem ilustrativa</div>
                      </div>
                    )}
                  <div className="mt-2.5 pt-1.5 border-t border-gray-300">
                    {it.qtd > 1 && it.valor > 0 && (
                      <div className="flex justify-between text-[12.5px] text-gray-500 mb-0.5">
                        <span>Valor unitário</span>
                        <span>R$ {formatBRLBare(it.valor)}</span>
                      </div>
                    )}
                    <div className="flex justify-between text-[15.5px] font-bold tracking-wide">
                      <span className="text-gray-700">VALOR{it.qtd > 1 ? ' TOTAL' : ''}</span>
                      {it.brinde ? (
                        <span className="flex items-center gap-2">
                          <span className="text-green-600 font-bold text-[15px]">BRINDE</span>
                          {!renderMode && onToggleBrinde && it.uid && (
                            <button
                              onClick={() => onToggleBrinde(it.uid!)}
                              className="text-[11px] text-gray-400 hover:text-red-500 print:hidden"
                              title="Remover brinde"
                            >✕</button>
                          )}
                        </span>
                      ) : editingValorUid === it.uid ? (
                        <input
                          autoFocus
                          type="number"
                          value={editingValorStr}
                          onChange={e => setEditingValorStr(e.target.value)}
                          onBlur={() => {
                            const v = parseFloat(editingValorStr)
                            if (!isNaN(v) && v >= 0 && onUpdateValor && it.uid) {
                              onUpdateValor(it.uid, v)
                            }
                            setEditingValorUid(null)
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
                            if (e.key === 'Escape') setEditingValorUid(null)
                          }}
                          className="w-40 text-right bg-yellow-50 border border-blue-400 rounded px-2 py-0.5 outline-none text-[15px] text-gray-900 font-bold"
                        />
                      ) : subtotal > 0 ? (
                        <span className="flex items-center gap-2">
                          <span
                            className={`text-gray-900 ${!renderMode && onUpdateValor && it.uid ? 'cursor-text hover:bg-yellow-50 rounded px-1' : ''}`}
                            title={!renderMode && onUpdateValor ? 'Duplo-clique para editar valor' : undefined}
                            onDoubleClick={() => {
                              if (!renderMode && onUpdateValor && it.uid) {
                                setSenhaModalUid(it.uid)
                                setSenhaInput('')
                                setSenhaErro(false)
                              }
                            }}
                          >R$ {formatBRLBare(subtotal)}</span>
                          {!renderMode && onToggleBrinde && it.uid && (
                            <button
                              onClick={() => onToggleBrinde(it.uid!)}
                              className="text-[10px] text-gray-400 hover:text-green-600 border border-gray-300 hover:border-green-500 rounded px-1.5 py-0.5 print:hidden"
                              title="Marcar como brinde"
                            >BRINDE</button>
                          )}
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          <span className="text-amber-600 italic text-[13px] print:text-gray-900 print:not-italic">
                            <span className="print:hidden">⚠ sem preço — preencha</span>
                            <span className="hidden print:inline">a consultar</span>
                          </span>
                          {!renderMode && onToggleBrinde && it.uid && (
                            <button
                              onClick={() => onToggleBrinde(it.uid!)}
                              className="text-[10px] text-gray-400 hover:text-green-600 border border-gray-300 hover:border-green-500 rounded px-1.5 py-0.5 print:hidden"
                              title="Marcar como brinde"
                            >BRINDE</button>
                          )}
                        </span>
                      )}
                    </div>
                  </div>
                  </div>{/* fecha data-no-break foto+valor */}
                </div>
              )
            })}
          </div>

          {/* + Adicionar mais um item — mesmo padrão visual do "+ Adicionar Acessórios".
              Vendedor scrolla até embaixo do último item e ja tem botão pra adicionar
              mais sem precisar voltar pro tab Catálogo. */}
          {!renderMode && onAddItem && carrinho.length > 0 && (
            <button
              onClick={onAddItem}
              className="w-full mt-4 mb-2 py-2 text-[15px] font-semibold text-blue-700 hover:bg-blue-50 border border-dashed border-blue-300 rounded transition-colors print:hidden"
            >
              + Adicionar mais um item
            </button>
          )}

          {/* ACESSÓRIOS — letra auto-incrementada após o último item.
              relative + bg-white pra ficar ACIMA das molduras absolutas das folhas A4 */}
          {acessorios ? (
            <div data-no-break className="group mt-3 border border-gray-700 rounded-md p-3 bg-white shadow-sm relative" style={{ zIndex: 1 }}>
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <div className="font-bold text-[15.5px] text-gray-900">
                  <span className="text-gray-900">{String.fromCharCode(65 + carrinho.length)} — ACESSÓRIOS</span>
                </div>
                {!renderMode && (onEditAcessorios || onRemoveAcessorios) && (
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditAcessorios && <button onClick={onEditAcessorios} className="text-[14px] text-blue-600 hover:underline">editar ({acessorios.valorFixo != null && acessorios.valorFixo > 0 ? 'R$ fixo' : `${acessorios.pct}%`})</button>}
                    {onRemoveAcessorios && <button onClick={onRemoveAcessorios} className="text-[14px] text-red-600 hover:underline">remover</button>}
                  </div>
                )}
              </div>
              <div className="pl-3 text-[14.5px] text-gray-700 space-y-0.5">
                {acessorios.items.length > 0
                  ? acessorios.items.map((s, i) => <div key={i} className="flex gap-1.5"><span className="text-gray-400">•</span><span>{s}</span></div>)
                  : <div className="text-gray-400 italic">(nenhum item listado{!renderMode ? ' — clique em "editar"' : ''})</div>
                }
              </div>
              <div className="mt-2.5 pt-1.5 border-t border-gray-300 flex justify-between text-[15.5px] font-bold tracking-wide">
                <span className="text-gray-700">VALOR</span>
                {valorAcessorios > 0 ? (
                  <span className="text-gray-900">R$ {formatBRLBare(valorAcessorios)}</span>
                ) : (
                  <span className="text-amber-600 italic text-[13px] print:text-gray-900 print:not-italic">
                    <span className="print:hidden">⚠ {acessorios.pct}% × R$ 0,00 = R$ 0,00 (precifique os itens acima)</span>
                    <span className="hidden print:inline">R$ 0,00</span>
                  </span>
                )}
              </div>
            </div>
          ) : (
            !renderMode && onAddAcessorios && carrinho.length > 0 && (
              <button
                onClick={onAddAcessorios}
                className="w-full mt-4 py-2 text-[15px] font-semibold text-blue-700 hover:bg-blue-50 border border-dashed border-blue-300 rounded transition-colors"
              >
                + Adicionar Acessórios
              </button>
            )
          )}

          {/* VALOR TOTAL DE EQUIPAMENTOS */}
          {mostrarTotalEquip && (
            <div data-no-break className="mt-4 px-6 py-4 border-2 border-gray-700 rounded-lg tracking-wide relative bg-white" style={{ zIndex: 1, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
              <div className="flex justify-between items-center gap-4 min-h-[24px] text-[17px] font-bold">
                <span className="text-gray-900 uppercase leading-[1] flex-1">Valor total de equipamentos</span>
                <span className="text-gray-900 leading-[1] tabular-nums whitespace-nowrap">R$ {formatBRLBare(totalEquip)}</span>
              </div>
            </div>
          )}

          {/* Motores */}
          {motoresAgrupados.length > 0 && (() => {
            const opcoesTensao: (220 | 380 | 660)[] = voltagem === 'monofasico' ? [220] : [220, 380, 660]
            // Monofásico só aceita 220V - corrige se tiver tensão inválida salva
            const tensaoEfetiva = voltagem === 'monofasico' && tensaoMotores && tensaoMotores !== 220 ? 220 : tensaoMotores
            const tensaoInteractive = !renderMode && !!onUpdateTensaoMotores
            const tensaoLabel = tensaoEfetiva ? `${tensaoEfetiva}V` : 'tensão a confirmar'
            return (
              <div data-no-break className="mt-3 border border-gray-700 rounded-md p-4 bg-white shadow-sm relative" style={{ zIndex: 1, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <div className="flex items-center justify-between gap-3 pb-2 border-b-2 border-gray-800 mb-2.5">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-bold text-[16px] tracking-wider uppercase text-gray-700">
                      {motoresTitle.replace(':', '')}
                    </span>
                    {tensaoInteractive ? (
                      <span className="inline-flex gap-1 items-center">
                        {opcoesTensao.map(v => (
                          <button
                            key={v}
                            onClick={() => onUpdateTensaoMotores!(tensaoEfetiva === v ? null : v)}
                            className={`text-[15px] px-2 py-0.5 rounded font-bold transition-all ${
                              tensaoEfetiva === v
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                            title={`Tensão ${v}V (clique no selecionado pra voltar a "a confirmar")`}
                          >
                            {v}V
                          </button>
                        ))}
                        {!tensaoEfetiva && (
                          <span className="text-[15px] text-gray-400 italic ml-1">tensão a confirmar</span>
                        )}
                      </span>
                    ) : (
                      <span className={`text-[15px] font-semibold ${tensaoEfetiva ? 'text-blue-700' : 'text-gray-400 italic'}`}>
                        {tensaoLabel}
                      </span>
                    )}
                  </div>
                </div>
                <table className="w-full text-[16px] border-collapse">
                  <thead>
                    <tr>
                      <th className="text-left font-bold py-2 text-gray-600 uppercase tracking-wider text-[15px]">Tipo</th>
                      <th className="text-right font-bold py-2 text-gray-600 uppercase tracking-wider text-[15px]">Novo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {motoresAgrupados.map((m, idx) => {
                      const incluso = m.valor_total === 0
                      const podeTrocar = !renderMode && !!onTrocarMotor && !!m.item_uid && !!motoresDisponiveis?.length
                      const aberto = trocarMotorIdx === idx
                      // Detecta "motorredutor" na spec do item → mostra em vez de "X polos"
                      const itemCarrinho = carrinho.find(it => it.uid === m.item_uid)
                      const specMotor = itemCarrinho?.specs?.find(s => /motorredutor|moto\s*redutor/i.test(s))
                      const tipoMotor = specMotor ? 'motorredutor' : `${m.polos} polos`
                      return (
                        <tr key={`${m.cv}-${m.polos}-${idx}`} className="border-t border-gray-200">
                          <td className="py-1.5 text-gray-800 relative">
                            <span className="text-gray-400 mr-1.5">•</span>
                            {podeTrocar ? (
                              <button
                                type="button"
                                onClick={() => { setMotorBusca(''); setTrocarMotorIdx(aberto ? null : idx) }}
                                className="font-semibold underline decoration-dotted underline-offset-2 decoration-gray-400 hover:decoration-blue-500 hover:text-blue-700 cursor-pointer print:no-underline print:text-gray-800"
                                title="Clique pra trocar o motor"
                              >
                                {m.cv} CV {tipoMotor}
                              </button>
                            ) : (
                              <span className="font-semibold">{m.cv} CV {tipoMotor}</span>
                            )}
                            {m.item_nome && (
                              <span className="text-gray-500"> · <span className="italic">{m.item_nome}</span></span>
                            )}
                            {m.qtd > 1 && <span className="text-gray-500"> (×{m.qtd})</span>}

                            {/* Modal de troca de motor — portal pro body pra escapar do overflow/sticky do preview */}
                            {aberto && podeTrocar && m.item_uid && motoresDisponiveis && createPortal(
                              <div
                                className="fixed inset-0 z-[100] bg-black/70 flex items-center justify-center p-4 print:hidden"
                                onClick={() => setTrocarMotorIdx(null)}
                              >
                                <div
                                  className="bg-white border border-gray-300 rounded-lg shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden"
                                  onClick={e => e.stopPropagation()}
                                >
                                  <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between bg-gray-50 shrink-0">
                                    <div className="min-w-0">
                                      <div className="text-[12px] uppercase font-bold text-gray-600 tracking-wider">Trocar motor</div>
                                      <div className="text-[11px] text-gray-500 truncate">
                                        Atual: {m.cv} CV {m.polos} polos{m.item_nome && ` · ${m.item_nome}`}
                                      </div>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => setTrocarMotorIdx(null)}
                                      className="text-gray-400 hover:text-gray-700 shrink-0 ml-2"
                                    >
                                      <X className="h-4 w-4" />
                                    </button>
                                  </div>
                                  <div className="p-2 border-b border-gray-200 shrink-0">
                                    <div className="relative">
                                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-400 pointer-events-none" />
                                      <input
                                        type="text"
                                        value={motorBusca}
                                        onChange={e => setMotorBusca(e.target.value)}
                                        placeholder="Buscar motor (ex: 5 CV, 4 polos, trifasico)..."
                                        autoFocus
                                        className="w-full pl-8 pr-2 py-1.5 bg-white border border-gray-300 rounded text-[12px] text-gray-800 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
                                      />
                                    </div>
                                  </div>
                                  <div className="p-1 overflow-y-auto">
                                    {(() => {
                                      const q = motorBusca.trim().toLowerCase()
                                      const lista = motoresDisponiveis
                                        .slice()
                                        .sort((a, b) => Number(a.cv) - Number(b.cv) || a.polos - b.polos || a.voltagem.localeCompare(b.voltagem))
                                        .filter(opt => {
                                          if (!q) return true
                                          const label = opt.polos === 0
                                            ? `motorredutor ${Number(opt.cv)} cv ${opt.voltagem}`
                                            : `${Number(opt.cv)} cv ${opt.polos} polos ${opt.voltagem}`
                                          return label.toLowerCase().includes(q)
                                        })
                                      if (lista.length === 0) {
                                        return <div className="px-3 py-6 text-[12px] text-gray-400 text-center">Nenhum motor encontrado</div>
                                      }
                                      return lista.map(opt => {
                                        const isAtual = Number(opt.cv) === m.cv && opt.polos === m.polos
                                        return (
                                          <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => {
                                              onTrocarMotor!(m.item_uid!, opt, m.motorIndex)
                                              setTrocarMotorIdx(null)
                                            }}
                                            className={`w-full text-left px-3 py-2 rounded text-[13px] flex items-center justify-between gap-2 hover:bg-blue-50 transition-colors ${
                                              isAtual ? 'bg-blue-100 font-semibold' : ''
                                            }`}
                                          >
                                            <span className="text-gray-800">
                                              {opt.polos === 0
                                                ? <><span className="text-amber-700">Motorredutor</span> {Number(opt.cv)} CV</>
                                                : <>{Number(opt.cv)} CV {opt.polos} polos</>}
                                              <span className="text-gray-500 ml-1.5 text-[11px] uppercase">{opt.voltagem}</span>
                                            </span>
                                            <span className="text-gray-600 tabular-nums text-[12px]">
                                              {Number(opt.valor) === 0
                                                ? <span className="text-gray-400 italic">incluso</span>
                                                : `R$ ${formatBRLBare(Number(opt.valor))}`}
                                            </span>
                                          </button>
                                        )
                                      })
                                    })()}
                                  </div>
                                </div>
                              </div>,
                              document.body
                            )}
                          </td>
                          <td className="py-1.5 text-right text-gray-800 tabular-nums">
                            {incluso
                              ? <span className="text-gray-500 italic">incluso</span>
                              : <>R$ {formatBRLBare(m.valor_total)}</>}
                          </td>
                        </tr>
                      )
                    })}
                    <tr className="border-t-2 border-gray-700 font-bold">
                      <td className="py-2 text-gray-900">TOTAL</td>
                      <td className="py-2 text-right text-gray-900 tabular-nums">
                        {totalMotores > 0
                          ? `R$ ${formatBRLBare(totalMotores)}`
                          : <span className="text-gray-400 italic text-[13px]">tudo incluso</span>}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )
          })()}

          {/* COMPONENTES ADICIONAIS — itens NÃO fabricados pela Branorte (painel, balança, célula de carga…) */}
          {(() => {
            const interactive = !renderMode && !!onUpdateComponentesExtras
            // Não renderiza nada se vazio E não tá em modo edit
            if (componentesExtras.length === 0 && !interactive) return null
            const totalExtras = componentesExtras.reduce((s, c) => s + (Number(c.valor) || 0), 0)
            // Presets sem preço — pra coisas que não estão no cadastro ainda (vendedor digita o R$)
            const PRESETS = [
              'Painel elétrico',
              'Inversor de frequência',
              'CLP / Automação',
              'Compressor',
              'Estrutura metálica',
              'Tubulação',
            ]
            function novoIdExtra() { return `cx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }
            function adicionar(nome: string, valor: number = 0) {
              if (!onUpdateComponentesExtras) return
              onUpdateComponentesExtras([...componentesExtras, { id: novoIdExtra(), nome, valor }])
              setExtraPickerOpen(false)
            }
            function atualizar(id: string, patch: Partial<PreviewComponenteExtra>) {
              if (!onUpdateComponentesExtras) return
              // Match automatico: se vendedor digitou nome que bate com item do cadastro
              // E o valor atual eh 0, auto-preenche o preco.
              if (patch.nome != null && componentesAdicionaisCatalogo.length > 0) {
                const atual = componentesExtras.find(c => c.id === id)
                if (atual && (!atual.valor || atual.valor === 0)) {
                  const nomeNorm = patch.nome.trim().toLowerCase()
                  const match = componentesAdicionaisCatalogo.find(c =>
                    c.nome.trim().toLowerCase() === nomeNorm
                  )
                  if (match?.valorSugerido && match.valorSugerido > 0) {
                    patch = { ...patch, valor: match.valorSugerido }
                  }
                }
              }
              onUpdateComponentesExtras(componentesExtras.map(c => c.id === id ? { ...c, ...patch } : c))
            }
            function remover(id: string) {
              if (!onUpdateComponentesExtras) return
              onUpdateComponentesExtras(componentesExtras.filter(c => c.id !== id))
            }
            return (
              <div data-no-break className="mt-3 border border-gray-700 rounded-md p-4 bg-white shadow-sm relative" style={{ zIndex: 1, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                <div className="flex items-center justify-between gap-3 pb-2 border-b-2 border-gray-800 mb-2.5">
                  <span className="font-bold text-[16px] tracking-wider uppercase text-gray-700">
                    Componentes adicionais
                  </span>
                </div>
                {componentesExtras.length === 0 ? (
                  <div className="text-[13px] text-gray-400 italic py-2">Nenhum componente adicional. Clique em "+ Adicionar" pra incluir painel elétrico, balança, célula de carga, etc.</div>
                ) : (
                  <table className="w-full text-[16px] border-collapse">
                    <thead>
                      <tr>
                        <th className="text-left font-bold py-2 text-gray-600 uppercase tracking-wider text-[15px]">Componente</th>
                        <th className="text-right font-bold py-2 text-gray-600 uppercase tracking-wider text-[15px] w-[160px]">Valor</th>
                        {interactive && <th className="w-8 print:hidden"></th>}
                      </tr>
                    </thead>
                    <tbody>
                      {componentesExtras.map((c) => (
                        <tr key={c.id} className="border-t border-gray-200">
                          <td className="py-1.5 text-gray-800">
                            <span className="text-gray-400 mr-1.5">•</span>
                            {interactive ? (
                              <>
                                <input
                                  value={c.nome}
                                  onChange={e => atualizar(c.id, { nome: e.target.value })}
                                  placeholder="nome do componente"
                                  list={`componentes-cadastro-list`}
                                  className="font-semibold text-[15px] bg-transparent border-b border-transparent hover:border-gray-300 focus:border-blue-500 outline-none px-1 py-0 w-[60%]"
                                />
                                <datalist id={`componentes-cadastro-list`}>
                                  {componentesAdicionaisCatalogo.map(opt => (
                                    <option key={opt.id} value={opt.nome}>
                                      {opt.valorSugerido && opt.valorSugerido > 0 ? `R$ ${opt.valorSugerido.toFixed(2)}` : 'sem preço'}
                                    </option>
                                  ))}
                                </datalist>
                              </>
                            ) : (
                              <span className="font-semibold">{c.nome}</span>
                            )}
                          </td>
                          <td className="py-1.5 text-right text-gray-800 tabular-nums">
                            {interactive ? (
                              <BRLInput
                                value={c.valor}
                                onChange={v => atualizar(c.id, { valor: v })}
                                prefix
                                className={`w-28 text-[15px] font-bold ${(!c.valor || c.valor === 0) ? 'border-amber-400 bg-amber-50' : ''}`}
                              />
                            ) : (
                              <>R$ {formatBRLBare(c.valor)}</>
                            )}
                          </td>
                          {interactive && (
                            <td className="text-center print:hidden">
                              <button
                                type="button"
                                onClick={() => remover(c.id)}
                                className="text-red-500 hover:text-white hover:bg-red-600 bg-red-50 border border-red-200 rounded p-1 transition-all"
                                title="Remover"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </td>
                          )}
                        </tr>
                      ))}
                      <tr className="border-t-2 border-gray-700 font-bold">
                        <td className="py-2 text-gray-900">TOTAL</td>
                        <td className="py-2 text-right text-gray-900 tabular-nums">
                          {totalExtras > 0
                            ? `R$ ${formatBRLBare(totalExtras)}`
                            : <span className="text-amber-600 italic text-[13px]">⚠ preencha o preço</span>}
                        </td>
                        {interactive && <td className="print:hidden"></td>}
                      </tr>
                    </tbody>
                  </table>
                )}
                {interactive && (
                  <div className="mt-3 print:hidden">
                    <button
                      type="button"
                      onClick={() => setExtraPickerOpen(true)}
                      className="text-[12px] px-3 py-1.5 rounded-md bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 font-semibold transition-all"
                    >+ Adicionar componente</button>
                    {/* Modal de senha pra editar valor */}
                    {senhaModalUid && createPortal(
                      <>
                        <div className="fixed inset-0 z-[9998] bg-black/50" onClick={() => setSenhaModalUid(null)} />
                        <div className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-bg border border-gray-300 dark:border-border rounded-xl shadow-2xl w-[320px] p-5">
                          <h3 className="text-[14px] font-bold text-gray-900 dark:text-ink mb-3">Editar valor</h3>
                          <p className="text-[12px] text-gray-500 dark:text-ink-muted mb-3">Digite a senha para liberar a edição:</p>
                          <input
                            autoFocus
                            type="password"
                            value={senhaInput}
                            onChange={e => { setSenhaInput(e.target.value); setSenhaErro(false) }}
                            onKeyDown={e => {
                              if (e.key === 'Enter') {
                                if (senhaInput === '2104') {
                                  const uid = senhaModalUid
                                  const item = carrinho.find(it => it.uid === uid)
                                  if (item) {
                                    setEditingValorStr(String(item.valor))
                                    setEditingValorUid(uid)
                                  }
                                  setSenhaModalUid(null)
                                  setSenhaInput('')
                                } else {
                                  setSenhaErro(true)
                                }
                              }
                              if (e.key === 'Escape') { setSenhaModalUid(null); setSenhaInput('') }
                            }}
                            placeholder="Senha"
                            className={`w-full px-3 py-2 bg-gray-50 dark:bg-surface-2 border rounded-md text-[13px] outline-none ${
                              senhaErro ? 'border-red-400 ring-1 ring-red-300' : 'border-gray-300 dark:border-border focus:border-accent'
                            }`}
                          />
                          {senhaErro && <p className="text-[11px] text-red-500 mt-1.5">Senha incorreta</p>}
                          <div className="flex justify-end gap-2 mt-4">
                            <button onClick={() => { setSenhaModalUid(null); setSenhaInput('') }} className="text-[12px] text-gray-500 hover:text-gray-700 dark:text-ink-muted px-3 py-1.5">Cancelar</button>
                            <button
                              onClick={() => {
                                if (senhaInput === '2104') {
                                  const uid = senhaModalUid
                                  const item = carrinho.find(it => it.uid === uid)
                                  if (item) {
                                    setEditingValorStr(String(item.valor))
                                    setEditingValorUid(uid)
                                  }
                                  setSenhaModalUid(null)
                                  setSenhaInput('')
                                } else {
                                  setSenhaErro(true)
                                }
                              }}
                              className="text-[12px] font-semibold bg-accent text-white px-4 py-1.5 rounded-md hover:bg-accent/90"
                            >OK</button>
                          </div>
                        </div>
                      </>,
                      document.body,
                    )}

                    {/* Modal de componentes — portal pra escapar de qualquer overflow/z-index */}
                    {extraPickerOpen && createPortal(
                      <>
                        <div className="fixed inset-0 z-[9998] bg-black/50" onClick={() => setExtraPickerOpen(false)} />
                        <div className="fixed z-[9999] top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-white dark:bg-bg border border-gray-300 dark:border-border rounded-xl shadow-2xl w-[380px] max-h-[70vh] flex flex-col overflow-hidden">
                          <div className="px-4 py-3 border-b border-gray-200 dark:border-border flex items-center justify-between">
                            <h3 className="text-[14px] font-bold text-gray-900 dark:text-ink">Adicionar Componente</h3>
                            <button onClick={() => setExtraPickerOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-ink p-1"><X className="w-4 h-4" /></button>
                          </div>
                          <div className="px-3 py-2 border-b border-gray-100 dark:border-border">
                            <input
                              autoFocus
                              type="text"
                              placeholder="Buscar componente..."
                              value={extraPickerBusca}
                              onChange={e => setExtraPickerBusca(e.target.value)}
                              className="w-full px-2.5 py-1.5 bg-gray-50 dark:bg-surface-2 border border-gray-200 dark:border-border rounded text-[12px] text-gray-800 dark:text-ink outline-none focus:border-blue-400"
                            />
                          </div>
                          <div className="flex-1 overflow-y-auto">
                            {/* Section 1: do cadastro (precos_branorte) */}
                            {componentesAdicionaisCatalogo.filter(c => !extraPickerBusca || c.nome.toLowerCase().includes(extraPickerBusca.toLowerCase())).length > 0 && (
                              <>
                                <div className="px-3 py-2 border-b border-gray-200 dark:border-border bg-blue-50/60 dark:bg-accent/10 text-[10px] uppercase font-bold text-blue-700 dark:text-accent tracking-wider">
                                  Do cadastro de preços
                                </div>
                                <div className="p-1">
                                  {componentesAdicionaisCatalogo
                                    .filter(c => !extraPickerBusca || c.nome.toLowerCase().includes(extraPickerBusca.toLowerCase()))
                                    .map(c => (
                                    <button
                                      key={c.id}
                                      type="button"
                                      onClick={() => { adicionar(c.nome, c.valorSugerido ?? 0); setExtraPickerBusca('') }}
                                      className="w-full text-left px-3 py-2 rounded-md text-[13px] hover:bg-blue-50 dark:hover:bg-accent/10 transition-colors text-gray-800 dark:text-ink flex items-center justify-between gap-2"
                                    >
                                      <span>{c.nome}</span>
                                      <span className="text-[11px] tabular-nums text-gray-500 dark:text-ink-muted">
                                        {c.valorSugerido != null && c.valorSugerido > 0
                                          ? `R$ ${formatBRLBare(c.valorSugerido)}`
                                          : <span className="italic text-gray-400">sem preço</span>}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              </>
                            )}
                            {/* Section 2: presets fixos */}
                            {PRESETS.filter(p => !extraPickerBusca || p.toLowerCase().includes(extraPickerBusca.toLowerCase())).length > 0 && (
                              <>
                                <div className="px-3 py-2 border-b border-t border-gray-200 dark:border-border bg-gray-50 dark:bg-surface-2 text-[10px] uppercase font-bold text-gray-600 dark:text-ink-muted tracking-wider">
                                  Outros componentes (digite o valor)
                                </div>
                                <div className="p-1">
                                  {PRESETS.filter(p => !extraPickerBusca || p.toLowerCase().includes(extraPickerBusca.toLowerCase())).map(p => (
                                    <button
                                      key={p}
                                      type="button"
                                      onClick={() => { adicionar(p); setExtraPickerBusca('') }}
                                      className="w-full text-left px-3 py-2 rounded-md text-[13px] hover:bg-blue-50 dark:hover:bg-accent/10 transition-colors text-gray-800 dark:text-ink"
                                    >{p}</button>
                                  ))}
                                </div>
                              </>
                            )}
                            {/* Section 3: livre */}
                            <div className="border-t border-gray-200 dark:border-border p-1">
                              <button
                                type="button"
                                onClick={() => { adicionar(extraPickerBusca || ''); setExtraPickerBusca('') }}
                                className="w-full text-left px-3 py-2 rounded-md text-[13px] hover:bg-yellow-50 dark:hover:bg-warning/10 transition-colors text-gray-700 dark:text-ink-muted italic"
                              >{extraPickerBusca ? `+ Adicionar "${extraPickerBusca}"` : '+ Outro (digitar manualmente)'}</button>
                            </div>
                          </div>
                        </div>
                      </>,
                      document.body,
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* VALOR TOTAL DA PROPOSTA */}
          {(() => {
            const descontoValor = desconto
              ? (desconto.tipo === 'pct' ? totalGeral * (desconto.valor / 100) : desconto.valor)
              : 0
            const totalFinal = Math.max(0, totalGeral - descontoValor)
            const temDesconto = !!desconto && descontoValor > 0
            return (
              <>
                <div data-no-break className={`mt-6 px-6 py-5 border-2 rounded-lg tracking-wide relative bg-white ${temDesconto ? 'border-gray-400 bg-gray-50/40' : 'border-gray-900'}`} style={{ zIndex: 1, breakInside: 'avoid', pageBreakInside: 'avoid' }}>
                  <div className={`flex justify-between items-center gap-4 min-h-[32px] ${temDesconto ? 'text-[15px] font-semibold' : 'text-[19px] font-black'}`}>
                    <span className={`uppercase flex-1 leading-tight ${temDesconto ? 'text-gray-500' : 'text-gray-900'}`}>
                      Valor total da proposta{totalMotores > 0 ? ' com motor novo' : ''}{temDesconto ? ' (sem desconto)' : ''}
                    </span>
                    <span className={`tabular-nums whitespace-nowrap leading-tight ${temDesconto ? 'text-[16px] text-gray-500' : 'text-[20px] text-gray-900'}`}>
                      R$ {formatBRLBare(totalGeral)}
                    </span>
                  </div>
                </div>

                {/* Caixa editável de desconto + total final (modo edit) */}
                {!renderMode && onUpdateDesconto && (
                  <div className="mt-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-2 text-[15px] print:hidden">
                    <span className="text-blue-900 font-semibold">Desconto:</span>
                    <select
                      value={desconto?.tipo || ''}
                      onChange={e => {
                        const v = e.target.value
                        if (!v) onUpdateDesconto(null)
                        else onUpdateDesconto({ tipo: v as 'pct' | 'valor', valor: desconto?.valor || 0 })
                      }}
                      className="text-[15px] px-2 py-1 border border-blue-300 rounded bg-white"
                    >
                      <option value="">Nenhum</option>
                      <option value="pct">% percentual</option>
                      <option value="valor">R$ manual</option>
                    </select>
                    {desconto && (
                      <input
                        type="number"
                        step="0.01" min={0}
                        value={desconto.valor || ''}
                        onChange={e => onUpdateDesconto({ tipo: desconto.tipo, valor: parseFloat(e.target.value) || 0 })}
                        className="w-24 text-[15px] px-2 py-1 border border-blue-300 rounded bg-white"
                        placeholder={desconto.tipo === 'pct' ? '5' : '500.00'}
                      />
                    )}
                    {desconto && (
                      <span className="text-blue-700 text-[15px]">
                        = R$ {formatBRLBare(descontoValor)} de abatimento
                      </span>
                    )}
                  </div>
                )}

                {/* VALOR TOTAL COM DESCONTO — caixa destacada (renderiza no PDF tb) */}
                {temDesconto && (
                  <div data-no-break className="mt-2 px-6 py-5 border-2 border-emerald-700 rounded-lg tracking-wide bg-emerald-50/60 relative" style={{ zIndex: 1 }}>
                    <div className="flex justify-between items-center gap-4 min-h-[40px] text-[20px] font-black">
                      <span className="text-emerald-900 uppercase flex-1 leading-tight">
                        Valor total com desconto
                      </span>
                      <span className="text-emerald-900 text-[22px] tabular-nums whitespace-nowrap leading-tight">
                        R$ {formatBRLBare(totalFinal)}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )
          })()}

          {/* Termos comerciais — campos editáveis em modo edit
              CSS Fragmentation: força bloco a NÃO quebrar entre páginas */}
          <div
            data-no-break
            style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
            className="mt-5 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded text-[14.5px] text-gray-800 space-y-1.5">
            {(() => {
              // Converte string BR (DD/MM/AAAA) → ISO (AAAA-MM-DD) e vice-versa pra <input type="date">
              const brToIso = (br: string) => {
                const m = br.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
                if (!m) return ''
                return `${m[3]}-${m[2]}-${m[1]}`
              }
              const isoToBr = (iso: string) => {
                const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
                if (!m) return iso
                return `${m[3]}/${m[2]}/${m[1]}`
              }
              const renderTerm = (_label: string, valor: string | null | undefined, placeholder: string, key: 'dataVenda' | 'prazoEntrega' | 'formaPagamento') => {
                const isPh = !valor || !valor.trim()
                if (!renderMode && onUpdateTerm) {
                  if (key === 'dataVenda') {
                    return (
                      <input
                        type="date"
                        value={brToIso(valor || '')}
                        onChange={e => onUpdateTerm(key, e.target.value ? isoToBr(e.target.value) : '')}
                        className={`bg-transparent border-b border-dashed border-gray-300 hover:border-blue-500 focus:border-blue-600 focus:outline-none px-1 cursor-pointer ${isPh ? 'text-gray-400' : 'text-gray-800'}`}
                      />
                    )
                  }
                  // prazoEntrega → input numérico de dias + select úteis/corridos
                  if (key === 'prazoEntrega') {
                    // Parse: "90 dias (úteis)" → { dias: 90, tipo: 'uteis' }
                    const m = (valor || '').match(/^\s*(\d+)\s*dias?\s*\(\s*(úteis|uteis|corridos)\s*\)\s*$/i)
                    const dias = m ? parseInt(m[1], 10) : (valor && valor.trim() ? 0 : 90)
                    const tipo: 'uteis' | 'corridos' = m && /corrido/i.test(m[2]) ? 'corridos' : 'uteis'
                    const tipoLabel = tipo === 'uteis' ? 'úteis' : 'corridos'
                    const writeBack = (d: number, t: 'uteis' | 'corridos') => {
                      const tl = t === 'uteis' ? 'úteis' : 'corridos'
                      onUpdateTerm(key, `${d} dias (${tl})`)
                    }
                    return (
                      <span className="inline-flex items-center gap-1 align-baseline">
                        <input
                          type="number"
                          min={1}
                          max={365}
                          value={dias || ''}
                          onChange={e => {
                            const d = parseInt(e.target.value, 10)
                            if (!isNaN(d) && d > 0) writeBack(d, tipo)
                          }}
                          placeholder="90"
                          className="bg-transparent border-b border-dashed border-gray-300 hover:border-blue-500 focus:border-blue-600 focus:outline-none px-1 w-[55px] text-center text-gray-800 tabular-nums"
                        />
                        <span className="text-gray-600">dias</span>
                        <select
                          value={tipo}
                          onChange={e => writeBack(dias || 90, e.target.value as 'uteis' | 'corridos')}
                          className="bg-transparent border border-gray-300 hover:border-blue-500 focus:border-blue-600 focus:outline-none rounded px-1.5 py-0 text-gray-800 cursor-pointer"
                          title="Tipo de contagem"
                        >
                          <option value="uteis">(úteis)</option>
                          <option value="corridos">(corridos)</option>
                        </select>
                        {!valor && <span className="text-gray-400 italic text-xs ml-1">default: 90 dias {tipoLabel}</span>}
                      </span>
                    )
                  }
                  // formaPagamento → textarea full-width (texto pode ser longo)
                  if (key === 'formaPagamento') {
                    return (
                      <textarea
                        defaultValue={valor || ''}
                        key={valor || 'empty'}
                        onBlur={e => onUpdateTerm(key, e.target.value)}
                        placeholder={placeholder}
                        rows={(valor || '').length > 80 ? 2 : 1}
                        className={`w-full resize-none bg-transparent border-b border-dashed border-gray-300 hover:border-blue-500 focus:border-blue-600 focus:outline-none px-1 ${isPh ? 'italic text-gray-400' : 'text-gray-800'}`}
                      />
                    )
                  }
                  return (
                    <input
                      type="text"
                      defaultValue={valor || ''}
                      onBlur={e => onUpdateTerm(key, e.target.value)}
                      placeholder={placeholder}
                      className={`bg-transparent border-b border-dashed border-gray-300 hover:border-blue-500 focus:border-blue-600 focus:outline-none px-1 min-w-[140px] ${isPh ? 'italic text-gray-400' : 'text-gray-800'}`}
                    />
                  )
                }
                return isPh
                  ? <span className="text-gray-400 italic">{placeholder}</span>
                  : <span>{valor}</span>
              }
              // Templates de forma de pagamento — calculam datas a partir da Data da Venda
              function addDaysBR(brDate: string, days: number): string {
                const iso = brToIso(brDate)
                if (!iso) return ''
                const d = new Date(iso + 'T12:00:00')
                d.setDate(d.getDate() + days)
                const dd = String(d.getDate()).padStart(2, '0')
                const mm = String(d.getMonth() + 1).padStart(2, '0')
                return `${dd}/${mm}/${d.getFullYear()}`
              }
              const baseDate = dataVendaTxt
              const templatesFP: { id: string; label: string; build: () => string }[] = [
                {
                  id: 'avista_pix5',
                  label: 'À vista PIX (5% desc)',
                  build: () => 'À vista no PIX com 5% de desconto',
                },
                {
                  id: 'pedido_nf',
                  label: '50% pedido + 50% NF',
                  build: () => `50% no pedido${baseDate ? ` (${baseDate})` : ''} + 50% na emissão da NF`,
                },
                {
                  id: '30_60_90',
                  label: '30/60/90 dias NF',
                  build: () => {
                    if (!baseDate) return '1/3 em 30d · 1/3 em 60d · 1/3 em 90d após NF'
                    return `1/3 em 30d (${addDaysBR(baseDate, 30)}) · 1/3 em 60d (${addDaysBR(baseDate, 60)}) · 1/3 em 90d (${addDaysBR(baseDate, 90)})`
                  },
                },
                {
                  id: 'pedido70_30d',
                  label: '30% pedido + 70% 30d',
                  build: () => {
                    const d30 = baseDate ? ` (${addDaysBR(baseDate, 30)})` : ''
                    const dpedido = baseDate ? ` (${baseDate})` : ''
                    return `30% no pedido${dpedido} + 70% em 30 dias${d30}`
                  },
                },
                {
                  id: 'entrada_3x',
                  label: '50% pedido + 3× após NF',
                  build: () => {
                    if (!baseDate) return '50% no pedido + 3× 30/60/90 dias após NF'
                    return `50% no pedido (${baseDate}) + 3× em ${addDaysBR(baseDate, 30)} · ${addDaysBR(baseDate, 60)} · ${addDaysBR(baseDate, 90)}`
                  },
                },
              ]
              return (
                <>
                  <div className="flex gap-1.5 items-center"><span className="text-gray-400">•</span><span>Data da venda – {renderTerm('Data da venda', dataVendaTxt, 'a combinar', 'dataVenda')}</span></div>
                  <div className="flex gap-1.5 items-center"><span className="text-gray-400">•</span><span>Prazo de entrega – {renderTerm('Prazo de entrega', prazoEntregaTxt, '90 dias (úteis)', 'prazoEntrega')}</span></div>
                  {/* TABELA DE PARCELAS DE PAGAMENTO (estruturada) */}
                  {(() => {
                    const arr = parcelas || []
                    const temParcelas = arr.length > 0
                    function novoId() { return `p-${Date.now()}-${Math.random().toString(36).slice(2, 6)}` }
                    function calcValor(p: ParcelaPagamento): number {
                      if (typeof p.valor === 'number') return p.valor
                      // Usa totalComDesconto (não totalGeral) pra parcelas refletirem o valor real
                      const base = totalComDesconto
                      if (typeof p.pct === 'number') return Math.round((base * p.pct / 100) * 100) / 100
                      return 0
                    }
                    function dataLabel(p: ParcelaPagamento): string {
                      if (p.dataTipo === 'no_pedido') return 'NO PEDIDO'
                      if (p.dataTipo === 'na_nf') return 'NA EMISSÃO DA NOTA'
                      if (p.dataTipo === 'apos_nf') return `${p.dias || 30} DIAS APÓS A NOTA`
                      if (p.dataTipo === 'data_fixa') return p.dataFixa || 'DATA FIXA'
                      return ''
                    }
                    // Calcula a data efetiva da parcela em formato BR (DD/MM/AAAA)
                    function brToIso(br: string): string {
                      const m = (br || '').match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
                      return m ? `${m[3]}-${m[2]}-${m[1]}` : ''
                    }
                    function isoToBr(iso: string): string {
                      const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
                      return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
                    }
                    function addDaysCorridos(brDate: string, days: number): string {
                      const iso = brToIso(brDate)
                      if (!iso) return ''
                      const d = new Date(iso + 'T12:00:00')
                      d.setDate(d.getDate() + days)
                      return isoToBr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
                    }
                    function addDiasUteis(brDate: string, days: number): string {
                      const iso = brToIso(brDate)
                      if (!iso) return ''
                      const d = new Date(iso + 'T12:00:00')
                      let restantes = days
                      while (restantes > 0) {
                        d.setDate(d.getDate() + 1)
                        const dow = d.getDay()  // 0=dom 6=sab
                        if (dow !== 0 && dow !== 6) restantes--
                      }
                      return isoToBr(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`)
                    }
                    // Extrai número de dias do prazo de entrega ("90 dias (úteis)" → 90)
                    function parsePrazoDias(txt: string): number {
                      const m = (txt || '').match(/(\d+)\s*dias?/i)
                      return m ? parseInt(m[1], 10) : 90
                    }
                    // Detecta se prazo é "úteis" (default) ou "corridos"
                    function prazoEhUteis(txt: string): boolean {
                      return !/corrido/i.test(txt || '')
                    }
                    function addDiasPrazo(base: string, days: number): string {
                      return prazoEhUteis(prazoEntregaTxt)
                        ? addDiasUteis(base, days)
                        : addDaysCorridos(base, days)
                    }
                    function dataCalculada(p: ParcelaPagamento): string {
                      const base = dataVendaTxt
                      if (p.dataTipo === 'no_pedido') return base || '—'
                      if (p.dataTipo === 'na_nf') {
                        // Na emissão da NF = data da venda + prazo de entrega
                        if (!base) return '—'
                        return addDiasPrazo(base, parsePrazoDias(prazoEntregaTxt))
                      }
                      if (p.dataTipo === 'apos_nf') {
                        // X dias APÓS a NF = base + prazoEntrega + X dias
                        if (!base) return `+${p.dias || 30}d após NF`
                        return addDiasPrazo(base, parsePrazoDias(prazoEntregaTxt) + (p.dias || 30))
                      }
                      if (p.dataTipo === 'data_fixa') return p.dataFixa || '—'
                      return '—'
                    }
                    function updateParcela(id: string, patch: Partial<ParcelaPagamento>) {
                      if (!onUpdateParcelas) return
                      onUpdateParcelas(arr.map(p => p.id === id ? { ...p, ...patch } : p))
                    }
                    function removeParcela(id: string) {
                      if (!onUpdateParcelas) return
                      onUpdateParcelas(arr.filter(p => p.id !== id))
                    }
                    function addParcela(preset?: Partial<ParcelaPagamento>) {
                      if (!onUpdateParcelas) return
                      onUpdateParcelas([...arr, { id: novoId(), dataTipo: 'na_nf', metodo: 'PIX', pct: 0, ...(preset || {}) }])
                    }
                    function applyTemplate(tipo: string) {
                      if (!onUpdateParcelas) return
                      const id1 = novoId(), id2 = novoId(), id3 = novoId(), id4 = novoId()
                      if (tipo === 'avista') onUpdateParcelas([{ id: id1, dataTipo: 'no_pedido', metodo: 'PIX', pct: 100 }])
                      else if (tipo === '50_50') onUpdateParcelas([
                        { id: id1, dataTipo: 'no_pedido', metodo: 'PIX', pct: 50 },
                        { id: id2, dataTipo: 'na_nf', metodo: 'PIX', pct: 50 },
                      ])
                      else if (tipo === '30_60_90') onUpdateParcelas([
                        { id: id1, dataTipo: 'apos_nf', dias: 30, metodo: 'BOLETO', pct: 33.34 },
                        { id: id2, dataTipo: 'apos_nf', dias: 60, metodo: 'BOLETO', pct: 33.33 },
                        { id: id3, dataTipo: 'apos_nf', dias: 90, metodo: 'BOLETO', pct: 33.33 },
                      ])
                      else if (tipo === 'pedido_nf_30_60') onUpdateParcelas([
                        { id: id1, dataTipo: 'no_pedido', metodo: 'PIX', pct: 25 },
                        { id: id2, dataTipo: 'na_nf', metodo: 'PIX', pct: 25 },
                        { id: id3, dataTipo: 'apos_nf', dias: 30, metodo: 'BOLETO', pct: 25 },
                        { id: id4, dataTipo: 'apos_nf', dias: 60, metodo: 'BOLETO', pct: 25 },
                      ])
                    }
                    const totalPct = arr.reduce((s, p) => s + (typeof p.pct === 'number' ? p.pct : 0), 0)
                    const totalParcelas = arr.reduce((s, p) => s + calcValor(p), 0)
                    // Soma das parcelas em R$ vs total COM DESCONTO (valida cobertura)
                    const baseComparacao = totalComDesconto
                    const diffParcelas = baseComparacao > 0 ? totalParcelas - baseComparacao : 0
                    const fechouValor = baseComparacao > 0 && Math.abs(diffParcelas) < 0.01
                    return (
                      <div className="flex gap-1.5 items-start">
                        <span className="text-gray-400 mt-0.5">•</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="font-semibold">Forma de pagamento:</span>
                            {!renderMode && onUpdateParcelas && (
                              <div className="flex items-center gap-1 print:hidden">
                                <select
                                  onChange={e => { if (e.target.value) { applyTemplate(e.target.value); e.target.value = '' } }}
                                  className="text-[12px] px-1 py-0.5 bg-blue-50 border border-blue-300 rounded text-blue-700 cursor-pointer focus:outline-none"
                                  defaultValue=""
                                >
                                  <option value="">📋 Templates</option>
                                  <option value="avista">100% à vista</option>
                                  <option value="50_50">50% pedido + 50% NF</option>
                                  <option value="30_60_90">3× 30/60/90 dias</option>
                                  <option value="pedido_nf_30_60">25/25/25/25 pedido+NF+30+60</option>
                                </select>
                                <button
                                  type="button"
                                  onClick={() => addParcela()}
                                  className="text-[12px] px-1.5 py-0.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-300 rounded text-emerald-700 font-bold"
                                  title="Adicionar parcela"
                                >+ Parcela</button>
                                {temParcelas && (
                                  <button
                                    type="button"
                                    onClick={() => { if (confirm('Limpar todas as parcelas?')) onUpdateParcelas([]) }}
                                    className="text-[12px] text-gray-500 hover:text-red-600 px-1"
                                    title="Limpar"
                                  >✕</button>
                                )}
                              </div>
                            )}
                          </div>
                          {temParcelas && !dataVendaTxt && !renderMode && (
                            <div className="text-[10px] bg-amber-50 border border-amber-300 text-amber-800 px-2 py-1.5 rounded mb-1.5 print:hidden">
                              ⚠️ <strong>Preencha "Data da venda"</strong> acima pra calcular as datas das parcelas (NF + X dias)
                            </div>
                          )}
                          {temParcelas ? (
                            <table
                              data-no-break
                              style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }}
                              className="w-full text-[12px] border-collapse mt-0.5">
                              <thead>
                                <tr className="bg-gray-100 border-b-2 border-gray-700">
                                  <th className="text-left py-1.5 px-2 font-bold text-gray-700 uppercase tracking-wider text-[11px]">Data</th>
                                  <th className="text-left py-1.5 px-2 font-bold text-gray-700 uppercase tracking-wider text-[11px]">Método</th>
                                  <th className="text-right py-1.5 px-2 font-bold text-gray-700 uppercase tracking-wider text-[11px]">Valor</th>
                                  {!renderMode && <th className="w-6 print:hidden"></th>}
                                </tr>
                              </thead>
                              <tbody>
                                {arr.map(p => (
                                  <tr key={p.id} style={{ breakInside: 'avoid', pageBreakInside: 'avoid' }} className="border-b border-gray-200">
                                    <td className="py-1 px-2">
                                      {!renderMode && onUpdateParcelas ? (
                                        <div>
                                          <div className="flex items-center gap-1">
                                            <select
                                              value={p.dataTipo}
                                              onChange={e => updateParcela(p.id, { dataTipo: e.target.value as ParcelaPagamento['dataTipo'] })}
                                              className="text-[12px] px-1 py-0.5 bg-white border border-gray-300 rounded"
                                            >
                                              <option value="no_pedido">No pedido</option>
                                              <option value="na_nf">Na NF</option>
                                              <option value="apos_nf">Após NF (dias)</option>
                                              <option value="data_fixa">Data fixa</option>
                                            </select>
                                            {p.dataTipo === 'apos_nf' && (
                                              <input
                                                type="number" min={1} max={365}
                                                value={p.dias ?? 30}
                                                onChange={e => updateParcela(p.id, { dias: parseInt(e.target.value) || 0 })}
                                                className="w-12 text-[12px] px-1 py-0.5 bg-white border border-gray-300 rounded text-center"
                                              />
                                            )}
                                            {p.dataTipo === 'data_fixa' && (
                                              <input
                                                type="date"
                                                value={brToIso(p.dataFixa || '')}
                                                onChange={e => updateParcela(p.id, { dataFixa: e.target.value ? isoToBr(e.target.value) : '' })}
                                                className="text-[12px] px-1 py-0.5 bg-white border border-gray-300 rounded cursor-pointer"
                                              />
                                            )}
                                          </div>
                                          {dataVendaTxt && (() => {
                                            const dataCalc = dataCalculada(p)
                                            return (
                                              <div className="mt-1">
                                                <label className="inline-flex items-center gap-1 cursor-pointer hover:underline">
                                                  <span className="text-[11px] font-bold text-emerald-700 tabular-nums">📅</span>
                                                  <input
                                                    type="date"
                                                    value={brToIso(dataCalc)}
                                                    onChange={e => {
                                                      if (e.target.value) updateParcela(p.id, { dataTipo: 'data_fixa', dataFixa: isoToBr(e.target.value) })
                                                    }}
                                                    className="text-[11px] font-bold text-emerald-700 tabular-nums bg-transparent border-none cursor-pointer p-0 focus:outline-none"
                                                  />
                                                </label>
                                              </div>
                                            )
                                          })()}
                                        </div>
                                      ) : (
                                        <div>
                                          <div className="uppercase font-semibold text-[10.5px]">{dataLabel(p)}</div>
                                          <div className="text-[11px] text-emerald-700 font-bold tabular-nums mt-0.5">{dataCalculada(p)}</div>
                                        </div>
                                      )}
                                    </td>
                                    <td className="py-1 px-2">
                                      {!renderMode && onUpdateParcelas ? (
                                        <select
                                          value={p.metodo}
                                          onChange={e => updateParcela(p.id, { metodo: e.target.value as ParcelaPagamento['metodo'] })}
                                          className="text-[12px] px-1 py-0.5 bg-white border border-gray-300 rounded"
                                        >
                                          <option value="">—</option>
                                          <option value="PIX">PIX</option>
                                          <option value="BOLETO">BOLETO</option>
                                          <option value="DINHEIRO">DINHEIRO</option>
                                          <option value="TRANSFERENCIA">TRANSFERÊNCIA</option>
                                          <option value="CARTAO">CARTÃO</option>
                                        </select>
                                      ) : (
                                        <span className="font-semibold">{p.metodo}</span>
                                      )}
                                    </td>
                                    <td className="py-1 px-2 text-right">
                                      {!renderMode && onUpdateParcelas ? (
                                        (() => {
                                          // Ambos inputs editaveis. Sync bidirecional automatico:
                                          //  - Editar % → salva pct, R$ recalcula como pct*total
                                          //  - Editar R$ → salva valor, % recalcula como valor/total*100
                                          // O "modo armazenado" (pct vs valor) muda conforme ultimo input editado.
                                          const base = totalComDesconto
                                          const pctMostrado = typeof p.pct === 'number'
                                            ? p.pct
                                            : (base > 0 && typeof p.valor === 'number'
                                                ? Math.round((p.valor / base) * 10000) / 100
                                                : '')
                                          const valorMostrado = typeof p.valor === 'number'
                                            ? p.valor
                                            : (typeof p.pct === 'number'
                                                ? Math.round((base * p.pct / 100) * 100) / 100
                                                : '')
                                          return (
                                            <div className="flex items-center justify-end gap-1">
                                              <input
                                                type="number" min={0} max={100} step={0.01}
                                                value={pctMostrado}
                                                onChange={e => updateParcela(p.id, {
                                                  pct: e.target.value === '' ? undefined : parseFloat(e.target.value),
                                                  valor: undefined,
                                                })}
                                                placeholder="%"
                                                title="% sobre o total. Editar atualiza o R$ automaticamente."
                                                className="w-14 text-[12px] px-1 py-0.5 bg-white border border-gray-300 rounded text-right hover:border-blue-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none"
                                              />
                                              <span className="text-gray-500 text-[11px]">% =</span>
                                              <span className="text-gray-700 text-[12px] font-bold">R$</span>
                                              <BRLInput
                                                value={typeof valorMostrado === 'number' ? valorMostrado : 0}
                                                onChange={v => updateParcela(p.id, { valor: v, pct: undefined })}
                                                title="Valor em R$. Editar fixa o valor (% recalcula automaticamente)."
                                                className="w-24 text-[12px] font-bold"
                                              />
                                            </div>
                                          )
                                        })()
                                      ) : (
                                        <span className="font-bold tabular-nums">R$ {formatBRLBare(calcValor(p))}</span>
                                      )}
                                    </td>
                                    {!renderMode && onUpdateParcelas && (
                                      <td className="py-1 px-1 text-center print:hidden">
                                        <button
                                          type="button"
                                          onClick={() => removeParcela(p.id)}
                                          className="text-red-500 hover:text-red-700 text-[16px] leading-none"
                                          title="Remover"
                                        >×</button>
                                      </td>
                                    )}
                                  </tr>
                                ))}
                                {/* Linha TOTAL — só no modo edit. Avisa quando a soma das parcelas
                                    nao fecha com o total do orcamento (em R$, considerando tanto pct quanto valor manual). */}
                                {!renderMode && !fechouValor && baseComparacao > 0 && (
                                  <tr className="border-t border-amber-300 bg-amber-50 print:hidden">
                                    <td className="py-1 px-2 text-[10px] text-amber-800 italic" colSpan={3}>
                                      ⚠️ Soma das parcelas: <strong>R$ {formatBRLBare(totalParcelas)}</strong> de R$ {formatBRLBare(baseComparacao)} ({totalPct > 0 && `${totalPct.toFixed(2)}% · `}{diffParcelas > 0 ? '+' : ''}{formatBRLBare(diffParcelas)}) — ajuste pra fechar
                                    </td>
                                    {!renderMode && <td className="print:hidden"></td>}
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          ) : (
                            <div>{renderTerm('Forma de pagamento', formaPagamentoTxt, 'a combinar (use templates ou + Parcela)', 'formaPagamento')}</div>
                          )}
                        </div>
                      </div>
                    )
                  })()}
                  <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Frete – por conta do cliente</span></div>
                  <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Validade da proposta – 10 dias após o envio</span></div>
                </>
              )
            })()}
          </div>

          <div data-no-break>
            <SectionHeader>Nossas Redes Sociais</SectionHeader>
            <div className="text-[14.5px] text-gray-800 space-y-0.5">
              <div><span className="font-bold">Instagram:</span> @branorte_metalurgica</div>
              <div><span className="font-bold">YouTube:</span> @mbranorte</div>
              <div><span className="font-bold">Facebook:</span> branorte.metalurgica</div>
            </div>
          </div>

          <div data-no-break>
            <SectionHeader>Dados do Fabricante</SectionHeader>
            <div className="text-[14.5px] text-gray-800 space-y-0.5">
              <div><span className="font-bold">Empresa:</span> BRANORTE – Metalúrgica BBA Ltda</div>
              <div><span className="font-bold">Endereço:</span> Rodovia SC 370, km 139, Nº 1390 — Grão Pará/SC · CEP 88890-000</div>
              <div><span className="font-bold">Telefone:</span> (48) 3658-4502 / (48) 3658-7453</div>
              <div><span className="font-bold">CNPJ:</span> 16.935.999/0001-09 · <span className="font-bold">I.E.:</span> 256.847.320</div>
              <div><span className="font-bold">E-mail:</span> contato@mbranorte.com.br</div>
            </div>
          </div>

          {/* Grid de vendedores REMOVIDO (user pediu — poluia o rodape).
              Contato principal continua no header 'DADOS DO FABRICANTE' acima. */}

          <div data-no-break>
            <SectionHeader>Conta para Depósito</SectionHeader>
            <div className="grid grid-cols-3 gap-3 text-[14px] text-gray-800">
              <div className="space-y-0.5">
                <div className="font-bold uppercase tracking-wide text-gray-900 mb-1 pb-0.5 border-b border-gray-300">Banco do Brasil</div>
                <div>Agência: <strong>0738-2</strong></div>
                <div>Conta: <strong>39551-X</strong></div>
                <div>Metalúrgica BBA</div>
                <div className="text-[13.5px] text-gray-500">CNPJ: 16.935.999/0001-09</div>
              </div>
              <div className="space-y-0.5">
                <div className="font-bold uppercase tracking-wide text-gray-900 mb-1 pb-0.5 border-b border-gray-300">Sicoob Credivale</div>
                <div>Cooperativa: <strong>3078</strong></div>
                <div>Banco: <strong>756</strong></div>
                <div>Conta: <strong>109909-4</strong></div>
                <div className="text-[13.5px] text-gray-500">CNPJ: 16.935.999/0001-09</div>
              </div>
              <div className="space-y-0.5">
                <div className="font-bold uppercase tracking-wide text-gray-900 mb-1 pb-0.5 border-b border-gray-300">PIX</div>
                <div className="text-[13.5px] text-gray-600">CNPJ:</div>
                <div className="font-mono"><strong>16935999000109</strong></div>
                <div className="text-[13.5px] text-gray-500 mt-1">SICOOB · Metalúrgica BBA</div>
              </div>
            </div>
          </div>

          <div data-no-break>
            <SectionHeader>Caixa Postal</SectionHeader>
            <div className="text-[14.5px] text-gray-800 space-y-0.5">
              <div><span className="font-bold">Caixa Postal:</span> Nº 149 · <span className="font-bold">CEP:</span> 88750-970</div>
              <div><span className="font-bold">Cidade:</span> Braço do Norte – SC</div>
              <div>Metalúrgica BBA · CNPJ: 16.935.999/0001-09</div>
            </div>
          </div>

          <div data-no-break>
            <SectionHeader>Observação <span className="text-gray-400 font-normal normal-case tracking-normal text-[14px]">— por conta do cliente</span></SectionHeader>
            <div className="text-[14.5px] text-gray-800 space-y-0.5 pl-2">
              <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Painel elétrico</span></div>
              <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Montagem dos equipamentos orçados acima (se necessário)</span></div>
              <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Muck (se necessário)</span></div>
              <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Despesa com obras civil (se necessário)</span></div>
              <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Instalação elétrica dos equipamentos (se necessário)</span></div>
            </div>
          </div>

          {observacoesExtra && observacoesExtra.trim() && (
            <div data-no-break>
              <SectionHeader>Observações</SectionHeader>
              <div className="text-[14.5px] text-gray-800 leading-snug whitespace-pre-wrap">
                {observacoesExtra}
              </div>
            </div>
          )}

          <div data-no-break>
            <SectionHeader>Tributos</SectionHeader>
            <div className="text-[14px] text-gray-700 leading-snug space-y-1.5 text-justify">
              <p data-no-break>
                As condições desta proposta consideram os impostos e taxas vigentes, quando da elaboração da mesma sendo que quaisquer alterações sobre os tributos Municipais, Estaduais e Federais serão repassados ou de responsabilidade do cliente, incluindo pagamento ou documento de exoneração fiscal da diferença do ICMS ao Estado de destino ou custos de caminhão parado em posto fiscal da fronteira.
              </p>
              <p data-no-break>
                Sendo o contratante não contribuinte de ICMS, este deverá obrigatoriamente depositar para a contratada até o dia do embarque o valor correspondente ao diferencial de alíquota de ICMS referente ao objeto deste contrato, para que a CONTRATADA possa então pagar este diferencial, cujo comprovante de pagamento será enviado com a nota fiscal de vendas das mercadorias.
              </p>
            </div>
          </div>

          <div data-no-break>
            <SectionHeader>Cláusula de Cancelamento</SectionHeader>
            <div className="text-[14px] text-gray-700 leading-snug text-justify">
              Caso o comprador deseje cancelar o pedido, fica estabelecido que será cobrada uma taxa de cancelamento no valor de <strong>10% do preço total do produto</strong>. Essa taxa é destinada a cobrir eventuais perdas financeiras decorrentes do cancelamento, incluindo custos de produção, armazenamento e distribuição.
            </div>
          </div>

          <div data-no-break>
            <SectionHeader>Garantia</SectionHeader>
            <div className="text-[14px] text-gray-700 leading-snug space-y-1.5 text-justify">
              <p data-no-break>
                Os equipamentos fornecidos pela metalúrgica BRANORTE estão garantidos pelo prazo de <strong>12 (doze) meses</strong> contados da data de entrega dos mesmos, quanto ao funcionamento, desde que sejam armazenados, montados e operados dentro das condições para as quais foram projetados. Durante o prazo de garantia serão substituídas as peças que apresentarem defeitos, ficando as despesas de frete das peças, deslocamento, estadia e alimentação dos técnicos montadores por conta do cliente. Expirado o prazo de garantia, forneceremos assistência técnica mediante solicitação. Ficam excluídos da garantia os seguintes itens: canalizações e dispositivos de interligação.
              </p>
              <p data-no-break>
                Componentes fabricados e/ou montados por terceiros, tais como: motores elétricos, redutores, chaves elétricas, quadro de comando elétrico, correias, rolamentos (tendo somente a garantia fornecida pelos respectivos fabricantes), bem como toda e qualquer obra civil que é de responsabilidade do cliente.
              </p>
            </div>
          </div>

          {/* Assinaturas */}
          <div data-no-break className="mt-10 grid grid-cols-2 gap-8 px-2">
            <div className="text-center">
              <div className="border-t border-gray-700 pt-1.5 text-[14.5px] font-bold text-gray-800">
                Metalúrgica BBA LTDA
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-gray-700 pt-1.5 text-[14.5px] font-bold text-gray-800">
                {cli.nome
                  ? <span>{cli.nome}</span>
                  : <span className="text-gray-400 italic">[Cliente]</span>}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 pt-2 border-t border-gray-200 flex justify-between text-[12.5px] text-gray-400">
            <span>Orçamento · Branorte BBA</span>
            <span>Página 1</span>
          </div>
        </div>
      </div>
    </div>
  )
}
