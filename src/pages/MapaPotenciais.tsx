import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useAuth } from '@/hooks/useAuth'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  useProspects, useSalvarProspect, STATUS_PROSPECT, BASES,
  type Prospect, type FonteBase,
} from '@/hooks/useProspects'

// Mapa de POSSÍVEIS representantes — prospecção outbound.
// 174 candidatos de DUAS pesquisas públicas de 06/08/2026 (Plasson, Big Dutchman,
// MSD, Silomax, IRCA, Indubras, Vetnil, Grupo Real e empresas locais):
//   base-148     → pesquisa nacional, 120 registros que não estavam na outra
//   planilha-54  → mapeamento de 2 por UF, 54 registros
// 28 empresas apareciam nas duas (casadas por nome+UF ou por telefone) e entraram
// uma vez só. As réguas de nota são DIFERENTES — ver pontuacao_max/prioridade_origem.
//
// Diferente dos outros dois mapas:
//   /mapa-visitas          → 1 pino por CLIENTE (quem já cotou ou comprou)
//   /mapa-representantes   → território dos 9 vendedores INTERNOS, o Brasil pintado por UF
//   /mapa-potenciais (aqui)→ 1 pino por CANDIDATO a representante externo, com contato
//
// A tela é operacional: dá pra marcar status da abordagem, dono e anotação sem sair
// do mapa. Esses 3 campos são os únicos graváveis — o resto é a pesquisa, congelada.

type Colorir = 'prioridade' | 'risco' | 'status'

const COR_PRIORIDADE: Record<string, string> = {
  Alta: '#10b981', Média: '#f59e0b', Exploratória: '#64748b',
}
const COR_RISCO: Record<string, string> = {
  Baixo: '#10b981', Médio: '#f59e0b', Alto: '#ef4444',
}
const COR_STATUS: Record<string, string> = {
  'Não abordado': '#94a3b8', 'Em contato': '#38bdf8', 'Negociando': '#a78bfa',
  'Fechado': '#10b981', 'Descartado': '#475569',
}
const CINZA = '#94a3b8'

const LEGENDAS: Record<Colorir, { titulo: string; itens: [string, string][]; nota: string }> = {
  prioridade: {
    titulo: 'Prioridade de abordagem',
    itens: Object.entries(COR_PRIORIDADE) as [string, string][],
    nota: 'Nota ajustada = fit de mercado + carteira + contato + presença local, menos o desconto do risco.',
  },
  risco: {
    titulo: 'Risco de conflito',
    itens: Object.entries(COR_RISCO) as [string, string][],
    nota: 'Alto = concorrente direto (Plasson, Big Dutchman). Baixo = distribuidor complementar.',
  },
  status: {
    titulo: 'Status da abordagem',
    itens: Object.entries(COR_STATUS) as [string, string][],
    nota: 'Marcado pela equipe na ficha do candidato — o mapa repinta na hora.',
  },
}

const REGIOES = ['Norte', 'Nordeste', 'Centro-Oeste', 'Sudeste', 'Sul']
const CENTRO_BR: [number, number] = [-14.5, -52]

function corDe(p: Prospect, modo: Colorir): string {
  if (modo === 'risco') return COR_RISCO[p.risco ?? ''] ?? CINZA
  if (modo === 'status') return COR_STATUS[p.status] ?? CINZA
  return COR_PRIORIDADE[p.prioridade ?? ''] ?? CINZA
}

// Pino de gota = tem cidade. Losango VAZADO = a fonte não publicou a cidade e o
// ponto é o centro do estado. A forma tem que denunciar isso: uma gota igual às
// outras seria afirmar um endereço que ninguém apurou.
function pinIcon(cor: string, destacado: boolean, semCidade: boolean): L.DivIcon {
  const t = destacado ? 28 : 22
  const halo = destacado ? ',0 0 0 4px rgba(56,189,248,.45)' : ''
  const html = semCidade
    ? `<div style="width:${t - 4}px;height:${t - 4}px;margin:2px;background:transparent;`
      + `border:${destacado ? 3 : 2}px dashed ${cor};transform:rotate(45deg);`
      + `box-shadow:0 1px 4px rgba(0,0,0,.35)${halo}"></div>`
    : `<div style="width:${t}px;height:${t}px;border-radius:50% 50% 50% 0;background:${cor};`
      + `transform:rotate(-45deg);border:${destacado ? 3 : 2}px solid #fff;`
      + `box-shadow:0 1px 5px rgba(0,0,0,.45)${halo}"></div>`
  return L.divIcon({
    className: 'prospect-pin',
    html,
    iconSize: [t, t],
    iconAnchor: semCidade ? [t / 2, t / 2] : [t / 2, t],
    popupAnchor: [0, -t],
  })
}

