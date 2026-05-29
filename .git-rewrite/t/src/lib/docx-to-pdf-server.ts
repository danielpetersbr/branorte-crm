// Converte DOCX → PDF via API ConvertAPI server-side (/api/orcamento-docx-to-pdf).
// Estratégia: o DOCX é gerado nativamente (gerarOrcamentoCustomDocx). DOCX
// tem layout/paginação perfeitos do Word. A conversão pra PDF mantém isso.
//
// Substitui o gerador client-side html2canvas + jsPDF que tinha vários bugs
// (canvas em branco, fotos sumidas, cortes errados, footer sobreposto).
import { supabase } from '@/lib/supabase'

export async function docxParaPdfServer(docxBlob: Blob, filename = 'orcamento.docx'): Promise<Blob> {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Sem sessão ativa — relogue')

  // Converte blob → base64
  const docxBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      // dataURL: "data:application/...;base64,XXXX" — pega só a parte base64
      const idx = result.indexOf(',')
      resolve(idx >= 0 ? result.slice(idx + 1) : result)
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(docxBlob)
  })

  const res = await fetch('/api/orcamento-docx-to-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ docxBase64, filename }),
  })

  if (!res.ok) {
    let detail = ''
    try {
      const j = await res.json()
      detail = j.detail || j.error || String(res.status)
    } catch {
      detail = await res.text().catch(() => String(res.status))
    }
    throw new Error(`DOCX→PDF server falhou: ${detail}`)
  }

  return res.blob()
}
