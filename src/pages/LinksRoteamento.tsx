// Página de Links de Roteamento — /disparos/links
//
// Aqui se cria o link que vai no anúncio. O que muda em relação ao card antigo
// que vivia dentro de /disparos:
//
//   1. CRIATIVO POR ANÚNCIO — e não por link. Esta página nasceu com a premissa
//      contrária ("um link por criativo") e os dados a derrubaram no mesmo dia:
//      em 07/08/2026 DOIS anúncios (&54 e &8) apontavam para o MESMO
//      /l/compacta02. Código no link creditaria os dois igual — e o carimbo de
//      criativo é first-touch-wins, ou seja, irreversível.
//      O de-para vive em public.meta_ad_criativo (ad_id → &NN); o gatilho casa
//      por utm_content = {{ad.id}}. O criativo do LINK continua existindo, mas
//      só como rede de segurança para clique que chega sem utm_content.
//      ⚠ ARMADILHA: os ids do Meta enganam. O ad_id MENOR (…870424) é o
//      Compacta 02 (&8), não o 01. Conferido abrindo o editor de cada anúncio.
//
//   2. PIXEL POR LINK. Antes era env var global. Vazio = usa o global.
//
//   3. GERADOR DE URL. A tela monta o endereço com os UTMs prontos pra colar no
//      Gerenciador. Evita o erro que já aconteceu: nome de anúncio com "&"
//      dentro (AD- &79) quebra a query string se entrar via {{ad.name}}.
//
//   4. PAINEL DE RASTREIO honesto. Separa o que é CERTEZA (selo invisível) do
//      que é só coincidência de tempo. Em 05-07/08 os 3 casamentos por selo
//      eram todos reais e os 7 por janela eram todos de outra origem — por isso
//      a janela hoje é diagnóstico e não carimba mais nada no CRM.

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { supabase } from '@/lib/supabase'
import {
  Link2, Copy, Check, Plus, Trash2, Pencil, X, MousePointerClick,
  MessageSquare, ShieldCheck, AlertTriangle, Megaphone,
} from 'lucide-react'

type LinkRota = {
  id: string
  slug: string
  nome: string
  mensagem: string
  origem: string
  ativo: boolean
  fallback_telefone: string | null
  criativo_codigo: string | null
  pixel_id: string | null
  utm_source: string | null
  utm_medium: string | null
  utm_campaign: string | null
  utm_content: string | null
  utm_term: string | null
}

type Resumo = {
  id: string
  slug: string
  nome: string
  origem: string
  ativo: boolean
  cliques: number
  /** Soma selo + janela. NÃO usar na tela: janela não é prova. */
  conversas: number
  /** Casadas pelo selo invisível — a única contagem confiável. */
  conversas_certas: number
  /** Só coincidência de tempo. Diagnóstico, nunca métrica de decisão. */
  conversas_provaveis: number
  cliques_7d: number
  ultimo_clique: string | null
}

type Clique = {
  id: number
  link_id: string
  codigo: string
  vendedor_nome: string | null
  fallback: boolean
  created_at: string
  matched_at: string | null
  match_via: string | null
  cliente_telefone: string | null
  utm_source: string | null
  utm_campaign: string | null
  utm_content: string | null
  fbclid: string | null
  referer: string | null
}

const MENSAGEM_PADRAO = 'Olá! Vi o anúncio da Branorte e queria falar sobre fábrica de ração.'

function baseDoLink(): string {
  if (typeof window === 'undefined') return 'https://branorte-crm.vercel.app'
  return window.location.origin
}

/** Monta a URL completa que vai no anúncio, com os UTMs preenchidos.
 *  Só entra parâmetro que tem valor — URL com "utm_term=" vazio suja o relatório. */
function montarUrlCompleta(l: Partial<LinkRota>): string {
  const base = `${baseDoLink()}/l/${l.slug || '<endereco>'}`
  const pares: [string, string | null | undefined][] = [
    ['utm_source', l.utm_source],
    ['utm_medium', l.utm_medium],
    ['utm_campaign', l.utm_campaign],
    ['utm_content', l.utm_content],
    ['utm_term', l.utm_term],
  ]
  const qs = pares
    .filter(([, v]) => v && String(v).trim())
    .map(([k, v]) => `${k}=${String(v).trim()}`)
    .join('&')
  return qs ? `${base}?${qs}` : base
}

