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

export function isFolderScanSupported(): boolean {
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

export async function resolverPastaDoMes(rootHandle: any, dt: Date = new Date()): Promise<ResolveResult> {
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

  // Nada encontrado — pasta selecionada parece errada
  return {
    ok: false,
    motivo: `Pasta selecionada nao parece ser de orcamentos. Pastas dentro dela: ${entriesNomes.slice(0, 5).join(', ')}${entriesNomes.length > 5 ? '...' : ''}`,
  }
}

// API antiga (compat) — usa resolverPastaDoMes mas FALHA explicitamente sem confirm
export async function obterPastaDoMes(rootHandle: any, data: Date = new Date()): Promise<any> {
  const r = await resolverPastaDoMes(rootHandle, data)
  if (r.ok) return r.pastaMes
  if (r.sugestaoCriar) return await r.sugestaoCriar()
  throw new Error(r.motivo || 'Pasta nao resolvida')
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
    throw new Error(`Não consegui criar "${nome}" na pasta: ${(e as Error).message}`)
  }
  let writable: any
  try {
    writable = await fileHandle.createWritable()
  } catch (e) {
    throw new Error(`Pasta sem permissão de escrita pra "${nome}": ${(e as Error).message}`)
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
    throw new Error(`Escrita de "${nome}" não pôde ser verificada: ${(e as Error).message}`)
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
}

export async function scanFolderForLastNumber(handle: any): Promise<ScanResult> {
  const ano = new Date().getFullYear()
  let ultimoNumero = 0
  let total = 0
  const recentes: string[] = []

  // Padrões de nome:
  //   "2026 - 0691 - Cliente.docx"
  //   "2026 - 0691 - Cliente.pdf"
  // Regex captura o número
  const FILE_RE = /^(\d{4})\s*[\-–—]\s*(\d{4})\s*[\-–—]/

  // Recursive scan
  async function scanDir(dirHandle: any, depth = 0) {
    if (depth > 4) return  // limita profundidade
    for await (const [name, entry] of dirHandle.entries()) {
      if (entry.kind === 'directory') {
        await scanDir(entry, depth + 1)
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
  }
}

export function formatarNumero(ano: number, sequencial: number): string {
  return `${ano} - ${String(sequencial).padStart(4, '0')}`
}
