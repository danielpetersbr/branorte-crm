import { jsPDF } from 'jspdf';
import { autoTable, type UserOptions } from 'jspdf-autotable';
import { getValorPedido, type Pedido } from './calculos';
import { sanitizePdfText } from './pdfFonts';
import { escalaBarrasPDF, segmentoBarraPDF } from './pdf-graficos';

export interface RelatorioVendasPDFInput {
  geradoEm: Date;
  periodo: string;
  anoEvolucao: number;
  vendedor: string;
  valorMinimo: number;
  valorTotal: number;
  totalRegistros: number;
  ticketMedio: number;
  pedidosUnicos: number;
  ajustes: number;
  cancelados: number;
  meta: number;
  vendedores: Array<{vendedor: string; valor: number; quantidade: number; ticketMedio: number}>;
  evolucao: Array<{mes: string; valor: number}>;
  fabricas: Array<{fabrica: string; quantidade: number}>;
  equipamentos: Array<{equipamento: string; quantidade: number; valor: number}>;
  fechamento: Array<{vendedor: string; dias: number; quantidade: number}>;
  estados: Array<{estado: string; valor: number; quantidade: number}>;
  origens: Array<{origem: string; valor: number; quantidade: number}>;
  rapidas: Array<{origem: string; quantidade: number; valor: number}>;
  conversao: Array<{origem: string; mediaDias: number; quantidade: number}>;
  registros: Pedido[];
  comissoes?: Array<{vendedor: string; quantidade: number; valor: number; percentual: number; comissao: number}>;
  mapa: {imagem: string; largura: number; altura: number};
}

const cores = {
  verde: [1, 169, 91], navy: [1, 1, 1], texto: [1, 1, 1],
  secundario: [90, 90, 90], linha: [225, 225, 225], fundo: [248, 248, 248],
  verdeClaro: [242, 250, 246], negativo: [90, 90, 90], branco: [255, 255, 255],
} satisfies Record<string, [number, number, number]>;
const moeda = (valor: number) => new Intl.NumberFormat('pt-BR', {style:'currency',currency:'BRL'}).format(valor).replace(/\u00a0/g,' ');
const numero = (valor: number) => new Intl.NumberFormat('pt-BR', {maximumFractionDigits:2}).format(valor);
const texto = (valor: string | null | undefined) => sanitizePdfText(valor) || '-';
const dataVenda = (valor: string) => {
  const data = valor?.split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(data || '') ? data.split('-').reverse().join('/') : '-';
};

const base64 = (bytes: Uint8Array): string => {
  let binario='';
  for(let i=0;i<bytes.length;i+=8192)binario+=String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(binario);
};

/** Assets locais e completos; cada documento incorpora as duas fontes uma única vez. */
export async function carregarIdentidadePDF(): Promise<{regular:string;bold:string;logo:Uint8Array}> {
  try {
    const caminhos=['Poppins-Regular.ttf','Poppins-Bold.ttf','logo-principal-verde-preto.png'];
    const [regular,bold,logo]=await Promise.all(caminhos.map(async nome=>{
      const resposta=await fetch(`/branding-branorte/${nome}`);
      if(!resposta.ok)throw Error('Asset indisponível');
      return new Uint8Array(await resposta.arrayBuffer());
    }));
    const ttf=(bytes:Uint8Array)=>bytes.length>10000&&bytes[0]===0&&bytes[1]===1&&bytes[2]===0&&bytes[3]===0;
    if(!ttf(regular)||!ttf(bold)||logo[0]!==137||logo[1]!==80||logo[2]!==78||logo[3]!==71)throw Error('Asset inválido');
    return {regular:base64(regular),bold:base64(bold),logo};
  }catch {throw Error('Não foi possível carregar a identidade visual Branorte. Atualize a página e exporte novamente.');}
}

/** Usa as parcelas já expandidas pelo dashboard, sem refazer rateios ou filtros. */
export const prepararRegistrosPDF = (registros: readonly Pedido[]): string[][] => registros.map(p => [
  dataVenda(p.data_venda), [p.pedido_numero ? texto(p._isAjuste ? p.pedido_numero.replace(/^(?:Acréscimo|Acrescimo)\s*/i,'') : p.pedido_numero) : '',p.numero_orcamento ? texto(p.numero_orcamento) : ''].filter(Boolean).join('\n') || '-',
  texto(p.cliente), texto(p.vendedor), p.estado?.trim().toUpperCase() || 'N/D',
  p.status === 'CANCELADO' ? `CANCELADO${p._isAjuste?'\nAJUSTE':''}` : p._isAjuste ? 'AJUSTE' : p.vendedor_2?.trim() ? `${p.status}\nCompartilhado` : p.status,
  moeda(getValorPedido(p)),
]);

