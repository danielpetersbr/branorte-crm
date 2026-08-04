import { useState } from 'react'
import { useViagens, useExcluirViagem, useDuplicarViagem, type ViagemStatus } from '@/hooks/useViagens'

// §19 do spec — abrir de novo, duplicar, excluir com confirmação.
// Sem esta tela os hooks de persistência ficam órfãos: dava pra salvar e nunca
// mais achar a viagem.

const STATUS_ROTULO: Record<ViagemStatus, { texto: string; cor: string }> = {
  rascunho:                { texto: 'Rascunho',              cor: '#64748b' },
  aguardando_localizacoes: { texto: 'Aguardando localização', cor: '#d97706' },
  aguardando_confirmacoes: { texto: 'Aguardando confirmação', cor: '#d97706' },
  pronta:                  { texto: 'Pronta',                cor: '#16a34a' },
  em_andamento:            { texto: 'Em andamento',          cor: '#2563eb' },
  concluida:               { texto: 'Concluída',             cor: '#16a34a' },
  cancelada:               { texto: 'Cancelada',             cor: '#dc2626' },
}

const dataBR = (iso: string | null) =>
  iso ? new Date(iso.length <= 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('pt-BR') : '—'

export function ViagensSalvas({
  viagemAtual, onFechar, onAbrir,
}: {
  viagemAtual: string | null
  onFechar: () => void
  onAbrir: (id: string) => void
}) {
  const { data: viagens = [], isLoading, isError, refetch } = useViagens()
  const excluir = useExcluirViagem()
  const duplicar = useDuplicarViagem()
  const [confirmar, setConfirmar] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  async function acao(fn: () => Promise<unknown>, msg: string) {
    setErro(null)
    try { await fn() } catch (e) { setErro(`${msg}: ${(e as Error).message}`) }
  }

  return (
    <div className="fixed inset-0 z-[1400] bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onFechar}>
      <div className="bg-surface w-full md:max-w-lg rounded-t-2xl md:rounded-2xl border border-border flex flex-col max-h-[82vh]" onClick={e => e.stopPropagation()}>
        <div className="shrink-0 flex items-center gap-2 p-3 border-b border-border">
          <span className="text-[15px]">📁</span>
          <div className="text-[15px] font-semibold text-ink">Viagens salvas</div>
          <span className="text-[12px] text-ink-muted">{viagens.length}</span>
          <button onClick={onFechar} className="ml-auto h-8 w-8 rounded-md text-ink-muted hover:bg-surface-2">✕</button>
        </div>

        {erro && <div className="shrink-0 px-3 py-2 text-[12px] text-red-600 border-b border-border">{erro}</div>}

        <div className="flex-1 min-h-0 overflow-y-auto p-2">
          {isLoading && <div className="p-4 text-[13px] text-ink-muted">Carregando…</div>}

          {isError && (
            <div className="p-4 text-[13px] text-ink-muted">
              Não consegui carregar.{' '}
              <button onClick={() => void refetch()} className="text-accent font-semibold">tentar de novo</button>
            </div>
          )}

          {!isLoading && !isError && viagens.length === 0 && (
            <div className="p-4 text-[13px] text-ink-muted leading-relaxed">
              Nenhuma viagem salva ainda. Monte o roteiro no painel e toque em <b>💾 Salvar</b> —
              depois ela aparece aqui pra reabrir, duplicar ou excluir.
            </div>
          )}

          <ul className="space-y-1.5">
            {viagens.map(v => {
              const st = STATUS_ROTULO[v.status] ?? STATUS_ROTULO.rascunho
              const atual = v.id === viagemAtual
              return (
                <li key={v.id} className={`rounded-lg border px-2.5 py-2 ${atual ? 'border-accent/50 bg-accent-bg/40' : 'border-border bg-surface'}`}>
                  <div className="flex items-start gap-2">
                    <button onClick={() => onAbrir(v.id)} className="min-w-0 flex-1 text-left">
                      <div className="text-[13px] font-semibold text-ink truncate">
                        {v.nome}{atual && <span className="ml-1.5 text-[10px] font-bold text-accent">· aberta</span>}
                      </div>
                      <div className="text-[11px] text-ink-muted">
                        {v.paradas} parada{v.paradas === 1 ? '' : 's'} · {v.dias} dia{v.dias === 1 ? '' : 's'}
                        {v.data_inicio && ` · a partir de ${dataBR(v.data_inicio)}`}
                      </div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold"
                              style={{ backgroundColor: st.cor + '22', color: st.cor }}>
                          {st.texto}
                        </span>
                        <span className="text-[10px] text-ink-faint">criada {dataBR(v.created_at)}</span>
                      </div>
                    </button>

                    <div className="flex flex-col gap-0.5 shrink-0">
                      <button
                        onClick={() => void acao(async () => { const novo = await duplicar.mutateAsync(v.id); onAbrir(novo) }, 'Não consegui duplicar')}
                        disabled={duplicar.isPending}
                        title="Duplicar (a cópia nasce rascunho, sem as confirmações)"
                        className="h-6 w-6 rounded text-ink-faint hover:bg-surface-2 text-[12px] disabled:opacity-40">⧉</button>
                      <button
                        onClick={() => setConfirmar(v.id)}
                        title="Excluir"
                        className="h-6 w-6 rounded text-ink-faint hover:bg-surface-2 text-[12px]">✕</button>
                    </div>
                  </div>

                  {confirmar === v.id && (
                    <div className="mt-2 pt-2 border-t border-border">
                      <div className="text-[11.5px] text-ink leading-snug">
                        Excluir <b>{v.nome}</b> e as {v.paradas} parada{v.paradas === 1 ? '' : 's'} dela? Não dá pra desfazer.
                      </div>
                      <div className="mt-1.5 flex gap-1.5">
                        <button
                          onClick={() => void acao(async () => { await excluir.mutateAsync(v.id); setConfirmar(null) }, 'Não consegui excluir')}
                          disabled={excluir.isPending}
                          className="h-7 px-3 rounded-md bg-red-600 text-white text-[11.5px] font-semibold disabled:opacity-50">
                          {excluir.isPending ? 'Excluindo…' : 'Excluir'}
                        </button>
                        <button onClick={() => setConfirmar(null)}
                                className="h-7 px-3 rounded-md bg-surface border border-border text-[11.5px] font-semibold text-ink">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        </div>

        <div className="shrink-0 border-t border-border px-3 py-2 text-[10.5px] text-ink-faint leading-snug">
          Abrir uma viagem substitui o que está no painel agora. Salve antes se não quiser perder.
        </div>
      </div>
    </div>
  )
}
