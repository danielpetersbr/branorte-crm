// Portão único de "conta APROVADA" das functions do CRM (29/09/2026).
//
// Por que existe: o signup do Supabase é público e confirma o e-mail sozinho
// (disable_signup=false, mailer_autoconfirm=true), e toda conta nova nasce com
// role='pending' e approved_at NULL (trigger handle_new_auth_user). Os endpoints
// que só faziam `supa.auth.getUser(token)` aceitavam essa conta recém-criada —
// um estranho gastava SPC (~R$ 10 por consulta), OpenAI, CNPJá/Infosimples e
// Chromium de 1 GB com as chaves do servidor, sem ninguém ter aprovado.
//
// A regra é a MESMA do portão do front (App.tsx: sem perfil, sem approved_at,
// 'pending' ou 'rejected' = fora). Se mudar lá, muda aqui — o teste em
// src/lib/exigir-aprovado.test.ts trava os casos.
//
// Import relativo com .js no fim: api/ roda como ESM na Vercel; sem a extensão a
// function morre em produção com ERR_MODULE_NOT_FOUND e o tsc não acusa.
import type { SupabaseClient } from '@supabase/supabase-js'

export interface PerfilDeAcesso {
  role: string | null
  approved_at: string | null
  vendor_id?: number | null
}

/** true só para perfil existente, com approved_at e fora de pending/rejected. */
export function perfilAprovado(perfil: PerfilDeAcesso | null | undefined): perfil is PerfilDeAcesso {
  return !!perfil && !!perfil.approved_at && perfil.role !== 'pending' && perfil.role !== 'rejected'
}

/**
 * Permissão de role_permissions lida FAIL-CLOSED: só passa com `true` explícito.
 * Chave ausente, null, papel sem linha ou erro de leitura = sem permissão.
 * (O dd-consultar barrava só `=== false`, e papel sem linha — pending, rejected,
 * representante — ficava `undefined` e passava para a consulta paga.)
 */
export function permissaoExplicita(permissions: unknown, chave: string): boolean {
  if (!permissions || typeof permissions !== 'object') return false
  return (permissions as Record<string, unknown>)[chave] === true
}

export interface UsuarioAprovado {
  userId: string
  email: string | null
  role: string | null
  vendorId: number | null
  isAdmin: boolean
  /** Entrou pela lista `contasTecnicas` (sem perfil de vendedor). */
  contaTecnica: boolean
}

export type ResultadoAprovacao =
  | { ok: true; usuario: UsuarioAprovado }
  | { ok: false; status: 401 | 403 | 500; error: string; detail?: string }

export interface OpcoesAprovacao {
  /**
   * E-mails aceitos mesmo SEM perfil aprovado. Existe por UM caso: o
   * ia-orcamento-worker (edge, sem ninguém logado) cunha sessão da conta técnica
   * PDF_USER_EMAIL (admin@branorte.com) para chamar /api/gerar-pdf, e essa conta
   * não tem linha em user_profiles. O e-mail vem do GoTrue (JWT já validado), não
   * do corpo da requisição — e signup não cria conta com e-mail que já existe.
   */
  contasTecnicas?: readonly string[]
}

export async function exigirAprovado(
  supa: SupabaseClient,
  token: string,
  opcoes: OpcoesAprovacao = {},
): Promise<ResultadoAprovacao> {
  if (!token) return { ok: false, status: 401, error: 'no_auth' }
  const { data, error } = await supa.auth.getUser(token)
  if (error || !data?.user) return { ok: false, status: 401, error: 'invalid_jwt', detail: error?.message }
  const user = data.user
  const email = user.email ?? null

  const tecnicas = (opcoes.contasTecnicas ?? []).map(e => e.trim().toLowerCase()).filter(Boolean)
  if (email && tecnicas.includes(email.toLowerCase())) {
    return {
      ok: true,
      usuario: { userId: user.id, email, role: null, vendorId: null, isAdmin: false, contaTecnica: true },
    }
  }

  const { data: perfil, error: perfilErr } = await supa
    .from('user_profiles')
    .select('role, approved_at, vendor_id')
    .eq('id', user.id)
    .maybeSingle()
  if (perfilErr) return { ok: false, status: 500, error: 'profile_lookup_failed' }
  const p = perfil as PerfilDeAcesso | null
  if (!perfilAprovado(p)) return { ok: false, status: 403, error: 'not_approved' }

  return {
    ok: true,
    usuario: {
      userId: user.id,
      email,
      role: p.role ?? null,
      vendorId: typeof p.vendor_id === 'number' ? p.vendor_id : null,
      isAdmin: p.role === 'admin' || p.role === 'financeiro',
      contaTecnica: false,
    },
  }
}

