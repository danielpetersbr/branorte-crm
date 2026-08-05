/**
 * Testes do Guia do Vendedor — busca, filtros e motor do Atendimento Rápido.
 *
 * Roda com `npm test` (tsx --test). Nada aqui toca React ou Supabase: as duas
 * bibliotecas são puras de propósito.
 *
 * O que estes testes protegem, em ordem de importância:
 *   1. Ingrediente incompatível (silagem, óleo) tem que APARECER como
 *      incompatível quando o vendedor o marca. Foi o defeito nº 1 da auditoria.
 *   2. `podeFecharEquipamento` não pode virar true sem consumo confirmado.
 *   3. A busca tem que aguentar acento, plural e a intenção escrita por extenso.
 */
import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buscar, detectarAtalho, filtrarMaterias, normalizar, tokens,
} from './busca'
import {
  analisar, capacidadeParaAnalise, consumoDeReferencia, especieDoEstudo, resumoParaCopiar,
} from './atendimento'
import type { Atendimento, GuiaAnimal, GuiaMateria } from './tipos'

// ---------------------------------------------------------------------------
// Fábricas de teste — só os campos que a lógica lê.
// ---------------------------------------------------------------------------
function materia(p: Partial<GuiaMateria> & { slug: string; nome: string }): GuiaMateria {
  return {
    id: 1, sinonimos: [], categoria: 'energetico', resumo: '', funcao: null, composicao: null,
    inclusao: {}, especies: [], restricoes: [], umidade: null, densidade_kg_m3: null,
    forma_fisica: null, fluidez: null, empedra: null, forma_ponte: null, abrasivo: null,
    oleoso: null, gera_poeira: null, corrosivo: null, risco_micotoxina: null, precisa_moer: null,
    granulometria: null, direto_misturador: null, exige_pre_mistura: null, microingrediente: null,
    compat_rosca: null, exige_exaustao: null, exige_limpeza_rapida: null, misturador_indicado: null,
    afeta_homogeneidade: null, armazenamento: null, compat_branorte: 'ok', compat_motivo: null,
    equipamentos: [], nivel_risco: 'informacao', alerta: null, perguntas: [],
    explicar_cliente: null, resumo_30s: null, regiao: null, imagem_slug: null, emoji: null,
    status: 'aprovado', pendente_validacao: false, pendencias: [], fontes: [], autor: null,
    revisor_tecnico: null, revisado_em: null, proxima_revisao: null, ordem: 0,
    updated_at: '2026-08-03T00:00:00Z', ...p,
  } as GuiaMateria
}

function animal(p: Partial<GuiaAnimal> & { slug: string; nome: string }): GuiaAnimal {
  return {
    id: 1, sinonimos: [], especie: 'bovinos', subgrupo: null, tipo: 'categoria',
    classificacao: null, finalidade: null, resumo: '', sistemas: [], fases: [], fase_estudo: null,
    peso_min_kg: null, peso_max_kg: null, peso_nota: null, consumo_ref: null,
    consumo_unidade: null, consumo_fatores: [], tipos_alimentacao: [], forma_fisica: [],
    materias_comuns: [], restricoes: [], perguntas: [], sinais_falta_info: [], processo: null,
    equipamentos: [], argumento: null, promessas_proibidas: [], branorte: {},
    explicar_cliente: null, resumo_30s: null, regiao: null, imagem_slug: null, emoji: null,
    status: 'aprovado', pendente_validacao: false, pendencias: [], fontes: [], autor: null,
    revisor_tecnico: null, revisado_em: null, proxima_revisao: null, ordem: 0,
    updated_at: '2026-08-03T00:00:00Z', ...p,
  } as GuiaAnimal
}

const MILHO = materia({
  slug: 'milho', nome: 'Milho (grão)', sinonimos: ['fubá', 'milho triturado'],
  categoria: 'energetico', resumo: 'Base energética da ração.',
  especies: ['aves', 'suinos', 'bovinos'], precisa_moer: true, equipamentos: ['MOINHO'],
  regiao: 'Centro-Oeste e Sul',
})
const SILAGEM = materia({
  slug: 'silagem-volumoso', nome: 'Silagem e volumosos', categoria: 'fibroso',
  resumo: 'Volumoso úmido.', especies: ['bovinos'], compat_branorte: 'incompativel',
  compat_motivo: 'A fábrica é de ração farelada — produto seco.',
  nivel_risco: 'incompativel',
})
const UREIA = materia({
  slug: 'ureia', nome: 'Ureia pecuária', categoria: 'risco', resumo: 'NNP.',
  especies: ['bovinos'], nivel_risco: 'alto_risco', alerta: 'Pode matar o animal.',
  compat_branorte: 'ressalva', microingrediente: true, corrosivo: true,
})
const CAROCO = materia({
  slug: 'caroco-algodao', nome: 'Caroço de algodão', categoria: 'proteico',
  resumo: 'Três em um.', especies: ['bovinos'], misturador_indicado: 'horizontal',
  compat_branorte: 'ressalva', compat_motivo: 'Não flui.',
})
const SAL = materia({
  slug: 'sal-comum', nome: 'Sal comum', categoria: 'mineral', resumo: 'NaCl.',
  especies: ['aves', 'suinos', 'bovinos'], corrosivo: true, misturador_indicado: 'horizontal',
})
const MATERIAS = [MILHO, SILAGEM, UREIA, CAROCO, SAL]

