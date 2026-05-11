import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  Sparkles, Search, Plus, Minus, Trash2, Package,
  Zap, X, AlertCircle, Star, FileText, Eye, ListChecks, Check,
} from 'lucide-react'
import {
  useCatalogoItems, useCatalogoMotores,
  agruparPorCategoria, acharMotorCompativel,
  type CatalogoItem, type CatalogoMotor,
} from '@/hooks/useCatalogo'
import { FinalizarMontarModal, type CarrinhoSnapshot } from '@/components/FinalizarMontarModal'

type Voltagem = 'monofasico' | 'trifasico'
type ModoVisao = 'preview' | 'edicao'

interface CarrinhoItem {
  uid: string
  catalogo_id: number
  categoria: string
  nome: string
  specs: string[]
  qtd: number
  valor: number
  valor_original: number
  motor_cv: number | null
  motor_polos: number | null
  motor_qtd: number
  motor_valor_unit: number  // valor unitário do motor (não multiplicado)
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function formatBRLBare(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function gerarUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Agrupa motores iguais (mesmo CV/polos)
interface MotorAgrupado {
  cv: number
  polos: number
  qtd: number
  valor_unit: number
  valor_total: number
}

function agruparMotores(carrinho: CarrinhoItem[]): MotorAgrupado[] {
  const m = new Map<string, MotorAgrupado>()
  for (const it of carrinho) {
    if (!it.motor_cv || !it.motor_polos) continue
    const qtdMotor = it.motor_qtd * it.qtd
    const key = `${it.motor_cv}-${it.motor_polos}`
    const e = m.get(key)
    if (e) {
      e.qtd += qtdMotor
      e.valor_total += it.motor_valor_unit * qtdMotor
    } else {
      m.set(key, {
        cv: it.motor_cv,
        polos: it.motor_polos,
        qtd: qtdMotor,
        valor_unit: it.motor_valor_unit,
        valor_total: it.motor_valor_unit * qtdMotor,
      })
    }
  }
  return [...m.values()].sort((a, b) => b.cv - a.cv)
}

export function OrcamentoMontar() {
  const { data: items, isLoading: loadingItems } = useCatalogoItems()
  const { data: motores, isLoading: loadingMotores } = useCatalogoMotores()

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [voltagem, setVoltagem] = useState<Voltagem>('trifasico')
  const [carrinho, setCarrinho] = useState<CarrinhoItem[]>([])
  const [showOnlyPopular, setShowOnlyPopular] = useState(false)
  const [showOnlyOficiais, setShowOnlyOficiais] = useState(true)  // default: só items curados
  const [modoVisao, setModoVisao] = useState<ModoVisao>('preview')
  const [finalizarOpen, setFinalizarOpen] = useState(false)
  const [sucesso, setSucesso] = useState<{ numero: string; baixouDocx: boolean; baixouPdf: boolean; salvouNaPasta: boolean } | null>(null)

  const categorias = useMemo(() => agruparPorCategoria(items ?? []), [items])

  const itemsFiltrados = useMemo(() => {
    if (!items) return []
    const buscaLower = busca.trim().toLowerCase()
    return items.filter(it => {
      if (showOnlyOficiais && !it.is_oficial) return false
      if (categoria && it.categoria !== categoria) return false
      if (showOnlyPopular && it.ocorrencias < 5) return false
      if (buscaLower) {
        const haystack = `${it.nome_curto} ${it.nome_completo} ${it.categoria}`.toLowerCase()
        if (!haystack.includes(buscaLower)) return false
      }
      return true
    })
  }, [items, categoria, busca, showOnlyPopular, showOnlyOficiais])

  const totalOficiais = useMemo(() => (items ?? []).filter(i => i.is_oficial).length, [items])

  const motoresAgrupados = useMemo(() => agruparMotores(carrinho), [carrinho])

  const totalItems = useMemo(
    () => carrinho.reduce((s, c) => s + (c.valor * c.qtd), 0),
    [carrinho],
  )
  const totalMotores = useMemo(
    () => motoresAgrupados.reduce((s, m) => s + m.valor_total, 0),
    [motoresAgrupados],
  )
  const totalGeral = totalItems + totalMotores

  function adicionarItem(item: CatalogoItem) {
    const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos && motores
      ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagem)
      : null

    setCarrinho(c => [...c, {
      uid: gerarUid(),
      catalogo_id: item.id,
      categoria: item.categoria,
      nome: item.nome_curto,
      specs: item.specs || [],
      qtd: 1,
      valor: Number(item.valor),
      valor_original: Number(item.valor),
      motor_cv: item.motor_padrao_cv ? Number(item.motor_padrao_cv) : null,
      motor_polos: item.motor_padrao_polos,
      motor_qtd: item.motor_padrao_qtd || 1,
      motor_valor_unit: motorMatch ? Number(motorMatch.valor) : 0,
    }])
  }

  function removerItem(uid: string) {
    setCarrinho(c => c.filter(it => it.uid !== uid))
  }

  function alterarQtd(uid: string, novaQtd: number) {
    if (novaQtd < 1) return
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, qtd: novaQtd } : it))
  }

  function alterarValor(uid: string, novoValor: number) {
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, valor: novoValor } : it))
  }

  function limparCarrinho() {
    if (carrinho.length === 0) return
    if (confirm('Limpar carrinho?')) setCarrinho([])
  }

  function aplicarVoltagem(novaVoltagem: Voltagem) {
    setVoltagem(novaVoltagem)
    if (!motores) return
    setCarrinho(c => c.map(it => {
      if (!it.motor_cv || !it.motor_polos) return it
      const motor = acharMotorCompativel(motores, it.motor_cv, it.motor_polos, novaVoltagem)
      return { ...it, motor_valor_unit: motor ? Number(motor.valor) : it.motor_valor_unit }
    }))
  }

  if (loadingItems || loadingMotores) return <PageLoading />

  return (
    <div className="h-full flex flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[18px] font-bold text-ink flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            Montar Orçamento Personalizado
          </h1>
          <p className="text-[11px] text-ink-faint mt-0.5">
            Adicione items à esquerda. Veja o orçamento se montando à direita.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Voltagem:</span>
          <button
            onClick={() => aplicarVoltagem('monofasico')}
            className={`text-[11px] px-3 py-1.5 rounded font-semibold transition-all ${
              voltagem === 'monofasico'
                ? 'bg-warning text-white'
                : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
            }`}
          >
            Monofásico
          </button>
          <button
            onClick={() => aplicarVoltagem('trifasico')}
            className={`text-[11px] px-3 py-1.5 rounded font-semibold transition-all ${
              voltagem === 'trifasico'
                ? 'bg-info text-white'
                : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
            }`}
          >
            Trifásico
          </button>
        </div>
      </div>

      {/* Grid 2 colunas: catálogo + preview */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_460px] gap-3 min-h-0">
        {/* CATÁLOGO */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
              <Input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar item (ex: triturador, caçamba, transportador)..."
                className="pl-7 text-[12px]"
              />
              {busca && (
                <button
                  onClick={() => setBusca('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setShowOnlyOficiais(p => !p)}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  showOnlyOficiais
                    ? 'bg-success text-white'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
                title={showOnlyOficiais ? `Mostrando só items curados (${totalOficiais}). Click pra ver todos.` : 'Mostrando todos. Click pra filtrar só items curados.'}
              >
                <Check className="h-3 w-3" />
                Só oficiais ({totalOficiais})
              </button>
              <button
                onClick={() => setShowOnlyPopular(p => !p)}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  showOnlyPopular
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
              >
                <Star className="h-3 w-3" />
                Só populares
              </button>
              <button
                onClick={() => setCategoria(null)}
                className={`text-[10px] px-2 py-1 rounded font-semibold transition-all ${
                  !categoria
                    ? 'bg-ink text-bg'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
              >
                Todas ({items?.length ?? 0})
              </button>
              {categorias.map(c => (
                <button
                  key={c.categoria}
                  onClick={() => setCategoria(c.categoria === categoria ? null : c.categoria)}
                  className={`text-[10px] px-2 py-1 rounded font-semibold transition-all ${
                    categoria === c.categoria
                      ? 'bg-ink text-bg'
                      : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                  }`}
                >
                  {c.categoria} ({c.qtd})
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {itemsFiltrados.length === 0 ? (
              <div className="text-center py-12 text-ink-faint">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-[12px]">Nenhum item encontrado</p>
                {busca && (
                  <button
                    onClick={() => { setBusca(''); setCategoria(null); setShowOnlyPopular(false) }}
                    className="text-[11px] text-accent mt-2 hover:underline"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {itemsFiltrados.slice(0, 200).map(item => (
                  <CardItem
                    key={item.id}
                    item={item}
                    voltagem={voltagem}
                    motores={motores ?? []}
                    onAdd={() => adicionarItem(item)}
                  />
                ))}
                {itemsFiltrados.length > 200 && (
                  <div className="col-span-full text-center py-3 text-[11px] text-ink-faint italic">
                    Mostrando 200 de {itemsFiltrados.length}. Use a busca pra filtrar mais.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* PREVIEW DO ORÇAMENTO */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          {/* Toolbar do preview */}
          <div className="p-2 border-b border-border flex items-center justify-between bg-surface-2/30">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setModoVisao('preview')}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  modoVisao === 'preview'
                    ? 'bg-accent text-white'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
              >
                <Eye className="h-3 w-3" />
                Preview
              </button>
              <button
                onClick={() => setModoVisao('edicao')}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  modoVisao === 'edicao'
                    ? 'bg-accent text-white'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
              >
                <ListChecks className="h-3 w-3" />
                Edição
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-ink-faint">
                {carrinho.length} {carrinho.length === 1 ? 'item' : 'items'}
              </span>
              {carrinho.length > 0 && (
                <button
                  onClick={limparCarrinho}
                  className="text-[10px] text-danger hover:text-danger/70 flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" />
                  Limpar
                </button>
              )}
            </div>
          </div>

          {/* Conteúdo do preview / edição */}
          <div className="flex-1 overflow-y-auto bg-white">
            {carrinho.length === 0 ? (
              <div className="text-center py-16 text-ink-faint">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-[12px] font-semibold">Orçamento em branco</p>
                <p className="text-[10px] mt-1">Adicione items à esquerda pra começar</p>
              </div>
            ) : modoVisao === 'preview' ? (
              <OrcamentoPreview
                carrinho={carrinho}
                motoresAgrupados={motoresAgrupados}
                voltagem={voltagem}
                totalItems={totalItems}
                totalMotores={totalMotores}
                totalGeral={totalGeral}
                onRemove={removerItem}
              />
            ) : (
              <div className="divide-y divide-border">
                {carrinho.map(it => (
                  <CarrinhoLinhaEdicao
                    key={it.uid}
                    item={it}
                    onRemove={() => removerItem(it.uid)}
                    onQtd={n => alterarQtd(it.uid, n)}
                    onValor={v => alterarValor(it.uid, v)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer com total + ação */}
          {carrinho.length > 0 && (
            <div className="border-t border-border p-3 space-y-1.5 bg-surface-2/50">
              <div className="flex justify-between text-[11px] text-ink-muted">
                <span>Equipamentos</span>
                <span className="font-semibold">{formatBRL(totalItems)}</span>
              </div>
              {totalMotores > 0 && (
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>Motores ({motoresAgrupados.length})</span>
                  <span className="font-semibold">{formatBRL(totalMotores)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-bold text-ink pt-1 border-t border-border">
                <span>TOTAL DA PROPOSTA</span>
                <span className="text-accent">{formatBRL(totalGeral)}</span>
              </div>
              <button
                disabled={carrinho.length === 0}
                onClick={() => setFinalizarOpen(true)}
                className="w-full mt-2 bg-accent hover:bg-accent-700 text-white text-[12px] font-semibold py-2 rounded disabled:opacity-50"
              >
                Continuar para gerar .docx + PDF →
              </button>
            </div>
          )}
        </Card>
      </div>

      {/* Modal de finalização */}
      <FinalizarMontarModal
        open={finalizarOpen}
        snapshot={{
          voltagem,
          itens: carrinho.map(c => ({
            nome: c.nome,
            qtd: c.qtd,
            valor: c.valor,
            specs: c.specs,
            motor_cv: c.motor_cv,
            motor_polos: c.motor_polos,
            motor_qtd: c.motor_qtd,
            motor_valor_unit: c.motor_valor_unit,
          })),
          motoresAgrupados,
          totalItems,
          totalMotores,
          totalGeral,
        } as CarrinhoSnapshot}
        onClose={() => setFinalizarOpen(false)}
        onSuccess={info => {
          setSucesso(info)
          setFinalizarOpen(false)
          setCarrinho([])
        }}
      />

      {/* Feedback de sucesso */}
      {sucesso && (
        <div className="fixed bottom-4 right-4 z-50 bg-success-bg/20 border border-success/50 rounded-lg p-4 shadow-lg max-w-md">
          <div className="flex items-start gap-2">
            <div className="text-[13px] font-bold text-success">✓ Orçamento {sucesso.numero} gerado</div>
            <button onClick={() => setSucesso(null)} className="ml-auto text-ink-faint hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="text-[11px] text-ink-muted mt-1">
            {sucesso.salvouNaPasta && '📁 Salvo na pasta Z:'}
            {sucesso.baixouDocx && '⬇️ .docx baixado'}
            {sucesso.baixouPdf && ' · PDF baixado'}
          </div>
        </div>
      )}
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Preview estilo orçamento real (papel A4 simulado)
// ──────────────────────────────────────────────────────────────────────────

function OrcamentoPreview({
  carrinho, motoresAgrupados, voltagem,
  totalItems, totalMotores, totalGeral, onRemove,
}: {
  carrinho: CarrinhoItem[]
  motoresAgrupados: MotorAgrupado[]
  voltagem: Voltagem
  totalItems: number
  totalMotores: number
  totalGeral: number
  onRemove: (uid: string) => void
}) {
  const motoresTitle = voltagem === 'monofasico' ? 'Motores Monofásicos:' : 'Motores Trifásicos:'
  const mostrarTotalEquip = carrinho.length > 1  // template real só mostra subtotal com 2+ itens
  const hoje = new Date().toLocaleDateString('pt-BR')

  // Cliente: 2 colunas (igual orçamento real)
  // ESQUERDA: CLIENTE, CIDADE, BAIRRO, ENDEREÇO, CEP, CPF/CNPJ, I.E., E-MAIL
  // DIREITA:  A/C, FONE
  const camposEsquerda: Array<[string, string, boolean]> = [
    ['CLIENTE', '[preencher]', true],
    ['CIDADE', '—', false],
    ['BAIRRO', '—', false],
    ['ENDEREÇO', '—', false],
    ['CEP', '—', false],
    ['CPF/CNPJ', '—', false],
    ['I.E.', '—', false],
    ['E-MAIL', '—', false],
  ]
  const camposDireita: Array<[string, string]> = [
    ['A/C', '—'],
    ['FONE', '—'],
  ]

  return (
    <div className="p-6 text-[10px] text-gray-900 leading-relaxed font-sans bg-white">
      {/* Logo BRANORTE (banner igual o orçamento real) */}
      <div className="text-center mb-4">
        <div className="inline-block text-[28px] font-black tracking-tight leading-none">
          <span className="text-emerald-600">BRA</span><span className="text-black">NORTE</span>
        </div>
      </div>

      {/* Cabeçalho: ORÇAMENTO N° (esquerda) | DATA (direita) */}
      <div className="flex justify-between items-baseline text-[10.5px] font-bold mb-2 pt-1 border-t border-gray-300">
        <div>ORÇAMENTO N°: <span className="text-gray-400">[a definir]</span></div>
        <div>DATA: <span className="text-gray-400">{hoje}</span></div>
      </div>

      {/* Cliente — 2 colunas (igual PDF real) */}
      <div className="flex gap-4 mb-3 text-[10px]">
        <div className="flex-1 space-y-0.5">
          {camposEsquerda.map(([label, val, placeholder]) => (
            <div key={label} className="flex">
              <span className="font-bold w-20 shrink-0">{label}:</span>
              <span className={placeholder ? 'text-gray-400 italic' : 'text-gray-400'}>{val}</span>
            </div>
          ))}
        </div>
        <div className="w-44 space-y-0.5">
          {camposDireita.map(([label, val]) => (
            <div key={label} className="flex">
              <span className="font-bold w-12 shrink-0">{label}:</span>
              <span className="text-gray-400">{val}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ITENS ORÇADOS ABAIXO: */}
      <div className="font-bold text-[10px] mb-2 mt-3">
        ITENS ORÇADOS ABAIXO:
      </div>

      <div className="space-y-3 mb-2">
        {carrinho.map((it, idx) => {
          const letra = String.fromCharCode(65 + idx)
          const subtotal = it.valor * it.qtd
          return (
            <div key={it.uid} className="group relative">
              <div className="flex justify-between items-start gap-2">
                <div className="font-bold text-[10px] flex-1 min-w-0">
                  {letra} - {String(it.qtd).padStart(2, '0')} – <span className="uppercase">{it.nome}</span>
                </div>
                <button
                  onClick={() => onRemove(it.uid)}
                  className="opacity-0 group-hover:opacity-100 text-red-600 hover:text-red-800 transition-opacity p-0.5 shrink-0"
                  title="Remover item"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              {/* Specs (sem dot leaders — orçamento real renderiza como texto comum) */}
              <div className="pl-3 text-[9.5px] text-gray-700 mt-0.5 space-y-0">
                {it.specs.length > 0
                  ? it.specs.map((s, i) => <div key={i}>- {s}</div>)
                  : it.motor_cv && (
                      <div>- Acionamento: motor {it.motor_cv} CV {it.motor_polos} polos{it.motor_qtd > 1 && ` (qtd ${it.motor_qtd})`}</div>
                    )
                }
              </div>
              {/* VALOR com linha fina acima e abaixo (igual PDF) */}
              <div className="mt-2 pt-1 border-t border-gray-300 flex justify-between text-[10px] font-bold">
                <span>VALOR</span>
                <span>R$ {formatBRLBare(subtotal)}</span>
              </div>
            </div>
          )
        })}
      </div>

      {/* VALOR TOTAL DE EQUIPAMENTOS — só com 2+ itens */}
      {mostrarTotalEquip && (
        <div className="flex justify-between text-[10px] font-bold border-y border-gray-400 py-1 mb-3">
          <span>VALOR TOTAL DE EQUIPAMENTOS</span>
          <span>R$ {formatBRLBare(totalItems)}</span>
        </div>
      )}

      {/* Motores (tabela TIPO | NOVO igual .docx) */}
      {motoresAgrupados.length > 0 && (
        <div className="mt-3">
          <div className="font-bold text-[10px] mb-1">{motoresTitle}</div>
          <table className="w-full text-[9.5px] border-collapse">
            <thead>
              <tr className="border-y border-gray-400">
                <th className="text-left font-bold py-1">TIPO</th>
                <th className="text-right font-bold py-1">NOVO</th>
              </tr>
            </thead>
            <tbody>
              {motoresAgrupados.map(m => (
                <tr key={`${m.cv}-${m.polos}`} className="border-b border-gray-200">
                  <td className="py-0.5">
                    - {m.cv} CV {m.polos} polos{m.qtd > 1 && ` (qtd ${m.qtd})`}
                  </td>
                  <td className="py-0.5 text-right">R$ {formatBRLBare(m.valor_total)}</td>
                </tr>
              ))}
              <tr className="border-t border-gray-400 font-bold">
                <td className="py-1">TOTAL</td>
                <td className="py-1 text-right">R$ {formatBRLBare(totalMotores)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {/* VALOR TOTAL DA PROPOSTA — barra com fundo bem clarinho (azul-acinzentado igual PDF) */}
      <div className="flex justify-between text-[11px] font-bold mt-4 px-2 py-2 border-y-2 border-gray-700 bg-slate-50">
        <span>VALOR TOTAL DA PROPOSTA COM MOTOR NOVO</span>
        <span>R$ {formatBRLBare(totalGeral)}</span>
      </div>

      {/* Termos (igual .docx, ordem e formato exatos) */}
      <div className="mt-3 text-[9.5px] text-gray-800 space-y-0">
        <div>- Data da venda – <span className="text-gray-400 italic">a combinar</span></div>
        <div>- Prazo de entrega – 90 dias (úteis)</div>
        <div>- Forma de pagamento – <span className="text-gray-400 italic">a combinar</span></div>
        <div>- Frete - por conta do cliente</div>
        <div>- Validade da proposta - 10 dias após o envio.</div>
      </div>

      <div className="mt-4 pt-2 border-t border-gray-300 text-[8px] text-gray-500 italic leading-snug">
        Próximas páginas do .docx/.pdf final: Redes Sociais · Dados do Fabricante · Vendedores · Conta para Depósito · Observações · Tributos · Cláusula de Cancelamento · Garantia · Assinaturas.
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Card de item do catálogo (esquerda)
// ──────────────────────────────────────────────────────────────────────────

function CardItem({
  item, voltagem, motores, onAdd,
}: {
  item: CatalogoItem
  voltagem: Voltagem
  motores: CatalogoMotor[]
  onAdd: () => void
}) {
  const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos
    ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagem)
    : null
  const motorValor = motorMatch ? Number(motorMatch.valor) * (item.motor_padrao_qtd || 1) : 0
  const totalComMotor = Number(item.valor) + motorValor

  const isPopular = item.ocorrencias >= 20

  return (
    <button
      onClick={onAdd}
      className="text-left p-2.5 rounded-md border border-border hover:border-accent/40 hover:bg-surface-2 transition-all group"
    >
      <div className="flex items-start gap-2">
        {item.foto_url && (
          <img
            src={item.foto_url}
            alt={item.nome_curto}
            className="w-12 h-12 object-cover rounded border border-border shrink-0"
            loading="lazy"
          />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
            <span className="text-[9px] uppercase tracking-wider text-ink-muted font-bold">
              {item.categoria}
            </span>
            {item.is_oficial && (
              <span className="text-[8px] bg-success/20 text-success px-1 py-0.5 rounded font-bold flex items-center gap-0.5">
                <Check className="h-2 w-2" />
                oficial
              </span>
            )}
            {isPopular && (
              <span className="text-[8px] bg-accent/15 text-accent px-1 py-0.5 rounded font-bold flex items-center gap-0.5">
                <Star className="h-2 w-2" />
                {item.ocorrencias}x
              </span>
            )}
          </div>
          <div className="text-[12px] font-semibold text-ink truncate">
            {item.nome_curto}
          </div>
          {item.motor_padrao_cv && (
            <div className="text-[10px] text-ink-faint mt-0.5 flex items-center gap-1">
              <Zap className="h-2.5 w-2.5" />
              Motor {item.motor_padrao_cv} CV {item.motor_padrao_polos}p
              {(item.motor_padrao_qtd || 1) > 1 && ` (x${item.motor_padrao_qtd})`}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-[12px] font-bold text-ink">
            {formatBRL(Number(item.valor))}
          </div>
          {motorValor > 0 && (
            <div className="text-[9px] text-ink-faint">
              + motor {formatBRL(motorValor)}
            </div>
          )}
          {motorValor > 0 && (
            <div className="text-[10px] font-semibold text-accent">
              = {formatBRL(totalComMotor)}
            </div>
          )}
        </div>
      </div>
      <div className="mt-2 flex items-center justify-end opacity-0 group-hover:opacity-100 transition-opacity">
        <span className="text-[10px] text-accent font-semibold flex items-center gap-1">
          <Plus className="h-3 w-3" />
          Adicionar
        </span>
      </div>
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Linha do carrinho em modo EDIÇÃO (controles compactos)
// ──────────────────────────────────────────────────────────────────────────

function CarrinhoLinhaEdicao({
  item, onRemove, onQtd, onValor,
}: {
  item: CarrinhoItem
  onRemove: () => void
  onQtd: (n: number) => void
  onValor: (v: number) => void
}) {
  const [editingValor, setEditingValor] = useState(false)
  const subtotal = item.valor * item.qtd
  const motorTotal = item.motor_valor_unit * item.motor_qtd * item.qtd
  const totalLinha = subtotal + motorTotal

  return (
    <div className="p-2.5 hover:bg-surface-2/40">
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-ink-faint font-bold">
            {item.categoria}
          </div>
          <div className="text-[11px] font-semibold text-ink leading-tight">
            {item.nome}
          </div>
          {item.motor_cv && (
            <div className="text-[9px] text-ink-faint flex items-center gap-1 mt-0.5">
              <Zap className="h-2 w-2" />
              Motor {item.motor_cv}CV {item.motor_polos}p
              {item.motor_qtd > 1 && ` x${item.motor_qtd}`}
              {item.motor_valor_unit > 0 && ` — ${formatBRL(motorTotal)}`}
              {item.motor_valor_unit === 0 && (
                <span className="text-warning ml-1 flex items-center gap-0.5">
                  <AlertCircle className="h-2.5 w-2.5" />
                  sem motor cadastrado
                </span>
              )}
            </div>
          )}
        </div>
        <button onClick={onRemove} className="text-ink-faint hover:text-danger shrink-0">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex items-center bg-surface-2 rounded">
          <button
            onClick={() => onQtd(item.qtd - 1)}
            disabled={item.qtd <= 1}
            className="px-1.5 py-0.5 text-ink-muted hover:text-ink disabled:opacity-30"
          >
            <Minus className="h-3 w-3" />
          </button>
          <span className="text-[11px] font-semibold w-6 text-center">{item.qtd}</span>
          <button
            onClick={() => onQtd(item.qtd + 1)}
            className="px-1.5 py-0.5 text-ink-muted hover:text-ink"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>

        <div className="flex-1 text-right">
          {editingValor ? (
            <input
              type="number"
              value={item.valor}
              onChange={e => onValor(Number(e.target.value) || 0)}
              onBlur={() => setEditingValor(false)}
              onKeyDown={e => { if (e.key === 'Enter') setEditingValor(false) }}
              autoFocus
              className="w-24 text-[11px] text-right bg-surface-2 border border-accent rounded px-1 py-0.5"
            />
          ) : (
            <button
              onClick={() => setEditingValor(true)}
              className="text-[11px] text-ink-muted hover:text-ink"
              title="Clique pra editar"
            >
              {formatBRL(item.valor)}
              {item.valor !== item.valor_original && (
                <span className="text-[9px] text-warning ml-1">(editado)</span>
              )}
            </button>
          )}
          <div className="text-[11px] font-bold text-ink">
            {formatBRL(totalLinha)}
          </div>
        </div>
      </div>
    </div>
  )
}
