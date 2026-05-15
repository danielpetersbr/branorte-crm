// Converte .docx em .pdf via Edge Function (Supabase) que faz proxy pro Gotenberg.
// Edge Function resolve o CORS — chamada direta do browser pro Render falha.
//
// Resultado IDÊNTICO ao Word "Salvar como PDF" porque Gotenberg usa LibreOffice
// (mesmo motor que Word usa quando exporta PDF).

import { supabase } from '@/lib/supabase'

// Sempre ON quando supabase tá configurado (URL/key sempre populados no CRM)
export function isGotenbergConfigured(): boolean {
  return true
}

export async function gerarPdfDoDocxGotenberg(docxBlob: Blob): Promise<Blob> {
  const form = new FormData()
  form.append('files', docxBlob, 'orcamento.docx')

  // supabase.functions.invoke retorna { data, error } — usa fetch direto pra ler binary PDF
  const { data: sessao } = await supabase.auth.getSession()
  const token = sessao.session?.access_token
  if (!token) throw new Error('Sessão expirou. Faça login de novo.')

  const url = `${(import.meta as any).env.VITE_SUPABASE_URL || 'https://flwbeevtvjiouxdjmziv.supabase.co'}/functions/v1/docx-to-pdf`
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(180_000),  // 3min — tolera cold start do Render
  })

  if (!r.ok) {
    let detail = ''
    try {
      const j = await r.json()
      detail = j.detail || j.message || j.error || ''
    } catch {}
    throw new Error(`PDF não gerado (${r.status})${detail ? ': ' + detail.slice(0, 200) : ''}`)
  }
  return await r.blob()
}
