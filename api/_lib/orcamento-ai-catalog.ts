import type { SupabaseClient } from '@supabase/supabase-js'
import {
  classeDeMotor,
  motorDoPreco,
  type MotorCatalogoBase,
  type PrecoComMotor,
} from '../../src/lib/motor-do-preco.js'
import type { ComposicaoResolvida, IntencaoOrcamento, ItemPedido, ModeloCandidato, VoltagemOrcamento } from '../../src/lib/orcamento-ai/types.js'
import { matchCatalogItem, type CatalogItemCandidate } from '../../src/lib/orcamento-ai/item-matcher.js'

type JsonRecord = Record<string, unknown>

interface CatalogMotorRow extends MotorCatalogoBase {
  id: number
}

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function nullableNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function normalizeMotorVoltage(value: unknown): VoltagemOrcamento | null {
  const folded = String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  if (folded.startsWith('mono')) return 'monofasico'
  if (folded.startsWith('tri')) return 'trifasico'
  return null
}

function mapCanonicalPrice(row: JsonRecord): PrecoComMotor {
  return {
    categoria: String(row.categoria ?? ''),
    subcategoria: row.subcategoria == null ? null : String(row.subcategoria),
    descricao: String(row.descricao ?? ''),
    capacidade: row.capacidade == null ? null : String(row.capacidade),
    motor_cv: nullableNumber(row.motor_cv),
    motor_polos: nullableNumber(row.motor_polos),
    valor_equipamento: nullableNumber(row.valor_equipamento),
    valor_com_motor_trif: nullableNumber(row.valor_com_motor_trif),
    valor_com_motor_mono: nullableNumber(row.valor_com_motor_mono),
  }
}

/**
 * Sem a voltagem, uma cotação não pode escolher silenciosamente preço ou motor.
 * Itens realmente sem motor (caixa, silo etc.) continuam cotáveis sem essa pergunta.
 */
export function catalogItemRequiresVoltage(price: PrecoComMotor): boolean {
  const hasVoltageSpecificPrice = Number(price.valor_com_motor_mono) > 0 || Number(price.valor_com_motor_trif) > 0
  const motorClass = classeDeMotor(price.categoria, price.subcategoria)
  return hasVoltageSpecificPrice || motorClass === 'AVULSO' || motorClass === 'MULTI_MOTOR'
}

function lineOf(row: JsonRecord): ModeloCandidato['linha'] {
  const text = `${row.pacote ?? ''} ${row.basename ?? ''}`.toUpperCase()
  if (/COMPACTA\s*0?1/.test(text)) return 'COMPACTA_01'
  if (/COMPACTA\s*0?2/.test(text)) return 'COMPACTA_02'
  if (/COMPACTA\s*0?3/.test(text)) return 'COMPACTA_03'
  if (/MINI/.test(text)) return 'MINI'
  return undefined
}

function mapModel(row: JsonRecord): ModeloCandidato {
  const rawItems = Array.isArray(row.itens) ? row.itens as JsonRecord[] : []
  const rawMotors = Array.isArray(row.motores) ? row.motores as JsonRecord[] : []
  const rawAccessories = row.acessorios && typeof row.acessorios === 'object' ? row.acessorios as JsonRecord : null
  return {
    id: number(row.id),
    basename: String(row.basename ?? ''),
    linha: lineOf(row),
    master: Boolean(row.is_master),
    voltagem: String(row.voltagem).toLowerCase() === 'monofasico' ? 'monofasico' : 'trifasico',
    producaoKgH: row.producao_kgh == null ? null : number(row.producao_kgh),
    armazenamentoKg: row.armazenamento_kg == null ? null : number(row.armazenamento_kg),
    itens: rawItems
      .filter((item) => !/^\s*motor\s+/i.test(String(item.nome ?? '')))
      .map((item) => ({
        catalogoId: typeof item.catalogo_id === 'number' ? item.catalogo_id : null,
        nome: String(item.nome ?? ''),
        quantidade: Math.max(1, number(item.qtd) || 1),
        valorUnitario: number(item.valor),
        categoria: typeof item.categoria === 'string' ? item.categoria : null,
        descricao: Array.isArray(item.specs) ? item.specs.map(String) : [],
        fotoUrl: typeof item.foto_url === 'string' ? item.foto_url : null,
      })),
    motores: rawMotors.map((motor) => ({
      descricao: `Motor ${number(motor.cv).toLocaleString('pt-BR')} CV ${number(motor.polos)} polos`,
      cv: number(motor.cv), polos: number(motor.polos), valor: number(motor.valor),
      incluso: Boolean(motor.incluso),
    })),
    acessorios: rawAccessories ? {
      mode: 'fixo',
      valor: number(rawAccessories.valor),
      items: Array.isArray(rawAccessories.items) ? rawAccessories.items.map(String) : [],
      source: 'modelo',
    } : null,
    componentes: [],
    fotoUrl: typeof row.foto_url === 'string' ? row.foto_url : null,
  }
}

