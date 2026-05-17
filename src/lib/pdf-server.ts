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

  const res = await fetch('/api/gerar-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ previewProps }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j.detail || j.error || String(res.status)
    } catch {
      detail = await res.text().catch(() => String(res.status))
    }
    throw new Error(`server PDF falhou: ${detail}`)
  }

  return res.blob()
}
