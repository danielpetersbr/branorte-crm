// Preview do orçamento personalizado.
// Usado em 2 contextos:
//  1) Modo edit (default) — dentro de OrcamentoMontar com botões de remover/editar acessórios
//  2) Modo render — usado pelo gerador de PDF (preview-to-pdf.ts) com renderMode=true
//     e cliente/numero/data/terms preenchidos. Esconde os botões interativos.

import { X } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'

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
}

export interface PreviewMotor {
  cv: number
  polos: number
  qtd: number
  valor_unit: number
  valor_total: number
  item_nome?: string  // se vier, mostra "de qual item" o motor é
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

export interface OrcamentoPreviewProps {
  carrinho: PreviewItem[]
  motoresAgrupados: PreviewMotor[]
  voltagem: 'monofasico' | 'trifasico'
  totalItems: number
  totalMotores: number
  totalEquip: number
  totalGeral: number
  acessorios: { pct: number; items: string[] } | null
  valorAcessorios: number

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
  onEditAcessorios?: () => void
  onRemoveAcessorios?: () => void
  onRemove?: (uid: string) => void
  onFotoChange?: (dataURL: string | null) => void
  onUpdateNome?: (uid: string, novoNome: string) => void
  onUpdateTerm?: (key: 'dataVenda' | 'prazoEntrega' | 'formaPagamento', valor: string) => void
  onMoverItem?: (uid: string, direcao: 'cima' | 'baixo') => void

