import type { OrigemProjeto3D } from './projeto-3d-orcamento'

type LinhaProjeto3D = {
  uid: string; nome: string; nome_custom?: string | null; specs: string[]; qtd: number;
  valor: number; valor_original: number; catalogo_id: number; origem_projeto3d?: OrigemProjeto3D;
}

export function temPendenciasProjeto3D(items: readonly { origem_projeto3d?: OrigemProjeto3D }[]): boolean {
  return items.some(item => item.origem_projeto3d?.resolution === 'pendente')
}

/** A escolha comercial altera preço e acionamento; a linha do projeto mantém sua identidade. */
export function resolverVinculoProjeto3D<T extends LinhaProjeto3D, P extends { specs: string[]; valor: number; catalogo_id: number; motor_cv?: number | null; motor_qtd?: number; motor_valor_unit?: number }>(original: T, precificado: P, options: { motorIncluso?: boolean } = {}): T {
  if (!original.origem_projeto3d || !Number.isFinite(precificado.valor) || precificado.valor <= 0 || precificado.catalogo_id < 0) throw new Error('O equipamento não tem preço válido no catálogo. Confirme um valor manual para esta linha.')
  if (Number(precificado.motor_cv) > 0 && Number(precificado.motor_qtd) > 0 && !options.motorIncluso && (!Number.isFinite(precificado.motor_valor_unit) || Number(precificado.motor_valor_unit) <= 0)) throw new Error('O catálogo não tem preço válido para o motor nesta voltagem. Selecione Trifásico no orçamento ou confirme um valor manual completo.')
  return {
    ...original, ...precificado,
    uid: original.uid, nome: original.nome, nome_custom: original.nome_custom,
    qtd: original.qtd,
    specs: [...new Set([...original.origem_projeto3d.sourceSpecifications, ...precificado.specs])],
    origem_projeto3d: { ...original.origem_projeto3d, resolution: 'vinculado' },
  } as T
}

export function resolverManualProjeto3D<T extends LinhaProjeto3D>(original: T, valor: number): T {
  if (!original.origem_projeto3d || !Number.isFinite(valor) || valor < 0) throw new Error('Informe um valor unitário válido.')
  return {
    ...original, valor: Math.round(valor), valor_original: Math.round(valor),
    catalogo_id: -1, preco_branorte_id: null,
    specs: [...original.origem_projeto3d.sourceSpecifications],
    motor_cv: null, motor_polos: null, motor_qtd: 0, motor_valor_unit: 0,
    motores_extras_snapshot: undefined, usa_inversor: false,
    origem_projeto3d: { ...original.origem_projeto3d, resolution: 'manual' },
  }
}

export function mensagemPopupProjeto3DValida(event: { source: unknown; origin: string; data: unknown }, opener: unknown, exportId: string): boolean {
  if (!opener || event.source !== opener || event.origin !== 'https://branorte-configurador-3d.vercel.app') return false
  const data = event.data as { type?: unknown; payload?: { exportId?: unknown } } | null
  return data?.type === 'branorte:budget:transfer' && data.payload?.exportId === exportId
}

/** Somente o rascunho desta transferência pode prevalecer sobre a lista enviada. */
export function readProjeto3DDraft(token: string, storage: Pick<Storage, 'getItem'>): { carrinho: LinhaProjeto3D[]; [key: string]: unknown } | null {
  try {
    const raw = storage.getItem(`branorte_orcamento_montar_draft_v1:import3d-${token}`)
    if (!raw) return null
    const draft = JSON.parse(raw)
    const age = Date.now() - Date.parse(draft.saved_at)
    if (draft.version !== 1 || !Number.isFinite(age) || age < -60_000 || age > 7 * 24 * 60 * 60 * 1000 || !Array.isArray(draft.data?.carrinho)) return null
    if (draft.data.projeto3DExportId !== token && (!draft.data.carrinho.length || !draft.data.carrinho.every((item: LinhaProjeto3D) => item.origem_projeto3d?.exportId === token))) return null
    return draft.data
  } catch { return null }
}
