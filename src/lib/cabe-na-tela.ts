// Quanto empurrar (em px, no eixo x) um card flutuante pra ele caber na tela.
//
// Por que existe (29/09/2026): o html/body tem `overflow-x: clip` (index.css) —
// nada rola de lado, o que passa da tela é CORTADO em silêncio. O card de funil
// do Escritório (/disparos) é `w-52` centrado na mesa; no celular (390px) a
// mesa da borda direita jogava o card até 418px e sumiam a coluna de números e
// o "funil ao vivo" (na borda esquerda, o mesmo corte do outro lado).
//
// Recebe a posição do card SEM deslocamento (left/right do getBoundingClientRect,
// que já é relativo à tela) e devolve o deslocamento que o encosta a `margem` px
// da borda que ele estoura. Cabendo, devolve 0 — no desktop nada se mexe.
// Arredonda pra px inteiro: o Chrome posiciona em 1/64 de px, e um deslocamento
// fracionário faria a medida seguinte achar uma diferença de resto e reescrever.
export function deslocamentoParaCaber(
  esquerda: number,
  direita: number,
  larguraTela: number,
  margem = 8,
): number {
  const largura = direita - esquerda
  // Card sem caixa (display:none, ainda não montado) ou tela sem medida: não mexe.
  if (!(largura > 0) || !(larguraTela > 0)) return 0
  let dx = 0
  // Mais largo que a área útil: prende o INÍCIO (é onde fica o nome do vendedor).
  if (largura > larguraTela - 2 * margem || esquerda < margem) dx = margem - esquerda
  else if (direita > larguraTela - margem) dx = larguraTela - margem - direita
  // `|| 0` troca o -0 do Math.round por 0 (senão o assert/strict e o `!==` do
  // chamador veem uma "mudança" que não existe).
  return Math.round(dx) || 0
}
