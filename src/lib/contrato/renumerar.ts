// Renumera as clausulas do contrato depois de montado.
//
// Por que existe: clausulas condicionais. A Décima Segunda (garantia pessoal) so
// entra quando ha garantidor — sem ela, o contrato pulava da Décima Primeira
// direto pra Décima Terceira. Em documento juridico isso levanta a pergunta que
// ninguem quer ouvir na assinatura: "sumiu alguma clausula aqui?".
//
// O texto e' escrito com a numeracao "de projeto" (1..17, fixa e legivel no
// codigo) e esta funcao reescreve tudo pro numero real: titulo, prefixo de cada
// item e as referencias cruzadas ("na forma da Cláusula Nona", "item 6.4").

import type { Bloco } from './contrato-blocos'

const ORDINAIS = [
  'PRIMEIRA', 'SEGUNDA', 'TERCEIRA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÉTIMA',
  'OITAVA', 'NONA', 'DÉCIMA', 'DÉCIMA PRIMEIRA', 'DÉCIMA SEGUNDA',
  'DÉCIMA TERCEIRA', 'DÉCIMA QUARTA', 'DÉCIMA QUINTA', 'DÉCIMA SEXTA',
  'DÉCIMA SÉTIMA', 'DÉCIMA OITAVA', 'DÉCIMA NONA', 'VIGÉSIMA',
]

/** "DÉCIMA PRIMEIRA" -> "Décima Primeira" (como aparece no meio do texto). */
function capitalizar(ordinal: string): string {
  return ordinal
    .split(' ')
    .map(w => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ')
}

function numeroDoOrdinal(ordinal: string): number | null {
  const i = ORDINAIS.indexOf(ordinal.trim().toUpperCase())
  return i >= 0 ? i + 1 : null
}

const RE_TITULO = /^CLÁUSULA\s+(.+?)\s+[–-]\s+(.+)$/

/**
 * Devolve os blocos com a numeracao corrigida.
 * Tudo que nao for clausula/item/referencia passa intacto.
 */
export function renumerarClausulas(blocos: Bloco[]): Bloco[] {
  // ── 1. de/para: numero escrito no codigo -> posicao real no documento ──────
  const mapa = new Map<number, number>()
  let posicao = 0
  for (const b of blocos) {
    if (b.k !== 'clausula') continue
    const m = RE_TITULO.exec(b.txt)
    if (!m) continue
    const antigo = numeroDoOrdinal(m[1])
    if (antigo == null) continue
    posicao += 1
    mapa.set(antigo, posicao)
  }
  // Nada mudou de lugar: evita reescrever texto a toa.
  let precisa = false
  mapa.forEach((novo, antigo) => { if (novo !== antigo) precisa = true })
  if (!precisa) return blocos

  // ── 2. referencias por extenso ("Cláusula Décima Primeira") ───────────────
  // Ordinais do maior pro menor, senao "Décima" casa antes de "Décima Primeira".
  const ordinaisPorTamanho = [...ORDINAIS].sort((a, b) => b.length - a.length)
  const reRef = new RegExp(
    `Cláusula (${ordinaisPorTamanho.map(capitalizar).join('|')})\\b`,
    'g',
  )

  function corrigirTexto(txt: string): string {
    let saida = txt.replace(reRef, (inteiro, ord: string) => {
      const antigo = numeroDoOrdinal(ord)
      const novo = antigo != null ? mapa.get(antigo) : undefined
      return novo ? `Cláusula ${capitalizar(ORDINAIS[novo - 1])}` : inteiro
    })

    // referencias a item ("item 6.4", "itens 2.2 e 2.4") — so' depois da palavra
    // item/itens, pra nao encostar em "art. 784", "art. 1.647" ou no nº 1.390 do
    // endereco da fabrica.
    // ATENCAO ao alternador: `itens?` casa "iten"/"itens" e NUNCA "item" — as duas
    // palavras divergem antes do s. Tem que ser ite(?:m|ns).
    saida = saida.replace(/\b(ite(?:m|ns)\s+)((?:\d{1,2}(?:\.\d+)+)(?:\s*(?:,|e)\s*\d{1,2}(?:\.\d+)+)*)/gi,
      (_inteiro, prefixo: string, lista: string) => {
        const corrigida = lista.replace(/\d{1,2}(?:\.\d+)+/g, ref => {
          const [cab, ...resto] = ref.split('.')
          const novo = mapa.get(Number(cab))
          return novo ? [novo, ...resto].join('.') : ref
        })
        return prefixo + corrigida
      })

    return saida
  }

  // ── 3. reescreve ──────────────────────────────────────────────────────────
  // `clausulaAntiga` guarda o numero COMO ESTA NO CODIGO, nao o novo: o prefixo
  // do paragrafo ("11.10.") vem na numeracao antiga e so' pode ser reescrito
  // quando pertence a clausula que esta sendo lida.
  let clausulaAntiga = 0
  return blocos.map((b): Bloco => {
    if (b.k === 'clausula') {
      const m = RE_TITULO.exec(b.txt)
      if (!m) return b
      const antigo = numeroDoOrdinal(m[1])
      const novo = antigo != null ? mapa.get(antigo) : undefined
      if (antigo == null || !novo) return b
      clausulaAntiga = antigo
      return { ...b, txt: `CLÁUSULA ${ORDINAIS[novo - 1]} – ${corrigirTexto(m[2])}` }
    }

    if (b.k === 'p') {
      let txt = b.txt
      // prefixo do item: "13.1. Nenhuma das partes..." -> "12.1. Nenhuma..."
      const mi = /^(\d{1,2})((?:\.\d+)+)\.\s/.exec(txt)
      if (mi && Number(mi[1]) === clausulaAntiga) {
        const novo = mapa.get(clausulaAntiga)
        if (novo) txt = `${novo}${mi[2]}. ${txt.slice(mi[0].length)}`
      }
      return { ...b, txt: corrigirTexto(txt) }
    }

    return b
  })
}