  // Parcelas estruturadas (alternativa ao texto livre de formaPagamento)
  parcelas?: ParcelaPagamento[]
  onUpdateParcelas?: (p: ParcelaPagamento[]) => void
}

function formatBRLBare(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
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

  // Helper: retorna o bloco no-break que contém o Y (ou null)
  const findContaining = (y: number): HTMLElement | null => {
    for (const el of noBreakEls) {
      const { top, bottom } = localTop(el)
      if (y > top + 2 && y < bottom + 2) return el
    }
    return null
  }

  // 1) Se idealY cai dentro de algum no-break, tenta mover pra antes (com margem de 8px)
  let y = idealY
  for (let iter = 0; iter < 8; iter++) {
    const hit = findContaining(y)
    if (!hit) break
    const { top } = localTop(hit)
    y = top - 8
  }

  // Se foi movido pra MUITO antes (perdemos > 30% da pagina), eh melhor empurrar pra DEPOIS do no-break original
  if (idealY - y > tolerance * 3) {
    // Pega o bloco originalmente atingido (em idealY) e move pra seu bottom
    const originalHit = findContaining(idealY)
    if (originalHit) {
      const { bottom } = localTop(originalHit)
      return bottom + 4
    }
  }

  // Garantia final: se ainda está dentro de algum bloco apos os 8 iters,
  // empurra pro fim do bloco (preferimos pagina mais cheia a quebra ruim)
  const stillIn = findContaining(y)
  if (stillIn) {
    const { bottom } = localTop(stillIn)
    return bottom + 4
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
    onAddAcessorios, onEditAcessorios, onRemoveAcessorios, onRemove, onFotoChange, onUpdateNome, onUpdateTerm, onMoverItem,
    parcelas, onUpdateParcelas,
  } = props
  const [editingNomeUid, setEditingNomeUid] = useState<string | null>(null)
  const [editingNomeValor, setEditingNomeValor] = useState<string>('')
  void totalItems  // mostrado no footer do builder, não no preview

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

  useLayoutEffect(() => {
    if (renderMode || !containerRef.current || !innerRef.current) return

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
  }, [renderMode, carrinho, motoresAgrupados, acessorios])

  return (
    <div ref={containerRef} className="text-[15px] text-gray-900 leading-relaxed font-sans bg-white">
      <div ref={innerRef} className={`m-4 px-6 pt-5 pb-6 relative ${renderMode || folhas.length === 0 ? 'border border-gray-900' : ''}`}>
        {/* Molduras INDEPENDENTES por folha A4 (so em modo edit + multi-pagina) */}
        {!renderMode && folhas.length > 1 && (
          <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
            {folhas.map((f, i) => (
              <div
                key={i}
                className="absolute left-0 right-0 border border-gray-900"
                style={{ top: `${f.top}px`, height: `${f.bottom - f.top}px` }}
              />
            ))}
          </div>
        )}
        {!renderMode && pageHeight > 0 && pageBreaks.length === 0 && carrinho.length > 0 && (
          <div className="absolute top-2 right-2 bg-green-600 text-white text-[14px] font-bold px-2 py-0.5 rounded shadow z-10 pointer-events-none">
            ✓ 1 folha A4
          </div>
        )}
        {!renderMode && pageBreaks.length > 0 && (
          <div className="absolute top-2 right-2 bg-blue-600 text-white text-[14px] font-bold px-2 py-0.5 rounded shadow z-10 pointer-events-none">
            {pageBreaks.length + 1} folhas A4
          </div>
        )}
        {/* Logo — inline styles pra garantir render correto no PDF/DOCX */}
        <div className="text-center mb-5" style={{ textAlign: 'center', marginBottom: 20 }}>
          <img
            src="/branorte-logo.png"
            alt="BRANORTE"
            className="inline-block h-12 w-auto"
            style={{ display: 'inline-block', height: 48, width: 'auto', maxWidth: '100%' }}
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
        <div className="grid grid-cols-3 gap-4 text-[16px] font-bold text-gray-900 mb-1">
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

        {/* Conteúdo */}
        <div className="mt-5">
          <SectionHeader>Itens orçados abaixo</SectionHeader>

          {fotoPrincipal ? (
            <div data-no-break className="group relative mb-3 border border-gray-300 rounded-md p-2 bg-white shadow-sm">
              <div className="w-full flex items-center justify-center bg-white">
                <img
                  src={fotoPrincipal}
                  alt="Foto da fábrica"
                  className="max-w-full h-auto object-contain"
                  style={{ maxHeight: '450px' }}
                  crossOrigin="anonymous"
                />
              </div>
              <div className="text-right text-[13px] italic text-gray-500 mt-1">Imagem ilustrativa</div>
              {!renderMode && onFotoChange && (
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
                    className="text-[15px] bg-blue-600 text-white px-2 py-1 rounded shadow hover:bg-blue-700"
                  >
                    Trocar
                  </button>
                  <button
                    onClick={() => onFotoChange(null)}
                    className="text-[15px] bg-red-600 text-white px-2 py-1 rounded shadow hover:bg-red-700"
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
              className="block w-full mb-3 py-2 text-center border border-dashed border-blue-300 rounded text-blue-700 hover:bg-blue-50 hover:border-blue-500 transition cursor-pointer text-[15px] font-semibold"
            >
              📷 + Adicionar Foto Principal (opcional)
            </button>
          )}

          <div className="space-y-3">
            {carrinho.map((it, idx) => {
              const letra = String.fromCharCode(65 + idx)
              const subtotal = it.valor * it.qtd
              return (
                <div key={it.uid || idx} data-no-break className="group relative border border-gray-300 rounded-md p-3 bg-white shadow-sm">
                  <div className="flex justify-between items-start gap-2 mb-1.5">
                    <div className="font-bold text-[15.5px] flex-1 min-w-0 text-gray-900">
                      <span className="text-gray-900">{letra} - {String(it.qtd).padStart(2, '0')}</span>
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
                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0 pl-3 text-[14.5px] text-gray-700 space-y-0.5">
                      {it.specs.length > 0
                        ? it.specs.map((s, i) => <div key={i} className="flex gap-1.5"><span className="text-gray-400">•</span><span>{s}</span></div>)
                        : it.motor_cv && (
                            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Acionamento: motor {it.motor_cv} CV {it.motor_polos} polos{it.motor_qtd > 1 && ` (qtd ${it.motor_qtd})`}</span></div>
                          )
                      }
                    </div>
                    {it.foto_url && (
                      <div className="shrink-0 w-40 flex flex-col items-center">
                        <div className="w-40 h-40 bg-white border border-gray-300 rounded p-1 flex items-center justify-center">
                          <img
                            src={it.foto_url}
                            alt={it.nome}
                            className="max-w-full max-h-full object-contain"
                            loading="lazy"
                            crossOrigin="anonymous"
                          />
                        </div>
                        <div className="text-[12px] text-gray-400 italic mt-1 tracking-wide">Imagem ilustrativa</div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2.5 pt-1.5 border-t border-gray-300 flex justify-between text-[15.5px] font-bold tracking-wide">
                    <span className="text-gray-700">VALOR</span>
                    <span className="text-gray-900">R$ {formatBRLBare(subtotal)}</span>
                  </div>
                </div>
              )
            })}
          </div>

          {/* ACESSÓRIOS */}
          {acessorios ? (
            <div data-no-break className="group mt-3 border border-gray-300 rounded-md p-3 bg-white shadow-sm">
              <div className="flex items-baseline justify-between gap-2 mb-1.5">
                <div className="font-bold text-[15.5px] text-gray-900">
                  <span className="text-gray-900">— ACESSÓRIOS</span>
                </div>
                {!renderMode && (onEditAcessorios || onRemoveAcessorios) && (
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditAcessorios && <button onClick={onEditAcessorios} className="text-[14px] text-blue-600 hover:underline">editar ({acessorios.pct}%)</button>}
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
                <span className="text-gray-900">R$ {formatBRLBare(valorAcessorios)}</span>
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
            <div data-no-break className="flex justify-between items-center text-[17px] font-bold mt-4 px-5 py-3 border-2 border-gray-700 rounded-lg tracking-wide">
              <span className="text-gray-900 uppercase leading-tight">Valor total de equipamentos</span>
              <span className="text-gray-900 leading-tight tabular-nums">R$ {formatBRLBare(totalEquip)}</span>
            </div>
          )}

          {/* Motores */}
          {motoresAgrupados.length > 0 && (() => {
            const opcoesTensao: (220 | 380 | 660)[] = voltagem === 'monofasico' ? [220] : [220, 380, 660]
            const tensaoInteractive = !renderMode && !!onUpdateTensaoMotores
            const tensaoLabel = tensaoMotores ? `${tensaoMotores}V` : 'tensão a confirmar'
            return (
              <div data-no-break className="mt-3 border border-gray-300 rounded-md p-4 bg-white shadow-sm">
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
                            onClick={() => onUpdateTensaoMotores!(tensaoMotores === v ? null : v)}
                            className={`text-[15px] px-2 py-0.5 rounded font-bold transition-all ${
                              tensaoMotores === v
                                ? 'bg-blue-600 text-white'
                                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                            }`}
                            title={`Tensão ${v}V (clique no selecionado pra voltar a "a confirmar")`}
                          >
                            {v}V
                          </button>
                        ))}
                        {!tensaoMotores && (
                          <span className="text-[15px] text-gray-400 italic ml-1">tensão a confirmar</span>
                        )}
                      </span>
                    ) : (
                      <span className={`text-[15px] font-semibold ${tensaoMotores ? 'text-blue-700' : 'text-gray-400 italic'}`}>
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
                      return (
                        <tr key={`${m.cv}-${m.polos}-${idx}`} className="border-t border-gray-200">
                          <td className="py-1.5 text-gray-800">
                            <span className="text-gray-400 mr-1.5">•</span>
                            <span className="font-semibold">{m.cv} CV {m.polos} polos</span>
                            {m.item_nome && (
                              <span className="text-gray-500"> · <span className="italic">{m.item_nome}</span></span>
                            )}
                            {m.qtd > 1 && <span className="text-gray-500"> (×{m.qtd})</span>}
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
                        {totalMotores > 0 ? `R$ ${formatBRLBare(totalMotores)}` : ''}
                      </td>
                    </tr>
                  </tbody>
                </table>
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
                <div data-no-break className={`flex justify-between items-center mt-6 px-5 py-4 border-2 border-gray-900 rounded-lg tracking-wide ${temDesconto ? 'text-[17px] font-bold' : 'text-[19px] font-black'}`}>
                  <span className="text-gray-900 uppercase leading-tight">Valor total da proposta com motor novo</span>
                  <span className={`text-gray-900 leading-tight tabular-nums ${temDesconto ? 'text-[18px] text-gray-500 line-through decoration-1' : 'text-[20px]'}`}>
                    R$ {formatBRLBare(totalGeral)}
                  </span>
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
                  <div data-no-break className="flex justify-between items-center mt-2 px-5 py-4 border-2 border-emerald-700 rounded-lg tracking-wide text-[19px] font-black bg-emerald-50/50">
                    <span className="text-emerald-900 uppercase leading-tight">
                      Valor total com desconto
                    </span>
                    <span className="text-emerald-900 text-[20px] leading-tight tabular-nums">
                      R$ {formatBRLBare(totalFinal)}
                    </span>
                  </div>
                )}
              </>
            )
          })()}

          {/* Termos comerciais — campos editáveis em modo edit */}
          <div data-no-break className="mt-5 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded text-[14.5px] text-gray-800 space-y-1.5">
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
                      if (typeof p.pct === 'number') return Math.round((totalGeral * p.pct / 100) * 100) / 100
                      return 0
                    }
                    function dataLabel(p: ParcelaPagamento): string {
                      if (p.dataTipo === 'no_pedido') return 'NO PEDIDO'
                      if (p.dataTipo === 'na_nf') return 'NA EMISSÃO DA NOTA'
                      if (p.dataTipo === 'apos_nf') return `${p.dias || 30} DIAS APÓS A NOTA`
                      if (p.dataTipo === 'data_fixa') return p.dataFixa || 'DATA FIXA'
                      return ''
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
                          {temParcelas ? (
                            <table className="w-full text-[12px] border-collapse mt-0.5">
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
                                  <tr key={p.id} className="border-b border-gray-200">
                                    <td className="py-1 px-2">
                                      {!renderMode && onUpdateParcelas ? (
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
                                              type="text"
                                              value={p.dataFixa || ''}
                                              onChange={e => updateParcela(p.id, { dataFixa: e.target.value })}
                                              placeholder="DD/MM/AAAA"
                                              className="w-20 text-[12px] px-1 py-0.5 bg-white border border-gray-300 rounded"
                                            />
                                          )}
                                        </div>
                                      ) : (
                                        <span className="uppercase font-semibold">{dataLabel(p)}</span>
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
                                        <div className="flex items-center justify-end gap-0.5">
                                          <input
                                            type="number" min={0} max={100} step={0.01}
                                            value={p.pct ?? ''}
                                            onChange={e => updateParcela(p.id, { pct: e.target.value === '' ? undefined : parseFloat(e.target.value), valor: undefined })}
                                            placeholder="%"
                                            className="w-14 text-[12px] px-1 py-0.5 bg-white border border-gray-300 rounded text-right"
                                          />
                                          <span className="text-gray-500 text-[11px]">% =</span>
                                          <span className="font-bold tabular-nums text-gray-900 min-w-[60px] text-right">R$ {formatBRLBare(calcValor(p))}</span>
                                        </div>
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
                                <tr className="border-t-2 border-gray-700 font-bold bg-gray-50">
                                  <td className="py-1.5 px-2 uppercase text-[11px] tracking-wider" colSpan={2}>Total</td>
                                  <td className="py-1.5 px-2 text-right">
                                    <span className={`text-[11px] mr-2 ${Math.abs(totalPct - 100) < 0.5 ? 'text-emerald-700' : 'text-amber-700'}`}>
                                      {totalPct.toFixed(2)}%
                                    </span>
                                    <span className="tabular-nums">R$ {formatBRLBare(totalParcelas)}</span>
                                  </td>
                                  {!renderMode && <td className="print:hidden"></td>}
                                </tr>
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
              <div><span className="font-bold">Endereço:</span> Rodovia SC 370 km 139, Nº 1390</div>
              <div><span className="font-bold">Cidade:</span> Grão Pará – SC · <span className="font-bold">CEP:</span> 88890-000</div>
              <div><span className="font-bold">Telefone:</span> (48) 3658-4502 / (48) 3658-7453</div>
              <div><span className="font-bold">CNPJ:</span> 16.935.999/0001-09 · <span className="font-bold">I.E.:</span> 256.847.320</div>
              <div><span className="font-bold">E-mail:</span> contato@mbranorte.com.br</div>
            </div>
          </div>

          <div data-no-break className="grid grid-cols-4 gap-2 mt-3 text-[14px] text-center">
            {[
              ['Patrick Alves', '(48) 9 9698-4660'],
              ['Edilson', '(48) 9 9991-2329'],
              ['Daniel', '(48) 9 8469-2860'],
              ['Branorte', '(48) 3658-4502'],
            ].map(([nome, tel]) => (
              <div key={nome} className="py-1.5 px-1 bg-gray-50 border border-gray-200 rounded">
                <div className="font-bold text-gray-800 text-[14.5px]">{nome}</div>
                <div className="text-gray-600 mt-0.5">{tel}</div>
              </div>
            ))}
          </div>

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
              <p>
                As condições desta proposta consideram os impostos e taxas vigentes, quando da elaboração da mesma sendo que quaisquer alterações sobre os tributos Municipais, Estaduais e Federais serão repassados ou de responsabilidade do cliente, incluindo pagamento ou documento de exoneração fiscal da diferença do ICMS ao Estado de destino ou custos de caminhão parado em posto fiscal da fronteira.
              </p>
              <p>
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
              <p>
                Os equipamentos fornecidos pela metalúrgica BRANORTE estão garantidos pelo prazo de <strong>12 (doze) meses</strong> contados da data de entrega dos mesmos, quanto ao funcionamento, desde que sejam armazenados, montados e operados dentro das condições para as quais foram projetados. Durante o prazo de garantia serão substituídas as peças que apresentarem defeitos, ficando as despesas de frete das peças, deslocamento, estadia e alimentação dos técnicos montadores por conta do cliente. Expirado o prazo de garantia, forneceremos assistência técnica mediante solicitação. Ficam excluídos da garantia os seguintes itens: canalizações e dispositivos de interligação.
              </p>
              <p>
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
