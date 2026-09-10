// WORKER DE ORCAMENTO DA IA
//
// Pega os pedidos que a persona abriu (ia_orcamento_pedidos), monta a proposta a partir de um
// MODELO PRONTO, gera o PDF e manda pro cliente. A IA nunca monta itens: ela escolhe o modelo.
//
// Por que modelo e nao montagem: o orcamento real de uma fabrica completa tem 11 pecas com a
// funcao de cada transportador escrita a mao ("alimentacao do silo de milho moido para a
// cacamba"). Isso e engenharia de layout — a IA inventaria.
//
// Caminho do PDF (Puppeteer no /api/gerar-pdf do CRM, o MESMO que o vendedor usa na tela):
//   orcamento_modelos.itens/motores  ->  previewProps  ->  /api/gerar-pdf  ->  PDF com fotos
//   PDF   ->  storage  ->  orcamento-enviar-meu-zap (destino: 'cliente')  ->  WhatsApp do cliente
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

// ---------------------------------------------------------------------------
// TOKEN DE USUARIO PARA O /api/gerar-pdf
//
// (31/07) Os pedidos 3 e 4 morreram com `gerar-pdf HTTP 401: {"error":"invalid_jwt",
// "detail":"invalid claim: missing sub claim"}`. Nao era chave errada nem formato novo de chave:
// /api/gerar-pdf valida com `supa.auth.getUser(token)`, e o GoTrue so aceita ali um token de
// SESSAO DE USUARIO — ele exige a claim `sub` (o id do usuario). A service_role e um JWT
// legitimo, assinado pelo projeto, mas o payload dela e {iss, ref, role, iat, exp}: NAO tem
// `sub`. Por isso o 403/401 vem DEPOIS de a assinatura conferir.
//
// Ja existiu um desvio no gerar-pdf.ts ("if (auth !== SVC_KEY)") aceitando a propria
// service_role, e foi assim que o pedido 2 funcionou em 30/07. Mas aquele hunk nunca foi
// commitado: ele subiu num deploy de CLI feito de arvore suja e o primeiro build vindo do
// GitHub (30/07 20:29 UTC) apagou. Depender dele e depender de codigo que nao existe no repo.
//
// Entao o conserto e do lado que a gente controla: cunhar uma sessao real de um usuario tecnico
// via Admin API (generate_link -> verify). O access_token que sai dali TEM `sub`, passa no
// getUser e nao depende de nenhuma mudanca no Vercel.
//
// Nao criamos usuario novo de proposito: auth.users tem dois triggers AFTER INSERT
// (on_auth_user_created / trg_handle_new_auth_user) que populam tabelas do CRM — um usuario
// fantasma apareceria em listas de vendedor. Usamos uma conta que ja existe.
//
// ⚠️ (10/09/2026) Este usuario precisa estar ATIVO no GoTrue. Em 11/08/2026 nove contas do CRM
// foram banidas de uma vez (banned_until = 2126), admin@branorte.com entre elas, e o worker
// passou a morrer em `verify 403: {"error_code":"user_banned"}` — silenciosamente, porque
// ninguem estava disparando orcamento pela IA desde 31/07. Se voltar a dar user_banned, o
// problema NAO e o codigo: e a conta.
const PDF_USER_EMAIL = Deno.env.get('PDF_USER_EMAIL') ?? 'admin@branorte.com'

let _tokenCache: { token: string; exp: number } | null = null

