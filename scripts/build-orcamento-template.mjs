// Gera o template inicial do orcamento (orcamento-template.docx) usando a
// lib `docx`. Esse template tem PLACEHOLDERS no formato {cliente_nome},
// {#itens}{nome}{/itens}, etc — sera preenchido em runtime via docxtemplater.
//
// Como usar: node scripts/build-orcamento-template.mjs
// Output: templates/orcamento-template.docx
//
// Pra REFINAR o layout: abra o output no Word, ajuste como quiser,
// salve como templates/orcamento-template.docx (sobrescrevendo).
// O sistema usa esse arquivo direto.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, BorderStyle,
  Table, TableRow, TableCell, WidthType, VerticalAlign, ImageRun, HeightRule,
  PageOrientation, convertMillimetersToTwip,
} from 'docx'
import fs from 'fs'
import path from 'path'

// Cell sem bordas (pra layouts em tabela usados como grid)
const NO_BORDERS = {
  top:    { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  bottom: { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  left:   { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
  right:  { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' },
}

const BORDER_TOP_GRAY = {
  ...NO_BORDERS,
  top: { style: BorderStyle.SINGLE, size: 4, color: 'D1D5DB' },
}

// Helper: TextRun com defaults uniformes
function r(text, opts = {}) {
  return new TextRun({
    text,
    bold: opts.bold ?? false,
    italics: opts.italics ?? false,
    size: opts.size ?? 20,         // half-points → 10pt
    color: opts.color ?? '1F2937',
    font: 'Calibri',
  })
}

function paraVazio(after = 100) {
  return new Paragraph({ children: [new TextRun('')], spacing: { after } })
}

function sectionHeader(text) {
  return new Paragraph({
    children: [r(text.toUpperCase(), { bold: true, size: 20, color: '374151' })],
    spacing: { before: 280, after: 120 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 16, color: '111827', space: 4 } },
  })
}

// ─── Top: Logo (placeholder ImageRun via {%logo}) ─────────────────────────
// Em runtime, docxtemplater-image-module substitui o {%logo} pela imagem.
// Por enquanto: placeholder de texto.
function buildHeader() {
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [r('BRANORTE', { bold: true, size: 36, color: '111827' })],
      spacing: { after: 200 },
    }),
    // Numero + Data em 2 colunas (tabela invisivel)
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...NO_BORDERS, insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top },
      rows: [
        new TableRow({
          children: [
            new TableCell({
              borders: NO_BORDERS,
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({
                children: [
                  r('ORÇAMENTO N° ', { bold: true, size: 22 }),
                  r('{numero}', { bold: true, size: 22, color: '6B7280' }),
                ],
              })],
            }),
            new TableCell({
              borders: NO_BORDERS,
              width: { size: 50, type: WidthType.PERCENTAGE },
              children: [new Paragraph({
                alignment: AlignmentType.RIGHT,
                children: [
                  r('DATA: ', { bold: true, size: 22 }),
                  r('{data_emissao}', { bold: true, size: 22, color: '6B7280' }),
                ],
              })],
            }),
          ],
        }),
      ],
    }),
  ]
}

// ─── Cliente ──────────────────────────────────────────────────────────────
function buildCliente() {
  // 3 colunas linha 1: CLIENTE / A/C / FONE
  const linha1 = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: NO_BORDERS,
    rows: [
      new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDERS, width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [r('CLIENTE: ', { bold: true, size: 22 }), r('{cliente_nome}', { size: 22 })],
            })],
          }),
          new TableCell({
            borders: NO_BORDERS, width: { size: 25, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [r('A/C: ', { bold: true, size: 22 }), r('{cliente_ac}', { size: 22, color: '6B7280' })],
            })],
          }),
          new TableCell({
            borders: NO_BORDERS, width: { size: 25, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              children: [r('FONE: ', { bold: true, size: 22 }), r('{cliente_fone}', { size: 22, color: '6B7280' })],
            })],
          }),
        ],
      }),
    ],
  })
  // Campos empilhados: CIDADE, BAIRRO, ENDEREÇO, CEP, CPF/CNPJ, I.E., E-MAIL
  const camposEmpilhados = [
    ['CIDADE', 'cliente_cidade'],
    ['BAIRRO', 'cliente_bairro'],
    ['ENDEREÇO', 'cliente_endereco'],
    ['CEP', 'cliente_cep'],
    ['CPF/CNPJ', 'cliente_cnpj'],
    ['I.E.', 'cliente_ie'],
    ['E-MAIL', 'cliente_email'],
  ].map(([label, key]) => new Paragraph({
    spacing: { after: 40 },
    children: [r(`${label}: `, { bold: true, size: 22 }), r(`{${key}}`, { size: 22, color: '6B7280' })],
  }))
  return [linha1, paraVazio(60), ...camposEmpilhados]
}

