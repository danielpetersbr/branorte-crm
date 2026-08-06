import { useMemo, useState } from 'react'
import { Settings2, Plus, X, Check, Tag } from 'lucide-react'
import { cn } from '@/lib/utils'
import { corDaEtiqueta, ETIQUETAS_OCULTAS } from '@/lib/wa-funil'
import {
  useContatosEtiquetas, useCrmEtiquetas, useCriarEtiqueta, useEditarEtiqueta,
  useEtiquetaPrefs, CORES_ETIQUETA, hexDaCor, estiloEtiqueta, type ChipEtiqueta,
} from '@/hooks/useCrmEtiquetas'
import type { ContactFilters } from '@/types'

// Barra de chips no topo de /contatos: cada etiqueta com quantos contatos tem
// DENTRO dos filtros atuais. Clicar filtra; clicar de novo limpa.
//
// A contagem vem de contatos_etiquetas_resumo, que recebe os mesmos filtros da
// lista. A RPC anterior não recebia nenhum — por isso filtrar por vendedor mudava
// a lista e deixava os números dos chips no total geral.
//
// Chips do CRM levam um ponto na frente: são internos e NÃO existem no WhatsApp
// do cliente.

function chaveDoChip(c: ChipEtiqueta) { return `${c.origem}:${c.etiqueta}` }

