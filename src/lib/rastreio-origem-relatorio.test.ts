import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { jsPDF } from 'jspdf'
import type { RastreioVenda } from '../hooks/useControleRastreio'
import { montarRelatorioOrigem, diaBrasilia, diasEntre } from './rastreio-origem-relatorio'
import { criarRelatorioOrigemPDF, nomeArquivoRelatorioOrigem } from './rastreio-origem-pdf'

process.env.TZ = 'America/Sao_Paulo'

function venda(p: Partial<RastreioVenda>): RastreioVenda {
  return {
    pedido_id: 'x', pedido_numero: 'PV-0', numero_orcamento: null, cliente: 'Fulano de Tal Secreto', vendedor: 'ANA', vendedor_2: null,
    data_venda: '2026-09-30', valor: 0, fonte_declarada: null, data_primeiro_contato: null,
    telefone_pedido: '(77) 99971-3032', telefone_orcamento: null,
    chegada_em: null, chegada_origem: null, chegada_criativo: null, chegada_anuncio: null, chegada_fonte: null, chegada_via: null,
    chegadas_com_origem: 0, ultima_chegada_em: null, ultima_chegada_origem: null, contato_sem_origem_em: null,
    pedido_anterior_numero: null, pedido_anterior_data: null, na_base_desde: null, ...p,
  }
}

const LINHAS: RastreioVenda[] = [
  // dois anúncios &54 (um confere com o vendedor, outro o vendedor marcou "Site" = mesmo? não: Meta x Site diverge)
  venda({ pedido_id: 'a', pedido_numero: 'PV-1', data_venda: '2026-09-25', valor: 46000, fonte_declarada: 'site', chegada_origem: 'Meta ADS', chegada_em: '2026-08-11T15:00:00Z', chegada_criativo: '&54', chegada_anuncio: 'FÁBRICA DE RAÇÃO COMPACTA 01', chegada_fonte: 'lead', chegada_via: 'orcamento', chegadas_com_origem: 1 }),
  venda({ pedido_id: 'b', pedido_numero: 'PV-2', data_venda: '2026-09-20', valor: 30000, fonte_declarada: 'instagram', chegada_origem: 'Meta ADS', chegada_em: '2026-09-10T12:00:00Z', chegada_criativo: '&54', chegada_anuncio: 'FÁBRICA DE RAÇÃO COMPACTA 01', chegada_fonte: 'lead', chegada_via: 'pedido', chegadas_com_origem: 2 }),
  // anúncio sem código, só nome
  venda({ pedido_id: 'c', pedido_numero: 'PV-3', data_venda: '2026-09-18', valor: 10000, fonte_declarada: null, chegada_origem: 'Meta ADS', chegada_em: '2026-09-18T02:30:00Z', chegada_anuncio: 'Converse conosco', chegada_fonte: 'repasse', chegada_via: 'pedido', chegadas_com_origem: 1 }),
  // só o vendedor
  venda({ pedido_id: 'd', pedido_numero: 'PV-4', data_venda: '2026-09-15', valor: 200000, fonte_declarada: 'indicacao' }),
  // porta de entrada com vendedor: vale o vendedor, e o anúncio NÃO entra como dado
  venda({ pedido_id: 'e', pedido_numero: 'PV-5', data_venda: '2026-09-12', valor: 5000, fonte_declarada: 'feira', chegada_origem: 'WhatsApp 1144', chegada_em: '2026-09-01T12:00:00Z', chegada_criativo: '&99', chegada_anuncio: 'NÃO DEVE APARECER' }),
  // nada
  venda({ pedido_id: 'f', pedido_numero: 'PV-6', data_venda: '2026-09-10', valor: 1000, fonte_declarada: 'nao_lembra' }),
]
const UFS = new Map<string, string | null>([['a', 'sc'], ['b', 'MG'], ['c', null], ['d', ' rs ']])

test('diaBrasilia: o dia é o de Brasília, não o do UTC nem o da máquina', () => {
  assert.equal(diaBrasilia('2026-09-16T01:30:00Z'), '2026-09-15')   // 22h30 do dia 15 em Brasília
  assert.equal(diaBrasilia('2026-09-16T03:00:00Z'), '2026-09-16')
  assert.equal(diaBrasilia(null), '')
  assert.equal(diaBrasilia('lixo'), '')
})

test('diasEntre: dias corridos; chegada no mesmo dia (ou depois, por fuso) vira 0', () => {
  assert.equal(diasEntre('2026-08-11', '2026-09-25'), 45)
  assert.equal(diasEntre('2026-09-25', '2026-09-25'), 0)
  assert.equal(diasEntre('2026-09-26', '2026-09-25'), 0)
  assert.equal(diasEntre('', '2026-09-25'), null)
})

