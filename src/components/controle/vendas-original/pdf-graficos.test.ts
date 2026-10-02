import assert from 'node:assert/strict';
import {test} from 'node:test';
import {capturaMapaPDF, dadosConversaoOrigemPDF, escalaBarrasPDF, evolucaoAnualPDFPronta, exigirEvolucaoAnualPDF, segmentoBarraPDF} from './pdf-graficos';

const pronta = {carregando:false, erro:null, contexto:'dono|vendedor', contextoConsulta:'dono|vendedor'};

test('anual só pode ser exportado depois de receber o contexto vigente sem loading/erro', () => {
  assert.equal(evolucaoAnualPDFPronta(pronta),true);
  assert.doesNotThrow(()=>exigirEvolucaoAnualPDF(pronta));
  for(const patch of [{carregando:true},{erro:'Falha na origem'},{contextoConsulta:''},{contextoConsulta:'dono anterior|vendedor'},{contexto:''},{contexto:'outro vendedor'}]) {
    const estado={...pronta,...patch};
    assert.equal(evolucaoAnualPDFPronta(estado),false);
    assert.throws(()=>exigirEvolucaoAnualPDF(estado),/evolução anual.*disponível/i);
  }
});

test('escala de ajustes -50, zero e venda100 mantém eixo zero e barras dentro da área',()=>{
  const escala=escalaBarrasPDF([-50,0,100]);
  assert.equal(escala.minimo,-50);assert.equal(escala.maximo,100);
  assert.equal(escala.zero,1/3);
  assert.equal(escala.posicao(-50),0);assert.equal(escala.posicao(100),1);
  const negativa=segmentoBarraPDF(-50,escala),zero=segmentoBarraPDF(0,escala),positiva=segmentoBarraPDF(100,escala);
  assert.deepEqual(negativa,{inicio:0,comprimento:1/3});
  assert.deepEqual(zero,{inicio:1/3,comprimento:0});
  assert.equal(positiva.inicio,1/3);assert.equal(positiva.inicio+positiva.comprimento,1);
  for(const segmento of [negativa,zero,positiva]) {
    assert.ok(segmento.inicio>=0);assert.ok(segmento.comprimento>=0);
    assert.ok(segmento.inicio+segmento.comprimento<=1);
    // Conversão vertical: nenhuma barra invade abaixo ou acima da área útil.
    const top=41+(1-segmento.inicio-segmento.comprimento)*46;
    const bottom=top+segmento.comprimento*46;
    assert.ok(top>=41&&bottom<=87);
  }
});

test('escala toda negativa usa zero à direita e nunca inventa barra positiva para média zero',()=>{
  const negativa=escalaBarrasPDF([-50]);
  assert.equal(negativa.zero,1);
  assert.deepEqual(segmentoBarraPDF(-50,negativa),{inicio:0,comprimento:1});
  for(const valores of [[],[0],[0,0]]) {
    const escala=escalaBarrasPDF(valores);
    assert.equal(escala.zero,0);
    assert.deepEqual(segmentoBarraPDF(0,escala),{inicio:0,comprimento:0});
  }
  const positiva=escalaBarrasPDF([0,100]);
  assert.deepEqual(segmentoBarraPDF(100,positiva),{inicio:0,comprimento:1});
});

test('valores não finitos e valores fora do domínio não viram zeros ou barras inventadas',()=>{
  for(const valor of [NaN,Infinity,-Infinity])assert.throws(()=>escalaBarrasPDF([valor]),/valor.*inválido/i);
  const escala=escalaBarrasPDF([-50,100]);
  for(const valor of [NaN,Infinity,-51,101])assert.throws(()=>segmentoBarraPDF(valor,escala),/valor.*inválido/i);
});

test('conversão PDF usa origem/mediaDias exatamente, sem o dataset por vendedor ou corte em oito',()=>{
  const origens=Object.freeze(Array.from({length:9},(_,i)=>Object.freeze({origem:`Canal de origem com nome completo ${i+1}`,mediaDias:i===0?0:8.5+i,quantidade:2,vendedor:'não é a série'})));
  const dados=dadosConversaoOrigemPDF(origens);
  assert.equal(dados.length,9);
  assert.deepEqual(dados[0],{label:origens[0].origem,valor:0,sufixo:' dias'});
  assert.deepEqual(dados[8],{label:origens[8].origem,valor:16.5,sufixo:' dias'});
  assert.ok(dados.every(d=>!('vendedor' in d)&&!('quantidade' in d)));
  assert.deepEqual(dadosConversaoOrigemPDF([]),[]);
});

test('falha síncrona/assíncrona na captura mapa aborta exportação com mensagem fixa, sem partial success',async()=>{
  const resultado={canvas:'synthetic',imgData:'synthetic'};
  assert.equal(await capturaMapaPDF(async()=>resultado),resultado);
  for(const capture of [()=>{throw Error('PRIVATE URL TOKEN');},async()=>{throw Error('PRIVATE URL TOKEN');}]) {
    let salvo=false;
    await assert.rejects(async()=>{await capturaMapaPDF(capture);salvo=true;},error=>{
      assert.ok(error instanceof Error);assert.match(error.message,/capturar.*mapa/i);
      assert.equal(error.message.includes('PRIVATE'),false);return true;
    });
    assert.equal(salvo,false);
  }
});
