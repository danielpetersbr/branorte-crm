// ═══════════════════════════════════════════════════════════════════════════
// MOTOR DE UM ITEM DE `precos_branorte`
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE ESTE ARQUIVO EXISTE:
// O preço de `precos_branorte` NEM SEMPRE é o preço da máquina. Em parte do
// catálogo o motor é vendido À PARTE e vira uma linha separada no orçamento —
// o Moinho Martelo BNMM7100 custa R$ 141.499,60 na coluna "Equipamento", mas
// o motor de 100 CV que ele exige custa R$ 49.826 e sai por fora. A máquina
// real é R$ 191.325,60. Quem cota olhando só a coluna de equipamento erra
// R$ 49 mil.
//
// O orçamento (OrcamentoMontar) já fazia essa conta certo, mas a lógica morava
// dentro da página. Este módulo é a FONTE ÚNICA: a página de orçamento importa
// daqui, a tabela de preços importa daqui. Uma regra só, um lugar só.
//
// ⚠️ Este módulo é PURO (sem React, sem supabase) pra poder ser testado.

import {
  recomendarMotorChupim,
  type InclinacaoChupim,
  type MaterialChupim,
} from './calcChupim'

export type VoltagemMotor = 'monofasico' | 'trifasico'

/** Forma mínima de uma linha de `catalogo_motores`. */
export interface MotorCatalogoBase {
  cv: number
  polos: number
  voltagem: string
  valor: number
}

/** Forma mínima de uma linha de `precos_branorte` usada aqui.
 *  ⚠️ `motor_cv`/`valor_*` chegam do PostgREST como STRING (colunas numeric).
 *  Por isso todo consumo passa por Number() — somar direto concatenaria texto. */
export interface PrecoComMotor {
  categoria: string
  subcategoria: string | null
  descricao: string
  capacidade: string | null
  motor_cv: number | null
  motor_polos: number | null
  valor_equipamento: number | null
  valor_com_motor_trif: number | null
  valor_com_motor_mono: number | null
}

// ─── acharMotorCompativel ──────────────────────────────────────────────────
// (movido de hooks/useCatalogo.ts — useCatalogo re-exporta pra não quebrar
//  quem já importava de lá)
//
// Acha o motor compatível mais próximo do CV/polos de um item.
// strictVoltagem: quando true, NUNCA cruza voltagem — se não houver motor na
// voltagem pedida, retorna null em vez de pegar o de outra voltagem. Usado pra
// cotação monofásica: motor que só existe em trifásico (ex: 6 CV) NÃO pode ser
// cobrado com o preço trifásico (mais barato) silenciosamente — o vendedor
// precisa ver "sem motor cadastrado / a confirmar" em vez de subcobrar.
export function acharMotorCompativel<M extends MotorCatalogoBase>(
  motores: M[],
  cv: number,
  polos: number,
  voltagem: VoltagemMotor,
  strictVoltagem = false,
): M | null {
  // 1) match exato
  const exato = motores.find(m =>
    Number(m.cv) === cv && m.polos === polos && m.voltagem === voltagem,
  )
  if (exato) return exato
  if (strictVoltagem) {
    // Não cruza voltagem: só aceita mesmo cv na MESMA voltagem (polos pode variar).
    return motores.find(m => Number(m.cv) === cv && m.voltagem === voltagem) ?? null
  }
  // 2) match cv+polos (qualquer voltagem)
  const cvPolos = motores.find(m => Number(m.cv) === cv && m.polos === polos)
  if (cvPolos) return cvPolos
  // 3) só cv (qualquer polos+voltagem)
  const soCv = motores.find(m => Number(m.cv) === cv)
  if (soCv) return soCv
  return null
}

