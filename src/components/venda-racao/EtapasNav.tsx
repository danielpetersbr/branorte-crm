/**
 * Barra de etapas do estudo — o "onde eu estou" do questionário.
 *
 * O formulário virou uma coluna só, com as 8 etapas empilhadas. Coluna única
 * resolve a ordem de leitura, mas cria um problema novo: a página fica LONGA, e
 * no meio da rolagem o vendedor perde a noção do que já respondeu e do que
 * falta. Esta barra é a resposta — fica grudada no topo, mostra as 8 etapas com
 * o estado de cada uma e leva pra qualquer uma com um clique.
 *
 * Componente BURRO de propósito: ele não sabe o que é "demanda mensal" nem lê
 * `resultado`. Quem decide se uma etapa está concluída é `etapasConcluidas()` na
 * ProducaoPropria, e quem decide se tem erro é o mapa campo→etapa que a página
 * monta a partir de `resultado.problemas`. Aqui só entra UI e rolagem.
 *
 * CONTRATO COM O FORMULÁRIO: cada etapa precisa ter `id="vr-etapa-N"` (N de 1 a
 * 8, na MESMA ordem do array `etapas`). Sem o id, o clique naquela etapa vira
 * um no-op silencioso — não quebra nada, só não rola.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

/** Mesmo formato devolvido por `etapasConcluidas()` na página. */
export interface EtapaProgresso {
  rotulo: string
  ok: boolean
}

export interface EtapasNavProps {
  /** As 8 etapas, na ordem do formulário. Vem pronta da página — não recalcular. */
  etapas: readonly EtapaProgresso[]
  /**
   * Índices (0-based, mesma ordem de `etapas`) que têm problema de BLOQUEIO.
   * A página deriva de `resultado.problemas` filtrando `nivel === 'bloqueio'` e
   * traduzindo `campo` → etapa. Avisos não entram aqui: aviso não é erro, e
   * pintar de vermelho o que só é ressalva ensina o vendedor a ignorar vermelho.
   */
  erros?: readonly number[]
  /**
   * Prefixo dos ids das âncoras. Default `vr-etapa` → `vr-etapa-1`…`vr-etapa-8`.
   * É prop pra tela irmã (/venda-racao, 5 etapas) poder reusar sem colidir.
   */
  idPrefixo?: string
  /**
   * Chamado ANTES de rolar. Existe porque a barra também aparece na fase de
   * RESULTADO, onde o formulário está desmontado e o `id` não existe: a página
   * usa este gancho pra voltar pra fase 'preencher'. Depois disso a rolagem é
   * tentada de novo por alguns quadros, dando tempo do React montar.
   */
  onSelecionar?: (indice: number) => void
}

/** Rótulo do estado pra leitor de tela — texto, não cor. */
function descreverEstado(ok: boolean, erro: boolean, atual: boolean): string {
  if (erro) return 'com pendência'
  if (ok) return 'concluída'
  if (atual) return 'em preenchimento'
  return 'não iniciada'
}

/** Respeita quem desligou animação no sistema. */
function comportamentoRolagem(): ScrollBehavior {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'auto'
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
}

