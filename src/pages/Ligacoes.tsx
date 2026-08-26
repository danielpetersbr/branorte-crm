import { useState, useMemo } from 'react'
import {
  PhoneCall, PhoneIncoming, PhoneOutgoing, PhoneMissed, Clock, Users, UserCheck, ChevronDown, Video,
  ArrowUp, ArrowDown, Minus, Sparkles, X, Filter, Headphones,
} from 'lucide-react'
import {
  useLigacoesResumo, useLigacoesSerie, useLigacoesPorHora, useLigacoesDe,
  useGravacoesDe, urlDoAudio,
  janelaDoPeriodo, janelaAnterior,
  type Periodo, type LigacaoResumo, type Janela, type Ligacao, type Gravacao,
} from '@/hooks/useLigacoes'
import {
  EvolucaoLigacoes, LigacoesNoMes, ResultadoLigacoes, PorVendedor, TaxaPorVendedor,
  PorHorario, fmtDur,
} from '@/components/ligacoes/GraficosLigacoes'
import { useAuth } from '@/hooks/useAuth'

// ============================================================================
// CENTRAL DE PERFORMANCE DE LIGAÇÕES
//
// Existe porque até 17/08/2026 a única régua era uma coluna que contava
// `call_log` de conversa COM ETIQUETA DO FUNIL: numa segunda de manhã o time
// inteiro somava UMA ligação. A fonte é o histórico do próprio WhatsApp —
// retroativa, com desfecho e duração, cobrindo a carteira toda.
//
// REGRAS DE NEGÓCIO PRESERVADAS (não mexer pra deixar gráfico bonito):
//  • "Atendida" = Completed OU AcceptedElsewhere. AcceptedElsewhere é atendida
//    NO CELULAR — contar só Completed puniria quem trabalha com o telefone na mão.
//  • Ligação FEITA: "não atendida" = Missed / Rejected; Canceled é o vendedor
//    que desligou antes de atenderem, e aparece separado ("desistiu antes").
//  • Ligação RECEBIDA: Canceled conta como PERDIDA junto com Missed/Rejected —
//    o cliente ligou e ficou sem falar com ninguém, tendo ele desligado antes
//    ou não. Contar só Missed escondia 44 das 50 perdidas do JARDEL (19/08/2026).
//  • Taxa de atendimento = atendidas_fez / fez. Nunca sobre (fez+recebeu):
//    misturaria o que ele controla com o que só acontece com ele.
//  • Tempo ao telefone é PISO: o WhatsApp só registra duração de chamada
//    atendida no próprio WhatsApp Web.
//
// MODO PESSOAL (papel `vendor`, desde 25/08/2026)
// A mesma tela serve as duas pontas. Pro vendedor ela vira a régua DELE:
//  • os dois blocos de ranking (PorVendedor, TaxaPorVendedor) somem — com a RLS
//    ligada eles seriam um gráfico de barras com UMA barra, que não compara nada;
//  • o seletor de vendedor some — a lista teria só o próprio nome;
//  • o resumo perde as frases de comparação ("fulano foi quem mais ligou") e
//    passa a falar na segunda pessoa;
//  • a tabela abre já expandida, porque a lista das ligações dele é o que ele
//    veio ver — pra ele não é "detalhe por vendedor", é a tela inteira.
// ⚠️ Nada disso é segurança: quem recorta o dado é a RLS de wa_ligacoes, no
// servidor. Isto aqui é só não mostrar moldura vazia.
// ============================================================================

const PERIODOS: Array<{ id: Periodo; label: string }> = [
  { id: 'hoje', label: 'Hoje' },
  { id: '7d', label: '7 dias' },
  { id: 'mes', label: 'Este mês' },
  { id: 'tudo', label: 'Tudo' },
]
const ROTULO_ANTERIOR: Record<string, string> = {
  hoje: 'vs ontem', '7d': 'vs 7 dias antes', mes: 'vs mês anterior', custom: 'vs período anterior',
}

// "agora mesmo" / "há 2 min" / hora cheia. Relativo diz mais que carimbo de hora
// pra responder "esse número é de quando?".
function fmtAtualizado(ms: number): string {
  if (!ms) return '—'
  const seg = Math.round((Date.now() - ms) / 1000)
  if (seg < 45) return 'agora mesmo'
  const min = Math.round(seg / 60)
  if (min < 60) return `há ${min} min`
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}

function fmtQuando(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
}
function fmtHora(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
}
function fmtFone(f: string | null): string {
  const n = (f || '').replace(/\D/g, '')
  if (n.length < 12) return f || ''
  const ddd = n.slice(2, 4), resto = n.slice(4)
  return `(${ddd}) ${resto.slice(0, resto.length - 4)}-${resto.slice(-4)}`
}
// O `peer` cru é um JID @lid do WhatsApp Business, ilegível — o nome e o telefone
// vêm do join com wa_chat_labels. Sem o contato na carteira, assume o silêncio.
function quemE(l: { cliente_nome: string | null; cliente_fone: string | null; peer: string | null }): string {
  if (l.cliente_nome?.trim()) return l.cliente_nome.trim()
  if (l.cliente_fone) return fmtFone(l.cliente_fone)
  const n = (l.peer || '').split('@')[0]
  if (/^\d{12,13}$/.test(n)) return fmtFone(n)
  return 'contato não identificado'
}

// ⚠️ O DESFECHO NÃO TEM DONO FIXO — depende de quem discou. Um mapa cego ao sentido
// acusava o vendedor de desistir de uma chamada que ele nem fez.
// ⚠️ O rótulo diz de quem é a FALHA, não quem apertou o botão primeiro. Em chamada
// recebida, tanto faz se o cliente desligou antes (Canceled) ou se chamou até o fim
// (Missed): ele ligou e não falou com ninguém — os dois viram "Vendedor não atendeu".
// A diferença mecânica sobrevive no `titulo` (tooltip), que é onde ela é útil.
const VERDE  = 'text-success bg-success/10 border-success/30'
const VERM   = 'text-danger bg-danger/10 border-danger/30'
const AMBAR  = 'text-warning bg-warning/10 border-warning/30'

