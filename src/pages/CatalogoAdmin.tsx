import { useMemo, useState } from 'react'
import {
  Search, ImageOff, Filter,
  Package, Camera, Edit,
  Rows3, LayoutGrid, Image as ImageView, FileText, Plus, X, ArrowRight,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { QueryNotice } from '@/components/ui/QueryNotice'
import {
  useCatalogoItemsAdmin,
  type CatalogoItemAdmin,
} from '@/hooks/useCatalogoAdmin'
import { CatalogoItemEditModal } from '@/components/CatalogoItemEditModal'
import { CatalogoFabricaFotoModal } from '@/components/CatalogoFabricaFotoModal'
import { correspondeBuscaCatalogo, nomeCategoria, resumirCatalogo } from '@/lib/catalogo-admin-apresentacao'

type AbaFiltro = 'todos' | 'sem-foto' | 'inativos'

const ABAS: Array<{ id: AbaFiltro; label: string }> = [
  { id: 'todos', label: 'Todos' },
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

// Categorias que SEMPRE ficam por último, depois das principais ordenadas por qtd.
// Vendedor pediu pra empurrar essas pro fim porque são peças/acessórios — não são
// equipamentos primários. Mantém ordem entre elas tambem por qtd.
const CATEGORIAS_FIM_DA_LISTA = ['ACESSORIO', 'HELICOIDE']

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
    .sort((a, b) => {
      const aFim = CATEGORIAS_FIM_DA_LISTA.includes(a.categoria)
      const bFim = CATEGORIAS_FIM_DA_LISTA.includes(b.categoria)
      if (aFim && !bFim) return 1
      if (!aFim && bFim) return -1
      return b.qtd - a.qtd
    })
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
  const { data: items, isLoading, error, refetch, isFetching } = useCatalogoItemsAdmin()
  const resumo = useMemo(() => resumirCatalogo(items ?? []), [items])

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
      return (saved === 'grid' || saved === 'galeria' || saved === 'lista' || saved === 'orcamento') ? saved : 'grid'
    } catch { return 'grid' }
  })
  function setViewModePersistente(v: ViewMode) {
    setViewMode(v)
    try { localStorage.setItem(VIEW_MODE_KEY, v) } catch {}
  }

  // ─── Categorias disponíveis (botões de toggle) ─────────────────
  // mostrarInativos no deps pra esconder categorias 100% inativas (ex.: COMPACTA)
  const categorias = useMemo(
    () => (items ? categoriasDoItems(items, mostrarInativos || aba === 'inativos') : []),
    [items, mostrarInativos, aba],
  )
  // ─── Subcategorias da categoria selecionada (só aparecem se categoria != null)
  const subcategorias = useMemo(
    () => (items ? subcategoriasDoItems(items, categoriaFiltro, mostrarInativos || aba === 'inativos') : []),
    [items, categoriaFiltro, mostrarInativos, aba],
  )
  // Diâmetros (apenas pra chupim/helicoidal de transportador)
  const diametros = useMemo(
    () => (items ? diametrosDoItems(items, categoriaFiltro, subcategoriaFiltro, mostrarInativos || aba === 'inativos') : []),
    [items, categoriaFiltro, subcategoriaFiltro, mostrarInativos, aba],
  )

  // ─── Aplicar filtros ────────────────────────────────────────────
  const itemsFiltrados = useMemo(() => {
    if (!items) return []
    const filtrados = items.filter(it => {
      // Aba
      switch (aba) {
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
      if (!correspondeBuscaCatalogo(it, busca)) return false
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

  function selecionarCategoria(categoria: string | null) {
    setCategoriaFiltro(categoria)
    setSubcategoriaFiltro(null)
    setDiametroFiltro(null)
    setLimite(PAGINA_INICIAL)
  }

  function limparFiltros() {
    setBusca('')
    setAba('todos')
    setMostrarInativos(false)
    selecionarCategoria(null)
  }

  function abrirEdicao(item: CatalogoItemAdmin) {
    setItemEditando(item)
    setModalOpen(true)
  }

  function fecharEdicao() {
    // Sem o setTimeout de 200 ms que havia aqui (29/09/2026). Ele existia "pra não
    // piscar o conteúdo", mas o modal não renderiza nada com open=false, então não
    // havia o que piscar. E com o "+ Novo Produto" funcionando ele virou armadilha:
    // fechar um item e abrir outro em menos de 200 ms deixava o timer zerar o item
    // do modal já aberto — que caía no modo CRIAR e, no Salvar, INSERIA uma cópia
    // em vez de atualizar.
    setModalOpen(false)
    setItemEditando(null)
  }

  if (error && !items) return <div className="p-4"><QueryNotice error={error} loading={isFetching} onRetry={() => { void refetch() }} message="Não foi possível carregar o catálogo de equipamentos." /></div>
  if (isLoading && !items) return <PageLoading />

  const temFiltros = !!busca || !!categoriaFiltro || aba !== 'todos' || mostrarInativos
  const modos = [
    { id: 'grid', label: 'Cards', icon: LayoutGrid },
    { id: 'lista', label: 'Lista', icon: Rows3 },
    { id: 'galeria', label: 'Fotos', icon: ImageView },
    { id: 'orcamento', label: 'Orçamento', icon: FileText },
  ] as const

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6 sm:py-8">
        <QueryNotice error={error} loading={isFetching} onRetry={() => { void refetch() }} message="Não foi possível atualizar o catálogo. Seus dados de edição foram preservados." />
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <p className="text-[11px] uppercase tracking-widest text-accent font-semibold mb-2">Catálogo e projetos</p>
            <h1 className="text-2xl sm:text-[28px] font-semibold tracking-tight text-ink">Catálogo de equipamentos</h1>
            <p className="text-sm text-ink-muted mt-2">Gerencie as fotos e descrições usadas nos orçamentos.</p>
          </div>
          <button onClick={() => { setItemEditando(null); setModalOpen(true) }} className="inline-flex items-center justify-center gap-2 bg-accent hover:bg-accent-700 text-white rounded-lg px-4 py-3 text-sm font-semibold shrink-0">
            <Plus className="w-4 h-4" /> Novo produto
          </button>
        </header>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6" aria-label="Resumo do catálogo ativo">
          {[
            { filtro: 'todos', label: 'Produtos ativos', valor: resumo.todos, icon: Package, detalhe: 'Todos os equipamentos', cor: 'text-ink' },
            { filtro: 'sem-foto', label: 'Sem foto', valor: resumo['sem-foto'], icon: ImageOff, detalhe: 'Adicione uma imagem', cor: 'text-warning' },
          ].map(s => (
            <button key={s.filtro} onClick={() => { limparFiltros(); setAba(s.filtro as AbaFiltro) }} className="text-left bg-surface border border-border hover:border-accent/50 rounded-xl p-4 transition group">
              <div className="flex items-center justify-between gap-2 text-ink-muted text-xs"><span>{s.label}</span><s.icon className={`w-4 h-4 ${s.cor}`} /></div>
              <p className={`text-2xl sm:text-3xl font-semibold tabular-nums mt-2 ${s.cor}`}>{s.valor}</p>
              <p className="text-[11px] text-ink-faint mt-1 flex items-center justify-between gap-1">{s.detalhe}<ArrowRight className="w-3 h-3 opacity-0 group-hover:opacity-100" /></p>
            </button>
          ))}
        </div>

        <div className="flex items-start gap-5">
          <aside className="hidden lg:block w-[220px] shrink-0 sticky top-6 bg-surface border border-border rounded-xl overflow-hidden" aria-label="Categorias de equipamentos">
            <div className="px-4 py-4 border-b border-border"><h2 className="font-semibold text-sm text-ink flex items-center gap-2"><Filter className="w-4 h-4 text-accent" /> Categorias</h2></div>
            <div className="p-2 max-h-[65vh] overflow-y-auto">
              <button onClick={() => selecionarCategoria(null)} aria-pressed={!categoriaFiltro} className={`w-full text-left px-3 py-2.5 rounded-lg text-sm mb-1 transition ${!categoriaFiltro ? 'bg-accent/15 text-accent font-semibold' : 'text-ink-muted hover:bg-surface-2'}`}>Todas as categorias</button>
              {categorias.map(c => (
                <button key={c.categoria} onClick={() => selecionarCategoria(c.categoria)} aria-pressed={categoriaFiltro === c.categoria} className={`w-full flex items-center justify-between gap-2 text-left px-3 py-2.5 rounded-lg text-[13px] transition ${categoriaFiltro === c.categoria ? 'bg-accent/15 text-accent font-semibold' : 'text-ink-muted hover:bg-surface-2 hover:text-ink'}`}>
                  <span>{nomeCategoria(c.categoria)}</span><span className="text-[11px] opacity-60 tabular-nums">{c.qtd}</span>
                </button>
              ))}
            </div>
            <p className="px-4 py-3 border-t border-border text-[11px] text-ink-faint">Clique em Editar para trocar a foto ou ajustar a descrição.</p>
          </aside>

          <main className="flex-1 min-w-0">
            <div className="bg-surface border border-border rounded-xl p-3 sm:p-4 mb-4 space-y-3 sticky top-0 z-10 shadow-sm">
              <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1 min-w-0">
                  <Input value={busca} onChange={e => { setBusca(e.target.value); setLimite(PAGINA_INICIAL) }} aria-label="Buscar equipamento" leftIcon={<Search className="w-4 h-4" />} placeholder="Buscar equipamento, categoria ou código…" className="sm:h-11" />
                </div>
                {temFiltros && <button onClick={limparFiltros} className="inline-flex items-center justify-center gap-1.5 px-3 py-2 text-xs text-ink-muted hover:text-ink rounded-lg border border-border hover:bg-surface-2"><X className="w-3.5 h-3.5" /> Limpar filtros</button>}
              </div>

              <div className="lg:hidden">
                <label htmlFor="catalogo-categoria" className="text-xs text-ink-muted block mb-1">Categoria</label>
                <select id="catalogo-categoria" value={categoriaFiltro ?? ''} onChange={e => selecionarCategoria(e.target.value || null)} className="w-full h-11 rounded-lg border border-border bg-surface px-3 text-sm text-ink">
                  <option value="">Todas as categorias</option>
                  {categorias.map(c => <option key={c.categoria} value={c.categoria}>{nomeCategoria(c.categoria)} ({c.qtd})</option>)}
                </select>
              </div>

              <div className="flex flex-wrap gap-1.5" aria-label="Status do produto">
                {ABAS.map(a => (
                  <button key={a.id} onClick={() => { setAba(a.id); setLimite(PAGINA_INICIAL) }} aria-pressed={aba === a.id} className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition ${aba === a.id ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink hover:bg-surface-2'}`}>
                    {a.label}<span className="text-[10px] tabular-nums opacity-70">{resumo[a.id]}</span>
                  </button>
                ))}
              </div>

              {subcategorias.length > 0 && <div className="flex flex-wrap items-center gap-1.5 border-t border-border pt-3">
                <span className="text-xs text-ink-faint mr-1">Tipo:</span>
                <button onClick={() => { setSubcategoriaFiltro(null); setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }} aria-pressed={!subcategoriaFiltro} className={`text-xs px-2.5 py-1.5 rounded border ${!subcategoriaFiltro ? 'text-accent border-accent/40 bg-accent/10' : 'text-ink-muted border-border'}`}>Todos</button>
                {subcategorias.map(s => <button key={s.subcategoria} onClick={() => { setSubcategoriaFiltro(s.subcategoria); setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }} aria-pressed={subcategoriaFiltro === s.subcategoria} className={`text-xs px-2.5 py-1.5 rounded border ${subcategoriaFiltro === s.subcategoria ? 'text-accent border-accent/40 bg-accent/10' : 'text-ink-muted border-border'}`}>{s.subcategoria.replace(/_/g, ' ')} <span className="opacity-60">({s.qtd})</span></button>)}
              </div>}
              {diametros.length > 0 && <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-ink-faint mr-1">Diâmetro:</span>
                <button onClick={() => { setDiametroFiltro(null); setLimite(PAGINA_INICIAL) }} aria-pressed={!diametroFiltro} className={`text-xs px-2.5 py-1.5 rounded border ${!diametroFiltro ? 'text-accent border-accent/40 bg-accent/10' : 'text-ink-muted border-border'}`}>Todos</button>
                {diametros.map(d => <button key={d.diametro} onClick={() => { setDiametroFiltro(d.diametro); setLimite(PAGINA_INICIAL) }} aria-pressed={diametroFiltro === d.diametro} className={`text-xs px-2.5 py-1.5 rounded border ${diametroFiltro === d.diametro ? 'text-accent border-accent/40 bg-accent/10' : 'text-ink-muted border-border'}`}>Ø {d.diametro} mm <span className="opacity-60">({d.qtd})</span></button>)}
              </div>}
            </div>

            <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-base font-semibold text-ink">{categoriaFiltro ? nomeCategoria(categoriaFiltro) : 'Todos os equipamentos'}</h2>
                <p className="text-xs text-ink-muted mt-1" role="status">{itemsFiltrados.length} produtos encontrados{temMais && ` · mostrando ${limite}`}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                {aba === 'todos' && <label className="flex items-center gap-1.5 text-xs text-ink-muted cursor-pointer"><input type="checkbox" checked={mostrarInativos} onChange={e => { setMostrarInativos(e.target.checked); setLimite(PAGINA_INICIAL) }} className="accent-accent" /> Incluir inativos</label>}
                <div className="flex items-center gap-1 bg-surface border border-border rounded-lg p-1" aria-label="Visualização">
                  {modos.map(m => <button key={m.id} onClick={() => setViewModePersistente(m.id)} aria-pressed={viewMode === m.id} className={`inline-flex items-center gap-1.5 px-2.5 py-2 rounded text-xs transition ${viewMode === m.id ? 'bg-accent/15 text-accent font-semibold' : 'text-ink-muted hover:text-ink hover:bg-surface-2'}`}><m.icon className="w-3.5 h-3.5" />{m.label}</button>)}
                </div>
              </div>
            </div>

            {itemsFiltrados.length === 0 ? (
              <div className="bg-surface border border-dashed border-border rounded-xl py-16 px-4 text-center">
                <Search className="w-9 h-9 text-ink-faint mx-auto mb-3" />
                <h3 className="text-base font-semibold text-ink">Nenhum equipamento encontrado</h3>
                <p className="text-sm text-ink-muted mt-2 mb-5">Tente outro nome ou ajuste os filtros selecionados.</p>
                <button onClick={limparFiltros} className="text-sm text-accent font-semibold hover:underline">Limpar filtros</button>
              </div>
            ) : viewMode === 'lista' ? (
              <div className="bg-surface border border-border rounded-xl overflow-hidden divide-y divide-border">
                {itemsVisiveis.map(item => <CatalogoLinhaItem key={item.id} item={item} onClick={() => abrirEdicao(item)} />)}
              </div>
            ) : viewMode === 'orcamento' ? (
              <div className="grid grid-cols-1 2xl:grid-cols-2 gap-4">
                {itemsVisiveis.map(item => <CatalogoOrcamentoItem key={item.id} item={item} onClick={() => abrirEdicao(item)} />)}
              </div>
            ) : (
              <div className={viewMode === 'galeria' ? 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-4' : 'grid grid-cols-1 xl:grid-cols-2 2xl:grid-cols-3 gap-4'}>
                {itemsVisiveis.map(item => <CatalogoCardItem key={item.id} item={item} galeria={viewMode === 'galeria'} onClick={() => abrirEdicao(item)} />)}
              </div>
            )}
            {temMais && <div className="flex justify-center mt-6"><button onClick={() => setLimite(prev => prev + PAGINA_INICIAL)} className="text-sm px-5 py-3 rounded-lg border border-border bg-surface hover:bg-surface-2 text-ink font-medium">Carregar mais produtos ({itemsFiltrados.length - limite} restantes)</button></div>}
          </main>
        </div>
      </div>
      {modalOpen && itemEditando?.modelo_id != null
        ? <CatalogoFabricaFotoModal key={itemEditando.modelo_id} item={itemEditando as CatalogoItemAdmin & { modelo_id: number }} onClose={fecharEdicao} />
        : <CatalogoItemEditModal open={modalOpen} item={itemEditando} onClose={fecharEdicao} onSaved={() => { /* Os hooks atualizam a lista após salvar. */ }} />}
    </div>
  )
}


// ─── Card de item (memoizado por simplicidade visual) ─────────────
interface CardProps {
  item: CatalogoItemAdmin
  onClick: () => void
  galeria?: boolean
}

function CatalogoCardItem({ item, onClick, galeria }: CardProps) {
  return (
    <article className={`group flex flex-col bg-surface border border-border rounded-xl overflow-hidden hover:border-accent/50 transition ${item.ativo ? '' : 'opacity-60'}`}>
      <button type="button" onClick={onClick} aria-label={`Editar ${item.nome_curto}`} className={`text-left w-full min-w-0 ${galeria ? '' : 'flex items-start gap-4 p-4'}`}>
        <div className={`relative flex items-center justify-center overflow-hidden bg-white border-border ${galeria ? 'w-full aspect-[4/3] border-b' : 'shrink-0 w-24 h-24 sm:w-28 sm:h-28 border rounded-lg'}`}>
          {item.foto_url ? <img src={item.foto_url} alt={item.nome_curto} loading="lazy" className="w-full h-full object-contain p-2" /> : <div className="flex flex-col items-center gap-2 text-gray-400"><ImageOff className="w-7 h-7" /><span className="text-xs">Sem foto</span></div>}
        </div>
        <div className={`min-w-0 flex-1 ${galeria ? 'p-4' : ''}`}>
          {!item.ativo && <span className="inline-block mb-2 px-2 py-0.5 rounded text-[11px] font-medium text-ink-muted bg-surface-2">Inativo</span>}
          <p className="text-[11px] text-accent font-medium mb-1.5">{nomeCategoria(item.categoria || 'Sem categoria')}</p>
          <h3 className="text-sm font-semibold text-ink leading-snug line-clamp-2" title={item.nome_curto}>{item.nome_curto}</h3>
          {item.subcategoria && <p className="text-[11px] text-ink-faint mt-1">{item.subcategoria.replace(/_/g, ' ')}</p>}
          <p className="text-base font-semibold text-ink tabular-nums mt-3">{formatBRL(item.valor || 0)}</p>
          {item.motor_padrao_cv && <p className="text-xs text-ink-muted mt-1">Motor {item.motor_padrao_cv} CV{item.motor_padrao_polos ? ` · ${item.motor_padrao_polos} polos` : ''}</p>}
        </div>
      </button>
      <div className="flex items-center justify-end gap-2 px-4 py-3 mt-auto border-t border-border">
        <button type="button" onClick={onClick} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/20" aria-label={`Editar ${item.modelo_id != null ? 'foto' : 'foto e descrição'} de ${item.nome_curto}`}><Edit className="w-3.5 h-3.5" /> Editar</button>
      </div>
    </article>
  )
}

function CatalogoLinhaItem({ item, onClick }: CardProps) {
  return (
    <article className={`flex flex-wrap sm:flex-nowrap items-center gap-3 px-3 sm:px-4 py-3 hover:bg-surface-2 transition ${item.ativo ? '' : 'opacity-60'}`}>
      <button type="button" onClick={onClick} aria-label={`Editar ${item.nome_curto}`} className="flex flex-1 min-w-0 items-center gap-3 text-left">
        <div className="shrink-0 w-16 h-16 sm:w-[76px] sm:h-[76px] rounded-lg overflow-hidden bg-white border border-border flex items-center justify-center">
          {item.foto_url ? <img src={item.foto_url} alt={item.nome_curto} loading="lazy" className="w-full h-full object-contain p-1" /> : <ImageOff className="w-6 h-6 text-gray-400" />}
        </div>
        <div className="min-w-0">
          <p className="text-[11px] text-accent mb-1">{nomeCategoria(item.categoria || 'Sem categoria')}</p>
          <h3 className="text-sm text-ink font-medium line-clamp-2">{item.nome_curto}</h3>
          <p className="text-[11px] text-ink-faint mt-1">{item.is_virtual ? 'Aguardando foto e descrição' : (item.modelo_id != null ? `Modelo #${item.modelo_id}` : `#${item.id}`)}{!item.foto_url && !item.is_virtual ? ' · Sem foto' : ''}{!item.ativo ? ' · Inativo' : ''}</p>
        </div>
      </button>
      <div className="w-full sm:w-auto flex items-center justify-end gap-2 sm:gap-4">
        <span className="mr-auto sm:mr-0 text-sm font-semibold text-ink tabular-nums">{formatBRL(item.valor || 0)}</span>
        <button type="button" onClick={onClick} aria-label={`Editar ${item.modelo_id != null ? 'foto' : 'foto e descrição'} de ${item.nome_curto}`} className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-accent bg-accent/10 hover:bg-accent/20"><Edit className="w-3.5 h-3.5" /> Editar</button>
      </div>
    </article>
  )
}


// ─── Card no MESMO layout do card de item no OrcamentoPreview ─────────────
// Foto 180x140 a direita, bullets de specs a esquerda, titulo grande no topo,
// linha VALOR no rodape. Pra editar vendo exatamente como o cliente ve.
function CatalogoOrcamentoItem({ item, onClick }: CardProps) {
  const specs = Array.isArray(item.specs) ? item.specs : []
  return (
    <div
      onClick={onClick}
      className={`group relative bg-white border-2 rounded-md p-3 cursor-pointer transition hover:border-accent/60 hover:shadow-md text-gray-900 ${
        item.ativo ? 'border-gray-300' : 'border-gray-200 opacity-60'
      }`}
    >
      {/* Categoria e status do item */}
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
      </div>

      {/* Titulo grande estilo orcamento */}
      <h3 className="text-[15.5px] font-bold text-gray-900 mb-2 leading-tight uppercase">
        {item.nome_curto || '(sem nome)'}
      </h3>

      {/* Bullets + foto (mesmo layout do OrcamentoPreview) */}
      <div className="flex flex-col sm:flex-row gap-4 items-start mb-2">
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2 mt-2">
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
            {item.modelo_id != null ? `Modelo #${item.modelo_id}` : item.is_virtual ? '(virtual)' : `#${item.id} · usado ${item.ocorrencias}×`}
          </span>
          <span className="text-[16px] font-bold text-accent">
            {formatBRL(item.valor || 0)}
          </span>
        </div>
      </div>
      <button type="button" onClick={e => { e.stopPropagation(); onClick() }} className="inline-flex items-center gap-1.5 text-xs font-semibold text-accent mt-3 px-3 py-2 rounded-lg bg-accent/10 hover:bg-accent/20"><Edit className="w-3.5 h-3.5" /> {item.modelo_id != null ? 'Editar foto' : 'Editar foto e descrição'}</button>
    </div>
  )
}
