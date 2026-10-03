import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'

function functions(names: string[], context: Record<string, unknown>) {
  const source = readFileSync(new URL('../hooks/useCatalogoAdmin.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('hook.ts', source, ts.ScriptTarget.Latest, true)
  const declarations = ast.statements.filter(n => ts.isFunctionDeclaration(n) && names.includes(n.name?.text ?? ''))
  assert.equal(declarations.length, names.length)
  const js = ts.transpileModule(declarations.map(n => n.getText(ast).replace(/^export /, '')).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText
  return vm.runInNewContext(`${js}\n({${names.join(',')}})`, { console: { warn() {} }, ...context })
}

test('catalogue propagation observes SDK error as an unconfirmed linked-model update', async () => {
  const { propagarParaModeloVinculado } = functions(['extrairModeloId', 'propagarParaModeloVinculado'], {
    supabase: { from: () => ({ update: () => ({ eq: async () => ({ error: new Error('model unavailable') }) }) }) },
  })
  assert.equal(await propagarParaModeloVinculado({ notas_curadoria: 'modelo_id=12', valor: 100 }), false)
})

test('a saved catalogue item stays saved, warns of partial propagation and refreshes the actual queries', async () => {
  const saved = { id: 15, notas_curadoria: 'modelo_id=12', valor: 100 }, warnings: string[] = [], refreshed: string[] = []
  const chain: Record<string, unknown> = {}
  for (const name of ['update', 'eq', 'select']) chain[name] = () => chain
  chain.single = async () => ({ data: saved, error: null })
  const { useAtualizarItemCatalogo } = functions(['useAtualizarItemCatalogo'], {
    supabase: { from: () => chain }, propagarParaModeloVinculado: async () => false,
    useMutation: (options: unknown) => options,
    useQueryClient: () => ({ invalidateQueries: ({ queryKey }: { queryKey: string[] }) => refreshed.push(queryKey[0]) }),
    toast: { warning: (message: string) => warnings.push(message) },
  })
  const mutation = useAtualizarItemCatalogo()
  const result = await mutation.mutationFn({ id: saved.id, updates: { valor: saved.valor } })
  assert.equal(result, saved)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /salvo.*modelo/i)
  mutation.onSuccess(result)
  assert.deepEqual(refreshed.sort(), ['catalogo-items', 'catalogo-items-admin', 'orcamento-modelos-v3'].sort())
})
