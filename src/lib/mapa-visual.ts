import type { OrcamentoPonto, Visita } from '../hooks/useVisitas'
import { faixaIdade } from './periodo'
import { corDoEstado } from './mapa-modos'
import { chaveCoordenadaMapa, criarCacheLimitesMapa, geometriaDosPontos } from './mapa-visitas-regras'

export type ModoMapaVisual = 'vendidos' | 'orcados' | 'visitas'
export type FormaVisual = 'circulo' | 'estrela' | 'diamante'
export interface PontoVisual {
  id: string
  lat: number
  lng: number
  forma: FormaVisual
  cor: string
  circulo: { radius: number; color: string; weight: number; fillOpacity: number }
  detalhes: {
    cliente: string | null
    telefone: string
    contato: string | null
    vendedor: string | null
    cidade: string | null
    uf: string | null
    categoria: 'Vendido' | 'Orçado' | 'Visita'
  }
}
export interface CategoriaVisual {
  pontos: PontoVisual[]
  total: number
  semLocalizacao: number
}

// Mesmo padrão de MapaVisitas: a posição na lista completa de vendedores
// define a cor, independentemente de quais clientes passaram no filtro.
const CORES_VENDEDORES = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4']
const CIRCULO_ORCAMENTO = { radius: 5, color: '#fff', weight: 1, fillOpacity: 0.92 }
const CIRCULO_VISITA = { radius: 9, color: '#0f172a', weight: 2.5, fillOpacity: 1 }

export function modoMapaVisual(valor: string | null): ModoMapaVisual | null {
  return valor === 'vendidos' || valor === 'orcados' || valor === 'visitas' ? valor : null
}

export function estiloOrcadoVisual(total: number | null, data: string | null, agora = Date.now()) {
  const faixa = faixaIdade(data, agora)
  const cor = faixa === 'recente' ? '#22c55e' : faixa === 'medio' ? '#ef4444' : '#9ca3af'
  const forma: FormaVisual = total != null && total >= 300_000 ? 'diamante'
    : total != null && total >= 100_000 ? 'estrela' : 'circulo'
  return { forma, cor }
}

function temCoordenadas(p: { lat: number | null; lng: number | null }): p is { lat: number; lng: number } {
  return p.lat != null && p.lng != null && Number.isFinite(p.lat) && Number.isFinite(p.lng)
    && Math.abs(p.lat) <= 90 && Math.abs(p.lng) <= 180
}

function telefoneVisual(bruto: string | null): string {
  const texto = (bruto || '').trim()
  const numero = texto.replace(/\D/g, '')
  // Importações brasileiras guardam só DDD + número. DDI explícito é preservado.
  return !texto.startsWith('+') && (numero.length === 10 || numero.length === 11) ? '55' + numero : numero
}

// A identidade e a conversão vêm das mesmas RPCs do mapa completo, já agregadas
// por cliente e com as restrições de acesso do usuário aplicadas no servidor.
export function selecionarMapaVisual(orcamentos: OrcamentoPonto[], visitas: Visita[]) {
  const vendedores = [...new Set([
    ...visitas.map(v => v.vendedor_nome || '—'),
    ...orcamentos.map(p => p.vendedor || '—'),
  ])].sort()
  const vendidos: CategoriaVisual = { pontos: [], total: 0, semLocalizacao: 0 }
  const orcados: CategoriaVisual = { pontos: [], total: 0, semLocalizacao: 0 }
  const pendentes: CategoriaVisual = { pontos: [], total: 0, semLocalizacao: 0 }
  for (const p of orcamentos) {
    if (!temCoordenadas(p)) continue
    const vendido = p.vendido || p.n_vendas > 0
    const categoria = vendido ? vendidos : orcados
    categoria.pontos.push({ id: p.cli_key, lat: p.lat, lng: p.lng, circulo: CIRCULO_ORCAMENTO,
      detalhes: { cliente: p.cliente, telefone: telefoneVisual(p.telefone || p.fone),
        contato: p.fone || p.telefone, vendedor: p.vendedor, cidade: p.cidade, uf: p.uf,
        categoria: vendido ? 'Vendido' : 'Orçado' },
      ...(vendido ? { forma: 'circulo' as const, cor: corDoEstado(p.uf, false) } : estiloOrcadoVisual(p.total, p.data_recente)) })
    categoria.total++
  }
  for (const v of visitas) {
    if (v.visitar !== true || v.vendido || (v.n_vendas ?? 0) > 0) continue
    pendentes.total++
    if (!temCoordenadas(v)) { pendentes.semLocalizacao++; continue }
    const indice = Math.max(0, vendedores.indexOf(v.vendedor_nome || '—'))
    pendentes.pontos.push({ id: v.id, lat: v.lat, lng: v.lng, forma: 'circulo',
      cor: CORES_VENDEDORES[indice % CORES_VENDEDORES.length], circulo: CIRCULO_VISITA,
      detalhes: { cliente: v.nome, telefone: telefoneVisual(v.telefone), contato: v.telefone,
        vendedor: v.vendedor_nome, cidade: v.cidade, uf: v.estado, categoria: 'Visita' } })
  }
  return { vendidos, orcados, visitas: pendentes }
}

interface DesenhoVisual extends PontoVisual {
  dx: number
  dy: number
  anelMax: number
  limiteM: number
}

function anelVisual(indice: number) {
  if (indice <= 0) return 0
  let anel = 1, base = 1
  while (indice >= base + 6 * anel) { base += 6 * anel; anel++ }
  return anel
}

export function prepararDesenhoVisual(pontos: PontoVisual[]): DesenhoVisual[] {
  const geometria = geometriaDosPontos(pontos.map(p => [p.lat, p.lng]))
  const limites = criarCacheLimitesMapa()(geometria)
  const usados = new Map<string, number>()
  return pontos.map(p => {
    const chave = chaveCoordenadaMapa(p.lat, p.lng)
    const total = geometria.totalPorCoord.get(chave) ?? 1
    const indice = usados.get(chave) ?? 0
    usados.set(chave, indice + 1)
    const anel = anelVisual(indice)
    let base = 1
    for (let j = 1; j < anel; j++) base += 6 * j
    const angulo = 2 * Math.PI * (indice - base) / (6 * Math.max(1, anel)) - Math.PI / 2
    return { ...p, dx: Math.cos(angulo) * anel, dy: Math.sin(angulo) * anel,
      anelMax: anelVisual(total - 1), limiteM: Math.min(2500, limites.get(chave) ?? 2500) }
  })
}

// Mesma régua do mapa completo: anéis apenas no desenho, até 2,5 km e antes
// da cidade vizinha. Na escala do país, os pontos voltam ao centro real.
export function deslocamentoVisual(p: DesenhoVisual, zoom: number): [number, number] {
  if (!p.anelMax || (!p.dx && !p.dy)) return [0, 0]
  const metrosPorPx = 156543.03392 * Math.cos(p.lat * Math.PI / 180) / 2 ** zoom
  const passo = Math.min(64, Math.max(18, 700 / metrosPorPx), 260 / p.anelMax,
    p.limiteM / (metrosPorPx * p.anelMax))
  if (passo < 10) return [0, 0]
  return [p.dx * passo, p.dy * passo]
}
