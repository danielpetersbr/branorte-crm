/**
 * Modo ATENDIMENTO RÁPIDO.
 *
 * O vendedor está no telefone com o produtor. Ele marca o que já sabe e a tela
 * responde três coisas: o que AINDA falta perguntar, quanto o cliente precisa
 * por mês, e o que pode dar errado.
 *
 * Disciplina que não se quebra: sem espécie, fase, quantidade e consumo
 * CONFIRMADO, a tela não fecha capacidade de equipamento. Mostra o cálculo como
 * ponto de partida e diz, com todas as letras, o que falta.
 */
import { useMemo, useState } from 'react'
import {
  AlertCircle, ArrowRight, Check, Copy, Factory, ListChecks, RotateCcw, Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Alerta } from './Selos'
import { Perguntas, Secao } from './DetalhePartes'
import { analisar, resumoParaCopiar } from '@/lib/guia/atendimento'
import { EQUIPAMENTOS, ESPECIES, NOME_SISTEMA, SISTEMAS } from '@/lib/guia/catalogo'
import { CATEGORIAS } from '@/lib/venda-racao/catalogo'
import { cn } from '@/lib/utils'
import type {
  Atendimento, Especie, GuiaAnimal, GuiaMateria, ItemGuia,
} from '@/lib/guia/tipos'

const PRODUTOS = [
  'Ração farelada completa', 'Concentrado', 'Sal mineral / proteinado',
  'Milho triturado', 'Ainda não sabe',
]

const VAZIO: Atendimento = {
  especie: null, fase: null, quantidade: null, sistema: null,
  produto: null, materias: [], consumoConfirmado: false,
}

interface Props {
  animais: GuiaAnimal[]
  materias: GuiaMateria[]
  onAbrir: (i: ItemGuia) => void
  onUsarNoEstudo: (dados: { especie: Especie; fase: string; quantidade: number; consumo: number | null }) => void
}

function Passo({ n, titulo, children, ok }: {
  n: number; titulo: string; children: React.ReactNode; ok?: boolean
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold',
          ok ? 'bg-success text-white' : 'bg-surface-2 text-ink-faint',
        )}>
          {ok ? <Check className="h-3 w-3" /> : n}
        </span>
        <h3 className="text-[12px] font-bold uppercase tracking-wide text-ink-muted">{titulo}</h3>
      </div>
      {children}
    </div>
  )
}

function Opcoes<T extends string>({ valor, opcoes, onEscolher, rotulo }: {
  valor: T | null
  opcoes: Array<{ chave: T; nome: string; icone?: string }>
  onEscolher: (v: T | null) => void
  rotulo: string
}) {
  return (
    <div role="group" aria-label={rotulo} className="flex flex-wrap gap-1.5">
      {opcoes.map(o => (
        <button
          key={o.chave}
          type="button"
          aria-pressed={valor === o.chave}
          onClick={() => onEscolher(valor === o.chave ? null : o.chave)}
          className={cn(
            'rounded-full border px-2.5 py-1 text-[12.5px] transition-colors',
            valor === o.chave
              ? 'border-accent bg-accent text-white'
              : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
          )}
        >
          {o.icone ? `${o.icone} ` : ''}{o.nome}
        </button>
      ))}
    </div>
  )
}

