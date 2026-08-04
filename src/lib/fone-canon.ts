/**
 * Forma canônica do telefone — a chave que casa o orçamento com o lead.
 *
 * ESPELHA a função `public.fone_canon` do banco. Se mexer aqui, mexa lá.
 *
 * POR QUE MORA EM lib/ E NÃO EM hooks/: estava copiada em useAtendimentos.ts e
 * useDashboard.ts, e o arquivo do hook importa o client do Supabase, que puxa
 * `import.meta.env` e não roda fora do Vite. Resultado: a função mais crítica do
 * casamento lead↔orçamento ficou sem teste nenhum, e as duas cópias podiam
 * divergir sem ninguém perceber. Agora é uma só, testada.
 *
 * O canônico reduz a DDD(2) + 8 dígitos: tira o "55" do país (só quando ≥12
 * dígitos, pra não confundir com o DDD 55 de Santa Maria/RS) e o 9º dígito do
 * celular. Assim casa com/sem 9 e com/sem +55.
 */
export function foneCanon(p?: string | null): string | null {
  const bruto = String(p ?? '').trim()
  const d = bruto.replace(/\D/g, '')
  if (d.length < 10) return null

  // TELEFONE ESTRANGEIRO NÃO TEM CANÔNICO.
  //
  // O canônico serve pra achar um lead do WhatsApp brasileiro. Número de fora
  // não tem lead pra casar — e, pior, o `slice(-10)` lá embaixo FABRICAVA um
  // canônico que colide com brasileiro de verdade, porque o DDI virava DDD:
  //   +1 555 123 4567    (EUA)          -> 5551234567 = (55) 5123-4567 Santa Maria/RS
  //   +54 9 11 1234 5678 (Buenos Aires) -> 1112345678 = DDD 11, São Paulo
  //   +351 912 345 678   (Portugal)     -> 1912345678 = DDD 19, Campinas
  // Medido: 10 de 16 DDIs conhecidos viram DDD brasileiro válido.
  //
  // O sinal é o "+" com DDI diferente de 55 — que é exatamente como o CRM passou
  // a gravar telefone internacional quando o orçamento ganhou seletor de país.
  // Sem ele não dá pra distinguir: "(917) 555-1234" dos EUA e um celular
  // brasileiro são os mesmos 10 dígitos.
  if (bruto.startsWith('+') && !d.startsWith('55')) return null

  let n = (d.length >= 12 && d.startsWith('55')) ? d.slice(2) : d
  if (n.length === 11 && n[2] === '9') n = n.slice(0, 2) + n.slice(3)
  if (n.length > 10) n = n.slice(-10)
  return n.length === 10 ? n : null
}
