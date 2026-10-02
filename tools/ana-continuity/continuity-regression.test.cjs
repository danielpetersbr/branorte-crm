const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Execute production declarations/expressions; never load the Edge entrypoint or credentials.
const sourcePath = process.env.ANA_CONTINUITY_SOURCE || path.resolve(__dirname, '../../../../outputs/ana-continuity-candidate/ia-atendente/index.ts')
const source = fs.readFileSync(sourcePath, 'utf8')
const ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true)
const globals = new Map()
for (const n of ast.statements) {
  if (ts.isFunctionDeclaration(n) && n.name) globals.set(n.name.text, n)
  if (ts.isVariableStatement(n)) for (const d of n.declarationList.declarations) {
    if (ts.isIdentifier(d.name)) globals.set(d.name.text, d)
  }
}
function find(predicate) {
  let result
  function visit(n) { if (!result && predicate(n)) result = n; if (!result) ts.forEachChild(n, visit) }
  visit(ast)
  assert.ok(result, 'Production behavioral boundary is missing')
  return result
}
const declaration = name => find(n => ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name)
function dependencyCode(nodes, excluded = []) {
  const selected = new Set(), omit = new Set(excluded)
  function visit(n) {
    if (ts.isIdentifier(n) && !omit.has(n.text) && globals.has(n.text) && !selected.has(n.text)) {
      selected.add(n.text); ts.forEachChild(globals.get(n.text), visit)
    }
    ts.forEachChild(n, visit)
  }
  for (const n of nodes) visit(n)
  return ast.statements.flatMap(n => {
    if (ts.isFunctionDeclaration(n) && selected.has(n.name?.text)) return [n.getText(ast)]
    if (ts.isVariableStatement(n)) return n.declarationList.declarations.filter(d => ts.isIdentifier(d.name) && selected.has(d.name.text)).map(d => `const ${d.getText(ast)};`)
    return []
  }).join('\n')
}
function executable(body, dependencies = [], excluded = []) {
  const text = dependencyCode(dependencies, excluded) + '\n' + body
  const compiled = ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  return vm.runInNewContext(compiled, { console: { log() {}, error() {} } }, { timeout: 1000 })
}
function helper(name) {
  const n = globals.get(name)
  assert.ok(n, `Production helper ${name} is missing`)
  return executable(name, [n])
}
function qualify(overrides = {}) {
  const d = { equipamento: 'misturador horizontal', aplicacao: 'ração farelada', energia: 'tri', _v24011: 1, ...overrides.dados }
  const values = { CONTINGENCIA: true, dadosMem: d, _porteQ: false, _local: !!(d.cidade || d.uf), _semCidV24011: true, _equipAvulso: true, temAplicacaoEquip: !!d.aplicacao,
    equipTxt: d.equipamento, equipEhFabrica: false, convCliente: 'Quero um misturador horizontal para ração farelada. Trifásico.', cfg: { anaSemCidade: true }, ...overrides }
  const n = declaration('_qualificado')
  const keys = Object.keys(values)
  const fn = executable(`(function(${keys.join(',')}) { return ${n.initializer.getText(ast)}; })`, [n.initializer], keys)
  return !!fn(...keys.map(k => values[k]))
}
function gate(overrides = {}) {
  const values = { CONTINGENCIA: true, cfg: { anaContingenciaRepasse: { ativo: true, repasse_qualificados: true, vendedores_repasse: ['RAMON'] } },
    repassePorteira: { criterio: { qualificado: true } }, consultaRepassePendente: false, contDuvidaDaniel: null, consultaAberta: null, contReconhecimento: false,
    encerrar: false, orientConfirmadasDaniel: [], st: { estado: 'AI_ACTIVE' }, ...overrides }
  const n = declaration('repasseQualificadoCont'), keys = Object.keys(values)
  const fn = executable(`(function(${keys.join(',')}) { return ${n.initializer.getText(ast)}; })`, [n.initializer], keys)
  return !!fn(...keys.map(k => values[k]))
}

