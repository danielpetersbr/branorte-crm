// Portão de "conta aprovada" das functions (api/_lib/exigir-aprovado.ts).
// Mora em src/lib porque o `npm test` só varre src/**/*.test.ts.
import { test } from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  perfilAprovado,
  permissaoExplicita,
  exigirAprovado,
  nomeDeArquivoSeguro,
  baseConfereComNumero,
  urlDeAudioPermitida,
  htmlTemImagemExterna,
  minificarComoHtmlToDocx,
  exigirPermissaoDoPapel,
} from '../../api/_lib/exigir-aprovado.js'
import { authenticateSeller } from '../../api/_lib/orcamento-ai-auth.js'
import { nomeBase } from './orcamento-nome-arquivo'

const APROVADO = '2026-01-10T12:00:00Z'

// Supabase falso: getUser devolve `user`, user_profiles devolve `perfil` e
// role_permissions devolve a linha `{ permissions }` (null = papel sem linha).
function fakeSupa(opts: {
  user?: { id: string; email?: string | null } | null
  userErr?: string
  perfil?: Record<string, unknown> | null
  perfilErr?: string
  permissions?: Record<string, unknown> | null
  permissionsErr?: string
}) {
  const consultas: string[] = []
  const filtros: Array<[string, unknown]> = []
  const client = {
    auth: {
      getUser: async (_t: string) => opts.userErr
        ? { data: { user: null }, error: { message: opts.userErr } }
        : { data: { user: opts.user ?? null }, error: null },
    },
    from: (tabela: string) => {
      consultas.push(tabela)
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => { filtros.push([col, val]); return q },
        maybeSingle: async () => {
          if (tabela === 'role_permissions') {
            return opts.permissionsErr
              ? { data: null, error: { message: opts.permissionsErr } }
              : { data: opts.permissions ? { permissions: opts.permissions } : null, error: null }
          }
          return opts.perfilErr
            ? { data: null, error: { message: opts.perfilErr } }
            : { data: opts.perfil ?? null, error: null }
        },
      }
      return q
    },
  }
  return { supa: client as unknown as SupabaseClient, consultas, filtros }
}

// ---------------------------------------------------------------- perfilAprovado

test('perfilAprovado: só passa perfil existente, com approved_at e fora de pending/rejected', () => {
  assert.equal(perfilAprovado({ role: 'vendor', approved_at: APROVADO }), true)
  assert.equal(perfilAprovado({ role: 'admin', approved_at: APROVADO }), true)
  assert.equal(perfilAprovado({ role: 'representante', approved_at: APROVADO }), true)
  assert.equal(perfilAprovado(null), false)
  assert.equal(perfilAprovado(undefined), false)
  assert.equal(perfilAprovado({ role: 'vendor', approved_at: null }), false)
  assert.equal(perfilAprovado({ role: 'pending', approved_at: APROVADO }), false)
  assert.equal(perfilAprovado({ role: 'rejected', approved_at: APROVADO }), false)
})

// ---------------------------------------------------------------- permissaoExplicita (id 23)

test('permissaoExplicita é fail-closed: só `true` explícito libera a consulta SPC', () => {
  const k = 'due_diligence.consultar'
  assert.equal(permissaoExplicita({ [k]: true }, k), true)
  // Os casos que PASSAVAM com `if (pode === false)`:
  assert.equal(permissaoExplicita({ [k]: null }, k), false)       // financeiro/mapa/visualizador
  assert.equal(permissaoExplicita({}, k), false)                  // chave ausente
  assert.equal(permissaoExplicita(null, k), false)                // papel sem linha (pending, rejected, representante)
  assert.equal(permissaoExplicita(undefined, k), false)
  assert.equal(permissaoExplicita({ [k]: false }, k), false)
  assert.equal(permissaoExplicita({ [k]: 'true' }, k), false)     // string não é true
  assert.equal(permissaoExplicita({ [k]: 1 }, k), false)
})

// ---------------------------------------------------------------- exigirAprovado (ids 23/114/101)

test('exigirAprovado: sem token = 401 no_auth, sem chamar o GoTrue', async () => {
  const { supa } = fakeSupa({ user: { id: 'u1' } })
  const r = await exigirAprovado(supa, '')
  assert.deepEqual(r, { ok: false, status: 401, error: 'no_auth' })
})

