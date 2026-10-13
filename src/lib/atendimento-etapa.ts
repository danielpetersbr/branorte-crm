import type { Atendimento } from '../types/atendimento'

export type EtapaAtendimento = 'com-vendedor' | 'em-atendimento' | 'encerrado-sem-vendedor'
type VendedorEfetivo = { name: string; source: 'crm' | 'wa' | 'repasse' } | null

function humano(nome: string | null | undefined): boolean {
  const primeiro = nome?.trim().split(/\s+/)[0].toUpperCase()
  return !!primeiro && primeiro !== 'ANA'
}

/** A view conta ANA em chegou_no_vendedor; esse booleano não prova repasse humano. */
export function etapaAtendimento(r: Partial<Atendimento>, vendedor?: VendedorEfetivo, vendedoresWhatsapp: (string | null | undefined)[] = []): EtapaAtendimento {
  const repasseConfirmado = r.dispatch_origem === 'WhatsApp ANA'
    && r.dispatch_status === 'sent' && humano(r.dispatch_vendedor_nome)
  const vendedorConfirmado = vendedor && vendedor.source !== 'repasse' && humano(vendedor.name)
  if (humano(r.responsavel) || repasseConfirmado || vendedorConfirmado || vendedoresWhatsapp.some(humano)) return 'com-vendedor'

  // Mesmos estados terminais gravados pelo webhook de encerramento da IA.
  // Sem-Resposta isolado também aparece nas tentativas 1–3, ainda em atendimento.
  if (r.finished_at || r.status_atendimento === 'Resolvido'
      || ['Venda', 'Perdido', 'Sem-resposta'].includes(r.como_finalizou ?? '')) {
    return 'encerrado-sem-vendedor'
  }
  return 'em-atendimento'
}

export const ETAPAS_ATENDIMENTO = {
  'com-vendedor': {
    label: 'Passou para o vendedor',
    linha: 'bg-emerald-500/[0.08] hover:bg-emerald-500/[0.14]',
    cartao: 'bg-emerald-500/[0.08] border-emerald-500/25',
    indicador: 'bg-emerald-500',
    borda: 'rgb(16 185 129 / 0.65)',
  },
  'em-atendimento': {
    label: 'Em atendimento — sem repasse',
    linha: 'bg-orange-500/[0.09] hover:bg-orange-500/[0.15]',
    cartao: 'bg-orange-500/[0.09] border-orange-500/25',
    indicador: 'bg-orange-500',
    borda: 'rgb(249 115 22 / 0.65)',
  },
  'encerrado-sem-vendedor': {
    label: 'Finalizado sem passar para o vendedor',
    linha: 'bg-red-500/[0.08] hover:bg-red-500/[0.14]',
    cartao: 'bg-red-500/[0.08] border-red-500/25',
    indicador: 'bg-red-500',
    borda: 'rgb(239 68 68 / 0.65)',
  },
} satisfies Record<EtapaAtendimento, { label: string; linha: string; cartao: string; indicador: string; borda: string }>
