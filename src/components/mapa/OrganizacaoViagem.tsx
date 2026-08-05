import { useMemo, useState } from 'react'
import {
  useQuadroViagens, useConfirmarParada, useStatusViagem, useCorrigirLocalDaParada,
  type ViagemQuadro, type ParadaConfirmacao,
} from '@/hooks/useViagens'
import type { Confirmacao } from '@/lib/viagem'
import { lerLocal, ehLinkCurto, urlCurta, distanciaKm } from '@/lib/local-link'

// ORGANIZAÇÃO DE VIAGEM — o quadro que fica ABAIXO do mapa de visitas.
//
// Existe porque montar a viagem é o passo FÁCIL. Entre salvar e sair dirigindo
// tem um vaivém que leva dias: o vendedor fala com cada cliente, volta com "pode
// nessa data?" e com a localização REAL da propriedade. Esse trabalho não morava
// em lugar nenhum — quem salvava a viagem perdia de vista o que faltava, e a
// única forma de ver era reabrir o planejador inteiro.
//
// A regra que organiza a tela: 68% dos clientes só têm coordenada de CIDADE
// (nenhum cliente do CRM tem coordenada de endereço). Enquanto a propriedade
// estiver no centro do município, a rota está errada em dezenas de km. Por isso
// "pegar a localização" é tão importante quanto "confirmar a data", e as duas
// coisas aparecem lado a lado em cada linha.

const ESTADO: Record<Confirmacao, { texto: string; cor: string; bg: string }> = {
  nao_solicitado:        { texto: 'Não pedido',            cor: '#64748b', bg: 'rgba(100,116,139,.12)' },
  aguardando_vendedor:   { texto: 'Com o vendedor',        cor: '#d97706', bg: 'rgba(217,119,6,.12)' },
  aguardando_cliente:    { texto: 'Com o cliente',         cor: '#d97706', bg: 'rgba(217,119,6,.12)' },
  localizacao_recebida:  { texto: 'Localização recebida',  cor: '#2563eb', bg: 'rgba(37,99,235,.12)' },
  visita_confirmada:     { texto: 'Visita confirmada',     cor: '#16a34a', bg: 'rgba(22,163,74,.12)' },
  indisponivel:          { texto: 'Não pode receber',      cor: '#dc2626', bg: 'rgba(220,38,38,.12)' },
}

const dataBR = (iso: string | null) =>
  iso ? new Date(iso.length <= 10 ? `${iso}T12:00:00` : iso).toLocaleDateString('pt-BR') : 'sem data'

/** Falta o quê pra essa parada estar pronta. Vazio = pronta. */
function pendencias(p: ParadaConfirmacao): string[] {
  // Cliente que já disse não: não se cobra localização de visita que não vai
  // acontecer. Antes o quadro pedia o endereço de quem tinha recusado.
  if (p.confirmacao === 'indisponivel') return []
  const f: string[] = []
  if (p.precisao === 'cidade' || p.precisao === 'estado') f.push('localização')
  if (p.confirmacao !== 'visita_confirmada') f.push('confirmação')
  return f
}

/**
 * Pronta = dá pra visitar. Cliente que disse NÃO está RESOLVIDO, não pronto —
 * tratar os dois como a mesma coisa fazia a barra ficar 100% verde e oferecer
 * "marcar como pronta pra rodar" numa viagem onde ninguém pode receber.
 */
const pronta = (p: ParadaConfirmacao) =>
  p.confirmacao !== 'indisponivel' && pendencias(p).length === 0

/** Já não pede mais nada — ou porque está pronta, ou porque o cliente recusou. */
const resolvida = (p: ParadaConfirmacao) =>
  p.confirmacao === 'indisponivel' || pronta(p)

/** Lembra se o quadro estava aberto entre uma visita e outra à página. */
const CHAVE_ABERTO = 'branorte:organizacao-viagem-aberto'

