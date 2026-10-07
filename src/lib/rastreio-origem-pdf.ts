import { jsPDF } from 'jspdf'
import { autoTable, type UserOptions } from 'jspdf-autotable'
import { carregarIdentidadePDF } from '@/components/controle/vendas-original/relatorio-pdf'
import { sanitizePdfText } from '@/components/controle/vendas-original/pdfFonts'
import { ROTULO_BASE, type RelatorioOrigem } from '@/lib/rastreio-origem-relatorio'

// ───────────────────────────────────────────────────────────────────────────
// PDF "Origem das vendas" pra mandar ao gestor de tráfego (pedido do Daniel, 07/10/2026).
//
// Identidade oficial (public/branding-branorte): verde #01A95B, preto #010101,
// Poppins e o logo original — os MESMOS assets e o mesmo desenho de seção, tabela e
// rodapé do Relatório de vendas (vendas-original/relatorio-pdf.ts), pra os dois
// documentos da casa parecerem da mesma família.
//
// O documento sai da empresa: não leva nome nem telefone de cliente (a parte pura,
// rastreio-origem-relatorio.ts, já não entrega esses campos).
// ───────────────────────────────────────────────────────────────────────────

export interface RelatorioOrigemPDFInput {
  relatorio: RelatorioOrigem
  /** Texto do período como aparece na tela, ex. "Outubro de 2026" ou "Maio a Outubro de 2026". */
  periodo: string
  geradoEm: Date
}

type RGB = [number, number, number]
const cores = {
  verde: [1, 169, 91], preto: [1, 1, 1], secundario: [90, 90, 90], linha: [225, 225, 225],
  fundo: [248, 248, 248], verdeClaro: [242, 250, 246], branco: [255, 255, 255], ambar: [176, 108, 0],
} satisfies Record<string, RGB>

const moeda = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v).replace(/ /g, ' ')
const numero = (v: number, casas = 0) => new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas, minimumFractionDigits: casas }).format(v)
const pct = (v: number) => `${numero(v, v > 0 && v < 10 ? 1 : 0)}%`
const texto = (v: string | null | undefined) => sanitizePdfText(v) || '-'
const dia = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10).split('-').reverse().join('/') : '-')
/** dd/mm/aa: cabe nas colunas estreitas da tabela venda a venda sem quebrar o ano. */
const diaCurto = (iso: string) => (/^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : '-')
const dias = (n: number | null) => (n === null ? '-' : n < 1 ? 'mesmo dia' : `${numero(n)} ${Math.round(n) === 1 ? 'dia' : 'dias'}`)

/** Nome do arquivo: estável, sem acento, com o período. */
export function nomeArquivoRelatorioOrigem(from: string, to: string): string {
  const a = from.slice(0, 7), b = to.slice(0, 7)
  return `Branorte-origem-das-vendas-${a === b ? a : `${a}-a-${b}`}.pdf`
}

