// Gera .docx de orçamento personalizado (do builder /orcamentos/montar).
// Espelha visualmente o preview da tela: logo BRANORTE, fotos dos equipamentos,
// tabela de motores TIPO/NOVO, todas as seções (redes sociais, vendedores,
// contas, observações, tributos, garantia, assinaturas).

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, ShadingType, TabStopType, TabStopPosition,
  Table, TableRow, TableCell, WidthType, VerticalAlign,
  ImageRun, HeightRule,
} from 'docx'

export interface CustomDocxItem {
  letra: string                 // A, B, C...
  qtd: number
  nome: string
  specs: string[]               // bullets de detalhes
  valor: number                 // valor unitário do item
  motor_cv?: number | null
  motor_polos?: number | null
  motor_qtd?: number
  foto_url?: string | null      // URL da foto do equipamento (opcional)
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

export interface CustomDocxAcessorios {
  pct: number
  items: string[]
  valor: number
}

export interface GerarCustomDocxOpts {
  numero: string
  dataEmissao: string
  cliente: CustomDocxCliente
  voltagem: 'monofasico' | 'trifasico'
  itens: CustomDocxItem[]
  motores: CustomDocxMotor[]
  acessorios?: CustomDocxAcessorios | null
  totalEquip: number
  totalMotores: number
  totalProposta: number
  formaPagamento?: string | null
  dataVenda?: string | null
  prazoEntrega?: string | null
  observacoes?: string | null
  vendedorNome?: string
}

// ─── helpers ──────────────────────────────────────────────────────────────

function formatBRL(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function r(text: string, opts: { bold?: boolean; size?: number; color?: string; italics?: boolean } = {}): TextRun {
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    italics: opts.italics ?? false,
    size: opts.size ?? 18,
    color: opts.color ?? '000000',
    font: 'Calibri',
  })
}

function paragrafoVazio(altura = 100): Paragraph {
  return new Paragraph({ children: [new TextRun('')], spacing: { after: altura } })
}

async function fetchImageBuffer(url: string): Promise<{ data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> {
  try {
    const r = await fetch(url, { mode: 'cors' })
    if (!r.ok) return null
    const data = await r.arrayBuffer()
    const lower = url.toLowerCase()
    let type: 'png' | 'jpg' | 'gif' | 'bmp' = 'png'
    if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) type = 'jpg'
    else if (lower.endsWith('.gif')) type = 'gif'
    else if (lower.endsWith('.bmp')) type = 'bmp'
    return { data, type }
  } catch {
    return null
  }
}

// Cell sem bordas (pra layouts em tabela usados como grid)
const NO_BORDERS = {
  top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

// Cell com border-top (linha de separação tipo "VALOR R$ X")
const BORDER_TOP_GRAY = {
  top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

// Section header: linha grossa embaixo, texto uppercase pequeno
function sectionHeader(text: string): Paragraph {
  return new Paragraph({
    children: [r(text.toUpperCase(), { bold: true, size: 18, color: '374151' })],
    spacing: { before: 240, after: 100 },
    border: {
      bottom: { style: BorderStyle.SINGLE, size: 12, color: '111827', space: 4 },
    },
  })
}

function bullet(text: string, size = 18): Paragraph {
  return new Paragraph({
    children: [r(text, { size })],
    bullet: { level: 0 },
    spacing: { after: 30 },
  })
}

// ─── seções ───────────────────────────────────────────────────────────────

async function buildLogo(): Promise<Paragraph> {
  const img = await fetchImageBuffer('/branorte-logo.png')
  if (!img) {
    // Fallback: texto
    return new Paragraph({
      children: [r('BRANORTE', { bold: true, size: 36, color: '111827' })],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
    })
  }
  return new Paragraph({
    children: [
      new ImageRun({
        type: img.type as any,
        data: img.data,
        transformation: { width: 220, height: 70 },
      }),
    ],
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
  })
}

function buildHeaderOrcamentoData(numero: string, dataEmissao: string): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [
                r('ORÇAMENTO N° ', { bold: true, size: 20 }),
                r(numero, { bold: true, size: 20, color: '6B7280' }),
              ],
            })],
          }),
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                r('DATA: ', { bold: true, size: 20 }),
                r(dataEmissao, { bold: true, size: 20, color: '6B7280' }),
              ],
            })],
          }),
        ],
      }),
    ],
  })
}

