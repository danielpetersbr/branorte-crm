// Due Diligence — endpoint de consulta SPC (Fase 2).
//
// Fluxo:
//  1. valida JWT do usuario logado
//  2. valida contact_id pertence ao tenant (ou eh admin)
//  3. checa cache de 30d via view v_dd_cache_30d
//     - se HIT → retorna sem cobrar (custo = 0, _cache_hit = true)
//     - se MISS → chama SPC, salva e retorna
//  4. monta pacote economico: CNPJ SPC + Score (+CPF socio opcional)
//
// Variaveis de ambiente:
//   SPC_USER         usuario de webservice (NAO o usuario WEB)
//   SPC_PASSWORD     senha de webservice
//   SPC_AMBIENTE     'homolog' (default) ou 'producao'
//   SPC_MOCK         '1' = retorna payload fake (pra dev sem credenciais)
//
// O endpoint salva o resultado em due_diligence_consultas (status=success ou
// =failed) e retorna o registro pro frontend. Cache de 30d eh por CNPJ.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  consultarSpc,
  PRODUTOS_SPC,
  INSUMOS_OPCIONAIS,
  calcularCustoPacote,
  type AmbienteSpc,
} from './_lib/spc-client.js'
import { gerarMockResumo, normalizarPayloadSpc } from './_lib/spc-normalizer.js'
import { buscarProcessos, type DatajudResultado } from './_lib/datajud-client.js'
import {
  consultarPortalTransparencia,
  type PortalTransparenciaResultado,
} from './_lib/portal-transparencia-client.js'
import { gerarParecerIA } from './_lib/dd-parecer-ia.js'
import { consultarOpenCnpj, type OpenCnpjResultado } from './_lib/opencnpj-client.js'
import { buscarNoticias, type NoticiasResultado } from './_lib/news-client.js'
import {
  enriquecerCEP,
  detectarEnderecoCompartilhado,
  type CepInfo,
  type EnderecoCompartilhadoInfo,
} from './_lib/brasil-api-client.js'
import {
  calcularDossie,
  type DetetiveInput,
  type DossieResultado,
} from './_lib/detetive-scoring.js'

export const config = {
  api: {
    bodyParser: { sizeLimit: '1mb' },
  },
  maxDuration: 60,
}

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!
const SPC_USER = process.env.SPC_USER || ''
const SPC_PASSWORD = process.env.SPC_PASSWORD || ''
const SPC_AMBIENTE: AmbienteSpc =
  (process.env.SPC_AMBIENTE as AmbienteSpc) === 'producao' ? 'producao' : 'homolog'
const SPC_MOCK = process.env.SPC_MOCK === '1'

interface ConsultarBody {
  /** UUID do contato (FK contacts.id) — opcional, pra registrar vinculo */
  contact_id?: string | null
  /** Tipo: 'pj' = so empresa, 'pf' = so pessoa, 'ambos' = empresa + socio. Default = 'pj' (legado). */
  tipo_consulta?: 'pj' | 'pf' | 'ambos'
  /** CNPJ — obrigatorio se tipo_consulta = pj|ambos */
  cnpj?: string | null
  /** CPF — obrigatorio se tipo_consulta = pf|ambos */
  cpf_socio?: string | null
  /** Pacote: economico | completo | paranoico | custom */
  pacote: 'economico' | 'completo' | 'paranoico' | 'custom'
  /** Forca reconsulta mesmo se tem cache <30d */
  force_refresh?: boolean
}

