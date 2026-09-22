// Renderiza os blocos do contrato (contrato-blocos.ts) em .docx.
//
// O texto juridico NAO mora aqui: este arquivo so sabe desenhar. Quem define o
// que o contrato diz e' `montarBlocosContrato`, que tambem alimenta o PDF —
// assim Word e PDF nunca divergem.

import {
  Document, Packer, Paragraph, TextRun, AlignmentType, Footer,
  Table, TableRow, TableCell, WidthType, ShadingType, BorderStyle,
} from 'docx'
import type { ContratoDados } from './contrato-dados'
import { montarBlocosContrato, nomeArquivoContrato, type Bloco, type CelulaBloco } from './contrato-blocos'

export { nomeArquivoContrato }

const FONTE = 'Calibri'
const LARG_TOTAL_TWIPS = 9400

function r(text: string, opts: { bold?: boolean; size?: number; color?: string } = {}): TextRun {
  return new TextRun({
    text,
    bold: opts.bold,
    size: opts.size ?? 22,          // half-points: 22 = 11pt
    color: opts.color,
    font: FONTE,
  })
}

const ALINHA = {
  left: AlignmentType.LEFT,
  center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT,
} as const

function celula(c: CelulaBloco, fundo?: string): TableCell {
  return new TableCell({
    width: c.larg ? { size: Math.round((c.larg / 100) * LARG_TOTAL_TWIPS), type: WidthType.DXA } : undefined,
    shading: fundo ? { type: ShadingType.CLEAR, fill: fundo, color: 'auto' } : undefined,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    children: [new Paragraph({
      alignment: ALINHA[c.align ?? 'left'],
      spacing: { after: 0 },
      children: [r(c.txt, { bold: c.bold, size: 20 })],
    })],
  })
}

function renderBloco(bl: Bloco): (Paragraph | Table)[] {
  switch (bl.k) {
    case 'titulo':
      return [new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: bl.ultimo ? 320 : 20 },
        children: [r(bl.txt, { bold: true, size: 26 })],
      })]

    case 'clausula':
      return [new Paragraph({
        spacing: { before: 280, after: 120 },
        children: [r(bl.txt, { bold: true })],
      })]

    case 'p':
      return [new Paragraph({
        alignment: bl.center ? AlignmentType.CENTER : AlignmentType.JUSTIFIED,
        spacing: { before: bl.spaceBefore ? 300 : undefined, after: 160, line: 276 },
        indent: bl.indent ? { left: 340 * bl.indent } : undefined,
        children: [r(bl.txt, { bold: bl.bold })],
      })]

    case 'tabela': {
      // Ultima linha com negrito = linha de total: fundo claro, nao o cinza do cabecalho.
      const iUltima = bl.linhas.length - 1
      const totalNoFim = iUltima >= 0 && bl.linhas[iUltima].some(c => c.bold)
      return [new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({ tableHeader: true, children: bl.head.map(c => celula(c, 'D9D9D9')) }),
          ...bl.linhas.map((linha, i) => new TableRow({
            children: linha.map(c => celula(c, totalNoFim && i === iUltima ? 'F2F2F2' : undefined)),
          })),
        ],
      })]
    }

    case 'assinatura':
      return [
        new Paragraph({ spacing: { before: 420, after: 0 }, children: [r(' ')] }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 40 },
          children: [r('_____________________________________________________')],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 20 },
          children: [r(bl.nome, { bold: true })],
        }),
        new Paragraph({
          alignment: AlignmentType.CENTER, spacing: { after: 40 },
          children: [r(bl.doc)],
        }),
      ]
  }
}

export async function gerarContratoDocx(d: ContratoDados): Promise<Blob> {
  const children = montarBlocosContrato(d).flatMap(renderBloco)

  const doc = new Document({
    creator: d.vendedorNome || 'Branorte CRM',
    title: `Contrato – ${d.comprador.nome || 'cliente'} – Orçamento ${d.orcamentoNumero}`,
    description: 'Contrato de compra e venda com reserva de domínio gerado pelo CRM Branorte',
    styles: { default: { document: { run: { font: FONTE, size: 22 } } } },
    sections: [{
      properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      footers: {
        default: new Footer({
          children: [new Paragraph({
            alignment: AlignmentType.CENTER,
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D0D0D0', space: 6 } },
            children: [r(
              'Rodovia SC 370, km 139, nº 1.390 – Rio Pequeno – Grão-Pará/SC – CEP 88.890-000 · ' +
              '(48) 3658-4502 · contato@mbranorte.com.br',
              { size: 15, color: '666666' })],
          })],
        }),
      },
      children,
    }],
  })

  return await Packer.toBlob(doc)
}
