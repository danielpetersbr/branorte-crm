import { useCallback, useEffect, useState, type RefObject } from 'react'
import { readBrowserPreference, writeBrowserPreference } from '@/lib/browser-preferences'

/**
 * "Ocultar números" — para abrir o dashboard numa TV, numa reunião ou num
 * compartilhamento de tela sem expor faturamento, meta e volume.
 *
 * Por que mascarar o DOM e não os formatadores: número chega na tela por
 * brl()/n()/pct(), mas também cru ({diasRestantes}), pelo eixo e tooltip do
 * Recharts e pelo tooltip do Leaflet. Trocar os formatadores deixaria metade
 * vazando. Aqui a regra vale para tudo que estiver dentro da área mascarada,
 * inclusive o que for desenhado depois (troca de aba, refetch, modal).
 */

export const MASCARA = '•••'

const LS_KEY = 'dashboard-ocultar-numeros'

// Um número inteiro vira UMA máscara: "R$ 1,77M" → "R$ •••". Máscara por
// dígito ("R$ •,••M") entregaria a ordem de grandeza.
const NUMERO = /\d(?:[\d.,/:]*\d)?(?:\s?(?:mil|mi|M|k)(?!\p{L}))?/gu
// Data e hora não são dado sensível e sem elas o eixo do gráfico fica ilegível.
const DATA_OU_HORA = /^\d{1,2}[/:]\d{2}(?:\/\d{2,4})?$/
const ATRIBUTOS = ['title', 'aria-label']
// Selo de janela ("últimos 30 dias") e afins: o número ali é rótulo, não dado.
const MANTER = '[data-manter-numeros]'

export function mascararTexto(txt: string): string {
  return txt.replace(NUMERO, m => (DATA_OU_HORA.test(m) ? m : MASCARA))
}

/** Preferência do usuário, lembrada entre visitas. */
export function useOcultarNumeros(): [boolean, () => void] {
  const [ocultar, setOcultar] = useState(() => readBrowserPreference(LS_KEY) === '1')
  const alternar = useCallback(() => {
    setOcultar(v => {
      writeBrowserPreference(LS_KEY, v ? '0' : '1')
      return !v
    })
  }, [])
  return [ocultar, alternar]
}

type Original = { orig: string; masc: string }

/**
 * Mascara os números de tudo que está dentro de `ref` enquanto `ativo`.
 * Guarda o texto original de cada nó e devolve ao desligar.
 */
export function useMascararNumeros(ref: RefObject<HTMLElement>, ativo: boolean) {
  useEffect(() => {
    const raiz = ref.current
    if (!ativo || !raiz) return

    const textos = new Map<Text, Original>()
    const attrs = new Map<Element, Map<string, Original>>()

    const mascararNo = (no: Text) => {
      const atual = no.nodeValue ?? ''
      const salvo = textos.get(no)
      if (salvo && atual === salvo.masc) return // a mutação foi nossa
      if (no.parentElement?.closest(MANTER)) return
      const masc = mascararTexto(atual)
      if (masc === atual) { textos.delete(no); return }
      textos.set(no, { orig: atual, masc })
      no.nodeValue = masc
    }

    const mascararAttr = (el: Element, nome: string) => {
      const atual = el.getAttribute(nome)
      if (atual == null || el.closest(MANTER)) return
      const doEl = attrs.get(el) ?? new Map<string, Original>()
      const salvo = doEl.get(nome)
      if (salvo && atual === salvo.masc) return
      const masc = mascararTexto(atual)
      if (masc === atual) return
      doEl.set(nome, { orig: atual, masc })
      attrs.set(el, doEl)
      el.setAttribute(nome, masc)
    }

    const varrer = (no: Node) => {
      if (no.nodeType === Node.TEXT_NODE) { mascararNo(no as Text); return }
      if (no.nodeType !== Node.ELEMENT_NODE) return
      const el = no as Element
      ATRIBUTOS.forEach(a => mascararAttr(el, a))
      el.querySelectorAll(ATRIBUTOS.map(a => `[${a}]`).join(',')).forEach(e => ATRIBUTOS.forEach(a => mascararAttr(e, a)))
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT)
      for (let t = walker.nextNode(); t; t = walker.nextNode()) mascararNo(t as Text)
    }

    varrer(raiz)

    // React reescreve o texto quando o dado muda; o observer mascara de novo.
    const obs = new MutationObserver(registros => {
      for (const r of registros) {
        if (r.type === 'characterData') mascararNo(r.target as Text)
        else if (r.type === 'attributes' && r.attributeName) mascararAttr(r.target as Element, r.attributeName)
        else r.addedNodes.forEach(varrer)
      }
      // Refetch troca nós a cada poucos minutos; sem isto o mapa só cresce.
      if (textos.size > 5000) textos.forEach((_, no) => { if (!no.isConnected) textos.delete(no) })
    })
    obs.observe(raiz, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATRIBUTOS })

    return () => {
      obs.disconnect()
      textos.forEach(({ orig, masc }, no) => { if (no.nodeValue === masc) no.nodeValue = orig })
      attrs.forEach((doEl, el) => doEl.forEach(({ orig, masc }, nome) => {
        if (el.getAttribute(nome) === masc) el.setAttribute(nome, orig)
      }))
    }
  }, [ref, ativo])
}