export function OrganizacaoViagem({
  onAbrirViagem, semMoldura = false,
}: {
  onAbrirViagem: (id: string) => void
  /**
   * Em PAGINA PROPRIA nao existe o que colapsar: quem entrou aqui veio ver isto.
   * O sanfonado so faz sentido quando o bloco divide a tela com outra coisa.
   */
  semMoldura?: boolean
}) {
  const { data: viagens = [], isLoading, isError, refetch } = useQuadroViagens()
  const [aberta, setAberta] = useState<string | null>(null)

  // FECHADO por padrão. O /mapa-visitas já é uma tela cheia — filtros, painel de
  // valor por estado, planejador. Mais um bloco sempre aberto embaixo empurra o
  // mapa pra cima e vira ruído pra quem só quer ver os pinos. Fica como OPÇÃO,
  // com o contador do lado pra não precisar abrir só pra saber se tem algo.
  const [abertoLocal, setAberto] = useState(() => {
    try { return localStorage.getItem(CHAVE_ABERTO) === '1' } catch { return false }
  })
  const aberto = semMoldura || abertoLocal
  const alternar = () => setAberto(v => {
    const novo = !v
    try { localStorage.setItem(CHAVE_ABERTO, novo ? '1' : '0') } catch { /* modo anônimo */ }
    return novo
  })

  // Viagem que ainda não tem parada nenhuma é rascunho vazio: só polui.
  const lista = useMemo(() => viagens.filter(v => v.paradas > 0), [viagens])

  // Quanto falta no total — é o que justifica abrir.
  const pendentes = useMemo(
    () => lista.reduce((n, v) => n + v.paradasDetalhe.filter(p => pendencias(p).length > 0).length, 0),
    [lista],
  )

  if (isLoading) {
    return <Moldura aberto={aberto} alternar={alternar} viagens={lista.length} pendentes={pendentes} semMoldura={semMoldura}><div className="p-4 text-[13px] text-ink-faint">Carregando viagens…</div></Moldura>
  }
  if (isError) {
    return (
      <Moldura aberto={aberto} alternar={alternar} viagens={lista.length} pendentes={pendentes} semMoldura={semMoldura}>
        <div className="p-4 text-[13px] text-red-600 flex items-center gap-2">
          Não consegui carregar as viagens.
          <button onClick={() => refetch()} className="underline font-semibold">tentar de novo</button>
        </div>
      </Moldura>
    )
  }
  if (!lista.length) {
    return (
      <Moldura aberto={aberto} alternar={alternar} viagens={lista.length} pendentes={pendentes} semMoldura={semMoldura}>
        <div className="p-4 text-[13px] text-ink-faint">
          Nenhuma viagem aguardando. Monte um roteiro em <b className="text-ink">🧭 Planejar viagem</b> e
          clique em <b className="text-ink">Salvar</b> — ele aparece aqui pra os vendedores confirmarem.
        </div>
      </Moldura>
    )
  }

  return (
    <Moldura aberto={aberto} alternar={alternar} viagens={lista.length} pendentes={pendentes} semMoldura={semMoldura}>
      <div className="divide-y divide-border">
        {lista.map(v => (
          <CardViagem
            key={v.id}
            v={v}
            aberta={aberta === v.id}
            onAlternar={() => setAberta(a => (a === v.id ? null : v.id))}
            onAbrirViagem={onAbrirViagem}
          />
        ))}
      </div>
    </Moldura>
  )
}

