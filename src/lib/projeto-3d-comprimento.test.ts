import assert from 'node:assert/strict'
import test from 'node:test'
import { materializeProjeto3DOrcamento } from './projeto-3d-orcamento'
import { resolverVinculoProjeto3D } from './projeto-3d-orcamento-integracao'

test('cobrar a medida de 7 m preserva os 6,8 m reais na descrição e explicita a referência de preço', () => {
  const original = materializeProjeto3DOrcamento({version:1,exportId:'medida-personalizada-123',projectId:'project',projectName:'Projeto',clientName:'',items:[{sourceId:'alongado',floorId:'piso',floorName:'Térreo',catalogId:'branorte_chupim_160x3_5malt1',kind:'equipment',sequence:1,name:'TRANSPORTADOR HELICOIDAL 160 X 6,8 M',quantity:2,specifications:[]}]})[0]
  const linked = resolverVinculoProjeto3D(original, {nome:'TRANSPORTADOR HELICOIDAL 160 X 7 M',catalogo_id:12,preco_branorte_id:31,valor:7926,specs:['Diâmetro: 160 mm','Comprimento: 7 metros.']})
  assert.equal(linked.nome, 'TRANSPORTADOR HELICOIDAL 160 X 6,8 M')
  assert.equal(linked.qtd, 2)
  assert.deepEqual(linked.specs, ['Diâmetro: 160 mm','Comprimento: 6,8 metros.','Referência de preço: transportador de 7 m (próxima medida da tabela).'])
  assert.equal(linked.preco_branorte_id,31)
  assert.equal(linked.valor,7926)
})
