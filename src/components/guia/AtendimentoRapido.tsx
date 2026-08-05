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
 *
 * ── A tela tem TRÊS papéis, e cada um tem casca própria ─────────────────────
 *   ENTRADA    o que o vendedor clica enquanto ouve      → recuada (bg-bg)
 *   MOSTRADOR  t/mês e kg/h, o que ele fala em voz alta  → elevada (accent/10)
 *   APOIO      perguntas, atenção, processo              → plana (bg-surface)
 *
 * Antes os três usavam `rounded-lg border-border bg-surface`, a menos de 1px de
 * padding entre eles: na abertura, "Espécie" — a pergunta que destrava a tela
 * inteira — tinha exatamente o mesmo peso visual da lista de matérias-primas.
 * O olho ia pro maior objeto, que era o menos importante.
 */
import { useMemo, useState } from 'react'
import {
  ArrowRight, Ban, Check, ChevronDown, Copy, Factory, ListChecks, RotateCcw, Search, Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { Alerta } from './Selos'
import { Perguntas, Secao } from './DetalhePartes'
import { ConfiguradorFabrica } from './ConfiguradorFabrica'
import { analisar, consumoDeReferencia, resumoParaCopiar } from '@/lib/guia/atendimento'
import { producaoNecessaria, type Jornada } from '@/lib/dimensionamento-fabrica'
import { EQUIPAMENTOS, ESPECIES, NOME_CATEGORIA, NOME_SISTEMA, SISTEMAS } from '@/lib/guia/catalogo'
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

/** 6 × 8 é o que o vendedor encontra na maioria das propriedades. */
const JORNADA_PADRAO: Jornada = { diasPorSemana: 6, horasPorDia: 8, margemPct: 0 }

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

type EstadoPasso = 'ok' | 'atual' | 'pendente'

/**
 * O numeral cardinal SAIU do círculo.
 *
 * Ele só funciona quando o conjunto é fixo, e aqui não é: fase e sistema não
 * montavam sem espécie, então o vendedor lia "1, 4, 5, 6" na abertura — um
 * índice que mente sobre o próprio conjunto. Pior que a estética: ao escolher a
 * espécie, dois cards se inseriam ENTRE o 1 e o 4 e empurravam tudo pra baixo,
 * mudando de lugar o alvo que ele ia clicar no meio da fala do cliente.
 * Agora os passos montam sempre — travados até destravar — e o estado vem do
 * marcador, não do número. A ordem visual já vem do empilhamento.
 */
function Passo({ titulo, estado, travado, valor, extra, children }: {
  titulo: string
  estado: EstadoPasso
  /** Depende de outro passo (espécie). Aparece, mas não aceita clique. */
  travado?: boolean
  /** O que já foi respondido, ao lado do título — pro vendedor varrer de relance. */
  valor?: string | null
  extra?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className={cn(
      'rounded-lg border p-3 transition-colors',
      estado === 'atual' ? 'border-accent/30 bg-surface ring-1 ring-accent/10'
        : estado === 'ok' ? 'border-border bg-surface'
        : 'border-border bg-bg',
      travado && 'opacity-45',
    )}>
      <div className="mb-2 flex items-center gap-2">
        <span className={cn(
          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
          estado === 'ok' ? 'border-success bg-success text-white'
            : estado === 'atual' ? 'border-accent'
            : 'border-border',
        )}>
          {estado === 'ok' && <Check className="h-3 w-3" />}
        </span>
        <h3 className="text-[13px] font-semibold tracking-[-0.01em] text-ink">{titulo}</h3>
        {!!valor && <span className="truncate text-[12px] text-ink-muted">{valor}</span>}
        {extra && <div className="ml-auto shrink-0">{extra}</div>}
      </div>
      <div className={cn(travado && 'pointer-events-none')} aria-disabled={travado || undefined}>
        {children}
      </div>
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
            'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
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

/** Um número do mostrador. Existe desde a abertura, em `—`. */
function Numero({ rotulo, valor, unidade }: {
  rotulo: string; valor: string | null; unidade: string
}) {
  return (
    <div>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-muted">{rotulo}</dt>
      <dd className={cn(
        'mt-1 text-[28px] font-bold leading-none tabular-nums tracking-[-0.02em]',
        valor ? 'text-ink' : 'text-ink-faint',
      )}>
        {valor ?? '—'}
        <span className="ml-1.5 text-[12px] font-normal tracking-normal text-ink-muted">{unidade}</span>
      </dd>
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
  const [apoioAberto, setApoioAberto] = useState(false)
  const [filtroMateria, setFiltroMateria] = useState('')
  // A jornada mora AQUI, não no configurador: é dela que sai o kg/h do
  // mostrador. Ver o cabeçalho de ConfiguradorFabrica.tsx pra história dos dois
  // kg/h divergentes que isso resolveu.
  const [jornada, setJornada] = useState<Jornada>(JORNADA_PADRAO)

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

  // ── o kg/h. UM só na tela, e sai da jornada que o vendedor ajustou ────────
  const producao = useMemo(
    () => (r.necessidadeMesKg ? producaoNecessaria(r.necessidadeMesKg, jornada) : null),
    [r.necessidadeMesKg, jornada],
  )
  const textoJornada = `${jornada.diasPorSemana} dias × ${jornada.horasPorDia} h`
    + (jornada.margemPct ? ` · ${jornada.margemPct}% de folga` : '')

  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(resumoParaCopiar(a, r, nomeFase, {
        producaoKgH: producao?.kgHoraNecessaria ?? null,
        jornada: textoJornada,
      }))
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* clipboard bloqueado */ }
  }

  const alternarMateria = (slug: string) =>
    setA(s => ({
      ...s,
      materias: s.materias.includes(slug) ? s.materias.filter(x => x !== slug) : [...s.materias, slug],
    }))

  // ── progressão ────────────────────────────────────────────────────────────
  // Derivada, não escrita à mão: no modo VENDA não existe rebanho nem consumo
  // por animal, e o total tem que acompanhar. "4 de 7" com um total fixo de 7
  // num modo que só tem 6 passos é a mesma mentira do numeral cardinal.
  const passos = useMemo(() => {
    const p: Array<{ chave: string; ok: boolean; travado: boolean }> = [
      { chave: 'especie', ok: !!a.especie, travado: false },
      {
        chave: 'rebanho',
        ok: modo === 'volume' ? !!a.volumeMesKg : !!a.quantidade,
        travado: false,
      },
      { chave: 'fase', ok: !!a.fase, travado: !a.especie },
      { chave: 'sistema', ok: !!a.sistema, travado: !a.especie },
    ]
    if (modo === 'rebanho') p.push({ chave: 'consumo', ok: a.consumoConfirmado, travado: !a.especie })
    p.push({ chave: 'produto', ok: !!a.produto, travado: false })
    p.push({ chave: 'materias', ok: !!a.materias.length, travado: false })
    return p
  }, [a, modo])

  const respondidos = passos.filter(p => p.ok).length
  const atual = passos.find(p => !p.ok && !p.travado)?.chave ?? null
  const estadoDe = (chave: string): EstadoPasso => {
    const p = passos.find(x => x.chave === chave)
    if (p?.ok) return 'ok'
    return chave === atual ? 'atual' : 'pendente'
  }
  const travadoEm = (chave: string) => !!passos.find(x => x.chave === chave)?.travado

  // "Começou" separa o checklist do alarme. Os 6 badges laranja de "ainda falta"
  // apareciam em 100% das aberturas — um alarme que dispara sempre não é alarme,
  // é papel de parede, e treina o vendedor a ignorar laranja, que é justamente a
  // cor dos avisos que importam.
  const comecou = respondidos > 0

  // ── matérias-primas: filtro, marcadas no topo, agrupadas ─────────────────
  const materiasFiltradas = useMemo(() => {
    const t = filtroMateria.trim().toLowerCase()
    if (!t) return materiasVisiveis
    return materiasVisiveis.filter(m =>
      m.nome.toLowerCase().includes(t)
      || (m.sinonimos ?? []).some(s => s.toLowerCase().includes(t)))
  }, [materiasVisiveis, filtroMateria])

  const gruposMateria = useMemo(() => {
    const mapa = new Map<string, GuiaMateria[]>()
    for (const m of materiasFiltradas) {
      if (a.materias.includes(m.slug)) continue   // marcadas ficam no topo
      const nome = NOME_CATEGORIA[m.categoria] ?? m.categoria
      const lista = mapa.get(nome)
      if (lista) lista.push(m); else mapa.set(nome, [m])
    }
    return Array.from(mapa.entries()).sort((x, y) => x[0].localeCompare(y[0], 'pt-BR'))
  }, [materiasFiltradas, a.materias])

  const marcadas = useMemo(
    () => materiasVisiveis.filter(m => a.materias.includes(m.slug)),
    [materiasVisiveis, a.materias],
  )

  const pilulaMateria = (m: GuiaMateria) => (
    <button
      key={m.slug}
      type="button"
      aria-pressed={a.materias.includes(m.slug)}
      onClick={() => alternarMateria(m.slug)}
      className={cn(
        'rounded-full border px-2 py-0.5 text-[12px] transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        a.materias.includes(m.slug)
          ? 'border-accent bg-accent text-white'
          : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
      )}
    >
      {m.nome}
    </button>
  )

  // O que GRITA fica na tela; o resto vai pra gaveta. `incompativel` e
  // `alto_risco` são "silagem não entra" e "ureia mata o animal" — poucos e
  // decisivos. O nível `atencao` é onde mora o papel de parede ("formulação
  // por profissional habilitado" repetido por cinco categorias diferentes).
  const criticos = useMemo(
    () => r.atencao.filter(x => x.nivel === 'incompativel' || x.nivel === 'alto_risco'),
    [r.atencao],
  )
  const secundarios = useMemo(
    () => r.atencao.filter(x => x.nivel !== 'incompativel' && x.nivel !== 'alto_risco'),
    [r.atencao],
  )
  const temApoio = !!(r.perguntas.length || r.processo.length || secundarios.length
    || r.equipamentos.length || r.relacionados.length)

  // DUAS trilhas, sempre. A terceira era EXPLÍCITA e por isso NÃO colapsava por
  // falta de filho — `fr` distribui espaço livre, não é função do conteúdo: em
  // 1920 com a sidebar davam 445px de branco na abertura. Agora ela nem existe:
  // o apoio virou gaveta no pé da coluna do resultado, e não há terceira coisa
  // a colocar ao lado.
  return (
    <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      {/* ---------------- entrada ---------------- */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[12px] text-ink-muted">
            <span className="font-semibold tabular-nums text-ink">
              {respondidos} de {passos.length}
            </span>
            {' '}respondidos
            {!!r.faltando.length && (
              <> · falta {r.faltando[0].charAt(0).toLowerCase() + r.faltando[0].slice(1)}</>
            )}
          </p>
          <Button size="sm" onClick={() => { setA(VAZIO); setFiltroMateria('') }}>
            <RotateCcw className="h-3.5 w-3.5" />Limpar
          </Button>
        </div>

        <Passo
          titulo="Espécie"
          estado={estadoDe('especie')}
          valor={a.especie ? ESPECIES.find(e => e.chave === a.especie)?.nome : null}
        >
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

        {/* O produtor fala "500 cabeças" logo depois de dizer o animal. A
            quantidade era um campo escondido DENTRO do passo "Quanto de ração
            por mês", entre o seletor de modo e o "kg por animal": o vendedor
            ouvia o número, tinha que descer, achar o campo certo entre outros
            dois, digitar e SUBIR de volta pra fase. Agora é passo próprio, na
            posição em que a conversa acontece. */}
        <Passo
          titulo={modo === 'volume' ? 'Quantas toneladas por mês' : 'Quantos animais'}
          estado={estadoDe('rebanho')}
          valor={modo === 'volume'
            ? (a.volumeMesKg ? `${(a.volumeMesKg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} t` : null)
            : (a.quantidade ? a.quantidade.toLocaleString('pt-BR') : null)}
        >
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
                // Trocar de modo tem que zerar o que só vale no outro: o
                // `consumoConfirmado` atravessava a ida e volta e a tela voltava a
                // fechar equipamento com um consumo que ninguém reconfirmou.
                onClick={() => setA(s => ({ ...s, modo: m, consumoConfirmado: false }))}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
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
              <span className="text-[12px] text-ink-faint">kg por mês</span>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <div className="w-32">
                <Input
                  type="number" min={0} inputMode="numeric"
                  value={a.quantidade ?? ''}
                  onChange={e => setA(s => ({ ...s, quantidade: e.target.value ? Number(e.target.value) : null }))}
                  placeholder="0"
                  aria-label="Quantidade de animais"
                />
              </div>
              <span className="pb-2 text-[12px] text-ink-faint">
                {(ESPECIES.find(e => e.chave === a.especie)?.animal ?? 'animais').toLowerCase()}
              </span>
            </div>
          )}
        </Passo>

        {/* Fase e sistema MONTAM SEMPRE, travados até a espécie. Montando
            condicionalmente, eles se inseriam no meio da coluna e empurravam
            tudo que estava embaixo — layout pulando debaixo do dedo do vendedor
            no meio da ligação. */}
        <Passo
          titulo="Fase produtiva"
          estado={estadoDe('fase')}
          travado={travadoEm('fase')}
          valor={nomeFase || null}
        >
          {a.especie ? (
            <Opcoes
              rotulo="Fase"
              valor={a.fase}
              opcoes={fases}
              onEscolher={v => setA(s => ({ ...s, fase: v, consumoConfirmado: false, consumoKgAnimalMes: null }))}
            />
          ) : (
            <p className="text-[12px] text-ink-faint">Escolha a espécie primeiro.</p>
          )}
        </Passo>

        <Passo
          titulo="Sistema de criação"
          estado={estadoDe('sistema')}
          travado={travadoEm('sistema')}
          valor={a.sistema ? NOME_SISTEMA(a.sistema) : null}
        >
          {a.especie ? (
            <Opcoes
              rotulo="Sistema"
              valor={a.sistema}
              opcoes={sistemas.map(s => ({ chave: s.chave, nome: s.nome }))}
              onEscolher={v => setA(s => ({ ...s, sistema: v }))}
            />
          ) : (
            <p className="text-[12px] text-ink-faint">Escolha a espécie primeiro.</p>
          )}
        </Passo>

        {/* Consumo por animal EDITÁVEL. O de catálogo é média de tabela; o
            produtor sabe o dele, e a diferença multiplica pelo rebanho inteiro
            — 20 kg a mais em 500 cabeças são 10 t/mês. */}
        {modo === 'rebanho' && (
          <Passo
            titulo="Consumo por animal"
            estado={estadoDe('consumo')}
            travado={travadoEm('consumo')}
            valor={r.consumoMesKg !== null ? `${r.consumoMesKg} kg/mês` : null}
          >
            <div className="flex items-end gap-2">
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
              <span className="pb-2 text-[12px] text-ink-faint">kg por animal/mês</span>
            </div>
            {a.consumoKgAnimalMes != null && a.consumoKgAnimalMes > 0 && (
              <p className="mt-1 text-[11px] text-ink-faint">
                Informado pelo cliente. O catálogo diz {consumoCatalogo ?? '—'} kg.
              </p>
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
          </Passo>
        )}

        <Passo titulo="Produto desejado" estado={estadoDe('produto')} valor={a.produto}>
          <Opcoes
            rotulo="Produto"
            valor={a.produto}
            opcoes={PRODUTOS.map(p => ({ chave: p, nome: p }))}
            onEscolher={v => setA(s => ({ ...s, produto: v }))}
          />
        </Passo>

        {/* Eram ~30 pílulas de 12px soltas num `max-h-52 overflow-y-auto`, sem
            busca, sem agrupamento e sem nenhum sinal de que havia conteúdo
            abaixo do corte. O vendedor não sabia que "farelo de soja" estava
            ali — e era a caixa MAIS ALTA da coluna, o passo menos determinante
            ocupando o maior volume vertical da tela. */}
        <Passo
          titulo="Matérias-primas que ele já tem"
          estado={estadoDe('materias')}
          extra={
            <span className="text-[11px] tabular-nums text-ink-faint">
              {a.materias.length} de {materiasVisiveis.length}
            </span>
          }
        >
          {!!marcadas.length && (
            <div className="mb-2 flex flex-wrap gap-1.5 border-b border-border pb-2">
              {marcadas.map(pilulaMateria)}
            </div>
          )}
          <Input
            value={filtroMateria}
            onChange={e => setFiltroMateria(e.target.value)}
            placeholder="Filtrar matéria-prima…"
            aria-label="Filtrar matérias-primas"
            leftIcon={<Search className="h-3.5 w-3.5" />}
            className="h-8 text-[12px]"
          />
          <div className="mt-2 max-h-64 space-y-2 overflow-y-auto">
            {gruposMateria.map(([nome, lista]) => (
              <div key={nome}>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-muted">
                  {nome}
                </p>
                <div className="flex flex-wrap gap-1.5">{lista.map(pilulaMateria)}</div>
              </div>
            ))}
            {!gruposMateria.length && (
              // As marcadas saem da lista e sobem pro topo. Filtrando "silagem"
              // e marcando o único resultado, a lista dizia "Nada com esse
              // nome" — e tinha, estava fixada duas linhas acima.
              <p className="text-[12px] text-ink-faint">
                {!materiasFiltradas.length
                  ? 'Nada com esse nome.'
                  : filtroMateria
                    ? 'Já marcada, ali em cima.'
                    : 'Todas as matérias já foram marcadas.'}
              </p>
            )}
          </div>
        </Passo>
      </div>

      {/* ---------------- mostrador: o que o vendedor LÊ e FALA ------------ */}
      {/* `sticky`: a coluna da entrada cresce conforme o vendedor preenche, e o
          número que ele lê em voz alta não pode sair da tela enquanto ele rola
          pra marcar mais uma matéria-prima. */}
      <div className="space-y-3 lg:sticky lg:top-4 lg:self-start">
        {/* O MOSTRADOR e o vazio são a MESMA caixa. Nada nasce, some ou pula
            quando o primeiro dado entra — só o conteúdo muda de `—` pra número.
            Isso mata o salto de layout e ensina, sem texto explicativo, onde a
            resposta vai aparecer. */}
        <div className="rounded-lg border border-accent/30 bg-accent/10 p-4">
          <dl className="grid grid-cols-2 gap-4">
            <Numero
              rotulo="Necessidade mensal"
              unidade="t/mês"
              valor={r.necessidadeMesKg
                ? (r.necessidadeMesKg / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
                : null}
            />
            <Numero
              rotulo="Produção necessária"
              unidade="kg/h"
              valor={producao ? Math.round(producao.kgHoraNecessaria).toLocaleString('pt-BR') : null}
            />
          </dl>

          {/* Uma linha, e ela responde a única pergunta binária que importa:
              "já posso falar de máquina?". Antes de o vendedor começar não é
              alarme nenhum — é a frase que ele diz ao telefone. */}
          {!comecou ? (
            <p className="mt-3 text-[15px] leading-snug text-ink">
              “Com que animal o senhor trabalha?”
              <span className="mt-1 block text-[12px] text-ink-muted">
                Marque ao lado o que ele for contando. O número aparece aqui.
              </span>
            </p>
          ) : r.podeFecharEquipamento ? (
            <p className="mt-3 text-[12px] text-success">
              Pode dimensionar · {textoJornada}
            </p>
          ) : (
            <p className="mt-3 text-[12px] text-warning">
              Referência — falta {r.bloqueioEquipamento}
            </p>
          )}

          {/* O configurador é FILHO do mostrador, sem casca própria: a jornada
              é o denominador do kg/h logo acima, e os dois estavam em caixas
              separadas, com o kg/h aparecendo duas vezes em tamanhos
              diferentes. */}
          <div className="mt-3 border-t border-accent/20 pt-3">
            <ConfiguradorFabrica
              necessidadeMesKg={r.necessidadeMesKg}
              podeFechar={r.podeFecharEquipamento}
              especie={a.especie}
              fase={a.fase}
              jornada={jornada}
              onJornada={setJornada}
            />
          </div>
        </div>

        {/* O que a linha NÃO faz. Estava no banco, corrigido na auditoria, e só
            era renderizado na FICHA do animal — a tela em que o vendedor está
            com o cliente no telefone não lia o campo. */}
        {!!r.naoAtende.length && (
          <Secao titulo="A Branorte NÃO faz" icone={<Ban className="h-3.5 w-3.5 text-danger" />}>
            <ul className="space-y-1">
              {r.naoAtende.map((x, i) => (
                <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink">
                  <span aria-hidden className="shrink-0 text-danger">✗</span>
                  <span className="min-w-0">{x}</span>
                </li>
              ))}
            </ul>
            {!!r.promessasProibidas.length && (
              <p className="mt-2 border-t border-border pt-2 text-[12px] leading-relaxed text-ink-muted">
                Não prometer: {r.promessasProibidas.join(' · ')}
              </p>
            )}
          </Secao>
        )}

        {/* "Ainda falta levantar" SAIU.
            Era a quarta vez que a tela dizia a mesma coisa: o contador no topo
            da entrada já nomeia o próximo bloqueio, o círculo de cada passo já
            mostra se foi respondido, e a linha do mostrador já repete o que
            falta. As seis etiquetas eram os seis passos, com outro nome. O dado
            continua em `r.faltando` — alimenta o contador e o texto que vai pro
            WhatsApp, onde a lista tem uso de verdade. */}

        {/* SÓ o que grita. Antes a seção despejava TUDO no mesmo peso: seis
            tarjas amarelas idênticas, "Formulação por profissional habilitado"
            do mesmo tamanho de "Silagem NÃO entra na fábrica farelada". É o
            defeito que Selos.tsx descreve no guia antigo, reintroduzido pelo
            layout — quando tudo é alerta, nada é. */}
        {!!criticos.length && (
          <Secao titulo="Pontos de atenção">
            <div className="space-y-2">
              {criticos.map((x, i) => (
                <Alerta key={i} nivel={x.nivel}>{x.texto}</Alerta>
              ))}
            </div>
          </Secao>
        )}

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

        {/* APOIO DE CONVERSA — fechado por padrão.
            Perguntas, processo provável, pontos secundários, equipamentos e
            conteúdo relacionado ocupavam a tela inteira e eram, todos, a UNIÃO
            de todas as categorias da espécie: 13 parágrafos de processo e
            "Quantos litros por vaca por dia?" no meio de uma conversa de gado
            de corte. Vira repertório sob demanda, não parede. */}
        {temApoio && (
          <div className="rounded-lg border border-border bg-surface">
            <button
              type="button"
              onClick={() => setApoioAberto(v => !v)}
              aria-expanded={apoioAberto}
              className="flex w-full items-center gap-1.5 px-4 py-2.5 text-[12px] text-ink-muted hover:text-ink"
            >
              <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', apoioAberto && 'rotate-180')} />
              Apoio de conversa
              <span className="text-ink-faint">
                — {[
                  r.perguntas.length && `${r.perguntas.length} perguntas`,
                  r.processo.length && 'processo',
                  secundarios.length && `${secundarios.length} observações`,
                ].filter(Boolean).join(' · ')}
              </span>
            </button>

            {apoioAberto && (
              <div className="space-y-4 border-t border-border px-4 py-3">
                {/* Sem fase escolhida, tudo aqui é a união de todas as
                    categorias da espécie. Dizer isso é a diferença entre
                    repertório e resposta. */}
                {r.baseAmpla && (
                  <p className="text-[12px] leading-relaxed text-warning">
                    Sem a fase produtiva, isto é o repertório de TODAS as fases da espécie —
                    não é o roteiro deste cliente. Escolha a fase pra filtrar.
                  </p>
                )}

                {!!r.perguntas.length && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <ListChecks className="h-3.5 w-3.5" />Perguntas que ainda cabem
                    </h4>
                    <Perguntas
                      perguntas={r.perguntas.slice(0, 12)}
                      className="sm:columns-2 [&>li]:break-inside-avoid"
                    />
                  </div>
                )}

                {!!r.processo.length && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <Factory className="h-3.5 w-3.5" />Processo provável
                    </h4>
                    <ul className="space-y-1.5">
                      {r.processo.map((x, i) => (
                        <li key={i} className="text-[13px] leading-relaxed text-ink">{x}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {!!secundarios.length && (
                  <div>
                    <h4 className="mb-2 text-[13px] font-semibold text-ink">Observações</h4>
                    <ul className="space-y-1">
                      {secundarios.map((x, i) => (
                        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink-muted">
                          <span aria-hidden className="shrink-0 text-ink-faint">•</span>
                          <span className="min-w-0">{x.texto}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {!!r.equipamentos.length && (
                  <div>
                    <h4 className="mb-2 flex items-center gap-1.5 text-[13px] font-semibold text-ink">
                      <Wrench className="h-3.5 w-3.5" />Equipamento que pode ser analisado
                    </h4>
                    <div className="flex flex-wrap gap-1.5">
                      {r.equipamentos.map(e => (
                        <Badge key={e} className="bg-surface-2 text-ink-muted">{EQUIPAMENTOS[e] ?? e}</Badge>
                      ))}
                    </div>
                    {/* `misturador_indicado` já existia nas matérias e era lido
                        só na ficha e na comparação. */}
                    {!!r.misturadorIndicado && (
                      <p className="mt-2 text-[12.5px] leading-relaxed text-ink">
                        As matérias marcadas pedem misturador <strong>{r.misturadorIndicado}</strong>.
                      </p>
                    )}
                  </div>
                )}

                {!!r.relacionados.length && (
                  <div>
                    <h4 className="mb-2 text-[13px] font-semibold text-ink">Conteúdos relacionados</h4>
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
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