function Moldura({
  children, aberto, alternar, viagens, pendentes, semMoldura,
}: {
  children: React.ReactNode
  aberto: boolean
  alternar: () => void
  viagens: number
  pendentes: number
  semMoldura: boolean
}) {
  return (
    <section className={semMoldura
      ? 'rounded-xl border border-border bg-surface overflow-hidden'
      : 'mt-4 rounded-xl border border-border bg-surface overflow-hidden'}>
      {/* Fechado, é UMA LINHA. Os números ficam do lado justamente pra não ter
          que abrir só pra descobrir se tem algo esperando. Em página própria o
          cabeçalho-botão sai: não há o que colapsar. */}
      {!semMoldura && <button
        onClick={alternar}
        className="w-full px-4 py-3 flex items-center gap-2 text-left hover:bg-surface-2 transition-colors"
      >
        <span className="text-[12px] text-ink-faint w-3">{aberto ? '▾' : '▸'}</span>
        <span className="text-[15px]">🧭</span>
        <h2 className="text-[14px] font-bold text-ink">Organização de viagem</h2>
        {viagens > 0 && (
          <span className="text-[12px] text-ink-faint">
            {viagens} viagem{viagens > 1 ? 's' : ''}
          </span>
        )}
        {pendentes > 0 && (
          <span
            className="text-[11px] font-bold px-2 py-0.5 rounded"
            style={{ color: '#d97706', background: 'rgba(217,119,6,.14)' }}
          >
            {pendentes} aguardando o vendedor
          </span>
        )}
        <span className="ml-auto text-[12px] text-ink-faint">
          {aberto ? 'fechar' : 'abrir'}
        </span>
      </button>}
      {/* Sem a moldura, o cabeçalho-botão some — e os contadores iam junto. Eles
          são o resumo mais útil do quadro ("2 aguardando o vendedor"), então
          voltam como linha, sem o botão. */}
      {semMoldura && (viagens > 0 || pendentes > 0) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-border">
          <span className="text-[12.5px] text-ink-muted">
            {viagens} viagem{viagens > 1 ? 's' : ''} em andamento
          </span>
          {pendentes > 0 && (
            <span
              className="text-[11px] font-bold px-2 py-0.5 rounded"
              style={{ color: '#d97706', background: 'rgba(217,119,6,.14)' }}
            >
              {pendentes} aguardando o vendedor
            </span>
          )}
        </div>
      )}
      {aberto && <div className={semMoldura ? '' : 'border-t border-border'}>{children}</div>}
    </section>
  )
}

function CardViagem({
  v, aberta, onAlternar, onAbrirViagem,
}: {
  v: ViagemQuadro
  aberta: boolean
  onAlternar: () => void
  onAbrirViagem: (id: string) => void
}) {
  const status = useStatusViagem()
  const prontas = v.paradasDetalhe.filter(pronta).length
  const resolvidas = v.paradasDetalhe.filter(resolvida).length
  const pct = v.paradas ? Math.round((resolvidas / v.paradas) * 100) : 0
  // Só oferece rodar se sobrou visita PRA VALER. Sem o `prontas > 0`, uma viagem
  // em que os 4 clientes recusaram batia 100% e virava roteiro de zero visitas.
  const tudoPronto = resolvidas === v.paradas && prontas > 0

  return (
    <div>
      <button onClick={onAlternar} className="w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-[12px] text-ink-faint w-4">{aberta ? '▾' : '▸'}</span>
          <span className="text-[13.5px] font-bold text-ink">{v.nome}</span>
          <span className="text-[12px] text-ink-faint">
            {dataBR(v.data_inicio)} · {v.dias} dia{v.dias > 1 ? 's' : ''} · {v.paradas} parada{v.paradas > 1 ? 's' : ''}
          </span>
          {v.indisponiveis > 0 && (
            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ color: '#dc2626', background: 'rgba(220,38,38,.12)' }}>
              {v.indisponiveis} não pode
            </span>
          )}
          <span className="ml-auto text-[12px] font-bold tabular-nums" style={{ color: tudoPronto ? '#16a34a' : '#d97706' }}>
            {prontas}/{v.paradas} pronta{v.paradas > 1 ? 's' : ''}
            {v.indisponiveis > 0 ? ` · ${v.indisponiveis} fora` : ''}
          </span>
        </div>
        {/* A barra é o resumo honesto: verde só quando dá pra sair dirigindo. */}
        <div className="mt-2 ml-7 h-1.5 rounded-full bg-surface-2 overflow-hidden">
          <div className="h-full rounded-full transition-all"
               style={{ width: `${pct}%`, background: tudoPronto ? '#16a34a' : '#d97706' }} />
        </div>
        {v.aproximadas > 0 && (
          <div className="mt-1.5 ml-7 text-[11.5px] text-amber-700 dark:text-amber-400">
            ⚠️ {v.aproximadas} parada{v.aproximadas > 1 ? 's' : ''} no centro da cidade — a rota sai errada até
            o vendedor mandar a localização da propriedade.
          </div>
        )}
      </button>

      {aberta && (
        <div className="px-4 pb-4">
          <div className="space-y-2">
            {v.paradasDetalhe.map(p => <LinhaParada key={p.id} p={p} viagem={v} />)}
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => onAbrirViagem(v.id)}
              className="h-9 px-3 rounded-lg bg-accent text-white text-[12.5px] font-bold"
            >
              Abrir no planejador
            </button>
            {tudoPronto && v.status !== 'pronta' && v.status !== 'em_andamento' && (
              <button
                onClick={() => status.mutate({ id: v.id, status: 'pronta' })}
                disabled={status.isPending}
                className="h-9 px-3 rounded-lg border border-green-600 text-green-700 dark:text-green-400 text-[12.5px] font-bold disabled:opacity-50"
              >
                ✅ Marcar como pronta pra rodar
              </button>
            )}
            {v.status === 'pronta' && (
              <button
                onClick={() => status.mutate({ id: v.id, status: 'em_andamento' })}
                disabled={status.isPending}
                className="h-9 px-3 rounded-lg border border-blue-600 text-blue-700 dark:text-blue-400 text-[12.5px] font-bold disabled:opacity-50"
              >
                🚚 Viagem começou
              </button>
            )}
            {v.status === 'em_andamento' && (
              <button
                onClick={() => status.mutate({ id: v.id, status: 'concluida' })}
                disabled={status.isPending}
                className="h-9 px-3 rounded-lg border border-border text-ink text-[12.5px] font-bold disabled:opacity-50"
              >
                Concluir viagem
              </button>
            )}
          </div>
          {status.isError && (
            <div className="mt-2 text-[12px] text-red-600">{status.error?.message}</div>
          )}
        </div>
      )}
    </div>
  )
}

