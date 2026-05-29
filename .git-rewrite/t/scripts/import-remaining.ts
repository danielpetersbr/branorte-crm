import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'
import * as path from 'path'

const SUPABASE_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTA0MDY3NiwiZXhwIjoyMDY2NjE2Njc2fQ.6zYh9j5Zcjv9mEPvbrR29Vaq5gr625SvgwonYYM3xPI'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const VENDOR_MAP: Record<string, string> = {}
const BATCH_SIZE = 200

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
  console.log(`Vendors loaded: ${Object.keys(VENDOR_MAP).length}`)
}

async function getExistingPhones(): Promise<Set<string>> {
  console.log('Loading existing phones...')
  const phones = new Set<string>()
  let offset = 0
  while (true) {
    const { data } = await supabase.from('contacts').select('phone, telefone_normalizado').range(offset, offset + 2000)
    if (!data || data.length === 0) break
    for (const r of data) {
      if (r.phone) phones.add(r.phone)
      if (r.telefone_normalizado) phones.add(r.telefone_normalizado)
    }
    offset += 2000
  }
  console.log(`  ${phones.size} existing phones`)
  return phones
}

async function main() {
  const filePath = process.argv[2] || String.raw`C:\Users\Usuario\Desktop\Listas de Contatos Branorte\CONTATOS CONSOLIDADOS BRANORTE v4.xlsx`

  await loadVendors()
  const existing = await getExistingPhones()

  console.log(`Reading ${filePath}...`)
  const wb = XLSX.readFile(filePath)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]])
  console.log(`  ${rows.length} rows`)

  const toInsert: any[] = []
  let skipped = 0

  for (const row of rows) {
    const nome = String(row['Nome'] ?? '').trim()
    const telefone = String(row['Telefone'] ?? '').trim()
    const estado = String(row['Estado'] ?? '').trim()
    const fonte = String(row['Fonte'] ?? '').trim()
    const vendedorName = String(row['Vendedor'] ?? '').trim().toUpperCase()

    if (!telefone || telefone.length < 10) continue

    // Skip if already in DB
    if (existing.has(telefone)) {
      skipped++
      continue
    }
    existing.add(telefone)

    // Resolve vendor - if not found, set null (avoid FK errors)
    let vendorId = VENDOR_MAP[vendedorName] ?? null
    if (vendorId === '') vendorId = null

    toInsert.push({
      name: nome === 'nan' || nome === '' ? '' : nome,
      phone: telefone,
      state: estado === 'nan' || estado === '' ? null : estado,
      origin: fonte === 'nan' || fonte === '' ? 'Excel Import' : fonte,
      vendor_id: vendorId,
      status: 'novo',
      telefone_normalizado: telefone,
    })
  }

  console.log(`  To insert: ${toInsert.length} | Skipped (existing): ${skipped}`)

  // Insert in small batches with upsert to handle remaining duplicates
  let imported = 0
  let errors = 0

  for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
    const batch = toInsert.slice(i, i + BATCH_SIZE)

    const { error } = await supabase.from('contacts').upsert(batch, {
      onConflict: 'telefone_normalizado',
      ignoreDuplicates: true,
    })

    if (error) {
      // Try without vendor_id for FK errors
      const batchNoVendor = batch.map(c => ({ ...c, vendor_id: null }))
      const { error: err2 } = await supabase.from('contacts').upsert(batchNoVendor, {
        onConflict: 'telefone_normalizado',
        ignoreDuplicates: true,
      })
      if (err2) {
        // Insert one by one as last resort
        for (const c of batch) {
          const { error: err3 } = await supabase.from('contacts').upsert(
            { ...c, vendor_id: null },
            { onConflict: 'telefone_normalizado', ignoreDuplicates: true }
          )
          if (!err3) imported++
          else errors++
        }
        continue
      }
      imported += batch.length
    } else {
      imported += batch.length
    }

    const pct = Math.round(((i + batch.length) / toInsert.length) * 100)
    process.stdout.write(`\r  Progress: ${i + batch.length}/${toInsert.length} (${pct}%) | Imported: ${imported}`)
  }

  console.log(`\n\nDONE!`)
  console.log(`  Imported: ${imported}`)
  console.log(`  Errors: ${errors}`)

  // Final count
  const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
  console.log(`  Total in DB: ${count}`)
}

main().catch(console.error)
