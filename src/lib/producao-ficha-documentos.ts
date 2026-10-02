import {jsPDF} from 'jspdf';
import {autoTable} from 'jspdf-autotable';
import {addBusinessDays,addDays,format,isValid,parse,parseISO} from 'date-fns';
import type {CardEspelho} from './producao-espelho-consulta';

export type BomItemDocumento={id:string;item:string|null;categoria:string|null;unidade:string|null;quantidade:string|number|null};
export type OrdemProducaoDocumento={
  referencia:string;cliente:string;cidadeUf:string|null;vendedor:string|null;dataVenda:string|null;dataEntrega:string|null;
  equipamentos:Array<{descricao:string;un:string;qtd:string|number}>;motores:string[];
  tensao:string|null;marcaMotor:string|null;responsavel:string|null;observacoes:string[];
};

const texto=(value:unknown)=>typeof value==='string'?value.trim():'';
const nullable=(value:unknown)=>texto(value)||null;
// The original production order retains technical lines only. Commercial and
// contact data belong to the sales document, not this factory handout.
const privados=[
  /R\s?\$/i,/\d{1,3}(?:[.\s]\d{3})+,\d{2}/,
  /pagament|parcel|descont|boleto|\bpix\b|à\s*vista|a\s*vista|valor\s*(total|unit)/i,
  /\bsinal\s+de\b/i,/\d+\s*%\s*(de\s+)?(entrada|saldo|sinal)/i,/\b(entrada|saldo)\s+de\s+\d/i,
  /\d{3}\.\d{3}\.\d{3}\s?-\s?\d{2}/,/\d{2}\.\d{3}\.\d{3}\s?\/\s?\d{4}/,/\bCPF\b|\bCNPJ\b/i,
  /\(\d{2}\)\s?\d{4,5}[-.\s]?\d{4}/,/\b\d{5}-\d{3}\b/,/ENDERE[ÇC]O|BAIRRO\s*:/i,
];
const tecnico=(value:string)=>!!value.trim()&&!privados.some(pattern=>pattern.test(value));
const cabecalhos=[
  /^(SUB[-\s]?TOTAL|TOTAL|VALOR|FRETE|IPI|ICMS|PIS|COFINS|DESCONTO)/i,
  /^(CUSTO|MARGEM|IMPOSTOS|SERVIÇO|FRETE|EMBALAGEM)/i,
  /^(EQUIPAMENTOS|COMPONENTES|CONJUNTO|PEÇAS|ELÉTRIC|AUTOMAÇÃO)/i,
  /^MOTORES?\s+(TRIF|MONOF|ELÉTRIC)/i,/^motoredutor(es)?$/i,/^\|/,/^ACESS[OÓ]RIOS$/i,
];
const equipamentoNoMotor=/triturador|moinho|transportador|peneira|misturador|dosador|elevador|silo|rosca|esteira|alimentador|secador|separador|britador|equipamento:/i;
function dataDocumento(value:unknown):Date|null {
  const raw=texto(value);if(!raw)return null;
  for(const date of [parse(raw,'dd/MM/yyyy',new Date(2000,0,1)),parseISO(raw)])if(isValid(date))return date;
  return null;
}
function entregaDocumento(card:CardEspelho):string|null {
  const raw=card.dadosOriginais;let date:Date|null=null;
  if(texto(raw.prazo_data))date=dataDocumento(raw.prazo_data);
  else if(typeof raw.prazo_dias==='number'&&Number.isInteger(raw.prazo_dias)&&raw.prazo_dias!==0){
    const start=dataDocumento(raw.created_at);
    if(start){start.setHours(0,0,0,0);date=raw.prazo_tipo==='uteis'?addBusinessDays(start,raw.prazo_dias):addDays(start,raw.prazo_dias);}
  }
  return date&&isValid(date)?format(date,'yyyy-MM-dd'):null;
}