function buildClienteHeader(c: CustomDocxCliente): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 40, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [
                r('CLIENTE: ', { bold: true, size: 20 }),
                r(c.nome || '[preencher]', { bold: true, size: 20, color: c.nome ? '000000' : '9CA3AF' }),
              ],
            })],
          }),
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 30, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                r('A/C: ', { bold: true, size: 20 }),
                r(c.ac || '—', { bold: true, size: 20, color: '6B7280' }),
              ],
            })],
          }),
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 30, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                r('FONE: ', { bold: true, size: 20 }),
                r(c.fone || '—', { bold: true, size: 20, color: '6B7280' }),
              ],
            })],
          }),
        ],
      }),
    ],
  })
}

function clienteCampo(label: string, valor: string | null | undefined): Paragraph {
  return new Paragraph({
    children: [
      r(`${label}: `, { bold: true, size: 20 }),
      r(valor || '—', { bold: true, size: 20, color: '6B7280' }),
    ],
    spacing: { after: 20 },
  })
}

// Bloco de UM item (com foto à direita se houver)
async function buildItemTable(item: CustomDocxItem, voltagemTxt: string): Promise<Table> {
  const subtotal = item.valor * item.qtd
  const tituloLetra = `${item.letra} - ${String(item.qtd).padStart(2, '0')}`
  const tituloNome = item.nome.toUpperCase()

  // Bullets de specs
  const bulletParas: Paragraph[] = []
  if (item.specs.length > 0) {
    for (const spec of item.specs.slice(0, 20)) {
      bulletParas.push(bullet(spec, 17))
    }
  } else if (item.motor_cv && item.motor_polos) {
    bulletParas.push(bullet(
      `Acionamento: motor ${item.motor_cv} CV ${item.motor_polos} polos${(item.motor_qtd ?? 1) > 1 ? ` (qtd ${item.motor_qtd})` : ''}`,
      17,
    ))
  }
  if (bulletParas.length === 0) {
    bulletParas.push(new Paragraph({ children: [r('—', { size: 17, color: '9CA3AF' })] }))
  }

  // Foto (se tiver)
  let fotoCellChildren: Paragraph[] = []
  if (item.foto_url) {
    const img = await fetchImageBuffer(item.foto_url)
    if (img) {
      fotoCellChildren = [
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new ImageRun({
              type: img.type as any,
              data: img.data,
              transformation: { width: 110, height: 110 },
            }),
          ],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [r('Imagem ilustrativa', { italics: true, size: 12, color: '9CA3AF' })],
        }),
      ]
    }
  }

  // Linha do título do item
  const tituloPara = new Paragraph({
    children: [
      r(tituloLetra, { bold: true, size: 20, color: '047857' }),
      r('  –  ', { bold: true, size: 20, color: '9CA3AF' }),
      r(tituloNome, { bold: true, size: 20 }),
    ],
    spacing: { after: 80 },
  })

  // Linha do valor (com border-top)
  const valorRow = new TableRow({
    children: [
      new TableCell({
        borders: BORDER_TOP_GRAY,
        columnSpan: 2,
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
          spacing: { before: 80, after: 0 },
          children: [
            r('VALOR', { bold: true, size: 19, color: '374151' }),
            new TextRun({ text: '\t', size: 19 }),
            r(`R$ ${formatBRL(subtotal)}`, { bold: true, size: 19, color: '111827' }),
          ],
        })],
      }),
    ],
  })

  // Linha conteúdo (bullets à esquerda + foto à direita)
  const contentRow = new TableRow({
    children: [
      new TableCell({
        borders: NO_BORDERS,
        width: { size: item.foto_url ? 65 : 100, type: WidthType.PERCENTAGE },
        children: [tituloPara, ...bulletParas],
      }),
      ...(fotoCellChildren.length > 0
        ? [new TableCell({
            borders: NO_BORDERS,
            verticalAlign: VerticalAlign.TOP,
            width: { size: 35, type: WidthType.PERCENTAGE },
            children: fotoCellChildren,
          })]
        : []),
    ],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      left: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      right: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [contentRow, valorRow],
  })
}

