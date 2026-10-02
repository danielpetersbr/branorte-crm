const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const source = fs.readFileSync(process.env.ANA_CONTINUITY_SOURCE || path.resolve(__dirname, '../../../../outputs/ana-continuity-candidate/ia-atendente/index.ts'), 'utf8')
const ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true)
const declarations = new Map()
for (const statement of ast.statements) {
  if (ts.isFunctionDeclaration(statement) && statement.name) declarations.set(statement.name.text, statement.getText(ast))
  if (ts.isVariableStatement(statement)) for (const d of statement.declarationList.declarations) {
    if (ts.isIdentifier(d.name)) declarations.set(d.name.text, `const ${d.getText(ast)};`)
  }
}
const compile = code => ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
function dependencies(names) {
  const found = new Map()
  function add(name) {
    if (found.has(name) || !declarations.has(name)) return
    const text = declarations.get(name)
    found.set(name,text)
    const node = ts.createSourceFile('dependency.ts',text,ts.ScriptTarget.Latest,true)
    function walk(n) { if (ts.isIdentifier(n) && n.text !== name) add(n.text); ts.forEachChild(n,walk) }
    walk(node)
  }
  names.forEach(add)
  // Function declarations are hoisted; dependent constants must retain production order.
  return [...found.entries()].sort((a,b)=>source.indexOf(declarations.get(a[0]).replace(/^const /,'').replace(/;$/,''))-source.indexOf(declarations.get(b[0]).replace(/^const /,'').replace(/;$/,''))).map(([,v])=>v).join('\n')
}
const prelude = dependencies(['equipamentoQualificadoAna','energiaRespondidaAna','continuarQualificacaoAna','perguntaQueFaltaPorteira','resumoRepasseAna'])
function section(start,end) { const a=source.indexOf(start),b=source.indexOf(end,a); assert.ok(a>=0&&b>a,'Production section missing'); return source.slice(a,b) }
function declaration(name) { let found; function walk(n){if(ts.isVariableDeclaration(n)&&n.name.getText(ast)===name)found=n;ts.forEachChild(n,walk)}walk(ast); assert.ok(found);return found.getText(ast) }
function qualified(d,semCidade=true,contingency=true,conv='Quero um misturador horizontal para ração farelada.') {
  const evaluate = vm.runInNewContext(compile(`${prelude}\n(function(dadosMem,_semCidV24011,CONTINGENCIA,convCliente){const PORTEIRA_EQUIP_QUALIFICA=false,equipTxt=String(dadosMem.equipamento||''),equipEhFabrica=/fabrica|compacta|mini/i.test(equipTxt),_equipAvulso=!!equipTxt&&!equipEhFabrica,temAplicacaoEquip=!!dadosMem.aplicacao,_local=!!(dadosMem.cidade||dadosMem.uf),_porteQ=!!(dadosMem.quantidade||dadosMem.producao_kgh);let ${declaration('_qualificado')};return _qualificado})`))
  return evaluate(d,semCidade,contingency,conv)
}
const equipment = changes => ({equipamento:'misturador horizontal',aplicacao:'ração farelada',...changes})

