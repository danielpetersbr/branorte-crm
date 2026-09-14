import assert from 'node:assert/strict'
import test from 'node:test'
import { maskCpfCnpj, maskEmail, maskPhone, sanitizeAuditPayload } from './privacy'

test('masks CPF/CNPJ, phone and email while keeping a support correlation suffix', () => {
  assert.equal(maskCpfCnpj('003.691.590-47'), '***.***.***-47')
  assert.equal(maskCpfCnpj('12.345.678/0001-90'), '**.***.***/****-90')
  assert.equal(maskPhone('(51) 99692-3378'), '(**) *****-3378')
  assert.equal(maskEmail('financeiro@albaagro.com'), 'f***@albaagro.com')
})

test('sanitizes only known personal fields without retaining arbitrary secrets', () => {
  const result = sanitizeAuditPayload({
    cliente: { nome: 'Breno', cpfCnpj: '00369159047', telefone: '51996923378', email: 'financeiro@albaagro.com' },
    authorization: 'Bearer secret',
    OPENAI_API_KEY: 'secret',
    modelo: { id: 7, basename: 'Compacta 03' },
  })
  assert.deepEqual(result, {
    cliente: { nome: 'Breno', cpfCnpj: '***.***.***-47', telefone: '(**) *****-3378', email: 'f***@albaagro.com' },
    modelo: { id: 7, basename: 'Compacta 03' },
  })
  assert.doesNotMatch(JSON.stringify(result), /Bearer|OPENAI|secret/)
})
