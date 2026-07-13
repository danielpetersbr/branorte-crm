#!/usr/bin/env node
/**
 * Sincroniza orçamentos gerados em mobile (Supabase Storage) com a pasta
 * de rede Z:\1 - Comercial\3 - Orçamento\YYYY\Orçamentos YYYY.
 *
 * Como rodar (PC do escritório, com acesso à pasta Z:\):
 *   1. Copie .env.example pra .env e preencha
 *      - SUPABASE_URL=https://flwbeevtvjiouxdjmziv.supabase.co
 *      - SUPABASE_SERVICE_ROLE_KEY=<service_role do Supabase Dashboard>
 *      - DEST_BASE_PATH=Z:\1 - Comercial\3 - Orçamento     (sem ano no fim)
 *   2. npm install @supabase/supabase-js dotenv
 *   3. node scripts/sync-orcamentos.mjs
 *
 * Pra rodar 24/7 no Windows:
 *   - Use NSSM ou criar Task Scheduler com "ao iniciar" + "Iniciar com sistema"
 *   - Ou rodar via pm2: npm i -g pm2 && pm2 start scripts/sync-orcamentos.mjs
 *     pm2 save && pm2 startup
 *
 * Comportamento:
 *   - A cada POLL_INTERVAL_MS (default 30s), lista bucket orcamentos-pendentes
 *   - Pra cada arquivo: baixa pra <DEST_BASE_PATH>\YYYY\Orçamentos YYYY\<filename>
 *   - Após copiar com sucesso, MOVE o arquivo dentro do bucket pra subpasta
 *     `_processados/YYYY/MM/<filename>` (preserva histórico, evita reprocessar)
 *   - Loga em ~/branorte-sync.log
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'
import { existsSync, mkdirSync, appendFileSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const SUPA_URL = process.env.SUPABASE_URL
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DEST_BASE = process.env.DEST_BASE_PATH || 'Z:\\1 - Comercial\\3 - Orçamento'
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30_000)
const BUCKET = 'orcamentos-pendentes'
const SERVICE_NAME = 'orcamentos-z-sync'
const LOG_FILE = path.join(os.homedir(), 'branorte-sync.log')

if (!SUPA_URL || !SUPA_KEY) {
  console.error('FALTAM env vars: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supa = createClient(SUPA_URL, SUPA_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  console.log(line)
  try { appendFileSync(LOG_FILE, line + '\n', 'utf8') } catch {}
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
}

async function listAllPendentes(prefix = '') {
  // Lista recursivo: bucket organiza como YYYY/MM/<arquivo>
  // Ignora subpasta _processados/
  const out = []
  async function walk(p) {
    const { data, error } = await supa.storage.from(BUCKET).list(p, { limit: 1000 })
    if (error) { log(`ERR list ${p}: ${error.message}`); return }
    for (const f of data || []) {
      // Subpastas têm name sem extensão e id null
      if (!f.id) {
        if (f.name.startsWith('_')) continue // pula _processados
        await walk(p ? `${p}/${f.name}` : f.name)
      } else {
        out.push({ path: p ? `${p}/${f.name}` : f.name, size: f.metadata?.size ?? 0 })
      }
    }
  }
  await walk(prefix)
  return out
}

// Nome da subpasta do mes na estrutura Z:\ — formato "5 - Maio"
const MES_NOMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro']
function nomePastaMes(mes /* 1..12 */) {
  return `${mes} - ${MES_NOMES[mes - 1]}`
}

