import { test } from 'node:test'
import assert from 'node:assert/strict'
import { QueryClient } from '@tanstack/react-query'
import { createClient } from '@supabase/supabase-js'
import type { Reuniao } from '../hooks/useReunioes'
import {
  REUNIOES_KEY, REUNIOES_MUTATION_KEY, REUNIOES_MUTATION_SCOPE,
  aplicarAtualizacaoReuniao, reverterAtualizacaoReuniao, inserirReuniaoNoCache,
  invalidarReunioesAposEscritas, excluirReuniaoComAudios,
} from './reunioes-updates'

const reuniao = (id = 'r1', patch: Partial<Reuniao> = {}): Reuniao => ({
  id, titulo: 'Original', data_reuniao: '2026-09-28T10:30:00Z', status: 'planejada',
  pauta: [], tarefas: [], resumo: '', gravacoes: [], feedback_token: null,
  apresentacao_manifesto: null, created_by: null, created_at: '', updated_at: '', ...patch,
})

test('criação entra imediatamente no cache, ordenada e sem duplicar o registro', () => {
  const antiga = reuniao('antiga', { data_reuniao: '2026-09-20T10:30:00Z' })
  const criada = reuniao()
  const cache = inserirReuniaoNoCache([antiga], criada)
  assert.deepEqual(cache.map(r => r.id), ['r1', 'antiga'])
  assert.equal(cache.find(r => r.id === criada.id), criada)
  assert.equal(inserirReuniaoNoCache(cache, criada).length, 2)
  assert.deepEqual(inserirReuniaoNoCache(undefined, criada), [criada])
})

test('rollback de título preserva edição simultânea do resumo e de outra reunião', () => {
  const anterior = reuniao()
  const input = { id: anterior.id, titulo: 'Falhou' }
  let cache = aplicarAtualizacaoReuniao([anterior, reuniao('r2')], input)
  cache = aplicarAtualizacaoReuniao(cache, { id: 'r1', resumo: 'Salvo' })
  cache = aplicarAtualizacaoReuniao(cache, { id: 'r2', titulo: 'Outra edição' })
  const resultado = reverterAtualizacaoReuniao(cache, anterior, input)!
  assert.equal(resultado[0].titulo, 'Original')
  assert.equal(resultado[0].resumo, 'Salvo')
  assert.equal(resultado[1].titulo, 'Outra edição')
})

test('rollback antigo não apaga edição posterior no mesmo campo', () => {
  const anterior = reuniao()
  const input = { id: anterior.id, titulo: 'Primeira' }
  let cache = aplicarAtualizacaoReuniao([anterior], input)
  cache = aplicarAtualizacaoReuniao(cache, { id: 'r1', titulo: 'Segunda' })
  assert.equal(reverterAtualizacaoReuniao(cache, anterior, input)![0].titulo, 'Segunda')
})

test('rollback compara arrays por conteúdo e preserva gravação retornada pela RPC', () => {
  const anterior = reuniao()
  const input = { id: 'r1', pauta: [{ id: 'p1', texto: 'Teste', feito: true }] }
  const gravacoes = [{ id: 'g1', url: 'audio', path: 'r1/g1.webm', duracao_seg: 60, created_at: '' }]
  const cache = [{ ...anterior, pauta: structuredClone(input.pauta), gravacoes }]
  const resultado = reverterAtualizacaoReuniao(cache, anterior, input)!
  assert.deepEqual(resultado[0].pauta, [])
  assert.equal(resultado[0].gravacoes, gravacoes)
  const posterior = [{ ...cache[0], pauta: [...input.pauta, { id: 'p2', texto: 'Novo', feito: false }] }]
  assert.equal(reverterAtualizacaoReuniao(posterior, anterior, input)![0].pauta.length, 2)
})

