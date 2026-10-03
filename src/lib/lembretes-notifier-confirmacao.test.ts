import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { createClient } from '@supabase/supabase-js'
import ts from 'typescript'
import { persistirAcaoLembrete } from './agenda-lembrete-acoes'

function callbackReal() {
  const path = new URL('../hooks/useLembretesDueNotifier.ts', import.meta.url)
  const source = ts.createSourceFile(path.pathname, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  let callback: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'executar') callback = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(callback, 'executa a ação real do notificador')
  return ts.transpileModule(`const executar = ${callback.getText(source)}; executar`, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText
}

function notifier() {
  let linhaExiste = false
  const requisicoes: Array<{ url: URL; headers: Headers; patch: Record<string, unknown> }> = []
  const supabase = createClient('https://agenda-teste.invalid', 'chave-ficticia', {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      fetch: async (input, init) => {
        assert.equal(init?.method, 'PATCH')
        const headers = new Headers(init?.headers)
        requisicoes.push({ url: new URL(String(input)), headers, patch: JSON.parse(String(init?.body)) })
        if (headers.get('Accept') === 'application/vnd.pgrst.object+json') {
          return new Response(JSON.stringify(linhaExiste ? { id: 42 } : { code: 'PGRST116', message: 'Nenhuma linha foi atualizada.' }), {
            status: linhaExiste ? 200 : 406, headers: { 'Content-Type': 'application/json' },
          })
        }
        return new Response(null, { status: 204 })
      },
    },
  })
  const item = { id: 42, data: null, hora: null }
  const estado = { cards: [item], erros: {} as Record<number, string>, invalidacoes: 0, pendentes: [] as number[] }
  const set = <T>(old: T, next: T | ((value: T) => T)): T => typeof next === 'function' ? (next as (value: T) => T)(old) : next
  const contexto = {
    useCallback: (fn: unknown) => fn, supabase, persistirAcaoLembrete,
    pendingRef: { current: new Set<number>() }, nomeRef: { current: 'Vendedor fictício' }, shownRef: { current: new Set([42]) },
    setCards: (next: typeof estado.cards | ((cards: typeof estado.cards) => typeof estado.cards)) => { estado.cards = set(estado.cards, next) },
    setActionErrors: (next: typeof estado.erros | ((errors: typeof estado.erros) => typeof estado.erros)) => { estado.erros = set(estado.erros, next) },
    setPendingIds: (value: number[]) => { estado.pendentes = [...value] },
    invalidar: () => { estado.invalidacoes++ }, HORA_MS: 3600000,
    parseLocalDateTime: () => new Date(), ymd: () => '2026-10-02', hm: () => '12:00',
  }
  const executar = runInNewContext(callbackReal(), contexto) as (item: unknown, acao: 'concluir' | 'adiar') => Promise<void>
  return { executar, item, estado, contexto, requisicoes, permitirAtualizacao: () => { linhaExiste = true } }
}

for (const acao of ['concluir', 'adiar'] as const) {
  test(`${acao}: UPDATE sem linha confirmada preserva card e permite tentar novamente`, async () => {
    const f = notifier()
    await f.executar(f.item, acao)
    assert.equal(f.estado.cards.length, 1)
    assert.match(f.estado.erros[42], /Tente novamente/)
    assert.equal(f.estado.invalidacoes, 0)
    assert.equal(f.contexto.shownRef.current.has(42), true)
    assert.deepEqual(f.estado.pendentes, [])
    const request = f.requisicoes[0]
    assert.equal(request.url.searchParams.get('id'), 'eq.42')
    assert.equal(request.url.searchParams.get('select'), 'id')
    assert.match(request.headers.get('Prefer') ?? '', /return=representation/)

    f.permitirAtualizacao()
    await f.executar(f.item, acao)
    assert.equal(f.estado.cards.length, 0)
    assert.equal(f.estado.erros[42], undefined)
    assert.equal(f.estado.invalidacoes, 1)
    assert.equal(f.contexto.shownRef.current.has(42), acao === 'concluir')
    assert.equal(request.patch[acao === 'concluir' ? 'concluido' : 'notificado_app'], acao === 'concluir')
  })
}
