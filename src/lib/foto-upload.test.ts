import { test } from 'node:test'
import assert from 'node:assert/strict'
import { dimensoesReduzidas, extensaoDaFoto, reduzirFotoParaUpload, LADO_MAX } from './foto-upload'

// Roadmap #94: a Foto 3D (PNG 3840x1981, 8-16 MB) era recusada pelo Storage e o orçamento salvava sem foto.

test('Foto 3D 3840x1981 cai pro lado maior de 2560 mantendo a proporção', () => {
  assert.deepEqual(dimensoesReduzidas(3840, 1981), { w: LADO_MAX, h: 1321 })
})

test('foto em pé também reduz pelo lado maior', () => {
  assert.deepEqual(dimensoesReduzidas(2000, 4000), { w: 1280, h: 2560 })
})

test('foto que já cabe não muda', () => {
  assert.deepEqual(dimensoesReduzidas(1080, 1080), { w: 1080, h: 1080 })
})

test('foto pequena passa intacta, sem redesenhar', async () => {
  const b = new Blob([new Uint8Array(1000)], { type: 'image/png' })
  assert.equal(await reduzirFotoParaUpload(b), b)
})

test('extensão segue o tipo da foto', () => {
  assert.equal(extensaoDaFoto(new Blob([], { type: 'image/png' })), 'png')
  assert.equal(extensaoDaFoto(new Blob([], { type: 'image/webp' })), 'webp')
  assert.equal(extensaoDaFoto(new Blob([], { type: 'image/jpeg' })), 'jpg')
})
