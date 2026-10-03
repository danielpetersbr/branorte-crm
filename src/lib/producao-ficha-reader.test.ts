import test from 'node:test';
import assert from 'node:assert/strict';
import {autorizarCardFicha,lerFichaEspelho,type DepsFicha} from '../../api/_lib/producao-ficha-reader.js';
import type {FonteEspelho,ReciboEspelho} from '../../api/_lib/producao-espelho-reader.js';
import {decodificarFichaEspelho} from './producao-ficha-consulta.js';
const id=(n:number)=>'00000000-0000-4000-8abc-'+n.toString(16).padStart(12,'0'),stamp='2026-10-02T09:00:00Z';
const scope={userId:id(999),role:'admin',displayName:'',vendedores:null},restricted={...scope,role:'vendor',vendedores:['ANA']};
type Tables=Record<string,Array<Record<string,unknown>>>;
type Call={table:string;columns:string;field:string;ids:string[];from:number;to:number;signal?:AbortSignal};
function fonte(tables:Tables,change?:(receipt:ReciboEspelho,call:Call)=>ReciboEspelho|Promise<ReciboEspelho>){
  const calls:Call[]=[];
  const client={from(table:string){const call:Call={table,columns:'',field:'',ids:[],from:0,to:999};let order='';const q={select(columns:string,options:unknown){assert.deepEqual(options,{count:'exact'});call.columns=columns;return q;},in(field:string,ids:string[]){call.field=field;call.ids=ids;return q;},order(field:string,options:unknown){assert.deepEqual(options,{ascending:true});order=field;return q;},range(from:number,to:number){call.from=from;call.to=to;return q;},async abortSignal(signal:AbortSignal){call.signal=signal;calls.push(call);const rows=(tables[table]??[]).filter(r=>call.ids.includes(String(r[call.field]).toLowerCase())).sort((a,b)=>String(a[order]).localeCompare(String(b[order])));const receipt={data:rows.slice(call.from,call.to+1),count:rows.length,error:null};return change?change(receipt,call):receipt;}};return q;}} as FonteEspelho;
  return {client,calls};
}
const fixture=():Tables=>({
  producao_cards:[{id:id(1),pedido_id:id(2),doc_tratado_path:'producao/em_projeto/'+id(2)+'/ORCAMENTO_TRATADO.docx',doc_original_path:'PRIVATE ORIGINAL',cliente_nome:'Not selected'}],
  projeto_detalhes:[{id:id(3),card_id:id(1),responsavel_projeto_id:id(4),status_projeto:'em_andamento',andamento:40,previsao_termino:'2026-10-05',prazo_prometido:null,prazo_interno:null,motivo_bloqueio:null,bom_aprovada:true,data_inicio:null,data_conclusao:null,standby_inicio:null,dias_pausados:0}],
  projetistas:[{id:id(4),nome:'Betuel',email:'PRIVATE EMAIL'}],
  producao_logistica:[{card_id:id(1),peso_kg:'12345678901234567890.123456789',qtd_volumes:1,medidas:'[{"descricao":"Real","peso_kg":10}]',observacoes:'Physical note',updated_at:stamp,updated_by:null}],
  bom_itens:[{id:id(5),card_id:id(1),item:'Motor',categoria:'motor',quantidade:'9007199254740993',unidade:'un',item_critico:true,observacao:null,status_item:'recebido',created_at:null,updated_at:null}],
  projeto_checklist:[{id:id(6),card_id:id(1),titulo:'Conferir',descricao:null,ordem:0,status:'pendente',responsavel_id:id(7),created_at:null,updated_at:null,concluido_por:null,concluido_em:null}],
  comentarios:[{id:id(8),card_id:id(1),autor_id:id(7),conteudo:'Physical comment',created_at:stamp,updated_at:null,mencoes:[],extra:'PRIVATE'}],
  profiles:[{id:id(7),full_name:'Daniel',email:'PRIVATE EMAIL',avatar_url:'PRIVATE URL'}],
  card_attachments:[{id:id(9),card_id:id(1),file_name:'video.mp4',file_path:id(1)+'/1_video.mp4',file_type:'video/mp4',file_size:50,created_at:stamp,categoria:'geral'},{id:id(10),card_id:id(1),file_name:'foto.jpg',file_path:id(1)+'/logistica/2_foto.jpg',file_type:'image/jpeg',file_size:30,created_at:stamp,categoria:'logistica'}],
  comentarios_anexos:[{id:id(11),comentario_id:id(8),file_name:'notas.txt',file_path:'PRIVATE FILE PATH',file_type:'text/plain',file_size:10,created_at:null}],
});
async function read(tables=fixture(),deps:DepsFicha={}){const s=fonte(tables);return {out:await lerFichaEspelho(scope,id(1),{fonte:()=>s.client,instante:()=>stamp,...deps}),calls:s.calls};}
test('selected ficha preserves physical project, BOM, comments, logistics and safe attachment metadata only',async()=>{
  const {out,calls}=await read();assert.equal(out.cardId,id(1));assert.equal(out.projeto?.responsavel_nome,'Betuel');assert.equal(out.projeto?.andamento,40);
  assert.equal(out.logistica?.peso_kg,'12345678901234567890.123456789');assert.equal(out.bom[0].quantidade,'9007199254740993');assert.equal(out.comentarios[0].autor_nome,'Daniel');assert.equal(out.projetoChecklist[0].responsavel_nome,'Daniel');
  assert.equal(out.comentarios[0].conteudo,'Physical comment');assert.deepEqual(out.anexos.map(a=>a.tipo),['video','foto']);assert.equal(out.comentarios[0].anexos[0].tipo,'comentario');
  assert.deepEqual(out.totals,{projeto:1,logistica:1,bom:1,projetoChecklist:1,comentarios:1,anexos:3});assert.equal(out.documento.disponivel,true);assert.equal(out.parcial,false);
  assert.ok(!JSON.stringify(out).includes('PRIVATE'));assert.ok(!JSON.stringify(out).includes('file_path'));assert.ok(!JSON.stringify(out).includes('doc_tratado_path'));
  assert.ok(calls.every(c=>c.ids.length>0));assert.ok(calls.filter(c=>!['profiles','projetistas','comentarios_anexos','producao_cards'].includes(c.table)).every(c=>c.field==='card_id'&&c.ids.length===1&&c.ids[0]===id(1)));
  assert.equal(calls.find(c=>c.table==='profiles')?.columns,'id,full_name');assert.match(calls.find(c=>c.table==='bom_itens')!.columns,/quantidade:quantidade::text/);
});

