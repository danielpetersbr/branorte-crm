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

const esc = s => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const isFoto = mt => /image/.test(mt)
const seen = new Set()
function atalho(slug, mt, sub) {
  const foto = isFoto(mt)
  const prefix = foto ? 'fp' : 'v'
  const uniq = a0 => { let a = a0.slice(0, 25), base = a, n = 2; while (seen.has(a)) { a = (base.slice(0, 24) + n).slice(0, 25); n++ } seen.add(a); return a }
  if (/\bALIMENTADOR\b/i.test(sub || '')) {
    const m = slug.match(/(\d+)\s*x\s*([\d\s]+?)\s*$/)
    const d = m ? (m[1] + 'x' + m[2].replace(/\s+/g, '')) : ''
    return uniq(prefix + 'alimentador' + d)
  }
  let body = slug.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  body = body.replace(/^preco\s+/, '')
  body = body.replace(/\b(semiautomatica|saco|para|transportadora|sacaria|litros|de|com|material)\b/g, ' ')
  body = body.replace(/\bmisturador\b/g, 'mist')
  body = body.replace(/\bpolimeros?\b/g, 'polimero')
  if (/polimero/.test(body)) body = body.replace(/\bvertical\b/g, ' ')
  const ehCompacta = /\bcompacta\b/.test(slug)
  if (foto && ehCompacta) body = body.replace(/\bcompacta\s+/g, '')
  if (ehCompacta) body = body.replace(/\bensacadeira\b/g, ' ')
  body = body.replace(/[^a-z0-9]/g, '')
  return uniq(prefix + body)
}
const FAB = new Set(['compacta 1 jr', 'compacta 1 75300', 'compacta 1 100500', 'compacta 1 1001000', 'compacta 1 celula de carga', 'compacta 1 master 100500', 'compacta 1 master 75300', 'compacta 2 100500', 'compacta 2 2001000', 'compacta 2 2001000 pre limpeza', 'compacta 2 master com ensacadeira', 'compacta 3', 'compacta 3 vertical', 'compacta 3 com baias', 'compacta 3 master', 'compacta 3 master misturador 500 kg', 'compacta 3 master misturador 1000 kg', 'compacta 4 master'])
const USADOS = 22, LIMITE = 50, SOBRAM = LIMITE - USADOS

const byCat = {}
for (const r of data) (byCat[r.category] ||= {}), ((byCat[r.category][r.subcategory] ||= []).push(r))

let body = ''
const catCor = { 'FÁBRICAS DE RAÇÃO': '#0a7d3c', 'EQUIPAMENTOS INDIVIDUAIS': '#1769aa', 'LISTA DE PREÇO': '#b8860b' }
for (const cat of ['FÁBRICAS DE RAÇÃO', 'EQUIPAMENTOS INDIVIDUAIS', 'LISTA DE PREÇO']) {
  const tipo = cat === 'LISTA DE PREÇO' ? 'fp = foto/preço' : 'v = vídeo'
  const n = Object.values(byCat[cat]).flat().length
  body += `<h2 style="color:${catCor[cat]}">${esc(cat)} <small>(${tipo} · ${n} itens)</small></h2>`
  if (cat === 'FÁBRICAS DE RAÇÃO') body += `<p class="ja">✅ Essas 18 já estão criadas (não contam — já estão nos 22 usados).</p>`
  for (const sub of Object.keys(byCat[cat]).sort()) {
    body += `<h3>${esc(sub)}</h3><table><thead><tr><th style="width:34px">✓</th><th>Atalho <span class=mut>(digita /…)</span></th><th>Mensagem <span class=mut>(texto puro que aciona)</span></th></tr></thead><tbody>`
    for (const r of byCat[cat][sub]) {
      const a = atalho(r.slug, r.media_type, r.subcategory)
      const cut = a.length === 25
      const ja = FAB.has(r.slug)
      const cls = isFoto(r.media_type) ? 'foto' : 'vid'
      const ck = ja ? '<td class=ck title="já criada">✅</td>' : `<td class=ck><input type="checkbox" class="pick" data-slug="${esc(r.slug)}" data-atalho="${esc(a)}"></td>`
      body += `<tr${ja ? ' class=jacriado' : ''}>${ck}<td><code class="${cls}${cut ? ' cut' : ''}">${esc(a)}</code>${cut ? ' <span class=warn>✂️</span>' : ''}</td><td>${esc(r.slug)}${ja ? ' <span class=ok>✅</span>' : ''}</td></tr>`
    }
    body += `</tbody></table>`
  }
}

