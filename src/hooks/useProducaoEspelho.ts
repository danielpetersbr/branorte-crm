import {useEffect,useRef,useState} from 'react';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from './useAuth';
import {useCan} from './usePermissions';
import {supabase} from '@/lib/supabase';
import {autoridadeEspelhoValida,chaveConsultaEspelho,criarCicloEspelho,consultaEspelhoRemovivel,consultarEspelho,dadosEspelhoVisiveis,type AutoridadeEspelho} from '@/lib/producao-espelho-consulta';

export function useProducaoEspelho() {
  const {session,profile,loading,profileError}=useAuth(),can=useCan(),queryClient=useQueryClient();
  const [,changed]=useState(0),[cycle]=useState(criarCicloEspelho);
  const fields={userId:session?.user.id??null,profileId:profile?.id??null,role:profile?.role??null,vendorId:profile?.vendor_id??null,approvedAt:profile?.approved_at??null,menu:can('menu.producao_fabrica'),loading,profileError};
  const signature=JSON.stringify(fields),surfaceToken=session?.access_token??null;
  const observed=useRef({signature,surfaceToken,liveToken:surfaceToken,liveUserId:fields.userId,generation:cycle.geracao});
  const current=observed.current;
  if(current.signature!==signature||current.surfaceToken!==surfaceToken) {
    current.generation=cycle.avancar();current.signature=signature;
    if(current.surfaceToken!==surfaceToken){current.surfaceToken=surfaceToken;current.liveToken=surfaceToken;current.liveUserId=fields.userId;}
  }
  const authority:AutoridadeEspelho={...fields,loading:loading||current.liveToken!==surfaceToken||current.liveUserId!==fields.userId,generation:current.generation};
  const authorityRef=useRef(authority);authorityRef.current=authority;
  const autorizado=autoridadeEspelhoValida(authority),queryKey=chaveConsultaEspelho(authority),identityKey=JSON.stringify(queryKey),failedIdentity=useRef<string|null>(null);
  const cleanup=(failed?:string)=>{
    const predicate=(q:{queryKey:readonly unknown[]})=>consultaEspelhoRemovivel(cycle,q.queryKey,authorityRef.current,failed);
    void queryClient.cancelQueries({predicate});queryClient.removeQueries({predicate});
  };
  useEffect(()=>{
    let active=true;
    if(!cycle.ativo){observed.current.generation=cycle.avancar();authorityRef.current={...authorityRef.current,generation:cycle.geracao,loading:true};changed(n=>n+1);}
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,next)=>{
      if(!active||!cycle.ativo)return;
      const token=next?.access_token??null,userId=next?.user.id??null,live=observed.current;
      if(live.liveToken===token&&live.liveUserId===userId)return;
      live.liveToken=token;live.liveUserId=userId;live.generation=cycle.avancar();
      authorityRef.current={...authorityRef.current,generation:live.generation,loading:true};cleanup();changed(n=>n+1);
    });
    return ()=>{active=false;cycle.encerrar();authorityRef.current={...authorityRef.current,loading:true};subscription.unsubscribe();cleanup();};
  },[cycle,queryClient]);
  const query=useQuery({queryKey,enabled:autorizado&&failedIdentity.current!==identityKey,retry:false,staleTime:30000,
    queryFn:({signal})=>consultarEspelho({authority,signal,getCurrentAuthority:()=>({...authorityRef.current,loading:authorityRef.current.loading||!cycle.ativo}),getCurrentToken:()=>observed.current.liveToken,
      getSession:async()=>{const {data:{session:now},error}=await supabase.auth.getSession();if(error)throw error;return now;},fetch:(url,init)=>fetch(url,init)})});
  if(query.isError)failedIdentity.current=identityKey;
  const failed=query.isError||failedIdentity.current===identityKey;
  useEffect(()=>{cleanup();},[identityKey,autorizado,queryClient]);
  useEffect(()=>{if(query.isError)cleanup(identityKey);},[query.isError,identityKey,queryClient]);
  const atualizar=()=>{if(!cycle.ativo||!autoridadeEspelhoValida(authorityRef.current))return;failedIdentity.current=null;observed.current.generation=cycle.avancar();authorityRef.current={...authorityRef.current,generation:observed.current.generation};changed(n=>n+1);};
  return {...query,isError:failed,data:dadosEspelhoVisiveis(query.data,authority,failed),autorizado,identityKey,atualizar};
}
