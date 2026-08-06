import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Tag, Plus, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  useCrmEtiquetas, useAplicarEtiqueta, useCriarEtiqueta,
  CORES_ETIQUETA, hexDaCor, estiloEtiqueta, type CrmEtiqueta,
} from '@/hooks/useCrmEtiquetas'

// Botão por linha: aplica/remove as etiquetas do CRM naquele contato.
//
// Só mexe em crm_contato_etiquetas — nada aqui encosta na etiqueta do WhatsApp,
// que é da extensão e representa o que o vendedor marcou na conversa real.
//
// O menu vai em portal porque a linha da tabela tem overflow: dentro dela o
// popover seria cortado na borda da célula.

export function BotaoEtiquetar({
  contactId, aplicadas, compacto,
}: {
  contactId: string
  aplicadas: CrmEtiqueta[]
  compacto?: boolean
}) {
  const [aberto, setAberto] = useState(false)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const [criando, setCriando] = useState(false)
  const [nome, setNome] = useState('')
  const [cor, setCor] = useState('azul')
  const [erro, setErro] = useState('')
  const botaoRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const { data: etiquetas } = useCrmEtiquetas()
  const aplicar = useAplicarEtiqueta()
  const criar = useCriarEtiqueta()

  const idsAplicados = new Set(aplicadas.map(e => e.id))

  useEffect(() => {
    if (!aberto) return
    const fora = (ev: MouseEvent) => {
      const t = ev.target as Node
      if (menuRef.current?.contains(t) || botaoRef.current?.contains(t)) return
      setAberto(false); setCriando(false)
    }
    const esc = (ev: KeyboardEvent) => { if (ev.key === 'Escape') { setAberto(false); setCriando(false) } }
    document.addEventListener('mousedown', fora)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fora); document.removeEventListener('keydown', esc) }
  }, [aberto])

  function abrir() {
    const r = botaoRef.current?.getBoundingClientRect()
    if (!r) return
    // 300px é a altura típica do menu; perto do rodapé ele sobe em vez de sair da tela.
    const espacoAbaixo = window.innerHeight - r.bottom
    setPos({ x: Math.min(r.left, window.innerWidth - 280), y: espacoAbaixo > 320 ? r.bottom + 4 : r.top - 304 })
    setAberto(true)
  }

  async function criarEAplicar() {
    setErro('')
    const n = nome.trim()
    if (n.length < 2) { setErro('Nome muito curto.'); return }
    try {
      await criar.mutateAsync({ nome: n, cor })
      setNome(''); setCriando(false)
    } catch (e: any) {
      setErro(e?.message ?? 'Não consegui criar.')
    }
  }

  return (
    <>
      {/* Neutro por padrão MESMO com etiquetas aplicadas: ele se repete uma vez
          por linha (até 50 por página) e, pintado de accent, virava uma coluna
          de blocos verdes competindo com as próprias etiquetas — que são a
          informação. Quem sinaliza "tem etiqueta do CRM" são os SelosCrm ao
          lado. Verde só quando o menu está ABERTO (elemento ativo). */}
      <button ref={botaoRef} onClick={e => { e.stopPropagation(); aberto ? setAberto(false) : abrir() }}
        title="Etiquetar no CRM (não vai pro WhatsApp)"
        aria-label="Etiquetar no CRM"
        aria-expanded={aberto}
        className={cn(
          'inline-flex items-center justify-center rounded-md border transition-colors duration-150 shrink-0',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          compacto ? 'h-6 w-6' : 'h-7 w-7',
          aberto
            ? 'border-accent/50 text-accent bg-accent-bg'
            : 'border-border text-ink-faint hover:text-accent hover:border-accent/40 hover:bg-accent-bg/70',
        )}>
        <Tag className={compacto ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
      </button>

      {aberto && pos && createPortal(
        <div ref={menuRef} style={{ left: pos.x, top: pos.y }}
          className="fixed z-50 w-[272px] rounded-lg border border-border bg-surface shadow-xl p-2.5">
          <p className="text-[10px] uppercase font-bold tracking-wider text-ink-faint px-1 mb-1.5">
            Etiquetas do CRM
          </p>

          <div className="max-h-[220px] overflow-y-auto space-y-0.5">
            {!etiquetas?.length && (
              <p className="text-[12px] text-ink-muted px-1 py-2 leading-snug">
                Nenhuma etiqueta criada ainda. Crie a primeira aqui embaixo.
              </p>
            )}
            {etiquetas?.map(e => {
              const on = idsAplicados.has(e.id)
              return (
                <button key={e.id}
                  onClick={() => aplicar.mutate({ contactId, etiquetaId: e.id, aplicar: !on })}
                  className={cn('w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-[13px] text-left transition-all',
                    on ? 'bg-accent/10' : 'hover:bg-surface-2')}>
                  <span className={cn('h-4 w-4 rounded border flex items-center justify-center shrink-0',
                    on ? 'bg-accent border-accent' : 'border-border')}>
                    {on && <Check className="h-3 w-3 text-white" />}
                  </span>
                  {/* `.etq-dot` e não o hex cru: os hues foram calibrados pra
                      serem legíveis sobre branco, então como mancha no tema
                      escuro sumiriam. (Os quadradinhos do seletor de cor logo
                      abaixo seguem com o hex puro — ali a cor É a informação.) */}
                  <span className="etq-dot h-2.5 w-2.5 rounded-full shrink-0" style={estiloEtiqueta(hexDaCor(e.cor))} />
                  <span className="truncate text-ink">{e.nome}</span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-border mt-2 pt-2">
            {!criando ? (
              <button onClick={() => setCriando(true)}
                className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-[12.5px] text-accent hover:bg-accent/10">
                <Plus className="h-3.5 w-3.5" /> Criar etiqueta nova
              </button>
            ) : (
              <div className="px-1 space-y-2">
                <input autoFocus value={nome} onChange={ev => { setNome(ev.target.value); setErro('') }}
                  onKeyDown={ev => { if (ev.key === 'Enter') criarEAplicar() }}
                  placeholder="Ex.: 3a tentativa" maxLength={40}
                  className="w-full h-8 rounded-md border border-border bg-surface-2 px-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent" />
                <div className="flex gap-1">
                  {CORES_ETIQUETA.map(c => (
                    /* ver BarraEtiquetas: `.etq-dot` da o tom real de cada tema.
                        `opacity-70` saiu — derrubava o quadradinho pra 1,7:1 no escuro,
                        e aqui nem havia hover:opacity-100 pra recuperar. */
                    <button key={c.v} onClick={() => setCor(c.v)} title={c.label}
                      style={estiloEtiqueta(c.hex)}
                      className={cn('etq-dot h-5 w-5 rounded transition-all',
                        cor === c.v && 'ring-2 ring-accent ring-offset-1 ring-offset-surface')} />
                  ))}
                </div>
                {erro && <p className="text-[11.5px] text-danger">{erro}</p>}
                <div className="flex gap-1.5">
                  <button onClick={criarEAplicar} disabled={criar.isPending}
                    className="flex-1 h-7 rounded-md bg-accent text-white text-[12px] font-semibold disabled:opacity-50">
                    {criar.isPending ? 'Criando…' : 'Criar'}
                  </button>
                  <button onClick={() => { setCriando(false); setErro('') }}
                    className="h-7 px-2.5 rounded-md border border-border text-[12px] text-ink-muted">
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>

          <p className="text-[11px] text-ink-faint leading-snug px-1 pt-2 mt-1 border-t border-border">
            Fica só no CRM. Não aparece no WhatsApp do cliente.
          </p>
        </div>,
        document.body,
      )}
    </>
  )
}

/** Os selos das etiquetas do CRM, pra mostrar junto com a do WhatsApp na lista. */
export function SelosCrm({ etiquetas }: { etiquetas: CrmEtiqueta[] }) {
  if (!etiquetas.length) return null
  return (
    <>
      {etiquetas.map(e => (
        <span key={e.id} style={estiloEtiqueta(hexDaCor(e.cor))}
          title={`${e.nome} — etiqueta do CRM (não vai pro WhatsApp)`}
          className="etq-soft inline-flex items-center gap-1 h-[20px] px-2 rounded-md text-[10px] font-medium whitespace-nowrap max-w-[130px]">
          {/* sem `opacity-70`: o dot caia pra 2,95:1 no claro (CRM amarelo) */}
          <span className="w-1 h-1 rounded-full bg-current shrink-0" />
          <span className="truncate">{e.nome}</span>
        </span>
      ))}
    </>
  )
}
