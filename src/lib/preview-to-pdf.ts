// Gera PDF a partir da renderizacao real do componente OrcamentoPreview.
// Garante que o PDF sai 100% identico ao preview HTML porque captura o DOM
// renderizado (em vez de tentar reconstruir num gerador separado).

import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import jsPDF from 'jspdf'
import html2canvas from 'html2canvas'
import {
  OrcamentoPreview,
  type OrcamentoPreviewProps,
} from '@/components/OrcamentoPreview'

interface GerarPdfOpts {
  /** Largura da pagina A4 em mm (default 210) */
  pageWidth?: number
  /** Altura da pagina A4 em mm (default 297) */
  pageHeight?: number
  /** Escala do html2canvas — quanto maior, melhor qualidade mas mais memoria (default 2) */
  scale?: number
  /** Largura em PIXELS do container offscreen onde a preview e renderizada (default 800px ≈ proporcional A4) */
  containerWidthPx?: number
}

/**
 * Renderiza OrcamentoPreview em um container hidden, captura o DOM como
 * imagem e empacota num PDF A4 multi-pagina.
 */
export async function gerarPdfDoPreview(
  previewProps: OrcamentoPreviewProps,
  opts: GerarPdfOpts = {},
): Promise<Blob> {
  const pageWidthMm = opts.pageWidth ?? 210
  const pageHeightMm = opts.pageHeight ?? 297
  const scale = opts.scale ?? 2
  const containerWidthPx = opts.containerWidthPx ?? 800

  // 1) Cria container off-screen com largura fixa pra o preview renderizar consistente
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = `${containerWidthPx}px`
  host.style.background = '#ffffff'
  host.style.zIndex = '-1'
  host.setAttribute('data-pdf-host', '1')
  document.body.appendChild(host)

  let root: ReturnType<typeof createRoot> | null = null

  try {
    // 2) Renderiza preview em renderMode (sem botoes)
    root = createRoot(host)
    root.render(createElement(OrcamentoPreview, { ...previewProps, renderMode: true }))

    // 3) Aguarda render + carregamento de imagens (logo + fotos dos equipamentos)
    await waitForImagesAndPaint(host)

    // 3.5) Captura posicoes Y (em CSS px do host) dos blocos [data-no-break] ANTES de capturar
    const hostTop = host.getBoundingClientRect().top + window.scrollY
    const noBreakRanges: Array<{ topPx: number; bottomPx: number }> = []
    host.querySelectorAll('[data-no-break]').forEach((el) => {
      const r = (el as HTMLElement).getBoundingClientRect()
      const top = r.top + window.scrollY - hostTop
      const bottom = r.bottom + window.scrollY - hostTop
      if (bottom > top + 4) noBreakRanges.push({ topPx: top, bottomPx: bottom })
    })

    // 4) Captura como canvas
    const canvas = await html2canvas(host, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 15000,
      width: containerWidthPx,
      windowWidth: containerWidthPx,
    })

    // Converte ranges de CSS px → canvas px (com scale aplicado)
    const noBreakCanvasRanges = noBreakRanges.map(r => ({
      top: Math.floor(r.topPx * scale),
      bottom: Math.ceil(r.bottomPx * scale),
    }))

    // 5) Converte canvas pra PDF A4 (multi-pagina se necessario)
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' })

    // mm por pixel da imagem capturada (mantem proporcao da largura A4)
    const mmPerPx = pageWidthMm / canvas.width
    const totalHeightMm = canvas.height * mmPerPx

    if (totalHeightMm <= pageHeightMm + 0.5) {
      // Cabe em 1 pagina so
      const imgData = canvas.toDataURL('image/jpeg', 0.92)
      pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, totalHeightMm, undefined, 'FAST')
    } else {
      // Multi-pagina: smart slicing — corta SO em linhas em branco
      // pra nao quebrar texto/blocos no meio da pagina A4
      const sliceHeightPx = Math.floor(pageHeightMm / mmPerPx)
      // Lê o canvas inteiro 1 vez pra procurar linhas em branco
      const fullCtx = canvas.getContext('2d')!
      const imageData = fullCtx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      const W = canvas.width

      // Helper: linha Y é "branca/clara"? (todos pixels >= threshold)
      // Uso threshold 245 (quase branco) e amostra a cada 4 px pra performance
      function isLineBlank(y: number): boolean {
        const rowOffset = y * W * 4
        for (let x = 0; x < W; x += 4) {
          const i = rowOffset + x * 4
          // RGB médio
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3
          if (avg < 245) return false
        }
        return true
      }

      // Verifica se Y cai dentro de algum bloco no-break
      function isInsideNoBreak(y: number): { inside: boolean; topY?: number; bottomY?: number } {
        for (const r of noBreakCanvasRanges) {
          if (y > r.top + 1 && y < r.bottom - 1) {
            return { inside: true, topY: r.top, bottomY: r.bottom }
          }
        }
        return { inside: false }
      }

      // Helper: encontra a melhor linha de corte perto do ideal
      // PRIMEIRO: se cai dentro de no-break, move pra ANTES dele
      // DEPOIS: procura linha em branco pra refinar
      function findCutY(idealY: number, maxY: number, sliceStart: number): number {
        // 1) Move idealY pra fora de qualquer no-break (iterativamente)
        let y = idealY
        for (let iter = 0; iter < 10; iter++) {
          const r = isInsideNoBreak(y)
          if (!r.inside) break
          // Tenta antes
          y = r.topY! - 4
          // Se moveu pra ANTES do sliceStart (pagina vazia), tenta DEPOIS
          if (y <= sliceStart + 50) {
            y = r.bottomY! + 4
          }
        }
        // 2) Refina: procura linha branca proxima
        const lookBack = Math.floor(sliceHeightPx * 0.10)
        const lookAhead = Math.floor(sliceHeightPx * 0.02)
        const minY = Math.max(y - lookBack, sliceStart + 50)
        const maxYClamp = Math.min(y + lookAhead, maxY - 1)
        let bestY = -1
        let bestRunLen = 0
        let runStart = -1
        for (let y2 = minY; y2 <= maxYClamp; y2++) {
          // Skip Y que cai em no-break (pode ter linha branca dentro de bloco branco)
          if (isInsideNoBreak(y2).inside) {
            if (runStart >= 0) {
              const runLen = y2 - runStart
              if (runLen >= 3 && runLen >= bestRunLen) {
                bestRunLen = runLen
                bestY = Math.floor((runStart + y2) / 2)
              }
              runStart = -1
            }
            continue
          }
          if (isLineBlank(y2)) {
            if (runStart < 0) runStart = y2
          } else {
            if (runStart >= 0) {
              const runLen = y2 - runStart
              if (runLen >= 3 && runLen >= bestRunLen) {
                bestRunLen = runLen
                bestY = Math.floor((runStart + y2) / 2)
              }
              runStart = -1
            }
          }
        }
        if (runStart >= 0) {
          const runLen = maxYClamp - runStart + 1
          if (runLen >= 3 && runLen >= bestRunLen) {
            bestY = Math.floor((runStart + maxYClamp) / 2)
          }
        }
        return bestY > 0 ? bestY : y
      }

      // Tolerancia: ignorar overflow < 8% da pagina (evita pagina extra so com footer)
      const minRemainingPx = Math.floor(sliceHeightPx * 0.08)
      let yPx = 0
      let pageIdx = 0
      while (yPx < canvas.height) {
        const remainingPx = canvas.height - yPx
        if (pageIdx > 0 && remainingPx < minRemainingPx) break

        let thisSliceHeightPx: number
        if (remainingPx <= sliceHeightPx) {
          // Última fatia — pega tudo que sobrou
          thisSliceHeightPx = remainingPx
        } else {
          // Procura linha branca perto do limite ideal — respeitando data-no-break
          const idealY = yPx + sliceHeightPx
          const cutY = findCutY(idealY, canvas.height, yPx)
          thisSliceHeightPx = cutY - yPx
        }

        // Cria canvas temporario pra fatia
        const sliceCanvas = document.createElement('canvas')
        sliceCanvas.width = canvas.width
        sliceCanvas.height = thisSliceHeightPx
        const ctx = sliceCanvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, sliceCanvas.width, sliceCanvas.height)
        ctx.drawImage(
          canvas,
          0, yPx, canvas.width, thisSliceHeightPx,
          0, 0, canvas.width, thisSliceHeightPx,
        )

        const imgData = sliceCanvas.toDataURL('image/jpeg', 0.92)
        const sliceHeightMm = thisSliceHeightPx * mmPerPx

        if (pageIdx > 0) pdf.addPage()
        pdf.addImage(imgData, 'JPEG', 0, 0, pageWidthMm, sliceHeightMm, undefined, 'FAST')

        yPx += thisSliceHeightPx
        pageIdx += 1
      }
    }

    return pdf.output('blob')
  } finally {
    try { root?.unmount() } catch {}
    try { document.body.removeChild(host) } catch {}
  }
}

/**
 * Espera todas as imagens dentro do container terminarem de carregar
 * e da uns frames pra browser pintar tudo.
 */
async function waitForImagesAndPaint(host: HTMLElement): Promise<void> {
  // 1) Espera todas as <img> terminarem
  const imgs = Array.from(host.querySelectorAll('img'))
  await Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      const done = () => resolve()
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })  // ignora erro, segue o jogo
      // safety timeout
      setTimeout(done, 8000)
    })
  }))
  // 2) Da 2 frames + delay extra pro browser pintar
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  await new Promise(r => setTimeout(r, 200))
}