// ─── Itens (loop com docxtemplater) ───────────────────────────────────────
function buildItens() {
  return [
    sectionHeader('Itens orçados abaixo'),
    // Aqui depois eh injetada a foto principal {%foto_principal} via image module
    // Por enquanto: placeholder de texto
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [r('[FOTO PRINCIPAL]', { italics: true, size: 18, color: '9CA3AF' })],
      spacing: { after: 200 },
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
                bottom: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
                left: { style: BorderStyle.SINGLE, size: 4, color: '374151' },
                right: { style: BorderStyle.SINGLE, size: 4, color: '374151' } },
    }),
    // Loop de itens (docxtemplater syntax)
    new Paragraph({
      spacing: { after: 60 },
      children: [r('{#itens}', { color: 'FFFFFF', size: 2 })],
    }),
    new Paragraph({
      spacing: { before: 120, after: 60 },
      children: [
        r('{letra} - {qtd_pad}  —  ', { bold: true, size: 22, color: '111827' }),
        r('{nome}', { bold: true, size: 22, color: '111827' }),
      ],
    }),
    // Specs em bullets (loop interno)
    new Paragraph({
      spacing: { after: 30 },
      children: [r('{#specs}{.}', { size: 20, color: '374151' }), r('{/specs}', { color: 'FFFFFF', size: 2 })],
      bullet: { level: 0 },
    }),
    // Valor
    new Paragraph({
      spacing: { before: 80, after: 120 },
      alignment: AlignmentType.RIGHT,
      border: BORDER_TOP_GRAY,
      children: [
        r('VALOR  ', { bold: true, size: 20, color: '6B7280' }),
        r('R$ {valor_brl}', { bold: true, size: 22, color: '111827' }),
      ],
    }),
    new Paragraph({
      children: [r('{/itens}', { color: 'FFFFFF', size: 2 })],
    }),
  ]
}

// ─── Acessórios (opcional) ────────────────────────────────────────────────
function buildAcessorios() {
  return [
    new Paragraph({
      children: [r('{#tem_acessorios}', { color: 'FFFFFF', size: 2 })],
    }),
    new Paragraph({
      spacing: { before: 200, after: 80 },
      children: [r('— ACESSÓRIOS', { bold: true, size: 22, color: '047857' })],
    }),
    new Paragraph({
      children: [r('{#acessorios_items}{.}', { size: 20, color: '374151' }), r('{/acessorios_items}', { color: 'FFFFFF', size: 2 })],
      bullet: { level: 0 },
      spacing: { after: 30 },
    }),
    new Paragraph({
      spacing: { before: 60, after: 100 },
      alignment: AlignmentType.RIGHT,
      border: BORDER_TOP_GRAY,
      children: [
        r('VALOR  ', { bold: true, size: 20, color: '6B7280' }),
        r('R$ {acessorios_valor_brl}', { bold: true, size: 22, color: '111827' }),
      ],
    }),
    new Paragraph({
      children: [r('{/tem_acessorios}', { color: 'FFFFFF', size: 2 })],
    }),
  ]
}

// ─── Total equipamentos ───────────────────────────────────────────────────
function buildTotalEquipamentos() {
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 12, color: '374151' },
        bottom: { style: BorderStyle.SINGLE, size: 12, color: '374151' },
        left: NO_BORDERS.left, right: NO_BORDERS.right,
        insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top,
      },
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDERS, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              spacing: { before: 80, after: 80 },
              children: [r('VALOR TOTAL DE EQUIPAMENTOS', { bold: true, size: 22, color: '111827' })],
            })],
          }),
          new TableCell({
            borders: NO_BORDERS, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 80, after: 80 },
              children: [r('R$ {total_equipamentos_brl}', { bold: true, size: 22, color: '111827' })],
            })],
          }),
        ],
      })],
    }),
  ]
}

