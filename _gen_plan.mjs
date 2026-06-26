import { createClient } from '@supabase/supabase-js'
import fs from 'fs'
const ref = 'flwbeevtvjiouxdjmziv'
let pat = null
for (const l of fs.readFileSync('d:/MEGA BRAIN/.env', 'utf8').split(/\r?\n/)) {
  const m = l.match(/^\s*SUPABASE_ACCESS_TOKEN\s*=\s*(.*)\s*$/)
  if (m) pat = m[1].replace(/^["']|["']$/g, '')
}
const kr = await (await fetch('https://api.supabase.com/v1/projects/' + ref + '/api-keys?reveal=true', { headers: { Authorization: 'Bearer ' + pat } })).json()
const svc = kr.find(k => /service/i.test(k.name)).api_key
const sb = createClient('https://' + ref + '.supabase.co', svc, { auth: { persistSession: false } })

const { data } = await sb.from('quick_replies')
  .select('slug,title,category,subcategory,media_type')
  .in('category', ['FÁBRICAS DE RAÇÃO', 'EQUIPAMENTOS INDIVIDUAIS', 'LISTA DE PREÇO'])
  .order('category').order('subcategory').order('title')

const emoji = mt => /image/.test(mt) ? '🖼️' : /video/.test(mt) ? '🎥' : '📎'
const seen = new Set()
function atalho(slug) {
  let a = slug.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '')
  a = a.slice(0, 25)
  let base = a, n = 2
  while (seen.has(a)) { a = (base.slice(0, 24) + n).slice(0, 25); n++ }
  seen.add(a)
  return a
}
// fabricas ja criadas (atalhos definidos no batch)
const FAB_CRIADAS = new Set(['compacta 1 jr', 'compacta 1 75300', 'compacta 1 100500', 'compacta 1 1001000', 'compacta 1 celula de carga', 'compacta 1 master 100500', 'compacta 1 master 75300', 'compacta 2 100500', 'compacta 2 2001000', 'compacta 2 2001000 pre limpeza', 'compacta 2 master com ensacadeira', 'compacta 3', 'compacta 3 vertical', 'compacta 3 com baias', 'compacta 3 master', 'compacta 3 master misturador 500 kg', 'compacta 3 master misturador 1000 kg', 'compacta 4 master'])

let md = `# PLANO — Respostas Rápidas Nativas do WhatsApp (gatilhos pro celular)

## Como funciona
- **Atalho** = o que você digita depois do "/". Só **letra e número** (regra do WhatsApp), máx **25 caracteres**.
- **Mensagem** = 🎥 (vídeo) ou 🖼️ (imagem) + o **GATILHO** que a extensão reconhece.
- No celular: digita \`/atalho\` → escolhe na lista → envia → o **PC (extensão ligada)** troca pela mídia.
- A extensão **ignora o emoji** ao reconhecer, então o 🎥/🖼️ é só pra você ver o tipo.

## ⚠️ Limite do WhatsApp: **50 respostas rápidas no total**
- Já usados: **22** → 4 antigos (Catálogo, catalogobba, obrigado, pagamento) + **18 Fábricas** (já criei, sem emoji).
- **Sobram ~28 slots.** Não cabem todos os 207 — você escolhe os mais importantes.

---
`

const byCat = {}
for (const r of data) (byCat[r.category] ||= {}), ((byCat[r.category][r.subcategory] ||= []).push(r))

for (const cat of ['FÁBRICAS DE RAÇÃO', 'EQUIPAMENTOS INDIVIDUAIS', 'LISTA DE PREÇO']) {
  const tipo = cat === 'LISTA DE PREÇO' ? '🖼️ IMAGEM' : '🎥 VÍDEO'
  md += `\n## ${cat}  (${tipo})\n`
  if (cat === 'FÁBRICAS DE RAÇÃO') md += `> ✅ **Já criadas** (sem emoji — são todas vídeo).\n`
  for (const sub of Object.keys(byCat[cat] || {}).sort()) {
    md += `\n### ${sub}\n\n| Atalho (digita /…) | Mensagem (o que aciona) |\n|---|---|\n`
    for (const r of byCat[cat][sub]) {
      const a = atalho(r.slug)
      const flag = r.slug.length > 0 && FAB_CRIADAS.has(r.slug) ? ' ✅' : ''
      md += `| \`${a}\`${a.length === 25 ? ' ⚠️' : ''} | ${emoji(r.media_type)} ${r.slug}${flag} |\n`
    }
  }
}
md += `\n---\n_⚠️ no atalho = bateu o limite de 25 e foi cortado (precisa encurtar)._\n_✅ = já criado no WhatsApp._\n\n**Total no catálogo:** ${data.length} itens. **Cabem só ~28 a mais** (limite 50).\n`

fs.writeFileSync('d:/MEGA BRAIN/_tmp/branorte-crm/PLANO-respostas-rapidas.md', md)
console.log('itens:', data.length, '| doc:', md.length, 'chars')
console.log('por categoria:', JSON.stringify(Object.fromEntries(Object.entries(byCat).map(([k, v]) => [k, Object.values(v).flat().length]))))
