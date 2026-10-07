import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function mutation(error: Error | null = null) {
  const updates: unknown[] = [], filtros: unknown[] = [], uploads: string[] = [], refreshed: string[] = []
  const source = readFileSync(new URL('../hooks/useFotoModeloCatalogo.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true)
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'useFotoModeloCatalogo')!
  const js = ts.transpileModule(fn.getText(ast).replace(/^export /, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
  const hook = vm.runInNewContext(`${js}; useFotoModeloCatalogo`, {
    crypto: { randomUUID: () => 'uuid' },
    supabase: {
      from: (table: string) => {
        assert.equal(table, 'orcamento_modelos')
        return { update: (payload: unknown) => { updates.push(payload); return { eq: (field: string, id: number) => { filtros.push([field, id]); return { select: () => ({ single: async () => ({ error }) }) } } } } }
      },
      storage: { from: () => ({ upload: async (path: string) => { uploads.push(path); return { error: null } }, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://storage/${path}` } }) }) },
    },
    useMutation: (options: unknown) => options,
    useQueryClient: () => ({ invalidateQueries: ({ queryKey }: { queryKey: string[] }) => refreshed.push(queryKey[0]) }),
  })
  return { ...hook(46), updates, filtros, uploads, refreshed }
}

test('trocar foto altera somente a imagem do modelo correto, preservando preços e composição', async () => {
  const m = mutation()
  const url = await m.mutationFn({ type: 'image/png', size: 500 })
  assert.equal(url, 'https://storage/modelos/46-uuid.png')
  assert.equal(JSON.stringify(m.updates), JSON.stringify([{ foto_url: url }]))
  assert.equal(JSON.stringify(m.filtros), JSON.stringify([['id', 46]]))
  m.onSuccess()
  assert.deepEqual(m.refreshed.sort(), ['catalogo-items-admin', 'orcamento-modelos-v3'])
})

test('arquivo inválido não envia nem altera o modelo; falha na gravação não anuncia sucesso', async () => {
  const m = mutation()
  await assert.rejects(m.mutationFn({ type: 'image/svg+xml', size: 500 }), /JPG/)
  await assert.rejects(m.mutationFn({ type: 'image/png', size: 6 * 1024 * 1024 }), /5 MB/)
  assert.equal(m.uploads.length, 0)
  assert.equal(m.updates.length, 0)
  const falha = mutation(new Error('modelo não autorizado'))
  await assert.rejects(falha.mutationFn(null), /não autorizado/)
  assert.equal(falha.refreshed.length, 0)
})
