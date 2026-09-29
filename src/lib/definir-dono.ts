// Resposta da RPC contato_definir_dono (o botão "Dar dono" do painel de violações da
// /contatos). A RPC NÃO lança erro quando recusa: devolve 200 com { ok: false, erro }.
//
// (29/09/2026) O hook devolvia esse objeto sem olhar o `ok`, e o PainelDonos chamava
// mutate sem onError — "ja_tem_dono", "reservado_por_outro_vendedor" e até o
// "permission denied" (a migration fecha_rpcs_orfas_lote2 de 03/09 tirou o EXECUTE de
// authenticated achando que a função era órfã) sumiam calados. O admin clicava, nada
// acontecia, e ele achava que tinha salvado.

export interface RespostaDefinirDono {
  ok: boolean
  erro?: string
  /** Com ok=true: quem virou dono. Com erro=ja_tem_dono: quem JÁ era. */
  vendedor?: string | null
}

/** Os códigos que a função devolve hoje (pg_get_functiondef em 29/09/2026). */
export const ERRO_DEFINIR_DONO_LABEL: Record<string, string> = {
  so_admin:                     'só administrador pode dar dono',
  vendedor_invalido:            'esse vendedor não está ativo',
  contato_inexistente:          'o contato não existe mais',
  ja_tem_dono:                  'o contato já tem dono',
  reservado_por_outro_vendedor: 'outro vendedor está com ele reservado no pool de prospecção',
}

/**
 * Null quando deu certo; senão, a frase pra mostrar. Resposta vazia ou sem `ok` é
 * tratada como falha — melhor avisar do que fingir que salvou.
 */
export function erroDefinirDono(r: RespostaDefinirDono | null | undefined): string | null {
  if (r?.ok === true) return null
  const codigo = r?.erro ?? ''
  let msg = ERRO_DEFINIR_DONO_LABEL[codigo] ?? (codigo ? `recusado (${codigo})` : 'a resposta do banco veio vazia')
  if (codigo === 'ja_tem_dono' && r?.vendedor) msg += `: ${r.vendedor}`
  return msg
}
