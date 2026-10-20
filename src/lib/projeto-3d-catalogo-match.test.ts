import test from 'node:test'
import assert from 'node:assert/strict'
import type { CatalogoItem } from '../hooks/useCatalogo'
import type { OrigemProjeto3D } from './projeto-3d-orcamento'

const matcher = await import('./projeto-3d-catalogo-match').catch(() => null)
const origin: OrigemProjeto3D = { exportId: 'transfer-1', projectId: 'project-1', projectName: 'Fábrica', floorId: 'floor-1', floorName: 'Térreo', sourceId: 'piece-1', kind: 'equipment', catalogId: 'branorte_chupim_160x3_5malt1', sequence: 1, sourceName: 'TRANSPORTADOR HELICOIDAL 160 X 3,5 M', sourceSpecifications: [], resolution: 'pendente' }
const line = (nome = origin.sourceName, patch: Partial<OrigemProjeto3D> = {}) => ({ nome, specs: [], origem_projeto3d: { ...origin, sourceName: nome, ...patch } })
const product = (nome: string, patch: Partial<CatalogoItem> = {}) => ({ id: 91, categoria: 'TRANSPORTADOR', nome_curto: nome, nome_completo: nome, specs: [], ativo: true, is_oficial: true, tamanho_codigo: null, valor: 15001, ...patch }) as CatalogoItem
const match = (item: ReturnType<typeof line>, catalog: CatalogoItem[]) => { assert.ok(matcher, 'matcher comercial deve existir'); return matcher.encontrarCatalogoProjeto3D(item, catalog) }

test('transportador nominal do print vincula a chave comercial sem usar envelope ou preço fixo', () => {
  const wanted = product('TRANSPORTADOR HELICOIDAL 160 X 3,50 M (Alimentação do moinho)', { tamanho_codigo: 'HELICOIDAL_160x3.5', valor: 23456 })
  assert.equal(match(line(), [wanted]), wanted)
  assert.equal(match(line(), [product('TRANSPORTADOR HELICOIDAL 160 X 4,0 M')]), null)
})

test('moinho martelo e triturador de grãos são aliases pela potência explícita em MOINHO', () => {
  const wanted = product('TRITURADOR DE GRÃOS 20 CV', { categoria: 'MOINHO' })
  const source = line('MOINHO MARTELO 20 CV', { catalogId: 'branorte_650_001_01alt3_moinho_martelo_20cv_bnmm20_com_base', sourceSpecifications: ['COM BASE', 'Referência 3D: BNMM20'] })
  assert.equal(match(source, [wanted]), wanted)
  assert.equal(match(source, [product('TRITURADOR DE GRÃOS 30 CV', { categoria: 'MOINHO' })]), null)
  assert.equal(match(source, [product('MOINHO MARTELO 20 CV', { categoria: 'MARTELOS' })]), null)
})

test('somente produto oficial ativo participa; preço permanece o do registro retornado', () => {
  const wanted = product(origin.sourceName)
  assert.equal(match(line(), [product(origin.sourceName, { id: 1, ativo: false }), product(origin.sourceName, { id: 2, is_oficial: false }), wanted]), wanted)
  assert.equal(match(line(), [product(origin.sourceName, { is_oficial: false })]), null)
})

test('dois cadastros compatíveis permanecem ambíguos independentemente da ordem e preço', () => {
  const first = product(origin.sourceName)
  const other = product(origin.sourceName, { id: 92, valor: 100 })
  assert.equal(match(line(), [first, other]), null)
  assert.equal(match(line(), [other, first]), null)
})

test('registros duplicados não são silenciosamente deduplicados pelo id ou nome', () => {
  const first = product(origin.sourceName)
  assert.equal(match(line(), [first, { ...first }]), null)
})

test('calha TH e transportador tubular não são intercambiáveis', () => {
  assert.equal(match(line(), [product('TRANSPORTADOR HELICOIDAL CALHA TH 160 X 3,5 M')]), null)
  const wanted = product('TRANSPORTADOR HELICOIDAL CALHA TH 210 X 8,0 M')
  assert.equal(match(line('TRANSPORTADOR HELICOIDAL CALHA TH 210 X 8 M'), [wanted]), wanted)
})

