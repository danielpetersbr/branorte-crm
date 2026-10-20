import { useState } from 'react'
import { Boxes, Check, ChevronDown, Link2, Search } from 'lucide-react'
import type { CatalogoItem } from '@/hooks/useCatalogo'
import type { OrigemProjeto3D } from '@/lib/projeto-3d-orcamento'

type Linha = { uid: string; nome: string; qtd: number; valor: number; catalogo_id?: number; origem_projeto3d?: OrigemProjeto3D }

export function Projeto3DOrcamentoResolver({ items, catalogo, onVincular, onManual }: {
  items: Linha[]; catalogo: CatalogoItem[];
  onVincular: (uid: string, item: CatalogoItem) => void;
  onManual: (uid: string, valor: number) => void;
}) {
  const imported = items.filter(item => item.origem_projeto3d)
  const pending = imported.filter(item => item.origem_projeto3d?.resolution === 'pendente').length
  const [expanded, setExpanded] = useState(true)
  if (!imported.length) return null
  return <section className="rounded-xl border border-accent/25 bg-surface shadow-sm overflow-hidden" aria-label="Itens recebidos do projeto 3D">
    <button type="button" className="w-full flex items-center gap-3 px-4 py-3 text-left" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent/10 text-accent"><Boxes className="h-5 w-5" /></span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-bold text-ink">Lista do projeto 3D</span><span className="block text-xs text-ink-muted mt-0.5">{imported.length} linhas · nomes, quantidades e sequência preservados</span></span>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${pending ? 'bg-amber-100 text-amber-900' : 'bg-accent/10 text-accent'}`}>{pending ? `${pending} a conferir` : 'Itens precificados'}</span>
      <ChevronDown className={`h-4 w-4 text-ink-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
    </button>
    {expanded && <div className="border-t border-border">
      <p className="px-4 py-3 text-xs text-ink-muted bg-accent/5">Os equipamentos reconhecidos recebem o cadastro e o preço automaticamente. Confira os itens pendentes para liberar a emissão.</p>
      <ol className="divide-y divide-border max-h-[480px] overflow-y-auto">
        {imported.map(item => <LinhaResolver key={item.uid} item={item} catalogo={catalogo} onVincular={onVincular} onManual={onManual} />)}
      </ol>
    </div>}
  </section>
}

function LinhaResolver({ item, catalogo, onVincular, onManual }: { item: Linha; catalogo: CatalogoItem[]; onVincular: (uid: string, item: CatalogoItem) => void; onManual: (uid: string, valor: number) => void }) {
  const [editing, setEditing] = useState(false)
  const [mode, setMode] = useState<'catalogo' | 'manual'>('catalogo')
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [price, setPrice] = useState('')
  const [error, setError] = useState('')
  const origin = item.origem_projeto3d!
  const pending = origin.resolution === 'pendente'
  const linkedCatalog = origin.resolution === 'vinculado' ? catalogo.find(row => row.id === item.catalogo_id) : null
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  const matches = editing ? catalogo.filter(row => row.ativo && normalize(`${row.nome_curto} ${row.nome_completo} ${row.categoria}`).includes(normalize(search))) : []
  const selected = catalogo.find(row => row.ativo && String(row.id) === selectedId)
  const manualPrice = Number(price.replace(',', '.'))
  return <li className="p-4 space-y-2.5">
    <div className="flex items-start gap-2.5"><span className="text-xs text-ink-faint tabular-nums pt-0.5">{origin.sequence}.</span><div className="min-w-0 flex-1"><p className="text-sm font-semibold text-ink break-words">{item.nome}</p><p className="text-[11px] text-ink-muted mt-0.5">{origin.floorName} · Quantidade: {item.qtd}</p></div>{!pending && <span className="flex items-center gap-1 text-xs font-medium text-accent"><Check className="h-3.5 w-3.5" />{origin.resolution === 'manual' ? 'Manual' : 'Vinculado'}</span>}</div>
    <button type="button" onClick={() => setEditing(value => !value)} aria-expanded={editing} className="text-xs font-semibold text-accent hover:underline">{editing ? 'Fechar conferência' : pending ? 'Conferir preço' : 'Alterar vínculo ou valor'}</button>
    {editing && <>
    <div className="flex gap-1 text-xs"><button type="button" onClick={() => setMode('catalogo')} className={`rounded-md px-2.5 py-1.5 ${mode === 'catalogo' ? 'bg-accent/10 text-accent font-semibold' : 'text-ink-muted hover:bg-bg'}`}>Vincular catálogo</button><button type="button" onClick={() => setMode('manual')} className={`rounded-md px-2.5 py-1.5 ${mode === 'manual' ? 'bg-accent/10 text-accent font-semibold' : 'text-ink-muted hover:bg-bg'}`}>Valor manual</button></div>
    {mode === 'catalogo' ? <div className="space-y-2">
      <label className="flex items-center gap-2 rounded-lg border border-border bg-bg px-2.5"><Search className="h-3.5 w-3.5 text-ink-faint" /><input className="min-w-0 w-full py-2 text-xs bg-transparent outline-none text-ink" aria-label={`Buscar catálogo para ${item.nome}`} placeholder="Buscar equipamento no catálogo" value={search} onChange={event => setSearch(event.target.value)} /></label>
      <div className="flex flex-col sm:flex-row gap-2"><select value={selectedId} onChange={event => setSelectedId(event.target.value)} aria-label={`Equipamento do catálogo para ${item.nome}`} className="min-w-0 flex-1 rounded-lg border border-border bg-bg px-2.5 py-2 text-xs text-ink"><option value="">Selecione a correspondência exata ({matches.length})</option>{matches.map(row => <option key={row.id} value={row.id}>{row.nome_curto} · {row.categoria}</option>)}</select><button type="button" disabled={!selected} onClick={() => { if (selected) { try { onVincular(item.uid, selected); setError(''); setEditing(false) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Não foi possível conferir o preço. Tente o valor manual.') } } }} className="flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"><Link2 className="h-3.5 w-3.5" />Aplicar preço</button></div>
    </div> : <div className="flex flex-col sm:flex-row gap-2"><label className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-bg px-3 text-xs text-ink-muted">R$<input type="number" min="0" step="1" className="w-full min-w-0 bg-transparent py-2 outline-none text-ink" aria-label={`Valor unitário de ${item.nome}`} value={price} placeholder="Valor por unidade" onChange={event => setPrice(event.target.value)} /></label><button type="button" disabled={!price.trim() || !Number.isFinite(manualPrice) || manualPrice < 0} onClick={() => { try { onManual(item.uid, manualPrice); setError(''); setEditing(false) } catch (cause) { setError(cause instanceof Error ? cause.message : 'Informe um valor manual válido.') } }} className="rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">Confirmar valor manual</button></div>}
    {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-800">{error}</p>}
    </>}
    {linkedCatalog && <p className="text-xs text-ink-muted">Cadastro: <span className="font-medium text-ink">{linkedCatalog.nome_curto}</span></p>}
    {!pending && <p className="text-xs text-ink-muted">Valor unitário: {item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>}
  </li>
}
