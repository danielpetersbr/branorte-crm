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
      // Multi-pagina: corta o canvas em fatias do tamanho da pagina A4
      const sliceHeightPx = Math.floor(pageHeightMm / mmPerPx)
      // Tolerancia: ignorar overflow < 8% da pagina (evita pagina extra so com footer)
      const minRemainingPx = Math.floor(sliceHeightPx * 0.08)
      let yPx = 0
      let pageIdx = 0
      while (yPx < canvas.height) {
        const remainingPx = canvas.height - yPx
        // Se sobrou pouco e ja temos pelo menos 1 pagina, joga o resto na ultima pagina (nao cria nova)
        if (pageIdx > 0 && remainingPx < minRemainingPx) break
        const thisSliceHeightPx = Math.min(sliceHeightPx, remainingPx)

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
