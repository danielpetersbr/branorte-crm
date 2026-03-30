import { createClient } from '@supabase/supabase-js'
import XLSX from 'xlsx'
import * as path from 'path'

const SUPABASE_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTA0MDY3NiwiZXhwIjoyMDY2NjE2Njc2fQ.6zYh9j5Zcjv9mEPvbrR29Vaq5gr625SvgwonYYM3xPI'

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

const VENDOR_NAME_TO_ID: Record<string, string> = {}
const BATCH_SIZE = 500

async function loadVendors() {
  const { data, error } = await supabase.from('vendors').select('id, name, key')
  if (error) throw error
  // Map various name formats to vendor IDs
  for (const v of data ?? []) {
    VENDOR_NAME_TO_ID[v.name.toUpperCase()] = v.id
    VENDOR_NAME_TO_ID[v.key.toUpperCase()] = v.id
  }
  // Add common aliases
  VENDOR_NAME_TO_ID['ALVARO'] = VENDOR_NAME_TO_ID['ALVARO TORRES'] ?? ''
  VENDOR_NAME_TO_ID['EDER'] = VENDOR_NAME_TO_ID['EDER SOUZA'] ?? ''
  VENDOR_NAME_TO_ID['EDILSON JR'] = VENDOR_NAME_TO_ID['EDILSON JUNIOR'] ?? ''
  VENDOR_NAME_TO_ID['GUSTAVO'] = VENDOR_NAME_TO_ID['GUSTAVO VICENTE'] ?? ''
  VENDOR_NAME_TO_ID['JARDEL'] = VENDOR_NAME_TO_ID['JARDEL DELLA GIUSTINA'] ?? ''
  VENDOR_NAME_TO_ID['PEDRO'] = VENDOR_NAME_TO_ID['PEDRO DELLA GIUSTINA'] ?? ''
  VENDOR_NAME_TO_ID['DANIEL-MATHEUS'] = VENDOR_NAME_TO_ID['DANIEL PETERS'] ?? ''
  VENDOR_NAME_TO_ID['DANIEL/MATHEUS'] = VENDOR_NAME_TO_ID['DANIEL PETERS'] ?? ''
  VENDOR_NAME_TO_ID['MATHEUS'] = VENDOR_NAME_TO_ID['MATHEUS COITINHO'] ?? ''

  console.log(`Loaded ${Object.keys(VENDOR_NAME_TO_ID).length} vendor mappings`)
}

async function getExistingPhones(): Promise<Set<string>> {
  console.log('Loading existing phones to avoid duplicates...')
  const phones = new Set<string>()
  let offset = 0
  const batchSize = 1000
  while (true) {
    const { data, error } = await supabase
      .from('contacts')
      .select('phone')
      .range(offset, offset + batchSize - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    for (const row of data) {
      if (row.phone) phones.add(row.phone)
    }
    offset += batchSize
  }
  console.log(`  ${phones.size} existing phones loaded`)
  return phones
}

async function importFile(filePath: string) {
  console.log(`\nReading ${filePath}...`)
  const workbook = XLSX.readFile(filePath)
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
  console.log(`  ${rows.length} rows found`)

  const existingPhones = await getExistingPhones()

  const contacts: Array<{
    name: string
    phone: string
    state: string
    origin: string
    vendor_id: string | null
    status: string
    telefone_normalizado: string
  }> = []

  let skippedDupes = 0
  let skippedInvalid = 0

  for (const row of rows) {
    const nome = String(row['Nome'] ?? '').trim()
    const telefone = String(row['Telefone'] ?? '').trim()
    const estado = String(row['Estado'] ?? '').trim()
    const fonte = String(row['Fonte'] ?? '').trim()
    const vendedorName = String(row['Vendedor'] ?? '').trim().toUpperCase()

    if (!telefone || telefone.length < 10) {
      skippedInvalid++
      continue
    }

    // Skip if phone already exists
    if (existingPhones.has(telefone)) {
      skippedDupes++
      continue
    }

    // Mark as seen
    existingPhones.add(telefone)

    const vendorId = VENDOR_NAME_TO_ID[vendedorName] ?? null

    contacts.push({
      name: nome === 'nan' || nome === '' ? '' : nome,
      phone: telefone,
      state: estado === 'nan' || estado === '' ? '' : estado,
      origin: fonte === 'nan' || fonte === '' ? 'Excel Import' : fonte,
      vendor_id: vendorId,
      status: 'novo',
      telefone_normalizado: telefone,
    })
  }

  console.log(`  Valid new contacts: ${contacts.length}`)
  console.log(`  Skipped duplicates: ${skippedDupes}`)
  console.log(`  Skipped invalid: ${skippedInvalid}`)

  // Batch insert
  let imported = 0
  let errors = 0
  for (let i = 0; i < contacts.length; i += BATCH_SIZE) {
    const batch = contacts.slice(i, i + BATCH_SIZE)
    const { error } = await supabase.from('contacts').insert(batch)
    if (error) {
      console.error(`\n  Error at batch ${i}: ${error.message}`)
      errors++
      continue
    }
    imported += batch.length
    const pct = Math.round((imported / contacts.length) * 100)
    process.stdout.write(`\r  Imported: ${imported}/${contacts.length} (${pct}%)`)
  }

  console.log(`\n\n  DONE!`)
  console.log(`  Imported: ${imported}`)
  console.log(`  Errors: ${errors}`)
}

async function main() {
  const filePath = process.argv[2]
  if (!filePath) {
    console.log('Usage: npx tsx scripts/import-contacts.ts <path-to-excel.xlsx>')
    process.exit(1)
  }

  await loadVendors()
  await importFile(path.resolve(filePath))
}

main().catch(console.error)
