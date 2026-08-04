#!/usr/bin/env node
/**
 * Geocodifica o ENDEREÇO REAL dos clientes e grava em public.cliente_localizacao.
 *
 * POR QUE ISSO EXISTE
 * Nenhum cliente do CRM tem coordenada de endereço — 0 de 2.340 (verificado em
 * 2026-08-04). `cidade_geocache` e `vendas_mapa` são AMBOS por município, então
 * 68,85% dos clientes dividem coordenada com outro e a rota do /mapa-visitas é
 * entre centros de cidade. Este script é o que faz alguns clientes virarem parada
 * própria em vez de entrarem no bolo da cidade.
 *
 * DE ONDE VEM O ENDEREÇO
 * `orcamentos_files.docx_endereco` / `docx_cep`, extraídos do DOCX do orçamento.
 * O parser é sujo: ~40% do campo é lixo ("ução até: 10,0 ton./hora", razão social
 * truncada, pedaço do telefone virando CEP). Daí a bateria de filtros abaixo.
 *
 * APROVEITAMENTO MEDIDO (piloto de 25, 2026-08-04): 40%.
 * O resto some em endereço rural — "Linha Aparecida", "Sitio Água fria",
 * "KM 08 Lote 59 Gleba 17". Geocoder nenhum resolve isso; só o vendedor.
 *
 * SEGURANÇA DO DADO
 * Só grava quando a CIDADE devolvida pelo geocoder é a mesma do cliente. Ponto
 * que cai a menos de 300 m do centroide é descartado — significa que o geocoder
 * caiu na cidade de novo, e aí não ganhamos nada. Nada é sobrescrito: quem já tem
 * linha em cliente_localizacao (confirmação de vendedor, ajuste manual) é pulado.
 *
 * USO
 *   node scripts/geocode-clientes.mjs --dry-run            # não grava, só relata
 *   node scripts/geocode-clientes.mjs --limit 50
 *   node scripts/geocode-clientes.mjs                      # roda tudo
 *
 * Precisa de SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.
 * Nominatim: 1 req/s é a política de uso. Não baixe o intervalo.
 */

const URL_SB = process.env.SUPABASE_URL
const CHAVE = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!URL_SB || !CHAVE) {
  console.error('Faltam SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.')
  process.exit(1)
}

const args = process.argv.slice(2)
const DRY = args.includes('--dry-run')
const LIMITE = Number((args.find(a => a.startsWith('--limit')) || '').split(/[= ]/)[1] || 0)
  || Number(args[args.indexOf('--limit') + 1]) || 0

const UA = 'branorte-crm-geocode/1.0 (+https://branorte-crm.vercel.app)'
const INTERVALO_MS = 1100          // política do Nominatim
const RAIO_MAX_KM = 90             // município grande (Santarém, Dourados) chega longe
const MIN_DO_CENTRO_KM = 0.3       // abaixo disso o geocoder só devolveu a cidade

const H = { apikey: CHAVE, Authorization: `Bearer ${CHAVE}`, 'Content-Type': 'application/json' }
const esperar = ms => new Promise(r => setTimeout(r, ms))
const limpo = s => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim()

