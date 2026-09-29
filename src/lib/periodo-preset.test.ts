import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { recortarPeriodo, paramsRpcPeriodo, type ConsultaRecortavel } from './periodo-preset'

// rangeForPreset usa a hora LOCAL (a do navegador, que é São Paulo no CRM). Fixar o
// fuso aqui dá o mesmo resultado em qualquer máquina que rode o teste.
process.env.TZ = 'America/Sao_Paulo'

// Os testes de baixo montam o intervalo pelo `rangeForPreset` REAL — o elo
// preset → query é justamente o que o bug quebrava (29/09/2026). Só que ele mora em
// hooks/useDashboard, que importa o client do Supabase, e esse lê `import.meta.env`
// do Vite, que não existe no node. Então, só neste processo de teste, o módulo
// src/lib/supabase.ts é trocado por um vazio. Nenhuma consulta sai daqui.
const CLIENT_VAZIO = 'data:text/javascript,' + encodeURIComponent(
  'const q = {}; export const supabase = { schema() { return q } }; export const supabaseAuditoria = q',
)
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(especificador, contexto, proximo) {
    const r = await proximo(especificador, contexto)
    return new URL(r.url).pathname.endsWith('/src/lib/supabase.ts')
      ? { url: ${JSON.stringify(CLIENT_VAZIO)}, shortCircuit: true }
      : r
  }