const CONFINAMENTO = animal({
  slug: 'bov-corte-confinamento', nome: 'Corte — Confinamento', especie: 'bovinos',
  subgrupo: 'corte', tipo: 'categoria', fases: ['confinamento'], fase_estudo: 'confinamento',
  sistemas: ['confinamento'], perguntas: ['Quantos animais?', 'Qual o peso médio?'],
  materias_comuns: ['milho', 'caroco-algodao'], equipamentos: ['MOINHO', 'MISTURADOR'],
  processo: 'Moagem + mistura seca.', restricoes: ['Silagem não entra na fábrica farelada.'],
  resumo: 'Cocho com dieta de alto concentrado.',
})
const NELORE = animal({
  slug: 'nelore', nome: 'Nelore', especie: 'bovinos', subgrupo: 'corte', tipo: 'raca',
  fases: ['manutencao'], sistemas: ['pasto'], resumo: 'Zebuíno predominante no rebanho de corte.',
  regiao: 'Todo o Brasil', materias_comuns: ['sal-comum'],
})
const POSTURA = animal({
  slug: 'ave-postura', nome: 'Poedeiras — Postura', especie: 'aves', subgrupo: 'postura',
  tipo: 'categoria', fases: ['postura'], fase_estudo: 'postura', sistemas: ['comercial'],
  resumo: 'Fase produtiva da poedeira.', perguntas: ['Quantas aves alojadas?'],
})
const ANIMAIS = [CONFINAMENTO, NELORE, POSTURA]

const rotA = (a: GuiaAnimal) => a.especie
const rotM = (m: GuiaMateria) => m.categoria
const SEM_FAVORITOS = new Set<string>()

// ===========================================================================
describe('normalização e tokens', () => {
  it('tira acento, pontuação e caixa', () => {
    assert.equal(normalizar('Óleo / Gordura'), 'oleo gordura')
    assert.equal(normalizar('Caroço de algodão (integral)'), 'caroco de algodao integral')
    assert.equal(normalizar(''), '')
  })

  it('descarta palavras de ligação, que só distorcem o score', () => {
    assert.deepEqual(tokens('ração para os suínos de corte'), ['racao', 'suinos', 'corte'])
  })
})

describe('atalhos semânticos', () => {
  it('reconhece a intenção escrita por extenso', () => {
    const a = detectarAtalho('ingrediente que não pode ir para aves')
    assert.ok(a, 'deveria ter detectado o atalho')
    assert.equal(a!.filtro.restritoPara, 'aves')
  })

  it('reconhece "misturador para sal"', () => {
    assert.equal(detectarAtalho('misturador para sal')?.filtro.misturador, 'horizontal')
  })

  it('avisa sobre peletização em vez de devolver resultado', () => {
    const a = detectarAtalho('ração peletizada')
    assert.ok(a)
    assert.match(a!.rotulo, /FARELADA/)
  })

  it('NÃO dispara em busca curta e comum — "sal" é um item, não uma intenção', () => {
    assert.equal(detectarAtalho('sal'), null)
    assert.equal(detectarAtalho('milho'), null)
  })
})

