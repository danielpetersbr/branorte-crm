import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularMontagem, inclusosMontagem, normalizarMontagem, MONTAGEM_PADRAO, type MontagemCfg,
  montagemParaSalvar, totalMontagemSalva, quadrosMontagem,
  comResponsavel, obsPorContaComMontagem, MONTAGEM_QUADRO_CLIENTE,
} from './orcamento-montagem.ts'
import { OBS_POR_CONTA_DEFAULT } from './orcamento-defaults.ts'

const cfg = (over: Partial<MontagemCfg> = {}): MontagemCfg => ({ ...MONTAGEM_PADRAO, ...over })

test('caso do Daniel: 2 pessoas, 5 dias, 1 carro, base 224 mil', () => {
  const r = calcularMontagem(cfg({ pessoas: 2, dias: 5, carros: 1 }), 224_000)
  const v = Object.fromEntries(r.linhas.map(l => [l.chave, l.valor]))
  assert.equal(v.mao_obra, 22_400)      // 10% de 224.000
  assert.equal(v.estadia, 5_000)        // 500 × 2 × 5
  assert.equal(v.alimentacao, 1_000)    // 100 × 2 × 5
  assert.equal(v.passagem, 10_000)      // 5.000 × 2
  assert.equal(v.deslocamento, 1_500)   // 300 × 1 × 5
  assert.equal(r.total, 39_900)
})

test('bloco desligado nao soma nada', () => {
  assert.equal(calcularMontagem(cfg({ ativo: false, pessoas: 4, dias: 10 }), 500_000).total, 0)
  assert.equal(calcularMontagem(null, 500_000).total, 0)
})

test('base zero: mao de obra some, o resto da viagem continua', () => {
  const r = calcularMontagem(cfg({ pessoas: 1, dias: 2, carros: 1 }), 0)
  assert.equal(r.linhas.find(l => l.chave === 'mao_obra'), undefined)
  assert.equal(r.total, 500 * 2 + 100 * 2 + 5_000 + 300 * 2)
})

test('passagem editada na hora entra no lugar da media', () => {
  const r = calcularMontagem(cfg({ pessoas: 3, dias: 1, carros: 0, passagemPessoa: 1_850 }), 0)
  assert.equal(r.linhas.find(l => l.chave === 'passagem')?.valor, 5_550)
  assert.equal(r.linhas.find(l => l.chave === 'deslocamento'), undefined) // 0 carro = sem linha
})

test('campo vazio/NaN/negativo nao vira valor negativo nem NaN', () => {
  const r = calcularMontagem(cfg({ pessoas: NaN as unknown as number, dias: -3, carros: 1 }), -100)
  assert.equal(r.total, 0)
  assert.ok(Number.isFinite(r.total))
})

test('percentual diferente de 10 respeitado', () => {
  const r = calcularMontagem(cfg({ pessoas: 0, dias: 0, carros: 0, percentualMaoObra: 7.5 }), 200_000)
  assert.equal(r.total, 15_000)
})

test('detalhe mostra a conta pro vendedor conferir', () => {
  const r = calcularMontagem(cfg({ pessoas: 2, dias: 5, carros: 1 }), 100_000)
  const estadia = r.linhas.find(l => l.chave === 'estadia')!
  assert.match(estadia.detalhe, /2 pessoas/)
  assert.match(estadia.detalhe, /5 dias/)
  const passagem = r.linhas.find(l => l.chave === 'passagem')!
  assert.doesNotMatch(passagem.detalhe, /dias/) // passagem nao multiplica por dia
})

test('normalizar preenche campo que faltou no JSONB antigo', () => {
  const n = normalizarMontagem({ pessoas: 3, dias: 4 })!
  assert.equal(n.pessoas, 3)
  assert.equal(n.dias, 4)
  assert.equal(n.carros, MONTAGEM_PADRAO.carros)
  assert.equal(n.passagemPessoa, 5_000)
  assert.equal(n.ativo, true)
  assert.equal(normalizarMontagem(null), null)
})

test('inclusos: lista o que entrou, sem valor, com "e" no fim', () => {
  const r = inclusosMontagem(cfg({ pessoas: 2, dias: 15, carros: 1 }), 92_126.9)
  assert.equal(r, 'mão de obra, estadia, alimentação, passagem aérea e deslocamento')
  assert.doesNotMatch(r, /\d/)       // nenhum numero vaza
  assert.doesNotMatch(r, /R\$/)
})

test('inclusos: so cita o que REALMENTE entrou', () => {
  // sem carro e sem base: some deslocamento e mao de obra
  assert.equal(inclusosMontagem(cfg({ pessoas: 1, dias: 3, carros: 0 }), 0),
    'estadia, alimentação e passagem aérea')
  // so passagem
  assert.equal(inclusosMontagem(cfg({ pessoas: 1, dias: 0, carros: 0 }), 0), 'passagem aérea')
  // nada ligado
  assert.equal(inclusosMontagem(cfg({ ativo: false }), 100_000), '')
  assert.equal(inclusosMontagem(null, 100_000), '')
})

