// ResponsiveScaler — encolhe proporcionalmente um documento de largura fixa
// pra caber na largura do container (responsivo).
//
// Caso de uso: preview de orçamento renderizado como A4/desktop (1024px de
// largura). Em mobile, queremos que o documento INTEIRO apareça na tela, sem
// scroll horizontal, mantendo o MESMO layout — só reduzido proporcionalmente.
//
// Como funciona:
//   - Mede a largura disponível via ResizeObserver
//   - Calcula scale = min(1, larguraDisponivel / documentWidth)
//   - Aplica transform: scale(scale) no inner (documento)
//   - Mede a altura real do documento e ajusta a altura do wrapper externo
//     pra `alturaReal * scale` (senão sobra espaço vazio embaixo do transform)
//
// `transform` é puramente visual — o browser ainda calcula o layout do inner
// como 1024px. Por isso o overflow:hidden no wrapper externo é essencial pra
// esconder o que estaria "fora" e não criar scroll horizontal.

import { useEffect, useRef, useState, type ReactNode } from 'react'

interface ResponsiveScalerProps {
  /** Largura base do documento em px (ex: 1024 = A4/desktop) */
  documentWidth?: number
  /** Conteúdo a ser escalado */
  children: ReactNode
  /** Se true, desativa o scaler (renderiza children sem transform). Útil pra impressão. */
  disabled?: boolean
  /** Origem do transform. Default: 'top center' (documento centralizado). */
  origin?: 'top left' | 'top center'
  className?: string
}

export function ResponsiveScaler({
  documentWidth = 1024,
  children,
  disabled = false,
  origin = 'top center',
  className,
}: ResponsiveScalerProps) {
  const outerRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  // Começa em 0 pra evitar flash de overflow no 1o paint (antes do measure).
  // Wrapper tem overflow:hidden, então scale=0 = nada visível até medir.
  const [scale, setScale] = useState(0)
  const [innerHeight, setInnerHeight] = useState(0)

  // Observa largura do container externo
  useEffect(() => {
    if (disabled) {
      setScale(1)
      return
    }
    const outer = outerRef.current
    if (!outer) return

    const measure = () => {
      // getBoundingClientRect() é mais preciso que clientWidth (sub-pixel)
      // e reflete transforms/zoom do parent.
      const availWidth = outer.getBoundingClientRect().width
      if (availWidth > 0) {
        // Math.min(1, ...) — nunca aumenta, só reduz.
        // -1px de folga pra evitar corte por sub-pixel rounding do browser
        // (transform com scale fracionado pode produzir bordas com 0.5px que
        // ficam cortadas pelo overflow:hidden do outer).
        const s = Math.min(1, (availWidth - 1) / documentWidth)
        setScale(s)
      }
    }
    // Measure sincrono + após próximo frame (cobre caso do parent ainda não
    // ter calculado largura final na primeira passada).
    measure()
    const raf = requestAnimationFrame(measure)

    const ro = new ResizeObserver(measure)
    ro.observe(outer)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [documentWidth, disabled])

  // Observa altura do inner (documento) pra compensar o scale no wrapper
  useEffect(() => {
    if (disabled) {
      setInnerHeight(0)
      return
    }
    const inner = innerRef.current
    if (!inner) return

    const measure = () => {
      const h = inner.scrollHeight
      if (h > 0) setInnerHeight(h)
    }
    measure()

    const ro = new ResizeObserver(measure)
    ro.observe(inner)
    // Também observa mudanças nos children (item adicionado, foto carregada etc)
    const mo = new MutationObserver(measure)
    mo.observe(inner, { childList: true, subtree: true, attributes: true })

    return () => { ro.disconnect(); mo.disconnect() }
  }, [disabled, children])

  if (disabled) {
    return <div className={className}>{children}</div>
  }

  // Wrapper externo: full width, overflow hidden (esconde o que escaparia
  // se o scale ainda não foi calculado), altura compensada pelo scale.
  // Inner: largura fixa documentWidth, scale aplicado.
  const wrapperHeight = innerHeight > 0 ? innerHeight * scale : undefined

  return (
    <div
      ref={outerRef}
      className={className}
      style={{
        width: '100%',
        overflow: 'hidden',
        height: wrapperHeight,
      }}
    >
      <div
        ref={innerRef}
        style={{
          width: documentWidth,
          transform: `scale(${scale})`,
          transformOrigin: '0 0',
          // Quando scale=1 (desktop), centraliza no outer maior que 1024.
          // Quando scale<1 (mobile), margin auto pode causar margens negativas
          // que browsers clampam diferente — força margin 0 pra alinhar à
          // esquerda do outer (e o scale faz caber).
          marginLeft: scale >= 1 ? 'auto' : 0,
          marginRight: scale >= 1 ? 'auto' : 0,
        }}
      >
        {children}
      </div>
    </div>
  )
}
