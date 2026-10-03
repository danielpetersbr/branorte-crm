import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { QueryNotice } from '../components/ui/QueryNotice'
import { cn } from './utils'

function realFunction(file: string, name: string, context: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let fn: ts.FunctionDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) fn = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(fn)
  const js = ts.transpileModule(fn.getText(ast).replace(/^export /, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
  }).outputText
  return vm.runInNewContext(`${js}\n${name}`, {
    React: { createElement }, QueryNotice, cn,
    useState: (initial: unknown) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useMemo: (fn: () => unknown) => fn(), useRef: (initial: unknown) => ({ current: initial }), useEffect() {},
    ...context,
  })
}

function pathsTo(node: unknown, target: unknown, path: unknown[] = []): unknown[][] {
  if (Array.isArray(node)) return node.flatMap((child, index) => pathsTo(child, target, [...path, index]))
  if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) return []
  const element = node as { type: unknown; key: unknown; props: { children?: unknown } }
  const next = [...path, element.type, element.key]
  return element.type === target ? [next] : pathsTo(element.props.children, target, next)
}

for (const page of ['MinhasVisitas', 'OrganizacaoViagem']) {
  const file = page === 'MinhasVisitas' ? '../pages/MinhasVisitas.tsx' : '../components/mapa/OrganizacaoViagem.tsx'
  function fixture(data: unknown) {
    const editor = () => createElement('input', { defaultValue: 'rascunho sem salvar' })
    const query = { data, isLoading: false, isFetching: false, isError: false, error: null as Error | null, refetch() {} }
    const context: Record<string, unknown> = {
      useMinhasVisitas: () => query, useQuadroViagens: () => query,
      useMinhasAtividades: () => ({ data: [] }), useConcluirAtividade: () => ({}), useToast: () => [[], () => {}],
      VisitaCard: editor, CardViagem: editor, ToastStack: () => null,
      dataBonita: () => '', pendencias: () => [],
      Moldura: (props: { children: never }) => createElement('div', {}, props.children),
    }
    for (const icon of ['ClipboardList', 'CalendarDays', 'AlertCircle', 'MapPin']) context[icon] = () => createElement('span')
    const render = realFunction(file, page, context)
    return { editor, query, render: () => render({ onAbrirViagem() {}, semMoldura: true }) }
  }

  test(`${page}: refetch com falha e retry preservam posição e identidade dos editores em cache`, () => {
    const data = page === 'MinhasVisitas'
      ? [{ parada_id: 'parada-A', data_prevista: '2026-10-02' }]
      : [{ id: 'viagem-A', paradas: 1, paradasDetalhe: [{ vendedor: 'Vendedor fictício' }] }]
    const f = fixture(data)
    const before = pathsTo(f.render(), f.editor)
    assert.equal(before.length, 1)
    f.query.error = new Error('offline'); f.query.isError = true
    const failed = f.render()
    assert.deepEqual(pathsTo(failed, f.editor), before)
    assert.match(renderToStaticMarkup(failed), /role="alert"/)
    assert.match(renderToStaticMarkup(failed), /Tentar novamente/)
    f.query.error = null; f.query.isError = false
    assert.deepEqual(pathsTo(f.render(), f.editor), before)
  })

  test(`${page}: primeira leitura com erro oferece retry sem anunciar lista vazia confirmada`, () => {
    const f = fixture(undefined)
    f.query.error = new Error('offline'); f.query.isError = true
    const failed = f.render()
    assert.equal(pathsTo(failed, f.editor).length, 0)
    const html = renderToStaticMarkup(failed)
    assert.match(html, /Tentar novamente|tentar de novo|Tente de novo/)
    assert.doesNotMatch(html, /Nenhuma visita|Nenhuma viagem/)
  })
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

function localAction() {
  const network = deferred<{ json: () => Promise<unknown> }>(), save = deferred<void>()
  const writes: Array<{ paradaId: string; lat: number }> = []
  let fetches = 0, closes = 0
  const context = {
    texto: 'https://maps.app.goo.gl/local-A', setErro() {}, setResolvendo() {}, setAplicando() {},
    localEmCurso: { current: false }, montado: { current: true }, paradaAtual: { current: 'parada-A' },
    p: { id: 'parada-A', cliKeys: ['cliente-A'], lat: 0, lng: 0, nome: 'Cliente fictício' },
    lerLocal: () => null, ehLinkCurto: () => true, urlCurta: (text: string) => text, distanciaKm: () => 0,
    fetch: () => { fetches++; return network.promise },
    corrigir: {
      mutate: (input: { paradaId: string; lat: number }, callbacks: { onSuccess: () => void }) => { writes.push(input); callbacks.onSuccess() },
      mutateAsync: async (input: { paradaId: string; lat: number }) => { writes.push(input); await save.promise },
    },
    setColando: () => { closes++ }, setTexto() {},
  }
  const action = realFunction('../components/mapa/OrganizacaoViagem.tsx', 'aplicarLocal', context) as () => Promise<void>
  const resolveNetwork = () => network.resolve({ json: async () => ({ ok: true, lat: -7, lng: -44 }) })
  return { action, context, writes, save, resolveNetwork, fetchCount: () => fetches, closeCount: () => closes }
}

test('Enter repetido não resolve nem grava outra localização durante resolução ou persistência', async () => {
  const f = localAction()
  const first = f.action()
  f.context.texto = 'https://maps.app.goo.gl/local-B'
  const second = f.action()
  const duringResolution = f.fetchCount()
  f.resolveNetwork()
  await new Promise<void>(resolve => setImmediate(resolve))
  assert.equal(f.writes.length, 1, 'a persistência ainda está pendente quando chega outro Enter')
  const third = f.action()
  const duringSave = f.fetchCount()
  f.save.resolve()
  await Promise.all([first, second, third])
  assert.equal(duringResolution, 1)
  assert.equal(duringSave, 1)
  assert.equal(f.writes.length, 1)
  assert.equal(f.closeCount(), 1)
  assert.equal(f.context.localEmCurso.current, false)
})

test('resolução que termina após desmontar ou trocar a parada não grava nem limpa outro rascunho', async () => {
  for (const limite of ['desmontar', 'trocar']) {
    const f = localAction()
    const pending = f.action()
    if (limite === 'desmontar') f.context.montado.current = false
    else f.context.paradaAtual.current = 'parada-B'
    f.resolveNetwork(); f.save.resolve()
    await pending
    assert.equal(f.writes.length, 0)
    assert.equal(f.closeCount(), 0)
  }
})

test('campo de localização fica bloqueado durante uma aplicação em curso', () => {
  const render = realFunction('../components/mapa/OrganizacaoViagem.tsx', 'LinhaParada', {
    useState: (initial: unknown) => [typeof initial === 'boolean' ? true : initial, () => {}],
    useConfirmarParada: () => ({}), useCorrigirLocalDaParada: () => ({ isPending: true }),
    pendencias: () => [], ESTADO: { nao_solicitado: { texto: '', cor: '', bg: '' } },
  })
  const tree = render({ p: { id: 'parada-A', nome: 'Cliente fictício', precisao: 'cidade', confirmacao: 'nao_solicitado', cliKeys: [] }, viagem: { dias: 1 } })
  const fields: Array<{ props: { disabled?: boolean } }> = []
  function visit(node: unknown) {
    if (Array.isArray(node)) { node.forEach(visit); return }
    if (!node || typeof node !== 'object' || !('type' in node) || !('props' in node)) return
    const element = node as { type: unknown; props: { disabled?: boolean; children?: unknown } }
    if (element.type === 'input') fields.push(element)
    visit(element.props.children)
  }
  visit(tree)
  assert.equal(fields.length, 1)
  assert.equal(fields[0].props.disabled, true)
})
