// PDF idêntico ao Word usando @nativedocuments/docx-wasm
// (motor próprio do NativeDocuments, fidelidade Word).
//
// Setup: precisa das envs VITE_ND_DEV_ID + VITE_ND_DEV_SECRET (registrar em
// https://developers.nativedocuments.com/). Free tier suficiente pra
// orçamentos da Branorte.

let docxModule: any = null
let initPromise: Promise<void> | null = null

const DEV_ID = (import.meta as any).env?.VITE_ND_DEV_ID || ''
const DEV_SECRET = (import.meta as any).env?.VITE_ND_DEV_SECRET || ''

export function isDocxWasmConfigured(): boolean {
  return !!DEV_ID && !!DEV_SECRET
}

async function init(): Promise<void> {
  if (initPromise) return initPromise
  initPromise = (async () => {
    if (!isDocxWasmConfigured()) {
      throw new Error('docx-wasm não configurado: defina VITE_ND_DEV_ID e VITE_ND_DEV_SECRET')
    }
    // Lazy import (a lib é grande, só carrega quando usar)
    docxModule = await import('@nativedocuments/docx-wasm')
    await docxModule.init({
      ND_DEV_ID: DEV_ID,
      ND_DEV_SECRET: DEV_SECRET,
      ENVIRONMENT: 'WEB',
      LAZY_INIT: true,
    })
  })()
  return initPromise
}

export async function gerarPdfDoDocxWasm(docxBlob: Blob): Promise<Blob> {
  await init()
  const arrayBuffer = await docxBlob.arrayBuffer()
  const api = await docxModule.engine()
  try {
    await api.load(arrayBuffer)
    const pdfArrayBuffer = await api.exportPDF()
    return new Blob([pdfArrayBuffer], { type: 'application/pdf' })
  } finally {
    await api.close()
  }
}