describe('busca', () => {
  it('acha por nome mesmo sem acento e sem plural exato', () => {
    const r = buscar(ANIMAIS, MATERIAS, 'caroco', {}, SEM_FAVORITOS, rotA, rotM)
    assert.equal(r.itens[0].slug, 'caroco-algodao')
  })

  it('acha por sinônimo', () => {
    const r = buscar([], MATERIAS, 'fuba', {}, SEM_FAVORITOS, rotA, rotM)
    assert.equal(r.itens[0].slug, 'milho')
  })

  it('exige TODOS os termos (AND): "gado confinamento" não traz tudo que fala de gado', () => {
    const r = buscar(ANIMAIS, MATERIAS, 'corte confinamento', {}, SEM_FAVORITOS, rotA, rotM)
    assert.equal(r.itens.length, 1)
    assert.equal(r.itens[0].slug, 'bov-corte-confinamento')
  })

  it('ordena por onde o termo casou — nome vale mais que corpo do texto', () => {
    const r = buscar(ANIMAIS, MATERIAS, 'milho', {}, SEM_FAVORITOS, rotA, rotM)
    assert.equal(r.itens[0].slug, 'milho')
  })

  it('sem consulta, devolve a lista inteira', () => {
    const r = buscar(ANIMAIS, MATERIAS, '', {}, SEM_FAVORITOS, rotA, rotM)
    assert.equal(r.itens.length, ANIMAIS.length + MATERIAS.length)
  })

  it('o atalho vira FILTRO, não busca textual', () => {
    const r = buscar([], MATERIAS, 'ingrediente que não pode ir para aves', {}, SEM_FAVORITOS, rotA, rotM)
    assert.ok(r.atalho)
    // milho e sal servem pra ave; silagem, ureia e caroço não.
    const slugs = r.itens.map(i => i.slug).sort()
    assert.deepEqual(slugs, ['caroco-algodao', 'silagem-volumoso', 'ureia'])
  })
})

describe('filtros de matéria-prima', () => {
  it('"o que não entra na fábrica" devolve só o incompatível', () => {
    const r = filtrarMaterias(MATERIAS, { compat: 'incompativel' }, SEM_FAVORITOS)
    assert.deepEqual(r.map(m => m.slug), ['silagem-volumoso'])
  })

  it('filtra por risco alto', () => {
    const r = filtrarMaterias(MATERIAS, { risco: 'alto_risco' }, SEM_FAVORITOS)
    assert.deepEqual(r.map(m => m.slug), ['ureia'])
  })

  it('filtra por propriedade mecânica (corrosivo)', () => {
    const r = filtrarMaterias(MATERIAS, { propriedade: 'corrosivo' }, SEM_FAVORITOS)
    assert.deepEqual(r.map(m => m.slug).sort(), ['sal-comum', 'ureia'])
  })

  it('filtra por misturador indicado', () => {
    const r = filtrarMaterias(MATERIAS, { misturador: 'horizontal' }, SEM_FAVORITOS)
    assert.deepEqual(r.map(m => m.slug).sort(), ['caroco-algodao', 'sal-comum'])
  })

  it('restritoPara devolve o que NÃO serve pra espécie', () => {
    const r = filtrarMaterias(MATERIAS, { restritoPara: 'aves' }, SEM_FAVORITOS)
    assert.ok(r.every(m => !m.especies.includes('aves')))
  })

  it('favoritos filtram pela chave tipo:slug', () => {
    const favs = new Set(['materia:ureia'])
    const r = filtrarMaterias(MATERIAS, { soFavoritos: true }, favs)
    assert.deepEqual(r.map(m => m.slug), ['ureia'])
  })
})

// ===========================================================================
describe('consumo de referência', () => {
  it('lê do catálogo de /producao-propria — os dois módulos usam o mesmo número', () => {
    assert.equal(consumoDeReferencia('aves', 'postura'), 3.4)
    assert.equal(consumoDeReferencia('suinos', 'terminacao'), 90)
  })

  it('devolve null pra espécie que o estudo ainda não conhece', () => {
    assert.equal(especieDoEstudo('ovinos'), null)
    assert.equal(consumoDeReferencia('ovinos', 'recria'), null)
  })

  it('devolve null pra fase inexistente', () => {
    assert.equal(consumoDeReferencia('aves', 'fase-que-nao-existe'), null)
  })
})

describe('capacidade para análise', () => {
  it('escolhe a menor capacidade da linha que dá conta', () => {
    // 50.000 kg/mês ÷ (26 × 8 × 0,8) = 300,5 kg/h → 500 é a primeira que atende.
    // Era 600 enquanto a lista era sintética; 600 kg/h não existe na linha.
    const { kgH } = capacidadeParaAnalise(50_000)
    assert.equal(kgH, 500)
  })

  it('avisa quando a linha escolhida fica perto do limite', () => {
    // 49.000 ÷ (26 × 8 × 0,8) = 294,7 kg/h → cabe em 300, mas a 98% do tempo
    const { kgH, nota } = capacidadeParaAnalise(49_000)
    assert.equal(kgH, 300)
    assert.match(nota!, /perto do limite/i)
  })

  it('com folga, a nota explica a conta em vez de alarmar', () => {
    // 30.000 ÷ 166,4 = 180 kg/h → 300 kg/h a 60% do tempo
    const { kgH, nota } = capacidadeParaAnalise(30_000)
    assert.equal(kgH, 300)
    assert.doesNotMatch(nota!, /perto do limite/i)
  })

  it('não inventa equipamento acima da linha — manda pra engenharia', () => {
    const { kgH, nota } = capacidadeParaAnalise(10_000_000)
    assert.equal(kgH, null)
    assert.match(nota!, /engenharia/i)
  })

  it('sem necessidade, não devolve capacidade', () => {
    assert.deepEqual(capacidadeParaAnalise(null), { kgH: null, nota: null })
    assert.deepEqual(capacidadeParaAnalise(0), { kgH: null, nota: null })
  })
})

