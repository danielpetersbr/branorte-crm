// Builder estruturado de "Forma de Pagamento" e "Data da venda".
// Saída: strings prontas pra substituir no .docx Branorte.

export type TipoPagamento = 'avista' | 'parcelado' | 'entrada' | 'personalizado'

export interface FormaPagamentoConfig {
  tipo: TipoPagamento
  data_venda?: string         // YYYY-MM-DD (input do tipo date)
  // À vista
  avista_meio?: 'pix' | 'transferencia' | 'boleto' | 'dinheiro' | ''
  avista_desconto_pct?: number
  // Parcelado
  num_parcelas?: number
  intervalo_dias?: number     // 30, 45, 60
  primeira_em?: string        // YYYY-MM-DD
  // Entrada + parcelas
  entrada_pct?: number
  parcelas_apos_entrada?: number
  // Personalizado
  texto_custom?: string
}

export interface FormaPagamentoOutput {
  forma_pagamento: string     // string que vai pro "Forma de pagamento – ..."
  data_venda: string          // string que vai pro "Data da venda – ..."
}

function formatDateBR(iso: string): string {
  if (!iso) return ''
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!m) return iso
  return `${m[3]}/${m[2]}/${m[1]}`
}

function fmtPct(n: number): string {
  return Number.isInteger(n) ? `${n}%` : `${n.toFixed(1).replace('.', ',')}%`
}

function meioLabel(m?: string): string {
  switch (m) {
    case 'pix': return 'PIX'
    case 'transferencia': return 'transferência'
    case 'boleto': return 'boleto'
    case 'dinheiro': return 'dinheiro'
    default: return ''
  }
}

export function construirFormaPagamento(cfg: FormaPagamentoConfig): FormaPagamentoOutput {
  const dataVenda = cfg.data_venda ? formatDateBR(cfg.data_venda) : 'a combinar'

  if (cfg.tipo === 'personalizado') {
    return {
      forma_pagamento: (cfg.texto_custom || 'a combinar').trim(),
      data_venda: dataVenda,
    }
  }

  if (cfg.tipo === 'avista') {
    const meio = meioLabel(cfg.avista_meio)
    const desconto = cfg.avista_desconto_pct && cfg.avista_desconto_pct > 0
      ? ` com ${fmtPct(cfg.avista_desconto_pct)} de desconto`
      : ''
    const meioStr = meio ? ` (${meio})` : ''
    return {
      forma_pagamento: `À vista${meioStr}${desconto}`,
      data_venda: dataVenda,
    }
  }

  if (cfg.tipo === 'parcelado') {
    const n = cfg.num_parcelas ?? 3
    const intervalo = cfg.intervalo_dias ?? 30
    const primeira = cfg.primeira_em ? formatDateBR(cfg.primeira_em) : null
    // Ex: "30/60/90 dias" ou "30/60/90/120 dias"
    const sequencia = Array.from({ length: n }, (_, i) => intervalo * (i + 1)).join('/')
    const primeiraStr = primeira ? ` (1ª em ${primeira})` : ''
    return {
      forma_pagamento: `${sequencia} dias${primeiraStr}`,
      data_venda: dataVenda,
    }
  }

  if (cfg.tipo === 'entrada') {
    const ent = cfg.entrada_pct ?? 50
    const restoPct = 100 - ent
    const parcelas = cfg.parcelas_apos_entrada ?? 1
    const intervalo = cfg.intervalo_dias ?? 30
    if (parcelas <= 1) {
      return {
        forma_pagamento: `${fmtPct(ent)} de entrada + ${fmtPct(restoPct)} no envio`,
        data_venda: dataVenda,
      }
    }
    const sequencia = Array.from({ length: parcelas }, (_, i) => intervalo * (i + 1)).join('/')
    return {
      forma_pagamento: `${fmtPct(ent)} de entrada + ${parcelas}x ${fmtPct(restoPct / parcelas)} (${sequencia} dias)`,
      data_venda: dataVenda,
    }
  }

  return { forma_pagamento: 'a combinar', data_venda: dataVenda }
}
