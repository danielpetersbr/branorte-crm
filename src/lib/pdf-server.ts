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

  // Corpo da requisição: o Vercel rejeita bodies acima de ~4.5MB com 413
  // ANTES da função rodar (caso real: orçamento com fotos coladas/trocadas no
  // preview vira data-URL base64 dentro do previewProps). Acima de 3MB, sobe o
  // JSON pro bucket pdf-tmp (prefixo props/, policy authenticated) e manda só
  // o caminho — o servidor baixa de lá.
  const inline = JSON.stringify({ previewProps, responseMode: 'url' })
  let requestBody = inline
  if (inline.length > 3_000_000) {
    const dia = new Date().toISOString().slice(0, 10)
    const propsPath = `props/${dia}/${crypto.randomUUID()}.json`
    const { error: upErr } = await supabase.storage.from('pdf-tmp').upload(
      propsPath,
      new Blob([JSON.stringify(previewProps)], { type: 'application/json' }),
    )
    if (upErr) throw new Error(`upload dos dados do orçamento falhou: ${upErr.message}`)
    console.log(`[pdf-server] previewProps grande (${(inline.length / 1e6).toFixed(1)}MB) — enviado via storage ${propsPath}`)
    requestBody = JSON.stringify({ propsPath, responseMode: 'url' })
  }

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
      body: requestBody,
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
