// Renderiza OrcamentoPreview num div oculto, captura HTML com COMPUTED STYLES
// inlined, manda pro endpoint /api/orcamento-html-to-docx que converte com
// html-to-docx. Resultado: DOCX editavel ~85-90% identico ao preview React.
//
// Por que computed styles: o HTML cru tem classes Tailwind (text-gray-700,
// border-b-2, etc) que NAO chegam no servidor (sem CSS bundle). Computed styles
// resolvem isso: pegamos a representacao final (color: rgb(55,65,81); border-bottom:
// 2px solid rgb(31,41,55)) e mandamos inline no style="..." de cada elemento.

import { createRoot } from 'react-dom/client'
import { createElement } from 'react'
import {
  OrcamentoPreview,
  type OrcamentoPreviewProps,
} from '@/components/OrcamentoPreview'

// Propriedades CSS importantes pra um DOCX bonito.
// Ignora as que nao traduzem bem (transform, animation, etc) e foca em layout/cor.
const RELEVANT_PROPS = [
  'font-family', 'font-size', 'font-weight', 'font-style', 'color',
  'background-color', 'background',
  'text-align', 'text-decoration', 'text-transform', 'letter-spacing',
  'line-height',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-color', 'border-style', 'border-width',
  'border-top-color', 'border-bottom-color', 'border-top-width', 'border-bottom-width',
  'border-top-style', 'border-bottom-style',
  'width', 'height', 'max-width', 'min-width',
  'display',
  'vertical-align',
]

/**
 * Walks DOM, computa estilo de cada elemento e cola como inline style.
 * Pula elementos invisiveis (display:none) pra reduzir tamanho.
 */
function inlineComputedStyles(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)
  const elementsToProcess: HTMLElement[] = []
  let node = walker.nextNode() as HTMLElement | null
  while (node) {
    elementsToProcess.push(node)
    node = walker.nextNode() as HTMLElement | null
  }

  for (const el of elementsToProcess) {
    const cs = window.getComputedStyle(el)
    if (cs.display === 'none') {
      el.remove()
      continue
    }
    const styleParts: string[] = []
    for (const prop of RELEVANT_PROPS) {
      const val = cs.getPropertyValue(prop)
      if (val && val !== 'initial' && val !== 'inherit' && val !== 'normal' && val !== 'none' && val !== 'auto') {
        // Filtra valores zerados que poluem (margin: 0px 0px 0px 0px etc)
        if (/^0(px|em|rem|%)?\s*$/.test(val)) continue
        if (/^(rgba?\(0,\s*0,\s*0,\s*0\)|transparent)$/.test(val) && prop.includes('color')) continue
        styleParts.push(`${prop}: ${val}`)
      }
    }
    if (styleParts.length > 0) {
      el.setAttribute('style', styleParts.join('; '))
    }
    // Limpa classes Tailwind (ja foram resolvidas pra computed style)
    el.removeAttribute('class')
  }
}

/**
 * Espera todas as imagens carregarem (CRITICO — html-to-docx precisa de img.src
 * acessivel, e algumas fotos sao Storage signed URLs que demoram a baixar).
 */
function waitForImages(root: HTMLElement, timeoutMs = 10000): Promise<void> {
  return new Promise((resolve) => {
    const imgs = Array.from(root.querySelectorAll('img'))
    if (imgs.length === 0) return resolve()
    let pending = imgs.length
    const done = () => { if (--pending <= 0) resolve() }
    const t = setTimeout(resolve, timeoutMs)  // never block
    for (const img of imgs) {
      if (img.complete && img.naturalWidth > 0) { done(); continue }
      img.addEventListener('load', () => { done(); if (pending === 0) clearTimeout(t) }, { once: true })
      img.addEventListener('error', () => { done(); if (pending === 0) clearTimeout(t) }, { once: true })
    }
  })
}

/**
 * Converte imgs com src=blob: ou cross-origin pra base64 (html-to-docx no
 * servidor nao consegue baixar de blob: URLs — sao locais ao navegador).
 */
async function inlineImagesAsBase64(root: HTMLElement): Promise<void> {
  const imgs = Array.from(root.querySelectorAll('img'))
  await Promise.all(imgs.map(async (img) => {
    const src = img.src
    if (src.startsWith('data:')) return  // ja inline
    try {
      const blob = await fetch(src, { mode: 'cors' }).then(r => r.blob())
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = reject
        r.readAsDataURL(blob)
      })
      img.src = dataUrl
    } catch (e) {
      console.warn('[html-to-docx] falha ao baixar img:', src, e)
      img.remove()  // remove img que nao carregou — melhor que blob: quebrado
    }
  }))
}

/**
 * Renderiza OrcamentoPreview, extrai HTML com computed styles inlined,
 * manda pro endpoint /api/orcamento-html-to-docx e retorna o DOCX como Blob.
 */
export async function gerarDocxViaHtml(previewProps: OrcamentoPreviewProps): Promise<Blob> {
  const host = document.createElement('div')
  host.style.position = 'fixed'
  host.style.left = '-99999px'
  host.style.top = '0'
  host.style.width = '794px'  // ~210mm @ 96dpi (A4)
  host.style.background = '#ffffff'
  host.style.zIndex = '-1'
  document.body.appendChild(host)

  let root: ReturnType<typeof createRoot> | null = null

  try {
    // 1) Renderiza preview no modo render (sem botoes de edit)
    root = createRoot(host)
    root.render(createElement(OrcamentoPreview, { ...previewProps, renderMode: true }))
    // Espera paint inicial
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))

    // 2) Espera todas as imagens carregarem (foto principal + fotos dos itens)
    await waitForImages(host)

    // 3) Inline imgs como base64 (pro endpoint conseguir embedar no DOCX)
    await inlineImagesAsBase64(host)

    // 4) Inline computed styles em todos os elementos
    inlineComputedStyles(host)

    // 5) Pega HTML final
    const innerHtml = host.innerHTML
    const fullHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family: Calibri, sans-serif; font-size: 11pt; color: #1f2937;">${innerHtml}</body></html>`
    const sizeKb = Math.round(new Blob([fullHtml]).size / 1024)
    console.log(`[gerarDocxViaHtml] HTML pronto: ${sizeKb}KB`)

    // 6) Manda pro endpoint
    const t0 = Date.now()
    const r = await fetch('/api/orcamento-html-to-docx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ html: fullHtml }),
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      throw new Error(`/api/orcamento-html-to-docx HTTP ${r.status}: ${text.slice(0, 300)}`)
    }
    const docxBlob = await r.blob()
    console.log(`[gerarDocxViaHtml] DOCX OK ${Math.round(docxBlob.size / 1024)}KB em ${Date.now() - t0}ms`)
    return docxBlob
  } finally {
    if (root) root.unmount()
    host.remove()
  }
}
