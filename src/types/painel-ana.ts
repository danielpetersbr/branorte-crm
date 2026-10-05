export type FiltroAna = 'todos' | 'atendidos' | 'qualificados' | 'erros' | 'abertos' | 'alertas'
export interface ClienteAna {
  cliente_ref: string; chat_id: string; contato_id: string | null; conversa_id: string | null; nome: string | null
  etapa: string; necessidade: string | null; vendedor: string | null; pendencia: string | null
  ultima_atividade: string | null; identidade_pendente: boolean
}
export interface IncidenteAna {
  id: string; origem: string; origem_ref: string; tipo: string; chat_id: string | null
  ocorrido_em: string; recuperado: boolean
  dados: { categoria?: string; severidade?: string; resumo?: string; referencia?: string }
}
export interface PainelAnaDados {
  gerado_em: string
  periodo: { inicio: string; fim: string }
  cobertura: Record<string, { inicio: string; incompleta: boolean; disponivel: boolean; parcial: boolean; observacao: string }>
  totais: { atendidos: number; qualificados: number; erros_tecnicos: number; alertas_revisor: number; nao_finalizados_agora: number }
  clientes: ClienteAna[]; incidentes: IncidenteAna[]; proximo_cursor: string | null
}
