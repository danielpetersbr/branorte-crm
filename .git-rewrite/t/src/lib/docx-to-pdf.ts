// Converte um .docx blob em PDF blob, renderizando o .docx em HTML fiel
// (via docx-preview) e capturando cada página com html2canvas → jsPDF.
//
// Vantagem: o PDF resultante é IDÊNTICO ao .docx (mesmo formato, fonte,
// imagens, layout) porque é um snapshot da renderização real.

import jsPDF from 'jspdf'
import { renderAsync } from 'docx-preview'
import html2canvas from 'html2canvas'

interface ConvertOptions {
  pageWidth?: number    // mm, default A4 (210)
  pageHeight?: number   // mm, default A4 (297)
  margin?: number       // mm, default 0
  scale?: number        // html2canvas scale, default 2 (high-DPI)
}

export async function docxParaPdf(docxBlob: Blob, opts: ConvertOptions = {}): Promise<Blob> {
  const pageWidth = opts.pageWidth ?? 210
  const pageHeight = opts.pageHeight ?? 297
  const margin = opts.margin ?? 0
  const scale = opts.scale ?? 2

  // Container hidden mas COM dimensão A4 fixa pra docx-preview respeitar paginação
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.width = `${pageWidth}mm`
  container.style.background = '#fff'
  container.style.zIndex = '-1'
  document.body.appendChild(container)

  try {
    // Renderiza o .docx
    await renderAsync(docxBlob, container, undefined, {
      className: 'docx-render',
      inWrapper: true,
      ignoreWidth: false,
      ignoreHeight: false,
      ignoreFonts: false,
      breakPages: true,
      ignoreLastRenderedPageBreak: false,
      experimental: false,
      trimXmlDeclaration: true,
      useBase64URL: true,
    })

    // Aguarda fontes + imagens
    await new Promise(r => setTimeout(r, 500))

    // Acha as paginas — docx-preview usa .docx > section > article (variante)
    // ou .docx-wrapper > section. Tenta varios seletores.
    const wrapper = container.querySelector('.docx-wrapper, .docx') as HTMLElement | null
    let pageElements: HTMLElement[] = []
    if (wrapper) {
      // Primeira tentativa: section/article filhos do wrapper
      pageElements = Array.from(wrapper.querySelectorAll(':scope > section, :scope > article')) as HTMLElement[]
      if (pageElements.length === 0) {
        // Sem section/article — pode ter divs com data-page ou similar
        pageElements = Array.from(wrapper.children) as HTMLElement[]
      }
    }
    if (pageElements.length === 0) {
      pageElements = [container]
    }

    // Cria PDF
    const pdf = new jsPDF({ unit: 'mm', format: [pageWidth, pageHeight], orientation: 'portrait' })

    // Captura cada pagina renderizada
    for (let i = 0; i < pageElements.length; i++) {
      const page = pageElements[i]
      // Pega dimensões REAIS da página (em pixels)
      const rect = page.getBoundingClientRect()
      if (rect.width < 50 || rect.height < 50) continue  // skip elementos vazios

      const canvas = await html2canvas(page, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
        width: rect.width,
        height: rect.height,
        windowWidth: rect.width,
        windowHeight: rect.height,
      })

      const imgData = canvas.toDataURL('image/jpeg', 0.92)

      // Aspect ratio da pagina capturada
      const canvasAspect = canvas.width / canvas.height
      const pageAvailW = pageWidth - margin * 2
      const pageAvailH = pageHeight - margin * 2
      const pdfAspect = pageAvailW / pageAvailH

      let imgW: number, imgH: number
      if (canvasAspect > pdfAspect) {
        // Pagina capturada e mais larga que PDF — fit por largura
        imgW = pageAvailW
        imgH = imgW / canvasAspect
      } else {
        // Mais alta — fit por altura
        imgH = pageAvailH
        imgW = imgH * canvasAspect
      }
      const x = margin + (pageAvailW - imgW) / 2
      const y = margin

      if (i > 0) pdf.addPage([pageWidth, pageHeight])
      pdf.addImage(imgData, 'JPEG', x, y, imgW, imgH, undefined, 'FAST')
    }

    return pdf.output('blob')
  } finally {
    try { document.body.removeChild(container) } catch {}
  }
}