export async function findModelCandidates(supabase: SupabaseClient, intent: IntencaoOrcamento, selectedModelId?: string): Promise<ModeloCandidato[]> {
  const requested = intent.modeloPedido
  if (!requested) return []
  let query = supabase
    .from('orcamento_modelos')
    .select('id, basename, pacote, voltagem, is_master, producao_kgh, armazenamento_kg, itens, acessorios, motores, foto_url')
    .eq('ativo', true)
    .order('id', { ascending: true })
  const selectedId = Number(selectedModelId)
  if (selectedModelId && Number.isFinite(selectedId)) query = query.eq('id', selectedId)
  else {
    if (requested.voltagem) query = query.eq('voltagem', requested.voltagem)
    if (requested.master !== undefined) query = query.eq('is_master', requested.master)
  }
  const { data, error } = await query
  if (error) throw new Error('catalog_lookup_failed')
  const models = (data ?? []).map((row) => mapModel(row as JsonRecord))
  if (models.some((model) => model.itens.some((item) => /CA[ÇC]AMBA.*PESAGEM/i.test(item.nome)))) {
    const { data: balances } = await supabase
      .from('precos_branorte')
      .select('descricao, valor_equipamento')
      .eq('ativo', true)
      .eq('categoria', 'BALANCA')
      .limit(30)
    const balance = (balances ?? []).find((item) => /balan.a.*el.tr.nica.*2000/i.test(String(item.descricao ?? '')))
    const value = number(balance?.valor_equipamento)
    if (value <= 0) throw new Error('balance_price_missing')
    models.forEach((model) => {
      if (model.itens.some((item) => /CA[ÇC]AMBA.*PESAGEM/i.test(item.nome))) model.componentes = [{ nome: 'Balança Eletrônica', valor: value }]
    })
  }
  return models
}

export function normalizeVoltage(value: unknown): VoltagemOrcamento | undefined {
  return value === 'monofasico' || value === 'trifasico' ? value : undefined
}

export function matchCatalogItemWithSelection(
  request: ItemPedido,
  candidates: CatalogItemCandidate[],
  selectedId?: string,
): ReturnType<typeof matchCatalogItem> {
  const match = matchCatalogItem(request, candidates)
  if (!selectedId || match.status !== 'requer_escolha') return match
  const selected = match.alternatives.find((candidate) => String(candidate.id) === selectedId)
  return selected ? { status: 'exato', match: selected, alternatives: [] } : match
}

