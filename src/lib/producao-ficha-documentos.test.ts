import test from 'node:test';
import assert from 'node:assert/strict';
import type {CardEspelho} from './producao-espelho-consulta';
import {montarOrdemProducao,gerarOrdemProducaoPdf,gerarPlacaIdentificacaoPdf,nomeDocumentoProducao} from './producao-ficha-documentos';

const card=(patch:Record<string,unknown>={}):CardEspelho=>({
  id:'00000000-0000-4000-8abc-000000000001',pedidoId:null,numeroOrcamento:'2026 - 12/ABC',
  cliente:'Cliente de teste',vendedor:'VENDEDOR',etapa:'SOLDA',atualizadoEm:'2026-10-01T12:00:00Z',
  dadosOriginais:{
    id:'00000000-0000-4000-8abc-000000000001',pedido_id:'PEDIDO-REAL',cliente_nome:'Cliente de teste',vendedor_nome:'VENDEDOR',
    created_at:'2026-10-02T12:00:00Z',cidade_destino:'Grão Pará - SC',prazo_data:'16/10/2026',prazo_dias:null,prazo_tipo:null,
    titulo_equipamento:'Misturador',resumo_equipamentos:'Misturador 2,5 m³, Silo 4 t',motor_tensao:'Trifásico 380V',motor_marca:'WEG',
    observacoes:'Montar no piso\nVALOR TOTAL R$ 19.500,00\nCPF: 123.456.789-00\nEnviar para ENDEREÇO: rua privada',
    observacao_vendedor:'Conferir flange\nPagamento à vista\nTel (48) 99999-9999',
    projeto:{id:'p',card_id:'c',responsavel_projeto_id:'r',responsavel_nome:'Betuel',status_projeto:'em_andamento',andamento:40,previsao_termino:null,prazo_prometido:null,prazo_interno:null},
    checklist_compras:null,vinculo:'nao_verificado',historico:[],logistica:null,setores:[],...patch,
  },
});

test('technical order preserves decimal commas from the source summary and excludes commercial/personal note lines',()=>{
  const out=montarOrdemProducao(card());
  assert.deepEqual(out.equipamentos,[{descricao:'Misturador 2,5 m³',un:'UN',qtd:1},{descricao:'Silo 4 t',un:'UN',qtd:1}]);
  assert.deepEqual(out.observacoes,['Montar no piso','Conferir flange']);
  assert.deepEqual(out.motores,[]);
  assert.equal(out.responsavel,'Betuel');assert.equal(out.dataEntrega,'2026-10-16');
  assert.equal(out.referencia,'2026 - 12/ABC');
});

test('real BOM takes precedence over summary, preserves numeric quantity text and separates motor rows',()=>{
  const out=montarOrdemProducao(card(),[
    {id:'1',item:' Misturador real ',categoria:'Equipamentos',unidade:'PC',quantidade:'2.000000000000000001'},
    {id:'2',item:'Motor WEG 5 cv',categoria:'Motores e Acionamentos',unidade:'UN',quantidade:'3'},
    {id:'3',item:'TOTAL R$ 999,00',categoria:'Equipamentos',unidade:'UN',quantidade:'1'},
    {id:'4',item:'CPF 123.456.789-00',categoria:'Equipamentos',unidade:'UN',quantidade:'1'},
  ]);
  assert.deepEqual(out.equipamentos,[{descricao:'Misturador real',un:'PC',qtd:'2.000000000000000001'}]);
  assert.deepEqual(out.motores,['3x Motor WEG 5 cv']);
});

test('motor heading is omitted when a specific motor exists and missing stock allocations remain absent',()=>{
  const out=montarOrdemProducao(card({resumo_equipamentos:null}),[
    {id:'1',item:'Motores trifásicos',categoria:'Motores e Acionamentos',unidade:'UN',quantidade:'5'},
    {id:'2',item:'Motor WEG 10 cv',categoria:'Motores e Acionamentos',unidade:'UN',quantidade:'2'},
  ]);
  assert.deepEqual(out.motores,['2x Motor WEG 10 cv']);assert.deepEqual(out.equipamentos,[]);
  assert.ok(!JSON.stringify(out).includes('alocado'));
});

test('delivery follows explicit calendar first and original business-day fallback without inventing a missing date',()=>{
  assert.equal(montarOrdemProducao(card({prazo_data:'2026-10-16',prazo_dias:99})).dataEntrega,'2026-10-16');
  assert.equal(montarOrdemProducao(card({prazo_data:null,prazo_dias:2,prazo_tipo:'uteis'})).dataEntrega,'2026-10-06');
  assert.equal(montarOrdemProducao(card({prazo_data:null,prazo_dias:2,prazo_tipo:'corridos'})).dataEntrega,'2026-10-04');
  assert.equal(montarOrdemProducao(card({prazo_data:null,prazo_dias:null})).dataEntrega,null);
  assert.equal(montarOrdemProducao(card({prazo_data:'invalid',prazo_dias:2})).dataEntrega,null);
});

test('generation refuses missing client or equipment and never adds a fictitious equipment to a card',()=>{
  assert.throws(()=>gerarPlacaIdentificacaoPdf({...card(),cliente:' '}),/cliente/i);
  assert.throws(()=>gerarPlacaIdentificacaoPdf(card({titulo_equipamento:null,resumo_equipamentos:null})),/equipamento/i);
  assert.throws(()=>gerarOrdemProducaoPdf(montarOrdemProducao({...card(),cliente:''})),/cliente/i);
  assert.throws(()=>gerarOrdemProducaoPdf(montarOrdemProducao(card({resumo_equipamentos:null}))),/equipamentos|motores/i);
});

test('real PDF contains the first and last physical equipment over multiple pages and removes sensitive lines',()=>{
  const bom=Array.from({length:75},(_,i)=>({id:String(i),item:`EQUIPAMENTO ${String(i).padStart(3,'0')}`,categoria:'Equipamentos',unidade:'UN',quantidade:'1'}));
  const pdf=gerarOrdemProducaoPdf(montarOrdemProducao(card(),bom)),wire=pdf.output();
  assert.ok(pdf.getNumberOfPages()>1);
  for(const label of ['EQUIPAMENTO 000','EQUIPAMENTO 074','Montar no piso','Conferir flange'])assert.ok(wire.includes(label),label);
  for(const privateText of ['19.500','123.456','rua privada','Pagamento','99999-9999'])assert.ok(!wire.includes(privateText),privateText);
});

test('identification PDF prints two copies on one A4 page and filename never contains path separators',()=>{
  const pdf=gerarPlacaIdentificacaoPdf(card()),wire=pdf.output();
  assert.equal(pdf.getNumberOfPages(),1);
  assert.equal(wire.split('CLIENTE: CLIENTE DE TESTE').length-1,2);
  assert.equal(wire.split('EQUIPAMENTO: MISTURADOR').length-1,2);
  assert.equal(nomeDocumentoProducao('placa','2026 / Grão Pará'),'placa-identificacao-2026-grao-para.pdf');
  assert.equal(nomeDocumentoProducao('ordem','../../'),'ordem-producao-pedido.pdf');
});

test('an identification plate that cannot fit both copies refuses generation instead of clipping the equipment',()=>{
  assert.throws(()=>gerarPlacaIdentificacaoPdf(card({titulo_equipamento:'Descrição muito extensa de equipamento '.repeat(100)})),/longos|resuma/i);
});