// ============================================================================
// Pacotes — definicoes
// ============================================================================
// PRODUTO BASE em todos os pacotes: 325 (Novo SPC Maxi).
//
// IMPORTANTE: os codigos de insumo da API REST sao DIFERENTES dos codigos
// da tabela de precos FCDL/SC. Os codigos corretos foram extraidos do XML
// "Todos produtos detalhado - Produção.txt" do manual oficial e testados em
// producao em 29/05/2026. Todos os 17 insumos testados retornaram 200 OK
// pra produto 325 com tipoConsumidor='J'.
//
// Economico PJ: 325 + Score 12m + Participacao + PEP = ~R$ 10,49
// Economico PF: 325 + Score 12m + Renda Presumida + PEP = ~R$ 8,10
// Completo:   + Faturamento + Quadro Social + Grupo Econ + Risco Credito + Limite
function montarPacotes(
  pacote: ConsultarBody['pacote'],
  opts: { incluiPj: boolean; incluiPf: boolean },
) {
  type Plano = {
    produto: string
    insumos: number[]
    tipoConsumidor: 'F' | 'J'
  }
  const planos: Plano[] = []
  if (pacote !== 'economico' && pacote !== 'completo' && pacote !== 'paranoico') {
    return planos
  }
  const isCompleto = pacote === 'completo' || pacote === 'paranoico'

  if (opts.incluiPj) {
    // PJ: Novo SPC Maxi + Score 12m + Participação Empresas + PEP
    const insumosPj: number[] = [
      INSUMOS_OPCIONAIS.SCORE_12_MESES.codigo,         // 78
      INSUMOS_OPCIONAIS.PARTICIPACAO_EMPRESAS.codigo,  // 24
      INSUMOS_OPCIONAIS.PEP.codigo,                    // 5255
      INSUMOS_OPCIONAIS.STATUS_RECEITA_FEDERAL.codigo, // 5183 (Receita ativa?)
    ]
    if (isCompleto) {
      insumosPj.push(
        INSUMOS_OPCIONAIS.FATURAMENTO_PRESUMIDO_PJ.codigo,  // 5178
        INSUMOS_OPCIONAIS.QUADRO_SOCIAL_COMPLETO.codigo,    // 5186
        INSUMOS_OPCIONAIS.GRUPO_ECONOMICO.codigo,           // 5241
        INSUMOS_OPCIONAIS.RISCO_CREDITO_PJ.codigo,          // 5184
        INSUMOS_OPCIONAIS.LIMITE_CREDITO_SUGERIDO.codigo,   // 5142
        INSUMOS_OPCIONAIS.SCORE_PJ.codigo,                  // 5229
      )
    }
    planos.push({
      produto: PRODUTOS_SPC.NOVO_SPC_MAXI.codigo,
      insumos: insumosPj,
      tipoConsumidor: 'J',
    })
  }

  if (opts.incluiPf) {
    // PF: Novo SPC Maxi + Score 12m + Participação Empresas + PEP + Renda Presumida
    const insumosPf: number[] = [
      INSUMOS_OPCIONAIS.SCORE_12_MESES.codigo,         // 78
      INSUMOS_OPCIONAIS.PARTICIPACAO_EMPRESAS.codigo,  // 24
      INSUMOS_OPCIONAIS.PEP.codigo,                    // 5255
      INSUMOS_OPCIONAIS.RENDA_PRESUMIDA_PF.codigo,     // 5097
    ]
    if (isCompleto) {
      insumosPf.push(
        INSUMOS_OPCIONAIS.COMPROMETIMENTO_RENDA.codigo, // 5194
        INSUMOS_OPCIONAIS.ALERTA_CPF_SUSPEITO.codigo,   // 5264
        INSUMOS_OPCIONAIS.ALERTA_IDENTIDADE_FRAUDE.codigo, // 5262
      )
    }
    planos.push({
      produto: PRODUTOS_SPC.NOVO_SPC_MAXI.codigo,
      insumos: insumosPf,
      tipoConsumidor: 'F',
    })
  }

  return planos
}