function validarDados(input: RelatorioVendasPDFInput): void {
  const valores = [input.anoEvolucao,input.valorMinimo,input.valorTotal,input.totalRegistros,input.ticketMedio,
    input.pedidosUnicos,input.ajustes,input.cancelados,input.meta,input.mapa.largura,input.mapa.altura,
    ...input.vendedores.flatMap(v=>[v.valor,v.quantidade,v.ticketMedio]),
    ...input.evolucao.map(v=>v.valor), ...input.fabricas.map(v=>v.quantidade),
    ...input.equipamentos.flatMap(v=>[v.valor,v.quantidade]), ...input.fechamento.flatMap(v=>[v.dias,v.quantidade]),
    ...input.estados.flatMap(v=>[v.valor,v.quantidade]), ...input.origens.flatMap(v=>[v.valor,v.quantidade]),
    ...input.rapidas.flatMap(v=>[v.valor,v.quantidade]), ...input.conversao.flatMap(v=>[v.mediaDias,v.quantidade]),
    ...input.registros.map(getValorPedido), ...(input.comissoes || []).flatMap(v=>[v.valor,v.quantidade,v.percentual,v.comissao]),
  ];
  if (valores.some(v=>!Number.isFinite(v))) throw Error('Valor de relatório inválido. Atualize os dados antes de exportar.');
  if (!Number.isFinite(input.geradoEm.getTime())) throw Error('Data de geração inválida.');
  if (!input.mapa.imagem || input.mapa.largura <= 0 || input.mapa.altura <= 0) throw Error('O mapa não está disponível para o relatório.');
}

