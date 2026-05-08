// Gera PDF de orçamento Branorte com layout idêntico ao .docx atual.
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type {
  OrcamentoItem, OrcamentoAcessorios, OrcamentoMotor, ClienteDados,
} from '@/hooks/useOrcamentoBuilder'

interface PdfInput {
  numero: string                 // 2026 - 0691
  data: string                   // dd/mm/yyyy
  cliente_nome: string
  cliente_dados: ClienteDados
  voltagem: 'monofasico' | 'trifasico'
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  observacoes?: string | null
}

const BRAND = '#10b981'
const PAGE_W = 210
const MARGIN = 15
const CONTENT_W = PAGE_W - MARGIN * 2

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

export function gerarOrcamentoPdf(input: PdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = MARGIN

  // ===== HEADER =====
  doc.setFillColor(16, 185, 129)
  doc.rect(0, 0, PAGE_W, 18, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(14).setFont('helvetica', 'bold')
  doc.text('BRANORTE', MARGIN, 11)
  doc.setFontSize(8).setFont('helvetica', 'normal')
  doc.text('Metalúrgica BBA Ltda', MARGIN, 16)
  doc.setFontSize(11).setFont('helvetica', 'bold')
  doc.text(`ORÇAMENTO N° ${input.numero}`, PAGE_W - MARGIN, 11, { align: 'right' })
  doc.setFontSize(9).setFont('helvetica', 'normal')
  doc.text(`DATA: ${input.data}`, PAGE_W - MARGIN, 16, { align: 'right' })
  doc.setTextColor(0, 0, 0)
  y = 24

  // ===== DADOS DO CLIENTE =====
  const c = input.cliente_dados
  const linha = (label: string, valor: string | undefined): string => `${label}: ${valor || '_'.repeat(30)}`

  doc.setFontSize(9).setFont('helvetica', 'bold')
  doc.text(`CLIENTE: ${input.cliente_nome || '_'.repeat(40)}`, MARGIN, y)
  doc.setFont('helvetica', 'normal')
  if (c.ac) doc.text(`A/C: ${c.ac}`, PAGE_W - MARGIN, y, { align: 'right' })
  y += 5
  if (c.fone) { doc.text(`FONE: ${c.fone}`, MARGIN, y); y += 5 }
  if (c.cidade) { doc.text(`CIDADE: ${c.cidade}`, MARGIN, y); y += 5 }
  if (c.bairro) { doc.text(`BAIRRO: ${c.bairro}`, MARGIN, y); y += 5 }
  if (c.endereco) { doc.text(`ENDEREÇO: ${c.endereco}`, MARGIN, y); y += 5 }
  if (c.cep) { doc.text(`CEP: ${c.cep}`, MARGIN, y); y += 5 }
  if (c.cnpj) { doc.text(`CPF/CNPJ: ${c.cnpj}`, MARGIN, y); y += 5 }
  if (c.ie) { doc.text(`I.E.: ${c.ie}`, MARGIN, y); y += 5 }
  if (c.email) { doc.text(`E-MAIL: ${c.email}`, MARGIN, y); y += 5 }

  y += 3
  doc.setDrawColor(200, 200, 200).line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 5

  // ===== ITENS ORÇADOS =====
  doc.setFontSize(11).setFont('helvetica', 'bold')
  doc.text('ITENS ORÇADOS:', MARGIN, y)
  y += 6

  for (const item of input.itens) {
    if (y > 250) { doc.addPage(); y = MARGIN }
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(16, 185, 129)
    doc.text(`${item.letra} - ${String(item.qtd).padStart(2, '0')} - ${item.nome}`, MARGIN, y)
    y += 5
    doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(60, 60, 60)
    for (const spec of item.specs) {
      if (y > 270) { doc.addPage(); y = MARGIN }
      const wrapped = doc.splitTextToSize(`• ${spec}`, CONTENT_W - 5)
      doc.text(wrapped, MARGIN + 3, y)
      y += wrapped.length * 4
    }
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
    doc.text(`VALOR: ${formatBRL(item.valor)}`, PAGE_W - MARGIN, y, { align: 'right' })
    y += 6
    doc.setDrawColor(220, 220, 220).line(MARGIN, y, PAGE_W - MARGIN, y)
    y += 4
  }

  // ===== ACESSORIOS =====
  if (input.acessorios && input.acessorios.items.length > 0) {
    if (y > 240) { doc.addPage(); y = MARGIN }
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(16, 185, 129)
    doc.text('ACESSÓRIOS', MARGIN, y)
    y += 5
    doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(60, 60, 60)
    for (const it of input.acessorios.items) {
      if (y > 270) { doc.addPage(); y = MARGIN }
      doc.text(`• ${it}`, MARGIN + 3, y)
      y += 4
    }
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
    doc.text(`VALOR: ${formatBRL(input.acessorios.valor)}`, PAGE_W - MARGIN, y, { align: 'right' })
    y += 6
  }

  // ===== TOTAL EQUIPAMENTOS =====
  if (y > 250) { doc.addPage(); y = MARGIN }
  doc.setFillColor(243, 244, 246)
  doc.rect(MARGIN, y - 3, CONTENT_W, 7, 'F')
  doc.setFontSize(10).setFont('helvetica', 'bold')
  doc.text('VALOR TOTAL DE EQUIPAMENTOS:', MARGIN + 2, y + 2)
  doc.text(formatBRL(input.total_equipamentos), PAGE_W - MARGIN - 2, y + 2, { align: 'right' })
  y += 10

  // ===== MOTORES =====
  if (input.motores.length > 0) {
    if (y > 240) { doc.addPage(); y = MARGIN }
    const motorTitle = input.voltagem === 'trifasico' ? 'Motores Trifásicos:' : 'Motores Monofásicos:'
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(16, 185, 129)
    doc.text(motorTitle, MARGIN, y)
    y += 6
    autoTable(doc, {
      startY: y,
      head: [['TIPO', 'NOVO']],
      body: input.motores.map(m => [
        `${m.cv} CV ${m.polos} polos`,
        formatBRL(m.valor),
      ]),
      foot: [['TOTAL', formatBRL(input.total_motores)]],
      theme: 'grid',
      headStyles: { fillColor: [16, 185, 129], textColor: 255, fontSize: 9 },
      bodyStyles: { fontSize: 9 },
      footStyles: { fillColor: [243, 244, 246], textColor: 0, fontSize: 9, fontStyle: 'bold' },
      margin: { left: MARGIN, right: MARGIN },
      columnStyles: { 1: { halign: 'right' } },
    })
    y = (doc as any).lastAutoTable.finalY + 6
  }

  // ===== TOTAL PROPOSTA =====
  if (y > 255) { doc.addPage(); y = MARGIN }
  doc.setFillColor(16, 185, 129)
  doc.rect(MARGIN, y - 3, CONTENT_W, 9, 'F')
  doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(255, 255, 255)
  doc.text('VALOR TOTAL DA PROPOSTA COM MOTOR NOVO:', MARGIN + 2, y + 3)
  doc.text(formatBRL(input.total_proposta), PAGE_W - MARGIN - 2, y + 3, { align: 'right' })
  y += 14
  doc.setTextColor(0, 0, 0)

  // ===== TERMOS =====
  if (y > 230) { doc.addPage(); y = MARGIN }
  doc.setFontSize(9).setFont('helvetica', 'normal')
  const termos = [
    'Data da venda — a combinar',
    'Prazo de entrega — 90 dias úteis',
    'Forma de pagamento — a combinar',
    'Frete — por conta do cliente',
    'Validade da proposta — 10 dias após o envio',
  ]
  for (const t of termos) {
    doc.text(`• ${t}`, MARGIN, y)
    y += 5
  }

  if (input.observacoes) {
    y += 3
    doc.setFont('helvetica', 'bold').text('OBSERVAÇÕES:', MARGIN, y); y += 5
    doc.setFont('helvetica', 'normal')
    const obsLines = doc.splitTextToSize(input.observacoes, CONTENT_W)
    doc.text(obsLines, MARGIN, y)
    y += obsLines.length * 4 + 4
  }

  // ===== FOOTER FIXO (em todas as páginas) =====
  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(120, 120, 120)
    const footer = 'Branorte — Metalúrgica BBA Ltda · Rod. SC 370 km 139, n° 1390 · Grão Pará/SC · CNPJ 16.935.999/0001-09 · (48) 3658-4502'
    doc.text(footer, PAGE_W / 2, 290, { align: 'center' })
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, 290, { align: 'right' })
  }

  return doc
}

export function baixarOrcamentoPdf(input: PdfInput) {
  const doc = gerarOrcamentoPdf(input)
  const safeNome = input.cliente_nome.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 50).trim()
  const filename = `${input.numero} - ${safeNome || 'orcamento'}.pdf`
  doc.save(filename)
}
