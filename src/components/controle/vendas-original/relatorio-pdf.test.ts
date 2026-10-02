import assert from 'node:assert/strict';
import { test } from 'node:test';
import { criarRelatorioVendasPDF, prepararRegistrosPDF, type RelatorioVendasPDFInput } from './relatorio-pdf';
import { type Pedido } from './calculos';

const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD3+iiigD//2Q==';
const pedido = (patch: Partial<Pedido> = {}): Pedido => ({
  id: 'id', pedido_numero: '2026-123', numero_orcamento: 'ORC-123',
  cliente: 'Cliente com razao social completa para preservar sem cortes',
  vendedor: 'Nome completo do vendedor sem abreviacoes', data_venda: '2026-10-02',
  valor_total: 100, status: 'FECHADO', atencao_a: '', descricao_equipamento: '',
  data_primeiro_contato: null, fonte_origem: null, estado: 'SP', equipamentos_json: [],
  ajuste_valor: 0, ajuste_motivo: null, ajuste_data: null, ...patch,
});
const entrada = (patch: Partial<RelatorioVendasPDFInput> = {}): RelatorioVendasPDFInput => ({
  geradoEm: new Date('2026-10-02T14:00:00Z'), periodo: 'Outubro de 2026', anoEvolucao: 2026,
  vendedor: 'Todos os vendedores', valorMinimo: 1000, valorTotal: 100, totalRegistros: 1,
  ticketMedio: 100, pedidosUnicos: 1, ajustes: 0, cancelados: 0, meta: 200,
  vendedores: [], evolucao: [{mes:'jan/26',valor:-50},{mes:'fev/26',valor:100}],
  fabricas: [], equipamentos: [], fechamento: [], estados: [], origens: [], rapidas: [], conversao: [],
  registros: [pedido()], mapa: {imagem:jpeg,largura:1,altura:1}, ...patch,
});

test('linhas preservam nomes e valores integrais, e distinguem ajuste, cancelamento e compartilhamento', () => {
  const original = pedido({vendedor_2:'Outra pessoa',_valorOverride:60});
  const ajuste = pedido({_isAjuste:true,_valorOverride:-15,pedido_numero:'Acréscimo 123'});
  const cancelado = pedido({status:'CANCELADO',valor_total:900});
  const linhas = prepararRegistrosPDF([original,ajuste,cancelado]);
  assert.equal(linhas.length,3);
  assert.equal(linhas[0][2],original.cliente);
  assert.equal(linhas[0][3],original.vendedor);
  assert.match(linhas[0][5],/Compartilhado/);
  assert.match(linhas[0][6],/60,00/);
  assert.equal(linhas[1][5],'AJUSTE');
  assert.match(linhas[1][6],/-R\$\s15,00/);
  assert.equal(linhas[2][5],'CANCELADO');
  assert.equal(original.cliente, pedido().cliente);
});

test('referências mantêm pedido e orçamento, e ajuste cancelado mostra os dois estados', () => {
  const linhas = prepararRegistrosPDF([pedido({_isAjuste:true,status:'CANCELADO'})]);
  assert.match(linhas[0][1],/ORC-123/);
  assert.match(linhas[0][1],/2026-123/);
  assert.match(linhas[0][5],/CANCELADO/);
  assert.match(linhas[0][5],/AJUSTE/);
});

test('ajustes usam referência neutra e pedido antes do orçamento', () => {
  const linha = prepararRegistrosPDF([pedido({_isAjuste:true,pedido_numero:'Acréscimo 123',_valorOverride:-25})])[0];
  assert.match(linha[1],/^123\nOrç\.: ORC-123$/);
  assert.equal(linha[1].includes('Acréscimo'),false);
});

test('registros preservam a UF original normalizada e indicam ausência sem cortar nomes',()=>{
  const base=pedido({estado:' rs '});
  const linhas=prepararRegistrosPDF([base,pedido({estado:'SP'}),pedido({estado:null}),pedido({estado:'   '})]);
  assert.equal(linhas[0][2],base.cliente);
  assert.equal(linhas[0][3],base.vendedor);
  assert.deepEqual(linhas.map(l=>l[4]),['RS','SP','N/D','N/D']);
  assert.equal(base.estado,' rs ');
});

test('renderer aborta contexto inválido antes de construir e antes de devolver o documento', async () => {
  let chamadas = 0;
  await assert.rejects(criarRelatorioVendasPDF(entrada(), () => {chamadas++;throw Error('contexto mudou');}), /contexto mudou/);
  assert.equal(chamadas,1);
  chamadas = 0;
  await assert.rejects(criarRelatorioVendasPDF(entrada(), () => {if (++chamadas === 2) throw Error('contexto mudou');}), /contexto mudou/);
  assert.equal(chamadas,2);
});