test('motorredutor, cardan e sem motor são variantes comerciais distintas', () => {
  for (const suffix of ['MOTORREDUTOR', 'ACIONAMENTO PELO CARDAN', 'SEM MOTOR']) {
    assert.equal(match(line(), [product(`${origin.sourceName} ${suffix}`)]), null)
    assert.equal(match(line(`${origin.sourceName} ${suffix}`), [product(origin.sourceName)]), null)
  }
  const wanted = product(`${origin.sourceName} MOTORREDUTOR`)
  assert.equal(match(line(origin.sourceName, { sourceSpecifications: ['MOTORREDUTOR'] }), [wanted]), wanted)
})

test('inox e seu grau não são descartados ou atribuídos a carbono', () => {
  assert.equal(match(line(), [product(`${origin.sourceName} INOX 304`)]), null)
  assert.equal(match(line(`${origin.sourceName} INOX 304`), [product(origin.sourceName)]), null)
  assert.equal(match(line(`${origin.sourceName} INOX 304`), [product(`${origin.sourceName} INOX 316`)]), null)
  const wanted = product(`${origin.sourceName} INOX 304`)
  assert.equal(match(line(`${origin.sourceName} INOX 304`), [wanted]), wanted)
})

test('variante no nome completo é considerada mesmo se o nome curto for genérico', () => {
  assert.equal(match(line(), [product(origin.sourceName, { nome_completo: `${origin.sourceName} INOX 304` })]), null)
})

test('referência CAD e detalhes geométricos não são tomados como nominal comercial', () => {
  const unknown = line('TRANSPORTADOR HELICOIDAL — externas L × P × A: 3,80 × 0,57 × 3,49 m', { catalogId: 'branorte_chupim_misturador', sourceSpecifications: ['ALIMENTAÇÃO DO MISTURADOR', 'Projeto L × P × A: 160 × 3,5 × 4 m'] })
  assert.equal(match(unknown, [product(origin.sourceName)]), null)
  assert.equal(match(line('TRANSPORTADOR HELICOIDAL', { sourceSpecifications: ['Referência 3D: BNTH350', 'Comprimento externo: 3,5 m'] }), [product(origin.sourceName)]), null)
})

test('especificações físicas extras não mudam a medida nominal explícita', () => {
  const wanted = product(origin.sourceName)
  assert.equal(match(line(origin.sourceName, { sourceSpecifications: ['Projeto L × P × A: 0,37 × 0,62 × 3,63 m'] }), [wanted]), wanted)
})

test('manual, custom, item já resolvido e fonte conflitante não são vinculados', () => {
  const wanted = product(origin.sourceName)
  for (const patch of [{ kind: 'manual' as const }, { catalogId: 'custom_my_model' }, { catalogId: null }, { resolution: 'manual' as const }, { resolution: 'vinculado' as const }, { catalogId: 'branorte_650_012_01alt2_moinho_martelo_75cv_com_base' }]) {
    assert.equal(match(line(origin.sourceName, patch), [wanted]), null)
  }
  assert.equal(matcher!.encontrarCatalogoProjeto3D({ nome: wanted.nome_curto }, [wanted]), null)
})

test('nome comercial exato de família não coberta pode vincular sem aproximação', () => {
  const wanted = product('CAIXA DE RAÇÃO PRONTA', { categoria: 'CAIXA' })
  assert.equal(match(line('  Caixa de ração pronta  '), [wanted]), wanted)
  assert.equal(match(line('CAIXA'), [wanted]), null)
})

test('conjuntos de várias máquinas não recebem vínculo de uma máquina ou kit homônimo', () => {
  for (const name of ['Chupim + misturador 900L', 'Moinho 20 CV com misturador', 'Fábrica Compacta 2 201900']) assert.equal(match(line(name), [product(name)]), null)
})

test('misturador distingue orientação, unidade literal e capacidade', () => {
  const wanted = product('MISTURADOR VERTICAL 1900 LITROS (1000 KG)', { categoria: 'MISTURADOR', capacidade_litros: 1900, capacidade_kg: 1000 })
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS'), [wanted]), wanted)
  assert.equal(match(line('MISTURADOR VERTICAL 1900 KG'), [wanted]), null)
  assert.equal(match(line('MISTURADOR HORIZONTAL 1900 LITROS'), [wanted]), null)
  assert.equal(match(line('MISTURADOR VERTICAL 900 LITROS'), [wanted]), null)
})

