import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'

const resolver = await import('./projeto-3d-conjuntos').catch(() => null)
const sourceName = 'Caixa 6m³ + Ensacadeira (sem Chupim)'
const origin: OrigemProjeto3D = {
  exportId: 'transfer-1', projectId: 'project-1', projectName: 'Fábrica',
  floorId: 'floor-1', floorName: 'Térreo', sourceId: 'piece-1', kind: 'equipment',
  catalogId: 'branorte_caixa_6m3_ensacadeira_sm_chupim', sequence: 4, sourceName,
  sourceSpecifications: ['Projeto L × P × A: 3,12 × 2,54 × 3,36 m'], resolution: 'pendente',
}
const line = (patch: Partial<OrigemProjeto3D> = {}) => ({ nome: sourceName, origem_projeto3d: { ...origin, ...patch } })
const product = (patch: Partial<CatalogoItem>): CatalogoItem => ({
  id: 901, categoria: 'CAIXA', subcategoria: null, nome_curto: 'Caixa de Ração 4 Ton', nome_completo: 'Caixa de Ração 4 Ton',
  specs: ['Caixa com 1 divisória (2 Compartimentos)', 'Capacidade: 4 toneladas (~6,2 m³ — densidade de ração pronta 0,65)'],
  capacidade_kg: 4000, capacidade_litros: 6154, potencia_cv: null, motor_padrao_cv: null, motor_padrao_polos: null,
  motor_padrao_qtd: 1, valor: 20301, imagem_url: null, ativo: true, ordem: 0, ocorrencias: 0, is_oficial: true,
  foto_url: '/caixa-atual.jpg', descricao: null, acessorios_relacionados_ids: [], usa_inversor: false,
  funcao_opcoes: [], tamanho_codigo: null, ocultar_funcao_no_pdf: false, motor_id: null, preco_branorte_id: 8801, motores_extras: [], ...patch,
})
const box = () => product({})
const bagger = () => product({
  id: 902, categoria: 'ENSACADEIRA', nome_curto: 'ENSACADEIRA SEMI AUTOMATICA', nome_completo: 'ENSACADEIRA SEMI AUTOMATICA',
  specs: ['Construída em aço galvanizado', 'Diâmetro: 160 mm', 'Comprimento 2 m', 'Capacidade de ensaque de 10 kg a 60 kg por sacaria', 'Acionamento: Motorredutor 1,5 CV (incluso)'],
  capacidade_kg: 10, capacidade_litros: null, potencia_cv: 1.5, motor_padrao_cv: 1.5, motor_padrao_polos: 4,
  valor: 30102, foto_url: '/ensacadeira-atual.jpg', usa_inversor: true, motor_id: 17, preco_branorte_id: 8802,
})
const resolve = (source: ReturnType<typeof line>, catalog: CatalogoItem[]) => {
  assert.ok(resolver, 'o resolvedor de componentes do conjunto deve existir')
  return resolver.encontrarComponentesConjuntoProjeto3D(source, catalog)
}

test('conjunto de 6 m³ usa a família Caixa de Ração 4 Ton confirmada e ensacadeira padrão', () => {
  const currentBox = box(), currentBagger = bagger(), source = line()
  const before = structuredClone(source)
  const result = resolve(source, [currentBagger,
    product({ id: 659, nome_curto: 'Caixa 3.900 kg', nome_completo: 'Caixa 3.900 kg', capacidade_kg: 3900, capacidade_litros: 6000 }),
    product({ id: 821, nome_curto: 'Caixa de Ração Pronta 4 Ton (1 saída)', nome_completo: 'Caixa de Ração Pronta 4 Ton (1 saída)' }),
    currentBox])
  assert.deepEqual(result?.map(item => [item.id, item.preco_branorte_id, item.valor]), [[901, 8801, 20301], [902, 8802, 30102]])
  assert.equal(result?.[0], currentBox)
  assert.equal(result?.[1], currentBagger)
  assert.deepEqual(source, before)
})

test('cadastro e preços atualizados são retornados sem depender dos ids históricos', () => {
  const currentBox = product({ id: 4001, preco_branorte_id: 9901, valor: 43021 })
  const currentBagger = { ...bagger(), id: 4002, preco_branorte_id: 9902, valor: 55032 }
  assert.deepEqual(resolve(line(), [currentBox, currentBagger]), [currentBox, currentBagger])
})

