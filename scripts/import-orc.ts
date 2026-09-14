import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const raw = readFileSync(String.raw`C:\Users\Usuario\Desktop\Listas de Contatos Branorte\orcamentos_contatos.json`, 'utf8')
  const data = JSON.parse(raw) as Array<{
    orcamento: string; client: string; phone: string | null; city: string;
    state: string; vendor_id: string | null; date: string;
  }>

  const contacts = data.filter(r => r.phone)
  console.log(`To import: ${contacts.length}`)

  let imported = 0
  let updated = 0
  let errors = 0

  for (const r of contacts) {
    const row = {
      name: r.client || '',
      phone: r.phone!,
      state: r.state || null,
      city: r.city || null,
      origin: `Orcamento ${r.orcamento}`,
      vendor_id: r.vendor_id || null,
      status: 'ABERTO',
      telefone_normalizado: r.phone!,
      notes: r.date ? `Orcamento ${r.orcamento} - ${r.date}` : `Orcamento ${r.orcamento}`,
    }

    const { error } = await supabase.from('contacts').upsert(row, {
      onConflict: 'phone',
      ignoreDuplicates: false,
    })

    if (error) {
      // Try without vendor_id
      row.vendor_id = null
      const { error: e2 } = await supabase.from('contacts').upsert(
        row,
        { onConflict: 'phone', ignoreDuplicates: false }
      )
      if (e2) {
        errors++
      } else {
        imported++
      }
    } else {
      imported++
    }
  }

  console.log(`Imported/Updated: ${imported}`)
  console.log(`Errors: ${errors}`)

  const { count } = await supabase.from('contacts').select('*', { count: 'exact', head: true })
  console.log(`Total in DB: ${count}`)
}

main().catch(console.error)
