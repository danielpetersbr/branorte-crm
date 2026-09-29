import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classificarFalhaPasta, avisoPastaViaServidor, saveFalhou, escreverArquivo } from './orcamento-folder-scan'

// O caso do 2026-2460 (08/09/2026, JARDEL) e do 2026-2858 (29/09/2026, ALVARO): o
// pedido de permissão do Chrome morria porque o clique já tinha passado (DOCX+PDF
// levam ~40s). Com a reserva da pasta colada no clique (passo 0), o erro de "user
// activation" só volta se o vendedor demorar numa confirmação — o próximo
// orçamento dá certo, então a pasta NÃO pode ser esquecida por isso.
test('pedido de permissão fora do clique (user activation) é transitório', () => {
  const falha = classificarFalhaPasta(
    new DOMException(
      "Failed to execute 'requestPermission' on 'FileSystemHandle': User activation is required to request permissions.",
      'SecurityError',
    ),
  )
  assert.equal(falha.permanente, false)
  assert.match(falha.motivo, /clique/i)
})

test('permissão negada pelo navegador (NotAllowedError) é permanente, com motivo em português', () => {
  const falha = classificarFalhaPasta(
    new DOMException('The request is not allowed by the user agent or the platform in the current context.', 'NotAllowedError'),
  )
  assert.equal(falha.permanente, true)
  assert.match(falha.motivo, /permiss/i)
})

// Handle falso da File System Access: getFileHandle ok, createWritable lança `erro`.
function pastaQueRecusa(erro: unknown) {
  return {
    getFileHandle: async () => ({
      createWritable: async () => { throw erro },
    }),
  }
}

async function falhaDoEscrever(erro: unknown): Promise<Error> {
  try {
    await escreverArquivo(pastaQueRecusa(erro), '2026 - 2858 - ALVARO.docx', 'x')
  } catch (e) {
    return e as Error
  }
  throw new Error('escreverArquivo deveria ter falhado')
}

test('arquivo travado (NoModificationAllowedError) no escreverArquivo NÃO esquece a pasta', async () => {
  const original = new DOMException('The file is locked.', 'NoModificationAllowedError')
  const e = await falhaDoEscrever(original)
  // o embrulho mantém o nome e o erro original — e não afirma "sem permissão"
  assert.equal(e.name, 'NoModificationAllowedError')
  assert.equal((e as Error & { cause?: unknown }).cause, original)
  assert.doesNotMatch(e.message, /permiss/i)
  assert.match(e.message, /2026 - 2858/)
  const falha = classificarFalhaPasta(e)
  assert.equal(falha.permanente, false)
  assert.doesNotMatch(falha.motivo, /permiss/i)
})

test('permissão revogada no escreverArquivo (NotAllowedError) continua permanente', async () => {
  const e = await falhaDoEscrever(new DOMException('Permission denied.', 'NotAllowedError'))
  assert.equal(e.name, 'NotAllowedError')
  assert.equal(classificarFalhaPasta(e).permanente, true)
})

test('texto com "permissão" sem o nome do DOMException não vira permanente', () => {
  // o que o embrulho antigo produzia pra QUALQUER falha do createWritable
  const falha = classificarFalhaPasta(new Error('Pasta sem permissão de escrita pra "x.docx": The file is locked.'))
  assert.equal(falha.permanente, false)
})

test('getStoredFolderHandle(true) devolvendo null (permissão negada) é permanente', () => {
  const falha = classificarFalhaPasta(new Error('Permissão de escrita negada'))
  assert.equal(falha.permanente, true)
})

test('pasta que sumiu do PC (Z: desconectado) é permanente', () => {
  const falha = classificarFalhaPasta(
    Object.assign(new Error('A requested file or directory could not be found'), { name: 'NotFoundError' }),
  )
  assert.equal(falha.permanente, true)
  // mesmo quando o erro chega sem o `name` (só o texto)
  const embrulhado = classificarFalhaPasta(
    new Error('Não consegui criar "x.docx" na pasta: A requested file or directory could not be found'),
  )
  assert.equal(embrulhado.permanente, true)
})

test('Z: lento (timeout) NÃO desliga a pasta — é transitório', () => {
  const falha = classificarFalhaPasta(
    new Error('Tempo esgotado (20s) em: localizar a pasta do mês no Z:\\. A pasta Z:\\ pode estar desconectada/lenta.'),
  )
  assert.equal(falha.permanente, false)
  assert.match(falha.motivo, /Z:/)
})

test('timeout com "permissão" no rótulo continua transitório', () => {
  const falha = classificarFalhaPasta(
    new Error('Tempo esgotado (20s) em: permissão de escrita na pasta. A pasta Z:\\ pode estar desconectada/lenta.'),
  )
  assert.equal(falha.permanente, false)
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

test('erro desconhecido não desliga a pasta e mostra o texto cru', () => {
  const falha = classificarFalhaPasta(new Error('disco cheio'))
  assert.equal(falha.permanente, false)
  assert.equal(falha.motivo, 'disco cheio')
  assert.equal(classificarFalhaPasta(null).permanente, false)
})

test('aviso diz que nada se perdeu e só ensina a reconfigurar quando é permanente', () => {
  const permanente = avisoPastaViaServidor({ motivo: 'teste', permanente: true })
  assert.match(permanente, /nada se perdeu/i)
  assert.match(permanente, /Trocar pasta/)
  assert.match(permanente, /3 - Orçamento/)
  assert.doesNotMatch(permanente, /virada de m[êe]s/i)

  const transitorio = avisoPastaViaServidor({ motivo: 'o Z:\\ não respondeu a tempo', permanente: false })
  assert.match(transitorio, /nada se perdeu/i)
  assert.doesNotMatch(transitorio, /Trocar pasta/)
})

test('card: salvo pelo servidor com aviso NÃO é "FALHA AO SALVAR"', () => {
  // o caso 2026-2858: pasta caiu, servidor salvou e entregou no Z:
  assert.equal(saveFalhou({ erro: null, pdfErro: null, salvouNaPasta: true, baixouDocx: false }), false)
})

test('card: falha de verdade continua vermelha', () => {
  // servidor também caiu → baixou local + erro
  assert.equal(saveFalhou({ erro: 'Upload pro servidor FALHOU', salvouNaPasta: false, baixouDocx: true }), true)
  // PDF não gerou
  assert.equal(saveFalhou({ erro: null, pdfErro: 'timeout', salvouNaPasta: true, baixouDocx: false }), true)
  // nada saiu por lugar nenhum
  assert.equal(saveFalhou({ erro: null, salvouNaPasta: false, baixouDocx: false }), true)
})
