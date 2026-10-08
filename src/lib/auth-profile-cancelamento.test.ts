import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { createClient } from '@supabase/supabase-js'

// Executa o corpo do efeito real, sem importar configuração/credenciais Supabase.
const source = ts.createSourceFile('useAuth.tsx', readFileSync(new URL('../hooks/useAuth.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let effectSource = ''
let sessionEffectSource = ''
let signOutSource = ''
function findEffect(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('const fetchProfile')) {
    effectSource = node.arguments[0].getText(source)
  }
  if (ts.isCallExpression(node) && node.expression.getText(source) === 'useEffect' && node.arguments[0]?.getText(source).includes('supabase.auth.getSession()')) {
    sessionEffectSource = node.arguments[0].getText(source)
  }
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'signOut') signOutSource = node.initializer!.getText(source)
  ts.forEachChild(node, findEffect)
}
findEffect(source)
assert.ok(effectSource, 'efeito de carregamento do perfil encontrado')
const effectJs = ts.transpileModule(`(${effectSource})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const sessionEffectJs = ts.transpileModule(`(${sessionEffectSource})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
const signOutJs = ts.transpileModule(`(${signOutSource})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText

type Profile = { id: string; display_name: string; role: string; approved_at: string | null }
type Response = { data: Profile | null; error: unknown }
async function flush() { for (let i = 0; i < 20; i++) await Promise.resolve() }

function harness(client?: unknown) {
  let now = 0
  let nextTimer = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const delays: number[] = []
  const requests: Array<{ uid: string; signal?: AbortSignal; resolve: (value: Response) => void; reject: (error: unknown) => void; active: boolean }> = []
  let maxActive = 0
  const state = { profile: null as Profile | null, loading: true, profileError: false }
  const errors: unknown[] = []
  const profileWrites: Array<Profile | null> = []
  const profileRequest = { current: null as { userId: string; controller: AbortController } | null }
  const window = {
    setTimeout(fn: () => void, delay: number) {
      delays.push(delay)
      const id = ++nextTimer
      timers.set(id, { at: now + delay, fn })
      return id
    },
    clearTimeout(id: number) { timers.delete(id) },
  }
  const supabase = {
    from(table: string) {
      assert.equal(table, 'user_profiles')
      let uid = ''
      let signal: AbortSignal | undefined
      const builder = {
        select(columns: string) { assert.equal(columns, 'id,email,display_name,role,vendor_id,approved_at'); return builder },
        eq(column: string, value: string) { assert.equal(column, 'id'); uid = value; return builder },
        maybeSingle() { return builder },
        abortSignal(value: AbortSignal) { signal = value; return builder },
        then(resolve: (response: Response) => void, reject: (error: unknown) => void) {
          const request = { uid, signal, resolve: (value: Response) => { request.active = false; resolve(value) }, reject: (error: unknown) => { request.active = false; reject(error) }, active: !signal?.aborted }
          requests.push(request)
          maxActive = Math.max(maxActive, requests.filter(r => r.active).length)
          // O SDK pode demorar antes de fetch, ou entregar uma resposta tardia:
          // não rejeitamos o thenable ao abortar, para testar também esse caminho.
          signal?.addEventListener('abort', () => { request.active = false }, { once: true })
        },
      }
      return builder
    },
  }
  function mount(userId: string | null) {
    const effect = vm.runInNewContext(effectJs, {
      userId, window, AbortController, Promise, Error, profileRequest, supabase: client ?? supabase,
      console: { error: (...args: unknown[]) => errors.push(args) },
      setProfile(value: Profile | null | ((previous: Profile | null) => Profile | null)) {
        state.profile = typeof value === 'function' ? value(state.profile) : value
        profileWrites.push(state.profile)
      },
      setLoading(value: boolean) { state.loading = value },
      setProfileError(value: boolean) { state.profileError = value },
    })
    return effect() as (() => void) | undefined
  }
  async function advance(ms: number) {
    const end = now + ms
    while (true) {
      const next = [...timers.entries()].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
      if (!next) break
      now = next[1].at
      timers.delete(next[0])
      next[1].fn()
      await flush()
    }
    now = end
    await flush()
  }
  return { mount, advance, requests, state, errors, profileWrites, profileRequest, delays, timers, get maxActive() { return maxActive } }
}
const profile = (id: string, name = id): Profile => ({ id, display_name: name, role: 'vendor', approved_at: '2026-10-08' })

test('três consultas travadas abortam antes do retry, com no máximo uma em voo e prazo/backoffs originais', async () => {
  const h = harness()
  h.mount('a')
  await flush()
  await h.advance(20_400)
  assert.equal(h.requests.length, 3)
  assert.equal(h.maxActive, 1)
  assert.ok(h.requests.every(r => r.signal?.aborted))
  assert.deepEqual(h.delays, [6000, 800, 6000, 1600, 6000])
  assert.equal(h.state.profileError, true)
  assert.equal(h.state.loading, false)
  assert.equal(h.errors.length, 3)
  assert.equal(h.timers.size, 0)
})

test('sucesso mantém atributos de aprovação e cancela seu timer', async () => {
  const h = harness()
  h.mount('a')
  await flush()
  const p = profile('a', 'Nome confirmado')
  h.requests[0].resolve({ data: p, error: null })
  await flush()
  assert.deepEqual(h.state, { profile: p, loading: false, profileError: false })
  assert.ok(h.requests[0].signal)
  assert.equal(h.requests[0].signal.aborted, false)
  assert.equal(h.timers.size, 0)
  await h.advance(30_000)
  assert.equal(h.requests.length, 1)
})

test('perfil ausente é resposta definitiva, sem virar erro de conexão nem retry', async () => {
  const h = harness()
  h.mount('a')
  await flush()
  h.requests[0].resolve({ data: null, error: null })
  await flush()
  assert.deepEqual(h.state, { profile: null, loading: false, profileError: false })
  assert.equal(h.timers.size, 0)
  assert.equal(h.requests.length, 1)
})

test('erro HTTP limpa deadline, repete só três vezes e mantém gate de erro', async () => {
  const h = harness()
  h.mount('a')
  await flush()
  for (let attempt = 0; attempt < 3; attempt++) {
    h.requests[attempt].resolve({ data: null, error: { status: 503, message: 'upstream unavailable' } })
    await flush()
    assert.equal(h.timers.size, attempt < 2 ? 1 : 0)
    if (attempt < 2) await h.advance(800 * (attempt + 1))
  }
  assert.equal(h.requests.length, 3)
  assert.equal(h.maxActive, 1)
  assert.deepEqual(h.state, { profile: null, loading: false, profileError: true })
})

test('desmontar aborta consulta mesmo travada antes do transporte e ignora resposta tardia', async () => {
  const h = harness()
  const cleanup = h.mount('a')!
  await flush()
  cleanup()
  assert.equal(h.requests[0].signal?.aborted, true)
  assert.equal(h.timers.size, 0)
  const writes = h.profileWrites.length
  h.requests[0].resolve({ data: profile('a', 'Tardio'), error: null })
  await flush()
  await h.advance(30_000)
  assert.equal(h.profileWrites.length, writes)
  assert.equal(h.requests.length, 1)
  assert.equal(h.errors.length, 0)
})

test('logout durante backoff cancela pausa e não inicia mais consultas', async () => {
  const h = harness()
  const cleanup = h.mount('a')!
  await flush()
  h.requests[0].reject(new Error('offline'))
  await flush()
  cleanup()
  h.mount(null)
  assert.equal(h.timers.size, 0)
  await h.advance(30_000)
  assert.equal(h.requests.length, 1)
  assert.equal(h.state.profile, null)
  assert.equal(h.state.profileError, false)
})

test('troca de UID aborta consulta anterior; nome e aprovação novos sobrevivem resposta antiga', async () => {
  const h = harness()
  const cleanup = h.mount('a')!
  await flush()
  cleanup()
  h.mount('b')
  await flush()
  assert.equal(h.requests[0].signal?.aborted, true)
  assert.equal(h.requests[1].uid, 'b')
  assert.equal(h.maxActive, 1)
  h.requests[1].resolve({ data: profile('b', 'Novo usuário'), error: null })
  await flush()
  h.requests[0].resolve({ data: profile('a', 'Usuário antigo'), error: null })
  await flush()
  assert.deepEqual(h.state.profile, profile('b', 'Novo usuário'))
  assert.equal(h.state.profileError, false)
  assert.equal(h.timers.size, 0)
})

test('resposta tardia de tentativa vencida não substitui resultado do retry', async () => {
  const h = harness()
  h.mount('a')
  await flush()
  await h.advance(6800)
  assert.equal(h.requests[0].signal?.aborted, true)
  h.requests[1].resolve({ data: profile('a', 'Atual'), error: null })
  await flush()
  h.requests[0].resolve({ data: profile('a', 'Obsoleto'), error: null })
  await flush()
  assert.deepEqual(h.state.profile, profile('a', 'Atual'))
  assert.equal(h.timers.size, 0)
})

test('SDK Supabase real passa o abort ao fetch e não sobrepõe transportes travados', async () => {
  const signals: AbortSignal[] = []
  let active = 0
  let maxActive = 0
  const client = createClient('https://synthetic.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    accessToken: async () => 'synthetic-token',
    global: { fetch: async (_url, init) => {
      const signal = init?.signal as AbortSignal
      signals.push(signal)
      assert.ok(signal)
      if (signal.aborted) throw new Error('aborted before fetch')
      active++
      maxActive = Math.max(maxActive, active)
      return new Promise<never>((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          active--
          reject(new Error('aborted fetch'))
        }, { once: true })
      })
    } },
  })
  const h = harness(client)
  h.mount('a')
  await flush()
  await h.advance(20_400)
  assert.equal(signals.length, 3)
  assert.equal(maxActive, 1)
  assert.equal(active, 0)
  assert.ok(signals.every(signal => signal.aborted))
  assert.deepEqual(h.delays, [6000, 800, 6000, 1600, 6000])
  assert.equal(h.state.profileError, true)
  assert.equal(h.timers.size, 0)
})

test('deadline cobre espera interna de sessão do SDK; liberação tardia não inicia fetch ativo', async () => {
  const tokenWaiters: Array<(token: string) => void> = []
  let tokenReads = 0
  const signals: AbortSignal[] = []
  let activeFetches = 0
  const client = createClient('https://synthetic.invalid', 'synthetic-public-key', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // A construção do cliente também inicializa o token do Realtime; só as
    // leituras seguintes, feitas pelas consultas REST, ficam travadas.
    accessToken: () => ++tokenReads === 1
      ? Promise.resolve('synthetic-token')
      : new Promise<string>(resolve => tokenWaiters.push(resolve)),
    global: { fetch: async (_url, init) => {
      const signal = init?.signal as AbortSignal
      signals.push(signal)
      if (signal.aborted) throw new Error('aborted before fetch')
      activeFetches++
      throw new Error('fetch inesperado')
    } },
  })
  const h = harness(client)
  h.mount('a')
  await flush()
  await h.advance(20_400)
  assert.equal(tokenWaiters.length, 3)
  assert.equal(signals.length, 0)
  assert.equal(h.state.profileError, true)
  assert.equal(h.timers.size, 0)
  tokenWaiters.forEach(resolve => resolve('synthetic-token'))
  await flush()
  assert.equal(signals.length, 3)
  assert.ok(signals.every(signal => signal.aborted))
  assert.equal(activeFetches, 0)
  assert.equal(h.state.profile, null)
  assert.equal(h.state.profileError, true)
})

test('logout cancela imediatamente mesmo se a confirmação de signOut ainda está travada', async () => {
  const h = harness()
  h.mount('a')
  await flush()
  let confirmLogout!: () => void
  let clears = 0
  const signOut = vm.runInNewContext(signOutJs, {
    profileRequest: h.profileRequest,
    supabase: { auth: { signOut: () => new Promise<void>(resolve => { confirmLogout = resolve }) } },
    queryClient: { clear: () => { clears++ } }, identity: { current: 'a' },
    setSession: () => {}, setProfile: () => {},
  })
  const pending = signOut()
  assert.equal(h.requests[0].signal?.aborted, true)
  assert.equal(h.timers.size, 0)
  await h.advance(30_000)
  assert.equal(h.requests.length, 1)
  assert.equal(h.errors.length, 0)
  confirmLogout()
  await pending
  assert.equal(clears, 1)
})

test('callback Auth preserva perfil iniciado antes de INITIAL_SESSION e refresh; aborta mudança real de UID', async () => {
  const h = harness()
  h.mount('a')
  await flush()
  let callback!: (event: string, session: { user: { id: string } } | null) => void
  let clears = 0
  const sessionEffect = vm.runInNewContext(sessionEffectJs, {
    profileRequest: h.profileRequest, identity: { current: null },
    supabase: { auth: {
      getSession: () => new Promise(() => {}),
      onAuthStateChange: (fn: typeof callback) => { callback = fn; return { data: { subscription: { unsubscribe() {} } } } },
    } },
    queryClient: { clear: () => { clears++ } },
    setSession: () => {}, setProfile: () => {}, setProfileError: () => {}, setLoading: () => {},
  })
  const cleanup = sessionEffect()
  callback('INITIAL_SESSION', { user: { id: 'a' } })
  assert.equal(h.requests[0].signal?.aborted, false)
  assert.equal(clears, 1)
  callback('TOKEN_REFRESHED', { user: { id: 'a' } })
  assert.equal(h.requests[0].signal?.aborted, false)
  assert.equal(clears, 1)
  callback('SIGNED_IN', { user: { id: 'b' } })
  assert.equal(h.requests[0].signal?.aborted, true)
  assert.equal(h.timers.size, 0)
  assert.equal(clears, 2)
  await h.advance(30_000)
  assert.equal(h.requests.length, 1)
  cleanup()
})
