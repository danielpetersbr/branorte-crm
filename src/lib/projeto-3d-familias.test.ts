import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'

const module = await import('./projeto-3d-familias').catch(() => null)
const origin = (sourceName: string, sourceSpecifications: string[] = [], patch: Partial<OrigemProjeto3D> = {}): OrigemProjeto3D => ({ exportId: 'test-export', projectId: 'project', projectName: 'Factory', floorId: 'floor', floorName: 'Floor', sourceId: 'piece', kind: 'equipment', catalogId: 'branorte_native', sequence: 1, sourceName, sourceSpecifications, resolution: 'pendente', ...patch })
const product = (categoria: string, nome: string, specs: string[] = [], patch: Partial<CatalogoItem> = {}) => ({ id: 901, categoria, nome_curto: nome, nome_completo: nome, specs, capacidade_kg: null, capacidade_litros: null, ativo: true, is_oficial: true, ...patch }) as CatalogoItem
const match = (source: OrigemProjeto3D, products: CatalogoItem[]) => { assert.ok(module, 'módulo deve existir'); return module.candidatosFamiliaProjeto3D(source, products) }

test('elevador usa série e altura exatas nos dois formatos comerciais', () => {
  const wanted = product('ELEVADOR', 'Elevador de Caneca 8,0m - 10 ton/h (EC-2310)', ['Modelo: EC-2310', 'Altura de elevação: 8 metros', 'Capacidade: 10 ton/h'])
  assert.deepEqual(match(origin('ELEVADOR CANECA 2310 X 8 M'), [wanted]), [wanted])
  assert.deepEqual(match(origin('BNEC 2310-8', ['Capacidade: 10 t/h']), [wanted]), [wanted])
  assert.deepEqual(match(origin('ELEVADOR CANECA 2310 X 8 M', ['Capacidade: 6 t/h']), [wanted]), [])
  assert.deepEqual(match(origin('ELEVADOR CANECA 5013 X 8 M'), [wanted]), [])
  assert.deepEqual(match(origin('ELEVADOR CANECA 2310 X 8,1 M'), [wanted]), [])
  assert.deepEqual(match(origin('BNEC 2310-8 Q63'), [wanted]), [])
})

test('elevador rejeita dados contraditórios e versões especiais sem equivalência', () => {
  const wanted = product('ELEVADOR', 'Elevador de Caneca 8,0m - 10 ton/h (EC-2310)', ['Modelo: EC-2310', 'Altura de elevação: 8 metros'])
  assert.deepEqual(match(origin('ELEVADOR CANECA 2310 X 8 M'), [{ ...wanted, specs: ['Modelo: EC-5014', 'Altura de elevação: 8 metros'] }]), [])
  assert.deepEqual(match(origin('ELEVADOR CANECA 2310 X 8 M', ['PARAF.']), [wanted]), [])
  assert.deepEqual(match(origin('ELEVADOR CANECA 2310 X 8 M', ['TOTAL']), [wanted]), [wanted])
})

test('pré-limpeza usa capacidade nominal PL e distingue peneira vibratória', () => {
  const wanted = product('PRE_LIMPEZA', 'Máquina Pré-Limpeza para Milho 7,0 TN/h', ['Capacidade 7,0 t/h (considerando o grão de milho inteiro)', 'Equipamento galvanizado.'])
  assert.deepEqual(match(origin('Pre Limpeza 7 Ton PL7T'), [wanted]), [wanted])
  assert.deepEqual(match(origin('Pré Limpeza 7 Ton PL7T Com Base'), [wanted]), [wanted])
  assert.deepEqual(match(origin('Pre Limpeza 6 Ton'), [wanted]), [])
  assert.deepEqual(match(origin('Pre Limpeza 7 Ton PL3T'), [wanted]), [])
  assert.deepEqual(match(origin('Conj. Base Pre Limpeza'), [wanted]), [])
  assert.deepEqual(match(origin('Pre Limpeza 7 Ton PL7T'), [product('PRE_LIMPEZA', 'PENEIRA VIBRATÓRIA PARA MILHO 7 TN/h')]), [])
})

test('silo exige material explícito e capacidade literal sem conversão por densidade', () => {
  const wanted = product('SILO', 'SILO 42,5 TONELADAS (MILHO)', ['Capacidade: 42,50 toneladas (milho)', 'Volume 56,63 m3'], { capacidade_kg: 42500 })
  assert.deepEqual(match(origin('Silo 42,5 toneladas para milho'), [wanted]), [wanted])
  assert.deepEqual(match(origin('Silo 42,5 toneladas'), [wanted]), [])
  assert.deepEqual(match(origin('Silo 56,63 m³ (milho)'), [wanted]), [])
  assert.deepEqual(match(origin('Silo 42,5 toneladas de ração'), [wanted]), [])
  assert.deepEqual(match(origin('Silo GSI 42,5 toneladas para milho'), [wanted]), [])
  assert.deepEqual(match(origin('Silo 42,5 toneladas para milho'), [{ ...wanted, capacidade_kg: 42000 }]), [])
})

