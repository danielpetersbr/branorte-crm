// Gera .docx de orçamento personalizado (do builder /orcamentos/montar).
// Constrói o documento do zero usando a lib docx — visual profissional,
// não é cópia exata do Branorte mas é editável no Word.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, HeadingLevel, ShadingType, TabStopType, TabStopPosition,
  Table, TableRow, TableCell, WidthType, VerticalAlign,
} from 'docx'

export interface CustomDocxItem {
  letra: string                 // A, B, C...
  qtd: number
  nome: string
  specs: string[]               // bullets de detalhes
  valor: number                 // valor unitário do item
  motor_cv?: number | null      // CV do motor padrão (se tiver)
  motor_polos?: number | null
  motor_qtd?: number            // qtd de motores deste item
}

export interface CustomDocxMotor {
  cv: number
  polos: number
  qtd: number
  valor_unit: number
  valor_total: number
}

export interface CustomDocxCliente {
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

export interface GerarCustomDocxOpts {
  numero: string                          // "2026 - 0691"
  dataEmissao: string                     // "11/05/2026"
  cliente: CustomDocxCliente
  voltagem: 'monofasico' | 'trifasico'
  itens: CustomDocxItem[]
  motores: CustomDocxMotor[]
  totalEquip: number
  totalMotores: number
  totalProposta: number
  formaPagamento?: string | null
  dataVenda?: string | null
  prazoEntrega?: string | null
  observacoes?: string | null
  vendedorNome?: string
}

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// Run helpers
function r(text: string, bold = false, size = 20): TextRun {
  return new TextRun({ text, bold, size, font: 'Calibri' })
}

function p(children: TextRun[], opts: { align?: typeof AlignmentType[keyof typeof AlignmentType]; spacing?: { after?: number; before?: number }; bullet?: boolean } = {}): Paragraph {
  return new Paragraph({
    children,
    alignment: opts.align,
    spacing: opts.spacing ?? { after: 0 },
    ...(opts.bullet ? { bullet: { level: 0 } } : {}),
  })
}

function paragrafoVazio(altura = 100): Paragraph {
  return new Paragraph({ children: [new TextRun('')], spacing: { after: altura } })
}

function linhaCliente(label: string, valor: string | null | undefined): Paragraph {
  return new Paragraph({
    children: [
      r(label.padEnd(12, ' '), true),
      r(valor || '—'),
    ],
    spacing: { after: 40 },
  })
}

// Borda escura pra blocos importantes
const BORDA = {
  top: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  bottom: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  left: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
  right: { style: BorderStyle.SINGLE, size: 6, color: '000000' },
}

export async function gerarOrcamentoCustomDocx(opts: GerarCustomDocxOpts): Promise<Blob> {
  const voltagemTxt = opts.voltagem === 'monofasico' ? 'MONOFÁSICO' : 'TRIFÁSICO'

  // ─── CABEÇALHO ──────────────────────────────────────────────────────
  const cabecalho: Paragraph[] = [
    new Paragraph({
      children: [new TextRun({ text: 'METALÚRGICA BBA LTDA', bold: true, size: 28, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'Av. Brasil, 1234 · São Lourenço do Sul · RS', size: 18, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 40 },
    }),
    new Paragraph({
      children: [new TextRun({ text: 'CNPJ XX.XXX.XXX/0001-XX · Fone (53) XXXX-XXXX', size: 18, font: 'Calibri' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `ORÇAMENTO Nº ${opts.numero}`, bold: true, size: 24, font: 'Calibri' }),
        new TextRun({ text: '\t\t\t\t', size: 24 }),
        new TextRun({ text: `DATA: ${opts.dataEmissao}`, bold: true, size: 24, font: 'Calibri' }),
      ],
      alignment: AlignmentType.CENTER,
      border: BORDA,
      spacing: { after: 200, before: 100 },
    }),
  ]

  // ─── DADOS DO CLIENTE ───────────────────────────────────────────────
  const dadosCliente: Paragraph[] = [
    linhaCliente('CLIENTE:', opts.cliente.nome),
    linhaCliente('A/C:', opts.cliente.ac),
    linhaCliente('FONE:', opts.cliente.fone),
    linhaCliente('CIDADE:', opts.cliente.cidade),
    linhaCliente('BAIRRO:', opts.cliente.bairro),
    linhaCliente('ENDEREÇO:', opts.cliente.endereco),
    linhaCliente('CEP:', opts.cliente.cep),
    linhaCliente('CPF/CNPJ:', opts.cliente.cnpj),
    linhaCliente('I.E.:', opts.cliente.ie),
    linhaCliente('E-MAIL:', opts.cliente.email),
    paragrafoVazio(200),
  ]

  // ─── ITENS ORÇADOS ──────────────────────────────────────────────────
  const itensSection: Paragraph[] = [
    new Paragraph({
      children: [r('ITENS ORÇADOS:', true, 24)],
      spacing: { after: 100, before: 100 },
      shading: { type: ShadingType.SOLID, color: 'F2F2F2', fill: 'F2F2F2' },
    }),
  ]

  for (const item of opts.itens) {
    // Linha do título do item (negrito, com letra-qtd-nome)
    const tituloItem = `${item.letra} - ${String(item.qtd).padStart(2, '0')} – ${item.nome}`
    itensSection.push(
      new Paragraph({
        children: [r(tituloItem, true, 22)],
        spacing: { before: 200, after: 60 },
      })
    )
    // Bullets de specs
    for (const spec of item.specs.slice(0, 12)) {
      itensSection.push(
        new Paragraph({
          children: [r(spec)],
          bullet: { level: 0 },
          spacing: { after: 20 },
        })
      )
    }
    // Linha do motor (se houver)
    if (item.motor_cv && item.motor_polos) {
      const motorTxt = `Acionamento: motor ${item.motor_cv} CV ${item.motor_polos} polos ${voltagemTxt.toLowerCase()}${(item.motor_qtd ?? 1) > 1 ? ` (qtd ${item.motor_qtd})` : ''} (não incluso)`
      itensSection.push(
        new Paragraph({
          children: [new TextRun({ text: motorTxt, italics: true, size: 18, font: 'Calibri' })],
          spacing: { after: 40 },
        })
      )
    }
    // Linha do valor (direita)
    const subtotal = item.valor * item.qtd
    itensSection.push(
      new Paragraph({
        children: [
          r('VALOR', true),
          new TextRun({ text: '\t', size: 20 }),
          r(`R$ ${formatBRL(subtotal)}`, true),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { after: 100 },
      })
    )
  }

  // ─── MOTORES NOVOS (se houver) ──────────────────────────────────────
  const motoresSection: Paragraph[] = []
  if (opts.motores.length > 0) {
    motoresSection.push(
      paragrafoVazio(200),
      new Paragraph({
        children: [r('MOTORES NOVOS:', true, 22)],
        spacing: { after: 80, before: 100 },
        shading: { type: ShadingType.SOLID, color: 'F2F2F2', fill: 'F2F2F2' },
      })
    )
    for (const motor of opts.motores) {
      motoresSection.push(
        new Paragraph({
          children: [
            r(`- ${motor.cv} CV ${motor.polos} polos ${voltagemTxt.toLowerCase()}${motor.qtd > 1 ? ` (qtd ${motor.qtd})` : ''}`),
            new TextRun({ text: '\t', size: 20 }),
            r(`R$ ${formatBRL(motor.valor_total)}`, true),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
          spacing: { after: 40 },
        })
      )
    }
    motoresSection.push(
      new Paragraph({
        children: [
          r('VALOR (motores)', true),
          new TextRun({ text: '\t', size: 20 }),
          r(`R$ ${formatBRL(opts.totalMotores)}`, true),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { after: 100, before: 80 },
      })
    )
  }

  // ─── TOTAIS ─────────────────────────────────────────────────────────
  const totaisSection: Paragraph[] = [
    paragrafoVazio(200),
    new Paragraph({
      children: [
        r('VALOR TOTAL DE EQUIPAMENTOS', true, 22),
        new TextRun({ text: '\t', size: 22 }),
        r(`R$ ${formatBRL(opts.totalEquip)}`, true, 22),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      spacing: { after: 60 },
    }),
  ]
  if (opts.totalMotores > 0) {
    totaisSection.push(
      new Paragraph({
        children: [
          r('VALOR TOTAL DE MOTORES', true, 22),
          new TextRun({ text: '\t', size: 22 }),
          r(`R$ ${formatBRL(opts.totalMotores)}`, true, 22),
        ],
        tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        spacing: { after: 60 },
      })
    )
  }
  totaisSection.push(
    new Paragraph({
      children: [
        new TextRun({ text: opts.totalMotores > 0 ? 'VALOR TOTAL DA PROPOSTA COM MOTOR NOVO' : 'VALOR TOTAL DA PROPOSTA', bold: true, size: 28, font: 'Calibri' }),
        new TextRun({ text: '\t', size: 28 }),
        new TextRun({ text: `R$ ${formatBRL(opts.totalProposta)}`, bold: true, size: 28, font: 'Calibri' }),
      ],
      tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
      border: BORDA,
      shading: { type: ShadingType.SOLID, color: 'FFF8DC', fill: 'FFF8DC' },
      spacing: { after: 200, before: 200 },
    })
  )

  // ─── CONDIÇÕES COMERCIAIS ──────────────────────────────────────────
  const condicoes: Paragraph[] = [
    paragrafoVazio(200),
    new Paragraph({
      children: [r('CONDIÇÕES COMERCIAIS:', true, 22)],
      spacing: { after: 80 },
      shading: { type: ShadingType.SOLID, color: 'F2F2F2', fill: 'F2F2F2' },
    }),
  ]
  if (opts.dataVenda) {
    condicoes.push(linhaCliente('Data da venda:', opts.dataVenda))
  }
  if (opts.formaPagamento) {
    condicoes.push(
      new Paragraph({
        children: [r('Forma de pagamento: ', true), r(opts.formaPagamento)],
        spacing: { after: 40 },
      })
    )
  }
  if (opts.prazoEntrega) {
    condicoes.push(linhaCliente('Prazo de entrega:', opts.prazoEntrega))
  }
  condicoes.push(
    linhaCliente('Frete:', 'Por conta do cliente'),
    linhaCliente('Validade:', '15 (quinze) dias corridos'),
  )

  // ─── DADOS DO FABRICANTE ───────────────────────────────────────────
  const fabricante: Paragraph[] = [
    paragrafoVazio(200),
    new Paragraph({
      children: [r('DADOS DO FABRICANTE:', true, 22)],
      spacing: { after: 80 },
      shading: { type: ShadingType.SOLID, color: 'F2F2F2', fill: 'F2F2F2' },
    }),
    linhaCliente('Razão Social:', 'METALÚRGICA BBA LTDA'),
    linhaCliente('CNPJ:', 'XX.XXX.XXX/0001-XX'),
    linhaCliente('Endereço:', 'Av. Brasil, 1234 · São Lourenço do Sul · RS'),
    linhaCliente('Fone:', '(53) XXXX-XXXX'),
  ]

  // ─── OBSERVAÇÕES ───────────────────────────────────────────────────
  const observacoes: Paragraph[] = []
  if (opts.observacoes) {
    observacoes.push(
      paragrafoVazio(200),
      new Paragraph({
        children: [r('OBSERVAÇÕES:', true, 22)],
        spacing: { after: 80 },
        shading: { type: ShadingType.SOLID, color: 'F2F2F2', fill: 'F2F2F2' },
      }),
      new Paragraph({
        children: [r(opts.observacoes)],
        spacing: { after: 100 },
      })
    )
  }

  // ─── ASSINATURAS ───────────────────────────────────────────────────
  const assinaturas: Paragraph[] = [
    paragrafoVazio(400),
    new Paragraph({
      children: [r('________________________________________')],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [r('METALÚRGICA BBA LTDA', true)],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    }),
    paragrafoVazio(400),
    new Paragraph({
      children: [r('________________________________________')],
      alignment: AlignmentType.CENTER,
      spacing: { after: 60 },
    }),
    new Paragraph({
      children: [r(opts.cliente.nome || 'Cliente', true)],
      alignment: AlignmentType.CENTER,
    }),
  ]

  // ─── MONTA DOCUMENTO ───────────────────────────────────────────────
  const doc = new Document({
    creator: opts.vendedorNome || 'Branorte CRM',
    title: `Orçamento ${opts.numero}`,
    description: `Orçamento personalizado gerado pelo CRM Branorte`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 20 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },  // 0,5 inch = 720 twip
        },
      },
      children: [
        ...cabecalho,
        ...dadosCliente,
        ...itensSection,
        ...motoresSection,
        ...totaisSection,
        ...condicoes,
        ...fabricante,
        ...observacoes,
        ...assinaturas,
      ],
    }],
  })

  return await Packer.toBlob(doc)
}
