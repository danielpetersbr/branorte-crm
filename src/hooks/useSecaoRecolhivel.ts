// Seções recolhíveis — lembra no navegador o que o usuário fechou.
//
// A Central de Roteamento (/disparos) virou um rolo de 9 blocos; quem usa só
// precisa de 2 ou 3 por vez. Aqui fica o estado de aberto/fechado por id, num
// store de módulo (não em Context) pra que o botão "Recolher tudo" da página
// consiga mexer em seções que moram em componentes diferentes.
//
// Mesma ideia do accordion da sidebar (Layout.tsx: 'sidebar-open-groups'),
// mas compartilhado entre componentes e com id namespaced por tela
// (ex: 'disparos.funil') pra duas telas não brigarem pela mesma chave.

import { useCallback, useEffect, useSyncExternalStore } from 'react'

const LS_KEY = 'crm-secoes-abertas'

/** id -> aberta. Quem não está no mapa nunca foi tocado: vale o default da seção. */
let estado: Record<string, boolean> = carregar()

/** Seções montadas AGORA na tela (id -> default). "Recolher tudo" só mexe nessas. */
const registradas = new Map<string, boolean>()

const ouvintes = new Set<() => void>()

function carregar(): Record<string, boolean> {
  try {
    const cru = JSON.parse(localStorage.getItem(LS_KEY) || '{}')
    return cru && typeof cru === 'object' ? cru : {}
  } catch {
    return {} // navegação privada / storage bloqueado
  }
}

function notificar() {
  for (const f of ouvintes) f()
}

function gravar() {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(estado))
  } catch {
    /* sem storage: vale só nesta visita */
  }
  notificar()
}

function assinar(f: () => void) {
  ouvintes.add(f)
  return () => {
    ouvintes.delete(f)
  }
}

function estaAberta(id: string, defaultAberta: boolean) {
  return estado[id] ?? defaultAberta
}

/**
 * Estado de uma seção recolhível.
 * @param id  chave estável e namespaced pela tela — ex: 'disparos.vendedores'
 * @param defaultAberta  como ela nasce pra quem nunca clicou (padrão: aberta)
 */
export function useSecaoRecolhivel(id: string, defaultAberta = true) {
  const aberta = useSyncExternalStore(
    assinar,
    () => estaAberta(id, defaultAberta),
    () => defaultAberta, // SSR/primeiro paint: sem localStorage, usa o default
  )

  // Só entra no "Recolher tudo" enquanto estiver na tela.
  useEffect(() => {
    registradas.set(id, defaultAberta)
    notificar()
    return () => {
      registradas.delete(id)
      notificar()
    }
  }, [id, defaultAberta])

  const alternar = useCallback(() => {
    estado = { ...estado, [id]: !estaAberta(id, defaultAberta) }
    gravar()
  }, [id, defaultAberta])

  return { aberta, alternar }
}

/** Controle "Recolher tudo / Abrir tudo" das seções montadas na tela atual. */
export function useTodasAsSecoes() {
  // O retrato precisa carregar o TOTAL junto, não só "tem alguma aberta".
  // Com tudo recolhido, "alguma aberta" nasce false e continua false quando as
  // seções se registram — o useSyncExternalStore não vê mudança, não re-renderiza,
  // e o botão "Abrir tudo" nunca aparecia (medido: sumia de vez após um F5 com
  // tudo fechado). Com "abertas/total" o retrato muda de "0/0" pra "0/9" e o
  // botão renderiza. String primitiva = comparação por Object.is, sem loop.
  const retrato = useSyncExternalStore(
    assinar,
    () => {
      let abertas = 0
      for (const [id, def] of registradas) if (estaAberta(id, def)) abertas++
      return `${abertas}/${registradas.size}`
    },
    () => '0/0',
  )
  const [abertas, total] = retrato.split('/').map(Number)
  const algumaAberta = abertas > 0

  const definirTodas = useCallback((aberta: boolean) => {
    const novo = { ...estado }
    for (const id of registradas.keys()) novo[id] = aberta
    estado = novo
    gravar()
  }, [])

  // `total` sai do retrato, não de registradas.size direto: ler o Map durante o
  // render é leitura impura e volta a esconder o botão.
  return { algumaAberta, definirTodas, total }
}
