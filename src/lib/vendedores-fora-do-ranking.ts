/**
 * Quem NÃO entra em ranking, meta e conta de vendedor.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 * DANIEL é o DONO da empresa, não um vendedor da equipe. Ele monta proposta e
 * fecha negócio de verdade (medido em 18/08/2026: 223 propostas e 11 vendas),
 * mas medir a equipe com ele dentro distorce tudo — o WhatsApp dele não é
 * carteira, a meta dele não é meta de vendedor, e ele lideraria todo ranking.
 *
 * ⚠️ Três pontos do código comentavam "Daniel (testes)". NÃO é conta de teste
 * — é o dono, e os números dele são reais. A palavra importa: "teste" sugere
 * lixo descartável e convida alguém a apagar o filtro achando que limpa
 * sujeira; "dono fora do ranking" explica a decisão de negócio.
 *
 * ── Por que aqui e não no banco ───────────────────────────────────────────
 * `mirror_vendedores` seria o lugar natural para uma coluna `conta_ranking`,
 * mas é ESPELHO sincronizado do Controle (tem `synced_at`): coluna nova seria
 * sobrescrita no próximo sync. Enquanto o Controle não expuser esse campo, a
 * regra mora no código — mas em UM lugar só.
 *
 * ── O defeito que isto conserta ───────────────────────────────────────────
 * A mesma regra estava escrita de TRÊS formas incompatíveis:
 *   • `/daniel/i`            — regex, pega qualquer nome que CONTENHA "daniel"
 *                              (useOrcamentosResumo, TabEquipe, TabVisaoGeral)
 *   • `=== 'DANIEL'`         — igualdade no nome inteiro (useWaKanban)
 *   • primeiro nome em caixa  — (useResumoDia)
 *
 * Hoje as três concordam por SORTE: as 4 tabelas e as 2 RPCs escrevem
 * exatamente "DANIEL" (conferido no banco). No dia em que a Branorte
 * contratar uma **Daniela**, o regex a esconde e as outras duas a mostram —
 * e os totais das metades param de fechar. Não quebra, não avisa, só diverge.
 *
 * ── A regra escolhida ─────────────────────────────────────────────────────
 * Compara o PRIMEIRO NOME em caixa alta. É exatamente o que `useResumoDia` já
 * fazia, então nenhum número muda hoje; e é mais estreita que o regex, que
 * pegava "Daniela" e "McDaniel" junto.
 *
 * ⚠️ Continua sendo nome, não identidade: um **Daniel Souza** contratado
 * amanhã cairia aqui indevidamente. O conserto definitivo é o Controle expor
 * uma flag por vendedor — aí esta lista some. Até lá, é UM lugar para mexer.
 *
 * ── ⚠️ O LADO SQL AINDA NÃO ESTÁ AQUI ─────────────────────────────────────
 * Este módulo unificou o TypeScript. A mesma regra também está escrita dentro
 * de **7 funções do Postgres**, em 3 dialetos:
 *
 *   `ilike '%daniel%'`        dashboard_extra, dashboard_orcamentos_periodo,
 *                             dashboard_orcamentos_periodo_detalhe,
 *                             dashboard_propostas_status
 *   `!~* 'daniel'`            dashboard_orfaos_por_vendedor, metas_semanais
 *   `!~* 'a definir|daniel'`  dashboard_vendedor_cobertura
 *
 * Todos os três são "CONTÉM daniel" — mais largo que a regra deste arquivo,
 * que é "primeiro nome É Daniel". Hoje dão o mesmo resultado porque só existe
 * "DANIEL" no banco (conferido em 18/08/2026 nas 4 tabelas e nas 2 RPCs).
 *
 * Numa contratação de "Daniela": o SQL a esconde, o TypeScript a mostra, e
 * os blocos alimentados por RPC param de fechar com os alimentados por query
 * direta — na MESMA tela. Migrar as 7 funções é mudança em banco de produção
 * usado por outras telas, então é decisão separada, não efeito colateral
 * desta refatoração.
 */

/** Primeiro nome, em caixa alta. Fonte: `mirror_vendedores.nome` (Controle grava em caixa). */
const FORA_DO_RANKING = new Set(['DANIEL'])

function primeiroNomeCaixa(nome: string | null | undefined): string {
  return (nome ?? '').trim().split(/\s+/)[0]?.toUpperCase() ?? ''
}

/**
 * `true` quando o nome é de alguém que não deve entrar em ranking, meta ou
 * conta de vendedor. Tolera caixa, espaço em volta e sobrenome.
 */
export function foraDoRanking(nome: string | null | undefined): boolean {
  return FORA_DO_RANKING.has(primeiroNomeCaixa(nome))
}

/** Açúcar para `.filter()` numa lista de objetos com nome de vendedor. */
export function soVendedores<T>(getNome: (item: T) => string | null | undefined) {
  return (item: T) => !foraDoRanking(getNome(item))
}

/**
 * Mesma lista, para filtrar no BANCO (`.not('col','in',...)`), onde a função
 * acima não alcança. Nasce do mesmo Set — foi ter duas listas paralelas, uma
 * no SQL e outra no JS, que criou a divergência que este módulo conserta.
 *
 * ⚠️ Aqui a comparação é do nome INTEIRO, porque quem filtra é o Postgres.
 * Só funciona enquanto as tabelas gravarem o primeiro nome puro — que é o
 * caso hoje (`wascript_etiquetas.vendedor_nome` = "DANIEL", conferido).
 */
export const NOMES_FORA_DO_RANKING: string[] = [...FORA_DO_RANKING]
