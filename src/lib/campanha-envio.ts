/*
 * Envio de campanha (NovaCampanhaModal): criar a campanha e ligá-la ('ativa') é
 * um passo só pro vendedor, mas são duas idas ao banco. Achado de 29/09/2026:
 *
 *  1. O botão só olhava `criar.isPending`. Entre o criar terminar e o ativar
 *     terminar ele reabilitava, e um clique nessa janela criava uma 2ª campanha
 *     com os mesmos alvos — que também virava 'ativa'. Não existe dedupe entre
 *     campanhas (o índice único de wa_campanha_alvos é por campanha, de
 *     propósito), então os mesmos clientes recebiam a sequência 2x pelo
 *     WhatsApp do vendedor.
 *  2. Se o ativar falhava, o clique seguinte criava OUTRA campanha. Pior quando a
 *     falha é de rede depois do banco já ter gravado 'ativa': a 1ª campanha já
 *     está disparando e a 2ª dispara por cima.
 *
 * A trava é um valor fora do estado do React de propósito: `isPending`/useState
 * só mudam no próximo render, e dois cliques podem cair antes dele.
 */

/** Status de onde dá pra ligar a campanha. 'ativa' -> 'ativa' é no-op (idempotente). */
export const STATUS_QUE_PODEM_ATIVAR = ['rascunho', 'pausada'] as const

/** A campanha não tem mais como ser ligada (cancelada, concluída ou sumiu). */
export class CampanhaNaoAtivavelError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CampanhaNaoAtivavelError'
  }
}

/**
 * Decide o que fazer quando o UPDATE pra 'ativa' não pegou linha nenhuma,
 * olhando o status que a campanha tem AGORA no banco:
 *  - já está 'ativa' → deu certo antes (clique repetido, ou resposta perdida na
 *    rede depois do banco gravar). Não é erro: é o que torna o ativar idempotente.
 *  - ainda está num status que podia ligar → o UPDATE não aplicou (corrida ou
 *    RLS). Erro comum: tentar de novo pode resolver.
 *  - cancelada/concluída/sumiu → CampanhaNaoAtivavelError: não adianta insistir.
 */
export function conferirAtivacao(statusAtual: string | null | undefined): void {
  if (statusAtual === 'ativa') return
  if (statusAtual == null) throw new CampanhaNaoAtivavelError('Não achei a campanha pra ligar.')
  if ((STATUS_QUE_PODEM_ATIVAR as readonly string[]).includes(statusAtual)) {
    throw new Error('Não consegui ligar a campanha. Tente de novo.')
  }
  throw new CampanhaNaoAtivavelError(`A campanha está ${statusAtual} e não pode mais ser ligada.`)
}

export interface PedidoCampanha {
  vendedorNome: string
  titulo: string
  sequenciaId: string
  ritmo: string
  alvos: { telefone: string }[]
}

/**
 * O que o vendedor pediu. Mesma chave = mesma campanha: o clique seguinte a uma
 * falha no ativar reaproveita a que já foi criada em vez de criar outra. Mudou
 * sequência, ritmo, título ou a seleção, é outro pedido.
 */
export function chaveEnvioCampanha(p: PedidoCampanha): string {
  const telefones = p.alvos.map(a => (a.telefone || '').replace(/\D/g, '')).sort()
  return JSON.stringify([p.vendedorNome, p.titulo, p.sequenciaId, p.ritmo, telefones])
}

export interface EnvioCampanha {
  /** true enquanto um criar+ativar está no ar. */
  emAndamento(): boolean
  /**
   * Cria (ou reaproveita, se a mesma chave já criou e o ativar falhou) e ativa.
   * Devolve false, sem fazer nada, se já houver um envio no ar.
   */
  enviar(
    chave: string,
    criar: () => Promise<{ id: string }>,
    ativar: (id: string) => Promise<void>,
  ): Promise<boolean>
}

export function criarEnvioCampanha(): EnvioCampanha {
  let emAndamento = false
  // Campanha criada cujo ativar falhou (ou não se sabe se pegou).
  let criadaSemAtivar: { chave: string; id: string } | null = null

  return {
    emAndamento: () => emAndamento,
    async enviar(chave, criar, ativar) {
      if (emAndamento) return false
      // Marcado ANTES do primeiro await: o 2º clique já encontra a trava fechada.
      emAndamento = true
      try {
        const id = criadaSemAtivar?.chave === chave ? criadaSemAtivar.id : (await criar()).id
        criadaSemAtivar = { chave, id }
        try {
          await ativar(id)
        } catch (e) {
          // Cancelada/concluída/sumiu: o próximo clique tem que criar outra.
          if (e instanceof CampanhaNaoAtivavelError) criadaSemAtivar = null
          throw e
        }
        criadaSemAtivar = null
        return true
      } finally {
        emAndamento = false
      }
    },
  }
}
