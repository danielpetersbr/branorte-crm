import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readBrowserPreference, writeBrowserPreference } from './browser-preferences'

function withWindow(value: unknown, run: () => void) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value })
  try { run() } finally {
    if (previous) Object.defineProperty(globalThis, 'window', previous)
    else Reflect.deleteProperty(globalThis, 'window')
  }
}

test('preferências continuam legíveis e persistidas quando storage está disponível', () => {
  const values = new Map<string, string>()
  withWindow({ localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) } }, () => {
    assert.equal(readBrowserPreference('theme-v3'), null)
    writeBrowserPreference('theme-v3', 'dark')
    assert.equal(readBrowserPreference('theme-v3'), 'dark')
  })
})

test('storage bloqueado não impede o app de ler defaults ou mudar aparência', () => {
  const browser = Object.defineProperty({}, 'localStorage', { get: () => { throw new Error('SecurityError') } })
  withWindow(browser, () => {
    assert.equal(readBrowserPreference('sidebar-collapsed'), null)
    assert.doesNotThrow(() => writeBrowserPreference('theme-v3', 'dark'))
  })
})

test('quota esgotada mantém leitura e a mudança visual sem derrubar o app', () => {
  withWindow({ localStorage: { getItem: () => 'light', setItem: () => { throw new Error('QuotaExceededError') } } }, () => {
    assert.equal(readBrowserPreference('theme-v3'), 'light')
    assert.doesNotThrow(() => writeBrowserPreference('theme-v3', 'dark'))
  })
})

test('preferências podem ser importadas sem browser', () => {
  withWindow(undefined, () => {
    assert.equal(readBrowserPreference('debug-rq'), null)
    assert.doesNotThrow(() => writeBrowserPreference('theme-v3', 'dark'))
  })
})