async function tokenDeUsuario(): Promise<string> {
  const agora = Math.floor(Date.now() / 1000)
  // 120s de folga: token que expira no meio do cold start do Chrome vira 401 intermitente.
  if (_tokenCache && _tokenCache.exp - 120 > agora) return _tokenCache.token

  const gl = await fetch(`${SUPABASE_URL}/auth/v1/admin/generate_link`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'content-type': 'application/json',
    },
    // magiclink NAO dispara e-mail quando chamado pelo endpoint /admin/ — ele devolve o link
    // e o hashed_token pra quem chamou. Nada sai pra caixa de entrada de ninguem.
    body: JSON.stringify({ type: 'magiclink', email: PDF_USER_EMAIL }),
  })
  const glTxt = await gl.text()
  if (!gl.ok) throw new Error(`generate_link ${gl.status}: ${glTxt.slice(0, 200)}`)
  let glJson: any = {}
  try { glJson = JSON.parse(glTxt) } catch { throw new Error('generate_link nao devolveu JSON') }
  const hashed = glJson?.hashed_token ?? glJson?.properties?.hashed_token
  if (!hashed) throw new Error('generate_link sem hashed_token: ' + glTxt.slice(0, 200))

  const vf = await fetch(`${SUPABASE_URL}/auth/v1/verify`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'magiclink', token_hash: hashed }),
  })
  const vfTxt = await vf.text()
  if (!vf.ok) throw new Error(`verify ${vf.status}: ${vfTxt.slice(0, 200)}`)
  let sess: any = {}
  try { sess = JSON.parse(vfTxt) } catch { throw new Error('verify nao devolveu JSON') }
  const token = sess?.access_token
  if (!token) throw new Error('verify sem access_token: ' + vfTxt.slice(0, 120))

  _tokenCache = { token, exp: Number(sess.expires_at || agora + 3600) }
  return token
}