// A base nacional publica o site sem protocolo ("silomax.com.br"). Sem o https://
// o href vira caminho RELATIVO e o clique leva pra dentro do próprio CRM.
const siteHref = (s: string) => (/^https?:\/\//i.test(s) ? s : `https://${s}`)

/** Telefones vêm como "(75) 3244-2281 / (75) 99199-3029". Separa e devolve os dígitos. */
function telefones(bruto: string | null): { exibir: string; digitos: string }[] {
  if (!bruto) return []
  return bruto.split('/').map(t => t.trim()).filter(Boolean).map(t => ({
    exibir: t, digitos: t.replace(/\D/g, ''),
  })).filter(t => t.digitos.length >= 10)
}
/** Celular tem 9 dígitos depois do DDD — só nele o wa.me faz sentido. */
const ehCelular = (d: string) => d.length === 11 || (d.length === 13 && d.startsWith('55'))
const waLink = (d: string) => `https://wa.me/55${d.replace(/^55/, '')}`

const MSG_BASE = (empresa: string, nome: string | null) =>
  `Olá${nome && nome.toLowerCase() !== 'comercial' ? `, ${nome}` : ''}. Sou Daniel, da BraNorte Metalúrgica, `
  + `fabricante de equipamentos para fábricas de ração para bovinos, suínos e aves. `
  + `Identificamos que a ${empresa} já atende produtores do nosso público e gostaríamos de avaliar `
  + `uma parceria comercial para sua região. Trabalhamos com comissão, apoio técnico e projetos `
  + `personalizados. Você teria interesse numa conversa rápida para entendermos sua carteira, `
  + `território de atuação e possíveis restrições de exclusividade?`

// Candidatos que dividem a mesma coordenada empilhariam um pino em cima do outro:
// 9 cidades têm 2 candidatos, e os 50 sem cidade publicada caem todos no centro do
// próprio estado (a Bahia sozinha tem 7). Espalha em círculo — a coordenada real
// fica intacta no banco.
function espalhar(lista: Prospect[]): Map<number, [number, number]> {
  const porChave = new Map<string, Prospect[]>()
  for (const p of lista) {
    if (p.lat == null || p.lng == null) continue
    const k = `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`
    const arr = porChave.get(k)
    if (arr) arr.push(p); else porChave.set(k, [p])
  }
  const out = new Map<number, [number, number]>()
  for (const grupo of porChave.values()) {
    if (grupo.length === 1) {
      out.set(grupo[0].id, [grupo[0].lat!, grupo[0].lng!])
      continue
    }
    // ~8 km pra empate de cidade; ~40 km pro empate no centro do estado, senão os
    // 7 da Bahia viram um borrão só no zoom em que se olha um estado.
    const raio = grupo[0].geo_precisao === 'uf' ? 0.36 : 0.075
    grupo.forEach((p, i) => {
      const ang = (2 * Math.PI * i) / grupo.length
      out.set(p.id, [p.lat! + raio * Math.sin(ang), p.lng! + raio * Math.cos(ang)])
    })
  }
  return out
}

export function MapaPotenciais() {
  const { data: prospects, isLoading, error } = useProspects()
  const salvar = useSalvarProspect()
  const { profile } = useAuth()

  const [colorir, setColorir] = useState<Colorir>('prioridade')
  const [busca, setBusca] = useState('')
  const [fRegiao, setFRegiao] = useState('')
  const [fPrioridade, setFPrioridade] = useState('')
  const [fRisco, setFRisco] = useState('')
  const [fStatus, setFStatus] = useState('')
  const [fBase, setFBase] = useState('')
  const [soComCidade, setSoComCidade] = useState(false)
  const [selecionado, setSelecionado] = useState<number | null>(null)
  const [copiado, setCopiado] = useState(false)

  const lista = prospects ?? []

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter(p => {
      if (fRegiao && p.regiao !== fRegiao) return false
      if (fPrioridade && p.prioridade !== fPrioridade) return false
      if (fRisco && p.risco !== fRisco) return false
      if (fStatus && p.status !== fStatus) return false
      if (fBase && p.fonte_base !== fBase) return false
      if (soComCidade && p.geo_precisao === 'uf') return false
      if (!q) return true
      return [p.empresa, p.contato, p.cidade, p.uf, p.estado, p.rede, p.segmento, p.especies]
        .some(v => (v ?? '').toLowerCase().includes(q))
    })
  }, [lista, busca, fRegiao, fPrioridade, fRisco, fStatus, fBase, soComCidade])

  const posicoes = useMemo(() => espalhar(filtrados), [filtrados])
  const atual = useMemo(
    () => filtrados.find(p => p.id === selecionado) ?? null,
    [filtrados, selecionado],
  )

  const resumo = useMemo(() => ({
    ufs: new Set(filtrados.map(p => p.uf).filter(uf => uf !== 'NAC')).size,
    alta: filtrados.filter(p => p.prioridade === 'Alta').length,
    baixoRisco: filtrados.filter(p => p.risco === 'Baixo').length,
    onda1: filtrados.filter(p => p.prioridade === 'Alta' && p.risco === 'Baixo').length,
    trabalhados: filtrados.filter(p => p.status !== 'Não abordado').length,
    semCidade: filtrados.filter(p => p.geo_precisao === 'uf').length,
  }), [filtrados])

  // ── Mapa ────────────────────────────────────────────────────────────────
  const divRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const camadaRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const map = L.map(divRef.current, { center: CENTRO_BR, zoom: 4, zoomControl: true, scrollWheelZoom: true })
    const mapa = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google Maps', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20,
    }).addTo(map)
    const satelite = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google Maps', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20,
    })
    L.control.layers({ 'Mapa': mapa, 'Satélite': satelite }, {}, { collapsed: true, position: 'topright' }).addTo(map)
    camadaRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; camadaRef.current = null }
  }, [])

  // redesenha os pinos a cada filtro / cor / seleção
  useEffect(() => {
    const camada = camadaRef.current
    if (!camada) return
    camada.clearLayers()
    for (const p of filtrados) {
      const pos = posicoes.get(p.id)
      if (!pos) continue
      const semCidade = p.geo_precisao === 'uf'
      const local = semCidade ? `${p.uf} · cidade não publicada` : `${p.cidade}/${p.uf_cidade}`
      const m = L.marker(pos, {
        icon: pinIcon(corDe(p, colorir), p.id === selecionado, semCidade),
        title: `${p.empresa} — ${local}`,
        zIndexOffset: p.id === selecionado ? 1000 : semCidade ? -100 : 0,
      })
      m.bindTooltip(
        `<b>${p.empresa}</b><br>${local} · ${p.tipo ?? ''}<br>`
        + `<span style="opacity:.8">${p.segmento ?? ''}</span>`,
        { direction: 'top', offset: [0, -20] },
      )
      m.on('click', () => { setSelecionado(p.id); setCopiado(false) })
      camada.addLayer(m)
    }
  }, [filtrados, posicoes, colorir, selecionado])

  // ao escolher um candidato na lista, o mapa vai até ele
  useEffect(() => {
    const map = mapRef.current
    const pos = selecionado != null ? posicoes.get(selecionado) : null
    if (map && pos) map.flyTo(pos, Math.max(map.getZoom(), 6), { duration: 0.6 })
  }, [selecionado, posicoes])

  useEffect(() => {
    const t = setTimeout(() => mapRef.current?.invalidateSize(), 150)
    return () => clearTimeout(t)
  }, [atual])

  // Conta 'mapa' (Patrick) abre em tela cheia, sem o cabeçalho do Layout.
  const telaCheia = profile?.role === 'mapa'
  const autor = profile?.display_name ?? profile?.email ?? null
  const legenda = LEGENDAS[colorir]

  function patch(campo: 'status' | 'responsavel' | 'anotacoes', valor: string) {
    if (!atual) return
    salvar.mutate({ id: atual.id, [campo]: valor, autor })
  }

  return (
    <div className={`flex flex-col gap-3 min-h-0 ${telaCheia ? 'h-[100dvh] p-3' : 'h-[calc(100dvh-7rem)]'}`}>
      {/* cabeçalho */}
      <div className="shrink-0 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-ink">Possíveis Representantes</h1>
          <p className="text-[13px] text-ink-muted">
            {filtrados.length} candidatos em {resumo.ufs} estados · {resumo.alta} prioridade alta ·{' '}
            <span className="text-emerald-400 font-semibold">{resumo.onda1} na onda 1</span> (alta + risco baixo)
            {resumo.trabalhados > 0 && <> · {resumo.trabalhados} já trabalhados</>}
            {resumo.semCidade > 0 && (
              <> · <button
                onClick={() => setSoComCidade(true)}
                className="text-amber-400 hover:underline"
                title="A fonte não publicou a cidade destes — o pino é o centro do estado. Clique pra escondê-los."
              >
                {resumo.semCidade} sem cidade publicada
              </button></>
            )}
          </p>
        </div>
        <div className="flex h-9 rounded-lg overflow-hidden border border-border bg-surface text-[12px] font-semibold">
          {(['prioridade', 'risco', 'status'] as Colorir[]).map(c => (
            <button
              key={c}
              onClick={() => setColorir(c)}
              title={`Colorir os pinos por ${c}`}
              className={`px-3 capitalize ${colorir === c ? 'bg-accent text-white' : 'text-ink-muted hover:bg-surface-2'}`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* filtros */}
      <div className="shrink-0 flex flex-wrap gap-2">
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar empresa, contato, cidade, rede…"
          className="h-9 min-w-[220px] flex-1 rounded-lg border border-border bg-surface px-3 text-[13px] text-ink placeholder:text-ink-faint"
        />
        {([
          ['Região', fRegiao, setFRegiao, REGIOES],
          ['Prioridade', fPrioridade, setFPrioridade, Object.keys(COR_PRIORIDADE)],
          ['Risco', fRisco, setFRisco, Object.keys(COR_RISCO)],
          ['Status', fStatus, setFStatus, [...STATUS_PROSPECT]],
        ] as [string, string, (v: string) => void, string[]][]).map(([rotulo, valor, set, opcoes]) => (
          <select
            key={rotulo}
            value={valor}
            onChange={e => set(e.target.value)}
            className={`h-9 rounded-lg border bg-surface px-2 text-[13px] ${valor ? 'border-accent text-ink' : 'border-border text-ink-muted'}`}
          >
            <option value="">{rotulo}: todos</option>
            {opcoes.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
        ))}
        <select
          value={fBase}
          onChange={e => setFBase(e.target.value)}
          title="De qual das duas pesquisas o candidato veio"
          className={`h-9 rounded-lg border bg-surface px-2 text-[13px] ${fBase ? 'border-accent text-ink' : 'border-border text-ink-muted'}`}
        >
          <option value="">Pesquisa: todas</option>
          {BASES.map(b => <option key={b.id} value={b.id} title={b.descricao}>{b.rotulo}</option>)}
        </select>
        <button
          onClick={() => setSoComCidade(v => !v)}
          title="Esconde os candidatos cuja cidade a fonte não publicou (pino no centro do estado)"
          className={`h-9 px-3 rounded-lg border text-[12px] font-semibold ${soComCidade ? 'border-accent bg-accent text-white' : 'border-border bg-surface text-ink-muted hover:bg-surface-2'}`}
        >
          Só com cidade
        </button>
        {(busca || fRegiao || fPrioridade || fRisco || fStatus || fBase || soComCidade) && (
          <button
            onClick={() => {
              setBusca(''); setFRegiao(''); setFPrioridade(''); setFRisco('')
              setFStatus(''); setFBase(''); setSoComCidade(false)
            }}
            className="h-9 px-3 rounded-lg border border-border bg-surface text-[12px] text-ink-muted hover:bg-surface-2"
          >
            Limpar
          </button>
        )}
      </div>

      {error && (
        <div className="shrink-0 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[12px] text-red-300">
          Não consegui carregar a base de candidatos. Se o erro persistir, é permissão: esta tela
          exige perfil admin ou a permissão <b>representantes.gerir</b>.
        </div>
      )}

      <div className="relative flex-1 min-h-0 flex flex-col md:flex-row md:gap-3">
        {/* mapa + legenda */}
        <div className="relative flex-1 min-h-[42vh] md:min-h-0 rounded-xl border border-border overflow-hidden bg-surface">
          <div ref={divRef} className="absolute inset-0 z-0" />
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center z-[400]"><PageLoading /></div>
          )}
          <div className="absolute bottom-3 left-3 z-[500] max-w-[15rem] rounded-lg border border-border bg-surface/95 backdrop-blur px-3 py-2 shadow-lg">
            <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-1.5">{legenda.titulo}</div>
            <ul className="space-y-1">
              {legenda.itens.map(([rotulo, cor]) => {
                const n = filtrados.filter(p => (
                  colorir === 'risco' ? p.risco : colorir === 'status' ? p.status : p.prioridade
                ) === rotulo).length
                return (
                  <li key={rotulo} className="flex items-center gap-2 text-[12px]">
                    <span
                      className="h-3 w-3 shrink-0 border border-white/80"
                      style={{ backgroundColor: cor, borderRadius: '50% 50% 50% 0', transform: 'rotate(-45deg)' }}
                    />
                    <span className="text-ink flex-1">{rotulo}</span>
                    <span className="tabular-nums text-ink-faint">{n}</span>
                  </li>
                )
              })}
            </ul>
            {resumo.semCidade > 0 && (
              <div className="mt-1.5 pt-1.5 border-t border-border flex items-center gap-2 text-[11px]">
                <span
                  className="h-3 w-3 shrink-0 border-2 border-dashed border-ink-muted"
                  style={{ transform: 'rotate(45deg)' }}
                />
                <span className="text-ink flex-1">sem cidade — centro do estado</span>
                <span className="tabular-nums text-ink-faint">{resumo.semCidade}</span>
              </div>
            )}
            <p className="mt-1.5 pt-1.5 border-t border-border text-[10px] leading-snug text-ink-faint">{legenda.nota}</p>
          </div>
        </div>

        {/* painel lateral: ficha do escolhido, ou a lista */}
        <div className="md:w-[23rem] shrink-0 rounded-xl border border-border bg-surface overflow-y-auto max-h-[42vh] md:max-h-none">
          {atual
            ? (
              <FichaCandidato
                p={atual}
                onFechar={() => setSelecionado(null)}
                onPatch={patch}
                salvando={salvar.isPending}
                copiado={copiado}
                setCopiado={setCopiado}
              />
            )
            : (
              <div className="p-3">
                <div className="flex items-baseline justify-between mb-2">
                  <span className="text-[11px] uppercase tracking-wide text-ink-faint">Candidatos</span>
                  <span className="text-[11px] text-ink-faint">clique pra abrir a ficha</span>
                </div>
                <ul className="space-y-1">
                  {filtrados.map(p => (
                    <li key={p.id}>
                      <button
                        onClick={() => { setSelecionado(p.id); setCopiado(false) }}
                        className="w-full text-left rounded-lg px-2 py-1.5 hover:bg-surface-2"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className="h-2.5 w-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: corDe(p, colorir) }}
                          />
                          <span className="text-[13px] font-semibold text-ink flex-1 truncate">{p.empresa}</span>
                          <span className="text-[11px] font-bold tabular-nums text-ink-muted">{p.pontuacao ?? '—'}</span>
                        </div>
                        <div className="pl-[18px] text-[11px] text-ink-faint truncate">
                          {p.uf} · {p.cidade ?? <span className="text-amber-500/80">sem cidade</span>} ·{' '}
                          {p.rede ?? 'sem rede'}
                        </div>
                      </button>
                    </li>
                  ))}
                  {!filtrados.length && !isLoading && (
                    <li className="px-2 py-6 text-center text-[12px] text-ink-faint">
                      Nenhum candidato com esses filtros.
                    </li>
                  )}
                </ul>
              </div>
            )}
        </div>
      </div>
    </div>
  )
}

// ── Ficha do candidato ──────────────────────────────────────────────────────

const baseDe = (p: Prospect) =>
  BASES.find(b => b.id === p.fonte_base) ?? { id: p.fonte_base as FonteBase, rotulo: 'Pesquisa', descricao: '' }

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  if (children == null || children === '') return null
  return (
    <div className="grid grid-cols-[6.5rem_1fr] gap-2 py-1 border-b border-border/60 last:border-0">
      <span className="text-[11px] text-ink-faint pt-0.5">{rotulo}</span>
      {/* min-w-0: item de grid tem min-width:auto por padrão, e um e-mail longo
          (uma "palavra" só) estourava a largura do painel em ~44px. */}
      <span className="min-w-0 text-[12px] text-ink break-words">{children}</span>
    </div>
  )
}

