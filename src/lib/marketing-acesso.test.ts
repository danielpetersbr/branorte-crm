import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { rotaMarketingPermitida } from './marketing-acesso'

// Itens do menu do marketing, lidos do próprio Layout.tsx (sem importar React).
function rotasDoMenuMarketing(): string[] {
  const src = readFileSync(new URL('../components/layout/Layout.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')
  const ini = src.indexOf('const MARKETING_GROUPS: NavGroup[] = [')
  assert.ok(ini > 0, 'MARKETING_GROUPS não encontrado no Layout.tsx')
  const bloco = src.slice(ini, src.indexOf('\n]\n', ini))
  return [...bloco.matchAll(/to: '([^']+)'/g)].map(m => m[1])
}

test('todo item do menu do marketing abre (menu e guard concordam)', () => {
  const rotas = rotasDoMenuMarketing()
  assert.equal(rotas.length, 15)   // 5 + 1 + 2 + 1 + 1 + 3 + 2
  for (const to of rotas) {
    assert.equal(rotaMarketingPermitida(to.split('?')[0]), true, `item do menu bloqueado pelo guard: ${to}`)
  }
})

test('marketing abre os detalhes das telas liberadas', () => {
  for (const rota of ['/', '/dashboard', '/perfil', '/atendimentos/123', '/guia/milho', '/mapa-visitas/sc',
    '/controle/pedidos/1b2c3d4e-0000-4000-8000-123456789abc', '/campanhas/']) {
    assert.equal(rotaMarketingPermitida(rota), true, rota)
  }
})

test('marketing NÃO abre o que ficou fora do bloco', () => {
  for (const rota of ['/controle/financeiro', '/controle/novo-pedido', '/controle/producao/fabrica',
    '/controle/pedidos/editar/1b2c3d4e-0000-4000-8000-123456789abc', '/orcamentos/montar', '/orcamentos',
    '/guia/admin', '/funil/relatorio', '/funil/manual', '/disparos', '/frete', '/frete/mapa', '/contatos',
    '/agenda', '/ia-teste', '/producao-propria', '/minhas-visitas', '/conversao-comercial', '/admin/usuarios']) {
    assert.equal(rotaMarketingPermitida(rota), false, rota)
  }
})