test('rollback não recria registro excluído nem inventa cache antes da primeira leitura', () => {
  const anterior = reuniao()
  assert.deepEqual(reverterAtualizacaoReuniao([], anterior, { id: 'r1', titulo: 'X' }), [])
  assert.equal(reverterAtualizacaoReuniao(undefined, anterior, { id: 'r1', titulo: 'X' }), undefined)
  assert.equal(aplicarAtualizacaoReuniao(undefined, { id: 'r1', titulo: 'X' }), undefined)
})

test('servidor mantém a ordem das escritas e invalida somente depois da última', async () => {
  const qc = new QueryClient()
  qc.setQueryData(REUNIOES_KEY, [reuniao()])
  const chamadas: string[] = []
  let liberarPrimeira!: () => void
  let liberarSegunda!: () => void
  const primeiraEspera = new Promise<void>(resolve => { liberarPrimeira = resolve })
  const segundaEspera = new Promise<void>(resolve => { liberarSegunda = resolve })
  const executar = (nome: string, espera: Promise<void>) => qc.getMutationCache().build(qc, {
    mutationKey: REUNIOES_MUTATION_KEY,
    scope: REUNIOES_MUTATION_SCOPE,
    mutationFn: async () => { chamadas.push(nome); await espera },
    onSettled: () => invalidarReunioesAposEscritas(qc),
  }).execute(undefined)
  const primeira = executar('update', primeiraEspera)
  const segunda = executar('rpc-gravacao', segundaEspera)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(qc.isMutating({ mutationKey: REUNIOES_MUTATION_KEY }), 2)
  assert.deepEqual(chamadas, ['update'])
  liberarPrimeira()
  await primeira
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(chamadas, ['update', 'rpc-gravacao'])
  assert.equal(qc.getQueryState(REUNIOES_KEY)?.isInvalidated, false)
  liberarSegunda()
  await segunda
  assert.equal(qc.getQueryState(REUNIOES_KEY)?.isInvalidated, true)
  qc.clear()
})

test('falha de exclusão no banco preserva os arquivos', async () => {
  const chamadas: string[] = []
  await assert.rejects(excluirReuniaoComAudios(
    async () => { chamadas.push('banco'); throw new Error('sem permissão') },
    async () => { chamadas.push('storage') },
  ), /sem permissão/)
  assert.deepEqual(chamadas, ['banco'])
})

test('exclusão confirma banco antes do Storage e devolve aviso de limpeza incompleta', async () => {
  const chamadas: string[] = []
  const resultado = await excluirReuniaoComAudios(
    async () => { chamadas.push('banco') },
    async () => { chamadas.push('storage'); throw new Error('offline') },
  )
  assert.deepEqual(chamadas, ['banco', 'storage'])
  assert.match(resultado.cleanupError!, /Reunião excluída.*offline/)
  assert.deepEqual(await excluirReuniaoComAudios(async () => {}, async () => {}), {})
})

test('update/select/single solicita representação singular e propaga zero linhas', async () => {
  let metodo: string | undefined
  let aceitar: string | null = null
  let preferencia: string | null = null
  let destino = ''
  const db = createClient('https://test.supabase.co', 'public-test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, options) => {
      metodo = options?.method
      const headers = new Headers(options?.headers)
      aceitar = headers.get('Accept')
      preferencia = headers.get('Prefer')
      destino = String(url)
      return new Response(JSON.stringify({ code: 'PGRST116', message: 'Cannot coerce the result to a single JSON object', details: 'The result contains 0 rows' }), {
        status: 406, headers: { 'Content-Type': 'application/json' },
      })
    } },
  })
  const { error } = await db.from('reunioes').update({ titulo: 'Teste' }).eq('id', 'ausente').select('id').single()
  assert.equal(metodo, 'PATCH')
  assert.equal(aceitar, 'application/vnd.pgrst.object+json')
  assert.match(preferencia!, /return=representation/)
  assert.match(destino, /id=eq.ausente/)
  assert.equal(error?.code, 'PGRST116')
})