test('exigirAprovado: JWT inválido = 401 invalid_jwt', async () => {
  const { supa } = fakeSupa({ userErr: 'bad jwt' })
  const r = await exigirAprovado(supa, 'tok')
  assert.equal(r.ok, false)
  if (!r.ok) {
    assert.equal(r.status, 401)
    assert.equal(r.error, 'invalid_jwt')
  }
})

test('exigirAprovado: conta pending, rejected, sem approved_at ou sem perfil = 403 not_approved', async () => {
  const casos: Array<Record<string, unknown> | null> = [
    { role: 'pending', approved_at: null, vendor_id: null },
    { role: 'rejected', approved_at: APROVADO, vendor_id: null },
    { role: 'vendor', approved_at: null, vendor_id: 3 },
    null, // sem linha em user_profiles (antes caía no fallback 'vendor' do dd-consultar)
  ]
  for (const perfil of casos) {
    const { supa } = fakeSupa({ user: { id: 'u1', email: 'x@y.com' }, perfil })
    const r = await exigirAprovado(supa, 'tok')
    assert.deepEqual(r, { ok: false, status: 403, error: 'not_approved' }, JSON.stringify(perfil))
  }
})

test('exigirAprovado: erro lendo o perfil = 500 (não deixa passar)', async () => {
  const { supa } = fakeSupa({ user: { id: 'u1' }, perfilErr: 'timeout' })
  const r = await exigirAprovado(supa, 'tok')
  assert.deepEqual(r, { ok: false, status: 500, error: 'profile_lookup_failed' })
})

test('exigirAprovado: vendor aprovado passa com role, vendorId e isAdmin', async () => {
  const { supa } = fakeSupa({
    user: { id: 'u9', email: 'vend@branorte.com' },
    perfil: { role: 'vendor', approved_at: APROVADO, vendor_id: 7 },
  })
  const r = await exigirAprovado(supa, 'tok')
  assert.deepEqual(r, {
    ok: true,
    usuario: { userId: 'u9', email: 'vend@branorte.com', role: 'vendor', vendorId: 7, isAdmin: false, contaTecnica: false },
  })
  const { supa: s2 } = fakeSupa({ user: { id: 'u1' }, perfil: { role: 'financeiro', approved_at: APROVADO } })
  const r2 = await exigirAprovado(s2, 'tok')
  assert.equal(r2.ok && r2.usuario.isAdmin, true)
})

test('exigirAprovado: conta técnica (worker de PDF) passa sem perfil, sem nem ler user_profiles', async () => {
  const { supa, consultas } = fakeSupa({ user: { id: 'bot', email: 'Admin@Branorte.com' }, perfil: null })
  const r = await exigirAprovado(supa, 'tok', { contasTecnicas: ['admin@branorte.com'] })
  assert.equal(r.ok, true)
  if (r.ok) assert.equal(r.usuario.contaTecnica, true)
  assert.deepEqual(consultas, [])
})

test('exigirAprovado: a exceção técnica é por e-mail exato — outra conta sem perfil continua 403', async () => {
  const { supa } = fakeSupa({ user: { id: 'x', email: 'admin@branorte.com.evil.io' }, perfil: null })
  const r = await exigirAprovado(supa, 'tok', { contasTecnicas: ['admin@branorte.com', '', '  '] })
  assert.deepEqual(r, { ok: false, status: 403, error: 'not_approved' })
  // Conta sem e-mail não casa com entrada vazia da lista.
  const { supa: s2 } = fakeSupa({ user: { id: 'y', email: null }, perfil: null })
  const r2 = await exigirAprovado(s2, 'tok', { contasTecnicas: [''] })
  assert.equal(r2.ok, false)
})

test('authenticateSeller (orcamento-ai) mantém o formato e as respostas de antes', async () => {
  const { supa } = fakeSupa({ user: { id: 'u9', email: 'v@b.com' }, perfil: { role: 'admin', approved_at: APROVADO, vendor_id: null } })
  assert.deepEqual(await authenticateSeller(supa, 'tok'), {
    ok: true,
    seller: { userId: 'u9', email: 'v@b.com', sellerId: null, isAdmin: true },
  })
  const { supa: p } = fakeSupa({ user: { id: 'u1' }, perfil: { role: 'pending', approved_at: null } })
  assert.deepEqual(await authenticateSeller(p, 'tok'), { ok: false, status: 403, error: 'not_approved' })
  const { supa: bad } = fakeSupa({ userErr: 'expired' })
  // Sem `detail` — o orcamento-ai nunca expôs a mensagem do GoTrue.
  assert.deepEqual(await authenticateSeller(bad, 'tok'), { ok: false, status: 401, error: 'invalid_jwt' })
})