// Numero do orcamento: MAX do ano + 1. Mesma regra do front (obterProximoNumero), sem o index de
// pasta — aqui nao ha acesso ao Z:, e o MAX do banco e a fonte autoritativa de qualquer jeito.
//
// ⚠️ (10/09/2026) O MAX IGNORA sequencial >= 10000, e isso NAO e detalhe. Em 26/08/2026 um INSERT
// de teste por service_role gravou o sequencial 91926 e ficou 11 minutos vivo; o MAX+1 do app
// propagou em cima dele e 7 orcamentos (R$ 835.583,60) sairam pro cliente numerados 91927..91933.
// Esses 7 nao podem ser apagados nem renumerados — ja foram entregues com esse numero. Depois do
// incidente o banco ganhou o CHECK `chk_sequencial_faixa` (sequencial < 10000), criado NOT VALID:
// os 7 antigos continuam la, mas qualquer INSERT novo acima da faixa e barrado.
// Sem o .lt() abaixo o worker le o 91933, tenta 91934 e morre com "violates check constraint" —
// foi exatamente o que aconteceu no teste de 10/09/2026. A numeracao boa de 2026 esta na casa
// dos 2500. Ver memoria reference_branorte_numeracao_orcamento_envenenada.
async function proximoNumero(supa: any): Promise<{ ano: number; sequencial: number; numero: string }> {
  const ano = new Date().getFullYear()
  const { data } = await supa.from('orcamentos_gerados')
    .select('sequencial').eq('ano', ano).lt('sequencial', 10000)
    .order('sequencial', { ascending: false }).limit(1).maybeSingle()
  const seq = Number(data?.sequencial ?? 0) + 1
  // Cinto de seguranca: se a faixa boa encostar no teto, PARA em vez de gravar numero invalido.
  if (seq >= 10000) throw new Error(`sequencial ${seq} fora da faixa (teto 10000) — numeracao precisa de revisao`)
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

  // ⚠️ CORRECAO DE 10/09/2026 — o comentario que estava aqui ("o valor dos ACESSORIOS ja esta
  // embutido nos itens; somar de novo duplica") estava ERRADO, e custou caro: o PDF saia em
  // media 7,5% ABAIXO do que a IA falava na conversa (R$ 3.507 a R$ 15.817 por proposta).
  // O que os numeros mostram, conferido nos 65 modelos de fabrica completa:
  //     total_proposta (equipamentos + motores)  +  acessorios.valor  =  catalogo oficial
  // Os acessorios (torres de fixacao, bocas dos chupins, funil e base do moinho) NAO estao nos
  // itens: eles faltam. Por isso agora existe `preco_catalogo` no modelo, e o total do PDF sai
  // dele — ver o bloco do previewProps.
  //
  // A conta INTERNA do modelo segue sendo equipamentos + motores = total_proposta, e e isso que
  // as tres checagens abaixo protegem (integridade do dado, nao o preco de venda).
  // O campo do motor e 'valor', nao 'valor_total' (o 'valor_total' e do orcamento montado).
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

  // O PREco QUE VAI PRO CLIENTE e o do catalogo oficial 2026 — o mesmo das artes, o que o
  // vendedor fala e o que a IA falou na conversa (decisao do Daniel, 30/07/2026). Sem ele
  // gravado no modelo nao ha como provar que o PDF sai pelo preco certo: falha FECHADA.
  const catalogo = Number(mod.preco_catalogo || 0)
  if (!(catalogo > 0)) {
    return `modelo sem preco_catalogo — nao da pra garantir que o PDF sai pelo valor que a IA falou`
  }
  // A diferenca entre o catalogo e a soma interna vira o bloco de acessorios. Se ela ficar
  // negativa ou absurda, o dado esta incoerente e nao se gera nada.
  const sobra = catalogo - Number(mod.total_equipamentos || 0) - Number(mod.total_motores || 0)
  const acessDeclarado = Number(mod.acessorios?.valor || 0)
  if (sobra < 0) {
    return `preco_catalogo ${catalogo.toFixed(2)} e MENOR que equipamentos + motores (${(catalogo - sobra).toFixed(2)})`
  }
  // Tolerancia de R$ 1.500: cobre o arredondamento do catalogo e as 8 Compactas 03 cujo bloco de
  // acessorios esta R$ 58 a R$ 1.171 defasado. Acima disso e outra coisa — e para.
  if (acessDeclarado > 0 && Math.abs(sobra - acessDeclarado) > 1500) {
    return `acessorios do modelo (${acessDeclarado.toFixed(2)}) longe demais da diferenca ate o catalogo (${sobra.toFixed(2)})`
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

  // probe: testa SO a autenticacao contra o /api/gerar-pdf, sem gerar orcamento nenhum.
  // Corpo vazio -> se o auth passou, o endpoint responde 400 missing_preview_props (ele so
  // checa o corpo DEPOIS do getUser); se o auth falhou, responde 401. Discriminador limpo,
  // e sem pagar o cold start de ~5s do Chromium. Nunca devolve o token.
  if (body.probe) {
    try {
      const t = await tokenDeUsuario()
      const r = await fetch(`${CRM_URL}/api/gerar-pdf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + t },
        body: JSON.stringify({}),
      })
      const txt = (await r.text()).slice(0, 200)
      return j({ ok: r.status === 400, probe: true, email: PDF_USER_EMAIL, status: r.status, resposta: txt })
    } catch (e) {
      return j({ ok: false, probe: true, email: PDF_USER_EMAIL, erro: String((e as Error)?.message || e) })
    }
  }

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
        .select('slug, pacote, voltagem, itens, motores, acessorios, total_equipamentos, total_motores, total_proposta, preco_catalogo')
        .eq('slug', p.modelo_slug).eq('ativo', true).maybeSingle()

      const problema = validarPedido(p, mod)
      if (problema) { await falhar(problema); continue }

      const num = await proximoNumero(supa)
      const hoje = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })

      // 1. PDF via PUPPETEER — o MESMO caminho que o vendedor usa na tela.
      // O primeiro corte deste worker usava /api/orcamento-template-fill + docx-to-pdf, que no
      // fluxo manual e o FALLBACK (Tier 2, quando o Puppeteer falha). Resultado: PDF de 47 KB com
      // ZERO imagens, contra 3 MB e 7 fotos do orcamento real. O Puppeteer renderiza o HTML/CSS da
      // previa — mesmas fotos, mesma paginacao, texto selecionavel.
      // As FOTOS nao vivem no modelo — vivem no catalogo. orcamento_modelos.itens guarda nome,
      // specs e valor, mas foto_url vem null e nao ha catalogo_id pra ligar. Quando o vendedor
      // monta na tela ele pega o item DO CATALOGO, que ja traz a foto; o modelo perdeu esse elo.
      // Casamento por nome exato (nome_completo), que bate nos itens conferidos. Item sem par
      // simplesmente sai sem foto — o PDF continua correto, so menos ilustrado.
      const nomes = (mod.itens || []).map((i: any) => String(i.nome || '')).filter(Boolean)
      const fotos: Record<string, string> = {}
      if (nomes.length) {
        const { data: cat } = await supa.from('catalogo_items')
          .select('nome_completo, foto_url, imagem_url').in('nome_completo', nomes).eq('ativo', true)
        for (const c of (cat || [])) {
          const u = c.foto_url || c.imagem_url
          if (u && !fotos[c.nome_completo]) fotos[c.nome_completo] = u
        }
      }
      const semFoto = nomes.filter((n: string) => !fotos[n])
      if (semFoto.length) console.warn('[ia-orcamento] sem foto no catalogo: ' + semFoto.join(' | '))

      const itensPdf = (mod.itens || []).map((i: any, idx: number) => ({
        uid: `pdf-${idx}`, categoria: i.categoria || '', nome: i.nome, specs: i.specs || [],
        qtd: i.qtd || 1, valor: i.valor,
        motor_cv: i.motor_cv ?? null, motor_polos: i.motor_polos ?? null,
        motor_qtd: i.motor_qtd ?? 1, motor_valor_unit: i.motor_valor_unit ?? 0,
        foto_url: i.foto_url ?? fotos[String(i.nome || '')] ?? null,
        brinde: !!i.brinde, incluso: !!i.incluso, por_conta_cliente: !!i.motor_por_conta_cliente,
      }))

      // ⚠️ O TOTAL DO PDF SAI DO CATALOGO, nao de `total_proposta` (10/09/2026).
      // `total_proposta` e so equipamentos + motores; os ACESSORIOS ficam de fora dele e o
      // catalogo os inclui. Usar total_proposta mandava para o cliente, por escrito, um valor
      // 7,5% menor do que a IA tinha acabado de falar na conversa — e o cliente cobra o papel.
      // Aqui o total e o catalogo e o bloco de acessorios ABSORVE a diferenca, o que garante
      // duas coisas ao mesmo tempo: o preco e o oficial, e a soma das linhas fecha com o total
      // (se nao fechasse, o cliente somaria item por item e acharia erro no proprio orcamento).
      // `validarPedido` ja recusou o pedido se essa diferenca fosse negativa ou grande demais.
      const precoCatalogo = Number(mod.preco_catalogo)
      const valorAcessorios = precoCatalogo - Number(mod.total_equipamentos || 0) - Number(mod.total_motores || 0)

      const previewProps = {
        carrinho: itensPdf,
        motoresAgrupados: (mod.motores || []).map((m: any) => ({
          cv: m.cv, polos: m.polos, qtd: m.qtd ?? 1,
          valor_unit: Number(m.valor ?? m.valor_total ?? 0),
          valor_total: Number(m.valor ?? m.valor_total ?? 0),
        })),
        voltagem: p.voltagem,
        totalItems: Number(mod.total_equipamentos || 0),
        totalMotores: Number(mod.total_motores || 0),
        totalEquip: Number(mod.total_equipamentos || 0),
        totalGeral: precoCatalogo,
        acessorios: mod.acessorios ? { pct: mod.acessorios.pct ?? null, items: mod.acessorios.items || [] } : null,
        valorAcessorios,
        numero: num.numero,
        dataEmissao: hoje,
        cliente: {
          nome: p.cliente_nome, ac: null, fone: p.cliente_telefone || null,
          cidade: [p.cidade, p.uf].filter(Boolean).join('/') || null,
          bairro: null, endereco: null, cep: null, cnpj: null, ie: null, ie_tipo: null, email: null,
        },
        terms: {
          dataVenda: null,
          prazoEntrega: '90 dias uteis',
          formaPagamento: '25% no pedido, 25% na conclusao do equipamento e 50% em boleto apos o carregamento (sujeito a analise de credito)',
          freteTipo: null, freteTxt: null, validadeDias: null,
        },
        observacoesExtra: null, obsPorConta: null, fotoPrincipal: null,
        tensaoMotores: null, marcaMotores: null, desconto: null,
        parcelas: [], componentesExtras: [],
        vendedoresContato: [], vendedorResponsavelNome: p.vendedor_nome,
        finameMode: false,
      }

      // Bearer = sessao de usuario, NAO service_role. Ver comentario em tokenDeUsuario().
      const pdfToken = await tokenDeUsuario()
      const gp = await fetch(`${CRM_URL}/api/gerar-pdf`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + pdfToken },
        body: JSON.stringify({ previewProps }),
      })
      if (!gp.ok) { await falhar('gerar-pdf HTTP ' + gp.status + ': ' + (await gp.text()).slice(0, 200)); continue }
      const pdf = await gp.arrayBuffer()
      // PDF valido comeca com %PDF. Sem isso, veio erro em corpo de texto.
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
        itens: mod.itens, motores: mod.motores,
        // O acessorio vai gravado com o valor que ENTROU no PDF (o que fecha com o catalogo),
        // nao com o do modelo — senao /orcamentos/salvos mostraria um total que nao bate com o
        // papel que o cliente tem na mao.
        acessorios: mod.acessorios ? { ...mod.acessorios, valor: valorAcessorios } : null,
        total_equipamentos: mod.total_equipamentos, total_motores: mod.total_motores,
        total_proposta: precoCatalogo,
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

      // 5. Envio AO CLIENTE — `destino: 'cliente'` (edge v11+)
      //
      // ⚠️ Ate 10/09/2026 este bloco mandava so `telefone_destino` e a proposta NAO chegava ao
      // cliente: a edge gravava `to_self: true` sempre, e a extensao, ao ver to_self, troca o
      // alvo pelo proprio numero (background.js:3191 — `const alvo = msg.to_self ? meuId :
      // msg.chat_id`). O chat_id do cliente era montado e ignorado. Resultado nos orcamentos
      // 2026-2534 e 2026-2535: a IA prometeu a proposta na conversa, o PDF caiu no zap do
      // vendedor e o cliente nao recebeu nada.
      //
      // `telefone_destino` continua significando "o zap do vendedor" nos 4 chamadores do CRM
      // (fluxo manual, onde o vendedor recebe e repassa) — por isso o campo do cliente e outro.
      const envio = await fetch(`${SUPABASE_URL}/functions/v1/orcamento-enviar-meu-zap`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + SERVICE_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          destino: 'cliente',
          telefone_cliente: p.cliente_telefone,
          vendedor_nome: p.vendedor_nome,
          pdf_url: pdfUrl, filename: `Orcamento ${num.numero}.pdf`,
          cliente_nome: p.cliente_nome,
          numero: num.numero, origem: 'ia-orcamento-worker',
          caption: `${p.cliente_nome.split(' ')[0]}, segue a proposta com os equipamentos, valores e condicoes. Da uma conferida e me chama se ficar qualquer duvida.`,
        }),
      })
      const enviou = envio.ok
      // Guarda o MOTIVO, nao so o status: 'HTTP 400' sozinho nao diz se foi telefone invalido,
      // vendedor fora do cadastro ou fila. Sem isso o diagnostico exige abrir os logs da edge.
      const envioDetalhe = enviou ? '' : (await envio.text().catch(() => '')).slice(0, 200)

      // Espelha no orcamento do CRM: quem abre /orcamentos/salvos ve o mesmo status de sempre.
      if (enviou && orc?.id) {
        await supa.from('orcamentos_gerados')
          .update({ status: 'enviado', enviado_em: new Date().toISOString() }).eq('id', orc.id)
      }

      await supa.from('ia_orcamento_pedidos').update({
        status: enviou ? 'enviado' : 'gerado', orcamento_id: orc?.id ?? null, pdf_url: pdfUrl,
        erro: enviou ? null : ('PDF gerado mas envio falhou (HTTP ' + envio.status + ') ' + envioDetalhe).trim(),
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
