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
  /**
   * Qualidade do PDF. `normal` = scale 5 desktop / 2 mobile (default).
   * `high` = scale 8 desktop / 4 mobile (≈300 DPI). Cuidado: mobile pode estourar memoria em PDFs longos.
   */
  quality?: 'normal' | 'high'
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
  // scale: 5 em desktop, 2 em mobile (default 'normal'). iOS Safari/PWA estoura
  // memoria com scale alto e gera CANVAS BRANCO (bug confirmado em iPad/iPhone).
  // 'high' = 8 desktop / 4 mobile (≈300 DPI) — use pra impressao premium.
  const isMobile = typeof window !== 'undefined' && window.innerWidth < 768
  const isHighQuality = opts.quality === 'high'
  const scale = opts.scale ?? (isHighQuality
    ? (isMobile ? 4 : 8)
    : (isMobile ? 2 : 5))
  const containerWidthPx = opts.containerWidthPx ?? 1024

  // 1) Cria container off-screen com largura fixa pra o preview renderizar consistente
  // CRÍTICO: força light mode no host pra texto não ficar branco-em-branco quando
  // o app está em dark mode. Sem isso, CSS vars (--ink: 96% branco no dark) fazem
  // todo texto sumir no PDF (fundo branco + texto branco = invisível).
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = `${containerWidthPx}px`
  host.style.background = '#ffffff'
  host.style.zIndex = '-1'
  host.setAttribute('data-pdf-host', '1')
  // Força light mode: remove dark do <html> temporariamente
  const htmlEl = document.documentElement
  const wasDark = htmlEl.classList.contains('dark')
  if (wasDark) htmlEl.classList.remove('dark')
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
    // foreignObjectRendering=false forca uso do canvas tradicional (em vez de
    // SVG foreignObject). Necessario porque iOS Safari TEM BUG conhecido que
    // gera canvas BRANCO quando usa foreignObject (especialmente em PWA).
    const captura = async () => html2canvas(host, {
      scale,
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      imageTimeout: 15000,
      width: containerWidthPx,
      windowWidth: containerWidthPx,
      foreignObjectRendering: false,
    })

    let canvas = await captura()
    // Defesa: se canvas saiu vazio (height 0 ou too small), tenta DE NOVO
    // apos paint extra. Bug iOS PWA: 1a captura as vezes pega antes do paint.
    if (!canvas || canvas.height < 100) {
      console.warn('[pdf] canvas pequeno demais (h=' + canvas?.height + '), retry...')
      await new Promise(r => setTimeout(r, 800))
      canvas = await captura()
      if (!canvas || canvas.height < 100) {
        throw new Error('html2canvas devolveu canvas vazio — preview nao renderizou (iOS Safari PWA bug?)')
      }
    }
    console.log(`[pdf] canvas OK ${canvas.width}x${canvas.height}px (scale=${scale})`)

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
      // Cabe em 1 pagina so. PNG = lossless, evita banding/strikethrough
      // artifacts que JPEG produz nas bordas de fatias horizontais.
      const imgData = canvas.toDataURL('image/png')
      pdf.addImage(imgData, 'PNG', 0, 0, pageWidthMm, totalHeightMm, undefined, 'FAST')
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
        // 1) Move idealY pra fora de qualquer no-break (iterativamente).
        // Margem de 30px antes / 16px depois pra evitar borda/sombra/padding
        // do bloco serem cortados.
        let y = idealY
        for (let iter = 0; iter < 10; iter++) {
          const r = isInsideNoBreak(y)
          if (!r.inside) break
          // Tenta antes
          y = r.topY! - 30
          // Se moveu pra ANTES do sliceStart (pagina vazia), tenta DEPOIS
          if (y <= sliceStart + 50) {
            y = r.bottomY! + 16
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

        // PNG = lossless. JPEG criava banding horizontal nas bordas do slice
        // (o "strikethrough" que aparecia em algumas linhas tipo Endereço).
        const imgData = sliceCanvas.toDataURL('image/png')
        const sliceHeightMm = thisSliceHeightPx * mmPerPx

        if (pageIdx > 0) pdf.addPage()
        pdf.addImage(imgData, 'PNG', 0, 0, pageWidthMm, sliceHeightMm, undefined, 'FAST')

        yPx += thisSliceHeightPx
        pageIdx += 1
      }
    }

    // 6) Decora todas as páginas: faixa verde Branorte no topo,
    //    mini logo no canto sup direito (apenas pgs 2+) e "Página X de Y" no rodapé
    await decorarPaginas(pdf, pageWidthMm, pageHeightMm)

    return pdf.output('blob')
  } finally {
    try { root?.unmount() } catch {}
    try { document.body.removeChild(host) } catch {}
    // Restaura dark mode se estava ativo
    if (wasDark) htmlEl.classList.add('dark')
  }
}