describe('Atendimento Rápido — motor', () => {
  const vazio: Atendimento = {
    especie: null, fase: null, quantidade: null, sistema: null,
    produto: null, materias: [], consumoConfirmado: false,
  }

  it('em branco, lista tudo que falta e não fecha equipamento', () => {
    const r = analisar(vazio, ANIMAIS, MATERIAS)
    assert.equal(r.podeFecharEquipamento, false)
    assert.equal(r.capacidadeSugeridaKgH, null)
    assert.ok(r.faltando.includes('Espécie'))
    assert.ok(r.faltando.includes('Confirmação do consumo com o cliente'))
  })

  it('NÃO fecha equipamento sem consumo confirmado, mesmo com todo o resto preenchido', () => {
    const a: Atendimento = {
      ...vazio, especie: 'aves', fase: 'postura', quantidade: 20_000,
      produto: 'Ração farelada completa', materias: ['milho'], consumoConfirmado: false,
    }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.equal(r.necessidadeMesKg, 68_000)          // 3,4 × 20.000
    assert.equal(r.podeFecharEquipamento, false)
    assert.equal(r.capacidadeSugeridaKgH, null, 'capacidade não pode sair sem confirmação')
  })

  it('com consumo confirmado, devolve a capacidade para análise', () => {
    const a: Atendimento = {
      ...vazio, especie: 'aves', fase: 'postura', quantidade: 20_000,
      produto: 'Ração farelada completa', materias: ['milho'], consumoConfirmado: true,
    }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.equal(r.podeFecharEquipamento, true)
    assert.ok(r.capacidadeSugeridaKgH && r.capacidadeSugeridaKgH > 0)
  })

  it('marcar SILAGEM avisa que não entra na fábrica farelada', () => {
    const a: Atendimento = { ...vazio, especie: 'bovinos', fase: 'confinamento', materias: ['silagem-volumoso'] }
    const r = analisar(a, ANIMAIS, MATERIAS)
    const inc = r.atencao.find(x => x.nivel === 'incompativel')
    assert.ok(inc, 'deveria ter alerta de incompatibilidade')
    assert.match(inc!.texto, /não entra na fábrica farelada/i)
  })

  it('marcar UREIA levanta alto risco', () => {
    const a: Atendimento = { ...vazio, especie: 'bovinos', fase: 'confinamento', materias: ['ureia'] }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.ok(r.atencao.some(x => x.nivel === 'alto_risco'))
  })

  it('avisa quando o ingrediente não serve pra espécie escolhida', () => {
    // caroço de algodão só serve pra ruminante; aqui a espécie é aves
    const a: Atendimento = { ...vazio, especie: 'aves', fase: 'postura', materias: ['caroco-algodao'] }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.ok(r.atencao.some(x => x.nivel === 'incompativel' && /NÃO é indicado/.test(x.texto)))
  })

  it('ingrediente corrosivo vira ponto de atenção de limpeza', () => {
    const a: Atendimento = { ...vazio, especie: 'bovinos', fase: 'confinamento', materias: ['sal-comum'] }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.ok(r.atencao.some(x => /corrosivo/i.test(x.texto)))
  })

  it('não repete o mesmo aviso duas vezes', () => {
    const a: Atendimento = {
      ...vazio, especie: 'bovinos', fase: 'confinamento', materias: ['sal-comum', 'ureia'],
    }
    const r = analisar(a, ANIMAIS, MATERIAS)
    const textos = r.atencao.map(x => x.texto)
    assert.equal(new Set(textos).size, textos.length)
  })

  it('traz as perguntas da fase escolhida', () => {
    const a: Atendimento = { ...vazio, especie: 'bovinos', fase: 'confinamento' }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.ok(r.perguntas.includes('Quantos animais?'))
  })

  it('relaciona as matérias comuns daquela criação', () => {
    const a: Atendimento = { ...vazio, especie: 'bovinos', fase: 'confinamento' }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.deepEqual(r.relacionados.map(x => x.slug).sort(), ['caroco-algodao', 'milho'])
  })
})