test('opt-in ficha loads complete production history and sector checklists only for the authorized selected card',async()=>{
  const tables=fixture();tables.producao_status_log=[{id:id(30),card_id:id(1),new_status:'SOLDA',changed_at:stamp,old_status:'PROJETO_CONCLUIDO',cliente_nome:null,numero_orcamento:null,changed_by:null}];
  tables.setor_producao=[{id:id(31),card_id:id(1),setor:'solda',responsavel_id:null,previsao_termino:null,status:'em_andamento',motivo_bloqueio:null,iniciado_em:null,concluido_em:null,created_at:null,updated_at:null,andamento:40}];
  tables.setor_checklist=[{id:id(32),setor_producao_id:id(31),titulo:'Conferir solda',descricao:null,concluido_em:null,created_at:null,ordem:1,concluido:false,concluido_por:null}];
  const {out,calls}=await read(tables,{producao:true});
  assert.deepEqual(out.producao?.totals,{historico:1,setores:1,checklists:1});assert.equal(out.producao?.setores[0].andamento,40);assert.equal(out.producao?.setores[0].checklists[0].titulo,'Conferir solda');
  assert.deepEqual(calls.find(c=>c.table==='setor_checklist')?.ids,[id(31)]);assert.deepEqual(calls.find(c=>c.table==='producao_status_log')?.ids,[id(1)]);
  tables.setor_checklist[0].setor_producao_id=id(99);const leaking=fonte(tables,(r,c)=>c.table==='setor_checklist'?{...r,data:tables.setor_checklist,count:1}:r);
  await assert.rejects(lerFichaEspelho(scope,id(1),{fonte:()=>leaking.client,producao:true}));
});

