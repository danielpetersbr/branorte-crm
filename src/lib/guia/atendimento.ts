/**
 * Modo ATENDIMENTO RÁPIDO — motor.
 *
 * O vendedor está no telefone. Ele marca o que já sabe; a função devolve o que
 * AINDA FALTA perguntar, o consumo de referência, a necessidade mensal, os
 * pontos de atenção e uma capacidade para ANÁLISE.
 *
 * Regra que não se quebra: `podeFecharEquipamento` só é true com espécie, fase
 * e quantidade preenchidas E consumo confirmado com o cliente. Sem isso,
 * devolve capacidade como "para analisar" e nunca como recomendação fechada —
 * é a mesma disciplina de `retorno.aplicavel` em /producao-propria.
 *
 * Função pura: sem React, sem banco. Testada em atendimento.test.ts.
 */
import { CAPACIDADES_BRANORTE, CATEGORIAS } from '../venda-racao/catalogo'
import type { Especie as EspecieEstudo } from '../venda-racao/tipos'
import type {
  Atendimento, Especie, GuiaAnimal, GuiaMateria, NivelRisco, ResultadoAtendimento,
} from './tipos'

/** O estudo só conhece 4 espécies; ovino e caprino ainda não têm catálogo lá. */
export function especieDoEstudo(e: Especie | null): EspecieEstudo | null {
  if (e === 'bovinos' || e === 'suinos' || e === 'aves') return e
  return null
}

export function consumoDeReferencia(especie: Especie | null, fase: string | null): number | null {
  const ee = especieDoEstudo(especie)
  if (!ee || !fase) return null
  const cat = CATEGORIAS[ee]?.find(c => c.chave === fase)
  if (!cat || !cat.consumoMes) return null
  return cat.consumoMes
}

/**
 * Menor capacidade da linha que atende a necessidade dentro das horas
 * disponíveis, com folga. Devolve null quando não dá pra calcular.
 */
export function capacidadeParaAnalise(
  necessidadeMesKg: number | null,
  diasMes = 26,
  horasDia = 8,
  aproveitamento = 0.8,
): { kgH: number | null; nota: string | null } {
  if (!necessidadeMesKg || necessidadeMesKg <= 0) return { kgH: null, nota: null }
  const horasMes = diasMes * horasDia * aproveitamento
  const exigido = necessidadeMesKg / horasMes
  const escolhida = CAPACIDADES_BRANORTE.find(c => c >= exigido) ?? null
  if (!escolhida) {
    return {
      kgH: null,
      nota: `A necessidade (${Math.round(exigido)} kg/h) passa da maior capacidade da linha `
        + `(${CAPACIDADES_BRANORTE[CAPACIDADES_BRANORTE.length - 1]} kg/h). Levar à engenharia.`,
    }
  }
  const ocupacao = exigido / escolhida
  const nota = ocupacao > 0.85
    ? `Com ${escolhida} kg/h a linha roda a ${Math.round(ocupacao * 100)}% do tempo disponível — `
      + 'perto do limite. Vale considerar a capacidade seguinte.'
    : `Necessidade estimada de ${Math.round(exigido)} kg/h considerando ${diasMes} dias × ${horasDia} h `
      + `com ${Math.round(aproveitamento * 100)}% de aproveitamento.`
  return { kgH: escolhida, nota }
}

const AVISO_SEM_DADOS =
  'Sem todos os dados não dá pra fechar equipamento. O que está abaixo é ponto de partida para a conversa.'

