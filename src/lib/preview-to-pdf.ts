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
    // NOTA: mantemos ranges ANINHADOS (item inteiro + foto+valor aninhado).
    // Quando item > 1 página, o caso especial em isInsideNoBreak permite cortar
    // dentro do item; o aninhado garante que o corte NÃO cai entre foto e valor.
    // Oscilação entre items adjacentes é resolvida pelo step 1.5 do findCutY.

    // 3.6) Cap scale dinamicamente: Chrome/Skia limita canvas a 16384px por
    // dimensão. Orçamentos longos (20+ items) podem ter host com 15000+ CSS px
    // de altura, e qualquer scale >= 1.1 estoura o limite. html2canvas devolve
    // canvas BRANCO silenciosamente. Calcula maxScale (aceita < 1 se preciso)
    // com margem de segurança (16000px efetivo).
    const hostHeightCssPx = host.offsetHeight
    const CANVAS_MAX_DIM = 16000
    const MIN_SCALE = 0.5  // abaixo disso, texto fica ilegível
    let effectiveScale = scale
    if (hostHeightCssPx > 0) {
      const maxScaleByHeight = Math.floor((CANVAS_MAX_DIM / hostHeightCssPx) * 100) / 100
      const maxScaleByWidth = Math.floor((CANVAS_MAX_DIM / containerWidthPx) * 100) / 100
      const maxScale = Math.max(MIN_SCALE, Math.min(maxScaleByHeight, maxScaleByWidth))
      if (effectiveScale > maxScale) {
        console.warn(`[pdf] scale ${scale} estouraria canvas (${hostHeightCssPx}×${scale} = ${hostHeightCssPx * scale}px > ${CANVAS_MAX_DIM}). Reduzindo para ${maxScale}.`)
        effectiveScale = maxScale
      }
      if (maxScale < 1) {
        console.warn(`[pdf] conteudo muito longo (${hostHeightCssPx}px) — qualidade reduzida pra caber no limite do browser.`)
      }
    }

    // 4) Captura como canvas
    // foreignObjectRendering=false forca uso do canvas tradicional (em vez de
    // SVG foreignObject). Necessario porque iOS Safari TEM BUG conhecido que
    // gera canvas BRANCO quando usa foreignObject (especialmente em PWA).
    const captura = async () => html2canvas(host, {
      scale: effectiveScale,
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

    // Defesa extra: canvas pode vir com altura OK mas todo branco quando
    // estoura limite Skia. Amostra ~50 pontos espalhados; se >98% forem
    // brancos puros, força retry com scale menor.
    if (isCanvasMostlyBlank(canvas)) {
      console.warn(`[pdf] canvas ${canvas.width}x${canvas.height} parece em branco — reduzindo scale e tentando de novo`)
      effectiveScale = Math.max(1, Math.floor(effectiveScale / 2))
      canvas = await captura()
      if (isCanvasMostlyBlank(canvas)) {
        throw new Error(`html2canvas devolveu canvas em branco mesmo com scale reduzido (${effectiveScale}). Conteudo pode estar excedendo limites do browser.`)
      }
    }
    console.log(`[pdf] canvas OK ${canvas.width}x${canvas.height}px (scale=${effectiveScale})`)

    // Converte ranges de CSS px → canvas px (com scale aplicado).
    // Expansão mínima (4 CSS px) só pra compensar drift DOM↔html2canvas.
    // O marginBeforePx (30px) no findCutY já dá o respiro visual.
    // NOTA: expansão grande (24px) causava sobreposição entre itens adjacentes
    // (space-y-3 = 12px gap) → findCutY não achava ponto válido de corte.
    const expandCanvasPx = Math.ceil(4 * effectiveScale)
    const noBreakCanvasRanges = noBreakRanges.map(r => ({
      top: Math.floor(r.topPx * effectiveScale) - expandCanvasPx,
      bottom: Math.ceil(r.bottomPx * effectiveScale) + expandCanvasPx,
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

      // Threshold adapta com effectiveScale: em scales baixos (< 1.5) o
      // antialiasing torna pixels de texto MAIS claros (avg ~248-254 quando
      // deveria ser ~0-100). Threshold mais agressivo (252) em scale baixo
      // evita falsos positivos de "linha branca" no meio de texto. Em scale
      // alto (>= 1.5) mantém 245 que tolera anti-alias suave nas bordas.
      const blankThreshold = effectiveScale < 1.5 ? 252 : 245

      function isLineBlank(y: number): boolean {
        const rowOffset = y * W * 4
        for (let x = 0; x < W; x += 4) {
          const i = rowOffset + x * 4
          // RGB médio
          const avg = (data[i] + data[i + 1] + data[i + 2]) / 3
          if (avg < blankThreshold) return false
        }
        return true
      }

      // Margens em canvas px proporcionais ao scale REAL aplicado pelo html2canvas.
      // CRÍTICO: usar effectiveScale (não scale), pois quando o conteúdo é longo
      // o cap Skia reduz scale (pode chegar a 0.5). Usar 'scale' aqui causava
      // margens 5x maiores em CSS px → findCutY cortava no início da página.
      const marginBeforePx = Math.ceil(30 * effectiveScale)
      const marginAfterPx = Math.ceil(16 * effectiveScale)

      function isInsideNoBreak(y: number, sliceStartY?: number): { inside: boolean; topY?: number; bottomY?: number } {
        for (const r of noBreakCanvasRanges) {
          if (y >= r.top && y <= r.bottom) {
            const blockHeight = r.bottom - r.top
            if (blockHeight > sliceHeightPx * 0.95) {
              const startY = sliceStartY ?? 0
              if (r.top - startY > sliceHeightPx * 0.05) {
                return { inside: true, topY: r.top, bottomY: r.bottom }
              }
              continue
            }
            return { inside: true, topY: r.top, bottomY: r.bottom }
          }
        }
        return { inside: false }
      }

      function findCutY(idealY: number, maxY: number, sliceStart: number): number {
        let y = idealY
        // Mínimo de 40% da página preenchida — evita páginas com pouco conteúdo
        const minFillPx = Math.floor(sliceHeightPx * 0.40)
        const minAcceptableY = sliceStart + minFillPx

        // Step 1: resolver no-break collisions. NUNCA volta pra antes do mínimo;
        // se proposta de subida violaria minFillPx, vai pra DEPOIS do bloco.
        for (let iter = 0; iter < 10; iter++) {
          const r = isInsideNoBreak(y, sliceStart)
          if (!r.inside) break
          const proposedUp = r.topY! - marginBeforePx
          if (proposedUp >= minAcceptableY) {
            y = proposedUp
          } else {
            // Cortar acima deixaria página com <40%. Vai depois do bloco.
            y = r.bottomY! + marginAfterPx
          }
        }

        // Step 1.5: se após 10 iterações y ainda cai em range (items muito
        // densos: gap CSS ~12px < margem 27px), busca o GAP entre items mais
        // próximo de idealY sem aplicar margem. Sai do loop infinito de
        // oscilação que deixa página com fill baixo.
        if (isInsideNoBreak(y, sliceStart).inside) {
          // Ordena ranges por top pra achar gaps
          const sorted = [...noBreakCanvasRanges]
            .filter(r => r.bottom >= sliceStart && r.top <= maxY)
            .sort((a, b) => a.top - b.top)
          // Gaps são pontos ENTRE ranges (e antes do primeiro / depois do último)
          const candidates: number[] = []
          let prevBottom = sliceStart
          for (const r of sorted) {
            if (r.top > prevBottom) {
              const gapCenter = Math.floor((prevBottom + r.top) / 2)
              if (gapCenter >= minAcceptableY && gapCenter <= maxY) {
                candidates.push(gapCenter)
              }
            }
            prevBottom = Math.max(prevBottom, r.bottom)
          }
          if (prevBottom < maxY) candidates.push(Math.min(maxY, prevBottom + 1))
          // Escolhe candidato mais próximo de idealY (preferindo abaixo > acima)
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const da = Math.abs(a - idealY)
              const db = Math.abs(b - idealY)
              return da - db
            })
            y = candidates[0]
          }
        }

        // Step 2: refina buscando linha branca próxima
        const lookBack = Math.floor(sliceHeightPx * 0.10)
        const lookAhead = Math.floor(sliceHeightPx * 0.02)
        const minY = Math.max(y - lookBack, minAcceptableY)
        const maxYClamp = Math.min(y + lookAhead, maxY - 1)

        // Defesa: scan window inteira abaixo do mínimo → descarta refino
        if (maxYClamp < minAcceptableY) {
          return Math.max(y, minAcceptableY)
        }

        let bestY = -1
        let bestRunLen = 0
        let runStart = -1
        for (let y2 = minY; y2 <= maxYClamp; y2++) {
          // Skip Y que cai em no-break (pode ter linha branca dentro de bloco branco)
          if (isInsideNoBreak(y2, sliceStart).inside) {
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

        // Garantia final: nunca devolver corte que viole minFillPx
        const finalY = bestY > 0 ? bestY : y
        return Math.max(finalY, minAcceptableY)
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
          let cutY = findCutY(idealY, canvas.height, yPx)
          // CLAMP: nunca cortar DEPOIS de idealY (= ultrapassa altura A4 → fatia
          // desenha por cima do footer). Se findCutY propôs ir além (caso de
          // item maior que página), força em idealY mesmo dentro de no-break.
          if (cutY > idealY) cutY = idealY
          const fillPct = ((cutY - yPx) / sliceHeightPx * 100).toFixed(0)
          console.log(`[pdf] page ${pageIdx + 1}: cut ${cutY}/${canvas.height} (slice=${cutY - yPx}px, fill=${fillPct}%)`)
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
        // Páginas 2+: desloca conteúdo 3mm pra baixo pra não colar na faixa verde (1.5mm)
        const topOffset = pageIdx > 0 ? 3 : 0
        pdf.addImage(imgData, 'PNG', 0, topOffset, pageWidthMm, sliceHeightMm, undefined, 'FAST')

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
 * Amostra ~50 pontos espalhados pelo canvas. Se >98% forem branco puro,
 * considera o canvas "em branco" (bug do Chrome/Skia quando excede 16384px).
 */
function isCanvasMostlyBlank(canvas: HTMLCanvasElement | null): boolean {
  if (!canvas || canvas.width === 0 || canvas.height === 0) return true
  try {
    const ctx = canvas.getContext('2d')
    if (!ctx) return false
    const samples = 50
    let blank = 0
    for (let i = 0; i < samples; i++) {
      const x = Math.floor(Math.random() * canvas.width)
      const y = Math.floor(Math.random() * canvas.height)
      const px = ctx.getImageData(x, y, 1, 1).data
      // Pixel branco puro (R=G=B=255) OU transparente
      if ((px[0] >= 253 && px[1] >= 253 && px[2] >= 253) || px[3] === 0) {
        blank++
      }
    }
    return blank / samples > 0.98
  } catch {
    return false  // se não conseguir ler, assume que ta OK
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