describe('resumo para copiar', () => {
  it('inclui o que falta levantar e a ressalva de profissional habilitado', () => {
    const a: Atendimento = {
      especie: 'aves', fase: 'postura', quantidade: 5000, sistema: 'comercial',
      produto: null, materias: [], consumoConfirmado: false,
    }
    const r = analisar(a, ANIMAIS, MATERIAS)
    const t = resumoParaCopiar(a, r, 'Postura')
    assert.match(t, /Ainda falta levantar/)
    assert.match(t, /profissional habilitado/)
    assert.match(t, /17\.000 kg\/mês|17000/)
  })
})

// ═════════════════════════════════════════════════════════════════════════════
// dois modos de volume: quem CONSOME e quem VENDE
// ═════════════════════════════════════════════════════════════════════════════

describe('modo de volume', () => {
  /** Poedeira: o fixture POSTURA tem consumo de 3,4 kg/ave/mês. */
  const aves = (o: Partial<Atendimento> = {}): Atendimento => ({
    especie: 'aves', fase: 'postura', quantidade: null, sistema: null,
    produto: 'Ração farelada completa', materias: ['milho'], consumoConfirmado: false,
    ...o,
  })

  it('modo rebanho: volume = animais × consumo por animal', () => {
    const r = analisar(aves({ quantidade: 20_000, consumoConfirmado: true }), ANIMAIS, MATERIAS)
    assert.equal(r.consumoMesKg, 3.4)
    assert.equal(r.necessidadeMesKg, 68_000)
  })

  it('o consumo DITO PELO CLIENTE ganha do de catálogo', () => {
    // O de catálogo é média de tabela. A diferença multiplica pelo plantel:
    // 0,6 kg a mais em 20 mil aves são 12 t/mês de fábrica a mais.
    const r = analisar(
      aves({ quantidade: 20_000, consumoConfirmado: true, consumoKgAnimalMes: 4 }),
      ANIMAIS, MATERIAS,
    )
    assert.equal(r.consumoMesKg, 4)
    assert.equal(r.necessidadeMesKg, 80_000)
  })

  it('consumo informado inválido cai de volta no catálogo', () => {
    for (const v of [0, -5, null]) {
      const r = analisar(
        aves({ quantidade: 20_000, consumoConfirmado: true, consumoKgAnimalMes: v }),
        ANIMAIS, MATERIAS,
      )
      assert.equal(r.consumoMesKg, 3.4, `${v} devia cair no catálogo`)
    }
  })

  it('modo volume: quem VENDE ração informa a tonelagem, sem rebanho', () => {
    const r = analisar(aves({ modo: 'volume', volumeMesKg: 150_000 }), ANIMAIS, MATERIAS)
    assert.equal(r.necessidadeMesKg, 150_000)
    assert.ok(!r.faltando.some(f => /Quantidade de animais/i.test(f)),
      'não pode cobrar rebanho de quem vende ração')
  })

  it('modo volume não pede "confirme o consumo" — o número JÁ é o final', () => {
    const r = analisar(aves({ modo: 'volume', volumeMesKg: 150_000 }), ANIMAIS, MATERIAS)
    assert.ok(!r.faltando.some(f => /Confirmação do consumo/i.test(f)),
      'seria pedir pra confirmar o que ele acabou de digitar')
  })

  it('modo volume SEM volume cobra o volume, não o rebanho', () => {
    const r = analisar(aves({ modo: 'volume' }), ANIMAIS, MATERIAS)
    assert.ok(r.faltando.some(f => /Volume mensal/i.test(f)), r.faltando.join(' | '))
    assert.equal(r.necessidadeMesKg, null)
    assert.equal(r.podeFecharEquipamento, false)
  })

  it('modo volume fecha equipamento sem rebanho nenhum', () => {
    const r = analisar(aves({ modo: 'volume', volumeMesKg: 150_000 }), ANIMAIS, MATERIAS)
    assert.equal(r.podeFecharEquipamento, true)
    assert.ok(r.capacidadeSugeridaKgH, 'e tem que sair capacidade')
  })

  it('sem `modo` no objeto, funciona como sempre funcionou (rebanho)', () => {
    // Compatibilidade com atendimento antigo, montado sem o campo.
    const r = analisar(aves({ quantidade: 20_000, consumoConfirmado: true }), ANIMAIS, MATERIAS)
    assert.equal(r.necessidadeMesKg, 68_000)
    assert.equal(r.podeFecharEquipamento, true)
  })
})

