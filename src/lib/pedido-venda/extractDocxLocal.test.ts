import { test } from 'node:test'
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import { Document, Packer, Paragraph, Table, TableCell, TableRow } from 'docx'

// Match Vite's browser resolution: the actual Mammoth browser API accepts the
// ArrayBuffer supplied by production; its Node API only accepts path/buffer.
registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === 'mammoth' ? 'mammoth/mammoth.browser.js' : specifier, context)
} })
const { extrairDadosDeLinhas, extrairLocalComMammoth } = await import('./extractDocxLocal')

for (const extension of ['pdf', 'PDF', 'docx']) {
  test(`descrição de acessório em ${extension} usa o conteúdo dos parênteses`, () => {
    const result = extrairDadosDeLinhas(
      ['CLIENTE: CALOS RENE SILVA'],
      `2026 - 3029 - CALOS RENE SILVA MIRANDA (JOGO PENEIRA MOINHO 20 CV).${extension}`,
    )
    assert.equal(result.descricao_equipamento, 'JOGO PENEIRA MOINHO 20 CV')
  })
}

test('nomes antigos sem parênteses preservam a descrição após o cliente', () => {
  assert.equal(extrairDadosDeLinhas(
    ['CLIENTE: Mondo Sementes Ltda'],
    '2023_-_0910_-_Mondo_Sementes_Ltda_Martelos.docx',
  ).descricao_equipamento, 'Martelos')
  assert.equal(extrairDadosDeLinhas(
    ['CLIENTE: Carlos Hobold'],
    '2021 - 1095 - Carlos Hobold Martelos.pdf',
  ).descricao_equipamento, 'Martelos')
})

test('observações do acessório terminam antes das redes sociais e condições comerciais', () => {
  const result = extrairDadosDeLinhas([
    'OBSERVAÇÕES',
    '- CONFERIR AS MEDIDAS DA PENEIRA COM O CLIENTE.',
    'A ÚLTIMA PRECISOU SER CORTADA PARA ENTRAR NO MOINHO.',
    'NOSSAS REDES SOCIAIS',
    'INSTAGRAM: @BRANORTE_METALURGICA',
    'DADOS DO FABRICANTE',
    'EMPRESA: BRANORTE – METALÚRGICA BBA LTDA',
    'CONTA PARA DEPÓSITO',
    'BANCO DO BRASIL',
    'OBSERVAÇÃO — POR CONTA DO CLIENTE',
    '- PAINEL ELÉTRICO',
    'TRIBUTOS',
    'AS CONDIÇÕES DESTA PROPOSTA CONSIDERAM OS IMPOSTOS.',
    'CLÁUSULA DE CANCELAMENTO',
    'CASO O COMPRADOR DESEJE CANCELAR O PEDIDO...',
    'GARANTIA',
  ], 'acessorio.pdf')
  assert.deepEqual(result.observacoes, [
    '- CONFERIR AS MEDIDAS DA PENEIRA COM O CLIENTE.',
    'A ÚLTIMA PRECISOU SER CORTADA PARA ENTRAR NO MOINHO.',
  ])
})

const sectionTitles = [
  'Nossas Redes Sociais',
  'Dados do Fabricante',
  'Conta para Depósito:',
  'Caixa Postal',
  'Observação — por conta do cliente',
  'TRIBUTOS',
  'Cláusula de Cancelamento',
  'GARANTIA',
  'VALOR TOTAL DA PROPOSTA: R$ 480,00',
  'VALOR TOTAL DE EQUIPAMENTOS R$ 480,00',
  'VALOR TOTAL DA PROPOSTA COM MOTOR NOVO R$ 480,00',
  'VALOR TOTAL DA PROPOSTA (SEM DESCONTO) R$ 480,00',
  'VALOR TOTAL COM DESCONTO R$ 480,00',
  'FORMA DE PAGAMENTO: À VISTA',
  'Forma de pagamento – a combinar',
  'PRAZO DE ENTREGA: 30 DIAS',
  'Prazo de entrega – 90 dias (úteis)',
]
for (const title of sectionTitles) {
  test(`observações param no título de seção ${title}`, () => {
    const result = extrairDadosDeLinhas([
      'OBSERVAÇÕES: CONFIRMAR O DIÂMETRO DA PENEIRA.',
      title,
      'CONTEÚDO DE OUTRA SEÇÃO',
    ], 'acessorio.pdf')
    assert.deepEqual(result.observacoes, ['CONFIRMAR O DIÂMETRO DA PENEIRA.'])
  })
}

