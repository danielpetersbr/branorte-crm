import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'

const SUPABASE_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTA0MDY3NiwiZXhwIjoyMDY2NjE2Njc2fQ.6zYh9j5Zcjv9mEPvbrR29Vaq5gr625SvgwonYYM3xPI'

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
  return s.replace(/'/g, "''")
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
  console.log(`  ${existing.size} existing phones`)

  console.log(`Reading Excel...`)
  const wb = XLSX.readFile(filePath)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])

  // Build VALUES for SQL
  const values: string[] = []
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

    let vendorId = VENDOR_MAP[vendedorName] ?? null
    if (vendorId === '') vendorId = null

    const n = nome === 'nan' || nome === '' ? '' : esc(nome)
    const s = estado === 'nan' || estado === '' ? '' : esc(estado)
    const f = fonte === 'nan' || fonte === '' ? 'Excel Import' : esc(fonte)
    const vid = vendorId ? `'${vendorId}'` : 'NULL'

    values.push(`('${esc(n)}', '${telefone}', '${s}', '${f}', ${vid}, 'novo', '${telefone}')`)
  }

  console.log(`  New contacts to insert: ${values.length} | Skipped: ${skipped}`)

  // Insert in batches via SQL with ON CONFLICT DO NOTHING
  const BATCH = 500
  let imported = 0

  for (let i = 0; i < values.length; i += BATCH) {
    const batch = values.slice(i, i + BATCH)
    const sql = `INSERT INTO contacts (name, phone, state, origin, vendor_id, status, telefone_normalizado)
VALUES ${batch.join(',\n')}
ON CONFLICT (phone) DO NOTHING;`

    const { error } = await supabase.rpc('exec_sql', { sql_query: sql }).single()

    if (error) {
      // Try without vendor_id
      const batchNoVendor = batch.map(v => {
        // Replace vendor UUID with NULL
        return v.replace(/'[0-9a-f-]{36}'/, 'NULL')
      })
      const sql2 = `INSERT INTO contacts (name, phone, state, origin, vendor_id, status, telefone_normalizado)
VALUES ${batchNoVendor.join(',\n')}
ON CONFLICT (phone) DO NOTHING;`

      const { error: err2 } = await supabase.rpc('exec_sql', { sql_query: sql2 }).single()
      if (err2) {
        console.log(`\n  Batch ${i} error: ${err2.message.substring(0, 100)}`)
      } else {
        imported += batch.length
      }
    } else {
      imported += batch.length
    }

    const pct = Math.round(((i + batch.length) / values.length) * 100)
    process.stdout.write(`\r  ${i + batch.length}/${values.length} (${pct}%) | ~${imported} inserted`)
  }

  console.log(`\n\nDONE! ~${imported} inserted`)

  const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
  console.log(`Total in DB: ${count}`)
}

main().catch(console.error)
