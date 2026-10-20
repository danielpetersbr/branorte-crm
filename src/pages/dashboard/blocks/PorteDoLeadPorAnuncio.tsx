import { useMemo, useState } from 'react'
import { AlertTriangle, CircleDashed } from 'lucide-react'
import type { DashboardPreset } from '@/hooks/useDashboard'
import type { JanelaCanais } from '@/hooks/useDashboardCanais'
import { useDashboardPorteAnuncio, type PorteAnuncio } from '@/hooks/useDashboardPorteAnuncio'
import { Card, CardHeader, Inner } from '../ui/Card'
import { JanelaBadge } from '../ui/JanelaBadge'
import { n, pct } from '../ui/format'

/**
 * "Qual anúncio traz o produtor maior?" (20/10/2026)
 *
 * Fonte: o que a ANA coletou na conversa (espécie, quantidade, uso, repasse ao vendedor).
 * É por ANÚNCIO do Meta (ID), não pelo código &NN: a Ana guarda a origem pelo ID do anúncio.
 * Porte com corte único só para BOVINO (200 e 500 cabeças, medidos na Branorte); suíno e
 * aves mostram a quantidade típica (mediana), porque 200 aves e 200 bois não são o mesmo
 * tamanho de fábrica.
 */

type Ordem = 'boi200' | 'conversas' | 'tipico'
const AMOSTRA_MIN = 15

const fmt = (v: number | null) => (v == null ? '—' : n(Math.round(v)))

function rotulo(l: PorteAnuncio): { titulo: string; sub: string | null } {
  if (!l.ad_id) return { titulo: 'Sem anúncio', sub: 'orgânico, site ou indicação' }
  if (l.anuncio) return { titulo: l.anuncio, sub: l.texto }
  return { titulo: `Anúncio …${l.ad_id.slice(-6)}`, sub: l.texto }
}