// ─── Motores ──────────────────────────────────────────────────────────────
function buildMotores() {
  return [
    sectionHeader('Motores {voltagem_label}'),
    // Header da tabela: TIPO | NOVO
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...NO_BORDERS, bottom: { style: BorderStyle.SINGLE, size: 8, color: '111827' } },
      rows: [new TableRow({
        children: [
          new TableCell({ borders: NO_BORDERS, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [r('TIPO', { bold: true, size: 18, color: '6B7280' })] })] }),
          new TableCell({ borders: NO_BORDERS, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [r('NOVO', { bold: true, size: 18, color: '6B7280' })] })] }),
        ],
      })],
    }),
    // Loop motores
    new Paragraph({ children: [r('{#motores}', { color: 'FFFFFF', size: 2 })] }),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [new TableRow({
        children: [
          new TableCell({ borders: NO_BORDERS, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              spacing: { before: 40, after: 40 },
              children: [
                r('• ', { size: 20, color: '111827' }),
                r('{cv} CV {polos} polos', { bold: true, size: 20, color: '111827' }),
                r('   ·   ', { size: 18, color: '9CA3AF' }),
                r('{item_nome}', { size: 18, color: '6B7280' }),
              ],
            })] }),
          new TableCell({ borders: NO_BORDERS, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 40, after: 40 },
              children: [r('R$ {valor_brl}', { bold: true, size: 20, color: '111827' })],
            })] }),
        ],
      })],
    }),
    new Paragraph({ children: [r('{/motores}', { color: 'FFFFFF', size: 2 })] }),
    // Total motores
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 8, color: '374151' } },
      rows: [new TableRow({
        children: [
          new TableCell({ borders: NO_BORDERS, width: { size: 70, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              spacing: { before: 80, after: 80 },
              children: [r('TOTAL', { bold: true, size: 22, color: '111827' })],
            })] }),
          new TableCell({ borders: NO_BORDERS, width: { size: 30, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 80, after: 80 },
              children: [r('R$ {total_motores_brl}', { bold: true, size: 22, color: '111827' })],
            })] }),
        ],
      })],
    }),
  ]
}

// ─── Valor total da proposta ──────────────────────────────────────────────
function buildValorTotal() {
  return [
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: {
        top: { style: BorderStyle.SINGLE, size: 24, color: '111827' },
        bottom: { style: BorderStyle.SINGLE, size: 24, color: '111827' },
        left: { style: BorderStyle.SINGLE, size: 24, color: '111827' },
        right: { style: BorderStyle.SINGLE, size: 24, color: '111827' },
        insideHorizontal: NO_BORDERS.top, insideVertical: NO_BORDERS.top,
      },
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: NO_BORDERS, width: { size: 65, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              spacing: { before: 160, after: 160 },
              children: [r('VALOR TOTAL DA PROPOSTA COM MOTOR NOVO', { bold: true, size: 22, color: '111827' })],
            })],
          }),
          new TableCell({
            borders: NO_BORDERS, width: { size: 35, type: WidthType.PERCENTAGE },
            children: [new Paragraph({
              alignment: AlignmentType.RIGHT,
              spacing: { before: 160, after: 160 },
              children: [r('R$ {total_proposta_brl}', { bold: true, size: 26, color: '111827' })],
            })],
          }),
        ],
      })],
    }),
  ]
}

// ─── Termos ───────────────────────────────────────────────────────────────
function buildTermos() {
  return [
    sectionHeader('Termos da proposta'),
    new Paragraph({ spacing: { after: 40 }, bullet: { level: 0 },
      children: [r('Data da venda – ', { bold: true, size: 20 }), r('{data_venda}', { size: 20, italics: true, color: '6B7280' })] }),
    new Paragraph({ spacing: { after: 40 }, bullet: { level: 0 },
      children: [r('Prazo de entrega – ', { bold: true, size: 20 }), r('{prazo_entrega}', { size: 20 })] }),
    new Paragraph({ spacing: { after: 40 }, bullet: { level: 0 },
      children: [r('Forma de pagamento – ', { bold: true, size: 20 }), r('{forma_pagamento}', { size: 20 })] }),
    new Paragraph({ spacing: { after: 40 }, bullet: { level: 0 },
      children: [r('Frete – por conta do cliente', { size: 20 })] }),
    new Paragraph({ spacing: { after: 40 }, bullet: { level: 0 },
      children: [r('Validade da proposta – 10 dias após o envio', { size: 20 })] }),
  ]
}