// ---------------------------------------------------------------- presign/confirm (ids 98/99)

test('nomeDeArquivoSeguro: barra, barra invertida e controle saem; reticências ficam', () => {
  assert.equal(nomeDeArquivoSeguro('2026 - 1946 - Phillip Neves Machado (Fabrica Master)'), true)
  assert.equal(nomeDeArquivoSeguro('2026 - 1946 - Joao (Fabrica... com silo)'), true)
  assert.equal(nomeDeArquivoSeguro('TESTE-12-34-56-cliente (2026 - 1946)'), true)
  assert.equal(nomeDeArquivoSeguro('../_processados/2026/09/x'), false)
  assert.equal(nomeDeArquivoSeguro('a/b'), false)
  assert.equal(nomeDeArquivoSeguro('a\\b'), false)
  assert.equal(nomeDeArquivoSeguro('a\nb'), false)
  assert.equal(nomeDeArquivoSeguro('a\u0000b'), false)
  assert.equal(nomeDeArquivoSeguro(''), false)
})

test('nomeDeArquivoSeguro aceita TODO nome que o front gera (nomeBase), inclusive com barra no cliente', () => {
  const agora = new Date('2026-09-29T12:34:56Z')
  const nomes = [
    nomeBase('2026 - 1946', 'Phillip / Neves \\ Machado', 'Fabrica Master com moega e silos 56,63 m³'),
    nomeBase('2026 - 1946-ALT2', 'Cliente: "Ltda" <ME>', 'desc?*|'),
    nomeBase('2026 - 0001', 'Fulano', ''),
    nomeBase('2026 - 0001', 'Fulano\tTab', 'x'.repeat(400)),
    nomeBase('2026 - 1946', 'Joao', 'teste', true, agora),
  ]
  for (const n of nomes) assert.equal(nomeDeArquivoSeguro(n), true, n)
})

test('baseConfereComNumero: casa o base que o nomeBase monta (normal, -ALT e TESTE)', () => {
  const agora = new Date('2026-09-29T12:34:56Z')
  const casos: Array<[string, string]> = [
    ['2026 - 1946', nomeBase('2026 - 1946', 'Phillip', 'Fabrica')],
    ['2026 - 1946-ALT2', nomeBase('2026 - 1946-ALT2', 'Phillip', 'Fabrica')],
    ['2026 - 1946-ALT', nomeBase('2026 - 1946-ALT', 'Phillip', 'Fabrica')],
    ['2026 - 1946', nomeBase('2026 - 1946', 'Phillip', 'Fabrica', true, agora)],
    ['2026 - 1946-ALT3', nomeBase('2026 - 1946-ALT3', 'Phillip', 'Fabrica', true, agora)],
  ]
  for (const [numero, base] of casos) assert.equal(baseConfereComNumero(base, numero), true, `${numero} → ${base}`)
})

test('baseConfereComNumero: base de OUTRO orçamento não confirma', () => {
  assert.equal(baseConfereComNumero('2026 - 2851 - Outro Cliente (Silo)', '2026 - 1946'), false)
  assert.equal(baseConfereComNumero('2026 - 1946 - X (Y)', null), false)
  assert.equal(baseConfereComNumero('2026 - 1946 - X (Y)', ''), false)
  assert.equal(baseConfereComNumero('qualquer', '-ALT2'), false)
})

// ---------------------------------------------------------------- reuniao-ia (id 112)

const SUPA = 'https://flwbeevtvjiouxdjmziv.supabase.co'

test('urlDeAudioPermitida: aceita só o Storage do projeto, no bucket reunioes-audio', () => {
  assert.equal(urlDeAudioPermitida(`${SUPA}/storage/v1/object/public/reunioes-audio/abc/p1.webm`, SUPA, 'reunioes-audio'), true)
  assert.equal(urlDeAudioPermitida(`${SUPA}/storage/v1/object/sign/reunioes-audio/abc/p1.webm?token=x`, SUPA, 'reunioes-audio'), true)
})

