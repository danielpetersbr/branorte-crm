/**
 * SEGURANÇA POR ESPÉCIE — o que NÃO pode entrar, e por quê.
 *
 * Esta camada é deliberadamente independente da composição. Bloquear ureia numa
 * fórmula de ave funciona pela IDENTIDADE do ingrediente, não pelos nutrientes
 * dele: mesmo com o perfil vazio o sistema reconhece "Ureia" e barra. Foi por
 * isso que ureia, sulfato de amônia e silagem estão cadastrados em
 * `ingredientes.ts` sem nenhum número — sem o cadastro seriam invisíveis, e o
 * invisível não é bloqueado.
 *
 * A DIFERENÇA ENTRE BLOQUEIO E LIMITE
 * Bloqueio é binário e não tem dosagem segura: ureia em monogástrico vira amônia
 * no sangue porque não existe rúmen pra convertê-la. Limite é quantitativo: DDG
 * em bovino é bom até 20% da matéria seca e perigoso acima. Tratar os dois com o
 * mesmo componente de tela ensinaria o vendedor a achar que basta "usar pouco".
 *
 * O QUE ESTA CAMADA NÃO FAZ
 * Não impede o vendedor de digitar o que quiser. Ele digita, e o sistema mostra
 * o bloqueio em vermelho e marca a fórmula como não validável. Travar a digitação
 * empurraria o caso pro papel, fora do sistema — e aí ninguém vê o alerta.
 */
import type { Especie, IngredienteFormula } from '@/lib/venda-racao/tipos'
import { acharIngrediente, type IngredienteNutricional, type LimiteInclusao } from './ingredientes'

export type NivelAlerta =
  /** Não pode. Impede marcar a fórmula como validada. */
  | 'bloqueio'
  /** Pode, mas há teto, risco ou exigência de análise. */
  | 'atencao'
  /** Falta dado. Não é erro do vendedor, é lacuna do banco. */
  | 'lacuna'

export interface AlertaSeguranca {
  nivel: NivelAlerta
  /** id do item da fórmula a que se refere, quando aplicável. */
  itemId?: string
  ingrediente: string
  titulo: string
  detalhe: string
  /** De onde vem a regra. Vazio só quando é lacuna de cadastro. */
  fonte?: string
}

/** Participação do item em % da fórmula, seja qual for a unidade digitada. */
function pctDe(i: IngredienteFormula): number {
  if (i.unidadeParticipacao === 'pct') return i.participacao
  if (i.unidadeParticipacao === 'kg_t') return i.participacao / 10
  return i.participacao / 10000 // g_t
}

/** O limite que se aplica a esta espécie, se houver. */
export function limitePara(ing: IngredienteNutricional, especie: Especie): LimiteInclusao | null {
  return ing.limites?.find(l => !l.especies?.length || l.especies.includes(especie)) ?? null
}

/**
 * Varre a fórmula e devolve tudo que precisa ser dito antes de alguém usar
 * aquilo numa fazenda.
 *
 * Ordem do retorno: bloqueios primeiro, depois atenção, depois lacunas. Quem
 * renderiza não precisa reordenar, e o pior aparece no topo.
 */
export function verificarSeguranca(
  itens: IngredienteFormula[], especie: Especie,
): AlertaSeguranca[] {
  const bloqueios: AlertaSeguranca[] = []
  const atencoes: AlertaSeguranca[] = []
  const lacunas: AlertaSeguranca[] = []

  for (const item of itens) {
    const nome = (item.nome || '').trim()
    if (!nome) continue

    const ing = acharIngrediente(nome)

    // Ingrediente que o banco não conhece: não dá pra afirmar nada sobre ele.
    if (!ing) {
      lacunas.push({
        nivel: 'lacuna', itemId: item.id, ingrediente: nome,
        titulo: 'Ingrediente não cadastrado',
        detalhe:
          `"${nome}" não está no banco de matérias-primas. O sistema não sabe a composição nem as `
          + 'restrições dele, então ele não entra na análise nutricional e nenhuma regra de segurança '
          + 'é aplicada. Confira com o responsável técnico.',
      })
      continue
    }

    // 1) Bloqueio por espécie.
    if (ing.proibidoPara?.includes(especie)) {
      bloqueios.push({
        nivel: 'bloqueio', itemId: item.id, ingrediente: ing.nome,
        titulo: `${ing.nome} não pode entrar em fórmula de ${nomeEspecie(especie)}`,
        detalhe: ing.motivoProibicao ?? 'Ingrediente incompatível com esta espécie.',
        fonte: ing.fontes[0]?.ref,
      })
      continue // bloqueado é bloqueado; teto e alerta viram ruído
    }

    // 2) Teto de inclusão.
    const limite = limitePara(ing, especie)
    if (limite) {
      const pct = pctDe(item)
      if (limite.base === 'formula' && pct > limite.max) {
        atencoes.push({
          nivel: 'atencao', itemId: item.id, ingrediente: ing.nome,
          titulo: `${ing.nome} acima do limite: ${pct.toFixed(1)}% (teto ${limite.max}% da fórmula)`,
          detalhe: limite.motivo, fonte: limite.fonte,
        })
      } else if (limite.base === 'dieta_ms') {
        // Teto sobre a DIETA TOTAL. A tela monta só o concentrado e não sabe
        // quanto de volumoso o animal come — afirmar que X% da fórmula são X%
        // da dieta seria inventar. Vira aviso, nunca comparação.
        atencoes.push({
          nivel: 'atencao', itemId: item.id, ingrediente: ing.nome,
          titulo: `${ing.nome} tem teto de ${limite.max}% da DIETA TOTAL em matéria seca`,
          detalhe:
            `${limite.motivo} Esta tela monta o CONCENTRADO e não enxerga o volumoso, então não dá pra `
            + `converter o teto em % da fórmula. Os ${pct.toFixed(1)}% aqui não são comparáveis com os `
            + `${limite.max}% do limite — confira a dieta completa com o zootecnista.`,
          fonte: limite.fonte,
        })
      }
    }

    // 3) Ressalva técnica permanente do ingrediente.
    if (ing.alerta) {
      atencoes.push({
        nivel: 'atencao', itemId: item.id, ingrediente: ing.nome,
        titulo: `${ing.nome} — ressalva técnica`,
        detalhe: ing.alerta, fonte: ing.fontes[0]?.ref,
      })
    }

    // 4) Lote varia demais pra confiar na média da tabela.
    if (ing.exigeAnalise) {
      lacunas.push({
        nivel: 'lacuna', itemId: item.id, ingrediente: ing.nome,
        titulo: `${ing.nome} exige análise do lote`,
        detalhe:
          'A composição deste ingrediente varia de lote para lote além do que uma tabela consegue '
          + 'representar. O número usado aqui é média de levantamento, não o do produto do cliente.',
      })
    }
  }

  return [...bloqueios, ...atencoes, ...lacunas]
}

/** true quando existe pelo menos um bloqueio — a fórmula não pode ser validada. */
export function temBloqueio(alertas: AlertaSeguranca[]): boolean {
  return alertas.some(a => a.nivel === 'bloqueio')
}

function nomeEspecie(e: Especie): string {
  return e === 'bovinos' ? 'bovinos' : e === 'suinos' ? 'suínos' : e === 'aves' ? 'aves' : e
}