test('commercial equipment with explicit application qualifies in contingency without animal or herd',()=>{
  assert.equal(qualified(equipment()),true)
})
test('equipment obeys city switch and does not change legacy non-contingency qualification',()=>{
  assert.equal(qualified(equipment(),false),false)
  assert.equal(qualified(equipment({cidade:'Teste'}),false),true)
  assert.equal(qualified(equipment(),true,false),false)
})
test('generic equipment, absent application, ambiguous type, parts and out-of-scope material stay unqualified',()=>{
  for(const d of [equipment({equipamento:'equipamento'}),equipment({aplicacao:null}),equipment({equipamento:'misturador'}),equipment({equipamento:'motor do misturador'}),equipment({aplicacao:'fertilizante'}),equipment({equipamento:'mini fábrica'})])assert.equal(qualified(d,true,true,'Quero '+d.equipamento+' para '+d.aplicacao),false)
  assert.equal(qualified({energia:'tri'}),false)
})
test('direct electrical answer is added to actual memory independently of LLM extraction',()=>{
  const block=section('      const dadosMem: any =','      // (05/08) RE-PERGUNTA')
  const fn=vm.runInNewContext(compile(`${prelude}\n(function(msgs){let dados={};const st={dados_coletados:{}},PORTEIRA=true;${block}\nreturn {dados,dadosMem}})`))
  const result=fn([{fromMe:true,t:1,body:'Sua energia é trifásica ou monofásica?'},{fromMe:false,t:2,body:'Trifásico'}])
  assert.equal(result.dadosMem.energia,'tri');assert.equal(result.dados.energia,'tri')
})
test('confirmed energy is included in persistence allowlist and handoff summary',()=>{
  const block=section('        for (const k of [\'nome_cliente\',','        // (v232, R2)')
  const fn=vm.runInNewContext(compile(`${prelude}\n(function(){const dados={energia:'mono'},limpo={},upd={},st={dados_coletados:{}},PORTEIRA=true;${block}\nreturn {persisted:upd.dados_coletados,summary:resumoRepasseAna(dados,null,null)}})`))
  const result=fn();assert.equal(result.persisted?.energia,'mono');assert.match(result.summary,/Energia: monofásica/)
})
test('rejected handoff continues the outstanding qualification question with electrical acknowledgement',()=>{
  let block
  function walk(n) { if(ts.isExpressionStatement(n)&&n.getText(ast).startsWith('_contResposta = { texto: repassePorteira?.motivo'))block=n.getText(ast);ts.forEachChild(n,walk) }
  walk(ast);assert.ok(block,'Actual handoff fallback missing')
  const fn=vm.runInNewContext(compile(`${prelude}\n(function(){let _contResposta;const repassePorteira={motivo:'llm_sem_pergunta'},porteiraTextoLlm='Vou passar para o consultor.',porteiraProxPergunta='Qual sua cidade?',energiaTurnoAna='tri',numeroDeDinheiroPorteira=()=>false;${block}\nreturn _contResposta.texto})`))
  assert.equal(fn(),'Energia trifásica registrada. Qual sua cidade?')
})

test('negative or ambiguous electrical replies do not persist model guesses as client facts',()=>{
  const block=section('      // MEMORIA DA IA:', '      // (05/08) RE-PERGUNTA')
  const fn=vm.runInNewContext(compile(`${prelude}\n(function(body){let dados={energia:'tri'};const st={dados_coletados:{energia:'mono'}},PORTEIRA=true,msgs=[{fromMe:true,t:1,body:'Sua energia é trifásica ou monofásica?'},{fromMe:false,t:2,body}];${block}\nreturn {dados,dadosMem}})`))
  for(const body of ['Não tenho trifásico','Trifásico ou monofásico','Serve trifásico?']) {
    const result=fn(body);assert.equal(result.dados.energia,undefined);assert.equal(result.dadosMem.energia,'mono')
  }
})

test('an energy answer continues the missing step even when the model did not request handoff',async()=>{
  const block=section('        if (!encerrar && (pediuPrecoCont || retomaPrecoCont))', '\n        if (CONSULTA_DANIEL')
  const fn=vm.runInNewContext(compile(`${prelude}\n(async function(){let _contResposta;const encerrar=false,pediuPrecoCont=false,retomaPrecoCont=false,vendedorAssumir=false,repassePorteira=null,porteiraTextoLlm='Certo',porteiraProxPergunta='Qual sua cidade?',energiaTurnoAna='mono',contDuvidaDaniel=null,consultaAberta=null,orientConfirmadasDaniel=[],st={estado:'AI_ACTIVE'},numeroDeDinheiroPorteira=()=>false;${block}\nreturn _contResposta?.texto})`))
  assert.equal(await fn(),'Energia monofásica registrada. Qual sua cidade?')
})
