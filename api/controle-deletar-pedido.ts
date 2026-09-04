// Vercel serverless — EXCLUI um PEDIDO DE VENDA no controle.branorte.com
// (Supabase kfucuvwrnwrkshxpsmyq), com a cascata de dependentes.
//
// ── POR QUE ISTO EXISTE (e não é só um wrapper preguiçoso) ────────────────────
// A edge function `deletar-pedido` do controle FAZ o trabalho certo, mas o CORS
// dela responde `Access-Control-Allow-Origin: https://controle.branorte.com` —
// e só. As outras 5 edges que esta tela usa respondem `*`. Resultado: chamada do
// CRM morre no PREFLIGHT, antes de sair do browser. O usuário via "Excluindo..."
// e uma tela que não mudava, porque o erro caía num toast que (até agora) nem
// renderizava. Chamar de servidor pra servidor mata o problema na raiz: CORS é
// regra de browser, não existe aqui.
//
// ── SEGURANÇA ────────────────────────────────────────────────────────────────
// Exclusão é destrutiva e SEM DESFAZER, então o portão é mais apertado que o do
// controle-criar-pedido:
//   1. JWT válido do CRM (via service key do CRM)
//   2. perfil aprovado
//   3. role === 'admin'   <- travado AQUI, no servidor. Esconder o botão na UI
//      não é controle de acesso: qualquer um faz POST no endpoint.
// A edge function original valida MENOS que isso: a `requireAuth` dela só checa
// se existe um header Bearer com mais de 20 chars — a anon key pública passa.
//
// Env vars (Vercel):
//   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY  -> valida o JWT do CRM + apaga o espelho
//   CONTROLE_SUPABASE_URL (opcional)          -> default kfucuvwrnwrkshxpsmyq
//   CONTROLE_SERVICE_KEY / CONTROLE_ANON_KEY  -> credencial do controle
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } }, maxDuration: 30 }

