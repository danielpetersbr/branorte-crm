import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const montarUrl = new URL('../pages/OrcamentoMontar.tsx', import.meta.url)
const chatUrl = new URL('../components/orcamento/OrcamentoAIChat.tsx', import.meta.url)

test('montador reserva no celular o espaço ocupado pela navegação inferior', async () => {
  const source = await readFile(montarUrl, 'utf8')

  assert.match(source, /h-\[calc\(100dvh-4rem-env\(safe-area-inset-bottom\)\)\]/)
  assert.doesNotMatch(source, /max-h-\[calc\(100vh-180px\)\]/)
})

test('orçamentista usa viewport dinâmica e respeita a área segura do celular', async () => {
  const source = await readFile(chatUrl, 'utf8')

  assert.match(source, /h-\[100dvh\]/)
  assert.match(source, /pb-\[max\(0\.5rem,env\(safe-area-inset-bottom\)\)\]/)
  assert.match(source, /rows=\{1\}/)
})
