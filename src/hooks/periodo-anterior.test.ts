import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// Mesmo arranjo do periodo-preset.test.ts: fuso fixo e o client do Supabase trocado
// por um vazio (useDashboard importa o client, que lê import.meta.env do Vite).
process.env.TZ = 'America/Sao_Paulo'
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
const { rangeForPreset, previousRange }: typeof import('./useDashboard') =
  await import(new URL('./useDashboard.ts', import.meta.url).href)

const local = (d: Date) => d.toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })

test('"Este mês" compara com o mesmo pedaço do mês anterior, até a mesma hora (19/10/2026)', () => {
  const agora = new Date('2026-10-19T15:30:00-03:00')
  const prev = previousRange(rangeForPreset('mes', agora), 'mes', agora)
  assert.ok(prev)
  // Antes eram 12–30/09 inteiros: o "+20%" virava "−17%" contra 01–19/09.
  assert.equal(local(prev.from), '2026-09-01 00:00:00')
  assert.equal(local(prev.to), '2026-09-19 15:30:00')
})

test('mês anterior mais curto não invade o mês atual', () => {
  const agora = new Date('2026-03-31T10:00:00-03:00')
  const atual = rangeForPreset('mes', agora)
  const prev = previousRange(atual, 'mes', agora)
  assert.ok(atual && prev)
  assert.equal(local(prev.from), '2026-02-01 00:00:00')
  assert.ok(prev.to.getTime() < atual.from.getTime())
})

test('"Hoje" compara com ontem só até a mesma hora (dia parcial contra dia parcial)', () => {
  const agora = new Date('2026-10-19T09:00:00-03:00')
  const prev = previousRange(rangeForPreset('hoje', agora), 'hoje', agora)
  assert.ok(prev)
  assert.equal(local(prev.from), '2026-10-18 00:00:00')
  assert.equal(local(prev.to), '2026-10-18 09:00:00')
})

test('período que já fechou ("Ontem") continua comparando o dia inteiro anterior', () => {
  const agora = new Date('2026-10-19T09:00:00-03:00')
  const prev = previousRange(rangeForPreset('ontem', agora), 'ontem', agora)
  assert.ok(prev)
  assert.equal(local(prev.from), '2026-10-17 00:00:00')
  assert.equal(local(prev.to).slice(0, 16), '2026-10-17 23:59')
})