function distKm(aLat, aLng, bLat, bLng) {
  const R = 6371, r = x => (x * Math.PI) / 180
  const dLat = r(bLat - aLat), dLng = r(bLng - aLng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

/**
 * Candidatos. Liga orcamentos_files ao cliente do mapa por DUAS chaves — número do
 * orçamento (ano+sequência, que é como o mapa normaliza) e telefone. Descarta CEP
 * que aparece em 3+ clientes: isso não é endereço, é o parser repetindo o mesmo
 * campo errado (o CEP 03648162 apareceu em cliente de MT, PE e RS).
 */
/** Candidatos vêm da RPC viagem_candidatos_geocode() — a regra de filtragem mora
 *  no banco (migration 20260804_viagem_candidatos_geocode) pra não duplicar aqui. */
async function candidatos() {
  const r = await fetch(`${URL_SB}/rest/v1/rpc/viagem_candidatos_geocode`, { method: 'POST', headers: H, body: '{}' })
  if (!r.ok) throw new Error(`RPC viagem_candidatos_geocode falhou (${r.status}): ${(await r.text()).slice(0, 200)}`)
  return r.json()
}

async function geocodar(c) {
  const q = [c.ender, c.cidade, c.uf, 'Brasil'].filter(Boolean).join(', ')
  let j = []
  try {
    const r = await fetch(
      `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&addressdetails=1&q=${encodeURIComponent(q)}`,
      { headers: { 'User-Agent': UA, 'Accept-Language': 'pt-BR' } },
    )
    if (r.ok) j = await r.json()
  } catch { /* rede: conta como sem resposta */ }

  if (!Array.isArray(j) || !j[0]) return { ok: false, motivo: 'sem_resposta' }

  const g = j[0]
  const lat = Number(g.lat), lng = Number(g.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return { ok: false, motivo: 'coord_invalida' }

  const cidGeo = g.address?.city || g.address?.town || g.address?.village || g.address?.municipality || ''
  const a = limpo(cidGeo), b = limpo(c.cidade)
  if (!a || !(a === b || a.includes(b) || b.includes(a))) {
    return { ok: false, motivo: 'cidade_diverge', detalhe: `${cidGeo || '?'} != ${c.cidade}` }
  }

  const d = distKm(c.cid_lat, c.cid_lng, lat, lng)
  if (d > RAIO_MAX_KM) return { ok: false, motivo: 'longe_demais', detalhe: `${d.toFixed(0)} km` }
  if (d < MIN_DO_CENTRO_KM) return { ok: false, motivo: 'caiu_no_centro', detalhe: `${(d * 1000).toFixed(0)} m` }

  return { ok: true, lat, lng, tipo: g.type, endereco: (g.display_name || '').slice(0, 200), dist: d }
}

async function gravar(cliKey, r, cru) {
  const res = await fetch(`${URL_SB}/rest/v1/cliente_localizacao`, {
    method: 'POST',
    headers: { ...H, Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify({
      cli_key: cliKey, lat: r.lat, lng: r.lng,
      precisao: 'endereco', fonte: 'geocode_endereco',
      endereco: r.endereco,
      observacao: `nominatim ${r.tipo} · ${r.dist.toFixed(1)} km do centro · origem: ${cru.slice(0, 80)}`,
    }),
  })
  if (!res.ok) throw new Error(`insert falhou ${res.status}: ${(await res.text()).slice(0, 160)}`)
}

// ── execução ─────────────────────────────────────────────────────────────────
const lista = await candidatos()
const fila = LIMITE ? lista.slice(0, LIMITE) : lista
console.log(`${lista.length} candidatos · processando ${fila.length}${DRY ? ' (DRY-RUN, não grava)' : ''}`)
console.log(`estimativa: ${Math.ceil((fila.length * INTERVALO_MS) / 60000)} min (1 req/s é a política do Nominatim)\n`)

const conta = { ok: 0, sem_resposta: 0, cidade_diverge: 0, longe_demais: 0, caiu_no_centro: 0, coord_invalida: 0, erro_gravar: 0 }
let i = 0
for (const c of fila) {
  i++
  const r = await geocodar(c)
  await esperar(INTERVALO_MS)

  if (!r.ok) {
    conta[r.motivo] = (conta[r.motivo] || 0) + 1
    if (i % 25 === 0 || r.motivo === 'cidade_diverge') {
      console.log(`  ${String(i).padStart(4)} ✗ ${r.motivo.padEnd(15)} ${(c.cliente || '').slice(0, 30)} ${r.detalhe || ''}`)
    }
    continue
  }
  if (!DRY) {
    try { await gravar(c.cli_key, r, c.ender) } catch (e) { conta.erro_gravar++; console.log(`  ${i} ! ${e.message}`); continue }
  }
  conta.ok++
  console.log(`  ${String(i).padStart(4)} ✓ ${r.dist.toFixed(1).padStart(5)} km  ${(c.cliente || '').slice(0, 30).padEnd(31)} ${r.endereco.slice(0, 55)}`)
}

console.log('\n' + '─'.repeat(70))
console.log(JSON.stringify(conta, null, 1))
console.log(`aproveitamento: ${((100 * conta.ok) / Math.max(1, fila.length)).toFixed(0)}%`)
if (DRY) console.log('\nDRY-RUN: nada foi gravado. Rode sem --dry-run pra valer.')
else console.log(`\n${conta.ok} cliente(s) agora têm coordenada de ENDEREÇO. O pino se move sozinho — a
mapa_orcamentos_v2() faz left join em cliente_localizacao.
Pra desfazer: delete from cliente_localizacao where fonte = 'geocode_endereco';`)
