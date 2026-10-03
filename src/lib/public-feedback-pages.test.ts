import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { writeBrowserPreference } from './browser-preferences'

function handler(page: string, extra: Record<string, unknown> = {}) {
  const url = new URL(`../pages/${page}.tsx`, import.meta.url)
  const source = ts.createSourceFile(url.pathname, readFileSync(url, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let send: ts.FunctionDeclaration | undefined
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'enviar') send = node
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(send, 'o teste executa o callback real da página')
  const state = { sending: false, sent: false, error: '', requests: 0 }
  const context = {
    exports: {}, nota: 5, notaBaixa: false, vendedor: 'VENDEDOR QA', telefone: '', nome: 'Pessoa fictícia', comentario: 'Comentário fictício', motivo: '', tipo: '', token: 'fixture',
    navigator: { userAgent: 'QA sintético' }, envioEmCurso: { current: false },
    setEnviando: (value: boolean) => { state.sending = value },
    setEnviado: (value: boolean) => { state.sent = value },
    setErro: (value: string) => { state.error = value },
    localStorage: { setItem: () => {} }, LS_NOME: 'fixture', writeBrowserPreference,
    supabase: {
      from: () => ({ insert: async () => { state.requests++; return { error: null } } }),
      rpc: async () => { state.requests++; return { error: null, data: { ok: true } } },
    }, ...extra,
  }
  const compiled = ts.transpileModule(`${send.getText(source)}\nexport { enviar }`, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
  runInNewContext(compiled, context)
  return { state, send: (context.exports as { enviar: () => Promise<void> }).enviar }
}

for (const page of ['Avaliacao', 'ReuniaoFeedback']) {
  test(`${page}: falha de transporte libera envio e conserva formulário para tentar novamente`, async () => {
    const failure = async () => { throw new Error('network unavailable') }
    const { state, send } = handler(page, { supabase: { from: () => ({ insert: failure }), rpc: failure } })
    await assert.doesNotReject(send)
    assert.equal(state.sending, false)
    assert.equal(state.sent, false)
    assert.ok(state.error)
  })

  test(`${page}: dois acionamentos enquanto envio está pendente não duplicam a gravação`, async () => {
    const { state, send } = handler(page)
    await Promise.all([send(), send()])
    assert.equal(state.requests, 1)
    assert.equal(state.sent, true)
    assert.equal(state.sending, false)
  })
}

test('comentário de reunião enviado continua confirmado mesmo sem espaço para guardar nome', async () => {
  const { state, send } = handler('ReuniaoFeedback', { localStorage: { setItem: () => { throw new Error('QuotaExceededError') } } })
  await assert.doesNotReject(send)
  assert.equal(state.sent, true)
})
