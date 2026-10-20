import assert from 'node:assert/strict'
import test from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { CatalogoItem } from '../hooks/useCatalogo'
import { Projeto3DOrcamentoResolver } from '../components/orcamento/Projeto3DOrcamentoResolver'
import { materializeProjeto3DOrcamento } from './projeto-3d-orcamento'

test('painel apresenta a causa e os dados do cadastro identificado antes de confirmar preço', () => {
  const items = materializeProjeto3DOrcamento({ version: 1, exportId: 'diagnostico-teste-1234', projectId: 'test', projectName: 'Teste', clientName: '', items: [{ sourceId: 'tubo', floorId: 'terreo', floorName: 'Térreo', kind: 'equipment', catalogId: 'tubo', sequence: 1, name: 'TRANSPORTADOR HELICOIDAL 160 X 5,5 M', quantity: 2, specifications: [] }] })
  const before = JSON.stringify(items)
  const html = renderToStaticMarkup(createElement(Projeto3DOrcamentoResolver, {
    items, catalogo: [], onVincular() {}, onManual() {}, onReanalisar() {},
    diagnosticos: [{ index: 0, uid: items[0].uid, motivo: 'motor_incompleto', mensagem: 'O catálogo não tem preço válido para o motor nesta voltagem.', catalogo: { id: 15, nome_curto: 'Transportador 160 × 5,5 m', foto_url: '/foto-oficial.jpg', specs: ['Diâmetro: 160 mm', 'Comprimento: 5,5 metros.'] } as CatalogoItem }],
  }))
  assert.match(html, /Conferir motor/)
  assert.match(html, /não tem preço válido para o motor nesta voltagem/)
  assert.match(html, /Cadastro identificado/)
  assert.match(html, /Comprimento: 5,5 metros/)
  assert.match(html, /foto-oficial.jpg/)
  assert.match(html, /Tentar vínculos novamente/)
  assert.match(html, /emissão fica bloqueada/)
  assert.equal(JSON.stringify(items), before)
})