/** Carrega o logo Branorte como dataURL (1x, cacheado) */
let _logoCache: string | null = null
async function carregarLogoBranorte(): Promise<string | null> {
  if (_logoCache) return _logoCache
  try {
    const res = await fetch('/branorte-logo.png')
    if (!res.ok) return null
    const blob = await res.blob()
    _logoCache = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result as string)
      reader.onerror = () => reject(reader.error)
      reader.readAsDataURL(blob)
    })
    return _logoCache
  } catch {
    return null
  }
}

/**
 * Aplica em TODAS as páginas:
 *  - Faixa verde Branorte 1.5mm no topo
 *  - Mini logo no canto superior direito (apenas pgs 2+, pra nao competir com o header grande da pg1)
 *  - "Página X de Y" + assinatura discreta no rodapé
 */
async function decorarPaginas(pdf: jsPDF, pageW: number, pageH: number) {
  const totalPages = pdf.getNumberOfPages()
  const logo = await carregarLogoBranorte()

  for (let p = 1; p <= totalPages; p++) {
    pdf.setPage(p)

    // Faixa verde Branorte (#00A859) no topo
    pdf.setFillColor(0, 168, 89)
    pdf.rect(0, 0, pageW, 1.5, 'F')

    // (Mini logo removido das pgs 2+ — competia espaco com conteudo. A faixa verde
    //  no topo + footer ja servem de branding)

    // Rodapé: "Página X de Y" + assinatura limpa (so BRANORTE, sem Metalurgica BBA)
    pdf.setFontSize(7)
    pdf.setTextColor(140, 140, 140)
    pdf.text(
      `Página ${p} de ${totalPages}`,
      pageW / 2,
      pageH - 5.5,
      { align: 'center' },
    )
    pdf.setTextColor(170, 170, 170)
    pdf.text(
      'BRANORTE · contato@mbranorte.com.br · (48) 3658-4502',
      pageW / 2,
      pageH - 2.5,
      { align: 'center' },
    )
  }
}

/**
 * Espera React montar + imagens carregarem + paint.
 * Bug: React 18 renderiza async — se capturarmos antes do mount, host está VAZIO.
 */
async function waitForImagesAndPaint(host: HTMLElement): Promise<void> {
  // 0) Espera React MONTAR — host precisa ter children. Polling com timeout.
  const mountStart = Date.now()
  while (host.children.length === 0 && Date.now() - mountStart < 5000) {
    await new Promise(r => setTimeout(r, 50))
  }
  // Espera content "estabilizar": altura precisa parar de crescer entre frames.
  let lastHeight = -1
  let stableFrames = 0
  const stabStart = Date.now()
  while (stableFrames < 3 && Date.now() - stabStart < 5000) {
    await new Promise(r => requestAnimationFrame(r))
    const h = host.offsetHeight
    if (h === lastHeight && h > 100) stableFrames++
    else stableFrames = 0
    lastHeight = h
  }

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
  await new Promise(r => setTimeout(r, 300))
}