/** Pure projection of the already authorized card and actual BOM; no source I/O. */
export function montarOrdemProducao(card:CardEspelho,bomItens:readonly BomItemDocumento[]=[]):OrdemProducaoDocumento {
  const raw=card.dadosOriginais;
  const equipamentosBom=bomItens.filter(item=>{
    const name=texto(item.item);return tecnico(name)&&!cabecalhos.some(pattern=>pattern.test(name))&&item.categoria!=='Motores e Acionamentos';
  });
  const equipamentos=equipamentosBom.length?equipamentosBom.map(item=>({descricao:texto(item.item),un:texto(item.unidade)||'UN',qtd:item.quantidade??1})):
    texto(raw.resumo_equipamentos).replace(/,\s*(\d)/g,'\u0000$1').split(',').map(part=>part.replace(/\u0000/g,',').trim()).filter(tecnico).map(descricao=>({descricao,un:'UN',qtd:1}));
  const motoresBom=bomItens.filter(item=>{
    const name=texto(item.item);return tecnico(name)&&!equipamentoNoMotor.test(name)&&(item.categoria==='Motores e Acionamentos'||/\bmotor\b|motoredutor/i.test(name));
  });
  const motoresEspecificos=motoresBom.filter(item=>!/^motores?\s*(trif|monof)/i.test(texto(item.item)));
  const motores=(motoresEspecificos.length?motoresEspecificos:motoresBom).map(item=>`${item.quantidade??1}x ${texto(item.item)}`);
  const observacoes=[raw.observacoes,raw.observacao_vendedor].flatMap(value=>texto(value).split(/\r?\n/)).map(line=>line.trim()).filter(tecnico);
  return {
    referencia:card.numeroOrcamento||texto(raw.pedido_id).slice(0,8)||card.id.slice(0,8),cliente:card.cliente,
    cidadeUf:nullable(raw.cidade_destino),vendedor:card.vendedor,dataVenda:nullable(raw.created_at),dataEntrega:entregaDocumento(card),
    equipamentos,motores,tensao:nullable(raw.motor_tensao),marcaMotor:nullable(raw.motor_marca),
    responsavel:nullable(raw.projeto?.responsavel_nome),observacoes,
  };
}

export function nomeDocumentoProducao(tipo:'placa'|'ordem',referencia:string):string {
  const base=referencia.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^[.-]+|[.-]+$/g,'').toLowerCase()||'pedido';
  return `${tipo==='placa'?'placa-identificacao':'ordem-producao'}-${base}.pdf`;
}
const textoPdf=(value:string)=>value.replace(/[\u2010-\u2015\u2212]/g,'-').replace(/\u00a0/g,' ').replace(/[\u200d\ufe0e\ufe0f]|\p{Extended_Pictographic}/gu,'');
const dataPdf=(value:string|null)=>{const date=dataDocumento(value);return date?format(date,'dd/MM/yyyy'):'-';};

/** Creates a local technical PDF. The caller saves it only while the card is visible. */
export function gerarOrdemProducaoPdf(dados:OrdemProducaoDocumento):jsPDF {
  if(!dados.cliente.trim())throw Error('Card sem nome de cliente.');
  const equipamentos=dados.equipamentos.filter(item=>tecnico(item.descricao)),motores=dados.motores.filter(tecnico),observacoes=dados.observacoes.filter(tecnico);
  if(!equipamentos.length&&!motores.length)throw Error('Card sem equipamentos nem motores para montar a ordem.');
  const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'}),width=pdf.internal.pageSize.getWidth(),margin=14;
  pdf.setFont('helvetica','bold');pdf.setFontSize(18);pdf.text('ORDEM DE PRODUÇÃO',width/2,18,{align:'center'});
  autoTable(pdf,{
    startY:24,margin:{left:margin,right:margin,bottom:19},theme:'grid',styles:{font:'helvetica',fontSize:10,cellPadding:2},
    columnStyles:{0:{fontStyle:'bold',cellWidth:42}},rowPageBreak:'avoid',
    body:[['EMPRESA','METALURGICA BBA LTDA ME'],['PEDIDO',textoPdf(dados.referencia)],['DATA VENDA',dataPdf(dados.dataVenda)],
      ['DATA ENTREGA',dataPdf(dados.dataEntrega)],['CLIENTE',textoPdf(dados.cliente.toUpperCase())],
      ['CIDADE',textoPdf((dados.cidadeUf||'-').toUpperCase())],['VENDEDOR',textoPdf((dados.vendedor||'-').toUpperCase())],
      ...(dados.responsavel?[['RESP. PROJETO',textoPdf(dados.responsavel.toUpperCase())]]:[])],
    didParseCell:cell=>{if(cell.row.index===3&&cell.column.index===1){cell.cell.styles.textColor=[204,0,0];cell.cell.styles.fontStyle='bold';}},
  });
  const end=()=>((pdf as jsPDF&{lastAutoTable:{finalY:number}}).lastAutoTable.finalY)+6;
  let y=end();
  if(equipamentos.length){
    autoTable(pdf,{
      startY:y,margin:{left:margin,right:margin,bottom:19},theme:'grid',rowPageBreak:'avoid',
      headStyles:{fillColor:[40,40,40],fontSize:10},styles:{font:'helvetica',fontSize:9.5,cellPadding:2},
      columnStyles:{1:{cellWidth:16,halign:'center'},2:{cellWidth:16,halign:'center'}},head:[['EQUIPAMENTOS - DESCRIÇÃO','UN','QTD']],
      body:equipamentos.map(item=>[textoPdf(item.descricao.replace(/\((JÁ EXISTENTE|CORTESIA|BRINDE|POR CONTA DO CLIENTE)\)/gi,'').trim()),textoPdf(item.un),String(item.qtd)]),
    });y=end();
  }
  const sections:Array<[string,string[]]>=[];
  if(motores.length)sections.push(['MOTORES',motores]);
  const motor=[dados.tensao,dados.marcaMotor?`Marca: ${dados.marcaMotor}`:null].filter((value):value is string=>!!value&&tecnico(value)).join('  |  ');
  if(motor)sections.push(['TENSÃO / MOTOR',[motor]]);
  if(observacoes.length)sections.push(['OBSERVAÇÕES TÉCNICAS',observacoes]);
  for(const [title,rows] of sections){
    autoTable(pdf,{startY:y,margin:{left:margin,right:margin,bottom:19},theme:'grid',rowPageBreak:'avoid',
      headStyles:{fillColor:[40,40,40],fontSize:10},styles:{font:'helvetica',fontSize:9.5,cellPadding:2},
      head:[[title]],body:rows.map(row=>[textoPdf(row)]),});y=end();
  }
  const pages=pdf.getNumberOfPages();
  for(let page=1;page<=pages;page++){
    pdf.setPage(page);pdf.setFont('helvetica','bold');pdf.setFontSize(8);pdf.setTextColor(120);
    pdf.text('DOCUMENTO PARA USO INTERNO - SEM VALORES COMERCIAIS',width/2,pdf.internal.pageSize.getHeight()-10,{align:'center'});
    pdf.setFont('helvetica','normal');pdf.text(`${page} / ${pages}`,width-margin,pdf.internal.pageSize.getHeight()-10,{align:'right'});
  }
  pdf.setProperties({title:`Ordem de produção - ${dados.referencia}`,author:'Branorte'});
  return pdf;
}

