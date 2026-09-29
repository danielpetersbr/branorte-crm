// Conversão Parada/ConfigViagem <-> linhas de `viagens` e `viagem_paradas`.
//
// Mora em lib/ e não em hooks/ de propósito: é lógica PURA, sem supabase, sem React.
// Enquanto estava dentro de useViagens.ts não dava pra testar — o import do client
// puxa `import.meta.env`, que não existe fora do Vite. Agora tem teste de round-trip.

import {
  CONFIG_PADRAO, refDoPonto,
  type ClienteRef, type ConfigViagem, type Confirmacao, type Parada,
  type Precisao, type PontoMapa, type Programacao, type TipoParada,
} from '@/lib/viagem'

// ── helpers de conversão ─────────────────────────────────────────────────────

/** time do banco ('HH:MM:SS') → 'HH:MM' do front. Aceita hora sem zero à esquerda. */
export const soHora = (t: unknown): string | null => {
  const m = /^(\d{1,2}):(\d{2})/.exec(t == null ? '' : String(t))
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** 'HH:MM' do front → time do banco. Lixo vira null em vez de estourar o INSERT.
 *  A faixa é checada de verdade: '99:99' casa com \d{1,2}:\d{2} mas não é hora,
 *  e o Postgres recusaria o literal em vez de gravar null. */
export const praHora = (h: string | null | undefined): string | null => {
  const min = hhmm(h)
  return min == null ? null : `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}:00`
}

export const num = (v: unknown): number | null => (v == null || v === '' ? null : Number(v))

/** data 'YYYY-MM-DD' + minutos desde 00:00 → timestamptz. Hora é LOCAL (é o horário da viagem). */
export function carimbo(data: string | null | undefined, minutos: number | null | undefined): string | null {
  if (!data || minutos == null) return null
  const d = new Date(`${data}T00:00:00`)
  if (Number.isNaN(d.getTime())) return null
  d.setMinutes(d.getMinutes() + minutos)
  return d.toISOString()
}

export interface Encaixe {
  dia: number
  data: string | null
  chegada: number
  saida: number
  metros: number | null
  segundos: number | null
}

/** parada.id → onde ela caiu na programação. Quem não caiu (fora do plano) não entra no mapa. */
export function indexarProgramacao(prog?: Programacao): Map<string, Encaixe> {
  const m = new Map<string, Encaixe>()
  for (const d of prog?.dias ?? []) {
    for (const x of d.paradas) {
      m.set(x.parada.id, {
        dia: d.dia,
        data: d.data,
        chegada: x.chegada,
        saida: x.saida,
        metros: x.trechoAnterior?.metros ?? null,
        segundos: x.trechoAnterior?.segundos ?? null,
      })
    }
  }
  return m
}

/**
 * Traduz os CHECK da tabela `viagens` pra mensagem legível ANTES do INSERT.
 * O painel deixa passar: os dois <input type="time"> não se conversam (dá pra
 * fechar às 07:00 e abrir às 08:00) e visitaMinutosPadrao só é travado por
 * baixo (Math.max(5, …), sem teto). Sem isto, o usuário levaria um
 * `23514 viagens_jornada_valida` cru na tela.
 */
export function validarCfg(cfg: ConfigViagem): void {
  const ini = hhmm(cfg.horaInicio), fim = hhmm(cfg.horaFim)
  if (ini == null || fim == null) {
    throw new Error('Horário de início ou de fim inválido. Use o formato HH:MM.')
  }
  if (fim <= ini) {
    throw new Error(`O fim da jornada (${cfg.horaFim}) precisa ser depois do início (${cfg.horaInicio}).`)
  }
  if (!Number.isFinite(cfg.dias) || cfg.dias < 1 || cfg.dias > 60) {
    throw new Error('A viagem precisa ter entre 1 e 60 dias.')
  }
  if (cfg.almocoMinutos < 0 || cfg.almocoMinutos > 240) {
    throw new Error('O almoço precisa ter entre 0 e 240 minutos.')
  }
  if (cfg.visitaMinutosPadrao < 5 || cfg.visitaMinutosPadrao > 600) {
    throw new Error('O tempo padrão de visita precisa ficar entre 5 e 600 minutos.')
  }
}

/** 'HH:MM' → minutos. null quando não é hora. (Local: não vale importar de viagem.ts,
 *  cujo hhmmParaMin aceita lixo e devolve 0 — aqui 0 e inválido são coisas diferentes.) */
export function hhmm(s: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec((s ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), min = Number(m[2])
  return h > 23 || min > 59 ? null : h * 60 + min
}

export function linhaDaParada(viagemId: string, p: Parada, ordem: number, e: Encaixe | undefined) {
  const c0 = p.clientes[0] ?? null
  const keys = p.clientes.map(c => c.cliKey).filter((k): k is string => !!k)
  if (p.tipo === 'cliente' && !keys.length) {
    throw new Error(`Parada "${p.rotulo || p.cidade || p.id}" está marcada como cliente mas não tem cli_key.`)
  }
  const quem = p.rotulo || p.clientes[0]?.nome || p.cidade || p.id
  // CHECK visita_minutos between 0 and 1440 — o painel só trava o piso (Math.max(0, …))
  if (p.visitaMinutos != null && (p.visitaMinutos > 1440 || p.visitaMinutos < 0)) {
    throw new Error(`Tempo de visita de "${quem}" precisa ficar entre 0 e 1440 minutos.`)
  }
  // CHECK viagem_paradas_janela_valida (janela_fim > janela_inicio). Os dois
  // <input type="time"> do painel são independentes, então dá pra pedir visita
  // "das 14:00 às 09:00" e só descobrir no INSERT.
  const jIni = praHora(p.janelaInicio), jFim = praHora(p.janelaFim)
  if (jIni && jFim && jFim <= jIni) {
    throw new Error(`Em "${quem}", o fim da janela (${p.janelaFim}) precisa ser depois do início (${p.janelaInicio}).`)
  }
  return {
    viagem_id: viagemId,
    tipo: p.tipo,
    cli_key: p.tipo === 'cliente' ? keys[0] : null,
    cli_keys: keys.length ? keys : null,
    rotulo: p.rotulo,
    cliente_nome: c0?.nome ?? null,
    vendedor: c0?.vendedor ?? null,
    telefone: c0?.telefone ?? null,
    equipamento: c0?.equipamento ?? null,
    valor: c0?.valor ?? null,
    cidade: p.cidade,
    uf: p.uf,
    endereco: p.endereco,
    lat: p.lat,
    lng: p.lng,
    precisao: p.precisao,
    dia: e?.dia ?? 1,
    ordem,
    ordem_travada: p.ordemTravada,
    visita_minutos: p.visitaMinutos,
    janela_inicio: praHora(p.janelaInicio),
    janela_fim: praHora(p.janelaFim),
    chegada_prevista: carimbo(e?.data, e?.chegada),
    saida_prevista: carimbo(e?.data, e?.saida),
    metros_anterior: e?.metros ?? null,
    deslocamento_anterior_seg: e?.segundos ?? null,
    confirmacao: p.confirmacao,
    notas: p.notas,
  }
}

/**
 * Volta pra Parada. O banco guarda nome/telefone/vendedor só do PRIMEIRO cliente da
 * parada-cidade — os demais voltam como esqueleto (só cliKey). Use hidratarParadas()
 * com os pontos do mapa pra recompor tudo.
 */
export function paradaDaLinha(r: Record<string, unknown>): Parada {
  const arr = Array.isArray(r.cli_keys) ? (r.cli_keys as string[]).filter(Boolean) : []
  const keys = arr.length ? arr : (r.cli_key ? [String(r.cli_key)] : [])
  const clientes: ClienteRef[] = keys.map((k, i) => ({
    cliKey: k,
    nome: i === 0 ? ((r.cliente_nome as string | null) ?? null) : null,
    telefone: i === 0 ? ((r.telefone as string | null) ?? null) : null,
    vendedor: i === 0 ? ((r.vendedor as string | null) ?? null) : null,
    equipamento: i === 0 ? ((r.equipamento as string | null) ?? null) : null,
    valor: i === 0 ? num(r.valor) : null,
    vendido: false,
    numeros: null,
  }))
  return {
    id: String(r.id),
    tipo: (r.tipo as TipoParada) ?? 'parada',
    clientes,
    rotulo: (r.rotulo as string | null) ?? null,
    cidade: (r.cidade as string | null) ?? null,
    uf: (r.uf as string | null) ?? null,
    endereco: (r.endereco as string | null) ?? null,
    lat: num(r.lat) ?? 0,
    lng: num(r.lng) ?? 0,
    precisao: ((r.precisao as Precisao) ?? 'cidade'),
    visitaMinutos: num(r.visita_minutos),
    janelaInicio: soHora(r.janela_inicio),
    janelaFim: soHora(r.janela_fim),
    ordemTravada: r.ordem_travada === true,
    notas: (r.notas as string | null) ?? null,
    confirmacao: ((r.confirmacao as Confirmacao) ?? 'nao_solicitado'),
  }
}

export function cfgDaLinha(v: Record<string, unknown>): ConfigViagem {
  const oLat = num(v.origem_lat), oLng = num(v.origem_lng)
  const dLat = num(v.destino_lat), dLng = num(v.destino_lng)
  return {
    nome: (v.nome as string | null) ?? '',
    dataInicio: (v.data_inicio as string | null) ?? null,
    dias: num(v.dias) ?? CONFIG_PADRAO.dias,
    // Viagem salva volta com os dias FIXOS: o número gravado foi decisão de
    // alguém (talvez de outro vendedor) e recalcular por cima ao abrir seria
    // reescrever o plano dos outros sem avisar. Quem quiser o automático
    // clica em "voltar ao automático" no campo Dias.
    diasManual: true,
    horaInicio: soHora(v.hora_inicio) ?? CONFIG_PADRAO.horaInicio,
    horaFim: soHora(v.hora_fim) ?? CONFIG_PADRAO.horaFim,
    almocoInicio: soHora(v.almoco_inicio),
    almocoMinutos: num(v.almoco_minutos) ?? CONFIG_PADRAO.almocoMinutos,
    visitaMinutosPadrao: num(v.visita_minutos_padrao) ?? CONFIG_PADRAO.visitaMinutosPadrao,
    origem: oLat != null && oLng != null
      ? { nome: (v.origem_nome as string | null) ?? 'Origem', lat: oLat, lng: oLng } : null,
    destino: dLat != null && dLng != null
      ? { nome: (v.destino_nome as string | null) ?? 'Destino', lat: dLat, lng: dLng } : null,
    retornarOrigem: v.retornar_origem !== false,
    pernoitar: v.pernoitar !== false,
    modo: v.modo_otimizacao === 'manual' ? 'manual' : 'otimizar',
  }
}

export function linhaDaCfg(cfg: ConfigViagem, prog?: Programacao) {
  return {
    nome: cfg.nome.trim() || 'Viagem sem nome', // coluna é NOT NULL e lista com nome vazio é inútil
    data_inicio: cfg.dataInicio || null,
    dias: cfg.dias,
    origem_nome: cfg.origem?.nome ?? null,
    origem_lat: cfg.origem?.lat ?? null,
    origem_lng: cfg.origem?.lng ?? null,
    destino_nome: cfg.destino?.nome ?? null,
    destino_lat: cfg.destino?.lat ?? null,
    destino_lng: cfg.destino?.lng ?? null,
    retornar_origem: cfg.retornarOrigem,
    pernoitar: cfg.pernoitar !== false,
    hora_inicio: praHora(cfg.horaInicio) ?? praHora(CONFIG_PADRAO.horaInicio),
    hora_fim: praHora(cfg.horaFim) ?? praHora(CONFIG_PADRAO.horaFim),
    almoco_inicio: praHora(cfg.almocoInicio),
    almoco_minutos: cfg.almocoMinutos,
    visita_minutos_padrao: cfg.visitaMinutosPadrao,
    modo_otimizacao: cfg.modo,
    total_metros: prog?.totalMetros ?? null,
    total_deslocamento_seg: prog?.totalDeslocamentoSeg ?? null,
    total_visita_seg: prog?.totalVisitaSeg ?? null,
    // 'estimado' = haversine × fator de estrada; a UI usa isso pra avisar que não é rota real
    provedor_rota: prog ? (prog.estimado ? 'estimado' : 'osrm') : null,
    calculado_em: prog ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  }
}

// ── paradas com visita feita: salvar não pode apagar ─────────────────────────
//
// 29/09/2026: salvar pelo planejador apagava TODAS as paradas e reinseria. Só que o
// representante bate check-in/checkout e preenche o relatório em cima da parada
// (visita_relatorio.parada_id é ON DELETE CASCADE): o gestor acrescentava uma
// parada, salvava, e a visita feita sumia sem aviso — a parada voltava "sem
// check-in / sem relatório". Agora quem tem visita é PRESERVADO (UPDATE por id) e
// só o resto segue no apaga-e-insere.

/** O que o banco tem de uma parada já gravada — o necessário pra decidir se pode apagar. */
export interface ParadaGravada {
  id: string
  cli_key: string | null
  cli_keys: string[] | null
  rotulo?: string | null
  cliente_nome?: string | null
  cidade?: string | null
  checkin_at: string | null
  checkout_at: string | null
}

/** Visita feita = check-in, checkout ou relatório. Qualquer um dos três é trabalho de campo. */
export function paradasComVisita(gravadas: ParadaGravada[], comRelatorio: Iterable<string>): ParadaGravada[] {
  const rel = new Set(comRelatorio)
  return gravadas.filter(g => !!g.checkin_at || !!g.checkout_at || rel.has(g.id))
}

/** Chaves de cliente da linha (cli_keys; cli_key em registro velho), em ordem fixa. */
function assinaturaClientes(l: { cli_key: string | null; cli_keys: string[] | null }): string {
  const arr = (l.cli_keys ?? []).filter(Boolean)
  const keys = arr.length ? arr : (l.cli_key ? [l.cli_key] : [])
  return [...keys].sort().join('\u0001')
}

export interface PlanoParadas<L> {
  /** parada com visita que continua no plano: UPDATE por id (check-in e relatório ficam) */
  atualizar: { id: string; linha: L }[]
  /** o resto do plano: INSERT, id novo */
  inserir: L[]
  /** ids que o DELETE não pode levar — toda parada com visita, esteja ou não no plano */
  preservar: string[]
  /** tinha visita mas saiu do plano: fica no banco mesmo assim (a tela avisa) */
  foraDoPlano: ParadaGravada[]
}

/**
 * Casa as paradas do planejador com as que já têm visita no banco.
 *
 * 1º pelo id — é a mesma parada que veio do useViagem.
 * 2º pelos MESMOS clientes — depois de salvar, a tela continua com os ids antigos
 *    (o apaga-e-insere gera ids novos e ela não recarrega). Sem este passo, a parada
 *    visitada ficaria duplicada: a preservada + uma cópia nova.
 * 3º pelo cli_key — é UNIQUE na viagem; sem casar, o INSERT bateria 23505 contra a
 *    preservada (ex.: o cliente foi pra outra parada junto com mais alguém).
 *
 * Pura: o hook busca o que o banco tem e executa o plano.
 */
export function planoDasParadas<L extends { cli_key: string | null; cli_keys: string[] | null }>(
  planejadas: { paradaId: string; linha: L }[],
  comVisita: ParadaGravada[],
): PlanoParadas<L> {
  const livres = new Map(comVisita.map(g => [g.id, g]))
  const atualizar: { id: string; linha: L }[] = []
  const casar = (g: ParadaGravada, linha: L) => { atualizar.push({ id: g.id, linha }); livres.delete(g.id) }

  let pendentes: { paradaId: string; linha: L }[] = []
  for (const pl of planejadas) {
    const g = livres.get(pl.paradaId)
    if (g) casar(g, pl.linha)
    else pendentes.push(pl)
  }

  const passo = (achar: (pl: { paradaId: string; linha: L }) => ParadaGravada | undefined) => {
    const sobra: typeof pendentes = []
    for (const pl of pendentes) {
      const g = achar(pl)
      if (g) casar(g, pl.linha)
      else sobra.push(pl)
    }
    pendentes = sobra
  }
  passo(pl => {
    const ass = assinaturaClientes(pl.linha)
    return ass ? [...livres.values()].find(g => assinaturaClientes(g) === ass) : undefined
  })
  passo(pl => (pl.linha.cli_key ? [...livres.values()].find(g => g.cli_key === pl.linha.cli_key) : undefined))

  return {
    atualizar,
    inserir: pendentes.map(pl => pl.linha),
    preservar: comVisita.map(g => g.id),
    foraDoPlano: [...livres.values()],
  }
}

/**
 * Recompõe nome/telefone/vendedor/valor dos clientes de uma viagem salva a partir dos
 * pontos do mapa (mapa_orcamentos_v2). Sem isso, a parada-cidade volta do banco com só
 * o primeiro cliente nomeado. Pura — chame no render, não precisa de mutation.
 */
export function hidratarParadas(paradas: Parada[], pontos: PontoMapa[]): Parada[] {
  if (!pontos.length || !paradas.length) return paradas
  const porKey = new Map(pontos.map(p => [p.cli_key, p]))
  return paradas.map(p => {
    if (!p.clientes.length) return p
    let achou = false
    const clientes = p.clientes.map(c => {
      const ponto = porKey.get(c.cliKey)
      if (!ponto) return c
      achou = true
      // equipamento não vem da RPC — é campo da parada, preserva o que estava salvo
      return { ...refDoPonto(ponto), equipamento: c.equipamento }
    })
    return achou ? { ...p, clientes } : p
  })
}
