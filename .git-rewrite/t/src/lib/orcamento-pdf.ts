// Gera PDF Branorte com layout idêntico ao .docx oficial.
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import type {
  OrcamentoItem, OrcamentoAcessorios, OrcamentoMotor, ClienteDados,
} from '@/hooks/useOrcamentoBuilder'

interface PdfInput {
  numero: string
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

const PAGE_W = 210
const PAGE_H = 297
const MARGIN = 18
const CONTENT_W = PAGE_W - MARGIN * 2

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function ensureSpace(doc: jsPDF, y: number, needed: number): number {
  if (y + needed > PAGE_H - 25) {
    doc.addPage()
    return MARGIN
  }
  return y
}

export function gerarOrcamentoPdf(input: PdfInput): jsPDF {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' })
  let y = MARGIN

  // ===== HEADER ===== (texto puro, sem cor de fundo — igual .docx)
  doc.setFontSize(13).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text(`ORÇAMENTO N° ${input.numero}`, MARGIN, y)
  doc.text(`DATA: ${input.data}`, PAGE_W - MARGIN, y, { align: 'right' })
  y += 8

  // ===== DADOS DO CLIENTE =====
  const c = input.cliente_dados
  doc.setFontSize(10).setFont('helvetica', 'bold')
  doc.text(`CLIENTE: ${input.cliente_nome}`, MARGIN, y)
  if (c.ac) doc.text(`A/C: ${c.ac}`, PAGE_W / 2, y)
  if (c.fone) doc.text(`FONE: ${c.fone}`, PAGE_W - MARGIN, y, { align: 'right' })
  y += 6

  doc.setFont('helvetica', 'normal')
  const linhasCliente: Array<[string, string | undefined]> = [
    ['CIDADE', c.cidade],
    ['BAIRRO', c.bairro],
    ['ENDEREÇO', c.endereco],
    ['CEP', c.cep],
    ['CPF/CNPJ', c.cnpj],
    ['I.E.', c.ie],
    ['E-MAIL', c.email],
  ]
  for (const [label, val] of linhasCliente) {
    if (val) {
      doc.text(`${label}: ${val}`, MARGIN, y)
      y += 5
    }
  }

  y += 2
  doc.setLineWidth(0.3).setDrawColor(180, 180, 180).line(MARGIN, y, PAGE_W - MARGIN, y)
  y += 6

  // ===== ITENS ORÇADOS =====
  doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('ITENS ORÇADOS ABAIXO:', MARGIN, y)
  y += 7

  for (const item of input.itens) {
    y = ensureSpace(doc, y, 30)
    // Título do item: A - 01 – NOME
    doc.setFontSize(10).setFont('helvetica', 'bold')
    const titulo = `${item.letra} - ${String(item.qtd).padStart(2, '0')} – ${item.nome}`
    const tituloLines = doc.splitTextToSize(titulo, CONTENT_W)
    doc.text(tituloLines, MARGIN, y)
    y += tituloLines.length * 5
    y += 1

    // Specs com dots
    doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(40, 40, 40)
    for (const spec of item.specs.filter(s => !/c[oó]digo\s*finame/i.test(s))) {
      y = ensureSpace(doc, y, 5)
      const wrapped = doc.splitTextToSize(`- ${spec}`, CONTENT_W - 8)
      doc.text(wrapped, MARGIN + 6, y)
      y += wrapped.length * 4.5
    }

    y += 2
    // VALOR (bold, à direita)
    y = ensureSpace(doc, y, 6)
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
    doc.text('VALOR', MARGIN + 6, y)
    doc.text(`R$ ${formatBRL(item.valor * item.qtd)}`, PAGE_W - MARGIN, y, { align: 'right' })
    y += 8
  }

  // ===== ACESSORIOS =====
  if (input.acessorios && input.acessorios.items.length > 0) {
    y = ensureSpace(doc, y, 20)
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
    doc.text('- ACESSÓRIOS', MARGIN, y)
    y += 5
    doc.setFontSize(9.5).setFont('helvetica', 'normal').setTextColor(40, 40, 40)
    for (const it of input.acessorios.items) {
      y = ensureSpace(doc, y, 5)
      doc.text(`- ${it}`, MARGIN + 6, y)
      y += 4.5
    }
    y += 1
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
    doc.text('VALOR', MARGIN + 6, y)
    doc.text(`R$ ${formatBRL(input.acessorios.valor)}`, PAGE_W - MARGIN, y, { align: 'right' })
    y += 8
  }

  // ===== TOTAL EQUIPAMENTOS =====
  y = ensureSpace(doc, y, 10)
  doc.setFillColor(245, 245, 245)
  doc.rect(MARGIN, y - 4, CONTENT_W, 7, 'F')
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('VALOR TOTAL DE EQUIPAMENTOS', MARGIN + 2, y + 1)
  doc.text(`R$ ${formatBRL(input.total_equipamentos)}`, PAGE_W - MARGIN - 2, y + 1, { align: 'right' })
  y += 10

  // ===== MOTORES =====
  if (input.motores.length > 0) {
    y = ensureSpace(doc, y, 30)
    const motorTitle = input.voltagem === 'trifasico' ? 'Motores Trifásicos:' : 'Motores Monofásicos:'
    doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
    doc.text(motorTitle, MARGIN, y)
    y += 6

    autoTable(doc, {
      startY: y,
      head: [['TIPO', 'NOVO']],
      body: input.motores.map(m => [
        `${m.cv} CV ${m.polos === 0 ? 'motorredutor' : `${m.polos} polos`}`,
        `R$ ${formatBRL(m.valor)}`,
      ]),
      foot: [['TOTAL', `R$ ${formatBRL(input.total_motores)}`]],
      theme: 'plain',
      headStyles: { fontStyle: 'bold', fontSize: 9.5, textColor: 0, lineWidth: 0.2, lineColor: [180, 180, 180] },
      bodyStyles: { fontSize: 9.5, textColor: 40, lineWidth: 0.1, lineColor: [220, 220, 220] },
      footStyles: { fontStyle: 'bold', fontSize: 9.5, textColor: 0, lineWidth: 0.3, lineColor: [180, 180, 180] },
      margin: { left: MARGIN, right: MARGIN },
      columnStyles: { 1: { halign: 'right' } },
    })
    y = (doc as any).lastAutoTable.finalY + 6
  }

  // ===== TOTAL PROPOSTA =====
  y = ensureSpace(doc, y, 12)
  doc.setFillColor(232, 245, 233)
  doc.setDrawColor(16, 185, 129)
  doc.setLineWidth(0.4)
  doc.rect(MARGIN, y - 4, CONTENT_W, 9, 'FD')
  doc.setFontSize(11).setFont('helvetica', 'bold').setTextColor(0, 100, 0)
  doc.text('VALOR TOTAL DA PROPOSTA COM MOTOR NOVO', MARGIN + 2, y + 2)
  doc.text(`R$ ${formatBRL(input.total_proposta)}`, PAGE_W - MARGIN - 2, y + 2, { align: 'right' })
  y += 14
  doc.setTextColor(0, 0, 0)

  // ===== TERMOS =====
  y = ensureSpace(doc, y, 30)
  doc.setFontSize(9.5).setFont('helvetica', 'normal')
  const termos = [
    'Data da venda – a combinar',
    'Prazo de entrega – 90 dias (úteis)',
    'Forma de pagamento – a combinar',
    'Frete – por conta do cliente',
    'Validade da proposta – 10 dias após o envio.',
  ]
  for (const t of termos) {
    doc.text(`- ${t}`, MARGIN, y)
    y += 5
  }
  y += 4

  // ===== DADOS DO FABRICANTE =====
  y = ensureSpace(doc, y, 60)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('DADOS DO FABRICANTE', MARGIN, y)
  y += 6
  doc.setFontSize(9).setFont('helvetica', 'normal')
  const fabricante = [
    'Empresa: BRANORTE - Metalúrgica BBA Ltda',
    'Endereço: Rodovia SC 370 km 139. N° 1390. Cidade: Grão Pará - SC',
    'CEP: 88890000',
    'Telefone: (48) 3658-4502 / (48) 3658-7453',
    'CNPJ: 16.935.999/0001-09',
    'Inscrição Estadual: 256847320',
    'E-mail: patrick@mbranorte.com.br',
  ]
  for (const l of fabricante) {
    doc.text(l, MARGIN, y); y += 4.5
  }
  y += 4

  // ===== ATENDIMENTO (vendedores) =====
  y = ensureSpace(doc, y, 25)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('ATENDIMENTO', MARGIN, y)
  y += 6
  doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(40, 40, 40)
  const colW = CONTENT_W / 4
  const vendedores = [
    { nome: 'Patrick Alves', tel: '(48) 9 9698-4660' },
    { nome: 'Edilson',       tel: '(48) 9 9991-2329' },
    { nome: 'Daniel',        tel: '(48) 9 8469-2860' },
    { nome: 'Branorte',      tel: '(48) 3658-4502' },
  ]
  vendedores.forEach((v, i) => {
    const x = MARGIN + colW * i + colW / 2
    doc.setFont('helvetica', 'bold')
    doc.text(v.nome, x, y, { align: 'center' })
    doc.setFont('helvetica', 'normal')
    doc.text(v.tel, x, y + 4, { align: 'center' })
  })
  y += 12

  // ===== CONTA PARA DEPOSITO =====
  y = ensureSpace(doc, y, 50)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('CONTA PARA DEPÓSITO:', MARGIN, y)
  y += 6
  doc.setFontSize(9).setFont('helvetica', 'normal')
  // Três colunas: BB | Sicoob | PIX
  const col1 = MARGIN
  const col2 = MARGIN + CONTENT_W / 3
  const col3 = MARGIN + (CONTENT_W * 2) / 3
  const yStart = y
  doc.setFont('helvetica', 'bold').text('BANCO DO BRASIL', col1, y)
  doc.setFont('helvetica', 'bold').text('SICOOB CREDIVALE', col2, y)
  doc.setFont('helvetica', 'bold').text('PIX', col3, y)
  y += 5
  doc.setFont('helvetica', 'normal')
  const linhas = [
    ['Agência 0738 - 2',                    'Cooperativa 3078',                                'CNPJ: 16935999000109'],
    ['Conta 39551 - X',                     'Banco 756',                                       'SICOOB Metalúrgica BBA'],
    ['CNPJ: 16.935.999/0001-09',            'Conta 109909-4',                                  ''],
    ['',                                    'CNPJ: 16.935.999/0001-09',                        ''],
  ]
  for (const [a, b, c] of linhas) {
    doc.text(a, col1, y)
    doc.text(b, col2, y)
    doc.text(c, col3, y)
    y += 4.5
  }
  y += 4

  // ===== CAIXA POSTAL =====
  y = ensureSpace(doc, y, 18)
  doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('CAIXA POSTAL: N° 149', MARGIN, y); y += 4.5
  doc.setFont('helvetica', 'normal')
  doc.text('CEP: 88750-970', MARGIN, y); y += 4.5
  doc.text('Cidade: Braço do Norte - SC', MARGIN, y); y += 4.5
  doc.text('Metalúrgica BBA — CNPJ: 16.935.999/0001-09', MARGIN, y); y += 6

  // ===== OBSERVAÇÃO =====
  y = ensureSpace(doc, y, 22)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('OBSERVAÇÃO: por conta do cliente', MARGIN, y); y += 5
  doc.setFontSize(9).setFont('helvetica', 'normal')
  const obsItens = [
    'Painel elétrico',
    'Montagem dos equipamentos orçados acima (se necessário)',
    'Muck (se necessário)',
    'Despesa com obras civil (se necessário)',
    'Instalação elétrica dos equipamentos (se necessário)',
  ]
  for (const o of obsItens) {
    doc.text(`- ${o}`, MARGIN, y); y += 4.5
  }
  if (input.observacoes) {
    y += 2
    const obsLines = doc.splitTextToSize(input.observacoes, CONTENT_W)
    doc.text(obsLines, MARGIN, y)
    y += obsLines.length * 4.5
  }
  y += 4

  // ===== TRIBUTOS =====
  y = ensureSpace(doc, y, 35)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('TRIBUTOS', MARGIN, y); y += 5
  doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(40, 40, 40)
  const tributos = [
    'As condições desta proposta consideram os impostos e taxas vigentes, quando da elaboração da mesma sendo que quaisquer alterações sobre os tributos Municipais, Estadual e Federais serão repassados ou de responsabilidade do cliente, incluindo pagamento ou documento de exoneração fiscal da diferença do ICMS ao Estado de destino ou custos de caminhão parado em posto fiscal da fronteira.',
    'Sendo o contrate não contribuinte de ICMS Este deverá obrigatoriamente depositar para a contratada até o dia do embarque, o valor correspondente ao diferencial de alíquota de ICMS referente ao objeto desde contrato, para que a CONTRATADA possa então pagar este diferencial, cujo o comprovante de pagamento será enviado com a nota fiscal de vendas das mercadorias.',
  ]
  for (const t of tributos) {
    y = ensureSpace(doc, y, 14)
    const lines = doc.splitTextToSize(t, CONTENT_W)
    doc.text(lines, MARGIN, y, { align: 'justify', maxWidth: CONTENT_W })
    y += lines.length * 4
    y += 2
  }
  y += 2

  // ===== CLAUSULA DE CANCELAMENTO =====
  y = ensureSpace(doc, y, 18)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('CLÁUSULA DE CANCELAMENTO', MARGIN, y); y += 5
  doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(40, 40, 40)
  const cancel = 'Caso o comprador deseje cancelar o pedido, fica estabelecido que será cobrada uma taxa de cancelamento no valor de 10% do preço total do produto. Essa taxa é destinada a cobrir eventuais perdas financeiras decorrentes do cancelamento, incluindo custos de produção, armazenamento e distribuição.'
  const cancelLines = doc.splitTextToSize(cancel, CONTENT_W)
  doc.text(cancelLines, MARGIN, y, { align: 'justify', maxWidth: CONTENT_W })
  y += cancelLines.length * 4 + 4

  // ===== GARANTIA =====
  y = ensureSpace(doc, y, 30)
  doc.setFontSize(10).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('GARANTIA', MARGIN, y); y += 5
  doc.setFontSize(8.5).setFont('helvetica', 'normal').setTextColor(40, 40, 40)
  const garantia = [
    'Os equipamentos fornecidos pela metalúrgica BRANORTE estão garantidos pelo prazo de 12 (doze) meses contados da data de entrega dos mesmos, quanto ao funcionamento, desde que sejam armazenados, montados e operados dentro das condições para as quais foram projetados. Durante o prazo de garantia serão substituídas as peças que apresentarem defeitos, ficando as despesas de frete das peças, deslocamento, estadia e alimentação dos técnicos montadores por conta do cliente. Expirado o prazo de garantia, forneceremos assistência técnica mediante solicitação. Ficam excluídos da garantia, os seguintes itens: Canalizações e dispositivos de interligação.',
    'Componentes fabricados e/ou montados por terceiros, tais como: motores elétricos, redutores, chaves elétricas, quadro de comando elétrico, correias, rolamentos (tendo somente a garantia fornecida pelos respectivos fabricantes) bem como toda e qualquer obra civil que é de responsabilidade do cliente.',
  ]
  for (const g of garantia) {
    y = ensureSpace(doc, y, 18)
    const lines = doc.splitTextToSize(g, CONTENT_W)
    doc.text(lines, MARGIN, y, { align: 'justify', maxWidth: CONTENT_W })
    y += lines.length * 4
    y += 2
  }
  y += 6

  // ===== ASSINATURAS =====
  y = ensureSpace(doc, y, 25)
  const sigW = (CONTENT_W - 6) / 2
  const sigY = y + 12
  doc.setLineWidth(0.3).setDrawColor(0, 0, 0)
  doc.line(MARGIN, sigY, MARGIN + sigW, sigY)
  doc.line(MARGIN + sigW + 6, sigY, MARGIN + CONTENT_W, sigY)
  doc.setFontSize(9).setFont('helvetica', 'bold').setTextColor(0, 0, 0)
  doc.text('Metalúrgica BBA LTDA', MARGIN + sigW / 2, sigY + 5, { align: 'center' })
  const nomeCliente = (input.cliente_nome || 'Cliente').slice(0, 50)
  doc.text(nomeCliente, MARGIN + sigW + 6 + sigW / 2, sigY + 5, { align: 'center' })

  // ===== Footer em todas as paginas =====
  const totalPages = (doc as any).internal.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFontSize(7).setFont('helvetica', 'normal').setTextColor(120, 120, 120)
    doc.text(`Orçamento ${input.numero} · Branorte BBA`, MARGIN, PAGE_H - 8)
    doc.text(`Página ${p} de ${totalPages}`, PAGE_W - MARGIN, PAGE_H - 8, { align: 'right' })
  }

  return doc
}

export function baixarOrcamentoPdf(input: PdfInput) {
  const doc = gerarOrcamentoPdf(input)
  const safeNome = input.cliente_nome.replace(/[^a-zA-Z0-9 ]/g, '').slice(0, 50).trim()
  const filename = `${input.numero} - ${safeNome || 'orcamento'}.pdf`
  doc.save(filename)
}