async function processFile(remotePath) {
  // remotePath formato: "2026/05/2026-0803-cliente.pdf"
  // Retorna true se o arquivo esta garantido no Z: (OK ou ja existia), false em erro.
  const segs = remotePath.split('/')
  if (segs.length < 3) {
    log(`SKIP path inesperado: ${remotePath}`)
    return false
  }
  const ano = segs[0]
  const mes = parseInt(segs[1], 10)  // "05" -> 5
  const filename = segs[segs.length - 1]

  // Estrutura local: Z:\...\YYYY\Orçamentos YYYY\<M> - <NomeMes>\<filename>
  const destDir = path.join(DEST_BASE, ano, `Orçamentos ${ano}`, nomePastaMes(mes))
  const destPath = path.join(destDir, filename)

  // Se ja existe local, pula (idempotente caso script reinicie)
  if (existsSync(destPath)) {
    log(`SKIP ja existe local: ${destPath}`)
    await markAsProcessed(remotePath)
    return true
  }

  // Baixa do Storage
  const { data: blob, error: dlErr } = await supa.storage.from(BUCKET).download(remotePath)
  if (dlErr || !blob) {
    log(`ERR download ${remotePath}: ${dlErr?.message ?? 'sem dados'}`)
    return false
  }

  ensureDir(destDir)
  const buf = Buffer.from(await blob.arrayBuffer())
  await fs.writeFile(destPath, buf)
  log(`OK ${remotePath} → ${destPath} (${buf.length} bytes)`)

  await markAsProcessed(remotePath)
  return true
}

async function markAsProcessed(remotePath) {
  // Move pra _processados/<original_path> dentro do bucket
  const newPath = `_processados/${remotePath}`
  let { error } = await supa.storage.from(BUCKET).move(remotePath, newPath)
  if (error && /exist/i.test(error.message)) {
    // Destino ja existe = orcamento re-gerado com o mesmo nome depois de um
    // processamento anterior. Sem tratamento o move falha 400 pra sempre e o
    // arquivo nunca sai da lista de pendentes (flood de retries a cada tick).
    // Descarta a copia antiga do historico e move a versao nova por cima.
    await supa.storage.from(BUCKET).remove([newPath])
    ;({ error } = await supa.storage.from(BUCKET).move(remotePath, newPath))
  }
  if (error) log(`WARN nao consegui mover ${remotePath} pra _processados: ${error.message}`)
}

