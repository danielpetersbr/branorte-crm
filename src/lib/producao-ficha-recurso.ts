import {autoridadeEspelhoValida,chaveConsultaEspelho,type AutoridadeEspelho} from './producao-espelho-consulta';
import {uuidFicha} from './producao-ficha-consulta';
export type PedidoRecursoFicha={tipo:'pedido'|'anexo'|'video'|'foto'|'comentario';arquivoId?:string};
export type ArquivoCarregadoFicha={blob:Blob;nome:string};
export type DepsRecursoFicha={cardId:string;authority:AutoridadeEspelho;signal:AbortSignal;getCurrentAuthority:()=>AutoridadeEspelho;getCurrentToken:()=>string|null;getSession:()=>Promise<{user:{id:string};access_token:string}|null>;fetch:(url:string,init:RequestInit)=>Promise<Response>;recurso:PedidoRecursoFicha;onProgress?:(percent:number)=>void};
const CHUNK=3*1024*1024,MAX=80*1024*1024;
const unavailable=():never=>{throw Error('Arquivo indisponível. Tente novamente.');};
export async function validarSessaoRecursoFicha(d:Pick<DepsRecursoFicha,'authority'|'getCurrentAuthority'|'getCurrentToken'|'getSession'>):Promise<void>{
  const signature=JSON.stringify(chaveConsultaEspelho(d.authority)),token=d.getCurrentToken();
  const check=()=>{const now=d.getCurrentAuthority();if(!token||d.getCurrentToken()!==token||!autoridadeEspelhoValida(d.authority)||!autoridadeEspelhoValida(now)||signature!==JSON.stringify(chaveConsultaEspelho(now)))throw Error('Sessão alterada. Abra o card novamente.');};
  check();const session=await d.getSession();check();if(!session||session.user.id!==d.authority.userId||session.access_token!==token)throw Error('Sessão alterada. Abra o card novamente.');
}
/** Each bounded chunk is authenticated; the browser never receives a source key or signed URL. */
export async function consultarRecursoFicha(d:DepsRecursoFicha):Promise<ArquivoCarregadoFicha> {
  const signature=JSON.stringify(chaveConsultaEspelho(d.authority)),token=d.getCurrentToken();
  const check=()=>{const now=d.getCurrentAuthority();if(d.signal.aborted||!uuidFicha(d.cardId)||!token||d.getCurrentToken()!==token||!autoridadeEspelhoValida(d.authority)||!autoridadeEspelhoValida(now)||signature!==JSON.stringify(chaveConsultaEspelho(now)))throw Error('Sessão alterada. Abra o card novamente.');};
  const sessionCheck=async()=>{check();const session=await d.getSession();check();if(!session||session.user.id!==d.authority.userId||session.access_token!==token)throw Error('Sessão alterada. Abra o card novamente.');};
  try{
    check();if(!['pedido','anexo','video','foto','comentario'].includes(d.recurso.tipo)||(d.recurso.tipo==='pedido'?d.recurso.arquivoId!==undefined:!uuidFicha(d.recurso.arquivoId)))return unavailable();
    let total=0,offset=0,mime='',name='',version='';const chunks:ArrayBuffer[]=[];
    do{
      await sessionCheck();const query=new URLSearchParams({cardId:d.cardId,tipo:d.recurso.tipo});if(d.recurso.arquivoId)query.set('arquivoId',d.recurso.arquivoId);if(offset)query.set('inicio',String(offset));
      const response=await d.fetch('/api/controle-producao-arquivo?'+query.toString(),{method:'GET',headers:{Authorization:'Bearer '+token},signal:d.signal,cache:'no-store'});check();if(!response.ok)return unavailable();
      const incomingTotal=response.headers.get('X-Arquivo-Total'),incomingOffset=response.headers.get('X-Arquivo-Inicio'),incomingVersion=response.headers.get('X-Arquivo-Versao')??'',incomingMime=response.headers.get('Content-Type')??'application/octet-stream';
      const disposition=response.headers.get('Content-Disposition')??'',filename=/filename\*=UTF-8''([^;]+)/i.exec(disposition)?.[1];const incomingName=filename?decodeURIComponent(filename):'Arquivo';
      if(!incomingTotal||!/^\d+$/.test(incomingTotal)||Number(incomingTotal)<=0||Number(incomingTotal)>MAX||incomingOffset!==String(offset)||incomingName.length>256||/[\\/\u0000-\u001f\u007f]/.test(incomingName))return unavailable();
      if(!offset){total=Number(incomingTotal);mime=incomingMime;name=incomingName;version=incomingVersion;}else if(total!==Number(incomingTotal)||mime!==incomingMime||name!==incomingName||version!==incomingVersion)return unavailable();
      if(total>CHUNK&&!version)return unavailable();
      const bytes=await response.arrayBuffer();check();if(bytes.byteLength!==Math.min(CHUNK,total-offset))return unavailable();chunks.push(bytes);offset+=bytes.byteLength;
      await sessionCheck();d.onProgress?.(Math.round(offset/total*100));
    }while(offset<total);
    check();return {blob:new Blob(chunks,{type:mime}),nome:name};
  }catch(error){check();if(error instanceof Error&&error.message==='Arquivo indisponível. Tente novamente.')throw error;return unavailable();}
}
