import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { MapPin, Monitor, Smartphone, ShieldAlert, Clock, Trash2, Plus, LogOut } from 'lucide-react'
import {
  useAcessoEventos,
  useQuemEstaOnline,
  useSessoesAtivas,
  useDerrubarSessoes,
  useJanelas,
  useSalvarJanela,
  useApagarJanela,
  useSalvarAcessoConfig,
  type JanelaAcesso,
} from '@/hooks/useAcesso'
import { useAcessoConfig } from '@/hooks/useLocalizacaoObrigatoria'

const DIAS = [
  { n: 1, l: 'Seg' },
  { n: 2, l: 'Ter' },
  { n: 3, l: 'Qua' },
  { n: 4, l: 'Qui' },
  { n: 5, l: 'Sex' },
  { n: 6, l: 'Sáb' },
  { n: 7, l: 'Dom' },
]

function quando(iso: string) {
  const d = new Date(iso)
  const min = Math.floor((Date.now() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  if (min < 1440) return `há ${Math.floor(min / 60)} h`
  return d.toLocaleDateString('pt-BR')
}

function local(e: { cidade: string | null; uf: string | null; pais: string | null }) {
  const partes = [e.cidade, e.uf].filter(Boolean)
  if (!partes.length) return e.pais || '—'
  return partes.join(' / ')
}

function useUsuarios() {
  return useQuery({
    queryKey: ['user_profiles_acesso'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id,email,display_name,role')
        .order('email')
      if (error) throw error
      return (data ?? []) as Array<{ id: string; email: string; display_name: string | null; role: string }>
    },
  })
}

export function AdminAcessos() {
  const [aba, setAba] = useState<'online' | 'trilha' | 'sessoes' | 'janelas'>('online')
  const [dias, setDias] = useState(7)
  const [filtroEmail, setFiltroEmail] = useState('')
  const [filtroRota, setFiltroRota] = useState('')

  const online = useQuemEstaOnline()
  const eventos = useAcessoEventos({ dias, email: filtroEmail || undefined, rota: filtroRota || undefined })
  const usuarios = useUsuarios()

  const paginasTop = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of eventos.data ?? []) m.set(e.rota, (m.get(e.rota) ?? 0) + 1)
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  }, [eventos.data])

  const bloqueios = useMemo(() => (eventos.data ?? []).filter(e => e.bloqueado), [eventos.data])

  return (
    <div className="p-4 md:p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-ink">Acessos</h1>
        <p className="text-[13px] text-ink-muted">
          Quem entrou, de onde e em quais telas. Retenção de 90 dias.
        </p>
      </div>

      <div className="flex gap-1.5 flex-wrap">
        {([
          ['online', 'Quem está usando'],
          ['trilha', 'Trilha de páginas'],
          ['sessoes', 'Sessões abertas'],
          ['janelas', 'Horário de acesso'],
        ] as const).map(([k, label]) => (
          <Button key={k} variant={aba === k ? 'primary' : 'secondary'} size="sm" onClick={() => setAba(k)}>
            {label}
          </Button>
        ))}
      </div>

      {aba === 'online' && (
        <Card className="p-0 overflow-hidden">
          {online.isLoading ? (
            <PageLoading />
          ) : !online.data?.length ? (
            <p className="p-6 text-[13px] text-ink-muted">
              Ninguém registrado nas últimas 24 h. A trilha começa a encher assim que as pessoas
              navegarem pelo sistema.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-surface-2 text-ink-muted">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Pessoa</th>
                    <th className="text-left px-4 py-2 font-medium">Última página</th>
                    <th className="text-left px-4 py-2 font-medium">Onde</th>
                    <th className="text-left px-4 py-2 font-medium">Dispositivo</th>
                    <th className="text-left px-4 py-2 font-medium">Quando</th>
                  </tr>
                </thead>
                <tbody>
                  {online.data.map(e => (
                    <tr key={e.user_id} className="border-t border-border">
                      <td className="px-4 py-2 text-ink">{e.email ?? e.user_id.slice(0, 8)}</td>
                      <td className="px-4 py-2 font-mono text-[12px] text-ink-muted">{e.rota}</td>
                      <td className="px-4 py-2 text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5 shrink-0" />
                          {local(e)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          {e.plataforma === 'mobile' ? (
                            <Smartphone className="w-3.5 h-3.5" />
                          ) : (
                            <Monitor className="w-3.5 h-3.5" />
                          )}
                          {e.plataforma === 'mobile' ? 'Celular' : 'Computador'}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-ink-muted">{quando(e.at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {aba === 'trilha' && (
        <div className="space-y-4">
          <Card className="p-3">
            <div className="flex flex-wrap gap-2 items-end">
              <div>
                <label className="block text-[11px] text-ink-muted mb-1">Período</label>
                <Select
                  value={String(dias)}
                  onChange={e => setDias(Number(e.target.value))}
                  options={[
                    { value: '1', label: 'Últimas 24 h' },
                    { value: '7', label: '7 dias' },
                    { value: '30', label: '30 dias' },
                    { value: '90', label: '90 dias' },
                  ]}
                />
              </div>
              <div>
                <label className="block text-[11px] text-ink-muted mb-1">Pessoa</label>
                <Select
                  value={filtroEmail}
                  onChange={e => setFiltroEmail(e.target.value)}
                  placeholder="Todas"
                  options={(usuarios.data ?? []).map(u => ({ value: u.email, label: u.email }))}
                />
              </div>
              <div>
                <label className="block text-[11px] text-ink-muted mb-1">Página começa com</label>
                <Input
                  value={filtroRota}
                  onChange={e => setFiltroRota(e.target.value)}
                  placeholder="/contatos"
                  className="font-mono"
                />
              </div>
            </div>
          </Card>

          {bloqueios.length > 0 && (
            <Card className="p-3 border-warning">
              <p className="text-[13px] text-ink flex items-center gap-1.5">
                <ShieldAlert className="w-4 h-4 text-warning shrink-0" />
                <span>
                  <strong>{bloqueios.length}</strong> tentativa{bloqueios.length > 1 ? 's' : ''} de
                  acesso fora do horário no período.
                </span>
              </p>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card className="p-0 overflow-hidden">
              {eventos.isLoading ? (
                <PageLoading />
              ) : !eventos.data?.length ? (
                <p className="p-6 text-[13px] text-ink-muted">Nenhum acesso no período.</p>
              ) : (
                <div className="overflow-x-auto max-h-[70vh]">
                  <table className="w-full text-[13px]">
                    <thead className="bg-surface-2 text-ink-muted sticky top-0">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Quando</th>
                        <th className="text-left px-3 py-2 font-medium">Pessoa</th>
                        <th className="text-left px-3 py-2 font-medium">Página</th>
                        <th className="text-left px-3 py-2 font-medium">Onde</th>
                        <th className="text-left px-3 py-2 font-medium">IP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {eventos.data.map(e => (
                        <tr key={e.id} className="border-t border-border">
                          <td className="px-3 py-1.5 text-ink-muted whitespace-nowrap">
                            {new Date(e.at).toLocaleString('pt-BR')}
                          </td>
                          <td className="px-3 py-1.5 text-ink">{e.email ?? '—'}</td>
                          <td className="px-3 py-1.5 font-mono text-[12px] text-ink-muted">
                            {e.rota}
                            {e.bloqueado && (
                              <Badge className="ml-2 bg-warning-bg text-warning">bloqueado</Badge>
                            )}
                          </td>
                          <td className="px-3 py-1.5 text-ink-muted">
                            {local(e)}
                            {e.lat != null && e.lon != null && (
                              <a
                                href={`https://www.google.com/maps?q=${e.lat},${e.lon}`}
                                target="_blank"
                                rel="noreferrer"
                                className="ml-1.5 text-accent hover:underline"
                                title={
                                  e.precisao_m
                                    ? `GPS · precisão ~${Math.round(e.precisao_m)} m`
                                    : 'GPS'
                                }
                              >
                                ver no mapa
                              </a>
                            )}
                            {e.geo_estado === 'denied' && (
                              <Badge className="ml-1.5 bg-warning-bg text-warning">
                                negou GPS
                              </Badge>
                            )}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-[11px] text-ink-faint">
                            {e.ip ?? '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <Card className="p-4 h-fit">
              <h3 className="text-[13px] font-medium text-ink mb-3">Páginas mais abertas</h3>
              {!paginasTop.length ? (
                <p className="text-[13px] text-ink-muted">Sem dados.</p>
              ) : (
                <ul className="space-y-1.5">
                  {paginasTop.map(([rota, n]) => (
                    <li key={rota} className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[12px] text-ink-muted truncate">{rota}</span>
                      <Badge className="bg-surface-2 text-ink-muted shrink-0">{n}</Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      )}

      {aba === 'sessoes' && <PainelSessoes />}

      {aba === 'janelas' && <PainelJanelas usuarios={usuarios.data ?? []} />}
    </div>
  )
}

function PainelSessoes() {
  const sessoes = useSessoesAtivas()
  const derrubar = useDerrubarSessoes()
  const [confirmando, setConfirmando] = useState<string | null>(null)

  // Uma linha por PESSOA (a sessão é por dispositivo/navegador — o que importa
  // pro admin é quantas estão abertas e desde quando a mais antiga).
  const porPessoa = useMemo(() => {
    const m = new Map<string, { email: string; papel: string; n: number; ips: Set<string>; maisAntiga: string; ultimo: string }>()
    for (const s of sessoes.data ?? []) {
      const atual = m.get(s.user_id)
      if (!atual) {
        m.set(s.user_id, {
          email: s.email,
          papel: s.papel,
          n: 1,
          ips: new Set(s.ip ? [s.ip] : []),
          maisAntiga: s.criada_em,
          ultimo: s.ultimo_uso,
        })
      } else {
        atual.n++
        if (s.ip) atual.ips.add(s.ip)
        if (s.criada_em < atual.maisAntiga) atual.maisAntiga = s.criada_em
        if (s.ultimo_uso > atual.ultimo) atual.ultimo = s.ultimo_uso
      }
    }
    return [...m.entries()].sort((a, b) => b[1].ultimo.localeCompare(a[1].ultimo))
  }, [sessoes.data])

  const diasDe = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <p className="text-[13px] text-ink-muted">
          <ShieldAlert className="w-3.5 h-3.5 inline mr-1 -mt-0.5 text-warning" />
          As sessões deste projeto <strong>não expiram sozinhas</strong>. Tirar o papel de alguém
          não o desconecta — quem desconecta é <em>Derrubar</em>. Depois de derrubar, a pessoa cai
          na próxima renovação do token (até 1 h).
        </p>
      </Card>

      <Card className="p-0 overflow-hidden">
        {sessoes.isLoading ? (
          <PageLoading />
        ) : !porPessoa.length ? (
          <p className="p-6 text-[13px] text-ink-muted">Nenhuma sessão ativa.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead className="bg-surface-2 text-ink-muted">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Pessoa</th>
                  <th className="text-left px-4 py-2 font-medium">Papel</th>
                  <th className="text-left px-4 py-2 font-medium">Sessões</th>
                  <th className="text-left px-4 py-2 font-medium">IPs</th>
                  <th className="text-left px-4 py-2 font-medium">Aberta há</th>
                  <th className="text-left px-4 py-2 font-medium">Último uso</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {porPessoa.map(([userId, p]) => (
                  <tr key={userId} className="border-t border-border">
                    <td className="px-4 py-2 text-ink">{p.email}</td>
                    <td className="px-4 py-2">
                      <Badge className="bg-surface-2 text-ink-muted">{p.papel}</Badge>
                    </td>
                    <td className="px-4 py-2 text-ink-muted">{p.n}</td>
                    <td className="px-4 py-2 font-mono text-[11px] text-ink-faint">
                      {[...p.ips].join(', ') || '—'}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">
                      {diasDe(p.maisAntiga) > 30 ? (
                        <span className="text-warning">{diasDe(p.maisAntiga)} dias</span>
                      ) : (
                        `${diasDe(p.maisAntiga)} dias`
                      )}
                    </td>
                    <td className="px-4 py-2 text-ink-muted">{quando(p.ultimo)}</td>
                    <td className="px-4 py-2 text-right whitespace-nowrap">
                      {confirmando === userId ? (
                        <>
                          <Button
                            size="sm"
                            variant="danger"
                            loading={derrubar.isPending}
                            onClick={() =>
                              derrubar.mutate(userId, { onSettled: () => setConfirmando(null) })
                            }
                          >
                            Confirmar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)}>
                            Cancelar
                          </Button>
                        </>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={() => setConfirmando(userId)}>
                          <LogOut className="w-3.5 h-3.5" />
                          Derrubar
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {derrubar.isError && (
          <p className="p-3 text-[12px] text-danger">
            Não derrubou: {(derrubar.error as Error)?.message}
          </p>
        )}
      </Card>
    </div>
  )
}

const PAPEIS_GATE = ['vendor', 'marketing', 'visualizador', 'representante', 'mapa', 'consultor']

function PainelLocalizacao() {
  const { data: cfg } = useAcessoConfig()
  const salvar = useSalvarAcessoConfig()
  const ligado = !!cfg?.exigir_localizacao
  const papeis = cfg?.papeis_obrigatorios ?? []

  const togglePapel = (p: string) =>
    salvar.mutate({
      exigir_localizacao: ligado,
      papeis_obrigatorios: papeis.includes(p) ? papeis.filter(x => x !== p) : [...papeis, p],
    })

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-[13px] font-medium text-ink flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5" />
            Exigir localização para usar o sistema
          </h3>
          <p className="text-[12px] text-ink-muted mt-1 max-w-xl">
            Quem não permitir a localização não entra. O navegador mostra um pedido de
            autorização — <strong>não existe captura silenciosa</strong>, a pessoa vê e aceita.
            Administradores nunca são exigidos.
          </p>
        </div>
        <Button
          variant={ligado ? 'danger' : 'primary'}
          loading={salvar.isPending}
          onClick={() => salvar.mutate({ exigir_localizacao: !ligado, papeis_obrigatorios: papeis })}
        >
          {ligado ? 'Desligar exigência' : 'Ligar exigência'}
        </Button>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-ink-muted mr-1">Exigir de:</span>
        {PAPEIS_GATE.map(p => (
          <Button
            key={p}
            size="sm"
            variant={papeis.includes(p) ? 'primary' : 'secondary'}
            onClick={() => togglePapel(p)}
          >
            {p}
          </Button>
        ))}
      </div>

      {ligado && (
        <p className="mt-3 text-[12px] text-warning">
          Ativo. Quem já tinha negado a localização no navegador precisa liberar no cadeado da
          barra de endereço — a tela explica o caminho.
        </p>
      )}
      {salvar.isError && (
        <p className="mt-2 text-[12px] text-danger">
          Não salvou: {(salvar.error as Error)?.message}
        </p>
      )}
    </Card>
  )
}

function PainelJanelas({
  usuarios,
}: {
  usuarios: Array<{ id: string; email: string; role: string }>
}) {
  const janelas = useJanelas()
  const salvar = useSalvarJanela()
  const apagar = useApagarJanela()
  const [nova, setNova] = useState<Partial<JanelaAcesso> & { user_id: string }>({
    user_id: '',
    dias: [1, 2, 3, 4, 5],
    hora_inicio: '07:30',
    hora_fim: '18:00',
    rota_prefixo: '',
  })

  const emailDe = (id: string) => usuarios.find(u => u.id === id)?.email ?? id.slice(0, 8)

  const toggleDia = (d: number) => {
    const atuais = nova.dias ?? []
    setNova({ ...nova, dias: atuais.includes(d) ? atuais.filter(x => x !== d) : [...atuais, d] })
  }

  return (
    <div className="space-y-4">
      <PainelLocalizacao />

      <Card className="p-4">
        <p className="text-[13px] text-ink-muted">
          <Clock className="w-3.5 h-3.5 inline mr-1 -mt-0.5" />
          Quem <strong>não tem</strong> janela cadastrada acessa livremente. Deixe a página em
          branco para travar o sistema inteiro, ou preencha (ex.: <code>/contatos</code>) para
          travar só aquela tela. <strong>Administradores nunca são bloqueados</strong> — é o que
          impede de trancar todo mundo do lado de fora.
        </p>
      </Card>

      <Card className="p-4">
        <h3 className="text-[13px] font-medium text-ink mb-3">Nova regra</h3>
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div>
            <label className="block text-[11px] text-ink-muted mb-1">Pessoa</label>
            <Select
              value={nova.user_id}
              onChange={e => setNova({ ...nova, user_id: e.target.value })}
              placeholder="Escolher…"
              options={usuarios
                .filter(u => u.role !== 'admin' && u.role !== 'rejected')
                .map(u => ({ value: u.id, label: u.email }))}
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted mb-1">Das</label>
            <Input
              type="time"
              value={(nova.hora_inicio ?? '07:30').slice(0, 5)}
              onChange={e => setNova({ ...nova, hora_inicio: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted mb-1">Até</label>
            <Input
              type="time"
              value={(nova.hora_fim ?? '18:00').slice(0, 5)}
              onChange={e => setNova({ ...nova, hora_fim: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-[11px] text-ink-muted mb-1">
              Página (vazio = tudo)
            </label>
            <Input
              value={nova.rota_prefixo ?? ''}
              onChange={e => setNova({ ...nova, rota_prefixo: e.target.value })}
              placeholder="/contatos"
              className="font-mono"
            />
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-muted mr-1">Dias:</span>
          {DIAS.map(d => (
            <Button
              key={d.n}
              size="sm"
              variant={(nova.dias ?? []).includes(d.n) ? 'primary' : 'secondary'}
              onClick={() => toggleDia(d.n)}
            >
              {d.l}
            </Button>
          ))}
        </div>

        <div className="mt-4">
          <Button
            variant="primary"
            disabled={!nova.user_id || !(nova.dias ?? []).length}
            loading={salvar.isPending}
            onClick={() =>
              salvar.mutate(nova, {
                onSuccess: () =>
                  setNova({
                    user_id: '',
                    dias: [1, 2, 3, 4, 5],
                    hora_inicio: '07:30',
                    hora_fim: '18:00',
                    rota_prefixo: '',
                  }),
              })
            }
          >
            <Plus className="w-3.5 h-3.5" />
            Criar regra
          </Button>
          {salvar.isError && (
            <span className="ml-3 text-[12px] text-danger">
              Não salvou: {(salvar.error as Error)?.message}
            </span>
          )}
        </div>
      </Card>

      <Card className="p-0 overflow-hidden">
        {janelas.isLoading ? (
          <PageLoading />
        ) : !janelas.data?.length ? (
          <p className="p-6 text-[13px] text-ink-muted">
            Nenhuma regra ativa — todo mundo acessa em qualquer horário.
          </p>
        ) : (
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 text-ink-muted">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Pessoa</th>
                <th className="text-left px-4 py-2 font-medium">Dias</th>
                <th className="text-left px-4 py-2 font-medium">Horário</th>
                <th className="text-left px-4 py-2 font-medium">Página</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {janelas.data.map(j => (
                <tr key={j.id} className="border-t border-border">
                  <td className="px-4 py-2 text-ink">{emailDe(j.user_id)}</td>
                  <td className="px-4 py-2 text-ink-muted">
                    {[...j.dias].sort((a, b) => a - b).map(d => DIAS.find(x => x.n === d)?.l).join(', ')}
                  </td>
                  <td className="px-4 py-2 text-ink-muted">
                    {j.hora_inicio.slice(0, 5)} – {j.hora_fim.slice(0, 5)}
                  </td>
                  <td className="px-4 py-2 font-mono text-[12px] text-ink-muted">
                    {j.rota_prefixo || <span className="font-sans italic">sistema inteiro</span>}
                  </td>
                  <td className="px-4 py-2 text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => apagar.mutate(j.id)}
                      title="Remover regra"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  )
}
