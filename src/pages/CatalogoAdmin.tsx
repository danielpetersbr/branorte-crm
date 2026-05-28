import { useMemo, useState } from 'react'
import {
  Search, Star, Image as ImageIcon, ImageOff, Filter, Loader2,
  Package, CheckCircle2, AlertCircle, Camera, Settings2, Edit,
  Rows3, LayoutGrid, Image as ImageView, FileText,
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

const PAGINA_INICIAL = 120

type ViewMode = 'lista' | 'grid' | 'galeria' | 'orcamento'

// localStorage key pra persistir preferencia entre sessoes
const VIEW_MODE_KEY = 'catalogo_admin_view_mode'

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

// Quando mostrarInativos=false, ignora itens inativos na contagem — assim
// categorias 100% inativas (ex.: COMPACTA enquanto fica fora da grade) somem
// dos chips ao invés de aparecerem com "(70)" e abrirem em "0 itens".
function categoriasDoItems(items: CatalogoItemAdmin[], mostrarInativos: boolean): Array<{ categoria: string; qtd: number }> {
  const m = new Map<string, number>()
  for (const it of items) {
    if (!it.categoria) continue
    if (!mostrarInativos && it.ativo === false) continue
    m.set(it.categoria, (m.get(it.categoria) || 0) + 1)
  }
  return [...m.entries()]
    .map(([categoria, qtd]) => ({ categoria, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
}

// Subcategorias dentro da categoria selecionada (lista vazia se categoria=null).
function subcategoriasDoItems(items: CatalogoItemAdmin[], categoria: string | null, mostrarInativos: boolean): Array<{ subcategoria: string; qtd: number }> {
  if (!categoria) return []
  const m = new Map<string, number>()
  for (const it of items) {
    if (it.categoria !== categoria) continue
    if (!mostrarInativos && it.ativo === false) continue
    const sub = it.subcategoria || '(sem subcategoria)'
    m.set(sub, (m.get(sub) || 0) + 1)
  }
  if (m.size <= 1) return []  // só mostra UI se há mais de 1 subcat na categoria
  return [...m.entries()]
    .map(([subcategoria, qtd]) => ({ subcategoria, qtd }))
    .sort((a, b) => b.qtd - a.qtd)
}

// Extrai diâmetro de nome (ex: "TRANSPORTADOR HELICOIDAL 160 X 3,5 M" → "160").
// Pega o primeiro número de 2-3 dígitos seguido de X/x.
function extrairDiametro(nome: string | null | undefined): string | null {
  if (!nome) return null
  const m = nome.match(/\b(\d{2,3})\s*[xX]/)
  return m ? m[1] : null
}

// Extrai comprimento em metros (ex: "TRANSPORTADOR HELICOIDAL 160 X 3,5 M" → 3.5).
// Pega o número (com vírgula decimal) depois de X/x e antes de M.
function extrairComprimentoMetros(nome: string | null | undefined): number | null {
  if (!nome) return null
  const m = nome.match(/[xX]\s*(\d+(?:[,.]\d+)?)\s*m\b/i)
  return m ? parseFloat(m[1].replace(',', '.')) : null
}

// Diâmetros disponíveis para a (categoria, subcategoria) selecionada.
// Só faz sentido pra TRANSPORTADOR/CHUPIM e TRANSPORTADOR/HELICOIDAL.
function diametrosDoItems(
  items: CatalogoItemAdmin[],
  categoria: string | null,
  subcategoria: string | null,
  mostrarInativos: boolean,
): Array<{ diametro: string; qtd: number }> {
  if (!categoria || categoria !== 'TRANSPORTADOR') return []
  if (!subcategoria || !['CHUPIM', 'TH'].includes(subcategoria)) return []
  const m = new Map<string, number>()
  for (const it of items) {
    if (it.categoria !== categoria) continue
    if ((it.subcategoria || '(sem subcategoria)') !== subcategoria) continue
    if (!mostrarInativos && it.ativo === false) continue
    const d = extrairDiametro(it.nome_curto)
    if (!d) continue
    m.set(d, (m.get(d) || 0) + 1)
  }
  if (m.size <= 1) return []
  return [...m.entries()]
    .map(([diametro, qtd]) => ({ diametro, qtd }))
    .sort((a, b) => Number(a.diametro) - Number(b.diametro))
}

export function CatalogoAdmin() {
  const { data: items, isLoading } = useCatalogoItemsAdmin()
  const { data: stats } = useStatsCatalogo()
  const toggleOficial = useToggleOficialCatalogo()

  const [aba, setAba] = useState<AbaFiltro>('todos')
  const [busca, setBusca] = useState('')
  const [categoriaFiltro, setCategoriaFiltro] = useState<string | null>(null)
  const [subcategoriaFiltro, setSubcategoriaFiltro] = useState<string | null>(null)
  const [diametroFiltro, setDiametroFiltro] = useState<string | null>(null)
  const [mostrarInativos, setMostrarInativos] = useState(false)
  const [limite, setLimite] = useState(PAGINA_INICIAL)
  const [itemEditando, setItemEditando] = useState<CatalogoItemAdmin | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(VIEW_MODE_KEY)
      return (saved === 'grid' || saved === 'galeria' || saved === 'lista' || saved === 'orcamento') ? saved : 'lista'
    } catch { return 'lista' }
  })
  function setViewModePersistente(v: ViewMode) {
    setViewMode(v)
    try { localStorage.setItem(VIEW_MODE_KEY, v) } catch {}
  }

  // ─── Categorias disponíveis (botões de toggle) ─────────────────
  // mostrarInativos no deps pra esconder categorias 100% inativas (ex.: COMPACTA)
  const categorias = useMemo(
    () => (items ? categoriasDoItems(items, mostrarInativos) : []),
    [items, mostrarInativos],
  )
  // ─── Subcategorias da categoria selecionada (só aparecem se categoria != null)
  const subcategorias = useMemo(
    () => (items ? subcategoriasDoItems(items, categoriaFiltro, mostrarInativos) : []),
    [items, categoriaFiltro, mostrarInativos],
  )
  // Diâmetros (apenas pra chupim/helicoidal de transportador)
  const diametros = useMemo(
    () => (items ? diametrosDoItems(items, categoriaFiltro, subcategoriaFiltro, mostrarInativos) : []),
    [items, categoriaFiltro, subcategoriaFiltro, mostrarInativos],
  )

  // ─── Aplicar filtros ────────────────────────────────────────────
  const itemsFiltrados = useMemo(() => {
    if (!items) return []
    const q = busca.trim().toLowerCase()
    const filtrados = items.filter(it => {
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
      // Subcategoria (só faz sentido quando categoria está selecionada)
      if (categoriaFiltro && subcategoriaFiltro) {
        const sub = it.subcategoria || '(sem subcategoria)'
        if (sub !== subcategoriaFiltro) return false
      }
      // Diâmetro (só pra transportador chupim/helicoidal)
      if (diametroFiltro) {
        const d = extrairDiametro(it.nome_curto)
        if (d !== diametroFiltro) return false
      }
      // Busca
      if (q) {
        const alvo = `${it.nome_curto} ${it.nome_completo} ${it.categoria} ${it.subcategoria || ''}`.toLowerCase()
        if (!alvo.includes(q)) return false
      }
      return true
    })
    // Ordenacao especial pra TRANSPORTADOR: ordena por (diametro asc, comprimento asc)
    // pra ficar "160 X 2,0 M", "160 X 2,5 M", "160 X 3,0 M", ..., "210 X 4,0 M", "210 X 4,5 M"...
    if (categoriaFiltro === 'TRANSPORTADOR') {
      return filtrados.slice().sort((a, b) => {
        const da = Number(extrairDiametro(a.nome_curto)) || 999
        const db = Number(extrairDiametro(b.nome_curto)) || 999
        if (da !== db) return da - db
        const ca = extrairComprimentoMetros(a.nome_curto) ?? 9999
        const cb = extrairComprimentoMetros(b.nome_curto) ?? 9999
        if (ca !== cb) return ca - cb
        return (a.nome_curto || '').localeCompare(b.nome_curto || '')
      })
    }
    return filtrados
  }, [items, aba, busca, categoriaFiltro, subcategoriaFiltro, diametroFiltro, mostrarInativos])

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
                onClick={() => { setCategoriaFiltro(null); setSubcategoriaFiltro(null); setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }}
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
                  onClick={() => { setCategoriaFiltro(c.categoria); setSubcategoriaFiltro(null); setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }}
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

          {/* Linha 4: subcategorias (só aparece quando uma categoria com >1 sub está selecionada) */}
          {subcategorias.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pl-4 border-l-2 border-accent/40">
              <div className="flex items-center gap-1 text-[11px] text-ink-faint mr-1">
                Tipo:
              </div>
              <button
                onClick={() => { setSubcategoriaFiltro(null); setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }}
                className={`text-[11px] px-2 py-1 rounded border transition ${
                  subcategoriaFiltro === null
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3 border-border'
                }`}
              >
                Todos
              </button>
              {subcategorias.map(s => (
                <button
                  key={s.subcategoria}
                  onClick={() => { setSubcategoriaFiltro(s.subcategoria); setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }}
                  className={`text-[11px] px-2 py-1 rounded border transition ${
                    subcategoriaFiltro === s.subcategoria
                      ? 'bg-accent text-white border-accent'
                      : 'bg-surface-2 text-ink-muted hover:bg-surface-3 border-border'
                  }`}
                >
                  {s.subcategoria} <span className="opacity-60">({s.qtd})</span>
                </button>
              ))}
            </div>
          )}

          {/* Linha 5: diâmetros (só pra chupim/helicoidal) */}
          {diametros.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pl-8 border-l-2 border-info/40">
              <div className="flex items-center gap-1 text-[11px] text-ink-faint mr-1">
                Ø Diâmetro:
              </div>
              <button
                onClick={() => { setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }}
                className={`text-[11px] px-2 py-1 rounded border transition ${
                  diametroFiltro === null
                    ? 'bg-info text-white border-info'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3 border-border'
                }`}
              >
                Todos
              </button>
              {diametros.map(d => (
                <button
                  key={d.diametro}
                  onClick={() => { setDiametroFiltro(d.diametro); setLimite(PAGINA_INICIAL) }}
                  className={`text-[11px] px-2 py-1 rounded border transition ${
                    diametroFiltro === d.diametro
                      ? 'bg-info text-white border-info'
                      : 'bg-surface-2 text-ink-muted hover:bg-surface-3 border-border'
                  }`}
                >
                  Ø {d.diametro} <span className="opacity-60">({d.qtd})</span>
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

          {/* Seletor de visualizacao: lista (densa) / grid (cards) / galeria (foto grande) */}
          <div className="flex items-center gap-1 bg-surface border border-border rounded-md p-0.5">
            <button
              onClick={() => setViewModePersistente('lista')}
              className={`p-1.5 rounded transition ${viewMode === 'lista' ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-2'}`}
              title="Lista compacta (mais itens por tela)"
            >
              <Rows3 className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewModePersistente('grid')}
              className={`p-1.5 rounded transition ${viewMode === 'grid' ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-2'}`}
              title="Grid (cards medios)"
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewModePersistente('galeria')}
              className={`p-1.5 rounded transition ${viewMode === 'galeria' ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-2'}`}
              title="Galeria (foto grande)"
            >
              <ImageView className="w-4 h-4" />
            </button>
            <button
              onClick={() => setViewModePersistente('orcamento')}
              className={`p-1.5 rounded transition ${viewMode === 'orcamento' ? 'bg-accent/15 text-accent' : 'text-ink-faint hover:text-ink hover:bg-surface-2'}`}
              title="Orçamento (mesma visualização que aparece no PDF do orçamento)"
            >
              <FileText className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Lista de items ─────────────────────────────────────── */}
        {itemsFiltrados.length === 0 ? (
          <div className="bg-surface border border-border rounded-lg py-16 flex flex-col items-center justify-center text-ink-faint">
            <Package className="w-10 h-10 mb-2 opacity-50" />
            <p className="text-[13px]">Nenhum item encontrado com esses filtros</p>
          </div>
        ) : viewMode === 'lista' ? (
          // LISTA COMPACTA: 1 linha por item, infos lado a lado, foto 32x32, ~4x mais densa
          <div className="bg-surface border border-border rounded-lg overflow-hidden divide-y divide-border">
            {itemsVisiveis.map(item => (
              <CatalogoLinhaItem
                key={item.id}
                item={item}
                onClick={() => abrirEdicao(item)}
                onToggleOficial={e => handleToggleOficial(e, item)}
                togglePending={toggleOficial.isPending && toggleOficial.variables?.id === item.id}
              />
            ))}
          </div>
        ) : viewMode === 'galeria' ? (
          // GALERIA: foto grande, ideal pra reconhecimento visual de transportadores/motores
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3">
            {itemsVisiveis.map(item => (
              <CatalogoGaleriaItem
                key={item.id}
                item={item}
                onClick={() => abrirEdicao(item)}
                onToggleOficial={e => handleToggleOficial(e, item)}
                togglePending={toggleOficial.isPending && toggleOficial.variables?.id === item.id}
              />
            ))}
          </div>
        ) : viewMode === 'orcamento' ? (
          // ORCAMENTO: mesmo layout do card no preview do orcamento (foto direita 180x140,
          // bullets esquerda, titulo grande, valor no rodape). Pra editar vendo como o cliente ve.
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
            {itemsVisiveis.map(item => (
              <CatalogoOrcamentoItem
                key={item.id}
                item={item}
                onClick={() => abrirEdicao(item)}
                onToggleOficial={e => handleToggleOficial(e, item)}
                togglePending={toggleOficial.isPending && toggleOficial.variables?.id === item.id}
              />
            ))}
          </div>
        ) : (
          // GRID: cards medios (formato original, 3 colunas)
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
            <p className="text-[10px] text-ink-faint uppercase tracking-wide truncate flex items-center gap-1.5">
              <span>{item.categoria || 'Sem categoria'}</span>
              {item.subcategoria && (
                <span className="px-1 py-px rounded bg-accent/15 text-accent border border-accent/30 text-[9px] font-bold tracking-wider">
                  {item.subcategoria}
                </span>
              )}
            </p>
            {!item.is_oficial && (
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

// ─── LISTA COMPACTA: linha unica densa, ~4x mais itens visiveis ───
function CatalogoLinhaItem({ item, onClick, onToggleOficial, togglePending }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-2 px-2 py-1.5 cursor-pointer transition hover:bg-surface-2 ${item.ativo ? '' : 'opacity-60'}`}
    >
      {/* Foto miniatura 56x56 (era 32 — pequeno demais pra reconhecer item) */}
      <div className="shrink-0 w-14 h-14 rounded overflow-hidden bg-surface-2 border border-border flex items-center justify-center">
        {item.foto_url ? (
          <img src={item.foto_url} alt={item.nome_curto} className="w-full h-full object-contain" />
        ) : (
          <ImageOff className="w-5 h-5 text-ink-faint" />
        )}
      </div>
      {/* Categoria + subcategoria (badges compactas) */}
      <div className="shrink-0 flex items-center gap-1 w-[140px]">
        <span className="text-[9px] text-ink-faint uppercase tracking-wide truncate">{item.categoria || '—'}</span>
        {item.subcategoria && (
          <span className="px-1 rounded bg-accent/15 text-accent border border-accent/30 text-[8px] font-bold tracking-wider">
            {item.subcategoria}
          </span>
        )}
      </div>
      {/* Nome (flex-1, trunca) */}
      <div className="flex-1 min-w-0">
        <p className="text-[12px] text-ink truncate font-medium">{item.nome_curto}</p>
      </div>
      {/* Motor (se tiver) */}
      {item.motor_padrao_cv && item.motor_padrao_polos && (
        <span className="shrink-0 text-[10px] text-ink-muted tabular-nums w-[60px] text-right">
          {item.motor_padrao_cv} CV {item.motor_padrao_polos}p
        </span>
      )}
      {/* Preco (alinhado direita) */}
      <span className="shrink-0 text-[12px] font-semibold text-accent tabular-nums w-[90px] text-right">
        {formatBRL(item.valor || 0)}
      </span>
      {/* Badges status (pendente / sem foto / sem link) */}
      <div className="shrink-0 flex items-center gap-1">
        {!item.is_oficial && (
          <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-warning/20 text-warning border border-warning/30 uppercase tracking-wider">P</span>
        )}
        {!item.foto_url && (
          <span title="Sem foto" className="text-[8px] font-bold px-1 py-0.5 rounded bg-danger/15 text-danger border border-danger/30">SF</span>
        )}
      </div>
      {/* Star toggle */}
      <button
        onClick={onToggleOficial}
        disabled={togglePending}
        className={`shrink-0 p-1 rounded transition ${item.is_oficial ? 'text-warning' : 'text-ink-faint opacity-0 group-hover:opacity-100 hover:text-warning'}`}
        title={item.is_oficial ? 'Remover de Oficiais' : 'Marcar como Oficial'}
      >
        {togglePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className={`w-3.5 h-3.5 ${item.is_oficial ? 'fill-current' : ''}`} />}
      </button>
    </div>
  )
}

// ─── GALERIA: foto grande, ideal pra reconhecimento visual rapido ───
function CatalogoGaleriaItem({ item, onClick, onToggleOficial, togglePending }: CardProps) {
  return (
    <div
      onClick={onClick}
      className={`group relative bg-surface border rounded-lg overflow-hidden cursor-pointer transition hover:border-accent/40 hover:shadow-md ${item.ativo ? 'border-border' : 'border-border opacity-60'}`}
    >
      {/* Foto grande (proporcao 4:3) */}
      <div className="w-full aspect-[4/3] bg-surface-2 border-b border-border flex items-center justify-center overflow-hidden">
        {item.foto_url ? (
          <img src={item.foto_url} alt={item.nome_curto} className="w-full h-full object-cover" />
        ) : (
          <ImageOff className="w-8 h-8 text-ink-faint opacity-50" />
        )}
      </div>
      {/* Star canto superior direito */}
      <button
        onClick={onToggleOficial}
        disabled={togglePending}
        className={`absolute top-1.5 right-1.5 p-1.5 rounded-full backdrop-blur bg-bg/70 transition ${item.is_oficial ? 'text-warning' : 'text-white/70 opacity-0 group-hover:opacity-100 hover:text-warning'}`}
        title={item.is_oficial ? 'Remover de Oficiais' : 'Marcar como Oficial'}
      >
        {togglePending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Star className={`w-3.5 h-3.5 ${item.is_oficial ? 'fill-current' : ''}`} />}
      </button>
      {/* Badge pendente canto superior esquerdo */}
      {!item.is_oficial && (
        <span className="absolute top-1.5 left-1.5 text-[8px] font-bold px-1.5 py-0.5 rounded bg-warning/90 text-white uppercase tracking-wider">
          Pendente
        </span>
      )}
      {/* Info abaixo da foto */}
      <div className="p-2">
        <p className="text-[9px] text-ink-faint uppercase tracking-wide truncate">{item.categoria}{item.subcategoria && ` · ${item.subcategoria}`}</p>
        <h3 className="text-[11px] font-semibold text-ink truncate" title={item.nome_curto}>{item.nome_curto}</h3>
        <div className="flex items-center justify-between mt-0.5">
          <span className="text-[11px] font-semibold text-accent tabular-nums">{formatBRL(item.valor || 0)}</span>
          {item.motor_padrao_cv && (
            <span className="text-[9px] text-ink-muted tabular-nums">{item.motor_padrao_cv}CV</span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Card no MESMO layout do card de item no OrcamentoPreview ─────────────
// Foto 180x140 a direita, bullets de specs a esquerda, titulo grande no topo,
// linha VALOR no rodape. Pra editar vendo exatamente como o cliente ve.
function CatalogoOrcamentoItem({ item, onClick, onToggleOficial, togglePending }: CardProps) {
  const specs = Array.isArray(item.specs) ? item.specs : []
  return (
    <div
      onClick={onClick}
      className={`group relative bg-white border-2 rounded-md p-3 cursor-pointer transition hover:border-accent/60 hover:shadow-md text-gray-900 ${
        item.ativo ? 'border-gray-300' : 'border-gray-200 opacity-60'
      }`}
    >
      {/* Header: badges + estrela */}
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <span className="text-[10px] text-gray-500 uppercase tracking-wide font-semibold">
            {item.categoria || 'Sem categoria'}
          </span>
          {item.subcategoria && (
            <span className="px-1.5 py-px rounded bg-accent/15 text-accent border border-accent/30 text-[9px] font-bold tracking-wider">
              {item.subcategoria}
            </span>
          )}
          {!item.is_oficial && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-warning/20 text-warning border border-warning/30 uppercase tracking-wider">
              Pendente
            </span>
          )}
          {item.is_virtual && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-info/15 text-info border border-info/30 uppercase tracking-wider">
              Só preço
            </span>
          )}
          {!item.ativo && (
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-gray-200 text-gray-500 border border-gray-300 uppercase tracking-wider">
              Inativo
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={e => { e.stopPropagation(); onToggleOficial(e) }}
          disabled={togglePending}
          title={item.is_oficial ? 'Oficial — clique pra remover do builder' : 'Marcar como oficial'}
          className={`shrink-0 p-1.5 rounded-md transition ${
            item.is_oficial
              ? 'bg-success-bg/60 text-success hover:bg-success-bg'
              : 'bg-gray-100 text-gray-400 hover:bg-warning/20 hover:text-warning'
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

      {/* Titulo grande estilo orcamento */}
      <h3 className="text-[15.5px] font-bold text-gray-900 mb-2 leading-tight uppercase">
        {item.nome_curto || '(sem nome)'}
      </h3>

      {/* Bullets + foto (mesmo layout do OrcamentoPreview) */}
      <div className="flex flex-row gap-4 items-start mb-2">
        <div className="flex-1 pl-3 text-[13.5px] text-gray-700 leading-normal space-y-0.5 min-w-0">
          {specs.length > 0 ? (
            specs.map((s, i) => (
              <div key={i} className="flex gap-1.5">
                <span className="text-gray-400 shrink-0">•</span>
                <span className="break-words">{s}</span>
              </div>
            ))
          ) : (
            <div className="text-[12px] text-amber-600 italic">⚠ Sem descrição — clique pra adicionar specs</div>
          )}
        </div>
        <div className="shrink-0 w-[180px] h-[140px] rounded-md overflow-hidden bg-gray-50 border border-gray-200 flex items-center justify-center relative">
          {item.foto_url ? (
            <img src={item.foto_url} alt={item.nome_curto} className="w-full h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center text-gray-400">
              <ImageOff className="w-6 h-6 mb-1" />
              <span className="text-[10px]">sem foto</span>
            </div>
          )}
          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition flex items-center justify-center opacity-0 group-hover:opacity-100">
            <span className="text-white text-[11px] font-semibold flex items-center gap-1">
              <Camera className="w-3.5 h-3.5" /> Trocar / Editar
            </span>
          </div>
        </div>
      </div>

      {/* Linha VALOR no rodape (igual orcamento) */}
      <div className="flex items-center justify-between border-t border-gray-200 pt-2 mt-2">
        <div className="flex items-center gap-3">
          <span className="text-[13px] font-bold text-gray-700 tracking-wider uppercase">Valor</span>
          {item.motor_padrao_cv && item.motor_padrao_polos && (
            <span className="text-[11px] text-gray-500">
              · {item.motor_padrao_cv} CV {item.motor_padrao_polos}p
              {item.motor_padrao_qtd > 1 && ` ×${item.motor_padrao_qtd}`}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[10px] text-gray-400">
            {item.is_virtual ? '(virtual)' : `#${item.id} · usado ${item.ocorrencias}×`}
          </span>
          <span className="text-[16px] font-bold text-accent">
            {formatBRL(item.valor || 0)}
          </span>
        </div>
      </div>
    </div>
  )
}
