// Escaneia a pasta de orçamentos (Z:\1 - Comercial\3 - Orçamento\YYYY\Orçamentos YYYY)
// usando File System Access API do Chrome.
// Uso: usuário clica em "Sincronizar com pasta", escolhe a pasta uma vez.
// O handle é salvo em IndexedDB pra persistir entre sessões.

const DB_NAME = 'branorte-orcamento-folder'
const STORE_NAME = 'handles'
const HANDLE_KEY = 'orcamentos-root'

// IndexedDB helpers (simples)
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      req.result.createObjectStore(STORE_NAME)
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function dbGet<T>(key: string): Promise<T | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const req = tx.objectStore(STORE_NAME).get(key)
    req.onsuccess = () => resolve(req.result ?? null)
    req.onerror = () => reject(req.error)
  })
}

async function dbSet(key: string, value: any): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).put(value, key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

async function dbDelete(key: string): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.objectStore(STORE_NAME).delete(key)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

// Esquece a pasta guardada NESTE navegador. Serve pros casos em que a pasta não
// volta sozinha (permissão negada/vencida, pasta que sumiu do PC, handle preso num
// mês antigo): sem isso o vendedor levava o mesmo aviso em TODO orçamento seguinte.
// Sem pasta guardada o modal já nasce no caminho do servidor, que entrega no Z:\
// pelo sincronizador (desde junho/2026 é ele quem entrega ~100% dos orçamentos).
export async function esquecerPastaSalva(): Promise<void> {
  try {
    await dbDelete(HANDLE_KEY)
  } catch (e) {
    console.warn('Não consegui esquecer a pasta salva:', (e as Error).message)
  }
}

export interface FalhaPasta {
  /** frase curta, em português de vendedor, do que aconteceu */
  motivo: string
  /** true = não adianta repetir neste navegador sem reescolher a pasta */
  permanente: boolean
}

// Traduz o erro cru da File System Access API pro que o vendedor precisa saber.
// Antes o app chutava "provável virada de mês" pra QUALQUER falha de pasta e
// gravava isso como ERRO — o card ficava vermelho ("FALHA AO SALVAR") num
// orçamento que o servidor tinha salvo e entregado no Z:\ (2026-2460 em 08/09,
// 2026-2858 do ALVARO em 29/09/2026: entregue_z_at 33 s depois).
export function classificarFalhaPasta(e: unknown): FalhaPasta {
  const err = e as { name?: string; message?: string } | null
  const nome = err?.name ?? ''
  const msg = (err?.message ?? String(e ?? '')).trim()

  // Primeiro o timeout do withTimeout: o rótulo dele fala de pasta/permissão e
  // não pode cair nas regras de baixo — Z:\ lento é transitório, não desliga nada.
  if (/tempo esgotado/i.test(msg)) {
    return { motivo: 'o Z:\\ não respondeu a tempo', permanente: false }
  }
  if (nome === 'AbortError' || /\babort|cancel/i.test(msg)) {
    return { motivo: 'a janela de escolher a pasta foi fechada', permanente: false }
  }
  // requestPermission() do Chrome só é aceito nos ~5 s seguintes a um clique. Com a
  // reserva da pasta colada no clique (passo 0 do FinalizarMontarModal), isso só
  // acontece se o vendedor demorou numa confirmação antes — no próximo orçamento
  // dá certo. Transitório (29/09/2026): esquecer a pasta aqui obrigava a
  // reconfigurar uma pasta que estava boa.
  if (/user activation|user gesture/i.test(msg)) {
    return {
      motivo: 'o Chrome só libera a pasta logo depois do clique, e o pedido saiu tarde',
      permanente: false,
    }
  }
  // Permissão negada de verdade: pelo NOME do DOMException (o escreverArquivo
  // preserva) ou pelo texto que o próprio passo 0 lança quando o
  // getStoredFolderHandle(true) volta vazio. NÃO casa "permiss" solto na mensagem:
  // era assim que arquivo travado virava "sem permissão" e a pasta era esquecida.
  if (nome === 'NotAllowedError' || nome === 'SecurityError' || /^Permissão de escrita negada/i.test(msg)) {
    return {
      motivo: 'o navegador não deu permissão de escrita na pasta (ela vence quando o Chrome fecha)',
      permanente: true,
    }
  }
  // Arquivo travado (aberto no Word, sincronizador do Drive mexendo) ou Z:\ ocupado:
  // passa sozinho, não é motivo pra desligar a pasta.
  if (nome === 'NoModificationAllowedError' || nome === 'InvalidModificationError' || nome === 'InvalidStateError') {
    return {
      motivo: 'o Z:\\ não deixou gravar agora (arquivo aberto em outro programa ou pasta ocupada)',
      permanente: false,
    }
  }
  if (nome === 'NotFoundError' || /not (be )?found|n[ãa]o encontrad/i.test(msg)) {
    return { motivo: 'a pasta configurada não existe mais neste PC (Z:\\ desconectado?)', permanente: true }
  }
  // Textos que o próprio resolverPastaDoMes devolve em `motivo`
  if (/^A pasta salva é/i.test(msg)) {
    return { motivo: 'a pasta configurada é a de um mês antigo', permanente: true }
  }
  if (/n[ãa]o parece a de or[çc]amentos/i.test(msg)) {
    return { motivo: 'a pasta configurada não é a de orçamentos', permanente: true }
  }
  return { motivo: msg || 'erro não identificado', permanente: false }
}

// Frase única pro card do vendedor quando a gravação direta caiu mas o orçamento
// foi inteiro pelo servidor. NÃO é falha: nada se perdeu.
export function avisoPastaViaServidor(falha: FalhaPasta): string {
  const base = `Não gravei direto na pasta (${falha.motivo}). O orçamento foi pelo servidor e chega no Z:\\ em até 30s — nada se perdeu.`
  return falha.permanente
    ? `${base} Desliguei a pasta deste navegador; pra voltar a gravar direto, abra "Finalizar" e clique em "Trocar pasta", escolhendo a pasta BASE "3 - Orçamento".`
    : base
}

// O card do fim do save fica VERMELHO ("FALHA AO SALVAR" + "Reabrir e tentar de
// novo") só quando alguma saída falhou de verdade. `aviso` fica fora da conta de
// propósito (29/09/2026): o "Tentar de novo" num orçamento já salvo convidava o
// vendedor a regerar — pares de duplicata do mesmo cliente+valor em <15 min.
export function saveFalhou(r: {
  erro?: string | null
  pdfErro?: string | null
  salvouNaPasta: boolean
  baixouDocx: boolean
}): boolean {
  return !!(r.erro || r.pdfErro || (!r.salvouNaPasta && !r.baixouDocx))
}

export function isFolderScanSupported(): boolean {
  if (typeof window === 'undefined') return false
  // showDirectoryPicker existe em Chrome Android mas LANCA erro quando chamado
  // (File System Access API só funciona em Chrome desktop). Detectamos mobile
  // via userAgent pra evitar mostrar botao "Salvar na pasta" que vai falhar.
  const ua = navigator.userAgent || ''
  const isMobile = /Android|iPhone|iPad|iPod|Mobile|Opera Mini/i.test(ua)
  if (isMobile) return false
  return typeof (window as any).showDirectoryPicker === 'function'
}

// Verifica permissão atual do handle salvo
async function verifyPermission(handle: any, write = false): Promise<boolean> {
  const opts: any = write ? { mode: 'readwrite' } : { mode: 'read' }
  if ((await handle.queryPermission(opts)) === 'granted') return true
  if ((await handle.requestPermission(opts)) === 'granted') return true
  return false
}

export async function pickOrcamentoFolder(write = true): Promise<any | null> {
  if (!isFolderScanSupported()) {
    throw new Error('Navegador sem suporte a File System Access (use Chrome ou Edge)')
  }
  const handle = await (window as any).showDirectoryPicker({
    id: 'branorte-orcamentos',
    mode: write ? 'readwrite' : 'read',
    startIn: 'documents',
  })
  await dbSet(HANDLE_KEY, handle)
  return handle
}

export async function getStoredFolderHandle(write = false): Promise<any | null> {
  const handle = await dbGet<any>(HANDLE_KEY)
  if (!handle) return null
  const ok = await verifyPermission(handle, write)
  if (!ok) return null
  return handle
}

// Garante permissao de escrita no handle salvo (pede se necessario)
export async function ensureWritePermission(handle: any): Promise<boolean> {
  return await verifyPermission(handle, true)
}

// Mapeia mes (1-12) → nome da pasta padrão Branorte
const MESES_NOMES = [
  '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// Normaliza string removendo acentos/cedilha pra match insensivel
function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')  // remove diacriticos
    .replace(/ç/g, 'c')                // safety
    .trim()
}

export function decidirDestinoPasta(handleName: string, dt: Date = new Date()): {
  pastaNome: string
  usarPastaLocal: boolean
} {
  const mes = dt.getMonth() + 1
  const mesNome = MESES_NOMES[mes]
  const pastaNome = `${mes} - ${mesNome}`
  const nomeNormalizado = normalizeName(handleName || '')
  const mesDoHandle = MESES_NOMES.slice(1).find((nome) =>
    nomeNormalizado.includes(normalizeName(nome)),
  )

  return {
    pastaNome,
    usarPastaLocal: !mesDoHandle || mesDoHandle === mesNome,
  }
}

// Detecta se um diretorio JA contem subpastas de meses (1 - Janeiro, etc.)
async function temPastasDeMeses(dirHandle: any): Promise<boolean> {
  let count = 0
  for await (const [name, entry] of dirHandle.entries()) {
    if (entry.kind !== 'directory') continue
    const norm = normalizeName(name)
    for (const m of MESES_NOMES.slice(1)) {
      if (norm.includes(normalizeName(m))) {
        count++
        if (count >= 2) return true
        break
      }
    }
  }
  return false
}

// Navega ate Orçamentos {ano}/{N - Mes}/ criando se nao existir.
// Aceita 3 cenarios pro rootHandle:
//  A) Z:\1 - Comercial\3 - Orçamento\{ano}\  → procura "Orçamentos {ano}" dentro
//  B) Z:\...\Orçamentos {ano}\               → ja e o container, pula 1 nivel
//  C) Z:\...\{ano}\Orçamentos {ano}\{Mes}\   → ja e a propria pasta do mes
//
// NUNCA cria silenciosamente - se nao acha, retorna { ok: false, sugestao }
export interface ResolveResult {
  ok: boolean
  pastaMes?: any
  caminho?: string         // descricao do caminho navegado
  motivo?: string          // descrição do problema se ok=false
  sugestaoCriar?: () => Promise<any>  // funcao que cria a estrutura faltante e retorna handle
}

export async function resolverPastaDoMes(rootHandle: any, dt: Date = new Date(), _depth = 0): Promise<ResolveResult> {
  const ano = dt.getFullYear()
  const mes = dt.getMonth() + 1
  const mesNome = MESES_NOMES[mes]

  // Logs pra debug
  const entriesNomes: string[] = []
  for await (const [name, entry] of rootHandle.entries()) {
    if (entry.kind === 'directory') entriesNomes.push(name)
  }

  // Cenário C: rootHandle É a pasta do mês? Olha o nome
  const rootName = (rootHandle as any).name || ''
  if (normalizeName(rootName).includes(normalizeName(mesNome))) {
    return { ok: true, pastaMes: rootHandle, caminho: `(pasta selecionada é "${rootName}")` }
  }

  // Cenário C-stale: a pasta salva é de OUTRO mês (ex: "5 - Maio" mas hoje é Junho).
  // File System Access NÃO permite navegar pra pasta irmã, então não há como chegar
  // no mês atual a partir daqui. Erro claro pedindo pra re-selecionar a pasta BASE.
  // (Só no nível raiz — _depth 0 — pra não confundir com descida interna.)
  if (_depth === 0) {
    const mesDaPasta = MESES_NOMES.slice(1).find((m) => normalizeName(rootName).includes(normalizeName(m)))
    if (mesDaPasta && mesDaPasta !== mesNome) {
      return {
        ok: false,
        motivo:
          `A pasta salva é "${rootName}" (mês de ${mesDaPasta}), mas hoje é ${mesNome}. ` +
          `O navegador não consegue pular pra pasta do mês ao lado. ` +
          `Clique em "Sincronizar com pasta" e selecione a pasta BASE de orçamentos UMA vez ` +
          `(ex: a pasta "3 - Orçamento") — daí o sistema acha o mês certo sozinho todo mês.`,
      }
    }
  }

  // Cenário T (teste/debug): pasta com "teste" no nome → salva direto sem subpasta
  if (normalizeName(rootName).includes('teste')) {
    return { ok: true, pastaMes: rootHandle, caminho: `(modo teste — salvando direto em "${rootName}")` }
  }

  // Cenário B: rootHandle ja contem meses dentro
  if (await temPastasDeMeses(rootHandle)) {
    // Busca pasta do mes atual
    for await (const [name, entry] of rootHandle.entries()) {
      if (entry.kind !== 'directory') continue
      if (normalizeName(name).includes(normalizeName(mesNome))) {
        return { ok: true, pastaMes: entry, caminho: `${rootName}/${name}` }
      }
    }
    // Achou meses mas não o atual — sugere criar
    return {
      ok: false,
      motivo: `A pasta tem meses mas nao tem "${mes} - ${mesNome}".`,
      sugestaoCriar: async () => {
        return await rootHandle.getDirectoryHandle(`${mes} - ${mesNome}`, { create: true })
      },
    }
  }

  // Cenário A: procura "Orçamentos {ano}" dentro
  for await (const [name, entry] of rootHandle.entries()) {
    if (entry.kind !== 'directory') continue
    const norm = normalizeName(name)
    if (norm.includes(`orcamentos ${ano}`) || norm.includes(`orcamento ${ano}`)) {
      // Achou — entra e procura mes
      for await (const [mNome, mEntry] of entry.entries()) {
        if (mEntry.kind !== 'directory') continue
        if (normalizeName(mNome).includes(normalizeName(mesNome))) {
          return { ok: true, pastaMes: mEntry, caminho: `${rootName}/${name}/${mNome}` }
        }
      }
      // Não tem mes - sugere criar
      return {
        ok: false,
        motivo: `Achei "${name}" mas falta "${mes} - ${mesNome}".`,
        sugestaoCriar: async () => {
          return await entry.getDirectoryHandle(`${mes} - ${mesNome}`, { create: true })
        },
      }
    }
  }

  // Cenário A0: rootHandle é a pasta BASE (ex: "3 - Orçamento") que contém a pasta do
  // ANO ("2026"), e DENTRO dela está "Orçamentos {ano}\{N - Mes}". Desce 1 nível pro
  // ano e re-resolve. Permite o vendedor escolher a pasta-raiz de orçamentos UMA vez e
  // o sistema achar o mês certo automaticamente (todo mês, e ano que vira também).
  // Guard _depth evita recursão infinita.
  if (_depth < 2) {
    for await (const [name, entry] of rootHandle.entries()) {
      if (entry.kind !== 'directory') continue
      const norm = normalizeName(name)
      if (norm.includes('orcamento')) continue // "Orçamentos {ano}" já tratado no Cenário A
      if (!norm.includes(String(ano))) continue // só desce na pasta do ano atual
      const sub = await resolverPastaDoMes(entry, dt, _depth + 1)
      if (sub.ok) return { ...sub, caminho: `${rootName}/${name}/${sub.caminho ?? ''}` }
      if (sub.sugestaoCriar) return { ...sub, motivo: `Em "${rootName}/${name}": ${sub.motivo}` }
    }
  }

  // Nada encontrado — pasta selecionada parece errada
  return {
    ok: false,
    motivo:
      `A pasta salva ("${rootName}") não parece a de orçamentos. ` +
      `Clique em "Sincronizar com pasta" e escolha a pasta BASE "3 - Orçamento". ` +
      `(Vi dentro dela: ${entriesNomes.slice(0, 5).join(', ')}${entriesNomes.length > 5 ? '...' : ''})`,
  }
}

// API antiga (compat) — usa resolverPastaDoMes mas FALHA explicitamente sem confirm
export async function obterPastaDoMes(rootHandle: any, data: Date = new Date()): Promise<any> {
  const r = await resolverPastaDoMes(rootHandle, data)
  if (r.ok) return r.pastaMes
  if (r.sugestaoCriar) return await r.sugestaoCriar()
  throw new Error(r.motivo || 'Pasta nao resolvida')
}

// Embrulha o erro da File System Access com um texto nosso MAS mantém o `name`
// do DOMException (e o erro original em `cause`). É pelo nome que
// classificarFalhaPasta decide se esquece a pasta (29/09/2026): o embrulho antigo
// jogava tudo como "Pasta sem permissão de escrita..." e um arquivo travado
// (NoModificationAllowedError — ex.: aberto no Word) virava "permissão negada",
// permanente, e o navegador esquecia uma pasta que estava boa.
function embrulharErroPasta(texto: string, e: unknown): Error {
  const original = e as { name?: unknown; message?: unknown } | null
  const msg = typeof original?.message === 'string' ? original.message : String(e ?? '')
  const erro = new Error(`${texto}: ${msg}`)
  if (typeof original?.name === 'string' && original.name && original.name !== 'Error') {
    erro.name = original.name
  }
  return Object.assign(erro, { cause: e })
}

// Escreve um arquivo (texto ou blob) num diretorio + VERIFICA que ele realmente existe
export async function escreverArquivo(
  dirHandle: any,
  nome: string,
  conteudo: Blob | string,
): Promise<void> {
  let fileHandle: any
  try {
    fileHandle = await dirHandle.getFileHandle(nome, { create: true })
  } catch (e) {
    throw embrulharErroPasta(`Não consegui criar "${nome}" na pasta`, e)
  }
  let writable: any
  try {
    writable = await fileHandle.createWritable()
  } catch (e) {
    // createWritable falha por permissão, por arquivo travado ou por Z:\ ocupado —
    // o texto não afirma a causa; quem classifica é o `name` preservado.
    throw embrulharErroPasta(`Não consegui abrir "${nome}" pra gravar`, e)
  }
  await writable.write(conteudo)
  await writable.close()
  // VERIFICA: relê o arquivo da pasta pra confirmar que existe
  try {
    const verify = await dirHandle.getFileHandle(nome)
    const f = await verify.getFile()
    if (!f || f.size === 0) {
      throw new Error(`Arquivo "${nome}" foi criado mas está vazio (escrita falhou silenciosamente)`)
    }
  } catch (e) {
    throw embrulharErroPasta(`Escrita de "${nome}" não pôde ser verificada`, e)
  }
}

// Escaneia a pasta procurando arquivos no padrão "YYYY - NNNN - ..."
// Retorna { ano, ultimoNumero, total, arquivos }
export interface ScanResult {
  ano: number
  ultimoNumero: number
  proximoNumero: number
  total: number
  arquivosRecentes: string[]
  /** true quando o scan foi cortado pelo orçamento de tempo (pasta lenta, ex:
   *  Z:\ no Google Drive File Stream). O número achado pode estar incompleto. */
  incompleto?: boolean
}

export async function scanFolderForLastNumber(
  handle: any,
  timeBudgetMs = 8000,
): Promise<ScanResult> {
  const ano = new Date().getFullYear()
  let ultimoNumero = 0
  let total = 0
  const recentes: string[] = []
  // Orçamento de tempo: em Z:\ (Drive File Stream) listar diretórios faz round-trip
  // de rede por entrada — um scan recursivo pode travar. Cortamos no tempo pra o
  // save nunca congelar. O caller deve tratar `incompleto` (cai pro nº do banco).
  const deadline = Date.now() + timeBudgetMs
  let incompleto = false

  // Padrões de nome:
  //   "2026 - 0691 - Cliente.docx"
  //   "2026 - 0691 - Cliente.pdf"
  // Regex captura o número
  const FILE_RE = /^(\d{4})\s*[\-–—]\s*(\d{4})\s*[\-–—]/

  // Recursive scan
  async function scanDir(dirHandle: any, depth = 0) {
    if (depth > 4 || incompleto) return  // limita profundidade
    for await (const [name, entry] of dirHandle.entries()) {
      if (Date.now() > deadline) { incompleto = true; return }  // estourou o tempo
      if (entry.kind === 'directory') {
        await scanDir(entry, depth + 1)
        if (incompleto) return
      } else if (entry.kind === 'file') {
        const m = name.match(FILE_RE)
        if (m) {
          const arq = parseInt(m[1], 10)
          const num = parseInt(m[2], 10)
          if (arq === ano && Number.isFinite(num)) {
            total++
            if (num > ultimoNumero) {
              ultimoNumero = num
            }
            if (recentes.length < 10) recentes.push(name)
          }
        }
      }
    }
  }

  await scanDir(handle)
  recentes.sort().reverse()  // mais recentes primeiro

  return {
    ano,
    ultimoNumero,
    proximoNumero: ultimoNumero + 1,
    total,
    arquivosRecentes: recentes,
    incompleto,
  }
}

export function formatarNumero(ano: number, sequencial: number): string {
  return `${ano} - ${String(sequencial).padStart(4, '0')}`
}
