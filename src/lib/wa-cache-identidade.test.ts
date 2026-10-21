import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { QueryClient } from '@tanstack/react-query'

test('contrato dos hooks inclui identidade e impede placeholder entre conversas', () => {
  const fonte = readFileSync(new URL('../hooks/useWaKanban.ts', import.meta.url), 'utf8')
  // O quadro usa chaveWaKanban() (o espelho do /whatsapp remenda o mesmo cache); ela tem que levar userId também.
  const keys = fonte.match(/queryKey: (?:\[|chaveWaKanban\()[^\n]+/g) ?? []
  assert.equal(keys.length, 5)
  for (const key of keys) assert.match(key, /userId/)
  assert.match(fonte, /chaveWaKanban = \(vendedor: string \| null, userId: string \| undefined[^\n]*\n\s+\['wa-kanban', vendedor, userId,/)
  assert.match(fonte, /query\?\.queryKey\[1\] === vendedor/)
  assert.match(fonte, /query\?\.queryKey\[2\] === chatId/)
  assert.match(fonte, /query\?\.queryKey\[4\] === userId/)
})

test('cache particionado não devolve mensagem de outra conta e clear remove dados', () => {
  const cache = new QueryClient()
  cache.setQueryData(['wa-mensagens', 'Ramon', 'chat', 30, 'conta-a'], ['privado'])
  assert.equal(cache.getQueryData(['wa-mensagens', 'Ramon', 'chat', 30, 'conta-b']), undefined)
  cache.clear()
  assert.equal(cache.getQueryCache().getAll().length, 0)
})

test('provider limpa cache na mudança de identidade e não expõe perfil de outra conta', () => {
  const fonte = readFileSync(new URL('../hooks/useAuth.tsx', import.meta.url), 'utf8')
  assert.match(fonte, /identity\.current !== nextId/)
  assert.match(fonte, /queryClient\.clear\(\)/)
  assert.match(fonte, /profile: profile\?\.id === userId \? profile : null/)
})
