const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const bg = fs.readFileSync(path.join(process.env.CRM_EXT_DIR || __dirname, 'background.js'), 'utf8')
const helpers = bg.includes('function crmLabelSnapshotKey(') ? bg.slice(bg.indexOf('function crmLabelSnapshotKey('), bg.indexOf('async function executarSync()')) : ''
const base = () => ({ ok:true, labels_confiavel:true, payload:[{id:'1',name:'Etapa A',color:1,count:1},{id:'2',name:'Etapa B',color:2,count:1}], chats_etiquetas:[{phone:'5511999990001',chat_id:'111@lid',label_ids:['1']},{phone:'5511999990002',chat_id:'222@lid',label_ids:['2']}], total_chats:2, sem_etiqueta:0, chats_ativos_hoje:0, chat_ts_map:{} })
function key(result, seller='ANA') {
  const context=vm.createContext({result,cfg:{vendedor_nome:seller},Map,Set,JSON})
  vm.runInContext(helpers,context)
  const start=bg.indexOf('      // Snapshot pra evitar POST sem mudança')
  const end=bg.indexOf('      // ===== Atividade diária',start)
  vm.runInContext(bg.slice(start,end)+'\nglobalThis.actual=key',context)
  return context.actual
}
function sync(result,{seller='ANA',ack=true,ok=true,throws=false,previousKey='old-key',snapshot={kept:['Etapa A']}}={}) {
  const writes=[],posts=[]
  const state={vendedor_nome:seller,enabled:true,last_snapshot_key:previousKey,chat_labels_snapshot:snapshot}
  const context=vm.createContext({
    _syncInFlight:false,console:{log(){},warn(){},info(){},error(){}},Date,Map,Set,JSON,
    CADENCIA_MS:{},naHora:()=>false,autoAtualizarPara:()=>false,queryAbasWa:async()=>[{id:7}],
    ultimaSemAvisoAnaPara:()=>true,chamarAgenteNaAba:async(_tab,fn)=>fn==='lerEtiquetas'?result:{ok:true,itens:[],agente:'test'},
    reinjetarAgenteSeVelho:async()=>{},sincronizarMensagensFunil:async()=>{},podeAutomatizar:()=>false,
    ARQUIVAR_LEGADO_ATE:{},ETIQUETAS_COMPLETAS_PARA:[],_etqCompletasDiag:{},_autoUpdDiag:null,_crmAvatarDiag:null,
    _portaDiag:{},_iaRapidaDiag:{},_iaSaidaDiag:{},_beaconsPopoutRecentes:()=>[],widConhecido:async()=>null,
    crmSyncAvatarsIfDue:()=>{},gateBackfill:async()=>{},GATE_CANON:s=>s,gateCarimbar:async()=>{},
    normLabel:s=>s,dispararPortaLead:()=>{},cadenciaAnaPara:()=>false,CALL_AMOSTRA_V:1,
    compararVersao:()=>0,sincronizarAvatars:async()=>{},ENDPOINT:'https://labels.invalid',SHARED_SECRET:'fake',
    chrome:{runtime:{getURL:()=>'',getManifest:()=>({version:'test'})},storage:{local:{get:async keys=>{const out={};for(const k of typeof keys==='string'?[keys]:keys)if(k in state)out[k]=state[k];return out},set:async values=>{writes.push(values);Object.assign(state,values)}}}},
    fetch:async(url,init)=>{if(url!=='https://labels.invalid')throw new Error('Unexpected endpoint');const payload=JSON.parse(init.body);posts.push(payload);if(throws)throw new TypeError('Failed to fetch');return {ok,status:ok?200:503,text:async()=>'',json:async()=>({...ack===true?{ok:true,heartbeat:false,chat_labels:2,chat_labels_raw:2,chat_labels_filtered:2}:ack===false?{ok:false}:ack})}},
  })
  vm.runInContext(helpers+bg.slice(bg.indexOf('async function executarSync()'),bg.indexOf('// ============ ELEIÇÃO DE INSTÂNCIA CENTRAL')),context)
  return {state,writes,posts,run:()=>context.executarSync()}
}
test('balanced label exchange changes the real-source snapshot key',()=>{const a=base(),b=base();b.chats_etiquetas[0].label_ids=['2'];b.chats_etiquetas[1].label_ids=['1'];assert.notEqual(key(a),key(b))})
test('label rename and color change are synced even with unchanged ID/count',()=>{const a=base(),b=base();b.payload[0].name='Etapa renomeada';assert.notEqual(key(a),key(b));b.payload[0].name=a.payload[0].name;b.payload[0].color=4;assert.notEqual(key(a),key(b))})
test('removal from a chat and addition to another changes key without aggregate change',()=>{const a=base(),b=base();b.chats_etiquetas[0].label_ids=[];b.chats_etiquetas[1].label_ids=['1','2'];assert.notEqual(key(a),key(b))})
test('catalog/chat/label order and duplicate label IDs do not create a new snapshot',()=>{const a=base(),b=base();a.chats_etiquetas[0].label_ids=['1','2'];b.chats_etiquetas[0].label_ids=['2','1','1'];b.chats_etiquetas.reverse();b.payload.reverse();assert.equal(key(a),key(b))})
test('untrusted or unknown ANA label reads have no publishable fingerprint',()=>{for(const trusted of [false,undefined,null]){const a=base();a.labels_confiavel=trusted;assert.equal(key(a),null)}})
test('other sellers retain their exact legacy fingerprint regardless of trust',()=>{const a=base(),b=base();b.labels_confiavel=false;b.payload[0].name='renamed';b.chats_etiquetas[0].label_ids=[];assert.equal(key(a,'DANIEL'),'1:1|2:1');assert.equal(key(a,'DANIEL'),key(b,'DANIEL'))})
test('ANA partial read posts heartbeat only, preserving both persisted snapshots',async()=>{const a=base();a.labels_confiavel=false;const h=sync(a);await h.run();assert.equal(h.posts.length,1);assert.equal(h.posts[0]._diag.heartbeat_only,true);assert.deepEqual(h.posts[0].etiquetas,[]);assert.deepEqual(h.posts[0].chats_etiquetas,[]);assert.equal(h.posts[0]._diag.skip_reason,'labels_untrusted');assert.equal(h.state.last_snapshot_key,'old-key');assert.deepEqual(h.state.chat_labels_snapshot,{kept:['Etapa A']})})
test('unchanged trusted ANA read only heartbeats and never advances the snapshot',async()=>{const a=base(),previousKey=key(a)+'|0|0',h=sync(a,{previousKey});await h.run();assert.equal(h.posts.length,1);assert.equal(h.posts[0]._diag.heartbeat_only,true);assert.equal(h.state.last_snapshot_key,previousKey);assert.ok(!h.writes.some(x=>'last_snapshot_key' in x))})
test('successful full ANA ACK commits both snapshots after the POST',async()=>{const a=base(),h=sync(a);await h.run();assert.equal(h.posts.length,1);assert.equal(h.posts[0]._diag.heartbeat_only,undefined);assert.equal(h.state.last_snapshot_key,key(a)+'|0|0');assert.deepEqual(JSON.parse(JSON.stringify(h.state.chat_labels_snapshot)),{'5511999990001':['ETAPA A'],'5511999990002':['ETAPA B']})})
test('HTTP failure, lost network ACK and rejected body preserve old ANA fingerprint/snapshot',async()=>{for(const options of [{ok:false},{throws:true},{ack:false},{ack:{ok:true,heartbeat:false,chat_labels:1,chat_labels_raw:2,chat_labels_filtered:2}},{ack:{ok:true,heartbeat:true,chat_labels:2,chat_labels_raw:2,chat_labels_filtered:2}},{ack:{}}]){const h=sync(base(),options);await h.run();assert.equal(h.posts.length,1);assert.equal(h.state.last_snapshot_key,'old-key');assert.deepEqual(h.state.chat_labels_snapshot,{kept:['Etapa A']});assert.ok(!h.writes.some(x=>'last_snapshot_key' in x))}})
test('non-ANA ACK body behavior remains unchanged',async()=>{const h=sync(base(),{seller:'DANIEL',ack:false});await h.run();assert.equal(h.state.last_snapshot_key,'1:1|2:1|0|0')})
test('ACK contract matches production truncation, empty labels and phone filtering',()=>{
  const context=vm.createContext({Map,Set,JSON});vm.runInContext(helpers,context)
  const a=base();a.chats_etiquetas[0].label_ids=[]
  a.chats_etiquetas.push({phone:'short',chat_id:'333@lid',label_ids:['1']})
  a.chats_etiquetas.push({phone:'5511999990004',chat_id:'444@lid',label_ids:null})
  assert.equal(context.crmLabelSnapshotAck('ANA',a,{ok:true,heartbeat:false,chat_labels:2,chat_labels_raw:4,chat_labels_filtered:2}),true)
  assert.equal(context.crmLabelSnapshotAck('ANA',a,{ok:true,heartbeat:false,chat_labels:1,chat_labels_raw:4,chat_labels_filtered:2}),false)
  a.chats_etiquetas=Array.from({length:5001},(_,i)=>({phone:String(5511000000000+i),chat_id:i+'@lid',label_ids:[]}))
  assert.equal(context.crmLabelSnapshotAck('ANA',a,{ok:true,heartbeat:false,chat_labels:5000,chat_labels_raw:5001,chat_labels_filtered:5000}),true)
})