// ── Roadmap #69 (29/09/2026): "Branorte cobre" x "por conta do cliente" por linha ──

// JSONB como está gravado HOJE em orcamentos_gerados.montagem (montagemParaSalvar
// de antes da mudança): sem `responsavel`, com o total carimbado.
const SALVO_ANTES = {
  ativo: true, pessoas: 2, dias: 5, carros: 1, percentualMaoObra: 10,
  estadiaDia: 500, alimentacaoDia: 100, passagemPessoa: 5000, deslocamentoDia: 300,
  total: 39_900,
}

test('orçamento salvo ANTES da mudança abre e soma exatamente igual', () => {
  const n = normalizarMontagem(SALVO_ANTES)!
  // mesmo objeto de sempre: nenhum campo novo aparece ao reabrir
  assert.deepEqual(n, {
    ativo: true, pessoas: 2, dias: 5, carros: 1, percentualMaoObra: 10,
    estadiaDia: 500, alimentacaoDia: 100, passagemPessoa: 5000, deslocamentoDia: 300,
  })
  assert.equal('responsavel' in n, false)
  const r = calcularMontagem(n, 224_000)
  assert.equal(r.total, 39_900)
  assert.deepEqual(r.linhas.map(l => [l.chave, l.valor]), [
    ['mao_obra', 22_400], ['estadia', 5_000], ['alimentacao', 1_000], ['passagem', 10_000], ['deslocamento', 1_500],
  ])
  assert.deepEqual(r.linhasCliente, [])
  // salvar de novo carimba o mesmo total; contrato (carimbo) lê o mesmo número
  assert.equal(montagemParaSalvar(n, 224_000)!.total, 39_900)
  assert.equal(totalMontagemSalva(SALVO_ANTES as MontagemCfg), 39_900)
  assert.equal(inclusosMontagem(n, 224_000), 'mão de obra, estadia, alimentação, passagem aérea e deslocamento')
  // PDF/DOCX: um quadro só, o do fabricante, com o mesmo total; nada "por conta do cliente"
  const q = quadrosMontagem(n, 224_000)
  assert.equal(q.fabricante?.total, 39_900)
  assert.equal(q.fabricante?.itens.length, 5)
  assert.equal(q.cliente, null)
  // "por conta do cliente" do rodapé: igual a hoje (sai só a linha da montagem cobrada)
  assert.deepEqual(obsPorContaComMontagem(null, n, 224_000),
    OBS_POR_CONTA_DEFAULT.filter(l => !/montagem dos equipamentos/i.test(l)))
})

test('caso do print: alimentação, estadia e deslocamento por conta do cliente', () => {
  const c = cfg({ pessoas: 2, dias: 5, carros: 1, responsavel: { alimentacao: 'cliente', estadia: 'cliente', deslocamento: 'cliente' } })
  const r = calcularMontagem(c, 224_000)
  assert.deepEqual(r.linhas.map(l => l.chave), ['mao_obra', 'passagem'])
  assert.equal(r.total, 22_400 + 10_000) // só o que a Branorte cobra
  assert.deepEqual(r.linhasCliente.map(l => l.chave), ['estadia', 'alimentacao', 'deslocamento'])
  assert.ok(r.linhasCliente.every(l => l.responsavel === 'cliente'))
  assert.equal(inclusosMontagem(c, 224_000), 'mão de obra e passagem aérea')

  // mesma ordem do print: Alimentação, Estadia, Deslocamento
  const q = quadrosMontagem(c, 224_000)
  assert.deepEqual(q.fabricante, { itens: ['Mão de obra', 'Passagens aéreas idas/voltas'], total: 32_400 })
  assert.deepEqual(q.cliente, { itens: ['Alimentação', 'Estadia', 'Deslocamento'] })
  assert.match(MONTAGEM_QUADRO_CLIENTE, /por conta do cliente/i)
  // o contrato lê o carimbo: tem que ser só a parte da Branorte
  assert.equal(montagemParaSalvar(c, 224_000)!.total, 32_400)
})

test('linha do cliente aparece mesmo zerada (sem carro) e nunca soma', () => {
  const c = cfg({ pessoas: 1, dias: 3, carros: 0, responsavel: { deslocamento: 'cliente' } })
  const r = calcularMontagem(c, 0)
  assert.deepEqual(r.linhasCliente.map(l => l.chave), ['deslocamento'])
  assert.equal(r.total, 500 * 3 + 100 * 3 + 5_000)
})

