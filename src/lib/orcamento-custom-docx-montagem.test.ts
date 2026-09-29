import { test } from 'node:test'
import assert from 'node:assert/strict'
import JSZip from 'jszip'
import { gerarOrcamentoCustomDocx, type GerarCustomDocxOpts } from './orcamento-custom-docx'
import { quadrosMontagem, obsPorContaComMontagem, MONTAGEM_PADRAO, type MontagemCfg } from './orcamento-montagem'

// O Word que vai pro Z:\ (Tier 1, gerarOrcamentoCustomDocx) tem que trazer os 2
// quadros da montagem do print do vendedor (roadmap #69 — 29/09/2026), iguais aos
// da prévia/PDF. Antes ele desenhava um bloco só ("Montagem dos equipamentos —
// inclui ...") e as linhas do cliente iam soltas em "Observação — por conta do cliente".

const BASE = 224_000

/** `obsSalva` = orcamentos_gerados.obs_por_conta (null = nunca editada). */
function opts(montagem: MontagemCfg | null, obsSalva: string[] | null = null): GerarCustomDocxOpts {
  return {
    numero: '2026 - 9999',
    dataEmissao: '29/09/2026',
    cliente: { nome: 'Cliente Teste' },
    voltagem: 'trifasico',
    itens: [{ letra: 'A', qtd: 1, nome: 'Misturador Vertical', specs: [], valor: BASE }],
    motores: [],
    totalEquip: BASE,
    totalMotores: 0,
    totalProposta: BASE + quadrosMontagemTotal(montagem),
    // exatamente como o FinalizarMontarModal passa
    obsPorConta: obsPorContaComMontagem(obsSalva, montagem, BASE),
    montagemQuadros: quadrosMontagem(montagem, BASE),
  }
}

function quadrosMontagemTotal(m: MontagemCfg | null): number {
  return quadrosMontagem(m, BASE).fabricante?.total ?? 0
}

/** Texto de cada parágrafo do document.xml, na ordem. */
async function paragrafos(o: GerarCustomDocxOpts): Promise<string[]> {
  const blob = await gerarOrcamentoCustomDocx(o)
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const xml = await zip.file('word/document.xml')!.async('string')
  return (xml.match(/<w:p[ >][\s\S]*?<\/w:p>/g) ?? [])
    .map(p => (p.match(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g) ?? []).map(t => t.replace(/<[^>]+>/g, '')).join(''))
    .map(t => t.replace(/&amp;/g, '&').trim())
    .filter(Boolean)
}

const TITULO_FABRICANTE = 'MONTAGEM DOS ITENS ORÇADOS ACIMA: (Valores para os montadores do fabricante)'
const TITULO_CLIENTE = 'MONTAGEM DOS ITENS ORÇADOS ACIMA: (POR CONTA DO CLIENTE)'

test('DOCX: caso do print — 2 quadros, total só no do fabricante, nada duplicado no rodapé', async () => {
  const cfg: MontagemCfg = {
    ...MONTAGEM_PADRAO, pessoas: 2, dias: 5, carros: 1,
    responsavel: { alimentacao: 'cliente', estadia: 'cliente', deslocamento: 'cliente' },
  }
  const ps = await paragrafos(opts(cfg))

  const iFab = ps.indexOf(TITULO_FABRICANTE)
  const iCli = ps.indexOf(TITULO_CLIENTE)
  assert.ok(iFab >= 0, 'falta o quadro do fabricante')
  assert.ok(iCli > iFab, 'falta o quadro do cliente (depois do do fabricante)')

  // 1º quadro: itens + UM total (22.400 mão de obra + 10.000 passagem)
  assert.deepEqual(ps.slice(iFab + 1, iCli), ['Mão de obra', 'Passagens aéreas idas/voltas', 'Valor total\tR$ 32.400,00'])
  // 2º quadro: só os itens, na ordem do print, sem valor
  assert.deepEqual(ps.slice(iCli + 1, iCli + 4), ['Alimentação', 'Estadia', 'Deslocamento'])
  // o quadro acaba aí: o próximo parágrafo já é o total da proposta, que soma só o
  // 1º quadro (224.000 + 32.400) — as linhas do cliente ficam fora
  assert.equal(ps[iCli + 4], 'VALOR TOTAL DA PROPOSTA\tR$ 256.400,00')

  // valor de cada linha é conta interna: não vaza
  const tudo = ps.join('\n')
  assert.doesNotMatch(tudo, /22\.400|10\.000,00/)
  assert.equal(ps.filter(p => p.startsWith('Valor total')).length, 1)
  // o bloco antigo e a linha solta no rodapé sumiram
  assert.doesNotMatch(tudo, /Montagem dos equipamentos — inclui/)
  assert.doesNotMatch(tudo, /Na montagem dos equipamentos/)
  // e a linha histórica "Montagem ... (se necessário)" sai do rodapé (montagem cobrada)
  assert.doesNotMatch(tudo, /Montagem dos equipamentos orçados acima/)
})