function buildAcessorios(acc: CustomDocxAcessorios): Table {
  const bulletParas: Paragraph[] = acc.items.length > 0
    ? acc.items.map(i => bullet(i, 17))
    : [new Paragraph({ children: [r('(nenhum item listado)', { italics: true, size: 17, color: '9CA3AF' })] })]

  const titulo = new Paragraph({
    children: [r('— ACESSÓRIOS', { bold: true, size: 20, color: '047857' })],
    spacing: { after: 80 },
  })

  const valorRow = new TableRow({
    children: [
      new TableCell({
        borders: BORDER_TOP_GRAY,
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
          spacing: { before: 80 },
          children: [
            r('VALOR', { bold: true, size: 19, color: '374151' }),
            new TextRun({ text: '\t', size: 19 }),
            r(`R$ ${formatBRL(acc.valor)}`, { bold: true, size: 19, color: '111827' }),
          ],
        })],
      }),
    ],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      left: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      right: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [new TableCell({
          borders: NO_BORDERS,
          children: [titulo, ...bulletParas],
        })],
      }),
      valorRow,
    ],
  })
}

function buildValorTotalEquip(total: number): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
    spacing: { before: 200, after: 200 },
    shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
    border: {
      top: { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: '9CA3AF' },
    },
    children: [
      r('VALOR TOTAL DE EQUIPAMENTOS', { bold: true, size: 20, color: '1F2937' }),
      new TextRun({ text: '\t', size: 20 }),
      r(`R$ ${formatBRL(total)}`, { bold: true, size: 20, color: '111827' }),
    ],
  })
}

function buildMotores(motores: CustomDocxMotor[], voltagem: 'monofasico' | 'trifasico', total: number): Table {
  const titulo = `MOTORES ${voltagem === 'monofasico' ? 'MONOFÁSICOS' : 'TRIFÁSICOS'}`
  const headerRow = new TableRow({
    children: [
      new TableCell({
        borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '111827' } },
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [r('TIPO', { bold: true, size: 16, color: '6B7280' })] })],
      }),
      new TableCell({
        borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '111827' } },
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [r('NOVO', { bold: true, size: 16, color: '6B7280' })],
        })],
      }),
    ],
  })

  const motorRows = motores.map(m => new TableRow({
    children: [
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' } },
        children: [new Paragraph({ children: [
          r('•  ', { color: '9CA3AF', size: 17 }),
          r(`${m.cv} CV ${m.polos} polos${m.qtd > 1 ? ` (qtd ${m.qtd})` : ''}`, { size: 17 }),
        ] })],
      }),
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' } },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [r(`R$ ${formatBRL(m.valor_total)}`, { size: 17 })],
        })],
      }),
    ],
  }))

  const totalRow = new TableRow({
    children: [
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 6, color: '4B5563' } },
        children: [new Paragraph({ children: [r('TOTAL', { bold: true, size: 18 })] })],
      }),
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 6, color: '4B5563' } },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [r(`R$ ${formatBRL(total)}`, { bold: true, size: 18 })],
        })],
      }),
    ],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      left: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      right: { style: BorderStyle.SINGLE, size: 8, color: '9CA3AF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [new TableCell({
          borders: NO_BORDERS,
          columnSpan: 2,
          children: [
            new Paragraph({
              children: [r(titulo, { bold: true, size: 18, color: '374151' })],
              border: { bottom: { style: BorderStyle.SINGLE, size: 12, color: '111827', space: 4 } },
              spacing: { after: 80 },
            }),
          ],
        })],
      }),
      headerRow,
      ...motorRows,
      totalRow,
    ],
  })
}