describe('texto copiado pro WhatsApp respeita o modo', () => {
  const aves = (o: Partial<Atendimento> = {}): Atendimento => ({
    especie: 'aves', fase: 'postura', quantidade: null, sistema: null,
    produto: 'Ração farelada completa', materias: ['milho'], consumoConfirmado: false,
    ...o,
  })

  it('modo VENDA não fala de consumo por animal nem de rebanho', () => {
    // O cliente que VENDE ração não tem animal. O texto vai colado no WhatsApp
    // dele — dizer "consumo de referência: 3,4 kg/animal/mês" é dizer besteira.
    const a = aves({ modo: 'volume', volumeMesKg: 150_000, quantidade: 20_000 })
    const r = analisar(a, ANIMAIS, MATERIAS)
    const txt = resumoParaCopiar(a, r, 'Postura')
    assert.ok(!/kg\/animal/i.test(txt), `sobrou consumo por animal:\n${txt}`)
    assert.ok(!/\d+ animais/i.test(txt), `sobrou o rebanho que não existe mais:\n${txt}`)
    assert.match(txt, /150\.000 kg\/mês/)
    assert.match(txt, /venda de ração/i, 'tem que dizer de onde veio o volume')
  })

  it('modo rebanho continua trazendo rebanho e consumo', () => {
    const a = aves({ quantidade: 20_000, consumoConfirmado: true })
    const r = analisar(a, ANIMAIS, MATERIAS)
    const txt = resumoParaCopiar(a, r, 'Postura')
    assert.match(txt, /20\.000 animais/)
    assert.match(txt, /3\.4 kg\/animal\/mês/)
  })

  it('consumo INFORMADO pelo cliente sai rotulado como tal', () => {
    const a = aves({ quantidade: 20_000, consumoConfirmado: true, consumoKgAnimalMes: 4 })
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.match(resumoParaCopiar(a, r, 'Postura'), /Consumo informado: 4 kg/)
  })
})

// ---------------------------------------------------------------------------
// O que a linha NÃO faz, o misturador que as matérias exigem, e o kg/h que vai
// pro WhatsApp. Os três existiam no banco/na tela e não chegavam ao vendedor no
// momento em que ele está com o cliente no telefone.
// ---------------------------------------------------------------------------
describe('o atendimento lê o bloco Branorte, não só a ficha', () => {
  const LACTACAO = animal({
    slug: 'bov-leite-lactacao', nome: 'Leite — Lactação', especie: 'bovinos',
    subgrupo: 'leite', tipo: 'categoria', fases: ['lactacao'], fase_estudo: 'lactacao',
    sistemas: ['confinamento'], resumo: 'Vaca em produção.',
    promessas_proibidas: ['Não prometer ração PELETIZADA'],
    branorte: {
      atende: ['Mistura seca do concentrado'],
      nao_atende: [
        'Peletização — a linha Branorte não peletiza',
        'Ingredientes ÚMIDOS',
      ],
    },
  })

  const base = (o: Partial<Atendimento> = {}): Atendimento => ({
    especie: 'bovinos', fase: 'lactacao', quantidade: 100, sistema: null,
    produto: null, materias: [], consumoConfirmado: false, ...o,
  })

  it('o que a Branorte NÃO faz sai no atendimento, não só no card', () => {
    const r = analisar(base(), [LACTACAO], MATERIAS)
    assert.ok(
      r.naoAtende.some(x => /peletiza/i.test(x)),
      'a frase "não peletiza" existe no banco e tem que chegar ao telefone',
    )
    assert.ok(r.promessasProibidas.some(x => /PELETIZADA/.test(x)))
  })

  it('sem categoria que fale nisso, não inventa restrição', () => {
    const r = analisar(base({ especie: 'aves', fase: 'postura' }), ANIMAIS, MATERIAS)
    assert.deepEqual(r.naoAtende, [])
  })

  it('uma matéria que pede horizontal decide o misturador da fábrica', () => {
    // Basta o sal na fórmula: mineral denso e corrosivo não roda em vertical.
    const r = analisar(base({ materias: ['milho', 'sal-comum'] }), [LACTACAO], MATERIAS)
    assert.equal(r.misturadorIndicado, 'horizontal')
  })

  it('sem matéria marcada, não opina sobre misturador', () => {
    assert.equal(analisar(base(), [LACTACAO], MATERIAS).misturadorIndicado, null)
  })
})