// ─── valorPorVoltagem ──────────────────────────────────────────────────────
// (movido de pages/OrcamentoMontar.tsx — a página passou a importar daqui)
//
// Escolhe o valor do equipamento conforme a voltagem.
// Quando precos_branorte tem valor_com_motor_trif/mono, esse valor JÁ INCLUI o
// motor — então motor_valor_unit deve virar 0 pra não cobrar 2x. Se a coluna
// voltagem-specific não existir/for zero, faz fallback pro valor_equipamento
// (motor cobrado à parte).
//
// ⚠️ ESTA É A FORMA CANÔNICA DE DETECTAR "MOTOR INCLUSO" POR ITEM.
export function valorPorVoltagem(
  p: { valor_equipamento: number | null; valor_com_motor_trif: number | null; valor_com_motor_mono: number | null },
  voltagemEfetiva: VoltagemMotor,
): { valor: number; motorIncluso: boolean } {
  const trifV = p.valor_com_motor_trif != null ? Number(p.valor_com_motor_trif) : null
  const monoV = p.valor_com_motor_mono != null ? Number(p.valor_com_motor_mono) : null
  const equipV = p.valor_equipamento != null ? Number(p.valor_equipamento) : 0
  if (voltagemEfetiva === 'trifasico' && trifV != null && trifV > 0) {
    return { valor: trifV, motorIncluso: true }
  }
  if (voltagemEfetiva === 'monofasico' && monoV != null && monoV > 0) {
    return { valor: monoV, motorIncluso: true }
  }
  return { valor: equipV, motorIncluso: false }
}

// ═══════════════════════════════════════════════════════════════════════════
// REGRA DE DOMÍNIO — quem cobra o motor à parte
// ═══════════════════════════════════════════════════════════════════════════
//
// ⚠️ NÃO INVERTA ESTA LISTA. Somar motor em quem já tem motor no preço
// SUPERFATURA; não somar em quem cobra à parte SUBFATURA. Os dois erram, e o
// segundo é o que está acontecendo hoje na tela de preços.
//
// A lista é a autoridade sobre QUEM é avulso. `valorPorVoltagem` é a
// autoridade sobre o ITEM: mesmo dentro de um grupo avulso, se aquela linha
// específica tiver `valor_com_motor_trif/mono` preenchido, o motor já está no
// preço e NÃO se soma nada. As duas travas valem juntas (E, não OU).

/** Motor vira linha separada no orçamento — cobra à parte. */
export const MOTOR_AVULSO: ReadonlySet<string> = new Set([
  'MOINHO/MARTELO',
  'TRANSPORTADOR/CHUPIM',
  'MISTURADOR/VERTICAL',
])

/** Equipamento que não tem motor nenhum — não há o que somar nem que avisar. */
export const SEM_MOTOR: ReadonlySet<string> = new Set([
  'CAIXA',
  'SILO',
  'PAINEL_ELETRICO',
  'BALANCA',
  'HELICOIDE',
  'ACESSORIO',
  'PASSARELA',
  'SUPORTE_BAG',
  'DESCARGA',
])

/** Pacote fechado com 6 a 8 motores. `motor_cv` é NULL nas 34 linhas: não há
 *  como somar sem inventar. Declara-se incalculável, não se chuta. */
export const MULTI_MOTOR: ReadonlySet<string> = new Set(['COMPACTA'])

export type ClasseMotor = 'AVULSO' | 'INCLUSO' | 'SEM_MOTOR' | 'MULTI_MOTOR'

export function chaveMotor(categoria: string, subcategoria: string | null): string {
  return subcategoria ? `${categoria}/${subcategoria}` : categoria
}

export function classeDeMotor(categoria: string, subcategoria: string | null): ClasseMotor {
  if (MULTI_MOTOR.has(categoria)) return 'MULTI_MOTOR'
  if (SEM_MOTOR.has(categoria)) return 'SEM_MOTOR'
  if (MOTOR_AVULSO.has(chaveMotor(categoria, subcategoria))) return 'AVULSO'
  return 'INCLUSO'
}

// ─── CHUPIM ────────────────────────────────────────────────────────────────
// ⚠️ Pro chupim o `motor_cv` do banco é DESCARTADO pelo orçamento e substituído
// pela fórmula oficial (POT=(C+(Q×L×K)/200)×b×1,36), arredondada pro próximo
// motor maior — ver OrcamentoMontar, bloco "CHUPIM: aplica fórmula oficial".
// Mostrar o motor do chupim usando `motor_cv` daria um número DIFERENTE do que
// o orçamento cobra. Então aqui se usa a MESMA fórmula, com os MESMOS defaults
// da sessão de orçamento, e o resultado sai marcado como estimativa: material
// e inclinação são escolha do vendedor por item, e mudam o CV.
export const CHUPIM_MATERIAL_PADRAO: MaterialChupim = 'MILHO'
export const CHUPIM_INCLINACAO_PADRAO: InclinacaoChupim = 45
/** Default de polos do orçamento quando `motor_polos` é NULL (e sempre, no chupim). */
export const POLOS_PADRAO = 4

