export type StatusGestor = 'ativo' | 'ocioso' | 'aguardando' | 'wa_fechado' | 'verificar_wa' | 'lento' | 'versao_antiga' | 'desconectado' | 'desligado'

export type VendedorGestor = {
  nome: string
  status: StatusGestor
  statusLabel: string
  pingSec: number | null
  versao: string | null
  atendimentos: number | null
  leads: number | null
  orcamentos: number | null
  ligacoesAtendidas: number | null
  ligacoesTotal: number | null
  followup: number | null
  quentes: number | null
  carteiraAberta: number | null
  carteiraTotal: number | null
  parados: number | null
  fatorCota: number | null
  cortadoPorCota: boolean
}

export type ResumoGestor = {
  atendimentos: number | null
  leads: number | null
  orcamentos: number | null
  ativos: number
  total: number
  precisamAtencao: number
}

export type AlertaGestor = {
  id: string
  vendedor: string
  tipo: 'cota-bloqueada' | 'cota-reduzida' | 'offline' | 'destaque'
  nivel: 'critico' | 'atencao' | 'positivo'
  titulo: string
  texto: string
}

export type OrdemGestor = 'atencao' | 'atendimentos' | 'leads' | 'orcamentos' | 'ligacoes' | 'parados'

export type CabecalhoHojeGestor = {
  id: 'vendedor' | 'status' | Exclude<OrdemGestor, 'atencao'>
  label: string
  ordem: Exclude<OrdemGestor, 'atencao'> | null
  ariaSort: 'descending' | 'none' | null
}

export function rotuloOrdemGestor(ordem: OrdemGestor): string {
  return {
    atencao: 'Atenção primeiro',
    atendimentos: 'Atend.',
    leads: 'Leads',
    orcamentos: 'Orç.',
    ligacoes: 'Ligações atendidas',
    parados: 'Pendências',
  }[ordem]
}

export function criarCabecalhosHojeGestor(ordemAtual: OrdemGestor): CabecalhoHojeGestor[] {
  const fixos: CabecalhoHojeGestor[] = [
    { id: 'vendedor', label: 'Vendedor', ordem: null, ariaSort: null },
    { id: 'status', label: 'Status', ordem: null, ariaSort: null },
  ]
  const ordenaveis: Array<Exclude<OrdemGestor, 'atencao'>> = ['atendimentos', 'leads', 'orcamentos', 'ligacoes', 'parados']
  return [
    ...fixos,
    ...ordenaveis.map(ordem => ({
      id: ordem,
      label: rotuloOrdemGestor(ordem),
      ordem,
      ariaSort: ordemAtual === ordem ? 'descending' as const : 'none' as const,
    })),
  ]
}

export type PeriodoGestor = 'hoje' | 'mes'
export type EstadoFonteGestor = 'carregando' | 'disponivel' | 'indisponivel'

export function resolverEstadoFonteGestor(isSuccess: boolean, isError: boolean): EstadoFonteGestor {
  if (isError) return 'indisponivel'
  return isSuccess ? 'disponivel' : 'carregando'
}

export function resolverVisaoTabelaGestor(periodo: PeriodoGestor, estadoMes: EstadoFonteGestor): 'hoje' | 'mes-carregando' | 'mes' | 'mes-indisponivel' {
  if (periodo === 'hoje') return 'hoje'
  if (estadoMes === 'carregando') return 'mes-carregando'
  return estadoMes === 'disponivel' ? 'mes' : 'mes-indisponivel'
}

export type OrigemSelecaoGestor =
  | { tipo: 'alerta'; vendedor: string }
  | { tipo: 'linha'; nome: string }

export function resolverSelecaoGestor(origem: OrigemSelecaoGestor): string {
  return origem.tipo === 'alerta' ? origem.vendedor : origem.nome
}

const normalizarNomeGestor = (nome: string) => nome
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .trim()
  .replace(/\s+/g, ' ')
  .toUpperCase()

export function nomeCanonicoVendedorGestor(nomeFonte: string, vendedores: string[]): string | null {
  const fonte = normalizarNomeGestor(nomeFonte)
  const exato = vendedores.find(nome => normalizarNomeGestor(nome) === fonte)
  if (exato) return exato
  const primeiroNome = fonte.split(' ')[0]
  const candidatos = vendedores.filter(nome => normalizarNomeGestor(nome).split(' ')[0] === primeiroNome)
  return candidatos.length === 1 ? candidatos[0] : null
}

export function mesaTemSuperficieClicavelGestor(
  modo: 'normal' | 'paredes' | 'mesas',
  tipoOcupante: 'vendedor' | 'outro' | null,
  pessoaSelecionada: boolean,
): boolean {
  return modo === 'normal' && (pessoaSelecionada || tipoOcupante === 'vendedor')
}

export function formatarMetricaGestor(valor: number | null): string {
  return valor == null ? '—' : new Intl.NumberFormat('pt-BR').format(valor)
}

export function formatarUltimoSinalGestor(pingSec: number | null): string {
  if (pingSec == null || !Number.isFinite(pingSec)) return '— (sem sinal)'
  const segundos = Math.max(0, Math.round(pingSec))
  if (segundos === 0) return 'agora'
  if (segundos < 60) return `há ${segundos}s`
  if (segundos < 3600) return `há ${Math.floor(segundos / 60)} min`
  return `há ${Math.floor(segundos / 3600)}h`
}

