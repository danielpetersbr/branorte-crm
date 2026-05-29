// Preenche o template Word de orcamento (templates/orcamento-template.docx)
// com os dados do orcamento via docxtemplater. Resultado: DOCX 100% Word-native,
// editavel, com o layout DESENHADO PELO USUARIO (nao por conversao).
//
// Pra REFINAR o layout: baixar templates/orcamento-template.docx, ajustar no
// Word como quiser, commitar de volta. Sistema usa direto.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import fs from 'fs'
import path from 'path'
import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'

export const config = {
  api: { bodyParser: { sizeLimit: '4mb' } },
  maxDuration: 30,
}

function formatBRL(v: number): string {
  return Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

interface OrcamentoData {
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
  itens: Array<{
    letra: string
    qtd: number
    nome: string
    specs: string[]
    valor: number
  }>
  motores: Array<{
    cv: number
    polos: number
    valor_total: number
    item_nome?: string
  }>
  acessorios?: { items: string[]; valor: number } | null
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  data_venda?: string | null
  prazo_entrega?: string | null
  forma_pagamento?: string | null
}

export default function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  try {
    const data = req.body as OrcamentoData
    if (!data || !data.numero) {
      return res.status(400).json({ error: 'invalid_data', detail: 'data.numero obrigatorio' })
    }

    // 1. Carrega template (versionado no repo)
    const templatePath = path.resolve(process.cwd(), 'templates', 'orcamento-template.docx')
    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({ error: 'template_missing', detail: 'orcamento-template.docx nao existe' })
    }
    const content = fs.readFileSync(templatePath)
    const zip = new PizZip(content)
    const doc = new Docxtemplater(zip, {
      paragraphLoop: true,
      linebreaks: true,
      delimiters: { start: '{', end: '}' },
    })

    // 2. Monta dados pro template
    const c = data.cliente || ({} as any)
    const tpl = {
      numero: data.numero,
      data_emissao: data.data_emissao,
      cliente_nome: c.nome || '—',
      cliente_ac: c.ac || '—',
      cliente_fone: c.fone || '—',
      cliente_cidade: c.cidade || '—',
      cliente_bairro: c.bairro || '—',
      cliente_endereco: c.endereco || '—',
      cliente_cep: c.cep || '—',
      cliente_cnpj: c.cnpj || '—',
      cliente_ie: c.ie || '—',
      cliente_email: c.email || '—',
      voltagem_label: data.voltagem === 'trifasico' ? 'Trifásicos' : 'Monofásicos',
      itens: (data.itens || []).map(it => ({
        letra: it.letra,
        qtd_pad: String(it.qtd).padStart(2, '0'),
        nome: it.nome,
        specs: (it.specs || []).map(s => ({ '.': s })),  // docxtemplater loop syntax
        valor_brl: formatBRL(it.valor),
      })),
      tem_acessorios: data.acessorios ? [{
        acessorios_items: (data.acessorios.items || []).map(s => ({ '.': s })),
        acessorios_valor_brl: formatBRL(data.acessorios.valor),
      }] : [],
      total_equipamentos_brl: formatBRL(data.total_equipamentos),
      motores: (data.motores || []).map(m => ({
        cv: m.cv,
        polos: m.polos,
        item_nome: m.item_nome || '—',
        valor_brl: formatBRL(m.valor_total),
      })),
      total_motores_brl: formatBRL(data.total_motores),
      total_proposta_brl: formatBRL(data.total_proposta),
      data_venda: data.data_venda || 'a combinar',
      prazo_entrega: data.prazo_entrega || '90 dias (úteis)',
      forma_pagamento: data.forma_pagamento || 'À vista (PIX) com 5% de desconto',
    }

    // 3. Preenche template
    doc.render(tpl)
    const buf = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    res.setHeader('Content-Disposition', `attachment; filename="orcamento-${data.numero}.docx"`)
    res.setHeader('Content-Length', String(buf.length))
    return res.status(200).send(buf)
  } catch (e) {
    const err = e as any
    // docxtemplater error tem .properties com explanation detalhada
    const detail = err?.properties?.errors
      ? JSON.stringify(err.properties.errors).slice(0, 500)
      : err?.message || String(err)
    console.error('[template-fill] error', detail)
    return res.status(500).json({ error: 'fill_failed', detail })
  }
}