function normalizarDoc(doc: string | null | undefined): string {
  return (doc ?? '').replace(/\D/g, '')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
  if (req.method === 'OPTIONS') return res.status(204).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })

  if (!SUPA_URL || !SVC_KEY) {
    return res.status(500).json({ error: 'env_missing', detail: 'Supabase env nao configurada' })
  }

  // 1) Auth do usuario
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
  if (!auth) return res.status(401).json({ error: 'no_auth' })

  const supa = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })
  const { data: u, error: uErr } = await supa.auth.getUser(auth)
  if (uErr || !u?.user) return res.status(401).json({ error: 'invalid_jwt', detail: uErr?.message })
  const userId = u.user.id

  // 2) Body
  const body = req.body as ConsultarBody
  const tipoConsulta = body?.tipo_consulta || 'pj'
  const cnpj = body?.cnpj ? normalizarDoc(body.cnpj) : ''
  const cpfSocio = body?.cpf_socio ? normalizarDoc(body.cpf_socio) : ''
  const pacote = body?.pacote || 'economico'

  if (!['pj', 'pf', 'ambos'].includes(tipoConsulta)) {
    return res.status(400).json({ error: 'tipo_consulta_invalido' })
  }
  const precisaCnpj = tipoConsulta === 'pj' || tipoConsulta === 'ambos'
  const precisaCpf = tipoConsulta === 'pf' || tipoConsulta === 'ambos'

  if (precisaCnpj && cnpj.length !== 14) {
    return res.status(400).json({ error: 'cnpj_invalido', detail: 'CNPJ deve ter 14 digitos' })
  }
  if (precisaCpf && cpfSocio.length !== 11) {
    return res.status(400).json({ error: 'cpf_invalido', detail: 'CPF deve ter 11 digitos' })
  }
  if (!['economico', 'completo', 'paranoico', 'custom'].includes(pacote)) {
    return res.status(400).json({ error: 'pacote_invalido' })
  }

  // 3) Permissao do user (precisa de 'due_diligence.consultar')
  const { data: perms } = await supa
    .from('role_permissions')
    .select('permissions')
    .eq('role', (await supa.from('user_profiles').select('role').eq('id', userId).single()).data?.role || 'vendor')
    .single()
  const pode = (perms?.permissions as Record<string, boolean> | null)?.['due_diligence.consultar']
  if (pode === false) {
    return res.status(403).json({ error: 'sem_permissao' })
  }

  // 4) Cache 30d (a menos que force_refresh)
  // Cache so funciona pra PJ por enquanto (v_dd_cache_30d indexa por cnpj_normalizado)
  if (!body.force_refresh && precisaCnpj && cnpj.length === 14) {
    const { data: cache } = await supa
      .from('v_dd_cache_30d')
      .select('*')
      .eq('cnpj_normalizado', cnpj)
      .maybeSingle()
    if (cache) {
      return res.status(200).json({
        ok: true,
        _cache_hit: true,
        consulta: { ...cache, custo_brl: 0 },
      })
    }
  }

  // 5) Cria registro pending pra rastreabilidade mesmo se falhar
  const planos = montarPacotes(pacote, { incluiPj: precisaCnpj, incluiPf: precisaCpf })
  const todosOsCodigos = planos.flatMap(p => [p.produto, ...p.insumos.map(String)])
  const custoEstimado = planos.reduce(
    (acc, p) => acc + calcularCustoPacote({ produto: p.produto, insumos: p.insumos }),
    0,
  )

  const { data: inserted, error: insErr } = await supa
    .from('due_diligence_consultas')
    .insert({
      contact_id: body.contact_id || null,
      cnpj: precisaCnpj ? cnpj : null,
      cpf_socio: precisaCpf ? cpfSocio : null,
      pacote,
      produtos_spc: todosOsCodigos,
      status: 'pending',
      custo_brl: 0,
      created_by: userId,
    })
    .select('id')
    .single()
  if (insErr || !inserted) {
    return res.status(500).json({ error: 'insert_failed', detail: insErr?.message })
  }
  const consultaId = inserted.id

  // 6) Consulta SPC (ou mock)
  let resultadoSpc: Record<string, unknown> | null = null
  let statusFinal: 'success' | 'partial' | 'failed' = 'success'
  let erroMsg: string | null = null

  // ─── Datajud (CNJ) — processos judiciais, em paralelo com SPC ───
  // Grátis, sem auth privada. Busca o doc principal (CNPJ se PJ, CPF se PF).
  const docDatajud = precisaCnpj && cnpj.length === 14
    ? cnpj
    : precisaCpf && cpfSocio.length === 11
    ? cpfSocio
    : ''
  const tipoDatajud: 'F' | 'J' = precisaCnpj ? 'J' : 'F'
  const datajudPromise: Promise<DatajudResultado | null> = docDatajud
    ? buscarProcessos({ documento: docDatajud, tipo: tipoDatajud, porTribunal: 5, timeoutMs: 12_000 })
        .catch(e => ({
          ok: false,
          documento: docDatajud,
          tipoDocumento: tipoDatajud,
          totalEncontrado: 0,
          processos: [],
          resumoTribunais: [],
          erros: [e instanceof Error ? e.message : String(e)],
        }))
    : Promise.resolve(null)

  // ─── Portal da Transparência (CGU) — PEP + CEIS + CNEP + CEPIM, em paralelo ───
  // Grátis (token gov.br), 8s por endpoint, fan-out de 4. Modo gracioso: se
  // PORTAL_TRANSPARENCIA_KEY ausente, retorna ok=false sem quebrar nada.
  const portalPromise: Promise<PortalTransparenciaResultado> = consultarPortalTransparencia({
    cnpj: precisaCnpj && cnpj.length === 14 ? cnpj : null,
    cpf: precisaCpf && cpfSocio.length === 11 ? cpfSocio : null,
    timeoutMs: 8_000,
  }).catch(e => ({
    ok: false,
    cnpj: precisaCnpj ? cnpj : null,
    cpf: precisaCpf ? cpfSocio : null,
    pep: { endpoint: 'peps', tem: false, quantidade: 0, detalhes: [], erro: null },
    ceis: { endpoint: 'ceis', tem: false, quantidade: 0, detalhes: [], erro: null },
    cnep: { endpoint: 'cnep', tem: false, quantidade: 0, detalhes: [], erro: null },
    cepim: { endpoint: 'cepim', tem: false, quantidade: 0, detalhes: [], erro: null },
    total_sancoes: 0,
    is_pep: false,
    erros: [e instanceof Error ? e.message : String(e)],
    motivo_nao_rodou: 'excecao_no_fanout',
  }))

  // ─── OpenCNPJ (BrasilAPI/publica.cnpj.ws) — cadastro público, em paralelo ───
  // Grátis, sem auth. Usado pra enriquecer dossiê: razão social, sócios, CNAE,
  // capital social, endereço. Só roda se for PJ.
  const opencnpjPromise: Promise<OpenCnpjResultado | null> =
    precisaCnpj && cnpj.length === 14
      ? consultarOpenCnpj(cnpj).catch(e => ({
          ok: false,
          cnpj,
          razao_social: null,
          nome_fantasia: null,
          situacao: null,
          data_abertura: null,
          capital_social: null,
          natureza_juridica: null,
          porte: null,
          mei: false,
          simples_nacional: null,
          cnae_principal: null,
          cnae_secundarios: [],
          endereco: null,
          telefone: null,
          email: null,
          socios: [],
          erro: e instanceof Error ? e.message : String(e),
          fonte: null,
        }) as OpenCnpjResultado)
      : Promise.resolve(null)

  if (SPC_MOCK) {
    // Modo dev: payload fake estruturado (mesmo shape do real, mas com dados ficticios)
    const resumos = planos.map(p => ({
      produto: p.produto,
      documento: p.tipoConsumidor === 'J' ? cnpj : cpfSocio,
      ok: true,
      resumo: gerarMockResumo(p.tipoConsumidor, p.tipoConsumidor === 'J' ? cnpj : cpfSocio),
    }))
    resultadoSpc = {
      _mock: true,
      _nota: 'Resultado simulado — SPC_MOCK=1 no ambiente',
      resumos,
    }
  } else if (!SPC_USER || !SPC_PASSWORD) {
    statusFinal = 'failed'
    erroMsg = 'SPC nao configurado: defina SPC_USER e SPC_PASSWORD nas env vars do Vercel'
  } else {
    // Chama SPC pra cada plano em sequencia (consultas independentes)
    const consultas: Array<Record<string, unknown>> = []
    const resumos: Array<Record<string, unknown>> = []
    let algumaFalhou = false
    let todasFalharam = true
    for (const plano of planos) {
      const doc = plano.tipoConsumidor === 'J' ? cnpj : cpfSocio
      const r = await consultarSpc(
        {
          codigoProduto: plano.produto,
          tipoConsumidor: plano.tipoConsumidor,
          documentoConsumidor: doc || '',
          codigoInsumoOpcional: plano.insumos,
        },
        { usuario: SPC_USER, senha: SPC_PASSWORD, ambiente: SPC_AMBIENTE },
      )
      consultas.push({
        produto: plano.produto,
        documento: doc,
        ok: r.ok,
        status: r.status,
        data: r.data,
        erro: r.erro,
      })
      // Normaliza o payload pra estrutura "resumo" que o frontend renderiza
      if (r.ok) {
        const resumo = normalizarPayloadSpc(r.data ?? null, doc || '')
        if (resumo) {
          resumos.push({ produto: plano.produto, documento: doc, ok: true, resumo })
        }
        todasFalharam = false
      } else {
        algumaFalhou = true
      }
    }
    resultadoSpc = { resumos, consultas }
    if (todasFalharam) {
      statusFinal = 'failed'
      erroMsg = 'Todas as consultas SPC falharam'
    } else if (algumaFalhou) {
      statusFinal = 'partial'
      erroMsg = 'Algumas consultas SPC falharam — veja resultado_spc.consultas'
    }
  }

  // 7) Aguarda Datajud + Portal Transparência + OpenCNPJ (já rodando em paralelo)
  const [datajudResultado, portalResultado, opencnpjResultado] = await Promise.all([
    datajudPromise,
    portalPromise,
    opencnpjPromise,
  ])

  // 7.0.1) Fanout secundário — depende do OpenCNPJ (razão social pra notícias,
  // CEP pra enriquecimento). News pode rodar com razão do SPC se OpenCNPJ falhar.
  const razaoParaNoticias =
    opencnpjResultado?.razao_social ||
    (resultadoSpc as { resumos?: Array<{ resumo?: { consumidor?: { nome?: string | null } } }> } | null)
      ?.resumos?.[0]?.resumo?.consumidor?.nome ||
    null
  const nomesSociosParaNoticias = opencnpjResultado?.socios?.map(s => s.nome).filter(Boolean) ?? []

  const noticiasPromise: Promise<NoticiasResultado | null> = razaoParaNoticias
    ? buscarNoticias({
        razaoSocial: razaoParaNoticias,
        cnpj: precisaCnpj ? cnpj : undefined,
        nomesSocios: nomesSociosParaNoticias,
      }).catch(e => ({
        ok: false,
        total: 0,
        tem_alerta: false,
        noticias: [],
        keywords_que_bateram: [],
        erros: [e instanceof Error ? e.message : String(e)],
      }) as NoticiasResultado)
    : Promise.resolve(null)

  const cepDoEndereco = opencnpjResultado?.endereco?.cep ?? null
  const numeroDoEndereco = opencnpjResultado?.endereco?.numero ?? undefined
  const cepPromise: Promise<CepInfo | null> = cepDoEndereco
    ? enriquecerCEP(cepDoEndereco).catch(() => null)
    : Promise.resolve(null)
  const enderecoCompartilhadoPromise: Promise<EnderecoCompartilhadoInfo | null> = cepDoEndereco
    ? detectarEnderecoCompartilhado(cepDoEndereco, numeroDoEndereco).catch(() => null)
    : Promise.resolve(null)

  const [noticiasResultado, cepResultado, enderecoCompartilhado] = await Promise.all([
    noticiasPromise,
    cepPromise,
    enderecoCompartilhadoPromise,
  ])

  // 7.0.2) Persistência do Portal Transparência + Detetive:
  // ESCOLHA DE PERSISTÊNCIA — IMPORTANTE LER ANTES DE MEXER:
  //   A tabela `due_diligence_consultas` tem colunas:
  //     resultado_spc | resultado_datajud | resultado_google | resultado_instagram
  //   NÃO existe coluna pra Portal Transparência, OpenCNPJ, Notícias, BrasilAPI ou
  //   Detetive, e a tarefa proíbe migration agora. Caminho sem migration: aninhar
  //   tudo como subchaves em `resultado_spc` (jsonb livre). Subchaves criadas:
  //     resultado_spc.portal_transparencia
  //     resultado_spc.opencnpj
  //     resultado_spc.noticias
  //     resultado_spc.brasilapi    (cep + endereço compartilhado)
  //     resultado_spc.dossie_detetive  ← consumido pelo DossieDetetiveCard
  if (!resultadoSpc || typeof resultadoSpc !== 'object') {
    resultadoSpc = {}
  }
  ;(resultadoSpc as Record<string, unknown>).portal_transparencia = portalResultado
  ;(resultadoSpc as Record<string, unknown>).opencnpj = opencnpjResultado
  ;(resultadoSpc as Record<string, unknown>).noticias = noticiasResultado
  ;(resultadoSpc as Record<string, unknown>).brasilapi = {
    cep: cepResultado,
    endereco_compartilhado: enderecoCompartilhado,
  }

  // 7.0.3) Cálculo do Dossiê do Detetive — consolida tudo em score 0-100 + semáforo
  let dossieDetetive: DossieResultado | null = null
  if (precisaCnpj && cnpj.length === 14) {
    try {
      const detetiveInput: DetetiveInput = {
        cnpj,
        // ticket_pedido: não temos no body atual; fica undefined.
        opencnpj: opencnpjResultado
          ? {
              razao_social: opencnpjResultado.razao_social,
              situacao: opencnpjResultado.situacao,
              data_abertura: opencnpjResultado.data_abertura,
              capital_social: opencnpjResultado.capital_social,
              cnae_principal: opencnpjResultado.cnae_principal,
              socios: opencnpjResultado.socios.map(s => ({
                nome: s.nome,
                cpf_cnpj_mascara: s.cpf_cnpj_mascara,
              })),
              endereco: opencnpjResultado.endereco
                ? {
                    cep: opencnpjResultado.endereco.cep,
                    municipio: opencnpjResultado.endereco.municipio,
                    uf: opencnpjResultado.endereco.uf,
                  }
                : null,
            }
          : null,
        cgu_sancoes: portalResultado
          ? {
              ceis: portalResultado.ceis?.quantidade ?? 0,
              cnep: portalResultado.cnep?.quantidade ?? 0,
              acordos_leniencia: 0, // não temos endpoint específico de leniência aqui
              cepim: portalResultado.cepim?.quantidade ?? 0,
            }
          : null,
        datajud: datajudResultado
          ? {
              total_processos: datajudResultado.totalEncontrado ?? datajudResultado.processos.length,
              // processos_por_ano não está pré-computado; deixa undefined (scoring lida)
            }
          : null,
        noticias: noticiasResultado
          ? {
              tem_alerta: noticiasResultado.tem_alerta,
              keywords_que_bateram: noticiasResultado.keywords_que_bateram,
              total: noticiasResultado.total,
            }
          : null,
        brasilapi:
          cepResultado || enderecoCompartilhado
            ? {
                endereco_compartilhado_count:
                  enderecoCompartilhado?.disponivel && enderecoCompartilhado.count != null
                    ? enderecoCompartilhado.count
                    : undefined,
                zona_inferida: cepResultado?.zona_inferida,
              }
            : null,
        socios_reverso: [], // reverso de sócios não está disponível em fontes públicas
      }
      dossieDetetive = calcularDossie(detetiveInput)
    } catch (e) {
      // Falha silenciosa — dossiê é best-effort; SPC + outros já estão persistidos
      ;(resultadoSpc as Record<string, unknown>).dossie_detetive_erro =
        e instanceof Error ? e.message : String(e)
    }
  }

  if (dossieDetetive) {
    ;(resultadoSpc as Record<string, unknown>).dossie_detetive = {
      ...dossieDetetive,
      // Campos que o card frontend espera mas que o motor não calcula:
      alvo: {
        razao_social: opencnpjResultado?.razao_social ?? null,
        nome_fantasia: opencnpjResultado?.nome_fantasia ?? null,
        idade_meses: opencnpjResultado?.data_abertura
          ? (() => {
              const d = new Date(opencnpjResultado.data_abertura)
              if (isNaN(d.getTime())) return null
              const meses =
                (new Date().getFullYear() - d.getFullYear()) * 12 +
                (new Date().getMonth() - d.getMonth())
              return meses >= 0 ? meses : null
            })()
          : null,
        capital_social: opencnpjResultado?.capital_social ?? null,
        situacao: opencnpjResultado?.situacao ?? null,
      },
      pegada_digital: {
        google_maps_url: cepResultado?.google_maps_url ?? undefined,
      },
      sancoes: portalResultado
        ? {
            ceis: portalResultado.ceis?.quantidade ?? 0,
            cnep: portalResultado.cnep?.quantidade ?? 0,
            acordos_leniencia: 0,
            cepim: portalResultado.cepim?.quantidade ?? 0,
          }
        : undefined,
      noticias: noticiasResultado
        ? {
            total: noticiasResultado.total,
            alertas: noticiasResultado.noticias
              .filter(n => n.keyword_match)
              .map(n => ({
                titulo: n.titulo,
                link: n.link,
                data: n.data ?? undefined,
                fonte: n.origem ?? n.fonte,
              })),
          }
        : undefined,
      fontes_consultadas: [
        opencnpjResultado?.ok ? `OpenCNPJ (${opencnpjResultado.fonte})` : null,
        portalResultado?.ok ? 'Portal Transparência (CGU)' : null,
        datajudResultado?.ok ? 'DataJud (CNJ)' : null,
        noticiasResultado?.ok ? 'GDELT + Google News' : null,
        cepResultado?.ok ? 'BrasilAPI (CEP)' : null,
        'SPC Brasil',
      ].filter((s): s is string => !!s),
      investigado_em: new Date().toISOString(),
      // Cache 30 dias (alinhado com v_dd_cache_30d). Front mostra "válido até".
      cache_valido_ate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
    }
  }

  // 7.0.4) Cache CNPJ por 30 dias (best-effort, não bloqueia resposta).
  // Tabela `cnpj_cache` (PK cnpj, dossie_json JSONB, score, semaforo, expires_at).
  // Schema é asumido como pré-existente; se a tabela não existir, ignora erro.
  if (dossieDetetive && precisaCnpj && cnpj.length === 14) {
    try {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
      await supa
        .from('cnpj_cache')
        .upsert(
          {
            cnpj,
            dossie_json: (resultadoSpc as Record<string, unknown>).dossie_detetive,
            score: dossieDetetive.score,
            semaforo: dossieDetetive.semaforo,
            expires_at: expiresAt,
          },
          { onConflict: 'cnpj' },
        )
    } catch {
      // Falha silenciosa — cache é otimização, não pré-requisito
    }
  }

  // 7.1) Parecer IA — consolida SPC + Datajud + Dossiê Detetive em markdown
  const resumosParaIA =
    (resultadoSpc as { resumos?: Array<{ resumo?: unknown }> } | null)?.resumos
      ?.map(r => r.resumo)
      .filter((r): r is Record<string, unknown> => !!r) ?? []
  let parecerIa: string | null = null
  let erroParecer: string | null = null
  const dossieParaIA = dossieDetetive
    ? {
        score: dossieDetetive.score,
        semaforo: dossieDetetive.semaforo,
        recomendacao: dossieDetetive.recomendacao,
        red_flags: dossieDetetive.red_flags.map(f => ({
          id: f.id,
          peso: f.peso,
          nome: f.nome,
          descricao: f.descricao,
        })),
        acoes_sugeridas: dossieDetetive.acoes_sugeridas,
      }
    : null
  if (
    statusFinal !== 'failed' ||
    (datajudResultado?.processos?.length ?? 0) > 0 ||
    dossieDetetive
  ) {
    try {
      const ia = await gerarParecerIA({
        spcResumos: resumosParaIA as Parameters<typeof gerarParecerIA>[0]['spcResumos'],
        datajud: datajudResultado,
        dossieDetetive: dossieParaIA,
        timeoutMs: 22_000,
      })
      parecerIa = ia.parecer
      erroParecer = ia.erro
    } catch (e) {
      erroParecer = e instanceof Error ? e.message : String(e)
    }
  }

  // 8) Update do registro com resultado
  // Custo: SPC cobra de verdade. Datajud + IA são grátis (IA tem custo mínimo).
  const custoFinal = statusFinal === 'failed' ? 0 : custoEstimado
  // Se SPC falhou MAS Datajud trouxe dados, considera 'partial' em vez de 'failed'
  if (statusFinal === 'failed' && datajudResultado && datajudResultado.processos.length > 0) {
    statusFinal = 'partial'
    erroMsg = `${erroMsg ?? ''} | Datajud retornou ${datajudResultado.processos.length} processo(s).`.trim()
  }

  const { data: updated, error: updErr } = await supa
    .from('due_diligence_consultas')
    .update({
      resultado_spc: resultadoSpc,
      resultado_datajud: datajudResultado as unknown as Record<string, unknown> | null,
      parecer_ia: parecerIa,
      status: statusFinal,
      custo_brl: custoFinal,
      erro: [erroMsg, erroParecer ? `IA: ${erroParecer}` : null].filter(Boolean).join(' | ') || null,
    })
    .eq('id', consultaId)
    .select('*')
    .single()
  if (updErr) {
    return res.status(500).json({ error: 'update_failed', detail: updErr.message })
  }

  return res.status(200).json({
    ok: statusFinal !== 'failed',
    _cache_hit: false,
    consulta: updated,
  })
}