export function analisar(
  a: Atendimento,
  animais: GuiaAnimal[],
  materias: GuiaMateria[],
): ResultadoAtendimento {
  const modo = a.modo ?? 'rebanho'
  const faltando: string[] = []
  if (!a.especie) faltando.push('Espécie')
  if (!a.fase) faltando.push('Fase ou sistema de criação')
  if (modo === 'volume') {
    // Vendendo ração não existe rebanho, e o volume JÁ é o número final: pedir
    // "confirme o consumo" seria pedir pra confirmar o que ele acabou de digitar.
    if (!a.volumeMesKg || a.volumeMesKg <= 0) faltando.push('Volume mensal de ração')
  } else {
    if (!a.quantidade || a.quantidade <= 0) faltando.push('Quantidade de animais')
    if (!a.consumoConfirmado) faltando.push('Confirmação do consumo com o cliente')
  }
  if (!a.produto) faltando.push('Produto desejado (ração, concentrado, mineral, milho triturado)')
  if (!a.materias.length) faltando.push('Matérias-primas que o cliente já tem')

  // Categorias da espécie: as que casam com a fase escolhida, ou todas da espécie.
  const daEspecie = animais.filter(x => x.especie === a.especie)
  const casaFase = (x: GuiaAnimal) => !a.fase || x.fases.includes(a.fase) || x.fase_estudo === a.fase
  const casaSistema = (x: GuiaAnimal) => !a.sistema || x.sistemas.includes(a.sistema)
  const categorias = daEspecie.filter(x => x.tipo === 'categoria' && casaFase(x) && casaSistema(x))
  const base = categorias.length ? categorias : daEspecie.filter(x => x.tipo === 'categoria')

  // Perguntas ainda não respondidas: as das categorias que casam, sem repetir.
  const perguntas = Array.from(new Set(base.flatMap(x => x.perguntas)))

  // O consumo do CLIENTE ganha do de catálogo. O de catálogo é média de tabela;
  // o produtor sabe o dele, e a diferença multiplica pelo rebanho inteiro —
  // 20 kg a mais em 500 cabeças são 10 t/mês de fábrica a mais.
  const consumoCatalogo = consumoDeReferencia(a.especie, a.fase)
  const consumoInformado = a.consumoKgAnimalMes && a.consumoKgAnimalMes > 0
    ? a.consumoKgAnimalMes : null
  const consumoMesKg = consumoInformado ?? consumoCatalogo

  // Quem VENDE ração informa a tonelagem direto: não há rebanho pra multiplicar.
  const necessidadeMesKg = a.modo === 'volume'
    ? (a.volumeMesKg && a.volumeMesKg > 0 ? a.volumeMesKg : null)
    : (consumoMesKg && a.quantidade ? consumoMesKg * a.quantidade : null)

  // Processo provável: união do que as categorias dizem.
  const processo = Array.from(new Set(base.map(x => x.processo).filter(Boolean))) as string[]

  // Equipamentos: união das categorias + os exigidos pelas matérias marcadas.
  const escolhidas = materias.filter(m => a.materias.includes(m.slug))
  const equipamentos = Array.from(new Set([
    ...base.flatMap(x => x.equipamentos),
    ...escolhidas.flatMap(m => m.equipamentos),
  ]))

  // ---------------------------------------------------------------------
  // Pontos de atenção. Vêm das matérias marcadas — é aqui que o guia deixa
  // de ser enciclopédia e vira ferramenta: o vendedor marcou "silagem" e a
  // tela responde "isso não entra na fábrica farelada".
  // ---------------------------------------------------------------------
  const atencao: Array<{ nivel: NivelRisco; texto: string }> = []

  for (const m of escolhidas) {
    if (m.compat_branorte === 'incompativel') {
      atencao.push({
        nivel: 'incompativel',
        texto: `${m.nome}: não entra na fábrica farelada. ${m.compat_motivo ?? ''}`.trim(),
      })
    } else if (m.nivel_risco === 'alto_risco') {
      atencao.push({ nivel: 'alto_risco', texto: `${m.nome}: ${m.alerta ?? 'alto risco.'}` })
    } else if (m.compat_branorte === 'ressalva' && m.compat_motivo) {
      atencao.push({ nivel: 'atencao', texto: `${m.nome}: ${m.compat_motivo}` })
    }
    if (m.corrosivo) {
      atencao.push({ nivel: 'atencao', texto: `${m.nome} é corrosivo — combinar rotina de limpeza com o cliente.` })
    }
    if (m.microingrediente || m.exige_pre_mistura) {
      atencao.push({ nivel: 'atencao', texto: `${m.nome} entra em dose pequena — exige pré-mistura e balança com resolução compatível.` })
    }
  }

  // Restrição de espécie: o ingrediente marcado não serve pra espécie escolhida.
  if (a.especie) {
    for (const m of escolhidas) {
      if (m.especies.length && !m.especies.includes(a.especie)) {
        atencao.push({
          nivel: 'incompativel',
          texto: `${m.nome} NÃO é indicado para ${a.especie}. Conferir antes de compor a fórmula.`,
        })
      }
    }
  }

  // Restrições declaradas nas categorias da espécie/fase.
  for (const r of Array.from(new Set(base.flatMap(x => x.restricoes)))) {
    atencao.push({ nivel: 'atencao', texto: r })
  }

  if (faltando.length) atencao.unshift({ nivel: 'informacao', texto: AVISO_SEM_DADOS })

  const podeFecharEquipamento = modo === 'volume'
    ? !!a.especie && !!a.fase && !!a.volumeMesKg && a.volumeMesKg > 0
    : !!a.especie && !!a.fase && !!a.quantidade && a.quantidade > 0 && a.consumoConfirmado

  const { kgH, nota } = capacidadeParaAnalise(necessidadeMesKg)

  // Conteúdo relacionado: as matérias que essas categorias costumam usar.
  const slugsRelacionados = Array.from(new Set(base.flatMap(x => x.materias_comuns)))
  const relacionados = materias
    .filter(m => slugsRelacionados.includes(m.slug))
    .map(m => ({
      tipo: 'materia' as const, slug: m.slug, nome: m.nome, resumo: m.resumo,
      emoji: m.emoji, imagem_slug: m.imagem_slug, grupo: m.categoria,
      status: m.status, pendente_validacao: m.pendente_validacao,
      nivel_risco: m.nivel_risco, compat_branorte: m.compat_branorte,
    }))

  return {
    faltando,
    perguntas,
    consumoMesKg,
    necessidadeMesKg,
    processo,
    // Dedup por texto: categorias diferentes repetem a mesma restrição.
    atencao: atencao.filter((x, i, arr) => arr.findIndex(y => y.texto === x.texto) === i),
    capacidadeSugeridaKgH: podeFecharEquipamento ? kgH : null,
    capacidadeNota: podeFecharEquipamento ? nota : (necessidadeMesKg ? AVISO_SEM_DADOS : null),
    equipamentos,
    relacionados,
    podeFecharEquipamento,
  }
}

