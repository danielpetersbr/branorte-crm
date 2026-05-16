// Helper pra subir orcamento via signed URLs (server-side).
// Por que: upload direto via supabase.storage.upload() estava falhando
// silenciosamente no PWA (provavelmente JWT stale). Signed URLs eliminam
// dependencia de RLS/session — sao tokens curtos por arquivo.
import { supabase } from './supabase'

export interface OrcamentoUploadInput {
  orcamentoId: number
  numero: string         // '2026 - 0795'
  ano: string            // '2026'
  mes: string            // '05'
  base: string           // '2026 - 0795 - Cliente (Descricao)' (sem extensao)
  vendedorNome: string   // 'Daniel Peters' (nome completo)
  clienteNome: string
  docxBlob: Blob
  docxEditavelBlob: Blob
  pdfBlob: Blob | null
  txtBlob: Blob
  // WhatsApp
  sendWhatsApp: boolean
  whatsAppCaption?: string
}

export interface OrcamentoUploadResult {
  ok: boolean
  arquivos: string[]
  whatsapp?: { ok: boolean; msg?: string; error?: string }
  detalhes?: string
}

interface PresignedFile { path: string; token: string; url: string }
interface PresignResponse {
  ok: true
  docx: PresignedFile
  docxEditavel: PresignedFile
  pdf: PresignedFile
  txt: PresignedFile
  envio?: PresignedFile
}

// Faz PUT no signed URL. Supabase aceita PUT direto com header `x-upsert: true`.
async function putSigned(file: PresignedFile, blob: Blob, contentType: string, label: string): Promise<void> {
  const t0 = Date.now()
  // Retry 2x — rede mobile pode ser instavel
  let lastErr: Error | null = null
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const r = await fetch(file.url, {
        method: 'PUT',
        headers: {
          'content-type': contentType,
          'x-upsert': 'true',
        },
        body: blob,
      })
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`)
      }
      console.log(`[upload-${label}] OK em ${Date.now() - t0}ms (${blob.size} bytes)`)
      return
    } catch (e) {
      lastErr = e as Error
      console.warn(`[upload-${label}] tentativa ${attempt} falhou:`, lastErr.message)
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500))
    }
  }
  throw lastErr || new Error(`upload ${label} falhou`)
}

export async function uploadOrcamentoViaServer(input: OrcamentoUploadInput): Promise<OrcamentoUploadResult> {
  // 1. Pega JWT do usuario logado
  const { data: sess } = await supabase.auth.getSession()
  const jwt = sess?.session?.access_token
  if (!jwt) throw new Error('Sessao expirada. Faca login de novo.')

  // 2. Solicita signed URLs ao endpoint /api/orcamento-presign
  console.log('[orc-upload] solicitando presign...')
  const presignR = await fetch('/api/orcamento-presign', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      ano: input.ano,
      mes: input.mes,
      base: input.base,
      vendedor_nome: input.vendedorNome,
      withWhatsApp: input.sendWhatsApp,
    }),
  })
  if (!presignR.ok) {
    const text = await presignR.text().catch(() => '')
    throw new Error(`presign HTTP ${presignR.status}: ${text.slice(0, 200)}`)
  }
  const presign = await presignR.json() as PresignResponse
  console.log('[orc-upload] presign OK, subindo arquivos...')

  // 3. Sobe em PARALELO via signed URLs (Supabase Storage direto, sem limite Vercel)
  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const uploads: Array<Promise<void>> = [
    putSigned(presign.docx, input.docxBlob, docxMime, 'docx'),
    putSigned(presign.docxEditavel, input.docxEditavelBlob, docxMime, 'docxEditavel'),
    putSigned(presign.txt, input.txtBlob, 'text/plain;charset=utf-8', 'txt'),
  ]
  if (input.pdfBlob && presign.pdf) {
    uploads.push(putSigned(presign.pdf, input.pdfBlob, 'application/pdf', 'pdf'))
  }
  if (input.sendWhatsApp && input.pdfBlob && presign.envio) {
    uploads.push(putSigned(presign.envio, input.pdfBlob, 'application/pdf', 'envio'))
  }

  // Aguarda todos. Se docx/envio falhar, propaga; se pdf/txt falhar, log mas continua
  // (PDF/TXT sao auxiliares — DOCX e o que conta pra Z:\)
  const results = await Promise.allSettled(uploads)
  const docxOk = results[0]?.status === 'fulfilled'
  if (!docxOk) {
    const reason = (results[0] as PromiseRejectedResult).reason
    throw new Error('Upload do .docx falhou: ' + (reason?.message || reason))
  }
  // Outros falhos vao como warning
  const falhos = results
    .map((r, i) => ({ r, label: ['docx', 'docxEditavel', 'txt', 'pdf', 'envio'][i] }))
    .filter(x => x.r.status === 'rejected')
  if (falhos.length > 0) {
    console.warn('[orc-upload] uploads falhos:', falhos.map(f => f.label).join(', '))
  }

  // 4. Confirma upload + dispara WhatsApp opcional
  const primeiroNome = input.vendedorNome.trim().split(/\s+/)[0]?.toUpperCase()
  console.log('[orc-upload] confirmando + whatsapp...')
  const confirmR = await fetch('/api/orcamento-confirm', {
    method: 'POST',
    headers: {
      'authorization': `Bearer ${jwt}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      orcamento_id: input.orcamentoId,
      ano: input.ano,
      mes: input.mes,
      base: input.base,
      send_whatsapp: input.sendWhatsApp && input.pdfBlob != null,
      whatsapp_envio_path: presign.envio?.path,
      whatsapp_caption: input.whatsAppCaption,
      whatsapp_filename: `${input.base}.pdf`,
      vendedor_nome: primeiroNome,
      cliente_nome: input.clienteNome,
    }),
  })
  if (!confirmR.ok) {
    const text = await confirmR.text().catch(() => '')
    throw new Error(`confirm HTTP ${confirmR.status}: ${text.slice(0, 200)}`)
  }
  const confirm = await confirmR.json()
  console.log('[orc-upload] tudo OK:', confirm)

  return {
    ok: true,
    arquivos: confirm.arquivos || [],
    whatsapp: confirm.whatsapp,
    detalhes: falhos.length > 0 ? `Avisos: ${falhos.map(f => f.label).join(', ')} falharam` : undefined,
  }
}