export async function criarRelatorioOrigemPDF(input: RelatorioOrigemPDFInput): Promise<jsPDF> {
  const r = input.relatorio
  if (!Number.isFinite(input.geradoEm.getTime())) throw Error('Data de geração inválida.')
  if (![r.total.valor, r.rastreadas.valor, ...r.vendas.map(v => v.valor)].every(Number.isFinite)) throw Error('Valor inválido no relatório. Atualize a tela antes de exportar.')

  const identidade = await carregarIdentidadePDF()
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true, putOnlyUsedFonts: true })
  doc.addFileToVFS('Poppins-Regular.ttf', identidade.regular); doc.addFileToVFS('Poppins-Bold.ttf', identidade.bold)
  doc.addFont('Poppins-Regular.ttf', 'Poppins', 'normal'); doc.addFont('Poppins-Bold.ttf', 'Poppins', 'bold')
  const fonte = 'Poppins'
  const logo = (x: number, yy: number, w: number) => doc.addImage(identidade.logo, 'PNG', x, yy, w, w * 427 / 2715, 'branorte-logo-oficial', 'FAST')
  const W = 210, margem = 14, largura = W - margem * 2, limite = 274
  let y = 27
  let secaoAtual = 'Resumo'
  const secoesPaginas = new Map<number, string>([[1, secaoAtual]])
  const geradoEm = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' }).format(input.geradoEm)
  const periodo = texto(input.periodo)

  doc.setProperties({ title: 'Branorte - Origem das vendas', subject: periodo, author: 'Branorte', creator: 'Branorte' })

  const escrever = (conteudo: string | string[], x: number, yy: number, tamanho = 9, negrito = false, cor: RGB = cores.preto, alinhamento?: 'left' | 'center' | 'right') => {
    doc.setFont(fonte, negrito ? 'bold' : 'normal'); doc.setFontSize(tamanho); doc.setTextColor(...cor)
    doc.text(conteudo, x, yy, { align: alinhamento || 'left' })
  }
  const novaPagina = () => { doc.addPage(); y = 30; secoesPaginas.set(doc.getNumberOfPages(), secaoAtual) }
  const espaco = (altura: number) => { if (y + altura > limite) novaPagina() }
  const paragrafo = (conteudo: string, cor: RGB = cores.secundario, tamanho = 8.5, larguraMax = largura, x = margem) => {
    doc.setFont(fonte, 'normal'); doc.setFontSize(tamanho)
    const linhas = doc.splitTextToSize(conteudo, larguraMax) as string[]
    const altura = linhas.length * tamanho * 0.44
    espaco(altura + 3); escrever(linhas, x, y, tamanho, false, cor); y += altura + 3
  }
  const secao = (titulo: string, descricao?: string, alturaMinima = 34) => {
    secaoAtual = titulo; espaco(alturaMinima)
    if (!secoesPaginas.has(doc.getNumberOfPages())) secoesPaginas.set(doc.getNumberOfPages(), titulo)
    doc.setFillColor(...cores.verde); doc.roundedRect(margem, y - 3.8, 1.4, 5.5, 0.5, 0.5, 'F')
    escrever(titulo, margem + 4, y, 12, true, cores.preto); y += 7
    if (descricao) paragrafo(descricao)
  }
  const tabela = (head: string[], body: string[][], opcoes: Partial<UserOptions> = {}) => {
    espaco(22)
    autoTable(doc, {
      startY: y, head: [head], body, theme: 'plain',
      margin: { top: 30, left: margem, right: margem, bottom: 24 }, tableWidth: largura,
      styles: { font: fonte, fontSize: 8, textColor: cores.preto, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 }, overflow: 'linebreak', lineColor: cores.linha, lineWidth: { bottom: 0.15 }, valign: 'middle' },
      headStyles: { font: fonte, fontStyle: 'bold', fillColor: cores.preto, textColor: cores.branco, fontSize: 7.8 },
      alternateRowStyles: { fillColor: cores.fundo },
      rowPageBreak: 'avoid', showHead: 'everyPage',
      didDrawPage: () => { const p = doc.getCurrentPageInfo().pageNumber; if (!secoesPaginas.has(p)) secoesPaginas.set(p, secaoAtual) },
      ...opcoes,
    })
    y = (doc as jsPDF & { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  }

  // ── Capa compacta + resumo ────────────────────────────────────────────────
  logo(margem, 8, 67)
  escrever('Origem das vendas', margem, 31, 22, true, cores.preto)
  escrever('Como cada venda chegou até a Branorte  |  relatório para gestão de tráfego', margem, 40, 9, false, cores.secundario)
  doc.setFillColor(...cores.verde); doc.rect(0, 45, W, 1.5, 'F')
  y = 56
  paragrafo(`Período: ${periodo}  |  Gerado em ${geradoEm}`, cores.preto, 9.5)
  y += 2

  const gap = 3, cardW = (largura - gap * 3) / 4, cardY = y
  const valorAnuncios = r.anuncios.reduce((s, a) => s + a.valor, 0)
  const vendasAnuncios = r.anuncios.reduce((s, a) => s + a.vendas, 0)
  const kpis: Array<[string, string, string]> = [
    ['Faturamento do período', moeda(r.total.valor), `${numero(r.total.vendas)} ${r.total.vendas === 1 ? 'venda' : 'vendas'}`],
    ['Ticket médio', moeda(r.total.ticketMedio), 'por venda'],
    ['Origem comprovada', `${numero(r.rastreadas.vendas)} de ${numero(r.total.vendas)}`, `${pct(r.rastreadas.pctVendas)} das vendas | ${moeda(r.rastreadas.valor)}`],
    ['Vendas com anúncio identificado', numero(vendasAnuncios), `${numero(r.anuncios.length)} ${r.anuncios.length === 1 ? 'anúncio' : 'anúncios'} | ${moeda(valorAnuncios)}`],
  ]
  kpis.forEach(([rotulo, valor, detalhe], i) => {
    const x = margem + i * (cardW + gap)
    doc.setFillColor(...(i === 0 ? cores.verdeClaro : cores.fundo)); doc.roundedRect(x, cardY, cardW, 30, 2, 2, 'F')
    doc.setFont(fonte, 'normal'); doc.setFontSize(7.4)
    escrever(doc.splitTextToSize(rotulo, cardW - 6) as string[], x + 3, cardY + 7, 7.4, false, cores.secundario)
    doc.setFont(fonte, 'bold'); let tamanho = 13
    doc.setFontSize(tamanho)
    while (tamanho > 9 && doc.getTextWidth(valor) > cardW - 6) { tamanho -= 0.5; doc.setFontSize(tamanho) }
    escrever(valor, x + 3, cardY + 19.5, tamanho, true, cores.preto)
    doc.setFont(fonte, 'normal'); doc.setFontSize(6.8)
    escrever((doc.splitTextToSize(detalhe, cardW - 6) as string[]).slice(0, 2), x + 3, cardY + 24.5, 6.8, false, cores.secundario)
  })
  y += 38

  secao('Como ler este relatório', undefined, 30)
  paragrafo('A origem é COMPROVADA quando o telefone do pedido, ou do orçamento que virou pedido, bate com um contato registrado antes da venda: um lead, um lead entregue a vendedor ou um clique em anúncio. Nesses casos a coluna "Como se soube" mostra Rastreio.')
  paragrafo('Quando não existe esse registro, o relatório usa o que o vendedor informou no pedido ("Como o cliente encontrou a empresa?") e a coluna mostra Vendedor. Esse número é declaração, não medição: use o Rastreio para decidir verba e o Vendedor como contexto.')
  y += 2

  // ── Vendas por origem ─────────────────────────────────────────────────────
  secao('Vendas por origem', 'Todas as origens do período, da maior para a menor em valor. A barra mostra a fatia do faturamento.', 46)
  if (r.origens.length === 0) { paragrafo('Nenhuma venda no período.'); y += 4 } else {
    const maior = Math.max(...r.origens.map(o => o.valor), 1)
    // rótulo | barra | "N vendas | x%" | valor: cada um com a sua faixa, pra barra cheia não encostar no texto
    const rotuloW = 50, complementoW = 31, valorW = 27, barraX = margem + rotuloW, barraW = largura - rotuloW - complementoW - valorW - 2
    for (const o of r.origens) {
      espaco(8)
      escrever(texto(o.origem), margem, y + 1, 8.2, true, cores.preto)
      doc.setFillColor(...cores.fundo); doc.roundedRect(barraX, y - 2, barraW, 3.4, 1.2, 1.2, 'F')
      const w = Math.max(o.valor > 0 ? 1.2 : 0, (o.valor / maior) * barraW)
      if (w > 0) { doc.setFillColor(...(o.porRastreio > 0 ? cores.verde : cores.secundario)); doc.roundedRect(barraX, y - 2, w, 3.4, 1.2, 1.2, 'F') }
      escrever(moeda(o.valor), W - margem, y + 1, 8.2, true, cores.preto, 'right')
      escrever(`${numero(o.vendas)} ${o.vendas === 1 ? 'venda' : 'vendas'} | ${pct(o.pctValor)}`, W - margem - valorW, y + 1, 7, false, cores.secundario, 'right')
      y += 7.2
    }
    escrever('Barra verde: origem com pelo menos uma venda comprovada pelo rastreio. Barra cinza: só declaração do vendedor.', margem, y + 1, 7, false, cores.secundario)
    y += 9
    tabela(
      ['Origem', 'Vendas', 'Valor', '% valor', 'Ticket médio', 'Rastreio', 'Vendedor', 'Prazo médio'],
      r.origens.map(o => [texto(o.origem), numero(o.vendas), moeda(o.valor), pct(o.pctValor), moeda(o.ticketMedio), numero(o.porRastreio), numero(o.porVendedor), dias(o.diasMedios)]),
      {
        columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 16, halign: 'right' }, 2: { cellWidth: 28, halign: 'right', fontStyle: 'bold' }, 3: { cellWidth: 17, halign: 'right' }, 4: { cellWidth: 26, halign: 'right' }, 5: { cellWidth: 17, halign: 'right' }, 6: { cellWidth: 19, halign: 'right' }, 7: { cellWidth: 17, halign: 'right' } },
        foot: [[{ content: 'Total do período', styles: { halign: 'left' } }, { content: numero(r.total.vendas), styles: { halign: 'right' } }, { content: moeda(r.total.valor), styles: { halign: 'right' } }, { content: '100%', styles: { halign: 'right' } }, { content: moeda(r.total.ticketMedio), styles: { halign: 'right' } }, { content: numero(r.rastreadas.vendas), styles: { halign: 'right' } }, { content: numero(r.vendas.filter(v => v.base === 'vendedor').length), styles: { halign: 'right' } }, ''] as never],
        showFoot: 'lastPage', footStyles: { fillColor: cores.verdeClaro, textColor: cores.preto, fontStyle: 'bold', fontSize: 8 },
      },
    )
    paragrafo('"Rastreio" e "Vendedor" contam quantas vendas da origem vieram de cada caminho. "Prazo médio" é a média de dias entre o primeiro contato rastreado e a venda, só das vendas comprovadas.', cores.secundario, 7.5)
    y += 3
  }

  // ── Anúncios ──────────────────────────────────────────────────────────────
  secao('Anúncios que geraram venda', 'Vendas em que o telefone do cliente bate com um lead ou clique que trouxe o anúncio. O código é o que está no nome do anúncio no Gerenciador (ex.: &50).', 40)
  if (r.anuncios.length === 0) {
    paragrafo('Nenhuma venda deste período tem anúncio identificado pelo rastreio.', cores.preto, 9); y += 4
  } else {
    tabela(
      ['Código', 'Anúncio', 'Canal', 'Vendas', 'Valor', 'Ticket médio', 'Prazo médio'],
      r.anuncios.map(a => [texto(a.codigo), texto(a.anuncio), texto(a.origem), numero(a.vendas), moeda(a.valor), moeda(a.ticketMedio), dias(a.diasMedios)]),
      {
        columnStyles: { 0: { cellWidth: 16, fontStyle: 'bold' }, 1: { cellWidth: 50 }, 2: { cellWidth: 34 }, 3: { cellWidth: 16, halign: 'right' }, 4: { cellWidth: 26, halign: 'right', fontStyle: 'bold' }, 5: { cellWidth: 23, halign: 'right' }, 6: { cellWidth: 17, halign: 'right' } },
        foot: [[{ content: 'Total com anúncio identificado', colSpan: 3, styles: { halign: 'left' } }, { content: numero(vendasAnuncios), styles: { halign: 'right' } }, { content: moeda(valorAnuncios), styles: { halign: 'right' } }, '', ''] as never],
        showFoot: 'lastPage', footStyles: { fillColor: cores.verdeClaro, textColor: cores.preto, fontStyle: 'bold', fontSize: 8 },
      },
    )
  }

  // ── Divergências ──────────────────────────────────────────────────────────
  if (r.divergentes.length > 0) {
    secao('Onde o rastreio e o vendedor discordam', `Em ${numero(r.divergentes.length)} ${r.divergentes.length === 1 ? 'venda o vendedor marcou um canal e o rastreio comprovou outro' : 'vendas o vendedor marcou um canal e o rastreio comprovou outro'}. Vale o rastreio. Em ${numero(r.conferem)} ${r.conferem === 1 ? 'venda os dois dizem' : 'vendas os dois dizem'} o mesmo canal.`, 40)
    tabela(
      ['Venda', 'Pedido', 'Valor', 'Rastreio comprovou', 'Vendedor marcou', 'Anúncio'],
      r.divergentes.map(v => [dia(v.data), texto(v.pedido), moeda(v.valor), texto(v.rastreioAchou), texto(v.vendedorMarcou), [v.codigoAnuncio, v.anuncio].filter(Boolean).map(texto).join(' ') || '-']),
      { columnStyles: { 0: { cellWidth: 21 }, 1: { cellWidth: 26 }, 2: { cellWidth: 25, halign: 'right' }, 3: { cellWidth: 36, fontStyle: 'bold' }, 4: { cellWidth: 29 }, 5: { cellWidth: 45 } } },
    )
  }

  // ── Venda a venda ─────────────────────────────────────────────────────────
  secao('Venda a venda', `${numero(r.total.vendas)} ${r.total.vendas === 1 ? 'venda' : 'vendas'} do período, da mais recente para a mais antiga. Sem dados de cliente: pedido, estado, valor e origem.`, 90)
  if (r.vendas.length === 0) { paragrafo('Nenhuma venda no período.'); y += 4 } else {
    tabela(
      ['Venda', 'Pedido', 'UF', 'Valor', 'Origem', 'Como se soube', 'Anúncio', 'Chegou', 'Prazo'],
      r.vendas.map(v => [diaCurto(v.data), texto(v.pedido), texto(v.uf), moeda(v.valor), texto(v.origem), ROTULO_BASE[v.base], [v.codigoAnuncio, v.anuncio].filter(Boolean).map(texto).join(' ') || '-', v.chegouEm ? diaCurto(v.chegouEm) : '-', dias(v.diasAteVenda)]),
      {
        styles: { font: fonte, fontSize: 7.4, textColor: cores.preto, cellPadding: { top: 1.7, bottom: 1.7, left: 1.6, right: 1.6 }, overflow: 'linebreak', lineColor: cores.linha, lineWidth: { bottom: 0.15 }, valign: 'middle' },
        columnStyles: { 0: { cellWidth: 15 }, 1: { cellWidth: 24 }, 2: { cellWidth: 9, halign: 'center' }, 3: { cellWidth: 23, halign: 'right' }, 4: { cellWidth: 32, fontStyle: 'bold' }, 5: { cellWidth: 19 }, 6: { cellWidth: 29 }, 7: { cellWidth: 15 }, 8: { cellWidth: 16, halign: 'right' } },
        foot: [[{ content: `Total | ${numero(r.total.vendas)} ${r.total.vendas === 1 ? 'venda' : 'vendas'}`, colSpan: 3, styles: { halign: 'left' } }, { content: moeda(r.total.valor), styles: { halign: 'right' } }, { content: '', colSpan: 5 }] as never],
        showFoot: 'lastPage', footStyles: { fillColor: cores.verdeClaro, textColor: cores.preto, fontStyle: 'bold', fontSize: 8 },
        didParseCell: hook => {
          if (hook.section !== 'body' || hook.column.index !== 5) return
          const base = r.vendas[hook.row.index]?.base
          if (base === 'rastreio') { hook.cell.styles.textColor = cores.verde; hook.cell.styles.fontStyle = 'bold' }
          else if (base === 'nenhuma') hook.cell.styles.textColor = cores.ambar
          else hook.cell.styles.textColor = cores.secundario
        },
      },
    )
  }

  // ── Método ────────────────────────────────────────────────────────────────
  secao('Como o rastreio é feito e o que ele não alcança', undefined, 46)
  for (const linha of [
    'Só conta contato registrado até o dia da venda. Para quem já tinha comprado antes, só conta o que veio depois daquela compra: o anúncio que trouxe a primeira compra não é a origem da segunda.',
    'Quando o mesmo telefone tem mais de um contato, vale o primeiro com origem identificada.',
    '"WhatsApp da empresa" indica por onde o cliente entrou, não como ele achou a empresa. Por isso não substitui o que o vendedor informou.',
    'Pedidos de garantia e pedidos cancelados ficam fora. O valor é o total do pedido.',
    'O rastreio só alcança quem passou por um contato registrado. Cliente que ligou, veio por indicação ou falou direto com o vendedor aparece pelo que o vendedor informou, e venda sem telefone no pedido e no orçamento não tem como ser cruzada.',
  ]) paragrafo(`-  ${linha}`, cores.secundario, 8.2)

  // ── Cabeçalho e rodapé em todas as páginas ────────────────────────────────
  const totalPaginas = doc.getNumberOfPages()
  for (let pagina = 1; pagina <= totalPaginas; pagina++) {
    doc.setPage(pagina)
    if (pagina > 1) {
      logo(margem, 7, 38)
      escrever('ORIGEM DAS VENDAS', W - margem, 13, 7, false, cores.secundario, 'right')
      doc.setDrawColor(...cores.linha); doc.setLineWidth(0.3); doc.line(margem, 18, W - margem, 18)
      escrever(secoesPaginas.get(pagina) || 'Origem das vendas', margem, 23, 8, false, cores.secundario)
    }
    doc.setDrawColor(...cores.linha); doc.setLineWidth(0.2); doc.line(margem, 281, W - margem, 281)
    escrever('BRANORTE', margem, 287, 7, true, cores.preto)
    escrever(`${numero(r.total.vendas)} ${r.total.vendas === 1 ? 'venda' : 'vendas'} | ${moeda(r.total.valor)}`, W / 2, 287, 7, false, cores.secundario, 'center')
    escrever(`${pagina} / ${totalPaginas}`, W - margem, 287, 7, false, cores.secundario, 'right')
    escrever(`${periodo} | gerado em ${geradoEm}`, margem, 292, 6.5, false, cores.secundario)
  }
  return doc
}
