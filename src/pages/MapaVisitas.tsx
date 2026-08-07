import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import {
  useVisitas, useGeocodarVisitas, useOrcamentosMapa, useListaOrcamentos, useVendasMapaCount, useUfsVisiveis,
  useMapaMarcacoes, useSalvarMarcacao,
  type Visita, type OrcamentoPonto, type OrcamentoLinha, type Marcacao,
} from '@/hooks/useVisitas'
import { useEtiquetas } from '@/hooks/useEtiquetas'
import { useAuth } from '@/hooks/useAuth'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { PainelViagem, corDoDia } from '@/components/mapa/PainelViagem'
import { useSalvarViagem, useSalvarLocalizacaoCliente, useViagem, type ViagemStatus } from '@/hooks/useViagens'
import { ViagensSalvas } from '@/components/mapa/ViagensSalvas'
import { supabase } from '@/lib/supabase'
import {
  passaPeriodo as passaPeriodoRegra, rotuloPeriodo,
  PERIODO_LABEL, PERIODO_LABEL_CURTO, type PeriodoFiltro,
} from '@/lib/periodo'
import {
  type ConfigViagem, type Parada, type Trecho, type PontoMapa, type Programacao,
  CONFIG_PADRAO, MAX_PARADAS, PRECISAO_INFO,
  montarParadas, otimizarOrdem, programar, chaveTrecho, nomeParada, roteavel,
  diasNecessarios,
} from '@/lib/viagem'

// Mapa de visitas — camadas (liga/desliga):
//  • Orçamentos: 1 pino por cliente. Cor pela IDADE do orçamento mais recente
//    (≤1 mês verde · 1–3 meses vermelho · >3 meses cinza). VENDIDO = azul (já comprou).
//  • Visitas WhatsApp: pinos dos "Dados pra visita" salvos pela extensão.
// Filtro vendido/orçado, lista completa (tabela) e filtro por RAIO a partir de um ponto.
// Geocoding por cidade/UF (Nominatim) com cache compartilhado.

const CENTRO_BR: [number, number] = [-15.78, -47.93]

