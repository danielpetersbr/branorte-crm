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

  // Modo render: esconde botões interativos (pra capturar pra PDF limpo)
  renderMode?: boolean

  // Callbacks (apenas no modo edit)
  onAddAcessorios?: () => void
  onEditAcessorios?: () => void
  onRemoveAcessorios?: () => void
  onRemove?: (uid: string) => void
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

  // 1) Se idealY cai dentro de algum no-break, move pra antes (com margem de 8px)
  let y = idealY
  for (let iter = 0; iter < 5; iter++) {
    let moved = false
    for (const el of noBreakEls) {
      const { top, bottom } = localTop(el)
      // Se Y cai dentro do bloco (com margem)
      if (y > top + 2 && y < bottom + 2) {
        y = top - 8
        moved = true
        break
      }
    }
    if (!moved) break
  }

  // Se foi movido pra MUITO antes (perdemos > 30% da pagina), eh melhor empurrar pra DEPOIS do no-break
  // (a pagina anterior fica curta demais)
  if (idealY - y > tolerance * 3) {
    // Procura no-break que tava no caminho e usa seu bottom
    for (const el of noBreakEls) {
      const { top, bottom } = localTop(el)
      if (top <= idealY + 2 && bottom >= y - 2 && bottom < idealY + tolerance) {
        return bottom + 4
      }
    }
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
    numero, dataEmissao, cliente, terms, observacoesExtra,
    renderMode = false,
    onAddAcessorios, onEditAcessorios, onRemoveAcessorios, onRemove,
  } = props
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
      <div className="text-[10px] font-bold tracking-wider uppercase text-gray-700 pb-1.5 border-b-2 border-gray-800">
        {children}
      </div>
    </div>
  )

  // Page break visualization (so em modo edit, nao no PDF render)
  const containerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const [pageBreaks, setPageBreaks] = useState<number[]>([])
  const [pageHeight, setPageHeight] = useState<number>(0)

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
          gap.style.cssText = 'height:36px;background:#e5e7eb;margin:8px -24px;border-top:2px dashed #ef4444;border-bottom:2px dashed #ef4444;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:bold;color:#dc2626;letter-spacing:0.05em;'
          gap.textContent = `↑ FIM FOLHA ${i + 1} · INÍCIO FOLHA ${i + 2} ↓`
          bestEl.parentNode.insertBefore(gap, bestEl.nextSibling)
        }
      }
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
    <div ref={containerRef} className="text-[10px] text-gray-900 leading-relaxed font-sans bg-white">
      <div ref={innerRef} className="m-4 border border-gray-900 px-6 pt-5 pb-6 relative">
        {!renderMode && pageHeight > 0 && pageBreaks.length === 0 && carrinho.length > 0 && (
          <div className="absolute top-2 right-2 bg-green-600 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow z-10 pointer-events-none">
            ✓ 1 folha A4
          </div>
        )}
        {!renderMode && pageBreaks.length > 0 && (
          <div className="absolute top-2 right-2 bg-blue-600 text-white text-[9px] font-bold px-2 py-0.5 rounded shadow z-10 pointer-events-none">
            {pageBreaks.length + 1} folhas A4
          </div>
        )}
        {/* Logo */}
        <div className="text-center mb-5">
          <img
            src="/branorte-logo.png"
            alt="BRANORTE"
            className="inline-block h-12 w-auto"
            crossOrigin="anonymous"
          />
        </div>

        {/* ORÇAMENTO N° | DATA */}
        <div className="flex justify-between items-baseline text-[11px] font-bold text-gray-900 mb-1.5">
          <div>
            ORÇAMENTO N°{' '}
            <span className={numeroIsPlaceholder ? 'text-gray-400 font-semibold' : 'text-gray-700 font-semibold'}>
              {numeroExibido}
            </span>
          </div>
          <div>DATA: <span className="text-gray-700 font-semibold">{hoje}</span></div>
        </div>

        {/* CLIENTE | A/C | FONE */}
        <div className="grid grid-cols-3 gap-4 text-[11px] font-bold text-gray-900 mb-1">
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
        <div className="text-[11px] font-bold text-gray-900 space-y-0.5">
          {camposEmpilhados.map(([label, val]) => (
            <div key={label}>{label}: {valOrPlaceholder(val)}</div>
          ))}
        </div>

        {/* Conteúdo */}
        <div className="mt-5">
          <SectionHeader>Itens orçados abaixo</SectionHeader>

          <div className="space-y-3">
            {carrinho.map((it, idx) => {
              const letra = String.fromCharCode(65 + idx)
              const subtotal = it.valor * it.qtd
              return (
                <div key={it.uid || idx} data-no-break className="group relative border border-gray-300 rounded-md p-3 bg-white shadow-sm">
                  <div className="flex justify-between items-start gap-2 mb-1.5">
                    <div className="font-bold text-[10.5px] flex-1 min-w-0 text-gray-900">
                      <span className="text-gray-900">{letra} - {String(it.qtd).padStart(2, '0')}</span>
                      <span className="text-gray-400 mx-1">–</span>
                      <span className="uppercase">{it.nome}</span>
                    </div>
                    {!renderMode && onRemove && it.uid && (
                      <button
                        onClick={() => onRemove(it.uid!)}
                        className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-800 transition-opacity p-0.5 shrink-0"
                        title="Remover item"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 min-w-0 pl-3 text-[9.5px] text-gray-700 space-y-0.5">
                      {it.specs.length > 0
                        ? it.specs.map((s, i) => <div key={i} className="flex gap-1.5"><span className="text-gray-400">•</span><span>{s}</span></div>)
                        : it.motor_cv && (
                            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Acionamento: motor {it.motor_cv} CV {it.motor_polos} polos{it.motor_qtd > 1 && ` (qtd ${it.motor_qtd})`}</span></div>
                          )
                      }
                    </div>
                    {it.foto_url && (
                      <div className="shrink-0 w-28 flex flex-col items-center">
                        <div className="w-28 h-28 bg-white border border-gray-300 rounded p-1 flex items-center justify-center">
                          <img
                            src={it.foto_url}
                            alt={it.nome}
                            className="max-w-full max-h-full object-contain"
                            loading="lazy"
                            crossOrigin="anonymous"
                          />
                        </div>
                        <div className="text-[7px] text-gray-400 italic mt-1 tracking-wide">Imagem ilustrativa</div>
                      </div>
                    )}
                  </div>
                  <div className="mt-2.5 pt-1.5 border-t border-gray-300 flex justify-between text-[10.5px] font-bold tracking-wide">
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
                <div className="font-bold text-[10.5px] text-gray-900">
                  <span className="text-gray-900">— ACESSÓRIOS</span>
                </div>
                {!renderMode && (onEditAcessorios || onRemoveAcessorios) && (
                  <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    {onEditAcessorios && <button onClick={onEditAcessorios} className="text-[9px] text-blue-600 hover:underline">editar ({acessorios.pct}%)</button>}
                    {onRemoveAcessorios && <button onClick={onRemoveAcessorios} className="text-[9px] text-red-600 hover:underline">remover</button>}
                  </div>
                )}
              </div>
              <div className="pl-3 text-[9.5px] text-gray-700 space-y-0.5">
                {acessorios.items.length > 0
                  ? acessorios.items.map((s, i) => <div key={i} className="flex gap-1.5"><span className="text-gray-400">•</span><span>{s}</span></div>)
                  : <div className="text-gray-400 italic">(nenhum item listado{!renderMode ? ' — clique em "editar"' : ''})</div>
                }
              </div>
              <div className="mt-2.5 pt-1.5 border-t border-gray-300 flex justify-between text-[10.5px] font-bold tracking-wide">
                <span className="text-gray-700">VALOR</span>
                <span className="text-gray-900">R$ {formatBRLBare(valorAcessorios)}</span>
              </div>
            </div>
          ) : (
            !renderMode && onAddAcessorios && carrinho.length > 0 && (
              <button
                onClick={onAddAcessorios}
                className="w-full mt-4 py-2 text-[10px] font-semibold text-blue-700 hover:bg-blue-50 border border-dashed border-blue-300 rounded transition-colors"
              >
                + Adicionar Acessórios
              </button>
            )
          )}

          {/* VALOR TOTAL DE EQUIPAMENTOS */}
          {mostrarTotalEquip && (
            <div data-no-break className="flex justify-between text-[10.5px] font-bold mt-4 px-4 py-2 border-2 border-gray-700 rounded-lg tracking-wide">
              <span className="text-gray-900 uppercase">Valor total de equipamentos</span>
              <span className="text-gray-900">R$ {formatBRLBare(totalEquip)}</span>
            </div>
          )}

          {/* Motores */}
          {motoresAgrupados.length > 0 && (
            <div data-no-break className="mt-3 border border-gray-300 rounded-md p-3 bg-white shadow-sm">
              <div className="font-bold text-[10px] tracking-wider uppercase text-gray-700 pb-1.5 border-b-2 border-gray-800 mb-2">
                {motoresTitle.replace(':', '')}
              </div>
              <table className="w-full text-[9.5px] border-collapse">
                <thead>
                  <tr>
                    <th className="text-left font-bold py-1.5 text-gray-600 uppercase tracking-wider text-[9px]">Tipo</th>
                    <th className="text-right font-bold py-1.5 text-gray-600 uppercase tracking-wider text-[9px]">Novo</th>
                  </tr>
                </thead>
                <tbody>
                  {motoresAgrupados.map(m => (
                    <tr key={`${m.cv}-${m.polos}`} className="border-t border-gray-200">
                      <td className="py-1 text-gray-800">
                        <span className="text-gray-400 mr-1.5">•</span>
                        {m.cv} CV {m.polos} polos{m.qtd > 1 && ` (qtd ${m.qtd})`}
                      </td>
                      <td className="py-1 text-right text-gray-800">R$ {formatBRLBare(m.valor_total)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-700 font-bold">
                    <td className="py-1.5 text-gray-900">TOTAL</td>
                    <td className="py-1.5 text-right text-gray-900">R$ {formatBRLBare(totalMotores)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          {/* VALOR TOTAL DA PROPOSTA */}
          <div data-no-break className="flex justify-between items-center text-[12px] font-black mt-6 px-4 py-3 border-2 border-gray-900 rounded-lg tracking-wide">
            <span className="text-gray-900 uppercase">Valor total da proposta com motor novo</span>
            <span className="text-gray-900 text-[13px]">R$ {formatBRLBare(totalGeral)}</span>
          </div>

          {/* Termos comerciais */}
          <div className="mt-5 px-3 py-2.5 bg-gray-50 border border-gray-200 rounded text-[9.5px] text-gray-800 space-y-1">
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>
              Data da venda – {dataVendaIsPlaceholder
                ? <span className="text-gray-400 italic">a combinar</span>
                : <span>{dataVendaTxt}</span>}
            </span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Prazo de entrega – {prazoEntregaTxt}</span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>
              Forma de pagamento – {formaPgIsPlaceholder
                ? <span className="text-gray-400 italic">a combinar</span>
                : <span>{formaPagamentoTxt}</span>}
            </span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Frete – por conta do cliente</span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Validade da proposta – 10 dias após o envio</span></div>
          </div>

          <SectionHeader>Nossas Redes Sociais</SectionHeader>
          <div className="text-[9.5px] text-gray-800 space-y-0.5">
            <div><span className="font-bold">Instagram:</span> @branorte_metalurgica</div>
            <div><span className="font-bold">YouTube:</span> @mbranorte</div>
            <div><span className="font-bold">Facebook:</span> branorte.metalurgica</div>
          </div>

          <SectionHeader>Dados do Fabricante</SectionHeader>
          <div className="text-[9.5px] text-gray-800 space-y-0.5">
            <div><span className="font-bold">Empresa:</span> BRANORTE – Metalúrgica BBA Ltda</div>
            <div><span className="font-bold">Endereço:</span> Rodovia SC 370 km 139, Nº 1390</div>
            <div><span className="font-bold">Cidade:</span> Grão Pará – SC · <span className="font-bold">CEP:</span> 88890-000</div>
            <div><span className="font-bold">Telefone:</span> (48) 3658-4502 / (48) 3658-7453</div>
            <div><span className="font-bold">CNPJ:</span> 16.935.999/0001-09 · <span className="font-bold">I.E.:</span> 256.847.320</div>
            <div><span className="font-bold">E-mail:</span> contato@mbranorte.com.br</div>
          </div>

          <div className="grid grid-cols-4 gap-2 mt-3 text-[9px] text-center">
            {[
              ['Patrick Alves', '(48) 9 9698-4660'],
              ['Edilson', '(48) 9 9991-2329'],
              ['Daniel', '(48) 9 8469-2860'],
              ['Branorte', '(48) 3658-4502'],
            ].map(([nome, tel]) => (
              <div key={nome} className="py-1.5 px-1 bg-gray-50 border border-gray-200 rounded">
                <div className="font-bold text-gray-800 text-[9.5px]">{nome}</div>
                <div className="text-gray-600 mt-0.5">{tel}</div>
              </div>
            ))}
          </div>

          <SectionHeader>Conta para Depósito</SectionHeader>
          <div className="grid grid-cols-3 gap-3 text-[9px] text-gray-800">
            <div className="space-y-0.5">
              <div className="font-bold uppercase tracking-wide text-gray-900 mb-1 pb-0.5 border-b border-gray-300">Banco do Brasil</div>
              <div>Agência: <strong>0738-2</strong></div>
              <div>Conta: <strong>39551-X</strong></div>
              <div>Metalúrgica BBA</div>
              <div className="text-[8.5px] text-gray-500">CNPJ: 16.935.999/0001-09</div>
            </div>
            <div className="space-y-0.5">
              <div className="font-bold uppercase tracking-wide text-gray-900 mb-1 pb-0.5 border-b border-gray-300">Sicoob Credivale</div>
              <div>Cooperativa: <strong>3078</strong></div>
              <div>Banco: <strong>756</strong></div>
              <div>Conta: <strong>109909-4</strong></div>
              <div className="text-[8.5px] text-gray-500">CNPJ: 16.935.999/0001-09</div>
            </div>
            <div className="space-y-0.5">
              <div className="font-bold uppercase tracking-wide text-gray-900 mb-1 pb-0.5 border-b border-gray-300">PIX</div>
              <div className="text-[8.5px] text-gray-600">CNPJ:</div>
              <div className="font-mono"><strong>16935999000109</strong></div>
              <div className="text-[8.5px] text-gray-500 mt-1">SICOOB · Metalúrgica BBA</div>
            </div>
          </div>

          <SectionHeader>Caixa Postal</SectionHeader>
          <div className="text-[9.5px] text-gray-800 space-y-0.5">
            <div><span className="font-bold">Caixa Postal:</span> Nº 149 · <span className="font-bold">CEP:</span> 88750-970</div>
            <div><span className="font-bold">Cidade:</span> Braço do Norte – SC</div>
            <div>Metalúrgica BBA · CNPJ: 16.935.999/0001-09</div>
          </div>

          <SectionHeader>Observação <span className="text-gray-400 font-normal normal-case tracking-normal text-[9px]">— por conta do cliente</span></SectionHeader>
          <div className="text-[9.5px] text-gray-800 space-y-0.5 pl-2">
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Painel elétrico</span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Montagem dos equipamentos orçados acima (se necessário)</span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Muck (se necessário)</span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Despesa com obras civil (se necessário)</span></div>
            <div className="flex gap-1.5"><span className="text-gray-400">•</span><span>Instalação elétrica dos equipamentos (se necessário)</span></div>
          </div>

          {observacoesExtra && observacoesExtra.trim() && (
            <>
              <SectionHeader>Observações</SectionHeader>
              <div className="text-[9.5px] text-gray-800 leading-snug whitespace-pre-wrap">
                {observacoesExtra}
              </div>
            </>
          )}

          <SectionHeader>Tributos</SectionHeader>
          <div className="text-[9px] text-gray-700 leading-snug space-y-1.5 text-justify">
            <p>
              As condições desta proposta consideram os impostos e taxas vigentes, quando da elaboração da mesma sendo que quaisquer alterações sobre os tributos Municipais, Estaduais e Federais serão repassados ou de responsabilidade do cliente, incluindo pagamento ou documento de exoneração fiscal da diferença do ICMS ao Estado de destino ou custos de caminhão parado em posto fiscal da fronteira.
            </p>
            <p>
              Sendo o contratante não contribuinte de ICMS, este deverá obrigatoriamente depositar para a contratada até o dia do embarque o valor correspondente ao diferencial de alíquota de ICMS referente ao objeto deste contrato, para que a CONTRATADA possa então pagar este diferencial, cujo comprovante de pagamento será enviado com a nota fiscal de vendas das mercadorias.
            </p>
          </div>

          <SectionHeader>Cláusula de Cancelamento</SectionHeader>
          <div className="text-[9px] text-gray-700 leading-snug text-justify">
            Caso o comprador deseje cancelar o pedido, fica estabelecido que será cobrada uma taxa de cancelamento no valor de <strong>10% do preço total do produto</strong>. Essa taxa é destinada a cobrir eventuais perdas financeiras decorrentes do cancelamento, incluindo custos de produção, armazenamento e distribuição.
          </div>

          <SectionHeader>Garantia</SectionHeader>
          <div className="text-[9px] text-gray-700 leading-snug space-y-1.5 text-justify">
            <p>
              Os equipamentos fornecidos pela metalúrgica BRANORTE estão garantidos pelo prazo de <strong>12 (doze) meses</strong> contados da data de entrega dos mesmos, quanto ao funcionamento, desde que sejam armazenados, montados e operados dentro das condições para as quais foram projetados. Durante o prazo de garantia serão substituídas as peças que apresentarem defeitos, ficando as despesas de frete das peças, deslocamento, estadia e alimentação dos técnicos montadores por conta do cliente. Expirado o prazo de garantia, forneceremos assistência técnica mediante solicitação. Ficam excluídos da garantia os seguintes itens: canalizações e dispositivos de interligação.
            </p>
            <p>
              Componentes fabricados e/ou montados por terceiros, tais como: motores elétricos, redutores, chaves elétricas, quadro de comando elétrico, correias, rolamentos (tendo somente a garantia fornecida pelos respectivos fabricantes), bem como toda e qualquer obra civil que é de responsabilidade do cliente.
            </p>
          </div>

          {/* Assinaturas */}
          <div className="mt-10 grid grid-cols-2 gap-8 px-2">
            <div className="text-center">
              <div className="border-t border-gray-700 pt-1.5 text-[9.5px] font-bold text-gray-800">
                Metalúrgica BBA LTDA
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-gray-700 pt-1.5 text-[9.5px] font-bold text-gray-800">
                {cli.nome
                  ? <span>{cli.nome}</span>
                  : <span className="text-gray-400 italic">[Cliente]</span>}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="mt-6 pt-2 border-t border-gray-200 flex justify-between text-[7.5px] text-gray-400">
            <span>Orçamento · Branorte BBA</span>
            <span>Página 1</span>
          </div>
        </div>
      </div>
    </div>
  )
}
