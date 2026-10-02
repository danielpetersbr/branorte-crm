import assert from 'node:assert/strict';
import { test } from 'node:test';
import { periodoMesAnterior } from './periodos';

test('31 de maio retorna todo abril sem transbordar para maio', () => {
  const data = new Date(2026, 4, 31, 23, 59, 59);
  const original = data.getTime();
  assert.deepEqual(periodoMesAnterior(data), { inicio: '2026-04-01', fim: '2026-04-30' });
  assert.equal(data.getTime(), original);
});

test('31 de março retorna fevereiro inteiro em ano comum', () => {
  assert.deepEqual(periodoMesAnterior(new Date(2026, 2, 31)), { inicio: '2026-02-01', fim: '2026-02-28' });
});

test('janeiro retorna dezembro do ano anterior', () => {
  assert.deepEqual(periodoMesAnterior(new Date(2026, 0, 31)), { inicio: '2025-12-01', fim: '2025-12-31' });
});

test('fevereiro mantém 29 dias no ano bissexto e respeita a regra dos séculos', () => {
  for (const [ano, dias] of [[2024, 29], [2000, 29], [2100, 28]] as const) {
    assert.deepEqual(periodoMesAnterior(new Date(ano, 2, 31)), { inicio: `${ano}-02-01`, fim: `${ano}-02-${dias}` });
  }
});

test('limites dependem do mês local, independentemente do dia e horário', () => {
  for (const data of [new Date(2026, 9, 1, 0, 0, 0), new Date(2026, 9, 31, 23, 59, 59)]) {
    assert.deepEqual(periodoMesAnterior(data), { inicio: '2026-09-01', fim: '2026-09-30' });
  }
});