export function BarraEtiquetas({
  filters, onEscolher,
}: {
  filters: ContactFilters
  onEscolher: (etiqueta: string) => void
}) {
  const { data: chips, isLoading } = useContatosEtiquetas(filters)
  const { data: etiquetasCrm } = useCrmEtiquetas()
  const { ocultas, salvar } = useEtiquetaPrefs()
  const criar = useCriarEtiqueta()
  const editar = useEditarEtiqueta()

  const [gerindo, setGerindo] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novaCor, setNovaCor] = useState<string>('azul')
  const [erro, setErro] = useState('')

  // ETIQUETAS_OCULTAS são as de sistema do WhatsApp (GRUPOS, FAVORITOS…). A coluna
  // já as esconde; um chip delas prometeria uma lista que a tela não representa.
  const todos = useMemo(
    () => (chips ?? []).filter(c => !(c.origem === 'wa' && ETIQUETAS_OCULTAS.has(c.etiqueta))),
    [chips])

  const visiveis = useMemo(
    () => todos.filter(c => !ocultas.includes(chaveDoChip(c))),
    [todos, ocultas])

  function hexDoChip(c: ChipEtiqueta): string {
    return c.origem === 'crm'
      ? hexDaCor(etiquetasCrm?.find(e => e.nome === c.etiqueta)?.cor ?? 'cinza')
      : corDaEtiqueta(c.etiqueta)
  }

  async function alternarVisibilidade(c: ChipEtiqueta) {
    const k = chaveDoChip(c)
    await salvar(ocultas.includes(k) ? ocultas.filter(x => x !== k) : [...ocultas, k])
  }

  async function criarEtiqueta() {
    setErro('')
    const nome = novoNome.trim()
    if (nome.length < 2) { setErro('Dê um nome com pelo menos 2 letras.'); return }
    try {
      await criar.mutateAsync({ nome, cor: novaCor })
      setNovoNome('')
    } catch (e: any) {
      setErro(e?.message ?? 'Não consegui criar a etiqueta.')
    }
  }

  if (isLoading) {
    return <div className="h-7 flex items-center text-[12px] text-ink-faint mb-3">Contando etiquetas…</div>
  }
  if (!todos.length) return null

  const ativa = filters.etiqueta

  return (
    <div className="mb-3">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase font-bold tracking-wider text-ink-faint mr-0.5">Etiquetas</span>

        {visiveis.map(c => {
          const selecionado = ativa === c.etiqueta
          const hex = hexDoChip(c)
          return (
            <button key={chaveDoChip(c)} onClick={() => onEscolher(selecionado ? '' : c.etiqueta)}
              title={c.origem === 'crm'
                ? `${c.etiqueta} — etiqueta do CRM (não vai pro WhatsApp)`
                : `${c.etiqueta} — etiqueta do WhatsApp`}
              style={selecionado ? undefined : estiloEtiqueta(hex)}
              className={cn(
                'inline-flex items-center gap-1.5 h-7 pl-2 pr-1.5 rounded-md text-[12px] transition-all',
                selecionado && 'bg-accent text-white font-semibold ring-2 ring-accent/40',
              )}>
              {c.origem === 'crm' && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70 shrink-0" />}
              <span className="truncate max-w-[160px]">{c.etiqueta}</span>
              <span className="tabular-nums font-mono text-[11px] px-1 rounded bg-black/10 dark:bg-white/15">
                {c.contatos}
              </span>
            </button>
          )
        })}

        {ativa && (
          <button onClick={() => onEscolher('')}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border text-[12px] text-ink-muted hover:text-ink">
            <X className="h-3 w-3" /> limpar
          </button>
        )}

        <button onClick={() => setGerindo(v => !v)} title="Escolher quais etiquetas aparecem e criar novas"
          className={cn('inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[12px] transition-all',
            gerindo ? 'border-accent text-accent bg-accent/10' : 'border-border text-ink-muted hover:text-ink')}>
          <Settings2 className="h-3.5 w-3.5" />
          {ocultas.length > 0 && <span className="tabular-nums">{ocultas.length} oculta{ocultas.length > 1 ? 's' : ''}</span>}
        </button>
      </div>

      {gerindo && (
        <div className="mt-2.5 rounded-lg border border-border bg-surface-2 p-3.5">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">Organizar etiquetas</p>
              <p className="text-[12px] text-ink-muted mt-0.5 max-w-2xl leading-snug">
                Desmarque as que você não quer ver na barra — vale só pra você. As
                etiquetas do CRM (as que têm um pontinho) são criadas aqui e
                <strong className="text-ink"> não vão pro WhatsApp do cliente</strong>;
                as outras vêm das conversas.
              </p>
            </div>
            <button onClick={() => setGerindo(false)} className="text-ink-muted hover:text-ink shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4">
            {todos.map(c => {
              const k = chaveDoChip(c)
              const on = !ocultas.includes(k)
              return (
                <button key={k} onClick={() => alternarVisibilidade(c)}
                  style={on ? estiloEtiqueta(hexDoChip(c)) : undefined}
                  className={cn('inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] transition-all',
                    !on && 'border border-border text-ink-faint line-through opacity-70')}>
                  {on ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                  {c.origem === 'crm' && <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />}
                  {c.etiqueta}
                  <span className="tabular-nums font-mono text-[11px] opacity-70">{c.contatos}</span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-[12px] font-semibold text-ink mb-2 flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-accent" /> Criar etiqueta do CRM
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={novoNome} onChange={e => { setNovoNome(e.target.value); setErro('') }}
                onKeyDown={e => { if (e.key === 'Enter') criarEtiqueta() }}
                placeholder="Ex.: 3a tentativa" maxLength={40}
                className="h-8 w-[210px] rounded-md border border-border bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent" />
              <div className="flex gap-1">
                {CORES_ETIQUETA.map(c => (
                  <button key={c.v} onClick={() => setNovaCor(c.v)} title={c.label}
                    style={{ backgroundColor: c.hex }}
                    className={cn('h-6 w-6 rounded transition-all',
                      novaCor === c.v ? 'ring-2 ring-accent ring-offset-2 ring-offset-surface-2' : 'opacity-70 hover:opacity-100')} />
                ))}
              </div>
              <button onClick={criarEtiqueta} disabled={criar.isPending}
                className="h-8 px-3 rounded-md bg-accent text-white text-[12.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-50">
                <Plus className="h-3.5 w-3.5" /> {criar.isPending ? 'Criando…' : 'Criar'}
              </button>
            </div>
            {erro && <p className="text-[12px] text-danger mt-2">{erro}</p>}

            {!!etiquetasCrm?.length && (
              <div className="mt-3">
                <p className="text-[11px] uppercase font-bold tracking-wider text-ink-faint mb-1.5">
                  Etiquetas do CRM ({etiquetasCrm.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {etiquetasCrm.map(e => (
                    <span key={e.id} style={estiloEtiqueta(hexDaCor(e.cor))}
                      className="inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-70" />
                      {e.nome}
                      <button title="Arquivar — some da lista, mas os contatos continuam marcados"
                        onClick={() => editar.mutate({ id: e.id, ativa: false })}
                        className="opacity-60 hover:opacity-100">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
