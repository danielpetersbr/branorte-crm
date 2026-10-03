import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { Readable } from 'node:stream'
import test from 'node:test'
import vm from 'node:vm'
import ConvertAPI from 'convertapi'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const UploadResult = require('convertapi/lib/upload_result').default

// Keep SDK normalization, upload stream and ResultFile getters real. Only the
// paid network requests are replaced; no credentials or company files are used.
test('PDF to DOCX uploads a readable file using the installed ConvertAPI SDK', async () => {
  const input = Buffer.from('%PDF-1.7 synthetic fixture\n' + 'x'.repeat(100)), output = Buffer.from('synthetic-docx')
  let uploaded: Buffer | undefined, downloaded = '', response: unknown, status = 0
  class LocalConvertAPI extends ConvertAPI {
    constructor() {
      super('synthetic-no-secret')
      this.client.upload = async (stream, name) => {
        assert.equal(name, 'teste.pdf')
        assert.ok(stream instanceof Readable)
        const chunks: Buffer[] = []
        for await (const chunk of stream as Readable) chunks.push(Buffer.from(chunk))
        uploaded = Buffer.concat(chunks)
        return new UploadResult({ FileId: 'synthetic-file', FileName: name, FileExt: 'pdf' })
      }
      this.client.post = async (path, params) => {
        assert.equal(path, 'convert/pdf/to/docx')
        assert.equal(params.StoreFile, true)
        assert.equal(String(params.File), 'synthetic-file')
        return { Files: [{ FileName: 'teste.docx', FileSize: output.length, Url: 'https://example.invalid/teste.docx' }] }
      }
    }
  }
  const source = readFileSync(new URL('../../api/orcamento-pdf-to-docx.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('endpoint.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  const handler = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'handler')!
  const js = ts.transpileModule(handler.getText(ast).replace('export default ', ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  const endpoint = vm.runInNewContext(`${js}\nhandler`, {
    ConvertAPI: LocalConvertAPI, Readable, Buffer, SECRET: 'synthetic-no-secret',
    SUPA_URL: 'https://example.invalid', SVC_KEY: 'synthetic', createClient: () => ({}),
    exigirAprovado: async () => ({ ok: true, usuario: { userId: 'synthetic' } }),
    fetch: async (url: string) => { downloaded = url; return new Response(output) },
    console: { log() {}, error() {} },
  })
  const res = {
    setHeader() {}, status(code: number) { status = code; return res },
    send(body: unknown) { response = body; return res }, json(body: unknown) { response = body; return res }, end() {},
  }
  await endpoint({ method: 'POST', headers: { authorization: 'Bearer synthetic' }, body: { pdfBase64: input.toString('base64'), filename: 'teste.pdf' } }, res)
  assert.equal(status, 200, JSON.stringify(response))
  assert.deepEqual(uploaded, input)
  assert.equal(downloaded, 'https://example.invalid/teste.docx')
  assert.deepEqual(response, output)
})