test('tudo por conta do cliente: total zero, só o 2º quadro', () => {
  const tudo = { mao_obra: 'cliente', estadia: 'cliente', alimentacao: 'cliente', passagem: 'cliente', deslocamento: 'cliente' } as const
  const c = cfg({ pessoas: 2, dias: 5, carros: 1, responsavel: tudo })
  assert.equal(calcularMontagem(c, 224_000).total, 0)
  const q = quadrosMontagem(c, 224_000)
  assert.equal(q.fabricante, null)
  assert.equal(q.cliente?.itens.length, 5)
})

test('voltar a linha pra Branorte apaga a marcação (JSON igual ao de antes)', () => {
  const base = cfg({ pessoas: 2, dias: 5 })
  const marcado = comResponsavel(base, 'estadia', 'cliente')
  assert.deepEqual(marcado.responsavel, { estadia: 'cliente' })
  const desmarcado = comResponsavel(marcado, 'estadia', 'branorte')
  assert.deepEqual(desmarcado, base)
  assert.equal('responsavel' in desmarcado, false)
})

test('normalizar guarda só "cliente" com chave conhecida e sobrevive ao salvar', () => {
  const n = normalizarMontagem({
    ...SALVO_ANTES,
    responsavel: { estadia: 'cliente', alimentacao: 'branorte', inventada: 'cliente', deslocamento: 'CLIENTE' },
  })!
  assert.deepEqual(n.responsavel, { estadia: 'cliente' })
  const volta = normalizarMontagem(montagemParaSalvar(n, 224_000))!
  assert.deepEqual(volta.responsavel, { estadia: 'cliente' })
  // lixo no campo não quebra nada
  assert.equal('responsavel' in normalizarMontagem({ ...SALVO_ANTES, responsavel: 'cliente' })!, false)
})

test('observação "por conta do cliente" coerente com a montagem', () => {
  // sem montagem: as 5 linhas históricas, iguais a hoje
  assert.deepEqual(obsPorContaComMontagem(null, null, 100_000), OBS_POR_CONTA_DEFAULT)
  // montagem cobrada: sai "Montagem dos equipamentos ... (se necessário)"
  const cobrada = obsPorContaComMontagem(null, cfg({ pessoas: 2, dias: 5 }), 100_000)
  assert.equal(cobrada.some(l => /montagem dos equipamentos/i.test(l)), false)
  assert.equal(cobrada.length, OBS_POR_CONTA_DEFAULT.length - 1)
  // linhas da montagem por conta do cliente NÃO entram aqui (prévia, PDF e DOCX
  // têm o 2º quadro): listar nos dois lugares duplicava a informação
  const c = cfg({ pessoas: 2, dias: 5, responsavel: { alimentacao: 'cliente', estadia: 'cliente' } })
  assert.deepEqual(obsPorContaComMontagem(['Painel elétrico'], c, 100_000), ['Painel elétrico'])
  // lista salva não é mutada
  const salva = ['Painel elétrico', 'Montagem dos equipamentos orçados acima (se necessário)']
  obsPorContaComMontagem(salva, c, 100_000)
  assert.equal(salva.length, 2)
})

test('editor: as 5 linhas aparecem, inclusive a da Branorte zerada (dá pra marcar e voltar o valor)', () => {
  // sem carro: deslocamento = R$ 0 — antes sumia da tela junto com o campo do unitário
  const c = cfg({ pessoas: 1, dias: 3, carros: 0 })
  const r = calcularMontagem(c, 0)
  assert.deepEqual(r.todas.map(l => l.chave), ['mao_obra', 'estadia', 'alimentacao', 'passagem', 'deslocamento'])
  assert.equal(r.todas.find(l => l.chave === 'deslocamento')?.valor, 0)
  assert.equal(r.todas.find(l => l.chave === 'deslocamento')?.responsavel, 'branorte')
  // mas no total e no PDF/DOCX a zerada continua fora, como sempre
  assert.equal(r.linhas.some(l => l.chave === 'deslocamento' || l.chave === 'mao_obra'), false)
  assert.equal(r.total, 500 * 3 + 100 * 3 + 5_000)
  assert.deepEqual(quadrosMontagem(c, 0).fabricante?.itens, ['Passagens aéreas idas/voltas', 'Alimentação', 'Estadia'])
  // marcada pelo editor, vai pro 2º quadro
  const marcada = comResponsavel(c, 'deslocamento', 'cliente')
  assert.equal(calcularMontagem(marcada, 0).todas.find(l => l.chave === 'deslocamento')?.responsavel, 'cliente')
  assert.deepEqual(quadrosMontagem(marcada, 0).cliente, { itens: ['Deslocamento'] })
  // bloco desligado: nada na tela de linhas
  assert.deepEqual(calcularMontagem(cfg({ ativo: false }), 100_000).todas, [])
})
