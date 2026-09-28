import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { montarItensFiname, classificarItemFiname, FINAME_TIPOS } from './finame'

// Tabela que o banco mandou (cadastro do Portal BNDES, 28/09/2026): Código / Nome / Modelo.
const CADASTRO_BNDES: Array<[string, string, string]> = [
  ['04328489', 'CAÇAMBA DE PESAGEM', 'BNCP1900 - BNCP1900I'],
  ['03617124', 'CAIXA DE ARMAZENAGEM', 'BNCX200'],
  ['03648162', 'TRANSPORTADOR HELICOIDAL', 'BNTH350'],
  ['03637657', 'ELEVADOR DE CANECAS', 'BNEC600'],
  ['03629482', 'PENEIRA VIBRATÓRIA', 'BNML550'],
  ['03625516', 'MOINHO MARTELO', 'BNMM650'],
  ['03590150', 'MISTURADOR VERTICAL', 'BNMV-500'],
]

const item = (uid: string, nome: string, categoria: string, specs: string[] = []) => ({
  uid, nome, categoria, qtd: 1, subtotal: 10000, motorValor: 0, specs,
})

describe('FINAME — nome e modelo iguais ao cadastro do BNDES', () => {
  it('cada código sai com o nome e o modelo do cadastro', () => {
    for (const [codigo, nome, modelo] of CADASTRO_BNDES) {
      const t = FINAME_TIPOS.find(x => x.codigo === codigo)
      assert.ok(t, codigo)
      assert.equal(t!.nome.toUpperCase(), `${nome} - MODELO ${modelo}`)
    }
    assert.equal(FINAME_TIPOS.length, CADASTRO_BNDES.length)
  })

  it('a linha leva código + modelo do BNDES e perde o modelo comercial do catálogo', () => {
    const r = montarItensFiname(
      [item('a', 'Caixa 3.900 kg', 'CAIXA', ['Capacidade: 3.900 kg', 'Modelo: BNCX1236/3900'])],
      0,
    )
    assert.equal(r.bloqueios.length, 0)
    assert.equal(r.itens[0].nomeFiname, 'Caixa de Armazenagem - Modelo BNCX200')
    assert.equal(r.itens[0].specs[0], 'Código FINAME: 03617124 · Modelo: BNCX200.')
    assert.ok(r.itens[0].specs.includes('Capacidade: 3.900 kg'))
    assert.equal(r.itens[0].specs.some(s => /BNCX1236/.test(s)), false)
  })

  it('reabrir um orçamento já FINAME não duplica a linha do código', () => {
    const r1 = montarItensFiname([item('a', 'Misturador Vertical 500 kg', 'MISTURADOR', ['Capacidade: 500 kg'])], 0)
    const salvo = r1.itens[0]
    const r2 = montarItensFiname([item('a', salvo.nomeFiname, 'MISTURADOR', salvo.specs)], 0)
    assert.deepEqual(r2.itens[0].specs, salvo.specs)
    assert.equal(r2.itens[0].nomeFiname, 'Misturador Vertical - Modelo BNMV-500')
  })

  it('misturador horizontal não tem cadastro: bloqueia, mas o vendedor pode forçar', () => {
    assert.equal(classificarItemFiname('Misturador Horizontal de 1000 kg', 'MISTURADOR').tipo, 'naoResolvido')
    // o painel oferece o botão de um clique "Sair como Misturador Vertical"
    const travado = montarItensFiname([item('h', 'Misturador Horizontal de 500 kg', 'MISTURADOR')], 0)
    assert.equal(travado.classificacoes[0].sugeridoKey, 'MISTURADOR')
    assert.ok(travado.classificacoes[0].motivo)
    const forcado = montarItensFiname(
      [item('h', 'Misturador Horizontal de 1000 kg', 'MISTURADOR')], 0, { h: 'MISTURADOR' },
    )
    assert.equal(forcado.bloqueios.length, 0)
  })

  it('misturador vertical e silo misturador continuam como Misturador Vertical', () => {
    for (const nome of ['Misturador Vertical 1000 kg', 'Silo Misturador Y 50 kg — Inox']) {
      const c = classificarItemFiname(nome, 'MISTURADOR')
      assert.equal(c.tipo === 'principal' && c.fin.codigoFiname, '03590150')
    }
  })
})