/** Constrói o documento completo. O chamador valida novamente o contexto antes de salvar. */
export async function criarRelatorioVendasPDF(input: RelatorioVendasPDFInput, validar: () => void): Promise<jsPDF> {
  validar();
  validarDados(input);
  const identidade=await carregarIdentidadePDF();
  validar();
  const doc = new jsPDF({orientation:'portrait',unit:'mm',format:'a4',compress:true,putOnlyUsedFonts:true});
  doc.addFileToVFS('Poppins-Regular.ttf',identidade.regular);doc.addFileToVFS('Poppins-Bold.ttf',identidade.bold);
  doc.addFont('Poppins-Regular.ttf','Poppins','normal');doc.addFont('Poppins-Bold.ttf','Poppins','bold');
  const fonte = 'Poppins';
  const logo = (x:number,yy:number,w:number) => doc.addImage(identidade.logo,'PNG',x,yy,w,w*427/2715,'branorte-logo-oficial','FAST');
  const W = 210, margem = 14, largura = W - margem * 2, limite = 276;
  let y = 27;
  let secaoAtual = 'Resumo executivo';
  const secoesPaginas = new Map<number, string>([[1,secaoAtual]]);
  const geradoEm = new Intl.DateTimeFormat('pt-BR', {dateStyle:'short',timeStyle:'short'}).format(input.geradoEm);
  const totalFabricas = input.fabricas.reduce((s,v)=>s+v.quantidade,0);
  const totalEquipamentos = input.equipamentos.reduce((s,v)=>s+v.quantidade,0);

  doc.setProperties({title:'Branorte - Relatório de vendas',subject:input.periodo,author:'Branorte',creator:'Branorte'});
  const escrever = (conteudo: string | string[], x: number, yy: number, tamanho=9, negrito=false, cor=cores.texto, alinhamento?: 'left' | 'center' | 'right') => {
    doc.setFont(fonte,negrito?'bold':'normal');doc.setFontSize(tamanho);doc.setTextColor(...cor);
    doc.text(conteudo,x,yy,{align:alinhamento || 'left'});
  };
  const novaPagina = () => {
    doc.addPage();y=30;secoesPaginas.set(doc.getNumberOfPages(),secaoAtual);
  };
  const espaco = (altura: number) => {if(y+altura>limite)novaPagina();};
  const paragrafo = (conteudo: string, cor=cores.secundario, tamanho=8.5) => {
    doc.setFont(fonte,'normal');doc.setFontSize(tamanho);
    const linhas = doc.splitTextToSize(conteudo,largura);
    const altura = linhas.length * tamanho * 0.44;
    espaco(altura+3);escrever(linhas,margem,y,tamanho,false,cor);y+=altura+3;
  };
  const secao = (titulo: string, descricao?: string, alturaMinima=32) => {
    secaoAtual=titulo;espaco(alturaMinima);
    if(!secoesPaginas.has(doc.getNumberOfPages()))secoesPaginas.set(doc.getNumberOfPages(),titulo);
    doc.setFillColor(...cores.verde);doc.roundedRect(margem,y-3.8,1.4,5.5,0.5,0.5,'F');
    escrever(titulo,margem+4,y,12,true,cores.navy);y+=7;
    if(descricao)paragrafo(descricao);
  };
  const tabela = (head: string[], body: string[][], opcoes: Partial<UserOptions> = {}) => {
    if(body.length===0&&!opcoes.foot?.length) {paragrafo('Sem registros para os filtros selecionados.');y+=3;return;}
    espaco(22);
    autoTable(doc,{
      startY:y,head:[head],body,theme:'plain',
      margin:{top:30,left:margem,right:margem,bottom:22},tableWidth:largura,
      styles:{font:fonte,fontSize:8.3,textColor:cores.texto,cellPadding:{top:2.1,bottom:2.1,left:2.2,right:2.2},overflow:'linebreak',lineColor:cores.linha,lineWidth:{bottom:0.15},valign:'middle'},
      headStyles:{font:fonte,fontStyle:'bold',fillColor:cores.navy,textColor:cores.branco,fontSize:8.1},
      alternateRowStyles:{fillColor:cores.fundo},
      rowPageBreak:'avoid',showHead:'everyPage',
      didDrawPage:()=>{const pagina=doc.getCurrentPageInfo().pageNumber;if(!secoesPaginas.has(pagina))secoesPaginas.set(pagina,secaoAtual);},
      ...opcoes,
    });
    y=(doc as jsPDF & {lastAutoTable:{finalY:number}}).lastAutoTable.finalY+10;
  };

  // Compacta capa e resumo no mesmo fluxo das seções seguintes.
  logo(margem,8,67);
  escrever('Relatório de vendas',margem,31,22,true,cores.texto);
  escrever('Visão executiva e demonstrativo completo',margem,40,9,false,cores.secundario);
  doc.setFillColor(...cores.verde);doc.rect(0,45,W,1.5,'F');
  y=56;
  paragrafo(`Período: ${texto(input.periodo)}  |  Vendedor: ${texto(input.vendedor)}`,cores.texto,9.5);
  paragrafo(`Valor mínimo do pedido: ${input.valorMinimo>0?moeda(input.valorMinimo):'Todos os valores'}  |  Gerado em ${geradoEm}`,cores.secundario,8.5);
  y+=2;
  const gap=3, cardW=(largura-gap*3)/4, cardY=y;
  const kpis=[['Total em vendas',moeda(input.valorTotal)],['Registros ativos',numero(input.totalRegistros)],['Ticket por registro',moeda(input.ticketMedio)],['Fábricas vendidas',numero(totalFabricas)]];
  kpis.forEach(([label,value],i)=>{
    const x=margem+i*(cardW+gap);
    doc.setFillColor(...(i===0?cores.verdeClaro:cores.fundo));doc.roundedRect(x,cardY,cardW,27,2,2,'F');
    escrever(label,x+3,cardY+8,8,false,cores.secundario);
    doc.setFont(fonte,'bold');let tamanho=13;
    while(tamanho>9.5&&doc.getTextWidth(value)*(tamanho/doc.getFontSize())>cardW-6)tamanho-=0.5;
    escrever(value,x+3,cardY+19,tamanho,true,cores.texto);
  });
  y+=35;
  if(input.meta>0) {
    const percentual=input.valorTotal/input.meta*100;
    escrever(`Meta do período: ${moeda(input.meta)}`,margem,y,9,true,cores.navy);
    escrever(`${numero(percentual)}% atingidos`,W-margem,y,9,true,cores.verde,'right');y+=5;
    doc.setFillColor(...cores.linha);doc.roundedRect(margem,y,largura,2.8,1.3,1.3,'F');
    const progresso=Math.max(0,Math.min(1,percentual/100))*largura;
    if(progresso>0){doc.setFillColor(...cores.verde);doc.roundedRect(margem,y,progresso,2.8,1.3,1.3,'F');}
    y+=10;
  } else {paragrafo('Meta do período: não definida.');}
  paragrafo(`${numero(input.pedidosUnicos)} pedidos físicos de venda  |  ${numero(input.ajustes)} registros de ajuste ativos  |  ${numero(input.cancelados)} registros cancelados`);
  paragrafo('Registros são parcelas monetárias da venda: compartilhamentos e ajustes podem gerar mais de uma linha por pedido. Cancelados constam no demonstrativo e ficam fora dos totais ativos.');
  paragrafo('Fábricas e equipamentos contam unidades físicas dos pedidos originais, sem duplicar compartilhamentos ou ajustes. O valor mínimo é aplicado ao total do pedido.');
  y+=3;

  secao('Ranking de vendedores','Todos os vendedores do período. Valores e ticket correspondem aos registros monetários ativos.');
  tabela(['Pos.','Vendedor','Registros','Valor de vendas','Ticket por registro'],input.vendedores.map((v,i)=>[`${i+1}º`,texto(v.vendedor),numero(v.quantidade),moeda(v.valor),moeda(v.ticketMedio)]),{
    columnStyles:{0:{cellWidth:12,halign:'center'},1:{cellWidth:58},2:{cellWidth:22,halign:'right'},3:{cellWidth:45,halign:'right',fontStyle:'bold'},4:{cellWidth:45,halign:'right'}},
  });

  // Gráfico vetorial com domínio assinado: ajustes negativos mantêm direção real.
  secao(`Evolução anual de vendas - ${input.anoEvolucao}`,'Ano completo, com os filtros de vendedor e valor mínimo. Esta série usa o ano indicado, independentemente do período do resumo.',95);
  const chartY=y+5, chartH=48, chartX=margem+21, chartW=largura-24;
  const escala=escalaBarrasPDF(input.evolucao.map(v=>v.valor));
  for(let i=0;i<=4;i++) {
    const frac=i/4, yy=chartY+chartH*(1-frac), v=escala.minimo+(escala.maximo-escala.minimo)*frac;
    doc.setDrawColor(...cores.linha);doc.setLineWidth(0.2);doc.line(chartX,yy,chartX+chartW,yy);
    const curto=Math.abs(v)>=1_000_000?`${numero(v/1_000_000)} mi`:Math.abs(v)>=1_000?`${numero(v/1_000)} mil`:numero(v);
    escrever(curto,chartX-3,yy+1,7,false,cores.secundario,'right');
  }
  escrever('R$',margem,chartY-3,7,false,cores.secundario);
  const passo=chartW/Math.max(input.evolucao.length,1),bw=Math.min(9,passo*0.58);
  input.evolucao.forEach((v,i)=>{
    const s=segmentoBarraPDF(v.valor,escala), x=chartX+passo*(i+0.5)-bw/2;
    if(s.comprimento>0){doc.setFillColor(...(v.valor<0?cores.negativo:cores.verde));doc.rect(x,chartY+chartH*(1-s.inicio-s.comprimento),bw,chartH*s.comprimento,'F');}
    escrever(texto(v.mes),x+bw/2,chartY+chartH+5,7,false,cores.secundario,'center');
  });
  doc.setDrawColor(...cores.secundario);doc.setLineWidth(0.3);doc.line(chartX,chartY+chartH*(1-escala.zero),chartX+chartW,chartY+chartH*(1-escala.zero));
  y=chartY+chartH+12;
  tabela(['Mês','Valor de vendas','Mês','Valor de vendas'],Array.from({length:Math.ceil(input.evolucao.length/2)},(_,i)=>{
    const a=input.evolucao[i],b=input.evolucao[i+Math.ceil(input.evolucao.length/2)];
    return [texto(a?.mes),a?moeda(a.valor):'-',texto(b?.mes),b?moeda(b.valor):'-'];
  }),{columnStyles:{0:{cellWidth:27},1:{cellWidth:64,halign:'right'},2:{cellWidth:27},3:{cellWidth:64,halign:'right'}}});

  const barras = (titulo: string, descricao: string, dados: Array<{label:string;valor:number;complemento:string}>, formato:(v:number)=>string) => {
    secao(titulo,descricao,35);
    if(!dados.length){paragrafo('Sem registros para os filtros selecionados.');y+=6;return;}
    const scale=escalaBarrasPDF(dados.map(v=>v.valor));
    for(const item of dados) {
      doc.setFont(fonte,'normal');doc.setFontSize(8.5);
      const label=doc.splitTextToSize(texto(item.label),106) as string[];
      const altura=Math.max(15,label.length*3.9+8);
      espaco(altura+2);
      escrever(label,margem,y,8.5,true,cores.texto);
      escrever(formato(item.valor),W-margem,y,8.5,true,item.valor<0?cores.negativo:cores.navy,'right');
      escrever(item.complemento,W-margem,y+4,7.5,false,cores.secundario,'right');
      const by=y+Math.max(label.length*3.9,7)+1;
      doc.setFillColor(...cores.fundo);doc.roundedRect(margem,by,largura,2,1,1,'F');
      const segment=segmentoBarraPDF(item.valor,scale);
      if(segment.comprimento>0){doc.setFillColor(...(item.valor<0?cores.negativo:cores.verde));doc.rect(margem+segment.inicio*largura,by,segment.comprimento*largura,2,'F');}
      if(scale.minimo<0){doc.setDrawColor(...cores.secundario);doc.setLineWidth(0.2);doc.line(margem+scale.zero*largura,by-0.6,margem+scale.zero*largura,by+2.6);}
      y+=altura+2;
    }
    y+=5;
  };
  barras('Vendas por canal de origem','Valor dos registros monetários ativos. Inclui todos os canais, inclusive os não informados.',input.origens.map(v=>({label:v.origem,valor:v.valor,complemento:`${numero(v.quantidade)} registros`})),moeda);
  barras('Conversões no mesmo mês','Pedidos físicos cujo primeiro contato e fechamento ocorreram no mesmo mês.',input.rapidas.map(v=>({label:v.origem,valor:v.quantidade,complemento:moeda(v.valor)})),v=>`${numero(v)} pedidos`);
  barras('Tempo médio de conversão por origem','Média de dias entre primeiro contato e fechamento dos pedidos físicos com datas válidas.',input.conversao.map(v=>({label:v.origem,valor:v.mediaDias,complemento:`${numero(v.quantidade)} pedidos com datas válidas`})),v=>`${numero(v)} dias`);
  secao('Tempo de fechamento por vendedor','Pedidos físicos com primeiro contato e venda válidos. Pedidos compartilhados aparecem nos vendedores associados.');
  tabela(['Vendedor','Média de dias','Pedidos considerados'],input.fechamento.map(v=>[texto(v.vendedor),numero(v.dias),numero(v.quantidade)]),{
    columnStyles:{0:{cellWidth:104},1:{cellWidth:39,halign:'right'},2:{cellWidth:39,halign:'right'}},
  });

  secao('Distribuição geográfica','Mapa e tabelas representam os registros monetários ativos do período. Estados sem informação aparecem na tabela quando presentes.',142);
  const imgW=Math.min(160,118*input.mapa.largura/input.mapa.altura),imgH=imgW*input.mapa.altura/input.mapa.largura;
  doc.addImage(input.mapa.imagem,'JPEG',(W-imgW)/2,y,imgW,imgH,undefined,'FAST');y+=imgH+8;
  secao('Vendas por estado','Todos os estados presentes na leitura, sem corte do ranking.');
  tabela(['Estado','Registros','Valor de vendas'],input.estados.map(v=>[texto(v.estado),numero(v.quantidade),moeda(v.valor)]),{
    columnStyles:{0:{cellWidth:98},1:{cellWidth:30,halign:'right'},2:{cellWidth:54,halign:'right',fontStyle:'bold'}},
  });
  secao('Demonstrativo por origem','Todos os canais presentes na leitura, inclusive a origem não informada.');
  tabela(['Canal de origem','Registros','Valor de vendas'],input.origens.map(v=>[texto(v.origem),numero(v.quantidade),moeda(v.valor)]),{
    columnStyles:{0:{cellWidth:98},1:{cellWidth:30,halign:'right'},2:{cellWidth:54,halign:'right'}},
  });

  secao('Fábricas de ração',`${numero(totalFabricas)} unidades físicas. Quantidades consolidadas por modelo, sem duplicar parcelas e ajustes.`);
  tabela(['Modelo','Quantidade vendida'],input.fabricas.map(v=>[texto(v.fabrica),numero(v.quantidade)]),{
    columnStyles:{0:{cellWidth:138},1:{cellWidth:44,halign:'right',fontStyle:'bold'}},
  });
  secao('Equipamentos separados',`${numero(totalEquipamentos)} unidades físicas. O valor dos itens usa quantidade x preço unitário; em filtro por vendedor, considera os itens integrais dos pedidos associados.`);
  tabela(['Equipamento','Quantidade','Valor dos itens'],input.equipamentos.map(v=>[texto(v.equipamento),numero(v.quantidade),moeda(v.valor)]),{
    columnStyles:{0:{cellWidth:98},1:{cellWidth:30,halign:'right'},2:{cellWidth:54,halign:'right'}},
  });

  secao('Demonstrativo completo de registros',`${numero(input.registros.length)} registros do período, incluindo cancelados. AJUSTE identifica lançamento na data do acréscimo ou desconto. Valores compartilhados correspondem à parcela atribuída ao vendedor.`,42);
  tabela(['Data','Pedido / orçamento','Cliente','Vendedor','UF','Status','Valor do registro'],prepararRegistrosPDF(input.registros),{
    styles:{font:fonte,fontSize:7.8,textColor:cores.texto,cellPadding:{top:1.8,bottom:1.8,left:1.8,right:1.8},overflow:'linebreak',lineColor:cores.linha,lineWidth:{bottom:0.15},valign:'middle'},
    columnStyles:{0:{cellWidth:20},1:{cellWidth:24},2:{cellWidth:49},3:{cellWidth:22},4:{cellWidth:10,halign:'center'},5:{cellWidth:25},6:{cellWidth:32,halign:'right'}},
    foot:[[{content:`TOTAL ATIVO - ${numero(input.totalRegistros)} registros`,colSpan:6,styles:{halign:'left'}},{content:moeda(input.valorTotal),styles:{halign:'right'}}]],
    showFoot:'lastPage',footStyles:{fillColor:cores.verdeClaro,textColor:cores.navy,fontStyle:'bold',fontSize:8.5},
    didParseCell:(hook)=>{
      if(hook.section==='body' && input.registros[hook.row.index]?.status==='CANCELADO') hook.cell.styles.textColor=cores.negativo;
      if(hook.section==='body' && hook.column.index===5 && input.registros[hook.row.index]?._isAjuste && input.registros[hook.row.index]?.status!=='CANCELADO')hook.cell.styles.textColor=cores.verde;
    },
  });
  if(input.comissoes) {
    secao('Comissões estimadas','Regra vigente: saldos positivos, excluindo DANIEL e PATRICK. Usa o percentual cadastrado, ou 1% quando ausente ou zero. Estimativa do dashboard, sem confirmação de pagamento.');
    // Soma os centavos efetivamente impressos, mantendo a comissão calculada de cada linha.
    const totalComissoes=input.comissoes.reduce((s,v)=>s+Number(moeda(v.comissao).replace(/[^\d-]/g,'')),0)/100;
    tabela(['Vendedor','Registros','Base de vendas','Percentual','Comissão'],input.comissoes.map(v=>[texto(v.vendedor),numero(v.quantidade),moeda(v.valor),`${numero(v.percentual)}%`,moeda(v.comissao)]),{
      columnStyles:{0:{cellWidth:57},1:{cellWidth:22,halign:'right'},2:{cellWidth:42,halign:'right'},3:{cellWidth:22,halign:'right'},4:{cellWidth:39,halign:'right',fontStyle:'bold'}},
      foot:[[{content:'Total estimado de comissões',colSpan:4,styles:{halign:'left'}},{content:moeda(totalComissoes),styles:{halign:'right'}}]],
      showFoot:'lastPage',footStyles:{fillColor:cores.verdeClaro,textColor:cores.navy,fontStyle:'bold',fontSize:8.5},
    });
  }

  // Impressão final em todas as páginas, inclusive as continuações automáticas.
  const totalPaginas=doc.getNumberOfPages();
  for(let pagina=1;pagina<=totalPaginas;pagina++) {
    doc.setPage(pagina);
    if(pagina>1) {
      logo(margem,7,38);
      escrever('CONTROLE DE VENDAS',W-margem,13,7,false,cores.secundario,'right');
      doc.setDrawColor(...cores.linha);doc.setLineWidth(0.3);doc.line(margem,18,W-margem,18);
      escrever(secoesPaginas.get(pagina)||'Relatório de vendas',margem,23,8,false,cores.secundario);
    }
    doc.setDrawColor(...cores.linha);doc.setLineWidth(0.2);doc.line(margem,281,W-margem,281);
    escrever('BRANORTE',margem,287,7,true,cores.navy);
    escrever(`TOTAL ATIVO ${moeda(input.valorTotal)} | ${numero(input.totalRegistros)} registros`,W/2,287,7,false,cores.secundario,'center');
    escrever(`${pagina} / ${totalPaginas}`,W-margem,287,7,false,cores.secundario,'right');
    escrever(`${texto(input.periodo)} | ${geradoEm}`,margem,292,6.5,false,cores.secundario);
  }
  validar();
  return doc;
}