`))
const { rangeForPreset }: typeof import('../hooks/useDashboard') =
  await import(new URL('../hooks/useDashboard.ts', import.meta.url).href)

// Builder falso: registra as chamadas E filtra linhas de verdade, pra o teste medir
// o efeito (o que entra na soma) e não só a forma da chamada.
interface Linha { id: string; created_at: string }
class Consulta implements ConsultaRecortavel<Consulta> {
  chamadas: string[] = []
  linhas: Linha[]
  constructor(linhas: Linha[]) { this.linhas = linhas }
  gte(coluna: string, valor: string): Consulta {
    this.chamadas.push(`gte ${coluna} ${valor}`)
    this.linhas = this.linhas.filter(l => (l as unknown as Record<string, string>)[coluna] >= valor)
    return this
  }
  lte(coluna: string, valor: string): Consulta {
    this.chamadas.push(`lte ${coluna} ${valor}`)
    this.linhas = this.linhas.filter(l => (l as unknown as Record<string, string>)[coluna] <= valor)
    return this
  }
}

// Datas em UTC fixo (São Paulo = UTC-3, sem horário de verão desde 2019): o teste
// não depende do fuso da máquina que roda.
// "Ontem" visto em 29/09/2026 às 17h de SP = 28/09 00:00 → 28/09 23:59:59.999 de SP.
const ONTEM = {
  from: new Date('2026-09-28T03:00:00.000Z'),
  to: new Date('2026-09-29T02:59:59.999Z'),
}
const LINHAS: Linha[] = [
  { id: 'anteontem 23h SP', created_at: '2026-09-28T02:00:00.000Z' },
  { id: 'ontem 09h SP', created_at: '2026-09-28T12:00:00.000Z' },
  { id: 'ontem 23h59 SP', created_at: '2026-09-29T02:59:59.000Z' },
  { id: 'hoje 00h01 SP', created_at: '2026-09-29T03:01:00.000Z' },
  { id: 'hoje 16h SP', created_at: '2026-09-29T19:00:00.000Z' },
]

test('Ontem: o que foi montado HOJE fica fora (o bug somava até agora)', () => {
  const q = recortarPeriodo(new Consulta(LINHAS), 'created_at', ONTEM)
  assert.deepEqual(q.linhas.map(l => l.id), ['ontem 09h SP', 'ontem 23h59 SP'])
})

test('aplica as DUAS pontas, com o ISO exato do intervalo', () => {
  const q = recortarPeriodo(new Consulta(LINHAS), 'created_at', ONTEM)
  assert.deepEqual(q.chamadas, [
    'gte created_at 2026-09-28T03:00:00.000Z',
    'lte created_at 2026-09-29T02:59:59.999Z',
  ])
})

test('personalizado 01/08–15/08 não vaza para depois do dia 15', () => {
  const agosto = {
    from: new Date('2026-08-01T03:00:00.000Z'),
    to: new Date('2026-08-16T02:59:59.999Z'),
  }
  const linhas: Linha[] = [
    { id: '15/08 20h SP', created_at: '2026-08-15T23:00:00.000Z' },
    { id: '16/08 10h SP', created_at: '2026-08-16T13:00:00.000Z' },
    { id: 'setembro', created_at: '2026-09-10T13:00:00.000Z' },
  ]
  const q = recortarPeriodo(new Consulta(linhas), 'created_at', agosto)
  assert.deepEqual(q.linhas.map(l => l.id), ['15/08 20h SP'])
})

test('sem intervalo ("Tudo") a consulta passa intacta', () => {
  const q = recortarPeriodo(new Consulta(LINHAS), 'created_at', null)
  assert.deepEqual(q.chamadas, [])
  assert.equal(q.linhas.length, LINHAS.length)
})

// ── Preset REAL → consulta / RPC ──────────────────────────────────────────────

// O que a RPC dashboard_propostas_status faz com os parâmetros (lido no banco em
// 29/09/2026): `(p_from is null or created_at >= p_from) and (p_to is null or created_at < p_to)`.
function comoARpcFiltra(linhas: Linha[], p: { p_from: string | null; p_to: string | null }): string[] {
  return linhas
    .filter(l => (p.p_from === null || l.created_at >= p.p_from) && (p.p_to === null || l.created_at < p.p_to))
    .map(l => l.id)
}

// 29/09/2026 às 17h de São Paulo — o cenário do achado.
const AGORA = new Date('2026-09-29T20:00:00.000Z')

test('preset "ontem" real: consulta e RPC param no fim de ontem, nada de hoje entra', () => {
  const r = rangeForPreset('ontem', AGORA)
  assert.ok(r)
  assert.equal(r.from.toISOString(), '2026-09-28T03:00:00.000Z')
  assert.equal(r.to.toISOString(), '2026-09-29T02:59:59.999Z')

  // useOrcamentosResumo
  const q = recortarPeriodo(new Consulta(LINHAS), 'created_at', r)
  assert.deepEqual(q.linhas.map(l => l.id), ['ontem 09h SP', 'ontem 23h59 SP'])

  // usePropostasStatus: o p_to NÃO pode mais ser null
  const p = paramsRpcPeriodo(r)
  assert.deepEqual(p, { p_from: '2026-09-28T03:00:00.000Z', p_to: '2026-09-29T03:00:00.000Z' })
  assert.deepEqual(comoARpcFiltra(LINHAS, p), ['ontem 09h SP', 'ontem 23h59 SP'])
})

test('preset personalizado real 01/08–15/08: RPC não vaza para o dia 16 nem para setembro', () => {
  const r = rangeForPreset('custom:2026-08-01:2026-08-15', AGORA)
  assert.ok(r)
  const p = paramsRpcPeriodo(r)
  assert.deepEqual(p, { p_from: '2026-08-01T03:00:00.000Z', p_to: '2026-08-16T03:00:00.000Z' })
  const linhas: Linha[] = [
    { id: '31/07 23h SP', created_at: '2026-08-01T02:00:00.000Z' },
    { id: '01/08 00h00 SP', created_at: '2026-08-01T03:00:00.000Z' },
    { id: '15/08 20h SP', created_at: '2026-08-15T23:00:00.000Z' },
    { id: '16/08 00h00 SP', created_at: '2026-08-16T03:00:00.000Z' },
    { id: 'setembro', created_at: '2026-09-10T13:00:00.000Z' },
  ]
  assert.deepEqual(comoARpcFiltra(linhas, p), ['01/08 00h00 SP', '15/08 20h SP'])
})

test('RPC: o último milissegundo do dia entra (é por isso o +1 ms contra o `<`)', () => {
  const p = paramsRpcPeriodo(rangeForPreset('ontem', AGORA))
  const linhas: Linha[] = [
    { id: 'ontem 23:59:59.999 SP', created_at: '2026-09-29T02:59:59.999Z' },
    { id: 'hoje 00:00:00.000 SP', created_at: '2026-09-29T03:00:00.000Z' },
  ]
  assert.deepEqual(comoARpcFiltra(linhas, p), ['ontem 23:59:59.999 SP'])
})

test('preset "Tudo" real: RPC recebe os dois nulos (sem limite)', () => {
  assert.equal(rangeForPreset('', AGORA), null)
  assert.deepEqual(paramsRpcPeriodo(rangeForPreset('', AGORA)), { p_from: null, p_to: null })
})

test('presets que terminam hoje continuam indo até o fim de hoje (sem mudar o que já era certo)', () => {
  for (const preset of ['hoje', '7d', '30d', 'mes'] as const) {
    const p = paramsRpcPeriodo(rangeForPreset(preset, AGORA))
    assert.equal(p.p_to, '2026-09-30T03:00:00.000Z', preset)
  }
  assert.equal(paramsRpcPeriodo(rangeForPreset('hoje', AGORA)).p_from, '2026-09-29T03:00:00.000Z')
  assert.equal(paramsRpcPeriodo(rangeForPreset('7d', AGORA)).p_from, '2026-09-23T03:00:00.000Z')
  assert.equal(paramsRpcPeriodo(rangeForPreset('mes', AGORA)).p_from, '2026-09-01T03:00:00.000Z')
})