/** Texto que o vendedor copia e manda pro cliente ou pro grupo interno. */
export function resumoParaCopiar(a: Atendimento, r: ResultadoAtendimento, nomeFase: string): string {
  const L: string[] = ['*Levantamento — Guia do Vendedor Branorte*', '']
  if (a.especie) L.push(`Espécie: ${a.especie}`)
  if (nomeFase) L.push(`Fase/sistema: ${nomeFase}`)
  // O texto TEM que respeitar o modo. Ignorando, saía "Consumo de referência:
  // 3,4 kg/animal/mês" pra um cliente que VENDE ração e não tem animal — e, se
  // ele tivesse passado pelo modo rebanho antes, o "Quantidade: 20.000 animais"
  // ia junto, de um rebanho que não existe mais. Isso é texto que o vendedor
  // cola no WhatsApp do cliente.
  const vendendo = a.modo === 'volume'
  if (!vendendo && a.quantidade) L.push(`Quantidade: ${a.quantidade.toLocaleString('pt-BR')} animais`)
  if (a.produto) L.push(`Produto: ${a.produto}`)
  if (a.materias.length) L.push(`Matérias-primas: ${a.materias.join(', ')}`)
  if (!vendendo && r.consumoMesKg) {
    L.push(`Consumo${a.consumoKgAnimalMes ? ' informado' : ' de referência'}: ${r.consumoMesKg} kg/animal/mês`)
  }
  if (vendendo) L.push('Origem do volume: informado pelo cliente (venda de ração)')
  if (r.necessidadeMesKg) L.push(`Necessidade estimada: ${Math.round(r.necessidadeMesKg).toLocaleString('pt-BR')} kg/mês`)
  if (r.capacidadeSugeridaKgH) L.push(`Capacidade para análise: ${r.capacidadeSugeridaKgH} kg/h`)
  if (r.faltando.length) {
    L.push('', '*Ainda falta levantar:*', ...r.faltando.map(f => `- ${f}`))
  }
  const criticos = r.atencao.filter(x => x.nivel === 'incompativel' || x.nivel === 'alto_risco')
  if (criticos.length) {
    L.push('', '*Pontos de atenção:*', ...criticos.map(x => `- ${x.texto}`))
  }
  L.push('', 'Valores de referência. Consumo e formulação devem ser confirmados com o cliente e '
    + 'com profissional habilitado em nutrição animal.')
  return L.join('\n')
}
