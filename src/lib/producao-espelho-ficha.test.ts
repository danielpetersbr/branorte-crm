import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {ProducaoEspelhoFicha,resumirAndamentoFicha,volumesFicha,destinoFicha} from '../components/controle/ProducaoEspelhoFicha';
import type {CardEspelho} from './producao-espelho-consulta';

function card():CardEspelho {
  const id='00000000-0000-4000-8abc-000000000001';
  return {id,pedidoId:null,numeroOrcamento:'2026 - 1728',cliente:'Cliente da ficha',vendedor:'EDER',etapa:'EM_PROJETO',atualizadoEm:'2026-10-02T12:00:00Z',dadosOriginais:{checklist_compras:null,vinculo:'nao_verificado',historico:[],logistica:null,setores:[],created_at:'2026-09-01T12:00:00Z',prazo_data:'20/10/2026',motor_tensao:'Trifásico 380V',motor_tensao_vendedor:'VALOR VENDEDOR DIFERENTE',observacao_vendedor:'Confirmar instalação',observacoes:'Nota da produção\nSegunda linha',doc_original_path:'PRIVATE/arquivo-com-precos.pdf',doc_tratado_path:'PRIVATE/arquivo-sem-precos.pdf',codigo_rastreio:'BN-EXATO',cidade_destino:'Cidade de destino',projeto:{id:'00000000-0000-4000-8abc-000000000002',card_id:id,responsavel_projeto_id:'00000000-0000-4000-8abc-000000000003',responsavel_nome:'Betuel',status_projeto:'em_andamento',andamento:40,previsao_termino:'2026-10-06',prazo_prometido:null,prazo_interno:null}}};
}
const render=(row=card(),props:Partial<React.ComponentProps<typeof ProducaoEspelhoFicha>>={})=>renderToStaticMarkup(React.createElement(ProducaoEspelhoFicha,{card:row,close:()=>{},...props}));

test('production sheet presents source sections with human labels and keeps storage metadata inert',()=>{
  const html=render();
  for(const label of ['Cliente da ficha','EDER','2026 - 1728','BN-EXATO','Etapa atual','Andamento da produção','Projetos Especiais','Dados do projeto','Ações &amp; geração','Documento do pedido','Logística e transporte','Notas','Comentários','Somente leitura','Betuel','Confirmar instalação','Trifásico 380V','Vídeo do projeto'])assert.ok(html.includes(label),label);
  for(const privateText of ['PRIVATE/','doc_original_path','responsavel_projeto_id','checklist_compras','VALOR VENDEDOR DIFERENTE','Sem valor (SQL NULL)'])assert.ok(!html.includes(privateText),privateText);
  assert.match(html,/20 de outubro de 2026/);assert.match(html,/06 de outubro de 2026/);
  assert.ok(!html.includes('contenteditable'));assert.ok(!html.includes('<textarea'));assert.ok(!html.includes('<input'));
});

test('progress matches the source mean across every sector and does not force completed progress to 100',()=>{
  const sectors=[{setor:'solda',andamento:20,status:'concluido'},{setor:'montagem',andamento:40,status:'aguardando'},{setor:'expedicao',andamento:null,status:null},{setor:'novo_setor',andamento:80,status:'em_andamento'}];
  const result=resumirAndamentoFicha(sectors);
  assert.equal(result.total,35);
  assert.deepEqual(result.segmentos.map(s=>[s.label,s.andamento,s.concluido]),[['Solda',20,true],['Montagem',40,false],['Expedição',0,false]]);
  assert.equal(resumirAndamentoFicha([]).total,0);
  assert.equal(resumirAndamentoFicha([{setor:'SOLDA',andamento:100,status:'concluido'}]).segmentos[0].andamento,0);
});

test('resources appear only through authorized resource presenters rather than raw source paths',()=>{
  const html=render(card(),{renderRecurso:tipo=>React.createElement('span',{'data-recurso':tipo},`Recurso seguro ${tipo}`)});
  for(const tipo of ['documento','video','fotos','placa','ordem-producao','anexos'])assert.ok(html.includes(`data-recurso="${tipo}"`),tipo);
  assert.ok(!html.includes('PRIVATE/'));assert.ok(!html.includes('href="PRIVATE'));
});

test('unloaded detail comments do not claim an empty collection and source errors remain visible',()=>{
  assert.ok(render().includes('Comentários não disponíveis nesta leitura'));
  assert.ok(render(card(),{carregando:true}).includes('Consultando comentários'));
  assert.ok(render(card(),{erro:true}).includes('Não foi possível consultar os detalhes'));
  const html=render(card(),{detalhes:{comentarios:[]}});
  assert.ok(html.includes('Nenhum comentário'));assert.ok(!html.includes('Comentários não disponíveis nesta leitura'));
});

