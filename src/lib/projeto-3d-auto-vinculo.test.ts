import assert from 'node:assert/strict'
import test from 'node:test'
import type { CatalogoItem } from '../hooks/useCatalogo'
import { resolverVinculoProjeto3D } from './projeto-3d-orcamento-integracao'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'

const integration = await import('./projeto-3d-auto-vinculo').catch(() => null)

function catalogo(id: number, nome: string, patch: Partial<CatalogoItem> = {}): CatalogoItem {
  return {
    id, categoria: 'MOINHO', subcategoria: 'MARTELO', nome_curto: nome, nome_completo: nome,
    specs: ['Acionamento: 20 CV (motor incluso)'], capacidade_kg: null, capacidade_litros: null,
    potencia_cv: 20, motor_padrao_cv: 20, motor_padrao_polos: 2, motor_padrao_qtd: 1,
    valor: 12000, imagem_url: null, ativo: true, ordem: 1, ocorrencias: 0, is_oficial: true,
    foto_url: 'https://example.com/moinho.jpg', descricao: null, acessorios_relacionados_ids: [],
    usa_inversor: false, funcao_opcoes: [], tamanho_codigo: null, ocultar_funcao_no_pdf: false,
    motor_id: null, preco_branorte_id: null, motores_extras: [], ...patch,
  }
}

function linha(uid: string, nome: string, sequence: number, patch: Partial<OrigemProjeto3D> = {}) {
  return {
    uid, nome, nome_custom: null, specs: ['Medida original do projeto'], qtd: 3,
    valor: 0, valor_original: 0, catalogo_id: -1, categoria: 'PROJETO3D',
    motor_cv: null, motor_polos: null, motor_qtd: 0, motor_valor_unit: 0, foto_url: null,
    origem_projeto3d: {
      exportId: 'export-1234567890', projectId: 'projeto', projectName: 'Layout',
      floorId: 'terreo', floorName: 'Térreo', sourceId: uid, catalogId: 'cad-moinho',
      kind: 'equipment' as const, sequence, sourceName: nome,
      sourceSpecifications: ['Medida original do projeto'], resolution: 'pendente' as const,
      ...patch,
    },
  }
}

type Linha = ReturnType<typeof linha>

function vincular(original: Linha, item: CatalogoItem): Linha {
  return resolverVinculoProjeto3D(original, {
    ...original, nome: item.nome_curto, uid: 'novo-id-descartado', qtd: 1,
    catalogo_id: item.id, categoria: item.categoria, specs: item.specs,
    valor: Number(item.valor), valor_original: Number(item.valor), foto_url: item.foto_url,
  }, { motorIncluso: true })
}

test('correspondência única preenche o vínculo mantendo identidade, sequência e quantidade de cada peça', () => {
  assert.ok(integration, 'a integração automática deve existir')
  const original = [linha('primeiro', 'MOINHO MARTELO 20 CV', 1), linha('segundo', 'MOINHO MARTELO 20 CV', 2, { floorId: 'mezanino', floorName: 'Mezanino' })]
  const before = JSON.stringify(original)
  const result = integration.autoVincularProjeto3D(original, [catalogo(17, 'MOINHO MARTELO 20 CV')], vincular)
  assert.deepEqual(result.map(item => [item.uid, item.qtd, item.origem_projeto3d.sequence, item.origem_projeto3d.floorId]), [['primeiro', 3, 1, 'terreo'], ['segundo', 3, 2, 'mezanino']])
  assert.deepEqual(result.map(item => [item.catalogo_id, item.valor, item.origem_projeto3d.resolution]), [[17, 12000, 'vinculado'], [17, 12000, 'vinculado']])
  assert.equal(result[0].foto_url, 'https://example.com/moinho.jpg')
  assert.deepEqual(result[0].specs, ['Medida original do projeto', 'Acionamento: 20 CV (motor incluso)'])
  assert.equal(JSON.stringify(original), before, 'o rascunho de entrada não é alterado')
})

test('rascunhos preservam vínculo já conferido, valor manual e item sem origem de projeto', () => {
  assert.ok(integration)
  const manual = { ...linha('manual', 'MOINHO MARTELO 20 CV', 1, { resolution: 'manual' }), valor: 17000 }
  const linked = { ...linha('vinculado', 'MOINHO MARTELO 20 CV', 2, { resolution: 'vinculado' }), catalogo_id: 99, valor: 19000 }
  const ordinary = { ...linha('comum', 'MOINHO MARTELO 20 CV', 3), origem_projeto3d: undefined }
  const result = integration.autoVincularProjeto3D([manual, linked, ordinary], [catalogo(17, 'MOINHO MARTELO 20 CV')], (item, entry) => ({ ...item, valor: entry.valor }))
  assert.equal(result[0], manual)
  assert.equal(result[1], linked)
  assert.equal(result[2], ordinary)
  assert.deepEqual(result.map(item => item.valor), [17000, 19000, 0])
})

