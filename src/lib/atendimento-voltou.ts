/**
 * (21/10/2026) Lead que já tinha chegado e voltou a falar.
 *
 * A lista do /atendimentos e o card "Hoje" cortam pela ATIVIDADE no período (`last_message_at`, desde 17/09: o cliente
 * que volta tem que aparecer no dia). Então ele aparece hoje com o "Chegou" da 1ª vez — o Renato chegou em 08/05, voltou
 * em 21/10 pelo anúncio (no WhatsApp da Ana) e o Daniel achou que era erro de etiqueta.
 *
 * Devolve o momento da volta quando ele cai num dia do calendário (local) depois da 1ª chegada. Conversa no mesmo dia em
 * que chegou não é "voltou". `last_message_at` só anda com o cliente: webhook de entrada (lead_dispatch_log), clique em
 * link de rota ou anúncio, e a Ana gravando o que ele respondeu (auditoria.wa_set_lead_fields).
 */
export function voltouEm(primeira: string | null | undefined, ultima: string | null | undefined): Date | null {
  if (!primeira || !ultima) return null
  const p = new Date(primeira)
  const u = new Date(ultima)
  if (!Number.isFinite(p.getTime()) || !Number.isFinite(u.getTime())) return null
  const dia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  return dia(u) > dia(p) ? u : null
}