test('production notes and comment content are escaped and presented without technical metadata',()=>{
  const row=card();row.dadosOriginais.observacoes='<script>nota literal</script>';
  const html=render(row,{detalhes:{comentarios:[{id:'comentario',conteudo:'<img onerror="literal">\nComentário',autor_nome:'Autor da produção',created_at:'2026-10-02T12:00:00Z'}]}});
  assert.ok(html.includes('&lt;script&gt;nota literal&lt;/script&gt;'));assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;img onerror='));assert.ok(!html.includes('<img onerror='));assert.ok(html.includes('Autor da produção'));
  assert.ok(!html.includes('conteudo'));assert.ok(!html.includes('created_at'));
});

test('retained detail comments and authorized resource presenters are masked while loading or failed',()=>{
  const detalhes={comentarios:[{id:'comentario',conteudo:'DETALHE ANTIGO PRIVADO',autor_nome:'Autor',created_at:'2026-10-02T12:00:00Z'}]};
  for(const state of [{carregando:true},{erro:true}]){
    let resources=0;
    const html=render(card(),{...state,detalhes,renderRecurso:()=>{resources++;return React.createElement('span',null,'RECURSO ANTIGO PRIVADO');}});
    assert.ok(!html.includes('DETALHE ANTIGO PRIVADO'));assert.ok(!html.includes('RECURSO ANTIGO PRIVADO'));assert.equal(resources,0);
  }
});

test('logistics displays source volume rows and destination without showing its JSON serialization',()=>{
  const row=card(),medidas='[{"descricao":"Caixa principal","comprimento":"120,5","largura":"80","altura":"50","peso_kg":12.5},{"descricao":"Motor","medidas":"30 x 20 x 15 cm","peso_kg":"7,5"}]';
  row.dadosOriginais.cidade_destino='Cuiabá - mt';row.dadosOriginais.logistica={medidas,peso_kg:'20.0',qtd_volumes:2,observacoes:'Transportadora definida'};
  const html=render(row);
  for(const label of ['Cuiabá','MT','Volumes da carga','Caixa principal','120,5','80','50','Motor','30','20','15','Total','2 volumes','20,00 kg','Transportadora definida'])assert.ok(html.includes(label),label);
  assert.ok(!html.includes('{&quot;'));assert.ok(!html.includes('peso_kg'));assert.ok(!html.includes(medidas));
  assert.deepEqual(destinoFicha('Cuiabá - mt'),{cidade:'Cuiabá',uf:'MT'});assert.deepEqual(destinoFicha('Destino - XX'),{cidade:'Destino - XX',uf:''});
  const volumes=volumesFicha({medidas,peso_kg:'20.0',qtd_volumes:2});
  assert.equal(volumes.totalVolumes,2);assert.equal(volumes.totalPeso,20);assert.equal(volumes.volumes[1].comprimento,'30');
});

test('logistics empty and legacy values stay readable without fabricating dimensions or peso',()=>{
  assert.equal(volumesFicha(null).totalVolumes,0);assert.equal(volumesFicha(null).totalPeso,0);
  const legacy=volumesFicha({medidas:'140 x 80 x 40 cm',peso_kg:'12.75',qtd_volumes:1});
  assert.equal(legacy.volumes[0].comprimento,'140');assert.equal(legacy.volumes[0].pesoKg,'12.75');assert.equal(legacy.totalPeso,12.75);
  const row=card();row.dadosOriginais.logistica={medidas:'[{"malformado":',peso_kg:null,qtd_volumes:null};
  const html=render(row);assert.ok(!html.includes('{&quot;'));assert.ok(!html.includes('malformado'));assert.ok(html.includes('formato'));
  row.dadosOriginais.logistica=null;assert.match(render(row),/0 volumes/);assert.match(render(row),/0,00 kg/);
});

test('comments accept absent source dates and expose attachments through scoped renderers',()=>{
  const html=render(card(),{detalhes:{comentarios:[{id:'id-comentario',conteudo:'Comentário sem data',autor_nome:null,created_at:null}]},renderComentarioAnexos:id=>React.createElement('span',null,`Anexos autorizados ${id}`)});
  assert.ok(html.includes('Comentário sem data'));assert.ok(html.includes('Usuário'));assert.ok(html.includes('Anexos autorizados id-comentario'));assert.ok(!html.includes('Invalid Date'));
});