test('renderer rejeita valores não finitos em vez de gerar indicadores falsos', async () => {
  for (const patch of [{valorTotal:NaN},{ticketMedio:Infinity},{evolucao:[{mes:'jan',valor:NaN}]}]) {
    await assert.rejects(criarRelatorioVendasPDF(entrada(patch), () => {}), /valor.*inválido/i);
  }
});

test('A4 completo mantém todas as categorias e registros na paginação e rodapés', async () => {
  const dados = entrada({
    vendedores: Array.from({length:12},(_,i)=>({vendedor:`Vendedor integral ${i}`,valor:100,quantidade:1,ticketMedio:100})),
    estados: Array.from({length:12},(_,i)=>({estado:`UF ${i}`,valor:100,quantidade:1})),
    origens: Array.from({length:10},(_,i)=>({origem:`Origem integral ${i}`,valor:100,quantidade:1})),
    registros: Array.from({length:75},(_,i)=>pedido({id:`${i}`,cliente:`Cliente integral numero ${i}`})),
  });
  const doc = await criarRelatorioVendasPDF(dados, () => {});
  assert.ok(Math.abs(doc.internal.pageSize.getWidth()-210)<0.01);
  assert.ok(doc.getNumberOfPages() >= 5);
  const pdf = doc.internal.pages.flat().join('\n');
  for (const texto of ['Vendedor integral 11','UF 11','Origem integral 9','Cliente integral numero 74']) assert.ok(pdf.includes(texto),texto);
  assert.equal((pdf.match(/BRANORTE CRM/g)||[]).length,doc.getNumberOfPages());
  assert.equal((pdf.match(/TOTAL ATIVO/g)||[]).length,doc.getNumberOfPages()+1);
  assert.equal((pdf.match(/\(BRANORTE\)/g)||[]).length,doc.getNumberOfPages(),'somente marca no cabeçalho');
});

test('total de comissões permanece junto à última linha, sem página com apenas o total', async () => {
  for (let quantidade=1;quantidade<=32;quantidade++) {
    const doc=await criarRelatorioVendasPDF(entrada({comissoes:Array.from({length:quantidade},(_,i)=>({
      vendedor:`Comissionado ${i+1}`,quantidade:1,valor:100,percentual:1,comissao:1,
    }))}),()=>{});
    const ultima=(doc.internal.pages as unknown as string[][])[doc.internal.pages.length - 1]?.join('\n') || '';
    assert.ok(ultima.includes('Total estimado'),`total presente com ${quantidade} vendedores`);
    assert.ok(ultima.includes(`Comissionado ${quantidade}`),`última linha com total, ${quantidade} vendedores`);
  }
});

test('comissões vazias ainda exibem total zero',async()=>{
  const doc=await criarRelatorioVendasPDF(entrada({comissoes:[]}),()=>{});
  const ultima=(doc.internal.pages as unknown as string[][])[doc.internal.pages.length - 1]?.join('\n') || '';
  assert.ok(ultima.includes('Total estimado'));
  assert.ok(ultima.includes('R$ 0,00'));
});

test('total de comissões soma os centavos exibidos nas linhas',async()=>{
  const comissoes=['ALFA','BETA'].map(vendedor=>({vendedor,quantidade:1,valor:50.5,percentual:1,comissao:0.505}));
  const doc=await criarRelatorioVendasPDF(entrada({comissoes}),()=>{});
  const paginas=doc.internal.pages.flat().join('\n');
  assert.equal((paginas.match(/R\$ 0,51/g)||[]).length,2);
  assert.ok(paginas.includes('R$ 1,02'),'total fecha com as duas linhas impressas');
});

test('total ativo fica junto ao último registro, sem abrir página apenas de total',async()=>{
  for(let quantidade=1;quantidade<=50;quantidade++) {
    const registros=Array.from({length:quantidade},(_,i)=>pedido({id:`${i+1}`,cliente:`Cliente completo ${i+1}`}));
    const doc=await criarRelatorioVendasPDF(entrada({registros,totalRegistros:quantidade}),()=>{});
    const ultima=(doc.internal.pages as unknown as string[][])[doc.internal.pages.length - 1]?.join('\n') || '';
    assert.ok(ultima.includes(`TOTAL ATIVO - ${quantidade} registros`),`total ativo com ${quantidade} registros`);
    assert.ok(ultima.includes(`Cliente completo ${quantidade}`),`último registro com total, ${quantidade} registros`);
  }
});
