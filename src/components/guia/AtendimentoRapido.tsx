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
import { ConfiguradorFabrica } from './ConfiguradorFabrica'
import { analisar, consumoDeReferencia, resumoParaCopiar } from '@/lib/guia/atendimento'
import { EQUIPAMENTOS, ESPECIES, NOME_SISTEMA, SISTEMAS } from '@/lib/guia/catalogo'
import { CATEGORIAS } from '@/lib/venda-racao/catalogo'
import { cn } from '@/lib/utils'
import type {
  Atendimento, Especie, GuiaAnimal, GuiaMateria, ItemGuia, ModoVolume,
} from '@/lib/guia/tipos'

const PRODUTOS = [
  'Ração farelada completa', 'Concentrado', 'Sal mineral / proteinado',
  'Milho triturado', 'Ainda não sabe',
]

const VAZIO: Atendimento = {
  especie: null, fase: null, quantidade: null, sistema: null,
  produto: null, materias: [], consumoConfirmado: false,
  modo: 'rebanho', consumoKgAnimalMes: null, volumeMesKg: null,
}

/** De onde vem a tonelagem: do rebanho (consome) ou digitada (vende). */
const MODOS: Array<[ModoVolume, string, string]> = [
  ['rebanho', 'Pelo rebanho', 'o cliente consome a ração'],
  ['volume', 'Direto em toneladas', 'o cliente vende ração, ou já sabe quanto quer produzir'],
]

