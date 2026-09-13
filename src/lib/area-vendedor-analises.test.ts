import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analisePrecalculadaSchema, estadoAnalisePrecalculada } from './area-vendedor-analises'

const exemplo = {
  vendedor_id: '00000000-0000-4000-8000-000000000001', chat_id: 'cliente@lid',
  gerado_em: '2026-09-13T15:00:00Z', snapshot_em: '2026-09-13T14:59:00Z',
  ultima_mensagem_em: '2026-09-13T14:00:00Z', snapshot_sha256: 'a'.repeat(64),
  mensagens_analisadas: 1, audios_sem_transcricao: 0, historico_parcial: true,
  versao_contrato: 1, origem: 'codex_cloud', resumo: 'Resumo baseado no registro.',
  pendencias: [], proxima_acao: null, mensagem_sugerida: null, evidencias: [],
}
test('contrato rejeita payload sem identificação e datas contraditórias', () => {
  assert.equal(analisePrecalculadaSchema.safeParse(exemplo).success, true)
  assert.equal(analisePrecalculadaSchema.safeParse({ ...exemplo, vendedor_id: 'Ramon' }).success, false)
  assert.equal(analisePrecalculadaSchema.safeParse({ ...exemplo, snapshot_em: '2026-09-14T15:00:00Z' }).success, false)
  assert.equal(analisePrecalculadaSchema.safeParse({ ...exemplo, evidencias: ['inventada'] }).success, false)
})
test('sem fingerprint atual não promete análise atualizada', () => {
  const a = analisePrecalculadaSchema.parse(exemplo)
  assert.equal(estadoAnalisePrecalculada(a, a.ultima_mensagem_em), 'snapshot_nao_verificado')
  assert.equal(estadoAnalisePrecalculada(a, '2026-09-13T14:01:00Z'), 'desatualizada')
  assert.equal(estadoAnalisePrecalculada(a, a.ultima_mensagem_em, 'b'.repeat(64)), 'desatualizada')
  assert.equal(estadoAnalisePrecalculada(a, a.ultima_mensagem_em, a.snapshot_sha256), 'verificada')
})
