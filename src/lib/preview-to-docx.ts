// Gera .docx a partir da renderização real do componente OrcamentoPreview.
// Usa a MESMA estrategia do preview-to-pdf: captura o DOM como canvas,
// faz slicing respeitando data-no-break, e empacota cada slice como ImageRun
// numa pagina A4 do docx.
//
// Vantagem: DOCX visual IDENTICO ao PDF (porque eh a mesma imagem).
// Desvantagem: DOCX nao eh mais editavel (texto nao selecionavel — eh imagem).

import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import {
  Document, Packer, Paragraph, ImageRun,
  PageOrientation, convertMillimetersToTwip,
} from 'docx'
import html2canvas from 'html2canvas'
import {
  OrcamentoPreview,
  type OrcamentoPreviewProps,
} from '@/components/OrcamentoPreview'

interface GerarDocxOpts {
  pageWidth?: number       // mm (default 210 A4)
  pageHeight?: number      // mm (default 297 A4)
  scale?: number           // html2canvas scale (default 2 high-DPI)
  containerWidthPx?: number // largura do container off-screen (default 800)
}

/**
 * Renderiza OrcamentoPreview, captura como imagem, fatia por A4 respeitando
 * data-no-break, e empacota num docx com 1 imagem por pagina.
 */
export async function gerarDocxDoPreview(
  previewProps: OrcamentoPreviewProps,
  opts: GerarDocxOpts = {},
): Promise<Blob> {
  const pageWidthMm = opts.pageWidth ?? 210
  const pageHeightMm = opts.pageHeight ?? 297
  const scale = opts.scale ?? 3
  // Container estreito (750) = fonte sai MAIOR no DOCX final (mobile-friendly)
  const containerWidthPx = opts.containerWidthPx ?? 750

  // 1) Cria container off-screen
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = `${containerWidthPx}px`
  host.style.background = '#ffffff'
  host.style.zIndex = '-1'
  document.body.appendChild(host)

  let root: ReturnType<typeof createRoot> | null = null

  try {
    // 2) Renderiza preview em renderMode
    root = createRoot(host)
    root.render(createElement(OrcamentoPreview, { ...previewProps, renderMode: true }))
    await waitForImagesAndPaint(host)

    // 3) Captura posicoes Y dos data-no-break ANTES da captura
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

    const noBreakCanvasRanges = noBreakRanges.map(r => ({
      top: Math.floor(r.topPx * scale),
      bottom: Math.ceil(r.bottomPx * scale),
    }))

    // 5) Slicing igual ao PDF
    const mmPerPx = pageWidthMm / canvas.width
    const totalHeightMm = canvas.height * mmPerPx

    const slices: Array<{ blob: ArrayBuffer; widthMm: number; heightMm: number }> = []

    if (totalHeightMm <= pageHeightMm + 0.5) {
      // Cabe em 1 pagina
      const ab = await canvasToArrayBuffer(canvas)
      slices.push({ blob: ab, widthMm: pageWidthMm, heightMm: totalHeightMm })
    } else {
      const sliceHeightPx = Math.floor(pageHeightMm / mmPerPx)
      const fullCtx = canvas.getContext('2d')!
      const imageData = fullCtx.getImageData(0, 0, canvas.width, canvas.height)
      const data = imageData.data
      const W = canvas.width

      function isLineBlank(y: number): boolean {
        const rowOffset = y * W * 4
        for (let x = 0; x < W; x += 4) {
          const i = rowOffset + x * 4
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3
          if (avg < 245) return false
        }
        return true
      }

      function isInsideNoBreak(y: number): { inside: boolean; topY?: number; bottomY?: number } {
        for (const r of noBreakCanvasRanges) {
          if (y > r.top + 1 && y < r.bottom - 1) {
            return { inside: true, topY: r.top, bottomY: r.bottom }
          }
        }
        return { inside: false }
      }

      function findCutY(idealY: number, maxY: number, sliceStart: number): number {
        let y = idealY
        for (let iter = 0; iter < 10; iter++) {
          const r = isInsideNoBreak(y)
          if (!r.inside) break
          y = r.topY! - 4
          if (y <= sliceStart + 50) y = r.bottomY! + 4
        }
        const lookBack = Math.floor(sliceHeightPx * 0.10)
        const lookAhead = Math.floor(sliceHeightPx * 0.02)
        const minY = Math.max(y - lookBack, sliceStart + 50)
        const maxYClamp = Math.min(y + lookAhead, maxY - 1)
        let bestY = -1
        let bestRunLen = 0
        let runStart = -1
        for (let y2 = minY; y2 <= maxYClamp; y2++) {
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

      const minRemainingPx = Math.floor(sliceHeightPx * 0.08)
      let yPx = 0
      let pageIdx = 0
      while (yPx < canvas.height) {
        const remainingPx = canvas.height - yPx
        if (pageIdx > 0 && remainingPx < minRemainingPx) break

        let thisSliceHeightPx: number
        if (remainingPx <= sliceHeightPx) {
          thisSliceHeightPx = remainingPx
        } else {
          const idealY = yPx + sliceHeightPx
          const cutY = findCutY(idealY, canvas.height, yPx)
          thisSliceHeightPx = cutY - yPx
        }

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

        const ab = await canvasToArrayBuffer(sliceCanvas)
        slices.push({
          blob: ab,
          widthMm: pageWidthMm,
          heightMm: thisSliceHeightPx * mmPerPx,
        })

        yPx += thisSliceHeightPx
        pageIdx += 1
      }
    }

    // 6) Monta DOCX com 1 section por slice (1 pagina cada)
    const sections = slices.map((slice) => ({
      properties: {
        page: {
          size: {
            width: convertMillimetersToTwip(pageWidthMm),
            height: convertMillimetersToTwip(pageHeightMm),
            orientation: PageOrientation.PORTRAIT,
          },
          margin: {
            top: 0, bottom: 0, left: 0, right: 0,
          },
        },
      },
      children: [
        new Paragraph({
          children: [
            new ImageRun({
              type: 'jpg' as any,
              data: slice.blob,
              transformation: {
                // Em pixels (docx converte). Usa 96 DPI: 1mm ≈ 3.78px
                width: Math.round(slice.widthMm * 3.78),
                height: Math.round(slice.heightMm * 3.78),
              },
            }),
          ],
          spacing: { before: 0, after: 0 },
        }),
      ],
    }))

    const doc = new Document({
      creator: 'Branorte CRM',
      title: 'Orçamento',
      sections,
    })

    return await Packer.toBlob(doc)
  } finally {
    try { root?.unmount() } catch {}
    try { document.body.removeChild(host) } catch {}
  }
}

async function canvasToArrayBuffer(canvas: HTMLCanvasElement): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) return reject(new Error('canvas.toBlob returned null'))
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result as ArrayBuffer)
        reader.onerror = () => reject(reader.error)
        reader.readAsArrayBuffer(blob)
      },
      'image/jpeg',
      0.96,
    )
  })
}

async function waitForImagesAndPaint(host: HTMLElement): Promise<void> {
  const imgs = Array.from(host.querySelectorAll('img'))
  await Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve()
    return new Promise<void>(resolve => {
      const done = () => resolve()
      img.addEventListener('load', done, { once: true })
      img.addEventListener('error', done, { once: true })
      setTimeout(done, 8000)
    })
  }))
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  await new Promise(r => setTimeout(r, 200))
}
