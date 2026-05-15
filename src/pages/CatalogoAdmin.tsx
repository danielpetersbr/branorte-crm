import { useMemo, useState } from 'react'
import {
  Search, Star, Image as ImageIcon, ImageOff, Filter, Loader2,
  Package, CheckCircle2, AlertCircle, Camera, Settings2, Edit,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  useCatalogoItemsAdmin,
  useToggleOficialCatalogo,
  useStatsCatalogo,
  type CatalogoItemAdmin,
} from '@/hooks/useCatalogoAdmin'
import { CatalogoItemEditModal } from '@/components/CatalogoItemEditModal'

type AbaFiltro = 'todos' | 'pendentes' | 'oficiais' | 'sem-foto' | 'inativos'

const ABAS: Array<{ id: AbaFiltro; label: string }> = [
  { id: 'todos', label: 'Todos' },
  { id: 'pendentes', label: 'Pendentes' },
  { id: 'oficiais', label: 'Oficiais' },
  { id: 'sem-foto', label: 'Sem foto' },
  { id: 'inativos', label: 'Inativos' },
]

const PAGINA_INICIAL = 60

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function categoriasDoItems(items: CatalogoItemAdmin[]): Array<{ categoria: string; qtd: number }> {
  const m = new Map<string, number>()
  for (const it of items) {
    if (!it.categoria) continue
    m.set(it.categoria, (m.get(it.categoria) || 0) + 1)
  }
  return [...m.entries()]
    .map(([categoria, qtd]) => ({ categoria, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
}

export function CatalogoAdmin() {
  const { data: items, isLoading } = useCatalogoItemsAdmin()
  const { data: stats } = useStatsCatalogo()
  const toggleOficial = useToggleOficialCatalogo()

  const [aba, setAba] = useState<AbaFiltro>('todos')
  const [busca, setBusca] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState<string | null>(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [limite, setLimite] = useState(PAGINA_INICIAL)
  const [itemEditando, setItemEditando] = useState<CatalogoItemAdmin | null>(null)
  const [modalOpen, setModalOpen] = useState(false)

  // ─── Categorias disponíveis (botões de toggle) ─────────────────
  const categorias = useMemo(() => (items ? categoriasDoItems(items) : []), [items])

  // ─── Aplicar filtros ────────────────────────────────────────────
  const itemsFiltrados = useMemo(() => {
    if (!items) return []
    const q = busca.trim().toLowerCase()
    return items.filter(it => {
      // Aba
      switch (aba) {
        case 'pendentes':
          if (it.is_oficial) return false
          if (!it.ativo) return false
          break
        case 'oficiais':
          if (!it.is_oficial) return false
          if (!it.ativo) return false
          break
        case 'sem-foto':
          if (it.foto_url) return false
          if (!it.ativo) return false
          break
        case 'inativos':
          if (it.ativo) return false
          break
        case 'todos':
          if (!it.ativo && !mostrarInativos) return false
          break
      }
      // Categoria
      if (categoriaFiltro && it.categoria !== categoriaFiltro) return false
      // Busca
      if (q) {
        const alvo = `${it.nome_curto} ${it.nome_completo} ${it.categoria}`.toLowerCase()
        if (!alvo.includes(q)) return false
      }
      return true
    })
  }, [items, aba, busca, categoriaFiltro, mostrarInativos])

  const itemsVisiveis = itemsFiltrados.slice(0, limite)
  const temMais = itemsFiltrados.length > limite

  function abrirEdicao(item: CatalogoItemAdmin) {
    setItemEditando(item)
    setModalOpen(true)
  }

  function fecharEdicao() {
    setModalOpen(false)
    // pequeno delay pra não piscar o conteúdo enquanto fecha
    setTimeout(() => setItemEditando(null), 200)
  }

  async function handleToggleOficial(e: React.MouseEvent, item: CatalogoItemAdmin) {
    e.stopPropagation()
    try {
      await toggleOficial.mutateAsync({ id: item.id, is_oficial: !item.is_oficial })
    } catch {
      // silencioso — react-query já mostra erro no devtools; fallback é re-fetch
    }
  }

  if (isLoading) return <PageLoading />

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6">
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Settings2 className="w-5 h-5 text-accent" />
              <h1 className="text-[18px] font-semibold text-ink">
                Admin do Catálogo de Produtos
              </h1>
            </div>
            <p className="text-[13px] text-ink-muted">
              Cure cada item com foto, motor e acessórios. Só items "Oficiais" aparecem no builder do vendedor.
            </p>
          </div>
          <button
            onClick={() => { setItemEditando(null); setModalOpen(true) }}
            className="text-[12px] px-4 py-2 rounded bg-accent hover:bg-accent-700 text-white font-semibold flex items-center gap-1.5 shadow shrink-0"
          >
            <span className="text-[16px] leading-none">+</span> Novo Produto
          </button>
        </div>

        {/* ── Stats banner ───────────────────────────────────────── */}
        {stats && (
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-6">
            <div className="bg-surface border border-border rounded-md px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Package className="w-3 h-3 text-ink-faint" />
                <span className="text-[10px] text-ink-faint uppercase tracking-wide">Total</span>
              </div>
              <div className="text-[18px] font-semibold text-ink">{stats.total}</div>
            </div>
            <div className="bg-success-bg/40 border border-success/30 rounded-md px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <CheckCircle2 className="w-3 h-3 text-success" />
                <span className="text-[10px] text-success uppercase tracking-wide">Oficiais</span>
              </div>
              <div className="text-[18px] font-semibold text-success">{stats.oficiais}</div>
            </div>
            <div className="bg-warning/15 border border-warning/30 rounded-md px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <AlertCircle className="w-3 h-3 text-warning" />
                <span className="text-[10px] text-warning uppercase tracking-wide">Pendentes</span>
              </div>
              <div className="text-[18px] font-semibold text-warning">{stats.pendentes}</div>
            </div>
            <div className="bg-info/10 border border-info/30 rounded-md px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Camera className="w-3 h-3 text-info" />
                <span className="text-[10px] text-info uppercase tracking-wide">Com Foto</span>
              </div>
              <div className="text-[18px] font-semibold text-info">{stats.com_foto}</div>
            </div>
            <div className="bg-surface border border-border rounded-md px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-0.5">
                <Settings2 className="w-3 h-3 text-ink-faint" />
                <span className="text-[10px] text-ink-faint uppercase tracking-wide">Com Motor</span>
              </div>
              <div className="text-[18px] font-semibold text-ink">{stats.com_motor}</div>
            </div>
          </div>
        )}

        {/* ── Filtros: abas + busca ──────────────────────────────── */}
        <div className="bg-surface border border-border rounded-lg p-3 mb-4 flex flex-col gap-3">
          {/* Linha 1: abas + toggle inativos */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1">
              {ABAS.map(a => (
                <button
                  key={a.id}
                  onClick={() => { setAba(a.id); setLimite(PAGINA_INICIAL) }}
                  className={`text-[12px] px-3 py-1.5 rounded-md font-medium transition ${
                    aba === a.id
                      ? 'bg-accent text-white'
                      : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'
                  }`}
                >
                  {a.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-[12px] text-ink-muted cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={mostrarInativos}
                  onChange={e => setMostrarInativos(e.target.checked)}
                  className="rounded border-border accent-accent"
                />
                Mostrar inativos
              </label>
            </div>
          </div>

          {/* Linha 2: busca */}
          <Input
            value={busca}
            onChange={e => { setBusca(e.target.value); setLimite(PAGINA_INICIAL) }}
            leftIcon={<Search className="w-3.5 h-3.5" />}
            placeholder="Buscar por nome, categoria..."
          />

          {/* Linha 3: categorias */}
          {categorias.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <div className="flex items-center gap-1 text-[11px] text-ink-faint mr-1">
                <Filter className="w-3 h-3" />
                Categoria:
              </div>
              <button
                onClick={() => { setCategoriaFiltro(null); setLimite(PAGINA_INICIAL) }}
                className={`text-[11px] px-2 py-1 rounded border transition ${
                  categoriaFiltro === null
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3 border-border'
                }`}
              >
                Todas
              </button>
              {categorias.map(c => (
                <button
                  key={c.categoria}
                  onClick={() => { setCategoriaFiltro(c.categoria); setLimite(PAGINA_INICIAL) }}
                  className={`text-[11px] px-2 py-1 rounded border transition ${
                    categoriaFiltro === c.categoria
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-2 text-ink-muted hover:bg-surface-3 border-border'
                  }`}
                >
                  {c.categoria} <span className="opacity-60">({c.qtd})</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* ── Resultado: contagem ─────────────────────────────────── */}
        <div className="flex items-center justify-between mb-3">
          <p className="text-[12px] text-ink-muted">
            {itemsFiltrados.length} item(s) encontrados
            {itemsFiltrados.length > limite && ` — exibindo ${limite}`}
          </p>
        </div>

        {/* ── Lista de items ─────────────────────────────────────── */}
        {itemsFiltrados.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg py-16 flex flex-col items-center justify-center text-ink-faint">
            <Package className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-[13px]">Nenhum item encontrado com esses filtros</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {itemsVisiveis.map(item => (
              <CatalogoCardItem
                key={item.id}
                item={item}
                onClick={() => abrirEdicao(item)}
                onToggleOficial={e => handleToggleOficial(e, item)}
                togglePending={toggleOficial.isPending && toggleOficial.variables?.id === item.id}
              />
            ))}
          </div>
        )}

        {/* ── Ver mais ───────────────────────────────────────────── */}
        {temMais && (
          <div className="flex justify-center mt-6">
            <button
              onClick={() => setLimite(prev => prev + PAGINA_INICIAL)}
              className="text-[12px] px-4 py-2 rounded border border-border bg-surface hover:bg-surface-2 text-ink-muted hover:text-ink font-semibold transition"
            >
              Ver mais ({itemsFiltrados.length - limite} restantes)
            </button>
          </div>
        )}
      </div>

      {/* ── Modal de edição ──────────────────────────────────────── */}
      <CatalogoItemEditModal
        open={modalOpen}
        item={itemEditando}
        onClose={fecharEdicao}
        onSaved={() => { /* react-query invalida a lista no hook */ }}
      />
    </div>
  )
}

// ─── Card de item (memoizado por simplicidade visual) ─────────────
interface CardProps {
  item: CatalogoItemAdmin
  onClick: () => void
  onToggleOficial: (e: React.MouseEvent) => void
  togglePending?: boolean
}

function CatalogoCardItem({ item, onClick, onToggleOficial, togglePending }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`group relative bg-surface border rounded-lg p-3 cursor-pointer transition hover:border-accent/40 hover:shadow-sm ${
        item.ativo ? 'border-border' : 'border-border opacity-60'
      }`}
    >
      <div className="flex gap-3">
        {/* Foto */}
        <div className="shrink-0 w-[60px] h-[60px] rounded-md overflow-hidden bg-surface-2 border border-border flex items-center justify-center">
          {item.foto_url ? (
            <img src={item.foto_url} alt={item.nome_curto} className="w-full h-full object-cover" />
          ) : (
            <ImageOff className="w-5 h-5 text-ink-faint" />
          )}
        </div>

        {/* Conteúdo */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-0.5">
            <p className="text-[10px] text-ink-faint uppercase tracking-wide truncate">
              {item.categoria || 'Sem categoria'}
            </p>
            {item.is_oficial ? (
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-success-bg text-success border border-success/30 uppercase tracking-wider">
                Oficial
              </span>
            ) : (
              <span className="shrink-0 text-[9px] font-bold px-1.5 py-0.5 rounded bg-warning/20 text-warning border border-warning/30 uppercase tracking-wider">
                Pendente
              </span>
            )}
          </div>
          <h3 className="text-[13px] font-semibold text-ink truncate mb-1">
            {item.nome_curto}
          </h3>
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="text-[12px] font-semibold text-accent">
              {formatBRL(item.valor || 0)}
            </span>
            {item.motor_padrao_cv && item.motor_padrao_polos && (
              <span className="text-[10px] text-ink-muted">
                {item.motor_padrao_cv} CV {item.motor_padrao_polos}p
                {item.motor_padrao_qtd > 1 && ` ×${item.motor_padrao_qtd}`}
              </span>
            )}
          </div>
          <p className="text-[10px] text-ink-faint flex items-center gap-1.5">
            {item.is_virtual ? (
              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30 uppercase tracking-wider">
                Sem foto/specs · só preço
              </span>
            ) : (
              <>Usado {item.ocorrencias}× · #{item.id}</>
            )}
            {!item.ativo && ' · INATIVO'}
          </p>
        </div>
      </div>

      {/* Botão estrela (toggle oficial) */}
      <button
        type="button"
        onClick={onToggleOficial}
        disabled={togglePending}
        title={item.is_oficial ? 'Marcar como pendente' : 'Marcar como oficial'}
        className={`absolute top-2 right-2 p-1.5 rounded-md transition opacity-0 group-hover:opacity-100 ${
          item.is_oficial
            ? 'bg-success-bg/60 text-success hover:bg-success-bg'
            : 'bg-surface-2 text-ink-faint hover:bg-warning/20 hover:text-warning'
        }`}
        aria-label="Alternar oficial"
      >
        {togglePending ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <Star className={`w-3.5 h-3.5 ${item.is_oficial ? 'fill-current' : ''}`} />
        )}
      </button>
    </div>
  )
}