function LinhaParada({ p, viagem }: { p: ParadaConfirmacao; viagem: ViagemQuadro }) {
  const confirmar = useConfirmarParada()
  const corrigir = useCorrigirLocalDaParada()
  const [colando, setColando] = useState(false)
  const [texto, setTexto] = useState('')
  const [erro, setErro] = useState<string | null>(null)
  const [resolvendo, setResolvendo] = useState(false)
  const [copiado, setCopiado] = useState(false)

  const falta = pendencias(p)
  const e = ESTADO[p.confirmacao]
  const aprox = p.precisao === 'cidade' || p.precisao === 'estado'

  /**
   * Recado pro vendedor. Fica no clipboard pra ele colar no WhatsApp — mandar
   * daqui exigiria integração com a instância, e o vendedor já vive no WhatsApp.
   */
  function copiarRecado() {
    const onde = [p.cidade, p.uf].filter(Boolean).join('/') || '—'
    const msg = [
      // Sem nome do vendedor, "Oi , tudo bem?" — o replace de espaço duplo não
      // pegava, porque a sobra é ANTES da vírgula.
      p.vendedor ? `Oi ${p.vendedor}, tudo bem?` : 'Oi, tudo bem?',
      '',
      `Tô montando a *${viagem.nome}* e o cliente *${p.nome}* (${onde}) está na lista.`,
      `Previsão: ${dataBR(viagem.data_inicio)}${viagem.dias > 1 ? ` (dia ${p.dia} da viagem)` : ''}.`,
      '',
      'Preciso de duas coisas:',
      '1) Confirma com ele se dá pra visitar nessa data?',
      aprox
        ? '2) Pede a *localização exata* da propriedade — o link do Google Maps ou a localização do WhatsApp mesmo.'
        : '2) Confirma se a localização que temos ainda é a certa.',
      '',
      aprox
        ? 'O que eu tenho aqui é só o centro da cidade, então sem isso a rota sai errada.'
        : '',
    ].filter(l => l !== '').join('\n')
    // O avanço para "com o vendedor" só acontece SE a cópia deu certo. Fora do
    // then, a parada mudava de estado mesmo com o erro "não consegui copiar" na
    // tela — o quadro passava a dizer que o vendedor foi acionado sem nenhuma
    // mensagem ter saído.
    navigator.clipboard.writeText(msg).then(
      () => {
        setCopiado(true); setTimeout(() => setCopiado(false), 2200)
        if (p.confirmacao === 'nao_solicitado') {
          confirmar.mutate({ paradaId: p.id, confirmacao: 'aguardando_vendedor' })
        }
      },
      () => setErro('Não consegui copiar. Selecione o texto na mão.'),
    )
  }

  /** Aceita link do Google, localização do WhatsApp, geo: ou coordenada colada. */
  async function aplicarLocal() {
    setErro(null)
    const t = texto.trim()
    if (!t) return

    let achado = lerLocal(t)
    let motivo: string | null = null

    // Link curto do celular não tem coordenada dentro — precisa seguir o
    // redirecionamento, e isso só dá server-side (o encurtador não manda CORS).
    if (!achado && ehLinkCurto(t)) {
      setResolvendo(true)
      try {
        const r = await fetch('/api/resolver-link', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ url: urlCurta(t) }),
        })
        const j = await r.json()
        if (j?.ok) achado = { lat: j.lat, lng: j.lng, fonte: 'link_curto_resolvido' }
        else motivo = j?.motivo || 'Não consegui abrir esse link.'
      } catch {
        motivo = 'Não consegui abrir esse link agora. Tente de novo.'
      } finally {
        setResolvendo(false)
      }
    }

    if (!achado) {
      // `motivo` local, NÃO o state `erro`: dentro desta função o `erro` ainda é
      // o valor do render anterior. Lendo dele, o motivo específico que o
      // servidor devolveu ("esse link expirou") era sempre trocado pela
      // mensagem genérica — e na segunda tentativa a mensagem sumia de vez.
      setErro(motivo ?? 'Não achei coordenada aí. Cole o link do Google Maps, a localização do WhatsApp, ou "-7.2297, -44.5561".')
      return
    }

    // Correção absurda é quase sempre link errado (o vendedor colou o link de
    // OUTRO cliente). Avisa antes, em vez de mover a propriedade em silêncio.
    const salto = distanciaKm(p.lat, p.lng, achado.lat, achado.lng)
    if (salto > 150) {
      const ok = window.confirm(
        `Essa localização fica a ${Math.round(salto)} km de onde o cliente está hoje.\n\n` +
        `Isso costuma ser link de outro cliente. Confirma que é do ${p.nome}?`,
      )
      if (!ok) return
    }

    corrigir.mutate(
      { paradaId: p.id, cliKeys: p.cliKeys, lat: achado.lat, lng: achado.lng, fonte: achado.fonte },
      { onSuccess: () => { setColando(false); setTexto('') }, onError: err => setErro(err.message) },
    )
  }

  return (
    <div className="rounded-lg border border-border bg-surface-2 px-3 py-2.5">
      <div className="flex items-start gap-2 flex-wrap">
        <span className="text-[11px] font-bold tabular-nums text-ink-faint mt-0.5">
          {viagem.dias > 1 ? `${p.dia}.${p.ordem}` : p.ordem}
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold text-ink truncate">{p.nome}</div>
          <div className="text-[11.5px] text-ink-faint">
            {[p.cidade, p.uf].filter(Boolean).join('/') || '—'}
            {p.vendedor ? ` · ${p.vendedor}` : ''}
            {p.cliKeys.length > 1 ? ` · ${p.cliKeys.length} clientes nessa parada` : ''}
          </div>
        </div>
        <span className="text-[11px] font-bold px-2 py-1 rounded" style={{ color: e.cor, background: e.bg }}>
          {e.texto}
        </span>
      </div>

      {aprox && (
        <div className="mt-1.5 text-[11.5px] text-amber-700 dark:text-amber-400">
          📍 Está no centro de {p.cidade || 'município'} — não é a propriedade.
        </div>
      )}
      {falta.length > 0 && !aprox && (
        <div className="mt-1.5 text-[11.5px] text-ink-faint">Falta: {falta.join(' e ')}.</div>
      )}

      {/* A RPC nega com 42501 quando a parada e de outro vendedor — e o quadro
          mostra TODAS as paradas da viagem, entao esse caminho e COMUM. Sem
          isto o clique nao fazia nada e nao dizia nada: so console. */}
      {confirmar.isError && (
        <div className="mt-1.5 text-[11.5px] text-red-600">
          {/^.*42501|permission|nao e sua|não é sua/i.test(confirmar.error?.message ?? '')
            ? 'Essa parada é de outro vendedor — só ele (ou quem montou a viagem) pode confirmar.'
            : `Não consegui salvar: ${confirmar.error?.message}`}
        </div>
      )}
      {corrigir.isError && !colando && (
        <div className="mt-1.5 text-[11.5px] text-red-600">
          Não consegui gravar a localização: {corrigir.error?.message}
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5">
        <button onClick={copiarRecado}
                className="h-8 px-2.5 rounded-md border border-border text-ink text-[12px] font-semibold hover:bg-surface">
          {copiado ? '✅ copiado' : '💬 Copiar recado pro vendedor'}
        </button>
        <button onClick={() => { setColando(c => !c); setErro(null) }}
                className="h-8 px-2.5 rounded-md border border-blue-300 dark:border-blue-800 text-blue-700 dark:text-blue-400 text-[12px] font-semibold">
          📍 {aprox ? 'Colar localização' : 'Corrigir localização'}
        </button>
        {p.confirmacao !== 'visita_confirmada' && (
          <button onClick={() => confirmar.mutate({ paradaId: p.id, confirmacao: 'visita_confirmada' })}
                  disabled={confirmar.isPending}
                  className="h-8 px-2.5 rounded-md border border-green-600 text-green-700 dark:text-green-400 text-[12px] font-bold disabled:opacity-50">
            ✅ Cliente confirmou
          </button>
        )}
        {p.confirmacao !== 'indisponivel' && (
          <button onClick={() => confirmar.mutate({ paradaId: p.id, confirmacao: 'indisponivel' })}
                  disabled={confirmar.isPending}
                  className="h-8 px-2.5 rounded-md border border-border text-ink-faint text-[12px] font-semibold disabled:opacity-50">
            ❌ Não pode
          </button>
        )}
        {p.confirmacao === 'indisponivel' && (
          <button onClick={() => confirmar.mutate({ paradaId: p.id, confirmacao: 'aguardando_vendedor' })}
                  className="h-8 px-2.5 rounded-md border border-border text-ink text-[12px] font-semibold">
            ↩ Reabrir
          </button>
        )}
      </div>

      {colando && (
        <div className="mt-2">
          <div className="flex gap-1.5">
            <input
              value={texto}
              onChange={ev => setTexto(ev.target.value)}
              onKeyDown={ev => { if (ev.key === 'Enter') { ev.preventDefault(); void aplicarLocal() } }}
              placeholder="Cole o link do Google Maps, a localização do WhatsApp ou -7.2297, -44.5561"
              autoFocus
              className="flex-1 h-9 px-2.5 rounded-md bg-surface border border-border text-[12.5px] text-ink"
            />
            <button onClick={() => void aplicarLocal()}
                    disabled={resolvendo || corrigir.isPending || !texto.trim()}
                    className="h-9 px-3 rounded-md bg-accent text-white text-[12.5px] font-bold disabled:opacity-50">
              {resolvendo ? 'abrindo…' : corrigir.isPending ? 'salvando…' : 'Aplicar'}
            </button>
          </div>
          <div className="mt-1 text-[11px] text-ink-faint">
            Link curto (maps.app.goo.gl) também serve — eu abro pra pegar a coordenada.
          </div>
          {erro && <div className="mt-1 text-[11.5px] text-red-600">{erro}</div>}
        </div>
      )}
    </div>
  )
}