export interface MotorResolvido {
  cv: number
  polos: number
  voltagem: string
  valor: number
}

export type MotorDoPreco =
  /** Motor já está dentro do preço do equipamento — não somar nada. */
  | { tipo: 'INCLUSO'; valorEquipamento: number }
  /** Equipamento sem motor. */
  | { tipo: 'SEM_MOTOR'; valorEquipamento: number }
  /** Sabe-se que tem motor à parte, mas não dá pra calcular. NUNCA vira soma. */
  | { tipo: 'INDETERMINADO'; valorEquipamento: number; motivo: string }
  /** Motor à parte, CV conhecido. `motor` null = não achado no catálogo:
   *  `total` fica null de propósito — somar 0 e chamar de total é o defeito
   *  que este módulo existe pra impedir. */
  | {
      tipo: 'AVULSO'
      valorEquipamento: number
      cv: number
      polos: number
      /** true = CV veio da fórmula do chupim (muda com material/inclinação),
       *  não da coluna `motor_cv` da planilha. */
      estimado: boolean
      motor: MotorResolvido | null
      total: number | null
    }

/**
 * Decide o que a tela deve mostrar de motor para uma linha de `precos_branorte`.
 *
 * Reproduz o que o orçamento cobra:
 *   valor do item = valorPorVoltagem(p).valor + (motor à parte ? motor.valor : 0)
 *
 * @param voltagem trifásico é o default comercial; monofásico existe e o
 *   catálogo só tem motor mono até 15 CV — acima disso o resultado sai com
 *   `motor: null` (strictVoltagem), que é o correto: subcobrar o preço
 *   trifásico num pedido monofásico é pior que avisar que falta cadastro.
 */
export function motorDoPreco(
  p: PrecoComMotor,
  motores: MotorCatalogoBase[],
  voltagem: VoltagemMotor = 'trifasico',
): MotorDoPreco {
  const { valor: valorEquipamento, motorIncluso } = valorPorVoltagem(p, voltagem)
  const classe = classeDeMotor(p.categoria, p.subcategoria)

  if (classe === 'SEM_MOTOR') return { tipo: 'SEM_MOTOR', valorEquipamento }
  if (classe === 'MULTI_MOTOR') {
    return {
      tipo: 'INDETERMINADO',
      valorEquipamento,
      motivo: 'pacote com 6 a 8 motores — soma depende da configuração',
    }
  }
  if (classe === 'INCLUSO') return { tipo: 'INCLUSO', valorEquipamento }

  // AVULSO pela categoria — mas a linha ainda pode ter preço com motor cadastrado.
  if (motorIncluso) return { tipo: 'INCLUSO', valorEquipamento }

  const ehChupim = chaveMotor(p.categoria, p.subcategoria) === 'TRANSPORTADOR/CHUPIM'
  let cv: number | null
  let polos: number
  let estimado: boolean

  if (ehChupim) {
    const rec = recomendarMotorChupim(
      p.descricao, p.capacidade, CHUPIM_MATERIAL_PADRAO, CHUPIM_INCLINACAO_PADRAO,
    )
    if (!rec) {
      return {
        tipo: 'INDETERMINADO',
        valorEquipamento,
        motivo: 'não deu pra ler comprimento/capacidade pra calcular o motor',
      }
    }
    cv = rec.cvMotor
    polos = POLOS_PADRAO // o orçamento usa 4 no default, em trif e em mono
    estimado = true
  } else {
    cv = p.motor_cv != null ? Number(p.motor_cv) : null
    polos = p.motor_polos ?? POLOS_PADRAO
    estimado = false
  }

  if (cv == null || !isFinite(cv) || cv <= 0) {
    return { tipo: 'INDETERMINADO', valorEquipamento, motivo: 'item sem potência de motor cadastrada' }
  }

  const achado = acharMotorCompativel(motores, cv, polos, voltagem, voltagem === 'monofasico')
  const motor: MotorResolvido | null = achado
    ? { cv: Number(achado.cv), polos: achado.polos, voltagem: achado.voltagem, valor: Number(achado.valor) }
    : null

  return {
    tipo: 'AVULSO',
    valorEquipamento,
    cv,
    polos,
    estimado,
    motor,
    total: motor ? valorEquipamento + motor.valor : null,
  }
}
