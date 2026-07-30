// WORKER DE ORCAMENTO DA IA
//
// Pega os pedidos que a persona abriu (ia_orcamento_pedidos), monta a proposta a partir de um
// MODELO PRONTO, gera o PDF e manda pro cliente. A IA nunca monta itens: ela escolhe o modelo.
//
// Por que modelo e nao montagem: o orcamento real de uma fabrica completa tem 11 pecas com a
// funcao de cada transportador escrita a mao ("alimentacao do silo de milho moido para a
// cacamba"). Isso e engenharia de layout — a IA inventaria.
//
// Caminho do PDF (tudo server-side, sem navegador):
//   orcamento_modelos.itens/motores  ->  /api/orcamento-template-fill  ->  DOCX
//   DOCX  ->  edge docx-to-pdf (Gotenberg)  ->  PDF
//   PDF   ->  storage  ->  orcamento-enviar-meu-zap  ->  WhatsApp do cliente
//
// Falha FECHADA em todo passo: qualquer erro marca status='erro' e NAO envia nada. Meio-orcamento
// no WhatsApp do cliente e pior que orcamento nenhum.
import { createClient } from 'jsr:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}
const SHARED_SECRET = Deno.env.get('WA_SYNC_SHARED_SECRET') ?? 'branorte-wa-sync-2026'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const CRM_URL = Deno.env.get('CRM_BASE_URL') ?? 'https://branorte-crm.vercel.app'

const j = (o: unknown, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...CORS, 'content-type': 'application/json' } })

// Numero do orcamento: MAX do ano + 1. Mesma regra do front (obterProximoNumero), sem o index de
// pasta — aqui nao ha acesso ao Z:, e o MAX do banco e a fonte autoritativa de qualquer jeito.
async function proximoNumero(supa: any): Promise<{ ano: number; sequencial: number; numero: string }> {
  const ano = new Date().getFullYear()
  const { data } = await supa.from('orcamentos_gerados')
    .select('sequencial').eq('ano', ano)
    .order('sequencial', { ascending: false }).limit(1).maybeSingle()
  const seq = Number(data?.sequencial ?? 0) + 1
  return { ano, sequencial: seq, numero: `${ano} - ${seq}` }
}