test('urlDeAudioPermitida: recusa host alheio, http, IP interno, outro bucket e subida de pasta', () => {
  const b = 'reunioes-audio'
  const ruins = [
    'http://169.254.169.254/latest/meta-data/',
    'http://flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/public/reunioes-audio/a.webm',
    'https://evil.com/storage/v1/object/public/reunioes-audio/a.webm',
    'https://flwbeevtvjiouxdjmziv.supabase.co.evil.com/storage/v1/object/public/reunioes-audio/a.webm',
    'https://outroprojeto.supabase.co/storage/v1/object/public/reunioes-audio/a.webm',
    `${SUPA}/storage/v1/object/public/orcamentos-pendentes/2026/09/x.pdf`,
    `${SUPA}/storage/v1/object/public/reunioes-audio/%2e%2e/orcamentos-pendentes/x.pdf`,
    `${SUPA}/rest/v1/user_profiles`,
    `https://user:pw@flwbeevtvjiouxdjmziv.supabase.co/storage/v1/object/public/reunioes-audio/a.webm`,
    'https://flwbeevtvjiouxdjmziv.supabase.co:8443/storage/v1/object/public/reunioes-audio/a.webm',
    'file:///etc/passwd',
    'nao e url',
    'undefined',
  ]
  for (const u of ruins) assert.equal(urlDeAudioPermitida(u, SUPA, b), false, u)
})

// ---------------------------------------------------------------- html-to-docx (id 101)

