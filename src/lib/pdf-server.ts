// Chama /api/gerar-pdf — gera PDF server-side via Puppeteer + Chrome.
// Vantagem: PDF nativo vetorial (texto selecionável, zoom infinito), zero
// dependência de html2canvas (que falha em iOS Safari/PWA).
//
// Cold start ~5-10s na primeira chamada após inatividade. Warm: 2-4s.
//
// Se falhar, deve cair pro fallback client-side (gerarPdfDoPreview).

import { supabase } from '@/lib/supabase'
import type { OrcamentoPreviewProps } from '@/components/OrcamentoPreview'

export async function gerarPdfServerSide(previewProps: OrcamentoPreviewProps): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sem sessão ativa — relogue')

  // AbortController com timeout de 75s — Puppeteer cold start no Vercel pode
  // levar até ~50s. Sem AbortController, o fetch usaria timeout default do
  // browser (~30s) e cairia pro fallback DOCX antes do Puppeteer terminar.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 75000)
  const t0 = Date.now()
  try {
    const res = await fetch('/api/gerar-pdf', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ previewProps }),
      signal: controller.signal,
    })

    if (!res.ok) {
      let detail = ''
      try {
        const j = await res.json()
        detail = j.detail || j.error || String(res.status)
      } catch {
        detail = await res.text().catch(() => String(res.status))
      }
      console.warn(`[pdf-server] HTTP ${res.status} em ${Date.now() - t0}ms: ${detail}`)
      throw new Error(`server PDF falhou: HTTP ${res.status} — ${detail}`)
    }

    const blob = await res.blob()
    console.log(`[pdf-server] OK em ${Date.now() - t0}ms (${blob.size} bytes)`)
    return blob
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      throw new Error(`server PDF timeout (${Date.now() - t0}ms > 75s)`)
    }
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}
