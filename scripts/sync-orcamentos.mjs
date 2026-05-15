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

async function processFile(remotePath) {
  // remotePath formato: "2026/05/2026-0803-cliente.pdf"
  const segs = remotePath.split('/')
  if (segs.length < 3) {
    log(`SKIP path inesperado: ${remotePath}`)
    return
  }
  const ano = segs[0]
  const filename = segs[segs.length - 1]

  // Estrutura local: Z:\1 - Comercial\3 - Orçamento\YYYY\Orçamentos YYYY\<filename>
  const destDir = path.join(DEST_BASE, ano, `Orçamentos ${ano}`)
  const destPath = path.join(destDir, filename)

  // Se ja existe local, pula (idempotente caso script reinicie)
  if (existsSync(destPath)) {
    log(`SKIP ja existe local: ${destPath}`)
    await markAsProcessed(remotePath)
    return
  }

  // Baixa do Storage
  const { data: blob, error: dlErr } = await supa.storage.from(BUCKET).download(remotePath)
  if (dlErr || !blob) {
    log(`ERR download ${remotePath}: ${dlErr?.message ?? 'sem dados'}`)
    return
  }

  ensureDir(destDir)
  const buf = Buffer.from(await blob.arrayBuffer())
  await fs.writeFile(destPath, buf)
  log(`OK ${remotePath} → ${destPath} (${buf.length} bytes)`)

  await markAsProcessed(remotePath)
}

async function markAsProcessed(remotePath) {
  // Move pra _processados/<original_path> dentro do bucket
  const newPath = `_processados/${remotePath}`
  const { error } = await supa.storage.from(BUCKET).move(remotePath, newPath)
  if (error) log(`WARN nao consegui mover ${remotePath} pra _processados: ${error.message}`)
}

async function tick() {
  try {
    const pendentes = await listAllPendentes()
    if (pendentes.length > 0) {
      log(`${pendentes.length} arquivo(s) pendente(s)`)
      for (const f of pendentes) {
        await processFile(f.path)
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
}

async function scanPastaUpdateIndex() {
  const ano = new Date().getFullYear()
  const dir = path.join(DEST_BASE, String(ano), `Orçamentos ${ano}`)
  if (!existsSync(dir)) return
  const files = await fs.readdir(dir)
  // Padrao de arquivo: "YYYY-XXXX-cliente.pdf" ou "YYYY-XXXX-cliente.docx"
  // (pode ter espacos/parenteses tambem). Pega o maior XXXX.
  const re = new RegExp(`^${ano}\\s*-?\\s*(\\d{3,5})\\b`)
  let maxSeq = 0
  let maxArq = ''
  for (const f of files) {
    const m = f.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > maxSeq) { maxSeq = n; maxArq = f }
    }
  }
  if (maxSeq === 0) return // pasta vazia ou sem arquivos no padrao

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
