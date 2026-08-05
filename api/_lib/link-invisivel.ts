// Codigo de rastreio invisivel embutido no texto do WhatsApp.
//
// O cliente clica em /l/<slug>, cai no WhatsApp do vendedor com um texto ja
// escrito. Esse texto carrega, escondido no fim, um numero de 30 bits que
// identifica AQUELE clique. Quando o cliente manda a mensagem, a extensao grava
// em wa_chat_messages e o gatilho link_rota_casar_msg() (migration
// 20260805_link_rota.sql) le esse numero e fecha a atribuicao.
//
// Formato: U+2060 + 15 digitos base-4 + U+2060.
//   digito 0 -> U+2061  FUNCTION APPLICATION
//   digito 1 -> U+2062  INVISIBLE TIMES
//   digito 2 -> U+2063  INVISIBLE SEPARATOR
//   digito 3 -> U+2064  INVISIBLE PLUS
//
// Por que esses e nao ZWSP/ZWJ: ZWJ e ZWNJ participam de sequencias de emoji e
// podem grudar num emoji vizinho e mudar o desenho. Os "invisible math
// operators" nao entram em nenhuma sequencia de grapheme -- sao inertes.
//
// TODO caractere aqui vai por escape \uXXXX de proposito: invisivel colado no
// fonte e impossivel de revisar e some num copy/paste descuidado.
//
// ATENCAO: o decodificador equivalente vive em SQL (public.link_rota_decode).
// Mexeu aqui, mexe la.

const DELIM = '\u2060'; // WORD JOINER — abre e fecha o payload
const DIGITS = ['\u2061', '\u2062', '\u2063', '\u2064'];

/** 15 digitos base-4 = 30 bits. Casa exatamente com CODIGO_MAX. */
const N_DIGITOS = 15;
export const CODIGO_MAX = 4 ** N_DIGITOS; // 1.073.741.824

// Base32 sem caracteres ambiguos (sem 0/O, sem 1/I/L). So pra humano ler.
const B32 = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Sorteia um codigo de clique. Espaco de 1,07 bilhao — colisao e irrelevante,
 *  e o indice unico em codigo_num pega o caso patologico. */
export function novoCodigoNum(): number {
  return Math.floor(Math.random() * CODIGO_MAX);
}

/** Versao legivel do mesmo numero (6 chars). So aparece no painel. */
export function codigoLegivel(num: number): string {
  let n = Math.floor(num);
  let out = '';
  for (let i = 0; i < 6; i++) {
    out = B32[n % 32] + out;
    n = Math.floor(n / 32);
  }
  return out;
}

/** O numero virado em caracteres invisiveis, pronto pra colar no fim do texto. */
export function selarInvisivel(num: number): string {
  let n = Math.floor(num);
  const digitos: string[] = [];
  for (let i = 0; i < N_DIGITOS; i++) {
    digitos.unshift(DIGITS[n % 4]);
    n = Math.floor(n / 4);
  }
  return DELIM + digitos.join('') + DELIM;
}

/** Inverso de selarInvisivel — usado em teste e depuracao. */
export function lerInvisivel(texto: string): number | null {
  const i = texto.indexOf(DELIM);
  if (i < 0) return null;
  const bruto = texto.slice(i + 1, i + 1 + N_DIGITOS);
  if (bruto.length !== N_DIGITOS) return null;
  let n = 0;
  for (const ch of bruto) {
    const d = DIGITS.indexOf(ch);
    if (d < 0) return null;
    n = n * 4 + d;
  }
  return n;
}

/** Tira os invisiveis — pro painel mostrar o texto como o cliente le. */
export function semInvisivel(texto: string): string {
  return texto.replace(/[\u2060-\u2064]/g, '');
}