// Oráculo: o que o html-to-docx 1.8.0 faz de verdade. Mesma minificação, o MESMO
// parser (html-to-vdom com o VNode/VText reais do virtual-dom) e o isValidUrl da
// lib copiado de dist/html-to-docx.esm.js. true = a lib baixaria no servidor.
const requireCjs = createRequire(import.meta.url)
const HTMLToVDOM = requireCjs('html-to-vdom')
const converterDaLib = HTMLToVDOM({
  VNode: requireCjs('virtual-dom/vnode/vnode'),
  VText: requireCjs('virtual-dom/vnode/vtext'),
})
const isValidUrlDaLib = (s: unknown) =>
  /http(s)?:\/\/(\w+:?\w*@)?(\S+)(:\d+)?((?<=\.)\w+)+(\/([\w#!:.?+=&%@!\-/])*)?/gi.test(String(s))
function libBaixaria(html: string): boolean {
  let baixa = false
  const andar = (n: any): void => {
    if (!n) return
    if (Array.isArray(n)) { n.forEach(andar); return }
    if (n.tagName === 'img' && isValidUrlDaLib(n.properties?.src)) baixa = true
    ;(n.children || []).forEach(andar)
  }
  andar(converterDaLib(minificarComoHtmlToDocx(html)))
  return baixa
}

test('htmlTemImagemExterna: as 3 brechas do regex (e primas) — a lib BAIXARIA e o filtro recusa', async () => {
  const ataques = [
    '<p><img src="http://evil.com/a.png"></p>',
    '<p><img alt="x"src="http://evil.com/a.png"></p>',          // (a) sem espaço antes de src
    '<p><img/src="http://evil.com/a.png"></p>',                 // (b) barra no lugar do espaço
    '<p><img alt="a>b" src="http://evil.com/a.png"></p>',       // (c) '>' dentro das aspas
    '<IMG alt="a" SRC=\'https://evil.com/a.png\'>',              // maiúsculas
    '<img src="data:image/png;base64,AA" SRC="http://evil.com/a.png">', // src duplicado: vale o último
    '<img\nsrc="http://evil.com/a.png">',
    '<img\tsrc="http://10.0.0.1/a.png">',
    '<img src="  http://evil.com/a.png">',                      // isValidUrl da lib não tem âncora
    '<img src=http://evil.com/a.png>',
    '<table><tr><td><div><span><img src="https://169.254.169.254/latest/meta-data/x.png"></span></div></td></tr></table>',
  ]
  for (const h of ataques) {
    assert.equal(libBaixaria(h), true, `premissa: a lib baixaria ${JSON.stringify(h)}`)
    assert.equal(await htmlTemImagemExterna(h), true, h)
  }
})

test('htmlTemImagemExterna: lista branca — src que não é data: puro é recusado mesmo sem a lib baixar', async () => {
  const recusados = [
    '<img src="//evil.com/a.png">',
    '<img src="data:image/png;base64,AA http://evil.com/a.png">', // "://" dentro do data:
    '<img alt="sem src">',
    '<img src="">',
    '<img src="&#104;ttp://evil.com/a.png">',
    '<img src="DATA:image/png;base64,AA">',
    '<img src="/etc/passwd.png">',
  ]
  for (const h of recusados) assert.equal(await htmlTemImagemExterna(h), true, h)
})

test('htmlTemImagemExterna: o HTML que o cliente manda (imagens data:;base64) passa', async () => {
  const b64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/'
  const passam = [
    `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family: Calibri, sans-serif; font-size: 11pt; color: #1f2937;"><table><tr><td><img src="data:image/jpeg;base64,${b64}" style="width: 120px; height: 80px;"></td><td><p>Fábrica Master — <a href="https://branorte.com">branorte.com</a></p></td></tr></table><img src="data:image/png;base64,iVBORw0KGgo=" alt="logo"></body></html>`,
    '<img style="width:10px" src="data:image/png;base64,AAAA">',
    '<img data-src="https://x.com/a.png" src="data:image/png;base64,AA">',
    // Texto do orçamento escapado pelo React não é tag.
    '<p>&lt;img src="https://x.com/a.png"&gt; e https://branorte.com</p>',
    '<a href="https://branorte.com">site</a>',
    // Comentário e valor de atributo não viram <img> no parser.
    '<!-- <img src="http://evil.com/a.png"> --><p>x</p>',
    '<img alt=\'<img src="http://evil.com/a.png">\' src="data:image/png;base64,AA">',
    '<p>sem imagem nenhuma</p>',
  ]
  for (const h of passam) {
    assert.equal(libBaixaria(h), false, `premissa: a lib NÃO baixaria ${h.slice(0, 80)}`)
    assert.equal(await htmlTemImagemExterna(h), false, h.slice(0, 120))
  }
})

// ---------------------------------------------------------------- papel no presign/confirm (id 98)

test('exigirPermissaoDoPapel: só `true` explícito do papel do perfil libera orcamentos.criar', async () => {
  const k = 'orcamentos.criar'
  for (const role of ['admin', 'vendor', 'marketing']) {
    const { supa, filtros } = fakeSupa({ permissions: { [k]: true } })
    assert.deepEqual(await exigirPermissaoDoPapel(supa, { role }, k), { ok: true }, role)
    assert.deepEqual(filtros, [['role', role]])
  }
  // visualizador/financeiro: chave null no banco; mapa/representante/consultor: sem linha.
  const negados: Array<Record<string, unknown> | null> = [{ [k]: null }, {}, null, { [k]: false }, { [k]: 'true' }]
  for (const permissions of negados) {
    const { supa } = fakeSupa({ permissions })
    assert.deepEqual(
      await exigirPermissaoDoPapel(supa, { role: 'visualizador' }, k),
      { ok: false, status: 403, error: 'sem_permissao' },
      JSON.stringify(permissions),
    )
  }
})

test('exigirPermissaoDoPapel: conta técnica (sem papel) = 403 sem consultar; erro de leitura = 500', async () => {
  const { supa, consultas } = fakeSupa({ permissions: { 'orcamentos.criar': true } })
  assert.deepEqual(await exigirPermissaoDoPapel(supa, { role: null }, 'orcamentos.criar'), { ok: false, status: 403, error: 'sem_permissao' })
  assert.deepEqual(consultas, [])
  const { supa: s2 } = fakeSupa({ permissionsErr: 'timeout' })
  assert.deepEqual(
    await exigirPermissaoDoPapel(s2, { role: 'vendor' }, 'orcamentos.criar'),
    { ok: false, status: 500, error: 'permissions_lookup_failed' },
  )
})

test('orcamento-presign não apaga nada antes de assinar: sem remove(), com upsert', () => {
  const fonte = readFileSync(new URL('../../api/orcamento-presign.ts', import.meta.url), 'utf8')
  const codigo = fonte.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
  assert.equal(/\.remove\(/.test(codigo), false, 'remove() voltou para o presign')
  assert.match(codigo, /createSignedUploadUrl\(path, \{ upsert: true \}\)/)
  for (const arq of ['orcamento-presign.ts', 'orcamento-confirm.ts']) {
    const f = readFileSync(new URL(`../../api/${arq}`, import.meta.url), 'utf8')
    assert.match(f, /exigirPermissaoDoPapel\(supa, acesso\.usuario, 'orcamentos\.criar'\)/, arq)
  }
})
