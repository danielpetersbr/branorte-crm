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

export async function pickOrcamentoFolder(): Promise<any | null> {
  if (!isFolderScanSupported()) {
    throw new Error('Navegador sem suporte a File System Access (use Chrome ou Edge)')
  }
  const handle = await (window as any).showDirectoryPicker({
    id: 'branorte-orcamentos',
    mode: 'read',
    startIn: 'documents',
  })
  await dbSet(HANDLE_KEY, handle)
  return handle
}

export async function getStoredFolderHandle(): Promise<any | null> {
  const handle = await dbGet<any>(HANDLE_KEY)
  if (!handle) return null
  const ok = await verifyPermission(handle, false)
  if (!ok) return null
  return handle
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