// Valida ANTES de gerar. O escopo lista 16 checagens; as que dao pra fazer com o dado disponivel
// estao aqui. O que nao da pra checar (ex.: "PDF pertence ao cliente certo") vira checagem no PDF
// depois de gerado — tamanho minimo e content-type.
function validarPedido(p: any, mod: any): string | null {
  if (!p.cliente_nome || p.cliente_nome.length < 2) return 'cliente sem nome'
  if (!mod) return 'modelo inexistente'
  if (mod.voltagem && mod.voltagem !== p.voltagem) {
    return `voltagem do pedido (${p.voltagem}) difere do modelo (${mod.voltagem})`
  }
  const itens = Array.isArray(mod.itens) ? mod.itens : []
  if (!itens.length) return 'modelo sem itens'
  if (itens.some((i: any) => !i?.nome || typeof i?.valor !== 'number')) return 'item sem nome ou sem valor'
  const total = Number(mod.total_proposta || 0)
  if (!(total > 0)) return 'modelo sem total'

  // A conta da casa (confirmada nos modelos): equipamentos + motores = proposta.
  // Dois detalhes que quebram quem assume o obvio:
  //   - o valor dos ACESSORIOS ja esta embutido nos itens; somar de novo duplica;
  //   - o campo do motor e 'valor', nao 'valor_total' (o 'valor_total' e do orcamento montado).
  const somaItens = itens.reduce((a: number, i: any) => a + Number(i.valor || 0) * Number(i.qtd || 1), 0)
  const somaMot = (Array.isArray(mod.motores) ? mod.motores : [])
    .reduce((a: number, m: any) => a + Number(m.valor ?? m.valor_total ?? 0), 0)

  if (Math.abs(somaItens - Number(mod.total_equipamentos || 0)) > 1) {
    return `itens somam ${somaItens.toFixed(2)} mas total_equipamentos e ${Number(mod.total_equipamentos || 0).toFixed(2)}`
  }
  if (Math.abs(somaMot - Number(mod.total_motores || 0)) > 1) {
    return `motores somam ${somaMot.toFixed(2)} mas total_motores e ${Number(mod.total_motores || 0).toFixed(2)}`
  }
  if (Math.abs(Number(mod.total_equipamentos || 0) + Number(mod.total_motores || 0) - total) > 1) {
    return `equipamentos + motores nao fecham com o total (${total.toFixed(2)})`
  }
  return null
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS })
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405, headers: CORS })
  const auth = req.headers.get('authorization') ?? ''
  if (auth.replace(/^Bearer\s+/i, '') !== SHARED_SECRET) return j({ error: 'unauthorized' }, 401)

  const supa = createClient(SUPABASE_URL, SERVICE_KEY)
  const body = await req.json().catch(() => ({}))
  const limite = Math.max(1, Math.min(5, Number(body.limite) || 2))

  // Pega os pendentes e marca 'gerando' na hora — se duas instancias rodarem juntas, a segunda
  // nao pega o mesmo pedido (o update com filtro de status faz as vezes de lease).
  const { data: fila } = await supa.from('ia_orcamento_pedidos')
    .select('*').eq('status', 'pendente').order('criado_em', { ascending: true }).limit(limite)

  const resultados: any[] = []

  for (const p of (fila || [])) {
    const { data: lease } = await supa.from('ia_orcamento_pedidos')
      .update({ status: 'gerando', atualizado_em: new Date().toISOString() })
      .eq('id', p.id).eq('status', 'pendente').select('id').maybeSingle()
    if (!lease) continue   // outra instancia pegou

    const falhar = async (erro: string) => {
      await supa.from('ia_orcamento_pedidos')
        .update({ status: 'erro', erro: erro.slice(0, 400), atualizado_em: new Date().toISOString() })
        .eq('id', p.id)
      // A conversa nao pode ficar presa em WAITING_QUOTE_GENERATION esperando um PDF que nao vem.
      await supa.from('ia_atendimentos')
        .update({ estado: 'AI_ERROR', estado_desde: new Date().toISOString(), estado_motivo: erro.slice(0, 120) })
        .eq('chat_id', p.chat_id)
      resultados.push({ id: p.id, ok: false, erro })
      console.error('[ia-orcamento] pedido ' + p.id + ' falhou: ' + erro)
    }

    try {
      const { data: mod } = await supa.from('orcamento_modelos')
        .select('slug, pacote, voltagem, itens, motores, acessorios, total_equipamentos, total_motores, total_proposta')
        .eq('slug', p.modelo_slug).eq('ativo', true).maybeSingle()

      const problema = validarPedido(p, mod)
      if (problema) { await falhar(problema); continue }

      const num = await proximoNumero(supa)
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

      // 1. DOCX preenchido (Vercel, docxtemplater — layout desenhado no Word, sem conversao)
      const fill = await fetch(`${CRM_URL}/api/orcamento-template-fill`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          numero: num.numero, data_emissao: hoje,
          cliente: {
            nome: p.cliente_nome, fone: p.cliente_telefone || null,
            cidade: [p.cidade, p.uf].filter(Boolean).join('/') || null,
          },
          voltagem: p.voltagem,
          itens: (mod.itens || []).map((i: any) => ({
            letra: i.letra, qtd: i.qtd || 1, nome: i.nome, specs: i.specs || [], valor: i.valor,
          })),
          // o template espera 'valor_total'; o modelo guarda 'valor'
          motores: (mod.motores || []).map((m: any) => ({
            cv: m.cv, polos: m.polos, valor_total: Number(m.valor ?? m.valor_total ?? 0),
          })),
          acessorios: mod.acessorios || null,
          total_equipamentos: Number(mod.total_equipamentos || 0),
          total_motores: Number(mod.total_motores || 0),
          forma_pagamento: '25% no pedido, 25% na conclusao do equipamento e 50% em boleto apos o carregamento (sujeito a analise de credito)',
          prazo_entrega: '90 dias uteis',
          total_proposta: Number(mod.total_proposta || 0),
        }),
      })
      if (!fill.ok) { await falhar('template-fill HTTP ' + fill.status + ': ' + (await fill.text()).slice(0, 200)); continue }
      const docx = await fill.arrayBuffer()
      if (docx.byteLength < 5000) { await falhar('DOCX suspeito: ' + docx.byteLength + ' bytes'); continue }

      // 2. DOCX -> PDF (Gotenberg via edge existente)
      const fd = new FormData()
      fd.append('file', new Blob([docx], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }), 'orcamento.docx')
      const conv = await fetch(`${SUPABASE_URL}/functions/v1/docx-to-pdf`, {
        method: 'POST', headers: { Authorization: 'Bearer ' + SERVICE_KEY }, body: fd,
      })
      if (!conv.ok) { await falhar('docx-to-pdf HTTP ' + conv.status); continue }
      const pdf = await conv.arrayBuffer()
      // PDF valido comeca com %PDF. Sem isso, o Gotenberg devolveu erro em corpo de texto.
      const head = new TextDecoder().decode(new Uint8Array(pdf.slice(0, 5)))
      if (!head.startsWith('%PDF') || pdf.byteLength < 10000) {
        await falhar('PDF invalido (' + pdf.byteLength + ' bytes, comeca com "' + head + '")'); continue
      }

      // 3. Storage — bucket PRIVADO com URL assinada.
      // Orcamento tem preco e dado de cliente; nao entra em bucket publico so pra facilitar o
      // envio. A assinatura de 7 dias cobre o cliente reabrir o PDF na semana da proposta.
      // O bucket 'orcamentos-pendentes' NAO e armazenamento — e uma FILA.
      // scripts/sync-orcamentos.mjs roda 24/7 no PC do escritorio, varre este bucket a cada 30s,
      // baixa tudo pro Z: e MOVE o objeto pra _processados/. Ele pula so o que comeca com "_"
      // (linha 71: if (f.name.startsWith('_')) continue).
      // Medido: o arquivo saia do path assinado em 3,3 segundos. O worker verificava a existencia
      // e ate BAIXAVA o PDF com sucesso — e ainda assim o cliente recebia 404, porque o link vive
      // 7 dias e o move acontece depois. Nenhuma verificacao dentro do worker pegaria isso.
      // O fluxo manual do CRM ja resolve assim ha tempos (FinalizarMontarModal.tsx:1154).
      const mm = String(new Date().getMonth() + 1).padStart(2, '0')
      const base = `${num.numero} - ${p.cliente_nome.replace(/[\/:*?"<>|]/g, '-').slice(0, 60)}`
      const nomeArq = `_envios/${num.ano}/${mm}/${base}.pdf`

      // Trava de invariante: se o path perder o "_", o daemon leva o arquivo e o cliente recebe
      // link morto. Melhor falhar aqui, alto, do que mandar 404 pro cliente.
      if (!nomeArq.startsWith('_')) { await falhar('path sem "_": o daemon do Z: moveria o arquivo'); continue }

      const { error: upErr } = await supa.storage.from('orcamentos-pendentes')
        .upload(nomeArq, new Blob([pdf], { type: 'application/pdf' }), {
          contentType: 'application/pdf', upsert: true,
        })
      if (upErr) { await falhar('upload: ' + upErr.message); continue }

      // Segunda copia, ESSA de proposito na fila: e a que o daemon leva pro Z:. O path precisa de
      // ano/mes reais — o daemon exige 3 segmentos e faz parseInt do mes (com 'ia/2026/x.pdf' ele
      // criou uma pasta "2026 - undefined" no Z:).
      await supa.storage.from('orcamentos-pendentes')
        .upload(`${num.ano}/${mm}/${base}.pdf`, new Blob([pdf], { type: 'application/pdf' }), {
          contentType: 'application/pdf', upsert: true,
        })

      // createSignedUrl JA valida existencia (404 NoSuchKey em path inexistente) — o .list() que
      // eu tinha posto aqui era redundante e nao protegia contra o move.
      const { data: signed, error: sErr } = await supa.storage.from('orcamentos-pendentes')
        .createSignedUrl(nomeArq, 60 * 60 * 24 * 7)
      const pdfUrl = signed?.signedUrl
      if (sErr || !pdfUrl) { await falhar('url assinada: ' + (sErr?.message || 'vazia')); continue }

      // Ultima prova antes de mandar pro cliente: a URL BAIXA um PDF de verdade?
      const prova = await fetch(pdfUrl)
      const provaTipo = prova.headers.get('content-type') || ''
      if (!prova.ok || !provaTipo.includes('pdf')) {
        await falhar('link do PDF nao abre (HTTP ' + prova.status + ', ' + provaTipo + ')'); continue
      }

      // 4. Registro no CRM — mesma tabela dos orcamentos feitos a mao
      const { data: orc, error: insErr } = await supa.from('orcamentos_gerados').insert({
        numero: num.numero, ano: num.ano, sequencial: num.sequencial,
        data_emissao: new Date().toISOString().slice(0, 10),
        vendedor_nome: p.vendedor_nome, cliente_nome: p.cliente_nome,
        cliente_dados: { fone: p.cliente_telefone, cidade: p.cidade, uf: p.uf },
        // Daqui pra baixo, igual ao que o FinalizarMontarModal grava quando o vendedor monta a
        // mao. O orcamento tem que ser indistinguivel: quem abrir /orcamentos/salvos nao deve
        // conseguir dizer qual saiu do atendimento e qual saiu da tela.
        modelo_id: null, modelo_basename: 'PERSONALIZADO', voltagem: p.voltagem,
        itens: mod.itens, acessorios: mod.acessorios, motores: mod.motores,
        total_equipamentos: mod.total_equipamentos, total_motores: mod.total_motores,
        total_proposta: mod.total_proposta,
        // Condicao padrao da casa, confirmada pelo dono: 25% no pedido, 25% na conclusao, 50% em
        // boleto apos o carregamento (sujeito a analise). Producao em 90 dias uteis.
        forma_pagamento: '25% no pedido, 25% na conclusao do equipamento e 50% em boleto apos o carregamento (sujeito a analise de credito)',
        prazo_entrega: '90 dias uteis',
        // 'rascunho' e nao 'gerado': o CHECK do CRM so aceita rascunho|enviado|aprovado|perdido.
        // Vira 'enviado' logo abaixo, quando o PDF sair de fato.
        status: 'rascunho', pdf_url: pdfUrl,
        observacoes: null,
      }).select('id').maybeSingle()
      if (insErr) { await falhar('registro: ' + insErr.message); continue }

      // 5. Envio ao cliente
      const envio = await fetch(`${SUPABASE_URL}/functions/v1/orcamento-enviar-meu-zap`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          vendedor_nome: p.vendedor_nome, telefone_destino: p.cliente_telefone,
          pdf_url: pdfUrl, filename: `Orcamento ${num.numero}.pdf`,
          cliente_nome: p.cliente_nome,
          caption: `${p.cliente_nome.split(' ')[0]}, segue a proposta com os equipamentos, valores e condicoes. Da uma conferida e me chama se ficar qualquer duvida.`,
        }),
      })
      const enviou = envio.ok

      // Espelha no orcamento do CRM: quem abre /orcamentos/salvos ve o mesmo status de sempre.
      if (enviou && orc?.id) {
        await supa.from('orcamentos_gerados')
          .update({ status: 'enviado', enviado_em: new Date().toISOString() }).eq('id', orc.id)
      }

      await supa.from('ia_orcamento_pedidos').update({
        status: enviou ? 'enviado' : 'gerado', orcamento_id: orc?.id ?? null, pdf_url: pdfUrl,
        erro: enviou ? null : 'PDF gerado mas envio falhou (HTTP ' + envio.status + ')',
        enviado_em: enviou ? new Date().toISOString() : null,
        atualizado_em: new Date().toISOString(),
      }).eq('id', p.id)

      // Volta a atender: o cliente vai perguntar sobre a proposta e a IA precisa estar viva.
      await supa.from('ia_atendimentos').update({
        estado: 'AI_ACTIVE', estado_desde: new Date().toISOString(),
        estado_motivo: 'orcamento ' + num.numero + (enviou ? ' enviado' : ' gerado (envio falhou)'),
      }).eq('chat_id', p.chat_id)

      try {
        await supa.from('automation_runs').insert({
          regra_key: 'ia_atendente', vendedor_nome: p.vendedor_nome, chat_id: p.chat_id,
          acao: 'ia_orcamento_enviado', modo: 'automatico', executor: 'ia',
          status: enviou ? 'executado' : 'falhou',
          payload: { numero: num.numero, modelo: mod.slug, total: mod.total_proposta, pdf_url: pdfUrl },
          motivo: enviou ? 'orcamento gerado e enviado pela IA' : 'orcamento gerado; envio falhou',
        })
      } catch (_) { /* auditoria best-effort */ }

      resultados.push({ id: p.id, ok: true, numero: num.numero, enviado: enviou })
      console.log('[ia-orcamento] ' + num.numero + ' ' + (enviou ? 'enviado' : 'gerado') + ' para ' + p.cliente_nome)
    } catch (e) {
      await falhar(String((e as any)?.message || e))
    }
  }

  return j({ ok: true, processados: resultados.length, resultados })
})
