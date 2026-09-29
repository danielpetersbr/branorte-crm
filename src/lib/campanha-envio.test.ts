import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  CampanhaNaoAtivavelError,
  chaveEnvioCampanha,
  conferirAtivacao,
  criarEnvioCampanha,
} from './campanha-envio'

function adiado<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

const PEDIDO = {
  vendedorNome: 'EDER',
  titulo: 'Chamada 29/09/2026',
  sequenciaId: 'seq-1',
  ritmo: 'cauteloso',
  alvos: [{ telefone: '(65) 99999-0001' }, { telefone: '65999990002' }],
}

test('segundo clique durante criar+ativar não cria outra campanha', async () => {
  const envio = criarEnvioCampanha()
  const ativacao = adiado<void>()
  let criadas = 0
  const ativadas: string[] = []
  const criar = async () => ({ id: `c${++criadas}` })
  const ativar = (id: string) => { ativadas.push(id); return ativacao.promise }

  const primeiro = envio.enviar('k', criar, ativar)
  assert.equal(envio.emAndamento(), true)
  // Janela do bug: o criar já terminou e o ativar está no ar.
  await new Promise(r => setImmediate(r))
  assert.equal(criadas, 1)
  assert.equal(await envio.enviar('k', criar, ativar), false)

  ativacao.resolve()
  assert.equal(await primeiro, true)
  assert.equal(criadas, 1)
  assert.deepEqual(ativadas, ['c1'])
  assert.equal(envio.emAndamento(), false)
})

test('clique seguinte a um ativar que falhou reaproveita a campanha criada', async () => {
  const envio = criarEnvioCampanha()
  let criadas = 0
  const ativadas: string[] = []
  let falhar = true
  const criar = async () => ({ id: `c${++criadas}` })
  const ativar = async (id: string) => {
    ativadas.push(id)
    if (falhar) throw new Error('rede caiu')
  }

  await assert.rejects(envio.enviar('k', criar, ativar), /rede caiu/)
  assert.equal(envio.emAndamento(), false)
  falhar = false
  assert.equal(await envio.enviar('k', criar, ativar), true)
  assert.equal(criadas, 1)
  assert.deepEqual(ativadas, ['c1', 'c1'])

  // Depois de dar certo, um novo pedido cria campanha nova.
  assert.equal(await envio.enviar('k', criar, ativar), true)
  assert.equal(criadas, 2)
})

test('pedido diferente depois da falha cria outra campanha', async () => {
  const envio = criarEnvioCampanha()
  let criadas = 0
  let falhar = true
  const criar = async () => ({ id: `c${++criadas}` })
  const ativar = async () => { if (falhar) throw new Error('falhou') }

  await assert.rejects(envio.enviar('k1', criar, ativar))
  falhar = false
  assert.equal(await envio.enviar('k2', criar, ativar), true)
  assert.equal(criadas, 2)
})

test('campanha que não pode mais ser ligada não é reaproveitada', async () => {
  const envio = criarEnvioCampanha()
  let criadas = 0
  let cancelada = true
  const criar = async () => ({ id: `c${++criadas}` })
  const ativar = async () => {
    if (cancelada) throw new CampanhaNaoAtivavelError('A campanha está cancelada e não pode mais ser ligada.')
  }

  await assert.rejects(envio.enviar('k', criar, ativar), CampanhaNaoAtivavelError)
  cancelada = false
  assert.equal(await envio.enviar('k', criar, ativar), true)
  assert.equal(criadas, 2)
})

test('falha no criar solta a trava e não deixa campanha pendente', async () => {
  const envio = criarEnvioCampanha()
  let tentativas = 0
  const ativadas: string[] = []
  const criar = async () => {
    tentativas++
    if (tentativas === 1) throw new Error('insert falhou')
    return { id: 'c2' }
  }
  const ativar = async (id: string) => { ativadas.push(id) }

  await assert.rejects(envio.enviar('k', criar, ativar), /insert falhou/)
  assert.equal(envio.emAndamento(), false)
  assert.equal(await envio.enviar('k', criar, ativar), true)
  assert.deepEqual(ativadas, ['c2'])
})

test('conferirAtivacao: já ativa é sucesso (ativar é idempotente)', () => {
  assert.doesNotThrow(() => conferirAtivacao('ativa'))
})

test('conferirAtivacao: rascunho/pausada que não mudou é erro comum (pode tentar de novo)', () => {
  for (const s of ['rascunho', 'pausada']) {
    assert.throws(() => conferirAtivacao(s), (e: unknown) => e instanceof Error && !(e instanceof CampanhaNaoAtivavelError))
  }
})

test('conferirAtivacao: cancelada, concluída ou sumida não pode mais ser ligada', () => {
  for (const s of ['cancelada', 'concluida', null, undefined]) {
    assert.throws(() => conferirAtivacao(s), CampanhaNaoAtivavelError)
  }
})

test('chave do pedido ignora formato/ordem dos telefones e muda com o que importa', () => {
  const base = chaveEnvioCampanha(PEDIDO)
  assert.equal(
    chaveEnvioCampanha({ ...PEDIDO, alvos: [{ telefone: '65999990002' }, { telefone: '65 99999 0001' }] }),
    base,
  )
  assert.notEqual(chaveEnvioCampanha({ ...PEDIDO, ritmo: 'normal' }), base)
  assert.notEqual(chaveEnvioCampanha({ ...PEDIDO, sequenciaId: 'seq-2' }), base)
  assert.notEqual(chaveEnvioCampanha({ ...PEDIDO, titulo: 'Outra' }), base)
  assert.notEqual(chaveEnvioCampanha({ ...PEDIDO, alvos: PEDIDO.alvos.slice(0, 1) }), base)
})

test('modal usa a trava de envio e o botão espera o ativar, não só o criar', () => {
  const fonte = readFileSync(new URL('../components/NovaCampanhaModal.tsx', import.meta.url), 'utf8')
  assert.match(fonte, /criarEnvioCampanha\(\)/)
  assert.match(fonte, /\.enviar\(/)
  assert.match(fonte, /const podeEnviar = [^\n]*!enviando/)
  assert.match(fonte, /const podeEnviar = [^\n]*!mudarStatus\.isPending/)
})

test('ativar só liga campanha em rascunho/pausada e confere quando não pega linha', () => {
  const fonte = readFileSync(new URL('../hooks/useCampanhas.ts', import.meta.url), 'utf8')
  assert.match(fonte, /\.in\('status', \[\.\.\.STATUS_QUE_PODEM_ATIVAR\]\)/)
  assert.match(fonte, /conferirAtivacao\(/)
})
