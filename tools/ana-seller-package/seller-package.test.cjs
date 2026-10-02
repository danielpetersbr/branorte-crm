const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')
const source = fs.readFileSync(process.env.ANA_SELLER_PACKAGE_SOURCE || path.resolve(__dirname,'../../../../outputs/ana-seller-package-candidate/ia-atendente/index.ts'),'utf8')
const ast = ts.createSourceFile('actual.ts',source,ts.ScriptTarget.Latest,true)
const globals = new Map()
for(const n of ast.statements) {
  if(ts.isFunctionDeclaration(n)&&n.name)globals.set(n.name.text,n)
  if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(ts.isIdentifier(d.name))globals.set(d.name.text,d)
}
function dependencyCode(names) {
  const selected=new Set()
  function add(name){if(selected.has(name)||!globals.has(name))return;selected.add(name);function walk(n){if(ts.isIdentifier(n))add(n.text);ts.forEachChild(n,walk)}walk(globals.get(name))}
  names.forEach(add)
  return ast.statements.flatMap(n=>ts.isFunctionDeclaration(n)&&selected.has(n.name?.text)?[n.getText(ast)]:ts.isVariableStatement(n)?n.declarationList.declarations.filter(d=>selected.has(d.name.getText(ast))).map(d=>`const ${d.getText(ast)};`):[]).join('\n')
}
const prelude=dependencyCode(['pacoteVendedorAna','respostaSemPacoteAna','continuarQualificacaoAna'])
const compile=code=>ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText
const execute=code=>vm.runInNewContext(compile(prelude+'\n'+code),{console:{log(){},error(){}}},{timeout:1000})
function find(predicate){let result;function visit(n){if(!result&&predicate(n))result=n;if(!result)ts.forEachChild(n,visit)}visit(ast);assert.ok(result,'Actual production branch missing');return result}
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert.ok(a>=0&&b>a);return source.slice(a,b)}
const active={ativo:true,inicio:'2026-10-02T18:00:00Z',fim:'2026-10-05T03:00:00Z'}

