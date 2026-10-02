import JSZip from 'jszip';
import {scrubDocxPrices} from './scrubDocxPrices.js';
const indisponivel=():never=>{throw Error('arquivo_indisponivel');};
function textoXmlSeguro(xml:string){
  const entities:Record<string,string>={amp:'&',lt:'<',gt:'>',quot:'"',apos:"'"};
  return xml.replace(/(<w:t(?:\s[^>]*)?>)([^<]*)(<\/w:t>)/g,(_all,open:string,text:string,close:string)=>{
    const decoded=text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi,(_m,k:string)=>{
      if(!k.startsWith('#'))return entities[k.toLowerCase()];const cp=parseInt(k.slice(k[1].toLowerCase()==='x'?2:1),k[1].toLowerCase()==='x'?16:10);
      if(!Number.isInteger(cp)||cp<1||cp>0x10ffff||cp>=0xd800&&cp<=0xdfff)return indisponivel();return String.fromCodePoint(cp);
    });
    return open+decoded.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+close;
  });
}

/** Source paths remain server side; no caller-provided URL or bucket is accepted. */
export function caminhoArquivoPrivado(bucket:string,raw:unknown):string {
  if(!['producao','card-attachments','comentarios-anexos'].includes(bucket)||typeof raw!=='string'||!raw||raw.length>1024||/[\\%?#:\u0000-\u001f\u007f]/.test(raw))return indisponivel();
  const path=raw.startsWith(bucket+'/')?raw.slice(bucket.length+1):raw;
  if(path.split('/').some(part=>!part||part==='.'||part==='..'))return indisponivel();
  return path;
}
export function caminhoPedidoTratado(raw:unknown):string {
  const path=caminhoArquivoPrivado('producao',raw);
  if(!/^[^/]+\/[^/]+\/[^/]+\.docx$/i.test(path)||/original/i.test(path.substring(path.lastIndexOf('/')+1)))return indisponivel();
  return path;
}
export async function lerCorpoLimitado(response:Response,limit:number):Promise<Buffer> {
  if(!Number.isSafeInteger(limit)||limit<1||!response.body)return indisponivel();
  const length=response.headers.get('Content-Length');
  if(length!==null&&(!/^\d+$/.test(length)||Number(length)>limit))return indisponivel();
  const reader=response.body.getReader(),chunks:Uint8Array[]=[];let size=0;
  try {for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit)return indisponivel();chunks.push(value);}return Buffer.concat(chunks,size);}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}

/** Re-scrub an in-memory copy: the original production object is never modified. */
export async function limparPedidoProducao(input:Buffer):Promise<Buffer> {
  if(!Buffer.isBuffer(input)||!input.length||input.length>15*1024*1024)return indisponivel();
  // CRC validation would inflate all members before limits can run.
  const zip=await JSZip.loadAsync(input,{checkCRC32:false}),names=Object.keys(zip.files);
  if(names.length>500||!zip.file('word/document.xml'))return indisponivel();
  let declaredTotal=0,expanded=0;
  for(const name of names){
    const entry=zip.files[name] as JSZip.JSZipObject & {_data?:{uncompressedSize?:number};unsafeOriginalName?:string};if(entry.dir)continue;
    const size=entry._data?.uncompressedSize;declaredTotal+=size??Infinity;
    if(typeof size!=='number'||!Number.isSafeInteger(size)||size<0||size>15*1024*1024||declaredTotal>40*1024*1024||entry.unsafeOriginalName!==undefined&&entry.unsafeOriginalName!==name)return indisponivel();
  }
  for(const name of names){
    const entry=zip.files[name];if(entry.dir)continue;
    if(!/^(?:\[Content_Types\]\.xml|_rels\/\.rels|word\/(?:document|styles|numbering|settings|fontTable|webSettings|header\d*|footer\d*|footnotes|endnotes)\.xml|word\/_rels\/[^/]+\.rels)$/.test(name)){zip.remove(name);continue;}
    const part=await new Promise<Buffer>((resolve,reject)=>{
      const helper=entry.nodeStream('nodebuffer'),chunks:Uint8Array[]=[];let bytes=0,settled=false;
      helper.on('data',(chunk:Uint8Array)=>{if(settled)return;bytes+=chunk.byteLength;expanded+=chunk.byteLength;if(bytes>15*1024*1024||expanded>40*1024*1024){settled=true;helper.pause();reject(Error('arquivo_indisponivel'));return;}chunks.push(chunk);});
      helper.on('error',reject);helper.on('end',()=>{if(!settled){settled=true;resolve(Buffer.concat(chunks,bytes));}});helper.resume();
    });
    let xml=Buffer.from(part).toString('utf8');
    if(/<!DOCTYPE|<!ENTITY/i.test(xml))return indisponivel();
    if(name.endsWith('.rels')) xml=xml.replace(/<Relationship\b[^>]*(?:\/>|>[\s\S]*?<\/Relationship>)/g,tag=>/TargetMode\s*=\s*["']External["']/i.test(tag)||/Target\s*=\s*["'][^"']*(?:media\/|embeddings\/|\.bin\b)/i.test(tag)?'':tag);
    if(name.endsWith('.xml'))xml=textoXmlSeguro(xml).replace(/<w:(?:object|del|delText|instrText)\b[\s\S]*?<\/w:(?:object|del|delText|instrText)>/g,'').replace(/<w:altChunk\b[^>]*(?:\/>|>[\s\S]*?<\/w:altChunk>)/g,'');
    zip.file(name,xml);
  }
  const copy=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE'}),result=await scrubDocxPrices(copy);
  if(result.leaks.length||result.out.length>3*1024*1024)return indisponivel();
  return result.out;
}
