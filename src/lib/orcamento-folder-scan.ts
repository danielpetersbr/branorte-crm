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

// Navega ate `Orçamentos {ano}\{N - Mes}\` criando se nao existir.
// O handle raiz aponta pra Z:\1 - Comercial\3 - Orçamento\{ano}\
export async function obterPastaDoMes(rootHandle: any, data: Date): Promise<any> {
  const ano = data.getFullYear()
  const mes = data.getMonth() + 1
  const mesNome = MESES_NOMES[mes]

  // Tenta achar a pasta "Orçamentos {ano}" (com ou sem cedilha/acento)
  let orcAnoHandle: any = null
  for await (const [name, entry] of rootHandle.entries()) {
    if (entry.kind !== 'directory') continue
    const norm = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (norm.includes(`orcamentos ${ano}`) || norm.includes(`orcamento ${ano}`)) {
      orcAnoHandle = entry
      break
    }
  }
  if (!orcAnoHandle) {
    orcAnoHandle = await rootHandle.getDirectoryHandle(`Orçamentos ${ano}`, { create: true })
  }

  // Tenta achar pasta do mes ("5 - Maio", "05 - Maio", etc.)
  for await (const [name, entry] of orcAnoHandle.entries()) {
    if (entry.kind !== 'directory') continue
    const norm = name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    if (norm.includes(mesNome.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))) {
      return entry
    }
  }
  return await orcAnoHandle.getDirectoryHandle(`${mes} - ${mesNome}`, { create: true })
}

// Escreve um arquivo (texto ou blob) num diretorio
export async function escreverArquivo(
  dirHandle: any,
  nome: string,
  conteudo: Blob | string,
): Promise<void> {
  const fileHandle = await dirHandle.getFileHandle(nome, { create: true })
  const writable = await fileHandle.createWritable()
  await writable.write(conteudo)
  await writable.close()
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
