// Aplica tag com nome do vendedor no contato do ReplyAgent.
// Se o contato nao existir, CRIA primeiro e depois aplica a tag.

import "jsr:@supabase/functions-js/edge-runtime.d.ts"

const REPLYAGENT_BASE = 'https://ra-bcknd.com/v1'
const REPLYAGENT_API_KEY = Deno.env.get('REPLYAGENT_API_KEY')
  ?? '27326|dwwZOIYwXC7jMhLWoDZT3wV6XCXrI5gAbPw3kc7v13e0af2d'

interface Payload {
  phone: string
  vendor_name: string
  lead_name?: string  // opcional — usado se precisar criar o contato
}

function firstName(s: string): string {
  return (s ?? '').trim().split(/\s+/)[0]
}

function phoneVariants(raw: string): string[] {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return []
  const out = new Set<string>()
  out.add('+' + digits)
  out.add(digits)
  if (digits.startsWith('55') && digits.length >= 12) {
    const ddd = digits.slice(2, 4)
    const rest = digits.slice(4)
    if (rest.startsWith('9') && rest.length === 9) {
      const semNove = '55' + ddd + rest.slice(1)
      out.add('+' + semNove); out.add(semNove)
    }
    if (rest.length === 8) {
      const comNove = '55' + ddd + '9' + rest
      out.add('+' + comNove); out.add(comNove)
    }
  }
  return Array.from(out)
}

// Garante telefone em formato E.164 (+55...)
function normalizePhoneE164(raw: string): string {
  const digits = (raw ?? '').replace(/\D/g, '')
  if (!digits) return ''
  return '+' + digits
}

async function fetchContact(phone: string): Promise<number | null> {
  const res = await fetch(`${REPLYAGENT_BASE}/fetch-contacts-by-whatsapp`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLYAGENT_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ whatsapp_number: phone }),
  })
  if (!res.ok) return null
  const data = await res.json().catch(() => null)
  if (!data) return null
  const list = Array.isArray(data) ? data : (data.contacts ?? data.data ?? [])
  if (Array.isArray(list) && list.length > 0 && list[0]?.id) return Number(list[0].id)
  if (data.id) return Number(data.id)
  return null
}

async function createContact(phone: string, name: string): Promise<{ id: number | null; status: number; body: string }> {
  const e164 = normalizePhoneE164(phone)
  const [first, ...rest] = (name || '').trim().split(/\s+/)
  const last = rest.join(' ')
  const payload = {
    first_name: first || 'Lead',
    last_name: last || '',
    locale: 'pt-BR',
    phone_number: e164,
    primary_phone_number: e164,
    whatsapp_number: e164,
    primary_whatsapp_number: e164,
    opt_in_call: true,
  }
  const res = await fetch(`${REPLYAGENT_BASE}/contact`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLYAGENT_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(payload),
  })
  const body = await res.text()
  if (!res.ok) return { id: null, status: res.status, body: body.slice(0, 300) }
  try {
    const data = JSON.parse(body)
    const id = data?.id ?? data?.contact?.id ?? data?.data?.id ?? null
    return { id: id ? Number(id) : null, status: res.status, body }
  } catch {
    return { id: null, status: res.status, body }
  }
}

async function applyTag(contactId: number, tag: string): Promise<{ ok: boolean; status: number; body: string }> {
  const res = await fetch(`${REPLYAGENT_BASE}/contacts/${contactId}/tag`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${REPLYAGENT_API_KEY}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({ tag }),
  })
  const body = await res.text()
  return { ok: res.ok, status: res.status, body }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  let body: Payload
  try { body = await req.json() as Payload } catch {
    return Response.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const phone  = (body.phone ?? '').toString()
  const vendor = (body.vendor_name ?? '').toString()
  const lead   = (body.lead_name ?? '').toString()
  if (!phone || !vendor) {
    return Response.json({ success: false, error: 'phone and vendor_name required' }, { status: 400 })
  }

  const tag = firstName(vendor)
  if (!tag) return Response.json({ success: false, error: 'vendor_name vazio' }, { status: 400 })

  // 1) Tenta achar contato
  const variants = phoneVariants(phone)
  let contactId: number | null = null
  let phoneUsado: string | null = null
  for (const v of variants) {
    const id = await fetchContact(v)
    if (id) { contactId = id; phoneUsado = v; break }
  }

  let created = false
  // 2) Se nao existe, cria
  if (!contactId) {
    const created_ = await createContact(phone, lead)
    if (created_.id) {
      contactId = created_.id
      phoneUsado = normalizePhoneE164(phone)
      created = true
    } else {
      return Response.json({
        success: false,
        error: 'contact_create_failed',
        phone_tried: variants,
        tag,
        replyagent_status: created_.status,
        replyagent_body: created_.body.slice(0, 300),
      }, { status: 502 })
    }
  }

  // 3) Aplica tag
  const r = await applyTag(contactId, tag)
  if (!r.ok) {
    return Response.json({
      success: false,
      error: 'tag_apply_failed',
      contact_id: contactId,
      created,
      tag,
      replyagent_status: r.status,
      replyagent_body: r.body.slice(0, 300),
    }, { status: 502 })
  }

  return Response.json({
    success: true,
    contact_id: contactId,
    tag,
    phone_usado: phoneUsado,
    created,
  })
})
