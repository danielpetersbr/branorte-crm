// Teste com um orcamento REAL (2026 - 2774, id 2066) copiado do banco.
// Cobre o que quebra na vida real: desconto que nao estava no total gravado,
// motores que saem em bloco proprio, parcela "no pedido" que vira entrada e
// vencimento calculado a partir do prazo de entrega em dias uteis.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { contratoDoOrcamento, camposPendentes } from './contrato-dados'
import { valorPorExtenso, numeroPorExtenso } from './extenso'
import type { OrcamentoGerado } from '@/hooks/useOrcamentoBuilder'

const ORC_2774 = {
  id: 2066,
  numero: '2026 - 2774',
  ano: 2026,
  sequencial: 2774,
  data_emissao: '2026-09-17',
  data_venda: '2026-09-22',
  vendedor_nome: 'LUCAS',
  cliente_id: 1765,
  cliente_nome: 'Warley',
  cliente_dados: { fone: '(31) 9647-9491', ie_tipo: 'estadual' },
  voltagem: 'monofasico',
  itens: [
    { letra: 'A', qtd: 1, nome: 'TRANSPORTADOR HELICOIDAL 160 X 2,80 M (Alimentação do moinho)', specs: [], valor: 4820, motor_cv: 2, motor_polos: 4, motor_qtd: 1, motor_valor_unit: 3190 },
    { letra: 'B', qtd: 1, nome: 'TRITURADOR DE GRÃOS 7,5 CV', specs: [], valor: 12124.2, motor_cv: 3, motor_polos: 2, motor_qtd: 1, motor_valor_unit: 3250 },
    { letra: 'C', qtd: 1, nome: 'MISTURADOR VERTICAL 300 LITROS (150 kg)', specs: [], valor: 6437, motor_cv: 1.5, motor_polos: 4, motor_qtd: 1, motor_valor_unit: 2536 },
  ],
  acessorios: {
    items: ['Fixação para chupim 160', 'Boca de alimentação para chupim 160', 'Boca de descarga para chupim 160', 'Boca de descarga moinho', 'Base da fábrica'],
    valor: 3508,
  },
  motores: [
    { cv: 2, polos: 4, valor: 3190, motorredutor: false },
    { cv: 3, polos: 2, valor: 3250, motorredutor: false },
    { cv: 1.5, polos: 4, valor: 2536, motorredutor: false },
  ],
  componentes_extras: [
    { id: 'cx-1', nome: 'Célula de Carga', valor: 8080 },
    { id: 'cx-2', nome: 'Painel Elétrico Mini Fábrica Compacta JR (30150)', valor: 10000 },
  ],
  montagem: null,
  motores_avulsos: null,
  desconto: { tipo: 'valor', valor: 11245 },
  parcelas: [
    { id: 'p1', valor: 8540.03, metodo: 'PIX', dataTipo: 'no_pedido' },
    { id: 'p2', valor: 8540.03, metodo: 'PIX', dataTipo: 'na_nf' },
    { id: 'p3', dias: 30, valor: 8540.03, metodo: 'BOLETO', dataTipo: 'apos_nf' },
    { id: 'p4', dias: 60, valor: 8540.03, metodo: 'BOLETO', dataTipo: 'apos_nf' },
    { id: 'p5', valor: 8540.08, metodo: 'BOLETO', dataTipo: 'na_nf' },
  ],
  total_equipamentos: 26889.2,
  total_motores: 8976,
  total_proposta: 53945.2,
  prazo_entrega: '60 dias (úteis)',
  frete_tipo: 'FOB',
  tensao_motores: 220,
  status: 'enviado',
} as unknown as OrcamentoGerado

describe('extenso', () => {
  it('escreve numero redondo e composto', () => {
    assert.equal(numeroPorExtenso(1000), 'mil')
    assert.equal(numeroPorExtenso(100), 'cem')
    assert.equal(numeroPorExtenso(182524), 'cento e oitenta e dois mil, quinhentos e vinte e quatro')
  })

  it('escreve valor com centavos', () => {
    assert.equal(valorPorExtenso(22816), 'vinte e dois mil, oitocentos e dezesseis reais')
    assert.equal(valorPorExtenso(1.5), 'um real e cinquenta centavos')
    assert.equal(valorPorExtenso(42700.2), 'quarenta e dois mil e setecentos reais e vinte centavos')
  })
})

