import assert from 'node:assert/strict'

const baseUrl = process.env.ORCAMENTO_AI_BASE_URL?.replace(/\/$/, '')
const token = process.env.ORCAMENTO_AI_TEST_TOKEN
if (!baseUrl || !token) {
  console.error('test credentials not configured: set ORCAMENTO_AI_BASE_URL and ORCAMENTO_AI_TEST_TOKEN')
  process.exit(2)
}

const snapshot = {
  orcamentoId: null,
  cliente: { nome: '' }, modelo: null, itens: [], motores: [], acessorios: null, componentes: [], voltagem: null, fotoPrincipalUrl: null,
  condicoes: { formaPagamento: 'a combinar', prazoDias: 90, prazoTipo: 'uteis', freteTipo: 'FOB', freteTexto: 'por conta do cliente', validadeDias: 10, observacoes: '' },
}

async function request(message) {
  const response = await fetch(`${baseUrl}/api/orcamento-ai`, {
    method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ message, snapshot, conversation_id: crypto.randomUUID() }),
  })
  const body = await response.json()
  assert.equal(response.status, 200, `HTTP ${response.status}: ${body.error ?? 'erro'}`)
  assert.equal('acoes' in body, false, 'contrato legado de ações não pode reaparecer')
  return body
}

const scenarios = [
  ['Compacta 03 Master exata', 'Ronaldo Biazi, Hidrolândia GO. Compacta 03 Master 150500-4000-4000 monofásica', (body) => {
    assert.match(body.proposal.modelo.basename, /Compacta 03 Master.*150500.*4000.*4000/i)
    assert.equal(body.proposal.voltagem, 'monofasico')
    assert.equal(body.proposal.acessorios.valor, 12154)
    assert.equal(body.proposal.componentes.find((item) => /balan/i.test(item.nome))?.valor, 8728)
    assert.equal(body.proposal.totais.proposta, 222934.2)
  }],
  ['Master explícita', 'Compacta 03 Master monofásica', (body) => { if (body.proposal) assert.equal(body.proposal.modelo.master, true); else assert.ok(body.questions.length) }],
  ['Standard explícita', 'Compacta 03 Standard monofásica', (body) => { if (body.proposal) assert.equal(body.proposal.modelo.master, false); else assert.ok(body.questions.length) }],
  ['Voltagem não é trocada', 'Compacta 02 monofásica', (body) => { if (body.proposal) assert.equal(body.proposal.voltagem, 'monofasico'); else assert.ok(body.questions.length) }],
  ['Suporte bag sem funil', 'Suporte para bag sem funil, sem substituir por outro modelo', (body) => { if (body.proposal) assert.match(body.proposal.itens[0].nome, /sem funil/i); else assert.ok(body.questions.length) }],
  ['Composição com acessórios 10%', 'Chupim 160 x 3,5 m monofásico com acessórios 10%', (body) => { if (body.proposal) assert.equal(body.proposal.acessorios.percentual, 10); else assert.ok(body.questions.length) }],
  ['Cliente preservado', 'Cliente Breno Fabres, telefone 51996923378. Compacta 03 Master 150500-4000-4000 monofásica', (body) => { assert.equal(body.proposal?.cliente.nome, 'Breno Fabres') }],
]

for (const [name, message, verify] of scenarios) {
  const body = await request(message)
  verify(body)
  console.log(`ok - ${name}`)
}
