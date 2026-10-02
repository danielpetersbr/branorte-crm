const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

const privateRoot = path.resolve(__dirname, '../../../../outputs/ana-routing-candidate')
const ia = fs.readFileSync(process.env.ANA_ROUTING_IA_SOURCE || path.join(privateRoot, 'ia-atendente/index.ts'), 'utf8')
const poll = fs.readFileSync(process.env.ANA_ROUTING_POLL_SOURCE || path.join(privateRoot, 'dispatch-poll/index.ts'), 'utf8')
const names = ['DANIEL', 'RAMON', 'GUSTAVO', 'ALVARO', 'EDER', 'EDILSON JR', 'IGOR', 'JARDEL', 'LUCAS', 'PEDRO']
const config = (changes = {}) => ({ativo:true, repasse_qualificados:true, vendedores_repasse:names, ...changes})
const compile = code => ts.transpileModule(code, {compilerOptions:{target:ts.ScriptTarget.ES2022, module:ts.ModuleKind.CommonJS}}).outputText

function sourceFunction(source, name) {
  const ast = ts.createSourceFile('actual.ts', source, ts.ScriptTarget.Latest, true)
  const node = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === name)
  assert.ok(node, `Actual function ${name} missing`)
  return node.getText(ast)
}
const parser = vm.runInNewContext(compile(`${sourceFunction(ia, 'vendedoresRepasseAna')}\nvendedoresRepasseAna`))

function section(source, start, end) {
  const a=source.indexOf(start),b=source.indexOf(end,a)
  assert.ok(a>=0&&b>a,'Actual production section missing')
  return source.slice(a,b)
}
const guard = section(poll, '  // Contingência comercial:', '  // Config de janela/intervalo.')
async function pollGate(value, seller, error=null) {
  const calls=[]
  const query={eq:(...args)=>{calls.push(['eq',...args]);return query},or:(...args)=>{calls.push(['or',...args]);return query}}
  const sb={from:table=>{assert.equal(table,'ia_config');return {select:()=>({eq:(_,key)=>{assert.equal(key,'ana_contingencia_preco');return {maybeSingle:async()=>({data:{valor:{v:value}},error})}}})}}}
  const fn=vm.runInNewContext(compile(`(async function(sb,vendedorNome,json,query){${guard}\nfiltroAna(query);return {continued:true}})`))
  const result=await fn(sb,seller,body=>body,query)
  return {result,calls}
}

test('Ana accepts the ten explicitly authorized names, normalizing and deduplicating',()=>{
  assert.deepEqual(Array.from(parser(config())),names)
  assert.deepEqual(Array.from(parser(config({vendedores_repasse:[' eder ','EDER','edilson jr']}))),['EDER','EDILSON JR'])
})
test('Ana still rejects outsiders and inactive, empty or unqualified configurations',()=>{
  for(const value of [null,config({ativo:false}),config({repasse_qualificados:false}),config({vendedores_repasse:[]}),config({vendedores_repasse:null}),config({vendedores_repasse:['DANIEL','OUTSIDER']}),config({vendedores_repasse:[{}]})])assert.deepEqual(Array.from(parser(value)),[])
})
test('poll permits every configured authorized seller and still filters only qualified Ana repasses',async()=>{
  for(const seller of names){
    const {result,calls}=await pollGate(config(),seller)
    assert.equal(result.continued,true,seller)
    assert.deepEqual(calls,[['eq','raw_payload->>ana_repasse_restrito','true'],['eq','raw_payload->>ana_qualificado','true']])
  }
})
test('poll refuses an unconfigured seller or any outsider without accessing the customer queue',async()=>{
  for(const [value,seller] of [[config({vendedores_repasse:['EDER']}),'PEDRO'],[config(),'OUTSIDER'],[config({vendedores_repasse:['DANIEL','OUTSIDER']}),'DANIEL'],[config({repasse_qualificados:false}),'DANIEL'],[config({vendedores_repasse:[]}),'DANIEL']]){
    const {result,calls}=await pollGate(value,seller)
    assert.equal(result.skip,'contingencia_vendedores_indisponiveis');assert.deepEqual(calls,[])
  }
})
test('poll only admits doubt repasses when their explicit switch is enabled',async()=>{
  const {result,calls}=await pollGate(config({repasse_duvidas:true}),'EDILSON JR')
  assert.equal(result.continued,true)
  assert.deepEqual(calls,[['eq','raw_payload->>ana_repasse_restrito','true'],['or','raw_payload->>ana_qualificado.eq.true,raw_payload->>ana_duvida_repasse.eq.true']])
})
test('poll configuration read failure remains closed',async()=>{
  const {result,calls}=await pollGate(config(),'EDER',{message:'unavailable'})
  assert.equal(result.skip,'contingencia_config_indisponivel');assert.deepEqual(calls,[])
})
test('inactive contingency preserves the existing legacy path without adding an Ana filter',async()=>{
  const {result,calls}=await pollGate(config({ativo:false}),'LEGACY')
  assert.equal(result.continued,true);assert.deepEqual(calls,[])
})
test('commercial and doubt prompts defer seller selection to the configured routine',()=>{
  const prompt=section(ia,'      if (CONTINGENCIA) persona +=','      const user = `CONVERSA')
  const fn=vm.runInNewContext(compile(`(function(vendedoresRepasseAna,cfg,PACOTE_VENDEDOR=false){let persona='';const CONTINGENCIA=true,CONSULTA_DANIEL=true;${prompt}\nreturn persona})`))
  for(const mode of [false,true]) {
    const result=fn(parser,{anaContingenciaRepasse:config({repasse_duvidas:true})},mode)
    assert.match(result,/vendedores habilitados/i)
    assert.doesNotMatch(result,/Daniel, Ramon ou Gustavo/)
    assert.match(result,/NÃO invente números/)
    assert.match(result,/não escolha nem prometa um vendedor antes da confirmação/i)
    if(mode) assert.match(result,/WhatsApp do vendedor após o encaminhamento confirmado/)
  }
})
