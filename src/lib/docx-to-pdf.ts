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

  // 1) Cria container hidden no DOM pra render
  const container = document.createElement('div')
  container.style.position = 'fixed'
  container.style.left = '-99999px'
  container.style.top = '0'
  container.style.width = '210mm'
  container.style.background = '#fff'
  document.body.appendChild(container)

  try {
    // 2) Renderiza o .docx no container via docx-preview
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

    // Espera fontes/imagens carregarem
    await new Promise(r => setTimeout(r, 250))

    // 3) Acha cada pagina renderizada
    const pages = container.querySelectorAll('.docx-wrapper > section.docx, .docx-wrapper > .docx')
    const pageElements: HTMLElement[] = pages.length > 0
      ? Array.from(pages) as HTMLElement[]
      : [container]

    // 4) Cria PDF e captura cada pagina
    const pdf = new jsPDF({
      unit: 'mm',
      format: [pageWidth, pageHeight],
      orientation: pageHeight > pageWidth ? 'portrait' : 'landscape',
    })

    for (let i = 0; i < pageElements.length; i++) {
      const page = pageElements[i]
      const canvas = await html2canvas(page, {
        scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: '#ffffff',
        logging: false,
      })

      // Calcula dimensões pra caber na pagina mantendo proporção
      const imgData = canvas.toDataURL('image/jpeg', 0.92)
      const aspectRatio = canvas.width / canvas.height
      const pageAvailW = pageWidth - margin * 2
      const pageAvailH = pageHeight - margin * 2
      let imgW = pageAvailW
      let imgH = imgW / aspectRatio
      if (imgH > pageAvailH) {
        imgH = pageAvailH
        imgW = imgH * aspectRatio
      }
      const x = margin + (pageAvailW - imgW) / 2
      const y = margin

      if (i > 0) pdf.addPage([pageWidth, pageHeight])
      pdf.addImage(imgData, 'JPEG', x, y, imgW, imgH, undefined, 'FAST')
    }

    return pdf.output('blob')
  } finally {
    document.body.removeChild(container)
  }
}
