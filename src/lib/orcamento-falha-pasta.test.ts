import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classificarFalhaPasta, avisoPastaViaServidor } from './orcamento-folder-scan.js'

// O caso do orçamento 2026-2460 (08/09/2026, JARDEL): o pedido de permissão do
// Chrome morre porque o clique já passou (DOCX+PDF levam ~40s). Não adianta
// repetir sem reconfigurar — e o vendedor não pode ver isso como "falha".
test('permissão vencida do Chrome é falha permanente, com motivo em português', () => {
  const falha = classificarFalhaPasta(
    Object.assign(new Error('User activation is required to request permissions'), { name: 'NotAllowedError' }),
  )
  assert.equal(falha.permanente, true)
  assert.match(falha.motivo, /permiss/i)
})

test('pasta que sumiu do PC (Z: desconectado) é permanente', () => {
  const falha = classificarFalhaPasta(
    Object.assign(new Error('A requested file or directory could not be found'), { name: 'NotFoundError' }),
  )
  assert.equal(falha.permanente, true)
})

test('Z: lento (timeout) NÃO desliga a pasta — é transitório', () => {
  const falha = classificarFalhaPasta(
    new Error('Tempo esgotado (20s) em: localizar a pasta do mês no Z:\\. A pasta Z:\\ pode estar desconectada/lenta.'),
  )
  assert.equal(falha.permanente, false)
  assert.match(falha.motivo, /Z:/)
})

test('handle preso num mês antigo continua sendo permanente', () => {
  const falha = classificarFalhaPasta(
    new Error('A pasta salva é "8 - Agosto" (mês de Agosto), mas hoje é Setembro. O navegador não consegue pular pra pasta do mês ao lado.'),
  )
  assert.equal(falha.permanente, true)
  assert.match(falha.motivo, /m[êe]s antigo/i)
})

test('vendedor fechando a janela de escolher pasta não é falha permanente', () => {
  const falha = classificarFalhaPasta(Object.assign(new Error('The user aborted a request.'), { name: 'AbortError' }))
  assert.equal(falha.permanente, false)
})

test('aviso diz que nada se perdeu e só ensina a reconfigurar quando é permanente', () => {
  const permanente = avisoPastaViaServidor({ motivo: 'teste', permanente: true })
  assert.match(permanente, /nada se perdeu/i)
  assert.match(permanente, /Trocar pasta/)
  assert.match(permanente, /3 - Orçamento/)

  const transitorio = avisoPastaViaServidor({ motivo: 'o Z:\\ não respondeu a tempo', permanente: false })
  assert.match(transitorio, /nada se perdeu/i)
  assert.doesNotMatch(transitorio, /Trocar pasta/)
})
