import {useEffect,useState} from 'react';
import DOMPurify from 'dompurify';
import {Download,Maximize2,Minimize2,Loader2} from 'lucide-react';
import type {ArquivoCarregadoFicha,PedidoRecursoFicha} from '../../lib/producao-ficha-recurso';
export type CarregarRecursoFicha=(recurso:PedidoRecursoFicha,signal:AbortSignal)=>Promise<ArquivoCarregadoFicha>;
export function baixarBlobFicha(arquivo:ArquivoCarregadoFicha){const url=URL.createObjectURL(arquivo.blob),a=document.createElement('a');a.href=url;a.download=arquivo.nome;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export function ProducaoEspelhoDocumento({carregar,cardId,validar}:{carregar:CarregarRecursoFicha;cardId:string;validar:()=>Promise<void>}){
  const [arquivo,setArquivo]=useState<ArquivoCarregadoFicha|null>(null),[html,setHtml]=useState(''),[erro,setErro]=useState(false),[grande,setGrande]=useState(false);
  useEffect(()=>{const controller=new AbortController();let active=true;setArquivo(null);setHtml('');setErro(false);
    (async()=>{try{
      const loaded=await carregar({tipo:'pedido'},controller.signal);if(!active)return;
      const mammoth=(await import('mammoth')).default;const {value}=await mammoth.convertToHtml({arrayBuffer:await loaded.blob.arrayBuffer()});if(!active||controller.signal.aborted)return;
      await validar();if(!active||controller.signal.aborted)return;
      const body=DOMPurify.sanitize(value,{ALLOWED_TAGS:['p','br','strong','em','b','i','u','s','h1','h2','h3','h4','h5','h6','ul','ol','li','table','thead','tbody','tr','th','td','span','div','hr'],ALLOWED_ATTR:['colspan','rowspan']});
      setArquivo(loaded);setHtml(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline';"><style>html,body{margin:0;background:white;color:#111;font:14px/1.6 Arial,sans-serif}body{padding:24px}table{border-collapse:collapse;width:100%;margin:12px 0}td,th{border:1px solid #ddd;padding:7px;vertical-align:top}p{margin:.5em 0}h1,h2,h3{line-height:1.3}strong{font-weight:700}</style></head><body>${body}</body></html>`);
    }catch{if(active&&!controller.signal.aborted)setErro(true);}})();
    return ()=>{active=false;controller.abort();};
  },[carregar,cardId,validar]);
  if(erro)return <p className="pf-ausente">Documento indisponível nesta leitura. <a href={`https://controledeproducao.mbranorte.com.br/producao?cardId=${encodeURIComponent(cardId)}`} target="_blank" rel="noopener noreferrer" className="pf-ver-mais">Ver no Controle de Produção</a></p>;
  if(!arquivo)return <p role="status" className="pf-arquivo-loading"><Loader2 size={16} className="animate-spin"/> Carregando o pedido…</p>;
  return <div className={grande?'pf-documento pf-documento-grande':'pf-documento'}><div className="pf-documento-toolbar"><div><strong>Pedido sem preços</strong><p>{arquivo.nome}</p></div><div><button type="button" className="pf-recurso-button" onClick={()=>setGrande(v=>!v)}>{grande?<Minimize2 size={14}/>:<Maximize2 size={14}/>} {grande?'Reduzir':'Tela cheia'}</button><button type="button" className="pf-recurso-button" onClick={async()=>{try{await validar();baixarBlobFicha(arquivo);}catch{setErro(true);}}}><Download size={14}/> Baixar</button></div></div><iframe title="Pedido sem preços" sandbox="" srcDoc={html} className="pf-documento-preview"/></div>;
}