/** The source identification plate has two identical copies on an A4 sheet. */
export function gerarPlacaIdentificacaoPdf(card:CardEspelho):jsPDF {
  const equipamento=texto(card.dadosOriginais.titulo_equipamento)||texto(card.dadosOriginais.resumo_equipamentos);
  if(!card.cliente.trim())throw Error('Não foi possível gerar a placa: cliente é obrigatório.');
  if(!equipamento)throw Error('Não foi possível gerar a placa: equipamento é obrigatório.');
  const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait'}),width=pdf.internal.pageSize.getWidth(),height=pdf.internal.pageSize.getHeight(),margin=12.7;
  const title='BRANORTE - PLACA DE IDENTIFICACAO',fields=[`CLIENTE: ${card.cliente}`,
    ...(card.vendedor?[`VENDEDOR: ${card.vendedor}`]:[]),
    ...(texto(card.dadosOriginais.cidade_destino)?[`LOCALIZACAO: ${texto(card.dadosOriginais.cidade_destino)}`]:[]),`EQUIPAMENTO: ${equipamento}`].map(value=>textoPdf(value.toUpperCase()));
  pdf.setFont('helvetica','bold');pdf.setFontSize(26);
  const titleFont=Math.min(26,26*(width-margin*2)/pdf.getTextWidth(title));
  let font=20,lines:string[][]=[],lineHeight=10,contentHeight=0;
  for(;font>=10;font--){
    pdf.setFontSize(font);lines=fields.map(value=>pdf.splitTextToSize(value,width-margin*2));lineHeight=font/2;
    contentHeight=22+lines.reduce((sum,field)=>sum+field.length,0)*lineHeight+lines.length*6;
    if(contentHeight<=height/2-margin*2)break;
  }
  if(font<10)throw Error('Dados longos demais para a placa de identificação. Resuma a descrição do equipamento.');
  for(const top of [0,height/2]){
    let y=top+(height/2-contentHeight)/2+12;
    pdf.setFontSize(titleFont);pdf.text(title,width/2,y,{align:'center'});y+=10;pdf.setFontSize(font);
    for(const field of lines){for(const line of field){y+=lineHeight;pdf.text(line,width/2,y,{align:'center'});}y+=6;}
  }
  pdf.setDrawColor(150);pdf.setLineWidth(.3);pdf.line(margin,height/2,width-margin,height/2);
  pdf.setProperties({title:`Placa de identificação - ${card.numeroOrcamento||card.cliente}`,author:'Branorte'});
  return pdf;
}