test('relatório: totais, o que é rastreio e o que é só declaração do vendedor', () => {
  const r = montarRelatorioOrigem(LINHAS, UFS)
  assert.deepEqual(r.total, { vendas: 6, valor: 292000, ticketMedio: 292000 / 6 })
  assert.equal(r.rastreadas.vendas, 3)
  assert.equal(r.rastreadas.valor, 86000)
  assert.equal(Math.round(r.rastreadas.pctVendas), 50)
  assert.deepEqual(r.comOrigem, { vendas: 5, valor: 291000 })
  assert.equal(r.conferem, 1)   // instagram x Meta ADS
  assert.equal(r.divergem, 1)   // site x Meta ADS
  assert.deepEqual(r.divergentes.map(v => [v.pedido, v.rastreioAchou, v.vendedorMarcou]), [['PV-1', 'Meta ADS (anúncio)', 'Site']])
})

test('relatório: origens da maior pra menor em valor, "não informada" por último, com quantas vieram de cada caminho', () => {
  const r = montarRelatorioOrigem(LINHAS, UFS)
  assert.deepEqual(r.origens.map(o => [o.origem, o.vendas, o.valor, o.porRastreio, o.porVendedor]), [
    ['Indicação', 1, 200000, 0, 1],
    ['Meta ADS (anúncio)', 3, 86000, 3, 0],
    ['Feira', 1, 5000, 0, 1],
    ['Origem não informada', 1, 1000, 0, 0],
  ])
  const meta = r.origens[1]
  assert.equal(Math.round(meta.pctValor * 10) / 10, 29.5)
  // prazo: 45 dias (11/08 → 25/09), 10 dias (10/09 → 20/09) e 1 dia (17/09 23h30 de Brasília → 18/09)
  assert.equal(Math.round((meta.diasMedios as number) * 100) / 100, Math.round(((45 + 10 + 1) / 3) * 100) / 100)
  assert.equal(r.origens[0].diasMedios, null) // sem rastreio não há prazo
})

test('relatório: anúncios agrupam pelo código; sem código, pelo nome; porta de entrada não vira anúncio', () => {
  const r = montarRelatorioOrigem(LINHAS, UFS)
  assert.deepEqual(r.anuncios.map(a => [a.codigo, a.anuncio, a.vendas, a.valor]), [
    ['&54', 'FÁBRICA DE RAÇÃO COMPACTA 01', 2, 76000],
    ['—', 'Converse conosco', 1, 10000],
  ])
  assert.ok(!r.anuncios.some(a => a.codigo === '&99'))
  const feira = r.vendas.find(v => v.pedido === 'PV-5')!
  assert.deepEqual([feira.origem, feira.base, feira.codigoAnuncio, feira.anuncio, feira.chegouEm], ['Feira', 'vendedor', '', '', ''])
})

test('relatório: linha da venda leva pedido, UF, valor e origem — e NADA de cliente', () => {
  const r = montarRelatorioOrigem(LINHAS, UFS)
  assert.deepEqual(r.vendas.map(v => v.pedido), ['PV-1', 'PV-2', 'PV-3', 'PV-4', 'PV-5', 'PV-6']) // mais recente primeiro
  assert.deepEqual(r.vendas.map(v => v.uf), ['SC', 'MG', '—', 'RS', '—', '—'])
  const tudo = JSON.stringify(r)
  assert.ok(!tudo.includes('Fulano'), 'nome do cliente não pode estar no relatório')
  assert.ok(!tudo.includes('99971'), 'telefone do cliente não pode estar no relatório')
})

test('relatório vazio não quebra', () => {
  const r = montarRelatorioOrigem([])
  assert.deepEqual(r.total, { vendas: 0, valor: 0, ticketMedio: 0 })
  assert.deepEqual([r.origens.length, r.anuncios.length, r.vendas.length, r.rastreadas.pctVendas], [0, 0, 0, 0])
})

test('nome do arquivo: um mês, ou a faixa de meses', () => {
  assert.equal(nomeArquivoRelatorioOrigem('2026-10-01', '2026-10-31'), 'Branorte-origem-das-vendas-2026-10.pdf')
  assert.equal(nomeArquivoRelatorioOrigem('2026-05-01', '2026-10-31'), 'Branorte-origem-das-vendas-2026-05-a-2026-10.pdf')
})

// ── O PDF de verdade (jsPDF roda no node; os assets da identidade vêm de public/) ──
const fetchOriginal = globalThis.fetch
const urls: string[] = []
before(() => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input); urls.push(url)
    assert.ok(url.startsWith('/branding-branorte/'), 'o PDF só pode buscar os assets oficiais locais')
    return new Response(new Uint8Array(await readFile(new URL(`../../public${url}`, import.meta.url))))
  }) as typeof fetch
})
after(() => { globalThis.fetch = fetchOriginal })

