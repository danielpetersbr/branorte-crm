// Vercel serverless function — apos cliente subir os arquivos via signed URL,
// chama esse endpoint pra:
//   1. Confirmar que arquivos existem no Storage (defensive check)
//   2. Atualizar orcamento_gerados.status = 'enviado' (era 'rascunho' ate aqui)
//   3. Se whatsapp marcado: gerar signed READ URL do PDF e disparar
//      edge function orcamento-enviar-meu-zap
//
// Por que separar de presign:
//   - Status so vira 'enviado' SE upload realmente aconteceu (zero falso positivo)
//   - WhatsApp e idempotente (pode re-enviar sem subir de novo)
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { settleWithin } from './_lib/orcamento-confirm-timeout.js'
import { baseConfereComNumero, exigirAprovado, exigirPermissaoDoPapel, nomeDeArquivoSeguro } from './_lib/exigir-aprovado.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

interface ConfirmBody {
  orcamento_id: number
  ano: string
  mes: string
  base: string
  // WhatsApp
  send_whatsapp?: boolean
  whatsapp_envio_path?: string  // path do PDF em _envios/
  whatsapp_caption?: string
  whatsapp_filename?: string
  vendedor_nome?: string        // primeiro nome em UPPERCASE
  cliente_nome?: string
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ error: 'env_missing' })

  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  // Conta APROVADA (29/09/2026): signup é público e nasce 'pending'. Com só JWT,
  // qualquer conta marcava orçamento alheio como 'enviado' e mandava pro WhatsApp
  // de um vendedor o link (7 dias) de QUALQUER arquivo do bucket.
  const acesso = await exigirAprovado(supa, auth)
  if (!acesso.ok) return res.status(acesso.status).json({ error: acesso.error, detail: acesso.detail })
  // Mesmo portão de papel do /api/orcamento-presign (orcamentos.criar = true):
  // quem não monta orçamento não marca 'enviado' nem dispara o WhatsApp.
  const papel = await exigirPermissaoDoPapel(supa, acesso.usuario, 'orcamentos.criar')
  if (!papel.ok) return res.status(papel.status).json({ error: papel.error })

  const body = req.body as ConfirmBody
  const id = Number(body?.orcamento_id)
  const ano = String(body?.ano || '').trim()
  const mes = String(body?.mes || '').trim()
  const base = String(body?.base || '').trim()
  if (!id || !ano || !mes || !base) return res.status(400).json({ error: 'missing_fields' })
  // Mesmas regras do /api/orcamento-presign (quem gera o caminho): o arquivo tem
  // que estar em AAAA/MM e o base não pode ter barra/controle.
  if (!/^\d{4}$/.test(ano)) return res.status(400).json({ error: 'invalid_ano' })
  if (!/^(0[1-9]|1[0-2])$/.test(mes)) return res.status(400).json({ error: 'invalid_mes' })
  if (base.length > 200 || !nomeDeArquivoSeguro(base)) return res.status(400).json({ error: 'invalid_base' })

  // O base tem que ser DESTE orçamento (29/09/2026): antes o id e o base não
  // tinham vínculo nenhum — o docx de um orçamento "confirmava" outro. Todo
  // número em orcamentos_gerados segue 'AAAA - NNNN[-ALTn]' (medido: 1762 de 1762
  // nos últimos 120 dias) e nomeBase() sempre põe esse número no nome.
  const { data: orc, error: orcErr } = await supa
    .from('orcamentos_gerados')
    .select('numero')
    .eq('id', id)
    .maybeSingle()
  if (orcErr) return res.status(500).json({ error: 'orcamento_lookup_failed', detail: orcErr.message })
  if (!orc) return res.status(404).json({ error: 'orcamento_nao_encontrado' })
  if (!baseConfereComNumero(base, (orc as { numero?: string | null }).numero)) {
    return res.status(403).json({ error: 'base_nao_confere' })
  }

  const folder = `${ano}/${mes}`
  const docxPath = `${folder}/${base}.docx`

  // 1. Verifica que .docx ao menos existe (PDF e .txt podem falhar — docx e core)
  //
  // ⚠️ CORRIDA COM O DAEMON (09/09/2026): o `scripts/sync-orcamentos.mjs` varre ESTE
  // bucket a cada 30s, leva os arquivos pro Z: e MOVE cada um pra `_processados/<path>`.
  // O cliente sobe docx/txt/pdf/envio em paralelo e só então chama este confirm — se o
  // daemon pegar o .docx nessa janela (PDF grande = janela maior; o 2026-2515 tinha
  // 11,4 MB e o docx foi movido 3s ANTES do confirm), a listagem de `AAAA/MM` volta
  // vazia e o endpoint respondia 400 docx_missing. O front lia isso como upload falho:
  // pintava "FALHA AO SALVAR", baixava 18 MB no Downloads, convidava a regerar
  // (duplicata) e — o pior — o bloco 3 nunca rodava, então o PDF NÃO ia pro WhatsApp
  // do vendedor. Estar em `_processados/` é prova MAIOR de entrega (o arquivo já chegou
  // no Z:), não motivo de erro. Por isso procuramos nos dois lugares.
  async function listar(prefix: string) {
    const { data, error } = await supa.storage
      .from('orcamentos-pendentes')
      .list(prefix, { limit: 100, search: base })
    if (error) throw new Error(error.message)
    return (data || []).filter(f => f.name?.includes(base))
  }

  let arquivos: { name: string }[] = []
  let achadoEm = folder
  try {
    arquivos = await listar(folder)
    if (!arquivos.some(f => f.name === `${base}.docx`)) {
      const processados = await listar(`_processados/${folder}`)
      if (processados.some(f => f.name === `${base}.docx`)) {
        arquivos = processados
        achadoEm = `_processados/${folder}`
      }
    }
  } catch (e) {
    return res.status(500).json({ error: 'list_failed', detail: (e as Error).message })
  }

  const temDocx = arquivos.some(f => f.name === `${base}.docx`)
  const temPdf = arquivos.some(f => f.name === `${base}.pdf`)
  if (!temDocx) {
    return res.status(400).json({
      error: 'docx_missing',
      detail: `Arquivo principal ${docxPath} nao encontrado no Storage (nem em _processados/). Faca upload primeiro.`,
      encontrados: arquivos.map(f => f.name),
    })
  }

  // 2. Atualiza status do orcamento (RLS bypass via service role)
  const { error: updErr } = await supa
    .from('orcamentos_gerados')
    .update({ status: 'enviado', updated_at: new Date().toISOString() })
    .eq('id', id)
  if (updErr) {
    return res.status(500).json({ error: 'status_update_failed', detail: updErr.message })
  }

  const result: any = {
    ok: true,
    arquivos: arquivos.map(f => f.name),
    tem_pdf: temPdf,
    achado_em: achadoEm,
  }

  // 3. WhatsApp (opcional)
  if (body.send_whatsapp && body.whatsapp_envio_path && body.vendedor_nome) {
    try {
      // Só assina o PDF de envio DESTE orçamento — exatamente o caminho que o
      // presign devolveu (presign.envio.path). Antes aceitava qualquer path do
      // bucket e o link de 7 dias ia pro WhatsApp (29/09/2026).
      const envioPath = `_envios/${folder}/${base}.pdf`
      if (body.whatsapp_envio_path !== envioPath) throw new Error('whatsapp_envio_path_invalido')
      const { data: signed, error: sErr } = await supa.storage
        .from('orcamentos-pendentes')
        .createSignedUrl(envioPath, 60 * 60 * 24 * 7)
      if (sErr || !signed?.signedUrl) throw new Error(`signed_url: ${sErr?.message || 'sem url'}`)

      const invocation = await settleWithin(supa.functions.invoke('orcamento-enviar-meu-zap', {
        body: {
          vendedor_nome: body.vendedor_nome,
          pdf_url: signed.signedUrl,
          filename: body.whatsapp_filename || `${base}.pdf`,
          cliente_nome: body.cliente_nome || '',
          caption: body.whatsapp_caption || `Orcamento ${base}`,
        },
      }), 10_000)
      if (invocation.status === 'timeout') {
        throw new Error('O WhatsApp demorou para responder. O orçamento foi salvo; use Reenviar ao WhatsApp em Orçamentos Salvos.')
      }
      const { data: fnData, error: fnErr } = invocation.value
      if (fnErr) throw new Error(fnErr.message)
      if ((fnData as any)?.error) throw new Error((fnData as any).detail || (fnData as any).error)
      result.whatsapp = { ok: true, msg: (fnData as any)?.msg || 'Enviado pro WhatsApp' }
    } catch (e) {
      result.whatsapp = { ok: false, error: (e as Error).message }
    }
  }

  return res.status(200).json(result)
}