export function LinksRoteamento() {
  const qc = useQueryClient()
  const [editando, setEditando] = useState<Partial<LinkRota> | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const { data: links } = useQuery<Resumo[]>({
    queryKey: ['link-rota-resumo'],
    queryFn: async () => {
      const { data } = await supabase.from('link_rota_resumo').select('*').order('nome')
      return (data as Resumo[]) || []
    },
    refetchInterval: 30_000,
  })

  // Detalhe completo (criativo, pixel, utm) — o resumo não traz.
  const { data: detalhes } = useQuery<LinkRota[]>({
    queryKey: ['link-rota-detalhe'],
    queryFn: async () => {
      const { data } = await supabase.from('link_rota').select('*')
      return (data as LinkRota[]) || []
    },
    refetchInterval: 60_000,
  })

  const { data: cliques } = useQuery<Clique[]>({
    queryKey: ['link-rota-cliques'],
    queryFn: async () => {
      const { data } = await supabase
        .from('link_rota_click')
        .select(
          'id, link_id, codigo, vendedor_nome, fallback, created_at, matched_at, match_via, cliente_telefone, utm_source, utm_campaign, utm_content, fbclid, referer'
        )
        .order('created_at', { ascending: false })
        .limit(60)
      return (data as Clique[]) || []
    },
    refetchInterval: 30_000,
  })

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const l of links || []) m[l.id] = l.nome
    return m
  }, [links])

  const detalhePorId = useMemo(() => {
    const m: Record<string, LinkRota> = {}
    for (const l of detalhes || []) m[l.id] = l
    return m
  }, [detalhes])

  /** Funil honesto: separa certeza de chute. */
  const funil = useMemo(() => {
    const cs = cliques ?? []
    return {
      total: cs.length,
      selo: cs.filter(c => c.match_via === 'codigo').length,
      janela: cs.filter(c => c.match_via === 'janela').length,
      soClique: cs.filter(c => !c.matched_at).length,
      comFbclid: cs.filter(c => c.fbclid).length,
    }
  }, [cliques])

  const salvar = useMutation({
    mutationFn: async (l: Partial<LinkRota>) => {
      const criativo = String(l.criativo_codigo || '').trim()
      const pixel = String(l.pixel_id || '').replace(/\D/g, '')
      const payload = {
        slug: String(l.slug || '').trim().toLowerCase(),
        nome: String(l.nome || '').trim(),
        mensagem: String(l.mensagem || '').trim(),
        origem: String(l.origem || '').trim() || 'Link',
        ativo: l.ativo !== false,
        fallback_telefone: l.fallback_telefone?.replace(/\D/g, '') || null,
        criativo_codigo: criativo ? (criativo.startsWith('&') ? criativo : `&${criativo}`) : null,
        pixel_id: pixel || null,
        utm_source: l.utm_source?.trim() || null,
        utm_medium: l.utm_medium?.trim() || null,
        utm_campaign: l.utm_campaign?.trim() || null,
        utm_content: l.utm_content?.trim() || null,
        utm_term: l.utm_term?.trim() || null,
      }
      if (!payload.nome) throw new Error('Dá um nome pro link.')
      if (!payload.mensagem) throw new Error('O texto que o cliente vai mandar não pode ficar vazio.')
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(payload.slug))
        throw new Error('Endereço inválido: só letras minúsculas, números e hífen (ex: fabrica-racao).')
      if (payload.criativo_codigo && !/^&[0-9]{1,4}$/.test(payload.criativo_codigo))
        throw new Error('Criativo tem que ser & seguido de 1 a 4 números (ex: &54).')
      if (payload.pixel_id && !/^[0-9]{10,20}$/.test(payload.pixel_id))
        throw new Error('Pixel do Meta é só número, entre 10 e 20 dígitos.')

      const q = l.id
        ? supabase.from('link_rota').update({ ...payload, atualizado_em: new Date().toISOString() }).eq('id', l.id)
        : supabase.from('link_rota').insert(payload)
      const { error } = await q
      if (error) {
        if (error.code === '23505') throw new Error(`O endereço "${payload.slug}" já está em uso.`)
        throw new Error(error.message)
      }
    },
    onSuccess: () => {
      setEditando(null)
      setErro(null)
      qc.invalidateQueries({ queryKey: ['link-rota-resumo'] })
      qc.invalidateQueries({ queryKey: ['link-rota-detalhe'] })
    },
    onError: (e: Error) => setErro(e.message),
  })

  const alternarAtivo = useMutation({
    mutationFn: async (l: Resumo) => {
      const { error } = await supabase.from('link_rota').update({ ativo: !l.ativo }).eq('id', l.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['link-rota-resumo'] }),
    onError: (e: Error) => setErro(e.message),
  })

  const apagar = useMutation({
    mutationFn: async (l: Resumo) => {
      const { error } = await supabase.from('link_rota').delete().eq('id', l.id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['link-rota-resumo'] })
      qc.invalidateQueries({ queryKey: ['link-rota-detalhe'] })
      qc.invalidateQueries({ queryKey: ['link-rota-cliques'] })
    },
    onError: (e: Error) => setErro(e.message),
  })

  async function copiar(texto: string, chave: string) {
    try {
      await navigator.clipboard.writeText(texto)
      setCopiado(chave)
      setTimeout(() => setCopiado(null), 1500)
    } catch {
      setErro(`Não consegui copiar. O endereço é: ${texto}`)
    }
  }

  function abrirEdicao(l?: Resumo) {
    setErro(null)
    if (!l) {
      setEditando({
        slug: '', nome: '', mensagem: MENSAGEM_PADRAO, origem: 'Meta ADS', ativo: true,
        utm_source: 'meta', utm_medium: 'paid',
      })
      return
    }
    setEditando(detalhePorId[l.id] ?? (l as unknown as LinkRota))
  }

  return (
    <div className="p-4 space-y-4 max-w-[1400px] mx-auto">
      {/* ---------- Cabeçalho ---------- */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink flex items-center gap-2">
            <Link2 className="h-5 w-5 text-accent" /> Links de roteamento
          </h1>
          <p className="text-ink-muted text-xs mt-1 max-w-4xl">
            O link que vai no anúncio. Quem clica cai no WhatsApp do <b>próximo vendedor da fila</b> — a mesma fila
            do quiz e das landing pages, respeitando ligado/desligado, bloqueio, fatia e cota de parados. Cada
            clique leva um <b>código invisível</b> no texto: quando o cliente manda a mensagem, o sistema casa
            sozinho a conversa com o clique e carimba origem e criativo no atendimento.
          </p>
        </div>
        <Button size="sm" variant="primary" onClick={() => abrirEdicao()} className="shrink-0">
          <Plus className="h-3.5 w-3.5" /> Novo link
        </Button>
      </div>

      {erro && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 flex items-start justify-between gap-2">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} className="shrink-0 text-red-300/70 hover:text-red-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ---------- Formulário ---------- */}
      {editando && (
        <Card className="p-4 border-accent/40">
          <h2 className="text-[13px] font-semibold text-ink mb-3">
            {editando.id ? 'Editar link' : 'Novo link'}
          </h2>

          <div className="space-y-4">
            {/* --- Bloco 1: o básico --- */}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-semibold text-ink-muted">Nome (só você vê)</span>
                <Input
                  value={editando.nome ?? ''}
                  onChange={e => setEditando({ ...editando, nome: e.target.value })}
                  placeholder="Anúncio Compacta 02 — Meta"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-ink-muted">Endereço do link</span>
                <div className="flex items-center gap-1">
                  <span className="text-[11px] text-ink-faint font-mono whitespace-nowrap">/l/</span>
                  <Input
                    value={editando.slug ?? ''}
                    onChange={e =>
                      setEditando({ ...editando, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })
                    }
                    placeholder="compacta02"
                  />
                </div>
              </label>
            </div>

            <label className="block">
              <span className="text-[11px] font-semibold text-ink-muted">
                Texto que já aparece escrito no WhatsApp do cliente
              </span>
              <textarea
                value={editando.mensagem ?? ''}
                onChange={e => setEditando({ ...editando, mensagem: e.target.value })}
                rows={3}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                placeholder={MENSAGEM_PADRAO}
              />
              <span className="text-[10px] text-ink-faint">
                Escreva como o <b>cliente</b> falaria — é ele quem manda. Use{' '}
                <code className="text-accent">{'{vendedor}'}</code> pro primeiro nome de quem recebeu. O código
                invisível entra sozinho no fim.
              </span>
            </label>

            {/* --- Bloco 2: rastreamento --- */}
            <div className="rounded-lg border border-border bg-surface-2/30 p-3 space-y-3">
              <h3 className="text-[11px] font-semibold text-ink flex items-center gap-1.5">
                <Megaphone className="h-3.5 w-3.5 text-accent" /> Rastreamento
              </h3>

              <div className="grid gap-3 sm:grid-cols-3">
                <label className="block">
                  <span className="text-[11px] font-semibold text-ink-muted">Criativo</span>
                  <Input
                    value={editando.criativo_codigo ?? ''}
                    onChange={e => setEditando({ ...editando, criativo_codigo: e.target.value })}
                    placeholder="&54"
                  />
                  <span className="text-[10px] text-ink-faint">
                    Vai direto pro atendimento. <b>Um link por criativo.</b>
                  </span>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-ink-muted">Origem (rótulo do relatório)</span>
                  <Input
                    value={editando.origem ?? ''}
                    onChange={e => setEditando({ ...editando, origem: e.target.value })}
                    placeholder="Meta ADS"
                  />
                  <span className="text-[10px] text-ink-faint">Use um rótulo que já exista na base.</span>
                </label>
                <label className="block">
                  <span className="text-[11px] font-semibold text-ink-muted">Pixel do Meta (opcional)</span>
                  <Input
                    value={editando.pixel_id ?? ''}
                    onChange={e => setEditando({ ...editando, pixel_id: e.target.value })}
                    placeholder="1518870689502747"
                  />
                  <span className="text-[10px] text-ink-faint">Vazio = usa o pixel padrão da conta.</span>
                </label>
              </div>

              <div className="grid gap-3 sm:grid-cols-5">
                {/* utm_content TEM que ser {{ad.id}}: e a coluna que o gatilho
                    casa contra meta_ad_criativo.ad_id, cujo CHECK exige 10-25
                    digitos. Codigo "&NN" aqui NUNCA casa e o criativo fica
                    vazio pra sempre (o carimbo e first-touch-wins). O de-para
                    ad_id -> &NN mora na tabela, nao na URL. */}
                {([
                  ['utm_source', 'meta'],
                  ['utm_medium', '{{placement}}'],
                  ['utm_campaign', '{{campaign.id}}'],
                  ['utm_content', '{{ad.id}}'],
                  ['utm_term', '{{adset.id}}'],
                ] as const).map(([campo, exemplo]) => (
                  <label className="block" key={campo}>
                    <span className="text-[10px] font-semibold text-ink-muted font-mono">{campo}</span>
                    <Input
                      value={(editando[campo] as string | null) ?? ''}
                      onChange={e => setEditando({ ...editando, [campo]: e.target.value })}
                      placeholder={exemplo}
                    />
                  </label>
                ))}
              </div>

              <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2">
                <p className="text-[10px] text-amber-200/90 leading-relaxed">
                  <b>Não use <code>{'{{ad.name}}'}</code> em nenhum campo.</b> Os nomes dos anúncios têm{' '}
                  <code>&amp;</code> dentro (<code>AD- &amp;79</code>) e um <code>&amp;</code> não codificado abre um
                  parâmetro novo no meio da URL — o valor chega cortado e o resto vira lixo, sem dar erro. Use os{' '}
                  <b>ids</b>, que são numéricos.
                </p>
              </div>
            </div>

            {/* --- Bloco 3: URL pronta --- */}
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <h3 className="text-[11px] font-semibold text-emerald-300">
                  Cole isto no campo "URL do site" do anúncio
                </h3>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => copiar(montarUrlCompleta(editando), 'url-form')}
                >
                  {copiado === 'url-form' ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  Copiar
                </Button>
              </div>
              <code className="block font-mono text-[11px] text-ink break-all">
                {montarUrlCompleta(editando)}
              </code>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="text-[11px] font-semibold text-ink-muted">Telefone de emergência (opcional)</span>
                <Input
                  value={editando.fallback_telefone ?? ''}
                  onChange={e => setEditando({ ...editando, fallback_telefone: e.target.value })}
                  placeholder="554888314825 — vazio usa a central"
                />
                <span className="text-[10px] text-ink-faint">Só usado se ninguém estiver ligado no painel.</span>
              </label>
            </div>

            <div className="flex items-center gap-2">
              <Button variant="primary" size="sm" loading={salvar.isPending} onClick={() => salvar.mutate(editando)}>
                Salvar
              </Button>
              <Button variant="ghost" size="sm" onClick={() => { setEditando(null); setErro(null) }}>
                Cancelar
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* ---------- Funil ---------- */}
      {funil.total > 0 && (
        <div className="grid gap-3 sm:grid-cols-4">
          {[
            { rot: 'Cliques', val: funil.total, cor: 'text-ink', dica: 'últimos 60 registrados' },
            { rot: 'Conversou (certeza)', val: funil.selo, cor: 'text-emerald-300', dica: 'código invisível bateu' },
            { rot: 'Só marcado', val: funil.janela, cor: 'text-amber-300', dica: 'tempo bateu, não é prova' },
            { rot: 'Só clicou', val: funil.soClique, cor: 'text-slate-300', dica: 'abriu e não mandou nada' },
          ].map(k => (
            <Card key={k.rot} className="p-3">
              <div className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{k.rot}</div>
              <div className={`text-2xl font-bold ${k.cor} mt-0.5`}>{k.val}</div>
              <div className="text-[10px] text-ink-faint mt-0.5">{k.dica}</div>
            </Card>
          ))}
        </div>
      )}

      {/* ---------- Lista de links ---------- */}
      <Card className="p-4">
        <h2 className="text-[13px] font-semibold text-ink mb-3">Links criados</h2>
        <div className="space-y-2">
          {(links ?? []).length === 0 && !editando && (
            <div className="text-center py-6 text-ink-muted text-[12px]">
              Nenhum link ainda. Clique em <b>Novo link</b> pra criar o primeiro.
            </div>
          )}

          {(links ?? []).map(l => {
            const d = detalhePorId[l.id]
            const url = d ? montarUrlCompleta(d) : `${baseDoLink()}/l/${l.slug}`
            return (
              <div
                key={l.id}
                className="rounded-lg border border-border bg-surface-2/30 p-3 flex items-start justify-between gap-3 flex-wrap"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[13px] font-semibold text-ink">{l.nome}</span>
                    {!l.ativo && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-slate-500/10 text-slate-300 border-slate-500/30">
                        desligado
                      </span>
                    )}
                    {d?.criativo_codigo && (
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-accent/10 text-accent border-accent/30 font-mono">
                        {d.criativo_codigo}
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-surface text-ink-muted border-border">
                      {l.origem}
                    </span>
                    {d?.pixel_id && (
                      <span className="text-[9px] text-ink-faint font-mono" title="Pixel próprio">
                        pixel {d.pixel_id.slice(-6)}
                      </span>
                    )}
                  </div>

                  <button
                    onClick={() => copiar(url, l.slug)}
                    title="Copiar a URL completa, com os UTMs"
                    className="mt-1 inline-flex items-start gap-1.5 font-mono text-[11px] text-accent hover:underline break-all text-left"
                  >
                    <span className="break-all">{url}</span>
                    {copiado === l.slug
                      ? <Check className="h-3 w-3 shrink-0 mt-0.5" />
                      : <Copy className="h-3 w-3 shrink-0 mt-0.5" />}
                  </button>

                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-muted flex-wrap">
                    <span className="inline-flex items-center gap-1">
                      <MousePointerClick className="h-3 w-3" /> {l.cliques} clique{l.cliques === 1 ? '' : 's'}
                    </span>
                    {/* Nunca o total. `conversas` soma selo + janela, e janela
                        não é prova: dos 7 casamentos por janela em 05-07/08,
                        NENHUM veio do link (Instagram, quiz do site, um
                        fornecedor prospectando a Branorte, uma cliente de
                        22/06). O verde é só o que o selo invisível provou. */}
                    <span className="inline-flex items-center gap-1 text-emerald-300"
                          title="Casadas pelo selo invisível — prova de que a mensagem nasceu deste link">
                      <MessageSquare className="h-3 w-3" /> {l.conversas_certas} conversa{l.conversas_certas === 1 ? '' : 's'}
                    </span>
                    {l.conversas_provaveis > 0 && (
                      <span className="inline-flex items-center gap-1 text-ink-faint"
                            title="Só coincidência de tempo com o clique. Não conte nisso para decidir verba.">
                        +{l.conversas_provaveis} sem prova
                      </span>
                    )}
                    <span className="text-ink-faint">{l.cliques_7d} nos últimos 7 dias</span>
                    {l.ultimo_clique && (
                      <span className="text-ink-faint">
                        último: {new Date(l.ultimo_clique).toLocaleString('pt-BR', { hour12: false })}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => alternarAtivo.mutate(l)}>
                    {l.ativo ? 'Desligar' : 'Ligar'}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => abrirEdicao(l)} title="Editar">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    title="Apagar"
                    onClick={() => {
                      if (confirm(`Apagar o link "${l.nome}"? Os ${l.cliques} cliques registrados vão junto.`))
                        apagar.mutate(l)
                    }}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-red-400" />
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      </Card>

      {/* ---------- Últimos cliques ---------- */}
      {(cliques ?? []).length > 0 && (
        <Card className="p-4">
          <h2 className="text-[13px] font-semibold text-ink mb-2">Últimos cliques</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-muted">
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1.5 font-semibold">Quando</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Link</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Foi pra</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Virou conversa?</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Anúncio</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Veio do Meta?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {(cliques ?? []).map(c => (
                  <tr key={c.id} className="hover:bg-surface-2/30">
                    <td className="px-2 py-1.5 text-ink-faint whitespace-nowrap font-mono text-[10px]">
                      {new Date(c.created_at).toLocaleString('pt-BR', { hour12: false })}
                    </td>
                    <td className="px-2 py-1.5 text-ink-muted">{nomePorId[c.link_id] ?? '—'}</td>
                    <td className="px-2 py-1.5 text-ink font-semibold">
                      {c.vendedor_nome ?? '—'}
                      {c.fallback && <span className="ml-1 text-[9px] text-amber-300 font-normal">(central)</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      {c.match_via === 'codigo' ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-emerald-500/10 text-emerald-300 border-emerald-500/30">
                          <ShieldCheck className="h-2.5 w-2.5" /> conversou
                        </span>
                      ) : c.match_via === 'janela' ? (
                        <span
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-amber-500/10 text-amber-300 border-amber-500/30"
                          title="O tempo bateu, mas o código invisível não veio. Não é prova — não carimba nada no CRM."
                        >
                          <AlertTriangle className="h-2.5 w-2.5" /> só marcado
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-slate-500/10 text-slate-300 border-slate-500/30">
                          só clicou
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-ink-faint font-mono text-[10px] max-w-[160px] truncate"
                        title={c.utm_content ?? ''}>
                      {c.utm_content || '—'}
                    </td>
                    <td className="px-2 py-1.5">
                      {c.fbclid ? (
                        <span className="text-[10px] text-emerald-300">sim</span>
                      ) : (
                        <span className="text-[10px] text-ink-faint" title={c.referer ?? ''}>
                          {c.utm_source || c.referer || 'não'}
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 space-y-1">
            <p className="text-[10px] text-ink-faint">
              <b className="text-emerald-300">conversou</b> = o código invisível bateu. É certeza, e é o único caso
              que carimba origem e criativo no atendimento — e o único que vira evento no Meta.
            </p>
            <p className="text-[10px] text-ink-faint">
              <b className="text-amber-300">só marcado</b> = o tempo bateu mas o código não veio. <b>Não é prova</b> e
              não escreve nada no CRM. Serve pra medir quantos cliques reais perdem o código no caminho.
            </p>
            <p className="text-[10px] text-ink-faint">
              <b>Veio do Meta?</b> "sim" quer dizer que o clique trouxe a assinatura do anúncio (fbclid) — sem ela o
              evento chega anônimo no Meta e não credita criativo nenhum.
            </p>
          </div>
        </Card>
      )}
    </div>
  )
}

export default LinksRoteamento