function FichaCandidato({ p, onFechar, onPatch, salvando, copiado, setCopiado }: {
  p: Prospect
  onFechar: () => void
  onPatch: (campo: 'status' | 'responsavel' | 'anotacoes', valor: string) => void
  salvando: boolean
  copiado: boolean
  setCopiado: (v: boolean) => void
}) {
  const [anotacoes, setAnotacoes] = useState(p.anotacoes ?? '')
  const [responsavel, setResponsavel] = useState(p.responsavel ?? '')
  useEffect(() => {
    setAnotacoes(p.anotacoes ?? '')
    setResponsavel(p.responsavel ?? '')
  }, [p.id, p.anotacoes, p.responsavel])

  const fones = telefones(p.telefone)
  const msg = MSG_BASE(p.empresa, p.contato)

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <h2 className="text-[15px] font-bold text-ink leading-tight">{p.empresa}</h2>
          <p className="text-[12px] text-ink-muted">
            {p.cidade ? `${p.cidade}/${p.uf_cidade}` : 'cidade não publicada'}
            {' · atende '}<b>{p.uf === 'NAC' ? 'nacional' : p.uf}</b> · {p.regiao}
          </p>
        </div>
        <button
          onClick={onFechar}
          className="shrink-0 h-7 w-7 rounded-lg border border-border text-ink-muted hover:bg-surface-2"
          title="Voltar para a lista"
        >
          ✕
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <span
          className="px-2 py-0.5 rounded text-[11px] font-semibold text-white"
          style={{ backgroundColor: COR_PRIORIDADE[p.prioridade ?? ''] ?? CINZA }}
        >
          Prioridade {p.prioridade}
        </span>
        <span
          className="px-2 py-0.5 rounded text-[11px] font-semibold text-white"
          style={{ backgroundColor: COR_RISCO[p.risco ?? ''] ?? CINZA }}
        >
          Risco {p.risco}
        </span>
        {/* A régua NÃO é a mesma nas duas pesquisas (10 numa, 13 na outra) —
            escrever "/13" pra quem foi medido até 10 rebaixaria o candidato de graça. */}
        <span
          className="px-2 py-0.5 rounded text-[11px] font-semibold bg-surface-2 text-ink"
          title={`Régua da pesquisa "${baseDe(p).rotulo}": ${baseDe(p).descricao}`}
        >
          Nota {p.pontuacao}/{p.pontuacao_max ?? 13}
        </span>
        <span
          className="px-2 py-0.5 rounded text-[11px] bg-surface-2 text-ink-muted"
          title={baseDe(p).descricao}
        >
          {baseDe(p).rotulo}
          {p.prioridade_origem && p.prioridade_origem !== p.prioridade
            ? ` · ${p.prioridade_origem}` : ''}
        </span>
      </div>

      {p.nota_geo && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
          {p.nota_geo}
        </p>
      )}

      {/* o que faz */}
      <div className="rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-0.5">O que faz</div>
        <Linha rotulo="Segmento">{p.segmento}</Linha>
        <Linha rotulo="Espécies">{p.especies}</Linha>
        <Linha rotulo="Vínculo">{p.tipo}{p.rede ? ` · ${p.rede}` : ''}</Linha>
        <Linha rotulo="Cobertura">{p.cobertura}</Linha>
        <Linha rotulo="Atende">{p.regiao_atendida}</Linha>
        <Linha rotulo="Carteira">{p.indicio_carteira}</Linha>
      </div>

      {/* contato */}
      <div className="rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-0.5">Contato</div>
        <Linha rotulo="Falar com">
          {p.contato || p.cargo
            ? `${p.contato ?? ''}${p.contato && p.cargo ? ' · ' : ''}${p.cargo ?? ''}`
            : null}
        </Linha>
        <Linha rotulo="Telefone">
          {fones.length
            ? (
              <span className="flex flex-col gap-0.5">
                {fones.map(f => (
                  <span key={f.digitos} className="flex items-center gap-2">
                    <a href={`tel:+55${f.digitos}`} className="text-accent hover:underline">{f.exibir}</a>
                    {ehCelular(f.digitos) && (
                      <a
                        href={waLink(f.digitos)} target="_blank" rel="noopener"
                        className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30"
                      >
                        WhatsApp
                      </a>
                    )}
                  </span>
                ))}
              </span>
            )
            : <span className="text-ink-faint">sem telefone publicado</span>}
        </Linha>
        <Linha rotulo="E-mail">
          {p.email
            ? <a href={`mailto:${p.email}`} className="text-accent hover:underline break-all">{p.email}</a>
            : <span className="text-ink-faint">sem e-mail publicado</span>}
        </Linha>
        <Linha rotulo="Site">
          {p.site ? <a href={siteHref(p.site)} target="_blank" rel="noopener" className="text-accent hover:underline break-all">{p.site}</a> : null}
        </Linha>
        <Linha rotulo="Perfil">
          {p.social ? <span className="break-all">{p.social}</span> : null}
        </Linha>
      </div>

      <button
        onClick={() => {
          navigator.clipboard?.writeText(msg).then(() => setCopiado(true)).catch(() => setCopiado(false))
        }}
        className="w-full h-9 rounded-lg border border-border bg-surface-2 text-[12px] font-semibold text-ink hover:bg-surface"
        title={msg}
      >
        {copiado ? '✓ Mensagem copiada' : '📋 Copiar mensagem de abordagem'}
      </button>

      {/* trabalho da equipe — os 3 únicos campos graváveis */}
      <div className="rounded-lg border border-accent/40 bg-accent/5 px-2.5 py-2 space-y-2">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint">Abordagem</div>
        <div className="flex gap-2">
          <select
            value={p.status}
            onChange={e => onPatch('status', e.target.value)}
            disabled={salvando}
            className="h-8 flex-1 rounded-lg border border-border bg-surface px-2 text-[12px] text-ink"
          >
            {STATUS_PROSPECT.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            value={responsavel}
            onChange={e => setResponsavel(e.target.value)}
            onBlur={() => { if (responsavel !== (p.responsavel ?? '')) onPatch('responsavel', responsavel) }}
            placeholder="Responsável"
            className="h-8 w-28 rounded-lg border border-border bg-surface px-2 text-[12px] text-ink placeholder:text-ink-faint"
          />
        </div>
        <textarea
          value={anotacoes}
          onChange={e => setAnotacoes(e.target.value)}
          onBlur={() => { if (anotacoes !== (p.anotacoes ?? '')) onPatch('anotacoes', anotacoes) }}
          rows={3}
          placeholder="Anotações da conversa (salva ao sair do campo)"
          className="w-full rounded-lg border border-border bg-surface px-2 py-1.5 text-[12px] text-ink placeholder:text-ink-faint resize-y"
        />
        {p.updated_by && (
          <p className="text-[10px] text-ink-faint">
            última alteração por {p.updated_by}
            {p.updated_at ? ` em ${new Date(p.updated_at).toLocaleDateString('pt-BR')}` : ''}
          </p>
        )}
      </div>

      {/* pesquisa (congelada) */}
      <div className="rounded-lg border border-border bg-surface-2/40 px-2.5 py-1.5">
        <div className="text-[10px] uppercase tracking-wide text-ink-faint mb-0.5">Pesquisa</div>
        <Linha rotulo="Próximo passo">{p.proxima_acao}</Linha>
        <Linha rotulo="Observação">{p.observacoes}</Linha>
        <Linha rotulo="Verificação">
          {p.nivel_verificacao
            ? (
              <span className={p.nivel_verificacao.startsWith('Confirmado') ? 'text-ink' : 'text-amber-400'}>
                {p.nivel_verificacao}
              </span>
            )
            : null}
        </Linha>
        <Linha rotulo="Nota">
          fit {p.fit}/4 · carteira {p.carteira}/{p.fonte_base === 'base-148' ? 3 : 2} ·{' '}
          contato {p.contato_pts}/2 · presença {p.presenca}/2
          {p.estrutura != null && <> · estrutura {p.estrutura}/2</>}
          {' '}= bruta {p.pontuacao_bruta} → ajustada <b>{p.pontuacao}</b>
        </Linha>
        <Linha rotulo="Fonte">
          {p.fonte
            ? <a href={p.fonte} target="_blank" rel="noopener" className="text-accent hover:underline break-all">{p.fonte}</a>
            : null}
        </Linha>
        <Linha rotulo="Verificado">
          {p.verificado_em ? new Date(p.verificado_em).toLocaleDateString('pt-BR') : null}
        </Linha>
      </div>

      <p className="text-[10px] leading-relaxed text-ink-faint">
        Contato de fonte pública — confirme antes de abordar. Estar numa rede oficial não prova
        disponibilidade para representar outro fabricante: pergunte sobre exclusividade primeiro,
        e cheque CORE, CNPJ e carteira ativa antes de firmar contrato.
      </p>
    </div>
  )
}