export function AtendimentoRapido({ animais, materias, onAbrir, onUsarNoEstudo }: Props) {
  const [a, setA] = useState<Atendimento>(VAZIO)
  const [copiado, setCopiado] = useState(false)

  const fases = useMemo(() => {
    if (!a.especie) return []
    const doEstudo = CATEGORIAS[a.especie as 'bovinos' | 'suinos' | 'aves']
    if (doEstudo) return doEstudo.filter(c => c.chave !== 'outro').map(c => ({ chave: c.chave, nome: c.nome }))
    // Ovino e caprino ainda não têm catálogo no estudo: usa as fases dos cards.
    const doGuia = animais.filter(x => x.especie === a.especie).flatMap(x => x.fases)
    return Array.from(new Set(doGuia)).map(f => ({ chave: f, nome: f.replace(/_/g, ' ') }))
  }, [a.especie, animais])

  const sistemas = useMemo(
    () => (a.especie ? SISTEMAS.filter(s => s.especies.includes(a.especie as Especie)) : []),
    [a.especie],
  )

  const materiasVisiveis = useMemo(
    () => materias.filter(m => m.status === 'aprovado' || m.status === 'desatualizado'),
    [materias],
  )

  const r = useMemo(() => analisar(a, animais, materias), [a, animais, materias])
  const nomeFase = fases.find(f => f.chave === a.fase)?.nome ?? ''

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resumoParaCopiar(a, r, nomeFase))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* clipboard bloqueado */ }
  }

  const alternarMateria = (slug: string) =>
    setA(s => ({
      ...s,
      materias: s.materias.includes(slug) ? s.materias.filter(x => x !== slug) : [...s.materias, slug],
    }))

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      {/* ---------------- entrada ---------------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12.5px] text-ink-muted">
            Marque o que o cliente já contou. O que faltar aparece do lado como pergunta.
          </p>
          <Button size="sm" onClick={() => setA(VAZIO)}>
            <RotateCcw className="h-3.5 w-3.5" />Limpar
          </Button>
        </div>

        <Passo n={1} titulo="Espécie" ok={!!a.especie}>
          <Opcoes
            rotulo="Espécie"
            valor={a.especie}
            opcoes={ESPECIES.map(e => ({ chave: e.chave, nome: e.nome, icone: e.icone }))}
            onEscolher={v => setA(s => ({ ...s, especie: v, fase: null, sistema: null, consumoConfirmado: false }))}
          />
        </Passo>

        {!!a.especie && (
          <Passo n={2} titulo="Fase produtiva" ok={!!a.fase}>
            <Opcoes
              rotulo="Fase"
              valor={a.fase}
              opcoes={fases}
              onEscolher={v => setA(s => ({ ...s, fase: v, consumoConfirmado: false }))}
            />
          </Passo>
        )}

        {!!a.especie && (
          <Passo n={3} titulo="Sistema de criação" ok={!!a.sistema}>
            <Opcoes
              rotulo="Sistema"
              valor={a.sistema}
              opcoes={sistemas.map(s => ({ chave: s.chave, nome: s.nome }))}
              onEscolher={v => setA(s => ({ ...s, sistema: v }))}
            />
          </Passo>
        )}

        <Passo n={4} titulo="Quantidade de animais" ok={!!a.quantidade}>
          <div className="flex items-center gap-2">
            <div className="w-40">
              <Input
                type="number"
                min={0}
                inputMode="numeric"
                value={a.quantidade ?? ''}
                onChange={e => setA(s => ({ ...s, quantidade: e.target.value ? Number(e.target.value) : null }))}
                placeholder="0"
                aria-label="Quantidade de animais"
              />
            </div>
            <span className="text-[12.5px] text-ink-faint">
              {ESPECIES.find(e => e.chave === a.especie)?.animal ?? 'animais'}
            </span>
          </div>
          {r.consumoMesKg !== null && (
            <label className="mt-2.5 flex items-start gap-2 text-[12.5px] text-ink">
              <input
                type="checkbox"
                checked={a.consumoConfirmado}
                onChange={e => setA(s => ({ ...s, consumoConfirmado: e.target.checked }))}
                className="mt-0.5 h-3.5 w-3.5 accent-current"
              />
              <span>
                Confirmei com o cliente que o consumo é de <strong>{r.consumoMesKg} kg por animal por mês</strong>.
                <span className="block text-ink-faint">
                  Enquanto não confirmar, o número é referência de catálogo — não dimensiona equipamento.
                </span>
              </span>
            </label>
          )}
        </Passo>

        <Passo n={5} titulo="Produto desejado" ok={!!a.produto}>
          <Opcoes
            rotulo="Produto"
            valor={a.produto}
            opcoes={PRODUTOS.map(p => ({ chave: p, nome: p }))}
            onEscolher={v => setA(s => ({ ...s, produto: v }))}
          />
        </Passo>

        <Passo n={6} titulo="Matérias-primas que ele já tem" ok={!!a.materias.length}>
          <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto">
            {materiasVisiveis.map(m => (
              <button
                key={m.slug}
                type="button"
                aria-pressed={a.materias.includes(m.slug)}
                onClick={() => alternarMateria(m.slug)}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[12px] transition-colors',
                  a.materias.includes(m.slug)
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
                )}
              >
                {m.nome}
              </button>
            ))}
          </div>
        </Passo>
      </div>

      {/* ---------------- saída ---------------- */}
      <div className="space-y-3">
        {!!r.faltando.length && (
          <Secao titulo="Ainda falta levantar" icone={<AlertCircle className="h-3.5 w-3.5" />}>
            <ul className="flex flex-wrap gap-1.5">
              {r.faltando.map(f => (
                <li key={f}><Badge className="bg-warning-bg text-warning">{f}</Badge></li>
              ))}
            </ul>
          </Secao>
        )}

        {(r.consumoMesKg !== null || r.necessidadeMesKg !== null) && (
          <Secao titulo="Necessidade" destaque>
            <dl className="grid grid-cols-2 gap-3">
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-faint">Consumo de referência</dt>
                <dd className="text-lg font-bold text-ink">
                  {r.consumoMesKg !== null ? `${r.consumoMesKg} kg` : '—'}
                  <span className="ml-1 text-[11px] font-normal text-ink-faint">por animal/mês</span>
                </dd>
              </div>
              <div>
                <dt className="text-[11px] uppercase tracking-wide text-ink-faint">Necessidade mensal</dt>
                <dd className="text-lg font-bold text-ink">
                  {r.necessidadeMesKg !== null
                    ? `${Math.round(r.necessidadeMesKg).toLocaleString('pt-BR')} kg`
                    : '—'}
                </dd>
              </div>
            </dl>
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">Capacidade para análise</p>
              {r.capacidadeSugeridaKgH ? (
                <>
                  <p className="text-lg font-bold text-ink">{r.capacidadeSugeridaKgH} kg/h</p>
                  {r.capacidadeNota && <p className="mt-0.5 text-[12px] text-ink-muted">{r.capacidadeNota}</p>}
                </>
              ) : (
                <p className="mt-0.5 text-[12.5px] text-warning">
                  {r.capacidadeNota ?? 'Preencha espécie, fase, quantidade e confirme o consumo.'}
                </p>
              )}
            </div>
          </Secao>
        )}

        {!!r.perguntas.length && (
          <Secao titulo="Perguntas que ainda cabem" icone={<ListChecks className="h-3.5 w-3.5" />}>
            <Perguntas perguntas={r.perguntas.slice(0, 12)} />
          </Secao>
        )}

        {!!r.atencao.length && (
          <Secao titulo="Pontos de atenção">
            <div className="space-y-2">
              {r.atencao.slice(0, 10).map((x, i) => (
                <Alerta key={i} nivel={x.nivel}>{x.texto}</Alerta>
              ))}
            </div>
          </Secao>
        )}

        {!!r.processo.length && (
          <Secao titulo="Processo provável" icone={<Factory className="h-3.5 w-3.5" />}>
            <ul className="space-y-1.5">
              {r.processo.map((p, i) => (
                <li key={i} className="text-[13px] leading-relaxed text-ink">{p}</li>
              ))}
            </ul>
          </Secao>
        )}

        {!!r.equipamentos.length && (
          <Secao titulo="Equipamento que pode ser analisado" icone={<Wrench className="h-3.5 w-3.5" />}>
            <div className="flex flex-wrap gap-1.5">
              {r.equipamentos.map(e => (
                <Badge key={e} className="bg-surface-2 text-ink-muted">{EQUIPAMENTOS[e] ?? e}</Badge>
              ))}
            </div>
            {!r.podeFecharEquipamento && (
              <p className="mt-2 text-[12px] leading-relaxed text-warning">
                Lista para ANÁLISE. Nada aqui fecha equipamento enquanto faltar dado.
              </p>
            )}
          </Secao>
        )}

        {!!r.relacionados.length && (
          <Secao titulo="Conteúdos relacionados">
            <div className="flex flex-wrap gap-1.5">
              {r.relacionados.slice(0, 14).map(i => (
                <button
                  key={i.slug}
                  onClick={() => onAbrir(i)}
                  className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] text-ink hover:border-border-strong hover:bg-surface-2"
                >
                  {i.emoji} {i.nome}
                </button>
              ))}
            </div>
          </Secao>
        )}

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={!a.especie || !a.fase || !a.quantidade}
            onClick={() => onUsarNoEstudo({
              especie: a.especie!, fase: a.fase!, quantidade: a.quantidade!, consumo: r.consumoMesKg,
            })}
          >
            <Factory className="h-4 w-4" />
            Usar no estudo de viabilidade
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
          <Button onClick={copiar}>
            {copiado ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copiado ? 'Copiado' : 'Copiar levantamento'}
          </Button>
        </div>
        {a.sistema && (
          <p className="text-[11px] text-ink-faint">Sistema marcado: {NOME_SISTEMA(a.sistema)}</p>
        )}
      </div>
    </div>
  )
}
