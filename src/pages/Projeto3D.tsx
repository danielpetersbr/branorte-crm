// /projeto-3d — Configurador de fábrica em 3D embutido, COM projetos salvos no CRM.
// O configurador (branorte-configurador-3d.vercel.app) roda no iframe; o CRM é dono da
// persistência: os projetos vão pra tabela configurador_projetos (Supabase), então
// sincronizam entre dispositivos e podem ficar ligados a um cliente. A conversa com o
// iframe é via postMessage (ver src/lib/embedBridge.ts do configurador):
//   Salvar  → pede o projeto atual (branorte:get) e grava no Supabase.
//   Abrir   → busca o JSON e manda pro iframe (branorte:load), que vai pro editor.
//   Novo    → manda o iframe abrir um editor vazio (branorte:new).
import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Boxes, Maximize2, RefreshCw, Save, FolderOpen, Plus, Trash2,
  ChevronDown, X, Search, Check, Loader2,
} from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  useConfiguradorProjetos, useSalvarConfiguradorProjeto, useDeletarConfiguradorProjeto,
  useBuscarContatos, fetchConfiguradorProjeto, type ConfiguradorProjetoMeta,
  bridgeList, bridgeLoad, bridgeSave, bridgeDelete, bridgeThumb,
} from '@/hooks/useConfiguradorProjetos'
import {
  fetchConfiguradorBlocos, upsertConfiguradorBloco, deleteConfiguradorBloco,
} from '@/hooks/useConfiguradorBlocos'
import {
  fetchConfiguradorModelos, saveConfiguradorModelo, deleteConfiguradorModelo,
} from '@/hooks/useConfiguradorModelos'

const CONFIGURADOR_ORIGIN = 'https://branorte-configurador-3d.vercel.app'
const CONFIGURADOR_URL = CONFIGURADOR_ORIGIN

const rid = () => Math.random().toString(36).slice(2)
const fmtData = (s: string) =>
  new Date(s).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' })

