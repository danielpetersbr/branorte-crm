import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

interface OrcData {
  orcamento: string
  client: string
  phone: string | null
  city: string
  state: string
  vendor_id: string | null
  produto: string
  date: string
  year: number
}

async function main() {
  const raw = readFileSync(String.raw`C:\Users\Usuario\Desktop\Listas de Contatos Branorte\all_orcamentos.json`, 'utf8')
  const data: OrcData[] = JSON.parse(raw)

  const withPhone = data.filter(r => r.phone)
  console.log(`Total with phone: ${withPhone.length}`)

  let imported = 0
  let updated = 0
  let errors = 0
  const BATCH = 50

  for (let i = 0; i < withPhone.length; i += BATCH) {
    const batch = withPhone.slice(i, i + BATCH)

    for (const r of batch) {
      const notesLines: string[] = []
      if (r.produto) notesLines.push(r.produto)
      notesLines.push(`Orcamento ${r.orcamento}${r.date ? ' - ' + r.date : ''}`)

      const row = {
        name: r.client || '',
        phone: r.phone!,
        state: r.state || null,
        city: r.city || null,
        origin: `Orcamento ${r.orcamento}`,
        vendor_id: r.vendor_id || null,
        status: 'ABERTO',
        telefone_normalizado: r.phone!,
        notes: notesLines.join('\n'),
      }

      const { error } = await supabase.from('contacts').upsert(row, {
        onConflict: 'phone',
        ignoreDuplicates: false,
      })

      if (error) {
        // Retry without vendor
        row.vendor_id = null
        const { error: e2 } = await supabase.from('contacts').upsert(row, {
          onConflict: 'phone',
          ignoreDuplicates: false,
        })
        if (e2) errors++
        else imported++
      } else {
        imported++
      }
    }

    const pct = Math.round(((i + batch.length) / withPhone.length) * 100)
    process.stdout.write(`\r  ${i + batch.length}/${withPhone.length} (${pct}%) | imported: ${imported} | errors: ${errors}`)
  }

  console.log(`\n\nDONE!`)
  console.log(`Imported/Updated: ${imported}`)
  console.log(`Errors: ${errors}`)

  const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
  console.log(`Total in DB: ${count}`)
}

main().catch(console.error)
