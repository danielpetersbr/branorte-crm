import { useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  Sparkles, Search, Plus, Minus, Trash2, ShoppingCart, Package,
  Zap, Filter, X, AlertCircle, Star,
} from 'lucide-react'
import {
  useCatalogoItems, useCatalogoMotores, useCatalogoAcessorios,
  agruparPorCategoria, acharMotorCompativel,
  type CatalogoItem, type CatalogoMotor,
} from '@/hooks/useCatalogo'

type Voltagem = 'monofasico' | 'trifasico'

interface CarrinhoItem {
  uid: string             // unique id (item.id + timestamp pra permitir duplicatas)
  catalogo_id: number
  categoria: string
  nome: string
  specs: string[]
  qtd: number
  valor: number           // valor unitario (pode ter sido editado)
  valor_original: number  // valor do catalogo (pra mostrar se mudou)
  motor_cv: number | null
  motor_polos: number | null
  motor_qtd: number
  motor_valor: number     // valor do motor (somado * qtd)
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function gerarUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

export function OrcamentoMontar() {
  const { data: items, isLoading: loadingItems } = useCatalogoItems()
  const { data: motores, isLoading: loadingMotores } = useCatalogoMotores()
  const { data: acessorios } = useCatalogoAcessorios()

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [voltagem, setVoltagem] = useState<Voltagem>('trifasico')
  const [carrinho, setCarrinho] = useState<CarrinhoItem[]>([])
  const [showOnlyPopular, setShowOnlyPopular] = useState(false)

  const categorias = useMemo(() => agruparPorCategoria(items ?? []), [items])

  const itemsFiltrados = useMemo(() => {
    if (!items) return []
    const buscaLower = busca.trim().toLowerCase()
    return items.filter(it => {
      if (categoria && it.categoria !== categoria) return false
      if (showOnlyPopular && it.ocorrencias < 5) return false
      if (buscaLower) {
        const haystack = `${it.nome_curto} ${it.nome_completo} ${it.categoria}`.toLowerCase()
        if (!haystack.includes(buscaLower)) return false
      }
      return true
    })
  }, [items, categoria, busca, showOnlyPopular])

  const totalItems = useMemo(
    () => carrinho.reduce((s, c) => s + (c.valor * c.qtd), 0),
    [carrinho],
  )
  const totalMotores = useMemo(
    () => carrinho.reduce((s, c) => s + c.motor_valor, 0),
    [carrinho],
  )
  const totalGeral = totalItems + totalMotores

  function adicionarItem(item: CatalogoItem) {
    const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos && motores
      ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagem)
      : null

    const motor_valor = motorMatch ? Number(motorMatch.valor) * (item.motor_padrao_qtd || 1) : 0

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
      motor_valor,
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

  // Re-calcula motores quando voltagem muda
  function aplicarVoltagem(novaVoltagem: Voltagem) {
    setVoltagem(novaVoltagem)
    if (!motores) return
    setCarrinho(c => c.map(it => {
      if (!it.motor_cv || !it.motor_polos) return it
      const motor = acharMotorCompativel(motores, it.motor_cv, it.motor_polos, novaVoltagem)
      return { ...it, motor_valor: motor ? Number(motor.valor) * it.motor_qtd : it.motor_valor }
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
            Selecione items do catálogo. Motor e preço são adicionados automaticamente.
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

      {/* Grid 2 colunas: catálogo + carrinho */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_400px] gap-3 min-h-0">
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
                  <CardItem key={item.id} item={item} voltagem={voltagem} motores={motores ?? []} onAdd={() => adicionarItem(item)} />
                ))}
                {itemsFiltrados.length > 200 && (
                  <div className="col-span-full text-center py-3 text-[11px] text-ink-faint italic">
                    Mostrando 200 de {itemsFiltrados.length} items. Use a busca pra filtrar mais.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* CARRINHO */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 border-b border-border flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShoppingCart className="h-4 w-4 text-accent" />
              <h2 className="text-[13px] font-bold text-ink">Carrinho</h2>
              <span className="text-[10px] text-ink-faint">({carrinho.length} {carrinho.length === 1 ? 'item' : 'items'})</span>
            </div>
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

          <div className="flex-1 overflow-y-auto">
            {carrinho.length === 0 ? (
              <div className="text-center py-12 text-ink-faint">
                <ShoppingCart className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-[12px]">Carrinho vazio</p>
                <p className="text-[10px] mt-1">Clique nos items à esquerda</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {carrinho.map(it => (
                  <CarrinhoLinha
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

          {carrinho.length > 0 && (
            <div className="border-t border-border p-3 space-y-1.5 bg-surface-2/50">
              <div className="flex justify-between text-[11px] text-ink-muted">
                <span>Equipamentos</span>
                <span className="font-semibold">{formatBRL(totalItems)}</span>
              </div>
              {totalMotores > 0 && (
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>Motores</span>
                  <span className="font-semibold">{formatBRL(totalMotores)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-bold text-ink pt-1 border-t border-border">
                <span>TOTAL</span>
                <span className="text-accent">{formatBRL(totalGeral)}</span>
              </div>

              <button
                disabled={carrinho.length === 0}
                onClick={() => alert('Geração de .docx personalizado vem na próxima fase 🚧')}
                className="w-full mt-2 bg-accent hover:bg-accent-700 text-white text-[12px] font-semibold py-2 rounded disabled:opacity-50 flex items-center justify-center gap-1.5"
              >
                Continuar para gerar orçamento →
              </button>
              <p className="text-[9px] text-ink-faint text-center italic">
                Cliente + dados extras na próxima tela
              </p>
            </div>
          )}
        </Card>
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
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-0.5">
            <span className="text-[9px] uppercase tracking-wider text-ink-muted font-bold">
              {item.categoria}
            </span>
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
// Linha do carrinho (direita)
// ──────────────────────────────────────────────────────────────────────────

function CarrinhoLinha({
  item, onRemove, onQtd, onValor,
}: {
  item: CarrinhoItem
  onRemove: () => void
  onQtd: (n: number) => void
  onValor: (v: number) => void
}) {
  const [editingValor, setEditingValor] = useState(false)
  const subtotal = item.valor * item.qtd
  const totalLinha = subtotal + item.motor_valor

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
              {item.motor_valor > 0 && ` — ${formatBRL(item.motor_valor)}`}
              {item.motor_valor === 0 && (
                <span className="text-warning ml-1 flex items-center gap-0.5">
                  <AlertCircle className="h-2.5 w-2.5" />
                  não achei motor
                </span>
              )}
            </div>
          )}
        </div>
        <button
          onClick={onRemove}
          className="text-ink-faint hover:text-danger shrink-0"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>

      <div className="flex items-center gap-2">
        {/* Quantidade */}
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

        {/* Valor unitário (editável) */}
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