type Rotulo = { label: string; cls: string; titulo?: string }
const DESFECHO: Record<string, { fez: Rotulo; recebeu: Rotulo }> = {
  Completed: {
    fez:     { label: 'Atendida', cls: VERDE },
    recebeu: { label: 'Atendida', cls: VERDE },
  },
  AcceptedElsewhere: {
    fez:     { label: 'Atendida no celular', cls: VERDE },
    recebeu: { label: 'Atendida no celular', cls: VERDE },
  },
  Missed: {
    fez:     { label: 'Cliente não atendeu',  cls: VERM },
    recebeu: { label: 'Vendedor não atendeu', cls: VERM, titulo: 'O cliente ligou e o vendedor não atendeu — chamou até o fim.' },
  },
  miss: {
    fez:     { label: 'Cliente não atendeu',  cls: VERM },
    recebeu: { label: 'Vendedor não atendeu', cls: VERM, titulo: 'O cliente ligou e o vendedor não atendeu — chamou até o fim.' },
  },
  Rejected: {
    fez:     { label: 'Cliente recusou',  cls: VERM },
    recebeu: { label: 'Vendedor recusou', cls: VERM, titulo: 'O cliente ligou e o vendedor recusou a chamada.' },
  },
  // ⚠️ Canceled RECEBIDA dizia "Cliente desistiu antes", em âmbar. Descrevia o mecanismo
  // (quem desligou primeiro) e o gestor lia como culpa do cliente — quando o fato é que
  // o telefone tocou e ninguém atendeu. Medido em agosto/2026: era assim que 44 das 50
  // chamadas perdidas do JARDEL e 12 das 13 do EDER ficavam fora do "Perdeu do cliente".
  // O rótulo agora nomeia a falha; o detalhe de quem desligou fica no title.
  Canceled: {
    fez:     { label: 'Vendedor desistiu antes', cls: AMBAR, titulo: 'O vendedor discou e desligou antes de o cliente atender.' },
    recebeu: { label: 'Vendedor não atendeu',    cls: VERM,  titulo: 'O cliente ligou e desligou antes de ser atendido. Vale retornar.' },
  },
}
// ⚠️ Desfecho VAZIO não é o mesmo que desfecho desconhecido pra nós: o próprio
// WhatsApp mandou `callOutcome`/`finalCallOutcome` nulos. São 11 em 1.880 (0,6%),
// quase todas RECEBIDAS. Um traço mudo faz o gestor perguntar o que é — o rótulo
// tem que dizer sozinho que a informação não existe na origem.
const SEM_DESFECHO = {
  label: 'sem registro',
  cls: 'text-ink-faint border-border/70 border-dashed',
  titulo: 'O WhatsApp não registrou o desfecho desta chamada — não dá pra saber se foi atendida ou perdida. Acontece em menos de 1% dos casos, quase sempre em chamada recebida.',
}
// `saiu` nulo = não sabemos o sentido; aí o rótulo tem que ficar neutro em vez de
// escolher um dos dois lados no chute.
const desfecho = (e: string | null, saiu: boolean | null): Rotulo => {
  const par = DESFECHO[e ?? '']
  if (!par) {
    return e ? { label: e, cls: 'text-ink-faint border-border' } : SEM_DESFECHO
  }
  if (saiu === null) {
    return { ...par.fez, label: NEUTRO[e as keyof typeof NEUTRO] ?? par.fez.label,
             titulo: 'O WhatsApp não registrou quem iniciou esta chamada.' }
  }
  return saiu ? par.fez : par.recebeu
}
const NEUTRO = {
  Missed: 'Não atendida', miss: 'Não atendida',
  Rejected: 'Recusada', Canceled: 'Desistiu antes',
} as const

const MIN_LIGACOES_TAXA = 5

// Soma o resumo do time. Uma passada só — os KPIs, o donut e o resumo escrito
// saem todos daqui, sem refazer conta em cada bloco.
function somar(linhas: LigacaoResumo[]) {
  return linhas.reduce((a, r) => ({
    fez: a.fez + r.fez,
    recebeu: a.recebeu + r.recebeu,
    atendidas_fez: a.atendidas_fez + r.atendidas_fez,
    atendidas: a.atendidas + r.atendidas,
    perdidas: a.perdidas + r.perdidas,
    perdidas_recebidas: a.perdidas_recebidas + r.perdidas_recebidas,
    retornadas: a.retornadas + r.retornadas,
    tempo_seg: a.tempo_seg + r.tempo_seg,
    // ⚠️ Somar contagem DISTINTA de cada vendedor não dá distinto global: o produtor que
    // falou com dois vendedores conta duas vezes. É o total de conversas do TIME, não de
    // pessoas na base — mesma régua que `clientes_fez` já usava.
    clientes_fez: a.clientes_fez + r.clientes_fez,
    clientes_falados: a.clientes_falados + r.clientes_falados,
    video_fez: a.video_fez + r.video_fez,
  }), { fez: 0, recebeu: 0, atendidas_fez: 0, atendidas: 0, perdidas: 0, perdidas_recebidas: 0, retornadas: 0, tempo_seg: 0, clientes_fez: 0, clientes_falados: 0, video_fez: 0 })
}

