import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'

export type EstadoGeo = 'checando' | 'granted' | 'denied' | 'prompt' | 'indisponivel' | 'erro'

export interface Coordenadas {
  lat: number
  lon: number
  precisao_m: number | null
}

export interface EstadoLocalizacao {
  exigida: boolean
  estado: EstadoGeo
  coords: Coordenadas | null
  /** dispara o popup do navegador (só funciona a partir de um clique do usuário) */
  pedir: () => void
}

export interface AcessoConfig {
  exigir_localizacao: boolean
  papeis_obrigatorios: string[]
}

export function useAcessoConfig() {
  return useQuery({
    queryKey: ['acesso_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('acesso_config')
        .select('exigir_localizacao,papeis_obrigatorios')
        .maybeSingle()
      if (error) throw error
      return (data ?? { exigir_localizacao: false, papeis_obrigatorios: [] }) as AcessoConfig
    },
    staleTime: 5 * 60_000,
  })
}

/**
 * Gate de geolocalização.
 *
 * ⚠️ NÃO existe captura silenciosa: `navigator.geolocation` sempre mostra o popup
 * do navegador, e o popup só aparece a partir de um gesto do usuário. Por isso
 * o fluxo é: tela explicando → botão → popup → coordenadas.
 *
 * ⚠️ "denied" é PEGAJOSO: uma vez negado, o navegador não pergunta de novo. A
 * pessoa tem que ir no cadeado da barra de endereço e reverter na mão — a tela
 * de bloqueio precisa ensinar isso, senão vira chamado de suporte.
 *
 * FAIL-OPEN quando o recurso não existe (navegador velho, contexto sem HTTPS):
 * `indisponivel` não tranca ninguém — o que se quer é registrar quem PODE ser
 * registrado, não impedir a pessoa de trabalhar por causa do navegador dela.
 */
export function useLocalizacaoObrigatoria(): EstadoLocalizacao {
  const { profile } = useAuth()
  const { data: cfg } = useAcessoConfig()
  const [estado, setEstado] = useState<EstadoGeo>('checando')
  const [coords, setCoords] = useState<Coordenadas | null>(null)
  const jaPediu = useRef(false)

  const exigida =
    !!cfg?.exigir_localizacao &&
    !!profile &&
    profile.role !== 'admin' &&
    (cfg.papeis_obrigatorios ?? []).includes(profile.role)

  const capturar = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setEstado('indisponivel')
      return
    }
    navigator.geolocation.getCurrentPosition(
      pos => {
        setCoords({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precisao_m: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
        })
        setEstado('granted')
      },
      err => {
        // 1 = PERMISSION_DENIED · 2 = POSITION_UNAVAILABLE · 3 = TIMEOUT
        setEstado(err.code === 1 ? 'denied' : 'erro')
      },
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 5 * 60_000 },
    )
  }

  // Descobre o estado SEM disparar o popup (Permissions API), e só captura
  // sozinho se já estiver concedido — senão o popup nasceria sem contexto.
  useEffect(() => {
    let vivo = true
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setEstado('indisponivel')
      return
    }
    if (!navigator.permissions?.query) {
      // Safari antigo: sem Permissions API. Assume que precisa perguntar.
      setEstado('prompt')
      return
    }
    navigator.permissions
      .query({ name: 'geolocation' as PermissionName })
      .then(st => {
        if (!vivo) return
        setEstado(st.state as EstadoGeo)
        if (st.state === 'granted' && !jaPediu.current) {
          jaPediu.current = true
          capturar()
        }
        st.onchange = () => {
          if (!vivo) return
          setEstado(st.state as EstadoGeo)
          if (st.state === 'granted') capturar()
        }
      })
      .catch(() => {
        if (vivo) setEstado('prompt')
      })
    return () => {
      vivo = false
    }
  }, [])

  return { exigida, estado, coords, pedir: capturar }
}
