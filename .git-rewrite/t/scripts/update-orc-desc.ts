import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const supabase = createClient(
  'https://flwbeevtvjiouxdjmziv.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTA0MDY3NiwiZXhwIjoyMDY2NjE2Njc2fQ.6zYh9j5Zcjv9mEPvbrR29Vaq5gr625SvgwonYYM3xPI'
)

async function main() {
  const raw = readFileSync(String.raw`C:\Users\Usuario\Desktop\Listas de Contatos Branorte\orcamentos_produtos.json`, 'utf8')
  const data = JSON.parse(raw) as Array<{ orcamento: string; produto: string }>

  console.log(`Updating ${data.length} orcamentos with product description...`)

  let updated = 0
  for (const item of data) {
    const origin = `Orcamento ${item.orcamento}`

    // Get existing contact
    const { data: contacts } = await supabase
      .from('contacts')
      .select('id, notes')
      .eq('origin', origin)
      .limit(1)

    if (contacts && contacts.length > 0) {
      const existing = contacts[0]
      const newNotes = `${item.produto}\n${existing.notes || ''}`

      const { error } = await supabase
        .from('contacts')
        .update({ notes: newNotes })
        .eq('id', existing.id)

      if (!error) updated++
    }
  }

  console.log(`Updated: ${updated}`)
}

main().catch(console.error)
