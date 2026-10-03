import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// Only the PDF worker boundary is replaced; extraction and cleanup run from
// the production module. No DOM or browser worker is needed in this process.
const sdkUrl = 'data:text/javascript,' + encodeURIComponent(`
  export const GlobalWorkerOptions = {};
  let fixture;
  export function configure(value) { fixture = value; }
  export function getDocument({ data }) {
    fixture.input = data;
    return {
      promise: fixture.loadError ? Promise.reject(fixture.loadError) : Promise.resolve({
        numPages: fixture.pages.length,
        async getPage(number) {
          if (fixture.pageError) throw fixture.pageError;
          return { async getTextContent() { return { items: fixture.pages[number - 1] }; } };
        }
      }),
      async destroy() { fixture.destroyed++; if (fixture.destroyError) throw fixture.destroyError; }
    };
  }
`)
register('data:text/javascript,' + encodeURIComponent(`
  export async function resolve(specifier, context, next) {
    if (specifier === 'pdfjs-dist') return { url: ${JSON.stringify(sdkUrl)}, shortCircuit: true };
    return next(specifier, context);
  }
`))
const sdk = await import(sdkUrl)
const { extractPdfLines } = await import('./extractPdfText')

function inputFile() {
  return new File([new Uint8Array([37, 80, 68, 70])], 'pedido.pdf', { type: 'application/pdf' })
}
function item(str: string, y: number) { return { str, transform: [1, 0, 0, 1, 0, y] } }

test('importações repetidas liberam cada documento e preservam texto e ordem das páginas', async () => {
  for (let n = 0; n < 3; n++) {
    const fixture = { destroyed: 0, input: undefined as ArrayBuffer | undefined, pages: [
      [item('segunda linha', 10), item('Pedido', 30), item('de venda', 30), { type: 'beginMarkedContent' }],
      [item('  Página   dois ', 50)],
    ] }
    sdk.configure(fixture)
    assert.deepEqual(await extractPdfLines(inputFile()), ['Pedido de venda', 'segunda linha', 'Página dois'])
    assert.equal(fixture.destroyed, 1)
    assert.ok(fixture.input instanceof ArrayBuffer)
  }
})

test('falha ao carregar o PDF ainda libera a tarefa e conserva o erro original', async () => {
  const loadError = new Error('PDF inválido')
  const fixture = { destroyed: 0, pages: [], loadError }
  sdk.configure(fixture)
  await assert.rejects(extractPdfLines(inputFile()), error => error === loadError)
  assert.equal(fixture.destroyed, 1)
})

test('falha ao ler uma página também libera o documento', async () => {
  const pageError = new Error('Página danificada')
  const fixture = { destroyed: 0, pages: [[]], pageError }
  sdk.configure(fixture)
  await assert.rejects(extractPdfLines(inputFile()), error => error === pageError)
  assert.equal(fixture.destroyed, 1)
})

test('erro de limpeza não substitui o motivo de falha da leitura', async () => {
  const loadError = new Error('PDF inválido')
  const fixture = { destroyed: 0, pages: [], loadError, destroyError: new Error('Worker indisponível') }
  sdk.configure(fixture)
  await assert.rejects(extractPdfLines(inputFile()), error => error === loadError)
  assert.equal(fixture.destroyed, 1)
})

test('falha de limpeza após leitura bem-sucedida é informada', async () => {
  const destroyError = new Error('Worker indisponível')
  const fixture = { destroyed: 0, pages: [[item('Pedido', 30)]], destroyError }
  sdk.configure(fixture)
  await assert.rejects(extractPdfLines(inputFile()), error => error === destroyError)
  assert.equal(fixture.destroyed, 1)
})