test('linha manual do projeto não recebe vínculo só por ter nome igual ao cadastro', () => {
  assert.ok(integration)
  const original = linha('digitado', 'MOINHO MARTELO 20 CV', 1, { kind: 'manual' })
  const result = integration.autoVincularProjeto3D([original], [catalogo(17, 'MOINHO MARTELO 20 CV')], vincular)
  assert.equal(result[0], original)
  assert.equal(result[0].origem_projeto3d.resolution, 'pendente')
})

test('falha de preço em uma linha mantém a pendência e não impede o vínculo da próxima', () => {
  assert.ok(integration)
  const invalid = linha('sem-preco', 'MOINHO MARTELO 10 CV', 1)
  const valid = linha('com-preco', 'MOINHO MARTELO 20 CV', 2)
  const result = integration.autoVincularProjeto3D([invalid, valid], [catalogo(10, 'MOINHO MARTELO 10 CV', { valor: 0 }), catalogo(20, 'MOINHO MARTELO 20 CV')], vincular)
  assert.equal(result[0], invalid)
  assert.equal(result[0].origem_projeto3d.resolution, 'pendente')
  assert.equal(result[1].catalogo_id, 20)
  assert.equal(result[1].origem_projeto3d.resolution, 'vinculado')
})

test('equipamentos sem correspondência ou com dois cadastros equivalentes continuam pendentes', () => {
  assert.ok(integration)
  const missing = linha('desconhecido', 'MOINHO MARTELO 100 CV', 1)
  const ambiguous = linha('duplicado', 'MOINHO MARTELO 20 CV', 2)
  const result = integration.autoVincularProjeto3D([missing, ambiguous], [catalogo(17, 'MOINHO MARTELO 20 CV'), catalogo(18, 'MOINHO MARTELO 20 CV')], vincular)
  assert.equal(result[0], missing)
  assert.equal(result[1], ambiguous)
  assert.deepEqual(result.map(item => item.catalogo_id), [-1, -1])
})

test('lista vazia não acrescenta equipamentos, acessórios ou componentes ao orçamento', () => {
  assert.ok(integration)
  assert.deepEqual(integration.autoVincularProjeto3D([], [catalogo(17, 'MOINHO MARTELO 20 CV')], vincular), [])
})

test('descrição editada diretamente no rascunho pendente não é substituída pelo vínculo automático', () => {
  assert.ok(integration)
  const original = { ...linha('descricao-editada', 'MOINHO MARTELO 20 CV', 1), specs: ['Construção especial conferida pelo vendedor'] }
  const result = integration.autoVincularProjeto3D([original], [catalogo(17, 'MOINHO MARTELO 20 CV')], vincular)
  assert.equal(result[0], original)
  assert.deepEqual(result[0].specs, ['Construção especial conferida pelo vendedor'])
  assert.equal(result[0].origem_projeto3d.resolution, 'pendente')
})

test('reordenar ou retirar especificações de linha pendente também preserva a edição manual', () => {
  assert.ok(integration)
  for (const specs of [['Segunda observação', 'Primeira observação'], []]) {
    const original = { ...linha('descricao-reordenada', 'MOINHO MARTELO 20 CV', 1, { sourceSpecifications: ['Primeira observação', 'Segunda observação'] }), specs }
    const result = integration.autoVincularProjeto3D([original], [catalogo(17, 'MOINHO MARTELO 20 CV')], vincular)
    assert.equal(result[0], original)
  }
})

test('foto já escolhida na linha pendente não é trocada pela foto do catálogo', () => {
  assert.ok(integration)
  const original = { ...linha('foto-editada', 'MOINHO MARTELO 20 CV', 1), foto_url: 'https://example.com/foto-do-cliente.jpg' }
  const result = integration.autoVincularProjeto3D([original], [catalogo(17, 'MOINHO MARTELO 20 CV')], item => ({ ...item, foto_url: 'https://example.com/moinho.jpg', valor: 12000 }))
  assert.equal(result[0], original)
  assert.equal(result[0].foto_url, 'https://example.com/foto-do-cliente.jpg')
})

test('valor editado diretamente em linha pendente não é sobrescrito mesmo sem confirmação no painel', () => {
  assert.ok(integration)
  for (const [valor, valor_original] of [[17500, 0], [0, 17500]]) {
    const original = { ...linha('preco-editado', 'MOINHO MARTELO 20 CV', 1), valor, valor_original }
    const result = integration.autoVincularProjeto3D([original], [catalogo(17, 'MOINHO MARTELO 20 CV')], vincular)
    assert.equal(result[0], original)
    assert.equal(result[0].valor, valor)
    assert.equal(result[0].valor_original, valor_original)
    assert.equal(result[0].origem_projeto3d.resolution, 'pendente')
  }
})