test('production detail completeness and counts must be own fields, never inherited declarations',async()=>{
  const {out}=await read(fixture(),{producao:true});assert.ok(out.producao);
  for(const field of ['complete','totals'] as const){const data=structuredClone(out);data.producao![field]=Object.create(data.producao![field]);assert.throws(()=>decodificarFichaEspelho(data,id(1)));}
});
test('restricted ficha authorizes only exact canonical parent vendor slot before any extra collection',async()=>{
  const s=fonte(fixture()),parents=fonte({pedidos_venda:[{id:id(2),vendedor:'OTHER',vendedor_2:'ANA'}]});
  const out=await lerFichaEspelho(restricted,id(1),{fonte:()=>s.client,fontePais:()=>parents.client,instante:()=>stamp});assert.equal(out.cardId,id(1));assert.deepEqual(parents.calls[0].ids,[id(2)]);
  for(const rows of [[],[{id:id(2),vendedor:'ANA OTHER',vendedor_2:null}],[{id:id(3),vendedor:'ANA',vendedor_2:null}]]){
    const denied=fonte(fixture()),pais=fonte({pedidos_venda:rows});await assert.rejects(lerFichaEspelho(restricted,id(1),{fonte:()=>denied.client,fontePais:()=>pais.client}));assert.deepEqual(denied.calls.map(c=>c.table),['producao_cards']);
  }
});
test('invalid id, absent card, manual restricted card and malformed parent never read extra records',async()=>{
  for(const cardId of ['invalid',id(999)]){const s=fonte(fixture());await assert.rejects(autorizarCardFicha(scope,cardId,{fonte:()=>s.client}));assert.ok(s.calls.every(c=>c.table==='producao_cards'));}
  const tables=fixture();tables.producao_cards[0].pedido_id='MANUAL-1';const s=fonte(tables);let parents=0;
  await assert.rejects(autorizarCardFicha(restricted,id(1),{fonte:()=>s.client,fontePais:()=>{parents++;throw Error('wrong source');}}));assert.equal(parents,0);
});
test('1001 comments and their author lookups are complete and UUID-batched without enlarging selected card scope',async()=>{
  const tables=fixture();tables.comentarios=Array.from({length:1001},(_,i)=>({id:id(10000+i),card_id:id(1),autor_id:null,conteudo:'Comment '+i,created_at:null,updated_at:null}));tables.comentarios_anexos=[];
  const {out,calls}=await read(tables);assert.equal(out.comentarios.length,1001);assert.deepEqual(calls.filter(c=>c.table==='comentarios').map(c=>c.from),[0,1000]);assert.ok(calls.every(c=>c.ids.length<=100));
});
test('incomplete, foreign and duplicate related receipts fail the entire ficha without forwarding source errors',async()=>{
  for(const mode of ['error','count','foreign','duplicate']){
    const s=fonte(fixture(),(r,c)=>c.table==='bom_itens'?mode==='error'?{...r,error:Error('PRIVATE KEY')}:mode==='count'?{...r,count:2}:mode==='foreign'?{...r,data:[{...(r.data![0] as object),card_id:id(99)}]}:{...r,data:[r.data![0],r.data![0]],count:2}:r);
    await assert.rejects(lerFichaEspelho(scope,id(1),{fonte:()=>s.client}),/^Error: producao_indisponivel$/);
  }
});
test('missing or deleted comment author stays unknown, but referenced project professional must exist',async()=>{
  const tables=fixture();tables.profiles=[];const {out}=await read(tables);assert.equal(out.comentarios[0].autor_nome,null);assert.equal(out.projetoChecklist[0].responsavel_nome,null);
  tables.projetistas=[];await assert.rejects(read(tables));
});
test('decoder rejects card identity/relation/completeness tampering and strips injected private file paths',async()=>{
  const {out}=await read();assert.throws(()=>decodificarFichaEspelho({...out,cardId:id(99)},id(1)));assert.throws(()=>decodificarFichaEspelho({...out,parcial:true},id(1)));assert.throws(()=>decodificarFichaEspelho({...out,totals:{...out.totals,bom:2}},id(1)));assert.throws(()=>decodificarFichaEspelho({...out,bom:[{...out.bom[0],card_id:id(99)}]},id(1)));
  assert.deepEqual(decodificarFichaEspelho({...out,anexos:out.anexos.map(a=>({...a,file_path:'PRIVATE',signedUrl:'PRIVATE'}))},id(1)),out);
});
test('ficha has a single four-query limit and cancellation never starts queued extra collections',async()=>{
  const pending:Array<()=>void>=[];let active=0,peak=0;
  const s=fonte(fixture(),(r,c)=>{if(c.table==='producao_cards')return r;active++;peak=Math.max(peak,active);return new Promise<ReciboEspelho>(resolve=>pending.push(()=>{active--;resolve(r);}));}),controller=new AbortController();
  const rejected=assert.rejects(lerFichaEspelho(scope,id(1),{fonte:()=>s.client,signal:controller.signal}),/^Error: producao_indisponivel$/);
  await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(active,4);const count=s.calls.length;controller.abort();await rejected;
  for(const resolve of pending)resolve();await new Promise<void>(resolve=>setImmediate(resolve));assert.equal(s.calls.length,count);assert.equal(peak,4);assert.ok(s.calls.every(c=>c.signal?.aborted));
});
test('ficha deadline covers held receipts and late source completion cannot return partial data',async()=>{
  let now=0;const pending:Array<()=>void>=[];
  const s=fonte(fixture(),(r,c)=>c.table==='producao_cards'?r:new Promise<ReciboEspelho>(resolve=>pending.push(()=>resolve(r))));
  const rejected=assert.rejects(lerFichaEspelho(scope,id(1),{fonte:()=>s.client,deadlineMs:30,agora:()=>now}),/^Error: producao_indisponivel$/);
  await new Promise<void>(resolve=>setImmediate(resolve));now=30;for(const resolve of pending)resolve();await rejected;assert.ok(s.calls.every(c=>c.signal?.aborted));
});