export function Ligacoes() {
  const { profile } = useAuth()
  // Papel `vendor` = a tela é a régua dele, não o painel do time. Ver o bloco
  // MODO PESSOAL lá em cima.
  const pessoal = profile?.role === 'vendor'

  const [periodo, setPeriodo] = useState<Periodo>('7d')
  const [custom, setCustom] = useState<Janela>({ from: null, to: null })
  const [vendedor, setVendedor] = useState<string | null>(null)
  const [aberto, setAberto] = useState<string | null>(null)

  const janela = useMemo(() => janelaDoPeriodo(periodo, custom), [periodo, custom])
  const anterior = useMemo(() => janelaAnterior(periodo, custom), [periodo, custom])

  const { data: linhas = [], isLoading, isError, dataUpdatedAt, isFetching } = useLigacoesResumo(janela, vendedor)
  const { data: linhasAnt = [] } = useLigacoesResumo(anterior ?? janela, vendedor, !!anterior)
  const { data: serie = [] } = useLigacoesSerie(janela, vendedor)
  const { data: horas = [] } = useLigacoesPorHora(janela, vendedor)

  // A lista de vendedores do filtro tem que vir de FORA do filtro, senão escolher
  // um vendedor esvazia o próprio seletor e não dá pra voltar.
  // ⚠️ No modo pessoal ela nem roda (`ativo=false`): o seletor não existe, e esta é a
  // consulta mais cara da tela — janela ABERTA, varre a tabela inteira. Deixar ligada
  // seria varrer tudo pra montar uma lista de um nome só que ninguém vê.
  const { data: todos = [] } = useLigacoesResumo({ from: null, to: null }, null, !pessoal, false)
  const nomes = useMemo(() => todos.map(t => t.vendedor).sort(), [todos])

  const tot = useMemo(() => somar(linhas), [linhas])
  const totAnt = useMemo(() => (anterior ? somar(linhasAnt) : null), [linhasAnt, anterior])

  // ⚠️ A taxa só aparece com volume. A tela já dizia isso na tabela e no gráfico
  // ("mínimo de 5"), mas o KPI do topo mostrava "0,0% de atendimento" em cima de UMA
  // ligação — o mesmo acerto isolado que o mínimo existe pra evitar, com o sinal trocado.
  const taxa = tot.fez >= MIN_LIGACOES_TAXA ? (tot.atendidas_fez / tot.fez) * 100 : null
  const taxaAnt = totAnt && totAnt.fez >= MIN_LIGACOES_TAXA ? (totAnt.atendidas_fez / totAnt.fez) * 100 : null
  const outras = Math.max(0, tot.fez - tot.atendidas_fez - tot.perdidas)
  // ⚠️ "Atendidas" no KPI e no donut é SÓ do que ele ligou (atendidas_fez); o resumo do
  // banco também tem `atendidas`, das duas direções, e é ela que sustenta o tempo ao
  // telefone. Sem mostrar esta diferença a tela dizia "0 atendidas · 14min31 ao telefone"
  // e parecia quebrada — era uma recebida atendida, que não tinha onde aparecer.
  const atendidasRecebeu = Math.max(0, tot.atendidas - tot.atendidas_fez)
  // ⚠️ "Tempo ao telefone" soma OS DOIS SENTIDOS — é o tempo que ele passou falando
  // com cliente, tenha ele ligado ou atendido. Por isso a média divide por TODAS as
  // atendidas, não só pelas que ele fez: antes o numerador contava as duas direções e o
  // denominador uma só, e a "média por atendida" saía inflada.
  const durMedia = tot.atendidas > 0 && tot.tempo_seg > 0 ? Math.round(tot.tempo_seg / tot.atendidas) : 0

  // A série do período pode estar cortada no começo: a 1ª leitura de cada
  // vendedor traz as últimas 500 ligações dele. Avisa em vez de fingir tendência.
  const truncado = serie.length > 20

  const filtrando = vendedor !== null || periodo === 'custom'

  return (
    <div className="p-3 lg:p-6 max-w-[1280px] mx-auto">
      {/* ── Cabeçalho + filtros ─────────────────────────────────────────── */}
      <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="min-w-0">
          <h1 className="text-xl lg:text-[28px] font-semibold text-ink tracking-tight flex items-center gap-2">
            <PhoneCall className="h-5 w-5 lg:h-6 lg:w-6 text-accent" /> {pessoal ? 'Minhas ligações' : 'Ligações'}
          </h1>
          <p className="text-[12px] lg:text-[12.5px] text-ink-faint mt-0.5 max-w-[560px]">
            {pessoal
              ? 'Suas ligações no WhatsApp: quantas você fez, quantas atenderam, em que horário o cliente atende mais e quais chamadas ficaram sem retorno.'
              : 'Acompanhe a atividade de ligações da equipe comercial e a evolução de cada vendedor.'}
          </p>
          {/* Sem este selo não dá pra saber se o número é de agora ou de quando a aba
              foi aberta — e a pergunta "isso atualiza sozinho?" volta toda vez. */}
          <p className="text-[11px] text-ink-faint mt-1 inline-flex items-center gap-1.5">
            <span className={`h-1.5 w-1.5 rounded-full ${isFetching ? 'bg-accent animate-pulse' : 'bg-success'}`} />
            {isFetching ? 'atualizando…' : <>atualiza sozinho · <b className="font-medium text-ink-muted">{fmtAtualizado(dataUpdatedAt)}</b></>}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap w-full sm:w-auto">
          <div className="grid grid-cols-4 flex-1 sm:flex-none sm:inline-flex rounded-lg border border-border overflow-hidden">
            {PERIODOS.map(p => (
              <button key={p.id} onClick={() => setPeriodo(p.id)}
                className={`px-3 py-2 sm:py-1.5 text-[12px] font-medium transition-colors ${
                  periodo === p.id ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {/* No modo pessoal a lista teria só o próprio nome — seletor de um item é
              moldura vazia. Some junto com a consulta que o alimentava. */}
          {!pessoal && (
            <select
              value={vendedor ?? ''}
              onChange={e => { setVendedor(e.target.value || null); setAberto(null) }}
              className="h-9 px-2.5 rounded-lg border border-border bg-surface text-[12.5px] text-ink outline-none focus:border-accent"
              aria-label="Filtrar por vendedor"
            >
              <option value="">Todos os vendedores</option>
              {nomes.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          {filtrando && (
            <button
              onClick={() => { setVendedor(null); setPeriodo('7d'); setCustom({ from: null, to: null }); setAberto(null) }}
              className="h-9 px-3 inline-flex items-center gap-1.5 rounded-lg border border-border text-[12px] text-ink-muted hover:text-ink hover:border-border-strong transition-colors"
            >
              <X className="h-3.5 w-3.5" /> Limpar filtros
            </button>
          )}
        </div>
      </header>

      {/* Período personalizado — fica recolhido pra não competir com os atalhos */}
      <details className="mb-4 group">
        <summary className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-faint cursor-pointer select-none hover:text-ink-muted">
          <Filter className="h-3.5 w-3.5" /> Período personalizado
        </summary>
        <div className="mt-2 flex items-end gap-2 flex-wrap">
          <label className="text-[11px] text-ink-faint">
            De
            <input type="date" className="block mt-1 h-9 px-2 rounded-lg border border-border bg-surface text-[12.5px] text-ink outline-none focus:border-accent"
              onChange={e => { if (e.target.value) { setCustom(c => ({ ...c, from: new Date(`${e.target.value}T00:00:00-03:00`).toISOString() })); setPeriodo('custom') } }} />
          </label>
          <label className="text-[11px] text-ink-faint">
            Até
            <input type="date" className="block mt-1 h-9 px-2 rounded-lg border border-border bg-surface text-[12.5px] text-ink outline-none focus:border-accent"
              onChange={e => { if (e.target.value) { const d = new Date(`${e.target.value}T00:00:00-03:00`); d.setDate(d.getDate() + 1); setCustom(c => ({ ...c, to: d.toISOString() })); setPeriodo('custom') } }} />
          </label>
          <p className="text-[10.5px] text-ink-faint pb-2">A data final entra por inteiro.</p>
        </div>
      </details>

      {/* ── Linha 1: KPIs ───────────────────────────────────────────────── */}
      {/* ⚠️ 4 POR FILEIRA, não 8 — MEDIDO em 19/08/2026 na tela do Daniel (1920px):
          com `xl:grid-cols-7` o cartão tinha 168px e "Atendidas (que ele ligou)" JÁ
          cortava (127px de texto em 120 de espaço). Em 8 colunas sobrariam ~78px e
          cortaria quase todos — e rótulo cortado ("Atendidas" sem o "que ele ligou")
          foi exatamente o que fez a tela mentir. Em 4 colunas o cartão vai a 302px,
          nada corta, e custa uma fileira a mais de altura. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 lg:gap-3 mb-4">
        <Kpi icone={PhoneOutgoing} cor="text-accent" rotulo="Ligações realizadas" valor={tot.fez}
             delta={pctDelta(tot.fez, totAnt?.fez)} rotuloDelta={ROTULO_ANTERIOR[periodo]} />
        <Kpi icone={Users} cor="text-accent" rotulo="Clientes chamados" valor={tot.clientes_fez}
             nota={tot.clientes_fez > 0 ? `${(tot.fez / tot.clientes_fez).toFixed(1).replace('.', ',')} ligações por cliente` : undefined} />
        {/* ⚠️ "Chamados" e "conversados" são perguntas diferentes, e só a segunda é
            resultado: discar 83 números e falar com 30 pessoas é um dia; discar 83 e
            falar com 70 é outro. Conta os DOIS sentidos — o cliente que ligou e foi
            atendido conversou igual. */}
        <Kpi icone={UserCheck} cor="text-success" rotulo="Clientes conversados" valor={tot.clientes_falados}
             nota={[
               tot.clientes_fez > 0 && tot.clientes_falados > 0
                 ? `${Math.round((tot.clientes_falados / tot.clientes_fez) * 100)}% dos que chamou` : undefined,
               tot.atendidas > 0 ? `${tot.atendidas} ligações atendidas no total` : undefined,
             ].filter(Boolean).join(' · ') || undefined} />
        <Kpi icone={PhoneCall} cor="text-success" rotulo={pessoal ? 'Atendidas (que você ligou)' : 'Atendidas (que ele ligou)'} valor={tot.atendidas_fez}
             nota={[
               taxa !== null ? `${taxa.toFixed(1).replace('.', ',')}% de atendimento`
                             : tot.fez > 0 ? `de ${tot.fez} que ligou` : undefined,
               atendidasRecebeu > 0 ? `+${atendidasRecebeu} que ele recebeu` : undefined,
             ].filter(Boolean).join(' · ') || undefined}
             delta={taxa !== null && taxaAnt !== null ? { valor: taxa - taxaAnt, unidade: 'pp' } : null}
             rotuloDelta={ROTULO_ANTERIOR[periodo]} />
        {/* ⚠️ DUAS COISAS DIFERENTES, e a tela tratava como uma só:
            • o vendedor ligou e o CLIENTE não atendeu → problema de alcance;
            • o CLIENTE ligou e o VENDEDOR não atendeu → oportunidade no chão.
            A segunda é a que dói, e estava invisível. */}
        <Kpi icone={PhoneMissed} cor="text-danger" rotulo="Cliente não atendeu" valor={tot.perdidas} inverso
             nota={tot.fez > 0 ? `${((tot.perdidas / tot.fez) * 100).toFixed(0)}% das que ele ligou` : undefined}
             delta={pctDelta(tot.perdidas, totAnt?.perdidas)} rotuloDelta={ROTULO_ANTERIOR[periodo]} />
        <Kpi icone={PhoneIncoming} cor="text-danger" rotulo="Perdeu do cliente" valor={tot.perdidas_recebidas} inverso
             nota={[
               tot.recebeu > 0 ? `${((tot.perdidas_recebidas / tot.recebeu) * 100).toFixed(0)}% das que recebeu` : undefined,
               // sem isto o número vira cobrança cega: retornar a chamada é a saída, e
               // quem retornou tem que aparecer separado de quem deixou o cliente no chão.
               tot.perdidas_recebidas > 0 ? `${tot.retornadas} devolvida${tot.retornadas === 1 ? '' : 's'}` : undefined,
             ].filter(Boolean).join(' · ') || undefined}
             delta={pctDelta(tot.perdidas_recebidas, totAnt?.perdidas_recebidas)} rotuloDelta={ROTULO_ANTERIOR[periodo]} />
        <Kpi icone={Video} cor="text-info" rotulo="Chamadas de vídeo" valor={tot.video_fez}
             delta={pctDelta(tot.video_fez, totAnt?.video_fez)} rotuloDelta={ROTULO_ANTERIOR[periodo]} />
        <Kpi icone={Clock} cor="text-success" rotulo="Tempo ao telefone" valor={fmtDur(tot.tempo_seg)}
             nota={durMedia > 0 ? `Média ${fmtDur(durMedia)} · feitas e recebidas` : undefined}
             delta={pctDelta(tot.tempo_seg, totAnt?.tempo_seg)} rotuloDelta={ROTULO_ANTERIOR[periodo]} />
      </div>

      <ResumoInteligente linhas={linhas} tot={tot} totAnt={totAnt} horas={horas} serie={serie}
                         rotuloAnterior={ROTULO_ANTERIOR[periodo]} pessoal={pessoal} />

      {isError ? (
        <p className="text-[13px] text-danger py-10 text-center">Não consegui carregar as ligações.</p>
      ) : isLoading ? (
        <Esqueleto />
      ) : (
        <div className="space-y-3 lg:space-y-4">
          <EvolucaoLigacoes serie={serie} truncado={truncado} />

          {/* ⚠️ Os dois blocos de ranking (PorVendedor, TaxaPorVendedor) só fazem sentido
              com o time na tela. No modo pessoal a RLS entrega UMA linha, e "ranking de
              um" não é ranking — é um gráfico de barras com uma barra. Somem, e o
              "melhor horário" sobe pro lado do donut pra fechar a fileira. */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
            <ResultadoLigacoes atendidas={tot.atendidas_fez} perdidas={tot.perdidas} outras={outras}
                               video={tot.video_fez} atendidasRecebeu={atendidasRecebeu} pessoal={pessoal} />
            {pessoal ? <PorHorario horas={horas} /> : <PorVendedor linhas={linhas} />}
          </div>

          <LigacoesNoMes serie={serie} />

          {!pessoal && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 lg:gap-4">
              <TaxaPorVendedor linhas={linhas} />
              <PorHorario horas={horas} />
            </div>
          )}

          <TabelaVendedores linhas={linhas} janela={janela} aberto={aberto} setAberto={setAberto} pessoal={pessoal} />
        </div>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
        <b className="text-ink-muted">Atendidas (que ele ligou)</b> conta só o que o vendedor discou,
        e inclui quem atendeu no celular (o WhatsApp marca <i>AcceptedElsewhere</i>) — contar só as
        atendidas no computador puniria justamente quem trabalha com o telefone na mão. As que ele
        recebeu e atendeu aparecem ao lado, com sinal de mais, porque são elas que explicam o tempo
        ao telefone sem entrar na taxa dele. <b className="text-ink-muted">Taxa de atendimento</b> é
        sobre as ligações que o vendedor FEZ, e só aparece com {MIN_LIGACOES_TAXA}+ ligações: abaixo
        disso um acerto isolado vira 100% e um erro isolado vira 0%. Nas ligações recentes o rótulo
        muda conforme o sentido — <b className="text-ink-muted">vendedor desistiu antes</b> é ele que
        discou e desligou antes de atenderem; <b className="text-ink-muted">vendedor não atendeu</b> é
        chamada de cliente que ficou sem resposta, tendo o cliente desligado antes ou tocado até o
        fim: as duas contam igual, porque o cliente ficou sem falar com ninguém dos dois jeitos.{' '}
        <b className="text-ink-muted">Clientes chamados</b> conta contatos
        DIFERENTES — quem liga cinco vezes pro mesmo produtor fez cinco ligações e alcançou um.{' '}
        <b className="text-ink-muted">Clientes conversados</b> é com quantos desses ele realmente
        FALOU: contato diferente com pelo menos uma chamada atendida, tendo sido ele a ligar ou o
        cliente — atender quem ligou é conversa igual. Discar 83 números e falar com 30 pessoas é um
        dia; discar 83 e falar com 70 é outro. Somando o time, o produtor que falou com dois
        vendedores conta duas vezes: é total de conversas, não de gente na base.{' '}
        <b className="text-ink-muted">Cliente não atendeu</b> e <b className="text-ink-muted">perdeu do
        cliente</b> são coisas diferentes: a primeira é ligação que o vendedor fez e ninguém atendeu
        do outro lado; a segunda é o cliente ligando e o vendedor não atendendo — essa é oportunidade
        perdida, e vem com o número de <b className="text-ink-muted">devolvidas</b> ao lado: ligar de
        volta em até 2h resolve, e quem resolveu não pode ser cobrado igual a quem sumiu. Chamada
        recebida fora do expediente entra na conta, então vale olhar o horário antes de cobrar. <b className="text-ink-muted">Tempo ao telefone</b> soma os dois sentidos e é piso:
        o WhatsApp só registra a duração das chamadas atendidas no próprio WhatsApp Web.
      </p>
    </div>
  )
}

// ── KPI ─────────────────────────────────────────────────────────────────────
type Delta = { valor: number; unidade: '%' | 'pp' } | null
function pctDelta(atual: number, anterior?: number): Delta {
  if (anterior === undefined || anterior === null) return null
  if (anterior === 0) return atual > 0 ? { valor: 100, unidade: '%' } : null
  return { valor: ((atual - anterior) / anterior) * 100, unidade: '%' }
}

function Kpi({ icone: Icone, cor, rotulo, valor, nota, delta, rotuloDelta, inverso }: {
  icone: typeof PhoneCall; cor: string; rotulo: string; valor: number | string
  nota?: string; delta?: Delta; rotuloDelta?: string
  // inverso: pra "não atendidas", subir é RUIM — a cor tem que acompanhar o sentido.
  inverso?: boolean
}) {
  const subiu = delta ? delta.valor > 0.5 : false
  const caiu = delta ? delta.valor < -0.5 : false
  const bom = inverso ? caiu : subiu
  const ruim = inverso ? subiu : caiu
  const Seta = subiu ? ArrowUp : caiu ? ArrowDown : Minus

  return (
    <div className="rounded-2xl border border-border bg-surface p-3.5 lg:p-4">
      <div className="flex items-center gap-1.5 text-[11px] text-ink-faint mb-1.5">
        <Icone className={`h-3.5 w-3.5 ${cor} shrink-0`} /> <span className="truncate">{rotulo}</span>
      </div>
      <p className="text-[24px] lg:text-[26px] font-semibold text-ink tabular-nums leading-none">{valor}</p>
      {nota && <p className="text-[10.5px] text-ink-muted mt-1.5">{nota}</p>}
      {delta && rotuloDelta && (
        <p className={`text-[10.5px] mt-1 inline-flex items-center gap-0.5 ${bom ? 'text-success' : ruim ? 'text-danger' : 'text-ink-faint'}`}>
          <Seta className="h-3 w-3" />
          {delta.unidade === 'pp'
            ? `${Math.abs(delta.valor).toFixed(1).replace('.', ',')} p.p.`
            : `${Math.abs(delta.valor).toFixed(0)}%`}
          <span className="text-ink-faint ml-0.5">{rotuloDelta}</span>
        </p>
      )}
    </div>
  )
}

// ── RESUMO INTELIGENTE ──────────────────────────────────────────────────────
// Só frases que saem de conta objetiva sobre o dado da tela. Nada de leitura
// que o número não sustenta.
function ResumoInteligente({ linhas, tot, totAnt, horas, serie, rotuloAnterior, pessoal }: {
  linhas: LigacaoResumo[]
  tot: ReturnType<typeof somar>
  totAnt: ReturnType<typeof somar> | null
  horas: Array<{ hora: number; feitas: number; atenderam: number }>
  serie: Array<{ dia: string; feitas: number }>
  rotuloAnterior?: string
  // Modo pessoal: as frases que ganham por comparação com colega não existem
  // (só há uma linha), e as que sobram falam na segunda pessoa.
  pessoal?: boolean
}) {
  const frases = useMemo(() => {
    const f: string[] = []
    if (tot.fez === 0) return f

    // ⚠️ "Fulano foi quem mais ligou" com UMA linha na tela vira "você foi quem mais
    // ligou entre você" — frase que se auto-elogia e não informa nada. No modo
    // pessoal as duas comparativas caem fora em vez de virarem texto sem sentido.
    if (!pessoal) {
      const maisLigou = [...linhas].sort((a, b) => b.fez - a.fez)[0]
      if (maisLigou?.fez > 0) f.push(`${maisLigou.vendedor} fez o maior número de ligações no período: ${maisLigou.fez}.`)

      const comTaxa = linhas.filter(r => r.fez >= MIN_LIGACOES_TAXA)
        .map(r => ({ v: r.vendedor, t: Math.round((r.atendidas_fez / r.fez) * 100) }))
        .sort((a, b) => b.t - a.t)
      if (comTaxa.length > 1) f.push(`${comTaxa[0].v} teve a maior taxa de atendimento: ${comTaxa[0].t}%.`)
    } else if (tot.fez >= MIN_LIGACOES_TAXA) {
      // A taxa dele sozinha, sem colega pra comparar. Vale como número absoluto —
      // é o que ele consegue mexer ligando em outro horário ou insistindo mais.
      f.push(`Sua taxa de atendimento no período foi de ${Math.round((tot.atendidas_fez / tot.fez) * 100)}%: ${tot.atendidas_fez} atendidas de ${tot.fez} que você ligou.`)
    }

    const hs = horas.filter(h => h.feitas >= 5).map(h => ({ h: h.hora, t: h.atenderam / h.feitas }))
    if (hs.length > 2) {
      const melhor = [...hs].sort((a, b) => b.t - a.t)[0]
      f.push(`O cliente atende mais entre ${melhor.h}h e ${melhor.h + 1}h: ${Math.round(melhor.t * 100)}% das ligações.`)
    }

    if (totAnt && totAnt.fez > 0) {
      const d = ((tot.fez - totAnt.fez) / totAnt.fez) * 100
      if (Math.abs(d) >= 5) {
        f.push(`${pessoal ? 'Você ligou' : 'A equipe ligou'} ${Math.abs(d).toFixed(0)}% ${d > 0 ? 'mais' : 'menos'} que ${(rotuloAnterior || 'no período anterior').replace('vs ', '')}.`)
      }
    }

    // Quem mais deixa o cliente na mão. É a frase mais acionável da tela: cliente
    // que ligou e não foi atendido é oportunidade que bateu na porta e foi embora.
    // ⚠️ A frase precisa carregar as DEVOLVIDAS junto. "Deixou 50 sem atender" sozinho
    // coloca no mesmo balde quem devolveu 9 e quem devolveu 0 — e a diferença entre os
    // dois é o negócio inteiro.
    const perdendo = linhas.filter(r => r.recebeu >= 10)
      .map(r => ({ v: r.vendedor, p: r.perdidas_recebidas, t: r.recebeu, dev: r.retornadas, pct: Math.round((r.perdidas_recebidas / r.recebeu) * 100) }))
      .sort((a, b) => (b.p - b.dev) - (a.p - a.dev))
    if (perdendo.length && perdendo[0].p > 0) {
      const q = perdendo[0]
      f.push(pessoal
        ? `Você deixou ${q.p} chamada${q.p > 1 ? 's' : ''} de cliente sem atender (${q.pct}% das que recebeu) e devolveu ${q.dev} — ${q.p - q.dev} ficaram sem retorno nenhum.`
        : `${q.v} deixou ${q.p} chamada${q.p > 1 ? 's' : ''} de cliente sem atender (${q.pct}% das que recebeu) e devolveu ${q.dev} — ${q.p - q.dev} ficaram sem retorno nenhum.`)
    }

    const melhorDia = [...serie].sort((a, b) => b.feitas - a.feitas)[0]
    if (melhorDia && serie.length > 2) {
      const [, m, dd] = melhorDia.dia.split('-')
      f.push(`O dia de maior volume foi ${dd}/${m}, com ${melhorDia.feitas} ligações.`)
    }
    return f
  }, [linhas, tot, totAnt, horas, serie, rotuloAnterior, pessoal])

  if (frases.length === 0) return null
  return (
    <section className="rounded-2xl border border-accent/25 bg-accent/[0.04] p-4 mb-4">
      <h2 className="text-[13px] font-semibold text-ink flex items-center gap-1.5 mb-2">
        <Sparkles className="h-4 w-4 text-accent" /> Resumo do período
      </h2>
      <ul className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-1.5">
        {frases.map(t => (
          <li key={t} className="text-[12.5px] text-ink-muted leading-relaxed flex gap-2">
            <span className="text-accent shrink-0">•</span>{t}
          </li>
        ))}
      </ul>
    </section>
  )
}

// ── UMA LIGAÇÃO NA LISTA ────────────────────────────────────────────────────
// Quando existe gravação, a linha ganha o botão de ouvir e o texto do que foi
// dito. Sem gravação ela fica EXATAMENTE como era — nada de espaço reservado
// nem ícone apagado: a gravação nasce desligada, então "sem áudio" é o normal,
// não uma falha a ser sinalizada.
function LinhaLigacao({ l, gravacao }: { l: Ligacao; gravacao?: Gravacao }) {
  const d = desfecho(l.estado, l.outgoing)
  const [aberto, setAberto] = useState(false)
  const [url, setUrl] = useState<string | null>(null)
  const [erro, setErro] = useState(false)

  const temTexto = !!(gravacao?.transcricao || '').trim()
  const temAudio = !!gravacao?.caminho_audio
  const temAlgo = temTexto || temAudio

  async function abrir() {
    const vaiAbrir = !aberto
    setAberto(vaiAbrir)
    // ⚠️ A URL assinada só é pedida no clique, e uma vez. Assinar as 300 da
    // lista de saída seriam 300 requisições pra mostrar um ícone — e a maioria
    // nunca é ouvida.
    if (vaiAbrir && temAudio && !url && !erro) {
      const u = await urlDoAudio(gravacao!.caminho_audio!)
      if (u) setUrl(u); else setErro(true)
    }
  }

  return (
    <div className="text-[12px]">
      <div className="flex items-center gap-x-2 gap-y-1 px-3 py-2 flex-wrap">
        {l.outgoing
          ? <PhoneOutgoing className="h-3.5 w-3.5 text-accent shrink-0" />
          : <PhoneIncoming className="h-3.5 w-3.5 text-info shrink-0" />}
        {l.is_video && <Video className="h-3.5 w-3.5 text-info shrink-0" />}
        <span className="text-ink font-medium">{quemE(l)}</span>
        {l.cliente_nome && l.cliente_fone && (
          <span className="hidden sm:inline text-ink-faint tabular-nums">{fmtFone(l.cliente_fone)}</span>
        )}
        <span title={d.titulo} className={`text-[10px] px-1.5 py-0.5 rounded-full border ${d.cls} ${d.titulo ? 'cursor-help' : ''}`}>{d.label}</span>
        {l.duracao_seg ? <span className="text-ink-muted tabular-nums">{fmtDur(l.duracao_seg)}</span> : null}
        {temAlgo && (
          <button
            onClick={abrir}
            className="inline-flex items-center gap-1 text-[10.5px] px-1.5 py-0.5 rounded-full border border-accent/30 text-accent hover:bg-accent/10 transition-colors"
            title={temTexto ? 'Ouvir e ler o que foi dito' : 'Ouvir a ligação'}
          >
            <Headphones className="h-3 w-3" />
            {temTexto ? 'gravada' : 'áudio'}
            <ChevronDown className={`h-3 w-3 transition-transform ${aberto ? 'rotate-180' : ''}`} />
          </button>
        )}
        <span className="flex-1" />
        <span className="text-ink-faint tabular-nums shrink-0 hidden sm:inline">{fmtQuando(l.offer_time)}</span>
        <span className="text-ink-faint tabular-nums shrink-0 sm:hidden">{fmtHora(l.offer_time)}</span>
      </div>

      {aberto && temAlgo && (
        <div className="px-3 pb-3 -mt-0.5 space-y-2">
          {temAudio && (
            erro
              ? <p className="text-[11px] text-ink-faint">Não consegui abrir o áudio desta ligação.</p>
              : url
                ? <audio controls preload="none" src={url} className="w-full h-8" />
                : <p className="text-[11px] text-ink-faint">Abrindo o áudio…</p>
          )}
          {temTexto && (
            <div className="rounded-lg border border-border/60 bg-surface-2/40 p-2.5">
              <p className="text-[10px] uppercase tracking-wide text-ink-faint mb-1">O que foi dito</p>
              {/* ⚠️ Não é ata: é transcrição automática, com os erros dela. O
                  rótulo abaixo existe pra ninguém tratar isso como prova. */}
              <p className="text-[12px] text-ink-muted leading-relaxed whitespace-pre-wrap">
                {gravacao!.transcricao}
              </p>
              <p className="text-[10px] text-ink-faint mt-1.5">
                Transcrição automática — pode conter erros. O áudio é a fonte.
              </p>
            </div>
          )}
          {temAudio && !temTexto && (
            <p className="text-[11px] text-ink-faint">Transcrição ainda não ficou pronta.</p>
          )}
        </div>
      )}
    </div>
  )
}

function Esqueleto() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-[340px] rounded-2xl border border-border bg-surface" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="h-[260px] rounded-2xl border border-border bg-surface" />
        <div className="h-[260px] rounded-2xl border border-border bg-surface" />
      </div>
    </div>
  )
}

// ── TABELA DOS VENDEDORES ───────────────────────────────────────────────────
function TabelaVendedores({ linhas, janela, aberto, setAberto, pessoal }: {
  linhas: LigacaoResumo[]; janela: Janela; aberto: string | null; setAberto: (v: string | null) => void
  pessoal?: boolean
}) {
  const maxFez = Math.max(1, ...linhas.map(r => r.fez))

  /*
   * No modo pessoal a lista das ligações É a tela — não é "detalhe", é o que ele
   * veio ver. Abre expandida em vez de exigir um clique num acordeão de uma linha
   * só, que parece bug ("cadê minhas ligações?").
   *
   * ⚠️ Derivado, não `useEffect` com `setAberto`: um efeito que escreve estado no
   * primeiro render reabriria a linha toda vez que ele fechasse. Aqui fechar
   * funciona — `aberto` vira '' (string vazia, ≠ null) e o `?? ` não repõe.
   */
  const abertoEfetivo = pessoal && aberto === null ? (linhas[0]?.vendedor ?? null) : aberto

  return (
    <section className="rounded-2xl border border-border bg-surface overflow-hidden">
      <div className="px-4 lg:px-5 pt-4 pb-3">
        <h2 className="text-[14px] font-semibold text-ink flex items-center gap-2">
          {/* ⚠️ No modo pessoal NÃO repetir "Minhas ligações" — é o mesmo texto do <h1>
              lá em cima, e a tela ficava com o título duplicado no meio dela. */}
          <Users className="h-4 w-4 text-accent" /> {pessoal ? 'Ligação por ligação' : 'Detalhe por vendedor'}
        </h2>
        <p className="text-[11px] text-ink-faint mt-0.5">
          {pessoal ? 'As mais recentes do período, com quem era e como terminou.' : 'Clique num vendedor pra ver as ligações dele.'}
        </p>
      </div>

      {/* ⚠️ A CONTA DE COLUNAS TEM QUE BATER COM AS CÉLULAS. Estava `repeat(7)` com NOVE
          células: a última (Tempo) caía numa segunda linha, e o número aparecia solto
          embaixo do nome do vendedor parecendo lixo de layout. Mexeu aqui, conte lá
          embaixo na LinhaVendedor — são os mesmos slots, nas duas grades. */}
      <div className="hidden lg:grid grid-cols-[1.3fr_repeat(9,minmax(0,1fr))] gap-2 px-5 py-2.5 border-y border-border bg-surface-2/40 text-[10.5px] font-medium text-ink-faint uppercase tracking-wide">
        <span>Vendedor</span>
        <span className="text-right">Feitas</span>
        <span className="text-right">Clientes</span>
        <span className="text-right">Atendidas<br/>que ele fez</span>
        <span className="text-right">Taxa</span>
        {/* sem esta coluna, quem só recebeu e atendeu tinha a linha INTEIRA de traços —
            era o caso do RAMON em 19/08, que atendeu o cliente no celular e aparecia
            como se não tivesse feito nada o dia todo. */}
        <span className="text-right">Recebidas</span>
        <span className="text-right">Cliente<br/>não atend.</span>
        <span className="text-right">Perdeu do<br/>cliente</span>
        <span className="text-right">Vídeo</span>
        <span className="text-right">Tempo</span>
      </div>

      {linhas.length === 0 ? (
        <p className="text-[12.5px] text-ink-muted py-10 text-center">Nenhuma ligação no período.</p>
      ) : linhas.map(r => (
        <LinhaVendedor key={r.vendedor} r={r} maxFez={maxFez} janela={janela}
          aberto={abertoEfetivo === r.vendedor} onToggle={() => setAberto(abertoEfetivo === r.vendedor ? '' : r.vendedor)} />
      ))}
    </section>
  )
}

function LinhaVendedor({ r, maxFez, janela, aberto, onToggle }: {
  r: LigacaoResumo; maxFez: number; janela: Janela; aberto: boolean; onToggle: () => void
}) {
  const [direcao, setDirecao] = useState<'tudo' | 'fez' | 'recebeu'>('tudo')
  const { data: bruta = [], isLoading } = useLigacoesDe(aberto ? r.vendedor : null, janela)
  const { data: gravacoes = {} } = useGravacoesDe(aberto ? r.vendedor : null, janela)
  const lista = useMemo(() => bruta.filter(l =>
    direcao === 'tudo' || (direcao === 'fez' ? l.outgoing === true : l.outgoing === false)), [bruta, direcao])
  const taxa = r.fez >= MIN_LIGACOES_TAXA ? Math.round((r.atendidas_fez / r.fez) * 100) : null
  const corTaxa = taxa === null ? 'text-ink-faint' : taxa >= 55 ? 'text-success' : taxa >= 40 ? 'text-ink' : 'text-danger'
  // ⚠️ A coluna/card "Atendidas" mostra `atendidas_fez` — só o que ELE discou, porque é
  // isso que sustenta a taxa. Mas a LISTA embaixo mostra os dois sentidos e o tempo ao
  // telefone soma os dois: sem este `+N` a tela dizia "Atendidas 2 · 16min15" com TRÊS
  // etiquetas verdes "Atendida" logo abaixo. Mesma correção que o KPI do topo já tinha
  // (ver comentário em `atendidasRecebeu`, lá em cima) e que aqui embaixo faltou.
  const atendRecebeu = Math.max(0, r.atendidas - r.atendidas_fez)

  return (
    <div className="border-b border-border/60 last:border-0">
      <button onClick={onToggle} className="w-full text-left px-3 lg:px-5 py-3 hover:bg-surface-2/40 transition-colors">
        {/* CELULAR: card. A grade de 2 colunas com rótulo miúdo não sobrevive a 8 métricas. */}
        <div className="lg:hidden">
          <div className="flex items-center gap-1.5 mb-2">
            <ChevronDown className={`h-3.5 w-3.5 text-ink-faint shrink-0 transition-transform ${aberto ? '' : '-rotate-90'}`} />
            <span className="text-[14px] font-semibold text-ink truncate flex-1">{r.vendedor}</span>
            {taxa !== null && <span className={`text-[11.5px] font-semibold tabular-nums ${corTaxa}`}>{taxa}% atenderam</span>}
          </div>
          <div className="grid grid-cols-3 gap-2 pl-5">
            <Mini rotulo="feitas" valor={r.fez} sub={`${r.clientes_fez} clientes`} forte />
            <Mini rotulo="atendidas (que ele fez)" valor={r.atendidas_fez} cls="text-success"
                  sub={atendRecebeu > 0 ? `+${atendRecebeu} que ele recebeu` : undefined} />
            <Mini rotulo="cliente não atend." valor={r.perdidas} cls={r.perdidas > 0 ? 'text-danger' : ''} />
            <Mini rotulo="perdeu do cliente" valor={r.perdidas_recebidas} cls={r.perdidas_recebidas > 0 ? 'text-danger' : ''}
                  sub={r.perdidas_recebidas > 0 ? `${r.retornadas} devolvida${r.retornadas === 1 ? '' : 's'}` : undefined} />
            <Mini rotulo="tempo" txt={fmtDur(r.tempo_seg)} />
            <Mini rotulo="média" txt={fmtDur(r.dur_media)} />
            <Mini rotulo="vídeo" valor={r.video_fez} cls={r.video_fez > 0 ? 'text-info' : ''} />
          </div>
        </div>

        {/* DESKTOP */}
        <div className="hidden lg:grid grid-cols-[1.3fr_repeat(9,minmax(0,1fr))] gap-2 items-center">
          <span className="flex items-center gap-1.5 min-w-0">
            <ChevronDown className={`h-3.5 w-3.5 text-ink-faint shrink-0 transition-transform ${aberto ? '' : '-rotate-90'}`} />
            <span className="text-[13px] font-semibold text-ink truncate">{r.vendedor}</span>
          </span>
          <Num v={r.fez} destaque barra={r.fez / maxFez} />
          <Num v={r.clientes_fez} />
          <Num v={r.atendidas_fez} cls="text-success"
               extra={atendRecebeu > 0 ? `${atendRecebeu} receb.` : undefined} />
          <span className="text-right">
            {taxa === null ? <span className="text-[12px] text-ink-faint">—</span> : (
              <>
                <span className={`text-[13px] font-semibold tabular-nums ${corTaxa}`}>{taxa}%</span>
                <span className="block h-1 rounded-full bg-surface-2 overflow-hidden mt-1">
                  <span className="block h-full rounded-full" style={{ width: `${taxa}%`, background: taxa >= 55 ? 'hsl(var(--success))' : taxa >= 40 ? 'hsl(var(--accent))' : 'hsl(var(--danger))' }} />
                </span>
              </>
            )}
          </span>
          {/* sem `extra`: quantas dessas ele atendeu já está na coluna Atendidas, e
              repetir o mesmo 24 em duas colunas vizinhas faz o gestor procurar erro. */}
          <Num v={r.recebeu} />
          <Num v={r.perdidas} cls={r.perdidas > 0 ? 'text-danger' : ''} />
          <Num v={r.perdidas_recebidas} cls={r.perdidas_recebidas > 0 ? 'text-danger' : ''}
               extra={r.perdidas_recebidas > 0 ? `${r.retornadas} devolv.` : undefined} />
          <Num v={r.video_fez} cls={r.video_fez > 0 ? 'text-info' : ''} />
          <Num txt={fmtDur(r.tempo_seg)} extra={r.dur_media > 0 ? `~${fmtDur(r.dur_media)}` : undefined} />
        </div>
      </button>

      {aberto && (
        <div className="px-3 lg:px-5 pb-4 bg-surface-2/20">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 py-3">
            <Resumo rotulo="Ligações feitas" valor={String(r.fez)} />
            <Resumo rotulo="Recebidas" valor={String(r.recebeu)} />
            <Resumo rotulo="Atendidas (que ele ligou)" valor={String(r.atendidas_fez)} cls="text-success"
                    sub={atendRecebeu > 0 ? `+${atendRecebeu} que ele recebeu` : undefined} />
            <Resumo rotulo="Clientes conversados" valor={String(r.clientes_falados)} cls="text-success"
                    sub={r.atendidas > 0 ? `em ${r.atendidas} ligação${r.atendidas === 1 ? '' : 'ões'} atendida${r.atendidas === 1 ? '' : 's'}` : undefined} />
            <Resumo rotulo="Cliente não atendeu" valor={String(r.perdidas)} cls={r.perdidas > 0 ? 'text-danger' : ''} />
            <Resumo rotulo="Perdeu do cliente" valor={String(r.perdidas_recebidas)} cls={r.perdidas_recebidas > 0 ? 'text-danger' : ''}
                    sub={r.perdidas_recebidas > 0 ? `${r.retornadas} devolvida${r.retornadas === 1 ? '' : 's'} em até 2h` : undefined} />
            <Resumo rotulo="Taxa" valor={taxa === null ? '—' : `${taxa}%`} cls={corTaxa} />
            <Resumo rotulo="Tempo ao telefone" valor={fmtDur(r.tempo_seg)} />
          </div>

          {/* ⚠️ A linha de cima conta só o que ele FEZ; a lista mostra os dois sentidos.
              Sem dizer isso, a linha marca 1 e a lista exibe 6 — parece conta errada.
              O filtro deixa reconciliar na hora. */}
          <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
            <h3 className="text-[11.5px] font-semibold text-ink-muted uppercase tracking-wide">
              Ligações recentes
              <span className="ml-1.5 normal-case font-normal text-ink-faint">
                {r.fez} feita{r.fez === 1 ? '' : 's'} · {r.recebeu} recebida{r.recebeu === 1 ? '' : 's'}
              </span>
            </h3>
            <div className="inline-flex rounded-lg border border-border overflow-hidden">
              {([['tudo', 'Todas'], ['fez', 'Feitas'], ['recebeu', 'Recebidas']] as const).map(([id, lb]) => (
                <button key={id} onClick={e => { e.stopPropagation(); setDirecao(id) }}
                  className={`px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    direcao === id ? 'bg-accent text-white' : 'bg-surface-2 text-ink-faint hover:text-ink-muted'}`}>
                  {lb}
                </button>
              ))}
            </div>
          </div>
          {isLoading ? (
            <p className="text-[11.5px] text-ink-faint py-2">Carregando…</p>
          ) : lista.length === 0 ? (
            <p className="text-[11.5px] text-ink-faint py-2">Nenhuma ligação no período.</p>
          ) : (
            <div className="rounded-xl border border-border/60 bg-surface divide-y divide-border/40 max-h-[420px] overflow-y-auto">
              {lista.map(l => (
                <LinhaLigacao key={l.call_id} l={l} gravacao={gravacoes[l.call_id]} />
              ))}
              {lista.length >= 300 && (
                <p className="px-3 py-2 text-[11px] text-ink-faint">Mostrando as 300 mais recentes do período.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Resumo({ rotulo, valor, cls = '', sub }: { rotulo: string; valor: string; cls?: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-surface px-3 py-2">
      <p className="text-[10px] text-ink-faint leading-none mb-1.5">{rotulo}</p>
      <p className={`text-[15px] font-semibold tabular-nums leading-none text-ink ${cls}`}>{valor}</p>
      {sub && <p className="text-[10px] text-ink-faint mt-1 leading-none">{sub}</p>}
    </div>
  )
}

function Mini({ rotulo, valor, txt, sub, cls = '', forte }: {
  rotulo: string; valor?: number; txt?: string; sub?: string; cls?: string; forte?: boolean
}) {
  return (
    <div>
      <p className="text-[10px] text-ink-faint leading-none mb-1">{rotulo}</p>
      <p className={`tabular-nums leading-none ${forte ? 'text-[16px] font-semibold text-ink' : 'text-[15px] text-ink-muted'} ${cls}`}>
        {txt ?? (valor === 0 ? '—' : valor)}
      </p>
      {sub && <p className="text-[10px] text-ink-faint mt-0.5">{sub}</p>}
    </div>
  )
}

function Num({ v, txt, cls = '', destaque, barra, extra }: {
  v?: number; txt?: string; cls?: string; destaque?: boolean; barra?: number; extra?: string
}) {
  return (
    <span className="text-right">
      <span className={`tabular-nums text-[13px] ${destaque ? 'font-semibold text-ink' : 'text-ink-muted'} ${cls}`}>
        {txt ?? (v === 0 ? '—' : v)}
      </span>
      {/* ⚠️ O ponto separador não é enfeite: MEDIDO em 19/08/2026, "50" seguido de
          "9 devolv." com 4px de respiro é lido como "509". O "·" resolve a ambiguidade
          sem gastar largura. */}
      {extra && <span className="text-[10px] text-ink-faint ml-1.5">· {extra}</span>}
      {barra !== undefined && (
        <span className="block h-1 rounded-full bg-surface-2 overflow-hidden mt-1">
          <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(4, barra * 100)}%` }} />
        </span>
      )}
    </span>
  )
}

export default Ligacoes