test('the actual qualification branch accepts the identified standalone mixer without factory animal or size', () => {
  assert.equal(qualify(), true)
})
test('standalone qualification rejects generic equipment and absent application', () => {
  const fn = helper('equipamentoQualificadoAna')
  assert.equal(fn({ aplicacao: 'ração farelada' }, 'equipamento', false, 'Quero equipamento para ração', true), false)
  assert.equal(fn({}, 'misturador horizontal', false, 'Quero um misturador horizontal', true), false)
  assert.equal(fn({}, '', false, 'Trifásico', true), false)
})
test('city exemption is current configuration, not a stale memory marker', () => {
  assert.equal(qualify({ _semCidV24011: false, cfg: { anaSemCidade: false } }), false)
  assert.equal(qualify({ _semCidV24011: false, cfg: { anaSemCidade: false }, dados: { cidade: 'Cascavel', uf: 'PR' } }), true)
})
test('energy alone never qualifies an equipment conversation', () => {
  assert.equal(qualify({ dados: { equipamento: '', aplicacao: '', energia: 'tri' }, equipTxt: '', temAplicacaoEquip: false, _equipAvulso: false, convCliente: 'Trifásico' }), false)
})
test('the commercial equipment change preserves the legacy non-contingency qualification rule', () => {
  assert.equal(qualify({ CONTINGENCIA: false }), false)
})
test('a direct energy answer after the actual question is recovered without an LLM extraction', () => {
  const fn = helper('energiaRespondidaAna')
  const question = { fromMe: true, body: 'Segue a tabela oficial de preços. Sua energia é trifásica ou monofásica?', t: 100 }
  assert.equal(fn([question, { fromMe: false, body: 'Trifásico', t: 200 }]), 'tri')
  assert.equal(fn([question, { fromMe: false, body: 'Monofásico', t: 200 }]), 'mono')
})
test('energy questions, isolated words before a question and outgoing replies do not become client facts', () => {
  const fn = helper('energiaRespondidaAna')
  assert.equal(fn([{ fromMe: false, body: 'Trifásico', t: 10 }]), null)
  assert.equal(fn([{ fromMe: true, body: 'Sua energia é trifásica ou monofásica?', t: 20 }, { fromMe: true, body: 'Trifásico', t: 30 }]), null)
  assert.equal(fn([{ fromMe: true, body: 'Sua energia é trifásica ou monofásica?', t: 20 }, { fromMe: false, body: 'Pode ser trifásico?', t: 30 }]), null)
})
test('commercial qualification never overrides pending consultations or human guidance', () => {
  assert.equal(gate(), true)
  for (const blocker of [{ consultaRepassePendente: true }, { contDuvidaDaniel: 'Technical doubt' }, { consultaAberta: { codigo: 'Q' } },
    { orientConfirmadasDaniel: ['Confirmed human answer'] }, { st: { estado: 'WAITING_INTERNAL_GUIDANCE' } }, { encerrar: true }]) assert.equal(gate(blocker), false)
})
test('the real responder rejects human takeover and opt-out before qualification runs', () => {
  const n = find(n => ts.isIfStatement(n) && n.expression.getText(ast) === 'CONTINGENCIA && contingenciaHumano(st)' && n.thenStatement.getText(ast).includes('skip:'))
  const fn = executable(`(function(CONTINGENCIA, st, j) { ${n.getText(ast)}; return { continued: true }; })`, [n], ['CONTINGENCIA', 'st', 'j'])
  for (const st of [{ estado: 'HUMAN_TAKEOVER' }, { assumido_por: 'synthetic-human' }, { bloqueado_em: '2026-10-02T18:00:00Z' }]) {
    assert.equal(fn(true, st, x => x).skip, 'contingencia_controle_humano')
  }
  assert.equal(fn(true, { estado: 'AI_ACTIVE' }, x => x).continued, true)
})
test('post-package status alone is not permission to hand off', () => {
  assert.equal(gate({ repassePorteira: { criterio: { pos: true, braco: 'A', fase: 'quando' } } }), false)
  assert.equal(gate({ cfg: { anaContingenciaRepasse: { ativo: true, repasse_qualificados: true, vendedores_repasse: [] } } }), false)
})
test('continuation uses a concrete missing question and never invents another price or a handoff', () => {
  const fn = helper('continuarQualificacaoAna')
  const text = fn('Para que você pretende usar esse misturador?', 'tri')
  assert.match(text, /Para que você pretende usar esse misturador\?/)
  assert.match(text, /trif[aá]sic/i)
  assert.doesNotMatch(text, /R\$|tabela|consultor|vendedor|te chama|qual d[uú]vida/i)
  assert.equal(fn(null, 'tri'), null)
})
test('failed destination confirmation restores service and does not promise a seller', async () => {
  const n = find(n => ts.isIfStatement(n) && n.expression.getText(ast) === 'repasseQualificadoCont && !rep.ok')
  const keys = ['repasseQualificadoCont', 'rep', 'supa', 'chat_id', 'st', 'upd', 'registrarSkip', 'j', 'respostasHoje']
  const fn = executable(`(async function(${keys.join(',')}) { ${n.getText(ast)}; return { continued: true }; })`, [n], keys)
  const query = { eq() { return this }, is() { return this }, or() { return this }, select: async () => ({ data: [{ chat_id: 'synthetic', estado: 'AI_ACTIVE' }], error: null }) }
  const result = await fn(true, { ok: false, falha: 'destination_unavailable' }, { from: () => ({ update: () => query }) }, 'synthetic', { vendedor_nome: 'ANA' }, { atualizado_em: '2026-10-02T18:09:09Z' }, async () => {}, x => x, 5)
  assert.equal(result.ok, true)
  assert.equal(result.acoes.desligada, false)
  assert.doesNotMatch(result.texto, /vou passar|te chama|encaminhei|RAMON|PEDRO/i)
})