export function Projeto3D() {
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [loading, setLoading] = useState(true)

  // Projeto salvo atualmente aberto (null = ainda não salvo / novo)
  const [projetoId, setProjetoId] = useState<string | null>(null)
  const [projetoNome, setProjetoNome] = useState('')

  const [showLista, setShowLista] = useState(false)
  const [toast, setToast] = useState<{ msg: string; erro?: boolean } | null>(null)

  // Modal de salvar
  const [saveOpen, setSaveOpen] = useState(false)
  const [saveNome, setSaveNome] = useState('')
  const [saveContactId, setSaveContactId] = useState<string | null>(null)
  const [saveContactNome, setSaveContactNome] = useState<string | null>(null)
  const [saveBusca, setSaveBusca] = useState('')
  const projetoDataRef = useRef<unknown>(null)

  const { profile } = useAuth()
  const profileRef = useRef(profile)
  useEffect(() => { profileRef.current = profile }, [profile])
  const qc = useQueryClient()
  // Papel passado pro iframe: só ADMIN vê o botão "Catálogo de Produtos" no configurador (vendedor não).
  const iframeSrc = `${CONFIGURADOR_URL}?adm=${profile?.role === 'admin' ? '1' : '0'}`
  const { data: projetos, isLoading: loadingLista } = useConfiguradorProjetos()
  const salvar = useSalvarConfiguradorProjeto()
  const deletar = useDeletarConfiguradorProjeto()
  const { data: contatos } = useBuscarContatos(saveBusca)

  const flash = useCallback((msg: string, erro = false) => {
    setToast({ msg, erro })
    window.setTimeout(() => setToast(null), 2600)
  }, [])

  // ---- postMessage: espera respostas do iframe (branorte:project) por requestId ----
  const pendings = useRef(new Map<string, (project: unknown) => void>())
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== CONFIGURADOR_ORIGIN) return
      const m = e.data
      if (!m || typeof m !== 'object') return
      if (m.type === 'branorte:project' && m.requestId) {
        const fn = pendings.current.get(m.requestId)
        if (fn) { pendings.current.delete(m.requestId); fn(m.project) }
      } else if (m.type === 'branorte:ready') {
        // iframe subiu → manda os BLOCOS PERSONALIZADOS e os MODELOS IMPORTADOS salvos (Supabase) pro catálogo dele
        fetchConfiguradorBlocos()
          .then((defs) => frameRef.current?.contentWindow?.postMessage({ type: 'branorte:blocks:load', defs }, CONFIGURADOR_ORIGIN))
          .catch(() => {})
        fetchConfiguradorModelos()
          .then((defs) => frameRef.current?.contentWindow?.postMessage({ type: 'branorte:models:load', defs }, CONFIGURADOR_ORIGIN))
          .catch(() => {})
      } else if (m.type === 'branorte:model:save' && m.requestId) {
        // MODELO IMPORTADO (GLB/STL): sobe o binário no Storage e grava a def compartilhada.
        // Responde com branorte:store:result (formato que o crmRequest do configurador espera).
        void (async () => {
          try {
            const assetUrl = await saveConfiguradorModelo({
              def: m.def, buffer: m.buffer as ArrayBuffer, format: m.format === 'stl' ? 'stl' : 'glb',
              thumb: typeof m.def?.thumb === 'string' ? m.def.thumb : null,
              createdBy: profileRef.current?.id ?? null, createdByNome: profileRef.current?.display_name ?? null,
            })
            frameRef.current?.contentWindow?.postMessage(
              { type: 'branorte:store:result', requestId: m.requestId, ok: true, assetUrl },
              CONFIGURADOR_ORIGIN,
            )
          } catch (err) {
            frameRef.current?.contentWindow?.postMessage(
              { type: 'branorte:store:result', requestId: m.requestId, ok: false, error: String((err as Error)?.message ?? err) },
              CONFIGURADOR_ORIGIN,
            )
          }
        })()
      } else if (m.type === 'branorte:model:delete' && m.id) {
        deleteConfiguradorModelo(String(m.id)).catch(() => {})
      } else if (m.type === 'branorte:block:upsert' && m.def) {
        // usuário criou/editou um bloco no configurador → grava no Supabase (compartilhado pela equipe)
        upsertConfiguradorBloco(m.def, profileRef.current?.id ?? null, profileRef.current?.display_name ?? null).catch(() => {})
      } else if (m.type === 'branorte:block:delete' && m.id) {
        deleteConfiguradorBloco(String(m.id)).catch(() => {})
      } else if (typeof m.type === 'string' && m.type.startsWith('branorte:store:') && m.requestId) {
        // GALERIA COMPARTILHADA: a tela inicial do configurador lista/salva/abre/exclui
        // projetos daqui (Supabase) via RPC postMessage — o iframe não tem sessão própria.
        const reply = (extra: Record<string, unknown>) =>
          frameRef.current?.contentWindow?.postMessage(
            { type: 'branorte:store:result', requestId: m.requestId, ok: true, ...extra },
            CONFIGURADOR_ORIGIN,
          )
        const fail = (err: unknown) =>
          frameRef.current?.contentWindow?.postMessage(
            { type: 'branorte:store:result', requestId: m.requestId, ok: false, error: String((err as Error)?.message ?? err) },
            CONFIGURADOR_ORIGIN,
          )
        void (async () => {
          try {
            if (m.type === 'branorte:store:list') {
              const items = await bridgeList()
              reply({ items, meId: profileRef.current?.id ?? null, meNome: profileRef.current?.display_name ?? null })
            } else if (m.type === 'branorte:store:load') {
              reply({ project: await bridgeLoad(String(m.id)) })
            } else if (m.type === 'branorte:store:save') {
              await bridgeSave(m.project, typeof m.thumbnail === 'string' ? m.thumbnail : null, {
                id: profileRef.current?.id ?? null,
                nome: profileRef.current?.display_name ?? null,
              })
              qc.invalidateQueries({ queryKey: ['configurador-projetos'] })
              reply({})
            } else if (m.type === 'branorte:store:delete') {
              await bridgeDelete(String(m.id))
              qc.invalidateQueries({ queryKey: ['configurador-projetos'] })
              reply({})
            } else {
              fail('tipo de mensagem desconhecido')
            }
          } catch (err) {
            fail(err)
          }
        })()
      } else if (m.type === 'branorte:store:thumb' && typeof m.id === 'string' && typeof m.dataUrl === 'string') {
        bridgeThumb(m.id, m.dataUrl).catch(() => {})
      } else if (m.type === 'branorte:download' && (typeof m.dataUrl === 'string' || m.blob instanceof Blob)) {
        // "Bater foto" (imagem 4K) e "Vídeo" (webm): o Chrome bloqueia download iniciado dentro do
        // iframe cross-origin, então o configurador manda o arquivo pra cá e o CRM (top-level) baixa.
        const baixar = (blob: Blob) => {
          const url = URL.createObjectURL(blob)
          const link = document.createElement('a')
          link.download = typeof m.filename === 'string' ? m.filename : 'branorte-3d'
          link.href = url
          document.body.appendChild(link)
          link.click()
          link.remove()
          setTimeout(() => URL.revokeObjectURL(url), 15000)
        }
        if (m.blob instanceof Blob) baixar(m.blob)
        else fetch(m.dataUrl as string).then((r) => r.blob()).then(baixar).catch(() => flash('Falha ao baixar', true))
      }
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  const postToFrame = (msg: Record<string, unknown>) =>
    frameRef.current?.contentWindow?.postMessage(msg, CONFIGURADOR_ORIGIN)

  // Pede o projeto atual do iframe e resolve com o JSON (ou null se estiver na tela inicial).
  const pedirProjeto = () =>
    new Promise<unknown>((resolve, reject) => {
      const id = rid()
      const timer = window.setTimeout(() => {
        pendings.current.delete(id)
        reject(new Error('timeout'))
      }, 5000)
      pendings.current.set(id, (project) => { window.clearTimeout(timer); resolve(project) })
      postToFrame({ type: 'branorte:get', requestId: id })
    })

  // ---- Ações ----
  const abrirNovo = () => {
    postToFrame({ type: 'branorte:new' })
    setProjetoId(null)
    setProjetoNome('')
    setShowLista(false)
    flash('Editor vazio aberto')
  }

  const abrirSalvo = async (meta: ConfiguradorProjetoMeta) => {
    setShowLista(false)
    try {
      const full = await fetchConfiguradorProjeto(meta.id)
      postToFrame({ type: 'branorte:load', project: full.data })
      setProjetoId(meta.id)
      setProjetoNome(meta.nome)
      setSaveContactId(meta.contact_id)
      setSaveContactNome(meta.cliente_nome)
      flash(`Aberto: ${meta.nome}`)
    } catch {
      flash('Falha ao abrir o projeto', true)
    }
  }

  const iniciarSalvar = async () => {
    try {
      const project = await pedirProjeto()
      if (!project) {
        flash('Abra ou crie um projeto no editor antes de salvar', true)
        return
      }
      projetoDataRef.current = project
      const nomeInterno = (project as { name?: string })?.name
      setSaveNome(projetoNome || nomeInterno || 'Projeto sem nome')
      setSaveBusca('')
      setSaveOpen(true)
    } catch {
      flash('O configurador não respondeu — recarregue e tente de novo', true)
    }
  }

  const confirmarSalvar = () => {
    if (!projetoDataRef.current) return
    salvar.mutate(
      {
        id: projetoId,
        nome: saveNome.trim() || 'Projeto sem nome',
        contact_id: saveContactId,
        cliente_nome: saveContactNome,
        data: projetoDataRef.current,
        created_by: profile?.id ?? null,
        created_by_nome: profile?.display_name ?? null,
      },
      {
        onSuccess: (row) => {
          setProjetoId(row.id)
          setProjetoNome(row.nome)
          setSaveOpen(false)
          flash(projetoId ? 'Projeto atualizado' : 'Projeto salvo')
        },
        onError: () => flash('Erro ao salvar', true),
      },
    )
  }

  const removerProjeto = (e: React.MouseEvent, meta: ConfiguradorProjetoMeta) => {
    e.stopPropagation()
    if (!confirm(`Excluir o projeto "${meta.nome}"?`)) return
    deletar.mutate(meta.id, {
      onSuccess: () => {
        if (projetoId === meta.id) { setProjetoId(null); setProjetoNome('') }
        flash('Projeto excluído')
      },
      onError: () => flash('Erro ao excluir', true),
    })
  }

  const telaCheia = () => frameRef.current?.requestFullscreen?.().catch(() => {})
  const recarregar = () => {
    const el = frameRef.current
    if (!el) return
    setLoading(true)
    el.src = el.src
  }

  return (
    <div className="h-[calc(100dvh_-_4rem_-_env(safe-area-inset-bottom))] md:h-screen flex flex-col bg-bg">
      <header className="shrink-0 flex items-center justify-between gap-2 px-3 sm:px-4 py-2.5 border-b border-border bg-surface relative z-20">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-accent/10 flex items-center justify-center shrink-0">
            <Boxes className="h-5 w-5 text-accent" />
          </div>
          <div className="min-w-0 hidden sm:block">
            <h1 className="text-sm font-bold text-ink truncate leading-tight">
              Projeto 3D{projetoNome ? <span className="text-ink-muted font-medium"> · {projetoNome}</span> : ''}
            </h1>
            <p className="text-[11px] text-ink-faint truncate">Desenhe o galpão, monte os equipamentos e salve pro cliente</p>
          </div>

          {/* Projetos salvos */}
          <div className="relative">
            <button
              onClick={() => setShowLista(v => !v)}
              className="h-9 px-3 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg flex items-center gap-1.5 text-sm font-medium"
            >
              <FolderOpen className="h-4 w-4" />
              <span className="hidden sm:inline">Projetos</span>
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {showLista && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setShowLista(false)} />
                <div className="absolute left-0 top-full mt-1 w-[340px] max-w-[85vw] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-xl z-40 p-1.5">
                  <button
                    onClick={abrirNovo}
                    className="w-full flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm font-semibold text-accent hover:bg-accent/10"
                  >
                    <Plus className="h-4 w-4" /> Novo projeto (editor vazio)
                  </button>
                  <div className="h-px bg-border my-1" />
                  {loadingLista && <div className="px-3 py-4 text-center text-sm text-ink-faint">Carregando…</div>}
                  {!loadingLista && (!projetos || projetos.length === 0) && (
                    <div className="px-3 py-6 text-center text-sm text-ink-faint">Nenhum projeto salvo ainda.</div>
                  )}
                  {projetos?.map(p => (
                    <div
                      key={p.id}
                      onClick={() => abrirSalvo(p)}
                      className={`group flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer hover:bg-bg ${projetoId === p.id ? 'bg-accent/5' : ''}`}
                    >
                      <Boxes className="h-4 w-4 text-ink-faint shrink-0" />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-ink truncate flex items-center gap-1">
                          {p.nome}
                          {projetoId === p.id && <Check className="h-3.5 w-3.5 text-accent shrink-0" />}
                        </div>
                        <div className="text-[11px] text-ink-faint truncate">
                          {p.cliente_nome ? `${p.cliente_nome} · ` : ''}{fmtData(p.updated_at)}
                          {p.created_by_nome ? ` · ${p.created_by_nome}` : ''}
                        </div>
                      </div>
                      <button
                        onClick={(e) => removerProjeto(e, p)}
                        title="Excluir"
                        className="h-7 w-7 rounded-md text-ink-faint hover:text-red-500 hover:bg-red-500/10 flex items-center justify-center opacity-0 group-hover:opacity-100 shrink-0"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <button
            onClick={iniciarSalvar}
            className="h-9 px-3 rounded-lg bg-accent text-white hover:opacity-90 flex items-center gap-1.5 text-sm font-semibold"
          >
            <Save className="h-4 w-4" /> <span className="hidden sm:inline">Salvar</span>
          </button>
          <button onClick={recarregar} title="Recarregar" className="h-9 w-9 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg flex items-center justify-center">
            <RefreshCw className="h-4 w-4" />
          </button>
          <button onClick={telaCheia} title="Tela cheia" className="h-9 w-9 rounded-lg border border-border text-ink-muted hover:text-ink hover:bg-bg hidden sm:flex items-center justify-center">
            <Maximize2 className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-bg pointer-events-none z-10">
            <div className="flex flex-col items-center gap-2 text-ink-faint">
              <Boxes className="h-8 w-8 animate-pulse" />
              <span className="text-sm">Carregando o configurador 3D…</span>
            </div>
          </div>
        )}
        <iframe
          ref={frameRef}
          src={iframeSrc}
          title="Configurador 3D Branorte"
          onLoad={() => setLoading(false)}
          className="absolute inset-0 h-full w-full border-0"
          allow="fullscreen; accelerometer; gyroscope; xr-spatial-tracking"
        />
      </div>

      {/* Toast */}
      {toast && (
        <div className={`fixed bottom-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg shadow-lg text-sm font-medium ${toast.erro ? 'bg-red-600 text-white' : 'bg-ink text-bg'}`}>
          {toast.msg}
        </div>
      )}

      {/* Modal salvar */}
      {saveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={() => setSaveOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-surface border border-border shadow-2xl p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-ink">{projetoId ? 'Atualizar projeto' : 'Salvar projeto'}</h2>
              <button onClick={() => setSaveOpen(false)} className="h-8 w-8 rounded-lg text-ink-faint hover:text-ink hover:bg-bg flex items-center justify-center">
                <X className="h-4 w-4" />
              </button>
            </div>

            <label className="block text-xs font-semibold text-ink-muted mb-1">Nome do projeto</label>
            <input
              value={saveNome}
              onChange={e => setSaveNome(e.target.value)}
              autoFocus
              placeholder="Ex.: Fábrica 5 t/h — Cliente X"
              className="w-full h-10 px-3 rounded-lg border border-border bg-bg text-ink text-sm mb-4 focus:outline-none focus:border-accent"
            />

            <label className="block text-xs font-semibold text-ink-muted mb-1">Cliente (opcional)</label>
            {saveContactNome ? (
              <div className="flex items-center gap-2 h-10 px-3 rounded-lg border border-accent/40 bg-accent/5 mb-4">
                <Check className="h-4 w-4 text-accent shrink-0" />
                <span className="text-sm text-ink truncate flex-1">{saveContactNome}</span>
                <button
                  onClick={() => { setSaveContactId(null); setSaveContactNome(null); setSaveBusca('') }}
                  className="text-ink-faint hover:text-ink"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="relative mb-4">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
                <input
                  value={saveBusca}
                  onChange={e => setSaveBusca(e.target.value)}
                  placeholder="Buscar por nome ou telefone…"
                  className="w-full h-10 pl-9 pr-3 rounded-lg border border-border bg-bg text-ink text-sm focus:outline-none focus:border-accent"
                />
                {saveBusca.trim().length >= 2 && contatos && contatos.length > 0 && (
                  <div className="absolute left-0 right-0 top-full mt-1 max-h-52 overflow-y-auto rounded-lg border border-border bg-surface shadow-xl z-10 p-1">
                    {contatos.map(c => (
                      <button
                        key={c.id}
                        onClick={() => { setSaveContactId(c.id); setSaveContactNome(c.name || c.phone || 'Contato'); setSaveBusca('') }}
                        className="w-full text-left px-3 py-2 rounded-md hover:bg-bg text-sm text-ink"
                      >
                        <div className="font-medium truncate">{c.name || '(sem nome)'}</div>
                        {c.phone && <div className="text-[11px] text-ink-faint">{c.phone}</div>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-2 justify-end">
              <button onClick={() => setSaveOpen(false)} className="h-10 px-4 rounded-lg border border-border text-ink-muted hover:bg-bg text-sm font-medium">
                Cancelar
              </button>
              <button
                onClick={confirmarSalvar}
                disabled={salvar.isPending || !saveNome.trim()}
                className="h-10 px-4 rounded-lg bg-accent text-white hover:opacity-90 text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
              >
                {salvar.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {projetoId ? 'Atualizar' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default Projeto3D
