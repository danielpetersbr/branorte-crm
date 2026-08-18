import { useState } from 'react'
import { UserCheck, UserX, FileWarning, Hand, Scale, UserMinus } from 'lucide-react'
import { cn, formatNumber, formatPhone } from '@/lib/utils'
import { MOTIVO_FORA_LABEL, type MeuPlacar, type RelatorioContatos, type Violacao } from '@/hooks/useMeusContatos'

/**
 * "Quem é dono de quem" — o painel de cima da /contatos.
 *
 * Responde três perguntas que o Daniel pediu em 18/08/2026:
 *   1. quantos contatos TÊM vendedor e quantos NÃO têm;
 *   2. quantos EU já puxei da lista (placar do vendedor);
 *   3. quais violam a regra "sem vendedor não pode ter orçamento".
 *
 * ⚠️ A REGRA, escrita: se um contato tem orçamento, alguém já vendeu pra ele —
 * logo ele TEM dono, mesmo que o CRM não saiba o nome. Por isso o número de
 * violações não é decoração: cada linha ali é um cliente que qualquer vendedor
 * pode chamar achando que é lead frio.
 *
 * As violações se dividem em duas espécies, e a diferença importa:
 *   • `disputa` — 2+ vendedores no histórico de orçamento. Ninguém pode carimbar
 *     automático sem escolher por outro. Cuidado: parte destes é telefone
 *     FUNDIDO (a regra do 9º dígito junta fixo com celular), então são pessoas
 *     diferentes no mesmo contato — não é o mesmo cliente disputado.
 *   • `orfao` — nenhum orçamento sabe o vendedor. Ex-vendedor (Samuel, Thiago,
 *     Geffiter) ou arquivo sem identificação. O banco não tem como resolver.
 *
 * `propagar` não deveria aparecer: é o caso em que UM vendedor conhecido consta
 * no orçamento e o contato ficou sem — corrigido no backfill de 18/08 e agora
 * fechado na origem (`sync_contacts_from_orcamentos`). Se voltar a aparecer,
 * a torneira vazou de novo.
 */

function Numero({
  icone: Icone, rotulo, valor, cor, ajuda, onClick, ativo,
}: {
  icone: typeof UserCheck
  rotulo: string
  valor: number | null
  cor: string
  ajuda: string
  onClick?: () => void
  ativo?: boolean
}) {
  const Tag = onClick ? 'button' : 'div'
  return (
    <Tag
      {...(onClick ? { onClick, type: 'button' as const, 'aria-pressed': !!ativo } : {})}
      title={ajuda}
      className={cn(
        'text-left rounded-lg border px-2.5 py-2 min-w-0',
        'transition-colors duration-100 motion-reduce:transition-none',
        onClick && 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
        ativo
          ? 'border-accent/50 bg-accent-bg'
          : cn('border-border bg-surface', onClick && 'hover:bg-surface-2/60 hover:border-border-strong'),
      )}
    >
      <span className="flex items-center gap-1 min-w-0">
        <Icone aria-hidden className={cn('h-3 w-3 shrink-0', cor)} />
        <span className="truncate text-[10.5px] font-medium uppercase tracking-[0.03em] text-ink-muted">
          {rotulo}
        </span>
      </span>
      <span className="mt-0.5 block text-[16px] font-semibold tabular-nums text-ink leading-none">
        {/* null = a consulta ainda não voltou. Zero seria mentira. */}
        {valor === null ? '—' : formatNumber(valor)}
      </span>
    </Tag>
  )
}

