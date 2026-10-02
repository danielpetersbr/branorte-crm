import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import type { jsPDF } from 'jspdf';
import * as relatorio from './relatorio-pdf';
import { criarRelatorioVendasPDF, prepararRegistrosPDF, type RelatorioVendasPDFInput } from './relatorio-pdf';
import { type Pedido } from './calculos';

const fetchOriginal=globalThis.fetch;
const urlsAssets:string[]=[];
before(()=>{globalThis.fetch=async(input)=>{
  const url=String(input);urlsAssets.push(url);
  assert.ok(url.startsWith('/branding-branorte/'),'somente assets locais oficiais');
  const bytes=await readFile(new URL(`../../../../public${url}`,import.meta.url));
  return new Response(new Uint8Array(bytes));
};});
after(()=>{globalThis.fetch=fetchOriginal;});

const textoDocumento=(doc:jsPDF):string=>{
  const mapas=new Map<string,Map<number,string>>();
  const fonteAnterior=doc.getFont();
  for(const estilo of ['normal','bold']){
    doc.setFont('Poppins',estilo);
    const fonte=doc.getFont() as unknown as {id:string;metadata?:{cmap?:{unicode?:{codeMap?:Record<string,number>}}}};
    const codigos=fonte.metadata?.cmap?.unicode?.codeMap;
    if(codigos)mapas.set(fonte.id,new Map(Object.entries(codigos).map(([unicode,glyph])=>[glyph,String.fromCodePoint(Number(unicode))])));
  }
  doc.setFont(fonteAnterior.fontName,fonteAnterior.fontStyle);
  return (doc.internal.pages as unknown as string[][]).map(pagina=>pagina?.join('\n')||'').join('\f').replace(/BT([\s\S]*?)ET/g,(_bloco,conteudo:string)=>{
    const id=conteudo.match(/\/(F\d+)\s[\d.]+\sTf/)?.[1];const mapa=id?mapas.get(id):undefined;
    return mapa?conteudo.replace(/<([\da-f]+)>/gi,(_str,hex:string)=>Array.from({length:hex.length/4},(_,i)=>mapa.get(parseInt(hex.slice(i*4,i*4+4),16))||'').join('')):conteudo;
  });
};

test('identidade oficial usa Poppins completa para moeda e acentos, sem fonte externa',async()=>{
  assert.equal(typeof relatorio.carregarIdentidadePDF,'function');
  const doc=await criarRelatorioVendasPDF(entrada(),()=>{});
  const lista=doc.getFontList();
  assert.ok(lista.Poppins?.includes('normal'));assert.ok(lista.Poppins?.includes('bold'));
  for(const estilo of ['normal','bold']) {
    doc.setFont('Poppins',estilo);
    const fonte=doc.getFont() as unknown as {metadata:{cmap:{unicode:{codeMap:Record<string,number>}}}};
    for(const caractere of 'R$áéíóúãõâêôçÀÁÉÍÓÚÇ')assert.ok(fonte.metadata.cmap.unicode.codeMap[caractere.codePointAt(0)!],`${estilo}: ${caractere}`);
  }
  assert.ok(urlsAssets.includes('/branding-branorte/Poppins-Regular.ttf'));
  assert.ok(urlsAssets.includes('/branding-branorte/Poppins-Bold.ttf'));
  assert.ok(urlsAssets.includes('/branding-branorte/logo-principal-verde-preto.png'));
});

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
  assert.match(linha[1],/^123\nORC-123$/);
  assert.equal(linha[1].includes('Acréscimo'),false);
});

test('referências compactas mantêm pedido e orçamento em duas linhas sem prefixos',()=>{
  const p=pedido({pedido_numero:'PV-2026-2519',numero_orcamento:'2026-2923'});
  const referencia=prepararRegistrosPDF([p])[0][1];
  assert.equal(referencia,'PV-2026-2519\n2026-2923');
  assert.deepEqual(referencia.split('\n'),[p.pedido_numero,p.numero_orcamento]);
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
  const pdf = textoDocumento(doc);
  for (const texto of ['Vendedor integral 11','UF 11','Origem integral 9','Cliente integral numero 74']) assert.ok(pdf.includes(texto),texto);
  assert.equal((pdf.match(/BRANORTE/g)||[]).length,doc.getNumberOfPages());
  assert.equal((pdf.match(/TOTAL ATIVO/g)||[]).length,doc.getNumberOfPages()+1);
  assert.equal((doc.output().match(/\/FontFile2/g)||[]).length,2,'duas fontes embutidas uma única vez');
  assert.equal((doc.output().match(/\/Subtype \/Image/g)||[]).length,3,'logo reutilizado, transparência e mapa');
});

test('total de comissões permanece junto à última linha, sem página com apenas o total', async () => {
  for (let quantidade=1;quantidade<=32;quantidade++) {
    const doc=await criarRelatorioVendasPDF(entrada({comissoes:Array.from({length:quantidade},(_,i)=>({
      vendedor:`Comissionado ${i+1}`,quantidade:1,valor:100,percentual:1,comissao:1,
    }))}),()=>{});
    const ultima=textoDocumento(doc).split('\f').slice(-1)[0];
    assert.ok(ultima.includes('Total estimado'),`total presente com ${quantidade} vendedores`);
    assert.ok(ultima.includes(`Comissionado ${quantidade}`),`última linha com total, ${quantidade} vendedores`);
  }
});

