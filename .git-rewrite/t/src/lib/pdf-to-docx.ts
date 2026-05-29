// Converte PDF blob -> DOCX blob via /api/orcamento-pdf-to-docx (ConvertAPI).
// Estrategia: PDF gerado por Puppeteer ja sai pixel-perfect. Conversao
// ConvertAPI mantem ~95% fidelidade visual e texto vira EDITAVEL.

const PDF_TO_DOCX_TIMEOUT_MS = 60_000  // ConvertAPI demora 3-5s pra 4 paginas

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = String(reader.result || '')
      // dataURL formato: "data:application/pdf;base64,XXXX"
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function convertPdfToDocx(pdfBlob: Blob, filename = 'orcamento.pdf'): Promise<Blob> {
  const t0 = Date.now()
  const pdfBase64 = await blobToBase64(pdfBlob)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), PDF_TO_DOCX_TIMEOUT_MS)
  try {
    const r = await fetch('/api/orcamento-pdf-to-docx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pdfBase64, filename }),
      signal: ac.signal,
    })
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      let parsed: any = null
      try { parsed = JSON.parse(text) } catch {}
      const detail = parsed?.detail || text.slice(0, 300)
      throw new Error(`pdf-to-docx HTTP ${r.status}: ${detail}`)
    }
    const docxBlob = await r.blob()
    console.log(`[convertPdfToDocx] OK ${Math.round(docxBlob.size / 1024)}KB em ${Date.now() - t0}ms`)
    return docxBlob
  } finally {
    clearTimeout(timer)
  }
}