export function PainelDonos({
  relatorio, placar, violacoes, carregandoViolacoes,
  verViolacoes, onVerViolacoes, poolAtivo, onPool,
}: {
  relatorio: RelatorioContatos | null | undefined
  placar: MeuPlacar | null | undefined
  violacoes: Violacao[] | undefined
  carregandoViolacoes: boolean
  verViolacoes: boolean
  onVerViolacoes: (v: boolean) => void
  /** O recorte "sem dono e sem orçamento" está ligado? */
  poolAtivo: boolean
  onPool: () => void
}) {
  const [verPorVendedor, setVerPorVendedor] = useState(false)
  if (!relatorio) return null

  const v = relatorio.violacoes_sem_vendedor_com_orcamento

  return (
    <section aria-label="Donos dos contatos" className="mt-4">
      <div className="flex items-baseline gap-2 mb-1.5">
        <h2 className="text-[10px] uppercase font-semibold tracking-[0.08em] text-ink-faint">
          Donos dos contatos
        </h2>
        {!!relatorio.por_vendedor.length && (
          <button
            onClick={() => setVerPorVendedor(x => !x)}
            className="text-[11px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
          >
            {verPorVendedor ? 'ocultar por vendedor' : 'por vendedor'}
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-5 gap-1.5">
        <Numero
          icone={UserCheck} rotulo="Com vendedor" valor={relatorio.com_vendedor}
          cor="text-success"
          ajuda="Contatos que têm um vendedor dono. No seu escopo de visão."
        />
        <Numero
          icone={UserX} rotulo="Sem vendedor" valor={relatorio.sem_vendedor}
          cor="text-ink-faint"
          ajuda="Contatos sem dono nenhum. Inclui os que têm orçamento (que não deveriam estar aqui) — veja o card de violações."
        />
        <Numero
          icone={Hand} rotulo="Pool de prospecção" valor={relatorio.sem_vendedor_sem_orcamento}
          cor="text-accent" ativo={poolAtivo} onClick={onPool}
          ajuda={
            'Contato que NINGUÉM nunca conversou e não é de outro: sem vendedor, sem etiqueta, '
            + 'sem conversa no WhatsApp, sem orçamento e sem ser duplicata de um cliente que já tem dono. '
            + 'É o que dá pra puxar sem risco de ligar pro cliente do colega.\n\n'
            + 'Clique para filtrar a lista por ele.'
          }
        />
        <Numero
          icone={FileWarning} rotulo="Sem dono, com orçamento" valor={v}
          cor={v > 0 ? 'text-danger' : 'text-success'}
          ativo={verViolacoes}
          onClick={() => onVerViolacoes(!verViolacoes)}
          ajuda={
            'VIOLA A REGRA: quem tem orçamento tem dono, o CRM é que não sabe quem. '
            + 'Não prospecte estes — o cliente já foi atendido. Clique para ver quem são.'
          }
        />
        {/* O placar do vendedor. Admin sem vendedor ligado não prospecta: some. */}
        {placar?.vendor_id ? (
          <Numero
            icone={Hand} rotulo={`Eu prospectei (${placar.vendedor ?? ''})`} valor={placar.total}
            cor="text-accent"
            ajuda={
              `Contatos que VOCÊ puxou da lista com "Pegar pra mim".\n\n`
              + `Hoje: ${placar.hoje}\n7 dias: ${placar.sete_dias}\n30 dias: ${placar.trinta_dias}\n`
              + `Total: ${placar.total}\n\nSua carteira inteira (inclusive o que não veio da lista): ${placar.carteira}`
            }
          />
        ) : (
          <div
            className="rounded-lg border border-dashed border-border px-2.5 py-2 text-[11px] text-ink-faint"
            title="Seu usuário não está ligado a um vendedor, então não há no que carimbar contato."
          >
            sem vendedor ligado ao usuário
          </div>
        )}
      </div>

      {/* A DIFERENÇA EXPLICADA. "172.826 sem vendedor" e "167.741 no pool" sem
          dizer o que houve com os 5.085 do meio é o tipo de número que faz o
          dono desconfiar da tela inteira. */}
      {(() => {
        const fora = relatorio.fora_do_pool_por_motivo ?? {}
        const itens = Object.entries(fora).filter(([, n]) => n > 0)
          .sort((a, b) => b[1] - a[1])
        const soma = itens.reduce((s, [, n]) => s + n, 0)
        if (!soma) return null
        return (
          <p className="mt-1.5 text-[11.5px] text-ink-muted">
            <span className="font-medium text-ink tabular-nums">{formatNumber(soma)}</span>{' '}
            sem vendedor ficaram <span className="font-medium">fora</span> do pool:{' '}
            {itens.map(([k, n], i) => (
              <span key={k}>
                {i > 0 && '; '}
                <span className="tabular-nums">{formatNumber(n)}</span>{' '}
                {MOTIVO_FORA_LABEL[k] ?? k}
              </span>
            ))}.
          </p>
        )
      })()}

      {/* Placar detalhado — só quando o vendedor tem o que mostrar. */}
      {!!placar?.vendor_id && placar.total > 0 && (
        <p className="mt-1.5 text-[11.5px] text-ink-muted tabular-nums">
          Você pegou <span className="font-medium text-ink">{formatNumber(placar.hoje)}</span> hoje,{' '}
          <span className="font-medium text-ink">{formatNumber(placar.sete_dias)}</span> nos últimos 7 dias e{' '}
          <span className="font-medium text-ink">{formatNumber(placar.trinta_dias)}</span> nos últimos 30.
          Sua carteira tem <span className="font-medium text-ink">{formatNumber(placar.carteira)}</span> contatos.
        </p>
      )}

      {verPorVendedor && !!relatorio.por_vendedor.length && (
        <div className="mt-2 rounded-lg border border-border bg-surface p-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-x-4 gap-y-1">
            {relatorio.por_vendedor.map(pv => (
              <div key={pv.vendor_id} className="flex items-baseline justify-between gap-2 min-w-0">
                <span className="truncate text-[12px] text-ink-muted">{pv.vendedor}</span>
                <span className="text-[12.5px] font-medium tabular-nums text-ink">{formatNumber(pv.contatos)}</span>
              </div>
            ))}
          </div>
          {!relatorio.admin && (
            <p className="mt-1.5 text-[11px] text-ink-faint">
              Você vê só o seu número. O total da equipe é do administrador.
            </p>
          )}
        </div>
      )}

      {/* A LISTA das violações. */}
      {verViolacoes && (
        <div className="mt-2 rounded-lg border border-border bg-surface">
          <div className="flex items-center justify-between gap-2 px-2.5 py-2 border-b border-border">
            <span className="text-[12px] text-ink-muted">
              {v === 0
                ? 'Nenhum contato sem vendedor tem orçamento. A regra está sendo cumprida.'
                : <>
                    <span className="font-medium text-ink tabular-nums">{formatNumber(v)}</span> contatos sem
                    vendedor têm orçamento —{' '}
                    <span className="tabular-nums">{formatNumber(relatorio.violacoes_disputa)}</span> em disputa,{' '}
                    <span className="tabular-nums">{formatNumber(relatorio.violacoes_orfa)}</span> órfãos de
                    vendedor que saiu
                    {/* Os 3 números NÃO fecham sem esta parcela: disputa+órfão conta
                        só quem tem arquivo LIGADO. Os "sem vínculo" têm orçamento na
                        origem e nenhum arquivo — não cabem na lista abaixo, e omitir
                        deixava 206 casos sem explicação na tela. */}
                    {relatorio.violacoes_sem_vinculo > 0 && <>
                      {' '}e <span className="tabular-nums">{formatNumber(relatorio.violacoes_sem_vinculo)}</span>{' '}
                      <span title="Têm orçamento na origem do cadastro mas nenhum arquivo vinculado: o arquivo pertence a outro contato (telefone duplicado) ou é pedido de venda, que não fica em orcamentos_files. Não aparecem na lista abaixo.">
                        sem vínculo com arquivo
                      </span>
                    </>}.
                  </>}
            </span>
            <button
              onClick={() => onVerViolacoes(false)}
              className="shrink-0 text-[11px] text-accent hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
            >
              fechar
            </button>
          </div>

          {carregandoViolacoes && (
            <p className="px-2.5 py-3 text-[12.5px] text-ink-muted">Carregando…</p>
          )}

          {!carregandoViolacoes && !!violacoes?.length && (
            <>
              <div className="max-h-[320px] overflow-auto">
                <table className="w-full text-[12.5px]">
                  <thead className="sticky top-0">
                    <tr className="[&>th]:bg-surface-2 [&>th]:text-left [&>th]:px-2.5 [&>th]:py-1.5 [&>th]:text-[10px] [&>th]:font-semibold [&>th]:uppercase [&>th]:tracking-[0.06em] [&>th]:text-ink-muted [&>th]:border-b [&>th]:border-border">
                      <th>Cliente</th>
                      <th>Telefone</th>
                      <th className="w-[46px]">UF</th>
                      <th className="w-[64px]">Orç.</th>
                      <th className="w-[64px]">Ano</th>
                      <th>Vendedor no orçamento</th>
                      <th className="w-[92px]">Tipo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {violacoes.map(l => (
                      <tr key={l.contact_id} className="border-b border-border last:border-0">
                        <td className="px-2.5 py-1.5 text-ink truncate max-w-0">{l.nome ?? '—'}</td>
                        <td className="px-2.5 py-1.5 text-ink-muted tabular-nums whitespace-nowrap">
                          {l.telefone ? formatPhone(l.telefone) : '—'}
                        </td>
                        <td className="px-2.5 py-1.5 text-ink-muted">{l.uf ?? '—'}</td>
                        <td className="px-2.5 py-1.5 text-ink-muted tabular-nums">{l.n_orcamentos}</td>
                        <td className="px-2.5 py-1.5 text-ink-muted tabular-nums">{l.ano_recente ?? '—'}</td>
                        <td className="px-2.5 py-1.5 text-ink-muted truncate max-w-0">{l.vendedores}</td>
                        <td className="px-2.5 py-1.5">
                          <span
                            title={
                              l.tipo === 'disputa'
                                ? 'Mais de um vendedor no histórico. Pode também ser telefone fundido (dois clientes no mesmo contato) — confira antes de decidir.'
                                : l.tipo === 'orfao'
                                ? 'Nenhum orçamento identifica o vendedor: ex-vendedor ou arquivo sem identificação.'
                                : 'Um vendedor conhecido consta no orçamento e o contato ficou sem — não deveria aparecer aqui.'
                            }
                            className={cn(
                              'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10.5px] font-medium',
                              l.tipo === 'disputa' && 'bg-warning-bg text-warning',
                              l.tipo === 'orfao' && 'bg-surface-2 text-ink-muted',
                              l.tipo === 'propagar' && 'bg-danger-bg text-danger',
                            )}
                          >
                            {l.tipo === 'disputa' ? <Scale className="h-3 w-3" aria-hidden />
                              : l.tipo === 'orfao' ? <UserMinus className="h-3 w-3" aria-hidden />
                              : <FileWarning className="h-3 w-3" aria-hidden />}
                            {l.tipo === 'disputa' ? 'disputa' : l.tipo === 'orfao' ? 'órfão' : 'propagar'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* A RPC devolve no máximo 500. Dizer isso evita ler a lista como
                  se fosse o total — o card acima é que tem o número certo. */}
              {/* Sempre dizer quantas estão na tela contra o total. Antes só
                  avisava no teto de 500 — quem tratasse as 500 concluía que
                  acabou, e as outras nunca eram oferecidas. */}
              <p className="px-2.5 py-1.5 text-[11px] text-ink-faint border-t border-border">
                Mostrando {formatNumber(violacoes.length)} das {formatNumber(v)}
                {violacoes.length >= 500 && ' (teto de 500 por consulta, as mais recentes primeiro)'}
                {relatorio.violacoes_sem_vinculo > 0
                  && `. As ${formatNumber(relatorio.violacoes_sem_vinculo)} sem vínculo com arquivo não entram nesta lista.`}
              </p>
            </>
          )}
        </div>
      )}
    </section>
  )
}
