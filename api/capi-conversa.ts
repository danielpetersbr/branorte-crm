// POST /api/capi-conversa  — varredura que avisa o Meta quando o clique virou
// CONVERSA DE VERDADE.
//
// POR QUE UMA VARREDURA E NAO O GATILHO:
// quem carimba matched_at e o gatilho link_rota_casar_msg(), em wa_chat_messages
// -- a tabela onde a frota inteira grava. Pendurar chamada HTTP la dentro
// significa que uma indisponibilidade do Meta vira latencia (ou erro engolido)
// no caminho de TODA mensagem de cliente. A varredura desacopla: se o Meta cair,
// as linhas ficam pendentes e saem no minuto seguinte.
//
// ⚠️ SO MANDA O QUE E CONFIAVEL. O filtro exige match_via in ('codigo','texto').
// Medido em 05-07/08/2026: dos 10 casamentos existentes, os 3 por 'codigo' eram
// todos reais e os 7 por 'janela' eram todos de OUTRA origem (Instagram,
// Facebook, quiz, e ate um fornecedor prospectando a Branorte). Mandar 'janela'
// pro Meta seria ensinar o algoritmo a caçar o lead errado -- pior que nao
// mandar nada. Se um dia o casamento por janela for consertado e virar
// confiavel, e AQUI que o nome entra na lista.
//
// Tambem exige fbc: sem a assinatura do clique no anuncio o evento chega
// anonimo, nao credita criativo nenhum e so infla o pixel.
//
// Chamado por pg_cron (padrao da casa: net.http_post de dentro do banco).
// Protegido por segredo compartilhado -- este endpoint escreve na conta de
// anuncios, nao pode ficar aberto.

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
// Extensao .js OBRIGATORIA (ESM em producao) -- ver comentario em api/l.ts.
import { enviarEventoCapi, capiConfigurada } from './_lib/meta-capi.js'

const SUPA_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL!
const SVC_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Graus de certeza que podem virar conversao no Meta. Ver cabecalho. */
const CONFIAVEIS = ['codigo', 'texto']

/** Teto por rodada. Com ~7 conversas/semana isso nunca morde; existe pro caso
 *  de a varredura ficar dias parada e voltar com fila. */
const LOTE = 50

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store')

  const segredo = process.env.CAPI_SWEEP_SECRET
  if (!segredo || req.headers['x-capi-secret'] !== segredo) {
    return res.status(401).json({ erro: 'nao autorizado' })
  }
  if (!SUPA_URL || !SVC_KEY) return res.status(500).json({ erro: 'sem banco' })
  if (!capiConfigurada()) return res.status(200).json({ pulado: 'CAPI desligada (sem env)' })

  const db = createClient(SUPA_URL, SVC_KEY, { auth: { persistSession: false } })

  const { data: pendentes, error } = await db
    .from('link_rota_click')
    .select('id, codigo, fbc, ip, user_agent, matched_at, match_via, link_rota(nome, origem, slug)')
    .not('matched_at', 'is', null)
    .is('capi_enviado_at', null)
    .not('fbc', 'is', null)
    .in('match_via', CONFIAVEIS)
    .order('matched_at', { ascending: true })
    .limit(LOTE)

  if (error) return res.status(500).json({ erro: error.message })
  if (!pendentes?.length) return res.status(200).json({ enviados: 0, falhas: 0 })

  let enviados = 0
  let falhas = 0

  for (const p of pendentes as Array<Record<string, any>>) {
    const link = Array.isArray(p.link_rota) ? p.link_rota[0] : p.link_rota
    const r = await enviarEventoCapi({
      nome: 'Lead',
      // Sufixo -c: o evento do CLIQUE ja usou o codigo puro. Sem isso, um
      // reprocessamento poderia colidir com ele na deduplicacao do Meta.
      eventId: `${p.codigo}-c`,
      fbc: p.fbc,
      ip: p.ip,
      userAgent: p.user_agent,
      sourceUrl: link?.slug ? `https://branorte-crm.vercel.app/l/${link.slug}` : null,
      // O fato aconteceu quando a mensagem chegou, nao agora.
      quandoMs: p.matched_at ? new Date(p.matched_at).getTime() : null,
      custom: {
        content_name: link?.nome || 'link de roteamento',
        content_category: link?.origem || 'Link',
        // Aparece no Gerenciador e deixa auditar de que grau de certeza veio.
        match_via: p.match_via,
      },
    })

    if (r === 'ok') enviados++
    else falhas++

    // Marca SEMPRE, inclusive no erro: senao a proxima rodada reenvia o mesmo
    // evento e o Meta passa a contar duas vezes. Perder um evento e chato;
    // inflar conversao e o defeito que este endpoint inteiro existe pra evitar.
    // O resultado fica gravado pra dar pra achar e reprocessar na mao.
    await db
      .from('link_rota_click')
      .update({ capi_enviado_at: new Date().toISOString(), capi_resultado: r })
      .eq('id', p.id)
  }

  return res.status(200).json({ enviados, falhas })
}