test('caixa usa capacidade explícita, preserva função e não arredonda volume', () => {
  const wanted = product('CAIXA', 'Caixa 7.800 kg', ['Capacidade: 12.000 litros'], { capacidade_kg: 7800, capacidade_litros: 12000 })
  assert.deepEqual(match(origin('Cx. 12m³'), [wanted]), [wanted])
  assert.deepEqual(match(origin('Cx. 3x2x12m³'), [wanted]), [])
  assert.deepEqual(match(origin('CAIXA DE RAÇÃO PRONTA', ['12 M³']), [wanted]), [])
  assert.deepEqual(match(origin('Cx. 12m³ Paraf.'), [wanted]), [])
  const feed = product('CAIXA', 'Caixa de Ração Pronta 4 Ton (1 saída)', ['1 saída'], { capacidade_kg: 4000, capacidade_litros: 6154 })
  assert.deepEqual(match(origin('Caixa de Ração Pronta 4 toneladas (1 saída)'), [feed]), [feed])
  assert.deepEqual(match(origin('Caixa de Ração Pronta 4 toneladas (1 saída)', ['6 M³']), [feed]), [])
})

test('ensacadeira mantém tecnologia, material e variantes nomeadas', () => {
  const wanted = product('ENSACADEIRA', 'ENSACADEIRA SEMI AUTOMATICA', ['Construída em aço galvanizado', 'Acionamento: Motorredutor 1,5 CV (incluso)'])
  assert.deepEqual(match(origin('ENSACADEIRA SEMI AUTOMATICA', ['SACO ABERTO — ATUALIZADA']), [wanted]), [wanted])
  assert.deepEqual(match(origin('ENSACADEIRA VALVULADA SEMI AUTOMATICA'), [wanted]), [])
  assert.deepEqual(match(origin('ENSACADEIRA SEMI AUTOMATICA', ['INOX 304']), [wanted]), [])
  assert.deepEqual(match(origin('ENSACADEIRA SEMI AUTOMATICA', ['SUPER BAIXA']), [wanted]), [])
})

test('somente um cadastro oficial ativo pode resolver uma família', () => {
  const wanted = product('PRE_LIMPEZA', 'Máquina Pré-Limpeza para Milho 3,0 TN/h')
  const source = origin('Pré Limpeza 3 Ton PL3T')
  const duplicate = { ...wanted, id: 902 }
  assert.deepEqual(match(source, [wanted, duplicate]), [wanted, duplicate])
  assert.deepEqual(match(source, [{ ...wanted, is_oficial: false }, { ...wanted, ativo: false }, wanted]), [wanted])
})

test('manual, custom, desconhecido, conjunto e envelope não viram produto', () => {
  const wanted = product('CAIXA', 'Caixa 7.800 kg', [], { capacidade_litros: 12000 })
  for (const patch of [{ kind: 'manual' as const }, { catalogId: 'custom_one' }, { catalogId: 'unknown' }, { resolution: 'manual' as const }]) assert.deepEqual(match(origin('Cx. 12m³', [], patch), [wanted]), [])
  for (const name of ['Caixa 12m³ + Ensacadeira', 'Fábrica Caixa 12m³', 'Objeto desconhecido', 'Caixa externas L × P × A: 2 × 3 × 2 m']) assert.deepEqual(match(origin(name), [wanted]), [])
  assert.deepEqual(match(origin('Caixa', ['Projeto L × P × A: 12 × 1 × 1 m']), [wanted]), [])
})

test('qualificadores materiais, identidades declaradas e títulos contraditórios bloqueiam vínculo', () => {
  const wanted = product('PRE_LIMPEZA', 'Máquina Pré-Limpeza para Milho 7,0 TN/h')
  assert.deepEqual(match(origin('Pre Limpeza 7 Ton PL7T', ['Equipamento: Pre Limpeza 3 Ton PL3T']), [wanted]), [])
  assert.deepEqual(match(origin('Pre Limpeza 7 Ton PL7T'), [{ ...wanted, nome_curto: 'Máquina Pré-Limpeza para Milho 3 TN/h' }]), [])
  assert.deepEqual(match(origin('Pre Limpeza 7 Ton PL7T'), [{ ...wanted, nome_curto: 'Máquina Pré-Limpeza para Milho 3 TN/h', specs: ['Capacidade: 7 t/h'] }]), [])
  const bagger = product('ENSACADEIRA', 'ENSACADEIRA SEMI AUTOMATICA')
  for (const specification of ['SEM MOTOR', 'PLÁSTICO', 'AÇO CARBONO']) assert.deepEqual(match(origin('ENSACADEIRA SEMI AUTOMATICA', [specification]), [bagger]), [])
})
