// TELEFONE COM DDI — orçamento para cliente fora do Brasil.
//
// O campo de telefone do orçamento aplicava a máscara brasileira em cima de
// QUALQUER coisa digitada. Um número do Paraguai (+595 981 123456) virava
// "(59) 5981-1234": o vendedor não conseguia registrar o cliente estrangeiro, e
// o pior é que saía um número plausível — errado, mas com cara de certo.
//
// A LISTA DE PAÍSES NÃO NASCE AQUI. Ela vem de `DDI_TO_PAIS` em lib/ddd-uf.ts,
// que já existia pra classificar lead internacional. Duplicar a lista faria o
// orçamento aceitar um país que o resto do CRM não sabe classificar.

import { DDIS_CONHECIDOS } from '@/lib/ddd-uf'

export const DDI_BRASIL = '55'

export interface OpcaoDdi {
  ddi: string
  sigla: string
  nome: string
  /** "+55 Brasil (BR)" — o que aparece no seletor. */
  rotulo: string
}

/** Brasil primeiro (é o caso de 99% dos orçamentos), o resto por nome. */
export const OPCOES_DDI: OpcaoDdi[] = (() => {
  const lista = DDIS_CONHECIDOS.map(p => ({
    ...p,
    rotulo: `+${p.ddi} ${p.nome} (${p.sigla})`,
  }))
  const br = lista.find(p => p.ddi === DDI_BRASIL)
  const resto = lista
    .filter(p => p.ddi !== DDI_BRASIL)
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'))
  return br ? [br, ...resto] : resto
})()

export const soDigitos = (v: string) => (v || '').replace(/\D/g, '')

/** Máscara brasileira: (48) 99999-9999. Vale SÓ pro DDI 55. */
export function formatarFoneBr(v: string): string {
  const d = soDigitos(v)
  if (d.length <= 2) return d
  if (d.length <= 6) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  if (d.length <= 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7, 11)}`
}

/**
 * Fora do Brasil NÃO se inventa máscara: cada país agrupa de um jeito, e chutar
 * um formato faria o número sair errado no PDF que vai pro cliente. Só limpa o
 * que não é dígito e agrupa de 3 em 3 pra ficar legível.
 */
export function formatarFoneIntl(v: string): string {
  const d = soDigitos(v).slice(0, 15)   // E.164 vai até 15 dígitos
  return d.replace(/(\d{3})(?=\d)/g, '$1 ').trim()
}

export function formatarFone(v: string, ddi: string): string {
  return ddi === DDI_BRASIL ? formatarFoneBr(v) : formatarFoneIntl(v)
}

/**
 * Como o telefone fica GRAVADO.
 *
 * Brasil continua saindo "(48) 99999-9999", sem prefixo — é o que o CRM inteiro
 * já espera, e pôr "+55" aqui mudaria o casamento com o lead em todo orçamento
 * antigo. Estrangeiro sai com "+DDI " na frente, porque sem isso o número não
 * disca e ninguém sabe de que país é.
 */
export function montarFone(digitado: string, ddi: string): string {
  const d = soDigitos(digitado)
  if (!d) return ''
  if (ddi === DDI_BRASIL) return formatarFoneBr(d)
  return `+${ddi} ${formatarFoneIntl(d)}`.trim()
}

/**
 * Separa um telefone já gravado de volta em (ddi, número) pra reabrir o modal.
 * Sem "+" na frente é brasileiro: é como o campo sempre funcionou, e telefone
 * antigo não pode ser lido como estrangeiro por acidente.
 */
export function separarFone(valor: string | null | undefined): { ddi: string; numero: string } {
  const t = (valor ?? '').trim()
  if (!t) return { ddi: DDI_BRASIL, numero: '' }
  if (!t.startsWith('+')) return { ddi: DDI_BRASIL, numero: formatarFoneBr(t) }

  const d = soDigitos(t)
  // Mais longo primeiro: senão "+1" abocanharia o começo de "+55" e de "+595".
  for (const p of [...DDIS_CONHECIDOS].sort((a, b) => b.ddi.length - a.ddi.length)) {
    if (d.startsWith(p.ddi)) {
      const resto = d.slice(p.ddi.length)
      return p.ddi === DDI_BRASIL
        ? { ddi: DDI_BRASIL, numero: formatarFoneBr(resto) }
        : { ddi: p.ddi, numero: formatarFoneIntl(resto) }
    }
  }
  return { ddi: DDI_BRASIL, numero: formatarFoneBr(d) }
}

export interface Veredito {
  ok: boolean
  /** Mensagem pro vendedor. Vazia quando ok. */
  erro: string
}

/**
 * Brasil exige DDD + número (10 dígitos): é o que amarra o orçamento ao lead
 * pelo `fone_canon`, e menos que isso não casa com nada.
 *
 * Fora do Brasil a regra é OUTRA de propósito: número nacional varia de 6 a 12
 * dígitos pelo mundo, e exigir 10 recusaria cliente legítimo. Aqui o telefone
 * não serve pra casar lead nenhum — serve pra ligar pro cliente.
 */
export function validarFone(digitado: string, ddi: string): Veredito {
  const d = soDigitos(digitado)
  if (ddi === DDI_BRASIL) {
    return d.length >= 10
      ? { ok: true, erro: '' }
      : { ok: false, erro: 'Telefone é obrigatório (com DDD) — é o que amarra o orçamento ao cliente/lead.' }
  }
  if (d.length < 6) {
    return { ok: false, erro: 'Telefone muito curto para um número internacional.' }
  }
  if (d.length > 15) {
    return { ok: false, erro: 'Telefone longo demais — o padrão internacional vai até 15 dígitos.' }
  }
  return { ok: true, erro: '' }
}
