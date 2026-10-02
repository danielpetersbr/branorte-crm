import test from 'node:test';
import assert from 'node:assert/strict';
import {codificarFiltroEspelho,type CardEspelho} from './producao-espelho-consulta';
import {agruparQuadro,consultarQuadro,dataCalendario,filtrosIniciaisQuadro,prazoCard} from './producao-espelho-quadro';

function card(n:number,patch:Record<string,unknown>={}):CardEspelho {
  const id=`00000000-0000-4000-8abc-${String(n).padStart(12,'0')}`,stamp='2026-10-02T12:00:00Z';
  const raw={id,pedido_id:'MANUAL',cliente_nome:`Cliente ${n}`,vendedor_nome:'JARDEL',status:'SOLDA',doc_original_path:'inert',created_at:stamp,updated_at:stamp,excluido:false,doc_tratado_path:null,prazo_dias:null,prazo_tipo:'data',prazo_data:'2026-10-20',observacoes:null,numero_orcamento:`2026-${n}`,motor_marca:null,motor_tensao:null,resumo_equipamentos:null,titulo_equipamento:null,codigo_rastreio:`BN-TEST${n}`,cidade_destino:null,observacao_vendedor:null,parado_status:null,parado_motivo:null,orcamento_revisado_info:null,motor_tensao_vendedor:null,excluido_em:null,parado_em:null,orcamento_revisado_em:null,orcamento_revisado_visto_em:null,excluido_por:null,checklist_compras:null,...patch};
  return {id,pedidoId:null,numeroOrcamento:raw.numero_orcamento,cliente:raw.cliente_nome,vendedor:raw.vendedor_nome,etapa:raw.status,atualizadoEm:stamp,dadosOriginais:{...raw,vinculo:'nao_verificado',historico:[],logistica:null,setores:[]}};
}
test('search finds the actual printed tracking code with case and surrounding spaces ignored',()=>{
  const rows=consultarQuadro([card(1),card(2)],{...filtrosIniciaisQuadro,busca:'  bn-test2  '});
  assert.deepEqual(rows.map(c=>c.cliente),['Cliente 2']);
});
test('seller, stage, paused and exclusion filters apply together to the authorised collection',()=>{
  const cards=[card(1,{parado_status:'parado'}),card(2,{parado_status:'parado',vendedor_nome:'PEDRO'}),card(3,{parado_status:'parado',excluido:true}),card(4),card(5,{parado_status:'parado',status:'EM_PROJETO'})];
  const rows=consultarQuadro(cards,{...filtrosIniciaisQuadro,vendedor:codificarFiltroEspelho('JARDEL'),status:codificarFiltroEspelho('SOLDA'),parados:'somente'});
  assert.deepEqual(rows.map(c=>c.cliente),['Cliente 1']);
  assert.deepEqual(consultarQuadro(cards,{...filtrosIniciaisQuadro,exclusao:'excluidos'}).map(c=>c.cliente),['Cliente 3']);
  assert.deepEqual(consultarQuadro(cards,{...filtrosIniciaisQuadro,parados:'sem'}).map(c=>c.cliente),['Cliente 4']);
});
test('sorting keeps missing dates last and does not mutate source rows',()=>{
  const cards=[card(1,{created_at:'invalid'}),card(2,{created_at:'2026-06-01T12:00:00Z'}),card(3,{created_at:'2026-01-01T12:00:00Z'})];
  assert.deepEqual(consultarQuadro(cards,filtrosIniciaisQuadro).map(c=>c.cliente),['Cliente 3','Cliente 2','Cliente 1']);
  assert.deepEqual(consultarQuadro(cards,{...filtrosIniciaisQuadro,ordem:'recentes'}).map(c=>c.cliente),['Cliente 2','Cliente 3','Cliente 1']);
  assert.deepEqual(cards.map(c=>c.cliente),['Cliente 1','Cliente 2','Cliente 3']);
});
test('delivery sorting supports both source date formats and does not turn missing dates into January 1970',()=>{
  const cards=[card(1,{prazo_data:null}),card(2,{prazo_data:'20/10/2026'}),card(3,{prazo_data:'2026-09-30'})];
  assert.deepEqual(consultarQuadro(cards,{...filtrosIniciaisQuadro,ordem:'entrega'}).map(c=>c.cliente),['Cliente 3','Cliente 2','Cliente 1']);
});
test('calendar parsing rejects rollovers and preserves leap days',()=>{
  assert.equal(dataCalendario('31/02/2026'),null);assert.equal(dataCalendario('2026-02-29'),null);assert.equal(dataCalendario('infinity'),null);
  assert.equal(dataCalendario('2026-10-03Tgarbage'),null);
  const date=dataCalendario('29/02/2024');assert.equal(date?.getFullYear(),2024);assert.equal(date?.getMonth(),1);assert.equal(date?.getDate(),29);
});
test('due labels count calendar days rather than elapsed 24-hour periods',()=>{
  const result=prazoCard(card(1,{prazo_data:'2026-10-03'}),new Date(2026,9,2,23,55));
  assert.equal(result?.dias,1);assert.equal(result?.descricao,'faltam 1 d');
});
test('a delivery on the day of the reading uses the original due-today label',()=>{
  assert.equal(prazoCard(card(1,{prazo_data:'2026-10-02'}),new Date(2026,9,2,12))?.descricao,'vence hoje');
});
test('grouping retains unknown physical stages and puts every included card in exactly one column',()=>{
  const groups=agruparQuadro([card(1),card(2,{status:'PROJETOS_PADROES'}),card(3,{status:'__proto__'})]);
  assert.deepEqual(groups.flatMap(g=>g.cards).map(c=>c.cliente).sort(),['Cliente 1','Cliente 2','Cliente 3']);
  assert.equal(groups.find(g=>g.status==='__proto__')?.cards[0].cliente,'Cliente 3');
  assert.equal(groups.find(g=>g.status==='PROJETOS_PADROES')?.label,'Projetos Padrões');
});
