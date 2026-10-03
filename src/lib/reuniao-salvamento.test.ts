import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

function mutation(response: { data: unknown; error: unknown }) {
  const file = new URL('../hooks/useReuniaoTime.ts', import.meta.url)
  const source = ts.createSourceFile(file.pathname, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const fn = source.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'useSalvarReuniao')!
  let callback: ts.Expression | undefined
  function visit(node: ts.Node) {
    if (ts.isPropertyAssignment(node) && node.name.getText(source) === 'mutationFn') callback = node.initializer
    ts.forEachChild(node, visit)
  }
  visit(fn)
  assert.ok(callback)
  const calls: { name: string; args: Record<string, unknown> }[] = []
  const context = {
    exports: {}, hojeSP: () => '2026-10-02', supabase: {
      from: () => { throw new Error('Salvamento parcial por tabela não é atômico') },
      rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return response },
    },
  }
  runInNewContext(ts.transpileModule(`export const save = ${callback.getText(source)}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText, context)
  return { save: (context.exports as { save: (f: unknown) => Promise<number> }).save, calls }
}

const form = {
  time_slug: 'time-qa', conduzida_por: 'QA', funcionando: 'Ata fictícia', melhorar: '', proximos_passos: '',
  perdas: [
    { cliente: 'Cliente fictício', vendedor_nome: '', valor: 100, motivo: 'Outro', concorrente: 'ignorado' },
    { cliente: '   ', vendedor_nome: '', valor: null, motivo: '', concorrente: '' },
  ],
}
test('ata e perdas são enviadas juntas em uma única operação confirmada', async () => {
  const { save, calls } = mutation({ data: 42, error: null })
  assert.equal(await save(form), 42)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'reuniao_salvar_atomicamente')
  assert.equal(calls[0].args.p_data, '2026-10-02')
  assert.equal((calls[0].args.p_perdas as unknown[]).length, 1)
})
test('erro no salvamento atômico não é tratado como sucesso nem dispara outro save', async () => {
  const { save, calls } = mutation({ data: null, error: new Error('Falha de gravação sintética') })
  await assert.rejects(() => save(form), /Falha de gravação sintética/)
  assert.equal(calls.length, 1)
})
test('resposta sem ID confirmado não permite anunciar uma reunião salva', async () => {
  const { save } = mutation({ data: null, error: null })
  await assert.rejects(() => save(form), /confirmado/)
})