function buildValorTotalProposta(total: number, comMotor: boolean): Paragraph {
  return new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
    spacing: { before: 240, after: 240 },
    shading: { type: ShadingType.SOLID, color: 'ECFDF5', fill: 'ECFDF5' },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: '059669' },
    },
    indent: { left: 200 },
    children: [
      r(comMotor ? 'VALOR TOTAL DA PROPOSTA COM MOTOR NOVO' : 'VALOR TOTAL DA PROPOSTA', {
        bold: true, size: 22, color: '111827',
      }),
      new TextRun({ text: '\t', size: 22 }),
      r(`R$ ${formatBRL(total)}`, { bold: true, size: 24, color: '065F46' }),
    ],
  })
}

function buildTermosComerciais(formaPagamento: string | null | undefined, dataVenda: string | null | undefined, prazoEntrega: string | null | undefined): Paragraph[] {
  const termos: Array<[string, string]> = [
    ['Data da venda', dataVenda || 'a combinar'],
    ['Prazo de entrega', prazoEntrega || '90 dias (úteis)'],
    ['Forma de pagamento', formaPagamento || 'a combinar'],
    ['Frete', 'por conta do cliente'],
    ['Validade da proposta', '10 dias após o envio'],
  ]
  return [
    new Paragraph({
      spacing: { before: 200, after: 200 },
      shading: { type: ShadingType.SOLID, color: 'F9FAFB', fill: 'F9FAFB' },
      border: {
        top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
        left: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
        right: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      },
      children: [r('Termos da proposta:', { bold: true, size: 17, color: '374151' })],
    }),
    ...termos.map(([k, v]) => new Paragraph({
      bullet: { level: 0 },
      spacing: { after: 30 },
      children: [
        r(`${k} – `, { size: 17 }),
        r(v, { size: 17, italics: v === 'a combinar' }),
      ],
    })),
  ]
}

function buildRedesSociais(): Paragraph[] {
  return [
    new Paragraph({
      spacing: { after: 60 },
      children: [
        r('📧 ', { size: 16 }), r('contato@mbranorte.com.br', { size: 16 }),
        r('   ·   📞 ', { size: 16 }), r('(48) 3658-4502', { size: 16 }),
        r('   ·   💬 WhatsApp ', { size: 16 }), r('(48) 98469-2860', { size: 16 }),
      ],
    }),
    new Paragraph({
      spacing: { after: 60 },
      children: [
        r('📷 Instagram ', { size: 16 }), r('@branorte_metalurgica', { size: 16 }),
        r('   ·   ▶️ YouTube ', { size: 16 }), r('@mbranorte', { size: 16 }),
        r('   ·   📘 Facebook ', { size: 16 }), r('branorte.metalurgica', { size: 16 }),
      ],
    }),
  ]
}

function buildDadosFabricante(): Paragraph[] {
  return [
    new Paragraph({ spacing: { after: 30 }, children: [
      r('Empresa: ', { bold: true, size: 17 }),
      r('BRANORTE – Metalúrgica BBA Ltda', { size: 17 }),
    ] }),
    new Paragraph({ spacing: { after: 30 }, children: [
      r('Endereço: ', { bold: true, size: 17 }),
      r('Rodovia SC 370 km 139, Nº 1390', { size: 17 }),
    ] }),
    new Paragraph({ spacing: { after: 30 }, children: [
      r('Cidade: ', { bold: true, size: 17 }), r('Grão Pará – SC   ·   ', { size: 17 }),
      r('CEP: ', { bold: true, size: 17 }), r('88890-000', { size: 17 }),
    ] }),
    new Paragraph({ spacing: { after: 30 }, children: [
      r('Telefone: ', { bold: true, size: 17 }),
      r('(48) 3658-4502 / (48) 3658-7453', { size: 17 }),
    ] }),
    new Paragraph({ spacing: { after: 30 }, children: [
      r('CNPJ: ', { bold: true, size: 17 }), r('16.935.999/0001-09   ·   ', { size: 17 }),
      r('I.E.: ', { bold: true, size: 17 }), r('256.847.320', { size: 17 }),
    ] }),
    new Paragraph({ spacing: { after: 30 }, children: [
      r('E-mail: ', { bold: true, size: 17 }),
      r('contato@mbranorte.com.br', { size: 17 }),
    ] }),
  ]
}