const CRM_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || ''
const CRM_SVC = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const CONTROLE_URL = process.env.CONTROLE_SUPABASE_URL || 'https://kfucuvwrnwrkshxpsmyq.supabase.co'
// anon key PÚBLICA do controle (role=anon, ref=kfucuvwrnwrkshxpsmyq, exp 2075) — a mesma
// que já está no bundle de controle.branorte.com. Não é segredo.
const CONTROLE_PUBLIC_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWN1dndybndya3NoeHBzbXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMzAwODgsImV4cCI6MjA3NTYwNjA4OH0.Oe0otpf1l_Ssbi8FQJlbcDRNtW_j_IRY5EMnr8dNYNE'
// ⚠️ DÍVIDA CONHECIDA: sem CONTROLE_SERVICE_KEY no ambiente, isto cai na anon
// key pública. Hoje funciona só porque a RLS do controle está escancarada
// (anon apaga tudo — ver memória `reference_branorte_controle_kfucu_banco_aberto`).
// Se a RLS de lá apertar, os DELETEs passam a voltar "0 linhas" SEM ERRO, e a
// cascata rodaria pela metade em silêncio: dependentes apagados, pedido vivo.
// A trava contra isso é o `.select('id')` no DELETE final (lá embaixo): se o
// pedido que acabamos de LER não voltar como apagado, devolvemos 500 dizendo
// exatamente o que houve, em vez de responder "ok".
const TEM_CHAVE_DE_ESCRITA = Boolean(process.env.CONTROLE_SERVICE_KEY || process.env.CONTROLE_ANON_KEY)
const CONTROLE_SVC = process.env.CONTROLE_SERVICE_KEY || process.env.CONTROLE_ANON_KEY || CONTROLE_PUBLIC_ANON

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!CRM_URL || !CRM_SVC) return res.status(500).json({ error: 'env_missing' })

  // ── Portão 1/3: JWT do CRM ──
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })
  const crm = createClient(CRM_URL, CRM_SVC, { auth: { persistSession: false } })
  const { data: u, error: authErr } = await crm.auth.getUser(auth)
  if (authErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt' })

  // ── Portão 2/3 e 3/3: aprovado E admin ──
  const { data: prof } = await crm
    .from('user_profiles')
    .select('role, approved_at')
    .eq('id', u.user.id)
    .maybeSingle()
  if (!prof || !prof.approved_at || prof.role === 'pending' || prof.role === 'rejected') {
    return res.status(403).json({ error: 'not_approved' })
  }
  // Por que admin e NÃO o `pedidoNoEscopo()` que o controle-atualizar-pedido usa:
  // admin-only é ESTRITAMENTE mais apertado que o recorte por vendedor — quem
  // passa aqui passaria no escopo de qualquer jeito. Exclusão é irreversível e
  // leva junto card de produção, checklist, parcelas e recebimentos; deixar o
  // vendedor apagar o próprio pedido apagaria o rastro da venda dele. Se um dia
  // isso mudar, o caminho é trocar por resolverEscopo()+pedidoNoEscopo(), que já
  // estão importáveis daqui.
  if (prof.role !== 'admin') {
    return res.status(403).json({ error: 'admin_required', detail: 'Só administrador pode excluir pedido.' })
  }

  const id = String((req.body as { id?: unknown } | undefined)?.id ?? '').trim()
  if (!id) return res.status(400).json({ error: 'id_obrigatorio' })
  // Sem isto, um `id` torto viraria filtro solto nos deletes em cascata abaixo.
  if (!UUID_RE.test(id)) return res.status(400).json({ error: 'id_invalido' })

  if (!TEM_CHAVE_DE_ESCRITA) {
    console.warn(
      '[controle-deletar-pedido] SEM CONTROLE_SERVICE_KEY: usando a anon pública. ' +
        'Só funciona enquanto a RLS do controle estiver aberta pra escrita.',
    )
  }

  const controle = createClient(CONTROLE_URL, CONTROLE_SVC, { auth: { persistSession: false } })

  // Confere que existe ANTES de sair apagando dependente — e guarda o arquivo
  // pra remover do storage no fim.
  const { data: pedido, error: findErr } = await controle
    .from('pedidos_venda')
    .select('id, pedido_numero, arquivo_url')
    .eq('id', id)
    .maybeSingle()
  if (findErr) return res.status(500).json({ error: 'consulta_falhou', detail: findErr.message })
  if (!pedido) return res.status(404).json({ error: 'pedido_nao_encontrado' })

  // ── Cascata. A ORDEM IMPORTA: filho antes de pai, senão a FK barra. ──
  // producao_itens_checklist não aponta pro pedido, aponta pro CARD de produção,
  // então precisa resolver os ids do card primeiro.
  try {
    const { data: cards } = await controle
      .from('producao_pedidos')
      .select('id')
      .eq('pedido_id', id)

    const cardIds = (cards ?? []).map((c: { id: string }) => c.id)
    if (cardIds.length > 0) {
      const { error } = await controle
        .from('producao_itens_checklist')
        .delete()
        .in('producao_pedido_id', cardIds)
      if (error) throw new Error(`producao_itens_checklist: ${error.message}`)
    }

    // Tabelas que referenciam o pedido direto. `receipts` e `order_installments`
    // usam `order_id`; o resto usa `pedido_id`.
    const dependentes: Array<{ tabela: string; coluna: string }> = [
      { tabela: 'producao_pedidos', coluna: 'pedido_id' },
      { tabela: 'producao_historico', coluna: 'pedido_id' },
      { tabela: 'receipts', coluna: 'order_id' },
      { tabela: 'order_installments', coluna: 'order_id' },
      { tabela: 'clientes_mapa', coluna: 'pedido_id' },
    ]
    for (const dep of dependentes) {
      const { error } = await controle.from(dep.tabela).delete().eq(dep.coluna, id)
      if (error) throw new Error(`${dep.tabela}: ${error.message}`)
    }

    // Por último o pedido. `.select('id')` NÃO é enfeite: um DELETE barrado por
    // RLS volta 200 com 0 linhas e `error === null`. Sem conferir, responderíamos
    // "ok" com o pedido ainda no banco e os dependentes já apagados.
    const { data: apagados, error: delErr } = await controle
      .from('pedidos_venda')
      .delete()
      .eq('id', id)
      .select('id')
    if (delErr) throw new Error(`pedidos_venda: ${delErr.message}`)
    if (!apagados || apagados.length === 0) {
      throw new Error(
        'os dependentes foram apagados mas o pedido NAO foi (DELETE voltou 0 linhas — ' +
          'provavelmente RLS do controle). Configure CONTROLE_SERVICE_KEY e refaça: ' +
          `pedido ${id} ficou inconsistente.`,
      )
    }
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e)
    console.error('[controle-deletar-pedido] cascata falhou:', detail)
    return res.status(500).json({ error: 'cascata_falhou', detail })
  }

  // Arquivo do orçamento no storage — não-fatal: pedido já foi embora, e um
  // .docx órfão no bucket não quebra ninguém.
  try {
    const nome = String(pedido.arquivo_url || '').split('/').pop()
    if (nome) await controle.storage.from('pedidos').remove([nome])
  } catch { /* não-fatal */ }

  // ⚠️ ESPELHO DO CRM. A listagem /controle/pedidos lê `mirror_pedidos_venda`,
  // não a tabela viva. Sem apagar aqui, o usuário exclui o pedido e ele CONTINUA
  // na lista até o próximo sync — parecendo que a exclusão não funcionou.
  try {
    await crm.from('mirror_pedidos_venda').delete().eq('id', id)
  } catch { /* não-fatal */ }

  console.log(`[controle-deletar-pedido] ${u.user.email} apagou ${pedido.pedido_numero || id}`)
  return res.status(200).json({ ok: true, pedido_numero: pedido.pedido_numero ?? null })
}