describe('contrato a partir do orcamento 2026-2774', () => {
  const d = contratoDoOrcamento(ORC_2774)

  it('usa o preco COM desconto — e nao o total bruto gravado', () => {
    assert.equal(d.totalBruto, 53945.2)
    assert.equal(d.descontoValor, 11245)
    assert.equal(d.valorTotal, 42700.2)
  })

  it('fecha a conta: soma das linhas = preco do contrato', () => {
    assert.ok(Math.abs(d.somaItens - d.valorTotal) < 0.05)
  })

  it('traz os motores como linha propria', () => {
    const motores = d.itens.find(i => i.descricao.startsWith('Motores'))
    assert.ok(motores)
    assert.equal(motores!.valorLinha, 8976)
    assert.ok(motores!.descricao.includes('2 CV 4 polos'))
  })

  it('NAO diz "motor incluso" quando o motor e cobrado a parte', () => {
    const triturador = d.itens.find(i => i.descricao.startsWith('TRITURADOR'))!
    assert.ok(triturador.descricao.includes('motor orçado à parte'))
    assert.ok(!triturador.descricao.includes('incluso'))
  })

  it('escreve CV com virgula, como em pt-BR', () => {
    const mist = d.itens.find(i => i.descricao.startsWith('MISTURADOR'))!
    assert.ok(mist.descricao.includes('1,5 CV'))
    assert.ok(!mist.descricao.includes('1.5 CV'))
  })

  it('leva acessorios e componentes extras pra tabela', () => {
    assert.equal(d.itens.some(i => i.descricao.startsWith('Acessórios')), true)
    assert.equal(d.itens.some(i => i.descricao.includes('Painel Elétrico')), true)
  })

  it('a parcela "no pedido" vira entrada e sobram 4 parcelas', () => {
    assert.ok(d.entrada)
    assert.equal(d.entrada!.valor, 8540.03)
    assert.equal(d.entrada!.vencimento, '22/09/2026')
    assert.equal(d.parcelas.length, 4)
  })

  it('calcula vencimento com prazo de entrega em dias uteis', () => {
    // 22/09/2026 + 60 dias uteis = 15/12/2026 (na NF)
    assert.equal(d.parcelas[0].vencimento, '15/12/2026')
    // +30 dias uteis depois da NF
    assert.equal(d.parcelas[1].vencimento, '26/01/2027')
  })

  it('a soma de entrada + parcelas fecha com o preco', () => {
    const soma = d.entrada!.valor + d.parcelas.reduce((s, p) => s + p.valor, 0)
    assert.ok(Math.abs(soma - d.valorTotal) < 0.05)
  })

  it('le prazo, frete e montagem do orcamento', () => {
    assert.equal(d.prazoEntrega, '60')
    assert.equal(d.prazoTipo, 'úteis')
    assert.equal(d.freteFob, true)
    assert.equal(d.montagemInclusa, false)
  })

  it('aponta o que falta preencher', () => {
    const faltam = camposPendentes(d)
    assert.ok(faltam.includes('CNPJ do comprador'))
    assert.ok(faltam.includes('Estado civil'))
    assert.ok(faltam.includes('Nome do garantidor'))
  })
})

// ── caso real 2026-2629 (Breno): condicao de pagamento escrita A MAO ─────────
// Sem ler o texto, o contrato tratava 10 parcelas como pagamento a vista e
// desligava a reserva de dominio pelo item 3.7.

const ORC_2629 = {
  id: 1918, numero: '2026 - 2629', data_emissao: '2026-09-15', data_venda: null,
  vendedor_nome: 'DANIEL', cliente_id: 1, cliente_nome: 'Breno Fabres Álvares da Cunha',
  cliente_dados: {
    ac: 'Fazenda Sinuelo', ie: '223/1090346', cep: '97870-000', cnpj: '003.691.590-47',
    fone: '(51) 99692-3378', email: 'financeiro@albaagro.com', bairro: 'Interior',
    cidade: 'Santo Antônio das Missões - RS', ie_tipo: 'estadual', endereco: 'VL Itaroquem, s/n',
  },
  itens: [{ letra: 'A', qtd: 1, nome: 'SILO METÁLICO', specs: [], valor: 69662 }],
  motores: [], acessorios: null, montagem: null, motores_avulsos: null,
  componentes_extras: null, desconto: null, parcelas: null, forma_pagamento_cfg: null,
  forma_pagamento: 'R$ 5.000,00 no pedido; R$ 14.700,00 até 10/10/2026; 21/11/2026 R$ 6.000,00 via PIX; saldo restante em boletos: 21/12/2026 R$ 5.000,00; 21/01/2027 R$ 5.000,00; 21/02/2027 R$ 5.000,00; 21/03/2027 R$ 5.000,00; 21/04/2027 R$ 5.000,00; 21/05/2027 R$ 5.000,00; 21/06/2027 R$ 42.823,00 (quitação).',
  total_equipamentos: 69662, total_motores: 28861, total_proposta: 98523,
  prazo_entrega: '60 dias (corridos)', frete_tipo: 'FOB', status: 'enviado',
} as unknown as OrcamentoGerado

