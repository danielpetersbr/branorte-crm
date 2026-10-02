import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { caminhoPedidoTratado, caminhoArquivoPrivado, limparPedidoProducao, lerCorpoLimitado } from '../../api/_lib/producao-ficha-arquivo.js';

test('document uses only the known treated DOCX, rejects original, URLs and traversal',()=>{
  assert.equal(caminhoPedidoTratado('producao/em_projeto/order-123/ORCAMENTO_TRATADO.docx'), 'em_projeto/order-123/ORCAMENTO_TRATADO.docx');
  assert.equal(caminhoPedidoTratado('em_projeto/order-123/2026-SEM PREÇO-BRANORTE.docx'),'em_projeto/order-123/2026-SEM PREÇO-BRANORTE.docx');
  for(const path of ['https://example.test/file.docx','em_projeto/x/ORCAMENTO_ORIGINAL.docx','em_projeto/x/ORCAMENTO_TRATADO.pdf','em_projeto/x/../ORCAMENTO_TRATADO.docx','em_projeto/x/%2e%2e/ORCAMENTO_TRATADO.docx','producao//x/ORCAMENTO_TRATADO.docx','em_projeto/x\\ORCAMENTO_TRATADO.docx']) assert.throws(()=>caminhoPedidoTratado(path));
});
test('private file path is inert and cannot escape its bucket',()=>{
  assert.equal(caminhoArquivoPrivado('card-attachments','card-id/a foto.png'),'card-id/a foto.png');
  for(const path of ['https://example.test/x','//host/x','../x','a/./x','a/%2fx','a\\x','a?token=x','a#x','a\nX']) assert.throws(()=>caminhoArquivoPrivado('card-attachments',path));
});
async function docx(xml:string, extra:Record<string,string>={}){const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('word/document.xml',xml);for(const [k,v] of Object.entries(extra))zip.file(k,v);return zip.generateAsync({type:'nodebuffer'});}
test('copy removes split money, active external relationships and opaque embeds; source stays unchanged',async()=>{
  const xml='<w:document><w:body><w:p><w:r><w:t>Misturador 1000 kg</w:t></w:r></w:p><w:p><w:r><w:t>R</w:t></w:r><w:r><w:t>$ 12.345,67</w:t></w:r></w:p></w:body></w:document>';
  const input=await docx(xml,{'word/_rels/document.xml.rels':'<Relationships><Relationship Id="evil" TargetMode="External" Target="https://example.test/track"/><Relationship Id="styles" Target="styles.xml"/></Relationships>','word/embeddings/ole.bin':'SECRET','customXml/item.xml':'SECRET','docProps/core.xml':'PRIVATE'}),before=Buffer.from(input);
  const clean=await limparPedidoProducao(input),zip=await JSZip.loadAsync(clean),out=await zip.file('word/document.xml')!.async('string');
  assert.match(out,/Misturador 1000 kg/);assert.ok(!out.includes('12.345'));assert.deepEqual(input,before);
  assert.equal(zip.file('word/embeddings/ole.bin'),null);assert.equal(zip.file('customXml/item.xml'),null);assert.equal(zip.file('docProps/core.xml'),null);
  assert.ok(!(await zip.file('word/_rels/document.xml.rels')!.async('string')).includes('https://'));
});
test('unknown monetary residual and malformed or excessive archives fail closed',async()=>{
  await assert.rejects(limparPedidoProducao(await docx('<w:document><w:p><w:r><w:t>VALOR: 1500,00</w:t></w:r></w:p></w:document>')));
  await assert.rejects(limparPedidoProducao(Buffer.from('not a DOCX')));
  const tooLarge=await docx('<w:document>'+ 'x'.repeat(16*1024*1024)+'</w:document>');await assert.rejects(limparPedidoProducao(tooLarge));
});
test('encoded currency and tracked deleted prices cannot remain in the downloadable copy',async()=>{
  const input=await docx('<w:document><w:p><w:r><w:t>R&#x24; 987,65</w:t></w:r></w:p><w:del><w:r><w:delText>R$ 98.765,43</w:delText></w:r></w:del><w:p><w:r><w:t>Tanque &amp; motor</w:t></w:r></w:p></w:document>');
  const zip=await JSZip.loadAsync(await limparPedidoProducao(input)),out=await zip.file('word/document.xml')!.async('string');assert.ok(!out.includes('987'));assert.ok(!out.includes('765'));assert.match(out,/Tanque &amp; motor/);
});
test('stream reading stops at the budget and never returns an oversized body',async()=>{
  assert.deepEqual(await lerCorpoLimitado(new Response(new Uint8Array([1,2,3])),3),Buffer.from([1,2,3]));
  await assert.rejects(lerCorpoLimitado(new Response(new Uint8Array([1,2,3,4])),3));
});