const CORES = ['#10b981', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316', '#06b6d4']
const CINZA = '#9ca3af'
const FOLLOWUP_NOMES = new Set(['FOLLOW UP', 'FALLOW UP'])
function corDoVendedor(vendedor: string | null, ordem: string[]): string {
  const i = Math.max(0, ordem.indexOf(vendedor || '—'))
  return CORES[i % CORES.length]
}

// Cor do pino de ORÇAMENTO: vendido=azul; senão pela idade (verde ≤1m, vermelho 1–3m, cinza >3m)
const VERDE = '#22c55e', VERMELHO = '#ef4444', CINZA_VELHO = '#9ca3af', AZUL_VENDIDO = '#2563eb'
function diasDesde(dataISO: string | null): number | null {
  if (!dataISO) return null
  const t = new Date(dataISO.length <= 10 ? dataISO + 'T00:00:00' : dataISO).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((Date.now() - t) / 86400000)
}
function corIdade(dataRecente: string | null): string {
  const d = diasDesde(dataRecente)
  if (d == null) return CINZA
  if (d <= 30) return VERDE
  if (d <= 90) return VERMELHO
  return CINZA_VELHO
}
function corOrcamento(p: { data_recente: string | null; vendido: boolean }): string {
  return p.vendido ? AZUL_VENDIDO : corIdade(p.data_recente)
}
function idadeLabel(dataRecente: string | null): string {
  const d = diasDesde(dataRecente)
  if (d == null) return '—'
  if (d <= 30) return `há ${d} dia${d === 1 ? '' : 's'}`
  const m = Math.floor(d / 30)
  return `há ${m} ${m === 1 ? 'mês' : 'meses'}`
}

// Destaque de valor no mapa (só ORÇADOS, não vendidos):
//  • total ≥ 300 mil → 💎 diamante   • total ≥ 100 mil → ⭐ estrela
// A COR continua sendo a da idade (verde/vermelho/cinza); só a FORMA muda.
const LIMITE_ESTRELA = 100_000
const LIMITE_DIAMANTE = 300_000
function formaValor(total: number | null, vendido: boolean): 'diamante' | 'estrela' | null {
  if (vendido || total == null) return null
  if (total >= LIMITE_DIAMANTE) return 'diamante'
  if (total >= LIMITE_ESTRELA) return 'estrela'
  return null
}
// SVG puro (sem lib) da forma, preenchido com a cor da idade + contorno branco.
//  • estrela: geometria Lucide (pontas levemente arredondadas — visual mais limpo)
//  • diamante: gema lapidada = silhueta preenchida + facetas brancas por cima
function svgForma(forma: 'diamante' | 'estrela', cor: string, tam = 24): string {
  const open = `<svg width="${tam}" height="${tam}" viewBox="0 0 24 24" style="display:block;filter:drop-shadow(0 1px 1.5px rgba(0,0,0,.5))">`
  if (forma === 'estrela') {
    const p = 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z'
    return `${open}<path d="${p}" fill="${cor}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/></svg>`
  }
  return `${open}`
    + `<path d="M5 3H19L22 9L12 22L2 9Z" fill="${cor}" stroke="#fff" stroke-width="1.3" stroke-linejoin="round"/>`
    + `<g stroke="#fff" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" fill="none" opacity=".85">`
    + `<path d="M2 9H22"/><path d="M5 3L12 9M19 3L12 9M12 9V22"/></g></svg>`
}
function iconeForma(forma: 'diamante' | 'estrela', cor: string): L.DivIcon {
  const tam = forma === 'diamante' ? 22 : 24
  return L.divIcon({
    className: 'orc-forma-valor',
    html: svgForma(forma, cor, tam),
    iconSize: [tam, tam],
    iconAnchor: [tam / 2, tam / 2],
    popupAnchor: [0, -tam / 2],
  })
}

// distância em km (haversine)
function distKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371, toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

function pinIcon(cor: string): L.DivIcon {
  return L.divIcon({
    className: 'visita-pin',
    html: `<div style="width:22px;height:22px;border-radius:50% 50% 50% 0;background:${cor};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 22],
    popupAnchor: [0, -22],
  })
}
function pinCentro(): L.DivIcon {
  return L.divIcon({
    className: 'raio-centro',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:#0ea5e9;border:3px solid #fff;box-shadow:0 0 0 3px rgba(14,165,233,.4)"></div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  })
}

const brl = (v: number | null) =>
  v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
// Zero no mapa quase nunca é "vendeu por zero": é venda importada sem valor —
// 1.724 das 2.204 linhas de vendas_mapa vieram só com nome e cidade, sem valor,
// sem data e sem vendedor. Escrever "R$ 0" afirma um número que ninguém apurou.
const temValor = (v: number | null) => v != null && Number(v) > 0
// Valor curto pro painel por estado (a coluna é estreita): R$ 6,7 mi · R$ 904 mil
const brlCurto = (v: number) => {
  if (!v) return 'R$ 0'
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`
  if (v >= 1_000) return `R$ ${Math.round(v / 1_000).toLocaleString('pt-BR')} mil`
  return brl(v)
}
// UF normalizada. Sem estado vira '—' (bucket próprio) pra não colidir com ''=“todos”.
const ufKey = (uf: string | null) => (uf || '').trim().toUpperCase() || '—'
const esc = (s: string | null) => (s || '').replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c] as string))
const dataBR = (iso: string | null) => (iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—')
const dataHoraBR = (iso: string | null) => (iso ? new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—')
// Normaliza texto pra busca: sem acento, minúsculo (ex "Ji-Paraná" casa "ji parana")
const normTxt = (s: string | null) =>
  (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

// Chave estável de um cliente pra marcação (telefone só-dígitos; senão nome normalizado).
function chaveMarc(telefone: string | null, fone: string | null, cliente: string | null): string {
  const tel = (telefone || fone || '').replace(/\D/g, '')
  return tel || ('nome:' + normTxt(cliente))
}

// ── clientes empilhados na MESMA coordenada ─────────────────────────────────
// A precisão é CIDADE, não endereço: 68,85% dos clientes dividem coordenada. Sem
// espalhar, o Leaflet pinta um EM CIMA do outro e só dá pra clicar no de cima —
// os de trás ficam invisíveis. O deslocamento é só de DESENHO: lat/lng do dado
// continua intacto (rota da viagem, "Abrir no Google Maps", distância do raio).
// Dado real (ago/2026): 2.346 clientes em 1.267 coordenadas — 352 pontos empilham
// 1.431 clientes (61%). 93% dessas pilhas têm até 7 (cabem no 1º anel); a maior tem 112.
// O passo ABRE conforme você aproxima. Com passo fixo em pixel o leque virava um
// nó apertado do mesmo tamanho em qualquer zoom: quanto mais perto, mais colado
// ele parecia contra as ruas. Longe manda o teto no chão; perto manda a tela.
// Os números saem do TAMANHO DO PINO, não de gosto: a estrela tem 24px e o
// diamante 22px, então 40px de passo deixava 16px de folga — no anel a distância
// entre vizinhos é igual ao raio, e o resultado era um bolo encostado. 64px dá
// folga de 40px, uma estrela e meia entre um pino e outro.
const PASSO_MIN_PX = 18        // piso: menos que isso os pinos voltam a se tocar
const PASSO_MAX_PX = 64        // teto: leque não vira uma flor gigante na tela
const PASSO_ALVO_M = 700       // alvo no chão — abre o leque já no zoom de cidade
const RAIO_TELA_MAX_PX = 260   // pilha grande não pode ocupar a tela inteira

// Teto no chão. Eram 20 km, e 20 km põe o pino na CIDADE VIZINHA: de Braço do
// Norte, São Ludgero está a 6,2 km e Grão-Pará a 11,1 km. Medido em 06/08/2026
// sobre as 316 pilhas do mapa: no zoom 9 eram 652 pinos (58%) desenhados mais
// perto de outra cidade do que da própria; no zoom 12, 373 (33%).
// 2,5 km cabe dentro de praticamente qualquer município e ainda dá leque legível
// do zoom 12 pra cima — que é onde se olha cidade.
const RAIO_MAX_M = 2_500

// Abaixo disto o leque não separa nada (o pino tem 5px de raio, a estrela 24px):
// só empurraria o cliente pra fora do município sem ganhar legibilidade. Quando
// o passo não alcança este piso, o grupo COLAPSA no ponto real — melhor um pino
// só na cidade certa do que 100 espalhados na cidade errada.
const PASSO_UTIL_PX = 10

/** Em que anel cai o índice i (0 = centro, 1..6 = 1º anel, 7..18 = 2º…). */
function anelDoIndice(i: number): number {
  if (i <= 0) return 0
  let k = 1, base = 1
  while (i >= base + 6 * k) { base += 6 * k; k++ }
  return k
}

/** Anel hexagonal: 0 fica no centro, 6 no 1º anel, 12 no 2º… devolve (dx, dy) em anéis. */
function anelHex(i: number): [number, number] {
  const k = anelDoIndice(i)
  if (!k) return [0, 0]
  let base = 1
  for (let j = 1; j < k; j++) base += 6 * j
  const ang = (2 * Math.PI * (i - base)) / (6 * k) - Math.PI / 2
  return [Math.cos(ang) * k, Math.sin(ang) * k]
}

/**
 * Converte o deslocamento (em anéis) na coordenada de desenho do zoom atual.
 *
 * O passo sai de PASSO_ALVO_M no chão, preso entre PASSO_MIN_PX e PASSO_MAX_PX:
 * é isso que faz o leque ABRIR quando você aproxima, em vez de ficar sempre com o
 * mesmo nó de 18px. Depois passa por dois tetos, os dois calibrados pelo anel MAIS
 * EXTERNO do grupo (`anelMax`) — porque é o pino de fora que estoura primeiro:
 *   • de tela  → uma pilha de 108 não pode virar uma flor do tamanho do monitor;
 *   • de chão  → nenhum pino a mais de RAIO_MAX_M do ponto real.
 * Como o passo é o mesmo pro grupo todo, os anéis encolhem juntos em vez de um
 * colapsar em cima do outro.
 *
 * Quando nem assim o passo alcança PASSO_UTIL_PX — mapa aberto no estado ou no
 * país — o grupo volta INTEIRO pro ponto real. Espalhar ali não separava nada e
 * ainda mandava o cliente pra cidade do lado; quem resolve nessa escala é a
 * lista "neste mesmo ponto" do popup.
 */
function posEspalhada(
  map: L.Map, lat: number, lng: number,
  dx: number, dy: number, anelMax: number, limiteM = RAIO_MAX_M,
): L.LatLng {
  if (!dx && !dy) return L.latLng(lat, lng)
  const z = map.getZoom()
  const mPorPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z)
  const anel = Math.max(1, anelMax)
  const raioM = Math.min(RAIO_MAX_M, limiteM)   // o menor entre o teto e a divisa
  const passo = Math.min(
    Math.min(PASSO_MAX_PX, Math.max(PASSO_MIN_PX, PASSO_ALVO_M / mPorPx)),
    RAIO_TELA_MAX_PX / anel,
    raioM / (mPorPx * anel),
  )
  if (passo < PASSO_UTIL_PX) return L.latLng(lat, lng)   // não cabe: fica na cidade certa
  const pt = map.project([lat, lng], z)
  return map.unproject(L.point(pt.x + dx * passo, pt.y + dy * passo), z)
}

/** Só o que o zoom precisa mexer: o pino e a coordenada real de onde ele saiu. */
type Espalhado = {
  m: { setLatLng: (ll: L.LatLng) => unknown }
  lat: number; lng: number; dx: number; dy: number; anelMax: number; limiteM: number
}
// Pino VISITADO (caso comum): um único ponto com o ✓ dentro, na cor da idade.
// Um blob só (sem bolinha extra colada) e é o próprio marcador clicável.
function iconeVisitado(cor: string): L.DivIcon {
  return L.divIcon({
    className: 'pin-visitado',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${cor};border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
    popupAnchor: [0, -9],
  })
}
// Selo ✓ pequeno no canto — usado só quando o pino já é estrela/diamante
// (aí não dá pra trocar a forma, então marca no cantinho). Não captura clique.
function checkIcon(): L.DivIcon {
  return L.divIcon({
    className: 'marc-check',
    html: `<div style="pointer-events:none;width:13px;height:13px;border-radius:50%;background:#16a34a;border:2px solid #fff;display:flex;align-items:center;justify-content:center;box-shadow:0 1px 2px rgba(0,0,0,.4)"><svg width="7" height="7" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg></div>`,
    iconSize: [13, 13],
    iconAnchor: [-1, 15], // grudado no canto sup-direito da estrela/diamante
  })
}

function popupVisita(v: Visita, isFollowUp: boolean, labels: string[]): string {
  const tel = (v.telefone || '').replace(/\D/g, '')
  const loc = [esc(v.cidade), esc(v.estado)].filter(Boolean).join(' - ')
  const badge = labels.length
    ? (isFollowUp
        ? `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#dcfce7;color:#166534;font-weight:600">🟢 Follow up</span>`
        : `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#e5e7eb;color:#374151;font-weight:600">⚪ ${labels.map(esc).join(', ')}</span>`)
    : ''
  return `
    <div style="min-width:180px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(v.nome) || 'Sem nome'}</div>
      ${loc ? `<div style="font-size:12px;color:#64748b">${loc}</div>` : ''}
      ${badge ? `<div style="margin-top:4px">${badge}</div>` : ''}
      ${v.interesse ? `<div style="font-size:12px;margin-top:4px">🎯 ${esc(v.interesse)}</div>` : ''}
      ${v.valor_negociando != null ? `<div style="font-size:13px;font-weight:600;color:#10b981;margin-top:2px">${brl(v.valor_negociando)}</div>` : ''}
      <div style="font-size:11px;color:#64748b;margin-top:4px">Vendedor: ${esc(v.vendedor_nome) || '—'}</div>
      ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" style="display:inline-block;margin-top:6px;font-size:12px;color:#10b981;font-weight:600">Abrir WhatsApp ↗</a>` : ''}
    </div>`
}

// Selo de precisão da coordenada. Aparece SEMPRE — o spec §7 é explícito:
// "Nunca esconder que uma localização é aproximada".
function seloPrecisao(p: OrcamentoPonto): string {
  const i = PRECISAO_INFO[p.precisao] ?? PRECISAO_INFO.cidade
  return `<div style="font-size:11px;margin-top:4px;padding:3px 6px;border-radius:6px;background:${i.cor}18;color:${i.cor};font-weight:600" title="${esc(i.rotulo)}">${i.icone} ${esc(i.rotulo)}</div>`
}

/**
 * Bloco de "adicionar à viagem" do popup.
 * Se houver vários clientes na MESMA coordenada (o caso comum — 68,85% dividem
 * coordenada), lista todos com botão individual + "adicionar todos". Sem isso o
 * usuário só consegue escolher o cliente que o Leaflet desenhou por cima.
 */
function blocoViagem(p: OrcamentoPonto, vizinhos: OrcamentoPonto[], jaNaViagem: Set<string>): string {
  const btn = (c: OrcamentoPonto, largura: string, rotulo: string) => {
    const dentro = jaNaViagem.has(c.cli_key)
    return `<button data-viagem data-key="${encodeURIComponent(c.cli_key)}" ${dentro ? 'disabled' : ''}
      style="width:${largura};padding:7px 8px;border:0;border-radius:8px;background:${dentro ? '#e2e8f0' : '#2563eb'};color:${dentro ? '#64748b' : '#fff'};font-weight:700;font-size:12px;cursor:${dentro ? 'default' : 'pointer'};margin-top:5px">${dentro ? '✓ na viagem' : rotulo}</button>`
  }
  if (vizinhos.length <= 1) return btn(p, '100%', '＋ Adicionar à viagem')

  const faltam = vizinhos.filter(c => !jaNaViagem.has(c.cli_key))
  const linhas = vizinhos.map(c => {
    const dentro = jaNaViagem.has(c.cli_key)
    return `<li style="display:flex;align-items:center;gap:6px;padding:3px 0;border-top:1px solid #e2e8f0">
      <span style="flex:1;min-width:0;font-size:12px;color:#0f172a;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.cliente)}">${esc(c.cliente) || '—'}</span>
      <span style="font-size:11px;color:${temValor(c.total) ? '#64748b' : '#cbd5e1'};white-space:nowrap">${temValor(c.total) ? brl(c.total) : '—'}</span>
      <button data-viagem data-key="${encodeURIComponent(c.cli_key)}" ${dentro ? 'disabled' : ''}
        style="padding:2px 8px;border:0;border-radius:6px;background:${dentro ? '#e2e8f0' : '#2563eb'};color:${dentro ? '#64748b' : '#fff'};font-weight:700;font-size:11px;cursor:${dentro ? 'default' : 'pointer'}">${dentro ? '✓' : '＋'}</button>
    </li>`
  }).join('')

  return `
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid #cbd5e1">
      <div style="font-size:11px;font-weight:700;color:#0f172a">${vizinhos.length} clientes neste ponto</div>
      <div style="font-size:10.5px;color:#64748b;line-height:1.35;margin-top:2px">Todos caem no centro da cidade — o CRM não tem o endereço deles.</div>
      <ul style="list-style:none;margin:5px 0 0;padding:0;max-height:150px;overflow-y:auto">${linhas}</ul>
      ${faltam.length > 1
        ? `<button data-viagem-todos data-keys="${encodeURIComponent(faltam.map(c => c.cli_key).join('|'))}"
             style="width:100%;padding:7px;border:0;border-radius:8px;background:#2563eb;color:#fff;font-weight:700;font-size:12px;cursor:pointer;margin-top:6px">＋ Adicionar os ${faltam.length} como uma parada</button>`
        : ''}
    </div>`
}

/**
 * Fora do modo viagem o popup também precisa dar saída pros empilhados: mesmo
 * espalhados, num zoom baixo os pinos voltam a se encavalar. Aqui a lista é dos
 * clientes VISÍVEIS no ponto (respeita os filtros da tela) e cada um abre o popup dele.
 */
function blocoVizinhos(p: OrcamentoPonto, vizinhos: OrcamentoPonto[]): string {
  const outros = vizinhos.filter(c => c.cli_key !== p.cli_key)
  if (!outros.length) return ''
  const linhas = outros.map(c => `
    <li style="border-top:1px solid #e2e8f0">
      <button data-ir data-key="${encodeURIComponent(c.cli_key)}"
        style="display:flex;align-items:center;gap:6px;width:100%;padding:4px 0;border:0;background:none;cursor:pointer;text-align:left">
        <span style="flex:1;min-width:0;font-size:12px;color:#1d4ed8;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.cliente)}">${esc(c.cliente) || '—'}</span>
        <span style="font-size:11px;color:${temValor(c.total) ? '#64748b' : '#cbd5e1'};white-space:nowrap">${temValor(c.total) ? brl(c.total) : '—'}</span>
      </button>
    </li>`).join('')
  return `
    <div style="margin-top:8px;padding-top:6px;border-top:1px solid #cbd5e1">
      <div style="font-size:11px;font-weight:700;color:#0f172a">＋${outros.length} cliente${outros.length > 1 ? 's' : ''} neste mesmo ponto</div>
      <div style="font-size:10.5px;color:#64748b;line-height:1.35;margin-top:2px">Todos caem no centro da cidade — o CRM não tem o endereço deles.</div>
      <ul style="list-style:none;margin:4px 0 0;padding:0;max-height:150px;overflow-y:auto">${linhas}</ul>
    </div>`
}

function popupOrcamento(
  p: OrcamentoPonto,
  marc?: Marcacao | null,
  dist?: number,
  viagem?: { vizinhos: OrcamentoPonto[]; jaNaViagem: Set<string> },
  vizinhos?: OrcamentoPonto[],
): string {
  const tel = (p.telefone || '').replace(/\D/g, '')
  const foneFmt = p.fone || p.telefone || ''
  const loc = [esc(p.cidade), esc(p.uf)].filter(Boolean).join(' - ')
  const compras = p.vendido && p.n_vendas > 0 ? ` · ${p.n_vendas} compra${p.n_vendas > 1 ? 's' : ''}` : ''
  const vendBadge = p.vendido
    ? `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#dbeafe;color:#1e40af;font-weight:700">✓ VENDIDO${compras}</span>`
    : `<span style="font-size:11px;padding:1px 7px;border-radius:999px;background:#fef9c3;color:#854d0e;font-weight:600">Orçado</span>`
  const feito = marc?.visitado
  const chave = chaveMarc(p.telefone, p.fone, p.cliente)
  const visitaLinha = feito
    ? `<div style="font-size:12px;color:#166534;font-weight:600;margin-top:6px">✅ Visita feita${marc?.visitado_em ? ' · ' + dataHoraBR(marc.visitado_em) : ''}${marc?.autor ? ' · ' + esc(marc.autor) : ''}</div>`
    : ''
  const notaLinha = marc?.nota
    ? `<div style="font-size:12px;color:#334155;margin-top:4px;white-space:pre-wrap;background:#f1f5f9;border-radius:6px;padding:5px 7px">📝 ${esc(marc.nota)}</div>`
    : ''
  const btn = `<button data-marcar data-chave="${encodeURIComponent(chave)}" style="margin-top:8px;width:100%;padding:8px;border:0;border-radius:8px;background:${feito ? '#e2e8f0' : '#16a34a'};color:${feito ? '#0f172a' : '#fff'};font-weight:700;font-size:12px;cursor:pointer">${feito ? '✏️ Editar visita / nota' : '✅ Marcar visita / anotar'}</button>`
  return `
    <div style="min-width:200px;font-family:inherit">
      <div style="font-weight:600;font-size:13px">${esc(p.cliente) || 'Sem nome'}</div>
      ${loc ? `<div style="font-size:12px;color:#64748b">${loc}${dist != null ? ` · <b>${dist.toFixed(0)} km</b>` : ''}</div>` : ''}
      <div style="margin-top:4px">${vendBadge}</div>
      ${p.numeros ? `<div style="font-size:11px;color:#475569;margin-top:3px">🧾 Nº ${esc(p.numeros)}</div>` : ''}
      ${temValor(p.total)
        ? `<div style="font-size:14px;font-weight:700;color:#10b981;margin-top:3px">${brl(p.total)}</div>`
        : `<div style="font-size:12px;color:#94a3b8;font-style:italic;margin-top:3px">valor não informado</div>`}
      <div style="font-size:11px;color:#64748b;margin-top:2px">${p.n_orcamentos} orçamento${p.n_orcamentos === 1 ? '' : 's'}${p.data_recente ? ` · último ${dataBR(p.data_recente)} <b>(${idadeLabel(p.data_recente)})</b>` : ' · sem data'}</div>
      <div style="font-size:11px;color:#64748b;margin-top:3px">Vendedor: ${esc(p.vendedor) || '—'}</div>
      ${foneFmt ? `<div style="font-size:12px;color:#0f172a;margin-top:4px">📱 ${esc(foneFmt)}</div>` : ''}
      ${tel ? `<a href="https://wa.me/${tel}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:12px;color:#10b981;font-weight:600">Abrir WhatsApp ↗</a>` : ''}
      ${seloPrecisao(p)}
      <a href="https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}" target="_blank" rel="noopener" style="display:inline-block;margin-top:4px;font-size:11px;color:#2563eb;font-weight:600">Abrir no Google Maps ↗</a>
      <button data-mover data-key="${encodeURIComponent(p.cli_key)}"
        style="display:block;width:100%;margin-top:6px;padding:6px;border:1px solid #cbd5e1;border-radius:8px;background:#f8fafc;color:#0f172a;font-weight:600;font-size:11.5px;cursor:pointer">📍 Mover este ponto no mapa</button>
      ${visitaLinha}
      ${notaLinha}
      ${viagem ? blocoViagem(p, viagem.vizinhos, viagem.jaNaViagem) : `${blocoVizinhos(p, vizinhos ?? [])}${btn}`}
    </div>`
}

/** Linha da tabela: 1 orçamento, ou 1 cliente com os orçamentos dele somados. */
type LinhaLista = OrcamentoLinha & { n_orc: number; numeros: string }

type VendFiltro = 'todos' | 'orcados' | 'vendidos' | 'alto' | 'diamante'
type VisitaFiltro = 'todos' | 'visitados' | 'pendentes'

// Filtro de PERÍODO — regra e rótulos em src/lib/periodo.ts (com testes).
// Padrão 24 meses: mantém a tela parecida com a de antes da carga do histórico.

export function MapaVisitas() {
  const { data: visitas = [], isLoading } = useVisitas()
  const { data: orcPontos = [], isLoading: loadingOrc, refetch: refetchOrc } = useOrcamentosMapa()
  const { data: lista = [] } = useListaOrcamentos()
  const { data: vendasCount = 0 } = useVendasMapaCount()
  const { data: etiquetasWa = [] } = useEtiquetas()
  const { data: marc = {} } = useMapaMarcacoes()
  const { data: ufsVisiveis = [] } = useUfsVisiveis()
  const salvarMarc = useSalvarMarcacao()
  const salvarViagemMut = useSalvarViagem()
  const salvarLocalMut = useSalvarLocalizacaoCliente()
  const { profile } = useAuth()
  const geocodar = useGeocodarVisitas()
  const [vendedorSel, setVendedorSel] = useState<string>('')
  const [showOrc, setShowOrc] = useState(true)
  const [showVis, setShowVis] = useState(false)
  const [busca, setBusca] = useState('')
  const [sugAberta, setSugAberta] = useState(false)
  const [vendFiltro, setVendFiltro] = useState<VendFiltro>('todos')
  const [visitaFiltro, setVisitaFiltro] = useState<VisitaFiltro>('todos')
  const [periodo, setPeriodo] = useState<PeriodoFiltro>('24m')
  const [ufSel, setUfSel] = useState<string>('')   // '' = todos os estados
  const [ufSheet, setUfSheet] = useState(false)    // painel por estado no celular
  const [showLista, setShowLista] = useState(false)
  const [porCliente, setPorCliente] = useState(false)   // lista/CSV: 1 linha por cliente
  // modal de marcação (visita feita + anotação)
  const [marcarAlvo, setMarcarAlvo] = useState<{ chave: string; cliente: string | null; telefone: string | null } | null>(null)
  const [formVisitado, setFormVisitado] = useState(true)
  const [formNota, setFormNota] = useState('')
  // lookup chave -> dados do cliente (pro clique no botão do popup abrir o modal)
  const pontoInfoRef = useRef<Map<string, { cliente: string | null; telefone: string | null }>>(new Map())
  const [sortKey, setSortKey] = useState<'numero' | 'data' | 'cliente' | 'cidade' | 'total' | 'vendido'>('data')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  // raio
  const [modoRaio, setModoRaio] = useState(false)
  const [centro, setCentro] = useState<{ lat: number; lng: number } | null>(null)
  const [raioKm, setRaioKm] = useState(100)
  const modoRaioRef = useRef(false)
  useEffect(() => { modoRaioRef.current = modoRaio }, [modoRaio])

  // ── MODO PLANEJAMENTO DE VIAGEM ───────────────────────────────────────────
  // Estado isolado: entrar e sair NÃO mexe em busca, filtros, raio ou lista.
  const [modoViagem, setModoViagem] = useState(false)
  const [cfgViagem, setCfgViagemState] = useState<ConfigViagem>(CONFIG_PADRAO)
  const [paradas, setParadas] = useState<Parada[]>([])
  const [trechos, setTrechos] = useState<Map<string, Trecho>>(new Map())
  const [provedorRota, setProvedorRota] = useState<string | null>(null)
  const [calculandoRota, setCalculandoRota] = useState(false)
  const [escolhendoOrigem, setEscolhendoOrigem] = useState(false)
  const [viagemSheet, setViagemSheet] = useState(false)
  const [salvandoViagem, setSalvandoViagem] = useState(false)
  const [viagemSalvaEm, setViagemSalvaEm] = useState<string | null>(null)
  const [gerandoPdf, setGerandoPdf] = useState(false)
  const [corrigirLocal, setCorrigirLocal] = useState<Parada | null>(null)
  const [viagemId, setViagemId] = useState<string | null>(null)
  const [viagemStatus, setViagemStatus] = useState<ViagemStatus>('rascunho')
  const [abrirSalvas, setAbrirSalvas] = useState(false)
  const [carregarId, setCarregarId] = useState<string | null>(null)
  const setCfgViagem = (patch: Partial<ConfigViagem>) => setCfgViagemState(c => ({ ...c, ...patch }))

  // Abrir uma viagem salva: o hook busca, o effect aplica no painel.
  const { data: viagemCarregada, isFetching: carregandoViagem } = useViagem(carregarId)
  useEffect(() => {
    if (!carregarId || !viagemCarregada || viagemCarregada.id !== carregarId) return
    setCfgViagemState(viagemCarregada.cfg)
    setParadas(viagemCarregada.paradas)
    setViagemId(viagemCarregada.id)
    setViagemStatus(viagemCarregada.status)
    setTrechos(new Map())            // trechos são do roteiro antigo
    geometriasRef.current = []
    setGeoTrechos(new Map())
    setProvedorRota(null)
    setViagemSalvaEm(null)
    setCarregarId(null)
    setAbrirSalvas(false)
    setModoViagem(true)
  }, [carregarId, viagemCarregada])

  // §25.19 — o planejamento tem que sobreviver ao F5. Salvar no banco é explícito
  // (botão), mas trabalho NÃO salvo também não pode evaporar: guarda um rascunho
  // local e devolve na volta. Só o rascunho — nada de telefone/coordenada vai pro
  // localStorage além do que o próprio mapa já mostra na tela.
  const RASCUNHO_KEY = 'branorte:viagem-rascunho:v1'
  const rascunhoLido = useRef(false)
  useEffect(() => {
    if (rascunhoLido.current) return
    rascunhoLido.current = true
    try {
      const cru = localStorage.getItem(RASCUNHO_KEY)
      if (!cru) return
      const r = JSON.parse(cru) as { cfg?: ConfigViagem; paradas?: Parada[]; id?: string | null; status?: ViagemStatus }
      if (!r?.paradas?.length && !r?.cfg?.origem) return
      if (r.cfg) setCfgViagemState({ ...CONFIG_PADRAO, ...r.cfg })
      if (r.paradas) setParadas(r.paradas)
      setViagemId(r.id ?? null)
      if (r.status) setViagemStatus(r.status)
    } catch {
      localStorage.removeItem(RASCUNHO_KEY)   // rascunho corrompido não pode travar a tela
    }
  }, [])
  useEffect(() => {
    if (!rascunhoLido.current) return
    try {
      if (!paradas.length && !cfgViagem.origem) localStorage.removeItem(RASCUNHO_KEY)
      else localStorage.setItem(RASCUNHO_KEY, JSON.stringify({ cfg: cfgViagem, paradas, id: viagemId, status: viagemStatus }))
    } catch { /* quota cheia: o rascunho é conveniência, não pode quebrar a tela */ }
  }, [cfgViagem, paradas, viagemId, viagemStatus])

  const viagemLayerRef = useRef<L.LayerGroup | null>(null)
  // O handler de popupopen é registrado UMA vez (deps []), então o closure congela.
  // Tudo que ele precisa saber "agora" passa por ref — mesmo padrão do modoRaioRef.
  const acoesPopupRef = useRef({
    adicionar: (_keys: string[]) => {},
    marcar: (_chave: string) => {},
    origem: (_c: { lat: number; lng: number }) => {},
    irPara: (_cliKey: string) => {},
    mover: (_cliKey: string) => {},
  })
  // MOVER PONTO — o pino só vira arrastável depois de um clique explícito em
  // "Mover este ponto", e a gravação só acontece no "Salvar aqui". Deixar os 2.349
  // pinos arrastáveis o tempo todo seria um deslize de mouse virando dado errado,
  // silenciosamente, na localização de um cliente.
  const [movendo, setMovendo] = useState<{ cliKey: string; cliente: string | null; lat: number; lng: number } | null>(null)
  const moverLayerRef = useRef<L.LayerGroup | null>(null)
  // Pinos que saíram do centro (empilhados): o zoom tem que reposicionar, senão o
  // espaçamento em pixels vira espaçamento em quilômetros.
  const espalhadosRef = useRef<Espalhado[]>([])
  // cli_key -> pino desenhado. É o que faz "ir pro vizinho" e a busca abrirem o
  // popup DO MARCADOR (com os botões ligados) em vez de um popup solto na coordenada.
  const marcadorPorKeyRef = useRef<Map<string, { openPopup: () => unknown }>>(new Map())
  const escolhendoOrigemRef = useRef(false)
  useEffect(() => { escolhendoOrigemRef.current = escolhendoOrigem }, [escolhendoOrigem])
  // Contexto do popup por REF, não por dep do effect: entrar no modo viagem ou
  // adicionar uma parada NÃO pode repintar os milhares de pinos.
  const ctxPopupRef = useRef<{ ativo: boolean; porCoord: Map<string, OrcamentoPonto[]>; dentro: Set<string> }>({
    ativo: false, porCoord: new Map(), dentro: new Set(),
  })
  const modoViagemRef = useRef(false)
  useEffect(() => { modoViagemRef.current = modoViagem }, [modoViagem])

  // resolve etiqueta_id (por vendedor) -> nome (IDs do Wascript não são globais).
  const { byVendId, globId } = useMemo(() => {
    const byVendId = new Map<string, string>()
    const cont = new Map<string, Map<string, number>>()
    for (const e of etiquetasWa) {
      const nome = e.etiqueta_nome || ''
      if (!nome) continue
      const id = String(e.etiqueta_id_wascript)
      const vend = (e.vendedor_nome || '').toUpperCase()
      if (vend) byVendId.set(`${vend}|${id}`, nome)
      if (!cont.has(id)) cont.set(id, new Map())
      const m = cont.get(id)!
      m.set(nome, (m.get(nome) || 0) + 1)
    }
    const globId = new Map<string, string>()
    for (const [id, m] of cont) {
      let best = '', bestN = -1
      for (const [nome, n] of m) if (n > bestN) { best = nome; bestN = n }
      globId.set(id, best)
    }
    return { byVendId, globId }
  }, [etiquetasWa])

  function resolverEtiquetas(v: Visita): { nomes: string[]; isFollowUp: boolean } {
    const vnorm = (v.vendedor_nome || '').toUpperCase()
    const nomes: string[] = []
    for (const id of v.etiquetas || []) {
      const nome = byVendId.get(`${vnorm}|${String(id)}`) || globId.get(String(id))
      if (nome && !nomes.includes(nome)) nomes.push(nome)
    }
    return { nomes, isFollowUp: nomes.some(n => FOLLOWUP_NOMES.has(n.toUpperCase())) }
  }
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const canvasRef = useRef<L.Canvas | null>(null) // renderer canvas (pontos rápidos)
  const raioLayerRef = useRef<L.LayerGroup | null>(null)
  const divRef = useRef<HTMLDivElement | null>(null)
  const autoGeoRef = useRef(false)
  const autoCidRef = useRef(false)

  // vendedores (dropdown) — combina visitas + orçamentos
  const vendedores = useMemo(() => {
    const s = new Set<string>()
    for (const v of visitas) s.add(v.vendedor_nome || '—')
    for (const p of orcPontos) s.add(p.vendedor || '—')
    return [...s].sort()
  }, [visitas, orcPontos])

  const comCoord = useMemo(() => visitas.filter(v => v.lat != null && v.lng != null), [visitas])
  const semCoord = visitas.length - comCoord.length
  const termo = busca.trim().toLowerCase()
  // filtro por status/valor. 'alto' = orçado ≥100 mil (estrela+diamante);
  // 'diamante' = orçado ≥300 mil. Ambos só valem pra NÃO vendidos.
  const passaFiltro = (vendido: boolean, total: number | null) => {
    switch (vendFiltro) {
      case 'vendidos': return vendido
      case 'orcados': return !vendido
      case 'alto': return !vendido && (total ?? 0) >= LIMITE_ESTRELA
      case 'diamante': return !vendido && (total ?? 0) >= LIMITE_DIAMANTE
      default: return true // 'todos'
    }
  }
  // filtro de PERÍODO pela data mais recente do cliente/orçamento.
  // ⚠️ Sem data NÃO some: 1.5 mil registros de vendas_mapa vieram sem data_venda,
  // e escondê-los faria o filtro apagar cliente real em vez de filtrar por idade.
  const passaPeriodo = (dataRecente: string | null) => passaPeriodoRegra(dataRecente, periodo)
  // filtro de visita (só na camada de orçamentos do mapa)
  const passaVisita = (p: OrcamentoPonto) => {
    if (visitaFiltro === 'todos') return true
    const feito = !!marc[chaveMarc(p.telefone, p.fone, p.cliente)]?.visitado
    return visitaFiltro === 'visitados' ? feito : !feito
  }

  const visFiltradas = useMemo(
    () => comCoord.filter(v =>
      (!vendedorSel || (v.vendedor_nome || '—') === vendedorSel) &&
      (!ufSel || ufKey(v.estado) === ufSel) &&
      (!termo || [v.nome, v.cidade, v.estado, v.telefone, v.vendedor_nome, v.interesse]
        .some(x => (x || '').toLowerCase().includes(termo)))
    ),
    [comCoord, vendedorSel, termo, ufSel]
  )
  // Base = todos os filtros MENOS o de estado. É dela que sai o painel "por estado"
  // (se saísse de orcFiltrados, ao escolher um estado os outros sumiriam da lista).
  const orcBase = useMemo(
    () => orcPontos.filter(p =>
      (!vendedorSel || (p.vendedor || '—') === vendedorSel) &&
      passaFiltro(p.vendido, p.total) &&
      passaVisita(p) &&
      passaPeriodo(p.data_recente) &&
      (!termo || [p.cliente, p.cidade, p.uf, p.telefone, p.fone, p.numeros, p.vendedor]
        .some(x => (x || '').toLowerCase().includes(termo)))
    ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orcPontos, vendedorSel, termo, vendFiltro, visitaFiltro, periodo, marc]
  )
  const orcFiltrados = useMemo(
    () => (ufSel ? orcBase.filter(p => ufKey(p.uf) === ufSel) : orcBase),
    [orcBase, ufSel]
  )

  // Quantos clientes o PERÍODO está escondendo, mantidos os demais filtros.
  // O mapa precisa dizer isso: no padrão de 24 meses some 57% da base — e 30% de
  // quem já comprou. Sem o aviso, o único jeito de descobrir é clicar em "Tudo"
  // e ver o mapa dobrar. A lista já era honesta ("4.841 de 11.428"); o mapa não era.
  const ocultosPeriodo = useMemo(() => {
    if (periodo === 'tudo') return 0
    return orcPontos.reduce((n, p) => n + (
      (!vendedorSel || (p.vendedor || '—') === vendedorSel) &&
      passaFiltro(p.vendido, p.total) &&
      passaVisita(p) &&
      (!ufSel || ufKey(p.uf) === ufSel) &&
      !passaPeriodo(p.data_recente) ? 1 : 0), 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcPontos, vendedorSel, vendFiltro, visitaFiltro, ufSel, periodo, marc])

  // Soma por ESTADO do que está no mapa. 1 valor por cliente: orçamento mais recente
  // (ou, se já comprou, a soma das vendas dele) — mesmo valor que decide ⭐/💎 no pino.
  const porUF = useMemo(() => {
    const m = new Map<string, { uf: string; n: number; total: number }>()
    for (const p of orcBase) {
      const k = ufKey(p.uf)
      const e = m.get(k) ?? { uf: k, n: 0, total: 0 }
      e.n++
      e.total += p.total || 0
      m.set(k, e)
    }
    return [...m.values()].sort((a, b) => b.total - a.total || b.n - a.n)
  }, [orcBase])
  const ufMaior = porUF[0]?.total || 1
  const ufSomaGeral = useMemo(() => porUF.reduce((s, u) => s + u.total, 0), [porUF])

  // Autocomplete de CIDADES: índice de cidades distintas (dos orçamentos) + contagem.
  // Respeita o PERÍODO — senão sugere "Goiânia · 33 clientes" e o mapa mostra 4.
  // (Não sai de orcBase porque orcBase já filtra pela busca: seria circular.)
  const cidadesIndex = useMemo(() => {
    const m = new Map<string, { cidade: string; uf: string; n: number }>()
    for (const p of orcPontos) {
      if (!p.cidade || !passaPeriodo(p.data_recente)) continue
      const key = (p.cidade + '|' + (p.uf || '')).toLowerCase()
      const e = m.get(key)
      if (e) e.n++
      else m.set(key, { cidade: p.cidade, uf: p.uf || '', n: 1 })
    }
    return [...m.values()]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orcPontos, periodo])

  // Sugestões conforme digita: "começa com" primeiro, depois mais clientes. Top 8.
  const sugestoesCidade = useMemo(() => {
    const q = normTxt(busca)
    if (q.length < 2) return []
    return cidadesIndex
      .filter(c => normTxt(c.cidade + ' ' + c.uf).includes(q))
      .sort((a, b) => {
        const sa = normTxt(a.cidade).startsWith(q) ? 0 : 1
        const sb = normTxt(b.cidade).startsWith(q) ? 0 : 1
        return sa - sb || b.n - a.n
      })
      .slice(0, 8)
  }, [busca, cidadesIndex])

  // pontos dentro do raio (a partir do centro), ordenados por distância
  const noRaio = useMemo(() => {
    if (!centro) return [] as Array<OrcamentoPonto & { dist: number }>
    return orcFiltrados
      .map(p => ({ ...p, dist: distKm(centro.lat, centro.lng, p.lat, p.lng) }))
      .filter(p => p.dist <= raioKm)
      .sort((a, b) => a.dist - b.dist)
  }, [centro, raioKm, orcFiltrados])

  // legenda orçamentos (por idade + vendido)
  const orcStats = useMemo(() => {
    let verde = 0, vermelho = 0, cinza = 0, vendido = 0, estrela = 0, diamante = 0
    for (const p of orcFiltrados) {
      if (p.vendido) { vendido++; continue }
      const f = formaValor(p.total, p.vendido)
      if (f === 'diamante') diamante++; else if (f === 'estrela') estrela++
      const c = corIdade(p.data_recente)
      if (c === VERDE) verde++; else if (c === VERMELHO) vermelho++; else cinza++
    }
    return { verde, vermelho, cinza, vendido, estrela, diamante }
  }, [orcFiltrados])

  // lista (tabela) filtrada
  const listaFiltrada = useMemo(() => {
    return lista.filter(r =>
      passaFiltro(r.vendido, r.total) &&
      passaPeriodo(r.data_emissao) &&
      (!ufSel || ufKey(r.uf) === ufSel) &&
      (!termo || [r.numero, r.cliente, r.equipamento, r.cidade, r.uf]
        .some(x => (x || '').toLowerCase().includes(termo)))
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lista, termo, vendFiltro, periodo, ufSel])

  // "1 linha por cliente". A lista é de ORÇAMENTOS — o mesmo cliente aparece uma vez
  // por proposta, e quem tem quatro propostas ocupa quatro linhas. Está certo pro
  // que a tela é, mas quem quer olhar carteira precisa do outro corte.
  const listaPorCliente = useMemo<LinhaLista[]>(() => {
    const grupos = new Map<string, LinhaLista>()
    // Nome normalizado + UF: só nome fundiria homônimos de estados diferentes.
    const chave = (r: OrcamentoLinha) => `${normTxt(r.cliente)}|${ufKey(r.uf)}`
    // O "mais recente" manda em cliente/cidade/equipamento/vendedor — grafia velha
    // do nome não pode ganhar da atual.
    const maisNovo = (a: string | null, b: string | null) => (a || '') >= (b || '')
    for (const r of listaFiltrada) {
      const k = chave(r)
      const g = grupos.get(k)
      if (!g) {
        grupos.set(k, { ...r, n_orc: 1, numeros: r.numero || '' })
        continue
      }
      g.n_orc++
      if (r.numero) g.numeros = g.numeros ? `${g.numeros}, ${r.numero}` : r.numero
      g.total = (g.total || 0) + (r.total || 0)
      g.vendido = g.vendido || r.vendido
      if (g.lat == null && r.lat != null) { g.lat = r.lat; g.lng = r.lng }
      if (maisNovo(r.data_emissao, g.data_emissao)) {
        g.data_emissao = r.data_emissao
        g.cliente = r.cliente
        g.cidade = r.cidade
        g.uf = r.uf
        g.equipamento = r.equipamento
      }
      // Vendedor: o do mais recente QUE TEM — 811 orçamentos legados vêm sem, e
      // sem esta ressalva o mais recente vazio apagaria o nome que existia.
      if (r.vendedor && (!g.vendedor || maisNovo(r.data_emissao, g.data_emissao))) g.vendedor = r.vendedor
    }
    for (const g of grupos.values()) {
      if (g.n_orc > 1) g.equipamento = `${g.n_orc} orçamentos · último: ${g.equipamento || '—'}`
    }
    return [...grupos.values()]
  }, [listaFiltrada])

  const baseLista: LinhaLista[] = porCliente
    ? listaPorCliente
    : listaFiltrada.map(r => ({ ...r, n_orc: 1, numeros: r.numero || '' }))

  // lista ordenada (clique no header)
  const sortedLista = useMemo(() => {
    const arr = [...baseLista]
    const dir = sortDir === 'asc' ? 1 : -1
    const txt = (s: string | null) => (s || '').toLowerCase()
    arr.sort((a, b) => {
      switch (sortKey) {
        case 'total': return ((a.total ?? -1) - (b.total ?? -1)) * dir
        case 'data': return txt(a.data_emissao) < txt(b.data_emissao) ? -dir : txt(a.data_emissao) > txt(b.data_emissao) ? dir : 0
        case 'numero': return txt(a.numero).localeCompare(txt(b.numero)) * dir
        case 'cidade': return (txt(a.cidade) + a.uf).localeCompare(txt(b.cidade) + b.uf) * dir
        case 'vendido': return ((a.vendido ? 1 : 0) - (b.vendido ? 1 : 0)) * dir
        default: return txt(a.cliente).localeCompare(txt(b.cliente)) * dir
      }
    })
    return arr
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseLista, sortKey, sortDir])

  const somaTotal = useMemo(() => sortedLista.reduce((s, r) => s + (r.total || 0), 0), [sortedLista])

  function ordenarPor(k: typeof sortKey) {
    if (sortKey === k) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'data' || k === 'total' ? 'desc' : 'asc') }
  }

  // lookup chave -> {cliente, telefone} (o clique no botão do popup usa isso)
  useEffect(() => {
    const m = new Map<string, { cliente: string | null; telefone: string | null }>()
    for (const p of orcPontos) m.set(chaveMarc(p.telefone, p.fone, p.cliente), { cliente: p.cliente, telefone: p.telefone || p.fone })
    pontoInfoRef.current = m
  }, [orcPontos])

  // ao abrir o modal, preenche o form com a marcação existente (se houver)
  useEffect(() => {
    if (!marcarAlvo) return
    const ex = marc[marcarAlvo.chave]
    setFormVisitado(ex?.visitado ?? true)
    setFormNota(ex?.nota ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [marcarAlvo])

  function salvarMarcacao() {
    if (!marcarAlvo) return
    const ex = marc[marcarAlvo.chave]
    salvarMarc.mutate({
      chave: marcarAlvo.chave,
      telefone: marcarAlvo.telefone,
      cliente: marcarAlvo.cliente,
      visitado: formVisitado,
      // mantém a data original se já estava visitado; senão o hook carimba agora
      visitado_em: formVisitado && ex?.visitado ? ex.visitado_em : null,
      nota: formNota.trim() || null,
      autor: profile?.display_name || profile?.email || null,
    }, { onSuccess: () => setMarcarAlvo(null) })
  }

  // ── viagem: dados derivados ───────────────────────────────────────────────
  const kCoord = (lat: number, lng: number) => `${lat.toFixed(5)},${lng.toFixed(5)}`

  // Índice coordenada -> clientes ali. É o que permite escolher UM entre os
  // sobrepostos (§6) — sem isso só dá pra clicar em quem o Leaflet pintou por cima.
  //
  // ⚠️ Sai de orcFiltrados, NÃO de orcPontos: este índice alimenta o popup do modo
  // viagem, e com a base crua ele oferecia (e adicionava à rota) clientes que não
  // estão desenhados no mapa — "36 clientes neste ponto" onde havia 7 pinos. Mesma
  // regra do `porCoord` dos vizinhos, que já respeitava os filtros.
  const pontosPorCoord = useMemo(() => {
    const m = new Map<string, OrcamentoPonto[]>()
    for (const p of orcFiltrados) {
      const k = kCoord(p.lat, p.lng)
      if (!m.has(k)) m.set(k, [])
      m.get(k)!.push(p)
    }
    return m
  }, [orcFiltrados])

  // Este continua na base CRUA de propósito: é o resolvedor de cli_key, e uma
  // viagem SALVA precisa reabrir com todos os clientes dela mesmo que o filtro
  // atual da tela não os mostre.
  const pontoPorKey = useMemo(() => {
    const m = new Map<string, OrcamentoPonto>()
    for (const p of orcPontos) m.set(p.cli_key, p)
    return m
  }, [orcPontos])

  const naViagem = useMemo(() => {
    const s = new Set<string>()
    for (const p of paradas) for (const c of p.clientes) s.add(c.cliKey)
    return s
  }, [paradas])

  // Programação: recalcula a cada mudança de parada/config/trecho. É barato
  // (puro, ~40 paradas) — o que tem debounce é a chamada de ROTA, não isto.
  const prog: Programacao = useMemo(
    () => programar(paradas, cfgViagem, trechos),
    [paradas, cfgViagem, trechos],
  )

  // Os dias SEGUEM as paradas enquanto ninguém mexer no campo "Dias". O
  // vendedor escolhe onde vai; quantos dias leva é resposta, não pergunta —
  // com 1 dia fixo, escolher o segundo cliente já derrubava o primeiro pra
  // "não coube" e a viagem que ele acabou de montar aparecia recusada.
  //
  // Sobe E desce: `diasNecessarios` devolve o MÍNIMO, então tirar uma parada
  // encolhe a viagem de volta em vez de deixar dia vazio pendurado.
  useEffect(() => {
    if (cfgViagem.diasManual) return
    if (!paradas.some(roteavel)) return
    const n = diasNecessarios(paradas, cfgViagem, trechos)
    // Só grava se mudou — senão o setState realimenta o efeito em loop.
    if (n !== cfgViagem.dias) setCfgViagem({ dias: n })
  }, [paradas, trechos, cfgViagem])

  function adicionarClientes(keys: string[]) {
    const novos = keys
      .map(k => pontoPorKey.get(k))
      .filter((x): x is OrcamentoPonto => !!x && !naViagem.has(x.cli_key))
    if (!novos.length) return
    const total = paradas.reduce((s, p) => s + p.clientes.length, 0)
    if (total + novos.length > MAX_PARADAS * 4) {
      window.alert(`Muitos clientes na viagem. Limite prático: ${MAX_PARADAS} paradas.`)
      return
    }
    // Reconstrói as paradas a partir dos clientes antigos + novos, preservando
    // ordem/tempo/travas do que já estava. Assim dois clientes da mesma cidade
    // caem na MESMA parada em vez de virar duas.
    const antigos: PontoMapa[] = []
    for (const p of paradas) for (const c of p.clientes) {
      const orig = pontoPorKey.get(c.cliKey)
      if (orig) antigos.push(orig as unknown as PontoMapa)
    }
    const recriadas = montarParadas([...antigos, ...(novos as unknown as PontoMapa[])])
    const antes = new Map(paradas.map(p => [p.id, p]))
    setParadas(recriadas.map(p => {
      const a = antes.get(p.id)
      return a
        ? { ...p, visitaMinutos: a.visitaMinutos, janelaInicio: a.janelaInicio, janelaFim: a.janelaFim,
            ordemTravada: a.ordemTravada, notas: a.notas, confirmacao: a.confirmacao }
        : p
    }))
    if (paradas.length + 1 >= MAX_PARADAS) {
      window.setTimeout(() => window.alert(`Você chegou em ${MAX_PARADAS} paradas — é o teto pra rota continuar útil.`), 0)
    }
  }

  function entrarNaViagem() {
    setModoViagem(true)
    setModoRaio(false)
    if (!cfgViagem.nome) setCfgViagem({ nome: `Viagem ${new Date().toLocaleDateString('pt-BR')}` })
  }

  // `/mapa-visitas?viagem=ID` — é como a página Organização de viagem manda o
  // vendedor de volta pro planejador com a viagem já aberta. Sem isto o botão
  // "Abrir no planejador" navegava e não acontecia nada.
  // Limpa o parâmetro depois: um F5 não pode reabrir por cima do que ele mexeu.
  const [params, setParams] = useSearchParams()
  useEffect(() => {
    const id = params.get('viagem')
    if (!id) return
    entrarNaViagem()
    setCarregarId(id)
    const p = new URLSearchParams(params)
    p.delete('viagem')
    setParams(p, { replace: true })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params])
  function novaViagem() {
    if (paradas.length && !window.confirm('Começar uma viagem em branco? O que está no painel some se não estiver salvo.')) return
    setCfgViagemState({ ...CONFIG_PADRAO, nome: `Viagem ${new Date().toLocaleDateString('pt-BR')}` })
    setParadas([])
    setTrechos(new Map())
    geometriasRef.current = []
    setGeoTrechos(new Map())
    setProvedorRota(null)
    setViagemId(null)
    setViagemStatus('rascunho')
    setViagemSalvaEm(null)
  }

  function sairDaViagem() {
    setModoViagem(false)
    setViagemSheet(false)
    setEscolhendoOrigem(false)
  }

  /**
   * Calcula a rota REAL. Ordem: otimiza (se modo auto) → pede trechos ao
   * /api/rota (server-side, sem chave no front) → guarda os trechos.
   * Se a API cair, a programação continua saindo com estimativa por haversine.
   */
  const abortRotaRef = useRef<AbortController | null>(null)
  async function calcularRota() {
    const uteis = paradas.filter(roteavel)
    if (!uteis.length) return
    setCalculandoRota(true)
    abortRotaRef.current?.abort()          // cancela cálculo anterior (§23)
    const ac = new AbortController()
    abortRotaRef.current = ac
    try {
      let ordenadas = paradas
      if (cfgViagem.modo === 'otimizar') {
        ordenadas = otimizarOrdem(paradas, cfgViagem.origem, cfgViagem.retornarOrigem ? cfgViagem.origem : cfgViagem.destino)
        setParadas(ordenadas)
      }
      const seq = ordenadas.filter(roteavel)
      const pontos = [
        ...(cfgViagem.origem ? [{ lat: cfgViagem.origem.lat, lng: cfgViagem.origem.lng }] : []),
        ...seq.map(p => ({ lat: p.lat, lng: p.lng })),
        ...(cfgViagem.retornarOrigem && cfgViagem.origem ? [{ lat: cfgViagem.origem.lat, lng: cfgViagem.origem.lng }]
            : cfgViagem.destino ? [{ lat: cfgViagem.destino.lat, lng: cfgViagem.destino.lng }] : []),
      ]
      if (pontos.length < 2) { setCalculandoRota(false); return }

      const r = await fetch('/api/rota', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pontos }), signal: ac.signal,
      })
      const j = r.ok ? await r.json() : null
      if (!j || j.erro || !Array.isArray(j.trechos) || !j.trechos.length) {
        setProvedorRota('estimado')
        setTrechos(new Map())
        return
      }
      const m = new Map<string, Trecho>()
      for (const t of j.trechos as Array<{ de: number; para: number; metros: number; segundos: number }>) {
        const a = pontos[t.de], b = pontos[t.para]
        if (!a || !b) continue
        m.set(chaveTrecho(a, b), { metros: t.metros, segundos: t.segundos, estimado: false })
      }
      setTrechos(m)
      setProvedorRota(j.provedor || 'osrm')
      if (Array.isArray(j.geometrias)) {
        geometriasRef.current = j.geometrias
        // geometrias[i] é a perna pontos[i] -> pontos[i+1] (contrato de api/rota.ts).
        const g = new Map<string, Array<[number, number]>>()
        for (let i = 0; i < j.geometrias.length; i++) {
          const de = pontos[i], para = pontos[i + 1]
          const linha = j.geometrias[i]
          if (!de || !para || !Array.isArray(linha) || linha.length < 2) continue
          g.set(chaveTrecho(de, para), linha)
        }
        setGeoTrechos(g)
      }
    } catch (e) {
      if ((e as Error)?.name !== 'AbortError') {
        setProvedorRota('estimado')
        setTrechos(new Map())
      }
    } finally {
      setCalculandoRota(false)
    }
  }
  const geometriasRef = useRef<Array<Array<[number, number]>>>([])
  /**
   * Mesma geometria do ref acima, mas chaveada por trecho (`chaveTrecho`) — é o
   * que permite desenhar CADA perna na cor do dia dela, em vez de um fio cinza
   * solto por cima de linhas retas coloridas. Estado e não ref de propósito: o
   * desenho precisa reagir quando a rota chega.
   */
  const [geoTrechos, setGeoTrechos] = useState<Map<string, Array<[number, number]>>>(new Map())

  // Recalcula sozinho quando muda o conjunto/ordem — com debounce, pra não
  // bater na API a cada clique (§10 e §23).
  const primeiroRenderViagem = useRef(true)
  useEffect(() => {
    if (!modoViagem) return
    if (primeiroRenderViagem.current) { primeiroRenderViagem.current = false; return }
    if (!paradas.length) { setTrechos(new Map()); geometriasRef.current = []; setGeoTrechos(new Map()); return }
    const t = window.setTimeout(() => { void calcularRota() }, 900)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoViagem, paradas.map(p => p.id).join('|'), cfgViagem.origem?.lat, cfgViagem.origem?.lng, cfgViagem.retornarOrigem])

  async function gerarPdfViagem() {
    setGerandoPdf(true)
    try {
      // O endpoint valida o JWT do Supabase (§22 — nada de rota aberta).
      const { data: sess } = await supabase.auth.getSession()
      const token = sess?.session?.access_token
      if (!token) throw new Error('sem sessão')

      const r = await fetch('/api/gerar-pdf-roteiro', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          roteiro: {
            cfg: cfgViagem,
            prog,
            // Chaveada por trecho, não por índice: parada que caiu em
            // "não coube" some do prog e desalinharia um array plano, fazendo o
            // PDF desenhar o traçado de uma perna no lugar de outra.
            geometrias: Object.fromEntries(geoTrechos),
            responsavel: profile?.display_name || profile?.email || null,
            provedor: provedorRota,
          },
          responseMode: 'url',
          nomeArquivo: `${(cfgViagem.nome || 'roteiro').replace(/[^\w\- ]+/g, '').trim() || 'roteiro'}.pdf`,
        }),
      })
      if (!r.ok) {
        const det = await r.json().catch(() => null)
        throw new Error(det?.error || String(r.status))
      }
      const j = await r.json()
      const url = j.url || (j.base64 ? `data:application/pdf;base64,${j.base64}` : null)
      if (!url) throw new Error('sem pdf')
      window.open(url, '_blank', 'noopener')
    } catch (e) {
      window.alert(
        `Não consegui gerar o PDF agora (${(e as Error).message}). `
        + 'O planejamento continua na tela e o que estava salvo não foi perdido.',
      )
    } finally {
      setGerandoPdf(false)
    }
  }

  async function salvarViagem() {
    if (!cfgViagem.nome.trim()) return
    setSalvandoViagem(true)
    try {
      // id presente = regrava por cima da mesma viagem (não cria uma cópia a cada salvar)
      const id = await salvarViagemMut.mutateAsync({
        id: viagemId ?? undefined, cfg: cfgViagem, paradas, programacao: prog, status: viagemStatus,
      })
      setViagemId(id)
      setViagemSalvaEm(new Date().toISOString())
    } catch (e) {
      // O hook valida os CHECK do banco antes do INSERT e joga mensagem em pt-BR
      // ("o fim da jornada precisa ser depois do início"). Mostrar ela, não um
      // genérico — senão o usuário não sabe o que corrigir.
      const msg = (e as Error)?.message || ''
      window.alert(
        msg && !/^\w+ error/i.test(msg)
          ? `${msg}\n\nNada foi perdido — corrija e salve de novo.`
          : 'Não consegui salvar a viagem. Nada foi perdido — tente de novo.',
      )
    } finally {
      setSalvandoViagem(false)
    }
  }

  // init do mapa (uma vez)
  useEffect(() => {
    if (mapRef.current || !divRef.current) return
    const map = L.map(divRef.current, { center: CENTRO_BR, zoom: 4, scrollWheelZoom: true, zoomControl: true })
    const mapa = L.tileLayer('https://{s}.google.com/vt/lyrs=m&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google Maps', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20,
    })
    const satelite = L.tileLayer('https://{s}.google.com/vt/lyrs=s,h&x={x}&y={y}&z={z}', {
      attribution: '&copy; Google Maps', subdomains: ['mt0', 'mt1', 'mt2', 'mt3'], maxZoom: 20,
    })
    mapa.addTo(map)
    L.control.layers({ 'Mapa': mapa, 'Satélite': satelite }, {}, { collapsed: false, position: 'bottomleft' }).addTo(map)
    // Pontos individuais em CANVAS: pinta milhares de círculos coloridos num único
    // canvas (rápido no celular, sem milhares de elementos no DOM). 1 ponto = 1 cliente,
    // cor pela idade/vendido. Sem cluster (o usuário quer ver os pontos, não as bolas).
    canvasRef.current = L.canvas({ padding: 0.5 })
    layerRef.current = L.layerGroup().addTo(map)
    raioLayerRef.current = L.layerGroup().addTo(map)
    // Camada PRÓPRIA da viagem. Separada de propósito: o effect dos pinos faz
    // clearLayers() em layerRef, e a rota não pode ser apagada junto.
    viagemLayerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      if (escolhendoOrigemRef.current) {
        acoesPopupRef.current.origem({ lat: e.latlng.lat, lng: e.latlng.lng })
        return
      }
      if (modoRaioRef.current) setCentro({ lat: e.latlng.lat, lng: e.latlng.lng })
    })
    // Botões dentro do popup (HTML string) → ações React.
    // Cada botão é ligado de forma INDEPENDENTE: antes havia um `if (!btn) return`
    // que abortava tudo quando o popup não tinha o botão de marcar visita.
    map.on('popupopen', (e: L.PopupEvent) => {
      const el = e.popup.getElement()
      if (!el) return

      const btnMarcar = el.querySelector('button[data-marcar]') as HTMLButtonElement | null
      if (btnMarcar) {
        btnMarcar.onclick = () => {
          acoesPopupRef.current.marcar(decodeURIComponent(btnMarcar.dataset.chave || ''))
          map.closePopup()
        }
      }

      el.querySelectorAll('button[data-viagem]').forEach(n => {
        const b = n as HTMLButtonElement
        if (b.disabled) return
        b.onclick = () => {
          acoesPopupRef.current.adicionar([decodeURIComponent(b.dataset.key || '')])
          map.closePopup()
        }
      })

      const btnTodos = el.querySelector('button[data-viagem-todos]') as HTMLButtonElement | null
      if (btnTodos) {
        btnTodos.onclick = () => {
          acoesPopupRef.current.adicionar(decodeURIComponent(btnTodos.dataset.keys || '').split('|').filter(Boolean))
          map.closePopup()
        }
      }

      // "outros clientes neste ponto" → abre o popup do vizinho
      el.querySelectorAll('button[data-ir]').forEach(n => {
        const b = n as HTMLButtonElement
        b.onclick = () => acoesPopupRef.current.irPara(decodeURIComponent(b.dataset.key || ''))
      })

      const btnMover = el.querySelector('button[data-mover]') as HTMLButtonElement | null
      if (btnMover) {
        btnMover.onclick = () => {
          acoesPopupRef.current.mover(decodeURIComponent(btnMover.dataset.key || ''))
          map.closePopup()
        }
      }
    })
    // Espaçamento dos empilhados é em PIXEL, então muda com o zoom.
    map.on('zoomend', () => {
      for (const it of espalhadosRef.current) it.m.setLatLng(posEspalhada(map, it.lat, it.lng, it.dx, it.dy, it.anelMax, it.limiteM))
    })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 0)
    setTimeout(() => map.invalidateSize(), 250)
    return () => {
      map.remove()
      mapRef.current = null
      layerRef.current = null
      raioLayerRef.current = null
      viagemLayerRef.current = null
    }
  }, [])

  // Mantém as ações do popup sempre atuais (o handler acima tem closure congelado).
  useEffect(() => {
    acoesPopupRef.current = {
      adicionar: (keys: string[]) => adicionarClientes(keys),
      marcar: (chave: string) => {
        const info = pontoInfoRef.current.get(chave)
        setMarcarAlvo({ chave, cliente: info?.cliente ?? null, telefone: info?.telefone ?? null })
      },
      origem: (c: { lat: number; lng: number }) => {
        setCfgViagem({ origem: { nome: `Ponto no mapa (${c.lat.toFixed(3)}, ${c.lng.toFixed(3)})`, lat: c.lat, lng: c.lng } })
        setEscolhendoOrigem(false)
      },
      irPara: (cliKey: string) => { marcadorPorKeyRef.current.get(cliKey)?.openPopup() },
      mover: (cliKey: string) => {
        const p = pontoPorKey.get(cliKey)
        if (!p) return
        // Começa de onde o pino ESTÁ DESENHADO (que pode estar espalhado no anel),
        // não da coordenada crua: o pino tem que nascer debaixo do cursor dele.
        const m = marcadorPorKeyRef.current.get(cliKey) as unknown as { getLatLng?: () => L.LatLng } | undefined
        const ll = m?.getLatLng?.()
        setMovendo({ cliKey, cliente: p.cliente, lat: ll?.lat ?? p.lat, lng: ll?.lng ?? p.lng })
      },
    }
  })

  // Pino arrastável + a camada dele. Fica FORA do layerRef de propósito: o effect
  // dos pinos faz clearLayers() a cada mudança de filtro e levaria o pino embora
  // no meio do arrasto.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (!moverLayerRef.current) moverLayerRef.current = L.layerGroup().addTo(map)
    const layer = moverLayerRef.current
    layer.clearLayers()
    if (!movendo) return
    const pino = L.marker([movendo.lat, movendo.lng], {
      draggable: true,
      zIndexOffset: 2000,
      icon: L.divIcon({
        className: '',
        html: '<div style="width:30px;height:30px;border-radius:50%;background:#2563eb;'
            + 'box-shadow:0 0 0 3px #fff,0 0 0 6px #2563eb,0 6px 14px rgba(0,0,0,.45);'
            + 'display:flex;align-items:center;justify-content:center;font-size:15px">📍</div>',
        iconSize: [30, 30], iconAnchor: [15, 15],
      }),
    })
    pino.on('dragend', () => {
      const ll = pino.getLatLng()
      setMovendo(m => (m ? { ...m, lat: ll.lat, lng: ll.lng } : m))
    })
    pino.addTo(layer)
    map.panTo([movendo.lat, movendo.lng])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movendo?.cliKey])

  // Celular: revalida o tamanho do mapa em resize/rotação (senão fica cinza/cortado).
  useEffect(() => {
    const onResize = () => mapRef.current?.invalidateSize()
    window.addEventListener('resize', onResize)
    window.addEventListener('orientationchange', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      window.removeEventListener('orientationchange', onResize)
    }
  }, [])

  // redesenha marcadores quando dados/filtro/camada mudam
  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    map.invalidateSize()
    layer.clearLayers()
    marcadorPorKeyRef.current.clear()   // os pinos antigos morreram no clearLayers
    const renderer = canvasRef.current ?? undefined
    const bounds: [number, number][] = []
    // Empilhados: quem divide coordenada é espalhado em anel em volta do ponto real.
    // O índice sai da ORDEM DESENHADA (respeita os filtros), então o que sobrar
    // sozinho na tela volta pro centro exato da cidade em vez de ficar deslocado.
    const espalhados: Espalhado[] = []
    // Quantos pinos (das DUAS camadas) caem em cada coordenada. Precisa ser o total
    // pra calibrar o anel externo — e pra visita e orçamento da mesma cidade não
    // sentarem um em cima do outro.
    const totalPorCoord = new Map<string, number>()
    const contar = (lat: number, lng: number) => {
      const k = kCoord(lat, lng)
      totalPorCoord.set(k, (totalPorCoord.get(k) ?? 0) + 1)
    }
    if (showVis) for (const v of visFiltradas) contar(v.lat as number, v.lng as number)
    if (showOrc) for (const p of orcFiltrados) contar(p.lat, p.lng)

    // Até onde a pilha pode abrir sem entrar na cidade do lado. Sem isto o teto é
    // só o RAIO_MAX_M, e onde as sedes são coladas (83 das 316 pilhas têm vizinha
    // a menos de 3 km) o leque atravessa a divisa. O limite é METADE do caminho
    // até a coordenada mais próxima — passou disso, o pino está mais perto da
    // outra cidade do que da própria.
    const limitePorCoord = new Map<string, number>()
    {
      const pts = [...totalPorCoord.keys()].map(k => {
        const [a, b] = k.split(',')
        return { k, lat: +a, lng: +b }
      })
      for (const p of pts) {
        if ((totalPorCoord.get(p.k) ?? 1) <= 1) continue
        let min = Infinity
        for (const q of pts) {
          if (q.k === p.k) continue
          // equirretangular: erro irrelevante nesta escala e MUITO mais barato
          const dx = (q.lng - p.lng) * Math.cos((p.lat * Math.PI) / 180)
          const dy = q.lat - p.lat
          const d2 = dx * dx + dy * dy
          if (d2 < min) min = d2
        }
        if (min < Infinity) limitePorCoord.set(p.k, (Math.sqrt(min) * 111_320) / 2)
      }
    }

    const usados = new Map<string, number>()
    /** Reserva o próximo slot livre da coordenada. [dx, dy, anelMax, limiteM]; [0,0,0,0] = ponto solto. */
    const proximo = (lat: number, lng: number): [number, number, number, number] => {
      const k = kCoord(lat, lng)
      const total = totalPorCoord.get(k) ?? 1
      if (total <= 1) return [0, 0, 0, 0]
      const i = usados.get(k) ?? 0
      usados.set(k, i + 1)
      const [dx, dy] = anelHex(i)
      return [dx, dy, anelDoIndice(total - 1), limitePorCoord.get(k) ?? RAIO_MAX_M]
    }
    if (showVis) {
      for (const v of visFiltradas) {
        const { nomes, isFollowUp } = resolverEtiquetas(v)
        const cor = isFollowUp ? corDoVendedor(v.vendedor_nome, vendedores) : CINZA
        const lat = v.lat as number, lng = v.lng as number
        const [dx, dy, anelMax, limiteM] = proximo(lat, lng)
        const m = L.circleMarker(posEspalhada(map, lat, lng, dx, dy, anelMax, limiteM), {
          renderer, radius: isFollowUp ? 6 : 5, fillColor: cor, color: '#fff', weight: 1, fillOpacity: isFollowUp ? 0.95 : 0.7,
        })
        // popup lazy: só monta o HTML quando abre
        m.bindPopup(() => popupVisita(v, isFollowUp, nomes))
        m.addTo(layer)
        if (dx || dy) espalhados.push({ m, lat, lng, dx, dy, anelMax, limiteM })
        bounds.push([lat, lng])
      }
    }
    if (showOrc) {
      // Vizinhos = os que estão VISÍVEIS no mesmo ponto (o popup lista só o que dá pra abrir).
      const porCoord = new Map<string, OrcamentoPonto[]>()
      for (const p of orcFiltrados) {
        const k = kCoord(p.lat, p.lng)
        const arr = porCoord.get(k)
        if (arr) arr.push(p); else porCoord.set(k, [p])
      }
      for (const p of orcFiltrados) {
        const mk = marc[chaveMarc(p.telefone, p.fone, p.cliente)]
        const visitado = !!mk?.visitado
        const forma = formaValor(p.total, p.vendido)
        const irmaos = porCoord.get(kCoord(p.lat, p.lng)) ?? [p]
        const [dx, dy, anelMax, limiteM] = proximo(p.lat, p.lng)
        const pos = posEspalhada(map, p.lat, p.lng, dx, dy, anelMax, limiteM)
        const m = forma
          // orçado de alto valor → estrela/diamante (marcador DOM, cor pela idade)
          ? L.marker(pos, { icon: iconeForma(forma, corOrcamento(p)) })
          : visitado
            // visitado (comum) → ponto único com ✓ dentro
            ? L.marker(pos, { icon: iconeVisitado(corOrcamento(p)) })
            // demais → círculo no canvas (rápido pra milhares de pontos)
            : L.circleMarker(pos, {
                renderer, radius: 5, fillColor: corOrcamento(p), color: '#fff', weight: 1, fillOpacity: 0.92,
              })
        m.bindPopup(() => {
          const ctx = ctxPopupRef.current
          return popupOrcamento(p, mk, undefined, ctx.ativo
            ? { vizinhos: ctx.porCoord.get(kCoord(p.lat, p.lng)) ?? [p], jaNaViagem: ctx.dentro }
            : undefined, irmaos)
        })
        m.addTo(layer)
        marcadorPorKeyRef.current.set(p.cli_key, m)
        if (dx || dy) espalhados.push({ m, lat: p.lat, lng: p.lng, dx, dy, anelMax, limiteM })
        // estrela/diamante visitado mantém a forma; ✓ vai num selinho no canto
        if (visitado && forma) {
          const selo = L.marker(pos, { icon: checkIcon(), interactive: false, zIndexOffset: 1000 })
          selo.addTo(layer)
          if (dx || dy) espalhados.push({ m: selo, lat: p.lat, lng: p.lng, dx, dy, anelMax, limiteM })
        }
        bounds.push([p.lat, p.lng])
      }
    }
    espalhadosRef.current = espalhados
    // No modo viagem o enquadramento é da ROTA — não pode ser roubado a cada
    // repintura de pino, senão o mapa pula toda vez que um filtro muda.
    if (bounds.length && !centro && !modoViagemRef.current) map.fitBounds(bounds, { padding: [50, 50], maxZoom: 10 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showVis, showOrc, visFiltradas, orcFiltrados, vendedores, byVendId, globId, marc])

  // Mantém o contexto do popup atual sem forçar repintura da camada de pinos.
  useEffect(() => {
    ctxPopupRef.current = { ativo: modoViagem, porCoord: pontosPorCoord, dentro: naViagem }
  }, [modoViagem, pontosPorCoord, naViagem])

  // §25.18 — confirmar uma localização tem que recalcular a rota.
  // Quando a RPC volta com coordenada nova (a v2 faz left join em
  // cliente_localizacao), as paradas já montadas são reposicionadas. Se a
  // precisão subiu de 'cidade'/'estado' pra real, a parada vira parada de CLIENTE.
  useEffect(() => {
    if (!modoViagem || !paradas.length) return
    let mudou = false
    const atualizadas = paradas.map(p => {
      const primeiro = p.clientes[0] ? pontoPorKey.get(p.clientes[0].cliKey) : undefined
      if (!primeiro) return p
      if (primeiro.lat === p.lat && primeiro.lng === p.lng && primeiro.precisao === p.precisao) return p
      mudou = true
      const virouReal = primeiro.precisao !== 'cidade' && primeiro.precisao !== 'estado'
      return {
        ...p,
        lat: primeiro.lat, lng: primeiro.lng, precisao: primeiro.precisao,
        tipo: virouReal && p.clientes.length === 1 ? ('cliente' as const) : p.tipo,
      }
    })
    if (mudou) {
      setParadas(atualizadas)
      setTrechos(new Map())          // trechos antigos apontam pra coordenada velha
      geometriasRef.current = []
    setGeoTrechos(new Map())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pontoPorKey, modoViagem])

  // ── camada da VIAGEM: pinos numerados + linha da rota ─────────────────────
  useEffect(() => {
    const map = mapRef.current
    const vl = viagemLayerRef.current
    if (!map || !vl) return
    vl.clearLayers()
    if (!modoViagem) return
    const pernoitando = cfgViagem.pernoitar !== false

    if (cfgViagem.origem) {
      L.marker([cfgViagem.origem.lat, cfgViagem.origem.lng], {
        icon: L.divIcon({
          className: 'viagem-origem',
          html: `<div style="width:26px;height:26px;border-radius:50%;background:#0f172a;border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:13px">🛫</div>`,
          iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
        }),
        zIndexOffset: 2000,
      }).bindPopup(`<b>Partida</b><br>${esc(cfgViagem.origem.nome)}`).addTo(vl)
    }

    // Trechos calculados de verdade viram linha cheia; o resto fica pontilhado
    // (§17: "trechos ainda não calculados em linha pontilhada").
    // `anterior` atravessa os dias: dormindo na estrada o dia 2 sai de onde o dia 1
    // parou. Reiniciar na origem a cada volta do laço era o que desenhava três
    // linhas saindo do mesmo ponto A, contradizendo o roteiro do painel.
    let anterior: [number, number] | null =
      cfgViagem.origem ? [cfgViagem.origem.lat, cfgViagem.origem.lng] : null
    for (const d of prog.dias) {
      const cor = corDoDia(d.dia)
      if (!pernoitando && cfgViagem.origem) anterior = [cfgViagem.origem.lat, cfgViagem.origem.lng]
      for (const pp of d.paradas) {
        const aqui: [number, number] = [pp.parada.lat, pp.parada.lng]
        if (anterior) {
          const real = pp.trechoAnterior && !pp.trechoAnterior.estimado
          // Traçado da estrada NA COR DO DIA. Sem geometria (rota ainda não
          // calculada, ou ponto fora da malha) cai na reta pontilhada — que aí
          // significa "ainda não sei o caminho", não "o caminho é reto".
          const via = geoTrechos.get(chaveTrecho(
            { lat: anterior[0], lng: anterior[1] },
            { lat: aqui[0], lng: aqui[1] },
          ))
          L.polyline(via && via.length > 1 ? via : [anterior, aqui], {
            color: cor, weight: real ? 3.5 : 2.5, opacity: 0.85,
            dashArray: via ? undefined : (real ? undefined : '7 7'),
          }).bindPopup(
            `<div style="font-size:12px"><b>${esc(pp.deQuem)}</b> → <b>${esc(nomeParada(pp.parada))}</b><br>`
            + `${pp.trechoAnterior ? `${(pp.trechoAnterior.metros / 1000).toFixed(0)} km · ${Math.round(pp.trechoAnterior.segundos / 60)} min` : '—'}`
            + `${real ? '' : ' <i>(estimado)</i>'}<br>`
            + `Saída ${String(Math.floor((pp.chegada - Math.round((pp.trechoAnterior?.segundos ?? 0) / 60)) / 60)).padStart(2, '0')}h · Chegada ${String(Math.floor(pp.chegada / 60)).padStart(2, '0')}:${String(pp.chegada % 60).padStart(2, '0')}</div>`,
          ).addTo(vl)
        }
        const aprox = pp.parada.precisao === 'cidade'
        L.marker(aqui, {
          icon: L.divIcon({
            className: 'viagem-parada',
            html: `<div style="position:relative;width:26px;height:26px">
              <div style="width:26px;height:26px;border-radius:50%;background:${cor};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;font-size:12px">${pp.ordem}</div>
              ${aprox ? `<div style="position:absolute;right:-4px;bottom:-3px;font-size:11px;line-height:1" title="Localização aproximada">⚠️</div>` : ''}
            </div>`,
            iconSize: [26, 26], iconAnchor: [13, 13], popupAnchor: [0, -14],
          }),
          zIndexOffset: 1500,
        }).bindPopup(
          `<div style="min-width:180px"><b>${pp.ordem}. ${esc(nomeParada(pp.parada))}</b><br>`
          + `<span style="color:#64748b;font-size:12px">Dia ${d.dia} · ${[esc(pp.parada.cidade), esc(pp.parada.uf)].filter(Boolean).join('/')}</span><br>`
          + `<span style="font-size:12px">Chega ${String(Math.floor(pp.chegada / 60)).padStart(2, '0')}:${String(pp.chegada % 60).padStart(2, '0')} · sai ${String(Math.floor(pp.saida / 60)).padStart(2, '0')}:${String(pp.saida % 60).padStart(2, '0')}</span>`
          + (aprox ? `<div style="margin-top:4px;font-size:11px;color:#d97706;font-weight:600">⚠️ Centro da cidade — não é o endereço</div>` : '')
          + `</div>`,
        ).addTo(vl)
        anterior = aqui
      }
      // Dia que dorme na estrada não volta pra base — só o último. Desenhar a
      // volta em todo dia mostrava um retorno que o roteiro não prevê.
      const ehUltimo = d.dia === prog.dias[prog.dias.length - 1]?.dia
      const volta = cfgViagem.retornarOrigem ? cfgViagem.origem : cfgViagem.destino
      if (volta && anterior && (!pernoitando || ehUltimo)) {
        const via = geoTrechos.get(chaveTrecho(
          { lat: anterior[0], lng: anterior[1] }, { lat: volta.lat, lng: volta.lng },
        ))
        L.polyline(via && via.length > 1 ? via : [anterior, [volta.lat, volta.lng]], {
          color: cor, weight: 2, opacity: 0.5, dashArray: via ? undefined : '4 8',
        }).addTo(vl)
      }
      // Marca onde o vendedor dorme: o roteiro sumia entre um dia e outro.
      if (pernoitando && !ehUltimo && anterior) {
        L.marker(anterior, {
          icon: L.divIcon({
            className: 'viagem-pernoite',
            html: `<div style="width:20px;height:20px;border-radius:50%;background:#fff;border:2px solid ${cor};box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:11px">🛏️</div>`,
            iconSize: [20, 20], iconAnchor: [-6, 14],
          }),
          zIndexOffset: 1400,
        }).bindPopup(`<b>Fim do dia ${d.dia}</b><br>Pernoite em ${esc(d.pernoiteEm ?? '')}`).addTo(vl)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modoViagem, prog, cfgViagem.origem, cfgViagem.destino, cfgViagem.retornarOrigem, cfgViagem.pernoitar, geoTrechos, provedorRota])

  // desenha círculo do raio
  useEffect(() => {
    const map = mapRef.current
    const rl = raioLayerRef.current
    if (!map || !rl) return
    rl.clearLayers()
    if (centro) {
      L.circle([centro.lat, centro.lng], {
        radius: raioKm * 1000, color: '#0ea5e9', weight: 2, fillColor: '#0ea5e9', fillOpacity: 0.08,
      }).addTo(rl)
      L.marker([centro.lat, centro.lng], { icon: pinCentro() }).addTo(rl)
      map.setView([centro.lat, centro.lng], map.getZoom() < 6 ? 6 : map.getZoom())
    }
  }, [centro, raioKm])

  // auto-geocoda visitas pendentes ao abrir (uma vez por montagem)
  useEffect(() => {
    if (autoGeoRef.current || isLoading || semCoord === 0 || geocodar.isPending) return
    autoGeoRef.current = true
    geocodar.mutate()
  }, [isLoading, semCoord, geocodar])

  // auto-geocoda as cidades dos orçamentos faltantes (em lotes, até preencher o cache)
  useEffect(() => {
    if (autoCidRef.current) return
    autoCidRef.current = true
    let cancelado = false
    ;(async () => {
      for (let i = 0; i < 10; i++) {
        const r = await fetch('/api/geocode-cidades', { method: 'POST' })
          .then(x => (x.ok ? x.json() : null))
          .catch(() => null)
        if (cancelado || !r) break
        if (r.atualizados > 0) await refetchOrc()
        if (!r.pendentes || r.pendentes <= 0 || r.atualizados === 0) break
      }
    })()
    return () => { cancelado = true }
  }, [refetchOrc])

  function focarPonto(p: OrcamentoPonto) {
    const map = mapRef.current
    if (!map) return
    map.setView([p.lat, p.lng], 11)
    // Abre o popup DO PINO (já espalhado, com os botões ligados). Só cai no popup
    // solto se o cliente estiver escondido pelos filtros da tela.
    const pino = marcadorPorKeyRef.current.get(p.cli_key)
    if (pino) { pino.openPopup(); return }
    L.popup().setLatLng([p.lat, p.lng]).setContent(popupOrcamento(p, marc[chaveMarc(p.telefone, p.fone, p.cliente)])).openOn(map)
  }

  function focarLinha(r: OrcamentoLinha) {
    if (r.lat == null || r.lng == null) return
    setShowLista(false)
    const map = mapRef.current
    if (!map) return
    map.setView([r.lat, r.lng], 11)
    const vb = r.vendido ? '✓ VENDIDO' : 'Orçado'
    L.popup().setLatLng([r.lat, r.lng]).setContent(
      `<div style="min-width:180px;font-family:inherit"><div style="font-weight:600;font-size:13px">${esc(r.cliente) || 'Sem nome'}</div>`
      + `<div style="font-size:12px;color:#64748b">${[esc(r.cidade), esc(r.uf)].filter(Boolean).join(' - ')}</div>`
      + `<div style="font-size:11px;color:#475569;margin-top:3px">🧾 ${esc(r.numero)} · ${dataBR(r.data_emissao)} · ${vb}</div>`
      + `<div style="font-size:12px;margin-top:3px">${esc(r.equipamento)}</div>`
      + `<div style="font-size:14px;font-weight:700;color:#10b981;margin-top:3px">${brl(r.total)}</div></div>`
    ).openOn(map)
  }

  function baixarCSV() {
    // Agrupado leva colunas próprias: "Numero" vira a lista de números e entra a
    // contagem — sem isso a planilha perde a informação de quantas propostas somaram.
    const head = porCliente
      ? ['Cliente', 'Vendedor', 'Orcamentos', 'Numeros', 'Ultimo', 'Ultimo equipamento', 'Cidade', 'UF', 'Total', 'Status']
      : ['Numero', 'Data', 'Cliente', 'Vendedor', 'Equipamento', 'Cidade', 'UF', 'Total', 'Status']
    const linhas = sortedLista.map(r => (porCliente
      ? [
          r.cliente || '', r.vendedor || '', r.n_orc, r.numeros || '', r.data_emissao || '',
          (r.equipamento || '').replace(/[\r\n]+/g, ' ').replace(/^\d+ orçamentos · último: /, ''),
          r.cidade || '', r.uf || '', r.total ?? '', r.vendido ? 'VENDIDO' : 'Orçado',
        ]
      : [
          r.numero || '', r.data_emissao || '', r.cliente || '', r.vendedor || '',
          (r.equipamento || '').replace(/[\r\n]+/g, ' '),
          r.cidade || '', r.uf || '', r.total ?? '', r.vendido ? 'VENDIDO' : 'Orçado',
        ]
    ).map(c => `"${String(c).replace(/"/g, '""')}"`).join(';'))
    const csv = '﻿' + [head.join(';'), ...linhas].join('\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `${porCliente ? 'clientes' : 'orcamentos'}-mapa-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const togglePill = (ativo: boolean) =>
    `h-9 px-3 rounded-md border text-[13px] font-semibold transition-colors ${ativo ? 'bg-accent-bg border-accent/40 text-accent' : 'bg-surface border-border text-ink-muted hover:text-ink'}`

  // Com 'todos' a soma mistura orçado em aberto + vendido, então o rótulo não pode dizer "Orçado".
  const rotuloValor = vendFiltro === 'vendidos' ? 'Vendido' : vendFiltro === 'todos' ? 'Valor' : 'Orçado'

  // Lista "por estado" — barra proporcional ao valor; clicar filtra o mapa naquele estado.
  const listaUF = (cls: string, aoEscolher?: () => void) => (
    <ul className={`space-y-0.5 ${cls}`}>
      {porUF.map(u => (
        <li key={u.uf}>
          <button
            onClick={() => { setUfSel(s => (s === u.uf ? '' : u.uf)); aoEscolher?.() }}
            title={`${u.uf === '—' ? 'Sem estado no cadastro' : u.uf} · ${u.n} cliente${u.n === 1 ? '' : 's'} · ${brl(u.total)}`}
            className={`relative w-full overflow-hidden rounded-md px-2 py-1.5 text-left transition-colors ${ufSel === u.uf ? 'bg-accent-bg ring-1 ring-accent/40' : 'hover:bg-surface-2 active:bg-surface-2'}`}
          >
            <span className="absolute inset-y-0 left-0 bg-accent/15 pointer-events-none"
                  style={{ width: `${Math.max(2, (u.total / ufMaior) * 100)}%` }} />
            <span className="relative flex items-center gap-2">
              <span className="w-7 shrink-0 text-[12px] font-bold text-ink">{u.uf}</span>
              <span className="text-[10px] tabular-nums text-ink-faint">{u.n}</span>
              <span className="ml-auto text-[12px] font-semibold tabular-nums text-ink">{brlCurto(u.total)}</span>
            </span>
          </button>
        </li>
      ))}
      {porUF.length === 0 && <li className="text-[12px] text-ink-muted px-2 py-1.5">Nenhum cliente no filtro atual.</li>}
    </ul>
  )

  return (
    // Volta a ser casca de altura fixa: a Organização de viagem virou página
    // própria (menu, abaixo de "Mapa de Visitas"), então não há mais nada
    // embaixo do mapa — e com a página rolando o mapa perdia altura à toa.
    <div className="relative flex flex-col overflow-hidden md:p-4 md:gap-3 h-[calc(100dvh-env(safe-area-inset-top)-env(safe-area-inset-bottom))]">
      {/* selo ✓ não pode capturar clique — senão não dá pra abrir o popup do pino visitado */}
      <style>{`.leaflet-marker-icon.marc-check{pointer-events:none!important}`}</style>
      {/* HEADER + TOOLBAR — só no desktop. No celular o mapa é tela cheia com filtros flutuantes. */}
      <div className="hidden md:flex flex-wrap items-center justify-between gap-2 md:gap-3 shrink-0">
        <div>
          <h1 className="text-[18px] md:text-[22px] font-semibold text-ink tracking-tight">Mapa de Visitas</h1>
          <p className="text-[13px] text-ink-muted">
            {ufsVisiveis.length > 0 && (
              <span className="mr-2 px-2 py-0.5 rounded-full bg-accent-bg border border-accent/30 text-accent text-[11px] font-bold"
                    title="Seu acesso é limitado a estes estados. Os outros nem chegam do servidor.">
                🗺️ {ufsVisiveis.join(' · ')}
              </span>
            )}
            {showOrc && <>{orcFiltrados.length} clientes com orçamento{orcStats.vendido > 0 && <> · <span className="text-blue-600 font-semibold">{orcStats.vendido} vendidos</span></>}</>}
            {showOrc && ocultosPeriodo > 0 && (
              <> · <button onClick={() => setPeriodo('tudo')} className="text-warning font-semibold hover:underline"
                    title={`${ocultosPeriodo} clientes estão fora da janela de ${rotuloPeriodo(periodo)}. Clique para ver o acervo inteiro.`}>
                +{ocultosPeriodo} fora do período ✕
              </button></>
            )}
            {showOrc && showVis && ' · '}
            {showVis && <>{visFiltradas.length} visitas{semCoord > 0 && <> · <span className="text-warning">{semCoord} sem localização</span></>}</>}
            {!showOrc && !showVis && 'Ligue uma camada pra ver os pontos'}
            {ufSel && (
              <> · <button onClick={() => setUfSel('')} className="text-accent font-semibold hover:underline" title="Mostrar o Brasil todo">
                {ufSel === '—' ? 'sem estado' : ufSel} ✕
              </button></>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full md:w-auto">
          <div className="relative w-full sm:w-auto">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-faint pointer-events-none">🔍</span>
            <input
              value={busca}
              onChange={e => { setBusca(e.target.value); setSugAberta(true) }}
              onFocus={() => setSugAberta(true)}
              onBlur={() => window.setTimeout(() => setSugAberta(false), 150)}
              onKeyDown={e => { if (e.key === 'Escape') setSugAberta(false) }}
              placeholder="Buscar cidade, cliente, telefone, Nº…"
              autoComplete="off"
              className="h-9 w-full sm:w-56 pl-8 pr-7 rounded-md bg-surface border border-border text-[13px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
            />
            {busca && (
              <button onClick={() => { setBusca(''); setSugAberta(false) }} className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink text-[13px]" title="Limpar busca">✕</button>
            )}
            {/* Autocomplete de cidades — aparece ao digitar; toca pra filtrar+zoom naquela cidade */}
            {sugAberta && sugestoesCidade.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-[1200] max-h-72 overflow-y-auto rounded-lg border border-border bg-surface shadow-lg py-1">
                <li className="px-3 py-1 text-[10px] uppercase tracking-wide text-ink-faint select-none">Cidades</li>
                {sugestoesCidade.map((c, i) => (
                  <li key={i}>
                    <button
                      onMouseDown={e => e.preventDefault()}
                      onClick={() => { setBusca(c.cidade); setSugAberta(false) }}
                      className="w-full text-left px-3 py-2.5 hover:bg-surface-2 active:bg-surface-2 flex items-center gap-2"
                    >
                      <span className="text-[13px] shrink-0">📍</span>
                      <span className="flex-1 truncate text-[13px] text-ink">{c.cidade}{c.uf ? ` - ${c.uf}` : ''}</span>
                      <span className="text-[11px] tabular-nums text-ink-faint shrink-0">{c.n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {/* No celular os controles ficam numa faixa que ROLA na horizontal (não empilham
              comendo a tela). md:contents remove o wrapper no desktop → volta ao flex-wrap original. */}
          <div className="flex items-center gap-2 w-full overflow-x-auto flex-nowrap md:contents pb-1 [&>*]:shrink-0">
          {/* filtro de período — o acervo tem 14 anos; sem ele a tela abre com tudo */}
          <div className="flex h-9 rounded-md border border-border overflow-hidden text-[12px] font-semibold"
               title="Período pela data do orçamento. Registros sem data aparecem sempre.">
            {PERIODO_LABEL.map(([v, label]) => (
              <button key={v} onClick={() => setPeriodo(v)}
                className={`px-2.5 transition-colors ${periodo === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* filtro vendido / orçado */}
          <div className="flex h-9 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
            {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos'], ['alto', '⭐ Alto valor'], ['diamante', '💎 ≥300 mil']] as [VendFiltro, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setVendFiltro(v)}
                className={`px-2.5 transition-colors ${vendFiltro === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          {/* filtro de visita */}
          <div className="flex h-9 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
            {([['todos', 'Todas'], ['visitados', '✅ Visitadas'], ['pendentes', '⏳ A visitar']] as [VisitaFiltro, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setVisitaFiltro(v)}
                className={`px-2.5 transition-colors ${visitaFiltro === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>
                {label}
              </button>
            ))}
          </div>
          <button className={togglePill(showOrc)} onClick={() => setShowOrc(v => !v)} title="Pinos a partir dos orçamentos">💰 Orçamentos</button>
          <button className={togglePill(showVis)} onClick={() => setShowVis(v => !v)} title="Visitas anotadas no WhatsApp">📍 Visitas</button>
          <button className={togglePill(modoRaio)} onClick={() => { setModoRaio(v => !v); if (modoRaio) setCentro(null) }} title="Filtrar clientes a partir de um ponto no mapa">🎯 Raio</button>
          <button className={togglePill(showLista)} onClick={() => setShowLista(true)} title="Lista de todos os orçamentos cadastrados">📋 Lista</button>
          <button
            onClick={() => (modoViagem ? sairDaViagem() : entrarNaViagem())}
            title="Montar roteiro de visitas escolhendo clientes pelo pino"
            className={`h-9 px-3 rounded-md border text-[13px] font-bold transition-colors ${modoViagem ? 'bg-blue-600 border-blue-600 text-white' : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'}`}
          >
            {/* Com paradas fora do modo (rascunho restaurado depois de um F5) o botão
                mostra a contagem — senão o trabalho fica invisível e parece perdido. */}
            🧭 {modoViagem || paradas.length > 0 ? `Viagem (${paradas.length})` : 'Planejar viagem'}
          </button>
          <select value={vendedorSel} onChange={e => setVendedorSel(e.target.value)} className="h-9 px-3 rounded-md bg-surface border border-border text-[13px] text-ink">
            <option value="">Todos os vendedores</option>
            {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          </div>
        </div>
      </div>

      {/* barra do modo raio */}
      {modoRaio && (
        <div className="shrink-0 rounded-md border border-sky-300 bg-sky-50 text-[12px] text-sky-900 px-3 py-2 hidden md:flex flex-wrap items-center gap-3">
          <span className="font-semibold">🎯 Modo raio:</span>
          {!centro ? <span>clique no mapa pra definir o ponto central (ex: Goiânia).</span>
            : <span>Centro definido · <b>{noRaio.length}</b> clientes em até {raioKm} km.</span>}
          <label className="flex items-center gap-1.5 ml-auto">
            Raio
            <input type="range" min={10} max={1000} step={10} value={raioKm} onChange={e => setRaioKm(Number(e.target.value))} className="w-32" />
            <input type="number" min={1} value={raioKm} onChange={e => setRaioKm(Math.max(1, Number(e.target.value) || 1))} className="h-7 w-16 px-1 rounded border border-border bg-surface text-ink" /> km
          </label>
          {centro && <button onClick={() => setCentro(null)} className="text-sky-700 underline">limpar ponto</button>}
        </div>
      )}

      {geocodar.data && showVis && (
        <div className="hidden md:block shrink-0 rounded-md border border-border bg-surface-2 text-[12px] text-ink-muted px-3 py-2">
          {geocodar.data.atualizados} localizado(s).
          {geocodar.data.falhas?.length ? ` Não achei: ${geocodar.data.falhas.join(', ')}.` : ''}
        </div>
      )}

      <div className="relative flex-1 min-h-0 md:flex md:gap-3">
        <div ref={divRef} className="absolute inset-0 md:static md:flex-1 md:rounded-xl md:border md:border-border overflow-hidden z-0" />
        {(isLoading || loadingOrc) && (
          <div className="absolute inset-0 flex items-center justify-center z-[400]"><PageLoading /></div>
        )}

        {/* ===== MOBILE: filtros flutuando SOBRE o mapa (tela cheia) ===== */}
        <div className="md:hidden absolute top-2 left-2 right-2 z-[1000] flex flex-col gap-2 pointer-events-none">
          <div className="relative pointer-events-auto">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-faint pointer-events-none">🔍</span>
            <input
              value={busca}
              onChange={e => { setBusca(e.target.value); setSugAberta(true) }}
              onFocus={() => setSugAberta(true)}
              onBlur={() => window.setTimeout(() => setSugAberta(false), 150)}
              onKeyDown={e => { if (e.key === 'Escape') setSugAberta(false) }}
              placeholder="Buscar cidade, cliente…"
              autoComplete="off"
              className="h-11 w-full pl-9 pr-9 rounded-xl bg-surface/95 backdrop-blur border border-border text-[15px] text-ink placeholder:text-ink-faint outline-none focus:border-accent shadow"
            />
            {busca && (
              <button onClick={() => { setBusca(''); setSugAberta(false) }} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-faint text-[16px]" title="Limpar">✕</button>
            )}
            {sugAberta && sugestoesCidade.length > 0 && (
              <ul className="absolute left-0 right-0 top-full mt-1 z-[1200] max-h-[50vh] overflow-y-auto rounded-xl border border-border bg-surface shadow-lg py-1">
                <li className="px-3 py-1 text-[10px] uppercase tracking-wide text-ink-faint select-none">Cidades</li>
                {sugestoesCidade.map((c, i) => (
                  <li key={i}>
                    <button onMouseDown={e => e.preventDefault()} onClick={() => { setBusca(c.cidade); setSugAberta(false) }} className="w-full text-left px-3 py-3 active:bg-surface-2 flex items-center gap-2">
                      <span className="text-[14px] shrink-0">📍</span>
                      <span className="flex-1 truncate text-[14px] text-ink">{c.cidade}{c.uf ? ` - ${c.uf}` : ''}</span>
                      <span className="text-[12px] tabular-nums text-ink-faint shrink-0">{c.n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto flex-nowrap [&>*]:shrink-0">
            <div className="flex h-9 rounded-lg overflow-hidden border border-border bg-surface/95 backdrop-blur text-[12px] font-semibold shadow"
                 title="Período pela data do orçamento. Registros sem data aparecem sempre.">
              {PERIODO_LABEL_CURTO.map(([v, label]) => (
                <button key={v} onClick={() => setPeriodo(v)} className={`px-3 ${periodo === v ? 'bg-accent text-white' : 'text-ink-muted'}`}>{label}</button>
              ))}
            </div>
            <div className="flex h-9 rounded-lg overflow-hidden border border-border bg-surface/95 backdrop-blur text-[12px] font-semibold shadow">
              {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos'], ['alto', '⭐ Alto valor'], ['diamante', '💎 ≥300 mil']] as [VendFiltro, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setVendFiltro(v)} className={`px-3 ${vendFiltro === v ? 'bg-accent text-white' : 'text-ink-muted'}`}>{label}</button>
              ))}
            </div>
            <div className="flex h-9 rounded-lg overflow-hidden border border-border bg-surface/95 backdrop-blur text-[12px] font-semibold shadow">
              {([['todos', 'Todas'], ['visitados', '✅'], ['pendentes', '⏳']] as [VisitaFiltro, string][]).map(([v, label]) => (
                <button key={v} onClick={() => setVisitaFiltro(v)} className={`px-3 ${visitaFiltro === v ? 'bg-accent text-white' : 'text-ink-muted'}`} title={v === 'visitados' ? 'Visitadas' : v === 'pendentes' ? 'A visitar' : 'Todas'}>{label}</button>
              ))}
            </div>
            <button onClick={() => { setModoRaio(v => !v); if (modoRaio) setCentro(null) }} className={`h-9 px-3 rounded-lg border text-[12px] font-semibold shadow ${modoRaio ? 'bg-accent text-white border-accent' : 'bg-surface/95 backdrop-blur border-border text-ink-muted'}`}>🎯 Raio</button>
            <button onClick={() => setShowVis(v => !v)} className={`h-9 px-3 rounded-lg border text-[12px] font-semibold shadow ${showVis ? 'bg-accent text-white border-accent' : 'bg-surface/95 backdrop-blur border-border text-ink-muted'}`}>📍 Visitas</button>
            <button onClick={() => setUfSheet(true)} className={`h-9 px-3 rounded-lg border text-[12px] font-semibold shadow ${ufSel ? 'bg-accent text-white border-accent' : 'bg-surface/95 backdrop-blur border-border text-ink-muted'}`}>🗺️ {ufSel || 'Estados'}</button>
            <button
              onClick={() => { if (modoViagem) { setViagemSheet(true) } else { entrarNaViagem(); setViagemSheet(true) } }}
              className={`h-9 px-3 rounded-lg border text-[12px] font-bold shadow ${modoViagem ? 'bg-blue-600 text-white border-blue-600' : 'bg-surface/95 backdrop-blur border-blue-300 text-blue-700'}`}
            >
              🧭 {modoViagem || paradas.length > 0 ? `Viagem ${paradas.length}` : 'Viagem'}
            </button>
          </div>
          {modoRaio && (
            <div className="pointer-events-auto flex items-center gap-2 rounded-lg bg-surface/95 backdrop-blur border border-border px-3 py-2 text-[12px] text-ink shadow">
              {!centro ? <span className="text-ink-muted">Toque no mapa pra centrar</span> : <span className="shrink-0"><b>{noRaio.length}</b> em {raioKm}km</span>}
              <input type="range" min={10} max={1000} step={10} value={raioKm} onChange={e => setRaioKm(Number(e.target.value))} className="flex-1 min-w-0" />
              {centro && <button onClick={() => setCentro(null)} className="text-accent shrink-0">limpar</button>}
            </div>
          )}
        </div>

        {/* ===== MOBILE: legenda flutuante (canto inferior esquerdo) ===== */}
        <div className="md:hidden absolute left-2 bottom-2 z-[1000] bg-surface/90 backdrop-blur rounded-lg border border-border px-2.5 py-2 text-[11px] shadow pointer-events-none">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VERDE }} /><span className="text-ink-muted">Até 1 mês</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.verde}</span></div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: VERMELHO }} /><span className="text-ink-muted">1–3 meses</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.vermelho}</span></div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CINZA_VELHO }} /><span className="text-ink-muted">+3 meses</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.cinza}</span></div>
            <div className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: AZUL_VENDIDO }} /><span className="text-ink-muted font-semibold">Vendido</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.vendido}</span></div>
            {(orcStats.estrela > 0 || orcStats.diamante > 0) && (
              <div className="mt-1 pt-1 border-t border-border flex flex-col gap-1">
                <div className="flex items-center gap-1.5"><span className="w-3 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('estrela', '#64748b', 13) }} /><span className="text-ink-muted">⭐ ≥ 100 mil</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.estrela}</span></div>
                <div className="flex items-center gap-1.5"><span className="w-3 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('diamante', '#64748b', 12) }} /><span className="text-ink-muted">💎 ≥ 300 mil</span><span className="ml-auto pl-2 tabular-nums text-ink-faint">{orcStats.diamante}</span></div>
              </div>
            )}
          </div>
        </div>

        {/* Desktop: no modo viagem o painel lateral vira a viagem (§4 do spec).
            A sidebar de legenda/estados volta inteira ao sair — nada é perdido. */}
        {modoViagem && (
          <div className="hidden md:flex w-[400px] shrink-0 rounded-xl border border-border bg-surface overflow-hidden">
            <PainelViagem
              cfg={cfgViagem} setCfg={setCfgViagem}
              paradas={paradas} setParadas={setParadas}
              prog={prog} trechos={trechos}
              calculando={calculandoRota}
              provedor={provedorRota}
              onCalcular={() => void calcularRota()}
              onSair={sairDaViagem}
              onFocar={pr => mapRef.current?.setView([pr.lat, pr.lng], 11)}
              onPedirOrigemNoMapa={() => setEscolhendoOrigem(true)}
              escolhendoOrigem={escolhendoOrigem}
              onSalvar={() => void salvarViagem()}
              salvando={salvandoViagem}
              salvoEm={viagemSalvaEm}
              onPDF={() => void gerarPdfViagem()}
              gerandoPdf={gerandoPdf}
              onConfirmarLocalizacao={setCorrigirLocal}
              viagemId={viagemId}
              status={viagemStatus}
              setStatus={setViagemStatus}
              onAbrirSalvas={() => setAbrirSalvas(true)}
              onNova={novaViagem}
              carregando={carregandoViagem}
            />
          </div>
        )}

        {/* sidebar (legenda / lista do raio) — só no desktop */}
        <div className={`${modoViagem ? 'hidden' : 'hidden md:block'} w-56 shrink-0 rounded-xl border border-border bg-surface p-3 overflow-y-auto`}>
          {modoRaio && centro ? (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">{noRaio.length} clientes em {raioKm} km</div>
              <ul className="space-y-1">
                {noRaio.map((p, i) => (
                  <li key={i}>
                    <button onClick={() => focarPonto(p)} className="w-full text-left rounded-md px-2 py-1.5 hover:bg-surface-2 transition-colors">
                      <div className="flex items-center gap-1.5">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: corOrcamento(p) }} />
                        <span className="text-[12px] text-ink truncate flex-1">{p.cliente || '—'}</span>
                        <span className="text-[11px] tabular-nums text-ink-faint">{p.dist.toFixed(0)}km</span>
                      </div>
                      <div className="text-[11px] text-ink-muted pl-4 truncate">{[p.cidade, p.uf].filter(Boolean).join(' - ')}{p.vendido && ' · ✓ vendido'}</div>
                    </button>
                  </li>
                ))}
                {noRaio.length === 0 && <li className="text-[12px] text-ink-muted">Nenhum cliente nesse raio.</li>}
              </ul>
            </div>
          ) : (
            <>
              {showOrc && (
                <div className="mb-3">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Orçamentos · idade</div>
                  <ul className="space-y-1.5">
                    <li className="flex items-center gap-2 text-[12px] text-ink"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: VERDE }} /><span className="truncate">Até 1 mês</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.verde}</span></li>
                    <li className="flex items-center gap-2 text-[12px] text-ink"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: VERMELHO }} /><span className="truncate">1 a 3 meses</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.vermelho}</span></li>
                    <li className="flex items-center gap-2 text-[12px] text-ink"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: CINZA_VELHO }} /><span className="truncate">+ de 3 meses</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.cinza}</span></li>
                    <li className="flex items-center gap-2 text-[12px] text-ink pt-1.5 mt-1 border-t border-border"><span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: AZUL_VENDIDO }} /><span className="truncate font-semibold">✓ Vendido</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.vendido}</span></li>
                  </ul>
                  {(orcStats.estrela > 0 || orcStats.diamante > 0) && (
                    <>
                      <div className="text-[11px] uppercase tracking-wide text-ink-faint mt-3 mb-2">Orçado · por valor</div>
                      <ul className="space-y-1.5">
                        <li className="flex items-center gap-2 text-[12px] text-ink"><span className="shrink-0 w-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('estrela', '#64748b', 16) }} /><span className="truncate">⭐ ≥ 100 mil</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.estrela}</span></li>
                        <li className="flex items-center gap-2 text-[12px] text-ink"><span className="shrink-0 w-4 flex justify-center" dangerouslySetInnerHTML={{ __html: svgForma('diamante', '#64748b', 15) }} /><span className="truncate">💎 ≥ 300 mil</span><span className="ml-auto tabular-nums text-ink-faint">{orcStats.diamante}</span></li>
                      </ul>
                    </>
                  )}
                  {vendasCount > 0 && (
                    <div className="text-[10px] text-ink-faint mt-1.5 leading-snug">
                      {orcStats.vendido} clientes vendidos · {vendasCount.toLocaleString('pt-BR')} vendas no total
                      <br />(1 pino por cliente — quem comprou +1x conta como 1)
                      {/* Sem esta linha o texto acima atribui à RECOMPRA uma diferença
                          que é do filtro de período — e a maior parte dela não é recompra. */}
                      {ocultosPeriodo > 0 && (
                        <><br /><span className="text-warning">
                          Fora da janela de {rotuloPeriodo(periodo)}: {ocultosPeriodo} clientes não entram nesta contagem.
                        </span></>
                      )}
                    </div>
                  )}

                  {/* ===== Soma por ESTADO (clique filtra o mapa) ===== */}
                  {porUF.length > 0 && (
                    <div className="mt-3 pt-3 border-t border-border">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-[11px] uppercase tracking-wide text-ink-faint">
                          {rotuloValor} · por estado
                        </span>
                        {ufSel && (
                          <button onClick={() => setUfSel('')} className="ml-auto text-[10px] font-semibold text-accent hover:underline">
                            limpar
                          </button>
                        )}
                      </div>
                      <div className="text-[10px] text-ink-faint mb-2 leading-snug"
                           title={'Soma dos pinos exibidos: 1 valor por cliente — o orçamento mais recente dele (ou a soma das vendas, se já comprou).'
                                  + (periodo !== 'tudo'
                                     ? ` O período filtra QUEM aparece, não o valor: cada cliente entra com o histórico completo dele. Não leia isto como "orçado nos últimos ${rotuloPeriodo(periodo)}".`
                                     : '')}>
                        Total <b className="text-ink-muted tabular-nums">{brl(ufSomaGeral)}</b> · 1 valor por cliente
                        {periodo !== 'tudo' && <span className="text-warning"> · dos clientes no período</span>}
                      </div>
                      {listaUF('max-h-[42vh] overflow-y-auto -mx-1 px-1')}
                    </div>
                  )}
                </div>
              )}
              {showVis && vendedores.length > 1 && (
                <div className={showOrc ? 'pt-3 border-t border-border' : ''}>
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint mb-2">Visitas · em follow-up</div>
                  <ul className="space-y-1.5">
                    {vendedores.filter(v => visFiltradas.some(x => resolverEtiquetas(x).isFollowUp && (x.vendedor_nome || '—') === v)).map(v => (
                      <li key={v} className="flex items-center gap-2 text-[12px] text-ink">
                        <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: corDoVendedor(v, vendedores) }} />
                        <span className="truncate">{v}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      </div>


      {/* Celular: folha "por estado" (mesma soma da sidebar do desktop) */}
      {ufSheet && (
        <div className="md:hidden fixed inset-0 z-[1300] bg-black/40 flex items-end" onClick={() => setUfSheet(false)}>
          <div className="bg-surface w-full rounded-t-2xl border-t border-border p-4 pb-safe max-h-[78vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-2">
              <div className="text-[15px] font-semibold text-ink">{rotuloValor} por estado</div>
              {ufSel && <button onClick={() => { setUfSel(''); setUfSheet(false) }} className="ml-auto text-[13px] font-semibold text-accent">Brasil todo</button>}
              <button onClick={() => setUfSheet(false)} className={`h-8 w-8 rounded-md text-ink-muted ${ufSel ? '' : 'ml-auto'}`}>✕</button>
            </div>
            <div className="text-[11px] text-ink-faint mt-1 mb-2 leading-snug">
              Total <b className="text-ink-muted tabular-nums">{brl(ufSomaGeral)}</b> · 1 valor por cliente · toque num estado pra filtrar o mapa
            </div>
            {listaUF('flex-1 overflow-y-auto -mx-1 px-1', () => setUfSheet(false))}
          </div>
        </div>
      )}

      {/* Celular: barra da viagem quando a folha está fechada (§4 — expandir/recolher) */}
      {modoViagem && !viagemSheet && (
        <button
          onClick={() => setViagemSheet(true)}
          className="md:hidden fixed left-2 right-2 bottom-2 z-[1250] h-12 rounded-xl bg-blue-600 text-white shadow-lg flex items-center gap-2 px-3"
        >
          <span className="text-[16px]">🧭</span>
          <span className="text-[13px] font-bold">{paradas.length} parada(s)</span>
          <span className="text-[11px] opacity-90 tabular-nums">
            {prog.dias.length} dia(s) · {(prog.totalMetros / 1000).toFixed(0)} km{prog.estimado ? ' ~' : ''}
          </span>
          <span className="ml-auto text-[12px] font-semibold">abrir ▲</span>
        </button>
      )}

      {/* Celular: folha do planejamento */}
      {modoViagem && viagemSheet && (
        <div className="md:hidden fixed inset-0 z-[1300] bg-black/40 flex items-end" onClick={() => setViagemSheet(false)}>
          <div className="bg-surface w-full rounded-t-2xl border-t border-border h-[82vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="shrink-0 flex justify-center pt-2 pb-1" onClick={() => setViagemSheet(false)}>
              <span className="h-1 w-10 rounded-full bg-border" />
            </div>
            <div className="flex-1 min-h-0">
              <PainelViagem
                cfg={cfgViagem} setCfg={setCfgViagem}
                paradas={paradas} setParadas={setParadas}
                prog={prog} trechos={trechos}
                calculando={calculandoRota}
                provedor={provedorRota}
                onCalcular={() => void calcularRota()}
                onSair={sairDaViagem}
                onFocar={pr => { setViagemSheet(false); mapRef.current?.setView([pr.lat, pr.lng], 11) }}
                onPedirOrigemNoMapa={() => { setEscolhendoOrigem(true); setViagemSheet(false) }}
                escolhendoOrigem={escolhendoOrigem}
                onSalvar={() => void salvarViagem()}
                salvando={salvandoViagem}
                salvoEm={viagemSalvaEm}
                onPDF={() => void gerarPdfViagem()}
                gerandoPdf={gerandoPdf}
                onConfirmarLocalizacao={p => { setCorrigirLocal(p); setViagemSheet(false) }}
                viagemId={viagemId}
                status={viagemStatus}
                setStatus={setViagemStatus}
                onAbrirSalvas={() => { setAbrirSalvas(true); setViagemSheet(false) }}
                onNova={novaViagem}
                carregando={carregandoViagem}
              />
            </div>
          </div>
        </div>
      )}

      {/* Aviso flutuante enquanto escolhe a origem clicando no mapa */}
      {escolhendoOrigem && (
        <div className="fixed left-1/2 -translate-x-1/2 top-20 md:top-28 z-[1400] rounded-full bg-slate-900 text-white text-[12.5px] font-semibold px-4 py-2 shadow-lg flex items-center gap-2">
          Clique no mapa pra marcar o ponto de partida
          <button onClick={() => setEscolhendoOrigem(false)} className="opacity-70 hover:opacity-100">✕</button>
        </div>
      )}

      {/* Modal: viagens salvas (§19 — abrir, duplicar, excluir) */}
      {abrirSalvas && (
        <ViagensSalvas
          viagemAtual={viagemId}
          onFechar={() => setAbrirSalvas(false)}
          onAbrir={id => setCarregarId(id)}
        />
      )}

      {/* Modal: corrigir localização de um cliente (grava em cliente_localizacao) */}
      {corrigirLocal && (
        <CorrigirLocalModal
          parada={corrigirLocal}
          onFechar={() => setCorrigirLocal(null)}
          onSalvar={async (lat, lng, endereco) => {
            const keys = corrigirLocal.clientes.map(c => c.cliKey)
            await Promise.all(keys.map(k => salvarLocalMut.mutateAsync({
              cliKey: k, lat, lng, precisao: 'confirmada', fonte: 'manual', endereco,
            })))
            setCorrigirLocal(null)
            // a RPC faz left join em cliente_localizacao: o pino se move sozinho
            await refetchOrc()
          }}
        />
      )}

      {/* Barra de MOVER PONTO — nada é gravado enquanto ela estiver aberta. */}
      {movendo && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-4 z-[1200] w-[min(560px,calc(100vw-1.5rem))]
                        bg-surface border border-accent/40 rounded-xl shadow-2xl p-3 flex flex-col gap-2">
          <div className="flex items-start gap-2">
            <span className="text-[18px] leading-none mt-0.5">📍</span>
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-semibold text-ink truncate">{movendo.cliente || 'Cliente'}</div>
              <div className="text-[11.5px] text-ink-muted">
                Arraste o pino azul até o lugar certo e clique em <b className="text-ink">Salvar aqui</b>.
                Nada é gravado antes disso.
              </div>
              <div className="text-[11px] text-ink-faint tabular-nums mt-0.5">
                {movendo.lat.toFixed(5)}, {movendo.lng.toFixed(5)}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={() => setMovendo(null)}
              className="h-9 px-3 rounded-md border border-border bg-surface text-ink-muted hover:text-ink text-[13px] font-semibold">
              Cancelar
            </button>
            <button
              disabled={salvarLocalMut.isPending}
              onClick={async () => {
                try {
                  await salvarLocalMut.mutateAsync({
                    cliKey: movendo.cliKey,
                    lat: movendo.lat,
                    lng: movendo.lng,
                    precisao: 'confirmada',
                    fonte: 'arrastado no mapa',
                  })
                  setMovendo(null)
                } catch (e) {
                  window.alert(`Não consegui salvar a localização.\n\n${(e as Error)?.message || ''}`)
                }
              }}
              className="h-9 flex-1 rounded-md bg-accent-bg border border-accent/40 text-accent text-[13px] font-bold disabled:opacity-60">
              {salvarLocalMut.isPending ? 'Salvando…' : '✅ Salvar aqui'}
            </button>
          </div>
        </div>
      )}

      {/* Overlay: lista (tabela) */}
      {showLista && (
        <div className="fixed inset-0 z-[1000] bg-black/40 flex items-center justify-center p-4" onClick={() => setShowLista(false)}>
          <div className="bg-surface rounded-xl border border-border w-full max-w-[1200px] max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
            <div className="flex flex-wrap items-center gap-2 md:gap-3 p-3 border-b border-border shrink-0">
              <h2 className="text-[16px] font-semibold text-ink">{porCliente ? 'Clientes' : 'Orçamentos cadastrados'}</h2>
              <span className="text-[12px] text-ink-muted">
                {porCliente
                  ? `${sortedLista.length} clientes · ${listaFiltrada.length} orçamentos`
                  : `${sortedLista.length} de ${lista.length}`}
              </span>
              {ufSel && (
                <button onClick={() => setUfSel('')} className="text-[12px] font-semibold text-accent hover:underline" title="Tirar o filtro de estado">
                  {ufSel === '—' ? 'sem estado' : ufSel} ✕
                </button>
              )}
              <div className="relative ml-2">
                <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar…" className="h-8 w-52 px-2 rounded-md bg-surface-2 border border-border text-[13px] text-ink outline-none focus:border-accent" />
              </div>
              <div className="flex h-8 rounded-md border border-border overflow-hidden text-[12px] font-semibold"
                   title="Período pela data do orçamento. Registros sem data aparecem sempre.">
                {PERIODO_LABEL.map(([v, label]) => (
                  <button key={v} onClick={() => setPeriodo(v)} className={`px-2.5 ${periodo === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>{label}</button>
                ))}
              </div>
              <div className="flex h-8 rounded-md border border-border overflow-hidden text-[12px] font-semibold">
                {([['todos', 'Todos'], ['orcados', 'Só orçados'], ['vendidos', 'Vendidos'], ['alto', '⭐ Alto valor'], ['diamante', '💎 ≥300 mil']] as [VendFiltro, string][]).map(([v, label]) => (
                  <button key={v} onClick={() => setVendFiltro(v)} className={`px-2.5 ${vendFiltro === v ? 'bg-accent-bg text-accent' : 'bg-surface text-ink-muted hover:text-ink'}`}>{label}</button>
                ))}
              </div>
              <button
                onClick={() => setPorCliente(v => !v)}
                title="Junta as propostas do mesmo cliente numa linha só, somando os valores"
                className={`h-8 px-3 rounded-md border text-[12px] font-semibold ${porCliente
                  ? 'bg-accent-bg border-accent/40 text-accent'
                  : 'bg-surface border-border text-ink-muted hover:text-ink'}`}>
                👤 1 linha por cliente
              </button>
              <button onClick={baixarCSV} className="h-8 px-3 rounded-md bg-accent-bg border border-accent/30 text-accent text-[12px] font-semibold ml-auto">⬇ CSV</button>
              <button onClick={() => setShowLista(false)} className="h-8 w-8 rounded-md hover:bg-surface-2 text-ink-muted">✕</button>
            </div>
            <div className="overflow-auto flex-1">
              <table className="w-full text-[12px] table-fixed">
                <colgroup>
                  <col style={{ width: '92px' }} /><col style={{ width: '88px' }} /><col style={{ width: '190px' }} />
                  <col /><col style={{ width: '150px' }} /><col style={{ width: '108px' }} /><col style={{ width: '92px' }} />
                </colgroup>
                <thead className="sticky top-0 z-10 bg-surface-2 text-ink-muted">
                  <tr className="text-left">
                    {([['numero', porCliente ? 'Nºs' : 'Nº', ''], ['data', porCliente ? 'Último' : 'Data', ''], ['cliente', 'Cliente', ''], [null, porCliente ? 'Orçamentos' : 'Equipamento', ''], ['cidade', 'Cidade', ''], ['total', 'Total', 'text-right'], ['vendido', 'Status', '']] as [typeof sortKey | null, string, string][]).map(([k, label, cls]) => (
                      <th key={label} className={`px-3 py-2 font-semibold ${cls} ${k ? 'cursor-pointer select-none hover:text-ink' : ''}`} onClick={() => k && ordenarPor(k)}>
                        {label}{k && sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sortedLista.map((r, i) => (
                    <tr key={i} onClick={() => focarLinha(r)}
                        className={`border-t border-border hover:bg-accent-bg/40 ${r.lat != null ? 'cursor-pointer' : ''}`}
                        title={r.lat != null ? 'Ver no mapa' : 'Sem localização'}>
                      <td className="px-3 py-1.5 whitespace-nowrap text-ink-muted truncate" title={porCliente ? r.numeros : ''}>{porCliente ? r.numeros || '—' : r.numero}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-ink-muted">{dataBR(r.data_emissao)}</td>
                      <td className="px-3 py-1.5 text-ink font-medium truncate" title={r.cliente || ''}>{r.cliente || '—'}</td>
                      <td className={`px-3 py-1.5 truncate ${r.equipamento === '(venda sem orçamento)' ? 'text-ink-faint italic' : 'text-ink-muted'}`} title={r.equipamento || ''}>{r.equipamento || '—'}</td>
                      <td className="px-3 py-1.5 truncate text-ink-muted" title={[r.cidade, r.uf].filter(Boolean).join(' - ')}>{[r.cidade, r.uf].filter(Boolean).join(' - ') || '—'}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap text-right tabular-nums text-ink">{brl(r.total)}</td>
                      <td className="px-3 py-1.5 whitespace-nowrap">
                        {r.vendido
                          ? <span className="px-2 py-0.5 rounded-full bg-blue-100 text-blue-800 font-semibold">✓ Vendido</span>
                          : <span className="px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">Orçado</span>}
                      </td>
                    </tr>
                  ))}
                  {sortedLista.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-6 text-center text-ink-muted">Nada encontrado.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex items-center gap-4 px-3 py-2 border-t border-border shrink-0 text-[12px] text-ink-muted bg-surface-2 rounded-b-xl">
              <span>
                <b className="text-ink">{sortedLista.length}</b> {porCliente ? 'clientes' : 'orçamentos'}
                {porCliente && <> · <b className="text-ink">{listaFiltrada.length}</b> orçamentos somados</>}
              </span>
              <span>Soma: <b className="text-ink tabular-nums">{brl(somaTotal)}</b></span>
              <span className="ml-auto text-ink-faint">Clique numa linha pra ver no mapa · clique no cabeçalho pra ordenar</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal: marcar visita + anotação */}
      {marcarAlvo && (
        <div className="fixed inset-0 z-[1300] bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={() => setMarcarAlvo(null)}>
          <div className="bg-surface w-full md:max-w-md rounded-t-2xl md:rounded-2xl border border-border p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[15px] font-semibold text-ink truncate">{marcarAlvo.cliente || 'Cliente'}</div>
                {marcarAlvo.telefone && <div className="text-[12px] text-ink-muted">📱 {marcarAlvo.telefone}</div>}
              </div>
              <button onClick={() => setMarcarAlvo(null)} className="h-8 w-8 shrink-0 rounded-md hover:bg-surface-2 text-ink-muted">✕</button>
            </div>
            <label className="flex items-center gap-2 text-[14px] text-ink cursor-pointer select-none">
              <input type="checkbox" checked={formVisitado} onChange={e => setFormVisitado(e.target.checked)} className="h-4 w-4 accent-green-600" />
              <span className="font-medium">✅ Visita já realizada</span>
            </label>
            <div>
              <div className="text-[12px] text-ink-muted mb-1">Anotação</div>
              <textarea
                value={formNota}
                onChange={e => setFormNota(e.target.value)}
                rows={4}
                placeholder="Ex: cliente pediu retorno em 15 dias · tem interesse na Compacta 02 · achou o preço alto…"
                className="w-full rounded-lg bg-surface-2 border border-border px-3 py-2 text-[14px] text-ink placeholder:text-ink-faint outline-none focus:border-accent resize-none"
              />
            </div>
            {marc[marcarAlvo.chave]?.updated_at && (
              <div className="text-[11px] text-ink-faint">
                Última atualização{marc[marcarAlvo.chave]?.autor ? ` por ${marc[marcarAlvo.chave]?.autor}` : ''} · {dataHoraBR(marc[marcarAlvo.chave]?.updated_at ?? null)}
              </div>
            )}
            <div className="flex items-center gap-2 pt-1">
              <button onClick={salvarMarcacao} disabled={salvarMarc.isPending}
                className="flex-1 h-11 rounded-lg bg-accent text-white font-semibold text-[14px] disabled:opacity-60">
                {salvarMarc.isPending ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
            {salvarMarc.isError && <div className="text-[12px] text-red-600">Não consegui salvar. Tenta de novo.</div>}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Corrigir a localização real de um cliente (§13/§14).
 * Aceita link do Google Maps, coordenada colada ou endereço (Nominatim).
 * Grava em cliente_localizacao com precisao='confirmada' — a partir daí a
 * mapa_orcamentos_v2() passa a devolver essa coordenada pro cliente.
 */
function CorrigirLocalModal({
  parada, onFechar, onSalvar,
}: {
  parada: Parada
  onFechar: () => void
  onSalvar: (lat: number, lng: number, endereco: string | null) => Promise<void>
}) {
  const [txt, setTxt] = useState('')
  const [endereco, setEndereco] = useState('')
  const [coord, setCoord] = useState<{ lat: number; lng: number } | null>(null)
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState(false)

  async function interpretar() {
    setErro(null)
    const t = txt.trim()
    if (!t) return
    const g = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&]q=(-?\d+\.\d+),\s*(-?\d+\.\d+)/)
    if (g) return setCoord({ lat: Number(g[1]), lng: Number(g[2]) })
    const c = t.match(/^\s*(-?\d+[.,]\d+)\s*[,;]\s*(-?\d+[.,]\d+)\s*$/)
    if (c) return setCoord({ lat: Number(c[1].replace(',', '.')), lng: Number(c[2].replace(',', '.')) })
    setBuscando(true)
    try {
      const busca = [t, parada.cidade, parada.uf].filter(Boolean).join(', ')
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=br&q=${encodeURIComponent(busca)}`)
      const j = await r.json()
      if (Array.isArray(j) && j[0]) {
        setCoord({ lat: Number(j[0].lat), lng: Number(j[0].lon) })
        setEndereco(String(j[0].display_name).split(',').slice(0, 4).join(',').trim())
      } else {
        setErro('Não achei esse endereço. Cole o link do Google Maps da propriedade — é mais confiável pra zona rural.')
      }
    } catch {
      setErro('Falha na busca. Cole o link do Google Maps.')
    } finally {
      setBuscando(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[1400] bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={onFechar}>
      <div className="bg-surface w-full md:max-w-md rounded-t-2xl md:rounded-2xl border border-border p-4 flex flex-col gap-3" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold text-ink truncate">{nomeParada(parada)}</div>
            <div className="text-[12px] text-ink-muted">{[parada.cidade, parada.uf].filter(Boolean).join('/') || '—'}</div>
          </div>
          <button onClick={onFechar} className="h-8 w-8 shrink-0 rounded-md hover:bg-surface-2 text-ink-muted">✕</button>
        </div>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 px-3 py-2 text-[11.5px] text-amber-900 dark:text-amber-300 leading-snug">
          A coordenada atual é <b>{PRECISAO_INFO[parada.precisao]?.rotulo?.toLowerCase()}</b>. Corrigir aqui vale pra
          {parada.clientes.length > 1 ? ` os ${parada.clientes.length} clientes desta parada` : ' este cliente'} e move o pino no mapa.
        </div>

        <div>
          <div className="text-[12px] text-ink-muted mb-1">Link do Google Maps, coordenada ou endereço</div>
          <div className="flex gap-1.5">
            <input
              value={txt}
              onChange={e => { setTxt(e.target.value); setCoord(null) }}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void interpretar() } }}
              placeholder="https://maps.app.goo.gl/… ou -5.0919, -42.8034"
              className="flex-1 min-w-0 h-10 px-3 rounded-lg bg-surface-2 border border-border text-[13.5px] text-ink placeholder:text-ink-faint outline-none focus:border-accent"
            />
            <button onClick={() => void interpretar()} disabled={buscando || !txt.trim()}
                    className="h-10 px-3 rounded-lg bg-surface border border-border text-[13px] font-semibold text-ink disabled:opacity-50">
              {buscando ? '…' : 'Ler'}
            </button>
          </div>
          {erro && <div className="text-[11.5px] text-red-600 mt-1.5 leading-snug">{erro}</div>}
        </div>

        {coord && (
          <div className="rounded-lg border border-green-300 bg-green-50 dark:bg-green-950/20 px-3 py-2">
            <div className="text-[12px] font-semibold text-green-800 dark:text-green-400">✓ Localização lida</div>
            <div className="text-[11.5px] tabular-nums text-ink-muted">{coord.lat.toFixed(6)}, {coord.lng.toFixed(6)}</div>
            <a href={`https://www.google.com/maps/search/?api=1&query=${coord.lat},${coord.lng}`} target="_blank" rel="noopener"
               className="text-[11.5px] font-semibold text-accent">conferir no Google Maps ↗</a>
            <input
              value={endereco} onChange={e => setEndereco(e.target.value)}
              placeholder="Endereço (opcional, pra registro)"
              className="mt-2 w-full h-8 px-2 rounded-md bg-surface border border-border text-[12px] text-ink placeholder:text-ink-faint outline-none"
            />
          </div>
        )}

        <button
          onClick={async () => {
            if (!coord) return
            setSalvando(true)
            try { await onSalvar(coord.lat, coord.lng, endereco.trim() || null) }
            catch { setErro('Não consegui salvar. Tente de novo.'); setSalvando(false) }
          }}
          disabled={!coord || salvando}
          className="h-11 rounded-lg bg-accent text-white font-semibold text-[14px] disabled:opacity-50"
        >
          {salvando ? 'Salvando…' : 'Confirmar localização'}
        </button>
      </div>
    </div>
  )
}
