import test from 'node:test';
import assert from 'node:assert/strict';
import type { EscopoEspelho as Escopo } from '../../api/_lib/producao-espelho-acesso.js';
import { criarFonteEspelhoPrivada, lerProducaoEspelho, projetarEspelhoProducao, type FonteEspelho, type ReciboEspelho } from '../../api/_lib/producao-espelho-reader.js';
const stamp='2026-10-01T20:38:12.028294+00', instant='2026-10-01T20:38:12.028Z';
const id=(n:number)=>`00000000-0000-4000-8abc-${n.toString(16).padStart(12,'0')}`;
const global:Escopo={userId:id(999999),role:'admin',displayName:'Synthetic',vendedores:null};
const restricted={...global,role:'vendor',vendedores:['ANA']};
const card=(n=1,extra:Record<string,unknown>={})=>({id:id(n),pedido_id:id(n+2000),cliente_nome:'  Nome físico  ',vendedor_nome:'OTHER',status:'SOLDA',doc_original_path:'javascript:inert-path',created_at:stamp,updated_at:stamp,excluido:false,doc_tratado_path:null,prazo_dias:null,prazo_tipo:null,prazo_data:null,observacoes:null,numero_orcamento:null,motor_marca:null,motor_tensao:null,resumo_equipamentos:null,titulo_equipamento:null,codigo_rastreio:null,cidade_destino:null,observacao_vendedor:null,parado_status:null,parado_motivo:null,orcamento_revisado_info:null,motor_tensao_vendedor:null,excluido_em:null,parado_em:null,orcamento_revisado_em:null,orcamento_revisado_visto_em:null,excluido_por:null,checklist_compras:null,...extra});
const history=(n=1,cardId=id(1))=>({id:id(n+3000),card_id:cardId,new_status:'UNKNOWN',changed_at:stamp,old_status:null,changed_by:null,cliente_nome:null,numero_orcamento:null});
const logistics=(cardId=id(1))=>({card_id:cardId,peso_kg:'12345678901234567890.123456789',qtd_volumes:null,medidas:null,observacoes:null,updated_at:stamp,updated_by:null});
const sector=(n=1,cardId=id(1))=>({id:id(n+4000),card_id:cardId,setor:'constructor',responsavel_id:null,previsao_termino:'2026-10-01',andamento:null,status:null,motivo_bloqueio:null,iniciado_em:null,concluido_em:null,created_at:null,updated_at:null});
const checklist=(n=1,sectorId=id(4001))=>({id:id(n+5000),setor_producao_id:sectorId,titulo:'<img onerror=inert>',descricao:null,ordem:null,concluido:null,concluido_por:null,concluido_em:null,created_at:null});
type Tables=Record<string,Record<string,unknown>[]>;
type Capture={table:string;columns:string;order:string;from:number;to:number;field?:string;ids?:string[];signal?:AbortSignal};
function source(tables:Tables={},change?:(receipt:ReciboEspelho,call:Capture)=>ReciboEspelho|Promise<ReciboEspelho>){const calls:Capture[]=[];const fonte={from(table:string){const call={table,columns:'',order:'',from:0,to:0} as Capture;const q={select(columns:string,options:unknown){assert.deepEqual(options,{count:'exact'});call.columns=columns;return q;},in(field:string,ids:string[]){call.field=field;call.ids=ids;return q;},order(column:string,options:unknown){assert.deepEqual(options,{ascending:true});call.order=column;return q;},range(from:number,to:number){call.from=from;call.to=to;return q;},async abortSignal(signal:AbortSignal){call.signal=signal;calls.push(call);const rows=(tables[table]??[]).filter(row=>!call.ids||call.ids.includes(String(row[call.field!]).toLowerCase()));const receipt={data:rows.slice(call.from,call.to+1),count:rows.length,error:null};return change?change(receipt,call):receipt;}};return q;}} as FonteEspelho;return {fonte,calls};}
const fixture=()=>({producao_cards:[card()],producao_status_log:[history()],producao_logistica:[logistics()],setor_producao:[sector()],setor_checklist:[checklist()]});
const read=(tables:Tables=fixture(),scope=global,extra:Record<string,unknown>={})=>lerProducaoEspelho(scope,{fonte:()=>source(tables).fonte,instante:()=>instant,...extra});
const unavailable=/^Error: producao_indisponivel$/;

