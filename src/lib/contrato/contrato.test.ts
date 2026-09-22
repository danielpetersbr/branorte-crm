// Teste com um orcamento REAL (2026 - 2774, id 2066) copiado do banco.
// Cobre o que quebra na vida real: desconto que nao estava no total gravado,
// motores que saem em bloco proprio, parcela "no pedido" que vira entrada e
// vencimento calculado a partir do prazo de entrega em dias uteis.

import { describe, it, expect } from 'vitest'
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
    expect(numeroPorExtenso(1000)).toBe('mil')
    expect(numeroPorExtenso(100)).toBe('cem')
    expect(numeroPorExtenso(182524)).toBe('cento e oitenta e dois mil, quinhentos e vinte e quatro')
  })

  it('escreve valor com centavos', () => {
    expect(valorPorExtenso(22816)).toBe('vinte e dois mil, oitocentos e dezesseis reais')
    expect(valorPorExtenso(1.5)).toBe('um real e cinquenta centavos')
    expect(valorPorExtenso(42700.2)).toBe('quarenta e dois mil e setecentos reais e vinte centavos')
  })
})

describe('contrato a partir do orcamento 2026-2774', () => {
  const d = contratoDoOrcamento(ORC_2774)

  it('usa o preco COM desconto — e nao o total bruto gravado', () => {
    expect(d.totalBruto).toBe(53945.2)
    expect(d.descontoValor).toBe(11245)
    expect(d.valorTotal).toBe(42700.2)
  })

  it('fecha a conta: soma das linhas = preco do contrato', () => {
    expect(Math.abs(d.somaItens - d.valorTotal)).toBeLessThan(0.05)
  })

  it('traz os motores como linha propria', () => {
    const motores = d.itens.find(i => i.descricao.startsWith('Motores'))
    expect(motores).toBeTruthy()
    expect(motores!.valorLinha).toBe(8976)
    expect(motores!.descricao).toContain('2 CV 4 polos')
  })

  it('NAO diz "motor incluso" quando o motor e cobrado a parte', () => {
    const triturador = d.itens.find(i => i.descricao.startsWith('TRITURADOR'))!
    expect(triturador.descricao).toContain('motor orçado à parte')
    expect(triturador.descricao).not.toContain('incluso')
  })

  it('escreve CV com virgula, como em pt-BR', () => {
    const mist = d.itens.find(i => i.descricao.startsWith('MISTURADOR'))!
    expect(mist.descricao).toContain('1,5 CV')
    expect(mist.descricao).not.toContain('1.5 CV')
  })

  it('leva acessorios e componentes extras pra tabela', () => {
    expect(d.itens.some(i => i.descricao.startsWith('Acessórios'))).toBe(true)
    expect(d.itens.some(i => i.descricao.includes('Painel Elétrico'))).toBe(true)
  })

  it('a parcela "no pedido" vira entrada e sobram 4 parcelas', () => {
    expect(d.entrada).toBeTruthy()
    expect(d.entrada!.valor).toBe(8540.03)
    expect(d.entrada!.vencimento).toBe('22/09/2026')
    expect(d.parcelas).toHaveLength(4)
  })

  it('calcula vencimento com prazo de entrega em dias uteis', () => {
    // 22/09/2026 + 60 dias uteis = 15/12/2026 (na NF)
    expect(d.parcelas[0].vencimento).toBe('15/12/2026')
    // +30 dias uteis depois da NF
    expect(d.parcelas[1].vencimento).toBe('26/01/2027')
  })

  it('a soma de entrada + parcelas fecha com o preco', () => {
    const soma = d.entrada!.valor + d.parcelas.reduce((s, p) => s + p.valor, 0)
    expect(Math.abs(soma - d.valorTotal)).toBeLessThan(0.05)
  })

  it('le prazo, frete e montagem do orcamento', () => {
    expect(d.prazoEntrega).toBe('60')
    expect(d.prazoTipo).toBe('úteis')
    expect(d.freteFob).toBe(true)
    expect(d.montagemInclusa).toBe(false)
  })

  it('aponta o que falta preencher', () => {
    const faltam = camposPendentes(d)
    expect(faltam).toContain('CNPJ do comprador')
    expect(faltam).toContain('Nome da mãe')
    expect(faltam).toContain('Nome do garantidor')
  })
})
