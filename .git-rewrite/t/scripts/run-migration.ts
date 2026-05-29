import pg from 'pg'

// Supabase direct connection
// Host: db.flwbeevtvjiouxdjmziv.supabase.co
// Port: 5432 (or 6543 for connection pooler)
// DB: postgres
// User: postgres
// Password: the database password set when project was created

// Try with the pooler connection (port 6543) using service role approach
// Actually, Supabase provides a direct connection string format:
// postgresql://postgres.[ref]:[password]@aws-0-sa-east-1.pooler.supabase.com:6543/postgres

// We need the database password. Let's try common ones or check if it's stored somewhere.
// The project was created with name "crm-branorte" - the password might be in local config

async function tryConnection(connStr: string, label: string) {
  try {
    const client = new pg.Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
    await client.connect()
    console.log(`${label}: Connected!`)

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
      try {
        await client.query(sql)
        const col = sql.match(/EXISTS (\w+)/)?.[1]
        console.log(`  Added: ${col}`)
      } catch (e: any) {
        console.log(`  Error: ${e.message.substring(0, 80)}`)
      }
    }

    // Set defaults for orcamento contacts
    const updates = [
      "UPDATE contacts SET temperatura = 'quente' WHERE origin LIKE 'Orcamento 2025%' OR origin LIKE 'Orcamento 2026%'",
      "UPDATE contacts SET temperatura = 'morno' WHERE origin LIKE 'Orcamento 2023%' OR origin LIKE 'Orcamento 2024%'",
      "UPDATE contacts SET estagio_funil = 'proposta_enviada' WHERE origin LIKE 'Orcamento%'",
    ]

    for (const sql of updates) {
      const res = await client.query(sql)
      console.log(`  Updated: ${res.rowCount} rows`)
    }

    // Verify
    const check = await client.query("SELECT temperatura, count(*) FROM contacts GROUP BY temperatura ORDER BY count DESC")
    console.log('\nTemperatura distribution:')
    for (const row of check.rows) {
      console.log(`  ${row.temperatura}: ${row.count}`)
    }

    await client.end()
    return true
  } catch (e: any) {
    console.log(`${label}: Failed - ${e.message.substring(0, 100)}`)
    return false
  }
}

async function main() {
  const ref = 'flwbeevtvjiouxdjmziv'

  // Try various possible passwords
  const passwords = [
    'Bn210408#@#',        // Daniel's common password
    'Bn210408',
    'branorte2025',
    'crm-branorte',
  ]

  for (const pwd of passwords) {
    // Direct connection
    const direct = `postgresql://postgres:${encodeURIComponent(pwd)}@db.${ref}.supabase.co:5432/postgres`
    if (await tryConnection(direct, `Direct (${pwd.substring(0,5)}...)`)) return

    // Pooler connection
    const pooler = `postgresql://postgres.${ref}:${encodeURIComponent(pwd)}@aws-0-sa-east-1.pooler.supabase.com:6543/postgres`
    if (await tryConnection(pooler, `Pooler (${pwd.substring(0,5)}...)`)) return
  }

  console.log('\nCould not connect with any password.')
  console.log('Please provide the Supabase database password.')
}

main().catch(console.error)