export type ResultadoPermissao =
  | { ok: true }
  | { ok: false; status: 403 | 500; error: string }

/**
 * Depois do exigirAprovado: o PAPEL do perfil tem `true` explícito em
 * role_permissions[chave]? (29/09/2026) Aprovado não basta onde o endpoint age
 * com service role em nome de um papel específico — o presign/confirm do
 * orçamento aceitavam visualizador e financeiro (orcamentos.criar = null) e os
 * papéis restritos (mapa, consultor, representante, que nem têm linha lá).
 * Conta técnica (sem papel) não passa. Erro lendo a tabela = 500, nunca "pode".
 */
export async function exigirPermissaoDoPapel(
  supa: SupabaseClient,
  usuario: Pick<UsuarioAprovado, 'role'>,
  chave: string,
): Promise<ResultadoPermissao> {
  if (!usuario.role) return { ok: false, status: 403, error: 'sem_permissao' }
  const { data, error } = await supa
    .from('role_permissions')
    .select('permissions')
    .eq('role', usuario.role)
    .maybeSingle()
  if (error) return { ok: false, status: 500, error: 'permissions_lookup_failed' }
  const perms = (data as { permissions?: unknown } | null)?.permissions
  if (!permissaoExplicita(perms, chave)) return { ok: false, status: 403, error: 'sem_permissao' }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Caminhos do bucket orcamentos-pendentes (presign/confirm)
// ---------------------------------------------------------------------------

/**
 * Nome de arquivo que NÃO sai da pasta onde é montado: sem barra, sem barra
 * invertida, sem caractere de controle. O caminho é `${ano}/${mes}/${base}.docx`;
 * com '/' no base ele escapava de AAAA/MM (ex.: '../_processados/...').
 *
 * '..' SOZINHO não é recusado de propósito: sem barra ele não sobe de pasta, e a
 * descrição que o vendedor digita pode ter reticências ("Fábrica... com silo") —
 * sanitizeNomeArquivo (src/lib/orcamento-nome-arquivo.ts) não tira ponto.
 */
export function nomeDeArquivoSeguro(nome: string): boolean {
  return !!nome && !/[\\/\x00-\x1f\x7f]/.test(nome)
}

/**
 * O base do arquivo pertence ao orçamento `numero`? nomeBase() põe o número no
 * começo ("2026 - 1946 - Cliente (desc)") ou, no modo TESTE, no fim entre
 * parênteses; o sufixo -ALTn vai para o fim do nome. Por isso `includes` do
 * número SEM o -ALT, e não startsWith.
 */
export function baseConfereComNumero(base: string, numero: string | null | undefined): boolean {
  const num = String(numero ?? '').replace(/-ALT\d*$/, '').trim()
  if (!num) return false
  return base.includes(num)
}

// ---------------------------------------------------------------------------
// reuniao-ia: URL de áudio (ramo de compatibilidade)
// ---------------------------------------------------------------------------

/**
 * Só aceita URL https do Storage do PRÓPRIO projeto Supabase
 * (flwbeevtvjiouxdjmziv.supabase.co), no bucket `bucket`. Antes o servidor fazia
 * fetch de qualquer URL que viesse no corpo — fetch cego saindo da Vercel, com o
 * status devolvido no 502 servindo de oráculo.
 */
export function urlDeAudioPermitida(url: string, supaUrl: string, bucket: string): boolean {
  let alvo: URL
  let projeto: URL
  try {
    alvo = new URL(url)
    projeto = new URL(supaUrl)
  } catch {
    return false
  }
  if (alvo.protocol !== 'https:') return false
  if (alvo.username || alvo.password || alvo.port) return false
  if (alvo.hostname.toLowerCase() !== projeto.hostname.toLowerCase()) return false
  const prefixos = ['sign', 'public', 'authenticated'].map(t => `/storage/v1/object/${t}/${bucket}/`)
  if (!prefixos.some(p => alvo.pathname.startsWith(p))) return false
  // Nada de subir de pasta dentro do bucket (literal ou codificado).
  if (/(^|\/)\.\.(\/|$)|%2e%2e|%2f/i.test(alvo.pathname)) return false
  return true
}

// ---------------------------------------------------------------------------
// orcamento-html-to-docx: a lib baixa <img src="http..."> no servidor
// ---------------------------------------------------------------------------

/**
 * A MESMA "minificação" que o html-to-docx 1.8.0 aplica antes de parsear
 * (minifyHTMLString, em node_modules/html-to-docx/dist/html-to-docx.esm.js),
 * copiada regex por regex: o filtro tem que ler exatamente a string que a lib lê.
 * Se a lib subir de versão, conferir se isto mudou lá.
 */
export function minificarComoHtmlToDocx(html: string): string {
  return html
    .replace(/\n/g, ' ')
    .replace(/\r/g, ' ')
    .replace(/\r\n/g, ' ')
    .replace(/[\t]+</g, '<')
    .replace(/>[\t ]+</g, '><')
    .replace(/>[\t ]+$/g, '>')
}

// O html-to-vdom só faz `new VNode(tag, props, filhos, key)` e `new VText(txt)`.
// Construtores mínimos bastam para ler a árvore e poupam depender do virtual-dom.
class NoLido {
  tagName: string
  properties: Record<string, unknown>
  children: unknown[]
  constructor(tagName: string, properties: Record<string, unknown>, children: unknown[]) {
    this.tagName = tagName
    this.properties = properties ?? {}
    this.children = children ?? []
  }
}
class TextoLido {}

/** src que a lib NUNCA baixa: imagem inline `data:` sem "://" em lugar nenhum. */
function srcInlineSeguro(src: unknown): boolean {
  return typeof src === 'string' && src.startsWith('data:') && !src.includes('://')
}

/**
 * true se alguma <img> do HTML tem src que NÃO é imagem inline `data:` — ou se o
 * HTML não pôde ser lido (fail-closed). O endpoint recusa com 400.
 *
 * Por que: a lib html-to-docx baixa NO SERVIDOR toda <img> cujo src casa com o
 * isValidUrl dela (regex SEM âncora: "http(s)://" em qualquer ponto do texto) e
 * embute o conteúdo no DOCX que volta para quem chamou — um proxy de fetch.
 *
 * 29/09/2026 (rodada 2): a 1ª versão era um regex sobre o HTML cru e tinha 3
 * brechas que o parser da lib lê como <img src="http..."> — `alt="x"src=...`
 * (sem espaço), `<img/src=...>` e `alt="a>b" src=...` ('>' dentro das aspas).
 * Regex não acompanha o tokenizador. Agora a leitura é pelo MESMO parser que a
 * lib usa (html-to-vdom 0.7 sobre htmlparser2), na MESMA string minificada, e a
 * regra é lista branca: todo `properties.src` de <img> tem que começar com
 * `data:` e não conter "://" (sem isso o isValidUrl da lib não dispara nunca).
 * O cliente legítimo (src/lib/preview-to-docx-html.ts, inlineImagesAsBase64)
 * manda toda imagem como data:...;base64 (FileReader) ou remove a <img>.
 */
export async function htmlTemImagemExterna(html: string): Promise<boolean> {
  let arvore: unknown
  try {
    // Import dinâmico: este arquivo é importado por ~15 functions e só o
    // html-to-docx precisa do parser (que já vem instalado junto com a lib).
    // @ts-ignore - lib sem tipos
    const mod = await import('html-to-vdom')
    const iniciar = (mod.default ?? mod) as (deps: { VNode: unknown; VText: unknown }) => (h: string) => unknown
    arvore = iniciar({ VNode: NoLido, VText: TextoLido })(minificarComoHtmlToDocx(html))
  } catch {
    return true
  }
  // Pilha em vez de recursão: HTML muito aninhado não estoura a stack aqui.
  const pilha: unknown[] = [arvore]
  while (pilha.length > 0) {
    const no = pilha.pop()
    if (Array.isArray(no)) {
      for (const f of no) pilha.push(f)
      continue
    }
    if (!(no instanceof NoLido)) continue
    if (String(no.tagName).toLowerCase() === 'img' && !srcInlineSeguro(no.properties.src)) return true
    for (const f of no.children) pilha.push(f)
  }
  return false
}
