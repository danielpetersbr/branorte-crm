// Chama /api/gerar-pdf — gera PDF server-side via Puppeteer + Chrome.
// Vantagem: PDF nativo vetorial (texto selecionável, zoom infinito), zero
// dependência de html2canvas (que falha em iOS Safari/PWA).
//
// Cold start ~5-10s na primeira chamada após inatividade. Warm: 2-4s.
//
// responseMode 'url': o servidor sobe o PDF no Storage (bucket pdf-tmp) e
// devolve uma signed URL — o download vem direto do Supabase. Necessário
// porque resposta binária grande (>~10MB, orçamento com muitas fotos) não
// chegava no cliente e o fluxo caía pro fallback html2canvas (modelo antigo).
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
      body: JSON.stringify({ previewProps, responseMode: 'url' }),
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

    const json = await res.json() as { url?: string; size?: number }
    if (!json.url) throw new Error('server PDF: resposta sem url')

    // Baixa o PDF direto do Supabase Storage (sem limite de payload do Vercel)
    const blob = await baixarPdfDaUrl(json.url, json.size)
    console.log(`[pdf-server] OK em ${Date.now() - t0}ms (${blob.size} bytes via signed url)`)
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

async function baixarPdfDaUrl(url: string, expectedSize?: number): Promise<Blob> {
  // Timeout próprio de 90s — PDF de 10MB+ em conexão lenta leva tempo,
  // mas não pode travar a UI pra sempre.
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 90000)
  try {
    const res = await fetch(url, { signal: controller.signal })
    if (!res.ok) throw new Error(`download do PDF falhou: HTTP ${res.status}`)
    const blob = await res.blob()
    if (blob.size === 0) throw new Error('download do PDF veio vazio')
    if (expectedSize && Math.abs(blob.size - expectedSize) > 1024) {
      throw new Error(`download do PDF incompleto (${blob.size} de ${expectedSize} bytes)`)
    }
    return blob
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('download do PDF timeout (90s)')
    throw e
  } finally {
    clearTimeout(timeoutId)
  }
}
