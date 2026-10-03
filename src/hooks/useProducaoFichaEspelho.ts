import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {useCan} from './usePermissions';
import {supabase} from '@/lib/supabase';
import {autoridadeEspelhoValida,chaveConsultaEspelho,type AutoridadeEspelho} from '@/lib/producao-espelho-consulta';
import {consultarFichaEspelho,uuidFicha} from '@/lib/producao-ficha-consulta';
let instanceSequence=0;
const namespace='producao-espelho-ficha';

export function useProducaoFichaEspelho(cardId:string|null,parentIdentity:string,parentAuthorized:boolean){
  const {session,profile,loading,profileError}=useAuth(),can=useCan(),queryClient=useQueryClient();
  const [instance]=useState(()=>++instanceSequence),[,changed]=useState(0),active=useRef(true);
  const fields={userId:session?.user.id??null,profileId:profile?.id??null,role:profile?.role??null,vendorId:profile?.vendor_id??null,approvedAt:profile?.approved_at??null,menu:can('menu.producao_fabrica'),loading:loading||!parentAuthorized,profileError};
  const signature=JSON.stringify({fields,cardId,parentIdentity}),surfaceToken=session?.access_token??null;
  const observed=useRef({signature,surfaceToken,liveToken:surfaceToken,liveUserId:fields.userId,generation:0});
  const live=observed.current;
  if(live.signature!==signature||live.surfaceToken!==surfaceToken){live.generation++;live.signature=signature;if(live.surfaceToken!==surfaceToken){live.surfaceToken=surfaceToken;live.liveToken=surfaceToken;live.liveUserId=fields.userId;}}
  const authority:AutoridadeEspelho={...fields,generation:live.generation,loading:fields.loading||live.liveToken!==surfaceToken||live.liveUserId!==fields.userId};
  const authorityRef=useRef(authority);authorityRef.current=authority;
  const autorizado=uuidFicha(cardId)&&autoridadeEspelhoValida(authority),queryKey=[namespace,instance,parentIdentity,cardId,...chaveConsultaEspelho(authority)],identityKey=JSON.stringify(queryKey);
  const currentIdentity=useRef(identityKey);currentIdentity.current=identityKey;
  const getCurrentAuthority=()=>({...authorityRef.current,loading:authorityRef.current.loading||!active.current});
  const getSession=async()=>{const {data:{session:current},error}=await supabase.auth.getSession();if(error)throw error;return current;};
  const cleanup=()=>{
    const predicate=(q:{queryKey:readonly unknown[]})=>q.queryKey[0]===namespace&&q.queryKey[1]===instance&&(!active.current||!autoridadeEspelhoValida(getCurrentAuthority())||JSON.stringify(q.queryKey)!==currentIdentity.current);
    void queryClient.cancelQueries({predicate});queryClient.removeQueries({predicate});
  };
  useEffect(()=>{
    if(!active.current){observed.current.generation++;active.current=true;changed(n=>n+1);}
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{
      if(!active.current)return;const token=next?.access_token??null,userId=next?.user.id??null,current=observed.current;
      if(current.liveToken===token&&current.liveUserId===userId)return;
      current.liveToken=token;current.liveUserId=userId;current.generation++;authorityRef.current={...authorityRef.current,generation:current.generation,loading:true};cleanup();changed(n=>n+1);
    });
    return()=>{active.current=false;observed.current.generation++;authorityRef.current={...authorityRef.current,generation:observed.current.generation,loading:true};subscription.unsubscribe();cleanup();};
  },[instance,queryClient]);
  const query=useQuery({queryKey,enabled:autorizado,retry:false,staleTime:0,
    queryFn:({signal})=>consultarFichaEspelho({cardId:cardId!,producao:true,authority,signal,getCurrentAuthority,getCurrentToken:()=>observed.current.liveToken,getSession,fetch:(url,init)=>fetch(url,init)})});
  useEffect(()=>{cleanup();},[identityKey,autorizado,queryClient]);
  const atualizar=()=>{if(!active.current||!autorizado)return;observed.current.generation++;authorityRef.current={...authorityRef.current,generation:observed.current.generation};changed(n=>n+1);};
  const recursoContexto=()=>({cardId,authority,getCurrentAuthority,getCurrentToken:()=>observed.current.liveToken,getSession});
  return {...query,data:autorizado&&!query.isError?query.data:undefined,autorizado,identityKey,atualizar,recursoContexto};
}
