import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ChevronRight, RefreshCw, Search } from 'lucide-react'
import { useVendors } from '@/hooks/useVendors'
import { useAuth } from '@/hooks/useAuth'
import { useWaVendedores, useWaMensagens } from '@/hooks/useWaKanban'
import { useAreaVendedor } from '@/hooks/useAreaVendedor'
import { ETAPAS_AREA, REGRAS_ETAPA, syncDesatualizada, type AreaCliente } from '@/lib/area-vendedor'
import { corpoVisivel } from '@/lib/wa-funil'
import { estadoAnalisePrecalculada, type AnalisePrecalculada } from '@/lib/area-vendedor-analises'

const control = 'min-h-10 rounded-md border border-border bg-surface px-3 text-sm text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent'
const normalizar = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase()
function dataHora(valor: string | number | null | undefined) {
  if (!valor) return 'Não disponível'
  const data = new Date(valor)
  return Number.isNaN(data.getTime()) ? 'Não disponível' : data.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

export default function AreaVendedor() {
  const { profile } = useAuth()
  const isAdmin = profile?.role === 'admin'
  const nomes = useWaVendedores()
  const vendors = useVendors()
  const [nome, setNome] = useState('')
  const [etapa, setEtapa] = useState('')
  const [busca, setBusca] = useState('')
  const [somentePendencias, setSomentePendencias] = useState(false)
  const [selecionado, setSelecionado] = useState<string | null>(null)
  // Apenas vínculo exato e único. Selecionar um nome não concede acesso.
  const matches = (vendors.data ?? []).filter(v => normalizar(v.name) === normalizar(nome) || normalizar(v.key ?? '') === normalizar(nome))
  const vendedorId = nome && matches.length === 1 ? matches[0].id : null
  const area = useAreaVendedor(nome || null, vendedorId, isAdmin)
  const analisesPorChat = useMemo(() => new Map((area.precalculadas.data ?? []).map(a => [a.chat_id, a])), [area.precalculadas.data])
  const filtrados = useMemo(() => area.clientes.filter(c =>
    (!etapa || c.etapas.includes(etapa)) &&
    normalizar(`${c.chat.contact_name ?? ''} ${c.chat.phone}`).includes(normalizar(busca))
  ).sort((a, b) => {
    const pa = analisesPorChat.get(a.chat.chat_id ?? '')?.pendencias.length ?? 0
    const pb = analisesPorChat.get(b.chat.chat_id ?? '')?.pendencias.length ?? 0
    return Number(pb > 0) - Number(pa > 0) || (Date.parse(b.chat.last_message_at ?? '') || 0) - (Date.parse(a.chat.last_message_at ?? '') || 0)
  }), [area.clientes, etapa, busca, analisesPorChat])
  const pendencias = filtrados.filter(c => (analisesPorChat.get(c.chat.chat_id ?? '')?.pendencias.length ?? 0) > 0).length
  const clientes = somentePendencias ? filtrados.filter(c => (analisesPorChat.get(c.chat.chat_id ?? '')?.pendencias.length ?? 0) > 0) : filtrados
  const cliente = clientes.find(c => c.id === selecionado) ?? null
  const analisados = filtrados.filter(c => analisesPorChat.has(c.chat.chat_id ?? '')).length
  const atualizando = area.carteira.isFetching || area.analises.isFetching || area.precalculadas.isFetching
  const syncAntiga = !!nome && !area.carteira.isLoading && syncDesatualizada(area.carteira.data?.ultimaSync ?? null)
  const problemas = [
    (nomes.error || vendors.error) && 'Cadastro de vendedores indisponível. Recarregue a página.',
    area.carteira.error && 'Falha ao atualizar a carteira. Os dados visíveis podem ser da consulta anterior.',
    area.precalculadas.error && 'Análises publicadas indisponíveis nesta consulta.',
    (nome && !vendedorId && !vendors.isLoading) && 'Vendedor sem vínculo único no cadastro: análises não associadas.',
    syncAntiga && 'Sincronização de etiquetas antiga ou sem data confiável.',
    area.analises.error && 'Supervisão antiga indisponível.',
  ].filter(Boolean)

  return (
    <main className="mx-auto max-w-[1600px] space-y-3 p-3 md:p-5">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Área do vendedor</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Clientes, conversas e próximos passos.</p>
        </div>
        <button className={`${control} inline-flex items-center gap-2 disabled:opacity-50`} disabled={!nome || atualizando} onClick={() => { void area.atualizar() }}>
          <RefreshCw size={16} aria-hidden="true" /> {atualizando ? 'Atualizando…' : 'Atualizar dados'}
        </button>
      </header>

      <section aria-label="Filtros da carteira" className="grid gap-2 sm:grid-cols-[1fr_1fr_1.4fr]">
        <label className="grid gap-1 text-xs font-medium text-ink-muted">Vendedor
          <select className={control} value={nome} onChange={e => { setNome(e.target.value); setSelecionado(null) }}>
            <option value="">Selecione seu nome</option>
            {(nomes.data ?? []).map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-muted">Etapa
          <select className={control} value={etapa} onChange={e => { setEtapa(e.target.value); setSelecionado(null) }}>
            <option value="">Todas as etapas</option>
            {ETAPAS_AREA.map(e => <option key={e} value={e}>{e}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs font-medium text-ink-muted">Cliente ou telefone
          <span className="relative"><Search size={16} aria-hidden="true" className="absolute left-3 top-3 text-ink-faint" /><input className={`${control} w-full pl-9`} type="search" value={busca} placeholder="Buscar na carteira" onChange={e => setBusca(e.target.value)} /></span>
        </label>
      </section>
      <details className="rounded-md border border-border px-3 py-2 text-xs text-ink-muted">
        <summary className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <span className={problemas.length ? 'text-warning' : ''}>{nomes.error || vendors.error ? 'Falha ao carregar vendedores' : area.carteira.error ? 'Carteira indisponível ou desatualizada' : !nome ? 'Selecione um vendedor para consultar' : area.precalculadas.error ? 'Análises indisponíveis' : area.precalculadas.isLoading ? 'Consultando análises…' : `${analisados} de ${filtrados.length} clientes com análise publicada`}</span>
          {syncAntiga && <span className="ml-3 text-warning">Sincronização desatualizada</span>}
          <span className="ml-3">Status e limites da leitura</span>
        </summary>
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {problemas.map((p, i) => <p key={i} className="text-warning">{p}</p>)}
          <p>Etiquetas sincronizadas: {dataHora(area.carteira.data?.ultimaSync)}. Carteira consultada: {dataHora(area.atualizadoEm)}.</p>
          <p>A carteira atualiza a cada 30 segundos; análises salvas, a cada minuto. Isso não gera análise nova. Nenhuma mensagem é enviada e nenhuma etiqueta é alterada.</p>
          <p>Ausência de análise não significa atendimento em dia. A captura pode estar incompleta. Supervisão antiga não substitui análise atual e permanece restrita ao gestor.</p>
          {etapa && REGRAS_ETAPA[etapa] && <p>{etapa}: {REGRAS_ETAPA[etapa]}</p>}
        </div>
      </details>
      {!nome ? <div className="rounded-lg border border-dashed border-border-strong px-5 py-14 text-center"><h2 className="text-lg font-semibold">Comece pelo seu nome</h2><p className="mt-2 text-ink-muted">Selecione um vendedor para consultar os clientes e as análises disponíveis.</p>{nomes.isLoading && <p role="status" className="mt-3 text-sm">Carregando vendedores…</p>}</div> : <>
        <section className="overflow-hidden rounded-lg border border-border bg-surface lg:grid lg:h-[calc(100dvh-215px)] lg:min-h-[480px] lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]" aria-label="Carteira e análise do cliente">
          <div className={`${cliente ? 'hidden lg:flex' : 'flex'} min-h-0 min-w-0 flex-col lg:border-r lg:border-border`}>
            <div className="space-y-2 border-b border-border px-4 py-3">
              <h2 className="font-semibold">{clientes.length} clientes <span className="font-normal text-ink-muted">na seleção</span></h2>
              <label className="flex min-h-7 items-center gap-2 text-xs text-ink-muted"><input type="checkbox" checked={somentePendencias} onChange={e => setSomentePendencias(e.target.checked)} className="h-4 w-4 accent-accent focus-visible:ring-2 focus-visible:ring-accent" />Com pendências na análise: {pendencias} clientes</label>
            </div>
            {area.carteira.isLoading ? <p role="status" className="p-6 text-ink-muted">Carregando a carteira…</p> : clientes.length === 0 ? <p className="p-6 text-sm text-ink-muted">Nenhum cliente nesta seleção. Limpe a busca ou desmarque o filtro de pendências.</p> : <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {clientes.map(c => <li key={c.id}><button onClick={() => setSelecionado(c.id)} aria-pressed={c.id === selecionado} className={`flex w-full items-start gap-3 p-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent ${c.id === selecionado ? 'bg-accent-bg' : 'hover:bg-surface-2'}`}>
                <span className="min-w-0 flex-1"><span className="block truncate font-semibold">{c.chat.contact_name || c.chat.phone}</span><span className="mt-1 block text-xs text-ink-muted">{c.etapas.join(' / ') || 'Sem etiqueta'}</span><span className="mt-2 block line-clamp-2 text-sm text-ink-muted">{analisesPorChat.get(c.chat.chat_id ?? '')?.pendencias[0] || (analisesPorChat.has(c.chat.chat_id ?? '') ? 'Análise publicada disponível' : 'Ainda sem análise publicada')}</span><span className="mt-2 block text-xs text-ink-faint">Conversa: {dataHora(c.chat.last_message_at)}</span></span><ChevronRight size={16} aria-hidden="true" className="mt-1 shrink-0 text-ink-faint" />
              </button></li>)}
            </ul>}
          </div>
          <div className={`${cliente ? '' : 'hidden lg:block'} min-h-0 min-w-0 overflow-y-auto`}>
            {cliente ? <DetalheCliente key={`${nome}:${cliente.id}`} cliente={cliente} vendedor={nome} analise={analisesPorChat.get(cliente.chat.chat_id ?? '')} carregandoAnalise={area.precalculadas.isLoading} erroAnalise={!!area.precalculadas.error} voltar={() => setSelecionado(null)} /> : <div className="px-6 py-20 text-center"><h2 className="text-lg font-semibold">Abra um cliente para conferir</h2><p className="mx-auto mt-2 max-w-sm text-sm text-ink-muted">Veja o resumo disponível, os próximos passos e as mensagens registradas, sem enviar nada automaticamente.</p></div>}
          </div>
        </section>
      </>}
    </main>
  )
}

function AnaliseSalva({ analise, ultimaMensagem }: { analise: AnalisePrecalculada; ultimaMensagem: string | null }) {
  const estado = estadoAnalisePrecalculada(analise, ultimaMensagem)
  return <section aria-label="Análise publicada pelo Codex" className="space-y-4">
    <div>
      <h3 className="text-base font-semibold">Análise do atendimento</h3>
      <p className="mt-1 text-xs text-ink-muted">Publicada pelo Codex em {dataHora(analise.gerado_em)}</p>
    </div>
    <details className="text-xs text-ink-muted"><summary className={`cursor-pointer ${estado === 'desatualizada' ? 'text-warning' : ''}`}>{estado === 'desatualizada' ? 'Análise desatualizada — confira a conversa' : 'Leitura salva — histórico atual não verificado'}{analise.audios_sem_transcricao > 0 ? ` / ${analise.audios_sem_transcricao} áudio(s) não interpretados` : ''}{analise.historico_parcial ? ' / histórico parcial' : ''}</summary><p className="mt-2">Dados lidos em {dataHora(analise.snapshot_em)}. {analise.mensagens_analisadas} mensagens analisadas; última incluída em {dataHora(analise.ultima_mensagem_em)}. Áudios sem transcrição não foram interpretados. A análise não é atualizada só por abrir esta página.</p></details>
    <div><h4 className="font-semibold">Resumo do atendimento</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{analise.resumo}</p></div>
    <div><h4 className="font-semibold">Pendências identificadas</h4>{analise.pendencias.length ? <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">{analise.pendencias.map((p, i) => <li key={i} className="whitespace-pre-wrap break-words">{p}</li>)}</ul> : <p className="mt-2 text-sm text-ink-muted">Nenhuma pendência apontada nesta leitura. Isso não garante que não existam pendências posteriores.</p>}</div>
    <div><h4 className="font-semibold">Próximo passo sugerido</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm">{analise.proxima_acao || 'Nenhum próximo passo foi publicado.'}</p></div>
    <div className="rounded-md border border-accent/30 bg-accent-bg p-4"><h4 className="font-semibold">Mensagem sugerida</h4><p className="mt-2 whitespace-pre-wrap break-words text-sm">{analise.mensagem_sugerida || 'Nenhuma mensagem sugerida foi publicada.'}</p><p className="mt-3 text-xs text-ink-muted">Rascunho para revisão do vendedor. Não foi enviado ao cliente.</p></div>
    <div><h4 className="font-semibold">Evidências da análise</h4>{analise.evidencias.length ? analise.evidencias.map((e, i) => <blockquote key={`${e.msg_id}:${i}`} className="mt-2 border-l-2 border-border-strong pl-3 text-sm"><p className="whitespace-pre-wrap break-words">{e.trecho}</p><footer className="mt-1 text-xs text-ink-muted">Mensagem de {dataHora(e.data_msg)}</footer></blockquote>) : <p className="mt-2 text-sm text-ink-muted">Nenhum trecho de evidência foi publicado. Valide a orientação na conversa.</p>}</div>
  </section>
}

function DetalheCliente({ cliente, vendedor, voltar, analise, carregandoAnalise, erroAnalise }: { cliente: AreaCliente; vendedor: string; voltar: () => void; analise?: AnalisePrecalculada; carregandoAnalise: boolean; erroAnalise: boolean }) {
  const titulo = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titulo.current?.focus({ preventScroll: true }) }, [])
  const [limite, setLimite] = useState(30)
  const conversa = useWaMensagens(vendedor, cliente.chat.chat_id, true, limite)
  // O hook legado mantém placeholder da consulta anterior; não exibir como nova conversa.
  const mensagens = conversa.isPlaceholderData ? [] : conversa.data?.mensagens ?? []
  const audios = mensagens.filter(m => /audio|ptt|voice/i.test(m.tipo))
  return <article className="space-y-6 p-4 md:p-6">
    <header>
      <button onClick={voltar} className={`${control} mb-4 inline-flex items-center gap-2 lg:hidden`}><ArrowLeft size={16} />Voltar à carteira</button>
      <h2 ref={titulo} tabIndex={-1} className="break-words text-xl font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">{cliente.chat.contact_name || cliente.chat.phone}</h2>
      <p className="mt-1 text-sm text-ink-muted">{cliente.chat.phone}</p>
    </header>
    {analise ? <AnaliseSalva analise={analise} ultimaMensagem={cliente.chat.last_message_at} /> : <section className="rounded-md bg-surface-2 p-4"><h3 className="font-semibold">{carregandoAnalise ? 'Consultando análise salva…' : erroAnalise ? 'Análise temporariamente indisponível' : 'Ainda não há análise publicada para este cliente'}</h3><p className="mt-1 text-sm text-ink-muted">{carregandoAnalise ? 'Aguarde a consulta terminar.' : 'Ausência de análise não significa que o atendimento está em dia. Confira a conversa abaixo.'}</p></section>}
    {cliente.achados.length > 0 && <details aria-label="Apontamentos antigos da supervisão" className="space-y-5 border-t border-border pt-3 text-ink-muted">
      <summary className="cursor-pointer text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">Supervisão antiga: {cliente.achados.length} apontamento(s) — não é a análise atual</summary>
      <p className="text-xs">Regras antigas podem indicar cobranças já resolvidas. Não use esses apontamentos como confirmação de pendência.{cliente.analiseDesatualizada ? ' Há mensagens posteriores aos apontamentos.' : ''}</p>
      {cliente.achados.map(a => <div key={a.id} className="border-l-2 border-accent pl-4">
        <p className="text-xs font-medium text-ink-muted">{a.camada === 'ia' ? 'Análise de IA' : a.camada === 'heuristica' ? 'Indício por regra heurística — não é IA' : 'Apontamento por regra — não é IA'} · {dataHora(a.atualizado_em)}</p>
        <h3 className="mt-2 text-base font-semibold">{a.titulo}</h3>
        <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-ink-muted">{a.o_que_aconteceu || 'Resumo não disponível neste apontamento.'}</p>
        <h4 className="mt-4 text-sm font-semibold">Próximo passo registrado</h4>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm">{a.proxima_acao || 'Nenhum próximo passo registrado.'}</p>
        <h4 className="mt-4 text-sm font-semibold">Evidência</h4>
        {a.evidencias.length ? a.evidencias.map(e => <blockquote key={e.id} className="mt-2 rounded-md bg-surface-2 p-3 text-sm"><p className="whitespace-pre-wrap break-words">{e.trecho || 'Trecho de texto não disponível.'}</p><footer className="mt-2 text-xs text-ink-muted">Fonte: {e.fonte} · {dataHora(e.ocorrido_em)}</footer></blockquote>) : <p className="mt-1 text-sm text-ink-muted">Este apontamento não trouxe um trecho de evidência. Verifique na conversa.</p>}
      </div>)}
    </details>}
    <section className="border-t border-border pt-5" aria-label="Conversa registrada">
      <h3 className="font-semibold">Conversa registrada</h3>
      <p className="mt-1 text-xs text-ink-muted">Somente mensagens capturadas pela extensão. Não equivale ao histórico completo do WhatsApp.</p>
      {audios.length > 0 && <p className="mt-3 rounded-md bg-warning-bg p-3 text-sm text-warning">Há {audios.length} áudio(s) neste trecho. A transcrição não está disponível nesta consulta; não deduza seu conteúdo pelo contexto.</p>}
      {!cliente.chat.chat_id ? <p className="mt-4 text-sm text-ink-muted">Este contato ainda não tem conversa vinculada.</p> : conversa.isLoading || conversa.isPlaceholderData ? <p role="status" className="mt-4 text-sm">Carregando mensagens…</p> : conversa.error ? <div role="alert" className="mt-4 text-sm text-danger">Não foi possível carregar as mensagens. <button onClick={() => { void conversa.refetch() }} className="underline focus-visible:ring-2 focus-visible:ring-accent">Tentar novamente</button></div> : <>
        {conversa.data?.temMais && <button className={`${control} mt-4 w-full`} disabled={conversa.isFetching} onClick={() => setLimite(n => n + 50)}>Carregar mensagens anteriores</button>}
        {mensagens.length === 0 && <p className="mt-4 text-sm text-ink-muted">Nenhuma mensagem capturada disponível.</p>}
        <ol className="mt-4 space-y-3">{mensagens.map(m => <li key={m.msg_id} className={`max-w-[95%] rounded-md p-3 ${m.from_me ? 'ml-auto bg-accent-bg' : 'mr-auto bg-surface-2'}`}><p className="mb-1 text-xs font-medium text-ink-muted">{m.from_me === null ? 'Origem não informada' : m.from_me ? vendedor : 'Cliente'} · {dataHora(m.data_msg)}</p><p className="whitespace-pre-wrap break-words text-sm">{corpoVisivel(m.body) || (/audio|ptt|voice/i.test(m.tipo) ? 'Áudio — conteúdo não transcrito' : `Mensagem ${m.tipo || 'sem texto'} — conteúdo não disponível`)}</p></li>)}</ol>
      </>}
    </section>
  </article>
}
