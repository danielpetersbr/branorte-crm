// Proxy CRM -> Gotenberg pra evitar CORS no browser.
// O frontend POSTa o .docx multipart e recebemos o PDF de volta.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts'

const GOTENBERG_URL = Deno.env.get('GOTENBERG_URL') || 'https://branorte-gotenberg.onrender.com'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    // Recebe o multipart com o .docx, repassa pro Gotenberg sem mexer
    const incoming = await req.formData()
    const file = incoming.get('files') || incoming.get('file') || incoming.get('docx')
    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: 'missing_file', hint: 'envie campo "files" com .docx' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    // Reconstroi multipart pra Gotenberg
    const fwdForm = new FormData()
    fwdForm.append('files', file, file.name || 'orcamento.docx')

    const upstream = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      body: fwdForm,
      // Tolera cold start do Render (free tier dorme apos 15min)
      signal: AbortSignal.timeout(150_000),
    })

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => '')
      return new Response(JSON.stringify({
        error: 'gotenberg_failed',
        status: upstream.status,
        detail: errText.slice(0, 500),
      }), {
        status: 502,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const pdfBuf = await upstream.arrayBuffer()
    return new Response(pdfBuf, {
      headers: {
        ...cors,
        'Content-Type': 'application/pdf',
        'Content-Length': String(pdfBuf.byteLength),
      },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: 'proxy_error', message: msg }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
