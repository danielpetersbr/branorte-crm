import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const SUPABASE_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTA0MDY3NiwiZXhwIjoyMDY2NjE2Njc2fQ.6zYh9j5Zcjv9mEPvbrR29Vaq5gr625SvgwonYYM3xPI'
const MGMT_TOKEN = 'sbp_514a864dca53dba8c9a9ba65f6428e55e99319f6'
const PROJECT_ID = 'flwbeevtvjiouxdjmziv'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const VENDOR_MAP: Record<string, string> = {}

async function loadVendors() {
  const { data } = await supabase.from('vendors').select('id, name, key')
  for (const v of data ?? []) {
    VENDOR_MAP[v.name.toUpperCase()] = v.id
    VENDOR_MAP[v.key.toUpperCase()] = v.id
  }
  VENDOR_MAP['ALVARO'] = VENDOR_MAP['ALVARO TORRES'] ?? ''
  VENDOR_MAP['EDER'] = VENDOR_MAP['EDER SOUZA'] ?? ''
  VENDOR_MAP['EDILSON JR'] = VENDOR_MAP['EDILSON JUNIOR'] ?? ''
  VENDOR_MAP['GUSTAVO'] = VENDOR_MAP['GUSTAVO VICENTE'] ?? ''
  VENDOR_MAP['JARDEL'] = VENDOR_MAP['JARDEL DELLA GIUSTINA'] ?? ''
  VENDOR_MAP['PEDRO'] = VENDOR_MAP['PEDRO DELLA GIUSTINA'] ?? ''
  VENDOR_MAP['DANIEL-MATHEUS'] = VENDOR_MAP['DANIEL PETERS'] ?? ''
  VENDOR_MAP['DANIEL/MATHEUS'] = VENDOR_MAP['DANIEL PETERS'] ?? ''
}

function esc(s: string): string {
  return s.replace(/'/g, "''").replace(/\\/g, '\\\\')
}

async function runSQL(sql: string): Promise<boolean> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${MGMT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query: sql }),
  })
  if (!res.ok) {
    const text = await res.text()
    console.log(`\n  SQL error: ${text.substring(0, 150)}`)
    return false
  }
  return true
}

async function main() {
  const filePath = process.argv[2] || String.raw`C:\Users\Usuario\Desktop\Listas de Contatos Branorte\CONTATOS CONSOLIDADOS BRANORTE v4.xlsx`

  await loadVendors()

  // Get existing phones
  console.log('Loading existing phones...')
  const existing = new Set<string>()
  let offset = 0
  while (true) {
    const { data } = await supabase.from('contacts').select('phone').range(offset, offset + 5000)
    if (!data || data.length === 0) break
    for (const r of data) if (r.phone) existing.add(r.phone)
    offset += 5000
  }
  console.log(`  ${existing.size} existing`)

  console.log(`Reading Excel...`)
  const wb = XLSX.readFile(filePath)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])

  // Build records
  interface Rec { name: string; phone: string; state: string; origin: string; vendor_id: string | null; }
  const records: Rec[] = []
  let skipped = 0

  for (const row of rows) {
    const nome = String(row['Nome'] ?? '').trim()
    const telefone = String(row['Telefone'] ?? '').trim()
    const estado = String(row['Estado'] ?? '').trim()
    const fonte = String(row['Fonte'] ?? '').trim()
    const vendedorName = String(row['Vendedor'] ?? '').trim().toUpperCase()

    if (!telefone || telefone.length < 10) continue
    if (existing.has(telefone)) { skipped++; continue }
    existing.add(telefone)

    let vid = VENDOR_MAP[vendedorName] ?? null
    if (vid === '') vid = null

    records.push({
      name: (nome === 'nan' || nome === '') ? '' : nome,
      phone: telefone,
      state: (estado === 'nan' || estado === '') ? '' : estado,
      origin: (fonte === 'nan' || fonte === '') ? 'Excel Import' : fonte,
      vendor_id: vid,
    })
  }

  console.log(`  To insert: ${records.length} | Skipped: ${skipped}`)

  // Insert via Management API SQL in batches
  const BATCH = 300
  let total = 0

  for (let i = 0; i < records.length; i += BATCH) {
    const batch = records.slice(i, i + BATCH)
    const vals = batch.map(r => {
      const vid = r.vendor_id ? `'${r.vendor_id}'` : 'NULL'
      return `('${esc(r.name)}', '${r.phone}', '${esc(r.state)}', '${esc(r.origin)}', ${vid}, 'novo', '${r.phone}')`
    }).join(',\n')

    const sql = `INSERT INTO contacts (name, phone, state, origin, vendor_id, status, telefone_normalizado)
VALUES ${vals}
ON CONFLICT (phone) DO NOTHING;`

    let ok = await runSQL(sql)
    if (!ok) {
      // Retry without vendor_id
      const vals2 = batch.map(r => {
        return `('${esc(r.name)}', '${r.phone}', '${esc(r.state)}', '${esc(r.origin)}', NULL, 'novo', '${r.phone}')`
      }).join(',\n')
      const sql2 = `INSERT INTO contacts (name, phone, state, origin, vendor_id, status, telefone_normalizado)
VALUES ${vals2}
ON CONFLICT (phone) DO NOTHING;`
      ok = await runSQL(sql2)
    }

    if (ok) total += batch.length
    const pct = Math.round(((i + batch.length) / records.length) * 100)
    process.stdout.write(`\r  ${i + batch.length}/${records.length} (${pct}%)`)
  }

  console.log(`\n\nDONE! Processed: ${total}`)

  const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
  console.log(`Total in DB: ${count}`)
}

main().catch(console.error)
