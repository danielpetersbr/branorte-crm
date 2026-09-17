import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export interface JanelaAcesso {
  id: number
  user_id: string
  dias: number[]        // isodow: 1=seg .. 7=dom
  hora_inicio: string
  hora_fim: string
  fuso: string
  rota_prefixo: string | null
  ativo: boolean
  criado_em: string
}

export interface AcessoEvento {
  id: number
  user_id: string
  email: string | null
  rota: string
  ip: string | null
  cidade: string | null
  uf: string | null
  pais: string | null
  user_agent: string | null
  plataforma: string | null
  bloqueado: boolean
  at: string
  lat: number | null
  lon: number | null
  precisao_m: number | null
  geo_estado: string | null
}

export interface EstadoBloqueio {
  bloqueado: boolean
  janela: { dias: number[]; hora_inicio: string; hora_fim: string } | null
}

/**
 * Registra cada página aberta e diz se o usuário está dentro da janela dele.
 *
 * ⚠️ FAIL-OPEN de propósito: erro de rede, endpoint fora do ar ou resposta
 * estranha => libera. Quem barra o DADO de verdade é a RLS no Postgres; esta
 * chamada existe pra registrar a passagem e dar uma tela decente a quem está
 * fora de hora, não pra ser a fechadura.
 */
export function useTrilhaAcesso(geo?: {
  estado: string
  coords: { lat: number; lon: number; precisao_m: number | null } | null
}): EstadoBloqueio {
  const loc = useLocation()
  const { session, profile } = useAuth()
  const [estado, setEstado] = useState<EstadoBloqueio>({ bloqueado: false, janela: null })
  // Evita reenviar a mesma rota em sequência (StrictMode, re-render, querystring).
  const ultima = useRef<{ rota: string; em: number } | null>(null)

  const token = session?.access_token
  const rota = loc.pathname
  const pronto = !!token && !!profile?.approved_at
  // Entra na dependência como string pra não redisparar a cada render por
  // identidade de objeto — só quando a coordenada muda de verdade.
  const geoChave = geo?.coords ? `${geo.coords.lat},${geo.coords.lon}` : geo?.estado ?? ''

  useEffect(() => {
    if (!pronto) return
    const agora = Date.now()
    if (ultima.current && ultima.current.rota === rota && agora - ultima.current.em < 10_000) return
    ultima.current = { rota, em: agora }

    let cancelado = false
    const plataforma = window.matchMedia('(max-width: 767px)').matches ? 'mobile' : 'desktop'

    fetch('/api/acesso', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({
        rota,
        plataforma,
        geo_estado: geo?.estado ?? null,
        lat: geo?.coords?.lat ?? null,
        lon: geo?.coords?.lon ?? null,
        precisao_m: geo?.coords?.precisao_m ?? null,
      }),
    })
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        if (cancelado || !j) return
        setEstado({ bloqueado: j.liberado === false, janela: j.janela ?? null })
      })
      .catch(() => {
        /* fail-open: silêncio */
      })

    return () => {
      cancelado = true
    }
  }, [rota, token, pronto, geoChave])

  return estado
}

// ============================================================
// Tela /admin/acessos
// ============================================================

export function useAcessoEventos(params: { dias: number; email?: string; rota?: string }) {
  return useQuery({
    queryKey: ['acesso_eventos', params],
    queryFn: async () => {
      const desde = new Date(Date.now() - params.dias * 86_400_000).toISOString()
      let q = supabase
        .from('acesso_eventos')
        .select('*')
        .gte('at', desde)
        .order('at', { ascending: false })
        .limit(1000)
      if (params.email) q = q.eq('email', params.email)
      if (params.rota) q = q.like('rota', `${params.rota}%`)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as AcessoEvento[]
    },
    staleTime: 30_000,
  })
}

/** Quem está online: último evento de cada pessoa nas últimas 24h. */
export function useQuemEstaOnline() {
  return useQuery({
    queryKey: ['acesso_online'],
    queryFn: async () => {
      const desde = new Date(Date.now() - 86_400_000).toISOString()
      const { data, error } = await supabase
        .from('acesso_eventos')
        .select('*')
        .gte('at', desde)
        .order('at', { ascending: false })
        .limit(1000)
      if (error) throw error
      const porUsuario = new Map<string, AcessoEvento>()
      for (const e of (data ?? []) as AcessoEvento[]) {
        if (!porUsuario.has(e.user_id)) porUsuario.set(e.user_id, e)
      }
      return [...porUsuario.values()]
    },
    refetchInterval: 60_000,
  })
}

export interface SessaoAtiva {
  session_id: string
  user_id: string
  email: string
  papel: string
  ip: string | null
  user_agent: string | null
  criada_em: string
  ultimo_uso: string
}

/**
 * Sessões vivas no Supabase Auth.
 *
 * ⚠️ Vem por RPC porque `auth.sessions` não é exposto pelo PostgREST. O guard
 * de admin está DENTRO da função (SECURITY DEFINER bypassa RLS).
 *
 * É aqui que se vê o problema estrutural: as sessões deste projeto não expiram
 * (`not_after` nulo), então elas se acumulam por meses — tirar o papel de
 * alguém NÃO o desconecta. Quem desconecta é o botão de derrubar.
 */
export function useSessoesAtivas() {
  return useQuery({
    queryKey: ['acesso_sessoes'],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('sessoes_ativas')
      if (error) throw error
      return (data ?? []) as SessaoAtiva[]
    },
    refetchInterval: 60_000,
  })
}

export function useDerrubarSessoes() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (userId: string) => {
      const { data, error } = await supabase.rpc('derrubar_sessoes', { p_user: userId })
      if (error) throw error
      return data as number
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['acesso_sessoes'] })
      qc.invalidateQueries({ queryKey: ['acesso_online'] })
    },
  })
}

export function useSalvarAcessoConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (c: {
      exigir_localizacao: boolean
      papeis_obrigatorios: string[]
      precisao_maxima_m: number | null
    }) => {
      const { error } = await supabase
        .from('acesso_config')
        .update({ ...c, atualizado_em: new Date().toISOString() })
        .eq('id', true)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acesso_config'] }),
  })
}

export function useJanelas() {
  return useQuery({
    queryKey: ['acesso_janelas'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('acesso_janelas')
        .select('*')
        .order('criado_em', { ascending: false })
      if (error) throw error
      return (data ?? []) as JanelaAcesso[]
    },
  })
}

export function useSalvarJanela() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (j: Partial<JanelaAcesso> & { user_id: string }) => {
      const payload = {
        user_id: j.user_id,
        dias: j.dias ?? [1, 2, 3, 4, 5],
        hora_inicio: j.hora_inicio ?? '07:30',
        hora_fim: j.hora_fim ?? '18:00',
        fuso: j.fuso ?? 'America/Cuiaba',
        rota_prefixo: j.rota_prefixo || null,
        ativo: j.ativo ?? true,
      }
      const { error } = j.id
        ? await supabase.from('acesso_janelas').update(payload).eq('id', j.id)
        : await supabase.from('acesso_janelas').insert(payload)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acesso_janelas'] }),
  })
}

export function useApagarJanela() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await supabase.from('acesso_janelas').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['acesso_janelas'] }),
  })
}
