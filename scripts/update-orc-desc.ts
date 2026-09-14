import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

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
