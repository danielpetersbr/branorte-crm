import type { SupabaseClient } from '@supabase/supabase-js'
import type { ComposicaoResolvida, IntencaoOrcamento, ModeloCandidato, VoltagemOrcamento } from '../../src/lib/orcamento-ai/types'
import { matchCatalogItem, priceForVoltage, type CatalogItemCandidate } from '../../src/lib/orcamento-ai/item-matcher'

type JsonRecord = Record<string, unknown>

function number(value: unknown): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
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

export async function findModelCandidates(supabase: SupabaseClient, intent: IntencaoOrcamento): Promise<ModeloCandidato[]> {
  const requested = intent.modeloPedido
  if (!requested) return []
  let query = supabase
    .from('orcamento_modelos')
    .select('id, basename, pacote, voltagem, is_master, producao_kgh, armazenamento_kg, itens, acessorios, motores, foto_url')
    .eq('ativo', true)
    .limit(30)
  if (requested.voltagem) query = query.eq('voltagem', requested.voltagem)
  if (requested.master !== undefined) query = query.eq('is_master', requested.master)
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
    const value = number(balance?.valor_equipamento) || 8728
    models.forEach((model) => {
      if (model.itens.some((item) => /CA[ÇC]AMBA.*PESAGEM/i.test(item.nome))) model.componentes = [{ nome: 'Balança Eletrônica', valor: value }]
    })
  }
  return models
}

export function normalizeVoltage(value: unknown): VoltagemOrcamento | undefined {
  return value === 'monofasico' || value === 'trifasico' ? value : undefined
}

export async function resolveCatalogComposition(supabase: SupabaseClient, intent: IntencaoOrcamento): Promise<ComposicaoResolvida> {
  if (!intent.itensPedidos.length) return { itens: [], motores: [], perguntas: [{ code: 'ITEMS_REQUIRED', question: 'Informe ao menos um equipamento ou um modelo pronto.' }] }
  const { data, error } = await supabase
    .from('precos_branorte')
    .select('id, categoria, descricao, valor_equipamento, valor_com_motor_mono, valor_com_motor_trif, motor_cv, motor_polos, capacidade_kg_pratica, capacidade_ton')
    .eq('ativo', true)
    .limit(2000)
  if (error) throw new Error('catalog_lookup_failed')
  const rows = (data ?? []) as JsonRecord[]
  const candidates: CatalogItemCandidate[] = rows.map((row) => ({
    id: number(row.id), categoria: String(row.categoria ?? ''), descricao: String(row.descricao ?? ''),
    valorEquipamento: row.valor_equipamento == null ? null : number(row.valor_equipamento),
    valorComMotorMono: row.valor_com_motor_mono == null ? null : number(row.valor_com_motor_mono),
    valorComMotorTrif: row.valor_com_motor_trif == null ? null : number(row.valor_com_motor_trif),
    motorCv: row.motor_cv == null ? null : number(row.motor_cv), motorPolos: row.motor_polos == null ? null : number(row.motor_polos),
    capacidadeKg: row.capacidade_kg_pratica == null ? null : number(row.capacidade_kg_pratica),
    capacidadeTon: row.capacidade_ton == null ? null : number(row.capacidade_ton),
  }))
  const itens: ComposicaoResolvida['itens'] = []
  const motores: ComposicaoResolvida['motores'] = []
  const perguntas: ComposicaoResolvida['perguntas'] = []
  const voltage = intent.modeloPedido?.voltagem

  for (const request of intent.itensPedidos) {
    const match = matchCatalogItem(request, candidates)
    if (match.status !== 'exato') {
      perguntas.push({
        code: match.status === 'nao_encontrado' ? 'ITEM_NOT_FOUND' : 'ITEM_CHOICE',
        question: match.status === 'nao_encontrado' ? `Não encontrei correspondência exata para “${request.textoOriginal}”.` : `Escolha a opção correta para “${request.textoOriginal}”.`,
        options: match.alternatives.map((candidate) => ({ id: String(candidate.id), label: candidate.descricao })),
      })
      continue
    }
    const candidate = match.match
    const soldWithMotor = (Number(candidate.valorEquipamento) || 0) <= 0
    const itemPrice = priceForVoltage(candidate, voltage)
    if (itemPrice <= 0) {
      perguntas.push({ code: 'ITEM_WITHOUT_PRICE', question: `O item “${candidate.descricao}” está sem preço válido para a voltagem informada.` })
      continue
    }
    itens.push({ catalogoId: candidate.id, nome: candidate.descricao.toUpperCase(), quantidade: request.quantidade, valorUnitario: itemPrice, categoria: candidate.categoria })
    if (candidate.motorCv && candidate.motorPolos) {
      if (soldWithMotor) {
        motores.push({ descricao: `Motor ${candidate.motorCv} CV ${candidate.motorPolos} polos`, cv: candidate.motorCv, polos: candidate.motorPolos, valor: 0, incluso: true })
      } else if (!voltage) {
        perguntas.push({ code: 'VOLTAGE_REQUIRED', question: `Informe se o motor de ${candidate.motorCv} CV será monofásico ou trifásico.` })
      } else {
        const { data: motor } = await supabase
          .from('catalogo_motores')
          .select('id, cv, polos, valor')
          .eq('ativo', true).eq('cv', candidate.motorCv).eq('polos', candidate.motorPolos)
          .eq('voltagem', voltage.toUpperCase()).maybeSingle()
        if (!motor || number(motor.valor) <= 0) perguntas.push({ code: 'MOTOR_WITHOUT_PRICE', question: `O motor de ${candidate.motorCv} CV e ${candidate.motorPolos} polos está sem preço para ${voltage}.` })
        else motores.push({ id: number(motor.id), itemCatalogoId: candidate.id, descricao: `Motor ${candidate.motorCv} CV ${candidate.motorPolos} polos`, cv: candidate.motorCv, polos: candidate.motorPolos, valor: number(motor.valor), incluso: false })
      }
    }
  }
  return { itens, motores, perguntas }
}
