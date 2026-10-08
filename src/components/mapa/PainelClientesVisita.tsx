import type { Visita } from '@/hooks/useVisitas'
import { useIsMobile } from '@/hooks/useIsMobile'
import { useState } from 'react'
import { copiarTexto, vendedorVisitaCorresponde } from '@/lib/visitas-whatsapp'
import { MapaDialog } from './MapaDialog'

interface Props {
  visitas: Visita[]
  loading: boolean
  error?: string
  saveError?: string
  saving: boolean
  role?: string
  vendedorLogado: string | null
  meuVendedor: string | null
  vendedorSel: string
  soMarcados: boolean
  onVendedor: (vendedor: string) => void
  onFiltro: (marcados: boolean) => void
  onMarcar: (id: string, visitar: boolean) => void
  onFocar: (visita: Visita) => void
  onClose: () => void
}

export function PainelClientesVisita({
  visitas, loading, error, saveError, saving, role, vendedorLogado, meuVendedor,
  vendedorSel, soMarcados, onVendedor, onFiltro, onMarcar, onFocar, onClose,
}: Props) {
  const mobile = useIsMobile()
  const [copiado, setCopiado] = useState<string | null>(null)
  async function copiar(id: string, telefone: string) {
    if (!(await copiarTexto(telefone))) return
    setCopiado(id)
    window.setTimeout(() => setCopiado(c => (c === id ? null : c)), 1800)
  }
  // Desmarcar tira o cliente da lista de visita do vendedor — clique sem querer
  // some com ele do filtro. Marcar não pergunta nada.
  function trocarVisita(v: Visita, visitar: boolean) {
    if (!visitar && !window.confirm(`Deseja desmarcar Pode visitar para ${v.nome || v.telefone || 'este cliente'}?`)) return
    onMarcar(v.id, visitar)
  }
  const meus = !!vendedorSel && vendedorSel === (meuVendedor || '__meus__')
  const semLocalizacao = visitas.filter(v => v.lat == null || v.lng == null).length
  const content = <>
    <div className="shrink-0 border-b border-border p-3">
      <div className="flex items-center gap-2">
        <h2 className="flex-1 text-sm font-semibold text-ink">📍 Clientes para visitar</h2>
        <button type="button" onClick={onClose} aria-label="Fechar contatos"
          className="h-8 w-8 rounded-lg text-ink-muted hover:bg-surface-2 hover:text-ink">✕</button>
      </div>
      <div className="mt-2 flex gap-1.5">
        <button type="button" onClick={() => onVendedor(meuVendedor || '__meus__')} aria-pressed={meus}
          className={`h-8 rounded-md border px-2 text-xs font-semibold ${meus ? 'bg-accent-bg border-accent/40 text-accent' : 'border-border text-ink-muted hover:text-ink'}`}>Só os meus</button>
        <button type="button" onClick={() => onVendedor('')} aria-pressed={!vendedorSel}
          className={`h-8 rounded-md border px-2 text-xs font-semibold ${!vendedorSel ? 'bg-accent-bg border-accent/40 text-accent' : 'border-border text-ink-muted hover:text-ink'}`}>Todos os vendedores</button>
      </div>
      {mobile && <label className="mt-3 flex items-center gap-2 text-xs text-ink-muted">
        <input type="checkbox" checked={soMarcados} onChange={e => onFiltro(e.target.checked)} />
        Só marcados para visitar
      </label>}
      <p className="mt-2 text-xs text-ink-muted">{visitas.length} clientes{semLocalizacao > 0 && ` · ${semLocalizacao} sem localização`}</p>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto p-3 pb-safe space-y-2">
      {vendedorSel === '__meus__' && <p className="text-xs text-warning">Não foi possível identificar seu vendedor. Configure seu nome na extensão ou escolha um vendedor no mapa.</p>}
      {error && <p role="alert" className="text-sm text-red-600">Não foi possível carregar os clientes: {error}</p>}
      {saveError && <p role="alert" className="text-sm text-red-600">Não foi possível salvar: {saveError}</p>}
      {loading && <p className="text-sm text-ink-muted">Carregando clientes…</p>}
      {!loading && !error && visitas.length === 0 && <p className="text-sm text-ink-muted">Nenhum cliente neste filtro.</p>}
      {visitas.map(v => {
        const podeEditar = role === 'admin' || (role === 'vendor' && !!vendedorLogado && vendedorVisitaCorresponde(v.vendedor_nome, vendedorLogado))
        const temLocalizacao = v.lat != null && v.lng != null
        const tel = (v.telefone || '').replace(/\D/g, '')
        return <div key={v.id} className="rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
          <button type="button" disabled={!temLocalizacao}
            className="text-left font-semibold text-ink hover:text-accent disabled:cursor-default disabled:hover:text-ink break-words"
            onClick={() => { onFocar(v); if (mobile) onClose() }}>
            {v.nome || v.telefone || 'Sem nome'}
          </button>
          {v.telefone && <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-ink-muted">{v.telefone}</span>
            <button type="button" onClick={() => copiar(v.id, tel || v.telefone!)}
              title="Copiar o telefone pra procurar a conversa no WhatsApp"
              className="h-7 rounded-md border border-border px-2 font-semibold text-ink hover:bg-surface-2">
              {copiado === v.id ? '✓ Copiado' : '📋 Copiar'}
            </button>
            {tel && <a href={`https://wa.me/${tel}`} target="_blank" rel="noopener"
              className="h-7 rounded-md border border-border px-2 font-semibold leading-7 text-accent hover:bg-surface-2">WhatsApp ↗</a>}
          </div>}
          <p className="mt-1 text-xs text-ink-muted">{[v.cidade, v.estado].filter(Boolean).join(' / ') || 'Cidade não informada'} · {v.vendedor_nome || 'Sem vendedor'}</p>
          {v.vendido && <p className="mt-1 text-xs font-semibold text-blue-500">✓ VENDIDO · já comprou</p>}
          {!temLocalizacao && <p className="mt-1 text-xs text-warning">Sem localização no mapa</p>}
          <label className="mt-2 flex items-center gap-2 text-xs text-ink-muted">
            <input type="checkbox" aria-label={`Pode visitar ${v.nome || v.telefone || 'cliente'}`} checked={v.visitar === true}
              disabled={!podeEditar || saving} onChange={e => trocarVisita(v, e.target.checked)} />
            Pode visitar{!podeEditar && ' · somente consulta'}
          </label>
        </div>
      })}
    </div>
  </>
  return mobile ? <MapaDialog title="Clientes para visitar" onClose={onClose}
    className="!left-auto !right-0 !top-0 !h-[100dvh] !max-h-[100dvh] !w-[min(340px,calc(100vw-1rem))] !translate-x-0 !translate-y-0 !rounded-none">
    {content}
  </MapaDialog> : <aside aria-label="Clientes para visitar"
    className="flex w-[320px] min-w-0 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface">
    {content}
  </aside>
}