test('observações vazias não importam o rodapé', () => {
  const result = extrairDadosDeLinhas([
    'OBSERVAÇÕES',
    'Nossas Redes Sociais',
    'Instagram: @branorte_metalurgica',
  ], 'acessorio.pdf')
  assert.deepEqual(result.observacoes, [])
})

test('observação comercial por conta do cliente não abre a seção livre', () => {
  const result = extrairDadosDeLinhas([
    'OBSERVAÇÃO — POR CONTA DO CLIENTE',
    '- MONTAGEM DOS EQUIPAMENTOS ORÇADOS ACIMA (SE NECESSÁRIO)',
    'TRIBUTOS',
  ], 'acessorio.pdf')
  assert.deepEqual(result.observacoes, [])
})

test('observações livres após a garantia no DOCX continuam sendo encontradas', () => {
  const result = extrairDadosDeLinhas([
    'Dados do fabricante',
    'GARANTIA',
    'Os equipamentos estão garantidos pelo prazo de 12 meses.',
    'Observações — Confirmar as medidas antes de fabricar.',
  ], 'acessorio.docx')
  assert.deepEqual(result.observacoes, ['Confirmar as medidas antes de fabricar.'])
})

test('palavras de condições comerciais no texto não cortam observações legítimas', () => {
  const expected = [
    'Confirmar prazo de entrega e garantia com o cliente.',
    'Garantia de encaixe depende da conferência das medidas.',
    'Prazo de entrega ajustado conforme aprovação das medidas.',
    'Valor total confirmado em reunião com o cliente.',
    'Revisar as observações anteriores antes de fabricar.',
    'Metalúrgica BBA LTDA vai conferir o projeto antes da produção.',
  ]
  const result = extrairDadosDeLinhas(['OBSERVAÇÕES', ...expected, 'NOSSAS REDES SOCIAIS'], 'acessorio.pdf')
  assert.deepEqual(result.observacoes, expected)
})

test('observações atravessam páginas sem importar a paginação ou footer do orçamento', () => {
  const result = extrairDadosDeLinhas([
    'OBSERVAÇÕES',
    'Conferir o diâmetro externo.',
    'PÁGINA 1 DE 3',
    'Orçamento 2026-3029 · Branorte BBA',
    'Conferir os furos de fixação.',
    'Orçamento 2026-3029 · Branorte BBA Página 2 de 3',
    'Confirmar a espessura.',
    'NOSSAS REDES SOCIAIS',
  ], 'acessorio.pdf')
  assert.deepEqual(result.observacoes, [
    'Conferir o diâmetro externo.',
    'Conferir os furos de fixação.',
    'Confirmar a espessura.',
  ])
})

test('referência a observações no meio de uma frase não abre uma seção', () => {
  const result = extrairDadosDeLinhas([
    'Cliente precisa confirmar as observações antes da produção.',
    'NOSSAS REDES SOCIAIS',
    'Instagram: @branorte_metalurgica',
  ], 'acessorio.pdf')
  assert.deepEqual(result.observacoes, [])
})

test('assinatura em tabela DOCX não entra nas observações lidas pelo Mammoth', async () => {
  const doc = new Document({ sections: [{ children: [
    new Paragraph('Observações'),
    new Paragraph('Confirmar as medidas antes de fabricar.'),
    new Table({ rows: [new TableRow({ children: [
      new TableCell({ children: [new Paragraph('Metalúrgica BBA LTDA')] }),
      new TableCell({ children: [new Paragraph('Carlos Hobold')] }),
    ] })] }),
  ] }] })
  const blob = await Packer.toBlob(doc)
  const result = await extrairLocalComMammoth(new File([blob], 'acessorio.docx'))
  assert.deepEqual(result.observacoes, ['Confirmar as medidas antes de fabricar.'])
})

test('assinatura com separador de colunas encerra observações', () => {
  const result = extrairDadosDeLinhas([
    'OBSERVAÇÕES',
    'Confirmar as medidas antes de fabricar.',
    'Metalúrgica BBA LTDA | Carlos Hobold',
  ], 'acessorio.docx')
  assert.deepEqual(result.observacoes, ['Confirmar as medidas antes de fabricar.'])
})
