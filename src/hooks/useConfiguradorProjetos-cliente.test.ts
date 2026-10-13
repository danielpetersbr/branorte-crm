import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import ts from 'typescript'
import * as identidade from '../lib/projeto-3d-identidade'

function loadHooks(supabase: unknown) {
  const source = readFileSync(new URL('./useConfiguradorProjetos.ts', import.meta.url), 'utf8')
    .replace(/^import .*\r?\n/gm, '')
  const code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  const context = vm.createContext({ exports: {}, supabase, ...identidade,
    useMutation: (options: unknown) => options,
    useQueryClient: () => ({ invalidateQueries() {} }),
  })
  vm.runInContext(code, context)
  return context.exports
}

function persistence(existing: boolean | 'legacy' | 'different' = true, updateError: unknown = null) {
  const writes: { kind: string; patch: Record<string, any>; filter?: [string, string]; constraint?: [string, null] }[] = []
  const supabase = { from(table: string) {
    assert.equal(table, 'configurador_projetos')
    const query = {
      update(patch: Record<string, any>) { writes.push({ kind: 'update', patch }); return query },
      insert(patch: Record<string, any>) { writes.push({ kind: 'insert', patch }); return query },
      eq(column: string, value: string) { writes.at(-1)!.filter = [column, value]; return query },
      is(column: string, value: null) { writes.at(-1)!.constraint = [column, value]; return query },
      select() { return query },
      single() { return Promise.resolve({ data: { id: 'row-1' }, error: updateError }) },
      then(resolve: (value: unknown) => unknown) {
        const exists = existing === true || (existing === 'legacy' && writes.at(-1)?.filter?.[0] === 'id' && writes.at(-1)?.constraint?.[0] === 'ext_id')
        return Promise.resolve({ data: exists ? [{ id: 'row-1' }] : [], error: updateError }).then(resolve)
      },
    }
    return query
  } }
  const hooks = loadHooks(supabase)
  return { writes, bridgeSave: hooks.bridgeSave as (project: unknown, thumb: string | null, me: object) => Promise<void>,
    save: hooks.useSalvarConfiguradorProjeto().mutationFn as (input: object) => Promise<unknown> }
}

const me = { id: 'vendedor-1', nome: 'Vendedor' }

test('autosave grava nome do cliente trim sem confundi-lo com o nome do layout', async () => {
  const db = persistence(false)
  await db.bridgeSave({ id: 'layout-1', name: 'Galpão 5 t/h', clientName: '  Maria Silva  ' }, null, me)
  assert.equal(db.writes.at(-1)!.kind, 'insert')
  assert.equal(db.writes.at(-1)!.patch.cliente_nome, 'Maria Silva')
  assert.equal(db.writes.at(-1)!.patch.data.clientName, 'Maria Silva')
  assert.equal(db.writes.at(-1)!.patch.nome, 'Galpão 5 t/h')
})

test('autosave rejeita INSERT novo sem cliente, inclusive só espaços', async () => {
  for (const clientName of [undefined, '', '   ']) {
    const db = persistence(false)
    await assert.rejects(db.bridgeSave({ id: 'novo', name: 'Layout', clientName }, null, me), /cliente/i)
    assert.equal(db.writes.some(write => write.kind === 'insert'), false)
  }
})

test('autosave mantém UPDATE legado aberto sem apagar cliente_nome existente', async () => {
  const db = persistence()
  await db.bridgeSave({ id: 'legado', name: 'Layout antigo' }, null, me)
  assert.equal(db.writes.length, 1)
  assert.equal(db.writes[0].kind, 'update')
  assert.equal('cliente_nome' in db.writes[0].patch, false)
  assert.equal(db.writes[0].patch.data.name, 'Layout antigo')
})

test('salvamento manual usa cliente livre no JSON e metadata, contato é opcional', async () => {
  const db = persistence(false)
  await db.save({ nome: 'Novo galpão', cliente_nome: '  Cliente Livre ', data: { id: 'novo', name: 'Novo galpão', clientName: 'Anterior' } })
  const patch = db.writes.at(-1)!.patch
  assert.equal(patch.cliente_nome, 'Cliente Livre')
  assert.equal(patch.data.clientName, 'Cliente Livre')
  assert.equal(patch.contact_id, null)
})

