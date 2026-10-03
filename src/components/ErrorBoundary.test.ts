import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ErrorBoundary } from './ErrorBoundary'

function withBrowser(storage: Pick<Storage, 'getItem' | 'setItem'>, run: (reloads: () => number) => void) {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const oldStorage = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage')
  const oldError = console.error
  let reloads = 0
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { reload: () => reloads++ } } })
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: storage })
  console.error = () => {}
  try { run(() => reloads) } finally {
    console.error = oldError
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow)
    else Reflect.deleteProperty(globalThis, 'window')
    if (oldStorage) Object.defineProperty(globalThis, 'sessionStorage', oldStorage)
    else Reflect.deleteProperty(globalThis, 'sessionStorage')
  }
}

const chunkFailure = new Error('Failed to fetch dynamically imported module')
const info = { componentStack: 'fixture' }

test('a recuperação de página continua visível quando o armazenamento está bloqueado', () => {
  withBrowser({ getItem: () => { throw new Error('SecurityError') }, setItem: () => {} }, reloads => {
    const boundary = new ErrorBoundary({ children: null })
    assert.doesNotThrow(() => boundary.componentDidCatch(chunkFailure, info))
    assert.equal(reloads(), 0, 'sem poder gravar o guard, mantém recuperação manual')
  })
})

test('a recuperação não falha nem recarrega em loop quando a quota está esgotada', () => {
  withBrowser({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }, reloads => {
    const boundary = new ErrorBoundary({ children: null })
    assert.doesNotThrow(() => boundary.componentDidCatch(chunkFailure, info))
    assert.equal(reloads(), 0)
  })
})

test('a falha de módulo tenta recarregar uma vez e respeita o guard da sessão', () => {
  let last: string | null = null
  withBrowser({ getItem: () => last, setItem: (_key, value) => { last = value } }, reloads => {
    const boundary = new ErrorBoundary({ children: null })
    boundary.componentDidCatch(chunkFailure, info)
    boundary.componentDidCatch(chunkFailure, info)
    assert.equal(reloads(), 1)
  })
})

test('uma falha de renderização comum mantém a recuperação manual sem acessar storage', () => {
  withBrowser({ getItem: () => { throw new Error('não deve ler storage') }, setItem: () => {} }, reloads => {
    const boundary = new ErrorBoundary({ children: null })
    assert.doesNotThrow(() => boundary.componentDidCatch(new Error('render failure'), info))
    assert.equal(reloads(), 0)
  })
})