// ─── Vendedores (4 colunas) ───────────────────────────────────────────────
function buildVendedores() {
  return [
    sectionHeader('Vendedores'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: { ...NO_BORDERS,
        top: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
        bottom: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
        left: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
        right: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
        insideVertical: { style: BorderStyle.SINGLE, size: 2, color: 'D1D5DB' },
      },
      rows: [new TableRow({
        children: ['Patrick Alves', 'Edilson', 'Daniel', 'Branorte'].map((nome, i) => {
          const fones = ['(48) 9 9698-4660', '(48) 9 9991-2329', '(48) 9 8469-2860', '(48) 3658-4502']
          return new TableCell({
            borders: NO_BORDERS,
            width: { size: 25, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 100, after: 40 },
                children: [r(nome, { bold: true, size: 20, color: '111827' })] }),
              new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
                children: [r(fones[i], { size: 18, color: '6B7280' })] }),
            ],
          })
        }),
      })],
    }),
  ]
}

// ─── Contas pra depósito (3 colunas) ──────────────────────────────────────
function buildContas() {
  return [
    sectionHeader('Conta para depósito'),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [new TableRow({
        children: [
          // BB
          new TableCell({
            borders: NO_BORDERS, width: { size: 34, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [r('BANCO DO BRASIL', { bold: true, size: 20, color: '111827' })], spacing: { after: 40 } }),
              new Paragraph({ children: [r('Agência: ', { bold: true, size: 18 }), r('0738-2', { size: 18 })] }),
              new Paragraph({ children: [r('Conta: ', { bold: true, size: 18 }), r('39551-X', { size: 18 })] }),
              new Paragraph({ children: [r('Metalúrgica BBA', { size: 18, italics: true })] }),
              new Paragraph({ children: [r('CNPJ: 16.935.999/0001-09', { size: 16, color: '9CA3AF' })] }),
            ],
          }),
          // Sicoob
          new TableCell({
            borders: NO_BORDERS, width: { size: 33, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [r('SICOOB CREDIVALE', { bold: true, size: 20, color: '111827' })], spacing: { after: 40 } }),
              new Paragraph({ children: [r('Cooperativa: ', { bold: true, size: 18 }), r('3078', { size: 18 })] }),
              new Paragraph({ children: [r('Banco: ', { bold: true, size: 18 }), r('756', { size: 18 })] }),
              new Paragraph({ children: [r('Conta: ', { bold: true, size: 18 }), r('109909-4', { size: 18 })] }),
              new Paragraph({ children: [r('CNPJ: 16.935.999/0001-09', { size: 16, color: '9CA3AF' })] }),
            ],
          }),
          // PIX
          new TableCell({
            borders: NO_BORDERS, width: { size: 33, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [r('PIX', { bold: true, size: 20, color: '111827' })], spacing: { after: 40 } }),
              new Paragraph({ children: [r('CNPJ:', { bold: true, size: 18 })] }),
              new Paragraph({ children: [r('16935999000109', { size: 18 })] }),
              new Paragraph({ children: [r('SICOOB · Metalúrgica BBA', { size: 16, color: '9CA3AF' })] }),
            ],
          }),
        ],
      })],
    }),
  ]
}

