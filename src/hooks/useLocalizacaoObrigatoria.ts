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
  /** true quando localizou, mas com raio maior que o exigido em acesso_config */
  precisaoRuim: boolean
  /** raio máximo aceito, em metros (null = sem exigência) */
  precisaoMaxima: number | null
  /** dispara o popup do navegador (só funciona a partir de um clique do usuário) */
  pedir: () => void
}

export interface AcessoConfig {
  exigir_localizacao: boolean
  papeis_obrigatorios: string[]
  precisao_maxima_m: number | null
}

export function useAcessoConfig() {
  return useQuery({
    queryKey: ['acesso_config'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('acesso_config')
        .select('exigir_localizacao,papeis_obrigatorios,precisao_maxima_m')
        .maybeSingle()
      if (error) throw error
      return (data ?? {
        exigir_localizacao: false,
        papeis_obrigatorios: [],
        precisao_maxima_m: null,
      }) as AcessoConfig
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

  /** Precisão que já serve pra dizer "está neste endereço". */
  const META_PRECISAO_M = 100
  /** Tempo máximo perseguindo uma leitura melhor. */
  const JANELA_MS = 12_000

  /**
   * Captura a MELHOR leitura possível, não a primeira.
   *
   * `getCurrentPosition` devolve a primeira coisa que o sistema tem — em geral
   * a estimativa por IP, com quilômetros de erro. `watchPosition` continua
   * emitindo enquanto o aparelho refina (GPS fixando satélite, varredura de
   * Wi-Fi), então guardamos a de menor `accuracy` dentro da janela.
   *
   * `enableHighAccuracy: true` liga o GPS no celular; `maximumAge: 0` proíbe
   * cache — sem isso o navegador devolve a leitura velha e larga de sempre.
   */
  const capturar = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setEstado('indisponivel')
      return
    }
    setEstado('checando')
    let melhor: Coordenadas | null = null
    let encerrado = false
    let watchId: number | null = null

    const encerrar = () => {
      if (encerrado) return
      encerrado = true
      if (watchId !== null) navigator.geolocation.clearWatch(watchId)
      if (melhor) {
        setCoords(melhor)
        setEstado('granted')
      } else {
        setEstado('erro')
      }
    }

    watchId = navigator.geolocation.watchPosition(
      pos => {
        const acc = Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null
        const atual: Coordenadas = {
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          precisao_m: acc,
        }
        const piorQueAtual = melhor?.precisao_m ?? Number.POSITIVE_INFINITY
        if (acc === null || acc < piorQueAtual) melhor = atual
        // Boa o bastante: para de gastar bateria e segue a vida.
        if (acc !== null && acc <= META_PRECISAO_M) encerrar()
      },
      err => {
        if (encerrado) return
        if (err.code === 1) {
          // PERMISSION_DENIED é definitivo — não adianta esperar.
          encerrado = true
          if (watchId !== null) navigator.geolocation.clearWatch(watchId)
          setEstado('denied')
          return
        }
        // POSITION_UNAVAILABLE / TIMEOUT: se já houver alguma leitura, vale ela.
        encerrar()
      },
      { enableHighAccuracy: true, timeout: JANELA_MS, maximumAge: 0 },
    )

    window.setTimeout(encerrar, JANELA_MS)
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

  const precisaoMaxima = cfg?.precisao_maxima_m ?? null
  const precisaoRuim =
    precisaoMaxima !== null &&
    coords !== null &&
    (coords.precisao_m === null || coords.precisao_m > precisaoMaxima)

  return { exigida, estado, coords, precisaoRuim, precisaoMaxima, pedir: capturar }
}
