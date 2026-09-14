export type VoltagemOrcamento = 'monofasico' | 'trifasico'
export type ProposalStatus = 'pronta' | 'requer_escolha' | 'bloqueada'
export type ProposalOperation = 'substituir' | 'acrescentar' | 'editar'

export interface ClienteNormalizado {
  nome: string
  telefone?: string
  cidade?: string
  uf?: string
  endereco?: string
  bairro?: string
  cep?: string
  cpfCnpj?: string
  ie?: string
  email?: string
  contato?: string
}

export type ClienteParcial = Partial<ClienteNormalizado>

export interface ModeloResolvido {
  id: number
  basename: string
  linha?: string
  master: boolean
  voltagem: VoltagemOrcamento
  producaoKgH?: number | null
  armazenamentoKg?: number | null
}

export interface ItemResolvido {
  catalogoId: number | null
  nome: string
  quantidade: number
  valorUnitario: number
  categoria?: string | null
  descricao?: string[]
  fotoUrl?: string | null
}

export interface MotorResolvido {
  id?: number | null
  itemCatalogoId?: number | null
  descricao: string
  cv?: number | null
  polos?: number | null
  valor: number
  incluso: boolean
}

export interface AcessoriosResolvidos {
  mode: 'fixo' | 'percentual'
  valor: number
  percentual?: number
  items: string[]
  source: 'modelo' | 'pedido_explicito' | 'snapshot'
}

export interface ComponenteResolvido {
  nome: string
  valor: number
}

export interface CondicoesComerciais {
  formaPagamento: string
  prazoDias: number
  prazoTipo: 'uteis' | 'corridos' | 'pronta_entrega'
  freteTipo: 'FOB' | 'CIF'
  freteTexto: string
  validadeDias: number
  observacoes: string
}

export interface OrcamentoAISnapshot {
  orcamentoId: number | string | null
  cliente: ClienteNormalizado
  modelo: ModeloResolvido | null
  itens: ItemResolvido[]
  motores: MotorResolvido[]
  acessorios: AcessoriosResolvidos | null
  componentes: ComponenteResolvido[]
  voltagem: VoltagemOrcamento | null
  fotoPrincipalUrl: string | null
  condicoes: CondicoesComerciais
}

export interface ItemPedido {
  textoOriginal: string
  categoria?: string
  quantidade: number
  diametroMm?: number
  comprimentoM?: number
  capacidade?: number
  unidadeCapacidade?: 'kg' | 'litros' | 'toneladas'
  motorCv?: number
  semFunil?: boolean
}

export interface PerguntaPendente {
  code: string
  question: string
  options?: Array<{ id: string; label: string }>
}

export interface IntencaoOrcamento {
  operacao: 'novo' | 'editar' | 'consultar' | 'finalizar'
  cliente: ClienteParcial
  modeloPedido?: {
    linha?: 'MINI' | 'COMPACTA_01' | 'COMPACTA_02' | 'COMPACTA_03'
    master?: boolean
    producaoKgH?: number
    armazenamentoKg?: number
    dimensoes?: number[]
    voltagem?: VoltagemOrcamento
    basenameToken?: string
    textoOriginal?: string
  }
  itensPedidos: ItemPedido[]
  instrucoesExplicitas: {
    preservarAcessoriosDoModelo?: boolean
    alterarAcessorios?: boolean
    percentualAcessorios?: number
    enviarWhatsapp?: boolean
  }
  ambiguidades: PerguntaPendente[]
}

export interface DiferencaProposta {
  path: string
  kind: 'adicionado' | 'removido' | 'alterado' | 'mantido'
  before: unknown
  after: unknown
  requiresExplicitApproval: boolean
}

export interface AlertaValidacao {
  code: string
  severity: 'info' | 'warning' | 'blocking'
  message: string
}

export interface TotaisCalculados {
  equipamentos: number
  motores: number
  acessorios: number
  componentes: number
  proposta: number
}

export interface PropostaOrcamento {
  id: string
  baseRevision: string
  operacao: ProposalOperation
  cliente: ClienteNormalizado
  modelo: ModeloResolvido | null
  itens: ItemResolvido[]
  motores: MotorResolvido[]
  acessorios: AcessoriosResolvidos | null
  componentes: ComponenteResolvido[]
  voltagem: VoltagemOrcamento | null
  fotoPrincipalUrl: string | null
  condicoes: CondicoesComerciais
  totais: TotaisCalculados
  diferencas: DiferencaProposta[]
  alertas: AlertaValidacao[]
  status: ProposalStatus
}

export interface ModeloCandidato extends ModeloResolvido {
  itens: ItemResolvido[]
  motores: MotorResolvido[]
  acessorios: AcessoriosResolvidos | null
  componentes?: ComponenteResolvido[]
  fotoUrl?: string | null
}

export interface ComposicaoResolvida {
  itens: ItemResolvido[]
  motores: MotorResolvido[]
  perguntas: PerguntaPendente[]
}
