import { useEffect, useMemo, useRef, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  Sparkles, Search, Plus, Minus, Trash2, Package,
  Zap, X, AlertCircle, Star, FileText, Eye, ListChecks, Check, Loader2, FolderOpen,
  Save, RotateCcw, ChevronRight, ChevronDown, RefreshCw,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  useCatalogoItems, useCatalogoMotores, useCatalogoAcessorios,
  agruparPorCategoria, acharMotorCompativel,
  type CatalogoItem, type CatalogoMotor, type CatalogoAcessorio, type MotorExtra,
} from '@/hooks/useCatalogo'
import { FinalizarMontarModal, type CarrinhoSnapshot } from '@/components/FinalizarMontarModal'
import { OrcamentoPreview, type ParcelaPagamento, type PreviewClienteDados } from '@/components/OrcamentoPreview'
import { ResponsiveScaler } from '@/components/ResponsiveScaler'
import { ClienteEditModal } from '@/components/ClienteEditModal'
import { useOrcamentoModelos, useOrcamentoGerado, type OrcamentoModelo, detectarBalancaDuplicada } from '@/hooks/useOrcamentoBuilder'
import { OrcamentoAIChat } from '@/components/orcamento/OrcamentoAIChat'
import { useSearchParams } from 'react-router-dom'
import { useOrcamentoDraft } from '@/hooks/useOrcamentoDraft'
import { useAuth } from '@/hooks/useAuth'
import { useVendors } from '@/hooks/useVendors'
import { usePrecosBranorte, type PrecoBranorte } from '@/hooks/usePrecosBranorte'
import {
  recomendarMotorChupim, FATOR_MATERIAL, FATOR_INCLINACAO,
  type MaterialChupim, type InclinacaoChupim,
} from '@/lib/calcChupim'
import { useTransportadorFuncoes, useCriarTransportadorFuncao, type TransportadorFuncao } from '@/hooks/useTransportadorFuncoes'

type Voltagem = 'monofasico' | 'trifasico'
type ModoVisao = 'preview' | 'edicao'

interface CarrinhoItem {
  uid: string
  catalogo_id: number
  categoria: string
  nome: string
  nome_custom?: string | null  // sobrescreve nome se vendedor editou inline
  specs: string[]
  qtd: number
  valor: number
  valor_original: number
  motor_cv: number | null
  motor_polos: number | null
  motor_qtd: number
  motor_valor_unit: number  // valor unitário do motor (não multiplicado)
  foto_url: string | null   // foto do equipamento (mostra no preview, igual orçamento real)
  /** Quando true, motor sempre cotado como trifásico (inversor faz mono = trif). */
  usa_inversor?: boolean
  /** Função escolhida pelo vendedor (alimentação/descarga/etc). */
  funcao_selecionada?: string | null
  /** Quando true, funcao_selecionada NÃO aparece no PDF (uso interno apenas). */
  ocultar_funcao_no_pdf?: boolean
  /** Material: undefined/null = galvanizado, '304' = Inox 304 (×2.5), '316' = Inox 316 (×3.5). */
  inox?: '304' | '316' | false
  /** Tungstênio: quando true, valor unitário do martelo = R$ 99. Só pra jogos de martelo. */
  tungstenio?: boolean
  /** Specs originais (antes de trocar pra inox/tungstenio) — pra poder restaurar ao desativar. */
  specs_original?: string[]
  /** Quando true, item é brinde (valor não entra no total, mostra "BRINDE" no preview). */
  brinde?: boolean
  /** Quando true, item é fornecido/comprado pelo CLIENTE (ex: caixa, estrutura própria).
   *  A Branorte não cobra: valor não entra no total e o preview mostra
   *  "por conta do cliente" em vez de um valor. */
  por_conta_cliente?: boolean
  /** Quando true, motor NÃO é cobrado pela Branorte — comprado pelo cliente.
   *  No preview a coluna de valor vira "por conta do cliente" (não "incluso"). */
  motor_por_conta_cliente?: boolean
  /** Issue #23: motor removido. Cliente não quer motor — Branorte vende só o equipamento.
   *  Quando true:
   *   - Motor não aparece na tabela MOTORES TRIFÁSICOS (agruparMotores pula).
   *   - Se motor estava incluso no valor (precos_branorte com valor_com_motor_*),
   *     o valor do item é recalculado pra valor_equipamento (sem motor).
   *   - Se motor era avulso, motor_valor_unit já é descartado pelo skip.
   *  valor_pre_remocao guarda o valor original do item antes da remoção (pra restaurar). */
  motor_removido?: boolean
  valor_pre_remocao?: number | null
  /** Multi-motor: "por conta do cliente" / "removido" POR motorIndex (em vez do item
   *  inteiro). motorIndex: 0/1 = motores do spec "X CV e Y CV"; 100+N = N-ésimo motor
   *  de motores_extras_snapshot. Os booleanos motor_por_conta_cliente/motor_removido
   *  seguem valendo pra item de motor ÚNICO (motorIndex undefined). */
  motores_por_conta_idx?: number[]
  motores_removidos_idx?: number[]
  /** Override MANUAL de "motor incluso" (vendedor marcou no modal Trocar Motor).
   *  Zera o valor do motor e mostra "incluso", mesmo quando a auto-detecção por spec
   *  não pegou. motor_incluso_manual = item de motor único; motores_incluso_idx = por
   *  motorIndex (multi-motor). */
  motor_incluso_manual?: boolean
  motores_incluso_idx?: number[]
  /** ID em precos_branorte (quando item veio de lá). Usado pra recalcular valor ao trocar voltagem. */
  preco_branorte_id?: number | null
  /** Snapshot dos motores extras do item de catálogo (multi-motor, ex: misturador c/ aquecimento).
   *  NÃO geram linha no carrinho — só entram em MOTORES TRIFÁSICOS / agruparMotores. */
  motores_extras_snapshot?: MotorExtra[]
}

type TensaoMotor = 220 | 380 | 660 | null

// Componente adicional NÃO fabricado pela Branorte (painel elétrico, balança, célula de carga…)
export interface ComponenteExtra {
  id: string
  nome: string
  valor: number
}

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.round(v))
}

