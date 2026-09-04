import assert from 'node:assert/strict'
import test from 'node:test'
import {
  criarCabecalhosHojeGestor,
  criarAlertasGestor,
  criarResumoGestor,
  escolherVendedorInicial,
  formatarMetricaGestor,
  normalizarFatorCotaGestor,
  ordenarVendedoresGestor,
  resolverSelecaoGestor,
  resolverVisaoTabelaGestor,
  rotuloOrdemGestor,
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

test('cota desativada neutraliza fator bruto sem alterar o fator da cota ativa', () => {
  assert.equal(normalizarFatorCotaGestor(false, 0.52), null)
  assert.equal(normalizarFatorCotaGestor(true, 0.52), 0.52)
  assert.equal(normalizarFatorCotaGestor(true, null), null)
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

test('cota parcial gera aviso sem dizer que o vendedor está bloqueado', () => {
  const [alerta] = criarAlertasGestor([
    base({ nome: 'JARDEL', parados: 37, fatorCota: 0.52, cortadoPorCota: false }),
  ], { expediente: true, cotaAtiva: true, cotaZero: 60 })

  assert.equal(alerta.tipo, 'cota-reduzida')
  assert.doesNotMatch(alerta.titulo, /não recebe/i)
})

test('fora do expediente não transforma ausência de WhatsApp em alerta', () => {
  const alertas = criarAlertasGestor([
    base({ status: 'desconectado', orcamentos: 0 }),
  ], { expediente: false, cotaAtiva: false, cotaZero: 60 })

  assert.equal(alertas.length, 0)
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

test('vendedor sem alerta inicial seleciona o líder de atendimentos disponível', () => {
  const vendedores = [
    base({ nome: 'EDER', atendimentos: 4 }),
    base({ nome: 'JARDEL', atendimentos: 30 }),
  ]

  assert.equal(escolherVendedorInicial(vendedores, []), 'JARDEL')
})

test('formata métrica ausente como travessão', () => {
  assert.equal(formatarMetricaGestor(null), '—')
  assert.equal(formatarMetricaGestor(0), '0')
  assert.equal(formatarMetricaGestor(1384), '1.384')
})

test('distingue ligações atendidas e não atribui a ordenação de atenção ao status', () => {
  const cabecalhos = criarCabecalhosHojeGestor('ligacoes')
  const status = cabecalhos.find(cabecalho => cabecalho.id === 'status')
  const ligacoes = cabecalhos.find(cabecalho => cabecalho.id === 'ligacoes')

  assert.deepEqual(status, { id: 'status', label: 'Status', ordem: null, ariaSort: null })
  assert.deepEqual(ligacoes, { id: 'ligacoes', label: 'Ligações atendidas', ordem: 'ligacoes', ariaSort: 'descending' })
  assert.equal(rotuloOrdemGestor('atencao'), 'Atenção primeiro')
})

test('resolve as visões Hoje, Mês e indisponibilidade mensal', () => {
  assert.equal(resolverVisaoTabelaGestor('hoje', false), 'hoje')
  assert.equal(resolverVisaoTabelaGestor('mes', true), 'mes')
  assert.equal(resolverVisaoTabelaGestor('mes', false), 'mes-indisponivel')
})

test('resolve a seleção para alertas e linhas sem trocar o vendedor', () => {
  assert.equal(resolverSelecaoGestor({ tipo: 'alerta', vendedor: 'RAMON' }), 'RAMON')
  assert.equal(resolverSelecaoGestor({ tipo: 'linha', nome: 'ALVARO' }), 'ALVARO')
})