describe('o texto copiado leva o kg/h da tela, não o da jornada cravada', () => {
  const a: Atendimento = {
    especie: 'aves', fase: 'postura', quantidade: 20_000, sistema: null,
    produto: 'Ração farelada completa', materias: ['milho'], consumoConfirmado: true,
  }

  it('quando a tela informa a produção, é ela que vai pro WhatsApp', () => {
    const r = analisar(a, ANIMAIS, MATERIAS)
    // `capacidadeParaAnalise` assume 26 dias × 8 h × 80% = 166,4 h/mês. Uma
    // jornada 6 × 8 dá 208 h/mês — 25% a menos de kg/h, dois degraus de moinho.
    // O texto tem que dizer o que a tela mostra, senão o cliente recebe no
    // WhatsApp um número que ninguém viu.
    const txt = resumoParaCopiar(a, r, 'Postura', {
      producaoKgH: 327,
      jornada: '6 dias × 8 h',
    })
    assert.match(txt, /Produção necessária: 327 kg\/h \(6 dias × 8 h\)/)
    assert.ok(!/Capacidade para análise/.test(txt), 'não pode sair o número da jornada cravada')
  })

  it('sem a tela informar, o comportamento antigo continua valendo', () => {
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.match(resumoParaCopiar(a, r, 'Postura'), /Capacidade para análise/)
  })

  it('modelo de moinho só entra no texto com o levantamento fechado', () => {
    const semConfirmar = { ...a, consumoConfirmado: false }
    const r = analisar(semConfirmar, ANIMAIS, MATERIAS)
    const txt = resumoParaCopiar(semConfirmar, r, 'Postura', {
      producaoKgH: 327, moinho: 'BNMM175 · 750 kg/h',
    })
    assert.ok(!/BNMM175/.test(txt), 'nomear máquina é o que o cliente leva embora da conversa')
  })
})

describe('"Pontos de atenção" só fala quando tem o que dizer', () => {
  it('sem matéria marcada e sem restrição, a seção não existe', () => {
    // O AVISO_SEM_DADOS enchia a seção com uma tarja azul em 100% das
    // aberturas, repetindo o que a linha de status do mostrador já diz. Um
    // aviso que aparece sempre não é atenção, é moldura.
    const a: Atendimento = {
      especie: null, fase: null, quantidade: null, sistema: null,
      produto: null, materias: [], consumoConfirmado: false,
    }
    assert.deepEqual(analisar(a, ANIMAIS, MATERIAS).atencao, [])
  })

  it('mas risco de matéria-prima continua aparecendo', () => {
    const a: Atendimento = {
      especie: 'bovinos', fase: 'confinamento', quantidade: 500, sistema: null,
      produto: null, materias: ['silagem-volumoso'], consumoConfirmado: false,
    }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.ok(
      r.atencao.some(x => x.nivel === 'incompativel' && /Silagem/.test(x.texto)),
      'silagem incompatível é o defeito nº 1 da auditoria — não pode sumir junto',
    )
    assert.ok(!r.atencao.some(x => /Sem todos os dados/.test(x.texto)))
  })

  it('a capacidade continua explicando por que não fechou', () => {
    // O texto saiu de `atencao`, mas segue vivo onde responde a uma pergunta.
    const a: Atendimento = {
      especie: 'bovinos', fase: 'confinamento', quantidade: 500, sistema: null,
      produto: null, materias: [], consumoConfirmado: false,
    }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.equal(r.podeFecharEquipamento, false)
    assert.match(r.capacidadeNota ?? '', /Sem todos os dados/)
  })
})