// Escolhe o valor do equipamento conforme a voltagem.
// Quando precos_branorte tem valor_com_motor_trif/mono, esse valor JÁ INCLUI o motor —
// então motor_valor_unit deve virar 0 pra não cobrar 2x. Se a coluna voltagem-specific
// não existir/for zero, faz fallback pro valor_equipamento (motor cobrado à parte).
function valorPorVoltagem(
  p: { valor_equipamento: number | null; valor_com_motor_trif: number | null; valor_com_motor_mono: number | null },
  voltagemEfetiva: 'monofasico' | 'trifasico',
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

function formatBRLBare(v: number): string {
  const abs = Math.abs(Math.round(v))
  const fixed = abs.toFixed(2)
  const [intPart, dec] = fixed.split('.')
  const withDots = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${v < 0 ? '-' : ''}${withDots},${dec}`
}

// ─── Fallback de foto pra TRANSPORTADOR (chupim/calha TH) ─────────────────
// Mesma foto pra todos os comprimentos do mesmo diâmetro+tipo. Ex: chupim 160 x 1m
// e chupim 160 x 8m mostram a mesma imagem (só muda comprimento).
//
// Estratégia: ao montar a tela, extrai (diametro, sub) do nome de cada catalogo_item
// que TEM foto e cria um mapa "DIAM:SUB -> primeira_foto". Quando o vendedor olha
// um chupim sem linkagem específica, pega a foto da família.
type TransportadorSub = 'CHUPIM' | 'TH'
function detectarTransportador(nome: string): { diametro: string | null; sub: TransportadorSub | null } {
  const m = nome.match(/(\d{2,3})\s*[xX]/)
  const diametro = m ? m[1] : null
  // CALHA TH: nome contém "CALHA" ou "TH" antes do diâmetro
  const isCalha = /\bCALHA\b|\bTH\s+\d/i.test(nome)
  const sub: TransportadorSub | null = diametro ? (isCalha ? 'TH' : 'CHUPIM') : null
  return { diametro, sub }
}
function montarMapaFotosTransportador(catalogoItems: CatalogoItem[]): Map<string, string> {
  const m = new Map<string, string>()
  for (const ci of catalogoItems) {
    if (!ci.ativo || ci.categoria !== 'TRANSPORTADOR' || !ci.foto_url) continue
    const { diametro, sub } = detectarTransportador(ci.nome_curto)
    if (!diametro || !sub) continue
    const key = `${sub}:${diametro}`
    // Preferência: nomes "limpos" (sem "AMPLIAÇÃO", "SUPORTE", "BIG BAG", "INOX")
    // sobrescrevem variantes. Assim a foto representativa é a do equipamento padrão.
    const isVariante = /AMPLIA[ÇC][AÃ]O|SUPORTE|BIG\s*BAG|INOX|ADAPTA/i.test(ci.nome_curto)
    if (!m.has(key) || !isVariante) {
      // Só substitui se o que tava era variante e o novo é "limpo"
      if (!m.has(key)) {
        m.set(key, ci.foto_url)
      } else if (!isVariante) {
        m.set(key, ci.foto_url)
      }
    }
  }
  return m
}

function gerarUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Detecta se o motor do item já vem incluso no preço do equipamento.
// Padrões no docx Branorte: "Acionamento ... (incluso)", "Motorredutor X CV (Incluso)", etc.
// Quando incluso = true, motor_valor_unit deve ser 0 pra não cobrar duas vezes.
//
// CUIDADO: a marca "(motor não incluso)" / "(não incluso)" significa o OPOSTO —
// o motor é cobrado à parte. A regex precisa excluir negação senão zera o preço
// de moinhos/trituradores (caso real: spec "Acionamento: 15 CV (motor não incluso)"
// fazia o 15 CV aparecer como "incluso" no preview, perdendo R$ 7.996).
function motorJaInclusoNoItem(specs: string[]): boolean {
  if (!specs || specs.length === 0) return false
  const motorKeywords = /acionamento|motorredutor|moto\s*redutor|pot[êe]ncia|\bcv\b/i
  // Casa "(incluso)", "(inclusos)", "(Incluso.)", etc — mas NÃO casa
  // "(motor não incluso)", "(nao inclusos)" ou variações com negação dentro do parêntese.
  const inclusoMarker = /\((?![^)]*\bn[ãa]o\b)[^)]*\binclus[oa]s?\b[^)]*\)/i
  return specs.some(s => motorKeywords.test(s) && inclusoMarker.test(s))
}

// Lista motores por item (não agrupa CV iguais — 1 linha por item do carrinho que tem motor)
interface MotorAgrupado {
  cv: number
  polos: number
  qtd: number              // motor_qtd * item.qtd (motores totais)
  valor_unit: number
  valor_total: number
  item_nome?: string       // nome do item que usa esse motor (pra mostrar no listagem)
  item_uid?: string        // uid do CarrinhoItem que origem o motor (pra editar de volta)
  motorIndex?: number      // 0=principal, 1=secundário (quando item tem 2 motores na spec)
  por_conta_cliente?: boolean  // motor comprado pelo cliente — coluna de valor mostra "por conta do cliente"
  // Bug #25: TRUE quando motor é GENUINAMENTE incluso (motorredutor/spec com "(incluso)"
  // ou item linkado a precos_branorte com valor_com_motor preenchido). Antes a UI inferia
  // "incluso" a partir de valor_total===0 — o que mostrava "incluso" pra motor avulso
  // sem match no catálogo (vendedor reclamou: "não colocou o valor do motor, colocou como incluso").
  incluso_real?: boolean
  // Issue #23: motor REMOVIDO pelo vendedor (cliente não quer). Não conta no total,
  // mostra como "removido" no preview com botão de restaurar. Esconde no renderMode (PDF).
  removido?: boolean
}

// Peneira PASSIVA (jogo de peneira, par de peneiras, peneira de moinho) não tem
// motor próprio — só a "Peneira Vibratória" é acionada. O CV que aparece no nome
// (ex: "Jogo Peneira Moinho 15 CV") é a bitola do moinho que ela serve, não um motor.
function peneiraSemMotor(nome: string): boolean {
  return /peneira/i.test(nome) && !/vibrat[óo]ria/i.test(nome)
}

function agruparMotores(
  carrinho: CarrinhoItem[],
  motores?: CatalogoMotor[],
  voltagem: Voltagem = 'trifasico',
): MotorAgrupado[] {
  const linhas: MotorAgrupado[] = []
  for (const it of carrinho) {
    const nomeItem = it.nome_custom || it.nome
    const ehAcessorioOuPassiva = it.categoria === 'ACESSORIO' || peneiraSemMotor(nomeItem)
    const motorRemovido = !!it.motor_removido
    // Multi-motor: flags POR motorIndex. Fallback nos booleanos do item inteiro
    // (motor único / legados). motorIndex undefined = item de motor único.
    const removidosIdx = it.motores_removidos_idx ?? []
    const porContaIdx = it.motores_por_conta_idx ?? []
    const inclusoManualIdx = it.motores_incluso_idx ?? []
    const isRemovido = (idx?: number) => motorRemovido || (idx != null && removidosIdx.includes(idx))
    const isPorConta = (idx?: number) => !!it.motor_por_conta_cliente || (idx != null && porContaIdx.includes(idx))
    // Override manual de "incluso" feito pelo vendedor no modal Trocar Motor.
    const isInclusoManual = (idx?: number) => !!it.motor_incluso_manual || (idx != null && inclusoManualIdx.includes(idx))

    // ── MOTORES EXTRAS (multi-motor, ex: misturador c/ aquecimento) ──
    // Aparecem como linha SEPARADA na tabela MOTORES TRIFÁSICOS, com o
    // nome do item + descricao do motor extra (ex: "Misturador 1900L (Exaustor)").
    if (!ehAcessorioOuPassiva && Array.isArray(it.motores_extras_snapshot)) {
      it.motores_extras_snapshot.forEach((me, extraArrIdx) => {
        // motorIndex estável do motor extra (100+ pra não colidir com 0/1 do spec) —
        // permite "por conta"/"remover"/"trocar" agirem SÓ neste motor secundário.
        const meIdx = 100 + extraArrIdx
        const meRemovido = isRemovido(meIdx)
        const mePorConta = isPorConta(meIdx)
        const voltagemEfetiva: Voltagem = it.usa_inversor ? 'trifasico' : voltagem
        const motorMatch = motores
          ? acharMotorCompativel(motores, Number(me.cv), me.polos, voltagemEfetiva, voltagemEfetiva === 'monofasico')
          : null
        const valorUnitExtraBruto = motorMatch ? Number(motorMatch.valor) : 0
        const meInclusoManual = isInclusoManual(meIdx)
        // Removido / por conta do cliente / marcado incluso zera o valor mas mantém a
        // linha (flag), pra vendedor restaurar via botão na própria linha.
        const valorUnitExtra = (meRemovido || mePorConta || meInclusoManual) ? 0 : valorUnitExtraBruto
        const qtdExtra = (me.qtd || 1) * it.qtd
        // Expande em N linhas (1 por motor) em vez de 1 linha com (×N)
        for (let i = 0; i < qtdExtra; i++) {
          linhas.push({
            cv: Number(me.cv),
            polos: me.polos,
            qtd: 1,
            valor_unit: valorUnitExtra,
            valor_total: valorUnitExtra,
            item_nome: `${nomeItem} (${me.descricao})`,
            item_uid: it.uid,
            motorIndex: meIdx,
            por_conta_cliente: mePorConta,
            incluso_real: meInclusoManual,
            removido: meRemovido,
          })
        }
      })
    }

    if (!it.motor_cv) continue
    if (ehAcessorioOuPassiva) continue
    // Motorredutor incluso (ex: esteira de sacaria id 517) às vezes vem com motor_polos NULL
    // no cadastro → antes a linha era PULADA e o motor sumia do orçamento (seção "Motores (0)").
    // Trata null como 0 (= motorredutor, display "X CV motorredutor"). O incluso/R$0 segue
    // dependendo do spec ("Motorredutor X CV (incluso)"), então motor avulso não é afetado.
    const motorPolos = it.motor_polos == null ? 0 : it.motor_polos
    const qtdMotor = it.motor_qtd * it.qtd

    // Detecta múltiplos motores na spec: "Acionamento 15 CV e 2 CV por motorredutor (Inclusos)"
    // Padrão: "X CV [texto] Y CV" — aceita "10 CV e motor auxiliar agitador de 2 CV"
    // (até 80 chars entre os CVs pra evitar match em coisas distantes).
    const specMotor = it.specs?.find(s => /acionamento|motorredutor/i.test(s)) ?? ''
    const multiMatch = specMotor.match(/(\d+(?:[.,]\d+)?)\s*CV[^.]{0,80}?(\d+(?:[.,]\d+)?)\s*CV/i)
    const eMotorredutor = /motorredutor|moto\s*redutor/i.test(specMotor)
    // PRE_LIMPEZA tem motor DIRETO incluso (spec "X CV e Y CV (incluso)", sem a palavra
    // "motorredutor"). Sem isto o "(incluso)" era ignorado e os 2 motores eram cobrados.
    // Restrito a essa categoria pra NÃO zerar moinho/triturador (avulso) que tem "(incluso)"
    // perdido na spec.
    const inclusoDireto = it.categoria === 'PRE_LIMPEZA'
    const eInclusoSpec = /\(\s*inclus[oa]s?\.?\s*\)/i.test(specMotor)
    // CV mencionado como incluso no spec (1º CV do match). Se motor REAL (it.motor_cv)
    // é diferente, NAO trata como incluso — é outro motor avulso.
    // Ex: spec "Acionamento 10 CV (incluso)" + motor pareado 15 CV → NÃO incluso.
    const cvSpecMatch = specMotor.match(/(\d+(?:[.,]\d+)?)\s*CV/i)
    const cvSpecNum = cvSpecMatch ? parseFloat(cvSpecMatch[1].replace(',', '.')) : null
    const cvMotorReal = it.motor_cv ? Number(it.motor_cv) : null
    const cvBate = cvSpecNum != null && cvMotorReal != null
      ? Math.abs(cvSpecNum - cvMotorReal) < 0.01
      : true  // se um dos lados não tem CV, mantém comportamento antigo
    const eIncluso = eInclusoSpec && cvBate
    // Motor por conta do cliente: ignora valor e marca a linha
    const porContaCliente = !!it.motor_por_conta_cliente
    // Issue #23: motor removido também zera o valor (item segue, motor sai do total)
    const valorMotor = (porContaCliente || motorRemovido)
      ? 0
      : (((eIncluso && (eMotorredutor || inclusoDireto)) || isInclusoManual()) ? 0 : it.motor_valor_unit)

    if (multiMatch) {
      const cv1 = parseFloat(multiMatch[1].replace(',', '.'))
      const cv2 = parseFloat(multiMatch[2].replace(',', '.'))
      // Multi-motor: cada CV pode ter preço diferente (ex: 12,5 CV principal + 2 CV exaustor).
      // Antes: ambas linhas usavam `valorMotor` (= motor_valor_unit do principal) — exaustor
      // ficava com valor errado e não atualizava ao trocar CV. Corrigido buscando o preço
      // de cada CV no catálogo de motores via acharMotorCompativel.
      const voltagemEfetiva: Voltagem = it.usa_inversor ? 'trifasico' : voltagem
      const motor1Cat = motores ? acharMotorCompativel(motores, cv1, motorPolos, voltagemEfetiva, voltagemEfetiva === 'monofasico') : null
      const motor2Cat = motores ? acharMotorCompativel(motores, cv2, motorPolos, voltagemEfetiva, voltagemEfetiva === 'monofasico') : null
      const tratarComoIncluso = eIncluso && (eMotorredutor || inclusoDireto)
      // Preço base de cada CV; zera POR motorIndex (0/1) conforme por-conta/removido,
      // pra marcar/remover UM motor não zerar o outro.
      const baseCv1 = tratarComoIncluso ? 0 : (motor1Cat ? Number(motor1Cat.valor) : it.motor_valor_unit)
      const baseCv2 = tratarComoIncluso ? 0 : (motor2Cat ? Number(motor2Cat.valor) : 0)
      const valorCv1 = (isPorConta(0) || isRemovido(0) || isInclusoManual(0)) ? 0 : baseCv1
      const valorCv2 = (isPorConta(1) || isRemovido(1) || isInclusoManual(1)) ? 0 : baseCv2
      // Bug: se o item TEM motores_extras_snapshot, o 2º motor já entra pelo bloco de
      // motores extras acima. Emitir o cv2 do spec aqui ALÉM disso conta o secundário
      // 2x na tabela e no total. Quando há extras, emite só o principal (cv1).
      const temMotoresExtras = Array.isArray(it.motores_extras_snapshot) && it.motores_extras_snapshot.length > 0
      // 1 linha por motor da spec × qtd do item (sem agregar — cada item vira N linhas)
      for (let i = 0; i < it.qtd; i++) {
        linhas.push({
          cv: cv1, polos: motorPolos, qtd: 1,
          valor_unit: valorCv1, valor_total: valorCv1,
          item_nome: nomeItem, item_uid: it.uid, motorIndex: 0,
          por_conta_cliente: isPorConta(0),
          incluso_real: tratarComoIncluso || isInclusoManual(0),
          removido: isRemovido(0),
        })
        if (!temMotoresExtras) {
          linhas.push({
            cv: cv2, polos: motorPolos, qtd: 1,
            valor_unit: valorCv2, valor_total: valorCv2,
            item_nome: nomeItem, item_uid: it.uid, motorIndex: 1,
            por_conta_cliente: isPorConta(1),
            incluso_real: tratarComoIncluso || isInclusoManual(1),
            removido: isRemovido(1),
          })
        }
      }
    } else {
      // 1 linha por motor — se item tem motor_qtd=2 ou qtd=2, gera N linhas iguais
      // (vendedor pediu pra ver "7,5 CV motorredutor" listado N vezes em vez de "(×2)")
      // Bug #25: marca incluso_real só quando spec literal diz "(incluso)" + é motorredutor.
      // Motor com valor=0 por OUTRO motivo (sem match no catálogo) NÃO é incluso → UI mostra warning.
      const inclusoReal = (eIncluso && (eMotorredutor || inclusoDireto)) || isInclusoManual()
      for (let i = 0; i < qtdMotor; i++) {
        linhas.push({
          cv: it.motor_cv, polos: motorPolos, qtd: 1,
          valor_unit: valorMotor, valor_total: valorMotor,
          item_nome: nomeItem, item_uid: it.uid,
          por_conta_cliente: porContaCliente,
          incluso_real: inclusoReal,
          removido: motorRemovido,
        })
      }
    }
  }
  return linhas
}

export function OrcamentoMontar() {
  const { data: items, isLoading: loadingItems } = useCatalogoItems()
  const { data: motores, isLoading: loadingMotores } = useCatalogoMotores()

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [voltagem, setVoltagem] = useState<Voltagem>('trifasico')
  // Modo exportação: quando ligado, +10% em TODOS os valores (preview + orçamento gerado).
  const [exportacao, setExportacao] = useState(false)
  // Tensão dos motores (global pra todos). null = "tensão a confirmar".
  const [tensaoMotores, setTensaoMotores] = useState<TensaoMotor>(null)
  // #32: Marca dos motores (global). Texto livre. null = "marca a confirmar".
  const [marcaMotores, setMarcaMotores] = useState<string | null>(null)
  const [carrinho, setCarrinho] = useState<CarrinhoItem[]>([])
  // Acessórios: bloco opcional com valor calculado como % do total de equipamentos
  // valorFixo: opcional. Quando setado (vem de modelo carregado), tem prioridade
  // sobre o calculo pct*itens — evita perder centavos no arredondamento.
  // Limpo pra null quando vendedor edita o pct manualmente.
  const [acessorios, setAcessorios] = useState<{ pct: number; items: string[]; valorFixo?: number | null; excludedItemUids?: string[] } | null>(null)
  const [acessoriosOpen, setAcessoriosOpen] = useState(false)
  // Popup de confirmação quando finaliza sem acessórios (obrigatório decidir)
  const [confirmSemAcessorios, setConfirmSemAcessorios] = useState(false)
  const [showOnlyPopular, setShowOnlyPopular] = useState(false)
  const [showOnlyOficiais, setShowOnlyOficiais] = useState(true)  // default: só items curados
  const [modoVisao, setModoVisao] = useState<ModoVisao>('preview')
  // Mobile-only: alterna entre catálogo e preview (ambos ocupam tela cheia em mobile)
  // Default = 'preview': mobile abre direto na previa do orcamento. Catalogo
  // vira sheet/tab secundaria. Vendedor ve o que esta montando, e abre
  // catalogo so quando precisa adicionar item.
  const [mobileTab, setMobileTab] = useState<'catalogo' | 'preview'>('preview')
  const [finalizarOpen, setFinalizarOpen] = useState(false)
  const [aiDrawerOpen, setAiDrawerOpen] = useState(false)
  const [saveMode, setSaveMode] = useState<'update' | 'alt' | 'new'>('new')
  const [saveDropdownOpen, setSaveDropdownOpen] = useState(false)
  // Sprint 3: marca true quando o copiloto IA dispara a finalização (auto-submit 3s)
  const [autoSubmitFromIA, setAutoSubmitFromIA] = useState(false)
  const [sucesso, setSucesso] = useState<{ numero: string; baixouDocx: boolean; baixouPdf: boolean; salvouNaPasta: boolean; pdfBlob: Blob | null; cliente: string; erro?: string | null; pdfErro?: string | null } | null>(null)
  const [enviandoWA, setEnviandoWA] = useState<'idle' | 'enviando' | 'enviado' | 'erro'>('idle')
  const [enviandoWAMsg, setEnviandoWAMsg] = useState<string>('')
  const [waPromptOpen, setWaPromptOpen] = useState(false)
  const [waPromptValue, setWaPromptValue] = useState('')
  const [waPromptResolve, setWaPromptResolve] = useState<((v: string | null) => void) | null>(null)
  const [fotoPrincipal, setFotoPrincipal] = useState<string | null>(null)
  // Desconto + termos editáveis inline no preview
  // tipo/valor sempre; motivo/base/manterValorParcelas opcionais (default: base='total').
  const [descontoCfg, setDescontoCfg] = useState<{
    tipo: 'pct' | 'valor'
    valor: number
    motivo?: string
    base?: 'total' | 'equipamento'
    manterValorParcelas?: boolean
  } | null>(null)
  // Data da venda começa VAZIA ("a combinar") — vendedor só preenche se vender (roadmap #36)
  const [dataVendaTxt, setDataVendaTxt] = useState('')
  const [prazoEntregaTxt, setPrazoEntregaTxt] = useState('')
  const [formaPagamentoTxt, setFormaPagamentoTxt] = useState('')
  // Frete editavel inline no preview: tipo (CIF/FOB) + texto livre.
  // Default = FOB + 'por conta do cliente' (comportamento legado). Vendedor pode mudar.
  const [freteTipo, setFreteTipo] = useState<'CIF' | 'FOB'>('FOB')
  const [freteTxt, setFreteTxt] = useState<string>('')
  // Parcelas estruturadas (tabela DATA/MÉTODO/VALOR) — alternativa ao texto livre acima
  const [parcelasPagamento, setParcelasPagamento] = useState<ParcelaPagamento[]>([])
  // Componentes adicionais (NÃO fabricados pela Branorte) — painel elétrico, balança, célula de carga, etc.
  // Cada item: nome livre + valor R$. Vai pro totalGeral mas NÃO é "equipamento" nem "motor".
  const [componentesExtras, setComponentesExtras] = useState<ComponenteExtra[]>([])
  // Seção "Observação — por conta do cliente" editável por orçamento.
  // null = usa OBS_POR_CONTA_DEFAULT (5 linhas históricas) na preview/PDF/DOCX.
  const [obsPorConta, setObsPorConta] = useState<string[] | null>(null)

  // Snapshot do estado p/ autosave. Inclui tudo que o vendedor pode ter mudado
  // (carrinho, acessorios, voltagem, termos, etc). Excluido: filtros de busca, modais.
  const draftSnapshot = useMemo(() => ({
    carrinho,
    acessorios,
    voltagem,
    tensaoMotores,
    marcaMotores,
    descontoCfg,
    dataVendaTxt,
    prazoEntregaTxt,
    formaPagamentoTxt,
    freteTipo,
    freteTxt,
    parcelasPagamento,
    fotoPrincipal,
    componentesExtras,
    obsPorConta,
  }), [
    carrinho, acessorios, voltagem, tensaoMotores, marcaMotores, descontoCfg,
    dataVendaTxt, prazoEntregaTxt, formaPagamentoTxt, freteTipo, freteTxt,
    parcelasPagamento, fotoPrincipal,
    componentesExtras, obsPorConta,
  ])

  // Autosave so liga depois que catalogo carregar (evita salvar snapshot vazio
  // antes do usuario interagir). Banner de recuperacao aparece se draft existir.
  const draft = useOrcamentoDraft(draftSnapshot, !loadingItems && !loadingMotores)

  // ─── HISTÓRICO PRA UNDO (Ctrl+Z) ──────────────────────────────────────────
  // Guarda snapshots anteriores do estado pra vendedor desfazer mudanças
  // acidentais (remover item sem querer, mudar valor errado, etc).
  // Cap em 50 entradas pra não explodir memória. Limpa quando troca pra
  // outro orçamento (editingId) ou quando finaliza.
  type DraftSnap = typeof draftSnapshot
  const [historyStack, setHistoryStack] = useState<DraftSnap[]>([])
  const isApplyingUndoRef = useRef(false)
  const lastSnapshotRef = useRef<string | null>(null)

  useEffect(() => {
    // Só rastreia depois que catálogo carregou (evita snapshots vazios iniciais)
    if (loadingItems || loadingMotores) return

    // Quando estamos restaurando um snapshot via undo, atualiza o ref e sai
    // sem empilhar (senão a própria restauração viraria nova entrada).
    if (isApplyingUndoRef.current) {
      isApplyingUndoRef.current = false
      lastSnapshotRef.current = JSON.stringify(draftSnapshot)
      return
    }

    const serialized = JSON.stringify(draftSnapshot)
    if (serialized === lastSnapshotRef.current) return

    const prev = lastSnapshotRef.current
    lastSnapshotRef.current = serialized

    // Primeira vez: só registra o estado, não tem o que empilhar ainda
    if (prev === null) return

    setHistoryStack(stack => {
      const prevSnap = JSON.parse(prev) as DraftSnap
      const next = [...stack, prevSnap]
      return next.length > 50 ? next.slice(-50) : next
    })
  }, [draftSnapshot, loadingItems, loadingMotores])

  function desfazer() {
    if (historyStack.length === 0) return
    const prev = historyStack[historyStack.length - 1]
    isApplyingUndoRef.current = true
    setCarrinho(prev.carrinho ?? [])
    setAcessorios(prev.acessorios ?? null)
    setVoltagem(prev.voltagem ?? 'trifasico')
    setTensaoMotores(prev.tensaoMotores ?? null)
    setMarcaMotores((prev as any).marcaMotores ?? null)
    setDescontoCfg(prev.descontoCfg ?? null)
    setDataVendaTxt(prev.dataVendaTxt ?? '')
    setPrazoEntregaTxt(prev.prazoEntregaTxt ?? '')
    setFormaPagamentoTxt(prev.formaPagamentoTxt ?? '')
    setFreteTipo((prev as any).freteTipo ?? 'FOB')
    setFreteTxt((prev as any).freteTxt ?? '')
    setParcelasPagamento(prev.parcelasPagamento ?? [])
    setFotoPrincipal(prev.fotoPrincipal ?? null)
    setComponentesExtras(prev.componentesExtras ?? [])
    setObsPorConta((prev as any).obsPorConta ?? null)
    setHistoryStack(stack => stack.slice(0, -1))
  }

  // Ctrl+Z / Cmd+Z: desfaz. Ignora quando foco tá em input/textarea pra não
  // atropelar o undo nativo do navegador na digitação.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const isUndo = (e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z'
      if (!isUndo) return
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
      e.preventDefault()
      desfazer()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [historyStack])

  function restaurarRascunho() {
    if (!draft.recovered) return
    const d = draft.recovered.data
    setCarrinho(d.carrinho ?? [])
    setAcessorios(d.acessorios ?? null)
    setVoltagem(d.voltagem ?? 'trifasico')
    setTensaoMotores(d.tensaoMotores ?? null)
    setMarcaMotores((d as any).marcaMotores ?? null)
    setDescontoCfg(d.descontoCfg ?? null)
    setDataVendaTxt(d.dataVendaTxt ?? '')
    setPrazoEntregaTxt(d.prazoEntregaTxt ?? '')
    setFormaPagamentoTxt(d.formaPagamentoTxt ?? '')
    setFreteTipo((d as any).freteTipo ?? 'FOB')
    setFreteTxt((d as any).freteTxt ?? '')
    setParcelasPagamento(d.parcelasPagamento ?? [])
    setFotoPrincipal(d.fotoPrincipal ?? null)
    setComponentesExtras(d.componentesExtras ?? [])
    setObsPorConta((d as any).obsPorConta ?? null)
    draft.dismissRecovered()
  }

  function descartarRascunho() {
    draft.clearDraft()
  }

  // ─── EDIÇÃO DE ORÇAMENTO SALVO ──────────────────────────────────────────
  // Se URL tem ?id=N, carrega orcamentos_gerados[N] e popula o carrinho.
  // Save flow detecta editingId pra fazer UPDATE em vez de INSERT.
  const [searchParams] = useSearchParams()
  const editingIdParam = searchParams.get('id')
  const editingId = editingIdParam ? Number(editingIdParam) : null
  const { data: orcamentoEditando, isLoading: loadingOrcamento } = useOrcamentoGerado(editingId)
  const [orcamentoHidratado, setOrcamentoHidratado] = useState(false)
  // Estado pra hidratar o modal FinalizarMontarModal com dados do orcamento salvo
  const [initialModal, setInitialModal] = useState<{
    cliente_nome: string
    cliente_dados: any
    observacoes: string | null
    forma_pagamento: string | null
    prazo_entrega: string | null
  } | null>(null)

  // Estado do cliente (preenchido via modal de edição ou IA)
  const [clienteDados, setClienteDados] = useState<PreviewClienteDados>({})
  const [clienteModalOpen, setClienteModalOpen] = useState(false)

  function atualizarTermo(key: 'dataVenda' | 'prazoEntrega' | 'formaPagamento' | 'freteTxt' | 'freteTipo', v: string) {
    if (key === 'dataVenda') {
      setDataVendaTxt(v)
    } else if (key === 'prazoEntrega') {
      setPrazoEntregaTxt(v)
      // Sincroniza com initialModal pra modal Finalizar nao sobrescrever com valor antigo
      setInitialModal(prev => prev ? { ...prev, prazo_entrega: v || null } : prev)
    } else if (key === 'formaPagamento') {
      setFormaPagamentoTxt(v)
      // Sincroniza com initialModal pra que o modal Finalizar nao sobrescreva o valor
      // editado inline com o antigo do banco. (Bug: vendedor editava 'a combinar'
      // no preview, mas PDF saia com 'À vista PIX 5%' herdado do banco.)
      setInitialModal(prev => prev ? { ...prev, forma_pagamento: v || null } : prev)
    } else if (key === 'freteTipo') {
      // Troca CIF/FOB. Se vendedor nao customizou o texto ainda, atualiza o default
      // pra refletir a nova semantica (FOB→"por conta do cliente", CIF→"por conta da Branorte").
      const novoTipo: 'CIF' | 'FOB' = v === 'CIF' ? 'CIF' : 'FOB'
      setFreteTipo(novoTipo)
    } else if (key === 'freteTxt') {
      setFreteTxt(v)
    }
  }

  const categorias = useMemo(() => agruparPorCategoria(items ?? []), [items])

  const itemsFiltrados = useMemo(() => {
    if (!items) return []
    const buscaLower = busca.trim().toLowerCase()
    return items.filter(it => {
      if (showOnlyOficiais && !it.is_oficial) return false
      if (categoria && it.categoria !== categoria) return false
      if (showOnlyPopular && it.ocorrencias < 5) return false
      if (buscaLower) {
        const haystack = `${it.nome_curto} ${it.nome_completo} ${it.categoria}`.toLowerCase()
        if (!haystack.includes(buscaLower)) return false
      }
      return true
    })
  }, [items, categoria, busca, showOnlyPopular, showOnlyOficiais])

  const totalOficiais = useMemo(() => (items ?? []).filter(i => i.is_oficial).length, [items])

  const motoresAgrupados = useMemo(() => agruparMotores(carrinho, motores, voltagem), [carrinho, motores, voltagem])

  const totalItems = useMemo(
    () => carrinho.reduce((s, c) => s + (c.brinde || c.por_conta_cliente ? 0 : c.valor * c.qtd), 0),
    [carrinho],
  )
  const totalMotores = useMemo(
    () => motoresAgrupados.reduce((s, m) => s + m.valor_total, 0),
    [motoresAgrupados],
  )
  // Valor dos acessórios = % do total de equipamentos (arredondado pra cima, sem centavos)
  // Pode excluir itens específicos do carrinho da base de cálculo (excludedItemUids).
  // Item novo no carrinho entra automaticamente — só fica fora o que vendedor desmarcou.
  const valorAcessorios = useMemo(() => {
    if (!acessorios) return 0
    if (acessorios.valorFixo != null && acessorios.valorFixo > 0) return Math.ceil(acessorios.valorFixo)
    const excluded = new Set(acessorios.excludedItemUids ?? [])
    const base = carrinho.reduce(
      (s, c) => s + (c.brinde || c.por_conta_cliente || excluded.has(c.uid) ? 0 : c.valor * c.qtd),
      0,
    )
    return Math.ceil((base * acessorios.pct) / 100)
  }, [acessorios, carrinho])

  const temAcessorios = !!acessorios && (acessorios.items?.length ?? 0) > 0

  // Abre o modal de finalização (gera PDF/DOCX). Antes revisa cliente.
  const abrirFinalizar = () => {
    setSaveMode('new')
    if (clienteDados.nome?.trim()) {
      setInitialModal(prev => ({
        cliente_nome: clienteDados.nome || prev?.cliente_nome || '',
        cliente_dados: { ...clienteDados },
        observacoes: prev?.observacoes ?? null,
        forma_pagamento: prev?.forma_pagamento ?? null,
        prazo_entrega: prev?.prazo_entrega ?? null,
      }))
    }
    setAutoSubmitFromIA(false)
    setFinalizarOpen(true)
  }

  // Clique no "Finalizar e gerar": se não há acessórios, exige decidir
  // (adicionar ou confirmar que não tem) antes de prosseguir.
  const handleFinalizarClick = () => {
    if (!temAcessorios) { setConfirmSemAcessorios(true); return }
    abrirFinalizar()
  }

  const totalEquip = totalItems + valorAcessorios   // entra no "VALOR TOTAL DE EQUIPAMENTOS"
  const totalComponentesExtras = useMemo(
    () => componentesExtras.reduce((s, c) => s + (Number(c.valor) || 0), 0),
    [componentesExtras],
  )
  const totalGeral = totalEquip + totalMotores + totalComponentesExtras

  // ── Modo EXPORTAÇÃO: +10% em todos os valores. fExp=1 quando desligado (zero efeito). ──
  // Aplica nas versões "*Exib" que alimentam o preview, o resumo e o orçamento gerado.
  const fExp = exportacao ? 1.1 : 1
  const carrinhoExib = useMemo(
    () => fExp === 1 ? carrinho : carrinho.map(c => ({
      ...c,
      valor: Math.round(c.valor * fExp),
      motor_valor_unit: c.motor_valor_unit != null ? Math.round(c.motor_valor_unit * fExp) : c.motor_valor_unit,
    })),
    [carrinho, fExp],
  )
  const motoresAgrupadosExib = useMemo(
    () => fExp === 1 ? motoresAgrupados : motoresAgrupados.map(m => ({ ...m, valor_total: Math.round(m.valor_total * fExp) })),
    [motoresAgrupados, fExp],
  )
  const componentesExtrasExib = useMemo(
    () => fExp === 1 ? componentesExtras : componentesExtras.map(c => ({ ...c, valor: Math.round((Number(c.valor) || 0) * fExp) })),
    [componentesExtras, fExp],
  )
  const totalItemsExib = useMemo(
    () => carrinhoExib.reduce((s, c) => s + (c.brinde || c.por_conta_cliente ? 0 : c.valor * c.qtd), 0),
    [carrinhoExib],
  )
  const totalMotoresExib = useMemo(() => motoresAgrupadosExib.reduce((s, m) => s + m.valor_total, 0), [motoresAgrupadosExib])
  const valorAcessoriosExib = fExp === 1 ? valorAcessorios : Math.round(valorAcessorios * fExp)
  const totalEquipExib = totalItemsExib + valorAcessoriosExib
  const totalComponentesExtrasExib = fExp === 1 ? totalComponentesExtras : Math.round(totalComponentesExtras * fExp)
  const totalGeralExib = totalEquipExib + totalMotoresExib + totalComponentesExtrasExib

  // Item pendente de escolha de função (modal). Null = nenhum modal aberto.
  const [escolherFuncaoFor, setEscolherFuncaoFor] = useState<CatalogoItem | null>(null)
  // Modal de "adicionar produto personalizado" (ad-hoc)
  const [customOpen, setCustomOpen] = useState(false)
  const { profile } = useAuth()
  const { data: vendorsAtivos } = useVendors()
  // Formata telefone Branorte (12 digitos) pra (DDD) 9 XXXX-XXXX
  const vendedoresContato = useMemo(() => {
    if (!vendorsAtivos) return []
    return vendorsAtivos
      .filter(v => v.telefone && v.name && !/^branorte$/i.test(v.name))
      .map(v => {
        const d = String(v.telefone).replace(/\D/g, '')
        let tel = v.telefone || ''
        // 554884692860 (12) -> (48) 9 8469-2860
        if (d.length === 12 && d.startsWith('55')) tel = `(${d.slice(2,4)}) 9 ${d.slice(4,8)}-${d.slice(8)}`
        // 5548998313374 (13) -> (48) 9 9831-3374
        else if (d.length === 13 && d.startsWith('55')) tel = `(${d.slice(2,4)}) ${d.slice(4,5)} ${d.slice(5,9)}-${d.slice(9)}`
        // Capitaliza nome (DANIEL -> Daniel)
        const nome = v.name.charAt(0).toUpperCase() + v.name.slice(1).toLowerCase()
        return { nome, telefone: tel }
      })
  }, [vendorsAtivos])

  // Adiciona um item livre ao carrinho (nao precisa estar no catalogo).
  async function adicionarItemCustomizado(data: {
    nome: string
    categoria: string
    valor: number
    motor_cv: number | null
    motor_polos: number | null
    motorIncluso?: boolean
    descricao: string | null
    foto_url: string | null
    enviarParaAprovacao: boolean
    porContaCliente?: boolean
  }) {
    // "Motorredutor incluso": motor não é cobrado à parte (motor_valor_unit = 0) e não busca match.
    const motorMatch = !data.motorIncluso && data.motor_cv && data.motor_polos && motores
      ? acharMotorCompativel(motores, data.motor_cv, data.motor_polos, voltagem, voltagem === 'monofasico')
      : null
    // Item "por conta do cliente" não tem valor: zera pra não entrar no total.
    const valorItem = data.porContaCliente ? 0 : data.valor
    const descSpecs = data.descricao ? data.descricao.split('\n').map(l => l.trim()).filter(Boolean) : []
    // Se motorredutor incluso, registra a linha de acionamento incluso no descritivo.
    const specsItem = data.motorIncluso && data.motor_cv
      ? [`Acionamento: motor ${data.motor_cv} CV (motorredutor incluso)`, ...descSpecs]
      : descSpecs
    setCarrinho(c => [...c, {
      uid: gerarUid(),
      catalogo_id: -1,  // marker: item nao oficial / customizado
      categoria: data.categoria || 'CUSTOM',
      nome: data.nome,
      specs: specsItem,
      qtd: 1,
      valor: valorItem,
      valor_original: valorItem,
      motor_cv: data.motor_cv,
      motor_polos: data.motor_polos,
      motor_qtd: data.motor_cv ? 1 : 0,
      motor_valor_unit: data.motorIncluso ? 0 : (motorMatch ? Number(motorMatch.valor) : 0),
      foto_url: data.foto_url,
      por_conta_cliente: !!data.porContaCliente,
    }])
    autoAdicionarBalancaSeCompacta(data.nome, data.categoria)

    // Se vendedor marcou pra enviar pro admin avaliar, grava em catalogo_items_pendentes
    if (data.enviarParaAprovacao) {
      try {
        await supabase.from('catalogo_items_pendentes').insert({
          nome_curto: data.nome,
          categoria: data.categoria || 'CUSTOM',
          valor: valorItem,
          motor_padrao_cv: data.motor_cv,
          motor_padrao_polos: data.motor_polos,
          descricao: data.descricao,
          foto_url: data.foto_url,
          criado_por: profile?.id ?? null,
          criado_por_email: profile?.email ?? null,
        })
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[catalogo_items_pendentes] falha ao gravar:', err)
      }
    }
  }

  // Configuração de cálculo de potência do chupim (fórmula Branorte)
  // Material/inclinação default — usado como pré-seleção no modal de confirmação por item.
  const [chupimMaterial, setChupimMaterial] = useState<MaterialChupim>('MILHO')
  const [chupimInclinacao, setChupimInclinacao] = useState<InclinacaoChupim>(45)
  // Modal de confirmação por chupim: abre quando vendedor clica num chupim no picker.
  // Permite escolher material/inclinação específicos pra AQUELE item antes de adicionar.
  const [confirmarChupim, setConfirmarChupim] = useState<PrecoBranorte | null>(null)

  // Modais de pickers (cada categoria tem seu próprio meta-card)
  const [transportadorPickerOpen, setTransportadorPickerOpen] = useState(false)
  const [misturadorPickerOpen, setMisturadorPickerOpen] = useState(false)
  const [moinhoPickerOpen, setMoinhoPickerOpen] = useState(false)
  const [caixaPickerOpen, setCaixaPickerOpen] = useState(false)
  const [siloPickerOpen, setSiloPickerOpen] = useState(false)
  const [elevadorPickerOpen, setElevadorPickerOpen] = useState(false)
  const [cacambaPickerOpen, setCacambaPickerOpen] = useState(false)
  const [preLimpezaPickerOpen, setPreLimpezaPickerOpen] = useState(false)
  const [peneiraPickerOpen, setPeneiraPickerOpen] = useState(false)
  const [helicoidePickerOpen, setHelicoidePickerOpen] = useState(false)
  const [balancaPickerOpen, setBalancaPickerOpen] = useState(false)
  const [compactaPickerOpen, setCompactaPickerOpen] = useState(false)
  const [plasticoPickerOpen, setPlasticoPickerOpen] = useState(false)
  // Picker de MODELOS de pacote (Compactas + Mini Fabrica) — abre os 65 modelos
  // estruturados de orcamento_modelos. Ao escolher um, carrega TODOS os itens
  // (transportador + moinho + misturador) pra ficar idêntico ao orçamento original.
  const [pacotePicker, setPacotePicker] = useState<{ open: boolean; initialPacote?: string }>({ open: false })
  const [ensacadeiraPickerOpen, setEnsacadeiraPickerOpen] = useState(false)
  const [alimentadorPickerOpen, setAlimentadorPickerOpen] = useState(false)
  const [descargaPickerOpen, setDescargaPickerOpen] = useState(false)
  const [moegaPickerOpen, setMoegaPickerOpen] = useState(false)
  const [passarelaPickerOpen, setPassarelaPickerOpen] = useState(false)
  const [suporteBagPickerOpen, setSuporteBagPickerOpen] = useState(false)
  const [outrosPickerOpen, setOutrosPickerOpen] = useState(false)
  const [esteiraPickerOpen, setEsteiraPickerOpen] = useState(false)

  // ===== Trocar item (roadmap #35): substitui um item por outro da mesma categoria =====
  // Abre o picker da categoria do item e, ao escolher, substitui na MESMA posição —
  // sem o vendedor ter que excluir e adicionar de novo (ex: trocar tamanho do chupim).
  const [substituirUid, setSubstituirUid] = useState<string | null>(null)
  const lenAoTrocarRef = useRef(0)

  const abrirPickerDaCategoria = (categoria: string) => {
    const cat = (categoria || '').toUpperCase()
    const mapa: Record<string, () => void> = {
      COMPACTA: () => setPacotePicker({ open: true }),
      TRANSPORTADOR: () => setTransportadorPickerOpen(true),
      MOINHO: () => setMoinhoPickerOpen(true),
      MISTURADOR: () => setMisturadorPickerOpen(true),
      CAIXA: () => setCaixaPickerOpen(true),
      SILO: () => setSiloPickerOpen(true),
      ELEVADOR: () => setElevadorPickerOpen(true),
      ESTEIRA: () => setEsteiraPickerOpen(true),
      CACAMBA_PESAGEM: () => setCacambaPickerOpen(true),
      PRE_LIMPEZA: () => setPreLimpezaPickerOpen(true),
      ENSACADEIRA: () => setEnsacadeiraPickerOpen(true),
      PENEIRA: () => setPeneiraPickerOpen(true),
      HELICOIDE: () => setHelicoidePickerOpen(true),
      BALANCA: () => setBalancaPickerOpen(true),
      PLASTICO: () => setPlasticoPickerOpen(true),
      ALIMENTADOR: () => setAlimentadorPickerOpen(true),
      DESCARGA: () => setDescargaPickerOpen(true),
      MOEGA: () => setMoegaPickerOpen(true),
      PASSARELA: () => setPassarelaPickerOpen(true),
      SUPORTE_BAG: () => setSuporteBagPickerOpen(true),
    }
    ;(mapa[cat] || (() => setOutrosPickerOpen(true)))()  // fallback: picker Outros
  }

  const handleTrocarItem = (uid: string) => {
    const item = carrinho.find(c => c.uid === uid)
    if (!item) return
    setSubstituirUid(uid)
    lenAoTrocarRef.current = carrinho.length
    abrirPickerDaCategoria(item.categoria)
  }

  const algumPickerAberto =
    transportadorPickerOpen || misturadorPickerOpen || moinhoPickerOpen || caixaPickerOpen ||
    siloPickerOpen || elevadorPickerOpen || cacambaPickerOpen || preLimpezaPickerOpen ||
    peneiraPickerOpen || helicoidePickerOpen || balancaPickerOpen || compactaPickerOpen ||
    plasticoPickerOpen || ensacadeiraPickerOpen || alimentadorPickerOpen || descargaPickerOpen ||
    moegaPickerOpen || passarelaPickerOpen || suporteBagPickerOpen || outrosPickerOpen ||
    esteiraPickerOpen || pacotePicker.open

  // Quando um novo item entra após "Trocar", move pra posição do antigo e remove o antigo.
  // Se o picker fecha sem escolher, cancela a troca (não bagunça a próxima adição).
  useEffect(() => {
    if (!substituirUid) return
    if (carrinho.length > lenAoTrocarRef.current) {
      setCarrinho(c => {
        const novo = c[c.length - 1]
        const semNovo = c.slice(0, -1)
        const idx = semNovo.findIndex(x => x.uid === substituirUid)
        if (idx === -1) return c
        const out = semNovo.slice()
        out.splice(idx, 1, novo)
        return out
      })
      setSubstituirUid(null)
    } else if (!algumPickerAberto) {
      setSubstituirUid(null)
    }
  }, [carrinho.length, algumPickerAberto, substituirUid])

  const { data: precos } = usePrecosBranorte()
  // Lista de modelos de pacote — usado pelo copiloto IA pra resolver onCarregarPacote.
  // (Outros componentes mais abaixo no arquivo carregam de novo; ok porque o hook
  // usa React Query e dedup automaticamente.)
  const { data: modelos } = useOrcamentoModelos()
  // Transportadores ficam em precos_branorte (modal dedicado com fórmula de chupim)
  const transportadores = useMemo(
    () => (precos ?? []).filter(p => p.categoria === 'TRANSPORTADOR'),
    [precos],
  )

  // ── Todas as outras categorias puxam do CATÁLOGO CURADO (catalog_items) ──
  // Só itens is_oficial aparecem pro vendedor. Fotos, specs e preços curados.
  const oficiais = items ?? []
  const filtrarCat = (cat: string) => oficiais.filter(ci => ci.categoria === cat && ci.is_oficial)

  const misturadoresOficiais = useMemo(() => filtrarCat('MISTURADOR'), [oficiais])
  const moinhosOficiais = useMemo(() => filtrarCat('MOINHO'), [oficiais])
  // Componentes adicionais disponíveis (NÃO fabricados pela Branorte) — vem da tabela de preços.
  // Hoje: BALANCA (eletrônicas, mecânicas, célula de carga). Futuro: adicionar outras categorias
  // ao banco e elas aparecem aqui sem mudar código.
  const componentesAdicionaisCatalogo = useMemo(
    () => (precos ?? [])
      .filter(p => p.categoria === 'BALANCA' || p.categoria === 'PAINEL_ELETRICO')
      .map(p => ({
        id: `pb-${p.id}`,
        nome: p.descricao,
        valorSugerido: p.valor_equipamento != null ? Math.round(Number(p.valor_equipamento)) : null,
      })),
    [precos],
  )
  const caixasOficiais = useMemo(() => filtrarCat('CAIXA'), [oficiais])
  const silosOficiais = useMemo(() => filtrarCat('SILO'), [oficiais])
  const elevadoresOficiais = useMemo(() => filtrarCat('ELEVADOR'), [oficiais])
  const cacambasOficiais = useMemo(() => filtrarCat('CACAMBA_PESAGEM'), [oficiais])
  const preLimpezasOficiais = useMemo(() => filtrarCat('PRE_LIMPEZA'), [oficiais])
  const peneirasOficiais = useMemo(() => filtrarCat('PENEIRA'), [oficiais])
  const helicoidesOficiais = useMemo(() => filtrarCat('HELICOIDE'), [oficiais])
  const balancasOficiais = useMemo(() => filtrarCat('BALANCA'), [oficiais])
  const compactasOficiais = useMemo(() => filtrarCat('COMPACTA'), [oficiais])
  const ensacadeirasOficiais = useMemo(() => filtrarCat('ENSACADEIRA'), [oficiais])
  const elevadorSacariaOficiais = useMemo(() => filtrarCat('ELEVADOR_SACARIA'), [oficiais])
  // Categorias pequenas (1-5 itens cada) — antes ficavam soltas no grid, agora cada uma tem meta-card.
  const alimentadoresOficiais = useMemo(() => filtrarCat('ALIMENTADOR'), [oficiais])
  const descargasOficiais = useMemo(() => filtrarCat('DESCARGA'), [oficiais])
  const moegasOficiais = useMemo(() => filtrarCat('MOEGA'), [oficiais])
  const passarelasOficiais = useMemo(() => filtrarCat('PASSARELA'), [oficiais])
  const suporteBagOficiais = useMemo(() => filtrarCat('SUPORTE_BAG'), [oficiais])
  const outrosOficiais = useMemo(() => oficiais.filter(ci => (ci.categoria === 'OUTROS' || ci.categoria === 'ACESSORIO') && ci.is_oficial), [oficiais])
  const plasticosOficiais = useMemo(() => filtrarCat('PLASTICO'), [oficiais])
  const esteirasOficiais = useMemo(() => filtrarCat('ESTEIRA'), [oficiais])

  // Formata CV pra usar em specs: "1.5" -> "1,5", "2" -> "2,0"
  function formatCvSpec(cv: number): string {
    return cv.toFixed(1).replace('.', ',')
  }

  // Formata nome de uma entrada de precos_branorte pro padrão Branorte
  // (mais profissional que o nome cru da planilha)
  function formatarNomeDePreco(p: PrecoBranorte): string {
    const cat = p.categoria
    const sub = p.subcategoria
    // Transportador Chupim: "chupim 160 x 3,5 m" → "TRANSPORTADOR HELICOIDAL 160 X 3,5 M"
    if (cat === 'TRANSPORTADOR' && sub === 'CHUPIM') {
      const m = p.descricao.match(/chupim\s+(\d+)\s*[xX]\s*([\d,.]+)\s*m/i)
      if (m) return `TRANSPORTADOR HELICOIDAL ${m[1]} X ${m[2]} M`
    }
    // Transportador Calha (TH): "TH 250 X 5,0 m" → "TRANSPORTADOR HELICOIDAL CALHA TH 250 X 5,0 M"
    if (cat === 'TRANSPORTADOR' && sub === 'TH') {
      const m = p.descricao.match(/TH\s+(\d+)\s*[xX]\s*([\d,.]+)\s*m/i)
      if (m) return `TRANSPORTADOR HELICOIDAL CALHA TH ${m[1]} X ${m[2]} M`
    }
    // Default: usa descrição mas em UPPERCASE
    return p.descricao.toUpperCase()
  }

  // REGRA DE NEGOCIO: SO Caçamba de Pesagem puxa balança eletrônica 2000kg
  // como componente adicional. Compacta 02/03 sozinho NAO puxa mais (usuario
  // pediu pra so puxar quando tiver cacamba).
  function autoAdicionarBalancaSeCompacta(nomeItem: string, categoriaItem?: string) {
    const nome = nomeItem.toUpperCase()
    const eCacamba = categoriaItem === 'CACAMBA_PESAGEM' || /CA[ÇC]AMBA.*PESAGEM/i.test(nome)
    if (!eCacamba) return

    const NOME_BALANCA = 'Balança Eletrônica'
    // Match relaxado (qualquer 'Balança Eletrônica' nos componentes ja conta)
    const jaExiste = componentesExtras.some(c =>
      /balan.a.*el.tr.nica/i.test(c.nome.trim())
    )
    if (jaExiste) return

    // Busca preco da Balanca Eletronica 2000kg no cadastro
    const balancaPreco = (precos ?? []).find(p =>
      p.categoria === 'BALANCA' && /balan.a.*el.tr.nica.*2000/i.test(p.descricao)
    )
    const valor = balancaPreco?.valor_equipamento ? Number(balancaPreco.valor_equipamento) : 8728

    setComponentesExtras(arr => [...arr, {
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nome: NOME_BALANCA,
      valor,
    }])
  }

  // ========================================================================
  // INTELIGENCIA DEFINITIVA — BALANÇA NUNCA MAIS COMO ITEM
  // ========================================================================
  // Esta logica garante que balança eletronica NUNCA aparece como item
  // (letra A/B/C/F/etc) no carrinho. Se detectar, MOVE pra componentes_extras
  // automaticamente. Idempotente — roda sempre que carrinho/extras muda.
  //
  // Cobre TODOS os cenarios:
  //   - Vendedor adiciona Compacta 02/03 → balança vai pros extras
  //   - Carregar modelo antigo que tinha balança como item → migra automaticamente
  //   - Load draft com balança como item → migra automaticamente
  //   - Abrir orçamento salvo antigo que tinha balança como item → migra
  //   - Vendedor manualmente adiciona "Balança" pelo catalogo → migra pros extras
  // ========================================================================
  useEffect(() => {
    if (!precos) return
    const BALANCA_RE = /balan.a.*el.tr.nica/i

    // 1) Remove qualquer item-balança do carrinho e renumera letras
    const balancaNoCarrinho = carrinho.findIndex(it => BALANCA_RE.test(it.nome))
    if (balancaNoCarrinho !== -1) {
      const valor = Number(carrinho[balancaNoCarrinho].valor) || 8728
      setCarrinho(c => c.filter((_, i) => i !== balancaNoCarrinho))
      // Adiciona como componente extra se ainda nao tem
      setComponentesExtras(arr => {
        if (arr.some(c => BALANCA_RE.test(c.nome.trim()))) return arr
        return [...arr, {
          id: `migrated-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          nome: 'Balança Eletrônica',
          valor,
        }]
      })
      return // sai pra rodar de novo apos o estado atualizar
    }

    // 2) Auto-add SO quando tem CAÇAMBA DE PESAGEM no carrinho.
    // (Antes puxava em Compacta 02/03 tambem, mas usuario pediu pra restringir
    // so a casos com cacamba.)
    const temCacamba = carrinho.some(it =>
      it.categoria === 'CACAMBA_PESAGEM' || /CA[ÇC]AMBA.*PESAGEM/i.test(it.nome)
    )
    if (!temCacamba) return
    const jaTemBalanca = componentesExtras.some(c => BALANCA_RE.test(c.nome.trim()))
    if (jaTemBalanca) return
    const balancaPreco = precos.find(p =>
      p.categoria === 'BALANCA' && /balan.a.*el.tr.nica.*2000/i.test(p.descricao)
    )
    const valor = balancaPreco?.valor_equipamento ? Number(balancaPreco.valor_equipamento) : 8728
    setComponentesExtras(arr => [...arr, {
      id: `auto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      nome: 'Balança Eletrônica',
      valor,
    }])
  }, [carrinho, precos, componentesExtras])

  // Adiciona item ao carrinho direto de uma entrada de precos_branorte.
  // Faz lookup do catalogo_items linkado (via preco_branorte_id) pra puxar
  // foto e specs curadas. Se não tiver match, gera specs dinamicamente.
  // chupimOpts: override de material/inclinação POR ITEM (vem do modal de confirmação).
  function adicionarItemDePreco(
    p: PrecoBranorte,
    categoriaForcada?: string,
    chupimOpts?: { material: MaterialChupim; inclinacao: InclinacaoChupim; polos?: 4 | 6; funcao?: TransportadorFuncao },
    quantidade?: number,
  ) {
    const cat = categoriaForcada ?? p.categoria

    // Bug #27: detecta duplicata de Balança Eletrônica também via PrecoBranorte.
    // (Caçamba auto-adiciona Balança; vendedor não deve poder adicionar outra avulsa
    // sem alerta — evita somar 2x no total geral do orçamento.)
    const dupP = detectarBalancaDuplicada(
      { categoria: cat, nome: p.descricao },
      carrinho,
      componentesExtras,
    )
    if (dupP.duplicada) {
      const prosseguir = window.confirm(
        `Atenção: balança duplicada.\n\n${dupP.motivo}\n\nAdicionar mesmo assim? (vai contabilizar 2x no total)`
      )
      if (!prosseguir) return
    }

    // Tenta achar o catalogo_item linkado via preco_branorte_id
    const ciLinkado = (items ?? []).find(ci => ci.preco_branorte_id === p.id && ci.ativo)

    // Specs: prefere as curadas do catalogo_item; senão gera dinamicamente
    let specsFinal: string[]
    if (ciLinkado && ciLinkado.specs && ciLinkado.specs.length > 0) {
      specsFinal = ciLinkado.specs
    } else {
      const specsGeradas: string[] = []
      // Extrai diâmetro e comprimento (chupim/TH 160 x 3,5 m)
      const mDim = p.descricao.match(/(\d{2,3})\s*[xX]\s*([\d,\.]+)\s*m/i)
      if (mDim && cat === 'TRANSPORTADOR') {
        specsGeradas.push(`Diâmetro: ${mDim[1]} mm`)
        specsGeradas.push(`Comprimento: ${mDim[2]} metros`)
        specsGeradas.push('Construção: Tubo em chapa n. 14')
        specsGeradas.push('Hélice em chapa expandida, unidas por mancais.')
        specsGeradas.push('Funil de entrada medindo 500 mm x 500 mm')
      }
      if (p.capacidade) {
        specsGeradas.push(`Capacidade/Produção: ${p.capacidade.replace('TON/H', 'ton/hora')}`)
      }
      if (p.capacidade_litros) {
        specsGeradas.push(`Volume: ${p.capacidade_litros} L`)
      }
      if (p.dimensoes) {
        specsGeradas.push(`Dimensões: ${p.dimensoes} mm`)
      }
      if (p.potencia) {
        // CHUPIM = motor avulso (não incluso). TH = motorredutor incluso. Resto: sem sufixo.
        const sufixo = cat === 'TRANSPORTADOR' && p.subcategoria === 'CHUPIM'
          ? ' (motor não incluso)'
          : cat === 'TRANSPORTADOR' && p.subcategoria === 'TH'
            ? ' (motorredutor incluso)'
            : ''
        specsGeradas.push(`Acionamento: potência ${p.potencia}${sufixo}`)
      }
      specsFinal = specsGeradas
    }

    // Motor: lookup no catalogo_motores via cv+polos
    let motor_valor_unit = 0
    let motor_polos = p.motor_polos ?? (ciLinkado?.motor_padrao_polos ?? 4)
    let motor_cv_n: number | null = p.motor_cv ?? (ciLinkado?.motor_padrao_cv ? Number(ciLinkado.motor_padrao_cv) : null)

    // CHUPIM: aplica fórmula oficial Branorte (POT=(C+(Q*L*K)/200)*b*1,36)
    // arredondando pro próximo motor maior. Substitui o motor padrão da planilha.
    // Usa override do modal se vendedor confirmou material/inclinação POR ITEM,
    // senão usa defaults da sessão.
    // CALHA TH NÃO entra: motorredutor já vem incluso no preço da TH.
    if (cat === 'TRANSPORTADOR' && p.subcategoria === 'CHUPIM') {
      const mat = chupimOpts?.material ?? chupimMaterial
      const inc = chupimOpts?.inclinacao ?? chupimInclinacao
      const rec = recomendarMotorChupim(p.descricao, p.capacidade, mat, inc)
      if (rec) {
        motor_cv_n = rec.cvMotor
        // Polos: vem da função do transportador (modal). Default 4. Algumas funções
        // (alimentação horizontal de silos, moinho martelo) usam 6 polos.
        // Monofásico sempre 4 polos.
        motor_polos = voltagem === 'trifasico' ? (chupimOpts?.polos ?? 4) : 4
        // Sincroniza a spec "Acionamento: potência X CV" com o motor recalculado
        // pra não ter conflito entre a descrição (planilha) e o motor cotado (fórmula).
        // Match flexível: substitui o número antes de "CV" na linha Acionamento.
        const acionamentoNovo = `Acionamento: potência ${formatCvSpec(rec.cvMotor)} CV ${motor_polos} polos (motor não incluso)`
        const idxAcc = specsFinal.findIndex(s => /^Acionamento\b/i.test(s))
        if (idxAcc >= 0) {
          specsFinal = [...specsFinal]
          specsFinal[idxAcc] = acionamentoNovo
        } else {
          specsFinal = [...specsFinal, acionamentoNovo]
        }
      }
    }

    if (motor_cv_n && motores) {
      const m = acharMotorCompativel(motores, Number(motor_cv_n), motor_polos, voltagem, voltagem === 'monofasico')
      if (m) motor_valor_unit = Number(m.valor)
    }

    // Detecta motor incluso pela spec (mesmo padrão usado no adicionarItem original)
    const motorIncluso = motorJaInclusoNoItem(specsFinal)

    // Foto: 1) catálogo linkado direto, 2) fallback por (subcategoria, diâmetro)
    // pra transportadores — todo chupim 160 mostra mesma foto independente do comprimento
    let fotoFinal: string | null = ciLinkado?.foto_url ?? null
    if (!fotoFinal && cat === 'TRANSPORTADOR' && p.subcategoria) {
      const { diametro } = detectarTransportador(p.descricao)
      if (diametro) {
        const mapa = montarMapaFotosTransportador(items ?? [])
        fotoFinal = mapa.get(`${p.subcategoria}:${diametro}`) ?? null
      }
    }

    // Nome do item: se tem função (chupim), concatena entre parênteses no fim.
    // Ex: "Chupim 160 x 3,5 m (Alimentação do silo)"
    const nomeBase = ciLinkado?.nome_curto || formatarNomeDePreco(p)
    const sufixoFuncao = chupimOpts?.funcao
      ? ` (${chupimOpts.funcao.nome_curto || chupimOpts.funcao.nome})`
      : ''
    // Valor por voltagem: precos_branorte tem valor_com_motor_trif/mono.
    // Item com inversor cota sempre como trif. Se houver valor com motor incluso,
    // motor_valor_unit vira 0 pra não cobrar 2x.
    const voltagemEfetivaPreco: Voltagem = ciLinkado?.usa_inversor ? 'trifasico' : voltagem
    const { valor: valorPreco, motorIncluso: motorInclusoNoPreco } = valorPorVoltagem(p, voltagemEfetivaPreco)
    const motorEfetivoVal = motorInclusoNoPreco ? 0 : (motorIncluso ? 0 : motor_valor_unit)
    setCarrinho(c => [...c, {
      uid: gerarUid(),
      catalogo_id: ciLinkado?.id ?? -1,
      categoria: cat,
      nome: nomeBase + sufixoFuncao,
      specs: specsFinal,
      qtd: quantidade ?? 1,
      valor: Math.round(valorPreco),
      valor_original: Math.round(valorPreco),
      motor_cv: motor_cv_n ? Number(motor_cv_n) : null,
      motor_polos: motor_polos,
      motor_qtd: ciLinkado?.motor_padrao_qtd ?? 1,
      motor_valor_unit: motorEfetivoVal,
      foto_url: fotoFinal,
      usa_inversor: !!(ciLinkado?.usa_inversor),
      preco_branorte_id: p.id,
    }])
    autoAdicionarBalancaSeCompacta(nomeBase, cat)
  }

  function adicionarItem(item: CatalogoItem, funcaoEscolhida?: string) {
    // Bug #27: detecta duplicata de Balança Eletrônica (Caçamba já auto-adiciona uma).
    // Bloqueia adicao com confirmação explícita pra evitar somar 2x no total.
    const dup = detectarBalancaDuplicada(
      { categoria: item.categoria, nome: item.nome_curto },
      carrinho,
      componentesExtras,
    )
    if (dup.duplicada) {
      const prosseguir = window.confirm(
        `Atenção: balança duplicada.\n\n${dup.motivo}\n\nAdicionar mesmo assim? (vai contabilizar 2x no total)`
      )
      if (!prosseguir) return
    }

    // Transportadores da busca lateral: abre cálculo de motor direto com esse item
    if (item.categoria === 'TRANSPORTADOR' && funcaoEscolhida === undefined) {
      // Tenta achar o PrecoBranorte correspondente pra abrir o ConfirmarChupimModal
      const precoMatch = item.preco_branorte_id
        ? transportadores.find(t => t.id === item.preco_branorte_id)
        : transportadores.find(t => {
            const tDiam = t.descricao?.match(/(\d{3})\s*[xX]/)?.[1]
            const tComp = t.descricao?.match(/(\d+[.,]?\d*)\s*[mM]/)?.[1]
            if (!tDiam || !tComp) return false
            const itemDiam = item.nome_curto?.match(/(\d{3})\s*[xX]/)?.[1]
            const itemComp = item.nome_curto?.match(/(\d+[.,]?\d*)\s*[mM]/)?.[1]
            return itemDiam === tDiam && itemComp === tComp
          })
      if (precoMatch && (precoMatch.subcategoria === 'CHUPIM' || precoMatch.subcategoria === 'TH')) {
        setConfirmarChupim(precoMatch)
        return
      }
      // Fallback: abre picker completo
      setTransportadorPickerOpen(true)
      return
    }

    // Se o item tem multiplas funcoes e o vendedor ainda nao escolheu,
    // abre o modal pra escolher. Adicao real acontece no callback do modal.
    if (
      item.funcao_opcoes && item.funcao_opcoes.length > 1
      && funcaoEscolhida === undefined
    ) {
      setEscolherFuncaoFor(item)
      return
    }

    const specs = item.specs || []
    const motorIncluso = motorJaInclusoNoItem(specs)

    // Item com inversor: motor sempre cotado como trifasico (cheaper),
    // mesmo se vendedor marcou monofasico no header.
    const voltagemEfetiva: Voltagem = item.usa_inversor ? 'trifasico' : voltagem

    const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos && motores
      ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagemEfetiva, voltagemEfetiva === 'monofasico')
      : null

    // Se item está linkado a precos_branorte, usa valor_com_motor_trif/mono conforme voltagem.
    // Senão, fallback pra item.valor do catálogo (single value).
    const precoLinkado = item.preco_branorte_id
      ? (precos ?? []).find(p => p.id === item.preco_branorte_id)
      : null
    const { valor: valorEscolhido, motorIncluso: motorInclusoPorPreco } = precoLinkado
      ? valorPorVoltagem(precoLinkado, voltagemEfetiva)
      : { valor: Number(item.valor), motorIncluso: false }
    const motorVal = (motorInclusoPorPreco || motorIncluso) ? 0 : (motorMatch ? Number(motorMatch.valor) : 0)

    // Se a funcao deve aparecer no PDF, sufixa no nome_custom. Caso contrario,
    // preserva o nome generico (funcao fica so em funcao_selecionada, uso interno).
    const funcao = funcaoEscolhida ?? (item.funcao_opcoes?.[0] ?? null)
    const nomeCustom = funcao && !item.ocultar_funcao_no_pdf
      ? `${item.nome_curto} (${funcao})`
      : null

    setCarrinho(c => [...c, {
      uid: gerarUid(),
      catalogo_id: item.id,
      categoria: item.categoria,
      nome: item.nome_curto,
      nome_custom: nomeCustom,
      specs,
      qtd: 1,
      valor: Math.round(valorEscolhido),
      valor_original: Math.round(valorEscolhido),
      motor_cv: item.motor_padrao_cv ? Number(item.motor_padrao_cv) : null,
      motor_polos: item.motor_padrao_polos,
      motor_qtd: item.motor_padrao_qtd || 1,
      motor_valor_unit: motorVal,
      foto_url: item.foto_url || null,
      usa_inversor: !!item.usa_inversor,
      funcao_selecionada: funcao,
      ocultar_funcao_no_pdf: !!item.ocultar_funcao_no_pdf,
      preco_branorte_id: item.preco_branorte_id ?? null,
      // Snapshot dos motores extras — não viram linha no carrinho, só somam em MOTORES TRIFÁSICOS
      motores_extras_snapshot: Array.isArray(item.motores_extras) && item.motores_extras.length > 0
        ? item.motores_extras
        : undefined,
    }])
    autoAdicionarBalancaSeCompacta(item.nome_curto, item.categoria)
  }

  function removerItem(uid: string) {
    setCarrinho(c => c.filter(it => it.uid !== uid))
  }

  function alterarQtd(uid: string, novaQtd: number) {
    if (novaQtd < 1) return
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, qtd: novaQtd } : it))
  }

  function alterarValor(uid: string, novoValor: number) {
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, valor: novoValor } : it))
  }

  function alterarNome(uid: string, novoNome: string) {
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, nome_custom: novoNome } : it))
  }

  // Parte do valor base que corresponde ao MOTOR embutido no preço (precos_branorte
  // com valor_com_motor_trif/mono). O fator de inox/markup do equipamento NÃO deve
  // multiplicar o motor. Retorna 0 quando o motor é avulso (linha separada), não há
  // preço linkado, ou não há motor incluso — nesses casos o valor base já é só equipamento.
  function motorContributionDoItem(it: CarrinhoItem): number {
    const precoLinkado = it.preco_branorte_id
      ? (precos ?? []).find(p => p.id === it.preco_branorte_id)
      : null
    if (!precoLinkado) return 0
    const voltagemEfetiva: Voltagem = it.usa_inversor ? 'trifasico' : voltagem
    const { valor: valorComMotor, motorIncluso } = valorPorVoltagem(precoLinkado, voltagemEfetiva)
    if (!motorIncluso) return 0
    const equipV = precoLinkado.valor_equipamento != null ? Number(precoLinkado.valor_equipamento) : 0
    const portion = valorComMotor - equipV
    return portion > 0 ? portion : 0
  }

  function toggleInox(uid: string, tipo?: '304' | '316' | false) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== uid) return it
      // Se tipo explícito, usa ele; senão desativa
      const proximo = tipo !== undefined ? tipo : false

      if (!proximo) {
        return { ...it, inox: false, valor: it.valor_original, specs: it.specs_original || it.specs, specs_original: undefined }
      }

      const fator = proximo === '304' ? 2.5 : 3.5
      // Inox multiplica SÓ o equipamento, não o motor incluso. Separa a parte do motor
      // do valor base, aplica o fator só no equipamento e soma o motor de volta intacto
      // (a não ser que o motor tenha sido removido do item).
      const motorContribution = motorContributionDoItem(it)
      const equipBase = it.valor_original - motorContribution
      const motorBack = it.motor_removido ? 0 : motorContribution
      const novoValor = Math.round((equipBase * fator + motorBack) * 100) / 100
      const specsOriginal = it.specs_original || it.specs.slice()
      const label = `Inox ${proximo}`
      const novasSpecs = specsOriginal.map(s => {
        if (/corpo\s*em\s*chapa/i.test(s) || /constru[ií]do\s*em\s*a[çc]o/i.test(s)) {
          return `Construído em chapa **${label}**`
        }
        return s
          .replace(/a[çc]o\s*galvanizado/gi, `**${label}**`)
          .replace(/galvanizado/gi, `**${label}**`)
          .replace(/a[çc]o\s*carbono/gi, `**${label}**`)
          .replace(/a[çc]o\s*SAE\s*\d+/gi, `**${label}**`)
      })
      return { ...it, inox: proximo, valor: novoValor, specs: novasSpecs, specs_original: specsOriginal }
    }))
  }

  // Toggle Tungstênio: valor unitário do martelo = R$ 99 (só pra jogos de martelo)
  function toggleTungstenio(uid: string) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== uid) return it
      const ativando = !it.tungstenio
      if (ativando) {
        // Extrair qtd martelos das specs (ex: "Quantidade: 16 martelos")
        const specMartelo = it.specs.find(s => /\d+\s*martelo/i.test(s))
        const matchQtd = specMartelo?.match(/(\d+)\s*martelo/i)
        const qtdMartelos = matchQtd ? parseInt(matchQtd[1]) : 16
        const novoValor = qtdMartelos * 99
        const specsOriginal = it.specs_original || it.specs.slice()
        const novasSpecs = specsOriginal.map(s =>
          /material|a[çc]o\s*tratado/i.test(s) ? 'Material: Tungstênio' : s
        )
        return { ...it, tungstenio: true, valor: novoValor, valor_original: it.valor_original, specs: novasSpecs, specs_original: specsOriginal }
      } else {
        return { ...it, tungstenio: false, valor: it.valor_original, specs: it.specs_original || it.specs, specs_original: undefined }
      }
    }))
  }

  function alterarSpec(uid: string, idx: number, valor: string) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== uid) return it
      const novas = it.specs.slice()
      novas[idx] = valor

      // Moinho martelo: se mudou peneira, recalcula capacidade automaticamente
      // Pen 3mm usa tabela real (valores comerciais arredondados)
      // Outras peneiras: Q = CV × 0.7457 × pen(mm) × 45
      const MOINHO_CAP_3MM: Record<number, number> = {
        7.5: 1000, 10: 1000, 15: 1800, 20: 2000,
        30: 3000, 50: 5000, 75: 7500, 100: 10000,
      }
      const isMoinho = (it.nome || '').toLowerCase().includes('moinho') || novas.some(s => s.toLowerCase().includes('martelo'))
      if (isMoinho && /peneira/i.test(valor)) {
        const penMatch = valor.match(/(\d+[.,]?\d*)\s*mm/i)
        if (penMatch) {
          const penMm = parseFloat(penMatch[1].replace(',', '.'))
          const cv = it.motor_cv || 0
          if (cv > 0 && penMm > 0) {
            let novaCapacidade: number
            if (penMm === 3 && MOINHO_CAP_3MM[cv]) {
              // Peneira 3mm: usa valor real da tabela comercial
              novaCapacidade = MOINHO_CAP_3MM[cv]
            } else {
              // Outras peneiras: calcula proporcional a partir da ref 3mm
              const ref3mm = MOINHO_CAP_3MM[cv]
              if (ref3mm) {
                novaCapacidade = Math.round(ref3mm * penMm / 3)
              } else {
                novaCapacidade = Math.round(cv * 0.7457 * penMm * 45)
              }
            }
            const capIdx = novas.findIndex(s => /capacidade/i.test(s))
            if (capIdx >= 0) {
              novas[capIdx] = novas[capIdx].replace(
                /\d[\d.]*\s*kg\/h.*/i,
                `${novaCapacidade.toLocaleString('pt-BR')} kg/h (na densidade do milho e peneira ${penMm.toLocaleString('pt-BR')}mm)`
              )
            }
          }
        }
      }

      return { ...it, specs: novas }
    }))
  }

  // Insere uma linha de descrição vazia logo após `idx` (idx = posição real na
  // array it.specs; quando vem do botão "+ adicionar linha" é it.specs.length = fim).
  function adicionarSpec(uid: string, idx: number) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== uid) return it
      const novas = it.specs.slice()
      const pos = Math.min(Math.max(idx, 0), novas.length)
      novas.splice(pos, 0, 'Nova linha')
      return { ...it, specs: novas }
    }))
  }

  // Remove a linha de descrição no índice real `idx`.
  function removerSpec(uid: string, idx: number) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== uid) return it
      if (idx < 0 || idx >= it.specs.length) return it
      const novas = it.specs.slice()
      novas.splice(idx, 1)
      return { ...it, specs: novas }
    }))
  }

  function limparCarrinho() {
    // Detecta se ha qualquer coisa pra limpar (carrinho OU dados auxiliares)
    const temAlgoPraLimpar = carrinho.length > 0
      || !!fotoPrincipal
      || !!acessorios
      || !!descontoCfg
      || !!prazoEntregaTxt
      || !!formaPagamentoTxt
      || parcelasPagamento.length > 0
      || componentesExtras.length > 0
      || !!clienteDados.nome
      || !!tensaoMotores
    if (!temAlgoPraLimpar) return
    if (!confirm('Limpar TUDO do orçamento? (itens, cliente, foto, forma de pagamento, observações)')) return
    // Reseta orcamento inteiro pro estado inicial
    setCarrinho([])
    setFotoPrincipal(null)
    setAcessorios(null)
    setDescontoCfg(null)
    setPrazoEntregaTxt('')
    setFormaPagamentoTxt('')
    setParcelasPagamento([])
    setComponentesExtras([])
    setObsPorConta(null)
    setClienteDados({})
    setTensaoMotores(null)
    setDataVendaTxt('') // "a combinar" por padrão (roadmap #36)
    setVoltagem('trifasico')
    // Reseta frete pro default legado (FOB + texto vazio = "por conta do cliente")
    setFreteTipo('FOB')
    setFreteTxt('')
    // initialModal e usado pra hidratar o modal Finalizar — limpa tambem
    setInitialModal(null)
  }

  function moverItem(uid: string, direcao: 'cima' | 'baixo') {
    setCarrinho(c => {
      const idx = c.findIndex(it => it.uid === uid)
      if (idx === -1) return c
      const novo = idx + (direcao === 'cima' ? -1 : 1)
      if (novo < 0 || novo >= c.length) return c
      const novaLista = [...c]
      const [item] = novaLista.splice(idx, 1)
      novaLista.splice(novo, 0, item)
      return novaLista
    })
  }

  // Atualiza specs do item refletindo o novo motor (substitui CV e polos
  // nas linhas relacionadas a acionamento/motor/potencia).
  function atualizarSpecsComMotor(
    specs: string[], novoCv: number, novoPolos: number,
  ): string[] {
    // Formato BR: 10 → "10", 1.5 → "1,5"
    const cvStr = Number.isInteger(novoCv) ? String(novoCv) : String(novoCv).replace('.', ',')
    // Regex de CV: aceita "10 CV", "1,5 CV", "1.5CV", "1.5 cv"
    const reCv = /(\d+(?:[,.]\d+)?)\s*CV\b/gi
    // Regex de polos: "4 polos", "2 polos"
    const rePolos = /(\d)\s*polos?\b/gi
    // Palavras que indicam que a linha eh sobre o motor
    const motorKw = /acionamento|motorredutor|moto\s*redutor|pot[êe]ncia|\bcv\b|polos?/i

    return specs.map(line => {
      if (!motorKw.test(line)) return line
      // Substitui CV mantendo a unidade
      let novo = line.replace(reCv, `${cvStr} CV`)
      // Substitui polos
      novo = novo.replace(rePolos, `${novoPolos} polos`)
      return novo
    })
  }

  // Atualiza o nome do item refletindo o novo motor — só se o nome JA continha CV
  // (ex: "TRITURADOR DE GRÃOS 10 CV" -> "TRITURADOR DE GRÃOS 20 CV").
  // Caso contrario mantem o nome intacto (nem todo item tem CV no nome).
  function atualizarNomeComMotor(nome: string, novoCv: number): string {
    const cvStr = Number.isInteger(novoCv) ? String(novoCv) : String(novoCv).replace('.', ',')
    const reCv = /(\d+(?:[,.]\d+)?)\s*CV\b/i
    if (!reCv.test(nome)) return nome
    return nome.replace(reCv, `${cvStr} CV`)
  }

  // Troca o motor de um item especifico do carrinho. Usado pelo picker no preview.
  // motorIndex: quando item tem 2 motores na spec (ex: "15 CV e 2 CV"), indica qual trocar (0 ou 1).
  // Marca/desmarca o motor de um item como "por conta do cliente" — Branorte não cobra, mostra texto.
  function marcarMotorPorContaCliente(itemUid: string, isPorConta: boolean, motorIndex?: number) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== itemUid) return it
      // Motor único (sem índice): flag do item inteiro (comportamento legado).
      if (motorIndex == null) return { ...it, motor_por_conta_cliente: isPorConta }
      // Multi-motor: marca SÓ o motorIndex clicado.
      const cur = it.motores_por_conta_idx ?? []
      const next = isPorConta
        ? Array.from(new Set([...cur, motorIndex]))
        : cur.filter(i => i !== motorIndex)
      return { ...it, motores_por_conta_idx: next }
    }))
  }

  // Marca/desmarca o motor de um item como INCLUSO no preço do equipamento — não cobra à
  // parte, mostra "incluso". Override manual pra quando a auto-detecção por spec não pegou.
  function marcarMotorIncluso(itemUid: string, isIncluso: boolean, motorIndex?: number) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== itemUid) return it
      if (motorIndex == null) return { ...it, motor_incluso_manual: isIncluso }
      const cur = it.motores_incluso_idx ?? []
      const next = isIncluso
        ? Array.from(new Set([...cur, motorIndex]))
        : cur.filter(i => i !== motorIndex)
      return { ...it, motores_incluso_idx: next }
    }))
  }

  // Issue #23: REMOVE o motor de um item. Cliente não quer motor — Branorte vende só o
  // equipamento. Quando o motor estava INCLUSO no preço (precos_branorte com
  // valor_com_motor_trif/mono), recalcula o valor pro valor_equipamento (sem motor).
  // Quando o motor era avulso (motor_valor_unit > 0), o agruparMotores skipará a linha,
  // o que zera o totalMotores — não precisa mexer no valor do item.
  // Para reverter, restaurarMotorDoItem volta valor_pre_remocao.
  function removerMotorDoItem(itemUid: string, motorIndex?: number) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== itemUid) return it
      // Multi-motor: remove SÓ o motorIndex clicado. Esses motores são linhas
      // separadas (avulsas) na tabela — não entram no valor do item, então não
      // recalcula it.valor; só marca o índice como removido (zerado em agruparMotores).
      if (motorIndex != null) {
        const cur = it.motores_removidos_idx ?? []
        if (cur.includes(motorIndex)) return it
        return { ...it, motores_removidos_idx: [...cur, motorIndex] }
      }
      if (it.motor_removido) return it  // já removido, no-op
      // Motor único: motorContributionDoItem retorna a PORÇÃO do motor embutida no valor
      // (sem o fator de inox/tungstênio). Subtrair essa porção do valor ATUAL funciona com
      // OU sem inox/tungstênio. Antes só subtraía quando NÃO havia inox/tungstênio →
      // remover motor com Inox ligado deixava o motor sendo cobrado.
      const motorContribution = motorContributionDoItem(it)
      const valorRecalculado = motorContribution > 0
        ? Math.round(it.valor - motorContribution)
        : it.valor
      return {
        ...it,
        motor_removido: true,
        valor_pre_remocao: it.valor,
        valor: valorRecalculado,
      }
    }))
  }

  function restaurarMotorDoItem(itemUid: string, motorIndex?: number) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== itemUid) return it
      // Multi-motor: restaura SÓ o motorIndex clicado.
      if (motorIndex != null) {
        const cur = it.motores_removidos_idx ?? []
        return { ...it, motores_removidos_idx: cur.filter(i => i !== motorIndex) }
      }
      if (!it.motor_removido) return it
      // Motor único: soma a porção do motor de volta ao valor ATUAL (que já reflete
      // inox/tungstênio aplicados após a remoção). Antes reusava valor_pre_remocao cru
      // — snapshot PRÉ-material — e perdia a valorização do inox.
      const motorContribution = motorContributionDoItem(it)
      const valorRestaurado = motorContribution > 0
        ? Math.round(it.valor + motorContribution)
        : (it.valor_pre_remocao != null ? it.valor_pre_remocao : it.valor)
      return {
        ...it,
        motor_removido: false,
        valor: valorRestaurado,
        valor_pre_remocao: null,
      }
    }))
  }

  function trocarMotorDoItem(itemUid: string, novoMotor: CatalogoMotor, motorIndex?: number) {
    setCarrinho(c => c.map(it => {
      if (it.uid !== itemUid) return it
      const incluso = motorJaInclusoNoItem(it.specs)
      const novoCv = Number(novoMotor.cv)
      const novoPolos = novoMotor.polos

      // Motor EXTRA (motorIndex 100+N): troca só o N-ésimo de motores_extras_snapshot,
      // sem tocar no motor principal / spec / nome. Antes caía no ramo "motor único"
      // e sobrescrevia o motor principal do item.
      if (motorIndex != null && motorIndex >= 100) {
        const extraArrIdx = motorIndex - 100
        const arr = [...(it.motores_extras_snapshot ?? [])]
        if (arr[extraArrIdx]) {
          arr[extraArrIdx] = { ...arr[extraArrIdx], cv: novoCv, polos: novoPolos }
        }
        return { ...it, motores_extras_snapshot: arr }
      }

      // Item com múltiplos motores na spec (ex: misturador c/ aquecimento, pré-limpeza):
      // só troca o CV da N-ésima ocorrência (motorIndex 0 = primeiro, 1 = segundo, etc).
      // Usa matchAll pra achar TODAS as ocorrências de "X CV" e mexe só na do índice.
      // Antes: regex restritivo a "CV e CV" / "CV, CV" / "CV + CV" — não pegava casos
      // como "10 CV e motor do exaustor de 10 CV" (texto livre entre os CVs).
      if (motorIndex != null) {
        const specIdx = it.specs.findIndex(s => /acionamento|motorredutor|pot[êe]ncia/i.test(s))
        if (specIdx >= 0) {
          const spec = it.specs[specIdx]
          const todasOcorrencias = [...spec.matchAll(/(\d+(?:[.,]\d+)?)\s*CV/gi)]
          if (todasOcorrencias.length >= 2 && motorIndex < todasOcorrencias.length) {
            const alvo = todasOcorrencias[motorIndex]
            const startIdx = alvo.index ?? 0
            const lenAntiga = alvo[0].length
            const cvStr = Number.isInteger(novoCv) ? String(novoCv) : String(novoCv).replace('.', ',')
            const novaSpec = spec.slice(0, startIdx) + `${cvStr} CV` + spec.slice(startIdx + lenAntiga)
            const novasSpecs = [...it.specs]
            novasSpecs[specIdx] = novaSpec
            // Atualiza motor_cv só pro principal (index 0); secundários ficam só no spec.
            const newMainCv = motorIndex === 0 ? novoCv : it.motor_cv
            return { ...it, specs: novasSpecs, motor_cv: newMainCv }
          }
        }
      }

      // Motor único: troca tudo como antes
      return {
        ...it,
        motor_cv: novoCv,
        motor_polos: novoPolos,
        motor_valor_unit: incluso ? 0 : Number(novoMotor.valor),
        specs: atualizarSpecsComMotor(it.specs, novoCv, novoPolos),
        nome: atualizarNomeComMotor(it.nome, novoCv),
        nome_custom: it.nome_custom ? atualizarNomeComMotor(it.nome_custom, novoCv) : it.nome_custom,
      }
    }))
  }

  function aplicarVoltagem(novaVoltagem: Voltagem) {
    setVoltagem(novaVoltagem)
    if (!motores) return
    setCarrinho(c => c.map(it => {
      if (!it.motor_cv || !it.motor_polos) return it
      // Item com inversor: cotar sempre como trifásico, polos não muda.
      const voltagemEfetiva: Voltagem = it.usa_inversor ? 'trifasico' : novaVoltagem
      // Monofásico só existe em 4 polos. Se trocou pra mono e item tinha 6 polos,
      // força 4 polos + atualiza specs/nome pra refletir. Tri mantém os polos atuais
      // (pode ter sido escolhido por função de transportador 6 polos, etc.).
      const polosFinais = (voltagemEfetiva === 'monofasico' && it.motor_polos !== 4) ? 4 : it.motor_polos
      const polosMudou = polosFinais !== it.motor_polos
      // Motor incluso continua com valor 0 mesmo ao trocar voltagem.
      const incluso = motorJaInclusoNoItem(it.specs)
      const motor = acharMotorCompativel(motores, it.motor_cv, polosFinais, voltagemEfetiva, voltagemEfetiva === 'monofasico')
      // Recalcula valor do equipamento por voltagem quando linkado a precos_branorte.
      // Pula se item tem inox/tungstenio (valor_original é base de cálculo desses fatores).
      const precoLinkado = it.preco_branorte_id
        ? (precos ?? []).find(p => p.id === it.preco_branorte_id)
        : null
      const podeRecalcularValor = precoLinkado && !it.inox && !it.tungstenio
      const { valor: novoValor, motorIncluso: motorInclusoPorPreco } = podeRecalcularValor
        ? valorPorVoltagem(precoLinkado, voltagemEfetiva)
        : { valor: it.valor, motorIncluso: false }
      // Issue #23: se o vendedor REMOVEU o motor e o preço inclui o motor, trocar a
      // voltagem NÃO pode reinserir o custo do motor. Mantém valor_equipamento (sem motor)
      // e guarda o valor-com-motor da nova voltagem em valor_pre_remocao (pra restaurar certo).
      const motorRemovidoIncluso = !!(podeRecalcularValor && it.motor_removido && motorInclusoPorPreco)
      const equipVolt = (motorRemovidoIncluso && precoLinkado!.valor_equipamento != null)
        ? Number(precoLinkado!.valor_equipamento)
        : novoValor
      const valorAtualizado = podeRecalcularValor ? Math.round(equipVolt) : it.valor
      const valorOriginalAtualizado = podeRecalcularValor ? Math.round(equipVolt) : it.valor_original
      const preRemocaoAtualizado = motorRemovidoIncluso ? Math.round(novoValor) : it.valor_pre_remocao
      const motorEfetivoVal = (motorInclusoPorPreco || incluso)
        ? 0
        // Mono sem motor cadastrado nessa voltagem: zera (mostra "sem motor cadastrado /
        // a confirmar") em vez de manter um preço trifásico antigo e subcobrar.
        : (motor ? Number(motor.valor) : (voltagemEfetiva === 'monofasico' ? 0 : it.motor_valor_unit))
      return {
        ...it,
        motor_polos: polosFinais,
        motor_valor_unit: motorEfetivoVal,
        valor: valorAtualizado,
        valor_original: valorOriginalAtualizado,
        valor_pre_remocao: preRemocaoAtualizado,
        specs: polosMudou ? atualizarSpecsComMotor(it.specs, it.motor_cv, polosFinais) : it.specs,
      }
    }))
  }

  // Carrega um modelo pronto (orcamento_modelos) no carrinho do Montar Custom
  function carregarDoModelo(modelo: OrcamentoModelo, append = false) {
    if (!append && carrinho.length > 0 && !confirm('Substituir os items atuais pelos do modelo?')) return
    const catalogoItems = items ?? []
    const fotoMapTransp = montarMapaFotosTransportador(catalogoItems)

    // Helpers locais ---------------------------------------------------------

    // Extrai CV de um spec ou nome de item. Ex: "potência 2,0 CV" → 2.0
    function extrairCvDeTexto(...textos: string[]): number | null {
      for (const t of textos) {
        if (!t) continue
        const m = t.match(/(\d+(?:[.,]\d+)?)\s*CV\b/i)
        if (m) return parseFloat(m[1].replace(',', '.'))
      }
      return null
    }

    // Normaliza nome (remove "(...)" sufixos, uppercase, sem acentos)
    // BUG FIX 2026-05-29 (v2): antes de remover "(...)", preserva capacidade em kg.
    // Item modelo: "MISTURADOR HORIZONTAL 900 LITROS (500 KG)"
    // Catalogo:    "Misturador Horizontal de 500 kg"
    // Sem o fix, "900 LITROS" não bate com "500 KG" e score fica 0.4. Com o fix,
    // extrai "500 KG" dos parens e substitui "N LITROS" → "M KG" antes de tokenizar.
    function normalizar(s: string): string {
      // Detecta padrão "<N> LITROS (<M> KG)" e troca por "<M> KG"
      const m = s.match(/(\d+(?:[.,]\d+)?)\s*LITROS?\s*\(\s*(\d+(?:[.,]\d+)?)\s*KG\s*\)/i)
      let pre = s
      if (m) {
        pre = s.replace(m[0], `${m[2]} KG`)
      }
      return pre
        .normalize('NFKD').replace(/[̀-ͯ]/g, '')
        .replace(/\(.+?\)/g, '')  // remove "(motor não incluso)", "(Incluso)", etc
        .replace(/[^A-Za-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim().toUpperCase()
    }

    // Acha o catalogo_item mais similar pelo nome.
    // BUG FIX 2026-05-29: modelos Master pediam "MISTURADOR HORIZONTAL ..."
    // mas o fuzzy match achava "Silo Misturador VERTICAL ..." pelo score
    // de tokens. Agora penaliza brutalmente quando orientação não bate.
    function acharCatalogoSimilar(nomeItem: string): CatalogoItem | null {
      const norm = normalizar(nomeItem)
      if (!norm) return null
      const itemHorizontal = norm.includes('HORIZONTAL')
      const itemVertical = norm.includes('VERTICAL')
      let melhor: { ci: CatalogoItem; score: number } | null = null
      for (const ci of catalogoItems) {
        if (!ci.ativo) continue
        const ciNorm = normalizar(ci.nome_curto)
        if (!ciNorm) continue
        const ciSub = (ci.subcategoria || '').toUpperCase()
        const ciHorizontal = ciNorm.includes('HORIZONTAL') || ciSub.includes('HORIZONTAL')
        const ciVertical = ciNorm.includes('VERTICAL') || ciSub === 'VERTICAL'
        // Guard de orientação: se modelo é HORIZONTAL e catalogo é VERTICAL (ou vice-versa) → descarta
        if (itemHorizontal && ciVertical && !ciHorizontal) continue
        if (itemVertical && ciHorizontal && !ciVertical) continue
        // Score: 1.0 se match exato; senão calcula fração de tokens em comum
        let score = 0
        if (ciNorm === norm) score = 1.0
        else if (norm.includes(ciNorm) || ciNorm.includes(norm)) score = 0.85
        else {
          const tokensA = new Set(norm.split(' ').filter(t => t.length >= 2))
          const tokensB = new Set(ciNorm.split(' ').filter(t => t.length >= 2))
          if (tokensA.size && tokensB.size) {
            let inter = 0
            tokensA.forEach(t => { if (tokensB.has(t)) inter++ })
            score = inter / Math.max(tokensA.size, tokensB.size)
          }
        }
        // Boost se orientação bate (ajuda a desempatar score 0.6)
        if ((itemHorizontal && ciHorizontal) || (itemVertical && ciVertical)) {
          score += 0.15
        }
        if (score >= 0.6 && (!melhor || score > melhor.score)) {
          melhor = { ci, score }
        }
      }
      return melhor?.ci ?? null
    }

    // Detecta subcategoria pra TRANSPORTADOR a partir do nome
    function detectarSubTransportador(nome: string): 'CHUPIM' | 'TH' | null {
      const n = normalizar(nome)
      if (!n.includes('TRANSPORTADOR') && !n.includes('CHUPIM') && !n.includes('CALHA')) return null
      return /CALHA|\bTH\b/.test(n) ? 'TH' : 'CHUPIM'
    }

    // -----------------------------------------------------------------------
    // 1) Pareia motores → itens pelo CV detectado no spec (em vez de round-robin)
    const motoresRestantes = [...modelo.motores]
    function pegarMotorPorCv(cvAlvo: number | null) {
      if (cvAlvo == null) return null
      const idx = motoresRestantes.findIndex(m => Math.abs(Number(m.cv) - cvAlvo) < 0.01)
      if (idx < 0) return null
      return motoresRestantes.splice(idx, 1)[0]
    }

    // 2) Constrói carrinho a partir dos itens do modelo
    const voltagemModelo: Voltagem = (modelo.voltagem === 'monofasico' ? 'monofasico' : 'trifasico')
    const novos: CarrinhoItem[] = []
    // BUG FIX #14 (2026-05-29): orcamentos legados salvavam motor avulso como item
    // (ex: 'Motor 3 cv 2 polos' reaparecia como 'G - 01 ...' ao editar id=201). Hoje
    // motores moram em o.motores e renderizam via motoresAgrupados. Pula items cujo
    // nome eh APENAS descricao de motor (sem equipamento associado).
    const SO_MOTOR_RE = /^\s*motor\s+\d+(?:[.,]\d+)?\s*cv\s+\d+\s*polos?\s*$/i
    modelo.itens.forEach(it => {
      if (SO_MOTOR_RE.test(it.nome || '')) return  // motor legado: pula, ja vai cair em MOTORES TRIFASICOS

      // ── Round-trip COMPLETO (2026-06-10) ──────────────────────────────────
      // Item salvo com __full=true (orçamento editado pós-fix): recarrega 1:1
      // usando os campos persistidos, SEM reconstruir do catálogo. Isso preserva
      // a foto manual, item custom (catalogo_id=-1), inox, tungstênio, motor,
      // função, motor por conta do cliente / removido, etc — que antes sumiam.
      const itAny = it as any
      if (itAny.__full === true) {
        const valorFull = Number(it.valor) || 0
        novos.push({
          uid: gerarUid(),
          catalogo_id: typeof itAny.catalogo_id === 'number' ? itAny.catalogo_id : -1,
          preco_branorte_id: itAny.preco_branorte_id ?? null,
          categoria: itAny.categoria || 'MODELO',
          nome: it.nome,
          specs: it.specs || [],
          specs_original: itAny.specs_original ?? undefined,
          qtd: it.qtd || 1,
          valor: valorFull,
          valor_original: typeof itAny.valor_original === 'number' ? itAny.valor_original : valorFull,
          motor_cv: itAny.motor_cv ?? null,
          motor_polos: itAny.motor_polos ?? null,
          motor_qtd: itAny.motor_qtd ?? 0,
          motor_valor_unit: itAny.motor_valor_unit ?? 0,
          foto_url: itAny.foto_url ?? null,
          usa_inversor: !!itAny.usa_inversor,
          funcao_selecionada: itAny.funcao_selecionada ?? null,
          ocultar_funcao_no_pdf: !!itAny.ocultar_funcao_no_pdf,
          inox: itAny.inox ?? false,
          tungstenio: !!itAny.tungstenio,
          brinde: !!itAny.brinde,
          por_conta_cliente: !!itAny.por_conta_cliente,
          motor_por_conta_cliente: !!itAny.motor_por_conta_cliente,
          motor_removido: !!itAny.motor_removido,
          valor_pre_remocao: itAny.valor_pre_remocao ?? null,
          motores_extras_snapshot: itAny.motores_extras_snapshot ?? undefined,
          motores_por_conta_idx: itAny.motores_por_conta_idx ?? undefined,
          motores_removidos_idx: itAny.motores_removidos_idx ?? undefined,
          motor_incluso_manual: !!itAny.motor_incluso_manual,
          motores_incluso_idx: itAny.motores_incluso_idx ?? undefined,
        })
        return
      }

      const ci = acharCatalogoSimilar(it.nome)
      // Acessório/peça avulsa (jogo de peneira, jogo de martelos, eixos e buchas) e peneira
      // passiva não têm motor próprio — ignora o CV do nome/spec (é a bitola do moinho).
      const semMotorProprio = ci?.categoria === 'ACESSORIO' || peneiraSemMotor(it.nome)
      const cvDoSpec = semMotorProprio ? null : extrairCvDeTexto(...(it.specs ?? []), it.nome)
      const motor = pegarMotorPorCv(cvDoSpec)

      // Categoria: do catálogo se achou, senão tenta inferir do nome
      let categoria = ci?.categoria
      if (!categoria) {
        const n = normalizar(it.nome)
        if (n.includes('TRANSPORTADOR') || n.includes('CHUPIM') || n.includes('CALHA')) categoria = 'TRANSPORTADOR'
        else if (n.includes('MOINHO') || n.includes('MARTELO') || n.includes('TRITURADOR')) categoria = 'MOINHO'
        else if (n.includes('MISTURADOR')) categoria = 'MISTURADOR'
        else if (n.includes('SILO')) categoria = 'SILO'
        else if (n.includes('ELEVADOR')) categoria = 'ELEVADOR'
        else if (n.includes('PENEIRA')) categoria = 'PENEIRA'
        else if (n.includes('CACAMBA_PESAGEM') || n.includes('CACAMBA_PESAGEM') || n.includes('PESAGEM')) categoria = 'CACAMBA_PESAGEM'
        else if (n.includes('ENSACADEIRA')) categoria = 'ENSACADEIRA'
        else categoria = 'MODELO'
      }

      // Foto: 1) catálogo similar  2) fallback transportador por diâmetro
      let foto = ci?.foto_url ?? null
      const subTransp = detectarSubTransportador(it.nome)
      if (!foto && subTransp) {
        const md = it.nome.match(/(\d{2,3})\s*[xX]/)
        if (md) foto = fotoMapTransp.get(`${subTransp}:${md[1]}`) ?? null
      }

      // Motor incluso? (spec diz "incluso/motorredutor")
      const motorIncluso = motorJaInclusoNoItem(it.specs ?? [])

      // BUG FIX (modelo pronto vs item individual):
      // Quando o modelo pronto tem item com "motor incluso" mas o JSONB foi importado
      // com valor_equipamento (sem motor), recalcula usando valor_com_motor_trif/mono
      // do precos_branorte vinculado, respeitando a voltagem do modelo.
      const precoLinkado = ci?.preco_branorte_id
        ? (precos ?? []).find(p => p.id === ci.preco_branorte_id)
        : null
      let valorFinal = Number(it.valor) || 0
      if (precoLinkado && motorIncluso) {
        const { valor: vCalc } = valorPorVoltagem(precoLinkado, voltagemModelo)
        if (vCalc > 0 && vCalc > valorFinal) valorFinal = vCalc
      }

      novos.push({
        uid: gerarUid(),
        catalogo_id: ci?.id ?? -1,
        preco_branorte_id: ci?.preco_branorte_id ?? null,
        categoria,
        nome: it.nome,
        specs: it.specs || [],
        qtd: it.qtd || 1,
        valor: valorFinal,
        valor_original: valorFinal,
        motor_cv: motor ? Number(motor.cv) : (cvDoSpec ?? null),
        motor_polos: motor ? motor.polos : (ci?.motor_padrao_polos ?? 4),
        // 2026-05-29: motor incluso AGORA aparece na tabela (motor_qtd=1) com
        // valor 0 → preview renderiza "Incluso" em vez de omitir a linha.
        // Vendedor reclamou que Compacta 01 Master 150500 nao mostrava o
        // motorredutor 7,5 CV do misturador horizontal.
        motor_qtd: motor ? 1 : (cvDoSpec ? 1 : 0),
        motor_valor_unit: motorIncluso ? 0 : (motor ? Number(motor.valor) : 0),
        foto_url: foto,
        usa_inversor: !!(ci?.usa_inversor),
        brinde: !!(it as any).brinde,
        motor_por_conta_cliente: !!(it as any).motor_por_conta_cliente,
        por_conta_cliente: !!(it as any).por_conta_cliente,
      })
    })

    // 3) Motores ÓRFÃOS (não pareados com nenhum item): NÃO materializa como
    // items dummy "D - 01 MOTOR 10 CV 2 POLOS" no orçamento. Esses motores
    // ficam apenas na tabela MOTORES TRIFÁSICOS lá embaixo, NÃO como item
    // separado com letra/foto/VALOR. Usuário reclamou de motor aparecer avulso.
    //
    // Se um motor estava no modelo mas o item correspondente não foi detectado
    // pelo extrairCvDeTexto, o motor simplesmente é DESCARTADO do carrinho —
    // mas vai cair na tabela de motores via motoresAgrupados (que lê do modelo).

    // Debug: log itens carregados do modelo
    console.log('[carregarDoModelo] Itens processados:', novos.length, novos.map(n => n.nome?.substring(0, 40)))

    // append=true: adiciona ao carrinho existente (quando IA já tem itens + carrega pacote)
    if (append) {
      setCarrinho(prev => [...prev, ...novos])
    } else {
      setCarrinho(novos)
    }

    // 4) Acessórios: preserva o VALOR EXATO do modelo (evita perder centavos
    // no arredondamento do pct). O pct fica como referencia visual ('Acessórios (8%)').
    if (modelo.acessorios && modelo.acessorios.items?.length) {
      const totalNovo = novos.reduce((s, it) => s + it.valor * it.qtd, 0)
      const pct = totalNovo > 0 ? Math.round((modelo.acessorios.valor / totalNovo) * 100) : 5
      setAcessorios({
        pct: Math.max(1, Math.min(50, pct)),
        items: modelo.acessorios.items,
        valorFixo: modelo.acessorios.valor, // ← preserva o valor exato do banco
      })
    } else {
      setAcessorios(null)
    }

    // 5) Voltagem do modelo — apenas seta o state, SEM recalcular motores
    // (preserva motor_valor_unit do snapshot do modelo, mantendo total exato
    // igual ao banco/card). Se vendedor TROCAR a voltagem depois, aí sim
    // aplicarVoltagem atualiza com precos atuais do catalogo central.
    if (modelo.voltagem) setVoltagem(modelo.voltagem)

    // 6) Foto Principal: só seta quando carrega pacote SOZINHO (não append).
    //    Se já tem itens individuais no carrinho, a foto do modelo não faz sentido
    //    porque o orçamento é misto (itens avulsos + pacote).
    if (modelo.foto_url && !append) {
      setFotoPrincipal(modelo.foto_url)
    }
  }

  // Hidrata estado a partir do orçamento salvo (modo edição via ?id=N).
  // Roda uma vez quando orcamentoEditando E catálogo estão prontos.
  useEffect(() => {
    if (orcamentoHidratado) return
    if (!editingId || !orcamentoEditando) return
    if (loadingItems || loadingMotores) return
    const o = orcamentoEditando
    // Converte OrcamentoGerado → shape OrcamentoModelo pra reusar carregarDoModelo
    const modeloShape: OrcamentoModelo = {
      id: -1,
      slug: `editing-${o.id}`,
      basename: o.modelo_basename || 'Orçamento personalizado',
      pacote: 'CUSTOM',
      voltagem: o.voltagem,
      is_master: false, is_jr: false,
      com_balanca: false, com_ensacadeira: false, com_chupim: false,
      producao_kgh: null, armazenamento_kg: null,
      itens: o.itens,
      acessorios: o.acessorios,
      motores: o.motores,
      total_equipamentos: o.total_equipamentos,
      total_motores: o.total_motores,
      total_proposta: o.total_proposta,
      arquivo_origem: null, template_path: null, foto_url: null,
      ativo: true,
    }
    carregarDoModelo(modeloShape)
    // Restaura foto principal:
    // 1) URL persistida no banco (fonte de verdade — sobrevive a edições)
    // 2) Fallback: foto do modelo original (se orçamento veio de pacote)
    // 3) Fallback: foto do primeiro item do catálogo que tem foto
    let fotoRestaurada = false
    if (o.foto_principal_url) {
      setFotoPrincipal(o.foto_principal_url)
      fotoRestaurada = true
    }
    if (!fotoRestaurada && o.modelo_id && modelos) {
      const modeloOriginal = modelos.find(m => m.id === o.modelo_id)
      if (modeloOriginal?.foto_url) {
        setFotoPrincipal(modeloOriginal.foto_url)
        fotoRestaurada = true
      }
    }
    // Sem foto_principal_url e sem modelo = sem hero photo.
    // Não inferir do primeiro item — orçamentos antigos não tinham hero.
    // Hidrata componentes extras + observacoes + termos
    if (o.componentes_extras) setComponentesExtras(o.componentes_extras as any)
    // Observação "por conta do cliente" editável (migration 2026-06-23).
    // Array salvo = usa ele; null/ausente = cai no default histórico.
    if (Array.isArray((o as any).obs_por_conta)) setObsPorConta((o as any).obs_por_conta)
    else setObsPorConta(null)
    // Restaura termos inline no preview (forma de pagamento, prazo, data, parcelas)
    if (o.forma_pagamento) setFormaPagamentoTxt(o.forma_pagamento)
    if (o.prazo_entrega) setPrazoEntregaTxt(o.prazo_entrega)
    // Frete: restaura do orcamento salvo (colunas criadas na migration 2026-06-10).
    if ((o as any).frete_tipo === 'CIF' || (o as any).frete_tipo === 'FOB') {
      setFreteTipo((o as any).frete_tipo)
    }
    if (typeof (o as any).frete_txt === 'string') {
      setFreteTxt((o as any).frete_txt)
    }
    // Desconto, tensão e marca dos motores (migration 2026-06-10): antes sumiam ao
    // reabrir (só viviam no rascunho local). Agora restaura do banco.
    if ((o as any).desconto) setDescontoCfg((o as any).desconto)
    if ((o as any).tensao_motores != null) setTensaoMotores((o as any).tensao_motores)
    if ((o as any).marca_motores != null) setMarcaMotores((o as any).marca_motores)
    if (o.parcelas?.length) setParcelasPagamento(o.parcelas)
    // Guarda dados que vão pro modal FinalizarMontar
    setInitialModal({
      cliente_nome: o.cliente_nome,
      cliente_dados: o.cliente_dados,
      observacoes: o.observacoes,
      forma_pagamento: o.forma_pagamento ?? null,
      prazo_entrega: o.prazo_entrega ?? null,
    })
    // Preenche dados do cliente no preview (cabeçalho do orçamento)
    if (o.cliente_dados) {
      setClienteDados({ nome: o.cliente_nome, ...o.cliente_dados } as PreviewClienteDados)
    } else if (o.cliente_nome) {
      setClienteDados({ nome: o.cliente_nome })
    }
    setOrcamentoHidratado(true)
  }, [editingId, orcamentoEditando, loadingItems, loadingMotores, orcamentoHidratado, modelos])

  if (loadingItems || loadingMotores || (editingId && loadingOrcamento)) return <PageLoading />

  // Indicador visual do autosave: status atual + horario do ultimo save.
  const draftStatusLabel = (() => {
    if (draft.status === 'saving') return 'Salvando rascunho...'
    if (draft.status === 'error') return 'Falha ao salvar rascunho'
    if (draft.lastSavedAt) {
      const hh = String(draft.lastSavedAt.getHours()).padStart(2, '0')
      const mm = String(draft.lastSavedAt.getMinutes()).padStart(2, '0')
      const ss = String(draft.lastSavedAt.getSeconds()).padStart(2, '0')
      return `Rascunho salvo às ${hh}:${mm}:${ss}`
    }
    return null
  })()

  return (
    <div
      // h-screen forca altura = viewport (era h-full que dependia do parent,
      // mas parent nao tem altura limitada -> orcMontar crescia infinito conforme
      // o conteudo da sidebar do catalogo, gerando area branca enorme no card preview).
      // Em desktop usa 100vh - padding pro respiro; mobile usa min-h-screen + overflow.
      className="h-screen lg:h-[calc(100vh-1rem)] flex flex-col gap-2 p-2 lg:pl-1 lg:pr-2 transition-all duration-200 overflow-hidden"
    >
      {/* Banner CRÍTICO: orçamento existente está em rascunho (upload server falhou).
          Quando vendedor reabre via ?id=N e a row tá rascunho, mostra alerta
          permanente até ele reenviar. Sem isso o vendedor acha que tá salvo. */}
      {editingId && orcamentoEditando?.status === 'rascunho' && (
        <div className="bg-danger/10 border border-danger/40 rounded-lg px-3 py-2.5 flex items-start gap-3">
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-ink">
              ⚠️ Orçamento {orcamentoEditando.numero} NÃO foi salvo no servidor
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              Ficou só no rascunho local — os arquivos não chegaram na pasta Z:.
              Provavelmente upload falhou por rede instável. Clique <strong>Finalizar e gerar</strong> de novo (todos os dados estão preservados).
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => setFinalizarOpen(true)}
              disabled={carrinho.length === 0}
              className="text-[11px] px-2.5 py-1.5 rounded bg-danger hover:bg-danger/90 text-white font-bold flex items-center gap-1 shadow-sm disabled:opacity-50"
            >
              <RefreshCw className="h-3 w-3" />
              Reenviar pra pasta
            </button>
          </div>
        </div>
      )}
      {/* Banner de recuperacao de rascunho */}
      {draft.recovered && draft.recovered.data?.carrinho?.length ? (
        <div className="bg-warning/10 border border-warning/40 rounded-lg px-3 py-2.5 flex items-start gap-3">
          <RotateCcw className="h-4 w-4 text-warning shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="text-[12px] font-semibold text-ink">
              Rascunho não finalizado encontrado
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              {draft.recovered.data.carrinho.length} {draft.recovered.data.carrinho.length === 1 ? 'item' : 'itens'} salvos automaticamente em{' '}
              {new Date(draft.recovered.saved_at).toLocaleString('pt-BR', {
                day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
              })}. Quer recuperar?
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={restaurarRascunho}
              className="text-[11px] bg-warning hover:bg-warning/90 text-white font-semibold px-3 py-1.5 rounded flex items-center gap-1"
            >
              <RotateCcw className="h-3 w-3" />
              Recuperar
            </button>
            <button
              onClick={descartarRascunho}
              className="text-[11px] text-ink-muted hover:text-ink font-medium px-2 py-1.5"
            >
              Descartar
            </button>
          </div>
        </div>
      ) : null}

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[18px] font-bold text-ink flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            Montar Orçamento Personalizado
          </h1>
          <p className="text-[11px] text-ink-faint mt-0.5 flex items-center gap-2">
            <span>Adicione items à esquerda. Veja o orçamento se montando à direita.</span>
            {draftStatusLabel && (
              <span className={`inline-flex items-center gap-1 ${draft.status === 'error' ? 'text-danger' : 'text-success'}`}>
                <Save className="h-3 w-3" />
                {draftStatusLabel}
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Seletor de modelo pronto */}
          <SelectorModelo onCarregar={carregarDoModelo} />
        </div>
      </div>

      {/* ⚡ Modelos Prontos — atalho pros 65 pacotes Compactas + Mini Fabrica.
          Em mobile: collapsible, default fechado se ja tem itens no carrinho. */}
      <details
        className="group bg-gradient-to-r from-accent/10 via-accent/5 to-transparent border border-accent/30 rounded-lg overflow-hidden"
        open={carrinho.length === 0}
      >
        <summary className="cursor-pointer flex items-center gap-2 px-3 py-2 select-none">
          <ChevronRight className="h-3.5 w-3.5 text-accent transition-transform group-open:rotate-90" />
          <Sparkles className="h-4 w-4 text-accent" />
          <div className="flex-1">
            <div className="text-[10px] uppercase font-bold text-accent tracking-wider">Modelos Prontos</div>
            <div className="text-[11px] text-ink-muted hidden sm:block">Carrega itens + motores + acessórios de uma vez</div>
          </div>
          <span className="text-[10px] text-ink-faint">4 pacotes</span>
        </summary>
        <div className="px-3 pb-2.5 grid grid-cols-2 sm:flex sm:flex-wrap gap-2 sm:gap-1.5">
          {[
            { label: 'Compacta 01', pacote: 'COMPACTA 01', qtd: 22 },
            { label: 'Compacta 02', pacote: 'COMPACTA 02', qtd: 21 },
            { label: 'Compacta 03', pacote: 'COMPACTA 03', qtd: 20 },
            { label: 'Mini Fábrica', pacote: 'MINI FABRICA', qtd: 2 },
          ].map(b => (
            <button
              key={b.pacote}
              onClick={() => setPacotePicker({ open: true, initialPacote: b.pacote })}
              className="text-[13px] sm:text-[11px] px-3 py-2.5 sm:py-1.5 rounded-md font-semibold bg-accent/15 active:bg-accent/35 hover:bg-accent/25 text-accent border border-accent/30 flex items-center justify-center sm:justify-start gap-1.5 transition-colors min-h-[44px] sm:min-h-0"
            >
              <Package className="h-4 w-4 sm:h-3.5 sm:w-3.5" />
              {b.label}
              <span className="text-[10px] opacity-70">({b.qtd})</span>
            </button>
          ))}
        </div>
      </details>

      {/* Tabs mobile-only — Preview e o foco, Catalogo e secao secundaria pra adicionar.
          Preview vem primeiro porque e default; Catalogo pra acao "+ adicionar item" */}
      <div className="lg:hidden flex items-center gap-1 bg-surface-2 rounded-lg p-1">
        <button
          onClick={() => setMobileTab('preview')}
          className={`flex-1 text-[14px] px-3 py-3 rounded-md font-bold transition-colors relative min-h-[48px] ${
            mobileTab === 'preview' ? 'bg-accent text-white' : 'text-ink-muted active:bg-surface-3'
          }`}
        >
          📄 Orçamento
          {carrinho.length > 0 && (
            <span className={`absolute -top-1 -right-1 text-[10px] font-bold rounded-full h-5 min-w-[20px] px-1 flex items-center justify-center ${
              mobileTab === 'preview' ? 'bg-white text-accent' : 'bg-accent text-white'
            }`}>{carrinho.length}</span>
          )}
        </button>
        <button
          onClick={() => setMobileTab('catalogo')}
          className={`flex-1 text-[14px] px-3 py-3 rounded-md font-bold transition-colors min-h-[48px] ${
            mobileTab === 'catalogo' ? 'bg-accent text-white' : 'text-ink-muted active:bg-surface-3'
          }`}
        >+ Adicionar</button>
      </div>

      {/* Grid 2 colunas: catálogo fixo 340px (suficiente pros cards) + preview pega TODO o resto */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[280px_minmax(0,1fr)] lg:grid-cols-[340px_minmax(0,1fr)] gap-2 min-h-0">
        {/* CATÁLOGO — em mobile, esconde se tab=preview */}
        <Card className={`flex flex-col min-h-0 overflow-hidden ${mobileTab === 'preview' ? 'hidden lg:flex' : ''}`}>
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
              <Input
                id="catalogo-busca-input"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar item (ex: triturador, caçamba, transportador)..."
                className="pl-7 text-[12px]"
              />
              {busca && (
                <button
                  onClick={() => setBusca('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
            <button
              onClick={() => setCustomOpen(true)}
              className="w-full text-[11px] py-1.5 px-2 rounded font-semibold flex items-center justify-center gap-1.5 bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 transition-all"
            >
              <Plus className="h-3 w-3" />
              Adicionar produto personalizado
            </button>

          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {itemsFiltrados.length === 0 ? (
              <div className="text-center py-12 text-ink-faint">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-[12px]">Nenhum item encontrado</p>
                {busca && (
                  <button
                    onClick={() => { setBusca(''); setCategoria(null); setShowOnlyPopular(false) }}
                    className="text-[11px] text-accent mt-2 hover:underline"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {/* Meta-cards oficiais — substituem variantes individuais por 1 entrada
                    com modal de seleção (puxa de precos_branorte) */}
                {!busca && (
                  <>
                    {/* Ordem: Fábricas → Transportador → Moinho → Misturador → Caixa → Silo → resto */}
                    {(categoria === null || categoria === 'COMPACTA') && (
                      <MetaCard categoria="COMPACTA" titulo="Fábricas Compactas (pacote)" descricao="Linhas 01, 01M, 02, 02M (75 a 500 kg/h) — kits completos prontos" qtd={65} onClick={() => setPacotePicker({ open: true })} />
                    )}
                    {(categoria === null || categoria === 'TRANSPORTADOR') && transportadores.length > 0 && (
                      <MetaCard categoria="TRANSPORTADOR" titulo="Transportador Helicoidal" descricao="Chupim e Calha TH — escolha tipo, diâmetro e medida" qtd={transportadores.length} onClick={() => setTransportadorPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'MOINHO') && moinhosOficiais.length > 0 && (
                      <MetaCard categoria="MOINHO" titulo="Moinho Martelo" descricao="Famílias BNMM-1 a BNMM-7 (3 a 100 CV)" qtd={moinhosOficiais.length} onClick={() => setMoinhoPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'MISTURADOR') && misturadoresOficiais.length > 0 && (
                      <MetaCard categoria="MISTURADOR" titulo="Misturador" descricao="Vertical, Horizontal S/Pulmão e C/Pulmão" qtd={misturadoresOficiais.length} onClick={() => setMisturadorPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'CAIXA') && caixasOficiais.length > 0 && (
                      <MetaCard categoria="CAIXA" titulo="Caixa" descricao="Recepção e Picados (volume + dimensões)" qtd={caixasOficiais.length} onClick={() => setCaixaPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'SILO') && silosOficiais.length > 0 && (
                      <MetaCard categoria="SILO" titulo="Silo" descricao="Ração e Milho (capacidade ton + geométrico)" qtd={silosOficiais.length} onClick={() => setSiloPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'ELEVADOR') && elevadoresOficiais.length > 0 && (
                      <MetaCard categoria="ELEVADOR" titulo="Elevador de Caneca" descricao="EC-2310/4010/5013 — vários comprimentos" qtd={elevadoresOficiais.length} onClick={() => setElevadorPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'ESTEIRA') && esteirasOficiais.length > 0 && (
                      <MetaCard categoria="ESTEIRA" titulo="Esteira Transportadora" descricao="Transporte de sacaria e grãos" qtd={esteirasOficiais.length} onClick={() => setEsteiraPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'CACAMBA_PESAGEM') && cacambasOficiais.length > 0 && (
                      <MetaCard categoria="CACAMBA_PESAGEM" titulo="Caçamba de Pesagem" descricao="600L / 1000L / 1900L / 3000L" qtd={cacambasOficiais.length} onClick={() => setCacambaPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'PRE_LIMPEZA' || categoria === 'PRE_LIMPEZA') && preLimpezasOficiais.length > 0 && (
                      <MetaCard categoria="PRE_LIMPEZA" titulo="Pré-Limpeza" descricao="3, 5, 7 e 10 ton/h" qtd={preLimpezasOficiais.length} onClick={() => setPreLimpezaPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'ENSACADEIRA') && ensacadeirasOficiais.length > 0 && (
                      <MetaCard categoria="ENSACADEIRA" titulo="Ensacadeira" descricao="Saco Aberto e Valvulado c/ painel" qtd={ensacadeirasOficiais.length} onClick={() => setEnsacadeiraPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'PENEIRA') && peneirasOficiais.length > 0 && (
                      <MetaCard categoria="PENEIRA" titulo="Peneira de Moinho" descricao="5 tamanhos (7,5 a 50 CV)" qtd={peneirasOficiais.length} onClick={() => setPeneiraPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'HELICOIDE') && helicoidesOficiais.length > 0 && (
                      <MetaCard categoria="HELICOIDE" titulo="Helicóide (peça)" descricao="⌀75 a ⌀300 — valor por metro" qtd={helicoidesOficiais.length} onClick={() => setHelicoidePickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'BALANCA') && balancasOficiais.length > 0 && (
                      <MetaCard categoria="BALANÇA" titulo="Balança" descricao="Eletrônica, Mecânica e Célula de Carga" qtd={balancasOficiais.length} onClick={() => setBalancaPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'ALIMENTADOR') && alimentadoresOficiais.length > 0 && (
                      <MetaCard categoria="ALIMENTADOR" titulo="Alimentador" descricao="160 e 210 (com levante ou direto)" qtd={alimentadoresOficiais.length} onClick={() => setAlimentadorPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'DESCARGA') && descargasOficiais.length > 0 && (
                      <MetaCard categoria="DESCARGA" titulo="Descarga (acessório)" descricao="Duas vias 160 e 210 mm" qtd={descargasOficiais.length} onClick={() => setDescargaPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'MOEGA') && moegasOficiais.length > 0 && (
                      <MetaCard categoria="MOEGA" titulo="Moega de Entrada" descricao="Caixa de entrada com helicoide" qtd={moegasOficiais.length} onClick={() => setMoegaPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'PASSARELA') && passarelasOficiais.length > 0 && (
                      <MetaCard categoria="PASSARELA" titulo="Passarela" descricao="Com guarda-corpo 21 e 25 m" qtd={passarelasOficiais.length} onClick={() => setPassarelaPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'SUPORTE_BAG' || categoria === 'SUPORTE BAG') && suporteBagOficiais.length > 0 && (
                      <MetaCard categoria="SUPORTE_BAG" titulo="Suporte de Big Bag" descricao="Estruturas pra Big Bag" qtd={suporteBagOficiais.length} onClick={() => setSuporteBagPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'OUTROS' || categoria === 'ACESSORIO') && outrosOficiais.length > 0 && (
                      <MetaCard categoria="OUTROS" titulo="Diversos / Acessórios" descricao="Martelos, peneiras avulsas, eixos, buchas e outros" qtd={outrosOficiais.length} onClick={() => setOutrosPickerOpen(true)} />
                    )}
                    {(categoria === null || categoria === 'PLASTICO') && plasticosOficiais.length > 0 && (
                      <MetaCard categoria="PLASTICO" titulo="Para Plástico" descricao="Misturadores específicos pra polímeros (com/sem aquecimento)" qtd={plasticosOficiais.length} onClick={() => setPlasticoPickerOpen(true)} />
                    )}
                  </>
                )}
                {itemsFiltrados
                  // Esconde individuais das categorias que tem meta-card (a menos que busca esteja ativa).
                  // Sem isso, item oficial individual aparece SOLTO no grid duplicando o que o
                  // picker do meta-card ja cobre.
                  .filter(it => busca || ![
                    'TRANSPORTADOR', 'MISTURADOR', 'MOINHO', 'CAIXA',
                    'SILO', 'ELEVADOR', 'CACAMBA_PESAGEM', 'PRE_LIMPEZA', 'PRE_LIMPEZA',
                    'PENEIRA', 'HELICOIDE', 'BALANCA', 'ENSACADEIRA', 'COMPACTA',
                    'ALIMENTADOR', 'DESCARGA', 'MARTELOS', 'MOEGA', 'PASSARELA',
                    'SUPORTE_BAG', 'SUPORTE BAG', 'OUTROS', 'ACESSORIO', 'PLASTICO',
                    'ESTEIRA',
                  ].includes(it.categoria))
                  .slice(0, 200)
                  .map(item => (
                    <CardItem
                      key={item.id}
                      item={item}
                      voltagem={voltagem}
                      motores={motores ?? []}
                      onAdd={() => adicionarItem(item)}
                    />
                  ))}
                {itemsFiltrados.length > 200 && (
                  <div className="col-span-full text-center py-3 text-[11px] text-ink-faint italic">
                    Mostrando 200 de {itemsFiltrados.length}. Use a busca pra filtrar mais.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* PREVIEW DO ORÇAMENTO — sticky no desktop pra não rolar com a lista esquerda */}
        <Card className={`flex flex-col w-full min-w-0 min-h-0 overflow-hidden max-h-[calc(100vh-180px)] md:max-h-none lg:sticky lg:top-3 lg:self-start lg:justify-self-stretch lg:max-h-[calc(100vh-1.5rem)] lg:h-[calc(100vh-1.5rem)] ${mobileTab === 'catalogo' ? 'hidden lg:flex' : ''}`}>
          {/* Toolbar do preview — botões maiores + CTA principal destacado */}
          <div className="p-1.5 sm:p-3 border-b border-border flex items-center justify-between bg-surface-2/30 flex-wrap gap-y-1.5 gap-x-1 sm:gap-2">
            <div className="flex items-center gap-1 bg-surface rounded-md p-0.5 border border-border">
              <button
                onClick={() => setModoVisao('preview')}
                className={`text-[12px] px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 transition-all min-h-[34px] ${
                  modoVisao === 'preview'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
                title="Visualizar como vai sair no PDF"
              >
                <Eye className="h-4 w-4" />
                Preview
              </button>
              <button
                onClick={() => setModoVisao('edicao')}
                className={`text-[12px] px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 transition-all min-h-[34px] ${
                  modoVisao === 'edicao'
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
                title="Editar items linha-a-linha"
              >
                <ListChecks className="h-4 w-4" />
                Edição
              </button>
            </div>
            {/* Voltagem dos motores — perto dos items, mais visivel que no header global */}
            <div className="flex items-center gap-1 bg-surface rounded-md p-0.5 border border-border">
              <span className="text-[10px] uppercase tracking-wider text-ink-faint font-bold px-2">⚡</span>
              <button
                onClick={() => aplicarVoltagem('monofasico')}
                className={`text-[12px] px-3 py-1.5 rounded font-semibold transition-all min-h-[34px] ${
                  voltagem === 'monofasico'
                    ? 'bg-warning text-white shadow-sm'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
                title="Motor monofásico (220V)"
              >
                Mono
              </button>
              <button
                onClick={() => aplicarVoltagem('trifasico')}
                className={`text-[12px] px-3 py-1.5 rounded font-semibold transition-all min-h-[34px] ${
                  voltagem === 'trifasico'
                    ? 'bg-info text-white shadow-sm'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
                title="Motor trifásico (220/380/660V)"
              >
                Trif
              </button>
            </div>
            {/* Modo exportação: +10% em todos os valores (só quando ligado) */}
            <button
              onClick={() => setExportacao(v => !v)}
              className={`text-[12px] px-3 py-1.5 rounded-md font-semibold transition-all min-h-[34px] border ${
                exportacao
                  ? 'bg-amber-500 text-white border-amber-500 shadow-sm'
                  : 'bg-surface text-ink-muted border-border hover:bg-surface-3'
              }`}
              title="Exportação: o orçamento GERADO (PDF/Word) sai com +10% em todos os valores. No builder você edita os valores normais."
            >
              {exportacao ? '🌎 Exportação +10% ✓' : '🌎 Ativar exportação'}
            </button>
            <div className="flex items-center gap-1 sm:gap-2">
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface border border-border">
                <span className="text-[11px] text-ink-faint">{carrinho.length}</span>
                <span className="text-[11px] text-ink-muted">{carrinho.length === 1 ? 'item' : 'items'}</span>
              </div>
              <button
                onClick={desfazer}
                disabled={historyStack.length === 0}
                className="hidden sm:flex text-[11px] text-ink-muted hover:bg-surface-3 px-2 py-1.5 rounded items-center gap-1 min-h-[34px] transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title={historyStack.length === 0 ? 'Nada para desfazer' : `Desfazer última alteração (Ctrl+Z) — ${historyStack.length} ${historyStack.length === 1 ? 'passo' : 'passos'} disponíveis`}
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Voltar</span>
              </button>
              {carrinho.length > 0 && (
                <button
                  onClick={limparCarrinho}
                  className="hidden sm:flex text-[11px] text-danger hover:bg-danger/10 px-2 py-1.5 rounded items-center gap-1 min-h-[34px] transition-colors"
                  title="Limpar todos os items"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Limpar</span>
                </button>
              )}
              {editingId ? (
                <div className="relative">
                  <div className="flex items-stretch">
                    <button
                      disabled={carrinho.length === 0}
                      onClick={() => {
                        setSaveMode('update')
                        setFinalizarOpen(true)
                      }}
                      className="text-[13px] bg-green-600 hover:bg-green-700 text-white font-bold px-4 py-2 rounded-l-md disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm min-h-[40px] transition-all"
                      title="Salvar alterações no orçamento atual (sobrescreve)"
                    >
                      <FileText className="h-4 w-4" />
                      <span className="hidden sm:inline">Salvar</span>
                    </button>
                    <button
                      disabled={carrinho.length === 0}
                      onClick={() => setSaveDropdownOpen(v => !v)}
                      className="text-[13px] bg-green-600 hover:bg-green-700 text-white font-bold px-2 py-2 rounded-r-md border-l border-green-500 disabled:opacity-30 disabled:cursor-not-allowed flex items-center min-h-[40px] transition-all"
                      title="Mais opções de salvamento"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  {saveDropdownOpen && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setSaveDropdownOpen(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 bg-bg border border-border rounded-lg shadow-xl min-w-[220px] overflow-hidden">
                        <button
                          onClick={() => { setSaveMode('update'); setFinalizarOpen(true); setSaveDropdownOpen(false) }}
                          className="w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border"
                        >
                          <div className="text-[13px] font-bold text-ink">Salvar em cima</div>
                          <div className="text-[11px] text-ink-muted">Sobrescreve o orçamento {orcamentoEditando?.numero}</div>
                        </button>
                        <button
                          onClick={() => { setSaveMode('alt'); setFinalizarOpen(true); setSaveDropdownOpen(false) }}
                          className="w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors border-b border-border"
                        >
                          <div className="text-[13px] font-bold text-accent">Salvar como ALT</div>
                          <div className="text-[11px] text-ink-muted">Cria versão alternativa vinculada</div>
                        </button>
                        <button
                          onClick={() => { setSaveMode('new'); setFinalizarOpen(true); setSaveDropdownOpen(false) }}
                          className="w-full text-left px-4 py-3 hover:bg-surface-2 transition-colors"
                        >
                          <div className="text-[13px] font-bold text-ink">Salvar como novo</div>
                          <div className="text-[11px] text-ink-muted">Cria orçamento novo independente</div>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <button
                  disabled={carrinho.length === 0}
                  onClick={handleFinalizarClick}
                  className="text-[13px] bg-accent hover:bg-accent/90 text-white font-bold px-4 py-2 rounded-md disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5 shadow-sm min-h-[40px] transition-all"
                  title={carrinho.length === 0 ? 'Adicione items primeiro' : 'Finalizar e gerar PDF + DOCX'}
                >
                  <FileText className="h-4 w-4" />
                  <span className="hidden sm:inline">Finalizar e gerar</span>
                  <span className="sm:hidden">Gerar</span>
                </button>
              )}
            </div>
          </div>

          {/* Conteúdo do preview / edição.
              overflow-x: hidden no mobile pra ResponsiveScaler funcionar sem
              gerar scroll horizontal residual. */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden bg-white">
            {carrinho.length === 0 ? (
              // Estado vazio: ocupa a tela inteira centralizado (flex vertical).
              // Antes ficava encolhido no topo, deixando ~860px de branco embaixo.
              <div className="h-full flex items-center justify-center px-4 py-6">
                <div className="w-full max-w-2xl text-center">
                  <div className="h-20 w-20 mx-auto mb-5 rounded-2xl bg-accent/10 flex items-center justify-center">
                    <FileText className="h-10 w-10 text-accent" />
                  </div>
                  <h3 className="text-[20px] font-bold text-gray-900">Comece adicionando o primeiro item</h3>
                  <p className="text-[14px] text-gray-500 mt-2 mb-6">Escolha pelo atalho abaixo ou toque em <span className="lg:hidden">"+ Adicionar"</span><span className="hidden lg:inline">no catálogo à esquerda</span>.</p>
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-left">
                    <button
                      onClick={() => { setMobileTab('catalogo'); setTransportadorPickerOpen(true) }}
                      className="group p-4 rounded-xl border border-gray-200 hover:border-accent hover:bg-accent/5 transition-all"
                    >
                      <div className="text-[24px] mb-1">🚛</div>
                      <div className="text-[14px] font-bold text-gray-900 group-hover:text-accent">Transportador</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">Chupim, helicoidal, calha</div>
                    </button>
                    <button
                      onClick={() => { setMobileTab('catalogo'); setMoinhoPickerOpen(true) }}
                      className="group p-4 rounded-xl border border-gray-200 hover:border-accent hover:bg-accent/5 transition-all"
                    >
                      <div className="text-[24px] mb-1">⚙️</div>
                      <div className="text-[14px] font-bold text-gray-900 group-hover:text-accent">Moinho</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">Martelo, peneira</div>
                    </button>
                    <button
                      onClick={() => { setMobileTab('catalogo'); setMisturadorPickerOpen(true) }}
                      className="group p-4 rounded-xl border border-gray-200 hover:border-accent hover:bg-accent/5 transition-all"
                    >
                      <div className="text-[24px] mb-1">🥄</div>
                      <div className="text-[14px] font-bold text-gray-900 group-hover:text-accent">Misturador</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">Vertical, horizontal</div>
                    </button>
                    <button
                      onClick={() => { setMobileTab('catalogo'); setSiloPickerOpen(true) }}
                      className="group p-4 rounded-xl border border-gray-200 hover:border-accent hover:bg-accent/5 transition-all"
                    >
                      <div className="text-[24px] mb-1">🏗️</div>
                      <div className="text-[14px] font-bold text-gray-900 group-hover:text-accent">Silo</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">Ração, milho, geométrico</div>
                    </button>
                  </div>
                  <button
                    onClick={() => { setMobileTab('catalogo'); setCustomOpen(true) }}
                    className="mt-4 w-full p-3 rounded-xl border border-dashed border-gray-300 text-[13px] text-gray-600 hover:border-accent hover:text-accent transition-colors"
                  >
                    + Produto personalizado (não-catálogo)
                  </button>
                  <p className="text-[11px] text-gray-400 mt-5">
                    💡 Dica: você pode também carregar um modelo pronto pelo botão no topo
                  </p>
                </div>
              </div>
            ) : modoVisao === 'preview' ? (
              <ResponsiveScaler documentWidth={1024}>
              <OrcamentoPreview
                carrinho={carrinho}
                numero={editingId && orcamentoEditando ? orcamentoEditando.numero : undefined}
                motoresAgrupados={motoresAgrupados}
                voltagem={voltagem}
                totalItems={totalItems}
                totalMotores={totalMotores}
                totalEquip={totalEquip}
                totalGeral={totalGeral}
                acessorios={acessorios}
                valorAcessorios={valorAcessorios}
                fotoPrincipal={fotoPrincipal}
                onAddAcessorios={() => setAcessoriosOpen(true)}
                onAddItem={() => {
                  // Mobile: alterna pro tab Catálogo (que tava escondido)
                  setMobileTab('catalogo')
                  // Desktop + mobile: rola pro topo do catálogo + foca o input de busca
                  // Timeout pra tab trocar antes de scrollar
                  setTimeout(() => {
                    const input = document.getElementById('catalogo-busca-input') as HTMLInputElement | null
                    if (input) {
                      input.scrollIntoView({ behavior: 'smooth', block: 'start' })
                      input.focus()
                      input.select()
                    }
                  }, 100)
                }}
                onEditAcessorios={() => setAcessoriosOpen(true)}
                onRemoveAcessorios={() => setAcessorios(null)}
                onRemove={removerItem}
                onFotoChange={setFotoPrincipal}
                onUpdateNome={alterarNome}
                onUpdateFotoItem={(uid, novaFoto) =>
                  setCarrinho(c => c.map(it => it.uid === uid ? { ...it, foto_url: novaFoto } : it))
                }
                onUpdateSpec={alterarSpec}
                onAddSpec={adicionarSpec}
                onRemoveSpec={removerSpec}
                obsPorConta={obsPorConta}
                onUpdateObsPorConta={setObsPorConta}
                onUpdateValor={alterarValor}
                onToggleInox={toggleInox}
                onToggleTungstenio={toggleTungstenio}
                onToggleBrinde={(uid) => setCarrinho(prev => prev.map(c => c.uid === uid ? { ...c, brinde: !c.brinde } : c))}
                onTogglePorConta={(uid) => setCarrinho(prev => prev.map(c => c.uid === uid ? { ...c, por_conta_cliente: !c.por_conta_cliente, ...(!c.por_conta_cliente ? { valor: 0, valor_original: 0 } : {}) } : c))}
                onUpdateQtd={alterarQtd}
                componentesExtras={componentesExtras}
                onUpdateComponentesExtras={setComponentesExtras}
                componentesAdicionaisCatalogo={componentesAdicionaisCatalogo}
                tensaoMotores={tensaoMotores}
                onUpdateTensaoMotores={setTensaoMotores}
                marcaMotores={marcaMotores}
                onUpdateMarcaMotores={setMarcaMotores}
                desconto={descontoCfg}
                onUpdateDesconto={setDescontoCfg}
                terms={{ dataVenda: dataVendaTxt, prazoEntrega: prazoEntregaTxt, formaPagamento: formaPagamentoTxt, freteTipo, freteTxt }}
                onUpdateTerm={atualizarTermo}
                onMoverItem={moverItem}
                onTrocarItem={handleTrocarItem}
                parcelas={parcelasPagamento}
                onUpdateParcelas={setParcelasPagamento}
                motoresDisponiveis={motores ?? []}
                onTrocarMotor={trocarMotorDoItem}
                onMotorPorContaCliente={marcarMotorPorContaCliente}
                onMotorIncluso={marcarMotorIncluso}
                onRemoverMotor={removerMotorDoItem}
                onRestaurarMotor={restaurarMotorDoItem}
                vendedoresContato={vendedoresContato}
                vendedorResponsavelNome={profile?.display_name || null}
                cliente={clienteDados}
                onEditCliente={() => setClienteModalOpen(true)}
              />
              </ResponsiveScaler>
            ) : (
              <div className="divide-y divide-border">
                {carrinho.map(it => (
                  <CarrinhoLinhaEdicao
                    key={it.uid}
                    item={it}
                    onRemove={() => removerItem(it.uid)}
                    onQtd={n => alterarQtd(it.uid, n)}
                    onValor={v => alterarValor(it.uid, v)}
                  />
                ))}
              </div>
            )}

          </div>

          {/* Footer com total + ação */}
          {carrinho.length > 0 && (
            <div className="border-t border-border p-3 space-y-1.5 bg-surface-2/50">
              <div className="flex justify-between text-[11px] text-ink-muted">
                <span>Equipamentos</span>
                <span className="font-semibold">{formatBRL(totalItems)}</span>
              </div>
              {acessorios && (
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>Acessórios ({acessorios.valorFixo != null && acessorios.valorFixo > 0 ? 'R$ fixo' : `${acessorios.pct}%`})</span>
                  <span className="font-semibold">{formatBRL(valorAcessorios)}</span>
                </div>
              )}
              {totalMotores > 0 && (
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>Motores ({motoresAgrupados.length})</span>
                  <span className="font-semibold">{formatBRL(totalMotores)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-bold text-ink pt-1 border-t border-border">
                <span>TOTAL DA PROPOSTA</span>
                <span className="text-accent">{formatBRL(totalGeral)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Modal de finalização */}
      {/* Popup obrigatório: orçamento sem acessórios */}
      {confirmSemAcessorios && (
        <div
          className="fixed inset-0 z-[60] bg-black/50 flex items-center justify-center p-4"
          onClick={() => setConfirmSemAcessorios(false)}
        >
          <div
            className="w-full max-w-md rounded-xl border border-border bg-surface p-5 shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 shrink-0 rounded-full bg-amber-500/15 text-amber-500 flex items-center justify-center text-lg">⚠️</div>
              <div className="min-w-0">
                <h3 className="text-[15px] font-bold text-ink">Sem acessórios</h3>
                <p className="text-[13px] text-ink-muted mt-1 leading-snug">
                  Você não adicionou nenhum acessório a este orçamento. Quer adicionar
                  agora ou confirma que <b>não tem acessório</b> e segue para gerar?
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2">
              <button
                onClick={() => { setConfirmSemAcessorios(false); setAcessoriosOpen(true) }}
                className="w-full rounded-md bg-accent hover:bg-accent/90 text-white text-[13px] font-bold py-2.5 transition-colors"
              >
                ➕ Adicionar acessórios
              </button>
              <button
                onClick={() => { setConfirmSemAcessorios(false); abrirFinalizar() }}
                className="w-full rounded-md border border-border bg-surface-2 hover:border-border-strong text-ink text-[13px] font-semibold py-2.5 transition-colors"
              >
                Não tem acessório, continuar
              </button>
              <button
                onClick={() => setConfirmSemAcessorios(false)}
                className="w-full text-[12px] text-ink-muted hover:text-ink py-1"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      <FinalizarMontarModal
        open={finalizarOpen}
        editingId={editingId}
        saveMode={saveMode}
        parentOrcamento={editingId && orcamentoEditando ? {
          id: orcamentoEditando.parent_id ?? orcamentoEditando.id,
          numero: orcamentoEditando.numero,
          numero_base: orcamentoEditando.numero_base ?? orcamentoEditando.numero,
        } : null}
        initialModal={initialModal}
        autoSubmitOnOpen={autoSubmitFromIA}
        snapshot={{
          voltagem,
          itens: carrinhoExib.map(c => ({
            nome: c.nome_custom || c.nome,  // usa nome customizado se vendedor editou
            qtd: c.qtd,
            valor: c.valor,
            specs: c.specs,
            motor_cv: c.motor_cv,
            motor_polos: c.motor_polos,
            motor_qtd: c.motor_qtd,
            motor_valor_unit: c.motor_valor_unit,
            foto_url: c.foto_url,
            brinde: c.brinde,
            motor_por_conta_cliente: c.motor_por_conta_cliente,
            por_conta_cliente: c.por_conta_cliente,
            // Round-trip completo: campos extras pra recarregar a edição 1:1
            // (foto manual/custom, inox, função, motor, etc) sem reconstruir.
            catalogo_id: c.catalogo_id,
            preco_branorte_id: c.preco_branorte_id ?? null,
            categoria: c.categoria,
            valor_original: c.valor_original,
            usa_inversor: c.usa_inversor,
            funcao_selecionada: c.funcao_selecionada ?? null,
            ocultar_funcao_no_pdf: c.ocultar_funcao_no_pdf,
            inox: c.inox,
            tungstenio: c.tungstenio,
            specs_original: c.specs_original,
            motor_removido: c.motor_removido,
            valor_pre_remocao: c.valor_pre_remocao ?? null,
            motores_extras_snapshot: c.motores_extras_snapshot,
            motores_por_conta_idx: c.motores_por_conta_idx,
            motores_removidos_idx: c.motores_removidos_idx,
            motor_incluso_manual: c.motor_incluso_manual,
            motores_incluso_idx: c.motores_incluso_idx,
          })),
          motoresAgrupados: motoresAgrupadosExib,
          acessorios: acessorios ? { pct: acessorios.pct, items: acessorios.items, valor: valorAcessoriosExib } : null,
          totalItems: totalItemsExib,
          totalMotores: totalMotoresExib,
          totalEquip: totalEquipExib,
          totalGeral: totalGeralExib,
          fotoPrincipal,
          tensaoMotores,
          marcaMotores,
          desconto: descontoCfg,
          termsInline: {
            dataVenda: dataVendaTxt || null,
            prazoEntrega: prazoEntregaTxt || null,
            formaPagamento: formaPagamentoTxt || 'a combinar',
            freteTipo,
            freteTxt: freteTxt || null,
          },
          parcelas: parcelasPagamento,
          componentesExtras: componentesExtrasExib,
          obsPorConta: obsPorConta,
        } as CarrinhoSnapshot}
        onClose={() => { setFinalizarOpen(false); setAutoSubmitFromIA(false); }}
        onSuccess={info => {
          setSucesso(info)
          setFinalizarOpen(false)
          setCarrinho([])
          setAcessorios(null)
          // Orcamento gerado → rascunho ja virou orcamento real, pode apagar.
          draft.clearDraft()
        }}
      />

      {/* Modal de Acessórios */}
      <AcessoriosModal
        open={acessoriosOpen}
        initial={acessorios}
        carrinho={carrinho}
        onClose={() => setAcessoriosOpen(false)}
        onSave={cfg => {
          // cfg.valorFixo definido = vendedor escolheu valor fixo (R$);
          // null = modo %, recalcula via pct sobre os equipamentos.
          setAcessorios({
            pct: cfg.pct,
            items: cfg.items,
            valorFixo: cfg.valorFixo,
            excludedItemUids: cfg.excludedItemUids,
          })
          setAcessoriosOpen(false)
        }}
        onRemove={() => { setAcessorios(null); setAcessoriosOpen(false) }}
      />

      {/* Modal de edição dos dados do cliente (CNPJ/CPF auto-fill) */}
      <ClienteEditModal
        open={clienteModalOpen}
        cliente={clienteDados}
        onClose={() => setClienteModalOpen(false)}
        onSave={dados => {
          setClienteDados(dados)
          // Sincroniza com initialModal pra quando abrir FinalizarMontarModal
          setInitialModal(prev => ({
            cliente_nome: dados.nome || prev?.cliente_nome || '',
            cliente_dados: { ...dados },
            observacoes: prev?.observacoes ?? null,
            forma_pagamento: prev?.forma_pagamento ?? null,
            prazo_entrega: prev?.prazo_entrega ?? null,
          }))
        }}
      />

      {/* Modal de produto personalizado (ad-hoc) */}
      <CustomItemModal
        open={customOpen}
        categorias={categorias.map(c => c.categoria)}
        onClose={() => setCustomOpen(false)}
        onAdd={async data => {
          await adicionarItemCustomizado(data)
          setCustomOpen(false)
        }}
      />

      {/* Modal de seleção de Transportador (puxa de precos_branorte) */}
      <TransportadorPickerModal
        open={transportadorPickerOpen}
        transportadores={transportadores}
        catalogoItems={items ?? []}
        material={chupimMaterial}
        inclinacao={chupimInclinacao}
        onMaterial={setChupimMaterial}
        onInclinacao={setChupimInclinacao}
        onClose={() => setTransportadorPickerOpen(false)}
        onPick={p => {
          // Chupim + Calha TH: mesma fórmula de motor, ambos abrem o modal
          // pra vendedor confirmar material/inclinação/função POR ITEM. Quem não é
          // helicoidal cai aqui? Não chega — picker só lista TRANSPORTADOR.
          if (p.subcategoria === 'CHUPIM' || p.subcategoria === 'TH') {
            setConfirmarChupim(p)
          } else {
            adicionarItemDePreco(p)
            setTransportadorPickerOpen(false)
          }
        }}
      />

      {/* Modal de confirmação por chupim: material + inclinação + função (polos + nome) específicos */}
      <ConfirmarChupimModal
        chupim={confirmarChupim}
        materialDefault={chupimMaterial}
        inclinacaoDefault={chupimInclinacao}
        voltagem={voltagem}
        onCancel={() => setConfirmarChupim(null)}
        onConfirm={(p, material, inclinacao, funcao, polos) => {
          setChupimMaterial(material)
          setChupimInclinacao(inclinacao)
          adicionarItemDePreco(p, undefined, { material, inclinacao, polos, funcao })
          setConfirmarChupim(null)
          setTransportadorPickerOpen(false)
        }}
      />

      {/* Picker genérico Misturador */}
      <CategoriaPickerModal
        open={misturadorPickerOpen}
        titulo="Misturador"
        items={misturadoresOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ VERTICAL: 'Vertical', HORIZONTAL_SPULMAO: 'Horiz. S/Pulmão', HORIZONTAL_CPULMAO: 'Horiz. C/Pulmão' }}
        ordemSub={['VERTICAL', 'HORIZONTAL_SPULMAO', 'HORIZONTAL_CPULMAO']}
        colKgPratica
        onClose={() => setMisturadorPickerOpen(false)}
        onPick={p => { adicionarItem(p); setMisturadorPickerOpen(false) }}
      />

      {/* Picker Plástico — Sem Aquecimento e C/ Aquecimento */}
      <CategoriaPickerModal
        open={plasticoPickerOpen}
        titulo="Misturador Para Plástico"
        items={plasticosOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ SIMPLES: 'Sem Aquecimento', AQUECIMENTO: 'C/ Aquecimento' }}
        ordemSub={['SIMPLES', 'AQUECIMENTO']}
        onClose={() => setPlasticoPickerOpen(false)}
        onPick={p => { adicionarItem(p); setPlasticoPickerOpen(false) }}
      />

      {/* Picker genérico Moinho */}
      <CategoriaPickerModal
        open={moinhoPickerOpen}
        titulo="Moinho Martelo"
        items={moinhosOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ MARTELO: 'Martelo' }}
        ordemSub={['MARTELO']}
        onClose={() => setMoinhoPickerOpen(false)}
        onPick={p => { adicionarItem(p); setMoinhoPickerOpen(false) }}
      />

      {/* Picker genérico Caixa */}
      <CategoriaPickerModal
        open={caixaPickerOpen}
        titulo="Caixa"
        items={caixasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ RECEPCAO: 'Recepção', PICADOS: 'Picados' }}
        ordemSub={['RECEPCAO', 'PICADOS']}
        colMilhoKg
        colDimensoes
        onClose={() => setCaixaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setCaixaPickerOpen(false) }}
      />

      {/* Silo */}
      <CategoriaPickerModal
        open={siloPickerOpen}
        titulo="Silo"
        items={silosOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ RACAO: 'Ração', MILHO: 'Milho' }}
        ordemSub={['RACAO', 'MILHO']}
        colSiloDims
        onClose={() => setSiloPickerOpen(false)}
        onPick={p => { adicionarItem(p); setSiloPickerOpen(false) }}
      />

      {/* Elevador */}
      <CategoriaPickerModal
        open={elevadorPickerOpen}
        titulo="Elevador de Caneca"
        items={elevadoresOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ COMPLETO: 'Completo', COMPONENTE: 'Componente (Pé/Padrão)' }}
        ordemSub={['COMPLETO', 'COMPONENTE']}
        colDimensoes
        onClose={() => setElevadorPickerOpen(false)}
        onPick={p => { adicionarItem(p); setElevadorPickerOpen(false) }}
      />

      {/* Caçamba */}
      <CategoriaPickerModal
        open={cacambaPickerOpen}
        titulo="Caçamba de Pesagem"
        items={cacambasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ PESAGEM: 'Pesagem' }}
        ordemSub={['PESAGEM']}
        colKgPratica
        onClose={() => setCacambaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setCacambaPickerOpen(false) }}
      />

      {/* Pré-Limpeza */}
      <CategoriaPickerModal
        open={preLimpezaPickerOpen}
        titulo="Pré-Limpeza"
        items={preLimpezasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setPreLimpezaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setPreLimpezaPickerOpen(false) }}
      />

      {/* Peneira */}
      <CategoriaPickerModal
        open={peneiraPickerOpen}
        titulo="Peneira de Moinho"
        items={peneirasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setPeneiraPickerOpen(false)}
        onPick={p => { adicionarItem(p); setPeneiraPickerOpen(false) }}
      />

      {/* Helicóide */}
      <CategoriaPickerModal
        open={helicoidePickerOpen}
        titulo="Helicóide (peça)"
        items={helicoidesOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ PECA: 'Peça' }}
        ordemSub={['PECA']}
        onClose={() => setHelicoidePickerOpen(false)}
        onPick={p => { adicionarItem(p); setHelicoidePickerOpen(false) }}
      />

      {/* Balança */}
      <CategoriaPickerModal
        open={balancaPickerOpen}
        titulo="Balança"
        items={balancasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ ELETRONICA: 'Eletrônica', MECANICA: 'Mecânica', CELULA: 'Célula de Carga' }}
        ordemSub={['ELETRONICA', 'MECANICA', 'CELULA']}
        onClose={() => setBalancaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setBalancaPickerOpen(false) }}
      />

      {/* Compacta (pacote fechado - preços avulsos, fallback se vendedor abrir via outro caminho) */}
      <CategoriaPickerModal
        open={compactaPickerOpen}
        titulo="Fábricas Compactas (preço único)"
        items={compactasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ '01': 'Linha 01', '01 MASTER': 'Linha 01 Master', '02': 'Linha 02', '02 MASTER': 'Linha 02 Master' }}
        ordemSub={['01', '01 MASTER', '02', '02 MASTER']}
        colCompacta
        onClose={() => setCompactaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setCompactaPickerOpen(false) }}
      />

      {/* Picker de MODELOS de pacote (Compactas + Mini Fabrica): carrega TODOS os items
          do modelo (transportador + moinho + misturador + acessórios + motores). */}
      <PacoteModeloPickerModal
        open={pacotePicker.open}
        initialPacote={pacotePicker.initialPacote}
        onClose={() => setPacotePicker({ open: false })}
        onPick={m => { carregarDoModelo(m); setPacotePicker({ open: false }) }}
      />

      {/* Ensacadeira */}
      <CategoriaPickerModal
        open={ensacadeiraPickerOpen}
        titulo="Ensacadeira"
        items={ensacadeirasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{ DIVERSOS: 'Diversos' }}
        ordemSub={['DIVERSOS']}
        onClose={() => setEnsacadeiraPickerOpen(false)}
        onPick={p => { adicionarItem(p); setEnsacadeiraPickerOpen(false) }}
      />

      {/* Categorias menores — antes eram items soltos no grid, agora cada uma tem meta-card.
          Sem subcategoria estruturada — labelSub default cobre 1 grupo "Diversos". */}
      <CategoriaPickerModal
        open={alimentadorPickerOpen}
        titulo="Alimentador"
        items={alimentadoresOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setAlimentadorPickerOpen(false)}
        onPick={p => { adicionarItem(p); setAlimentadorPickerOpen(false) }}
      />

      <CategoriaPickerModal
        open={descargaPickerOpen}
        titulo="Descarga (acessório)"
        items={descargasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setDescargaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setDescargaPickerOpen(false) }}
      />

      <CategoriaPickerModal
        open={moegaPickerOpen}
        titulo="Moega de Entrada"
        items={moegasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setMoegaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setMoegaPickerOpen(false) }}
      />

      <CategoriaPickerModal
        open={passarelaPickerOpen}
        titulo="Passarela"
        items={passarelasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setPassarelaPickerOpen(false)}
        onPick={p => { adicionarItem(p); setPassarelaPickerOpen(false) }}
      />

      <CategoriaPickerModal
        open={suporteBagPickerOpen}
        titulo="Suporte de Big Bag"
        items={suporteBagOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setSuporteBagPickerOpen(false)}
        onPick={p => { adicionarItem(p); setSuporteBagPickerOpen(false) }}
      />

      <CategoriaPickerModal
        open={outrosPickerOpen}
        titulo="Diversos"
        items={outrosOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setOutrosPickerOpen(false)}
        onPick={p => { adicionarItem(p); setOutrosPickerOpen(false) }}
      />

      <CategoriaPickerModal
        open={esteiraPickerOpen}
        titulo="Esteira Transportadora"
        items={esteirasOficiais}
        precosBranorte={precos ?? []}
        labelSub={{}}
        ordemSub={[]}
        onClose={() => setEsteiraPickerOpen(false)}
        onPick={p => { adicionarItem(p); setEsteiraPickerOpen(false) }}
      />

      {/* Modal de escolha de função — aberto quando o item tem várias funções
          (ex: transportador → alimentação/descarga/etc) */}
      {escolherFuncaoFor && (
        <div
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={() => setEscolherFuncaoFor(null)}
        >
          <div
            className="bg-bg border border-border rounded-xl max-w-md w-full shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-border flex items-start gap-3">
              <Package className="h-5 w-5 text-accent shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-accent font-bold">
                  Escolha a função
                </div>
                <div className="text-[14px] font-bold text-ink leading-tight">
                  {escolherFuncaoFor.nome_curto}
                </div>
                {escolherFuncaoFor.ocultar_funcao_no_pdf && (
                  <div className="text-[10px] text-ink-faint mt-1">
                    A função é só pra produção — não aparece no PDF final.
                  </div>
                )}
              </div>
              <button
                onClick={() => setEscolherFuncaoFor(null)}
                className="text-ink-faint hover:text-ink p-1 -m-1"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="p-3 max-h-[60vh] overflow-y-auto flex flex-col gap-1.5">
              {/* Opção "sem função" — adiciona o item sem nenhuma função/parêntese */}
              <button
                onClick={() => {
                  const item = escolherFuncaoFor
                  setEscolherFuncaoFor(null)
                  adicionarItem(item, '')
                }}
                className="text-left px-3 py-2 rounded-lg border border-dashed border-border hover:border-accent hover:bg-surface-2 transition-all text-[12px] font-medium text-ink-muted italic flex items-center gap-2"
              >
                <Plus className="h-3.5 w-3.5 text-ink-faint shrink-0" />
                <span className="flex-1">Sem função (deixar em branco)</span>
              </button>
              {escolherFuncaoFor.funcao_opcoes.map(fn => (
                <button
                  key={fn}
                  onClick={() => {
                    const item = escolherFuncaoFor
                    setEscolherFuncaoFor(null)
                    adicionarItem(item, fn)
                  }}
                  className="text-left px-3 py-2 rounded-lg border border-border hover:border-accent hover:bg-surface-2 transition-all text-[12px] font-medium text-ink flex items-center gap-2"
                >
                  <Plus className="h-3.5 w-3.5 text-accent shrink-0" />
                  <span className="flex-1">{fn}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Feedback de sucesso — toast premium. Fica VERMELHO se algo falhou. */}
      {sucesso && (() => {
        const algoFalhou = !!(sucesso.erro || sucesso.pdfErro || (!sucesso.salvouNaPasta && !sucesso.baixouDocx))
        const corBg = algoFalhou ? 'bg-danger/15 border-danger/30' : 'bg-success/15 border-success/30'
        const corText = algoFalhou ? 'text-danger' : 'text-success'
        const corBorda = algoFalhou ? 'border-danger' : 'border-success'
        const iconBg = algoFalhou ? 'bg-danger' : 'bg-success'
        const titulo = algoFalhou ? 'FALHA AO SALVAR' : 'Orçamento gerado'
        return (
        <div className={`fixed bottom-4 left-3 right-3 sm:left-auto sm:right-6 sm:bottom-6 z-50 bg-bg border ${corBorda} rounded-xl shadow-2xl max-w-sm sm:w-[360px] overflow-hidden`}>
          {/* Header */}
          <div className={`${corBg} border-b px-4 py-3 flex items-start gap-3`}>
            <div className={`w-8 h-8 rounded-full ${iconBg} flex items-center justify-center shrink-0`}>
              {algoFalhou ? <AlertCircle className="h-5 w-5 text-white" /> : <Check className="h-5 w-5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className={`text-[11px] uppercase tracking-wider ${corText} font-bold`}>{titulo}</div>
              <div className="text-[16px] font-bold text-ink leading-tight">Nº {sucesso.numero}</div>
            </div>
            <button onClick={() => setSucesso(null)} className="text-ink-faint hover:text-ink p-1 -m-1 rounded hover:bg-surface-2">
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Body — status de cada saída */}
          <div className="px-4 py-3 space-y-1.5 text-[11px]">
            {sucesso.salvouNaPasta && (
              <div className="flex items-start gap-2 text-ink-muted">
                <FolderOpen className="h-3.5 w-3.5 text-blue-400 shrink-0 mt-0.5" />
                <span>
                  {typeof window !== 'undefined' && !('showDirectoryPicker' in window)
                    ? <>Enviado pro servidor — vai aparecer em <code className="text-[10px] bg-surface-2 px-1 rounded">Z:\1 - Comercial\3 - Orçamento\2026\Orçamentos 2026\</code> em até 30s.</>
                    : <>Salvo na pasta Z:</>}
                </span>
              </div>
            )}
            {sucesso.baixouDocx && (
              <div className="flex items-center gap-2 text-ink-muted">
                <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span>.docx baixado</span>
              </div>
            )}
            {sucesso.baixouPdf && (
              <div className="flex items-center gap-2 text-ink-muted">
                <FileText className="h-3.5 w-3.5 text-red-400 shrink-0" />
                <span>PDF baixado</span>
              </div>
            )}
            {/* Erros — surfacing pro vendedor saber que deu ruim */}
            {sucesso.erro && (
              <div className="flex items-start gap-2 text-danger text-[10.5px] bg-danger/10 border border-danger/30 rounded p-2 mt-1">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span><strong>Upload falhou:</strong> {sucesso.erro}</span>
              </div>
            )}
            {sucesso.pdfErro && (
              <div className="flex items-start gap-2 text-warning text-[10.5px] bg-warning/10 border border-warning/30 rounded p-2 mt-1">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span><strong>PDF não gerou:</strong> {sucesso.pdfErro}</span>
              </div>
            )}
            {algoFalhou && !sucesso.erro && !sucesso.pdfErro && (
              <div className="flex items-start gap-2 text-danger text-[10.5px] bg-danger/10 border border-danger/30 rounded p-2 mt-1">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span><strong>Nada foi salvo!</strong> O orçamento ficou como rascunho. Clique "Tentar de novo" abaixo.</span>
              </div>
            )}
          </div>
          {/* Botão Tentar de novo — só aparece se falhou */}
          {algoFalhou && (
            <button
              onClick={() => { setSucesso(null); setFinalizarOpen(true); }}
              className="w-full bg-danger hover:bg-danger/90 text-white text-[12px] font-semibold py-2.5 flex items-center justify-center gap-2 transition border-t border-border"
            >
              <RefreshCw className="h-4 w-4" />
              Tentar de novo
            </button>
          )}
          {/* COMPARTILHAR via share sheet nativo do celular (Web Share API).
              Em mobile abre menu com WhatsApp, Drive, Email, Files, AirDrop.
              Em desktop sem share API, fallback pra abrir/salvar PDF.
              Vendedor em campo manda direto pro cliente OU pro Drive da empresa. */}
          {/* Botão Compartilhar — só faz sentido se o PDF gerou */}
          {sucesso.pdfBlob ? (
            <button
              onClick={async () => {
                if (!sucesso.pdfBlob) return
                const filename = `${sucesso.numero}-${(sucesso.cliente || 'cliente').replace(/[^a-zA-Z0-9]+/g, '_')}.pdf`
                const file = new File([sucesso.pdfBlob], filename, { type: 'application/pdf' })
                try {
                  if ((navigator as any).canShare?.({ files: [file] })) {
                    await (navigator as any).share({
                      files: [file],
                      title: `Orçamento ${sucesso.numero}`,
                      text: `Orçamento Branorte ${sucesso.numero} — ${sucesso.cliente}`,
                    })
                  } else {
                    // Fallback desktop: abre o PDF em nova aba
                    const url = URL.createObjectURL(sucesso.pdfBlob)
                    window.open(url, '_blank')
                    setTimeout(() => URL.revokeObjectURL(url), 60_000)
                  }
                } catch (e: any) {
                  // AbortError é normal (user cancelou share), ignora
                  if (e?.name !== 'AbortError') alert('Erro ao compartilhar: ' + (e?.message || e))
                }
              }}
              className="w-full bg-info hover:bg-info/90 active:bg-info/80 text-white text-[12px] font-semibold py-2.5 flex items-center justify-center gap-2 transition border-t border-border"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
              Compartilhar PDF (WhatsApp, Drive, Email…)
            </button>
          ) : !algoFalhou && (
            <div className="w-full bg-surface-2 text-ink-faint text-[11px] py-2.5 flex items-center justify-center gap-2 border-t border-border">
              <AlertCircle className="h-3.5 w-3.5" />
              <span>PDF não disponível pra compartilhar</span>
            </div>
          )}

          {sucesso.pdfBlob && enviandoWA !== 'enviado' && (
            <button
              onClick={async () => {
                setEnviandoWA('enviando')
                setEnviandoWAMsg('Detectando vendedor...')
                try {
                  // Pega telefone via postMessage da extensão (se aberto via popup)
                  let telefone = await new Promise<string>((resolve) => {
                    const onMsg = (ev: MessageEvent) => {
                      if (ev.data?.type === 'branorte:vendor-info') {
                        window.removeEventListener('message', onMsg)
                        resolve(ev.data.telefone || '')
                      }
                    }
                    window.addEventListener('message', onMsg)
                    try { window.opener?.postMessage({ type: 'branorte:request-vendor-info' }, '*') } catch {}
                    setTimeout(() => { window.removeEventListener('message', onMsg); resolve('') }, 3000)
                  })
                  if (!telefone) {
                    const saved = localStorage.getItem('branorte_meu_telefone_wa') || ''
                    setWaPromptValue(saved.replace(/^55/, ''))
                    const tel = await new Promise<string | null>((resolve) => {
                      setWaPromptResolve(() => resolve)
                      setWaPromptOpen(true)
                    })
                    setWaPromptOpen(false)
                    setWaPromptResolve(null)
                    if (!tel) throw new Error('Cancelado')
                    const d = tel.replace(/[^\d]/g, '')
                    if (d.length < 10) throw new Error('Telefone inválido')
                    telefone = d.startsWith('55') ? d : '55' + d
                    localStorage.setItem('branorte_meu_telefone_wa', telefone)
                  }
                  setEnviandoWAMsg('Fazendo upload do PDF...')
                  const filename = `${sucesso.numero}-${(sucesso.cliente || 'cliente').replace(/[^a-zA-Z0-9]+/g,'_')}.pdf`
                  const path = `orcamentos/${new Date().toISOString().slice(0,7)}/${filename}`
                  const { error: upErr } = await supabase.storage.from('qr-media').upload(path, sucesso.pdfBlob!, { contentType: 'application/pdf', upsert: true })
                  if (upErr) throw new Error('Upload: ' + upErr.message)
                  const { data: pub } = supabase.storage.from('qr-media').getPublicUrl(path)
                  const { data: { session } } = await supabase.auth.getSession()
                  const r = await fetch('https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/orcamento-enviar-meu-zap', {
                    method: 'POST',
                    headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
                    body: JSON.stringify({ telefone_destino: telefone, pdf_url: pub.publicUrl, filename, cliente_nome: sucesso.cliente }),
                  })
                  const j = await r.json()
                  if (!j.ok) throw new Error(j.error || 'erro')
                  setEnviandoWA('enviado')
                  setEnviandoWAMsg(j.msg)
                } catch (e: any) {
                  setEnviandoWA('erro')
                  setEnviandoWAMsg(e?.message || 'erro')
                }
              }}
              disabled={enviandoWA === 'enviando'}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white text-[12px] font-semibold py-2.5 flex items-center justify-center gap-2 transition"
            >
              {enviandoWA === 'enviando'
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {enviandoWAMsg || 'Enviando...'}</>
                : <><svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.31a7.85 7.85 0 0 0-13.4 5.6 7.85 7.85 0 0 0 1.05 3.94L4 20l4.27-1.12a7.85 7.85 0 0 0 3.74.95h.01a7.86 7.86 0 0 0 5.58-13.52zm-5.58 12.07h-.01a6.52 6.52 0 0 1-3.32-.91l-.24-.14-2.46.65.66-2.4-.16-.25a6.5 6.5 0 0 1-1-3.42 6.52 6.52 0 0 1 11.13-4.61 6.48 6.48 0 0 1 1.91 4.61 6.52 6.52 0 0 1-6.51 6.47z"/></svg> Enviar pro meu WhatsApp</>}
            </button>
          )}
          {enviandoWA === 'enviado' && (
            <div className="px-4 py-2.5 bg-emerald-600/15 border-t border-emerald-600/30 text-[11px] text-emerald-300 flex items-start gap-2">
              <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{enviandoWAMsg}</span>
            </div>
          )}
          {enviandoWA === 'erro' && (
            <div className="px-4 py-2.5 bg-red-600/15 border-t border-red-600/30 text-[11px] text-red-400 flex items-start gap-2">
              <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{enviandoWAMsg}</span>
            </div>
          )}
        </div>
        )
      })()}

      {/* Modal estilizado pra pedir telefone WhatsApp (substitui prompt() feio) */}
      {waPromptOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
          onClick={() => { waPromptResolve?.(null); setWaPromptOpen(false) }}
        >
          <div
            className="bg-bg border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-emerald-600/15 border-b border-emerald-600/30 px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center">
                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.31a7.85 7.85 0 0 0-13.4 5.6 7.85 7.85 0 0 0 1.05 3.94L4 20l4.27-1.12a7.85 7.85 0 0 0 3.74.95h.01a7.86 7.86 0 0 0 5.58-13.52z"/></svg>
              </div>
              <div>
                <div className="text-[13px] font-bold text-ink">SEU WhatsApp</div>
                <div className="text-[11px] text-ink-faint">Pra mandar o PDF pro seu próprio número</div>
              </div>
            </div>
            <div className="p-5">
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Telefone (DDD + número)</label>
              <input
                autoFocus
                type="tel"
                value={waPromptValue}
                onChange={(e) => setWaPromptValue(e.target.value.replace(/[^\d]/g, '').slice(0, 13))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && waPromptValue.replace(/\D/g, '').length >= 10) {
                    waPromptResolve?.(waPromptValue)
                  }
                  if (e.key === 'Escape') { waPromptResolve?.(null); setWaPromptOpen(false) }
                }}
                placeholder="48984692860"
                className="mt-1 w-full px-3 py-2.5 text-[15px] bg-surface-2 border border-border rounded-md focus:outline-none focus:border-emerald-500 text-ink"
              />
              <div className="text-[10px] text-ink-faint mt-1.5">Ex: 48984692860 (sem +55, sem espaços, sem traços)</div>
            </div>
            <div className="bg-surface-2 px-5 py-3 flex justify-end gap-2 border-t border-border">
              <button
                onClick={() => { waPromptResolve?.(null); setWaPromptOpen(false) }}
                className="text-[12px] px-4 py-2 rounded text-ink-muted hover:bg-surface-3 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => waPromptResolve?.(waPromptValue)}
                disabled={waPromptValue.replace(/\D/g, '').length < 10}
                className="text-[12px] px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold transition"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Copiloto IA — botão flutuante + drawer lateral. Faz consultas (leitura)
          e propõe ações de escrita (vendedor aprova clicando nos cards do chat).
          O carrinho_resumo dá contexto pra IA referenciar itens já adicionados. */}
      <OrcamentoAIChat
        contexto={{
          orcamento_id: editingId,
          cliente_nome: initialModal?.cliente_nome ?? null,
          carrinho_resumo: carrinho.length > 0
            ? (() => {
                const fmt = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n)
                const total = carrinho.reduce((acc, c) => acc + c.valor * c.qtd, 0)
                const linhas = carrinho.slice(0, 15).map(c =>
                  `- ${c.qtd}x ${c.nome} [id=${c.catalogo_id}] = ${fmt(c.valor * c.qtd)}`
                )
                const sufixo = carrinho.length > 15 ? `\n…e mais ${carrinho.length - 15} itens` : ''
                return `${linhas.join('\n')}${sufixo}\n\nTOTAL ATUAL: ${fmt(total)} (${carrinho.length} ${carrinho.length === 1 ? 'item' : 'itens'})`
              })()
            : null,
        }}
        onAdicionarItem={(preco_id, qtd) => {
          const p = (precos ?? []).find(x => x.id === preco_id)
          if (!p) return
          adicionarItemDePreco(p, undefined, undefined, Math.max(1, qtd || 1))
        }}
        onCarregarPacote={(modelo_id) => {
          const m = (modelos ?? []).find(x => x.id === modelo_id)
          console.log('[CRM] onCarregarPacote id:', modelo_id, 'found:', !!m, 'modelos count:', (modelos ?? []).length)
          if (!m) {
            console.warn('[CRM] Modelo não encontrado! ID:', modelo_id)
            return
          }
          // Quando vem da IA, SEMPRE append (a IA pode ter adicionado itens
          // antes mas o state do React ainda não atualizou neste tick)
          carregarDoModelo(m, true)
        }}
        onPreencherCliente={(dados) => {
          // Merge nos dados do modal de finalização. Quando o vendedor clicar
          // em "Finalizar", o FinalizarMontarModal abre com esses campos preenchidos.
          setInitialModal(prev => ({
            cliente_nome: dados.nome ?? prev?.cliente_nome ?? '',
            cliente_dados: { ...(prev?.cliente_dados ?? {}), ...dados },
            observacoes: prev?.observacoes ?? null,
            forma_pagamento: prev?.forma_pagamento ?? null,
            prazo_entrega: prev?.prazo_entrega ?? null,
          }))
        }}
        onDrawerToggle={setAiDrawerOpen}
        onFinalizarOrcamento={(opts) => {
          // Pré-preenche cliente se IA mandou + abre o modal FinalizarMontarModal.
          // Vendedor revisa e clica em "Gerar" — fluxo padrão (PDF, save, WhatsApp).
          if (opts.cliente_dados) {
            setInitialModal(prev => ({
              cliente_nome: opts.cliente_dados!.nome ?? prev?.cliente_nome ?? '',
              cliente_dados: { ...(prev?.cliente_dados ?? {}), ...opts.cliente_dados },
              observacoes: prev?.observacoes ?? null,
              forma_pagamento: prev?.forma_pagamento ?? null,
              prazo_entrega: prev?.prazo_entrega ?? null,
            }))
          }
          // Carrinho vazio? avisa antes de abrir o modal (que pediria items)
          if (carrinho.length === 0) {
            alert('Adicione items ao carrinho antes de finalizar. A IA pode te ajudar com isso.')
            return
          }
          // Auto-submit SE IA pré-preencheu cliente (zero atrito)
          const temCliente = !!opts.cliente_dados?.nome
          setAutoSubmitFromIA(temCliente)
          setFinalizarOpen(true)
        }}
      />
    </div>
  )
}


// ──────────────────────────────────────────────────────────────────────────
// Selector de modelo pronto (carrega items + motores + acessórios do banco)
// ──────────────────────────────────────────────────────────────────────────
// Picker grande de modelos de pacote (Compactas + Mini Fabrica).
// Mostra os 65 modelos com itens estruturados, com filtro por pacote e voltagem.
// Ao clicar, carrega TODOS os itens (transportador + moinho + misturador + acessórios + motores).
function PacoteModeloPickerModal({
  open, onClose, onPick, initialPacote,
}: {
  open: boolean
  onClose: () => void
  onPick: (m: OrcamentoModelo) => void
  initialPacote?: string
}) {
  const { data: modelos, isLoading } = useOrcamentoModelos()
  const [pacote, setPacote] = useState<string | 'todos'>('todos')
  const [voltagem, setVoltagem] = useState<'todos' | 'monofasico' | 'trifasico'>('todos')
  const [masterFilter, setMasterFilter] = useState<'todos' | 'master' | 'standard'>('todos')
  const [busca, setBusca] = useState('')

  useEffect(() => {
    if (open) { setPacote(initialPacote ?? 'todos'); setVoltagem('todos'); setMasterFilter('todos'); setBusca('') }
  }, [open, initialPacote])

  // Só os pacotes COMPACTA + MINI FABRICA (são os com itens estruturados)
  const pacotesDisponiveis = useMemo(() => {
    if (!modelos) return [] as string[]
    const set = new Set<string>()
    for (const m of modelos) {
      if (m.itens && m.itens.length > 0 && m.pacote) set.add(m.pacote)
    }
    return [...set].sort()
  }, [modelos])

  const filtrados = useMemo(() => {
    if (!modelos) return [] as OrcamentoModelo[]
    const q = busca.toLowerCase().trim()
    return modelos
      .filter(m => m.itens && m.itens.length > 0)
      .filter(m => pacote === 'todos' || m.pacote === pacote)
      .filter(m => voltagem === 'todos' || m.voltagem === voltagem)
      .filter(m => masterFilter === 'todos' || (masterFilter === 'master' ? m.is_master : !m.is_master))
      .filter(m => !q || m.basename.toLowerCase().includes(q))
      .sort((a, b) => (a.producao_kgh ?? 0) - (b.producao_kgh ?? 0) || a.basename.localeCompare(b.basename))
  }, [modelos, pacote, voltagem, masterFilter, busca])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-xl max-w-4xl w-full shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold">Kits completos · pré-montados</div>
            <div className="text-[15px] font-bold text-ink leading-tight">Fábricas Compactas + Mini Fábrica</div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              {modelos ? `${filtrados.length} de ${modelos.filter(m => m.itens?.length).length}` : '…'} modelos · carrega todos os items + motores + acessórios de uma vez
            </div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1 -m-1"><X className="h-4 w-4" /></button>
        </div>

        {/* Filtros */}
        <div className="px-4 py-2 border-b border-border bg-surface-2/30 flex flex-wrap gap-2 items-center">
          <span className="text-[10px] uppercase font-bold text-ink-muted">Pacote:</span>
          <button
            onClick={() => setPacote('todos')}
            className={`text-[11px] px-2 py-1 rounded font-semibold ${pacote === 'todos' ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'}`}
          >Todos</button>
          {pacotesDisponiveis.map(p => (
            <button
              key={p}
              onClick={() => setPacote(p)}
              className={`text-[11px] px-2 py-1 rounded font-semibold ${pacote === p ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'}`}
            >{p}</button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
          <span className="text-[10px] uppercase font-bold text-ink-muted">Voltagem:</span>
          {([['todos','Todas'], ['monofasico','Mono'], ['trifasico','Tri']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setVoltagem(v)}
              className={`text-[11px] px-2 py-1 rounded font-semibold ${voltagem === v ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'}`}
            >{l}</button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
          {([['todos','Todas'], ['standard','Standard'], ['master','Master']] as const).map(([v, l]) => (
            <button
              key={v}
              onClick={() => setMasterFilter(v as typeof masterFilter)}
              className={`text-[11px] px-2 py-1 rounded font-semibold ${masterFilter === v
                ? (v === 'master' ? 'bg-amber-500 text-white' : 'bg-accent text-white')
                : 'bg-surface-2 text-ink-muted hover:bg-surface-3'}`}
            >{l}</button>
          ))}
          <input
            type="text"
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar (ex: 75150, master, jr)..."
            className="ml-auto px-2 py-1 bg-surface-2 border border-border rounded text-[11px] text-ink focus:border-accent outline-none w-44"
          />
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {isLoading ? (
            <div className="text-center py-12 text-ink-faint text-[12px]">Carregando modelos…</div>
          ) : filtrados.length === 0 ? (
            <div className="text-center py-12 text-ink-faint text-[12px]">Nenhum modelo com esses filtros.</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 p-3">
              {filtrados.map(m => (
                <button
                  key={m.id}
                  onClick={() => onPick(m)}
                  className="text-left p-3 rounded-lg border border-border hover:border-accent hover:bg-surface-2 transition-all flex items-start gap-3"
                >
                  {m.foto_url ? (
                    <img
                      src={m.foto_url}
                      alt={m.basename}
                      className="w-16 h-16 object-cover rounded border border-border shrink-0 bg-white"
                      loading="lazy"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-16 h-16 rounded border border-border bg-surface-2 shrink-0 flex items-center justify-center text-ink-faint">
                      <Package className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <span className="text-[12px] font-bold text-ink leading-tight">{m.basename}</span>
                      <span className="text-[11px] font-bold text-success tabular-nums shrink-0">{formatBRL(Number(m.total_proposta))}</span>
                    </div>
                    <div className="text-[10px] text-ink-faint mt-1 flex items-center gap-1.5 flex-wrap">
                      {m.pacote && <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent font-bold">{m.pacote}</span>}
                      <span className={m.voltagem === 'trifasico' ? 'text-info' : 'text-warning'}>{m.voltagem}</span>
                      {m.is_master && <span className="text-warning font-bold">MASTER</span>}
                      {m.is_jr && <span className="text-info font-bold">JR</span>}
                      {m.producao_kgh && <span>· {m.producao_kgh} kg/h</span>}
                      {m.armazenamento_kg && <span>· {m.armazenamento_kg} kg</span>}
                    </div>
                    <div className="text-[10px] text-ink-muted mt-1">
                      {m.itens.length} {m.itens.length === 1 ? 'item' : 'itens'} · {m.motores.length} {m.motores.length === 1 ? 'motor' : 'motores'}
                      {m.acessorios && m.acessorios.items?.length ? ` · ${m.acessorios.items.length} acessórios` : ''}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="px-4 py-2 border-t border-border bg-surface-2/30 text-[10px] text-ink-faint">
          ⓘ Clique num modelo: substitui o carrinho pelos itens dele. Linkados automaticamente ao catálogo (foto + categoria + motor por CV detectado).
        </div>
      </div>
    </div>
  )
}

function SelectorModelo({ onCarregar }: { onCarregar: (m: OrcamentoModelo) => void }) {
  const { data: modelos, isLoading } = useOrcamentoModelos()
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const filtrados = useMemo(() => {
    if (!modelos) return []
    if (!busca.trim()) return modelos
    const q = busca.toLowerCase()
    return modelos.filter(m =>
      m.basename.toLowerCase().includes(q) ||
      (m.pacote || '').toLowerCase().includes(q)
    )
  }, [modelos, busca])
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] px-3 py-1.5 rounded font-semibold bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 items-center gap-1.5 hidden"
        title="Carregar items a partir de um modelo pronto"
      >
        <Package className="h-3.5 w-3.5" />
        Carregar Modelo {modelos && `(${modelos.length})`}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="fixed sm:absolute top-[60px] sm:top-full left-2 right-2 sm:left-auto sm:right-0 sm:mt-1 sm:w-[420px] max-h-[70vh] sm:max-h-[60vh] overflow-hidden bg-bg border border-border rounded-lg shadow-2xl z-50 flex flex-col">
            <div className="p-2 border-b border-border bg-surface-2">
              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar modelo (ex: compacta, mini fabrica)..."
                className="w-full px-2 py-1.5 bg-bg border border-border rounded text-[11px] text-ink focus:border-accent outline-none"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading && <div className="p-4 text-[11px] text-ink-muted text-center">Carregando modelos…</div>}
              {!isLoading && filtrados.length === 0 && <div className="p-4 text-[11px] text-ink-muted text-center">Nenhum modelo encontrado</div>}
              {filtrados.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onCarregar(m); setOpen(false); setBusca('') }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-2 border-b border-border/50 group flex items-center gap-2.5"
                >
                  {m.foto_url ? (
                    <img
                      src={m.foto_url}
                      alt={m.basename}
                      className="w-12 h-12 object-cover rounded-md border border-border shrink-0 bg-white"
                      loading="lazy"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-md border border-border bg-surface-2 shrink-0 flex items-center justify-center text-ink-faint">
                      <Package className="h-4 w-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-ink truncate">{m.basename}</span>
                      <span className="text-[10px] font-bold text-success tabular-nums shrink-0">{formatBRL(Number(m.total_proposta))}</span>
                    </div>
                    <div className="text-[9px] text-ink-faint mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {m.pacote && <span className="px-1 py-0.5 rounded bg-surface-3 text-accent font-bold">{m.pacote}</span>}
                      <span className="text-blue-400 font-medium">{m.voltagem}</span>
                      {m.is_master && <span className="text-warning font-bold">MASTER</span>}
                      {m.is_jr && <span className="text-info font-bold">JR</span>}
                      <span>· {m.itens.length} items · {m.motores.length} motores</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}


// ──────────────────────────────────────────────────────────────────────────
// Card de item do catálogo (esquerda)
// ──────────────────────────────────────────────────────────────────────────

function CardItem({
  item, voltagem, motores, onAdd,
}: {
  item: CatalogoItem
  voltagem: Voltagem
  motores: CatalogoMotor[]
  onAdd: () => void
}) {
  const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos
    ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagem, voltagem === 'monofasico')
    : null
  const motorValor = motorMatch ? Number(motorMatch.valor) * (item.motor_padrao_qtd || 1) : 0
  const totalComMotor = Number(item.valor) + motorValor

  return (
    <button
      onClick={onAdd}
      className="text-left p-2 rounded-lg border border-border hover:border-accent hover:bg-surface-2 transition-all group flex items-center gap-2.5 relative"
    >
      {item.foto_url ? (
        <img
          src={item.foto_url}
          alt={item.nome_curto}
          className="w-14 h-14 object-cover rounded-md border border-border shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-14 h-14 rounded-md border border-border bg-surface-2 shrink-0 flex items-center justify-center text-ink-faint">
          <Package className="h-5 w-5" />
        </div>
      )}
      <div className="flex-1 min-w-0 self-stretch flex flex-col justify-between py-0.5">
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[9px] uppercase tracking-wider text-accent font-bold truncate">
              {item.categoria}
            </span>
            {item.is_oficial && <Check className="h-2.5 w-2.5 text-success shrink-0" />}
            {item.preco_branorte_id && (
              <span
                className="text-[8px] uppercase font-bold px-1 py-[1px] rounded bg-success/15 text-success border border-success/30 shrink-0"
                title="Preço sincronizado com a Tabela de Preços Branorte oficial"
              >
                $ Oficial
              </span>
            )}
            {item.funcao_opcoes && item.funcao_opcoes.length > 1 && (
              <span
                className="text-[8px] uppercase font-bold px-1 py-[1px] rounded bg-info/20 text-info border border-info/30 shrink-0"
                title={`Escolha de função obrigatória ao adicionar: ${item.funcao_opcoes.join(', ')}`}
              >
                {item.funcao_opcoes.length} opções
              </span>
            )}
          </div>
          <div className="text-[13px] font-semibold text-ink leading-snug" title={item.nome_curto}>
            {item.nome_curto}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {item.motor_padrao_cv && (
            <div className="text-[9px] text-ink-faint leading-none flex items-center gap-0.5">
              ⚡ <span>{item.motor_padrao_cv} CV {item.motor_padrao_polos}p</span>
            </div>
          )}
        </div>
      </div>
      <div className="text-right shrink-0 self-stretch flex flex-col justify-center">
        <div className="text-[12px] font-bold text-ink leading-tight tabular-nums">
          {formatBRL(Number(item.valor))}
        </div>
        {motorValor > 0 && (
          <div className="text-[10px] font-semibold text-accent leading-tight tabular-nums mt-0.5">
            ={formatBRL(totalComMotor)}
          </div>
        )}
      </div>
      <Plus className="h-3.5 w-3.5 text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0 absolute top-1.5 right-1.5" />
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Linha do carrinho em modo EDIÇÃO (controles compactos)
// ──────────────────────────────────────────────────────────────────────────

function CarrinhoLinhaEdicao({
  item, onRemove, onQtd, onValor,
}: {
  item: CarrinhoItem
  onRemove: () => void
  onQtd: (n: number) => void
  onValor: (v: number) => void
}) {
  const [editingValor, setEditingValor] = useState(false)
  const subtotal = item.valor * item.qtd
  const motorTotal = item.motor_valor_unit * item.motor_qtd * item.qtd
  const totalLinha = subtotal + motorTotal
  const valorEditado = item.valor !== item.valor_original

  return (
    <div className="p-3 hover:bg-surface-2/30 transition-colors group">
      <div className="flex gap-3">
        {/* Foto à esquerda */}
        <div className="shrink-0">
          {item.foto_url ? (
            <img
              src={item.foto_url}
              alt={item.nome}
              className="w-14 h-14 object-cover rounded border border-border bg-white"
              loading="lazy"
            />
          ) : (
            <div className="w-14 h-14 rounded border border-border bg-surface-2 flex items-center justify-center text-ink-faint">
              <Package className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Info + controles à direita */}
        <div className="flex-1 min-w-0">
          {/* Header: categoria + nome + remover */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[9px] uppercase tracking-wider text-ink-faint font-bold">
                {item.categoria}
              </div>
              <div className="text-[12px] font-semibold text-ink leading-tight">
                {item.nome}
              </div>
              {item.motor_cv && (
                <div className="text-[10px] text-ink-muted mt-1 flex items-center gap-1.5">
                  <Zap className="h-2.5 w-2.5 text-warning" />
                  <span>Motor {item.motor_cv} CV {item.motor_polos} polos{item.motor_qtd > 1 && ` (x${item.motor_qtd})`}</span>
                  {item.motor_valor_unit > 0
                    ? <span className="text-ink-faint">— {formatBRL(item.motor_valor_unit * item.motor_qtd)}/un</span>
                    : (
                      <span className="text-warning flex items-center gap-0.5">
                        <AlertCircle className="h-2.5 w-2.5" />
                        sem motor cadastrado
                      </span>
                    )
                  }
                </div>
              )}
            </div>
            <button
              onClick={onRemove}
              className="text-ink-faint hover:text-danger shrink-0 p-1 opacity-50 group-hover:opacity-100 transition-opacity"
              title="Remover item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Controles: qtd + valor unit + total */}
          <div className="flex items-center justify-between gap-3 mt-2.5 pt-2 border-t border-border/50">
            {/* Quantidade */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-ink-faint font-semibold">Qtd</span>
              <div className="flex items-center bg-surface-2 border border-border rounded">
                <button
                  onClick={() => onQtd(item.qtd - 1)}
                  disabled={item.qtd <= 1}
                  className="px-1.5 py-1 text-ink-muted hover:text-ink hover:bg-surface-3 disabled:opacity-30 disabled:hover:bg-transparent rounded-l"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="text-[12px] font-bold w-7 text-center text-ink">{item.qtd}</span>
                <button
                  onClick={() => onQtd(item.qtd + 1)}
                  className="px-1.5 py-1 text-ink-muted hover:text-ink hover:bg-surface-3 rounded-r"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Valor unitário (editável) */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-ink-faint font-semibold">Unit.</span>
              {editingValor ? (
                <input
                  type="number"
                  value={item.valor}
                  onChange={e => onValor(Number(e.target.value) || 0)}
                  onBlur={() => setEditingValor(false)}
                  onKeyDown={e => { if (e.key === 'Enter') setEditingValor(false) }}
                  autoFocus
                  className="w-24 text-[11px] text-right bg-surface-1 border border-accent rounded px-1.5 py-0.5"
                />
              ) : (
                <button
                  onClick={() => setEditingValor(true)}
                  className={`text-[11px] px-2 py-0.5 rounded border ${valorEditado ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border bg-surface-2 text-ink hover:border-accent/50'}`}
                  title="Clique pra editar"
                >
                  {formatBRL(item.valor)}
                  {valorEditado && <span className="ml-1 text-[9px]">●</span>}
                </button>
              )}
            </div>

            {/* Total da linha */}
            <div className="text-right ml-auto">
              <div className="text-[9px] uppercase tracking-wider text-ink-faint font-semibold">Total</div>
              <div className="text-[13px] font-bold text-accent leading-tight">
                {formatBRL(totalLinha)}
              </div>
              {motorTotal > 0 && (
                <div className="text-[8.5px] text-ink-faint leading-tight">
                  equip {formatBRL(subtotal)} + motor {formatBRL(motorTotal)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de Acessórios (% sobre equipamentos + lista de itens)
// ──────────────────────────────────────────────────────────────────────────

function AcessoriosModal({
  open, initial, carrinho, onClose, onSave, onRemove,
}: {
  open: boolean
  initial: { pct: number; items: string[]; valorFixo?: number | null; excludedItemUids?: string[] } | null
  carrinho: CarrinhoItem[]
  onClose: () => void
  onSave: (cfg: { pct: number; items: string[]; valorFixo: number | null; excludedItemUids: string[] }) => void
  onRemove: () => void
}) {
  const { data: catalogoAcc } = useCatalogoAcessorios()
  const initialModo: 'pct' | 'valor' =
    initial?.valorFixo != null && initial.valorFixo > 0 ? 'valor' : 'pct'
  const [modo, setModo] = useState<'pct' | 'valor'>(initialModo)
  const [pct, setPct] = useState<number>(initial?.pct ?? 5)
  const [valorFixo, setValorFixo] = useState<number>(initial?.valorFixo ?? 0)
  const [selecionados, setSelecionados] = useState<string[]>(initial?.items ?? [])
  const [busca, setBusca] = useState('')
  const [livre, setLivre] = useState('')
  // UIDs do carrinho EXCLUÍDOS da base de cálculo do %. Default vazio = todos entram.
  const [excludedUids, setExcludedUids] = useState<string[]>(initial?.excludedItemUids ?? [])

  useEffect(() => {
    if (open) {
      setModo(initial?.valorFixo != null && initial.valorFixo > 0 ? 'valor' : 'pct')
      setPct(initial?.pct ?? 5)
      setValorFixo(initial?.valorFixo ?? 0)
      setSelecionados(initial?.items ?? [])
      setExcludedUids(initial?.excludedItemUids ?? [])
      setBusca('')
      setLivre('')
    }
  }, [open, initial])

  // Base de cálculo (preview ao vivo dentro do modal).
  const itensCarrinho = useMemo(
    () => carrinho.filter(c => !c.brinde && !c.por_conta_cliente),
    [carrinho],
  )
  const baseCalculo = useMemo(() => {
    const excl = new Set(excludedUids)
    return itensCarrinho.reduce(
      (s, c) => s + (excl.has(c.uid) ? 0 : c.valor * c.qtd),
      0,
    )
  }, [itensCarrinho, excludedUids])
  const valorPreview = Math.ceil((baseCalculo * (Number(pct) || 0)) / 100)

  function toggleExclusao(uid: string) {
    setExcludedUids(prev =>
      prev.includes(uid) ? prev.filter(x => x !== uid) : [...prev, uid],
    )
  }

  // Top sugeridos (top 12 por ocorrencias)
  const sugeridos = useMemo(() => {
    const arr = (catalogoAcc ?? []).slice().sort((a, b) => b.ocorrencias - a.ocorrencias)
    return arr.slice(0, 12)
  }, [catalogoAcc])

  const filtrados = useMemo(() => {
    if (!catalogoAcc) return []
    const q = busca.trim().toLowerCase()
    if (!q) return []
    return catalogoAcc
      .filter(a => a.nome.toLowerCase().includes(q) && !selecionados.includes(a.nome))
      .slice(0, 30)
  }, [catalogoAcc, busca, selecionados])

  if (!open) return null

  function toggleAcessorio(nome: string) {
    setSelecionados(prev =>
      prev.includes(nome) ? prev.filter(x => x !== nome) : [...prev, nome],
    )
  }

  function removerSel(nome: string) {
    setSelecionados(prev => prev.filter(x => x !== nome))
  }

  function adicionarLivre() {
    const txt = livre.trim()
    if (txt && !selecionados.includes(txt)) {
      setSelecionados(prev => [...prev, txt])
      setLivre('')
    }
  }

  function handleSalvar() {
    const pctClamp = Math.max(0, Math.min(100, pct))
    if (modo === 'valor') {
      const vf = Math.max(0, Number(valorFixo) || 0)
      onSave({ pct: pctClamp, items: selecionados, valorFixo: vf > 0 ? vf : null, excludedItemUids: excludedUids })
    } else {
      onSave({ pct: pctClamp, items: selecionados, valorFixo: null, excludedItemUids: excludedUids })
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-bg border border-border rounded-lg max-w-2xl w-full shadow-2xl flex flex-col max-h-[85vh]">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ink">Acessórios do orçamento</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-3 border-b border-border bg-surface-2/30">
          <div className="flex items-center gap-1 mb-2">
            <button
              type="button"
              onClick={() => setModo('pct')}
              className={`text-[11px] px-2.5 py-1 rounded font-semibold border ${
                modo === 'pct'
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-2 text-ink-muted border-border hover:border-accent'
              }`}
            >% sobre equipamentos</button>
            <button
              type="button"
              onClick={() => setModo('valor')}
              className={`text-[11px] px-2.5 py-1 rounded font-semibold border ${
                modo === 'valor'
                  ? 'bg-accent text-white border-accent'
                  : 'bg-surface-2 text-ink-muted border-border hover:border-accent'
              }`}
            >R$ valor fixo</button>
          </div>
          {modo === 'pct' ? (
            <>
              <label className="text-[11px] font-semibold text-ink-muted block mb-1">
                % sobre equipamentos (valor cobrado)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={pct}
                  onChange={e => setPct(Number(e.target.value))}
                  className="w-24 text-center"
                />
                <span className="text-[12px] text-ink-muted">%</span>
                <div className="text-[10px] text-ink-faint ml-auto">ex: 5% / 10% / 15%</div>
              </div>
            </>
          ) : (
            <>
              <label className="text-[11px] font-semibold text-ink-muted block mb-1">
                Valor fixo dos acessórios (R$)
              </label>
              <div className="flex items-center gap-2">
                <span className="text-[12px] text-ink-muted">R$</span>
                <Input
                  type="number"
                  min={0}
                  step={0.01}
                  value={valorFixo}
                  onChange={e => setValorFixo(Number(e.target.value))}
                  className="w-36 text-center"
                  placeholder="0,00"
                />
                <div className="text-[10px] text-ink-faint ml-auto">ex: 6.500,00 — valor cobrado direto</div>
              </div>
            </>
          )}
        </div>

        {/* Base de cálculo do % — checkbox por item do carrinho */}
        {modo === 'pct' && itensCarrinho.length > 0 && (
          <div className="px-5 py-3 border-b border-border bg-surface-2/20">
            <div className="flex items-center justify-between mb-2">
              <label className="text-[11px] font-semibold text-ink-muted">
                Base de cálculo ({itensCarrinho.length - excludedUids.length} de {itensCarrinho.length} itens)
              </label>
              <div className="flex items-center gap-2">
                {excludedUids.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExcludedUids([])}
                    className="text-[10px] text-accent hover:underline"
                  >Marcar todos</button>
                )}
                {excludedUids.length < itensCarrinho.length && (
                  <button
                    type="button"
                    onClick={() => setExcludedUids(itensCarrinho.map(c => c.uid))}
                    className="text-[10px] text-ink-faint hover:text-ink"
                  >Desmarcar todos</button>
                )}
              </div>
            </div>
            <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
              {itensCarrinho.map(c => {
                const excl = excludedUids.includes(c.uid)
                const subtotal = c.valor * c.qtd
                const nomeExibir = c.nome_custom || c.nome
                return (
                  <label
                    key={c.uid}
                    className={`flex items-center gap-2 px-2 py-1 rounded cursor-pointer text-[11px] hover:bg-surface-2/60 ${
                      excl ? 'opacity-50' : ''
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={!excl}
                      onChange={() => toggleExclusao(c.uid)}
                      className="h-3.5 w-3.5 accent-accent"
                    />
                    <span className="flex-1 truncate text-ink">{nomeExibir}</span>
                    <span className="text-ink-muted font-mono whitespace-nowrap">
                      R$ {subtotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </label>
                )
              })}
            </div>
            <div className="mt-2 pt-2 border-t border-border/60 flex items-center justify-between text-[11px]">
              <span className="text-ink-muted">
                Base: <span className="text-ink font-semibold">R$ {baseCalculo.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span> × {pct || 0}%
              </span>
              <span className="text-success font-semibold">
                = R$ {valorPreview.toLocaleString('pt-BR')}
              </span>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          {/* Selecionados */}
          {selecionados.length > 0 && (
            <div>
              <label className="text-[10px] uppercase font-bold text-success block mb-1.5">
                Selecionados ({selecionados.length})
              </label>
              <div className="flex flex-wrap gap-1.5">
                {selecionados.map(nome => (
                  <span
                    key={nome}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-success/15 border border-success/30 text-[11px] text-ink"
                  >
                    {nome}
                    <button
                      onClick={() => removerSel(nome)}
                      className="text-ink-faint hover:text-danger"
                      title="Remover"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Sugeridos (top por uso) */}
          {sugeridos.length > 0 && (
            <div>
              <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1.5 flex items-center gap-1.5">
                <Star className="h-3 w-3 text-warning" /> Mais usados nos orçamentos
              </label>
              <div className="flex flex-wrap gap-1.5">
                {sugeridos.map(a => {
                  const ativo = selecionados.includes(a.nome)
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleAcessorio(a.nome)}
                      className={`text-[11px] px-2 py-1 rounded-full border transition-all ${
                        ativo
                          ? 'bg-success text-white border-success'
                          : 'bg-surface-2 border-border hover:border-accent text-ink-muted'
                      }`}
                      title={`Usado em ${a.ocorrencias} orçamentos`}
                    >
                      {ativo ? '✓ ' : '+ '}{a.nome}
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {/* Busca no catálogo */}
          <div>
            <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1.5">
              Buscar no catálogo ({catalogoAcc?.length ?? 0} acessórios)
            </label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
              <Input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Ex: bandeja, registro, sensor..."
                className="pl-7"
              />
            </div>
            {filtrados.length > 0 && (
              <div className="mt-2 flex flex-col gap-0.5 max-h-48 overflow-y-auto border border-border rounded">
                {filtrados.map(a => (
                  <button
                    key={a.id}
                    onClick={() => toggleAcessorio(a.nome)}
                    className="text-left px-2 py-1.5 hover:bg-surface-2 text-[11px] text-ink flex items-center justify-between gap-2 border-b border-border/30 last:border-b-0"
                  >
                    <span className="flex-1 truncate">{a.nome}</span>
                    {a.ocorrencias > 0 && (
                      <span className="text-[9px] text-ink-faint shrink-0">{a.ocorrencias}x</span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Texto livre */}
          <div>
            <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1.5">
              Adicionar livre (não está no catálogo)
            </label>
            <div className="flex gap-1.5">
              <Input
                value={livre}
                onChange={e => setLivre(e.target.value)}
                placeholder="Digite e tecle Enter"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); adicionarLivre() } }}
                className="flex-1"
              />
              <button
                onClick={adicionarLivre}
                disabled={!livre.trim()}
                className="px-3 py-1.5 bg-accent/15 hover:bg-accent/25 text-accent text-[11px] font-semibold rounded border border-accent/30 disabled:opacity-40"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>

        <div className="px-5 py-3 border-t border-border flex gap-2">
          <button
            onClick={handleSalvar}
            className="flex-1 bg-accent hover:bg-accent-700 text-white text-[12px] font-semibold py-2 rounded"
          >
            Salvar ({selecionados.length} {selecionados.length === 1 ? 'item' : 'itens'})
          </button>
          {initial && (
            <button
              onClick={onRemove}
              className="px-3 py-2 text-[12px] text-danger hover:bg-danger/10 rounded border border-danger/30"
            >
              Remover
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-2 text-[12px] text-ink-muted hover:bg-surface-2 rounded"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal: adicionar produto personalizado (ad-hoc) ao carrinho
// ──────────────────────────────────────────────────────────────────────────

function CustomItemModal({
  open, categorias, onClose, onAdd,
}: {
  open: boolean
  categorias: string[]
  onClose: () => void
  onAdd: (data: {
    nome: string
    categoria: string
    valor: number
    motor_cv: number | null
    motor_polos: number | null
    motorIncluso: boolean
    descricao: string | null
    foto_url: string | null
    enviarParaAprovacao: boolean
    porContaCliente: boolean
  }) => Promise<void>
}) {
  const [nome, setNome] = useState('')
  const [categoria, setCategoria] = useState('CUSTOM')
  const [valor, setValor] = useState<number | ''>('')
  const [motorCv, setMotorCv] = useState<number | ''>('')
  const [motorPolos, setMotorPolos] = useState<number | '' | 'incluso'>('')
  const [descricao, setDescricao] = useState('')
  const [enviarParaAprovacao, setEnviarParaAprovacao] = useState(false)
  const [porContaCliente, setPorContaCliente] = useState(false)
  const [salvando, setSalvando] = useState(false)
  const [fotoUrl, setFotoUrl] = useState<string | null>(null)
  const [uploadingFoto, setUploadingFoto] = useState(false)
  const [erroUpload, setErroUpload] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setNome(''); setCategoria('CUSTOM'); setValor('')
      setMotorCv(''); setMotorPolos(''); setDescricao('')
      setEnviarParaAprovacao(false); setPorContaCliente(false); setSalvando(false)
      setFotoUrl(null); setUploadingFoto(false); setErroUpload(null)
    }
  }, [open])

  if (!open) return null

  // Item "por conta do cliente": não precisa de valor (cliente fornece/compra).
  const valido = nome.trim().length >= 3 && (porContaCliente || (typeof valor === 'number' && valor > 0))

  async function handleUploadFoto(file: File) {
    if (!file) return
    if (file.size > 8 * 1024 * 1024) {
      setErroUpload('Imagem muito grande (máx. 8MB)')
      return
    }
    if (!file.type.startsWith('image/')) {
      setErroUpload('Arquivo precisa ser uma imagem')
      return
    }
    setErroUpload(null)
    setUploadingFoto(true)
    try {
      const ext = (file.name.split('.').pop() || file.type.split('/').pop() || 'jpg').toLowerCase()
      const ts = Date.now()
      const rand = Math.random().toString(36).slice(2, 7)
      const path = `custom/${ts}-${rand}.${ext}`
      const { error: upErr } = await supabase.storage
        .from('catalogo-fotos')
        .upload(path, file, { upsert: false, contentType: file.type || undefined })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('catalogo-fotos').getPublicUrl(path)
      setFotoUrl(pub.publicUrl)
    } catch (err: any) {
      setErroUpload(err?.message || 'Falha no upload')
    } finally {
      setUploadingFoto(false)
    }
  }

  async function handleSubmit() {
    if (!valido || salvando) return
    setSalvando(true)
    try {
      const motorIncluso = motorPolos === 'incluso'
      await onAdd({
        nome: nome.trim(),
        categoria: categoria || 'CUSTOM',
        valor: porContaCliente ? 0 : Number(valor),
        motor_cv: typeof motorCv === 'number' && motorCv > 0 ? motorCv : null,
        motor_polos: motorIncluso ? 0 : (typeof motorPolos === 'number' && motorPolos > 0 ? motorPolos : null),
        motorIncluso,
        descricao: descricao.trim() || null,
        foto_url: fotoUrl,
        enviarParaAprovacao: porContaCliente ? false : enviarParaAprovacao,
        porContaCliente,
      })
    } finally {
      setSalvando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-xl max-w-lg w-full shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-start gap-3">
          <Plus className="h-5 w-5 text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold">Produto personalizado</div>
            <div className="text-[14px] font-bold text-ink leading-tight">Adicionar item fora do catálogo</div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1 -m-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-y-auto">
          <div>
            <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1">Nome do produto *</label>
            <Input
              value={nome}
              onChange={e => setNome(e.target.value)}
              placeholder="Ex: Caixa metálica 800L com tampa"
              autoFocus
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1">Categoria</label>
              <select
                value={categoria}
                onChange={e => setCategoria(e.target.value)}
                className="w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-[12px] text-ink"
              >
                <option value="CUSTOM">CUSTOM (genérico)</option>
                {categorias.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1">
                Valor unitário (R$){porContaCliente ? '' : ' *'}
              </label>
              <Input
                type="number"
                value={porContaCliente ? '' : valor}
                onChange={e => setValor(e.target.value ? Number(e.target.value) : '')}
                placeholder={porContaCliente ? 'Por conta do cliente' : '0,00'}
                min="0"
                step="0.01"
                disabled={porContaCliente}
                className={porContaCliente ? 'opacity-50 cursor-not-allowed' : undefined}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1">Motor CV (opcional)</label>
              <Input
                type="number"
                value={motorCv}
                onChange={e => setMotorCv(e.target.value ? Number(e.target.value) : '')}
                placeholder="Ex: 3"
                min="0"
                step="0.5"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1">Polos (opcional)</label>
              <select
                value={motorPolos === '' ? '' : String(motorPolos)}
                onChange={e => {
                  const v = e.target.value
                  setMotorPolos(v === '' ? '' : v === 'incluso' ? 'incluso' : Number(v))
                }}
                className="w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-[12px] text-ink"
              >
                <option value="">—</option>
                <option value="2">2 polos</option>
                <option value="4">4 polos</option>
                <option value="6">6 polos</option>
                <option value="8">8 polos</option>
                <option value="incluso">Motorredutor incluso</option>
              </select>
            </div>
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1">Descrição / especificações (opcional)</label>
            <textarea
              value={descricao}
              onChange={e => setDescricao(e.target.value)}
              placeholder="Detalhes técnicos, observações..."
              className="w-full bg-surface-2 border border-border rounded px-2 py-1.5 text-[12px] text-ink min-h-[60px]"
            />
          </div>

          <div>
            <label className="text-[10px] uppercase font-bold text-ink-muted block mb-1">Foto do produto (opcional)</label>
            {fotoUrl ? (
              <div className="flex items-center gap-3">
                <img
                  src={fotoUrl}
                  alt="Pré-visualização"
                  className="w-20 h-20 object-cover rounded border border-border bg-white"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-[11px] text-success font-semibold flex items-center gap-1">
                    <Check className="h-3 w-3" />
                    Imagem carregada
                  </div>
                  <button
                    onClick={() => setFotoUrl(null)}
                    className="text-[10px] text-danger hover:underline mt-0.5"
                  >
                    Remover e trocar
                  </button>
                </div>
              </div>
            ) : (
              <label className={`flex items-center justify-center gap-2 px-3 py-3 border border-dashed border-border rounded text-[11px] font-semibold transition-all ${
                uploadingFoto
                  ? 'opacity-50 cursor-wait'
                  : 'text-ink-muted hover:border-accent hover:text-accent cursor-pointer'
              }`}>
                {uploadingFoto ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Enviando...
                  </>
                ) : (
                  <>
                    <Plus className="h-3.5 w-3.5" />
                    Selecionar imagem (JPG/PNG até 8MB)
                  </>
                )}
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  disabled={uploadingFoto}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) handleUploadFoto(f)
                    e.target.value = ''  // permite reupload do mesmo arquivo
                  }}
                />
              </label>
            )}
            {erroUpload && (
              <div className="text-[10px] text-danger mt-1 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                {erroUpload}
              </div>
            )}
          </div>

          <label className={`flex items-start gap-2 text-[11px] cursor-pointer p-2 rounded border transition-all ${
            porContaCliente
              ? 'border-accent/50 bg-accent/10 text-ink'
              : 'border-transparent text-ink-muted hover:bg-surface-2'
          }`}>
            <input
              type="checkbox"
              checked={porContaCliente}
              onChange={e => setPorContaCliente(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              <strong className="text-ink">Por conta do cliente</strong> · Item fornecido/comprado pelo
              próprio cliente (ex: caixa, estrutura). A Branorte não cobra — sai como
              <em> "por conta do cliente"</em> na proposta, sem entrar no total.
            </span>
          </label>

          {!porContaCliente && (
            <label className="flex items-start gap-2 text-[11px] text-ink-muted cursor-pointer p-2 rounded hover:bg-surface-2 transition-all">
              <input
                type="checkbox"
                checked={enviarParaAprovacao}
                onChange={e => setEnviarParaAprovacao(e.target.checked)}
                className="mt-0.5"
              />
              <span>
                <strong className="text-ink">Sugerir cadastro oficial</strong> · Envia esse item pro admin
                avaliar e (se aprovado) adicionar ao catálogo permanente.
              </span>
            </label>
          )}
        </div>

        <div className="px-4 py-3 border-t border-border flex items-center justify-between gap-2">
          <button onClick={onClose} className="px-3 py-2 text-[12px] text-ink-muted hover:bg-surface-2 rounded">
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!valido || salvando}
            className="px-4 py-2 text-[12px] bg-accent hover:bg-accent-700 text-white font-semibold rounded disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5"
          >
            {salvando ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Adicionando...
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" />
                Adicionar ao carrinho
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal: picker de Transportador (lista direto de precos_branorte)
// Vendedor escolhe TIPO (Chupim/Calha) + DIÂMETRO + MEDIDA → item entra
// no carrinho com preço oficial e specs geradas dinamicamente.
// ──────────────────────────────────────────────────────────────────────────

// Modal de confirmação por chupim. Vendedor escolhe material/inclinação/função
// ANTES de adicionar. Mostra o motor recomendado em tempo real.
// Função é OBRIGATÓRIA — vai pro nome do item entre parênteses (ex: "Chupim 160
// x 3,5 m (Alimentação do silo)") e determina os polos do motor (trifásico: 4 ou 6).
function ConfirmarChupimModal({
  chupim, materialDefault, inclinacaoDefault, voltagem, onCancel, onConfirm,
}: {
  chupim: PrecoBranorte | null
  materialDefault: MaterialChupim
  inclinacaoDefault: InclinacaoChupim
  voltagem: Voltagem
  onCancel: () => void
  onConfirm: (p: PrecoBranorte, material: MaterialChupim, inclinacao: InclinacaoChupim, funcao: TransportadorFuncao, polos: 4 | 6) => void
}) {
  const [material, setMaterial] = useState<MaterialChupim>(materialDefault)
  const [inclinacao, setInclinacao] = useState<InclinacaoChupim>(inclinacaoDefault)
  const [funcaoId, setFuncaoId] = useState<number | null>(null)
  const { data: funcoes } = useTransportadorFuncoes()
  const criarFuncao = useCriarTransportadorFuncao()
  // UI inline pra cadastrar nova função sem sair do modal
  const [novaFuncaoOpen, setNovaFuncaoOpen] = useState(false)
  const [novaFuncaoNome, setNovaFuncaoNome] = useState('')
  const [novaFuncaoCurto, setNovaFuncaoCurto] = useState('')
  const [novaFuncaoPolos, setNovaFuncaoPolos] = useState<4 | 6>(4)

  // Reset pros defaults toda vez que abrir com chupim novo
  useEffect(() => {
    if (chupim) {
      setMaterial(materialDefault)
      setInclinacao(inclinacaoDefault)
      setFuncaoId(null)
      setNovaFuncaoOpen(false)
      setNovaFuncaoNome('')
      setNovaFuncaoCurto('')
      setNovaFuncaoPolos(4)
    }
  }, [chupim, materialDefault, inclinacaoDefault])

  if (!chupim) return null

  const funcaoSelecionada = (funcoes ?? []).find(f => f.id === funcaoId) ?? null
  const rec = recomendarMotorChupim(chupim.descricao, chupim.capacidade, material, inclinacao)
  const motorCvDefault = chupim.motor_cv ? Number(chupim.motor_cv) : null
  // Polos: vem da função selecionada (trifásico). Monofásico sempre 4.
  const polos: 4 | 6 = voltagem === 'trifasico' ? (funcaoSelecionada?.polos ?? 4) : 4
  // Função é obrigatória pra adicionar
  const podeAdicionar = !!funcaoSelecionada

  async function handleCriarFuncao() {
    const nome = novaFuncaoNome.trim()
    if (!nome) return
    try {
      const nova = await criarFuncao.mutateAsync({
        nome,
        nome_curto: novaFuncaoCurto.trim() || null,
        polos: novaFuncaoPolos,
      })
      setFuncaoId(nova.id)
      setNovaFuncaoOpen(false)
      setNovaFuncaoNome('')
      setNovaFuncaoCurto('')
      setNovaFuncaoPolos(4)
    } catch (e: any) {
      alert('Erro ao cadastrar função: ' + (e?.message || e))
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
      onClick={onCancel}
    >
      <div
        className="bg-bg border border-border rounded-xl max-w-md w-full shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold">
              Cálculo de motor por item
            </div>
            <div className="text-[15px] font-bold text-ink leading-tight">
              {chupim.descricao}
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              Capacidade: {chupim.capacidade || '—'} · Pot. planilha: {chupim.potencia || '—'}
            </div>
          </div>
          <button onClick={onCancel} className="text-ink-faint hover:text-ink p-1 -m-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <div className="px-4 py-4 space-y-3">
          <div>
            <label className="block text-[11px] uppercase font-bold text-ink-muted mb-1">
              Material transportado
            </label>
            <select
              value={material}
              onChange={e => setMaterial(e.target.value as MaterialChupim)}
              className="w-full text-[13px] px-3 py-2 bg-surface-2 border border-border rounded text-ink"
            >
              {(Object.keys(FATOR_MATERIAL) as MaterialChupim[]).map(k => (
                <option key={k} value={k}>{k} (K = {FATOR_MATERIAL[k]})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-[11px] uppercase font-bold text-ink-muted mb-1">
              Inclinação de instalação
            </label>
            <select
              value={inclinacao}
              onChange={e => setInclinacao(Number(e.target.value) as InclinacaoChupim)}
              className="w-full text-[13px] px-3 py-2 bg-surface-2 border border-border rounded text-ink"
            >
              {(Object.keys(FATOR_INCLINACAO).map(Number) as InclinacaoChupim[]).map(g => (
                <option key={g} value={g}>{g}° (b = {FATOR_INCLINACAO[g]})</option>
              ))}
            </select>
            <p className="text-[10px] text-ink-faint mt-1">
              Quanto maior o ângulo, maior a potência necessária.
            </p>
          </div>

          {/* Função do transportador — OBRIGATÓRIA. Vai pro nome do item entre
              parênteses e (se trifásico) determina os polos do motor (4 ou 6). */}
          <div>
            <label className="block text-[11px] uppercase font-bold text-ink-muted mb-1">
              Função do transportador <span className="text-danger">*</span>
            </label>
            <div className="flex items-stretch gap-1">
              <select
                value={funcaoId ?? ''}
                onChange={e => setFuncaoId(e.target.value ? Number(e.target.value) : null)}
                className={`flex-1 text-[13px] px-3 py-2 bg-surface-2 border rounded text-ink ${funcaoId === null ? 'border-warning/60' : 'border-border'}`}
              >
                <option value="">— escolha a função…</option>
                {(funcoes ?? []).map(f => (
                  <option key={f.id} value={f.id}>
                    {f.nome_curto || f.nome}{voltagem === 'trifasico' ? ` (${f.polos} polos)` : ''}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setNovaFuncaoOpen(v => !v)}
                className="text-[12px] px-2 py-1 rounded bg-accent/10 text-accent border border-accent/30 hover:bg-accent/20 font-bold whitespace-nowrap"
                title="Cadastrar nova função"
              >+ Nova</button>
            </div>
            <p className="text-[10px] text-ink-faint mt-1">
              Aparece no nome do item entre parênteses. {voltagem === 'trifasico' && 'Define os polos do motor (4 ou 6).'}
            </p>

            {/* Form inline pra cadastrar nova função */}
            {novaFuncaoOpen && (
              <div className="mt-2 p-3 bg-surface-2 border border-accent/40 rounded space-y-2">
                <div className="text-[10px] uppercase font-bold text-accent">Cadastrar nova função</div>
                <div>
                  <label className="block text-[10px] text-ink-muted mb-0.5">Nome completo</label>
                  <input
                    autoFocus
                    value={novaFuncaoNome}
                    onChange={e => setNovaFuncaoNome(e.target.value)}
                    placeholder="ex: Coleta de pó (vertical)"
                    className="w-full text-[12px] px-2 py-1 bg-bg border border-border rounded text-ink"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-ink-muted mb-0.5">
                    Nome curto <span className="text-ink-faint">(usado no nome do item — opcional)</span>
                  </label>
                  <input
                    value={novaFuncaoCurto}
                    onChange={e => setNovaFuncaoCurto(e.target.value)}
                    placeholder="ex: Coleta de pó"
                    className="w-full text-[12px] px-2 py-1 bg-bg border border-border rounded text-ink"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-ink-muted mb-0.5">
                    Polos do motor (apenas trifásico)
                  </label>
                  <div className="flex gap-1">
                    {([4, 6] as const).map(p => (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setNovaFuncaoPolos(p)}
                        className={`flex-1 text-[12px] py-1.5 rounded border font-bold transition-colors ${
                          novaFuncaoPolos === p
                            ? 'bg-accent/20 text-accent border-accent/60'
                            : 'bg-bg text-ink-muted border-border hover:text-ink'
                        }`}
                      >{p} polos</button>
                    ))}
                  </div>
                </div>
                <div className="flex items-center justify-end gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => setNovaFuncaoOpen(false)}
                    className="text-[11px] px-2 py-1 rounded text-ink-muted hover:bg-surface-3"
                  >Cancelar</button>
                  <button
                    type="button"
                    onClick={handleCriarFuncao}
                    disabled={!novaFuncaoNome.trim() || criarFuncao.isPending}
                    className="text-[11px] px-3 py-1 rounded bg-accent text-white font-bold hover:bg-accent/90 disabled:opacity-40"
                  >{criarFuncao.isPending ? 'Salvando…' : 'Cadastrar'}</button>
                </div>
              </div>
            )}
          </div>

          {/* Resultado do cálculo */}
          <div className="bg-info/5 border border-info/30 rounded-lg p-3 mt-3">
            <div className="text-[10px] uppercase font-bold text-info mb-1">
              ⚡ Motor recomendado
            </div>
            {rec ? (
              <div>
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-[24px] font-bold text-info">{rec.cvMotor} CV</span>
                  <span className="text-[16px] font-semibold text-info">·</span>
                  <span className="text-[16px] font-semibold text-info">{polos} polos</span>
                  <span className="text-[11px] text-ink-faint">
                    (calculado: {rec.cvCalculado.toFixed(2)} CV → próximo maior)
                  </span>
                </div>
                <div className="text-[10px] text-ink-faint mt-1 font-mono">
                  POT = (0,4 + ({rec.Q}·{rec.L}·{FATOR_MATERIAL[material]})/200) × {FATOR_INCLINACAO[inclinacao]} × 1,36
                </div>
                {motorCvDefault && motorCvDefault !== rec.cvMotor && (
                  <div className="text-[10px] text-warning mt-1">
                    ⚠ Substitui motor padrão da planilha ({motorCvDefault} CV) — devido a {material} a {inclinacao}°.
                  </div>
                )}
                {voltagem === 'trifasico' && polos === 6 && funcaoSelecionada && (
                  <div className="text-[10px] text-warning mt-1">
                    ⚠ 6 polos (em vez de 4) por causa da função: {funcaoSelecionada.nome_curto || funcaoSelecionada.nome}.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-[11px] text-ink-faint italic">
                Sem capacidade ou comprimento detectáveis na descrição — vai usar motor padrão da planilha ({motorCvDefault ?? '—'} CV{voltagem === 'trifasico' ? `, ${polos} polos` : ''}).
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="px-4 py-3 border-t border-border flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="text-[12px] px-3 py-1.5 rounded font-semibold bg-surface-2 text-ink-muted hover:bg-surface-3"
          >
            Cancelar
          </button>
          <button
            onClick={() => funcaoSelecionada && onConfirm(chupim, material, inclinacao, funcaoSelecionada, polos)}
            disabled={!podeAdicionar}
            className="text-[12px] px-4 py-1.5 rounded font-bold bg-accent text-white hover:bg-accent/90 disabled:opacity-40 disabled:cursor-not-allowed"
            title={!podeAdicionar ? 'Escolha a função do transportador' : undefined}
          >
            Adicionar {rec ? `(${rec.cvMotor} CV · ${polos}p)` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function TransportadorPickerModal({
  open, transportadores, catalogoItems,
  material, inclinacao, onMaterial, onInclinacao,
  onClose, onPick,
}: {
  open: boolean
  transportadores: PrecoBranorte[]
  catalogoItems: CatalogoItem[]
  material: MaterialChupim
  inclinacao: InclinacaoChupim
  onMaterial: (m: MaterialChupim) => void
  onInclinacao: (i: InclinacaoChupim) => void
  onClose: () => void
  onPick: (p: PrecoBranorte) => void
}) {
  const [tipo, setTipo] = useState<'todos' | 'CHUPIM' | 'TH'>('todos')
  const [diametro, setDiametro] = useState<string | null>(null)
  const fotoPorPrecoId = useMemo(() => {
    const m = new Map<number, string>()
    for (const ci of catalogoItems) {
      if (ci.preco_branorte_id && ci.foto_url) m.set(ci.preco_branorte_id, ci.foto_url)
    }
    return m
  }, [catalogoItems])
  // Fallback de foto por (subcategoria, diâmetro). Usado quando o preço específico
  // não tem catálogo linkado — assume que todo chupim 160 (independente do comprimento)
  // tem a mesma aparência.
  const fotoFallback = useMemo(() => montarMapaFotosTransportador(catalogoItems), [catalogoItems])

  useEffect(() => {
    if (open) { setTipo('todos'); setDiametro(null) }
  }, [open])

  // Extrai diâmetro do nome (chupim 160 x 3,5 m → 160; TH 250 X 5 m → 250)
  function getDiam(p: PrecoBranorte): string | null {
    const m = p.descricao.match(/(\d{2,3})\s*[xX]/)
    return m ? m[1] : null
  }

  // Extrai comprimento em metros (chupim 210 x 14,0 m → 14.0; TH 200 X 3,5 m → 3.5)
  function getComprimento(p: PrecoBranorte): number {
    const m = p.descricao.match(/[xX]\s*(\d+[,.]?\d*)\s*m/i)
    return m ? parseFloat(m[1].replace(',', '.')) : 999
  }

  const filtrados = useMemo(() => {
    return transportadores
      .filter(p => tipo === 'todos' ? true : p.subcategoria === tipo)
      .filter(p => diametro ? getDiam(p) === diametro : true)
      .sort((a, b) => {
        // 1. Agrupar por subcategoria (CHUPIM primeiro, depois HELICOIDAL/TH)
        const subA = (a.subcategoria || '').toUpperCase()
        const subB = (b.subcategoria || '').toUpperCase()
        if (subA !== subB) return subA < subB ? -1 : 1

        // 2. Dentro do mesmo tipo, ordenar por diâmetro crescente
        const diamA = parseInt(getDiam(a) || '0')
        const diamB = parseInt(getDiam(b) || '0')
        if (diamA !== diamB) return diamA - diamB

        // 3. Mesmo diâmetro, ordenar por comprimento crescente
        return getComprimento(a) - getComprimento(b)
      })
  }, [transportadores, tipo, diametro])

  const diametrosDisponiveis = useMemo(() => {
    const set = new Set<string>()
    for (const p of transportadores) {
      if (tipo !== 'todos' && p.subcategoria !== tipo) continue
      const d = getDiam(p)
      if (d) set.add(d)
    }
    return [...set].sort((a, b) => Number(a) - Number(b))
  }, [transportadores, tipo])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-bg border border-border rounded-xl max-w-4xl w-full shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 border-b border-border flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold">
              Tabela de Preços oficial
            </div>
            <div className="text-[15px] font-bold text-ink leading-tight">
              Selecionar Transportador Helicoidal
            </div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              {transportadores.length} medidas disponíveis · escolha tipo, diâmetro e clique no tamanho desejado
            </div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1 -m-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Filtros */}
        <div className="px-4 py-2 border-b border-border bg-surface-2/30 flex flex-wrap gap-2 items-center">
          <span className="text-[10px] uppercase font-bold text-ink-muted">Tipo:</span>
          {[
            { v: 'todos', l: 'Todos' },
            { v: 'CHUPIM', l: 'Chupim' },
            { v: 'TH', l: 'Calha (TH)' },
          ].map(o => (
            <button
              key={o.v}
              onClick={() => { setTipo(o.v as any); setDiametro(null) }}
              className={`text-[11px] px-2 py-1 rounded font-semibold transition-all ${
                tipo === o.v ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >
              {o.l}
            </button>
          ))}
          <div className="w-px h-5 bg-border mx-1" />
          <span className="text-[10px] uppercase font-bold text-ink-muted">Diâmetro:</span>
          <button
            onClick={() => setDiametro(null)}
            className={`text-[11px] px-2 py-1 rounded font-semibold transition-all ${
              !diametro ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
            }`}
          >
            Todos
          </button>
          {diametrosDisponiveis.map(d => (
            <button
              key={d}
              onClick={() => setDiametro(d)}
              className={`text-[11px] px-2 py-1 rounded font-semibold transition-all ${
                diametro === d ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >
              ⌀ {d}mm
            </button>
          ))}
        </div>

        {/* Configuração da fórmula de potência (Chupim) */}
        {(tipo === 'todos' || tipo === 'CHUPIM') && (
          <div className="px-4 py-2 border-b border-border bg-info/5 flex flex-wrap gap-3 items-center text-[11px]">
            <span className="text-[10px] uppercase font-bold text-info">⚡ Cálculo de motor:</span>
            <div className="flex items-center gap-1">
              <span className="text-ink-muted">Material:</span>
              <select
                value={material}
                onChange={e => onMaterial(e.target.value as MaterialChupim)}
                className="text-[11px] px-2 py-0.5 bg-surface-2 border border-border rounded text-ink"
              >
                {(Object.keys(FATOR_MATERIAL) as MaterialChupim[]).map(k => (
                  <option key={k} value={k}>{k} (K={FATOR_MATERIAL[k]})</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-ink-muted">Inclinação:</span>
              <select
                value={inclinacao}
                onChange={e => onInclinacao(Number(e.target.value) as InclinacaoChupim)}
                className="text-[11px] px-2 py-0.5 bg-surface-2 border border-border rounded text-ink"
              >
                {(Object.keys(FATOR_INCLINACAO).map(Number) as InclinacaoChupim[]).map(g => (
                  <option key={g} value={g}>{g}° (b={FATOR_INCLINACAO[g]})</option>
                ))}
              </select>
            </div>
            <span className="text-[10px] text-ink-faint ml-auto">
              POT = (0,4 + (Q·L·K)/200) × b × 1,36 → próximo motor maior
            </span>
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {filtrados.length === 0 ? (
            <div className="text-center py-12 text-ink-faint">
              <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
              <p className="text-[12px]">Nenhum transportador com esses filtros.</p>
            </div>
          ) : (
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2/50 text-ink-muted sticky top-0">
                <tr>
                  <th className="px-3 py-2 text-[10px] uppercase font-semibold tracking-wider w-14">Foto</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Medida</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Tipo</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Produção</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Pot. Planilha</th>
                  <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider bg-info/15" title="Calculado pela fórmula com material e inclinação selecionados">
                    Motor Recomendado
                  </th>
                  <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Equipamento</th>
                  <th className="px-1 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {filtrados.map(p => {
                  // 1) Foto exata via linkagem catalogo_items.preco_branorte_id
                  // 2) Fallback: foto de qualquer catalogo do mesmo tipo+diâmetro
                  let foto = fotoPorPrecoId.get(p.id)
                  if (!foto && p.subcategoria) {
                    const { diametro: d } = detectarTransportador(p.descricao)
                    if (d) foto = fotoFallback.get(`${p.subcategoria}:${d}`)
                  }
                  return (
                  <tr
                    key={p.id}
                    onClick={() => onPick(p)}
                    className="border-t border-border/40 hover:bg-accent/10 cursor-pointer group"
                  >
                    <td className="px-2 py-1">
                      {foto ? (
                        <img src={foto} alt={p.descricao} className="w-10 h-10 object-cover rounded border border-border" loading="lazy" />
                      ) : (
                        <div className="w-10 h-10 rounded border border-border bg-surface-2 flex items-center justify-center text-ink-faint">
                          <Package className="h-4 w-4" />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-ink font-semibold">{p.descricao}</td>
                    <td className="px-3 py-1.5 text-[10px]">
                      {p.subcategoria === 'CHUPIM'
                        ? <span className="px-1.5 py-0.5 rounded bg-info/15 text-info font-bold">Chupim</span>
                        : <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning font-bold">Calha TH</span>}
                    </td>
                    <td className="px-3 py-1.5 text-ink-muted text-[11px]">{p.capacidade || '—'}</td>
                    <td className="px-3 py-1.5 text-ink-muted text-[11px]">{p.potencia || '—'}</td>
                    <td className="px-3 py-1.5 text-[11px] bg-info/5">
                      {(() => {
                        // Fórmula vale pros dois tipos de helicoidal (CHUPIM e TH/Calha TH)
                        if (p.subcategoria !== 'CHUPIM' && p.subcategoria !== 'TH') return <span className="text-ink-faint italic">—</span>
                        const rec = recomendarMotorChupim(p.descricao, p.capacidade, material, inclinacao)
                        if (!rec) return <span className="text-ink-faint italic">—</span>
                        return (
                          <span>
                            <span className="font-bold text-info">{rec.cvMotor} CV</span>
                            <span className="text-[9px] text-ink-faint ml-1">
                              (calc {rec.cvCalculado.toFixed(2)})
                            </span>
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold text-ink">
                      {p.valor_equipamento
                        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(p.valor_equipamento))
                        : '—'}
                    </td>
                    <td className="px-1 py-1.5">
                      <Plus className="h-3.5 w-3.5 text-accent opacity-0 group-hover:opacity-100 transition-opacity" />
                    </td>
                  </tr>
                )})}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-2.5 border-t border-border bg-surface-2/30 flex items-center justify-between text-[10px] text-ink-faint">
          <span>{filtrados.length} {filtrados.length === 1 ? 'medida' : 'medidas'} listadas</span>
          <span>Foto vem do catálogo curado (vendedor)</span>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// MetaCard genérico do catálogo (1 entrada → abre picker da categoria)
// ──────────────────────────────────────────────────────────────────────────

function MetaCard({
  categoria, titulo, descricao, qtd, onClick,
}: {
  categoria: string
  titulo: string
  descricao: string
  qtd: number
  onClick: () => void
}) {
  const thumbPath = `metacard/${categoria.replace(/\s+/g, '_')}.jpg`
  const thumbUrl = `https://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/public/catalogo-fotos/${thumbPath}`
  const [thumb, setThumb] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)

  // Tenta carregar a thumb do Storage (cache local pra não ficar batendo)
  useEffect(() => {
    const cached = localStorage.getItem(`metacard-url-${categoria}`)
    if (cached) { setThumb(cached); return }
    // Checa se existe no Storage
    const img = new Image()
    img.onload = () => { setThumb(thumbUrl); localStorage.setItem(`metacard-url-${categoria}`, thumbUrl) }
    img.onerror = () => { /* sem thumb */ }
    img.src = thumbUrl + '?t=' + Date.now()
  }, [categoria, thumbUrl])

  function handleContextMenu(e: React.MouseEvent) {
    e.preventDefault()
    const inp = document.createElement('input')
    inp.type = 'file'
    inp.accept = 'image/*'
    inp.onchange = async () => {
      const f = inp.files?.[0]
      if (!f) return
      setUploading(true)
      // Resize to 112x112 (2x pra retina)
      const dataUrl = await new Promise<string>(resolve => {
        const reader = new FileReader()
        reader.onload = () => {
          const img = new Image()
          img.onload = () => {
            const canvas = document.createElement('canvas')
            canvas.width = 112; canvas.height = 112
            const ctx = canvas.getContext('2d')!
            const scale = Math.max(112 / img.width, 112 / img.height)
            const w = img.width * scale, h = img.height * scale
            ctx.drawImage(img, (112 - w) / 2, (112 - h) / 2, w, h)
            resolve(canvas.toDataURL('image/jpeg', 0.85))
          }
          img.src = reader.result as string
        }
        reader.readAsDataURL(f)
      })
      // Converte dataUrl pra blob e faz upload pro Storage
      const res = await fetch(dataUrl)
      const blob = await res.blob()
      const { error } = await supabase.storage.from('catalogo-fotos').upload(thumbPath, blob, { upsert: true, contentType: 'image/jpeg' })
      setUploading(false)
      if (!error) {
        const url = thumbUrl + '?t=' + Date.now()
        setThumb(url)
        localStorage.setItem(`metacard-url-${categoria}`, url)
      }
    }
    inp.click()
  }

  return (
    <button
      onClick={onClick}
      onContextMenu={handleContextMenu}
      className="text-left p-2 rounded-lg border-2 border-dashed border-accent/40 hover:border-accent hover:bg-accent/5 transition-all group flex items-center gap-2.5 relative"
      title="Clique pra abrir · Botão direito pra trocar foto"
    >
      <div className="w-14 h-14 rounded-md border border-accent/30 bg-accent/10 shrink-0 flex items-center justify-center overflow-hidden relative">
        {uploading ? (
          <Loader2 className="h-5 w-5 text-accent animate-spin" />
        ) : thumb ? (
          <img src={thumb} alt={titulo} className="w-full h-full object-cover" />
        ) : (
          <Sparkles className="h-6 w-6 text-accent" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-[9px] uppercase tracking-wider text-accent font-bold">{categoria}</span>
          <span className="text-[8px] uppercase font-bold px-1 py-[1px] rounded bg-success/15 text-success border border-success/30">
            $ Oficial · {qtd} {qtd === 1 ? 'item' : 'itens'}
          </span>
        </div>
        <div className="text-[13px] font-semibold text-ink">{titulo}</div>
        <div className="text-[10px] text-ink-faint mt-0.5">{descricao}</div>
      </div>
      <Plus className="h-4 w-4 text-accent shrink-0" />
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// CategoriaPickerModal: picker genérico (Misturador, Moinho, Caixa, etc.)
// Puxa do catálogo curado (catalog_items). Foto e preço vêm direto do catálogo.
// Colunas detalhadas (silo dims, compacta, etc.) fazem lookup no precos_branorte.
// ──────────────────────────────────────────────────────────────────────────

interface PickerProps {
  open: boolean
  titulo: string
  items: CatalogoItem[]
  precosBranorte?: PrecoBranorte[]   // para lookup de colunas detalhadas (silo, compacta, etc.)
  labelSub: Record<string, string>
  ordemSub: string[]
  colKgPratica?: boolean
  colMilhoKg?: boolean
  colDimensoes?: boolean
  colSiloDims?: boolean   // colunas geométricas pra silo (volume, ⌀, altura, anéis, funil)
  colCompacta?: boolean   // colunas pra Compacta (produção, armaz., trif+bal., mono+bal.)
  onClose: () => void
  onPick: (p: CatalogoItem) => void
}

function CategoriaPickerModal(props: PickerProps) {
  const {
    open, titulo, items, precosBranorte, labelSub, ordemSub,
    colKgPratica, colMilhoKg, colDimensoes, colSiloDims, colCompacta, onClose, onPick,
  } = props
  const [subSel, setSubSel] = useState<string | null>(null)

  useEffect(() => { if (open) setSubSel(null) }, [open])

  const filtrados = useMemo(() => {
    const arr = subSel ? items.filter(p => p.subcategoria === subSel) : items
    return arr.slice().sort((a, b) => {
      const ia = ordemSub.indexOf(a.subcategoria ?? '')
      const ib = ordemSub.indexOf(b.subcategoria ?? '')
      if (ia !== ib) return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib)
      return a.ordem - b.ordem
    })
  }, [items, subSel, ordemSub])

  // Lookup reverso: catalog_item → precos_branorte (pra colunas detalhadas)
  const pbMap = useMemo(() => {
    const m = new Map<number, PrecoBranorte>()
    for (const p of precosBranorte ?? []) m.set(p.id, p)
    return m
  }, [precosBranorte])

  if (!open) return null

  const subsDisponiveis = ordemSub.filter(s => items.some(p => p.subcategoria === s))

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-xl max-w-5xl w-full shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-border flex items-start gap-3">
          <Sparkles className="h-5 w-5 text-accent shrink-0 mt-0.5" />
          <div className="flex-1">
            <div className="text-[10px] uppercase tracking-wider text-accent font-bold">Tabela de Preços oficial</div>
            <div className="text-[15px] font-bold text-ink leading-tight">Selecionar {titulo}</div>
            <div className="text-[11px] text-ink-muted mt-0.5">
              {items.length} variantes · clique numa linha pra adicionar ao orçamento (foto vem do catálogo)
            </div>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink p-1 -m-1">
            <X className="h-4 w-4" />
          </button>
        </div>

        {subsDisponiveis.length > 1 && (
          <div className="px-4 py-2 border-b border-border bg-surface-2/30 flex flex-wrap gap-2 items-center">
            <span className="text-[10px] uppercase font-bold text-ink-muted">Tipo:</span>
            <button
              onClick={() => setSubSel(null)}
              className={`text-[11px] px-2 py-1 rounded font-semibold transition-all ${
                !subSel ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >Todos</button>
            {subsDisponiveis.map(s => (
              <button
                key={s}
                onClick={() => setSubSel(subSel === s ? null : s)}
                className={`text-[11px] px-2 py-1 rounded font-semibold transition-all ${
                  subSel === s ? 'bg-accent text-white' : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
              >{labelSub[s] ?? s}</button>
            ))}
          </div>
        )}

        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2/50 text-ink-muted sticky top-0">
              <tr>
                <th className="px-3 py-2 text-[10px] uppercase font-semibold tracking-wider w-14">Foto</th>
                <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Modelo</th>
                {subsDisponiveis.length > 1 && (
                  <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Tipo</th>
                )}
                <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Capacidade</th>
                {colKgPratica && (
                  <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Kg prática</th>
                )}
                {colMilhoKg && (
                  <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Milho 0,65</th>
                )}
                {colDimensoes && (
                  <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Dim. (mm)</th>
                )}
                {colSiloDims && (
                  <>
                    <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Volume</th>
                    <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">⌀ Diâm.</th>
                    <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Altura</th>
                    <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Funil</th>
                  </>
                )}
                {colCompacta && (
                  <>
                    <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Produção</th>
                    <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Armaz.</th>
                  </>
                )}
                <th className="text-left px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Potência</th>
                <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">Equipamento</th>
                {colCompacta && (
                  <>
                    <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">+ Trif</th>
                    <th className="text-right px-3 py-2 font-semibold uppercase text-[10px] tracking-wider">+ Mono</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtrados.map(p => {
                // Lookup reverso pra colunas detalhadas (silo, compacta, caixa, etc.)
                const pb = p.preco_branorte_id ? pbMap.get(p.preco_branorte_id) : null
                const capacidadeLabel = p.capacidade_litros
                  ? `${p.capacidade_litros.toLocaleString('pt-BR')} L`
                  : p.capacidade_kg
                    ? `${p.capacidade_kg.toLocaleString('pt-BR')} kg`
                    : pb?.capacidade || '—'
                return (
                  <tr
                    key={p.id}
                    onClick={() => onPick(p)}
                    className="border-t border-border/40 hover:bg-accent/10 cursor-pointer"
                  >
                    <td className="px-2 py-1">
                      {p.foto_url ? (
                        <img src={p.foto_url} alt={p.nome_curto} className="w-10 h-10 object-cover rounded border border-border" loading="lazy" />
                      ) : (
                        <div className="w-10 h-10 rounded border border-border bg-surface-2 flex items-center justify-center text-ink-faint">
                          <Package className="h-4 w-4" />
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-1.5 text-ink">
                      <span className="font-semibold">{p.nome_curto}</span>
                    </td>
                    {subsDisponiveis.length > 1 && (
                      <td className="px-3 py-1.5 text-[10px] text-ink-muted">
                        {labelSub[p.subcategoria ?? ''] ?? p.subcategoria}
                      </td>
                    )}
                    <td className="px-3 py-1.5 text-ink-muted text-[11px]">{capacidadeLabel}</td>
                    {colKgPratica && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-warning font-semibold">
                        {(p.capacidade_kg ?? pb?.capacidade_kg_pratica)
                          ? Number(p.capacidade_kg ?? pb?.capacidade_kg_pratica).toLocaleString('pt-BR') + ' kg'
                          : '—'}
                      </td>
                    )}
                    {colMilhoKg && (
                      <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-warning font-semibold">
                        {pb?.capacidade_kg_milho ? Number(pb.capacidade_kg_milho).toLocaleString('pt-BR') + ' kg' : '—'}
                      </td>
                    )}
                    {colDimensoes && (
                      <td className="px-3 py-1.5 text-ink-faint text-[10px] font-mono">{pb?.dimensoes || '—'}</td>
                    )}
                    {colSiloDims && (
                      <>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-ink">
                          {pb?.volume_m3 ? `${Number(pb.volume_m3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-ink-muted">
                          {pb?.diametro_m ? `${Number(pb.diametro_m).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-ink-muted">
                          {pb?.altura_m ? `${Number(pb.altura_m).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-[11px]">
                          {pb?.funil_tipo === 'PLANO'
                            ? <span className="px-1.5 py-0.5 rounded bg-info/20 text-info font-bold text-[10px]">PLANO</span>
                            : pb?.funil_tipo
                              ? <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border font-bold text-[10px]">{pb.funil_tipo}°</span>
                              : '—'}
                        </td>
                      </>
                    )}
                    {colCompacta && (
                      <>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-ink font-semibold">
                          {pb?.producao_kgh ? `${pb.producao_kgh} kg/h` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-ink">
                          {pb?.armazenamento_kg ? `${Number(pb.armazenamento_kg).toLocaleString('pt-BR')} kg` : '—'}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-1.5 text-ink-muted text-[11px]">
                      {p.motor_padrao_cv ? `${String(p.motor_padrao_cv).replace('.', ',')} CV` : pb?.potencia || '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums font-bold text-ink">
                      {p.valor
                        ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(p.valor))
                        : '—'}
                    </td>
                    {colCompacta && (
                      <>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-info">
                          {pb?.valor_com_motor_trif ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(pb.valor_com_motor_trif)) : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-[11px] text-warning">
                          {pb?.valor_com_motor_mono ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(pb.valor_com_motor_mono)) : '—'}
                        </td>
                      </>
                    )}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="px-4 py-2.5 border-t border-border bg-surface-2/30 flex items-center justify-between text-[10px] text-ink-faint">
          <span>{filtrados.length} {filtrados.length === 1 ? 'variante' : 'variantes'}</span>
          <span>Foto vem do catálogo curado (vendedor)</span>
        </div>
      </div>
    </div>
  )
}