test('salvamento manual recupera cliente do JSON quando não houve edição do campo', async () => {
  const db = persistence()
  await db.save({ id: 'row-1', nome: 'Layout editado', data: { id: 'layout-1', clientName: 'Maria' } })
  assert.equal(db.writes[0].patch.cliente_nome, 'Maria')
  assert.equal(db.writes[0].patch.data.clientName, 'Maria')
  assert.equal('contact_id' in db.writes[0].patch, false)
})

test('salvamento manual legado mantém vínculos omitidos e rejeita novo sem cliente', async () => {
  const db = persistence()
  await db.save({ id: 'row-1', nome: 'Legado editado', data: { id: 'legado' } })
  assert.equal('cliente_nome' in db.writes[0].patch, false)
  assert.equal('contact_id' in db.writes[0].patch, false)
  const fresh = persistence(false)
  await assert.rejects(fresh.save({ nome: 'Novo', data: { id: 'novo' } }), /cliente/i)
  assert.equal(fresh.writes.some(write => write.kind === 'insert'), false)
})

test('erro de UPDATE não vira INSERT duplicado no salvamento manual', async () => {
  const db = persistence(false, { message: 'Falha de rede' })
  await assert.rejects(db.save({ nome: 'Layout', cliente_nome: 'Maria', data: { id: 'layout' } }))
  assert.equal(db.writes.some(write => write.kind === 'insert'), false)
})

const legacyId = '12345678-1234-1234-1234-123456789012'

test('autosave de legado sem ext_id atualiza somente a linha legada original', async () => {
  const db = persistence('legacy')
  await db.bridgeSave({ id: legacyId, name: 'Layout antigo' }, null, me)
  assert.equal(db.writes.length, 2)
  assert.equal(db.writes.at(-1)!.kind, 'update')
  assert.deepEqual(Array.from(db.writes.at(-1)!.filter!), ['id', legacyId])
  assert.deepEqual(Array.from(db.writes.at(-1)!.constraint!), ['ext_id', null])
})

test('salvamento manual reconhece identidade UUID do legado sem criar outra linha', async () => {
  const db = persistence('legacy')
  await db.save({ nome: 'Legado editado', data: { id: legacyId } })
  assert.equal(db.writes.some(write => write.kind === 'insert'), false)
  assert.deepEqual(Array.from(db.writes.at(-1)!.constraint!), ['ext_id', null])
})

test('fallback UUID não altera uma linha que pertence a outro ext_id', async () => {
  const db = persistence('different')
  await assert.rejects(db.bridgeSave({ id: legacyId, name: 'Layout sem cliente' }, null, me), /cliente/i)
  assert.equal(db.writes.some(write => write.kind === 'insert'), false)
  assert.deepEqual(Array.from(db.writes.at(-1)!.constraint!), ['ext_id', null])
})

test('abrir legado sem ext_id usa UUID da linha nas duas entradas, preservando projetos modernos', async () => {
  let modern = false
  const row = () => ({ id: legacyId, ext_id: modern ? 'interno-original' : null, data: { id: 'interno-original', name: 'Antigo' } })
  let selectedId = ''
  const hooks = loadHooks({ from() {
    const query = {
      select() { return query }, eq(column: string) { selectedId = column; return query },
      single: async () => ({ data: row(), error: null }),
      maybeSingle: async () => ({ data: selectedId === 'ext_id' ? null : row(), error: null }),
    }
    return query
  } })
  assert.equal((await hooks.bridgeLoad(legacyId)).id, legacyId)
  assert.equal((await hooks.fetchConfiguradorProjeto(legacyId)).data.id, legacyId)
  modern = true
  assert.equal((await hooks.bridgeLoad(legacyId)).id, 'interno-original')
  assert.equal((await hooks.fetchConfiguradorProjeto(legacyId)).data.id, 'interno-original')
})

test('modal manual resolve metadata do UUID legado somente quando ext_id é nulo', async () => {
  let column = ''
  let constraint: [string, null] | undefined
  const hooks = loadHooks({ from() {
    const query = {
      select() { return query }, eq(value: string) { column = value; return query },
      is(key: string, value: null) { constraint = [key, value]; return query },
      maybeSingle: async () => ({ data: column === 'id' && constraint ? { id: legacyId, cliente_nome: 'Maria' } : null, error: null }),
    }
    return query
  } })
  const meta = await hooks.fetchConfiguradorProjetoMetaAtual({ id: legacyId })
  assert.equal(meta?.id, legacyId)
  assert.deepEqual(constraint, ['ext_id', null])
})