function buildVendedores(): Table {
  const vendedores: Array<[string, string]> = [
    ['Patrick Alves', '(48) 9 9698-4660'],
    ['Edilson', '(48) 9 9991-2329'],
    ['Daniel', '(48) 9 8469-2860'],
    ['Branorte', '(48) 3658-4502'],
  ]
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: vendedores.map(([nome, fone]) => new TableCell({
          borders: {
            top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
            bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
            left: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
            right: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
          },
          width: { size: 25, type: WidthType.PERCENTAGE },
          shading: { type: ShadingType.SOLID, color: 'F9FAFB', fill: 'F9FAFB' },
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { before: 60, after: 30 },
              children: [r(nome, { bold: true, size: 17 })],
            }),
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 60 },
              children: [r(fone, { size: 16, color: '4B5563' })],
            }),
          ],
        })),
      }),
    ],
  })
}

function buildContasDeposito(): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [
          // Banco do Brasil
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 33, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ spacing: { after: 30 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } }, children: [r('BANCO DO BRASIL', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('Agência: ', { size: 16 }), r('0738-2', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('Conta: ', { size: 16 }), r('39551-X', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('Metalúrgica BBA', { size: 16 })] }),
              new Paragraph({ children: [r('CNPJ: 16.935.999/0001-09', { size: 14, color: '6B7280' })] }),
            ],
          }),
          // Sicoob Credivale
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 33, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ spacing: { after: 30 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } }, children: [r('SICOOB CREDIVALE', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('Cooperativa: ', { size: 16 }), r('3078', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('Banco: ', { size: 16 }), r('756', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('Conta: ', { size: 16 }), r('109909-4', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('CNPJ: 16.935.999/0001-09', { size: 14, color: '6B7280' })] }),
            ],
          }),
          // PIX
          new TableCell({
            borders: NO_BORDERS,
            width: { size: 33, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ spacing: { after: 30 }, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' } }, children: [r('PIX', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('CNPJ:', { size: 14, color: '6B7280' })] }),
              new Paragraph({ children: [r('16935999000109', { bold: true, size: 16 })] }),
              new Paragraph({ children: [r('SICOOB · Metalúrgica BBA', { size: 14, color: '6B7280' })] }),
            ],
          }),
        ],
      }),
    ],
  })
}

function buildCaixaPostal(): Paragraph[] {
  return [
    new Paragraph({ spacing: { after: 30 }, children: [
      r('Caixa Postal: ', { bold: true, size: 17 }), r('Nº 149   ·   ', { size: 17 }),
      r('CEP: ', { bold: true, size: 17 }), r('88750-970', { size: 17 }),
    ] }),
    new Paragraph({ spacing: { after: 30 }, children: [
      r('Cidade: ', { bold: true, size: 17 }),
      r('Braço do Norte – SC', { size: 17 }),
    ] }),
    new Paragraph({ spacing: { after: 30 }, children: [
      r('Metalúrgica BBA · CNPJ: 16.935.999/0001-09', { size: 17 }),
    ] }),
  ]
}

function buildObservacoesPorContaCliente(): Paragraph[] {
  const items = [
    'Painel elétrico',
    'Montagem dos equipamentos orçados acima (se necessário)',
    'Muck (se necessário)',
    'Despesa com obras civil (se necessário)',
    'Instalação elétrica dos equipamentos (se necessário)',
  ]
  return items.map(t => bullet(t, 17))
}

