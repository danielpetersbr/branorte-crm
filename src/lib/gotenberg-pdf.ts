// Converte .docx em .pdf via Gotenberg (LibreOffice headless).
// Resultado IDÊNTICO ao Word "Salvar como PDF" porque é o mesmo motor.
//
// Setup:
// 1. Deploy gotenberg/gotenberg:8 no Render (ou qualquer Docker host)
// 2. Defina VITE_GOTENBERG_URL=https://branorte-gotenberg.onrender.com no Vercel
// 3. Pronto — PDF gerado automaticamente quando salvar na pasta Z:

const GOTENBERG_URL = ((import.meta as any).env?.VITE_GOTENBERG_URL || '').replace(/\/+$/, '')

export function isGotenbergConfigured(): boolean {
  return !!GOTENBERG_URL
}

export async function gerarPdfDoDocxGotenberg(docxBlob: Blob): Promise<Blob> {
  if (!GOTENBERG_URL) {
    throw new Error('Gotenberg não configurado: defina VITE_GOTENBERG_URL no Vercel')
  }

  const form = new FormData()
  form.append('files', docxBlob, 'orcamento.docx')
  // Garante PDF/A-1b pra arquivamento (opcional, comente se causar problemas)
  // form.append('pdfa', 'PDF/A-1b')

  const r = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
    method: 'POST',
    body: form,
    // free tier do Render dorme após 15min — cold start até 60s
    signal: AbortSignal.timeout(120_000),
  })

  if (!r.ok) {
    const errorText = await r.text().catch(() => '')
    throw new Error(`Gotenberg falhou (${r.status}): ${errorText.slice(0, 200)}`)
  }

  return await r.blob()
}
