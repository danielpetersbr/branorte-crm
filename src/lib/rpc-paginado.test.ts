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

test('junta as 17.249 conversas mesmo com o teto de 10.000 do PostgREST, em ordem', async () => {
  const s = servidor(17_249, 10_000)
  const tudo = await todasAsLinhas(s.buscar, 5000)
  assert.equal(tudo.length, 17_249)
  assert.deepEqual(tudo.slice(0, 3), [0, 1, 2])
  assert.equal(tudo[17_248], 17_248)
  assert.ok(tudo.every((v, i) => v === i), 'linhas na ordem do servidor, sem buraco nem repetição')
  assert.equal(s.chamadas.length, 4)
  assert.deepEqual(s.chamadas[0], [0, 4999])
  assert.deepEqual(s.chamadas[3], [15_000, 17_248])
})

test('com o total conhecido, as páginas que faltam saem em PARALELO (não em fila)', async () => {
  // As 3 faixas restantes só resolvem quando as 3 foram PEDIDAS. Em fila, travaria.
  let pendentes: (() => void)[] = []
  const buscar = (de: number, ate: number): Promise<PaginaRpc<number>> => {
    const pagina = { linhas: Array.from({ length: ate - de + 1 }, (_, i) => de + i), total: 20_000 }
    if (de === 0) return Promise.resolve(pagina)
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('faixa pedida em fila, não em paralelo')), 500)
      pendentes.push(() => { clearTimeout(t); resolve(pagina) })
      if (pendentes.length === 3) { const p = pendentes; pendentes = []; p.forEach(f => f()) }
    })
  }
  const tudo = await todasAsLinhas(buscar, 5000)
  assert.equal(tudo.length, 20_000)
  assert.ok(tudo.every((v, i) => v === i))
})

test('teto MENOR que a página (1.000): a faixa vem curta, descarta e completa em sequência', async () => {
  const s = servidor(2_500, 1_000)
  const tudo = await todasAsLinhas(s.buscar, 5000)
  assert.equal(tudo.length, 2_500)
  assert.ok(tudo.every((v, i) => v === i), 'sem buraco no meio')
  // 1ª página (1000) + faixa paralela curta (descartada) + 2 em sequência
  assert.equal(s.chamadas.length, 4)
  assert.deepEqual(s.chamadas[1], [1_000, 2_499])
  assert.deepEqual(s.chamadas[2], [1_000, 5_999])
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

test('cabe numa página só: uma chamada', async () => {
  const s = servidor(5_355, 10_000)
  const tudo = await todasAsLinhas(s.buscar, 5000)
  assert.equal(tudo.length, 5_355)
  assert.equal(s.chamadas.length, 2)
  const s2 = servidor(4_000, 10_000)
  assert.equal((await todasAsLinhas(s2.buscar, 5000)).length, 4_000)
  assert.equal(s2.chamadas.length, 1)
})

test('servidor que mente o total (diz mais do que tem) não vira laço infinito', async () => {
  let n = 0
  const buscar = async (): Promise<PaginaRpc<number>> => { n++; return { linhas: n === 1 ? [1, 2, 3] : [], total: 999 } }
  assert.deepEqual(await todasAsLinhas(buscar, 5000), [1, 2, 3])
  assert.equal(n, 3)
})

test('maxPaginas segura um servidor que devolve sempre página cheia', async () => {
  const buscar = async (de: number, ate: number): Promise<PaginaRpc<number>> =>
    ({ linhas: Array.from({ length: ate - de + 1 }, (_, i) => de + i), total: null })
  const tudo = await todasAsLinhas(buscar, 10, 3)
  assert.equal(tudo.length, 30)
})