export function normalizarFatorCotaGestor(cotaAtiva: boolean, fator: number | null | undefined): number | null {
  return cotaAtiva && fator != null ? Number(fator) : null
}

export function normalizarMetricaFonteGestor(isSuccess: boolean, valor: number | null | undefined): number | null {
  return isSuccess ? (valor ?? 0) : null
}

export function estaNoExpedienteGestor(instante: Date | number): boolean {
  const data = instante instanceof Date ? instante : new Date(instante)
  const dia = data.getDay()
  const minutos = data.getHours() * 60 + data.getMinutes()
  return dia >= 1 && dia <= 5 && minutos >= 7 * 60 + 15 && minutos < 17 * 60 + 30
}

const somaOuNull = (valores: Array<number | null>) => valores.every(valor => valor == null)
  ? null
  : valores.reduce<number>((total, valor) => total + (valor ?? 0), 0)

const PESO_ALERTA_GESTOR = { 'cota-bloqueada': 0, offline: 1, 'cota-reduzida': 2, destaque: 3 } as const

export function criarResumoGestor(vendedores: VendedorGestor[], alertas: AlertaGestor[]): ResumoGestor {
  return {
    atendimentos: somaOuNull(vendedores.map(vendedor => vendedor.atendimentos)),
    leads: somaOuNull(vendedores.map(vendedor => vendedor.leads)),
    orcamentos: somaOuNull(vendedores.map(vendedor => vendedor.orcamentos)),
    ativos: vendedores.filter(vendedor => vendedor.status === 'ativo').length,
    total: vendedores.length,
    precisamAtencao: new Set(alertas.filter(alerta => alerta.nivel !== 'positivo').map(alerta => alerta.vendedor)).size,
  }
}

export function criarAlertasGestor(vendedores: VendedorGestor[], cfg: { expediente: boolean; cotaAtiva: boolean; cotaZero: number }): AlertaGestor[] {
  const alertas: AlertaGestor[] = []
  for (const vendedor of vendedores) {
    if (cfg.cotaAtiva && vendedor.cortadoPorCota) {
      alertas.push({ id: `${vendedor.nome}-cota`, vendedor: vendedor.nome, tipo: 'cota-bloqueada', nivel: 'critico', titulo: `${vendedor.nome} não recebe novos leads`, texto: `Não recebe novos leads: ${vendedor.parados ?? 0} clientes parados; limite ${cfg.cotaZero}.` })
    } else if (cfg.cotaAtiva && vendedor.fatorCota != null && vendedor.fatorCota < 1) {
      alertas.push({ id: `${vendedor.nome}-cota`, vendedor: vendedor.nome, tipo: 'cota-reduzida', nivel: 'atencao', titulo: `${vendedor.nome} recebe menos leads`, texto: `${vendedor.parados ?? 0} clientes parados reduziram a distribuição.` })
    }
    if (cfg.expediente && ['wa_fechado', 'verificar_wa', 'desconectado'].includes(vendedor.status)) {
      alertas.push({ id: `${vendedor.nome}-status`, vendedor: vendedor.nome, tipo: 'offline', nivel: 'critico', titulo: `${vendedor.nome} está ${vendedor.statusLabel}`, texto: 'Pode não receber novos leads. Verifique o computador e o WhatsApp.' })
    }
  }
  const lider = [...vendedores].sort((a, b) => (b.orcamentos ?? -1) - (a.orcamentos ?? -1) || (b.leads ?? -1) - (a.leads ?? -1))[0]
  if (lider && (lider.orcamentos ?? 0) > 0) {
    alertas.push({ id: `${lider.nome}-destaque`, vendedor: lider.nome, tipo: 'destaque', nivel: 'positivo', titulo: `${lider.nome} lidera em orçamentos`, texto: `${lider.orcamentos} dos orçamentos de hoje.` })
  }
  return alertas.sort((a, b) => PESO_ALERTA_GESTOR[a.tipo] - PESO_ALERTA_GESTOR[b.tipo] || a.vendedor.localeCompare(b.vendedor))
}

export function ordenarVendedoresGestor(vendedores: VendedorGestor[], ordem: OrdemGestor, alertas: AlertaGestor[]): VendedorGestor[] {
  if (ordem === 'atencao') {
    const prioridade = new Map<string, number>()
    for (const alerta of alertas) {
      if (alerta.tipo === 'destaque') continue
      prioridade.set(alerta.vendedor, Math.min(prioridade.get(alerta.vendedor) ?? 3, PESO_ALERTA_GESTOR[alerta.tipo]))
    }
    return [...vendedores].sort((a, b) => (prioridade.get(a.nome) ?? 3) - (prioridade.get(b.nome) ?? 3) || (b.parados ?? -1) - (a.parados ?? -1) || (b.atendimentos ?? -1) - (a.atendimentos ?? -1))
  }
  const campo = ordem === 'ligacoes' ? 'ligacoesAtendidas' : ordem
  return [...vendedores].sort((a, b) => ((b[campo] as number | null) ?? -1) - ((a[campo] as number | null) ?? -1))
}

export function escolherVendedorInicial(vendedores: VendedorGestor[], alertas: AlertaGestor[]): string | null {
  const lider = ordenarVendedoresGestor(vendedores, 'atendimentos', alertas).find(vendedor => vendedor.atendimentos != null)
  return alertas[0]?.vendedor ?? lider?.nome ?? null
}
