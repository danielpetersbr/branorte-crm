import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProducaoEspelhoView} from '../components/controle/ProducaoEspelhoPainel';
import type {CardEspelho,ConsultaEspelho} from './producao-espelho-consulta';

const stamp='2026-10-02T10:30:00.000Z';
function card(n:number,etapa='SOLDA',excluded=false):CardEspelho {
  const id=`00000000-0000-4000-8abc-${n.toString(16).padStart(12,'0')}`;
  const raw={id,pedido_id:'MANUAL',cliente_nome:`Cliente do card ${n}`,vendedor_nome:'Vendedor teste',status:etapa,doc_original_path:'javascript:inert',created_at:stamp,updated_at:stamp,excluido:excluded,doc_tratado_path:null,prazo_dias:null,prazo_tipo:null,prazo_data:'2026-10-20',observacoes:null,numero_orcamento:`ORC-${n}`,motor_marca:null,motor_tensao:null,resumo_equipamentos:null,titulo_equipamento:'Equipamento teste',codigo_rastreio:null,cidade_destino:null,observacao_vendedor:null,parado_status:null,parado_motivo:null,orcamento_revisado_info:null,motor_tensao_vendedor:null,excluido_em:null,parado_em:null,orcamento_revisado_em:null,orcamento_revisado_visto_em:null,excluido_por:null,checklist_compras:null};
  return {id,pedidoId:null,numeroOrcamento:raw.numero_orcamento,cliente:raw.cliente_nome,vendedor:raw.vendedor_nome,etapa,atualizadoEm:stamp,dadosOriginais:{...raw,vinculo:'nao_verificado',historico:[],logistica:null,setores:[]}};
}
function data(cards:CardEspelho[]):ConsultaEspelho {
  return {origem:'app2',fonte:'controle-producao-live',consultadoEm:stamp,atualizadoEm:null,sincronizadoEm:null,parcial:false,aviso:'Leituras independentes; consistência entre coleções não comprovada.',consistency:'crossread_unproved',complete:{cards:true,historico:true,logistica:true,setores:true,checklists:true},totals:{cards:cards.length,historico:0,logistica:0,setores:0,checklists:0},dados:{cards,kpis:{total:cards.length,excluidos:cards.filter(c=>c.dadosOriginais.excluido).length,ativos:cards.length,entregues:0,cancelados:0,pedidosUnicos:0},porEtapa:{},porSetor:{}}};
}
function render(cards:CardEspelho[],patch:Partial<React.ComponentProps<typeof ProducaoEspelhoView>>={}) {
  return renderToStaticMarkup(React.createElement(ProducaoEspelhoView,{data:data(cards),autorizado:true,error:false,loading:false,fetching:false,identityKey:'synthetic',atualizar:()=>{},...patch}));
}
test('default board reaches every card rather than the first catalog page',()=>{
  const html=render(Array.from({length:51},(_,i)=>card(i+1)));
  assert.match(html,/aria-label="Kanban de produção"/);
  for(const n of [1,25,26,50,51])assert.ok(html.includes(`Cliente do card ${n}<`),`card ${n} missing from board`);
  assert.match(html,/Equipamento teste/);assert.match(html,/Prazo: 2026-10-20/);
});
test('board assigns cards exactly once to their physical stage and retains excluded and unknown states',()=>{
  const html=render([card(1,'SOLDA'),card(2,'CANCELADO',true),card(3,'__proto__'),card(4,'constructor')]);
  const sections=[...html.matchAll(/<section\b[^>]*data-etapa="([^"]*)"[^>]*>([\s\S]*?)<\/section>/g)];
  const byStage=new Map(sections.map(m=>[m[1],m[2]]));
  assert.equal(byStage.size,10);
  for(const [stage,n] of [['SOLDA',1],['CANCELADO',2],['__proto__',3],['constructor',4]] as const){
    assert.ok(byStage.get(stage)?.includes(`Cliente do card ${n}<`),`${stage} card missing`);
    assert.equal((html.match(new RegExp(`Cliente do card ${n}<`,'g'))??[]).length,1);
  }
  assert.ok(byStage.get('CANCELADO')?.includes('Excluído'));
  assert.ok(html.indexOf('data-etapa="PPCP"')<html.indexOf('data-etapa="SOLDA"'));
});
test('retained board data is synchronously hidden on denied, error and loading states',()=>{
  for(const patch of [{autorizado:false},{error:true},{loading:true}]){
    const html=render([card(1,'PRIVATE-STAGE')],patch);
    assert.equal(html.includes('Cliente do card 1'),false);
    assert.equal(html.includes('PRIVATE-STAGE'),false);
    assert.equal(html.includes('Kanban de produção'),false);
  }
});