export async function resolveCatalogComposition(
  supabase: SupabaseClient,
  intent: IntencaoOrcamento,
  selectedItemChoices: Record<string, string> = {},
): Promise<ComposicaoResolvida> {
  if (!intent.itensPedidos.length) return { itens: [], motores: [], perguntas: [{ code: 'ITEMS_REQUIRED', question: 'Informe ao menos um equipamento ou um modelo pronto.' }] }
  const { data, error } = await supabase
    .from('precos_branorte')
    .select('id, categoria, subcategoria, codigo, modelo, descricao, capacidade, dimensoes, valor_equipamento, valor_com_motor_mono, valor_com_motor_trif, motor_cv, motor_polos, capacidade_kg_pratica, capacidade_litros, capacidade_ton')
    .eq('ativo', true)
    .limit(2000)
  if (error) throw new Error('catalog_lookup_failed')
  const rows = (data ?? []) as JsonRecord[]
  const canonicalPrices = new Map<number, PrecoComMotor>(
    rows.map((row) => [number(row.id), mapCanonicalPrice(row)]),
  )
  const candidates: CatalogItemCandidate[] = rows.map((row) => ({
    id: number(row.id), categoria: String(row.categoria ?? ''), descricao: String(row.descricao ?? ''),
    subcategoria: row.subcategoria == null ? null : String(row.subcategoria),
    codigo: row.codigo == null ? null : String(row.codigo),
    modelo: row.modelo == null ? null : String(row.modelo),
    capacidade: row.capacidade == null ? null : String(row.capacidade),
    dimensoes: row.dimensoes == null ? null : String(row.dimensoes),
    valorEquipamento: row.valor_equipamento == null ? null : number(row.valor_equipamento),
    valorComMotorMono: row.valor_com_motor_mono == null ? null : number(row.valor_com_motor_mono),
    valorComMotorTrif: row.valor_com_motor_trif == null ? null : number(row.valor_com_motor_trif),
    motorCv: row.motor_cv == null ? null : number(row.motor_cv), motorPolos: row.motor_polos == null ? null : number(row.motor_polos),
    capacidadeKg: row.capacidade_kg_pratica == null ? null : number(row.capacidade_kg_pratica),
    capacidadeLitros: row.capacidade_litros == null ? null : number(row.capacidade_litros),
    capacidadeTon: row.capacidade_ton == null ? null : number(row.capacidade_ton),
  }))

  // Uma consulta por proposta, nunca uma consulta por item. Além de evitar N+1,
  // esta lista completa permite ao motorDoPreco aplicar o mesmo fallback oficial
  // de CV/polos — e o modo estrito para monofásico — usado no montador manual.
  const { data: motorRows, error: motorError } = await supabase
    .from('catalogo_motores')
    .select('id, cv, polos, voltagem, valor')
    .eq('ativo', true)
  if (motorError) throw new Error('motor_catalog_lookup_failed')
  const catalogMotors: CatalogMotorRow[] = ((motorRows ?? []) as JsonRecord[])
    .map<CatalogMotorRow | null>((row) => {
      const voltagem = normalizeMotorVoltage(row.voltagem)
      return voltagem ? {
        id: number(row.id),
        cv: number(row.cv),
        polos: number(row.polos),
        voltagem,
        valor: number(row.valor),
      } : null
    })
    .filter((row): row is CatalogMotorRow => row != null && row.cv > 0 && row.polos > 0 && row.valor > 0)
  const itens: ComposicaoResolvida['itens'] = []
  const motores: ComposicaoResolvida['motores'] = []
  const perguntas: ComposicaoResolvida['perguntas'] = []
  const voltage = intent.modeloPedido?.voltagem

  for (const [requestIndex, request] of intent.itensPedidos.entries()) {
    const questionCode = `ITEM_CHOICE:${requestIndex}`
    const match = matchCatalogItemWithSelection(request, candidates, selectedItemChoices[questionCode])
    if (match.status !== 'exato') {
      perguntas.push({
        code: match.status === 'nao_encontrado' ? `ITEM_NOT_FOUND:${requestIndex}` : questionCode,
        question: match.status === 'nao_encontrado' ? `Não encontrei correspondência exata para “${request.textoOriginal}”.` : `Escolha a opção correta para “${request.textoOriginal}”.`,
        options: match.alternatives.map((candidate) => ({ id: String(candidate.id), label: candidate.descricao })),
      })
      continue
    }
    const candidate = match.match
    const canonicalPrice = canonicalPrices.get(candidate.id)
    if (!canonicalPrice) {
      perguntas.push({ code: 'ITEM_WITHOUT_PRICE', question: `O item “${candidate.descricao}” não possui uma linha de preço válida.` })
      continue
    }

    if (!voltage && catalogItemRequiresVoltage(canonicalPrice)) {
      perguntas.push({
        code: 'VOLTAGE_REQUIRED',
        question: `Informe se “${candidate.descricao}” será monofásico ou trifásico para calcular o preço e o motor corretos.`,
      })
      continue
    }

    // Só usa o default trifásico nos itens cuja classe/preço independe de
    // voltagem. Para qualquer motor ou coluna mono/tri a pergunta acima bloqueia.
    const pricing = motorDoPreco(canonicalPrice, catalogMotors, voltage ?? 'trifasico')
    if (pricing.tipo === 'INDETERMINADO') {
      perguntas.push({
        code: 'MOTOR_CONFIGURATION_REQUIRED',
        question: `Não foi possível calcular “${candidate.descricao}” com segurança: ${pricing.motivo}.`,
      })
      continue
    }
    if (!Number.isFinite(pricing.valorEquipamento) || pricing.valorEquipamento <= 0) {
      perguntas.push({ code: 'ITEM_WITHOUT_PRICE', question: `O item “${candidate.descricao}” está sem preço válido para a voltagem informada.` })
      continue
    }
    if (pricing.tipo === 'AVULSO' && (!pricing.motor || pricing.total == null)) {
      perguntas.push({
        code: 'MOTOR_WITHOUT_PRICE',
        question: `O motor de ${pricing.cv} CV e ${pricing.polos} polos está sem preço para ${voltage}.`,
      })
      continue
    }

    itens.push({
      catalogoId: candidate.id,
      nome: candidate.descricao.toUpperCase(),
      quantidade: request.quantidade,
      valorUnitario: pricing.valorEquipamento,
      categoria: candidate.categoria,
    })

    if (pricing.tipo === 'AVULSO' && pricing.motor) {
      const motorRow = catalogMotors.find((motor) =>
        Number(motor.cv) === pricing.motor!.cv
        && Number(motor.polos) === pricing.motor!.polos
        && motor.voltagem === pricing.motor!.voltagem
        && Number(motor.valor) === pricing.motor!.valor,
      )
      const quantityPrefix = request.quantidade > 1 ? `${request.quantidade}x ` : ''
      motores.push({
        id: motorRow?.id ?? null,
        itemCatalogoId: candidate.id,
        descricao: `${quantityPrefix}Motor ${pricing.cv} CV ${pricing.polos} polos${pricing.estimado ? ' (dimensionado para chupim)' : ''}`,
        cv: pricing.cv,
        polos: pricing.polos,
        valor: pricing.motor.valor * request.quantidade,
        incluso: false,
      })
    } else if (pricing.tipo === 'INCLUSO' && canonicalPrice.motor_cv && canonicalPrice.motor_polos) {
      motores.push({
        itemCatalogoId: candidate.id,
        descricao: `Motor ${canonicalPrice.motor_cv} CV ${canonicalPrice.motor_polos} polos (incluso)`,
        cv: canonicalPrice.motor_cv,
        polos: canonicalPrice.motor_polos,
        valor: 0,
        incluso: true,
      })
    }
  }
  return { itens, motores, perguntas }
}
