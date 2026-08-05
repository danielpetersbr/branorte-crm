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

/**
 * Produtos cujo consumo NÃO é o consumo de ração completa.
 *
 * `CATEGORIAS[].consumoMes` é kg de RAÇÃO por animal/mês. O produto escolhido
 * não entrava em conta nenhuma: dava pra marcar "Confinamento" (297 kg/mês) com
 * produto "Sal mineral / proteinado" e a tela devolvia 148.500 kg/mês para 500
 * cabeças — quando proteinado nessa boiada é da ordem de 15.000 e mineral, de
 * 1.500. Erro de 10× a 99×, e o número ia pro texto que o vendedor cola no
 * WhatsApp do cliente.
 *
 * Não há tabela de consumo por produto aqui, e inventar uma seria pior que o
 * defeito. Então a tela faz o que já faz com o resto: PERGUNTA, e não fecha
 * equipamento até o vendedor trazer o número do cliente.
 */
const PRODUTOS_FORA_DA_RACAO = [
  'Concentrado', 'Sal mineral / proteinado', 'Milho triturado',
]

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
  // "Gado de corte" e "Gado de leite" NÃO são fases — são SUBGRUPOS, e o
  // seletor de fase os oferece junto com cria/recria/engorda porque vem de
  // `CATEGORIAS` (venda-racao), que é lista de PRODUTO, não de fase do guia.
  //
  // `gado_corte` não existe em `fases` nem em `fase_estudo` de NENHUMA das 12
  // categorias de bovino — casava com ZERO. E é a PRIMEIRA opção da lista, a
  // mais natural numa conversa de corte: escolhê-la derrubava o motor na queda
  // "todas as categorias da espécie" e despejava a união das 12, com pergunta
  // de leite ("Quantos litros por vaca por dia?") no meio da conversa de boi.
  // Medido em 05/08/2026: das 9 chaves de bovino, `gado_corte` era a única
  // órfã; aves e suínos não têm nenhuma.
  const SUBGRUPO_POR_FASE: Record<string, string> = { gado_corte: 'corte', gado_leite: 'leite' }
  const subgrupoEscolhido = a.fase ? SUBGRUPO_POR_FASE[a.fase] : undefined
  const casaFase = (x: GuiaAnimal) => subgrupoEscolhido
    ? x.subgrupo === subgrupoEscolhido
    : (!a.fase || x.fases.includes(a.fase) || x.fase_estudo === a.fase)
  const casaSistema = (x: GuiaAnimal) => !a.sistema || x.sistemas.includes(a.sistema)
  const categorias = daEspecie.filter(x => x.tipo === 'categoria' && casaFase(x) && casaSistema(x))
  const base = categorias.length ? categorias : daEspecie.filter(x => x.tipo === 'categoria')
  // A queda acima é o que gerava papel de parede: sem fase escolhida, `base`
  // vira TODAS as categorias da espécie, e processo/perguntas/restrições saem
  // como a UNIÃO de todas elas — 13 parágrafos de processo e "Quantos litros
  // por vaca por dia?" no meio de uma conversa de gado de corte. A tela precisa
  // saber que está nesse estado pra não vender a lista como se fosse específica.
  //
  // O sinal é `base.length > 1`, e NÃO "a queda disparou": sem fase escolhida,
  // `casaFase` devolve true pra todo mundo, então `categorias` já vem com as 12
  // e a queda nem chega a rodar. Medido na tela: 1 processo com a fase marcada,
  // 12 sem ela.
  const baseAmpla = base.length > 1

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

  // O consumo em uso é de RAÇÃO COMPLETA, mas o cliente pediu outro produto?
  // Só morde no modo rebanho (no modo volume a tonelagem é palavra do cliente,
  // seja qual for o produto) e só quando o número veio do CATÁLOGO — se o
  // vendedor digitou o consumo, o número é do produtor e vale.
  const produtoForaDaRacao =
    modo === 'rebanho'
    && !!a.produto
    && PRODUTOS_FORA_DA_RACAO.includes(a.produto)
    && consumoInformado === null
    && consumoCatalogo !== null

  if (produtoForaDaRacao) {
    faltando.push(`Consumo de ${a.produto!.toLowerCase()} por animal (o de catálogo é de ração completa)`)
    atencao.push({
      nivel: 'atencao',
      texto: `O cliente pediu ${a.produto}, e o consumo em uso (${consumoCatalogo} kg/animal/mês) `
        + 'é de RAÇÃO COMPLETA. Concentrado, mineral e proteinado entram em dose muito menor — '
        + 'perguntar quanto ele dá por cabeça e digitar no campo de consumo. Sem isso a necessidade '
        + 'mensal fica alta demais e o equipamento sai grande demais.',
    })
  }

  const podeFecharEquipamento = (modo === 'volume'
    ? !!a.especie && !!a.fase && !!a.volumeMesKg && a.volumeMesKg > 0
    : !!a.especie && !!a.fase && !!a.quantidade && a.quantidade > 0 && a.consumoConfirmado)
    // Fechar equipamento em cima de um consumo 10x a 99x maior que o real é o
    // dano exato que esta tela existe pra impedir.
    && !produtoForaDaRacao

  // Na MESMA ordem das condições acima, pro mostrador nomear o que de fato
  // segura — e não o primeiro item de uma lista que mistura as duas coisas.
  const bloqueioEquipamento = podeFecharEquipamento ? null
    : !a.especie ? 'a espécie'
    : !a.fase ? 'a fase ou o sistema de criação'
    : modo === 'volume' ? 'o volume mensal'
    : !a.quantidade ? 'a quantidade de animais'
    : !a.consumoConfirmado ? 'confirmar o consumo com o cliente'
    : produtoForaDaRacao ? `o consumo de ${a.produto!.toLowerCase()} por animal`
    : 'um dado'

  // AVISO_SEM_DADOS NÃO entra mais em `atencao`.
  //
  // Ele enchia "Pontos de atenção" com uma tarja azul em 100% das aberturas,
  // dizendo o que o mostrador já diz na linha de status ("Referência — falta
  // X"). Ponto de atenção é risco de matéria-prima e restrição de categoria —
  // coisa que muda a conversa. Um aviso que aparece sempre não é atenção, é
  // moldura. Continua vivo em `capacidadeNota`, que é onde ele responde a uma
  // pergunta específica.

  const { kgH, nota } = capacidadeParaAnalise(necessidadeMesKg)

  // O que a linha NÃO faz. Vem das MESMAS categorias que geram processo e
  // perguntas — não é texto fixo aqui: é o campo do banco, corrigido na
  // auditoria, finalmente lido no modo em que o vendedor está no telefone.
  const naoAtende = Array.from(new Set(base.flatMap(x => x.branorte?.nao_atende ?? [])))
  const promessasProibidas = Array.from(new Set(base.flatMap(x => x.promessas_proibidas ?? [])))

  // Basta UMA matéria pedir horizontal pra decidir a máquina toda.
  const indicados = escolhidas.map(m => m.misturador_indicado).filter(Boolean)
  const misturadorIndicado = indicados.includes('horizontal') ? 'horizontal' as const
    : indicados.includes('vertical') ? 'vertical' as const
    : null

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
    bloqueioEquipamento,
    baseAmpla,
    naoAtende,
    promessasProibidas,
    misturadorIndicado,
  }
}

