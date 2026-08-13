// Links de roteamento — seção da Central de Roteamento (/disparos).
//
// Cria links curtos (branorte-crm.vercel.app/l/<slug>) pra colar em site,
// formulário, bio ou anúncio. Quem clica cai no WhatsApp do PRÓXIMO vendedor da
// fila — a mesma fila do quiz e das ALPs — com um texto já escrito.
//
// A tabela de baixo mostra o que aconteceu depois do clique: "conversou" quer
// dizer que o cliente mandou mensagem de verdade e o banco casou a conversa com
// o clique (gatilho link_rota_casar_msg, migration 20260805_link_rota.sql).

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { supabase } from '@/lib/supabase'
import { Link2, Copy, Check, Plus, Trash2, Pencil, X, MousePointerClick, MessageSquare } from 'lucide-react'
import { useSecaoRecolhivel } from '@/hooks/useSecaoRecolhivel'
import { TituloRecolhivel } from '@/components/ui/Recolhivel'

type LinkRota = {
  id: string
  slug: string
  nome: string
  mensagem: string
  origem: string
  ativo: boolean
  fallback_telefone: string | null
}

type Resumo = {
  id: string
  slug: string
  nome: string
  origem: string
  ativo: boolean
  cliques: number
  /** Total — soma certeza e chute. Mantido por compatibilidade; NÃO exibir. */
  conversas: number
  /** Casamento provado: selo invisível ou texto do link. */
  conversas_certas: number
  /** Casado só pela janela de tempo. Já adotou lead de Instagram, Facebook,
   *  quiz e até fornecedor prospectando — não é fato, é palpite. */
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
  referer: string | null
}

const MENSAGEM_PADRAO =
  'Olá! Vi o site da Branorte e queria falar sobre fábrica de ração.'

/** Base do link. Em preview/localhost mostra a origem atual pra não enganar
 *  quem estiver testando com um endereço que não é o de produção. */
function baseDoLink(): string {
  if (typeof window === 'undefined') return 'https://branorte-crm.vercel.app'
  return window.location.origin
}