interface Props {
  animais: GuiaAnimal[]
  materias: GuiaMateria[]
  onAbrir: (i: ItemGuia) => void
  onUsarNoEstudo: (dados: {
    especie: Especie; fase: string; quantidade: number; consumo: number | null
    /** Modo VENDA: tonelagem mensal em kg. O estudo cai no modo `direto`. */
    volumeMesKg?: number | null
  }) => void
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
  const modo: ModoVolume = a.modo ?? 'rebanho'
  // O de TABELA, pra dizer de quanto o cliente discordou. `r.consumoMesKg` ja e
  // o valor em uso (o informado, quando existe), entao nao serve pra comparar.
  const consumoCatalogo = consumoDeReferencia(a.especie, a.fase)
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
    // TRES colunas em tela larga. Eram duas de 50%: o formulario ficava numa
    // coluna estreita com as opcoes quebrando de tres em tres, e as 12 perguntas
    // empurravam a Necessidade e os Pontos de atencao pra fora da tela — o
    // vendedor rolava enquanto o cliente falava. Agora o que ele PREENCHE tem
    // mais largura, o que ele LE fica ao lado, e as perguntas ganham coluna
    // propria em vez de disputar espaco com o resultado.
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_minmax(0,0.85fr)]">
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
            // O consumo informado é POR ESPÉCIE. Sobrevivendo à troca, 240 kg de bovino
            // passavam a valer por AVE — medido: 4.800.000 kg/mês no lugar de 68.000,
            // e o número ia direto pro texto que o vendedor manda pro cliente.
            onEscolher={v => setA(s => ({
              ...s, especie: v, fase: null, sistema: null,
              consumoConfirmado: false, consumoKgAnimalMes: null,
            }))}
          />
        </Passo>

        {!!a.especie && (
          <Passo n={2} titulo="Fase produtiva" ok={!!a.fase}>
            <Opcoes
              rotulo="Fase"
              valor={a.fase}
              opcoes={fases}
              onEscolher={v => setA(s => ({ ...s, fase: v, consumoConfirmado: false, consumoKgAnimalMes: null }))}
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

        <Passo n={4} titulo="Quanto de ração por mês" ok={!!r.necessidadeMesKg}>
          {/* DUAS origens pro volume. Quem VENDE ração já sabe a tonelagem e não
              tem rebanho — antes precisava inventar um pra chegar no número que
              já sabia. */}
          <div className="mb-2 flex gap-1.5">
            {MODOS.map(([m, rot, dica]) => (
              <button
                key={m}
                type="button"
                title={dica}
                aria-pressed={modo === m}
                onClick={() => setA(s => ({ ...s, modo: m }))}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  modo === m
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-surface text-ink-muted hover:text-ink',
                )}
              >
                {rot}
              </button>
            ))}
          </div>

          {modo === 'volume' ? (
            <div className="flex items-center gap-2">
              <div className="w-40">
                <Input
                  type="number" min={0} inputMode="numeric"
                  value={a.volumeMesKg ?? ''}
                  onChange={e => setA(s => ({ ...s, volumeMesKg: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="0"
                  aria-label="Volume mensal em kg"
                />
              </div>
              <span className="text-[12.5px] text-ink-faint">
                kg por mês
                {!!a.volumeMesKg && ` · ${(a.volumeMesKg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t`}
              </span>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-2">
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-faint">
                    {ESPECIES.find(e => e.chave === a.especie)?.animal ?? 'Animais'}
                  </span>
                  <div className="w-32">
                    <Input
                      type="number" min={0} inputMode="numeric"
                      value={a.quantidade ?? ''}
                      onChange={e => setA(s => ({ ...s, quantidade: e.target.value ? Number(e.target.value) : null }))}
                      placeholder="0"
                      aria-label="Quantidade de animais"
                    />
                  </div>
                </label>
                {/* Consumo por animal EDITÁVEL. O de catálogo é média de tabela;
                    o produtor sabe o dele, e a diferença multiplica pelo rebanho
                    inteiro — 20 kg a mais em 500 cabeças são 10 t/mês. */}
                <label className="block">
                  <span className="mb-1 block text-[11px] text-ink-faint">kg por animal/mês</span>
                  <div className="w-28">
                    {/* O valor de catálogo é PLACEHOLDER, não `value`.
                        Estava como value com fallback (`?? r.consumoMesKg`), e
                        isso formava um laço: <input type="number"> devolve ""
                        em TODO estado intermediário de decimal ("3,", "0."), o
                        handler gravava null, o value voltava a ser o catálogo e
                        o React sobrescrevia o que o vendedor estava digitando.
                        Não dava pra apagar o campo, e — pior — ele MENTIA:
                        digitar "3,5" virava 3.45, porque o catálogo se colava
                        aos dígitos. O campo de volume ao lado nunca teve isso,
                        justamente por usar `?? ''`. */}
                    <Input
                      type="number" min={0} step="0.1" inputMode="decimal"
                      value={a.consumoKgAnimalMes ?? ''}
                      onChange={e => setA(s => ({
                        ...s,
                        consumoKgAnimalMes: e.target.value ? Number(e.target.value) : null,
                        consumoConfirmado: false,
                      }))}
                      placeholder={r.consumoMesKg != null ? String(r.consumoMesKg) : '—'}
                      aria-label="Consumo por animal por mês"
                    />
                  </div>
                </label>
                {!!r.necessidadeMesKg && (
                  <div className="pb-1.5 text-[12.5px] text-ink-muted">
                    ={' '}
                    <b className="text-ink">
                      {(r.necessidadeMesKg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t/mês
                    </b>
                  </div>
                )}
              </div>
              {a.consumoKgAnimalMes != null && a.consumoKgAnimalMes > 0 && (
                <div className="mt-1 text-[11px] text-ink-faint">
                  Informado pelo cliente. O catálogo diz {consumoCatalogo ?? '—'} kg.
                </div>
              )}
              {r.consumoMesKg !== null && (
                <label className="mt-2 flex items-start gap-2 text-[12.5px] text-ink">
                  <input
                    type="checkbox"
                    checked={a.consumoConfirmado}
                    onChange={e => setA(s => ({ ...s, consumoConfirmado: e.target.checked }))}
                    className="mt-0.5 h-3.5 w-3.5 accent-current"
                  />
                  <span>
                    Confirmei com o cliente: <strong>{r.consumoMesKg} kg por animal por mês</strong>.
                    <span className="block text-ink-faint">
                      Sem confirmar, o número é referência — não dimensiona equipamento.
                    </span>
                  </span>
                </label>
              )}
            </>
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

      {/* ---------------- resultado: o que o vendedor LÊ enquanto fala ------ */}
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

        {/* CONFIGURADOR — o passo seguinte ao levantamento. Do consumo mensal sai
            a producao por hora, e dela o equipamento. Fica AQUI, no painel de
            resposta, e nao numa tela a parte: o vendedor esta no telefone e o
            cliente pergunta "e quanto custa?" no mesmo minuto em que diz o
            rebanho. */}
        <ConfiguradorFabrica
          necessidadeMesKg={r.necessidadeMesKg}
          especie={a.especie}
          fase={a.fase}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            variant="primary"
            // No modo VENDA não existe rebanho: exigir `quantidade` deixava o
            // botão desabilitado pra sempre — quem vende ração nunca chegava ao
            // estudo. Agora cada modo cobra o SEU dado.
            disabled={!a.especie || !a.fase || (modo === 'volume' ? !a.volumeMesKg : !a.quantidade)}
            onClick={() => onUsarNoEstudo({
              especie: a.especie!, fase: a.fase!,
              quantidade: a.quantidade ?? 0,
              consumo: r.consumoMesKg,
              volumeMesKg: modo === 'volume' ? a.volumeMesKg ?? null : null,
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

      {/* -------- TERCEIRA coluna: apoio de conversa -------------------------
          As 12 perguntas e o conteúdo relacionado são o que o vendedor lê PRA
          PERGUNTAR — não é resultado. Empilhadas junto da Necessidade, elas
          empurravam o número e os pontos de atenção pra fora da tela. Em telas
          menores voltam pro fim da coluna do meio, que é o comportamento antigo. */}
      {/* SÓ renderiza quando há pergunta. Renderizando sempre, a terceira trilha
          reservava ~28% da largura EM BRANCO na abertura da tela (sem espécie
          escolhida não há pergunta), e em duas colunas sobrava uma linha
          fantasma de 14px. Medido em Chrome com o CSS de produção.

          `lg:col-span-2`: entre 1024 e 1535px o grid tem DUAS colunas, e este é
          o terceiro filho — ele caía na coluna 1, linha 2, ou seja embaixo do
          FORMULÁRIO e depois da linha inteira. Eu tinha afirmado que "voltava
          pro fim da coluna do meio"; não voltava. Ocupando a largura toda ele
          vira uma faixa de perguntas embaixo das duas colunas, que é legível —
          e é a faixa que pega notebook de 1280 e 1366. */}
      {!!r.perguntas.length && (
        <div className="space-y-3 lg:col-span-2 2xl:col-span-1 2xl:col-start-3 2xl:row-start-1">
          <Secao titulo="Perguntas que ainda cabem" icone={<ListChecks className="h-3.5 w-3.5" />}>
            <Perguntas perguntas={r.perguntas.slice(0, 12)} />
          </Secao>
        </div>
      )}
    </div>
  )
}