// ---------------------------------------------------------------------------
// "Produto desejado" não entrava em conta nenhuma. O consumo de catálogo é de
// RAÇÃO COMPLETA; pedir mineral com ele multiplicava a necessidade por até 99.
// ---------------------------------------------------------------------------
describe('o produto pedido tem que bater com o consumo em uso', () => {
  const bov = (o: Partial<Atendimento> = {}): Atendimento => ({
    especie: 'bovinos', fase: 'confinamento', quantidade: 500, sistema: null,
    produto: null, materias: [], consumoConfirmado: true, ...o,
  })

  it('mineral com consumo de ração completa NÃO fecha equipamento', () => {
    // 500 × 297 kg/mês = 148.500 kg/mês de "sal mineral". Proteinado nessa
    // boiada é da ordem de 15.000; mineral, de 1.500.
    const r = analisar(bov({ produto: 'Sal mineral / proteinado' }), ANIMAIS, MATERIAS)
    assert.equal(r.podeFecharEquipamento, false)
    assert.ok(r.atencao.some(x => /RAÇÃO COMPLETA/.test(x.texto)))
    assert.ok(r.faltando.some(x => /Consumo de sal mineral/i.test(x)))
  })

  it('ração farelada completa fecha normalmente', () => {
    const r = analisar(bov({ produto: 'Ração farelada completa' }), ANIMAIS, MATERIAS)
    assert.equal(r.podeFecharEquipamento, true)
    assert.ok(!r.atencao.some(x => /RAÇÃO COMPLETA/.test(x.texto)))
  })

  it('com o consumo digitado pelo vendedor, o número é do produtor e vale', () => {
    // 3 kg/cabeça/mês de mineral é coisa que o cliente disse. Não travar.
    const r = analisar(
      bov({ produto: 'Sal mineral / proteinado', consumoKgAnimalMes: 3 }),
      ANIMAIS, MATERIAS,
    )
    assert.equal(r.podeFecharEquipamento, true)
    assert.equal(r.necessidadeMesKg, 1500)
  })

  it('no modo VENDA a tonelagem é palavra do cliente, seja qual for o produto', () => {
    const r = analisar(
      bov({ modo: 'volume', volumeMesKg: 40_000, produto: 'Concentrado', quantidade: null }),
      ANIMAIS, MATERIAS,
    )
    assert.equal(r.podeFecharEquipamento, true)
  })
})

describe('o mostrador nomeia o que TRAVA, não o primeiro item da lista', () => {
  it('com mineral travando, aponta o consumo do produto e não as matérias-primas', () => {
    // `faltando` traz "Matérias-primas..." antes do consumo do produto. O
    // mostrador apontava a matéria-prima, que não trava equipamento nenhum.
    const a: Atendimento = {
      especie: 'bovinos', fase: 'confinamento', quantidade: 500, sistema: null,
      produto: 'Sal mineral / proteinado', materias: [], consumoConfirmado: true,
    }
    const r = analisar(a, ANIMAIS, MATERIAS)
    assert.equal(r.podeFecharEquipamento, false)
    assert.ok(/mat[ée]ria/i.test(r.faltando[0]), 'a lista continua na ordem do checklist')
    assert.match(r.bloqueioEquipamento ?? '', /consumo de sal mineral/i)
  })

  it('sem confirmar o consumo, é isso que trava', () => {
    const a: Atendimento = {
      especie: 'bovinos', fase: 'confinamento', quantidade: 500, sistema: null,
      produto: 'Ração farelada completa', materias: ['milho'], consumoConfirmado: false,
    }
    assert.match(analisar(a, ANIMAIS, MATERIAS).bloqueioEquipamento ?? '', /confirmar o consumo/i)
  })

  it('liberado, não há bloqueio a nomear', () => {
    const a: Atendimento = {
      especie: 'bovinos', fase: 'confinamento', quantidade: 500, sistema: null,
      produto: 'Ração farelada completa', materias: [], consumoConfirmado: true,
    }
    assert.equal(analisar(a, ANIMAIS, MATERIAS).bloqueioEquipamento, null)
  })
})

describe('a tela sabe quando está mostrando repertório, não resposta', () => {
  const bov = (o: Partial<Atendimento> = {}): Atendimento => ({
    especie: 'bovinos', fase: null, quantidade: 500, sistema: null,
    produto: null, materias: [], consumoConfirmado: false, ...o,
  })
  const CONFINAMENTO2 = animal({
    slug: 'bov-corte-engorda', nome: 'Corte — Engorda', especie: 'bovinos',
    tipo: 'categoria', fases: ['engorda'], sistemas: ['pasto'],
    processo: 'Mistura seca em pasto.', perguntas: ['Quantos litros por vaca por dia?'],
    resumo: 'Engorda a pasto.',
  })
  const LISTA = [CONFINAMENTO, CONFINAMENTO2, NELORE, POSTURA]

  it('sem fase, o processo e as perguntas são a UNIÃO de todas as categorias', () => {
    // `casaFase` devolve true pra todo mundo quando `a.fase` é null — então a
    // queda "todas as categorias" nem chega a rodar, e mesmo assim a lista sai
    // misturada. Foi por isso que checar a queda não detectava nada.
    const r = analisar(bov(), LISTA, MATERIAS)
    assert.equal(r.baseAmpla, true)
    assert.ok(r.processo.length > 1, 'mais de um processo = repertório, não resposta')
  })

  it('com a fase marcada, estreita e para de avisar', () => {
    const r = analisar(bov({ fase: 'confinamento' }), LISTA, MATERIAS)
    assert.equal(r.baseAmpla, false)
    assert.equal(r.processo.length, 1)
  })
})
