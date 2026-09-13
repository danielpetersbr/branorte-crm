import { z } from 'zod'

export const analisePrecalculadaSchema = z.object({
  vendedor_id: z.string().uuid(), chat_id: z.string().min(1).max(200),
  gerado_em: z.string().datetime({ offset: true }),
  snapshot_em: z.string().datetime({ offset: true }),
  ultima_mensagem_em: z.string().datetime({ offset: true }).nullable(),
  snapshot_sha256: z.string().regex(/^[a-f0-9]{64}$/),
  mensagens_analisadas: z.number().int().nonnegative(),
  audios_sem_transcricao: z.number().int().nonnegative(), historico_parcial: z.boolean(),
  versao_contrato: z.literal(1), origem: z.enum(['codex_review', 'codex_cloud']),
  resumo: z.string().min(1).max(12000),
  pendencias: z.array(z.string().max(2000)).max(30),
  proxima_acao: z.string().max(4000).nullable(),
  mensagem_sugerida: z.string().max(4000).nullable(),
  evidencias: z.array(z.object({
    msg_id: z.string().min(1).max(300),
    trecho: z.string().min(1).max(4000),
    data_msg: z.string().datetime({ offset: true }).nullable(),
  })).max(50),
}).refine(a => Date.parse(a.snapshot_em) <= Date.parse(a.gerado_em), 'Snapshot posterior à análise')
  .refine(a => !a.ultima_mensagem_em || Date.parse(a.ultima_mensagem_em) <= Date.parse(a.snapshot_em), 'Mensagem posterior ao snapshot')

export type AnalisePrecalculada = z.infer<typeof analisePrecalculadaSchema>

/** SHA atualizado permite detectar inclusive edição de mensagem antiga.
 * Sem SHA atual, o máximo demonstrável é se existe mensagem posterior.
 */
export function estadoAnalisePrecalculada(a: AnalisePrecalculada, ultimaMensagem: string | null, shaAtual?: string): 'desatualizada' | 'verificada' | 'snapshot_nao_verificado' {
  if (shaAtual) return shaAtual === a.snapshot_sha256 ? 'verificada' : 'desatualizada'
  if (ultimaMensagem && (!a.ultima_mensagem_em || Date.parse(ultimaMensagem) > Date.parse(a.ultima_mensagem_em))) return 'desatualizada'
  return 'snapshot_nao_verificado'
}
