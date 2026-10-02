import { useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { chatChange, chatRefresh } from '@/lib/chat-realtime'
import { ChatRpcError } from '@/lib/chat-rpc-error'
import type { ChatOrigin } from '@/lib/chat-origin'
import { chatQueueCursor, mergeHistoryPages, orderChatQueue, type ChatQueue } from '@/lib/chat-productivity'
import { CHAT_MEDIA_BUCKET, privateChatMediaPath, type ChatConversation, type ChatMessage, type ChatNote, type ChatOutbox } from '@/lib/atendimento-chat'

export async function chatRpc<T>(action:string,args:Record<string,unknown>={}):Promise<T> {
  const {data,error}=await supabase.rpc('crm_chat',{p_action:action,p_args:args})
  if(error) throw new ChatRpcError(error)
  return data as T
}
interface ChatList {items:ChatConversation[];tags:string[];ana_tags?:string[];connection:{last_sync:string;version:string;number_final:string}|null}
export interface ChatDetail {conversation:ChatConversation;contact:{city:string|null;state:string|null;empresa:string|null;email:string|null;status:string|null}|null;notes:ChatNote[];outbox:ChatOutbox[]}
export interface ChatSales {
  orders:{id:string;number:string;status:string|null;total:number|null;date:string|null;href:string|null}[];
  quotes:{id:number;number:string;year:number;status:string|null;date:string|null;href:string|null}[];
}
// Supabase reuses a same-topic channel until asynchronous removal completes.
let chatRealtimeCleanup:Promise<unknown>=Promise.resolve()

export function useAtendimentoChat(filters:{search:string;status:string;vendor:string;tag:string;ana_tag:string;queue:ChatQueue},selected:string|null,historySearch='') {
  const {profile}=useAuth()
  const qc=useQueryClient()
  const identity=[profile?.id,profile?.role,profile?.vendor_id]
  const base=['crm-chat',...identity]
  const session=useRef(crypto.randomUUID()).current
  const [leaseError,setLeaseError]=useState<string|null>(null)
  const enabled=!!profile?.approved_at && ['admin','vendor'].includes(profile.role)
  const [realtimeConnected,setRealtimeConnected]=useState(false)
  const [lastEventAt,setLastEventAt]=useState<number|null>(null)
  const selectedRef=useRef(selected);selectedRef.current=selected
  useEffect(()=>{
    setRealtimeConnected(false)
    if(!enabled)return
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined
    const pending=new Set<string>()
    const topics=[profile!.role==='admin'?'crm-chat:all':`crm-chat:vendor:${profile!.vendor_id}`,'crm-chat:catalog']
    const ready=new Set<string>()
    const channels:ReturnType<typeof supabase.channel>[]=[]
    void chatRealtimeCleanup.then(async()=>{
      await supabase.realtime.setAuth()
      if(stopped)return
      channels.push(...topics.map(topic=>supabase.channel(topic,{config:{private:true}}).on('broadcast',{event:'change'},({payload})=>{
      const change=chatChange(payload);if(stopped||!change)return
      setLastEventAt(Date.now())
      for(const key of chatRefresh(change,selectedRef.current))pending.add(key)
      if(!timer)timer=setTimeout(()=>{timer=undefined;for(const key of pending)void qc.invalidateQueries({queryKey:[...base,key]});pending.clear()},100)
      })))
      channels.forEach((channel,i)=>channel.subscribe(status=>{
        if(stopped)return
        if(status==='SUBSCRIBED'){ready.add(topics[i]);void qc.invalidateQueries({queryKey:base})}else ready.delete(topics[i])
        setRealtimeConnected(ready.size===topics.length)
      }))
    }).catch(()=>{if(!stopped)setRealtimeConnected(false)})
    return()=>{stopped=true;if(timer)clearTimeout(timer);chatRealtimeCleanup=Promise.all([chatRealtimeCleanup,...channels.map(c=>supabase.removeChannel(c))]).catch(()=>{})}
  },[enabled,profile?.id,profile?.role,profile?.vendor_id,qc])
  const list=useInfiniteQuery({
    queryKey:[...base,'list',filters],initialPageParam:null as {before:string;before_id:string}|null,enabled,
    queryFn:({pageParam})=>chatRpc<ChatList>('list',{...filters,...pageParam}),
    getNextPageParam:p=>chatQueueCursor(p.items,filters.queue),
    refetchInterval:realtimeConnected?60000:10000,
  })
  const detail=useQuery({queryKey:[...base,'detail',selected],enabled:enabled&&!!selected,
    queryFn:()=>chatRpc<ChatDetail>('detail',{id:selected}),refetchInterval:realtimeConnected?60000:4000,retry:1})
  const history=useInfiniteQuery({queryKey:[...base,'messages',selected],enabled:enabled&&!!selected,
    initialPageParam:null as {before:string;before_id:number}|null,
    queryFn:({pageParam})=>chatRpc<ChatMessage[]>('messages',{id:selected,...pageParam}),
    getNextPageParam:p=>p.length===50?{before:p[0].data_msg,before_id:p[0].id}:undefined,
    refetchInterval:realtimeConnected?60000:4000,retry:1,
  })
  // Separate pages and DOM: a search never becomes the normal history or marks results read.
  const historyResults=useInfiniteQuery({queryKey:[...base,'messages',selected,'search',historySearch.trim()],enabled:enabled&&!!selected&&!!historySearch.trim(),
    initialPageParam:null as {before:string;before_id:number}|null,
    queryFn:({pageParam})=>chatRpc<ChatMessage[]>('messages',{id:selected,search:historySearch.trim(),...pageParam}),
    getNextPageParam:p=>p.length===50?{before:p[0].data_msg,before_id:p[0].id}:undefined,retry:1,
  })
  const sales=useQuery({queryKey:[...base,'sales',selected],enabled:enabled&&!!selected,
    queryFn:()=>chatRpc<ChatSales>('sales',{id:selected}),staleTime:60000,retry:1})
  const origin=useQuery({queryKey:[...base,'origin',selected],enabled:enabled&&!!selected,
    queryFn:async()=>{const {data,error}=await supabase.rpc('crm_chat_origin',{p_conversation_id:selected});if(error)throw new ChatRpcError(error);return data as ChatOrigin},
    staleTime:60000,refetchInterval:60000,retry:1})
  const conversations=useMemo(()=>{
    const m=new Map<string,ChatConversation>();list.data?.pages.forEach(p=>p.items.forEach(c=>{if(!m.has(c.id))m.set(c.id,c)}));
    return orderChatQueue([...m.values()],filters.queue)
  },[list.data,filters.queue])
  const messages=useMemo(()=>mergeHistoryPages(history.data?.pages),[history.data])
  const searchMessages=useMemo(()=>mergeHistoryPages(historyResults.data?.pages,true),[historyResults.data])
  const conversation=detail.data?.conversation
  const ownsLease=!!conversation&&conversation.lock_user_id===profile?.id&&conversation.lock_session_id===session&&!!conversation.lock_until&&Date.parse(conversation.lock_until)>Date.now()&&!leaseError
  const action=useMutation({mutationFn:({name,id=selected,...args}:{name:string;id?:string|null;[key:string]:unknown})=>chatRpc(name,{id,session,...args}),
    onSuccess:()=>{setLeaseError(null);qc.invalidateQueries({queryKey:base})}})
  useEffect(()=>{setLeaseError(null)},[selected])
  useEffect(()=>{
    if(!selected||!ownsLease) return
    let stopped=false
    const heartbeat=setInterval(()=>{chatRpc('heartbeat',{id:selected,session}).catch(e=>{if(!stopped)setLeaseError(e.message)})},25000)
    return()=>{stopped=true;clearInterval(heartbeat)}
  },[selected,ownsLease,session])
  useEffect(()=>{
    if(!selected||!messages.length||history.isError||detail.isError) return
    chatRpc('read',{id:selected}).then(()=>qc.invalidateQueries({queryKey:[...base,'list']})).catch(()=>{})
  },[selected,messages[messages.length-1]?.msg_id,history.isError,detail.isError])
  // Release libera apenas a sessão atual; a IA permanece pausada até decisão explícita.
  useEffect(()=>()=>{if(selected) void chatRpc('release',{id:selected,session}).catch(()=>{})},[selected,session])
  return {list,detail,history,historyResults,searchMessages,sales,origin,conversations,messages,conversation,session,ownsLease,leaseError,action,profile,realtimeConnected,lastEventAt,
    invalidate:()=>qc.invalidateQueries({queryKey:base})}
}

export function useChatMedia(path:string|null) {
  const {profile}=useAuth()
  return useQuery({queryKey:['crm-chat-media',profile?.id,profile?.vendor_id,path],enabled:!!path,
    queryFn:async()=>{const {data,error}=await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrl(path!,300);if(error)throw error;return data.signedUrl},
    staleTime:120000,refetchInterval:240000,retry:1})
}

// One signing request for the visible history; every path still passes Storage's portfolio RLS.
export function useChatHistoryMedia(messages:ChatMessage[]) {
  const {profile}=useAuth()
  const paths=useMemo(()=>[...new Set(messages.map(m=>privateChatMediaPath(m.media_url)).filter((path):path is string=>!!path))].sort(),[messages])
  return useQuery({queryKey:['crm-chat-history-media',profile?.id,profile?.vendor_id,paths],
    enabled:!!profile?.approved_at&&paths.length>0,
    queryFn:async()=>{
      const {data,error}=await supabase.storage.from(CHAT_MEDIA_BUCKET).createSignedUrls(paths,300)
      if(error)throw error
      return Object.fromEntries((data??[]).filter(item=>item.path&&!item.error&&item.signedUrl).map(item=>[item.path!,item.signedUrl])) as Record<string,string>
    },staleTime:120000,refetchInterval:240000,retry:1})
}