export function LinksRoteamento() {
  const qc = useQueryClient()
  const [editando, setEditando] = useState<Partial<LinkRota> | null>(null)
  const [copiado, setCopiado] = useState<string | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  // A lista passa de 30 links e a tabela de cliques tem 50 linhas: as duas
  // recolhem separado (e o que você fechar continua fechado na próxima visita).
  const secao = useSecaoRecolhivel('disparos.links')
  const secCliques = useSecaoRecolhivel('disparos.links.cliques')
  // Com formulário aberto o corpo fica aberto NA MARRA. Sem isso, recolher a
  // seção no meio de uma edição deixava o formulário flutuando sob um título
  // fechado — e pior: ao salvar, a lista (escondida) não mostrava o link novo,
  // então parecia que não salvou e o usuário tentava de novo, batendo em
  // "endereço já está em uso" com um link que ele mesmo acabou de criar.
  const corpoAberto = secao.aberta || !!editando
  const secaoVisivel = { aberta: corpoAberto, alternar: secao.alternar }

  const { data: links } = useQuery<Resumo[]>({
    queryKey: ['link-rota-resumo'],
    queryFn: async () => {
      const { data } = await supabase.from('link_rota_resumo').select('*').order('nome')
      return (data as Resumo[]) || []
    },
    refetchInterval: 30_000,
  })

  const { data: cliques } = useQuery<Clique[]>({
    queryKey: ['link-rota-cliques'],
    queryFn: async () => {
      const { data } = await supabase
        .from('link_rota_click')
        .select(
          'id, link_id, codigo, vendedor_nome, fallback, created_at, matched_at, match_via, cliente_telefone, utm_source, utm_campaign, referer'
        )
        .order('created_at', { ascending: false })
        .limit(50)
      return (data as Clique[]) || []
    },
    refetchInterval: 30_000,
  })

  const nomePorId = useMemo(() => {
    const m: Record<string, string> = {}
    for (const l of links || []) m[l.id] = l.nome
    return m
  }, [links])

  const salvar = useMutation({
    mutationFn: async (l: Partial<LinkRota>) => {
      const payload = {
        slug: String(l.slug || '').trim().toLowerCase(),
        nome: String(l.nome || '').trim(),
        mensagem: String(l.mensagem || '').trim(),
        origem: String(l.origem || '').trim() || 'Link',
        ativo: l.ativo !== false,
        fallback_telefone: l.fallback_telefone?.replace(/\D/g, '') || null,
      }
      if (!payload.nome) throw new Error('Dá um nome pro link.')
      if (!payload.mensagem) throw new Error('O texto que o cliente vai mandar não pode ficar vazio.')
      if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(payload.slug))
        throw new Error('Endereço inválido: só letras minúsculas, números e hífen (ex: fabrica-racao).')

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
      qc.invalidateQueries({ queryKey: ['link-rota-cliques'] })
    },
    onError: (e: Error) => setErro(e.message),
  })

  async function copiar(slug: string) {
    const url = `${baseDoLink()}/l/${slug}`
    try {
      await navigator.clipboard.writeText(url)
      setCopiado(slug)
      setTimeout(() => setCopiado(null), 1500)
    } catch {
      setErro(`Não consegui copiar. O link é: ${url}`)
    }
  }

  async function abrirEdicao(l?: Resumo) {
    setErro(null)
    if (!l) {
      setEditando({ slug: '', nome: '', mensagem: MENSAGEM_PADRAO, origem: 'Link', ativo: true })
      return
    }
    // O resumo não traz mensagem/fallback — busca o registro completo.
    const { data } = await supabase.from('link_rota').select('*').eq('id', l.id).maybeSingle()
    setEditando((data as LinkRota) ?? l)
  }

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="min-w-0">
          <TituloRecolhivel
            secao={secaoVisivel}
            icone={<Link2 className="h-4 w-4 text-accent" />}
            resumo={`${(links ?? []).length} links${(links ?? []).some(l => !l.ativo) ? ` · ${(links ?? []).filter(l => !l.ativo).length} desligados` : ''}`}
          >
            Links de roteamento
          </TituloRecolhivel>
          {corpoAberto && (
            <p className="text-ink-muted text-xs mt-1 max-w-3xl">
              Um link pra colar onde você quiser — site, formulário, bio, anúncio. Quem clica cai no WhatsApp do{' '}
              <b>próximo vendedor da fila</b> (a mesma fila do quiz e das landing pages: respeita ligado/desligado,
              bloqueio, fatia e cota de parados) com o <b>texto que você escrever</b> já pronto. Cada clique leva um
              código invisível — quando o cliente manda a mensagem, o sistema casa sozinho a conversa com o clique.
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="primary"
          // Recolhido, criar link também abre a seção (o corpoAberto já faria
          // isso enquanto o formulário existir; alternar deixa o estado gravado
          // coerente com o que ficou na tela depois de salvar).
          onClick={() => { if (!secao.aberta) secao.alternar(); abrirEdicao() }}
          className="shrink-0"
        >
          <Plus className="h-3.5 w-3.5" /> Novo link
        </Button>
      </div>

      {erro && (
        <div className="mt-3 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300 flex items-start justify-between gap-2">
          <span>{erro}</span>
          <button onClick={() => setErro(null)} className="shrink-0 text-red-300/70 hover:text-red-200">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ---------- Formulário ---------- */}
      {editando && (
        <div className="mt-3 rounded-lg border border-accent/40 bg-surface-2/40 p-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold text-ink-muted">Nome (só você vê)</span>
              <Input
                value={editando.nome ?? ''}
                onChange={e => setEditando({ ...editando, nome: e.target.value })}
                placeholder="Botão do site — página de fábrica de ração"
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
                  placeholder="fabrica-racao"
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
              Escreva como o <b>cliente</b> falaria — é ele quem manda essa mensagem. Use{' '}
              <code className="text-accent">{'{vendedor}'}</code> se quiser o primeiro nome de quem recebeu.
            </span>
          </label>

          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-semibold text-ink-muted">Origem (rótulo do relatório)</span>
              <Input
                value={editando.origem ?? ''}
                onChange={e => setEditando({ ...editando, origem: e.target.value })}
                placeholder="Site"
              />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold text-ink-muted">
                Telefone de emergência (opcional)
              </span>
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
      )}

      {/* ---------- Lista de links ---------- */}
      {corpoAberto && (
      <div className="mt-3 space-y-2">
        {(links ?? []).length === 0 && !editando && (
          <div className="text-center py-6 text-ink-muted text-[12px]">
            Nenhum link ainda. Clique em <b>Novo link</b> pra criar o primeiro.
          </div>
        )}

        {(links ?? []).map(l => (
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
              </div>
              <button
                onClick={() => copiar(l.slug)}
                title="Copiar link"
                className="mt-1 inline-flex items-center gap-1.5 font-mono text-[11px] text-accent hover:underline break-all text-left"
              >
                {baseDoLink()}/l/{l.slug}
                {copiado === l.slug ? <Check className="h-3 w-3 shrink-0" /> : <Copy className="h-3 w-3 shrink-0" />}
              </button>
              <div className="mt-1.5 flex items-center gap-3 text-[11px] text-ink-muted flex-wrap">
                <span className="inline-flex items-center gap-1">
                  <MousePointerClick className="h-3 w-3" /> {l.cliques} clique{l.cliques === 1 ? '' : 's'}
                </span>
                {/* Certeza e palpite NÃO podem somar no mesmo número. O card
                    mostrava o total em verde, como fato: dizia 10 conversas
                    quando 3 eram reais e 7 eram lead de outra origem adotado
                    pela janela de tempo. Quem lê o número grande nunca chega
                    na tabela de detalhe, que já distinguia os dois. */}
                <span
                  className="inline-flex items-center gap-1 text-emerald-300"
                  title="Casamento provado: o código invisível bateu, ou o texto do link + segundos entre o clique e a mensagem."
                >
                  <MessageSquare className="h-3 w-3" /> {l.conversas_certas} conversa
                  {l.conversas_certas === 1 ? '' : 's'}
                </span>
                {l.conversas_provaveis > 0 && (
                  <span
                    className="inline-flex items-center gap-1 text-amber-300/80"
                    title="Casado só pela janela de tempo, sem prova. Já adotou lead vindo de Instagram, Facebook e quiz — não conte como conversão do link."
                  >
                    + {l.conversas_provaveis} sem prova
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
              <Button size="sm" variant="ghost" onClick={() => alternarAtivo.mutate(l)} title={l.ativo ? 'Desligar' : 'Ligar'}>
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
        ))}
      </div>
      )}

      {/* ---------- Últimos cliques ---------- */}
      {corpoAberto && (cliques ?? []).length > 0 && (
        <div className="mt-4">
          <TituloRecolhivel
            secao={secCliques}
            nivel="h3"
            className="text-[12px] mb-2"
            // Só `match_via === 'codigo'` conta como conversa. Contar todo
            // `matched_at` juntaria os "prováveis" (casados só pela janela de
            // tempo, que já adotaram lead de Instagram e até fornecedor) — o
            // resumo viraria a mesma mentira que a tabela abaixo deixou de contar.
            resumo={`${(cliques ?? []).length} últimos · ${(cliques ?? []).filter(c => c.match_via === 'codigo').length} com prova de conversa`}
          >
            Últimos cliques
          </TituloRecolhivel>
          {secCliques.aberta && (
          <>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead className="text-ink-muted">
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-1.5 font-semibold">Quando</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Link</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Foi pra</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Virou conversa?</th>
                  <th className="text-left px-2 py-1.5 font-semibold">Veio de</th>
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
                      {c.matched_at ? (
                        <span className="inline-flex items-center gap-1">
                          {/* A cor precisa mudar junto com a palavra. Antes os
                              dois graus saíam no MESMO verde, e verde lê-se
                              "confirmado" antes de qualquer texto. */}
                          <span
                            className={
                              'px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border ' +
                              (c.match_via === 'codigo' || c.match_via === 'texto'
                                ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                                : 'bg-amber-500/10 text-amber-300 border-amber-500/30')
                            }
                            title={
                              c.match_via === 'codigo' || c.match_via === 'texto'
                                ? 'Casamento provado.'
                                : 'Casado só pela janela de tempo — pode ser lead de outra origem.'
                            }
                          >
                            {c.match_via === 'codigo' || c.match_via === 'texto' ? 'conversou' : 'sem prova'}
                          </span>
                          {c.cliente_telefone && (
                            <span className="font-mono text-[10px] text-ink-faint">+{c.cliente_telefone}</span>
                          )}
                        </span>
                      ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border bg-slate-500/10 text-slate-300 border-slate-500/30">
                          só clicou
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 text-ink-faint max-w-[220px] truncate" title={c.referer ?? ''}>
                      {c.utm_campaign || c.utm_source || c.referer || '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] text-ink-faint mt-2">
            <b>conversou</b> = o código invisível bateu, é certeza. <b>sem prova</b> = o WhatsApp limpou o código e o
            sistema casou por <i>vendedor + tempo</i> — qualquer conversa nova daquele vendedor dentro de 1 hora do
            clique. Isso adota lead de outra origem: medido em 05–07/08, <b>7 de 7</b> vieram de Instagram, Facebook,
            quiz e até de um fornecedor. Não conte como conversão do link. <b>só clicou</b> = abriu o WhatsApp e não
            mandou nada (ou ainda não mandou).
          </p>
          </>
          )}
        </div>
      )}
    </Card>
  )
}