export function PorteDoLeadPorAnuncio({ preset, periodoLabel }: { preset: DashboardPreset; periodoLabel: string }) {
  const [janela, setJanela] = useState<JanelaCanais>('90d')
  const [ordem, setOrdem] = useState<Ordem>('boi200')
  const [todos, setTodos] = useState(false)
  const q = useDashboardPorteAnuncio(janela, preset)
  const linhas = q.data?.linhas
  const usou90 = q.data?.usou90 ?? janela === '90d'

  const tot = useMemo(() => (linhas ?? []).reduce((a, l) => ({
    conversas: a.conversas + l.conversas,
    qtd: a.qtd + l.informou_qtd,
    boi200: a.boi200 + l.bovino_200,
    repass: a.repass + l.repassados,
  }), { conversas: 0, qtd: 0, boi200: 0, repass: 0 }), [linhas])

  const visiveis = useMemo(() => {
    const rows = (linhas ?? []).filter(l => todos || l.conversas >= AMOSTRA_MIN)
    const chave = (l: PorteAnuncio) =>
      ordem === 'conversas' ? l.conversas : ordem === 'tipico' ? (l.bovino_mediana ?? -1) : l.bovino_200
    return [...rows].sort((a, b) => (chave(b) - chave(a)) || (b.conversas - a.conversas))
  }, [linhas, todos, ordem])
  const escondidos = (linhas?.length ?? 0) - visiveis.length

  const th = 'whitespace-nowrap px-2 py-2 text-micro font-semibold text-ink-muted'
  const td = 'px-2 py-2 text-body tabular-nums text-ink-muted border-t border-border'
  const botao = (ativo: boolean) =>
    `inline-flex min-h-[44px] items-center rounded-lg px-3 py-1 text-micro md:min-h-0 ${ativo ? 'bg-accent font-semibold text-accent-fg' : 'bg-surface-2 text-ink-muted hover:text-ink'}`

  return (
    <Card id="marketing-porte-anuncio">
      <CardHeader
        title="Qual anúncio traz o produtor maior"
        subtitle="O que os leads contaram para a Ana: espécie e quantidade de animais, e quantos ela passou para vendedor. Por anúncio do Meta."
        janela={<JanelaBadge tipo={usou90 ? 'fixo' : 'periodo'} label={usou90 ? 'últimos 90 dias' : periodoLabel} />}
        right={
          <div className="flex gap-1" role="group" aria-label="Janela">
            <button type="button" className={botao(janela === '90d')} aria-pressed={janela === '90d'} onClick={() => setJanela('90d')}>90 dias</button>
            <button type="button" className={botao(janela === 'periodo')} aria-pressed={janela === 'periodo'} onClick={() => setJanela('periodo')}>Período do topo</button>
          </div>
        }
      />

      {q.error && !linhas ? (
        <p className="rounded-lg bg-surface-2 p-4 text-body text-ink-muted">Não deu para carregar o porte por anúncio agora. Use Atualizar dados.</p>
      ) : !linhas ? (
        <div className="h-[240px] animate-pulse rounded-lg bg-surface-2" aria-label="Carregando porte por anúncio" />
      ) : (
        <div className={q.isPlaceholderData ? 'opacity-60' : ''} aria-busy={q.isPlaceholderData}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-label text-ink-muted">
              {n(tot.conversas)} conversas da Ana · <strong className="text-ink">{pct(tot.conversas > 0 ? (tot.qtd / tot.conversas) * 100 : 0, 0)} disseram quantos animais</strong> · {n(tot.boi200)} com 200+ bois · {n(tot.repass)} passadas ao vendedor
            </p>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Ordenar por">
              <button type="button" className={botao(ordem === 'boi200')} aria-pressed={ordem === 'boi200'} onClick={() => setOrdem('boi200')}>Mais bois 200+</button>
              <button type="button" className={botao(ordem === 'tipico')} aria-pressed={ordem === 'tipico'} onClick={() => setOrdem('tipico')}>Maior rebanho típico</button>
              <button type="button" className={botao(ordem === 'conversas')} aria-pressed={ordem === 'conversas'} onClick={() => setOrdem('conversas')}>Mais conversas</button>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[980px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th scope="col" className={`${th} text-left`}>Anúncio</th>
                  <th scope="col" className={`${th} text-right`}>Conversas</th>
                  <th scope="col" className={`${th} text-right`} title="Parte das conversas em que o lead disse quantos animais tem. O porte abaixo descreve só quem respondeu.">Disseram qtd.</th>
                  <th scope="col" className={`${th} text-right`}>Bovinos</th>
                  <th scope="col" className={`${th} text-right`} title="Rebanho típico (mediana) de quem disse a quantidade de bois">Boi típico</th>
                  <th scope="col" className={`${th} text-right`} title="Leads com 200 cabeças ou mais — o porte que mais vira proposta na Branorte">Boi 200+</th>
                  <th scope="col" className={`${th} text-right`}>Boi 500+</th>
                  <th scope="col" className={`${th} text-right`} title="Suínos: quantos leads e o plantel típico">Suínos</th>
                  <th scope="col" className={`${th} text-right`} title="Aves: quantos leads e o plantel típico">Aves</th>
                  <th scope="col" className={`${th} text-right`} title="Querem fabricar ração para VENDER (revenda)">Revenda</th>
                  <th scope="col" className={`${th} text-right`} title="Conversas que a Ana passou para um vendedor">Passou p/ vendedor</th>
                  <th scope="col" className={`${th} text-left`}>Mais pedido</th>
                </tr>
              </thead>
              <tbody>
                {visiveis.map(l => {
                  const r = rotulo(l)
                  const pouca = l.conversas < AMOSTRA_MIN || l.informou_qtd < 5
                  return (
                    <tr key={l.ad_id ?? 'sem-anuncio'}>
                      <th scope="row" className="max-w-[280px] border-t border-border px-2 py-2 text-left align-top">
                        <span className="block text-body font-medium text-ink">{r.titulo}</span>
                        {r.sub && <span className="block truncate text-micro text-ink-faint" title={r.sub}>{r.sub}</span>}
                        <span className="mt-0.5 flex flex-wrap gap-1">
                          {l.app && <span className="rounded-sm bg-surface-2 px-1.5 py-0.5 text-micro text-ink-faint">{l.app}</span>}
                          {pouca && (
                            <span className="inline-flex items-center gap-1 rounded-sm bg-surface-2 px-1.5 py-0.5 text-micro text-ink-faint" title="Menos de 15 conversas ou menos de 5 com quantidade: ainda não dá para comparar">
                              <CircleDashed className="h-3 w-3" aria-hidden="true" />amostra pequena
                            </span>
                          )}
                        </span>
                      </th>
                      <td className={`${td} text-right`}>{n(l.conversas)}</td>
                      <td className={`${td} text-right`}>{l.conversas > 0 ? pct((l.informou_qtd / l.conversas) * 100, 0) : '—'}</td>
                      <td className={`${td} text-right`}>{n(l.bovino)}</td>
                      <td className={`${td} text-right`}>{l.bovino_mediana != null ? `${fmt(l.bovino_mediana)} cab.` : '—'}</td>
                      <td className={`${td} text-right font-semibold text-ink`}>{n(l.bovino_200)}</td>
                      <td className={`${td} text-right`}>{n(l.bovino_500)}</td>
                      <td className={`${td} text-right`}>{n(l.suino)}{l.suino_mediana != null && <span className="block text-micro text-ink-faint">{fmt(l.suino_mediana)} típico</span>}</td>
                      <td className={`${td} text-right`}>{n(l.aves)}{l.aves_mediana != null && <span className="block text-micro text-ink-faint">{fmt(l.aves_mediana)} típico</span>}</td>
                      <td className={`${td} text-right`}>{n(l.revenda)}</td>
                      <td className={`${td} text-right`}>{l.conversas > 0 ? pct((l.repassados / l.conversas) * 100, 0) : '—'}</td>
                      <td className={`${td} text-left text-micro`}>{l.equipamento_mais_pedido ?? '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {escondidos > 0 && !todos && (
            <button type="button" onClick={() => setTodos(true)} className="mt-2 min-h-[44px] text-micro text-ink-muted underline hover:text-ink md:min-h-0">
              Mostrar mais {n(escondidos)} anúncio(s) com menos de {AMOSTRA_MIN} conversas
            </button>
          )}

          <Inner tone="atencao" className="mt-4 flex items-start gap-2">
            <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            <ul className="space-y-1 text-micro text-ink-muted">
              <li><strong className="text-ink">O porte descreve só quem respondeu à Ana</strong> ({pct(tot.conversas > 0 ? (tot.qtd / tot.conversas) * 100 : 0, 0)} disseram a quantidade). Anúncio com pouca resposta pode ter produtor grande escondido.</li>
              <li><strong className="text-ink">Anúncio de equipamento</strong> (ensacadeira, esteira, moinho…) quase não tem porte: nesse caminho a Ana não pergunta os animais.</li>
              <li><strong className="text-ink">O mesmo texto roda em anúncios diferentes</strong> e rende diferente — muda o público. Compare por anúncio, não pela mensagem.</li>
              <li><strong className="text-ink">Proposta e venda por anúncio ainda não dá:</strong> na maioria das conversas o WhatsApp entrega só o código interno do contato, sem telefone. Para proposta, use o quadro por canal acima.</li>
              <li>Anúncio sem nome aparece pelo final do ID e pelo texto: o cadastro de anúncios do Gerenciador ainda não tem os mais novos.</li>
            </ul>
          </Inner>
        </div>
      )}
    </Card>
  )
}