/**
 * Texto que o vendedor copia e manda pro cliente ou pro grupo interno.
 *
 * `linha` é o que a TELA está mostrando: a produção por hora calculada com a
 * jornada que o vendedor ajustou, e o moinho que o catálogo devolveu pra ela.
 * Sem isso o texto saía com a `capacidadeSugeridaKgH`, que assume 26 dias × 8 h
 * × 80% CRAVADOS (`capacidadeParaAnalise`) — 166,4 h/mês contra as 208 h de uma
 * jornada 6 × 8. São 25% de diferença, dois degraus de moinho, e ia num texto
 * que o vendedor cola no WhatsApp do cliente.
 */
export function resumoParaCopiar(
  a: Atendimento,
  r: ResultadoAtendimento,
  nomeFase: string,
  linha?: { producaoKgH?: number | null; jornada?: string | null; moinho?: string | null },
): string {
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
  if (r.necessidadeMesKg) {
    // A tonelagem saía sem ressalva nenhuma. É o número que o cliente ANOTA —
    // e com o levantamento aberto ela é referência, não compromisso. Pior no
    // caso do mineral: o consumo em uso é de ração completa, e o texto ia pro
    // WhatsApp dele com uma necessidade até 99x maior que a real.
    L.push(`Necessidade estimada: ${Math.round(r.necessidadeMesKg).toLocaleString('pt-BR')} kg/mês`
      + (r.podeFecharEquipamento ? '' : ` (referência — falta ${r.bloqueioEquipamento})`))
  }
  if (linha?.producaoKgH) {
    L.push(`Produção necessária: ${Math.round(linha.producaoKgH).toLocaleString('pt-BR')} kg/h`
      + (linha.jornada ? ` (${linha.jornada})` : ''))
    // Modelo só sai no texto com o levantamento fechado — a mesma trava da tela.
    if (r.podeFecharEquipamento && linha.moinho) L.push(`Moinho para análise: ${linha.moinho}`)
  } else if (r.capacidadeSugeridaKgH) {
    L.push(`Capacidade para análise: ${r.capacidadeSugeridaKgH} kg/h`)
  }
  if (r.naoAtende.length) {
    L.push('', '*A linha Branorte NÃO faz:*', ...r.naoAtende.map(x => `- ${x}`))
  }
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