const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Plano — Respostas Rápidas Branorte</title>
<style>
:root{--g:#0a7d3c}
*{box-sizing:border-box}
body{font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:940px;margin:0 auto;padding:14px;color:#1a1f25;background:#f6f8fa;line-height:1.45}
h1{color:var(--g);margin:0 0 4px}
.box{background:#fff;border:1px solid #e3e8ee;border-radius:12px;padding:12px 15px;margin:12px 0;box-shadow:0 1px 4px rgba(0,0,0,.04)}
.box b{color:var(--g)}
.lim{background:#fff7e6;border-color:#f0d28a}
.counter{position:sticky;top:0;z-index:50;background:var(--g);color:#fff;padding:11px 16px;border-radius:10px;margin:10px 0;font-size:15px;display:flex;align-items:center;gap:14px;flex-wrap:wrap;box-shadow:0 3px 12px rgba(0,0,0,.18)}
.counter b{font-size:18px}
.counter.over{background:#c0392b}
.counter button{margin-left:auto;background:#fff;color:var(--g);border:0;padding:7px 12px;border-radius:7px;font-weight:700;cursor:pointer;font-size:13px}
h2{margin:24px 0 6px;padding-bottom:6px;border-bottom:2px solid #eef1f4}
h3{margin:14px 0 6px;font-size:15px;color:#42505f}
small{font-weight:400;color:#7a828c;font-size:13px}
table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #e3e8ee;border-radius:8px;overflow:hidden;margin-bottom:6px}
th,td{text-align:left;padding:6px 10px;border-bottom:1px solid #eef1f4;font-size:14px;vertical-align:middle}
th{background:#f0f3f6;font-size:12px;color:#5a636d}
tr:last-child td{border-bottom:0}
td.ck{text-align:center}
.pick{width:19px;height:19px;cursor:pointer;accent-color:var(--g)}
code{padding:2px 7px;border-radius:5px;font-size:13px;font-weight:700}
code.vid{background:#e7f4ec;color:#0a7d3c}
code.foto{background:#fdf3e0;color:#b8860b}
code.cut{outline:2px solid #f3b0a8}
.warn{color:#c0392b}
.mut{color:#9aa1a9;font-weight:400;font-size:11px}
.ja{color:#0a7d3c;font-weight:600;margin:4px 0}
tr.jacriado{opacity:.55}
tr.sel{background:#e7f7ed}
tr.sel td{font-weight:600}
.ok{color:#0a7d3c}
.foot{margin:20px 0 60px;color:#7a828c;font-size:13px}
.leg code{margin:0 2px}
</style></head><body>
<h1>📋 Plano — Respostas Rápidas Nativas do WhatsApp</h1>
<div class="counter" id="counter">
  <span>✅ Já criadas: <b>${USADOS}</b> (fixas)</span>
  <span>🟩 Marcadas: <b id="sel">0</b></span>
  <span>Total: <b id="tot">${USADOS}</b>/${LIMITE}</span>
  <span id="restMsg">Pode marcar mais <b id="rem">${SOBRAM}</b></span>
  <button id="copybtn">📋 Copiar marcados</button>
</div>
<div class="box">
<b>Marque ✓</b> nas que você quer cadastrar. A linha fica <b style="background:#e7f7ed;padding:0 4px;border-radius:3px">verde</b> e o contador conta sozinho. Quando passar de <b>${SOBRAM}</b>, a barra fica <span style="color:#c0392b;font-weight:700">vermelha</span>.<br><br>
<b>Atalho</b> = digita depois do "/". <span class=leg><code class=vid>v…</code> = vídeo · <code class=foto>fp…</code> = foto/preço</span>. <b>Mensagem</b> = texto puro que aciona o envio.<br>
👉 no celular: <code class=vid>/v</code> mostra os vídeos, <code class=foto>/fp</code> mostra os preços.
</div>
<div class="box lim">
⚠️ <b>Limite do WhatsApp: 50 no total.</b> Já usei <b>${USADOS}</b> (4 antigos + 18 fábricas) → <b>sobram ${SOBRAM}</b>. <span class="warn">✂️ = atalho cortou (me dá apelido)</span>.
</div>
${body}
<p class="foot">Catálogo real (${data.length} itens). ✅ = já criada · ✂️ = cortou. Sua seleção fica salva mesmo se recarregar.</p>
<script>
const SOBRAM=${SOBRAM}, USADOS=${USADOS};
const $=id=>document.getElementById(id);
function update(){
  const picks=[...document.querySelectorAll('.pick:checked')];
  const sel=picks.length;
  $('sel').textContent=sel;
  $('tot').textContent=USADOS+sel;
  const rem=SOBRAM-sel;
  $('rem').textContent=Math.max(0,rem);
  const c=$('counter');
  if(rem<0){c.classList.add('over');$('restMsg').innerHTML='⚠️ PASSOU! tira <b>'+(-rem)+'</b>';}
  else {c.classList.remove('over');$('restMsg').innerHTML='Pode marcar mais <b id=rem>'+rem+'</b>';}
  document.querySelectorAll('.pick').forEach(p=>p.closest('tr').classList.toggle('sel',p.checked));
  try{localStorage.setItem('bnrSel',JSON.stringify(picks.map(p=>p.dataset.slug)));}catch(e){}
}
document.querySelectorAll('.pick').forEach(p=>p.addEventListener('change',update));
try{const s=JSON.parse(localStorage.getItem('bnrSel')||'[]');document.querySelectorAll('.pick').forEach(p=>{if(s.includes(p.dataset.slug))p.checked=true;});}catch(e){}
$('copybtn').addEventListener('click',()=>{
  const picks=[...document.querySelectorAll('.pick:checked')];
  const txt=picks.map(p=>p.dataset.atalho+'  |  '+p.dataset.slug).join('\\n');
  navigator.clipboard.writeText(txt).then(()=>alert('Copiado '+picks.length+' marcados! Cola pro Claude.')).catch(()=>alert('Copia manual:\\n\\n'+txt));
});
update();
</script>
</body></html>`

fs.writeFileSync('d:/MEGA BRAIN/_tmp/branorte-crm/PLANO-respostas-rapidas.html', html)
console.log('itens:', data.length, '| html:', html.length, 'chars')