test('comissões vazias ainda exibem total zero',async()=>{
  const doc=await criarRelatorioVendasPDF(entrada({comissoes:[]}),()=>{});
  const ultima=textoDocumento(doc).split('\f').slice(-1)[0];
  assert.ok(ultima.includes('Total estimado'));
  assert.ok(ultima.includes('R$ 0,00'));
});

test('total de comissões soma os centavos exibidos nas linhas',async()=>{
  const comissoes=['ALFA','BETA'].map(vendedor=>({vendedor,quantidade:1,valor:50.5,percentual:1,comissao:0.505}));
  const doc=await criarRelatorioVendasPDF(entrada({comissoes}),()=>{});
  const paginas=textoDocumento(doc);
  assert.equal((paginas.match(/R\$ 0,51/g)||[]).length,2);
  assert.ok(paginas.includes('R$ 1,02'),'total fecha com as duas linhas impressas');
});

test('total ativo fica junto ao último registro, sem abrir página apenas de total',async()=>{
  for(let quantidade=1;quantidade<=50;quantidade++) {
    const registros=Array.from({length:quantidade},(_,i)=>pedido({id:`${i+1}`,cliente:`Cliente completo ${i+1}`}));
    const doc=await criarRelatorioVendasPDF(entrada({registros,totalRegistros:quantidade}),()=>{});
    const ultima=textoDocumento(doc).split('\f').slice(-1)[0];
    assert.ok(ultima.includes(`TOTAL ATIVO - ${quantidade} registros`),`total ativo com ${quantidade} registros`);
    assert.ok(ultima.includes(`Cliente completo ${quantidade}`),`último registro com total, ${quantidade} registros`);
  }
});

test('falha de asset aborta sem fallback e exportação seguinte consegue carregar a identidade',async()=>{
  const fetchLocal=globalThis.fetch;
  globalThis.fetch=async()=>new Response('indisponível',{status:404});
  try {await assert.rejects(criarRelatorioVendasPDF(entrada(),()=>{}),/carregar.*identidade visual Branorte/i);}
  finally {globalThis.fetch=fetchLocal;}
  const doc=await criarRelatorioVendasPDF(entrada(),()=>{});
  assert.ok(doc.getFontList().Poppins);
});

test('mudança de dono durante carregamento dos assets aborta antes de montar o documento',async()=>{
  const fetchLocal=globalThis.fetch;let dono='original';let validacoes=0;
  globalThis.fetch=async(input,init)=>{dono='novo';return fetchLocal(input,init);};
  try {
    await assert.rejects(criarRelatorioVendasPDF(entrada(),()=>{validacoes++;if(dono!=='original')throw Error('Contexto mudou durante assets');}),/contexto mudou/i);
    assert.equal(validacoes,2);
  }finally {globalThis.fetch=fetchLocal;}
});

test('apêndice comporta data larga e status compartilhado inteiros em Poppins',async()=>{
  const doc=await criarRelatorioVendasPDF(entrada({registros:[pedido({data_venda:'2026-06-06',vendedor_2:'ALFA'})]}),()=>{});
  const tabela=(doc as unknown as {lastAutoTable:{columns:Array<{width:number}>;body:Array<{cells:Record<number,{text:string[]}>}>}}).lastAutoTable;
  doc.setFont('Poppins','normal');doc.setFontSize(7.8);
  const cortes=[{texto:'06/06/2026',coluna:0},{texto:'Compartilhado',coluna:5}]
    .filter(item=>doc.getTextWidth(item.texto)>tabela.columns[item.coluna].width-3.6);
  assert.deepEqual(cortes,[],'texto integral cabe após os dois paddings de1,8mm');
  assert.deepEqual(tabela.body[0].cells[0].text,['06/06/2026']);
  assert.deepEqual(tabela.body[0].cells[5].text,['FECHADO','Compartilhado']);
});

test('referência mantém identificador de pedido largo inteiro em Poppins',async()=>{
  const pedidoNumero='PV-2026-2509';
  const doc=await criarRelatorioVendasPDF(entrada({registros:[pedido({pedido_numero:pedidoNumero,numero_orcamento:'2026-2923'})]}),()=>{});
  const tabela=(doc as unknown as {lastAutoTable:{columns:Array<{width:number}>;body:Array<{cells:Record<number,{text:string[]}>}>}}).lastAutoTable;
  doc.setFont('Poppins','normal');doc.setFontSize(7.8);
  assert.ok(doc.getTextWidth(pedidoNumero)<=tabela.columns[1].width-3.6,'identificador cabe sem cortar a última cifra');
  assert.deepEqual(tabela.body[0].cells[1].text,[pedidoNumero,'2026-2923']);
});
