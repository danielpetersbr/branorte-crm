// orcamento-enviar-meu-zap v11: modo `destino: 'cliente'` — a proposta vai pro WhatsApp do
//   CLIENTE, não pro do vendedor.
//   Até a v10 esta função gravava `to_self: true` SEMPRE, e a extensão, ao ver to_self, troca o
//   alvo pelo próprio número (background.js:3191 — `const alvo = msg.to_self ? meuId : msg.chat_id`).
//   O `telefone_destino` do corpo virava enfeite: montava o chat_id e era ignorado na entrega.
//   No fluxo manual isso está CERTO (o vendedor recebe o PDF e repassa; é o que os 4 chamadores
//   do CRM esperam — todos passam o telefone DO VENDEDOR ali).
//   O problema era o worker da IA (ia-orcamento-worker) chamar a MESMA função passando o telefone
//   do CLIENTE: o PDF caía no zap do vendedor e o cliente, que tinha acabado de pedir a proposta
//   na conversa, não recebia nada. Medido em 10/09/2026 nos orçamentos 2026-2534 e 2026-2535 —
//   `to_self=true` com `chat_id` do cliente, entregue na conta do vendedor.
//   Duas consequências do to_self=false, ambas tratadas no ramo novo:
//   • o espaçador anti-ban (trigger BEFORE INSERT) só isenta to_self/@g.us/sys: — sem cuidado a
//     proposta entraria na fila junto com disparo em massa (medido: até 22h de atraso). Por isso
//     o UPDATE scheduled_at=now() logo após o insert: o gatilho é de INSERT, não de UPDATE.
//   • o vendedor deixaria de saber que saiu proposta em nome dele — por isso o aviso to_self.
// v10: grava a TENTATIVA em orcamento_envio_log, não só o sucesso.
//   Até aqui o único registro que existia era a linha em wa_scheduled_messages — ou seja, só
//   o sucesso. Falha sumia: os returns 400 daqui não deixavam rastro, e o /api/orcamento-confirm
//   devolve HTTP 200 mesmo com whatsapp.ok=false. Foi por isso que um defeito de envio ficou
//   semanas invisível, e medir a taxa real exigia cruzar storage.objects com wa_scheduled_messages
//   na mão. Agora "quantos não chegaram hoje" é um SELECT.
//   O log NUNCA derruba o envio: todo insert é best-effort dentro de try/catch.
// v9: marca to_self=true no INSERT. Sem isso (default false) o orçamento entrava na fila do
//   espaçador anti-ban junto com disparo em massa — os dois espaçadores (trigger
//   wa_espacar_no_insert e cron wa_espacar_fila) isentam SÓ to_self, @g.us e sys:. Medido em
//   produção: atrasos de até 22h. Efeito colateral bom: a entrega passa a usar obterMeuWhatsId()
//   em vez de findChat(chat_id), imune a vendors.telefone desatualizado.
// v8: dois defeitos que matavam o envio automático:
//   • CORS: o Allow-Headers só tinha 'authorization, content-type', mas supabase.functions.invoke
//     (FinalizarMontarModal, caminho de save local) manda também x-client-info/apikey — o browser
//     aprovava o preflight e BLOQUEAVA o POST em seguida (OPTIONS sem POST nos logs). IGOR, ALVARO
//     e EDER nunca recebiam o orçamento no WhatsApp por isso.
//   • Nome: o front/confirm passa só o PRIMEIRO nome ('EDILSON'), que não casa com vendors.name
//     'EDILSON JR' — e no caminho servidor o JWT é a service key (sem sub/email), então os
//     fallbacks por perfil nunca rodavam => 400 sem_telefone. Agora: match exato e, se falhar,
//     prefixo ÚNICO (ilike 'EDILSON%' => 'EDILSON JR'; só aceita se achar exatamente 1).
// v7: resolve o vendedor pelo PERFIL do CRM (user_profiles.vendor_id).
// v6: resolve vendedor por telefone com VARIANTES BR (com/sem o 9).
// v4: resolve via JWT email + vendors.email.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Max-Age': '86400',
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
  // Opcionais, só pro log ficar legível: quem chamou manda se souber.
  const numero = String(body.numero || '').trim() || null
  const origem = String(body.origem || '').trim() || 'edge'
  // v11 — destino explícito. Sem isto, comportamento idêntico ao de sempre (vai pro vendedor).
  // `telefone_cliente` é campo PRÓPRIO de propósito: `telefone_destino` já significa "o zap do
  // vendedor" nos 4 chamadores do CRM, e reaproveitar o nome pra outra coisa é como o bug nasceu.
  const paraCliente = String(body.destino || '').trim().toLowerCase() === 'cliente'
  const telefoneCliente = String(body.telefone_cliente || '').replace(/[^\d]/g, '')

  const supa = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '')

  let telefone = ''
  let vendedorResolvido = vendedor
  let via = ''

  // Best-effort: o log é diagnóstico, jamais motivo pra perder um envio.
  async function logar(resultado: string, extra: Record<string, unknown> = {}) {
    try {
      await supa.from('orcamento_envio_log').insert({
        numero,
        vendedor_recebido: vendedor || null,
        vendedor_resolvido: vendedorResolvido || null,
        via: via || null,
        telefone: telefone || null,
        origem,
        resultado,
        ...extra,
      })
    } catch (_e) { /* nunca derruba o envio */ }
  }

  const erro400 = (code: string, detail?: string) =>
    new Response(JSON.stringify(detail ? { error: code, detail } : { error: code }),
      { status: 400, headers: { ...CORS, 'content-type': 'application/json' } })

  if (!pdfUrl) {
    await logar('sem_pdf_url', { erro: 'body.pdf_url veio vazio' })
    return erro400('sem_pdf_url')
  }

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = decodeJwt(authHeader.replace(/^Bearer\s+/i, ''))

  // Acha o vendedor pelo NOME (match exato; senão prefixo ÚNICO). Devolve nome do cadastro e o
  // telefone dele — no modo cliente esse telefone serve só pro aviso, não pro envio.
  async function vendedorPorNome(nome: string): Promise<{ name: string; telefone: string } | null> {
    if (!nome) return null
    const { data: v } = await supa.from('vendors').select('name, telefone').eq('name', nome).maybeSingle()
    if (v?.name) return { name: v.name, telefone: String(v.telefone ?? '').replace(/[^\d]/g, '') }
    const { data: vs } = await supa.from('vendors').select('name, telefone').ilike('name', nome + '%').limit(2)
    if (vs && vs.length === 1) return { name: vs[0].name, telefone: String(vs[0].telefone ?? '').replace(/[^\d]/g, '') }
    return null
  }

  // ---------------------------------------------------------------------------
  // MODO CLIENTE (v11): a proposta vai pra conversa do cliente.
  // ---------------------------------------------------------------------------
  if (paraCliente) {
    if (telefoneCliente.length < 10 || telefoneCliente.length > 15) {
      via = 'destino_cliente'
      await logar('sem_telefone_cliente', { erro: 'destino=cliente sem telefone_cliente válido: ' + String(body.telefone_cliente ?? '') })
      return erro400('sem_telefone_cliente', 'destino=cliente exige telefone_cliente com 10 a 15 dígitos.')
    }
    // O telefone do CLIENTE nunca entra na resolução do vendedor — quem envia é a conta do
    // vendedor, e confundir os dois é justamente o que mandaria a proposta pela conta errada.
    const v = await vendedorPorNome(vendedor)
    telefone = telefoneCliente
    via = 'destino_cliente'
    if (!v) {
      // Falha FECHADA: a extensão casa a fila por vendedor_nome. Nome que não existe no cadastro
      // vira linha que ninguém consome — a proposta ficaria "pending" pra sempre, em silêncio.
      await logar('vendedor_desconhecido', { erro: 'destino=cliente com vendedor fora do cadastro: ' + (vendedor || '(vazio)') })
      return erro400('vendedor_desconhecido', `Não achei "${vendedor || '(vazio)'}" em vendors — sem isso nenhuma conta envia a mensagem.`)
    }
    vendedorResolvido = v.name

    const chatCliente = `${telefoneCliente}@c.us`
    const bodyCliente = caption || `📄 Orçamento${clienteNome ? ' — ' + clienteNome : ''}`

    const { data: sched, error: schErr } = await supa.from('wa_scheduled_messages').insert({
      vendedor_nome: vendedorResolvido,
      chat_id: chatCliente,
      contato_numero: telefoneCliente,
      contato_nome: clienteNome || 'Cliente',
      to_self: false,
      body: bodyCliente,
      media_url: pdfUrl,
      media_filename: filename,
      media_type: 'document',
      scheduled_at: new Date().toISOString(),
      status: 'pending',
    }).select('id, scheduled_at').single()

    if (schErr) {
      await logar('schedule_failed', { erro: schErr.message })
      return new Response(JSON.stringify({ error: 'schedule_failed', detail: schErr.message }),
        { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
    }

    // O espaçador anti-ban é um trigger BEFORE INSERT e acabou de empurrar o scheduled_at pra
    // frente se havia fila do vendedor na janela de ±6h. Proposta que a IA acabou de prometer na
    // conversa ("já está saindo") não pode chegar horas depois: desfaz o empurrão com um UPDATE,
    // que o gatilho não vê. É a receita documentada pra envio urgente a terceiro.
    let reagendado = false
    const empurrado = sched?.scheduled_at ? new Date(sched.scheduled_at).getTime() - Date.now() : 0
    if (empurrado > 15_000) {
      const { error: upErr } = await supa.from('wa_scheduled_messages')
        .update({ scheduled_at: new Date().toISOString() }).eq('id', sched.id).eq('status', 'pending')
      reagendado = !upErr
    }

    // O vendedor não pode ficar sabendo por último que saiu proposta em nome dele. Aviso curto,
    // sem anexo (o PDF já está no CRM e na conversa do cliente). Best-effort: se falhar, o envio
    // ao cliente continua de pé.
    let avisou = false
    if (v.telefone.length >= 10) {
      const { error: avErr } = await supa.from('wa_scheduled_messages').insert({
        vendedor_nome: vendedorResolvido,
        chat_id: `${v.telefone}@c.us`,
        contato_numero: v.telefone,
        contato_nome: 'Eu (orçamento)',
        to_self: true,
        body: `📤 Proposta enviada ao cliente${clienteNome ? ' *' + clienteNome + '*' : ''}${numero ? ' (' + numero + ')' : ''}\n+${telefoneCliente}\n\nO PDF foi direto pra conversa dele. Se precisar, o orçamento está em /orcamentos/salvos.`,
        scheduled_at: new Date().toISOString(),
        status: 'pending',
      })
      avisou = !avErr
    }

    await logar('ok_cliente', { scheduled_id: sched.id })
    return new Response(JSON.stringify({
      ok: true,
      scheduled_id: sched.id,
      destino: 'cliente',
      vendedor: vendedorResolvido,
      telefone: telefoneCliente,
      via,
      reagendado,
      aviso_vendedor: avisou,
      msg: `Orçamento agendado pro cliente +${telefoneCliente} (envia pela conta de ${vendedorResolvido}). Chega em até 30s.`,
    }), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // ---------------------------------------------------------------------------
  // MODO PADRÃO: vai pro WhatsApp do PRÓPRIO vendedor (o "meu zap" do nome).
  // ---------------------------------------------------------------------------

  // PRIORIDADE 1: telefone_destino direto (vindo da extensão ou do prompt do CRM)
  if (telefoneDireto && telefoneDireto.length >= 10 && telefoneDireto.length <= 15) {
    telefone = telefoneDireto
    via = 'telefone_direto'
  }

  // PRIORIDADE 2: nome do vendedor (passado pelo front — só o PRIMEIRO nome, em UPPERCASE).
  // Match exato primeiro; se falhar, prefixo ÚNICO ('EDILSON' => 'EDILSON JR').
  // Só aceita o prefixo se casar exatamente 1 vendedor — ambiguidade não resolve nada.
  if (!telefone && vendedor) {
    const v = await vendedorPorNome(vendedor)
    if (v?.telefone) {
      telefone = v.telefone
      vendedorResolvido = v.name
      via = 'vendedor_nome'
    }
  }

  // PRIORIDADE 3: perfil do CRM — user_profiles.vendor_id pelo `sub` do JWT.
  // Só funciona quando o JWT é do USUÁRIO — a invocação server-side do
  // /api/orcamento-confirm vem com a service key, sem sub.
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
    await logar('sem_telefone', { erro: 'nao resolvi telefone para: ' + (vendedor || '(vazio)') })
    return erro400('sem_telefone',
      'Não consegui identificar seu telefone. Opções: 1) Admin vincular seu login a um vendedor (user_profiles.vendor_id) 2) Preencher vendors.telefone do seu cadastro 3) Digitar o telefone na mão.')
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

  // to_self: a mensagem é pro WhatsApp do PRÓPRIO vendedor. Ver comentário do v9 no topo.
  const { data: sched, error: schErr } = await supa.from('wa_scheduled_messages').insert({
    vendedor_nome: vendedorResolvido,
    chat_id: chatId,
    contato_numero: telefone,
    contato_nome: 'Eu (orçamento)',
    to_self: true,
    body: bodyMsg,
    media_url: pdfUrl,
    media_filename: filename,
    media_type: 'document',
    scheduled_at: new Date().toISOString(),
    status: 'pending',
  }).select('id').single()

  if (schErr) {
    await logar('schedule_failed', { erro: schErr.message })
    return new Response(JSON.stringify({ error: 'schedule_failed', detail: schErr.message }), { status: 500, headers: { ...CORS, 'content-type': 'application/json' } })
  }

  // Aviso honesto quando o vendedor segue desconhecido: a extensão casa por vendedor_nome,
  // então DESCONHECIDO não seria entregue — melhor o vendedor saber na hora.
  const desconhecido = vendedorResolvido === 'DESCONHECIDO'
  await logar(desconhecido ? 'ok_vendedor_desconhecido' : 'ok', { scheduled_id: sched.id })
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