export function EtapasNav({
  etapas, erros = [], idPrefixo = 'vr-etapa', onSelecionar,
}: EtapasNavProps) {
  const barraRef = useRef<HTMLElement | null>(null)
  const listaRef = useRef<HTMLDivElement | null>(null)

  /** Etapa que está sob o topo da tela agora. -1 = nenhuma (form desmontado). */
  const [atual, setAtual] = useState<number>(-1)
  /** Altura real da barra — vira o recorte do scroll-spy. Medida, não chutada. */
  const [alturaBarra, setAlturaBarra] = useState<number>(72)

  const total = etapas.length
  const concluidas = useMemo(() => etapas.filter(e => e.ok).length, [etapas])
  const comErro = useMemo(() => new Set<number>(erros), [erros])

  // --- altura da barra -------------------------------------------------------
  // Em telas estreitas a barra ganha uma linha e muda de altura; o recorte do
  // observer precisa acompanhar, senão a etapa "atual" fica sempre uma atrás.
  useEffect(() => {
    const el = barraRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const h = Math.round(el.getBoundingClientRect().height)
      // só troca o state se mudou de verdade — senão vira laço de re-render
      setAlturaBarra(anterior => (Math.abs(anterior - h) > 1 ? h : anterior))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // --- scroll-spy ------------------------------------------------------------
  // "Em preenchimento" não dá pra deduzir de {rotulo, ok}: um campo pela metade
  // não aparece no cálculo. O que dá pra saber com honestidade é ONDE o vendedor
  // está olhando — e é isso que a barra destaca. O recorte de baixo (-55%) evita
  // que meia dúzia de etapas contem como visíveis ao mesmo tempo num monitor
  // grande: vale a que cruzou o topo por último.
  useEffect(() => {
    if (typeof IntersectionObserver === 'undefined') return

    const indicePorElemento = new Map<Element, number>()
    for (let i = 0; i < total; i += 1) {
      const el = document.getElementById(`${idPrefixo}-${i + 1}`)
      if (el) indicePorElemento.set(el, i)
    }
    if (indicePorElemento.size === 0) {
      setAtual(-1)
      return
    }

    const visiveis = new Set<number>()
    const obs = new IntersectionObserver(
      entradas => {
        for (const e of entradas) {
          const i = indicePorElemento.get(e.target)
          if (i === undefined) continue
          if (e.isIntersecting) visiveis.add(i)
          else visiveis.delete(i)
        }
        // a de menor índice entre as visíveis = a que está mais no topo
        setAtual(visiveis.size ? Math.min(...visiveis) : -1)
      },
      { rootMargin: `-${alturaBarra + 8}px 0px -55% 0px`, threshold: 0 },
    )
    for (const el of indicePorElemento.keys()) obs.observe(el)
    return () => obs.disconnect()
  }, [total, idPrefixo, alturaBarra])

  // --- no celular a lista rola na horizontal; a etapa atual tem que aparecer --
  // Mexe SÓ no scrollLeft da lista. `scrollIntoView` no chip arrastaria a página
  // inteira junto (a barra é sticky, o navegador tentaria centralizar no eixo Y).
  useEffect(() => {
    const lista = listaRef.current
    if (!lista || atual < 0) return
    const item = lista.children[atual]
    if (!(item instanceof HTMLElement)) return
    const alvo = item.offsetLeft - (lista.clientWidth - item.offsetWidth) / 2
    lista.scrollTo({ left: Math.max(0, alvo), behavior: comportamentoRolagem() })
  }, [atual])

  // --- clique ----------------------------------------------------------------
  const irParaEtapa = useCallback((indice: number) => {
    onSelecionar?.(indice)
    const id = `${idPrefixo}-${indice + 1}`
    const behavior = comportamentoRolagem()
    // O alinhamento fino é do CSS: `scroll-margin-top` na âncora tira o título
    // de baixo da barra sticky. scrollIntoView respeita, e não precisa de conta
    // de pixel aqui dentro.
    const tentar = (restantes: number): void => {
      const el = document.getElementById(id)
      if (el) { el.scrollIntoView({ behavior, block: 'start' }); return }
      // ainda não montou (veio da fase de resultado) — tenta de novo, mesmo
      // truque dos 60ms que a página já usa nos botões de premissas/WhatsApp
      if (restantes > 0) window.setTimeout(() => tentar(restantes - 1), 60)
    }
    tentar(3)
  }, [idPrefixo, onSelecionar])

  if (total === 0) return null

  return (
    <nav ref={barraRef} className="vr-etapas vr-no-print" aria-label="Etapas do estudo">
      <div className="vr-etapas-trilho">
        <span style={{ width: `${(concluidas / total) * 100}%` }} />
      </div>

      <div className="vr-etapas-lista" ref={listaRef}>
        {etapas.map((etapa, i) => {
          const erro = comErro.has(i)
          const ativa = i === atual
          // erro ganha de concluída: um bloqueio significa que a etapa NÃO está
          // pronta, mesmo que o critério de preenchimento tenha passado
          const estado = erro ? 'erro' : etapa.ok ? 'ok' : 'vazia'
          const classes = ['vr-etapas-item', estado]
          if (ativa) classes.push('atual')
          return (
            <button
              key={etapa.rotulo}
              type="button"
              className={classes.join(' ')}
              aria-current={ativa ? 'step' : undefined}
              aria-label={`Etapa ${i + 1}: ${etapa.rotulo} — ${descreverEstado(etapa.ok, erro, ativa)}`}
              title={`Ir para: ${etapa.rotulo}`}
              onClick={() => irParaEtapa(i)}
            >
              <span className="vr-etapas-n" aria-hidden="true">
                {erro ? '!' : etapa.ok ? '✓' : i + 1}
              </span>
              <span className="vr-etapas-rotulo">{etapa.rotulo}</span>
            </button>
          )
        })}
      </div>

      <div className="vr-etapas-contador">
        {concluidas} de {total} etapas
        {comErro.size > 0 ? ` · ${comErro.size} com pendência` : ''}
      </div>
    </nav>
  )
}

export default EtapasNav
