import {useCallback,useEffect,useRef,useState} from 'react';
import {Download,Eye,FileText,Loader2,Play} from 'lucide-react';
import {useProducaoFichaEspelho} from '../../hooks/useProducaoFichaEspelho';
import type {CardEspelho} from '../../lib/producao-espelho-consulta';
import type {ArquivoFichaEspelho} from '../../lib/producao-ficha-consulta';
import {consultarRecursoFicha,validarSessaoRecursoFicha,type ArquivoCarregadoFicha} from '../../lib/producao-ficha-recurso';
import {ProducaoEspelhoFicha,type RecursoProducaoFicha} from './ProducaoEspelhoFicha';
import {ProducaoEspelhoDocumento,baixarBlobFicha,type CarregarRecursoFicha} from './ProducaoEspelhoDocumento';

function Arquivo({arquivo,carregar,validar}:{arquivo:ArquivoFichaEspelho;carregar:CarregarRecursoFicha;validar:()=>Promise<void>}){
  const [state,setState]=useState<'pronto'|'carregando'|'erro'>('pronto'),[url,setUrl]=useState('');
  const controller=useRef<AbortController|null>(null),objectUrl=useRef(''),active=useRef(true);
  useEffect(()=>{active.current=true;return()=>{active.current=false;controller.current?.abort();if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);};},[]);
  const image=/^image\/(jpeg|png|webp)$/i.test(arquivo.mime??''),video=/^video\/(mp4|webm|quicktime)$/i.test(arquivo.mime??''),pdf=arquivo.mime==='application/pdf';
  const obter=async(preview:boolean)=>{controller.current?.abort();const attempt=new AbortController();controller.current=attempt;setState('carregando');
    try {const loaded=await carregar({tipo:arquivo.tipo,arquivoId:arquivo.id},attempt.signal);await validar();if(!active.current||attempt.signal.aborted)return;
      if(preview){if(objectUrl.current)URL.revokeObjectURL(objectUrl.current);objectUrl.current=URL.createObjectURL(loaded.blob);setUrl(objectUrl.current);}else baixarBlobFicha(loaded);setState('pronto');
    }catch{if(active.current&&!attempt.signal.aborted)setState('erro');}
  };
  return <article className="pf-arquivo"><div className="pf-arquivo-row"><FileText size={15} aria-hidden="true"/><span className="pf-arquivo-nome">{arquivo.nome}{arquivo.tamanho!==null&&<small>{(arquivo.tamanho/1024/1024).toLocaleString('pt-BR',{maximumFractionDigits:1})} MB</small>}</span>{(image||video||pdf)&&!url&&<button className="pf-recurso-button" type="button" disabled={state==='carregando'} onClick={()=>obter(true)}>{video?<Play size={13}/>:<Eye size={13}/>} {video?'Assistir':'Visualizar'}</button>}<button type="button" className="pf-recurso-button" disabled={state==='carregando'} onClick={()=>obter(false)}><Download size={13}/> Baixar</button></div>
    {state==='carregando'&&<p role="status" className="pf-arquivo-loading"><Loader2 size={14} className="animate-spin"/> Carregando arquivo…</p>}{state==='erro'&&<p role="alert" className="pf-ausente">Não foi possível carregar este arquivo. Tente novamente.</p>}
    {url&&image&&<img className="pf-arquivo-imagem" src={url} alt={arquivo.nome}/>} {url&&video&&<video className="pf-arquivo-video" src={url} controls preload="metadata"/>}{url&&pdf&&<iframe title={arquivo.nome} className="pf-documento-preview" sandbox="" src={url}/>}
  </article>;
}
function Arquivos({arquivos,carregar,validar,vazio}:{arquivos:readonly ArquivoFichaEspelho[];carregar:CarregarRecursoFicha;validar:()=>Promise<void>;vazio:string}){return arquivos.length?<div className="pf-arquivos">{arquivos.map(file=><Arquivo key={file.id} arquivo={file} carregar={carregar} validar={validar}/>)}</div>:<p className="pf-ausente">{vazio}</p>;}
export function ProducaoEspelhoFichaConectada({card,close,context,autorizado}:{card:CardEspelho;close:()=>void;context:string;autorizado:boolean}){
  const query=useProducaoFichaEspelho(card.id,context,autorizado),[gerando,setGerando]=useState(''),[erroGeracao,setErroGeracao]=useState(false);
  const active=useRef(true);useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  const carregar=useCallback<CarregarRecursoFicha>((recurso,signal)=>{const deps=query.recursoContexto();if(!deps.cardId)return Promise.reject(Error('Sessão alterada.'));return consultarRecursoFicha({...deps,cardId:deps.cardId,signal,recurso,fetch:(url,init)=>fetch(url,init)});},[query.identityKey]);
  const validar=useCallback(()=>validarSessaoRecursoFicha(query.recursoContexto()),[query.identityKey]);
  const gerar=async(tipo:'placa'|'ordem')=>{setGerando(tipo);setErroGeracao(false);const deps=query.recursoContexto();
    try {await validarSessaoRecursoFicha(deps);const docs=await import('../../lib/producao-ficha-documentos');await validarSessaoRecursoFicha(deps);if(!active.current)return;
      const currentCard={...card,dadosOriginais:{...card.dadosOriginais,projeto:query.data?query.data.projeto:card.dadosOriginais.projeto}};
      const pdf=tipo==='placa'?docs.gerarPlacaIdentificacaoPdf(currentCard):docs.gerarOrdemProducaoPdf(docs.montarOrdemProducao(currentCard,query.data?.bom??[]));
      await validarSessaoRecursoFicha(deps);if(!active.current)return;pdf.save(docs.nomeDocumentoProducao(tipo,card.numeroOrcamento??card.id));
    }catch{if(active.current)setErroGeracao(true);}finally{if(active.current)setGerando('');}
  };
  const render=(tipo:RecursoProducaoFicha)=>{
    const data=query.data;if(!data)return null;
    if(tipo==='documento')return data.documento.disponivel?<ProducaoEspelhoDocumento carregar={carregar} cardId={card.id} validar={validar}/>:<p className="pf-ausente">Documento sem preços não disponível nesta leitura. <a className="pf-ver-mais" href={`https://controledeproducao.mbranorte.com.br/producao?cardId=${encodeURIComponent(card.id)}`} target="_blank" rel="noopener noreferrer">Ver no Controle de Produção</a></p>;
    if(tipo==='placa'||tipo==='ordem-producao'){const op=tipo==='ordem-producao';return <div><button type="button" className="pf-recurso-button" disabled={!!gerando} onClick={()=>gerar(op?'ordem':'placa')}>{gerando===(op?'ordem':'placa')?<Loader2 size={14} className="animate-spin"/>:<Download size={14}/>} {op?'Baixar ordem de produção (PDF)':'Baixar placa de identificação'}</button>{erroGeracao&&<p role="alert" className="pf-ausente">Não foi possível gerar o documento. Tente novamente.</p>}</div>;}
    const files=data.anexos.filter(f=>f.tipo===(tipo==='video'?'video':tipo==='fotos'?'foto':'anexo'));
    return <Arquivos arquivos={files} carregar={carregar} validar={validar} vazio={tipo==='video'?'Nenhum vídeo enviado.':tipo==='fotos'?'Nenhuma foto enviada.':'Nenhum arquivo anexado.'}/>;
  };
  if(!query.autorizado)return null;
  return <ProducaoEspelhoFicha key={query.identityKey} card={card} close={close} detalhes={query.data} carregando={query.isPending} erro={query.isError} renderRecurso={render} renderComentarioAnexos={id=><Arquivos arquivos={query.data?.comentarios.find(c=>c.id===id)?.anexos??[]} carregar={carregar} validar={validar} vazio=""/>}/>;
}
