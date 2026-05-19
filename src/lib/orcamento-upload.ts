// Helper pra subir orcamento via signed URLs (server-side).
// Por que: upload direto via supabase.storage.upload() estava falhando
// silenciosamente no PWA (provavelmente JWT stale). Signed URLs eliminam
// dependencia de RLS/session — sao tokens curtos por arquivo.
import { supabase } from './supabase'

export interface OrcamentoUploadInput {
  orcamentoId: number
  numero: string
  ano: string
  mes: string
  base: string
  vendedorNome: string
  clienteNome: string
  docxBlob: Blob
  docxEditavelBlob: Blob
  pdfBlob: Blob | null
  txtBlob: Blob
  sendWhatsApp: boolean
  whatsAppCaption?: string
  /** Callback opcional pra mostrar progresso no UI ("Enviando docx (2.4MB)...") */
  onProgress?: (step: string) => void
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

// fetch com timeout. iOS Safari pode pendurar requests indefinidamente.
async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: ac.signal })
  } finally {
    clearTimeout(t)
  }
}

async function putSigned(file: PresignedFile, blob: Blob, contentType: string, label: string): Promise<void> {
  const sizeKb = Math.round(blob.size / 1024)
  let lastErr: Error | null = null
  const MAX_ATTEMPTS = 4
  const TIMEOUT_MS = 180_000  // 180s pra rede mobile ruim + PDF pesado
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now()
    try {
      const r = await fetchWithTimeout(file.url, {
        method: 'PUT',
        headers: { 'content-type': contentType, 'x-upsert': 'true' },
        body: blob,
      }, TIMEOUT_MS)
      if (!r.ok) {
        const text = await r.text().catch(() => '')
        throw new Error(`HTTP ${r.status}: ${text.slice(0, 200)}`)
      }
      console.log(`[upload-${label}] ✅ ${sizeKb}KB em ${Date.now() - t0}ms (tentativa ${attempt})`)
      return
    } catch (e) {
      lastErr = e as Error
      const ms = Date.now() - t0
      const isAbort = lastErr.name === 'AbortError' || /abort/i.test(lastErr.message)
      console.warn(`[upload-${label}] ❌ tentativa ${attempt}/${MAX_ATTEMPTS} falhou em ${ms}ms: ${isAbort ? `TIMEOUT ${TIMEOUT_MS / 1000}s` : lastErr.message}`)
      if (attempt < MAX_ATTEMPTS) {
        // Backoff exponencial: 1.5s, 4s, 10s
        const delay = 1500 * Math.pow(2.5, attempt - 1)
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastErr || new Error(`upload ${label} falhou`)
}

export async function uploadOrcamentoViaServer(input: OrcamentoUploadInput): Promise<OrcamentoUploadResult> {
  const log = (s: string) => { console.log(`[orc-upload] ${s}`); input.onProgress?.(s) }

  // 1. Pega JWT do usuario logado. Refresh se stale.
  log('Verificando sessao...')
  let { data: sess } = await supabase.auth.getSession()
  let jwt = sess?.session?.access_token
  if (!jwt) {
    // Tenta refresh — pode ser que session esta no localStorage mas expired
    const { data: refreshed } = await supabase.auth.refreshSession()
    jwt = refreshed?.session?.access_token
  }
  if (!jwt) throw new Error('Sessao expirada. Faca login de novo (saia e entre).')

  // 2. /api/orcamento-presign
  log('Solicitando URLs de upload...')
  const presignR = await fetchWithTimeout('/api/orcamento-presign', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      ano: input.ano, mes: input.mes, base: input.base,
      vendedor_nome: input.vendedorNome,
      withWhatsApp: input.sendWhatsApp,
    }),
  }, 30_000)
  if (!presignR.ok) {
    const text = await presignR.text().catch(() => '')
    throw new Error(`presign HTTP ${presignR.status}: ${text.slice(0, 200)}`)
  }
  const presign = await presignR.json() as PresignResponse
  console.log('[orc-upload] presign OK')

  // 3. Sobe em PARALELO via signed URLs
  const docxKB = Math.round(input.docxBlob.size / 1024)
  const pdfKB = input.pdfBlob ? Math.round(input.pdfBlob.size / 1024) : 0
  log(`Subindo ${docxKB}KB docx${pdfKB ? ` + ${pdfKB}KB pdf` : ''}...`)

  const docxMime = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  const ops: Array<{ label: string; promise: Promise<void> }> = [
    { label: 'docx', promise: putSigned(presign.docx, input.docxBlob, docxMime, 'docx') },
    { label: 'docxEditavel', promise: putSigned(presign.docxEditavel, input.docxEditavelBlob, docxMime, 'docxEditavel') },
    { label: 'txt', promise: putSigned(presign.txt, input.txtBlob, 'text/plain;charset=utf-8', 'txt') },
  ]
  if (input.pdfBlob && presign.pdf) {
    ops.push({ label: 'pdf', promise: putSigned(presign.pdf, input.pdfBlob, 'application/pdf', 'pdf') })
  }
  if (input.sendWhatsApp && input.pdfBlob && presign.envio) {
    ops.push({ label: 'envio', promise: putSigned(presign.envio, input.pdfBlob, 'application/pdf', 'envio') })
  }

  const results = await Promise.allSettled(ops.map(o => o.promise))
  const falhos = results
    .map((r, i) => ({ r, label: ops[i].label }))
    .filter(x => x.r.status === 'rejected')

  // docx e o critico — se falhar, propaga
  const docxResult = results[0]
  if (docxResult.status === 'rejected') {
    const reason: any = docxResult.reason
    throw new Error('Upload do .docx falhou: ' + (reason?.message || reason))
  }
  if (falhos.length > 0) {
    log(`Aviso: ${falhos.length}/${ops.length} uploads falharam (${falhos.map(f => f.label).join(', ')})`)
  }

  // 4. /api/orcamento-confirm — atualiza status + dispara WhatsApp
  log('Confirmando + WhatsApp...')
  const primeiroNome = input.vendedorNome.trim().split(/\s+/)[0]?.toUpperCase()
  const confirmR = await fetchWithTimeout('/api/orcamento-confirm', {
    method: 'POST',
    headers: { 'authorization': `Bearer ${jwt}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      orcamento_id: input.orcamentoId,
      ano: input.ano, mes: input.mes, base: input.base,
      send_whatsapp: input.sendWhatsApp && input.pdfBlob != null,
      whatsapp_envio_path: presign.envio?.path,
      whatsapp_caption: input.whatsAppCaption,
      whatsapp_filename: `${input.base}.pdf`,
      vendedor_nome: primeiroNome,
      cliente_nome: input.clienteNome,
    }),
  }, 60_000)
  if (!confirmR.ok) {
    const text = await confirmR.text().catch(() => '')
    throw new Error(`confirm HTTP ${confirmR.status}: ${text.slice(0, 200)}`)
  }
  const confirm = await confirmR.json()
  console.log('[orc-upload] confirm OK:', confirm)

  return {
    ok: true,
    arquivos: confirm.arquivos || [],
    whatsapp: confirm.whatsapp,
    detalhes: falhos.length > 0 ? `${falhos.map(f => f.label).join(', ')} falharam` : undefined,
  }
}
