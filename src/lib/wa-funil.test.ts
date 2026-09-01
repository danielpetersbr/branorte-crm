/**
 * Testes da conversa do funil (drawer do /funil).
 *
 * Runner nativo do Node (sem dependência nova no projeto):
 *   npx tsx --test src/lib/wa-funil.test.ts
 *
 * Cobre a lógica pura que sustenta o histórico do drawer: janela/paginação,
 * ordem cronológica, dedup, formatação de telefone e o contrato de nomes de
 * etiqueta que a extensão precisa espelhar pra capturar a conversa.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  montarConversa, formatarTelefone, nomeContato, canonico, ALIASES, ORDEM_FUNIL,
  idCanonicoMsg, corpoVisivel, statusDaEtiqueta, statusDerivadoDaEtiqueta, comEtiquetasDoCrm,
  type MensagemLite,
} from './wa-funil'

const msg = (msg_id: string, data_msg: string | null, media_url?: string | null): MensagemLite =>
  ({ msg_id, data_msg, media_url })

// Como o banco devolve: DESC por data_msg (mais recente primeiro).
const desc = (...ms: MensagemLite[]) =>
  ms.slice().sort((a, b) => {
    if (!a.data_msg) return 1
    if (!b.data_msg) return -1
    return new Date(b.data_msg).getTime() - new Date(a.data_msg).getTime()
  })

test('ordena cronologicamente (antiga → recente) pra render em bolha', () => {
  const linhas = desc(
    msg('c', '2026-07-20T12:00:00Z'),
    msg('a', '2026-07-20T10:00:00Z'),
    msg('b', '2026-07-20T11:00:00Z'),
  )
  const { mensagens } = montarConversa(linhas, 30)
  assert.deepEqual(mensagens.map(m => m.msg_id), ['a', 'b', 'c'])
})

test('mensagem sem data_msg vai pro FIM, nunca pro topo', () => {
  const linhas = [msg('sem-data', null), ...desc(msg('nova', '2026-07-20T12:00:00Z'), msg('velha', '2026-07-20T10:00:00Z'))]
  const { mensagens } = montarConversa(linhas, 30)
  assert.equal(mensagens[mensagens.length - 1].msg_id, 'sem-data')
  assert.deepEqual(mensagens.slice(0, 2).map(m => m.msg_id), ['velha', 'nova'])
})

test('sem exceder o limite: temMais=false e devolve tudo', () => {
  const linhas = desc(msg('a', '2026-07-20T10:00:00Z'), msg('b', '2026-07-20T11:00:00Z'))
  const r = montarConversa(linhas, 30)
  assert.equal(r.temMais, false)
  assert.equal(r.mensagens.length, 2)
})

test('a linha-sonda (limite+1) marca temMais e NÃO é exibida', () => {
  // 4 linhas com limite 3 → sonda presente
  const linhas = desc(
    msg('m4', '2026-07-20T13:00:00Z'),
    msg('m3', '2026-07-20T12:00:00Z'),
    msg('m2', '2026-07-20T11:00:00Z'),
    msg('m1', '2026-07-20T10:00:00Z'),
  )
  const r = montarConversa(linhas, 3)
  assert.equal(r.temMais, true)
  assert.equal(r.mensagens.length, 3)
  // mantém as MAIS RECENTES e descarta a mais antiga (m1)
  assert.deepEqual(r.mensagens.map(m => m.msg_id), ['m2', 'm3', 'm4'])
})

test('exatamente no limite não acusa página anterior (off-by-one)', () => {
  const linhas = desc(
    msg('m3', '2026-07-20T12:00:00Z'),
    msg('m2', '2026-07-20T11:00:00Z'),
    msg('m1', '2026-07-20T10:00:00Z'),
  )
  const r = montarConversa(linhas, 3)
  assert.equal(r.temMais, false)
  assert.equal(r.mensagens.length, 3)
})

test('expandir o limite revela histórico mais antigo sem perder o recente', () => {
  const todas = desc(...Array.from({ length: 10 }, (_, i) =>
    msg(`m${i}`, `2026-07-20T${String(10 + i).padStart(2, '0')}:00:00Z`)))
  const pagina1 = montarConversa(todas.slice(0, 4), 3) // banco devolveu limite+1
  const pagina2 = montarConversa(todas.slice(0, 9), 8)
  assert.equal(pagina1.mensagens.length, 3)
  assert.equal(pagina2.mensagens.length, 8)
  // a mais recente continua sendo a última bolha nas duas páginas
  const ultima = <T extends { msg_id: string }>(a: T[]) => a[a.length - 1]
  assert.equal(ultima(pagina1.mensagens).msg_id, 'm9')
  assert.equal(ultima(pagina2.mensagens).msg_id, 'm9')
})

test('dedup por msg_id — bolha nunca repete', () => {
  const linhas = [
    msg('dup', '2026-07-20T11:00:00Z'),
    msg('dup', '2026-07-20T11:00:00Z'),
    msg('outra', '2026-07-20T10:00:00Z'),
  ]
  const { mensagens } = montarConversa(linhas, 30)
  assert.equal(mensagens.length, 2)
  assert.equal(new Set(mensagens.map(m => m.msg_id)).size, 2)
})

test('temMais vem da contagem CRUA — dedup nunca esconde histórico', () => {
  // 3 linhas cruas com limite 2: mesmo que 2 sejam a mesma mensagem, o banco
  // devolveu mais do que a janela. Preferimos oferecer um "carregar" a mais
  // do que deixar de oferecer quando existe mensagem antiga de verdade.
  const linhas = [
    msg('a', '2026-07-20T12:00:00Z'),
    msg('a', '2026-07-20T12:00:00Z'),
    msg('b', '2026-07-20T11:00:00Z'),
  ]
  const r = montarConversa(linhas, 2)
  assert.equal(r.temMais, true)
  assert.deepEqual(r.mensagens.map(m => m.msg_id), ['b', 'a']) // sem bolha repetida
})

// --- identidade canônica da mensagem (bug das bolhas duplicadas) -----------

test('idCanonicoMsg reduz as duas formas de msg_id ao mesmo hash', () => {
  assert.equal(idCanonicoMsg('3EB0201F4BF2979B45CFBB'), '3EB0201F4BF2979B45CFBB')
  assert.equal(idCanonicoMsg('true_113271390642224@lid_3EB0201F4BF2979B45CFBB'), '3EB0201F4BF2979B45CFBB')
  assert.equal(idCanonicoMsg('false_5547999@c.us_ABC123'), 'ABC123')
  assert.equal(idCanonicoMsg(''), '')
})

test('hash curto e serializado da MESMA msg viram UMA bolha', () => {
  // caso real: 1.129 pares assim no banco, em 137 chats
  const linhas = [
    msg('true_113271390642224@lid_3EB0201F', '2026-07-20T12:00:00Z'),
    msg('3EB0201F', '2026-07-20T12:00:00Z'),
    msg('OUTRA', '2026-07-20T11:00:00Z'),
  ]
  const { mensagens } = montarConversa(linhas, 30)
  assert.equal(mensagens.length, 2)
  assert.deepEqual(mensagens.map(m => idCanonicoMsg(m.msg_id)), ['OUTRA', '3EB0201F'])
})

test('entre duplicatas, vence a que tem mídia (não perde áudio/foto)', () => {
  const semMidia = msg('3EB0201F', '2026-07-20T12:00:00Z', null)
  const comMidia = msg('true_chat@lid_3EB0201F', '2026-07-20T12:00:00Z', 'https://x/audio.ogg')
  assert.equal(montarConversa([semMidia, comMidia], 30).mensagens[0].media_url, 'https://x/audio.ogg')
  // e independe da ordem de chegada
  assert.equal(montarConversa([comMidia, semMidia], 30).mensagens[0].media_url, 'https://x/audio.ogg')
})

test("mídia 'unavailable' não vence uma duplicata com mídia real", () => {
  const expirada = msg('3EB0201F', '2026-07-20T12:00:00Z', 'unavailable')
  const boa = msg('true_chat@lid_3EB0201F', '2026-07-20T12:00:00Z', 'https://x/foto.jpg')
  assert.equal(montarConversa([expirada, boa], 30).mensagens[0].media_url, 'https://x/foto.jpg')
})

test('mensagens do mesmo segundo têm ordem estável (não embaralham no refetch)', () => {
  const a = msg('AAA', '2026-07-20T12:00:00Z')
  const b = msg('BBB', '2026-07-20T12:00:00Z')
  const c = msg('CCC', '2026-07-20T12:00:00Z')
  const ordem1 = montarConversa([a, b, c], 30).mensagens.map(m => m.msg_id)
  const ordem2 = montarConversa([c, a, b], 30).mensagens.map(m => m.msg_id)
  const ordem3 = montarConversa([b, c, a], 30).mensagens.map(m => m.msg_id)
  assert.deepEqual(ordem1, ordem2)
  assert.deepEqual(ordem2, ordem3)
})

// --- corpo exibível (thumbnail base64 vazando) ----------------------------

test('thumbnail base64 de mídia sem legenda não vira texto na bolha', () => {
  // 976 linhas reais no banco (498 image + 351 video + 119 document + 8 location)
  const thumb = 'A'.repeat(400)
  assert.equal(corpoVisivel(thumb), null)
  assert.equal(corpoVisivel('/9j/4AAQSkZJRgABAQAAAQABAAD' + 'x'.repeat(200)), null)
})

test('legenda de verdade é preservada, inclusive com acento e emoji', () => {
  assert.equal(corpoVisivel('Segue a proposta'), 'Segue a proposta')
  assert.equal(corpoVisivel('  Orçamento em anexo 👍  '), 'Orçamento em anexo 👍')
  assert.equal(corpoVisivel(null), null)
  assert.equal(corpoVisivel(''), null)
})

test('texto longo COM espaços não é confundido com base64', () => {
  const longo = 'Bom dia, segue o detalhamento da fábrica '.repeat(12)
  assert.equal(corpoVisivel(longo), longo.trim())
})

test('código/link curto não é descartado por engano', () => {
  assert.equal(corpoVisivel('OK123'), 'OK123')
  assert.equal(corpoVisivel('https://branorte.com.br/orcamento'), 'https://branorte.com.br/orcamento')
})

test('conversa vazia é vazia — não inventa mensagem', () => {
  const r = montarConversa([], 30)
  assert.deepEqual(r.mensagens, [])
  assert.equal(r.temMais, false)
})

test('não muta o array de entrada', () => {
  const linhas = desc(msg('b', '2026-07-20T11:00:00Z'), msg('a', '2026-07-20T10:00:00Z'))
  const antes = linhas.map(m => m.msg_id)
  montarConversa(linhas, 30)
  assert.deepEqual(linhas.map(m => m.msg_id), antes)
})

// --- telefone -------------------------------------------------------------

test('formata telefone BR com e sem o nono dígito', () => {
  assert.equal(formatarTelefone('5566998144699'), '+55 (66) 99814-4699') // 13 díg, com 9
  assert.equal(formatarTelefone('556699814469'), '+55 (66) 9981-4469')   // 12 díg, sem 9
  assert.equal(formatarTelefone('+55 66 99814-4699'), '+55 (66) 99814-4699') // já formatado
})

test('telefone fora do padrão BR degrada sem quebrar', () => {
  assert.equal(formatarTelefone(''), '')
  assert.equal(formatarTelefone('12345'), '12345')
})

test('nome do contato cai pro telefone quando é placeholder', () => {
  assert.equal(nomeContato('João', '5566998144699'), 'João')
  assert.equal(nomeContato('(sem nome)', '5566998144699'), '+55 (66) 99814-4699')
  assert.equal(nomeContato(null, '5566998144699'), '+55 (66) 99814-4699')
})

// --- contrato de etiquetas ------------------------------------------------
// A extensão só captura conversa de chats cuja etiqueta canoniza pra um destes
// 5 nomes. Se um nome mudar aqui e não lá, a conversa some silenciosamente.

const ESTAGIOS_COM_CONVERSA = ['PROSPECCAO', '2A TENTATIVA', 'NOVO LEAD', 'FOLLOW UP', 'LEAD QUENTE']

test('os 5 estágios com conversa existem na ordem oficial do funil', () => {
  for (const e of ESTAGIOS_COM_CONVERSA) {
    assert.ok(ORDEM_FUNIL.includes(e), `estágio ausente de ORDEM_FUNIL: ${e}`)
  }
})

test('aliases de typo colapsam nos 5 estágios (contrato com a extensão)', () => {
  assert.equal(canonico('FALLOW UP'), 'FOLLOW UP')
  assert.equal(canonico('FOLLOWUP'), 'FOLLOW UP')
  assert.equal(canonico('QUENTE'), 'LEAD QUENTE')
  assert.equal(canonico('PROSPECCOES'), 'PROSPECCAO')
  assert.equal(canonico('NOVOS LEADS'), 'NOVO LEAD')
  assert.equal(canonico('LEAD NOVO'), 'NOVO LEAD')
})

test('todo alias que aponta pros 5 estágios está listado (pra espelhar na extensão)', () => {
  const aliasesDosEstagios = Object.entries(ALIASES)
    .filter(([, destino]) => ESTAGIOS_COM_CONVERSA.includes(destino))
    .map(([origem]) => origem)
    .sort()
  // Snapshot: se alguém adicionar um alias novo, este teste falha e lembra de
  // replicar em ALIASES_MSG do background.js da extensão.
  assert.deepEqual(aliasesDosEstagios, [
    // '2O TENTATIVA' entrou em 06/08/2026: existia só na função SQL
    // wa_etiqueta_canonica e faltava aqui. ⚠️ PENDENTE replicar em ALIASES_MSG
    // do background.js da extensão — é pra isso que este snapshot existe.
    '2O TENTATIVA',
    'FALLOW UP', 'FALLOWUP', 'FOLLOWUP', 'LEAD NOVO', 'NOVOS LEADS', 'PROSPECCOES', 'QUENTE',
  ])
})

test('etiqueta desconhecida passa direto (não vira estágio por acidente)', () => {
  assert.equal(canonico('ALGO NOVO'), 'ALGO NOVO')
  assert.equal(canonico('  FOLLOW UP  '), 'FOLLOW UP') // trim
})

// ─────────────────────────────────────────────────────────────────────────────
// Status derivado da etiqueta (regra ditada pelo Daniel em 06/08/2026)
// ⚠️ Estes testes existem pra travar o ESPELHO com as funcoes SQL
// `wa_status_da_etiqueta` e `wa_status_do_contato`. Divergiu, a tela explica uma
// coisa e o job grava outra.
// ─────────────────────────────────────────────────────────────────────────────

test('statusDaEtiqueta: prospeccao e negociacao sao ABERTO', () => {
  for (const e of ['PROSPECCAO', '2A TENTATIVA', '3A TENTATIVA', '4A TENTATIVA',
                   'NOVO LEAD', 'FOLLOW UP', 'LEAD QUENTE', 'ORCAMENTO ENVIADO']) {
    assert.equal(statusDaEtiqueta(e), 'ABERTO', e)
  }
})

test('statusDaEtiqueta: motivo de encerramento e FECHADO', () => {
  for (const e of ['INTERESSE FUTURO', 'SO BASE DE PRECO', 'NAO TEM INTERESSE',
                   'NAO FABRICAMOS', 'OUTROS ASSUNTOS', 'FORA DO ORCAMENTO', 'VENDIDO',
                   'NAO RESPONDEU MAIS', 'NUNCA RESPONDEU', 'RESOLVIDO', 'COMPROU DO CONCORRENTE']) {
    assert.equal(statusDaEtiqueta(e), 'FECHADO', e)
  }
})

test('statusDaEtiqueta: etiqueta avulsa ou interna NAO decide', () => {
  for (const e of ['IMPORTANTES', 'PENDENTE', 'FEIRA', 'SUPORTE TECNICO', 'AGENDAMENTO',
                   'BRANORTE', 'TRANSPORTADORAS', 'FUNCIONARIO', '19 - C. EDER / ORC. ENVIADO', '']) {
    assert.equal(statusDaEtiqueta(e), null, e)
  }
})

test('statusDaEtiqueta: typo e caixa passam pelo canonico', () => {
  assert.equal(statusDaEtiqueta('FALLOW UP'), 'ABERTO')
  assert.equal(statusDaEtiqueta('fallowup'), 'ABERTO')
  assert.equal(statusDaEtiqueta('VENDIDOS'), 'FECHADO')
  assert.equal(statusDaEtiqueta('RESOLVIDOS'), 'FECHADO')
  assert.equal(statusDaEtiqueta('  quente  '), 'ABERTO')
  assert.equal(statusDaEtiqueta(null), null)
})

test('statusDaEtiqueta: toda etiqueta de ORDEM_FUNIL decide algo', () => {
  // se alguem adicionar etiqueta no funil e esquecer do mapa, cai aqui
  for (const e of ORDEM_FUNIL) {
    assert.notEqual(statusDaEtiqueta(e), null, `${e} ficou fora de STATUS_POR_ETIQUETA`)
  }
})

test('statusDerivadoDaEtiqueta: a etiqueta do DONO vence a do outro vendedor', () => {
  const etqs = [
    { etiqueta: 'VENDIDO', vendedor: 'PEDRO', em: '2026-08-05T10:00:00Z' },
    { etiqueta: 'NOVO LEAD', vendedor: 'GUSTAVO', em: '2026-08-01T10:00:00Z' },
  ]
  assert.equal(statusDerivadoDaEtiqueta(etqs, 'GUSTAVO')?.status, 'ABERTO')
  assert.equal(statusDerivadoDaEtiqueta(etqs, 'PEDRO')?.status, 'FECHADO')
})

test('statusDerivadoDaEtiqueta: sem dono, vale a mais recente', () => {
  const etqs = [
    { etiqueta: 'VENDIDO', vendedor: 'PEDRO', em: '2026-08-05T10:00:00Z' },
    { etiqueta: 'NOVO LEAD', vendedor: 'GUSTAVO', em: '2026-08-01T10:00:00Z' },
  ]
  assert.equal(statusDerivadoDaEtiqueta(etqs, null)?.status, 'FECHADO')
  assert.equal(statusDerivadoDaEtiqueta(etqs, 'ALVARO')?.status, 'FECHADO', 'dono sem etiqueta cai na mais recente')
})

test('statusDerivadoDaEtiqueta: entre as do dono, a mais recente manda', () => {
  const etqs = [
    { etiqueta: 'NOVO LEAD', vendedor: 'EDER', em: '2026-08-01T10:00:00Z' },
    { etiqueta: 'VENDIDO', vendedor: 'EDER', em: '2026-08-05T10:00:00Z' },
  ]
  const r = statusDerivadoDaEtiqueta(etqs, 'EDER')
  assert.equal(r?.status, 'FECHADO')
  assert.equal(r?.etiqueta, 'VENDIDO')
})

test('statusDerivadoDaEtiqueta: avulsa nao atrapalha quem decide', () => {
  const etqs = [
    { etiqueta: 'IMPORTANTES', vendedor: 'EDER', em: '2026-08-05T10:00:00Z' },
    { etiqueta: 'NOVO LEAD', vendedor: 'EDER', em: '2026-08-01T10:00:00Z' },
  ]
  assert.equal(statusDerivadoDaEtiqueta(etqs, 'EDER')?.status, 'ABERTO')
})

test('statusDerivadoDaEtiqueta: so avulsa (ou nenhuma) deixa pro vendedor marcar', () => {
  assert.equal(statusDerivadoDaEtiqueta([{ etiqueta: 'FEIRA', vendedor: 'EDER', em: 'x' }], 'EDER'), null)
  assert.equal(statusDerivadoDaEtiqueta([], 'EDER'), null)
  assert.equal(statusDerivadoDaEtiqueta(null, 'EDER'), null)
  assert.equal(statusDerivadoDaEtiqueta(undefined, null), null)
})

test('statusDaEtiqueta: acento da etiqueta digitada no CRM nao atrapalha', () => {
  assert.equal(statusDaEtiqueta('Não tem interesse'), 'FECHADO')
  assert.equal(statusDaEtiqueta('Orçamento enviado'), 'ABERTO')
  assert.equal(statusDaEtiqueta('PROSPECÇÃO'), 'ABERTO')
  assert.equal(statusDaEtiqueta('Só base de preço'), 'FECHADO')
})

test('statusDerivadoDaEtiqueta: empate total = encerramento vence (e nao a ordem do JSON)', () => {
  // A extensao carimba todas as etiquetas da conversa com o MESMO `em`.
  const em = '2026-08-31T10:20:14.007295+00:00'
  const a = [
    { etiqueta: 'ORCAMENTO ENVIADO', vendedor: 'ALVARO', em },
    { etiqueta: 'NAO RESPONDEU MAIS', vendedor: 'ALVARO', em },
  ]
  const b = [a[1], a[0]]
  assert.equal(statusDerivadoDaEtiqueta(a, 'ALVARO')?.status, 'FECHADO')
  assert.equal(statusDerivadoDaEtiqueta(b, 'ALVARO')?.status, 'FECHADO', 'ordem invertida da o mesmo')
  assert.equal(statusDerivadoDaEtiqueta(a, 'ALVARO')?.etiqueta, 'NAO RESPONDEU MAIS')
  assert.equal(statusDerivadoDaEtiqueta(a, null)?.status, 'FECHADO', 'sem dono tambem')
})

test('statusDerivadoDaEtiqueta: data mais recente continua vencendo o empate de status', () => {
  const etqs = [
    { etiqueta: 'NAO RESPONDEU MAIS', vendedor: 'ALVARO', em: '2026-08-01T10:00:00Z' },
    { etiqueta: 'ORCAMENTO ENVIADO', vendedor: 'ALVARO', em: '2026-08-05T10:00:00Z' },
  ]
  assert.equal(statusDerivadoDaEtiqueta(etqs, 'ALVARO')?.status, 'ABERTO')
})

test('comEtiquetasDoCrm: "Vendido" aplicado no CRM fecha o contato e diz que veio do CRM', () => {
  const wa = [{ etiqueta: 'ORCAMENTO ENVIADO', vendedor: 'IGOR', em: '2026-08-20T10:00:00Z' }]
  const crm = [{ nome: 'Vendido', aplicada_em: '2026-08-31T12:20:10Z' }]
  const r = statusDerivadoDaEtiqueta(comEtiquetasDoCrm(wa, crm, 'IGOR'), 'IGOR')
  assert.equal(r?.status, 'FECHADO')
  assert.equal(r?.origem, 'crm')
  assert.equal(r?.etiqueta, 'VENDIDO')
  assert.equal(statusDerivadoDaEtiqueta(wa, 'IGOR')?.origem, 'wa')
})

test('comEtiquetasDoCrm: etiqueta do dono no WhatsApp mais recente que a do CRM manda', () => {
  const wa = [{ etiqueta: 'NAO TEM INTERESSE', vendedor: 'IGOR', em: '2026-09-02T10:00:00Z' }]
  const crm = [{ nome: '3a tentativa', aplicada_em: '2026-08-31T12:20:10Z' }]
  const r = statusDerivadoDaEtiqueta(comEtiquetasDoCrm(wa, crm, 'IGOR'), 'IGOR')
  assert.equal(r?.status, 'FECHADO')
  assert.equal(r?.origem, 'wa')
})

test('comEtiquetasDoCrm: a do CRM vale como do DONO — vence a de outro vendedor no WhatsApp', () => {
  const wa = [{ etiqueta: 'VENDIDO', vendedor: 'PEDRO', em: '2026-09-02T10:00:00Z' }]
  const crm = [{ nome: '4a tentativa', aplicada_em: '2026-08-06T14:33:33Z' }]
  assert.equal(statusDerivadoDaEtiqueta(comEtiquetasDoCrm(wa, crm, 'EDER'), 'EDER')?.status, 'ABERTO')
  // sem dono, ela nao tem privilegio: vale a mais recente
  assert.equal(statusDerivadoDaEtiqueta(comEtiquetasDoCrm(wa, crm, null), null)?.status, 'FECHADO')
  assert.equal(statusDerivadoDaEtiqueta(comEtiquetasDoCrm([], [], 'EDER'), 'EDER'), null)
})

test('statusDerivadoDaEtiqueta: comparacao de vendedor ignora caixa e espaco', () => {
  const etqs = [
    { etiqueta: 'VENDIDO', vendedor: 'PEDRO', em: '2026-08-05T10:00:00Z' },
    { etiqueta: 'NOVO LEAD', vendedor: ' gustavo ', em: '2026-08-01T10:00:00Z' },
  ]
  assert.equal(statusDerivadoDaEtiqueta(etqs, 'GUSTAVO')?.status, 'ABERTO')
})