function buildTributos(): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 100 },
      children: [r(
        'As condições desta proposta consideram os impostos e taxas vigentes, quando da elaboração da mesma sendo que quaisquer alterações sobre os tributos Municipais, Estaduais e Federais serão repassados ou de responsabilidade do cliente, incluindo pagamento ou documento de exoneração fiscal da diferença do ICMS ao Estado de destino ou custos de caminhão parado em posto fiscal da fronteira.',
        { size: 16, color: '374151' },
      )],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 100 },
      children: [r(
        'Sendo o contratante não contribuinte de ICMS, este deverá obrigatoriamente depositar para a contratada até o dia do embarque o valor correspondente ao diferencial de alíquota de ICMS referente ao objeto deste contrato, para que a CONTRATADA possa então pagar este diferencial, cujo comprovante de pagamento será enviado com a nota fiscal de vendas das mercadorias.',
        { size: 16, color: '374151' },
      )],
    }),
  ]
}

function buildClausulaCancelamento(): Paragraph {
  return new Paragraph({
    alignment: AlignmentType.JUSTIFIED,
    spacing: { after: 100 },
    children: [
      r('Caso o comprador deseje cancelar o pedido, fica estabelecido que será cobrada uma taxa de cancelamento no valor de ', { size: 16, color: '374151' }),
      r('10% do preço total do produto', { bold: true, size: 16, color: '374151' }),
      r('. Essa taxa é destinada a cobrir eventuais perdas financeiras decorrentes do cancelamento, incluindo custos de produção, armazenamento e distribuição.', { size: 16, color: '374151' }),
    ],
  })
}

function buildGarantia(): Paragraph[] {
  return [
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 100 },
      children: [
        r('Os equipamentos fornecidos pela metalúrgica BRANORTE estão garantidos pelo prazo de ', { size: 16, color: '374151' }),
        r('12 (doze) meses', { bold: true, size: 16, color: '374151' }),
        r(' contados da data de entrega dos mesmos, quanto ao funcionamento, desde que sejam armazenados, montados e operados dentro das condições para as quais foram projetados. Durante o prazo de garantia serão substituídas as peças que apresentarem defeitos, ficando as despesas de frete das peças, deslocamento, estadia e alimentação dos técnicos montadores por conta do cliente. Expirado o prazo de garantia, forneceremos assistência técnica mediante solicitação. Ficam excluídos da garantia os seguintes itens: canalizações e dispositivos de interligação.', { size: 16, color: '374151' }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 100 },
      children: [r(
        'Componentes fabricados e/ou montados por terceiros, tais como: motores elétricos, redutores, chaves elétricas, quadro de comando elétrico, correias, rolamentos (tendo somente a garantia fornecida pelos respectivos fabricantes), bem como toda e qualquer obra civil que é de responsabilidade do cliente.',
        { size: 16, color: '374151' },
      )],
    }),
  ]
}

function buildAssinaturas(nomeCliente: string): Table {
  const cell = (label: string) => new TableCell({
    borders: NO_BORDERS,
    width: { size: 50, type: WidthType.PERCENTAGE },
    children: [
      new Paragraph({ children: [r(' ')], spacing: { after: 480 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: '4B5563' } },
        spacing: { before: 60 },
        children: [r(label, { bold: true, size: 17, color: '374151' })],
      }),
    ],
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      left: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      right: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [new TableRow({ children: [cell('Metalúrgica BBA LTDA'), cell(nomeCliente || '[Cliente]')] })],
  })
}

// ─── ENTRY POINT ──────────────────────────────────────────────────────────