test('silo misturador e misturador simples não são colapsados', () => {
  const wanted = product('SILO MISTURADOR VERTICAL 1900 LITROS (1000 KG)', { categoria: 'MISTURADOR' })
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS'), [wanted]), null)
  assert.equal(match(line('SILO MISTURADOR VERTICAL 1900 LITROS'), [wanted]), wanted)
})

test('pulmão, secador, plástico e aquecimento são variantes distintas do misturador', () => {
  const name = 'MISTURADOR HORIZONTAL 900 LITROS'
  for (const variant of ['C/PULMÃO', 'SECADOR', 'PARA PLÁSTICO', 'COM AQUECIMENTO']) {
    assert.equal(match(line(name), [product(`${name} ${variant}`, { categoria: 'MISTURADOR' })]), null)
    assert.equal(match(line(`${name} ${variant}`), [product(name, { categoria: 'MISTURADOR' })]), null)
  }
  const wanted = product('MISTURADOR HORIZONTAL C/PULMÃO 900 LITROS (500 KG)', { categoria: 'MISTURADOR' })
  assert.equal(match(line('MISTURADOR HORIZONTAL C/PULMÃO 900 LITROS'), [wanted]), wanted)
})

test('ensacadeiras valvulada e saco aberto não se confundem', () => {
  const wanted = product('ENSACADEIRA VALVULADA SEMI AUTOMATICA', { categoria: 'ENSACADEIRA' })
  assert.equal(match(line('ENSACADEIRA SEMI AUTOMATICA'), [wanted]), null)
  assert.equal(match(line('ENSACADEIRA VALVULADA SEMI AUTOMATICA'), [wanted]), wanted)
})

test('elevador exige modelo e altura nominal iguais sem aproximação', () => {
  const wanted = product('ELEVADOR CANECA 2310 X 6,0 M', { categoria: 'ELEVADOR' })
  assert.equal(match(line('ELEVADOR CANECA 2310 X 6 M'), [wanted]), wanted)
  assert.equal(match(line('ELEVADOR CANECA 5013 X 6 M'), [wanted]), null)
  assert.equal(match(line('ELEVADOR CANECA 2310 X 6,5 M'), [wanted]), null)
})

test('tamanho_codigo conflitante com o título não autoriza vínculo', () => {
  assert.equal(match(line(), [product('TRANSPORTADOR HELICOIDAL 160 X 4 M', { tamanho_codigo: 'HELICOIDAL_160x3.5' })]), null)
})

test('litros só correspondem ao registro em kg quando capacidade_litros é explícita e coerente', () => {
  const wanted = product('Misturador Vertical 1000kg', { categoria: 'MISTURADOR', capacidade_kg: 1000, capacidade_litros: 1900 })
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS'), [wanted]), wanted)
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS'), [{ ...wanted, capacidade_litros: null }]), null)
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS'), [{ ...wanted, nome_curto: 'MISTURADOR VERTICAL 900 LITROS', nome_completo: 'MISTURADOR VERTICAL 900 LITROS' }]), null)
})

test('inclinação, registro gaveta e motorredutor superior são variantes preservadas', () => {
  for (const suffix of ['45° DE INCLINAÇÃO', 'REGISTRO GAVETA']) {
    assert.equal(match(line(), [product(`${origin.sourceName} ${suffix}`)]), null)
    const wanted = product(`${origin.sourceName} ${suffix}`)
    assert.equal(match(line(`${origin.sourceName} ${suffix}`), [wanted]), wanted)
  }
  assert.equal(match(line(`${origin.sourceName} MOTORREDUTOR EM CIMA`), [product(`${origin.sourceName} MOTORREDUTOR`)]), null)
})

test('capacidade comercial literal na especificação refina litros e impede vincular kg incompatíveis', () => {
  const source = line('MISTURADOR VERTICAL 1900 LITROS', { sourceSpecifications: ['1000 KG'] })
  const wrong = product('MISTURADOR VERTICAL 1900 LITROS (500 KG)', { categoria: 'MISTURADOR', capacidade_litros: 1900, capacidade_kg: 500 })
  const wanted = product('MISTURADOR VERTICAL 1900 LITROS (1000 KG)', { categoria: 'MISTURADOR', capacidade_litros: 1900, capacidade_kg: 1000 })
  assert.equal(match(source, [wrong]), null)
  assert.equal(match(source, [wrong, wanted]), wanted)
  assert.equal(match(line(source.nome, { sourceSpecifications: ['Capacidade: 1900 litros / 1000 kg'] }), [wanted]), wanted)
})

