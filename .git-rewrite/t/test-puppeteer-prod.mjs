// Testa /api/gerar-pdf em prod com JWT real do supabase
// Login com user de teste, depois chama endpoint

import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'fs'

const SUPA_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co'
const ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const USER_EMAIL = process.env.TEST_USER_EMAIL || ''
const USER_PASS = process.env.TEST_USER_PASS || ''

if (!ANON_KEY || !USER_EMAIL || !USER_PASS) {
  console.error('Faltam env: SUPABASE_ANON_KEY, TEST_USER_EMAIL, TEST_USER_PASS')
  process.exit(1)
}

const supa = createClient(SUPA_URL, ANON_KEY, { auth: { persistSession: false } })
console.log('[test] Login...')
const { data: signin, error: signinErr } = await supa.auth.signInWithPassword({
  email: USER_EMAIL,
  password: USER_PASS,
})
if (signinErr) throw signinErr
const accessToken = signin.session?.access_token
console.log('[test] Login OK, token len:', accessToken?.length)

const previewProps = {
  numero: '2026 - 9999',
  dataEmissao: '26/05/2026',
  cliente: { nome: 'TESTE', ac: 'TESTE', fone: '+5548999999999' },
  voltagem: 'trifasico',
  carrinho: [{
    uid: '1', nome: 'TRITURADOR DE GRÃOS 50 CV', qtd: 1, valor: 51503,
    specs: ['Construído em aço galvanizado', 'Capacidade 5.000 kg/h'],
    motor_cv: 50, motor_polos: 2, motor_qtd: 1, foto_url: null, brinde: false,
  }],
  motoresAgrupados: [{ cv: 50, polos: 2, qtd: 1, valor_unit: 24122, valor_total: 24122, item_nome: 'TRITURADOR' }],
  acessorios: null,
  totalItems: 51503, totalMotores: 24122, totalEquip: 51503, totalGeral: 75625,
  fotoPrincipal: null, tensaoMotores: null, desconto: null,
  termsInline: { dataVenda: '26/05/2026', prazoEntrega: '90 dias', formaPagamento: 'À vista' },
  parcelas: [], componentesExtras: [],
}

console.log('[test] Chamando /api/gerar-pdf em prod...')
const t0 = Date.now()
const res = await fetch('https://branorte-crm.vercel.app/api/gerar-pdf', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${accessToken}`,
  },
  body: JSON.stringify({ previewProps }),
})

console.log(`[test] Status ${res.status} em ${Date.now() - t0}ms`)

if (!res.ok) {
  const txt = await res.text()
  console.error('[test] ERRO:', txt.slice(0, 2000))
  process.exit(1)
}

const buf = Buffer.from(await res.arrayBuffer())
writeFileSync('d:/tmp/prod-puppeteer.pdf', buf)
console.log(`[test] PDF salvo: d:/tmp/prod-puppeteer.pdf (${buf.length} bytes)`)