test('seller-package configuration uses inclusive start and exclusive end, and permits permanent mode',()=>{
  assert.ok(globals.has('pacoteVendedorAna'),'Seller time-window helper missing')
  const fn=execute('pacoteVendedorAna')
  for(const [time,expected] of [['2026-10-02T17:59:59Z',false],['2026-10-02T18:00:00Z',true],['2026-10-04T23:00:00Z',true],['2026-10-05T03:00:00Z',false]])assert.equal(fn(active,Date.parse(time)),expected)
  assert.equal(fn({ativo:true,inicio:active.inicio},Date.parse('2027-01-01T00:00:00Z')),true)
  assert.equal(fn({...active,inicio:'2026-10-02T18:00:00.123456+00:00'},Date.parse('2026-10-02T18:00:01Z')),true)
})
test('invalid or inactive window cannot activate seller mode',()=>{
  assert.ok(globals.has('pacoteVendedorAna'))
  const fn=execute('pacoteVendedorAna'),now=Date.parse('2026-10-04T12:00:00Z')
  for(const cfg of [null,{}, {...active,ativo:false},{...active,ativo:'true'},{...active,inicio:null},{...active,inicio:'invalid'},{...active,inicio:'2026-10-02'},{...active,fim:'invalid'},{...active,fim:active.inicio},{...active,inicio:'2026-10-06T00:00:00Z'}])assert.equal(fn(cfg,now),false)
})
test('actual response enables seller mode only for Ana under active contingency',()=>{
  const cont=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='CONTINGENCIA')
  const mode=find(n=>ts.isVariableDeclaration(n)&&n.name.getText(ast)==='PACOTE_VENDEDOR')
  const fn=execute(`(function(PORTEIRA,enabled){const cfg={anaContingenciaPreco:enabled,anaPacoteVendedor:${JSON.stringify({...active,inicio:'2000-01-01T00:00:00Z',fim:'2099-01-01T00:00:00Z'})}};const ${cont.getText(ast)};const ${mode.getText(ast)};return PACOTE_VENDEDOR})`)
  assert.equal(fn(true,true),true);assert.equal(fn(false,true),false);assert.equal(fn(true,false),false)
})
function priceContinuation(mode){
  const fn=globals.get('precoContinuarAna').getText(ast)
  return execute(`${fn}\n(async function(){let calls=0;const passosAnaDoRepasse=()=>({energia:'tri',categoria:'fabrica_vertical'}),aplicarPacoteAnuncioAna=x=>x,alvoPacoteAnuncioAna=()=>null,pacoteAnaCliente=async()=>{calls++;return {comPreco:true,midias:[{tipo:'image',titulo:'Mini: modelos e valores',url:'https://example.com/table.png'}],texto:'R$ 10.000'}};${fn}\nconst result=await precoContinuarAna({rep:{modelo_indicado:{slug:'known'}},dc:{},conv:'',equipTxt:'',equipEhFabrica:true,permitirMidia:true,pacoteVendedor:${mode},proximaPergunta:'Pra qual animal é a ração?',energiaTurno:'tri'});return {result,calls}})`)()
}
test('incomplete price request continues useful qualification without assembling or sending an Ana package',async()=>{
  const {result,calls}=await priceContinuation(true)
  assert.equal(calls,0);assert.deepEqual(Array.from(result.midias),[]);assert.match(result.texto,/Pra qual animal é a ração\?/);assert.match(result.texto,/trifásica/);assert.doesNotMatch(result.texto,/R\$|tabela|te mandei|vendedor escolhido/)
})
test('outside seller mode the existing official table path remains intact',async()=>{
  const {result,calls}=await priceContinuation(false);assert.equal(calls,1);assert.equal(result.midias.length,1);assert.match(result.texto,/tabela oficial/)
})
test('seller handoff does not leave dispatch waiting for Ana package completion',()=>{
  const spread=find(n=>ts.isSpreadAssignment(n)&&n.getText(ast).includes('cfg.anaPacoteUmaVez')&&n.getText(ast).includes('anaPend: true'))
  const fn=execute(`(function(PACOTE_VENDEDOR){const cfg={anaPacoteUmaVez:true},_v240=null;return {${spread.getText(ast)}}})`)
  assert.equal(fn(true).anaPend,undefined);assert.equal(fn(false).anaPend,true)
})
test('seller mode skips only Ana handoff delivery, retaining the normal package builder',async()=>{
  const branch=find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes("_v240.acao === 'fora'")&&n.thenStatement.getText(ast).includes('_pkAna = _alvoRep'))
  const fn=execute(`(async function(PACOTE_VENDEDOR){let _pkAna=null,calls=0;const _v240=null,_alvoRep=null,_eqRep=null,_pkPre=null,_pkEq=null,_paRep={},pacoteAnaCliente=async()=>{calls++;return {midias:['photo']}};${branch.getText(ast)};return {calls,_pkAna}})`)
  assert.equal((await fn(true)).calls,0);assert.equal((await fn(true))._pkAna,null);assert.equal((await fn(false)).calls,1)
})
test('seller mode also skips the legacy equipment photo/video fallback',()=>{
  const condition=find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('!_pkAna && equipTxt')&&n.expression.getText(ast).includes('passa_B')).expression.getText(ast)
  const fn=execute(`(function(PACOTE_VENDEDOR){const _pkAna=null,equipTxt='misturador horizontal',equipEhFabrica=false,_v240=null;return !!(${condition})})`)
  assert.equal(fn(true),false);assert.equal(fn(false),true)
})
test('seller mode cannot create or propagate Mini R1 markers that falsely record an Ana delivery',()=>{
  const producer=find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('cfg.anaMenorMini === true')&&n.thenStatement.getText(ast).includes('mandou: !!_pkMV'))
  const propagate=find(n=>ts.isIfStatement(n)&&n.expression.getText(ast).includes('cfg.anaMenorMini === true')&&n.thenStatement.getText(ast).includes('_menorRepV2407 ='))
  const producerFn=execute(`(function(PACOTE_VENDEDOR){const cfg={anaMenorMini:true},_v240=null,_equipAvulso=false,nfEspera=false,_vagaCodP=false,_FORA_DO_ESCOPO_PORTEIRA=/nevermatches/,convCliente='';return !!(${producer.expression.getText(ast)})})`)
  const propagateFn=execute(`(function(PACOTE_VENDEDOR){const cfg={anaMenorMini:true};return !!(${propagate.expression.getText(ast)})})`)
  assert.equal(producerFn(true),false);assert.equal(propagateFn(true),false);assert.equal(producerFn(false),true);assert.equal(propagateFn(false),true)
  const spread=find(n=>ts.isSpreadAssignment(n)&&n.getText(ast).includes('menorV2407: _menorRepV2407'))
  const spreadFn=execute(`(function(PACOTE_VENDEDOR){const _menorRepV2407={v:1,mandou:true,bMarca:true};return {${spread.getText(ast)}}})`)
  assert.equal(spreadFn(true).menorV2407,undefined);assert.equal(spreadFn(false).menorV2407.mandou,true)
})
function finalResponse(mode,text='Te mandei a foto. R$ 10.000.',consult=false){
  const block=section('      if (CONTINGENCIA && _contResposta) {','      const clienteMsg =')
  const fn=execute(`(function(PACOTE_VENDEDOR,texto,consulta){let fabricaMidias=[{tipo:'image',url:'https://example.com/photo.png'}],midia={tipo:'video'};const CONTINGENCIA=true,_contResposta=null,_anaJaSeApresentou=true,porteiraProxPergunta='Qual sua cidade?',energiaTurnoAna='tri',encerrar=false,consultaAberta=consulta?{codigo:'synthetic'}:null,contDuvidaDaniel=null,st={estado:consulta?'WAITING_INTERNAL_GUIDANCE':'AI_ACTIVE'},vendedorAssumir=false;${block}\nreturn {texto,fabricaMidias,midia}})`)
  return fn(mode,text,consult)
}
test('final response suppresses late media and monetary/material promises, including Mini and oriented replies',()=>{
  const result=finalResponse(true);assert.equal(result.fabricaMidias.length,0);assert.equal(result.midia,null);assert.match(result.texto,/Qual sua cidade\?/);assert.doesNotMatch(result.texto,/R\$|te mandei|foto|tabela/i)
  const waiting=finalResponse(true,'O preço aprovado é R$ 10.000.',true);assert.doesNotMatch(waiting.texto,/R\$|Qual sua cidade/);assert.match(waiting.texto,/aguardando/i)
})
test('late material statements cannot survive when their attachments were removed',()=>{
  for(const statement of ['Segue a tabela oficial.','Vou te enviar as fotos.','Envio o vídeo agora.','Confira o catálogo abaixo.','O equipamento custa 40 mil.']) {
    const result=finalResponse(true,statement);assert.match(result.texto,/Qual sua cidade\?/);assert.equal(result.fabricaMidias.length,0)
  }
})
test('late delivery remains unchanged outside seller mode and technical facts are preserved inside it',()=>{
  const legacy=finalResponse(false);assert.equal(legacy.fabricaMidias.length,1);assert.match(legacy.texto,/R\$/)
  assert.equal(finalResponse(true,'O misturador tem capacidade de 500 kg por batida.').texto,'O misturador tem capacidade de 500 kg por batida.')
  for(const fact of ['O motor funciona em 220 V.','A capacidade é 300 kg/h.','O Jardel, nosso consultor, te chama no WhatsApp dele.'])assert.equal(finalResponse(true,fact).texto,fact)
})
