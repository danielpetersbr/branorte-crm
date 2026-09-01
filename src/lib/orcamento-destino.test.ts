import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as folderScan from './orcamento-folder-scan.js'

test('virada para setembro ignora o handle mensal de agosto e usa 9 - Setembro pelo servidor', () => {
  const decidirDestino = (folderScan as typeof folderScan & {
    decidirDestinoPasta: (handleName: string, data: Date) => {
      pastaNome: string
      usarPastaLocal: boolean
    }
  }).decidirDestinoPasta

  assert.equal(typeof decidirDestino, 'function', 'falta a decisão explícita do destino mensal')
  assert.deepEqual(
    decidirDestino('8 - Agosto', new Date(2026, 8, 1, 10, 0, 0)),
    { pastaNome: '9 - Setembro', usarPastaLocal: false },
  )
})

test('pasta base continua local, mas mostra o mês real de destino', () => {
  const decidirDestino = (folderScan as typeof folderScan & {
    decidirDestinoPasta: (handleName: string, data: Date) => {
      pastaNome: string
      usarPastaLocal: boolean
    }
  }).decidirDestinoPasta

  assert.equal(typeof decidirDestino, 'function', 'falta a decisão explícita do destino mensal')
  assert.deepEqual(
    decidirDestino('3 - Orçamento', new Date(2026, 8, 1, 10, 0, 0)),
    { pastaNome: '9 - Setembro', usarPastaLocal: true },
  )
})

test('WhatsApp usa o vendedor vinculado ao perfil, não um telefone salvo no navegador', async () => {
  const modulo = await import('./orcamento-vendedor.js').catch(() => null)
  assert.ok(modulo, 'falta o resolvedor do vendedor responsável')

  assert.deepEqual(
    modulo.resolverVendedorDoOrcamento(
      { vendor_id: 'vendor-lucas', display_name: 'Administrador' },
      [
        { id: 'vendor-daniel', name: 'DANIEL', telefone: '5548999999999' },
        { id: 'vendor-lucas', name: 'LUCAS', telefone: '5548888888888' },
      ],
    ),
    { nome: 'LUCAS', telefone: '5548888888888' },
  )
})
