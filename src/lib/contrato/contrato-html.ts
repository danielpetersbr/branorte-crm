// Renderiza os MESMOS blocos do contrato em HTML A4, pro Chrome imprimir em PDF
// (/api/contrato-pdf). Nenhum texto juridico aqui — so' desenho.

import type { ContratoDados } from './contrato-dados'
import { montarBlocosContrato, type Bloco } from './contrato-blocos'

function esc(s: string): string {
  return (s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function blocoHtml(bl: Bloco): string {
  switch (bl.k) {
    case 'titulo':
      return `<h1 class="${bl.ultimo ? 'titulo titulo-fim' : 'titulo'}">${esc(bl.txt)}</h1>`

    case 'clausula':
      return `<h2 class="clausula">${esc(bl.txt)}</h2>`

    case 'p': {
      const cls = [
        'par',
        bl.center ? 'centro' : '',
        bl.indent ? 'recuo' : '',
        bl.bold ? 'forte' : '',
        bl.spaceBefore ? 'antes' : '',
      ].filter(Boolean).join(' ')
      return `<p class="${cls}">${esc(bl.txt)}</p>`
    }

    case 'tabela': {
      const cols = bl.head.map(c => `<col style="width:${c.larg ?? 0}%">`).join('')
      const th = bl.head
        .map(c => `<th class="a-${c.align ?? 'left'}">${esc(c.txt)}</th>`)
        .join('')
      const iUltima = bl.linhas.length - 1
      const totalNoFim = iUltima >= 0 && bl.linhas[iUltima].some(c => c.bold)
      const tr = bl.linhas
        .map((linha, i) => {
          const tds = linha
            .map(c => `<td class="a-${c.align ?? 'left'}${c.bold ? ' forte' : ''}">${esc(c.txt)}</td>`)
            .join('')
          return `<tr${totalNoFim && i === iUltima ? ' class="total"' : ''}>${tds}</tr>`
        })
        .join('')
      return `<table><colgroup>${cols}</colgroup><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table>`
    }

    case 'assinatura':
      return `<div class="assin">
        <div class="linha"></div>
        <div class="nome">${esc(bl.nome)}</div>
        <div class="doc">${esc(bl.doc)}</div>
      </div>`
  }
}

const CSS = `
  @page { size: A4; margin: 20mm 20mm 22mm; }
  * { box-sizing: border-box; }
  body {
    font-family: Calibri, 'Segoe UI', Arial, sans-serif;
    font-size: 11pt; line-height: 1.35; color: #000; margin: 0;
  }
  .titulo {
    text-align: center; font-size: 13pt; font-weight: 700;
    margin: 0 0 2pt; letter-spacing: .2px;
  }
  .titulo-fim { margin-bottom: 16pt; }
  .clausula {
    font-size: 11pt; font-weight: 700; margin: 14pt 0 6pt;
    page-break-after: avoid; break-after: avoid;
  }
  .par { text-align: justify; margin: 0 0 8pt; orphans: 3; widows: 3; }
  .par.centro { text-align: center; }
  .par.recuo { margin-left: 12mm; }
  .par.forte { font-weight: 700; }
  .par.antes { margin-top: 15pt; }
  table {
    width: 100%; border-collapse: collapse; margin: 4pt 0 10pt;
    font-size: 10pt; page-break-inside: auto;
  }
  th, td { border: 1px solid #8a8a8a; padding: 3pt 4pt; vertical-align: top; }
  th { background: #d9d9d9; font-weight: 700; }
  tr.total td { background: #f2f2f2; font-weight: 700; }
  .a-left { text-align: left; } .a-center { text-align: center; } .a-right { text-align: right; }
  td.forte { font-weight: 700; }
  .assin { margin-top: 22pt; text-align: center; page-break-inside: avoid; }
  .assin .linha {
    width: 82mm; margin: 0 auto 3pt; border-top: 1px solid #000;
  }
  .assin .nome { font-weight: 700; }
  .assin .doc { }
`

/** HTML completo do contrato, pronto pro Chrome imprimir. */
export function gerarContratoHtml(d: ContratoDados): string {
  const corpo = montarBlocosContrato(d).map(blocoHtml).join('\n')
  const titulo = `Contrato – ${d.comprador.nome || 'cliente'} – Orçamento ${d.orcamentoNumero}`
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${esc(titulo)}</title>
<style>${CSS}</style>
</head>
<body>
${corpo}
</body>
</html>`
}
