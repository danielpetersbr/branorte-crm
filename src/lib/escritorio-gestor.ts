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

export function formatarMetricaGestor(valor: number | null): string {
  return valor == null ? '—' : new Intl.NumberFormat('pt-BR').format(valor)
}

const somaOuNull = (valores: Array<number | null>) => valores.every(valor => valor == null)
  ? null
  : valores.reduce<number>((total, valor) => total + (valor ?? 0), 0)

const precisaAtencao = (vendedor: VendedorGestor, expediente: boolean) =>
  vendedor.cortadoPorCota || (expediente && ['wa_fechado', 'verificar_wa', 'desconectado'].includes(vendedor.status))

export function criarResumoGestor(vendedores: VendedorGestor[], expediente: boolean): ResumoGestor {
  return {
    atendimentos: somaOuNull(vendedores.map(vendedor => vendedor.atendimentos)),
    leads: somaOuNull(vendedores.map(vendedor => vendedor.leads)),
    orcamentos: somaOuNull(vendedores.map(vendedor => vendedor.orcamentos)),
    ativos: vendedores.filter(vendedor => vendedor.status === 'ativo').length,
    total: vendedores.length,
    precisamAtencao: new Set(vendedores.filter(vendedor => precisaAtencao(vendedor, expediente)).map(vendedor => vendedor.nome)).size,
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
      alertas.push({ id: `${vendedor.nome}-status`, vendedor: vendedor.nome, tipo: 'offline', nivel: 'critico', titulo: `${vendedor.nome} está ${vendedor.statusLabel}`, texto: 'Verifique o computador e o WhatsApp.' })
    }
  }
  const lider = [...vendedores].sort((a, b) => (b.orcamentos ?? -1) - (a.orcamentos ?? -1) || (b.leads ?? -1) - (a.leads ?? -1))[0]
  if (lider && (lider.orcamentos ?? 0) > 0) {
    alertas.push({ id: `${lider.nome}-destaque`, vendedor: lider.nome, tipo: 'destaque', nivel: 'positivo', titulo: `${lider.nome} lidera em orçamentos`, texto: `${lider.orcamentos} dos orçamentos de hoje.` })
  }
  const peso = { critico: 0, atencao: 1, positivo: 2 } as const
  return alertas.sort((a, b) => peso[a.nivel] - peso[b.nivel] || a.vendedor.localeCompare(b.vendedor))
}

export function ordenarVendedoresGestor(vendedores: VendedorGestor[], ordem: OrdemGestor): VendedorGestor[] {
  if (ordem === 'atencao') {
    return [...vendedores].sort((a, b) => Number(b.cortadoPorCota) - Number(a.cortadoPorCota) || (b.parados ?? -1) - (a.parados ?? -1) || (b.atendimentos ?? -1) - (a.atendimentos ?? -1))
  }
  const campo = ordem === 'ligacoes' ? 'ligacoesAtendidas' : ordem
  return [...vendedores].sort((a, b) => ((b[campo] as number | null) ?? -1) - ((a[campo] as number | null) ?? -1))
}

export function escolherVendedorInicial(vendedores: VendedorGestor[], alertas: AlertaGestor[]): string | null {
  const lider = ordenarVendedoresGestor(vendedores, 'atendimentos').find(vendedor => vendedor.atendimentos != null)
  return alertas[0]?.vendedor ?? lider?.nome ?? null
}
