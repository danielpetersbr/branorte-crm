// Gera .docx de orçamento personalizado (do builder /orcamentos/montar).
// Espelha visualmente o preview da tela: logo BRANORTE, fotos dos equipamentos,
// tabela de motores TIPO/NOVO, todas as seções (redes sociais, vendedores,
// contas, observações, tributos, garantia, assinaturas).

import {
  Document, Packer, Paragraph, TextRun, AlignmentType,
  BorderStyle, ShadingType, TabStopType, TabStopPosition,
  Table, TableRow, TableCell, WidthType, VerticalAlign,
  ImageRun, HeightRule, PageBreak,
} from 'docx'
import { OBS_POR_CONTA_DEFAULT } from '@/lib/orcamento-defaults'

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
  brinde?: boolean              // quando true, mostra "BRINDE" em vez do valor
  por_conta_cliente?: boolean   // quando true, mostra "por conta do cliente" em vez do valor
}

export interface CustomDocxMotor {
  cv: number
  polos: number
  qtd: number
  valor_unit: number
  valor_total: number
  item_nome?: string
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

export interface CustomDocxParcela {
  dataTipo: 'no_pedido' | 'na_nf' | 'apos_nf' | 'apos_pedido' | 'data_fixa'
  dias?: number
  dataFixa?: string
  metodo: string
  pct?: number
  valor?: number
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
  // Seção "Observação — por conta do cliente". null/ausente = default histórico.
  obsPorConta?: string[] | null
  vendedorNome?: string
  fotoPrincipal?: string | null
  componentesExtras?: Array<{ nome: string; valor: number }>
  desconto?: { tipo: 'pct' | 'valor'; valor: number; base?: 'total' | 'equipamento'; manterValorParcelas?: boolean } | null
  parcelas?: CustomDocxParcela[]
  vendedoresContato?: Array<{ nome: string; telefone: string }>
  vendedorResponsavelNome?: string | null
  tensaoMotores?: 220 | 380 | 660 | null
  freteTipo?: 'CIF' | 'FOB' | null
  freteTxt?: string | null
}

// Valor do desconto respeitando a base ('equipamento' = sem motores). Espelha a
// lógica do preview/PDF (OrcamentoPreview) pra DOCX e PDF baterem.
function calcDescontoVal(
  desconto: { tipo: 'pct' | 'valor'; valor: number; base?: 'total' | 'equipamento' } | null | undefined,
  totalProposta: number,
  totalEquip?: number,
): number {
  if (!desconto || desconto.valor <= 0) return 0
  if (desconto.tipo !== 'pct') return desconto.valor
  const base = desconto.base === 'equipamento' ? (totalEquip ?? totalProposta) : totalProposta
  return base * (desconto.valor / 100)
}

// ─── helpers ──────────────────────────────────────────────────────────────

// Letra base-26 (A..Z, AA, AB...) — evita estourar o alfabeto com 27+ itens.
function letraItem(idx: number): string {
  let s = ''
  let i = idx + 1
  while (i > 0) {
    const r = (i - 1) % 26
    s = String.fromCharCode(65 + r) + s
    i = Math.floor((i - 1) / 26)
  }
  return s || 'A'
}

function formatBRL(v: number): string {
  const abs = Math.abs(v)
  const fixed = abs.toFixed(2)
  const [intPart, dec] = fixed.split('.')
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 ? '-' : ''}${withDots},${dec}`
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

function detectImageType(url: string, mime?: string): 'png' | 'jpg' | 'gif' | 'bmp' {
  if (mime) {
    if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
    if (mime.includes('gif')) return 'gif'
    if (mime.includes('bmp')) return 'bmp'
    if (mime.includes('png')) return 'png'
  }
  const lower = url.toLowerCase().split('?')[0] // strip query params
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg'
  if (lower.endsWith('.gif')) return 'gif'
  if (lower.endsWith('.bmp')) return 'bmp'
  return 'png'
}

async function fetchImageBuffer(url: string): Promise<{ data: ArrayBuffer; type: 'png' | 'jpg' | 'gif' | 'bmp' } | null> {
  try {
    // Browser path: relative URL → tenta fetch direto
    // Node path (test-docx.mjs): URL relativa precisa virar caminho local
    const isNode = typeof process !== 'undefined' && process.versions?.node
    let data: ArrayBuffer
    if (isNode && url.startsWith('/')) {
      // No node, resolve URL relativa pra public/
      const fs = await import('fs/promises')
      const path = await import('path')
      const localPath = path.join(process.cwd(), 'public', url.slice(1))
      const buf = await fs.readFile(localPath)
      data = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    } else {
      const r = await fetch(url, { mode: 'cors' })
      if (!r.ok) return null
      data = await r.arrayBuffer()
    }
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

async function buildFotoPrincipal(url: string): Promise<(Paragraph | Table)[]> {
  const img = await fetchImageBuffer(url)
  if (!img) return []
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 40 },
      children: [
        new ImageRun({
          type: img.type as any,
          data: img.data,
          transformation: { width: 500, height: 650 },
        }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 80 },
      children: [r('Imagem ilustrativa', { italics: true, size: 14, color: '9CA3AF' })],
    }),
    new Paragraph({
      children: [new PageBreak()],
    }),
  ]
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

// Layout 1-coluna (empilhado) — espelha a prévia HTML que mostra CIDADE,
// BAIRRO, ENDEREÇO, CEP, CPF, IE, EMAIL um abaixo do outro.
function buildClienteGrid(c: CustomDocxCliente): Paragraph[] {
  const campos: [string, string | null | undefined][] = [
    ['CIDADE', c.cidade],
    ['BAIRRO', c.bairro],
    ['ENDEREÇO', c.endereco],
    ['CEP', c.cep],
    ['CPF/CNPJ', c.cnpj],
    ['I.E.', c.ie],
    ['E-MAIL', c.email],
  ]
  return campos.map(([label, valor]) => new Paragraph({
    children: [
      r(`${label}: `, { bold: true, size: 18 }),
      r(valor || '—', { size: 18, color: valor ? '000000' : '9CA3AF' }),
    ],
    spacing: { after: 40 },
  }))
}

// Bloco de UM item (FOTO LARGA centralizada EMBAIXO dos bullets, espelhando o preview)
async function buildItemTable(item: CustomDocxItem, voltagemTxt: string): Promise<Table> {
  const subtotal = item.valor * item.qtd
  const tituloLetra = `${item.letra} - ${String(item.qtd).padStart(2, '0')}`
  const tituloNome = item.nome.toUpperCase()

  // Bullets de specs (preview: text-[14.5px] = ~14pt; size em half-points = 18 = 9pt → bumpando pra 20 = 10pt)
  const bulletParas: Paragraph[] = []
  if (item.specs.length > 0) {
    for (const spec of item.specs.filter(s => !/c[oó]digo\s*finame/i.test(s)).slice(0, 20)) {
      bulletParas.push(bullet(spec, 20))
    }
  } else if (item.motor_cv && item.motor_polos) {
    bulletParas.push(bullet(
      `Acionamento: motor ${item.motor_cv} CV ${item.motor_polos} polos${(item.motor_qtd ?? 1) > 1 ? ` (qtd ${item.motor_qtd})` : ''}`,
      20,
    ))
  }
  if (bulletParas.length === 0) {
    bulletParas.push(new Paragraph({ children: [r('—', { size: 20, color: '9CA3AF' })] }))
  }

  // Linha do título do item (preview: text-[15.5px] font-bold → size 22 = 11pt bold)
  const tituloPara = new Paragraph({
    children: [
      r(tituloLetra, { bold: true, size: 22, color: '111827' }),
      r('  –  ', { bold: true, size: 22, color: '9CA3AF' }),
      r(tituloNome, { bold: true, size: 22, color: '111827' }),
    ],
    spacing: { after: 120 },
  })

  // Foto LARGA centralizada EMBAIXO (espelha preview maxWidth 540 maxHeight 280)
  // DOCX em twips: ~540px ≈ 405pt ≈ largura confortável A4 com margem.
  // ImageRun usa pixels — escalando p/ 400×210 (proporção ~1.9:1).
  // Preview tem: border: 1px solid #d1d5db + padding: 8px ao redor da img.
  // No DOCX usamos uma Table 1×1 pra envolver a imagem com border cinza fino + padding.
  const fotoBlocks: Array<Paragraph | Table> = []
  if (item.foto_url) {
    const img = await fetchImageBuffer(item.foto_url)
    if (img) {
      const imgPara = new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: img.type as any,
            data: img.data,
            transformation: { width: 400, height: 210 },
          }),
        ],
      })
      // Wrap em Table 1×1 com border cinza fino (espelha border: 1px solid #d1d5db)
      const fotoTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: {
          top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
          bottom: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
          left: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
          right: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
          insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
          insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
        },
        rows: [
          new TableRow({
            children: [new TableCell({
              margins: { top: 120, bottom: 120, left: 120, right: 120 }, // ~padding: 8px
              children: [imgPara],
            })],
          }),
        ],
      })
      fotoBlocks.push(new Paragraph({ children: [r('')], spacing: { before: 160, after: 40 } }))
      fotoBlocks.push(fotoTable)
      fotoBlocks.push(new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 40, after: 80 },
        children: [r('Imagem ilustrativa', { italics: true, size: 14, color: '9CA3AF' })],
      }))
    }
  }

  // Linha do valor (com border-top cinza, espelhando preview "border-t border-gray-300")
  // Preview: text-[15.5px] font-bold → size 22 = 11pt bold
  const valorPara = new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9600 }],
    spacing: { before: 120, after: 40 },
    border: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 4 },
    },
    children: [
      r(item.qtd > 1 ? 'VALOR TOTAL' : 'VALOR', { bold: true, size: 22, color: '374151' }),
      new TextRun({ text: '\t', size: 22 }),
      item.por_conta_cliente
        ? r('por conta do cliente', { italics: true, size: 20, color: '4B5563' })
        : item.brinde
          ? r('BRINDE', { bold: true, size: 22, color: '059669' })
          : r(`R$ ${formatBRL(subtotal)}`, { bold: true, size: 22, color: '111827' }),
    ],
  })

  // Tabela 1 coluna: título + bullets + foto + valor — tudo dentro do card com padding
  const cellChildren: Array<Paragraph | Table> = [tituloPara, ...bulletParas, ...fotoBlocks, valorPara]

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      left: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      right: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        // cantSplit: row não pode ser dividida entre páginas. Garante que o
        // card inteiro do item (header + bullets + foto + valor) fica em UMA
        // página só. Antes o B-01 quebrava no meio (header+bullets pg1,
        // foto+valor pg2).
        cantSplit: true,
        children: [
          new TableCell({
            // Sem borders aqui — herda da Table outer (gray-700 size 8).
            margins: { top: 160, bottom: 160, left: 200, right: 200 },
            children: cellChildren,
          }),
        ],
      }),
    ],
  })
}

function buildAcessorios(acc: CustomDocxAcessorios, letra: string): Table {
  const bulletParas: Paragraph[] = acc.items.length > 0
    ? acc.items.map(i => bullet(i, 20))
    : [new Paragraph({ children: [r('(nenhum item listado)', { italics: true, size: 20, color: '9CA3AF' })] })]

  const titulo = new Paragraph({
    children: [r(`${letra} — ACESSÓRIOS`, { bold: true, size: 22, color: '111827' })],
    spacing: { after: 120 },
  })

  const valorPara = new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9600 }],
    spacing: { before: 120, after: 40 },
    border: {
      top: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 4 },
    },
    children: [
      r('VALOR', { bold: true, size: 22, color: '374151' }),
      new TextRun({ text: '\t', size: 22 }),
      r(`R$ ${formatBRL(acc.valor)}`, { bold: true, size: 22, color: '111827' }),
    ],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      left: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      right: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        cantSplit: true,  // Acessórios não pode quebrar entre páginas
        children: [new TableCell({
          // Sem borders aqui — herda da Table outer
          margins: { top: 160, bottom: 160, left: 200, right: 200 },
          children: [titulo, ...bulletParas, valorPara],
        })],
      }),
    ],
  })
}

// Componentes adicionais (painel elétrico, frete, Difal, etc) — não fabricados pela
// Branorte mas que entram no total. ANTES esta função era CHAMADA (linha ~1181) mas
// NUNCA existia: o campo nunca era passado, então o if ficava falso e a tabela sumia
// do DOCX — mas o valor seguia somado no total → total não fechava. Agora existe e o
// campo é passado (ver gerarOrcamentoCustomDocx no FinalizarMontarModal).
function buildComponentesExtras(componentes: Array<{ nome: string; valor: number }>): Table {
  const total = componentes.reduce((s, c) => s + (Number(c.valor) || 0), 0)
  const titulo = new Paragraph({
    children: [r('COMPONENTES ADICIONAIS', { bold: true, size: 22, color: '111827' })],
    spacing: { after: 120 },
  })
  const linhas: Paragraph[] = componentes.map(c => new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9600 }],
    spacing: { after: 40 },
    children: [
      r(c.nome || 'Componente', { size: 20, color: '374151' }),
      new TextRun({ text: '\t', size: 20 }),
      r(`R$ ${formatBRL(Number(c.valor) || 0)}`, { size: 20, color: '111827' }),
    ],
  }))
  const totalPara = new Paragraph({
    tabStops: [{ type: TabStopType.RIGHT, position: 9600 }],
    spacing: { before: 120, after: 40 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: 'D1D5DB', space: 4 } },
    children: [
      r('TOTAL', { bold: true, size: 22, color: '374151' }),
      new TextRun({ text: '\t', size: 22 }),
      r(`R$ ${formatBRL(total)}`, { bold: true, size: 22, color: '111827' }),
    ],
  })
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      left: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      right: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        cantSplit: true,
        children: [new TableCell({
          margins: { top: 160, bottom: 160, left: 200, right: 200 },
          children: [titulo, ...linhas, totalPara],
        })],
      }),
    ],
  })
}

// Preview: caixa branca com border-2 border-gray-700 rounded-lg, px-6 py-4, font-bold uppercase
// Em DOCX usamos Table 1×1 pra ter borda completa em volta do conteúdo + padding.
function buildValorTotalEquip(total: number): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 12, color: '374151' },
      bottom: { style: BorderStyle.SINGLE, size: 12, color: '374151' },
      left: { style: BorderStyle.SINGLE, size: 12, color: '374151' },
      right: { style: BorderStyle.SINGLE, size: 12, color: '374151' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        cantSplit: true,  // VALOR TOTAL DE EQUIPAMENTOS não quebra
        children: [new TableCell({
          // Sem borders — herda da Table outer (gray-700 size 12)
          margins: { top: 240, bottom: 240, left: 320, right: 320 },
          children: [new Paragraph({
            tabStops: [{ type: TabStopType.RIGHT, position: 9200 }],
            children: [
              r('VALOR TOTAL DE EQUIPAMENTOS', { bold: true, size: 24, color: '111827' }),
              new TextRun({ text: '\t', size: 24 }),
              r(`R$ ${formatBRL(total)}`, { bold: true, size: 24, color: '111827' }),
            ],
          })],
        })],
      }),
    ],
  })
}

function buildMotores(motores: CustomDocxMotor[], voltagem: 'monofasico' | 'trifasico', total: number, tensaoMotores?: 220 | 380 | 660 | null): Table {
  const tensaoLabel = tensaoMotores ? `${tensaoMotores}V` : '(tensão a confirmar)'
  const titulo = `MOTORES ${voltagem === 'monofasico' ? 'MONOFÁSICOS' : 'TRIFÁSICOS'} ${tensaoLabel}`
  const headerRow = new TableRow({
    children: [
      new TableCell({
        borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '111827' } },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        width: { size: 70, type: WidthType.PERCENTAGE },
        children: [new Paragraph({ children: [r('TIPO', { bold: true, size: 18, color: '6B7280' })] })],
      }),
      new TableCell({
        borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '111827' } },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        width: { size: 30, type: WidthType.PERCENTAGE },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [r('NOVO', { bold: true, size: 18, color: '6B7280' })],
        })],
      }),
    ],
  })

  const motorRows = motores.map(m => new TableRow({
    children: [
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' } },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({ children: [
          r('•  ', { color: '9CA3AF', size: 20 }),
          r(`${m.cv} CV ${m.polos === 0 ? 'motorredutor' : `${m.polos} polos`}`, { size: 20, bold: true }),
          ...(m.item_nome ? [r(` · ${m.item_nome}`, { size: 20, color: '6B7280', italics: true })] : []),
          ...(m.qtd > 1 ? [r(` (×${m.qtd})`, { size: 20, color: '6B7280' })] : []),
        ] })],
      }),
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' } },
        margins: { top: 60, bottom: 60, left: 80, right: 80 },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [r(`R$ ${formatBRL(m.valor_total)}`, { size: 20 })],
        })],
      }),
    ],
  }))

  const totalRow = new TableRow({
    children: [
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 6, color: '4B5563' } },
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [new Paragraph({ children: [r('TOTAL', { bold: true, size: 22 })] })],
      }),
      new TableCell({
        borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 6, color: '4B5563' } },
        margins: { top: 80, bottom: 80, left: 80, right: 80 },
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [r(`R$ ${formatBRL(total)}`, { bold: true, size: 22 })],
        })],
      }),
    ],
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      left: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      right: { style: BorderStyle.SINGLE, size: 8, color: '374151' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [
      new TableRow({
        children: [new TableCell({
          borders: NO_BORDERS,
          columnSpan: 2,
          margins: { top: 160, bottom: 80, left: 160, right: 160 },
          children: [
            new Paragraph({
              children: [r(titulo, { bold: true, size: 22, color: '374151' })],
              border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: '111827', space: 4 } },
              spacing: { after: 120 },
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

function buildValorTotalProposta(total: number, comMotor: boolean, desconto?: { tipo: 'pct' | 'valor'; valor: number; base?: 'total' | 'equipamento' } | null, totalEquip?: number): Paragraph[] {
  const label = comMotor ? 'VALOR TOTAL DA PROPOSTA COM MOTOR NOVO' : 'VALOR TOTAL DA PROPOSTA'

  if (!desconto || desconto.valor <= 0) {
    return [new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
      spacing: { before: 240, after: 240 },
      shading: { type: ShadingType.SOLID, color: 'ECFDF5', fill: 'ECFDF5' },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: '059669' } },
      indent: { left: 200 },
      children: [
        r(label, { bold: true, size: 22, color: '111827' }),
        new TextRun({ text: '\t', size: 22 }),
        r(`R$ ${formatBRL(total)}`, { bold: true, size: 24, color: '065F46' }),
      ],
    })]
  }

  // With desconto: muted "sem desconto" box + green "com desconto" box.
  // Respeita desconto.base ('equipamento' = sem motores) — igual ao preview/PDF.
  const descontoValor = calcDescontoVal(desconto, total, totalEquip)
  const totalComDesconto = total - descontoValor
  const descontoLabel = desconto.tipo === 'pct'
    ? `Desconto de ${desconto.valor}%`
    : `Desconto de R$ ${formatBRL(desconto.valor)}`

  return [
    // Muted box: sem desconto
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
      spacing: { before: 240, after: 80 },
      shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
      border: { left: { style: BorderStyle.SINGLE, size: 16, color: 'D1D5DB' } },
      indent: { left: 200 },
      children: [
        r(`${label} (sem desconto)`, { bold: true, size: 18, color: '6B7280' }),
        new TextRun({ text: '\t', size: 18 }),
        r(`R$ ${formatBRL(total)}`, { bold: true, size: 18, color: '6B7280' }),
      ],
    }),
    // Desconto info
    new Paragraph({
      alignment: AlignmentType.RIGHT,
      spacing: { after: 80 },
      indent: { left: 200 },
      children: [r(descontoLabel, { italics: true, size: 16, color: '059669' })],
    }),
    // Green box: com desconto
    new Paragraph({
      tabStops: [{ type: TabStopType.RIGHT, position: 9000 }],
      spacing: { before: 0, after: 240 },
      shading: { type: ShadingType.SOLID, color: 'ECFDF5', fill: 'ECFDF5' },
      border: { left: { style: BorderStyle.SINGLE, size: 24, color: '059669' } },
      indent: { left: 200 },
      children: [
        r('VALOR TOTAL COM DESCONTO', { bold: true, size: 22, color: '064E3B' }),
        new TextRun({ text: '\t', size: 22 }),
        r(`R$ ${formatBRL(totalComDesconto)}`, { bold: true, size: 24, color: '065F46' }),
      ],
    }),
  ]
}

function formatParcelaData(p: CustomDocxParcela): string {
  switch (p.dataTipo) {
    case 'no_pedido': return 'NO PEDIDO'
    case 'apos_pedido': return `${p.dias ?? 0} DIAS APÓS O PEDIDO`
    case 'na_nf': return 'NA EMISSÃO DA NOTA'
    case 'apos_nf': return `${p.dias ?? 0} DIAS APÓS A NOTA`
    case 'data_fixa': return p.dataFixa ?? '—'
    default: return '—'
  }
}

function buildParcelasTable(parcelas: CustomDocxParcela[], totalProposta: number): Table {
  const headerRow = new TableRow({
    children: ['DATA', 'MÉTODO', 'VALOR (R$)'].map((label, i) => new TableCell({
      borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 6, color: '111827' } },
      width: { size: i === 0 ? 45 : i === 1 ? 25 : 30, type: WidthType.PERCENTAGE },
      shading: { type: ShadingType.SOLID, color: 'F3F4F6', fill: 'F3F4F6' },
      children: [new Paragraph({
        alignment: i === 2 ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [r(label, { bold: true, size: 16, color: '374151' })],
      })],
    })),
  })

  const dataRows = parcelas.map(p => {
    const valor = p.valor != null ? p.valor : (p.pct != null ? totalProposta * (p.pct / 100) : 0)
    return new TableRow({
      children: [
        new TableCell({
          borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' } },
          children: [new Paragraph({ children: [r(formatParcelaData(p), { size: 17 })] })],
        }),
        new TableCell({
          borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' } },
          children: [new Paragraph({ children: [r(p.metodo.toUpperCase(), { size: 17 })] })],
        }),
        new TableCell({
          borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 2, color: 'E5E7EB' } },
          children: [new Paragraph({
            alignment: AlignmentType.RIGHT,
            children: [r(`R$ ${formatBRL(valor)}`, { size: 17, bold: true })],
          })],
        }),
      ],
    })
  })

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      left: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      right: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
      insideHorizontal: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
      insideVertical: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
    },
    rows: [headerRow, ...dataRows],
  })
}

function buildTermosComerciais(
  formaPagamento: string | null | undefined,
  dataVenda: string | null | undefined,
  prazoEntrega: string | null | undefined,
  parcelas?: CustomDocxParcela[],
  totalProposta?: number,
  freteTipo?: 'CIF' | 'FOB' | null,
  freteTxt?: string | null,
): (Paragraph | Table)[] {
  // Frete: usa o texto escolhido pelo vendedor; senão deriva do tipo (CIF = Branorte
  // paga, FOB = cliente paga). Antes era hardcoded "por conta do cliente" — errado em CIF.
  const freteFinal = (freteTxt && freteTxt.trim())
    || (freteTipo === 'CIF' ? 'por conta da Branorte' : 'por conta do cliente')
  const termos: Array<[string, string]> = [
    ['Data da venda', dataVenda || 'a combinar'],
    ['Prazo de entrega', prazoEntrega || '90 dias (úteis)'],
    ...(!parcelas || parcelas.length === 0
      ? [['Forma de pagamento', formaPagamento || 'a combinar'] as [string, string]]
      : []),
    ['Frete', freteFinal],
    ['Validade da proposta', '10 dias após o envio'],
  ]
  const result: (Paragraph | Table)[] = [
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

  // If structured parcelas exist, add the table after the bullet list
  if (parcelas && parcelas.length > 0 && totalProposta != null) {
    result.push(new Paragraph({
      spacing: { before: 120, after: 60 },
      children: [r('Forma de pagamento:', { bold: true, size: 17, color: '374151' })],
    }))
    result.push(buildParcelasTable(parcelas, totalProposta))
  }

  return result
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

function buildVendedores(
  vendedoresContato?: Array<{ nome: string; telefone: string }>,
  vendedorResponsavelNome?: string | null,
): Table {
  const defaultVendedores: Array<{ nome: string; telefone: string }> = [
    { nome: 'Patrick Alves', telefone: '(48) 9 9698-4660' },
    { nome: 'Edilson', telefone: '(48) 9 9991-2329' },
    { nome: 'Daniel', telefone: '(48) 9 8469-2860' },
    { nome: 'Branorte', telefone: '(48) 3658-4502' },
  ]
  const list = vendedoresContato && vendedoresContato.length > 0 ? vendedoresContato : defaultVendedores
  const colWidth = Math.floor(100 / list.length)
  const responsavelLower = (vendedorResponsavelNome || '').toLowerCase().trim()

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
        children: list.map(v => {
          const isResponsavel = responsavelLower && v.nome.toLowerCase().trim() === responsavelLower
          return new TableCell({
            borders: {
              top: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
              bottom: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
              left: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
              right: { style: BorderStyle.SINGLE, size: 4, color: 'E5E7EB' },
            },
            width: { size: colWidth, type: WidthType.PERCENTAGE },
            shading: { type: ShadingType.SOLID, color: isResponsavel ? 'EFF6FF' : 'F9FAFB', fill: isResponsavel ? 'EFF6FF' : 'F9FAFB' },
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { before: 60, after: 30 },
                children: [r(v.nome, { bold: true, size: 17, color: isResponsavel ? '1E40AF' : '000000' })],
              }),
              new Paragraph({
                alignment: AlignmentType.CENTER,
                spacing: { after: 60 },
                children: [r(v.telefone, { size: 16, color: '4B5563' })],
              }),
            ],
          })
        }),
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

function buildObservacoesPorContaCliente(obsPorConta?: string[] | null): Paragraph[] {
  // Array salvo (editado pelo vendedor) tem prioridade; senão usa o default.
  const items = Array.isArray(obsPorConta) && obsPorConta.length > 0
    ? obsPorConta
    : OBS_POR_CONTA_DEFAULT
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

  // Demais campos do cliente — empilhados em 1 coluna (igual à prévia)
  blocos.push(...buildClienteGrid(opts.cliente))

  // Items
  blocos.push(sectionHeader('Itens orçados abaixo'))

  // Foto principal (hero shot) - before items loop
  if (opts.fotoPrincipal) {
    const fotoParts = await buildFotoPrincipal(opts.fotoPrincipal)
    blocos.push(...fotoParts)
  }

  for (const item of opts.itens) {
    blocos.push(await buildItemTable(item, opts.voltagem === 'monofasico' ? 'monofásico' : 'trifásico'))
    blocos.push(paragrafoVazio(80))
  }

  // Acessórios — letra auto-incrementada após o último item (espelha preview)
  if (opts.acessorios && opts.acessorios.valor > 0) {
    const letraAcc = letraItem(opts.itens.length)
    blocos.push(buildAcessorios(opts.acessorios, letraAcc))
    blocos.push(paragrafoVazio(80))
  }

  // Valor total de equipamentos (se 2+ itens ou se tem acessórios)
  if (opts.itens.length > 1 || (opts.acessorios && opts.acessorios.valor > 0)) {
    blocos.push(buildValorTotalEquip(opts.totalEquip))
  }

  // Motores
  if (opts.motores.length > 0) {
    blocos.push(buildMotores(opts.motores, opts.voltagem, opts.totalMotores, opts.tensaoMotores))
    blocos.push(paragrafoVazio(80))
  }

  // Componentes extras
  if (opts.componentesExtras && opts.componentesExtras.length > 0) {
    blocos.push(buildComponentesExtras(opts.componentesExtras))
    blocos.push(paragrafoVazio(80))
  }

  // Valor total proposta (destaque verde, with desconto support)
  // Base das parcelas (respeita desconto.base e manterValorParcelas — igual ao preview/PDF)
  const descontoValorCalc = calcDescontoVal(opts.desconto, opts.totalProposta, opts.totalEquip)
  const totalEfetivo = opts.desconto?.manterValorParcelas
    ? opts.totalProposta
    : (opts.totalProposta - descontoValorCalc)

  blocos.push(...buildValorTotalProposta(opts.totalProposta, opts.totalMotores > 0, opts.desconto, opts.totalEquip))

  // Termos comerciais (with parcelas support) — frete escolhido pelo vendedor
  blocos.push(...buildTermosComerciais(opts.formaPagamento, opts.dataVenda, opts.prazoEntrega, opts.parcelas, totalEfetivo, opts.freteTipo, opts.freteTxt))

  // Redes sociais
  blocos.push(sectionHeader('Nossas redes sociais'))
  blocos.push(...buildRedesSociais())

  // Dados fabricante
  blocos.push(sectionHeader('Dados do fabricante'))
  blocos.push(...buildDadosFabricante())

  // Vendedores grid removido (user pediu — poluia o rodape, igual ao preview)

  // Contas
  blocos.push(sectionHeader('Conta para depósito'))
  blocos.push(buildContasDeposito())

  // Caixa postal
  blocos.push(sectionHeader('Caixa postal'))
  blocos.push(...buildCaixaPostal())

  // Observação por conta do cliente
  blocos.push(sectionHeader('Observação — por conta do cliente'))
  blocos.push(...buildObservacoesPorContaCliente(opts.obsPorConta))

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
          // Preview não tem moldura preta na página — removida pra dar visual mais limpo.
          // Margens 0,5" (720 twips) pra maximizar largura útil do conteúdo (cards, fotos).
          margin: { top: 720, right: 720, bottom: 720, left: 720 },
        },
      },
      children: blocos,
    }],
  })

  return await Packer.toBlob(doc)
}
