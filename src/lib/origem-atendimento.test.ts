import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeOrigem, corOrigem } from './origem-atendimento.ts'
import { chaveOrigemRastreada, rotuloOrigemVenda } from './vendas-origem.ts'

test('painel de vendas dá nome bonito às origens do site', () => {
  const casos: Array<[string, string, string]> = [
    ['Site', 'site', 'Site'], ['Google Ads', 'google', 'Google'], ['YouTube', 'youtube', 'YouTube'],
    ['TikTok', 'tiktok', 'TikTok'], ['LinkedIn', 'linkedin', 'LinkedIn'], ['ChatGPT/IA', 'chatgpt_ia', 'ChatGPT/IA'],
    ['E-mail', 'email', 'E-mail'], ['Link no WhatsApp', 'link_whatsapp', 'Link no WhatsApp'],
    ['Outros buscadores', 'outros_buscadores', 'Outros buscadores'], ['Outros sites', 'outros_sites', 'Outros sites'],
  ]
  for (const [origem, chave, rotulo] of casos) {
    assert.equal(chaveOrigemRastreada(origem), chave, origem)
    assert.equal(rotuloOrigemVenda(chave), rotulo, origem)
  }
  assert.equal(chaveOrigemRastreada('WhatsApp ANA'), 'whatsapp_empresa') // a porta continua porta
})

test('origens do botão do site ganham rótulo próprio na barra ORIGENS', () => {
  assert.equal(normalizeOrigem('Google Ads'), 'Google Ads')        // antes somava em "Google"
  assert.equal(normalizeOrigem('Link no WhatsApp'), 'Link no WhatsApp') // antes somava em "WhatsApp"
  for (const o of ['Site', 'YouTube', 'TikTok', 'LinkedIn', 'ChatGPT/IA', 'E-mail', 'Outros buscadores', 'Outros sites']) {
    assert.equal(normalizeOrigem(o), o)
    assert.notEqual(corOrigem(o), '#6B7280', `${o} sem cor própria`)
  }
})

test('origens antigas seguem iguais', () => {
  assert.equal(normalizeOrigem('Google'), 'Google')
  assert.equal(normalizeOrigem('WhatsApp ANA'), 'WhatsApp ANA')
  assert.equal(normalizeOrigem('WhatsApp 1144'), 'WhatsApp (48) 8878-1144')
  assert.equal(normalizeOrigem('WhatsApp 4502'), 'WhatsApp (48) 3658-4502')
  assert.equal(normalizeOrigem('Meta ADS'), 'Meta ADS')
  assert.equal(normalizeOrigem('Bio Instagram'), 'Instagram')
  assert.equal(normalizeOrigem('Instagram Formulario'), 'Instagram')
  assert.equal(normalizeOrigem('Facebook Formulario'), 'Facebook Form')
  assert.equal(normalizeOrigem('Facebook'), 'Facebook')
  assert.equal(normalizeOrigem('Não identificou'), 'Não identificado')
  assert.equal(normalizeOrigem(null), 'Não identificado')
  assert.equal(normalizeOrigem('LP Mini Fábrica'), 'LP Mini Fábrica')
  assert.equal(corOrigem('LP Mini Fábrica'), '#6B7280')
})
