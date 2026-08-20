// orcamento-enviar-meu-zap v7: resolve o vendedor pelo PERFIL do CRM (user_profiles.vendor_id).
// v6 dependia de vendors.email casar com o e-mail do login — e isso furava em dois casos reais:
//   • LUCAS e IGOR não têm vendors.email preenchido (o vínculo só existe em user_profiles);
//   • quem loga com um e-mail diferente do cadastrado (DANIEL loga com daniel.peters.br@gmail.com,
//     mas vendors.email dele é admin@branorte.com) caía em 'sem_telefone'.
// Sem telefone o front parava o vendedor pedindo o número na mão — o envio deixava de ser automático.
// v6: resolve vendedor por telefone com VARIANTES BR (com/sem o 9). v5 fazia .eq exato — vendedor que
// digitava o numero com o 9 (13 digitos) nao casava com o cadastro (12 digitos) => vendedor_nome=
// 'DESCONHECIDO' e NENHUMA extensao pegava a mensagem (caso real: EDILSON JR preso desde 02/07).
// v4: resolve via JWT email + vendors.email.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}

function decodeJwt(token: string): any {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = atob(payload + '='.repeat((4 - payload.length % 4) % 4))
    return JSON.parse(json)
  } catch { return null }
}

// Variantes BR do telefone: 55 DDD 9XXXXXXXX <-> 55 DDD XXXXXXXX (com/sem o 9 movel)
function phoneVariants(d: string): string[] {
  const out = new Set<string>([d])
  if (d.length === 13 && d.startsWith('55') && d[4] === '9') out.add(d.slice(0, 4) + d.slice(5))
  if (d.length === 12 && d.startsWith('55')) out.add(d.slice(0, 4) + '9' + d.slice(4))
  return [...out]
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })

  const body = await req.json().catch(() => ({}))
  const vendedor = String(body.vendedor_nome || '').trim().toUpperCase()
  const telefoneDireto = String(body.telefone_destino || '').replace(/[^\d]/g, '')
  const pdfUrl = String(body.pdf_url || '').trim()
  const filename = String(body.filename || 'orcamento.pdf').trim()
  const clienteNome = String(body.cliente_nome || '').trim()
  const caption = String(body.caption || '').trim()

  if (!pdfUrl) return new Response(JSON.stringify({ error: 'sem_pdf_url' }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })

  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = decodeJwt(authHeader.replace(/^Bearer\s+/i, ''))

  let telefone = ''
  let vendedorResolvido = vendedor
  let via = ''

  // PRIORIDADE 1: telefone_destino direto (vindo da extensão ou do prompt do CRM)
  if (telefoneDireto && telefoneDireto.length >= 10 && telefoneDireto.length <= 15) {
    telefone = telefoneDireto
    via = 'telefone_direto'
  }

  // PRIORIDADE 2: nome do vendedor (passado pelo front)
  if (!telefone && vendedor) {
    const { data: v } = await supa.from('vendors').select('name, telefone').eq('name', vendedor).maybeSingle()
    if (v?.telefone) { telefone = String(v.telefone).replace(/[^\d]/g, ''); vendedorResolvido = v.name; via = 'vendedor_nome' }
  }

  // PRIORIDADE 3: perfil do CRM — user_profiles.vendor_id pelo `sub` do JWT.
  // É o vínculo mais confiável que existe: não depende de e-mail igual nem de a
  // extensão estar respondendo. Cobre os 10 vendedores, inclusive quem não tem
  // vendors.email preenchido.
  if (!telefone && jwt?.sub) {
    const { data: perfil } = await supa.from('user_profiles').select('vendor_id').eq('id', String(jwt.sub)).maybeSingle()
    if (perfil?.vendor_id) {
      const { data: v } = await supa.from('vendors').select('name, telefone').eq('id', perfil.vendor_id).maybeSingle()
      if (v?.telefone) {
        telefone = String(v.telefone).replace(/[^\d]/g, '')
        vendedorResolvido = v.name
        via = 'user_profiles.vendor_id'
      }
    }
  }

  // PRIORIDADE 4: email do JWT (login do branorte-crm) → vendors.email
  if (!telefone) {
    const email = String(jwt?.email || '').toLowerCase().trim()
    if (email) {
      const { data: v } = await supa.from('vendors').select('name, telefone').ilike('email', email).maybeSingle()
      if (v?.telefone) {
        telefone = String(v.telefone).replace(/[^\d]/g, '')
        vendedorResolvido = v.name
        via = 'vendors.email'
      }
    }
  }

  if (!telefone) {
    return new Response(JSON.stringify({
      error: 'sem_telefone',
      detail: 'Não consegui identificar seu telefone. Opções: 1) Admin vincular seu login a um vendedor (user_profiles.vendor_id) 2) Preencher vendors.telefone do seu cadastro 3) Digitar o telefone na mão.',
    }), { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // Se ainda não resolvi o vendedor, tenta pelo telefone — COM VARIANTES (com/sem o 9).
  if (!vendedorResolvido) {
    const { data: vById } = await supa.from('vendors').select('name, telefone')
      .in('telefone', phoneVariants(telefone)).limit(1)
    if (vById && vById.length > 0) {
      vendedorResolvido = vById[0].name
      // Usa o telefone DO CADASTRO como destino: é o formato que a extensão/WhatsApp conhece.
      const telCadastro = String(vById[0].telefone ?? '').replace(/[^\d]/g, '')
      if (telCadastro.length >= 10) telefone = telCadastro
    }
  }
  if (!vendedorResolvido) vendedorResolvido = 'DESCONHECIDO'

  const chatId = `${telefone}@c.us`
  const bodyMsg = caption || `📄 Orçamento ${clienteNome ? '— ' + clienteNome : ''}\n\nGerado em ${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}`

  const { data: sched, error: schErr } = await supa.from('wa_scheduled_messages').insert({
    vendedor_nome: vendedorResolvido,
    chat_id: chatId,
    contato_numero: telefone,
    contato_nome: 'Eu (orçamento)',
    body: bodyMsg,
    media_url: pdfUrl,
    media_filename: filename,
    media_type: 'document',
    scheduled_at: new Date().toISOString(),
    status: 'pending',
  }).select('id').single()

  if (schErr) {
    return new Response(JSON.stringify({ error: 'schedule_failed', detail: schErr.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // Aviso honesto quando o vendedor segue desconhecido: a extensão casa por vendedor_nome,
  // então DESCONHECIDO não seria entregue — melhor o vendedor saber na hora.
  const desconhecido = vendedorResolvido === 'DESCONHECIDO'
  return new Response(JSON.stringify({
    ok: true,
    scheduled_id: sched.id,
    vendedor: vendedorResolvido,
    telefone,
    via,
    msg: desconhecido
      ? `⚠️ Telefone +${telefone} não está no cadastro de vendedores — o envio automático pode não sair. Confira seu número com o admin (/disparos) ou digite o telefone igual ao cadastro.`
      : `Orçamento agendado pra ${vendedorResolvido} (+${telefone}). Chega em até 30s.`,
  }), { headers: { ...CORS, 'content-type': 'application/json' } })
})