/** Texto do PDF (a Poppins embutida grava glifos; o cmap da fonte devolve as letras). */
function textoDocumento(doc: jsPDF): string {
  const mapas = new Map<string, Map<number, string>>()
  const anterior = doc.getFont()
  for (const estilo of ['normal', 'bold']) {
    doc.setFont('Poppins', estilo)
    const f = doc.getFont() as unknown as { id: string; metadata?: { cmap?: { unicode?: { codeMap?: Record<string, number> } } } }
    const codigos = f.metadata?.cmap?.unicode?.codeMap
    if (codigos) mapas.set(f.id, new Map(Object.entries(codigos).map(([u, g]) => [g, String.fromCodePoint(Number(u))])))
  }
  doc.setFont(anterior.fontName, anterior.fontStyle)
  return (doc.internal.pages as unknown as string[][]).map(p => p?.join('\n') || '').join('\f').replace(/BT([\s\S]*?)ET/g, (_b, conteudo: string) => {
    const id = conteudo.match(/\/(F\d+)\s[\d.]+\sTf/)?.[1]; const mapa = id ? mapas.get(id) : undefined
    return mapa ? conteudo.replace(/<([\da-f]+)>/gi, (_s, hex: string) => Array.from({ length: hex.length / 4 }, (_, i) => mapa.get(parseInt(hex.slice(i * 4, i * 4 + 4), 16)) || '').join('')) : conteudo
  })
}

test('PDF: identidade oficial (Poppins + logo locais), seções na ordem e os números do relatório', async () => {
  const doc = await criarRelatorioOrigemPDF({ relatorio: montarRelatorioOrigem(LINHAS, UFS), periodo: 'Setembro de 2026', geradoEm: new Date('2026-10-07T18:00:00Z') })
  const fontes = doc.getFontList()
  assert.ok(fontes.Poppins?.includes('normal') && fontes.Poppins?.includes('bold'))
  assert.deepEqual([...new Set(urls)].sort(), ['/branding-branorte/Poppins-Bold.ttf', '/branding-branorte/Poppins-Regular.ttf', '/branding-branorte/logo-principal-verde-preto.png'])
  const t = textoDocumento(doc)
  const pos = ['Origem das vendas', 'Como ler este relatório', 'Vendas por origem', 'Anúncios que geraram venda', 'Onde o rastreio e o vendedor discordam', 'Venda a venda', 'Como o rastreio é feito'].map(s => t.indexOf(s))
  assert.ok(pos.every(p => p >= 0), `seção faltando: ${pos}`)
  assert.deepEqual([...pos].sort((a, b) => a - b), pos, 'seções fora de ordem')
  // (nome de anúncio comprido quebra de linha na célula: confere por um pedaço que cabe numa linha)
  for (const esperado of ['Setembro de 2026', 'R$ 292.000', '3 de 6', '&54', 'COMPACTA', 'Meta ADS (anúncio)', 'Indicação', 'PV-1', 'Rastreio', 'Vendedor', 'BRANORTE']) {
    assert.ok(t.includes(esperado), `faltou "${esperado}" no PDF`)
  }
})

test('PDF: não leva nome nem telefone de cliente, nem o anúncio de uma porta de entrada', async () => {
  const doc = await criarRelatorioOrigemPDF({ relatorio: montarRelatorioOrigem(LINHAS, UFS), periodo: 'Setembro de 2026', geradoEm: new Date('2026-10-07T18:00:00Z') })
  const t = textoDocumento(doc)
  assert.ok(!t.includes('Fulano'))
  assert.ok(!t.includes('99971'))
  assert.ok(!t.includes('NÃO DEVE APARECER'))
})

test('PDF: período sem venda nenhuma gera documento válido, dizendo que não houve venda', async () => {
  const doc = await criarRelatorioOrigemPDF({ relatorio: montarRelatorioOrigem([]), periodo: 'Janeiro de 2020', geradoEm: new Date('2026-10-07T18:00:00Z') })
  const t = textoDocumento(doc)
  assert.ok(t.includes('Nenhuma venda no período.'))
  assert.ok(t.includes('Nenhuma venda deste período tem anúncio identificado'))
  assert.ok(!t.includes('Onde o rastreio e o vendedor discordam'))
})

test('PDF: recusa data de geração inválida em vez de imprimir "Invalid Date"', async () => {
  await assert.rejects(() => criarRelatorioOrigemPDF({ relatorio: montarRelatorioOrigem(LINHAS, UFS), periodo: 'x', geradoEm: new Date('lixo') }), /Data de geração inválida/)
})
