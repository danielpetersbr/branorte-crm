import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_ACCESS_TOKEN = process.env.SUPABASE_ACCESS_TOKEN
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Configure SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente.')
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

async function runSQL(sql: string) {
  // Use the postgrest rpc or direct fetch
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/exec_sql`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'apikey': SUPABASE_SERVICE_ROLE_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql_query: sql }),
  })
  return res.ok
}

async function main() {
  // Add columns via direct SQL through management API won't work
  // Use a workaround: create a function that executes SQL, then call it

  // First, let's try adding columns via the Supabase management API with a fresh token
  // Actually, let's use the dashboard SQL editor approach via the service role key

  // The simplest approach: use supabase-js to test if columns exist, if not, we need migration

  // Test if temperatura column exists
  const { data, error } = await supabase.from('contacts').select('id').limit(1)
  console.log('Connection OK:', !error)

  // Try to read a contact with new fields
  const { data: test, error: testErr } = await supabase
    .from('contacts')
    .select('id, temperatura, estagio_funil, valor_estimado, proximo_followup, ultimo_contato, motivo_perda, tentativas')
    .limit(1)

  if (testErr) {
    console.log('New columns do NOT exist yet. Need to add via SQL migration.')
    console.log('Error:', testErr.message)

    // We need to run DDL via the Supabase Dashboard SQL editor or management API
    // Let's try the management API with a fresh approach
    if (!SUPABASE_ACCESS_TOKEN) throw new Error('Configure SUPABASE_ACCESS_TOKEN para executar migrações pela Management API.')
    const MGMT_TOKEN = SUPABASE_ACCESS_TOKEN
    const PROJECT_ID = 'flwbeevtvjiouxdjmziv'

    const sqls = [
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS temperatura TEXT DEFAULT 'frio'",
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS estagio_funil TEXT DEFAULT 'novo_lead'",
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS valor_estimado NUMERIC DEFAULT 0",
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS proximo_followup DATE",
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS ultimo_contato TIMESTAMPTZ",
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS motivo_perda TEXT",
      "ALTER TABLE contacts ADD COLUMN IF NOT EXISTS tentativas INT DEFAULT 0",
    ]

    for (const sql of sqls) {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MGMT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      })
      const col = sql.match(/ADD COLUMN IF NOT EXISTS (\w+)/)?.[1]
      if (res.ok) {
        console.log(`  Added: ${col}`)
      } else {
        const text = await res.text()
        console.log(`  Error ${col}: ${text.substring(0, 100)}`)
      }
    }

    // Now set defaults for orcamento contacts
    const updates = [
      "UPDATE contacts SET temperatura = 'morno' WHERE origin LIKE 'Orcamento 2023%' OR origin LIKE 'Orcamento 2024%'",
      "UPDATE contacts SET temperatura = 'quente' WHERE origin LIKE 'Orcamento 2025%' OR origin LIKE 'Orcamento 2026%'",
      "UPDATE contacts SET estagio_funil = 'proposta_enviada' WHERE origin LIKE 'Orcamento%'",
    ]

    for (const sql of updates) {
      const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_ID}/database/query`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MGMT_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: sql }),
      })
      console.log(`  Update: ${res.ok ? 'OK' : 'FAIL'}`)
    }

  } else {
    console.log('Columns already exist!')
    console.log('Sample:', test?.[0])
  }
}

main().catch(console.error)
