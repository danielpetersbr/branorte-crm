import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import React from 'react'

const editor = 'https://branorte-configurador-3d.vercel.app'
const config = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'))

test('CRM response permits microphone only for itself and the embedded configurator', () => {
  const headers = config.headers.filter((rule: { source: string }) => rule.source === '/(.*)').flatMap((rule: { headers: unknown[] }) => rule.headers)
  const policy = headers.find((h: { key: string }) => h.key.toLowerCase() === 'permissions-policy').value
  const directives = new Map(policy.split(',').map((part: string) => part.trim().split('=')))
  const microphone = String(directives.get('microphone')).slice(1, -1).match(/"[^"]+"|\S+/g) ?? []
  assert.deepEqual(new Set(microphone), new Set(['self', `"${editor}"`]))
  assert.equal(directives.get('camera'), '()', 'narration must not grant webcam access')
  assert.equal(directives.get('payment'), '()')
})

test('actual Projeto3D iframe delegates microphone to the configurator, not every origin', () => {
  const source = readFileSync(new URL('../pages/Projeto3D.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('Projeto3D.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let frame: ts.JsxSelfClosingElement | undefined
  const visit = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'iframe') frame = node
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(frame)
  // Evaluate the actual JSX boundary without mounting authenticated CRM hooks.
  const js = ts.transpileModule(`(${frame.getText(ast)})`, { compilerOptions: { jsx: ts.JsxEmit.React } }).outputText
  const element = vm.runInNewContext(js, { React, frameRef: { current: null }, iframeSrc: editor, setLoading() {}, CONFIGURADOR_ORIGIN: editor })
  const directives = new Map<string, string[]>(element.props.allow.split(';').map((part: string) => {
    const [feature, ...origins] = part.trim().split(/\s+/)
    return [feature, origins]
  }))
  assert.deepEqual(directives.get('microphone'), [editor])
  assert.equal(directives.has('camera'), false)
  assert.equal(element.props.src, editor)
})