// Heartbeat: o daemon "bate o coracao" a cada tick. last_tick velho = daemon
// caido (alerta via cron sync-health-alert); z_ok=false = pasta Z indisponivel.
// service_role bypassa RLS. O row e semeado com alert_vendor_nome (quem recebe
// o WA) — nao incluimos esse campo no upsert pra nao sobrescrever.
async function writeHeartbeat(z_ok, pendentes, entregues, detail) {
  const { error } = await supa.from('sync_heartbeat').upsert({
    service: SERVICE_NAME,
    last_tick: new Date().toISOString(),
    z_ok,
    pendentes,
    entregues_ciclo: entregues,
    detail,
    host: os.hostname(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'service' })
  if (error) log(`WARN heartbeat: ${error.message}`)
}

async function tick() {
  let pendentesCount = 0
  let entregues = 0
  try {
    const pendentes = await listAllPendentes()
    pendentesCount = pendentes.length
    if (pendentes.length > 0) {
      log(`${pendentes.length} arquivo(s) pendente(s)`)
      for (const f of pendentes) {
        const ok = await processFile(f.path)
        if (ok) entregues++
      }
    }
  } catch (e) {
    log(`ERR tick: ${e?.message ?? e}`)
  }

  // Tambem escaneia a pasta Z:\YYYY\Orcamentos YYYY pra detectar
  // orcamentos que vendedor salvou DIRETO la (fora do CRM). Atualiza
  // tabela pasta_orcamento_index pra mobile/desktop calcularem proximo
  // numero unico.
  try {
    await scanPastaUpdateIndex()
  } catch (e) {
    log(`ERR scan pasta: ${e?.message ?? e}`)
  }

  // Heartbeat SEMPRE no fim — enquanto o processo vive, last_tick fica fresco.
  const zOk = existsSync(DEST_BASE)
  try {
    await writeHeartbeat(zOk, pendentesCount, entregues, zOk ? 'ok' : 'Z: indisponivel')
  } catch (e) {
    log(`ERR heartbeat: ${e?.message ?? e}`)
  }
}

async function scanPastaUpdateIndex() {
  const ano = new Date().getFullYear()
  const baseDir = path.join(DEST_BASE, String(ano), `Orçamentos ${ano}`)
  if (!existsSync(baseDir)) return

  // Estrutura real: Orçamentos YYYY/<M - NomeMes>/<arquivos>.pdf|docx
  // Varre TODAS as subpastas de mes (1 - Janeiro até 12 - Dezembro).
  const re = new RegExp(`^${ano}\\s*-?\\s*(\\d{3,5})\\b`)
  let maxSeq = 0
  let maxArq = ''
  const seqsNoZ = []

  const subpastas = await fs.readdir(baseDir).catch(() => [])
  for (const sub of subpastas) {
    const subDir = path.join(baseDir, sub)
    let stat
    try { stat = await fs.stat(subDir) } catch { continue }
    if (!stat.isDirectory()) continue

    const files = await fs.readdir(subDir).catch(() => [])
    for (const f of files) {
      const m = f.match(re)
      if (m) {
        const n = parseInt(m[1], 10)
        seqsNoZ.push(n)
        if (n > maxSeq) { maxSeq = n; maxArq = `${sub}/${f}` }
      }
    }
  }

  // Marca entregue_z_at pra orcamentos cujo arquivo JA esta no Z: — cobre
  // Caminho A (gravacao direta no desktop do admin) E Caminho B (bucket->daemon).
  // Query-first: busca so os AINDA NAO marcados (poucos em regime) e marca os
  // que tem arquivo presente no Z:. Evita mandar centenas de seqs todo tick.
  if (seqsNoZ.length) {
    const noZ = new Set(seqsNoZ)
    const { data: naoMarcados } = await supa.from('orcamentos_gerados')
      .select('sequencial').eq('ano', ano).is('entregue_z_at', null).limit(5000)
    const aMarcar = (naoMarcados || []).map((r) => r.sequencial).filter((s) => noZ.has(s))
    if (aMarcar.length) {
      const { error: eEnt } = await supa.from('orcamentos_gerados')
        .update({ entregue_z_at: new Date().toISOString() })
        .eq('ano', ano).in('sequencial', aMarcar)
      if (eEnt) log(`WARN marcar entregue_z: ${eEnt.message}`)
      else log(`entregue_z marcado: ${aMarcar.length} orcamento(s)`)
    }
  }

  if (maxSeq === 0) {
    log(`scan: nenhum arquivo no padrao ${ano}-XXXX encontrado em ${baseDir}`)
    return
  }

  // Upsert na tabela
  const { error } = await supa.from('pasta_orcamento_index').upsert({
    ano,
    ultimo_sequencial: maxSeq,
    ultimo_arquivo: maxArq,
    atualizado_em: new Date().toISOString(),
  }, { onConflict: 'ano' })
  if (error) {
    log(`WARN nao consegui atualizar pasta_orcamento_index: ${error.message}`)
  } else {
    // log so quando muda
    const cached = scanPastaUpdateIndex._lastSeq
    if (cached !== maxSeq) {
      log(`pasta_orcamento_index atualizado: ano=${ano} ultimo=${maxSeq} (${maxArq})`)
      scanPastaUpdateIndex._lastSeq = maxSeq
    }
  }
}

log(`Iniciando sync. DEST=${DEST_BASE} | POLL=${POLL_INTERVAL_MS}ms | LOG=${LOG_FILE}`)

// Roda imediato + interval
tick()
setInterval(tick, POLL_INTERVAL_MS)

// REALTIME: escuta canal "force-scan" do Supabase. Quando frontend
// abre o modal Finalizar e chama supabase.channel('force-scan').send(),
// fazemos scan IMEDIATO da pasta (sem esperar o proximo tick de 5s).
// Garante que mobile sempre pega o numero mais novo da pasta.
const channel = supa.channel('force-scan-pasta')
channel
  .on('broadcast', { event: 'scan-now' }, async () => {
    log('REALTIME: force-scan recebido — scan imediato')
    try {
      await scanPastaUpdateIndex()
    } catch (e) {
      log(`ERR realtime scan: ${e?.message ?? e}`)
    }
  })
  .subscribe((status) => {
    if (status === 'SUBSCRIBED') log('REALTIME: subscribed em force-scan-pasta')
  })