test('faltando um componente válido o conjunto inteiro permanece pendente', () => {
  for (const catalog of [[], [box()], [bagger()], [box(), { ...bagger(), ativo: false }], [box(), { ...bagger(), is_oficial: false }], [{ ...box(), ativo: false }, bagger()], [{ ...box(), is_oficial: false }, bagger()]]) {
    assert.equal(resolve(line(), catalog), null)
  }
})

test('duplicatas de qualquer componente tornam a composição ambígua', () => {
  const currentBox = box(), currentBagger = bagger()
  for (const catalog of [[currentBox, { ...currentBox }, currentBagger], [currentBox, currentBagger, { ...currentBagger, id: 999 }]]) {
    assert.equal(resolve(line(), catalog), null)
    assert.equal(resolve(line(), [...catalog].reverse()), null)
  }
})

test('referência CAD, origem, nome e capacidade do conjunto devem continuar exatos', () => {
  for (const patch of [
    { catalogId: 'branorte_caixa_6m3_ensacadeira' }, { catalogId: null }, { kind: 'manual' as const },
    { resolution: 'vinculado' as const }, { resolution: 'manual' as const },
    { sourceName: 'Caixa 8m³ + Ensacadeira (sem Chupim)' },
    { sourceName: 'Caixa 6m³ + Ensacadeira (com Chupim)' },
    { sourceName: `${sourceName} inox` }, { sourceName: `${sourceName} valvulada` },
    { sourceSpecifications: ['Capacidade: 8 m³'] }, { sourceSpecifications: ['Caixa 8000 litros'] },
    { sourceSpecifications: ['Equipamento: Caixa 8m³ + Ensacadeira (sem Chupim)'] },
    { sourceSpecifications: ['Ensacadeira valvulada'] }, { sourceSpecifications: ['Construída em aço inox'] },
  ]) assert.equal(resolve(line(patch), [box(), bagger()]), null, JSON.stringify(patch))
  assert.equal(resolver!.encontrarComponentesConjuntoProjeto3D({ nome: sourceName }, [box(), bagger()]), null)
})

test('caixa genérica, outros tamanhos e variantes não substituem a Caixa de Ração 4 Ton', () => {
  for (const patch of [
    { capacidade_litros: null }, { capacidade_litros: 3900 }, { capacidade_litros: 8000 }, { capacidade_kg: 3900 },
    { categoria: 'SILO' }, { nome_completo: 'Caixa 3.900 kg inox' }, { subcategoria: 'INOX' },
    { specs: ['Capacidade: 8.000 litros'] }, { nome_curto: 'Caixa 8 m³' },
    { nome_curto: 'Caixa 3.900 kg', nome_completo: 'Caixa 3.900 kg', capacidade_litros: 6000, capacidade_kg: 3900 },
    { nome_curto: 'Caixa de Ração 2 Ton', nome_completo: 'Caixa de Ração 2 Ton', capacidade_litros: 3077, capacidade_kg: 2000 },
    { nome_curto: 'Caixa de Ração 5 Ton', nome_completo: 'Caixa de Ração 5 Ton', capacidade_litros: 7692, capacidade_kg: 5000 },
    { nome_curto: 'Caixa de Ração Pronta 4 Ton (1 saída)', nome_completo: 'Caixa de Ração Pronta 4 Ton (1 saída)' },
    { specs: ['Caixa com 1 compartimento único (sem divisória) — 1 saída'] },
  ]) assert.equal(resolve(line(), [product(patch), bagger()]), null, JSON.stringify(patch))
})

test('ensacadeira valvulada, adaptação e inox não são o componente padrão de saco aberto', () => {
  for (const patch of [
    { nome_curto: 'ENSACADEIRA VALVULADA SEMI AUTOMATICA', nome_completo: 'ENSACADEIRA VALVULADA SEMI AUTOMATICA' },
    { nome_completo: 'ENSACADEIRA SEMI AUTOMATICA (ADAPTAÇÃO)' },
    { specs: ['Modelo para saco valvulado'] }, { specs: ['Construída em aço inox 304'] }, { subcategoria: 'ADAPTACAO' }, { categoria: 'ACESSORIO' },
  ]) assert.equal(resolve(line(), [box(), { ...bagger(), ...patch }]), null, JSON.stringify(patch))
})