describe('orcamento 2026-2629 — condicao escrita a mao', () => {
  const d = contratoDoOrcamento(ORC_2629)

  it('NAO trata venda parcelada como pagamento antecipado', () => {
    assert.equal(d.pagamentoAntecipado, false)
  })

  it('le as 10 parcelas do texto livre e fecha com o preco', () => {
    assert.ok(d.entrada)
    assert.equal(d.entrada!.valor, 5000)
    assert.equal(d.parcelas.length, 9)
    const soma = d.entrada!.valor + d.parcelas.reduce((s, p) => s + p.valor, 0)
    assert.equal(soma, 98523)
  })

  it('pega data e valor de cada parcela', () => {
    assert.equal(d.parcelas[0].vencimento, '10/10/2026'); assert.equal(d.parcelas[0].valor, 14700)
    assert.equal(d.parcelas[1].vencimento, '21/11/2026'); assert.equal(d.parcelas[1].valor, 6000); assert.equal(d.parcelas[1].metodo, 'PIX')
    assert.equal(d.parcelas[8].vencimento, '21/06/2027'); assert.equal(d.parcelas[8].valor, 42823)
  })

  it('separa a UF grudada no nome da cidade', () => {
    assert.equal(d.comprador.cidade, 'Santo Antônio das Missões')
    assert.equal(d.comprador.uf, 'RS')
    assert.equal(d.comarca, 'Santo Antônio das Missões/RS')
  })

  it('pessoa fisica: o CPF do comprador ja preenche o do signatario', () => {
    assert.equal(d.comprador.tipoPessoa, 'pf')
    assert.equal(d.comprador.representante.cpf, '003.691.590-47')
    assert.ok(!camposPendentes(d).includes('CPF do comprador'))
  })

  it('exige garantidor mesmo sem quadro de parcelas', () => {
    assert.equal(d.garantidor.incluir, true)
  })
})

describe('parse que NAO fecha com o preco', () => {
  it('devolve null e o contrato usa o texto original', () => {
    const orc = { ...ORC_2629, forma_pagamento: 'entrada de R$ 1.000,00 e o resto a combinar' } as unknown as OrcamentoGerado
    const d = contratoDoOrcamento(orc)
    assert.equal(d.parcelas.length, 0)
    assert.ok(d.formaPagamentoTexto.includes('a combinar'))
    assert.equal(d.pagamentoAntecipado, false)
  })
})


describe('forma de pagamento herdada e campos opcionais', () => {
  const d = contratoDoOrcamento(ORC_2629)

  it('herda BOLETO do "saldo restante em boletos" pras parcelas seguintes', () => {
    // 21/12, 21/01 ... 21/06 vieram depois de "saldo restante em boletos:"
    const boletos = d.parcelas.filter(p => p.metodo === 'BOLETO')
    assert.equal(boletos.length, 7)
    assert.equal(d.parcelas[8].metodo, 'BOLETO')
  })

  it('mantem PIX onde estava escrito', () => {
    assert.equal(d.parcelas[1].metodo, 'PIX')
  })

  it('nao exige RG, nascimento nem nome da mae', () => {
    const faltam = camposPendentes(d)
    assert.ok(!faltam.includes('RG'))
    assert.ok(!faltam.includes('Data de nascimento'))
    assert.ok(!faltam.includes('Nome da mãe'))
  })
})

describe('data base e garantidor = comprador', () => {
  it('a base do parcelamento e HOJE quando o orcamento nao tem data de venda', () => {
    const d = contratoDoOrcamento(ORC_2629)   // data_venda: null, emissao 15/09
    const hoje = new Date()
    const hojeBR = `${String(hoje.getDate()).padStart(2, '0')}/${String(hoje.getMonth() + 1).padStart(2, '0')}/${hoje.getFullYear()}`
    assert.equal(d.entrada!.vencimento, hojeBR)
    assert.notEqual(d.entrada!.vencimento, '15/09/2026')  // nao usa a data do orcamento
  })

  it('a data do contrato e a de hoje', () => {
    const d = contratoDoOrcamento(ORC_2629)
    const hoje = new Date()
    const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`
    assert.equal(d.dataContrato, iso)
  })

  it('garantidor = comprador nao vira pendencia', () => {
    const d = contratoDoOrcamento(ORC_2629)
    d.garantidor.mesmoQueComprador = true
    const faltam = camposPendentes(d)
    assert.ok(!faltam.includes('Nome do garantidor'))
    assert.ok(!faltam.includes('CPF do garantidor'))
    assert.ok(!faltam.includes('Endereço do garantidor'))
  })
})