test('capacidades comerciais conflitantes na origem ou cadastro impedem vínculo', () => {
  const wanted = product('MISTURADOR VERTICAL 1900 LITROS (1000 KG)', { categoria: 'MISTURADOR' })
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS', { sourceSpecifications: ['Capacidade: 900 LITROS'] }), [wanted]), null)
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS', { sourceSpecifications: ['1000 KG', '500 KG'] }), [wanted]), null)
  assert.equal(match(line('MISTURADOR VERTICAL 1900 LITROS'), [{ ...wanted, specs: ['Capacidade: 500 KG'] }]), null)
})

test('referências 3D, dimensões, peso e vazão em specs não redefinem capacidade ou CV', () => {
  const wanted = product('MISTURADOR VERTICAL 1900 LITROS (1000 KG)', { categoria: 'MISTURADOR' })
  const source = line('MISTURADOR VERTICAL 1900 LITROS', { sourceSpecifications: ['Referência 3D: 500 KG', 'Projeto L × P × A: 900 LITROS', 'Peso: 500 KG', 'Produção: 500 KG/H', 'Motor: 2 CV'] })
  assert.equal(match(source, [wanted]), wanted)
  const mill = product('TRITURADOR DE GRÃOS 20 CV', { categoria: 'MOINHO' })
  assert.equal(match(line('MOINHO MARTELO 20 CV', { sourceSpecifications: ['Motor auxiliar: 2 CV'] }), [mill]), mill)
})

test('entradas e saídas especiais precisam coincidir inclusive quando descritas nos detalhes', () => {
  const name = 'MISTURADOR HORIZONTAL 900 LITROS'
  for (const variant of ['ENTRADA ESQUERDA', 'SAÍDA ESQ', 'SAÍDA 2 VIAS', 'SAÍDA REDONDA']) {
    const wanted = product(`${name} ${variant}`, { categoria: 'MISTURADOR' })
    assert.equal(match(line(name), [wanted]), null)
    assert.equal(match(line(name, { sourceSpecifications: [variant] }), [wanted]), wanted)
    assert.equal(match(line(`${name} ${variant}`), [product(name, { categoria: 'MISTURADOR' })]), null)
  }
  assert.equal(match(line(`${name} ENTRADA ESQ`), [product(`${name} ENTRADA DIREITA`, { categoria: 'MISTURADOR' })]), null)
})

test('acionamento padrão descrito na ficha não é uma variante de título motorredutor', () => {
  const wanted = product(origin.sourceName, { specs: ['Acionamento: 2 CV por motorredutor (incluso)'] })
  assert.equal(match(line(), [wanted]), wanted)
  assert.equal(match(line(`${origin.sourceName} MOTORREDUTOR`), [wanted]), null)
})

test('sem pulmão e sem aquecimento não se confundem com variantes que os incluem', () => {
  const name = 'MISTURADOR HORIZONTAL 900 LITROS'
  for (const [positive, negative] of [['C/PULMÃO', 'S/PULMÃO'], ['COM PULMÃO', 'SEM PULMÃO'], ['COM AQUECIMENTO', 'SEM AQUECIMENTO']]) {
    assert.equal(match(line(`${name} ${positive}`), [product(`${name} ${negative}`, { categoria: 'MISTURADOR' })]), null)
    assert.equal(match(line(`${name} ${negative}`), [product(`${name} ${positive}`, { categoria: 'MISTURADOR' })]), null)
    const standard = product(name, { categoria: 'MISTURADOR' })
    assert.equal(match(line(`${name} ${negative}`), [standard]), standard)
  }
})

test('qualificadores contraditórios entre título e detalhes impedem vínculo', () => {
  const name = 'MISTURADOR HORIZONTAL 900 LITROS C/PULMÃO'
  const wanted = product(name, { categoria: 'MISTURADOR' })
  assert.equal(match(line(name, { sourceSpecifications: ['SEM PULMÃO'] }), [wanted]), null)
  assert.equal(match(line(name), [{ ...wanted, specs: ['SEM PULMÃO'] }]), null)
})