// ─── Garantia + Tributos ──────────────────────────────────────────────────
function buildLegais() {
  return [
    sectionHeader('Observação — por conta do cliente'),
    ...['Painel elétrico',
        'Montagem dos equipamentos orçados acima (se necessário)',
        'Muck (se necessário)',
        'Despesa com obras civil (se necessário)',
        'Instalação elétrica dos equipamentos (se necessário)'].map(t =>
      new Paragraph({ children: [r(t, { size: 20 })], bullet: { level: 0 }, spacing: { after: 30 } })
    ),
    sectionHeader('Tributos'),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 80 },
      children: [r('As condições desta proposta consideram os impostos e taxas vigentes, quando da elaboração da mesma sendo que quaisquer alterações sobre os tributos Municipais, Estaduais e Federais serão repassados ou de responsabilidade do cliente, incluindo pagamento ou documento de exoneração fiscal da diferença do ICMS ao Estado de destino ou custos de caminhão parado em posto fiscal da fronteira.', { size: 20, color: '374151' })],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [r('Sendo o contratante não contribuinte de ICMS, este deverá obrigatoriamente depositar para a contratada até o dia do embarque o valor correspondente ao diferencial de alíquota de ICMS referente ao objeto deste contrato, para que a CONTRATADA possa então pagar este diferencial, cujo comprovante de pagamento será enviado com a nota fiscal de vendas das mercadorias.', { size: 20, color: '374151' })],
    }),
    sectionHeader('Cláusula de cancelamento'),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [
        r('Caso o comprador deseje cancelar o pedido, fica estabelecido que será cobrada uma taxa de cancelamento no valor de ', { size: 20, color: '374151' }),
        r('10% do preço total do produto', { bold: true, size: 20, color: '111827' }),
        r('. Essa taxa é destinada a cobrir eventuais perdas financeiras decorrentes do cancelamento, incluindo custos de produção, armazenamento e distribuição.', { size: 20, color: '374151' }),
      ],
    }),
    sectionHeader('Garantia'),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 80 },
      children: [
        r('Os equipamentos fornecidos pela metalúrgica BRANORTE estão garantidos pelo prazo de ', { size: 20, color: '374151' }),
        r('12 (doze) meses', { bold: true, size: 20, color: '111827' }),
        r(' contados da data de entrega dos mesmos, quanto ao funcionamento, desde que sejam armazenados, montados e operados dentro das condições para as quais foram projetados. Durante o prazo de garantia serão substituídas as peças que apresentarem defeitos, ficando as despesas de frete das peças, deslocamento, estadia e alimentação dos técnicos montadores por conta do cliente. Expirado o prazo de garantia, forneceremos assistência técnica mediante solicitação. Ficam excluídos da garantia os seguintes itens: canalizações e dispositivos de interligação.', { size: 20, color: '374151' }),
      ],
    }),
    new Paragraph({
      alignment: AlignmentType.JUSTIFIED,
      children: [r('Componentes fabricados e/ou montados por terceiros, tais como: motores elétricos, redutores, chaves elétricas, quadro de comando elétrico, correias, rolamentos (tendo somente a garantia fornecida pelos respectivos fabricantes), bem como toda e qualquer obra civil que é de responsabilidade do cliente.', { size: 20, color: '374151' })],
    }),
    // Assinaturas
    paraVazio(400),
    new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      borders: NO_BORDERS,
      rows: [new TableRow({
        children: [
          new TableCell({
            borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 4, color: '374151' } },
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 },
              children: [r('Metalúrgica BBA LTDA', { bold: true, size: 22, color: '111827' })] })],
          }),
          new TableCell({
            borders: { ...NO_BORDERS, top: { style: BorderStyle.SINGLE, size: 4, color: '374151' } },
            width: { size: 50, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 60 },
              children: [r('{cliente_nome}', { bold: true, size: 22, color: '111827' })] })],
          }),
        ],
      })],
    }),
  ]
}

// ─── Build document ───────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: 'Calibri', size: 20 } },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top:    convertMillimetersToTwip(20),
          right:  convertMillimetersToTwip(20),
          bottom: convertMillimetersToTwip(20),
          left:   convertMillimetersToTwip(20),
        },
        size: { orientation: PageOrientation.PORTRAIT },
      },
    },
    children: [
      ...buildHeader(),
      paraVazio(120),
      ...buildCliente(),
      ...buildItens(),
      ...buildAcessorios(),
      ...buildTotalEquipamentos(),
      ...buildMotores(),
      paraVazio(120),
      ...buildValorTotal(),
      ...buildTermos(),
      ...buildVendedores(),
      ...buildContas(),
      ...buildLegais(),
    ],
  }],
})

const outDir = path.resolve(process.cwd(), 'templates')
fs.mkdirSync(outDir, { recursive: true })
const outPath = path.join(outDir, 'orcamento-template.docx')
const buf = await Packer.toBuffer(doc)
fs.writeFileSync(outPath, buf)
console.log(`✓ Template gerado: ${outPath} (${Math.round(buf.length / 1024)}KB)`)
console.log(`  Abra no Word e refine o layout. Salve em cima desse arquivo.`)
