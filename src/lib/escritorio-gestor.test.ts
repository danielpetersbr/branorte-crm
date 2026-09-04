import assert from 'node:assert/strict'
import test from 'node:test'
import {
  criarAlertasGestor,
  criarResumoGestor,
  escolherVendedorInicial,
  formatarMetricaGestor,
  ordenarVendedoresGestor,
  type VendedorGestor,
} from './escritorio-gestor'

const base = (overrides: Partial<VendedorGestor>): VendedorGestor => ({
  nome: 'EDER',
  status: 'ativo',
  statusLabel: 'trabalhando',
  pingSec: 10,
  versao: '1.46.0',
  atendimentos: 4,
  leads: 2,
  orcamentos: 1,
  ligacoesAtendidas: 1,
  ligacoesTotal: 2,
  followup: 17,
  quentes: 0,
  carteiraAberta: 91,
  carteiraTotal: 1371,
  parados: 0,
  fatorCota: 1,
  cortadoPorCota: false,
  ...overrides,
})

test('resume produção e conta cada pessoa em atenção uma única vez', () => {
  const vendedores = [
    base({ nome: 'RAMON', atendimentos: 4, leads: 0, orcamentos: 0, status: 'ocioso', parados: 109, fatorCota: 0, cortadoPorCota: true }),
    base({ nome: 'ALVARO', atendimentos: 6, leads: 2, orcamentos: 0, status: 'desconectado', parados: 86, fatorCota: 0, cortadoPorCota: true }),
    base({ nome: 'LUCAS', atendimentos: 8, leads: 2, orcamentos: 5 }),
  ]
  assert.deepEqual(criarResumoGestor(vendedores, true), {
    atendimentos: 18,
    leads: 4,
    orcamentos: 5,
    ativos: 1,
    total: 3,
    precisamAtencao: 2,
  })
})

test('preserva ausência de fonte como null em vez de zero', () => {
  const resumo = criarResumoGestor([base({ atendimentos: null, leads: null, orcamentos: null })], true)
  assert.equal(resumo.atendimentos, null)
  assert.equal(resumo.leads, null)
  assert.equal(resumo.orcamentos, null)
})

test('gera primeiro o bloqueio por cota e depois a queda operacional', () => {
  const alertas = criarAlertasGestor([
    base({ nome: 'ALVARO', status: 'desconectado', parados: 86, fatorCota: 0, cortadoPorCota: true }),
    base({ nome: 'RAMON', status: 'ocioso', parados: 109, fatorCota: 0, cortadoPorCota: true }),
  ], { expediente: true, cotaAtiva: true, cotaZero: 60 })
  assert.equal(alertas[0].tipo, 'cota-bloqueada')
  assert.match(alertas[0].texto, /não recebe novos leads/i)
  assert.ok(alertas.some(alerta => alerta.tipo === 'offline' && alerta.vendedor === 'ALVARO'))
  assert.ok(alertas.some(alerta => alerta.tipo === 'destaque' && alerta.vendedor === 'ALVARO'))
})

test('ordena atenção antes da produção e escolhe o primeiro alerta', () => {
  const vendedores = [base({ nome: 'JARDEL', atendimentos: 30 }), base({ nome: 'RAMON', parados: 109, cortadoPorCota: true })]
  assert.equal(ordenarVendedoresGestor(vendedores, 'atencao')[0].nome, 'RAMON')
  assert.equal(escolherVendedorInicial(vendedores, [{ id: 'RAMON-cota', vendedor: 'RAMON', tipo: 'cota-bloqueada', nivel: 'critico', titulo: '', texto: '' }]), 'RAMON')
})

test('não escolhe líder de atendimentos quando a fonte está ausente para todos', () => {
  const vendedores = [base({ nome: 'JARDEL', atendimentos: null }), base({ nome: 'RAMON', atendimentos: null })]
  assert.equal(escolherVendedorInicial(vendedores, []), null)
})

test('formata métrica ausente como travessão', () => {
  assert.equal(formatarMetricaGestor(null), '—')
  assert.equal(formatarMetricaGestor(0), '0')
  assert.equal(formatarMetricaGestor(1384), '1.384')
})
