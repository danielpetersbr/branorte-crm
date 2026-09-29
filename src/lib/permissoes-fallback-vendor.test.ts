import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/*
 * O guard de rota do vendedor (App.tsx) decide com o FALLBACK de usePermissions.ts
 * enquanto a query de role_permissions ainda não voltou. Chave que o guard pergunta
 * ao can(), que o banco dá `true` ao vendor e que falta no FALLBACK vira redirect
 * intermitente pra /atendimentos na carga fria (link salvo, F5).
 *
 * Já aconteceu 3 vezes, sempre igual: /contatos e /ligacoes (06/08) e /funil
 * (liberado no banco em 28/09, achado em 29/09/2026). Este teste amarra as duas
 * pontas: quem acrescentar `can('x')` no bloco do vendedor tem que pôr 'x' no
 * FALLBACK.vendor ou declarar aqui que o vendedor NÃO tem essa chave no banco.
 */

// Chaves que o guard do vendedor consulta mas que o papel `vendor` NÃO tem em
// role_permissions (conferido no banco em 29/09/2026). Pra elas o FALLBACK dizer
// `false` é a verdade, não corrida.
const NEGADAS_AO_VENDEDOR = new Set(['frete.aprovar'])

function blocoGuardVendedor(): string {
  const app = readFileSync(new URL('../App.tsx', import.meta.url), 'utf8')
  const inicio = app.indexOf("if (profile.role === 'vendor') {")
  assert.ok(inicio >= 0, "não achei o guard do vendedor em App.tsx (if (profile.role === 'vendor'))")
  const fim = app.indexOf('if (!allowed) return <Navigate', inicio)
  assert.ok(fim > inicio, 'não achei o fim do guard do vendedor em App.tsx')
  return app.slice(inicio, fim)
}

function chavesFallbackVendedor(): Set<string> {
  const fonte = readFileSync(new URL('../hooks/usePermissions.ts', import.meta.url), 'utf8')
  const fallback = fonte.indexOf('const FALLBACK')
  assert.ok(fallback >= 0, 'não achei const FALLBACK em usePermissions.ts')
  const inicio = fonte.indexOf('  vendor: {', fallback)
  assert.ok(inicio > fallback, 'não achei FALLBACK.vendor em usePermissions.ts')
  const resto = fonte.slice(inicio)
  const fim = resto.search(/\r?\n {2}\},/)
  assert.ok(fim > 0, 'não achei o fim de FALLBACK.vendor')
  const bloco = resto.slice(0, fim)
  return new Set([...bloco.matchAll(/'([\w.]+)':\s*true/g)].map(m => m[1]))
}

test('toda chave que o guard do vendedor pergunta ao can() está no FALLBACK.vendor', () => {
  const guard = blocoGuardVendedor()
  const chavesGuard = [...new Set([...guard.matchAll(/\bcan\('([\w.]+)'\)/g)].map(m => m[1]))]
  assert.ok(chavesGuard.length > 0, 'o guard do vendedor não chama can() — o parser deste teste quebrou')

  const fallback = chavesFallbackVendedor()
  const faltando = chavesGuard.filter(k => !fallback.has(k) && !NEGADAS_AO_VENDEDOR.has(k))
  assert.deepEqual(
    faltando,
    [],
    `chave(s) no guard do vendedor sem espelho no FALLBACK.vendor: ${faltando.join(', ')}. ` +
      'Se o banco dá true ao vendor, acrescente no FALLBACK; se não dá, ponha em NEGADAS_AO_VENDEDOR.',
  )
})

test('FALLBACK.vendor libera o Funil (menu.funil está true pro vendor no banco desde 28/09)', () => {
  assert.ok(chavesFallbackVendedor().has('menu.funil'))
})

test('nenhuma chave negada ao vendedor aparece como true no FALLBACK.vendor', () => {
  const fallback = chavesFallbackVendedor()
  for (const k of NEGADAS_AO_VENDEDOR) assert.ok(!fallback.has(k), `${k} não devia estar true no FALLBACK.vendor`)
})