test('DOCX: orçamento salvo ANTES da mudança sai só com o quadro do fabricante, mesmo total', async () => {
  // JSONB gravado antes de 29/09/2026: sem `responsavel`
  const antigo: MontagemCfg = {
    ativo: true, pessoas: 2, dias: 5, carros: 1, percentualMaoObra: 10,
    estadiaDia: 500, alimentacaoDia: 100, passagemPessoa: 5000, deslocamentoDia: 300,
  }
  const ps = await paragrafos(opts(antigo))
  const iFab = ps.indexOf(TITULO_FABRICANTE)
  assert.ok(iFab >= 0)
  assert.equal(ps.indexOf(TITULO_CLIENTE), -1)
  assert.deepEqual(ps.slice(iFab + 1, iFab + 7), [
    'Mão de obra', 'Passagens aéreas idas/voltas', 'Alimentação', 'Estadia', 'Deslocamento',
    'Valor total\tR$ 39.900,00',
  ])
})

test('DOCX: tudo por conta do cliente — só o 2º quadro, sem valor e sem "Valor total"', async () => {
  const cfg: MontagemCfg = {
    ...MONTAGEM_PADRAO, pessoas: 2, dias: 5, carros: 1,
    responsavel: { mao_obra: 'cliente', estadia: 'cliente', alimentacao: 'cliente', passagem: 'cliente', deslocamento: 'cliente' },
  }
  const ps = await paragrafos(opts(cfg))
  assert.equal(ps.indexOf(TITULO_FABRICANTE), -1)
  assert.ok(ps.indexOf(TITULO_CLIENTE) >= 0)
  assert.equal(ps.some(p => p.startsWith('Valor total')), false)
})

test('DOCX: sem montagem, nenhum quadro', async () => {
  const ps = await paragrafos(opts(null))
  assert.equal(ps.some(p => /MONTAGEM DOS ITENS/.test(p)), false)
  // rodapé com as 5 linhas históricas, como sempre
  assert.ok(ps.includes('Montagem dos equipamentos orçados acima (se necessário)'))
})

/** Linhas da seção "Observação — por conta do cliente" (entre o título e "Tributos"). */
function obsDoRodape(ps: string[]): string[] {
  const i = ps.indexOf('OBSERVAÇÃO — POR CONTA DO CLIENTE')
  const f = ps.indexOf('TRIBUTOS')
  assert.ok(i >= 0 && f > i, 'seção de observação fora do lugar')
  return ps.slice(i + 1, f)
}

test('DOCX: montagem cobrada + vendedor deixou só a linha da montagem → rodapé sem linha nenhuma (igual à prévia)', async () => {
  // Regressão (crítico, 29/09/2026): obsPorContaComMontagem tira a linha da
  // montagem e devolve [] — o DOCX tratava [] como "não salvo" e voltava as 5
  // linhas históricas, INCLUSIVE "Montagem ... (se necessário)" (contradição).
  const cfg: MontagemCfg = { ...MONTAGEM_PADRAO, pessoas: 2, dias: 5, carros: 1 }
  const salva = ['Montagem dos equipamentos orçados acima (se necessário)']
  assert.deepEqual(obsPorContaComMontagem(salva, cfg, BASE), [])
  const ps = await paragrafos(opts(cfg, salva))
  assert.deepEqual(obsDoRodape(ps), [])
  assert.doesNotMatch(ps.join('\n'), /Painel elétrico|Muck|Montagem dos equipamentos orçados acima/)
})

test('DOCX: lista salva vazia (vendedor apagou tudo) sai vazia; null segue com as 5 históricas', async () => {
  assert.deepEqual(obsDoRodape(await paragrafos(opts(null, []))), [])
  assert.deepEqual(obsDoRodape(await paragrafos(opts(null, null))), [
    'Painel elétrico',
    'Montagem dos equipamentos orçados acima (se necessário)',
    'Muck (se necessário)',
    'Despesa com obras civil (se necessário)',
    'Instalação elétrica dos equipamentos (se necessário)',
  ])
  // lista editada é respeitada como veio
  assert.deepEqual(obsDoRodape(await paragrafos(opts(null, ['Painel elétrico']))), ['Painel elétrico'])
})
