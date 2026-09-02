import { test } from 'node:test'
import assert from 'node:assert/strict'
import { todasAsLinhas, type PaginaRpc } from './rpc-paginado'

/** Servidor de mentira: `total` linhas, corta cada resposta em `teto` (o max_rows). */
function servidor(total: number, teto: number, informaTotal = true) {
  const chamadas: [number, number][] = []
  const buscar = async (de: number, ate: number): Promise<PaginaRpc<number>> => {
    chamadas.push([de, ate])
    const pedidas = ate - de + 1
    const n = Math.max(0, Math.min(pedidas, teto, total - de))
    return { linhas: Array.from({ length: n }, (_, i) => de + i), total: informaTotal ? total : null }
  }
  return { buscar, chamadas }
}

test('junta as 17.249 conversas mesmo com o teto de 10.000 do PostgREST', async () => {
  const s = servidor(17_249, 10_000)
  const tudo = await todasAsLinhas(s.buscar, 5000)
  assert.equal(tudo.length, 17_249)
  assert.deepEqual(tudo.slice(0, 3), [0, 1, 2])
  assert.equal(tudo[17_248], 17_248)
  assert.equal(s.chamadas.length, 4)
  assert.deepEqual(s.chamadas[0], [0, 4999])
  assert.deepEqual(s.chamadas[3], [15_000, 19_999])
})

test('teto MENOR que a página (1.000): a página vem curta, mas o total diz que falta — continua', async () => {
  const s = servidor(2_500, 1_000)
  const tudo = await todasAsLinhas(s.buscar, 5000)
  assert.equal(tudo.length, 2_500)
  assert.equal(s.chamadas.length, 3)
  assert.deepEqual(s.chamadas[1], [1_000, 5_999])
})

test('sem total informado: página curta é o fim', async () => {
  const s = servidor(7_200, 100_000, false)
  const tudo = await todasAsLinhas(s.buscar, 5000)
  assert.equal(tudo.length, 7_200)
  assert.equal(s.chamadas.length, 2)
})

test('sem total e página exatamente cheia: faz mais uma chamada e para na vazia', async () => {
  const s = servidor(10_000, 100_000, false)
  const tudo = await todasAsLinhas(s.buscar, 5000)
  assert.equal(tudo.length, 10_000)
  assert.equal(s.chamadas.length, 3)
})

test('conjunto vazio: uma chamada, lista vazia', async () => {
  const s = servidor(0, 10_000)
  assert.deepEqual(await todasAsLinhas(s.buscar, 5000), [])
  assert.equal(s.chamadas.length, 1)
})

test('servidor que mente o total (diz mais do que tem) não vira laço infinito', async () => {
  let n = 0
  const buscar = async (): Promise<PaginaRpc<number>> => { n++; return { linhas: n === 1 ? [1, 2, 3] : [], total: 999 } }
  assert.deepEqual(await todasAsLinhas(buscar, 5000), [1, 2, 3])
  assert.equal(n, 2)
})

test('maxPaginas segura um servidor que devolve sempre página cheia', async () => {
  const buscar = async (de: number, ate: number): Promise<PaginaRpc<number>> =>
    ({ linhas: Array.from({ length: ate - de + 1 }, (_, i) => de + i), total: null })
  const tudo = await todasAsLinhas(buscar, 10, 3)
  assert.equal(tudo.length, 30)
})