test('five readonly receipts preserve every physical field and close output without inferred semantics',async()=>{const tables=fixture();tables.producao_cards=[card(1,{status:'__proto__',excluido:true,checklist_compras:JSON.stringify({raw:[null,true,'  literal  ',2]}),raw:'PRIVATE'})];const s=source(tables);const out=await lerProducaoEspelho(global,{fonte:()=>s.fonte,instante:()=>instant});assert.equal(out.origem,'app2');assert.equal(out.fonte,'controle-producao-live');assert.equal(out.consultadoEm,instant);assert.equal(out.atualizadoEm,null);assert.equal(out.sincronizadoEm,null);assert.equal(out.consistency,'crossread_unproved');assert.equal(out.parcial,false);assert.deepEqual(out.complete,{cards:true,historico:true,logistica:true,setores:true,checklists:true});assert.deepEqual(out.totals,{cards:1,historico:1,logistica:1,setores:1,checklists:1});const c=out.dados.cards[0];assert.equal(c.pedidoId,null);assert.equal(c.cliente,'  Nome físico  ');assert.equal(c.atualizadoEm,stamp);assert.equal(c.dadosOriginais.vinculo,'nao_verificado');assert.equal(c.dadosOriginais.pedido_id,id(2001));assert.equal(c.dadosOriginais.raw,undefined);assert.equal(c.dadosOriginais.arquivo_fabrica_url,undefined);assert.deepEqual(c.dadosOriginais.logistica,logistics());assert.deepEqual(c.dadosOriginais.historico,[history()]);assert.deepEqual(c.dadosOriginais.setores,[{...sector(),checklists:[checklist()]}]);assert.equal(out.dados.porEtapa.__proto__,1);assert.equal(out.dados.porSetor.constructor,1);assert.equal(out.dados.kpis.urgentes,undefined);assert.equal(out.dados.kpis.progresso,undefined);assert.ok(s.calls.every(c=>c.signal&&!c.signal.aborted));assert.equal(s.calls.find(c=>c.table==='producao_logistica')?.order,'card_id');assert.match(s.calls.find(c=>c.table==='producao_logistica')!.columns,/peso_kg:peso_kg::text/);assert.ok(s.calls.every(c=>!c.ids||c.ids.length<=100));});
test('excluded and cancellation are independent, unknown statuses and manual links remain discoverable globally',async()=>{const out=await read({producao_cards:[card(1,{status:'CANCELADO'}),card(2,{status:'ENTREGUE'}),card(3,{excluido:true,status:'CANCELADO'}),card(4,{pedido_id:'MANUAL-X',status:' unknown '})]});assert.equal(out.dados.cards.length,4);assert.deepEqual(out.dados.kpis,{total:4,excluidos:1,ativos:1,entregues:1,cancelados:1,pedidosUnicos:0});assert.deepEqual(out.dados.cards.map(c=>c.etapa),['CANCELADO','ENTREGUE','CANCELADO',' unknown ']);assert.ok(out.dados.cards.every(c=>c.pedidoId===null));});
test('global never invokes canonical provider; restricted fresh receipt uses secondary slot and filters relations',async()=>{let lookups=0;const tables={producao_cards:[card(1),card(2,{pedido_id:id(2001).toUpperCase()}),card(3,{pedido_id:'MANUAL-X',vendedor_nome:'ANA'}),card(4)],producao_status_log:[history(1),history(2,id(4))]};await read(tables,global,{pais:async()=>{throw Error('must not lookup global');}});const out=await read(tables,restricted,{pais:async(ids:string[],signal:AbortSignal)=>{lookups++;assert.deepEqual(ids,[id(2001),id(2004)]);assert.equal(signal.aborted,false);return {complete:true,rows:[{id:id(2001).toUpperCase(),vendedor:'BETO',vendedor_2:'ANA'}]};}});assert.equal(lookups,1);assert.deepEqual(out.dados.cards.map(c=>c.id),[id(1),id(2)]);assert.equal(out.dados.cards[0].pedidoId,id(2001).toUpperCase());assert.equal(out.dados.cards[0].vendedor,'OTHER');assert.equal(out.dados.cards[0].dadosOriginais.vinculo,'confirmado');assert.equal(out.totals.historico,1);assert.equal(out.dados.kpis.pedidosUnicos,1);assert.equal((await read(tables,restricted,{pais:async()=>({complete:true,rows:[{id:id(2001),vendedor:'OTHER',vendedor_2:null}]})})).dados.cards.length,0);});
test('restricted empty candidates still requires a fresh configured complete canonical channel',async()=>{let lookups=0;const out=await read({producao_cards:[card(1,{pedido_id:'MANUAL-X'})]},restricted,{pais:async(ids:string[])=>{lookups++;assert.deepEqual(ids,[]);return {complete:true,rows:[]};}});assert.equal(out.dados.cards.length,0);assert.equal(lookups,1);await assert.rejects(read({},restricted,{pais:async()=>{throw Error('PRIVATE missing channel');}}),unavailable);});
for(const bad of [{complete:false,rows:[]},{complete:true,rows:[{id:id(2001),vendedor:'ANA'}]},{complete:true,rows:[{id:id(2001),vendedor:'ANA',vendedor_2:null},{id:id(2001).toUpperCase(),vendedor:'ANA',vendedor_2:null}]},{complete:true,rows:[{id:id(9000),vendedor:'ANA',vendedor_2:null}]}])test('invalid/duplicate/unrequested/incomplete canonical receipt fails wholly',async()=>{await assert.rejects(read(fixture(),restricted,{pais:async()=>bad}),unavailable);});
test('invalid scope is rejected before source or parent IO and only known privileged roles are global',async()=>{for(const scope of [{...global,userId:''},{...global,userId:'u1'},{...global,role:'vendor'},{...global,role:'technical'},{...restricted,vendedores:[]},{...restricted,vendedores:['']},{...restricted,vendedores:[null]}]){let calls=0;await assert.rejects(lerProducaoEspelho(scope as typeof global,{fonte:()=>{calls++;throw Error('IO');},pais:async()=>{calls++;throw Error('IO');}}),unavailable);assert.equal(calls,0);}for(const role of ['admin','financeiro'])assert.equal((await read({}, {...global,role})).totals.cards,0);for(const role of ['vendor','mapa','marketing','visualizador'])assert.equal((await read({}, {...restricted,role},{pais:async()=>({complete:true,rows:[]})})).totals.cards,0);});
test('1001+ cards and related batches are complete with stable IDs/ranges and source row budget',async()=>{const tables:Tables={producao_cards:Array.from({length:1001},(_,i)=>card(i+1)),producao_status_log:Array.from({length:1001},(_,i)=>history(i+1)),producao_logistica:Array.from({length:1001},(_,i)=>logistics(id(i+1))),setor_producao:Array.from({length:1001},(_,i)=>sector(i+1)),setor_checklist:Array.from({length:1001},(_,i)=>checklist(i+1))};const s=source(tables);const out=await lerProducaoEspelho(global,{fonte:()=>s.fonte,instante:()=>instant});assert.equal(out.totals.cards,1001);assert.equal(out.totals.historico,1001);assert.equal(out.totals.checklists,1001);assert.equal(out.totals.logistica,1001);assert.equal(out.totals.setores,1001);assert.deepEqual(s.calls.filter(c=>c.table==='producao_cards').map(c=>[c.from,c.to]),[[0,999],[1000,1999]]);assert.ok(s.calls.some(c=>c.table==='producao_status_log'&&c.from===1000));assert.ok(s.calls.some(c=>c.table==='setor_checklist'&&c.from===1000));assert.ok(s.calls.some(c=>c.table==='setor_producao'&&c.from===1000));assert.equal(s.calls.filter(c=>c.table==='producao_logistica').length,11);assert.ok(s.calls.every(c=>!c.ids||c.ids.length<=100));});
test('canonical provider factory pinned separately and parent UUID batching is readonly',async()=>{const tables={producao_cards:Array.from({length:1001},(_,i)=>card(i+1))};const main=source(tables),parent=source({pedidos_venda:Array.from({length:1001},(_,i)=>({id:id(i+2001),vendedor:null,vendedor_2:'ANA'}))});const out=await lerProducaoEspelho(restricted,{fonte:()=>main.fonte,fontePais:()=>parent.fonte,instante:()=>instant});assert.equal(out.totals.cards,1001);assert.equal(parent.calls.length,11);assert.ok(parent.calls.every(c=>c.columns==='id,vendedor,vendedor_2'&&c.order==='id'&&c.ids!.length<=100&&c.signal===main.calls[0].signal));});
test('receipt holes/count drift/truncation/duplicates/filter escape invalidate all collections',async()=>{const tables:Tables={producao_cards:Array.from({length:1001},(_,i)=>card(i+1)),producao_status_log:[history()],producao_logistica:[logistics()],setor_producao:[sector()],setor_checklist:[checklist()]};for(const change of [(r:ReciboEspelho,c:Capture)=>c.table==='producao_cards'&&c.from?{...r,count:1002}:r,(r:ReciboEspelho,c:Capture)=>c.table==='producao_cards'?{...r,data:(r.data as unknown[]).slice(1)}:r,(r:ReciboEspelho,c:Capture)=>c.table==='producao_cards'&&c.from?{...r,data:[card(1)]}:r,(r:ReciboEspelho,c:Capture)=>c.table==='producao_status_log'?{...r,data:[history(1,id(90000))]}:r,(r:ReciboEspelho,c:Capture)=>c.table==='setor_checklist'?{...r,data:[checklist(1,id(90000))]}:r,(r:ReciboEspelho,c:Capture)=>c.table==='producao_logistica'?{...r,count:2,data:[logistics(),logistics(id(1).toUpperCase())]}:r,(r:ReciboEspelho,c:Capture)=>c.table==='setor_producao'?{...r,data:new Array(1)}:r])await assert.rejects(lerProducaoEspelho(global,{fonte:()=>source(tables,change).fonte}),unavailable);});
for(const table of ['producao_cards','producao_status_log','producao_logistica','setor_producao','setor_checklist'])test(`every collection is mandatory and sanitized on failure: ${table}`,async()=>{await assert.rejects(lerProducaoEspelho(global,{fonte:()=>source(fixture(),(r,c)=>c.table===table?{...r,error:Error('PRIVATE URL TOKEN')}:r).fonte}),unavailable);});
test('strict own physical columns, nullable types/int4/UUIDs, NUMERIC string and case uniqueness',async()=>{for(const change of [(t:Tables)=>{delete t.producao_cards[0].excluido;},(t:Tables)=>{t.producao_cards[0].status=null;},(t:Tables)=>{t.producao_cards[0].excluido=0;},(t:Tables)=>{t.producao_cards[0].prazo_dias=2147483648;},(t:Tables)=>{t.producao_cards[0].excluido_por='notuuid';},(t:Tables)=>{t.producao_cards.push(card(1,{id:id(1).toUpperCase()}));},(t:Tables)=>{t.producao_logistica[0].peso_kg=0;},(t:Tables)=>{t.setor_checklist[0].concluido=0;},(t:Tables)=>{t.setor_producao[0].andamento=1.2;}]){const tables:Tables=fixture();change(tables);await assert.rejects(read(tables),unavailable);}for(const value of ['NaN','Infinity','-Infinity','0','-0.0001']){const tables=fixture();tables.producao_logistica[0].peso_kg=value;assert.equal((await read(tables)).dados.cards[0].dadosOriginais.logistica?.peso_kg,value);}});
test('JSONB text preserves opaque data and rejects malformed wire values and all structural budgets',async()=>{const cyclic:Record<string,unknown>={};cyclic.self=cyclic;let deep:unknown=null;for(let i=0;i<17;i++)deep=[deep];for(const value of [cyclic,new Array(1),new Date(),NaN,Infinity,JSON.stringify(deep),JSON.stringify(Array.from({length:10000},()=>null)),JSON.stringify('x'.repeat(1048576)),{'a':undefined}])await assert.rejects(read({producao_cards:[card(1,{checklist_compras:value})]}),unavailable);const shared={value:'x'};const valid=JSON.stringify({a:shared,b:shared});assert.deepEqual((await read({producao_cards:[card(1,{checklist_compras:valid})]})).dados.cards[0].dadosOriginais.checklist_compras,valid);const cards=Array.from({length:9},(_,i)=>card(i+1,{checklist_compras:JSON.stringify('x'.repeat(950000))}));await assert.rejects(read({producao_cards:cards}),unavailable);});
test('single budget includes canonical and related rows before projection',async()=>{const main=source(fixture(),(r,c)=>c.table==='producao_status_log'?{...r,count:100000}:r);await assert.rejects(lerProducaoEspelho(global,{fonte:()=>main.fonte}),unavailable);const s=source({producao_cards:Array.from({length:100000},(_,i)=>card(i+1))});await assert.rejects(lerProducaoEspelho(restricted,{fonte:()=>s.fonte,pais:async(ids:string[])=>({complete:true,rows:ids.map(pid=>({id:pid,vendedor:'ANA',vendedor_2:null}))})}),unavailable);});
test('deadline covers factory, awaits, JSON validation and final instant; external abort propagates without late DTO',async()=>{let now=0;const s=source(fixture(),(r)=>{now=30;return r;});await assert.rejects(lerProducaoEspelho(global,{fonte:()=>s.fonte,agora:()=>now,deadlineMs:30}),unavailable);assert.equal(s.calls[0].signal!.aborted,true);now=0;await assert.rejects(read({},global,{agora:()=>now,deadlineMs:30,instante:()=>{now=30;return instant;}}),unavailable);await assert.rejects(read({},global,{deadlineMs:0}),unavailable);await assert.rejects(lerProducaoEspelho(global,{fonte:()=>new Promise(()=>{}),deadlineMs:5}),unavailable);const abort=new AbortController();let lateResolve:(v:ReciboEspelho)=>void=()=>{};const delayed=source(fixture(),()=>new Promise(resolve=>{lateResolve=resolve;}));const pending=lerProducaoEspelho(global,{fonte:()=>delayed.fonte,signal:abort.signal});await new Promise(resolve=>setImmediate(resolve));abort.abort();await assert.rejects(pending,unavailable);assert.equal(delayed.calls[0].signal!.aborted,true);lateResolve({data:[],count:0,error:null});await new Promise(resolve=>setImmediate(resolve));});
test('private channel exact pins and private key shape never reuse anon/CRM/receiver',()=>{const jwt=(role:string,ref:string)=>`eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({role,ref})).toString('base64url')}.syntheticsignature`;const config={PRODUCAO_SUPABASE_URL:'https://yyfosrvlpsaycjnxcnkj.supabase.co',PRODUCAO_PRIVATE_READ_KEY:'sb_secret_synthetic_private_abcdefghijkl'};let calls=0;const create=(url:string,key:string,options:unknown)=>{calls++;assert.equal(url,config.PRODUCAO_SUPABASE_URL);assert.equal(key,config.PRODUCAO_PRIVATE_READ_KEY);assert.deepEqual(options,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});return source().fonte;};criarFonteEspelhoPrivada(config,'fabrica',create);assert.equal(calls,1);for(const bad of [{...config,PRODUCAO_SUPABASE_URL:'https://yyfosrvlpsaycjnxcnkj.supabase.co:443'},{...config,PRODUCAO_SUPABASE_URL:'https://yyfosrvlpsaycjnxcnkj.supabase.co/path'},{...config,PRODUCAO_PRIVATE_READ_KEY:'sb_publishable_synthetic'},{...config,PRODUCAO_PRIVATE_READ_KEY:' '+config.PRODUCAO_PRIVATE_READ_KEY},{...config,PRODUCAO_PRIVATE_READ_KEY:jwt('anon','yyfosrvlpsaycjnxcnkj')},{...config,PRODUCAO_PRIVATE_READ_KEY:jwt('service_role','flwbeevtvjiouxdjmziv')},{...config,unknown:'PRIVATE'}])assert.throws(()=>criarFonteEspelhoPrivada(bad,'fabrica',create),unavailable);assert.equal(calls,1);assert.ok(criarFonteEspelhoPrivada({...config,PRODUCAO_PRIVATE_READ_KEY:jwt('service_role','yyfosrvlpsaycjnxcnkj')},'fabrica',()=>source().fonte));assert.ok(criarFonteEspelhoPrivada({CONTROLE_SUPABASE_URL:'https://kfucuvwrnwrkshxpsmyq.supabase.co/',CONTROLE_SERVICE_KEY:jwt('service_role','kfucuvwrnwrkshxpsmyq')},'pais',()=>source().fonte));assert.throws(()=>criarFonteEspelhoPrivada(config,'pais',create),unavailable);});
test('public projection revalidates injected metadata/relations and recomputes derived aggregates without forwarding extras',async()=>{const out=await read();const closed=projetarEspelhoProducao({...out,PRIVATE:'hidden',dados:{...out.dados,kpis:{secret:999},porEtapa:{secret:999},porSetor:{secret:999}}},global);assert.deepEqual(closed,out);for(const bad of [{...out,origem:'controle-interno'},{...out,complete:{...out.complete,logistica:false}},{...out,parcial:true},{...out,consistency:'snapshot'},{...out,sincronizadoEm:stamp},{...out,consultadoEm:'invalid'},{...out,dados:{...out.dados,cards:[{...out.dados.cards[0],pedidoId:id(2001)}]}}])assert.throws(()=>projetarEspelhoProducao(bad,global),unavailable);});
test('entire response UTF8 byte cap rejects multibyte payload wholly, including defensive API projection',async()=>{const small=await read({producao_cards:[card(1,{observacoes:'é'.repeat(1000000)})]});assert.ok(Buffer.byteLength(JSON.stringify(small),'utf8')<4000000);const raw={producao_cards:[card(1,{observacoes:'é'.repeat(2000000)})]};await assert.rejects(read(raw),unavailable);const c=small.dados.cards[0];assert.throws(()=>projetarEspelhoProducao({...small,dados:{...small.dados,cards:[{...c,dadosOriginais:{...c.dadosOriginais,observacoes:'é'.repeat(2000000)}}]}},global),unavailable);});
test('NUMERIC cast must be physical numeric text, never arbitrary string or alternate unsafe alias',async()=>{for(const peso_kg of ['not numeric','0 PRIVATE','']){const tables:Tables=fixture();tables.producao_logistica[0].peso_kg=peso_kg;await assert.rejects(read(tables),unavailable);}const tables:Tables=fixture();delete tables.producao_logistica[0].peso_kg;tables.producao_logistica[0].weight='1';await assert.rejects(read(tables),unavailable);});
test('JSON exact depth/node/UTF8 boundaries preserve text instead of coercion or truncation',async()=>{let deep:unknown=null;for(let i=0;i<16;i++)deep=[deep];for(const value of [JSON.stringify(deep),JSON.stringify(Array.from({length:9999},()=>null)),JSON.stringify('x'.repeat(1048574)),'{"__proto__":null,"constructor":"literal"}']){const out=await read({producao_cards:[card(1,{checklist_compras:value})]});assert.deepEqual(out.dados.cards[0].dadosOriginais.checklist_compras,value);}await assert.rejects(read({producao_cards:[card(1,{checklist_compras:JSON.stringify('é'.repeat(524288))})]}),unavailable);});
test('whole envelope exact 4000000-byte boundary is accepted; plus one byte fails',async()=>{const base=await read({producao_cards:[card(1,{observacoes:''})]});const padding=4000000-Buffer.byteLength(JSON.stringify(base),'utf8');const out=await read({producao_cards:[card(1,{observacoes:'x'.repeat(padding)})]});assert.equal(Buffer.byteLength(JSON.stringify(out),'utf8'),4000000);await assert.rejects(read({producao_cards:[card(1,{observacoes:'x'.repeat(padding+1)})]}),unavailable);});
test('receipt ownership and required error field cannot be supplied by a prototype or omission',async()=>{for(const change of [(r:ReciboEspelho)=>Object.create(r),(r:ReciboEspelho)=>({data:r.data,count:r.count}) as ReciboEspelho])await assert.rejects(lerProducaoEspelho(global,{fonte:()=>source(fixture(),change).fonte,instante:()=>instant}),unavailable);});
test('defensive envelope requires aggregate containers and textual notice before recomputing them',async()=>{const out=await read();for(const bad of [{...out,totals:null},{...out,aviso:123},{...out,dados:{...out.dados,kpis:null}},{...out,dados:{...out.dados,porEtapa:null}},{...out,dados:{...out.dados,porSetor:null}}])assert.throws(()=>projetarEspelhoProducao(bad,global),unavailable);});
test('JSONtext cast preserves numeric lexemes, SQLNULL versus JSONnull and exact PostgreSQL bytes',async()=>{for(const value of ['9007199254740993','1234567890.123456789012345678901','1e999','null','{"n": 9007199254740993, "decimal": 0.1234567890123456789}','"text"',null]){const s=source({producao_cards:[card(1,{checklist_compras:value})]});const out=await lerProducaoEspelho(global,{fonte:()=>s.fonte,instante:()=>instant});assert.equal(out.dados.cards[0].dadosOriginais.checklist_compras,value);assert.match(s.calls[0].columns,/checklist_compras:checklist_compras::text/);}});
test('JSONtext rejects object/numeric wire values and malformed syntax without restoring text from objects',async()=>{for(const value of [{n:1},[1],1,true,NaN,Infinity,'NaN','Infinity','{"n":Infinity}','{"bad":}','undefined','plain text',''])await assert.rejects(read({producao_cards:[card(1,{checklist_compras:value})]}),unavailable);});
test('declared completeness totals require five own safe counts and must match cards and every related collection',async()=>{const out=await read(),empty=await read({});assert.throws(()=>projetarEspelhoProducao({...empty,totals:{...empty.totals,cards:573}},global),unavailable);const keys=['cards','historico','logistica','setores','checklists'] as const;for(const kind of keys){const missing={...out.totals} as Partial<typeof out.totals>;delete missing[kind];for(const totals of [missing,{...out.totals,[kind]:out.totals[kind]+1},{...out.totals,[kind]:0}])assert.throws(()=>projetarEspelhoProducao({...out,totals},global),unavailable);}for(const value of [-1,0.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1',null,undefined])assert.throws(()=>projetarEspelhoProducao({...out,totals:{...out.totals,cards:value}},global),unavailable);assert.throws(()=>projetarEspelhoProducao({...out,totals:Object.create(out.totals)},global),unavailable);assert.deepEqual(projetarEspelhoProducao(empty,global),empty);});

const project=(n=1,cardId=id(1),extra:Record<string,unknown>={})=>({
  id:id(6000+n),card_id:cardId,responsavel_projeto_id:id(7001),
  status_projeto:'bloqueado',andamento:40,previsao_termino:'2026-10-02',
  prazo_prometido:null,prazo_interno:'2026-10-01',...extra,
});
const projectFixture=():Tables=>({...fixture(),projeto_detalhes:[project()],projetistas:[{id:id(7001),nome:'Betuel'}]});

test('opt-in board reads cards and linked project names without loading any detail collection',async()=>{
  const s=source(projectFixture()),out=await read(projectFixture(),global,{fonte:()=>s.fonte,visao:'quadro-v1'});
  assert.equal(out.parcial,true);assert.deepEqual(out.complete,{cards:true,historico:false,logistica:false,setores:false,checklists:false});
  assert.deepEqual(out.totals,{cards:1,historico:null,logistica:null,setores:null,checklists:null});assert.equal(out.dados.porSetor,null);
  assert.deepEqual(s.calls.map(c=>c.table),['producao_cards','projeto_detalhes','projetistas']);
  const raw=out.dados.cards[0].dadosOriginais;assert.equal(raw.projeto?.responsavel_nome,'Betuel');
  for(const name of ['historico','logistica','setores'])assert.equal(Object.prototype.hasOwnProperty.call(raw,name),false);
});

test('light board filters by canonical authorized parents before reading project details',async()=>{
  const tables=projectFixture();tables.producao_cards.push(card(2));tables.projeto_detalhes.push(project(2,id(2)));
  const s=source(tables),out=await read(tables,restricted,{fonte:()=>s.fonte,visao:'quadro-v1',pais:async()=>({complete:true,rows:[{id:id(2001),vendedor:'ANA',vendedor_2:null},{id:id(2002),vendedor:'Ana OTHER',vendedor_2:null}]})});
  assert.deepEqual(out.dados.cards.map(c=>c.id),[id(1)]);assert.equal(out.dados.cards[0].pedidoId,id(2001));
  assert.deepEqual(s.calls.find(c=>c.table==='projeto_detalhes')?.ids,[id(1)]);
});

test('project lookup reads only cards already authorized and names only referenced professionals',async()=>{
  const tables=projectFixture();tables.producao_cards.push(card(2));
  tables.projeto_detalhes.push(project(2,id(2),{responsavel_projeto_id:id(7002)}));
  tables.projetistas=[{id:id(7001),nome:'<img onerror="inert">',email:'PRIVATE',role:'admin'},{id:id(7002),nome:'Outside wallet'}];
  const s=source(tables);
  const out=await lerProducaoEspelho(restricted,{fonte:()=>s.fonte,instante:()=>instant,pais:async()=>({complete:true,rows:[{id:id(2001),vendedor:'ANA',vendedor_2:null}]})});
  assert.equal(out.dados.cards.length,1);
  assert.deepEqual(out.dados.cards[0].dadosOriginais.projeto,{...project(),responsavel_nome:'<img onerror="inert">'});
  const projects=s.calls.filter(c=>c.table==='projeto_detalhes'),names=s.calls.filter(c=>c.table==='projetistas');
  assert.equal(projects.length,1);assert.equal(names.length,1);
  assert.deepEqual(projects[0].ids,[id(1)]);assert.equal(projects[0].field,'card_id');
  assert.deepEqual(names[0].ids,[id(7001)]);assert.equal(names[0].columns,'id,nome');
  assert.equal(names[0].field,'id');assert.equal(names[0].signal,projects[0].signal);
  assert.equal(Object.prototype.hasOwnProperty.call(out.dados.cards[0].dadosOriginais.projeto, 'email'),false);
  assert.equal(Object.prototype.hasOwnProperty.call(out.dados.cards[0].dadosOriginais.projeto, 'role'),false);
  assert.ok(!JSON.stringify(out).includes('Outside wallet'));assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});

test('new reader emits explicit project null while defensive projection preserves legacy absence',async()=>{
  const out=await read();assert.equal(Object.prototype.hasOwnProperty.call(out.dados.cards[0].dadosOriginais,'projeto'),true);
  assert.equal(out.dados.cards[0].dadosOriginais.projeto,null);
  const legacy=structuredClone(out);delete legacy.dados.cards[0].dadosOriginais.projeto;
  const projected=projetarEspelhoProducao(legacy,global);
  assert.equal(Object.prototype.hasOwnProperty.call(projected.dados.cards[0].dadosOriginais,'projeto'),false);
  assert.deepEqual(projected,legacy);
});

test('unassigned project stays unassigned and unknown project status is literal source data',async()=>{
  const tables=projectFixture();tables.projeto_detalhes=[project(1,id(1),{responsavel_projeto_id:null,status_projeto:'<literal new status>',andamento:0})];
  const s=source(tables);const out=await lerProducaoEspelho(global,{fonte:()=>s.fonte,instante:()=>instant});
  assert.deepEqual(out.dados.cards[0].dadosOriginais.projeto,{...tables.projeto_detalhes[0],responsavel_nome:null});
  assert.equal(s.calls.filter(c=>c.table==='projetistas').length,0);
});

test('project output strips extras and never treats professional name or role as scope authorization',async()=>{
  const tables=projectFixture();tables.projeto_detalhes[0].email='PRIVATE';tables.projeto_detalhes[0].role='admin';
  const out=await read(tables);const c=out.dados.cards[0];
  const injected={...out,dados:{...out.dados,cards:[{...c,dadosOriginais:{...c.dadosOriginais,projeto:{...project(),responsavel_nome:'Betuel',email:'PRIVATE',role:'admin',token:'PRIVATE'}}}]}};
  assert.deepEqual(projetarEspelhoProducao(injected,global).dados.cards[0].dadosOriginais.projeto,{...project(),responsavel_nome:'Betuel'});
  assert.ok(!JSON.stringify(out).includes('PRIVATE'));
});

test('duplicate project rows for one card fail even when each physical id differs',async()=>{
  const tables=projectFixture();tables.projeto_detalhes.push(project(2));await assert.rejects(read(tables),unavailable);
});

test('project and professional lookup receipts cannot escape their requested ids',async()=>{
  for(const table of ['projeto_detalhes','projetistas']) {
    const s=source(projectFixture(),(r,c)=>c.table===table?{...r,data:table==='projeto_detalhes'?[project(1,id(2))]:[{id:id(7002),nome:'Not requested'}]}:r);
    await assert.rejects(lerProducaoEspelho(global,{fonte:()=>s.fonte,instante:()=>instant}),unavailable);
  }
});

test('referenced professional must exist with a nonempty literal name, without active filtering',async()=>{
  for(const rows of [[],[{id:id(7001),nome:null}],[{id:id(7001),nome:'   '}],[{id:id(7001)}]]) {
    const tables=projectFixture();tables.projetistas=rows;await assert.rejects(read(tables),unavailable);
  }
  const tables=projectFixture();tables.projetistas=[{id:id(7001),nome:'  Giuslei  ',ativo:false}];
  assert.equal((await read(tables)).dados.cards[0].dadosOriginais.projeto?.responsavel_nome,'  Giuslei  ');
});

test('project injection validates own fields, physical types, UUID relation and name pairing',async()=>{
  const out=await read();const c=out.dados.cards[0];
  const valid={...project(),responsavel_nome:'Betuel'};
  const missing={...valid} as Record<string,unknown>;delete missing.prazo_interno;
  for(const bad of [undefined,missing,Object.create(valid),{...valid,id:'not-uuid'},{...valid,card_id:id(2)},
    {...valid,responsavel_projeto_id:'not-uuid'},{...valid,andamento:1.5},{...valid,andamento:2147483648},
    {...valid,status_projeto:5},{...valid,previsao_termino:5},{...valid,responsavel_nome:null},
    {...valid,responsavel_nome:5},{...valid,responsavel_nome:''},{...valid,responsavel_projeto_id:null},
    {...valid,responsavel_projeto_id:null,responsavel_nome:'Someone'}]) {
    const injected={...out,dados:{...out.dados,cards:[{...c,dadosOriginais:{...c.dadosOriginais,projeto:bad}}]}};
    assert.throws(()=>projetarEspelhoProducao(injected,global),unavailable);
  }
});

test('same project physical id cannot be rebound to multiple cards during defensive projection',async()=>{
  const out=await read({producao_cards:[card(1),card(2)]});
  const cards=out.dados.cards.map((c,i)=>({...c,dadosOriginais:{...c.dadosOriginais,projeto:{...project(1,id(i+1)),responsavel_nome:'Betuel'}}}));
  assert.throws(()=>projetarEspelhoProducao({...out,dados:{...out.dados,cards}},global),unavailable);
});

for(const table of ['projeto_detalhes','projetistas']) {
  test(`new ${table} receipt errors or truncation fail wholly with no private error forwarding`,async()=>{
    for(const bad of ['error','partial']) {
      const s=source(projectFixture(),(r,c)=>c.table===table?bad==='error'?{...r,error:Error('PRIVATE SQL TOKEN')}:{...r,count:2}:r);
      await assert.rejects(lerProducaoEspelho(global,{fonte:()=>s.fonte,instante:()=>instant}),unavailable);
    }
  });
  test(`deadline also covers awaiting ${table}`,async()=>{
    let now=0;const s=source(projectFixture(),(r,c)=>{if(c.table===table)now=30;return r;});
    await assert.rejects(lerProducaoEspelho(global,{fonte:()=>s.fonte,agora:()=>now,deadlineMs:30,instante:()=>instant}),unavailable);
    assert.ok(s.calls.filter(c=>c.table===table).every(c=>c.signal?.aborted));
  });
}

test('new project and professional rows share the existing total source row budget',async()=>{
  const s=source(projectFixture(),(r,c)=>c.table==='projetistas'?{...r,count:100000}:r);
  await assert.rejects(lerProducaoEspelho(global,{fonte:()=>s.fonte,instante:()=>instant}),unavailable);
});

// Hold only the external SDK receipts: the real reader still owns scheduling,
// pagination, validation, cancellation and the complete physical envelope.
function controlledSource(tables:Tables,onStart?:(call:Capture)=>void) {
  type Pending={call:Capture;receipt:ReciboEspelho;release:(receipt?:ReciboEspelho)=>void};
  const pending:Pending[]=[];let active=0,peak=0;
  const s=source(tables,(receipt,call)=>{
    if(call.table==='producao_cards')return receipt;
    onStart?.(call);
    active++;peak=Math.max(peak,active);
    return new Promise<ReciboEspelho>(resolve=>pending.push({call,receipt,release(value=receipt){active--;resolve(value);}}));
  });
  const release=()=>{for(const entry of pending.splice(0).reverse())entry.release();};
  return {...s,pending,release,get active(){return active;},get peak(){return peak;}};
}
const settleReader=()=>new Promise<void>(resolve=>setImmediate(resolve));

test('independent authorized collections start together before any SDK receipt resolves',async()=>{
  const s=controlledSource(projectFixture()),controller=new AbortController();
  const reading=lerProducaoEspelho(global,{fonte:()=>s.fonte,signal:controller.signal,instante:()=>instant});
  const settled=reading.catch(()=>undefined);
  try {
    await settleReader();
    assert.deepEqual(s.pending.map(p=>p.call.table).sort(),['producao_logistica','producao_status_log','projeto_detalhes','setor_producao']);
    assert.equal(s.active,4);
  } finally {controller.abort();s.release();await settled;}
});

test('all batches share one four-query limit while out-of-order receipts preserve every row and page order',async()=>{
  const tables:Tables={
    producao_cards:Array.from({length:250},(_,i)=>card(i+1)),
    producao_status_log:Array.from({length:1201},(_,i)=>history(i+1)),
    producao_logistica:Array.from({length:250},(_,i)=>logistics(id(i+1))),
    setor_producao:Array.from({length:750},(_,i)=>sector(i+1,id(Math.floor(i/3)+1))),
    setor_checklist:Array.from({length:750},(_,i)=>checklist(i+1,id(i+4001))),
    projeto_detalhes:Array.from({length:250},(_,i)=>project(i+1,id(i+1))),
    projetistas:[{id:id(7001),nome:'Betuel'}],
  };
  const s=controlledSource(tables),controller=new AbortController();let done=false;
  const reading=lerProducaoEspelho(global,{fonte:()=>s.fonte,signal:controller.signal,instante:()=>instant});
  const settled=reading.then(out=>{done=true;return out;},error=>{done=true;throw error;});
  void settled.catch(()=>{});
  try {
    await settleReader();assert.equal(s.active,4);
    for(let turn=0;!done&&turn<100;turn++){assert.ok(s.active<=4);s.release();await settleReader();}
    assert.ok(done,'all queued receipts must finish');
    const out=await settled;
    assert.equal(s.peak,4);assert.deepEqual(out.totals,{cards:250,historico:1201,logistica:250,setores:750,checklists:750});
    assert.deepEqual(out.dados.cards.map(c=>c.id),tables.producao_cards.map(c=>c.id));
    assert.deepEqual(out.dados.cards[0].dadosOriginais.historico,tables.producao_status_log);
    for(let i=0;i<250;i++) {
      const raw=out.dados.cards[i].dadosOriginais;
      assert.deepEqual(raw.logistica,tables.producao_logistica[i]);
      assert.deepEqual(raw.projeto,{...tables.projeto_detalhes[i],responsavel_nome:'Betuel'});
      assert.deepEqual(raw.setores,tables.setor_producao.slice(i*3,i*3+3).map((s,j)=>({...s,checklists:[tables.setor_checklist[i*3+j]]})));
    }
    assert.deepEqual(s.calls.filter(c=>c.table==='producao_status_log'&&c.ids?.includes(id(1))).map(c=>c.from),[0,1000]);
    assert.ok(s.calls.every(c=>!c.ids||c.ids.length<=100));
  } finally {controller.abort();s.release();await settled.catch(()=>{});}
});

test('concurrent readers each have their own four-query capacity',async()=>{
  const s=controlledSource(projectFixture()),controller=new AbortController();
  const reading=Promise.all([1,2].map(()=>lerProducaoEspelho(global,{fonte:()=>s.fonte,signal:controller.signal,instante:()=>instant})));
  const settled=reading.catch(()=>undefined);
  try {await settleReader();assert.equal(s.active,8);}
  finally {controller.abort();s.release();await settled;}
});

for(const mode of ['source-error','invalid-receipt','abort'] as const)test(`${mode} stops queued batches before they can issue any new SQL`,async()=>{
  const tables:Tables={producao_cards:Array.from({length:450},(_,i)=>card(i+1))};
  const s=controlledSource(tables),controller=new AbortController();
  const reading=lerProducaoEspelho(global,{fonte:()=>s.fonte,signal:controller.signal,instante:()=>instant});
  const rejected=assert.rejects(reading,unavailable);
  try {
    await settleReader();assert.equal(s.active,4);const before=s.calls.length;
    if(mode==='abort')controller.abort();
    else {
      const entry=s.pending.shift()!;
      entry.release(mode==='source-error'?{...entry.receipt,error:Error('PRIVATE SDK FAILURE')}:{...entry.receipt,count:1});
    }
    await settleReader();
    assert.ok(s.calls.every(c=>c.signal?.aborted));
    s.release();await rejected;await settleReader();
    assert.equal(s.calls.length,before);
  } finally {controller.abort();s.release();await rejected;}
});

test('deadline during batch scheduling observes every already-started receipt rejection',async()=>{
  let now=0;
  const s=controlledSource({producao_cards:Array.from({length:250},(_,i)=>card(i+1))},()=>{now=30;});
  const reading=lerProducaoEspelho(global,{fonte:()=>s.fonte,agora:()=>now,deadlineMs:30,instante:()=>instant});
  await assert.rejects(reading,unavailable);
  const before=s.calls.length;s.release();await settleReader();
  assert.equal(s.calls.length,before);assert.ok(s.calls.every(c=>c.signal?.aborted));
});
