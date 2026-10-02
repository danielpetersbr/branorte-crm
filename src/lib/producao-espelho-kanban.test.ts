import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProducaoEspelhoView} from '../components/controle/ProducaoEspelhoPainel';
import type {CardEspelho,ConsultaEspelho,ProjetoEspelho} from './producao-espelho-consulta';

const stamp='2026-10-02T10:30:00.000Z';
function card(n:number,etapa='SOLDA',excluded=false):CardEspelho {
  const id=`00000000-0000-4000-8abc-${n.toString(16).padStart(12,'0')}`;
  const raw={id,pedido_id:'MANUAL',cliente_nome:`Cliente do card ${n}`,vendedor_nome:'Vendedor teste',status:etapa,doc_original_path:'javascript:inert',created_at:stamp,updated_at:stamp,excluido:excluded,doc_tratado_path:null,prazo_dias:null,prazo_tipo:null,prazo_data:'2026-10-20',observacoes:null,numero_orcamento:`ORC-${n}`,motor_marca:null,motor_tensao:null,resumo_equipamentos:null,titulo_equipamento:'Equipamento teste',codigo_rastreio:null,cidade_destino:null,observacao_vendedor:null,parado_status:null,parado_motivo:null,orcamento_revisado_info:null,motor_tensao_vendedor:null,excluido_em:null,parado_em:null,orcamento_revisado_em:null,orcamento_revisado_visto_em:null,excluido_por:null,checklist_compras:null};
  return {id,pedidoId:null,numeroOrcamento:raw.numero_orcamento,cliente:raw.cliente_nome,vendedor:raw.vendedor_nome,etapa,atualizadoEm:stamp,dadosOriginais:{...raw,vinculo:'nao_verificado',historico:[],logistica:null,setores:[]}};
}
function data(cards:CardEspelho[]):ConsultaEspelho {
  return {origem:'app2',fonte:'controle-producao-live',consultadoEm:stamp,atualizadoEm:null,sincronizadoEm:null,parcial:false,aviso:'Leituras independentes; consistência entre coleções não comprovada.',consistency:'crossread_unproved',complete:{cards:true,historico:true,logistica:true,setores:true,checklists:true},totals:{cards:cards.length,historico:0,logistica:0,setores:0,checklists:0},dados:{cards,kpis:{total:cards.length,excluidos:cards.filter(c=>c.dadosOriginais.excluido).length,ativos:cards.length,entregues:0,cancelados:0,pedidosUnicos:0},porEtapa:{},porSetor:{}}};
}
function projeto(card:CardEspelho,nome:string|null,status:string):ProjetoEspelho {
  return {id:card.id.replace('4000','5000'),card_id:card.id,responsavel_projeto_id:nome?'00000000-0000-4000-8abc-00000000ffff':null,responsavel_nome:nome,status_projeto:status,andamento:null,previsao_termino:null,prazo_prometido:null,prazo_interno:null};
}
function render(cards:CardEspelho[],patch:Partial<React.ComponentProps<typeof ProducaoEspelhoView>>={}) {
  return renderToStaticMarkup(React.createElement(ProducaoEspelhoView,{data:data(cards),autorizado:true,error:false,loading:false,fetching:false,identityKey:'synthetic',atualizar:()=>{},...patch}));
}
test('default board reaches every card rather than the first catalog page',()=>{
  const html=render(Array.from({length:51},(_,i)=>card(i+1)));
  assert.match(html,/aria-label="Kanban de produção"/);
  for(const n of [1,25,26,50,51])assert.ok(html.includes(`Cliente do card ${n}<`),`card ${n} missing from board`);
  assert.match(html,/Equipamento teste/);assert.match(html.replace(/<[^>]+>/g,''),/Entrega: 20\/10/);
});
test('board assigns included cards exactly once to their physical stage and retains unknown states',()=>{
  const html=render([card(1,'SOLDA'),card(2,'CANCELADO'),card(3,'__proto__'),card(4,'constructor')]);
  const sections=[...html.matchAll(/<section\b[^>]*data-etapa="([^"]*)"[^>]*>([\s\S]*?)<\/section>/g)];
  const byStage=new Map(sections.map(m=>[m[1],m[2]]));
  assert.ok(byStage.size>=13);
  for(const [stage,n] of [['SOLDA',1],['CANCELADO',2],['__proto__',3],['constructor',4]] as const){
    assert.ok(byStage.get(stage)?.includes(`Cliente do card ${n}<`),`${stage} card missing`);
    assert.equal((html.match(new RegExp(`Cliente do card ${n}<`,'g'))??[]).length,1);
  }
  assert.ok(html.indexOf('data-etapa="PPCP"')<html.indexOf('data-etapa="SOLDA"'));
});
test('default board mirrors the source by leaving excluded cards out of the displayed count',()=>{
  const html=render([card(1,'SOLDA'),card(2,'SOLDA',true)]);
  assert.ok(html.includes('Cliente do card 1'));
  assert.ok(!html.includes('Cliente do card 2'));
  assert.match(html,/1 pedido/);
});
test('standard and special projects remain separate before the post-project PPCP column',()=>{
  const html=render([card(1,'PROJETOS_PADROES'),card(2,'EM_PROJETO'),card(3,'PROJETO_CONCLUIDO')]);
  assert.match(html,/Projetos Padrões/);assert.match(html,/Projetos Especiais/);
  const positions=['PPCP','PROJETOS_PADROES','EM_PROJETO','PROJETO_CONCLUIDO','SOLDA'].map(s=>html.indexOf(`data-etapa="${s}"`));
  assert.ok(positions.every((p,i)=>p>=0&&(i===0||p>positions[i-1])));
});
test('default stage order places older entries first without reordering the source array',()=>{
  const later=card(1),earlier=card(2);later.dadosOriginais.created_at='2026-08-22T12:00:00Z';earlier.dadosOriginais.created_at='2026-04-21T12:00:00Z';
  const cards=[later,earlier],html=render(cards);
  assert.ok(html.indexOf('Cliente do card 2')<html.indexOf('Cliente do card 1'));
  assert.deepEqual(cards.map(c=>c.id),[later.id,earlier.id]);
});
test('paused notes and motor details are visible directly on the source-style card',()=>{
  const paused=card(1);Object.assign(paused.dadosOriginais,{parado_status:'PARADO',parado_motivo:'Cliente vai confirmar a compra',motor_tensao:'Motor Trifásico 380V',motor_marca:'WEG'});
  const html=render([paused]);
  assert.match(html,/PARADO/);assert.match(html,/Cliente vai confirmar a compra/);assert.match(html,/Motor Trifásico 380V/);assert.match(html,/WEG/);
});
test('delivery dates use local calendar days and reject impossible or unrecognised input',()=>{
  const overdue=card(1),brazilian=card(2),invalid=card(3);
  overdue.dadosOriginais.prazo_data='2026-09-30';brazilian.dadosOriginais.prazo_data='20/10/2026';invalid.dadosOriginais.prazo_data='31/02/2026';
  const html=render([overdue,brazilian,invalid]);
  assert.match(html,/2 d de atraso/);assert.match(html,/faltam 18 d/);assert.match(html,/Sem data de entrega/);
  assert.ok(!html.includes('31/02/2026'));
});
test('delivered cards preserve their delivery date without suggesting production is overdue',()=>{
  const delivered=card(1,'ENTREGUE');delivered.dadosOriginais.prazo_data='2025-05-28';
  const html=render([delivered]);
  assert.match(html,/28\/05\/25/);assert.ok(!html.includes('d de atraso'));
});
test('unseen revisions and internal production orders have distinct badges on their cards',()=>{
  const order=card(1),revision=card(2),seen=card(3);
  order.numeroOrcamento='OP 00013';
  revision.dadosOriginais.orcamento_revisado_em='2026-10-01T12:00:00Z';
  seen.dadosOriginais.orcamento_revisado_em='2026-10-01T12:00:00Z';seen.dadosOriginais.orcamento_revisado_visto_em='2026-10-01T13:00:00Z';
  const html=render([order,revision,seen]);
  assert.match(html,/>OP<\/span>/);assert.equal((html.match(/>REVISADO<\/span>/g)??[]).length,1);
});
test('source project names are shown only on linked cards and keep their verified state',()=>{
  const working=card(1,'EM_PROJETO'),finished=card(2,'PROJETOS_PADROES'),unlinked=card(3,'EM_PROJETO');
  working.dadosOriginais.projeto=projeto(working,'Projetista sintético Betuel','em_andamento');
  finished.dadosOriginais.projeto=projeto(finished,'Projetista sintético Giuslei','concluido');
  unlinked.dadosOriginais.projeto=projeto(unlinked,null,'em_andamento');
  const html=render([working,finished,unlinked]);
  assert.match(html,/Projetista sintético Betuel/);assert.match(html,/Projetista sintético Giuslei/);assert.match(html,/Projetista trabalhando/);assert.match(html,/Projeto concluído/);
  assert.equal((html.match(/pq-responsavel /g)??[]).length,2);
});
test('project responsibility stays visible only in standard and special project columns',()=>{
  const stages=['PROJETOS_PADROES','EM_PROJETO','PPCP','PROJETO_CONCLUIDO','SOLDA','ENTREGUE'];
  const cards=stages.map((stage,i)=>{const row=card(i+1,stage);row.dadosOriginais.projeto=projeto(row,'Projetista restrito às etapas de projeto','em_andamento');return row;});
  const html=render(cards);
  for(const [index,row] of cards.entries()){
    const markup=html.match(new RegExp(`<div data-card-shell="${row.id}"[\\s\\S]*?<\\/div>`))?.[0];
    assert.ok(markup);
    assert.equal(markup.includes('Projetista restrito às etapas de projeto'),index<2,row.etapa);
    assert.equal(markup.includes('pq-card-projeto-andamento'),index<2,row.etapa);
    assert.equal(markup.includes('pq-responsavel '),index<2,row.etapa);
  }
});
test('copying the printed tracking code has its own button outside the button that opens the record',()=>{
  const tracked=card(1);tracked.dadosOriginais.codigo_rastreio='BN-EXATO';
  const html=render([tracked]),open=html.match(new RegExp(`<button data-card-id="${tracked.id}"[\\s\\S]*?<\\/button>`))?.[0];
  assert.ok(open);assert.ok(!open.includes('pq-rastreio'));
  assert.match(html,/<button[^>]*aria-label="Copiar rastreio BN-EXATO"[^>]*>[\s\S]*?BN-EXATO<\/button>/);
  let depth=0;
  for(const token of html.matchAll(/<\/?button\b[^>]*>/g)){
    if(token[0].startsWith('</'))depth--;else {assert.equal(depth,0,'nested button');depth++;}
  }
  assert.equal(depth,0);
});
test('general and seller observations stay out of the compact card while its equipment summary remains visible',()=>{
  const annotated=card(1);Object.assign(annotated.dadosOriginais,{observacoes:'Observação geral só na ficha',observacao_vendedor:'Observação do vendedor só na ficha',titulo_equipamento:null,resumo_equipamentos:'[PEDIDO DE GARANTIA] Equipamento sintético'});
  const html=render([annotated]);
  assert.ok(!html.includes('Observação geral só na ficha'));assert.ok(!html.includes('Observação do vendedor só na ficha'));
  assert.match(html,/\[PEDIDO DE GARANTIA\] Equipamento sintético/);
});
test('motor labels receive one Motor prefix while the literal source details stay intact',()=>{
  const missing=card(1),present=card(2);
  missing.dadosOriginais.motor_tensao='Trifásico - A confirmar';present.dadosOriginais.motor_tensao='Motor Monofásico 220V';
  const html=render([missing,present]);
  assert.match(html,/Motor Trifásico - A confirmar/);assert.match(html,/Motor Monofásico 220V/);assert.ok(!html.includes('Motor Motor'));
});
test('retained board data is synchronously hidden on denied, error and loading states',()=>{
  for(const patch of [{autorizado:false},{error:true},{loading:true}]){
    const html=render([card(1,'PRIVATE-STAGE')],patch);
    assert.equal(html.includes('Cliente do card 1'),false);
    assert.equal(html.includes('PRIVATE-STAGE'),false);
    assert.equal(html.includes('Kanban de produção'),false);
  }
});