export async function gerarOrcamentoCustomDocx(opts: GerarCustomDocxOpts): Promise<Blob> {
  const blocos: Array<Paragraph | Table> = []

  // Cabeçalho
  blocos.push(await buildLogo())
  blocos.push(buildHeaderOrcamentoData(opts.numero, opts.dataEmissao))
  blocos.push(paragrafoVazio(60))
  blocos.push(buildClienteHeader(opts.cliente))
  blocos.push(paragrafoVazio(60))

  // Demais campos do cliente (empilhados)
  blocos.push(clienteCampo('CIDADE', opts.cliente.cidade))
  blocos.push(clienteCampo('BAIRRO', opts.cliente.bairro))
  blocos.push(clienteCampo('ENDEREÇO', opts.cliente.endereco))
  blocos.push(clienteCampo('CEP', opts.cliente.cep))
  blocos.push(clienteCampo('CPF/CNPJ', opts.cliente.cnpj))
  blocos.push(clienteCampo('I.E.', opts.cliente.ie))
  blocos.push(clienteCampo('E-MAIL', opts.cliente.email))

  // Items
  blocos.push(sectionHeader('Itens orçados abaixo'))
  for (const item of opts.itens) {
    blocos.push(await buildItemTable(item, opts.voltagem === 'monofasico' ? 'monofásico' : 'trifásico'))
    blocos.push(paragrafoVazio(80))
  }

  // Acessórios
  if (opts.acessorios && opts.acessorios.valor > 0) {
    blocos.push(buildAcessorios(opts.acessorios))
    blocos.push(paragrafoVazio(80))
  }

  // Valor total de equipamentos (se 2+ itens ou se tem acessórios)
  if (opts.itens.length > 1 || (opts.acessorios && opts.acessorios.valor > 0)) {
    blocos.push(buildValorTotalEquip(opts.totalEquip))
  }

  // Motores
  if (opts.motores.length > 0) {
    blocos.push(buildMotores(opts.motores, opts.voltagem, opts.totalMotores))
    blocos.push(paragrafoVazio(80))
  }

  // Valor total proposta (destaque verde)
  blocos.push(buildValorTotalProposta(opts.totalProposta, opts.totalMotores > 0))

  // Termos comerciais
  blocos.push(...buildTermosComerciais(opts.formaPagamento, opts.dataVenda, opts.prazoEntrega))

  // Redes sociais
  blocos.push(sectionHeader('Nossas redes sociais'))
  blocos.push(...buildRedesSociais())

  // Dados fabricante
  blocos.push(sectionHeader('Dados do fabricante'))
  blocos.push(...buildDadosFabricante())

  // Vendedores
  blocos.push(paragrafoVazio(80))
  blocos.push(buildVendedores())

  // Contas
  blocos.push(sectionHeader('Conta para depósito'))
  blocos.push(buildContasDeposito())

  // Caixa postal
  blocos.push(sectionHeader('Caixa postal'))
  blocos.push(...buildCaixaPostal())

  // Observação por conta do cliente
  blocos.push(sectionHeader('Observação — por conta do cliente'))
  blocos.push(...buildObservacoesPorContaCliente())

  // Tributos
  blocos.push(sectionHeader('Tributos'))
  blocos.push(...buildTributos())

  // Cláusula de cancelamento
  blocos.push(sectionHeader('Cláusula de cancelamento'))
  blocos.push(buildClausulaCancelamento())

  // Garantia
  blocos.push(sectionHeader('Garantia'))
  blocos.push(...buildGarantia())

  // Observações livres do vendedor (se preencheu)
  if (opts.observacoes && opts.observacoes.trim()) {
    blocos.push(sectionHeader('Observações'))
    blocos.push(new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 100 },
      children: [r(opts.observacoes, { size: 17, color: '374151' })],
    }))
  }

  // Assinaturas
  blocos.push(paragrafoVazio(400))
  blocos.push(buildAssinaturas(opts.cliente.nome))

  // ─── MONTA DOCUMENTO ────────────────────────────────────────────────
  const doc = new Document({
    creator: opts.vendedorNome || 'Branorte CRM',
    title: `Orçamento ${opts.numero}`,
    description: `Orçamento personalizado gerado pelo CRM Branorte`,
    styles: {
      default: {
        document: {
          run: { font: 'Calibri', size: 18 },
        },
      },
    },
    sections: [{
      properties: {
        page: {
          margin: { top: 720, right: 720, bottom: 720, left: 720 },  // 0,5 inch
          borders: {
            pageBorderTop: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 16 },
            pageBorderBottom: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 16 },
            pageBorderLeft: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 16 },
            pageBorderRight: { style: BorderStyle.SINGLE, size: 8, color: '000000', space: 16 },
          },
        },
      },
      children: blocos,
    }],
  })

  return await Packer.toBlob(doc)
}
