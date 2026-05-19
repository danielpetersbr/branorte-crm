// Chama /api/orcamento-template-fill que preenche template Word com docxtemplater.
// Resultado: DOCX 100% Word-native, layout DESENHADO no Word (nao convertido).
// Editavel 100%, sem perda de conversao.

export interface TemplateFillInput {
  numero: string
  data_emissao: string
  cliente: {
    nome: string
    ac?: string | null
    fone?: string | null
    cidade?: string | null
    bairro?: string | null
    endereco?: string | null
    cep?: string | null
    cnpj?: string | null
    ie?: string | null
    email?: string | null
  }
  voltagem: 'monofasico' | 'trifasico'
  itens: Array<{ letra: string; qtd: number; nome: string; specs: string[]; valor: number }>
  motores: Array<{ cv: number; polos: number; valor_total: number; item_nome?: string }>
  acessorios?: { items: string[]; valor: number } | null
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  data_venda?: string | null
  prazo_entrega?: string | null
  forma_pagamento?: string | null
}

export async function preencherTemplateOrcamento(data: TemplateFillInput): Promise<Blob> {
  const t0 = Date.now()
  const r = await fetch('/api/orcamento-template-fill', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    let detail = text.slice(0, 300)
    try { detail = JSON.parse(text).detail || detail } catch {}
    throw new Error(`template-fill HTTP ${r.status}: ${detail}`)
  }
  const blob = await r.blob()
  console.log(`[preencherTemplateOrcamento] OK ${Math.round(blob.size / 1024)}KB em ${Date.now() - t0}ms`)
  return blob
}
