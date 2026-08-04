/**
 * Guia do Vendedor — nativo no CRM.
 *
 * Substitui o iframe de branorte-viabilidade.vercel.app/guia.html, aposentado na
 * auditoria de 03/08/2026. O que o iframe não conseguia entregar e aqui existe:
 * autenticação (o guia antigo era público na internet), tema claro/escuro,
 * busca, filtros, página individual com URL própria, favoritos por vendedor,
 * comparação, e conteúdo em banco com revisão e histórico de versões.
 *
 * Três modos, na ordem de uso real:
 *   ATENDIMENTO — o vendedor está no telefone AGORA
 *   ANIMAIS     — entender a criação do cliente
 *   MATÉRIAS    — nutrição + ficha mecânica pro equipamento
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BookOpen, GitCompare, Headphones, Star, Wheat, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { CardGuia } from '@/components/guia/CardGuia'
import { Filtros } from '@/components/guia/Filtros'
import { DetalheAnimal } from '@/components/guia/DetalheAnimal'
import { DetalheMateria } from '@/components/guia/DetalheMateria'
import { Comparar } from '@/components/guia/Comparar'
import { AtendimentoRapido } from '@/components/guia/AtendimentoRapido'
import {
  lerRecentes, registrarRecente, useFavoritos, useGuiaAnimais, useGuiaMaterias,
  useMapaFontes, useMapaImagens,
} from '@/hooks/useGuia'
import { animalParaItem, buscar, materiaParaItem, type Filtros as TFiltros } from '@/lib/guia/busca'
import { NOME_CATEGORIA, NOME_ESPECIE, SUBGRUPOS, TIPOS_ANIMAL } from '@/lib/guia/catalogo'
import { cn } from '@/lib/utils'
import type { Especie, GuiaAnimal, GuiaMateria, ItemGuia, TipoItem } from '@/lib/guia/tipos'

type Modo = 'atendimento' | 'animais' | 'materias'

const ABAS: Array<{ chave: Modo; nome: string; icone: typeof BookOpen; dica: string }> = [
  { chave: 'atendimento', nome: 'Atendimento rápido', icone: Headphones, dica: 'Levantar dados durante a ligação' },
  { chave: 'animais', nome: 'Animais', icone: BookOpen, dica: 'Espécie, sistema, fase e raça' },
  { chave: 'materias', nome: 'Matérias-primas', icone: Wheat, dica: 'Nutrição e comportamento no equipamento' },
]

export function Guia({ modoInicial = 'animais' }: { modoInicial?: Modo }) {
  const navigate = useNavigate()
  const { slug } = useParams<{ slug?: string }>()
  const [params, setParams] = useSearchParams()

  const modo = (params.get('modo') as Modo) ?? modoInicial
  const consulta = params.get('q') ?? ''
  const tipoAberto = (params.get('tipo') as TipoItem) ?? (modo === 'materias' ? 'materia' : 'animal')

  const [filtros, setFiltros] = useState<TFiltros>({})
  const [comparando, setComparando] = useState(false)
  const [selecao, setSelecao] = useState<string[]>([])

  const { data: animais = [], isLoading: cA } = useGuiaAnimais()
  const { data: materias = [], isLoading: cM } = useGuiaMaterias()
  const imagens = useMapaImagens()
  const fontes = useMapaFontes()
  const { favoritos, alternar } = useFavoritos()

  const setParam = useCallback((k: string, v: string | null) => {
    setParams(p => {
      const n = new URLSearchParams(p)
      if (v) n.set(k, v); else n.delete(k)
      return n
    }, { replace: true })
  }, [setParams])

  // ---------------------------------------------------------------- rótulos
  const rotuloAnimal = useCallback((a: GuiaAnimal) => {
    const sub = a.subgrupo ? SUBGRUPOS[a.subgrupo] ?? a.subgrupo : null
    return [NOME_ESPECIE[a.especie], sub, TIPOS_ANIMAL[a.tipo]].filter(Boolean).join(' · ')
  }, [])
  const rotuloMateria = useCallback((m: GuiaMateria) => NOME_CATEGORIA[m.categoria], [])

  const regioes = useMemo(() => {
    const s = new Set<string>()
    for (const a of animais) if (a.regiao) s.add(a.regiao.split(/[.,;(]/)[0].trim())
    for (const m of materias) if (m.regiao) s.add(m.regiao.split(/[.,;(]/)[0].trim())
    return Array.from(s)
      .filter(x => x.length > 2 && x.length < 60)
      .sort((a, b) => a.localeCompare(b, 'pt-BR'))
  }, [animais, materias])

  // Cada modo enxerga só a sua coleção. Com termo digitado, a busca cruza as
  // duas: aí o vendedor quer a resposta, não a aba.
  const { itens, atalho } = useMemo(() => {
    const buscando = consulta.trim().length > 0
    const listaA = modo === 'materias' && !buscando ? [] : animais
    const listaM = modo === 'animais' && !buscando ? [] : materias
    return buscar(listaA, listaM, consulta, filtros, favoritos, rotuloAnimal, rotuloMateria)
  }, [animais, materias, consulta, filtros, favoritos, modo, rotuloAnimal, rotuloMateria])

  // ---------------------------------------------------------------- item aberto
  const animalAberto = slug ? animais.find(a => a.slug === slug) : undefined
  const materiaAberta = slug ? materias.find(m => m.slug === slug) : undefined
  const ehMateria = tipoAberto === 'materia' ? !!materiaAberta : !animalAberto && !!materiaAberta
  const aberto = ehMateria ? materiaAberta : animalAberto

  useEffect(() => {
    if (!slug || !aberto) return
    registrarRecente(ehMateria ? 'materia' : 'animal', slug)
  }, [slug, aberto, ehMateria])

  const abrir = useCallback((i: ItemGuia) => {
    const q = consulta ? `&q=${encodeURIComponent(consulta)}` : ''
    navigate(`/guia/${i.slug}?modo=${modo}&tipo=${i.tipo}${q}`)
  }, [navigate, modo, consulta])

  const fechar = useCallback(() => {
    const q = consulta ? `&q=${encodeURIComponent(consulta)}` : ''
    navigate(`/guia?modo=${modo}${q}`)
  }, [navigate, modo, consulta])

  // ---------------------------------------------------------------- estudo
  const irParaEstudo = useCallback((d: {
    especie: Especie; fase: string; quantidade?: number; consumo?: number | null
    /** Modo VENDA: tonelagem mensal em kg, sem rebanho. */
    volumeMesKg?: number | null
  }) => {
    // Ovino e caprino ainda não existem no catálogo de /producao-propria: manda
    // sem semente, em vez de mandar semente inválida.
    const suportado = d.especie === 'bovinos' || d.especie === 'suinos' || d.especie === 'aves'
    navigate('/producao-propria', {
      state: suportado
        ? {
            guiaSemente: {
              especie: d.especie,
              categoria: d.fase,
              numeroAnimais: d.quantidade ?? 0,
              consumoPorAnimal: d.consumo ?? null,
              volumeMesKg: d.volumeMesKg ?? null,
            },
          }
        : undefined,
    })
  }, [navigate])

  // ---------------------------------------------------------------- comparar
  const paraComparar = useMemo(() => {
    if (selecao.length !== 2) return null
    const [x, y] = selecao
    const tipo = x.startsWith('materia:') ? 'materia' as const : 'animal' as const
    if (!y.startsWith(tipo)) return null
    const acha = (chave: string) => {
      const s = chave.split(':')[1]
      return tipo === 'materia'
        ? materias.find(m => m.slug === s) as GuiaMateria | undefined
        : animais.find(a => a.slug === s) as GuiaAnimal | undefined
    }
    const a = acha(x); const b = acha(y)
    return a && b ? { a, b, tipo } : null
  }, [selecao, animais, materias])

  const recentes = useMemo(() => {
    if (consulta || slug) return []
    const out: ItemGuia[] = []
    for (const r of lerRecentes()) {
      if (r.tipo === 'animal') {
        const a = animais.find(x => x.slug === r.slug)
        if (a) out.push(animalParaItem(a, rotuloAnimal(a)))
      } else {
        const m = materias.find(x => x.slug === r.slug)
        if (m) out.push(materiaParaItem(m, rotuloMateria(m)))
      }
      if (out.length >= 6) break
    }
    return out
  }, [animais, materias, consulta, slug, rotuloAnimal, rotuloMateria])

  const relacionadosDe = useCallback(
    (slugs: string[]) => materias.filter(m => slugs.includes(m.slug)).map(m => materiaParaItem(m, rotuloMateria(m))),
    [materias, rotuloMateria],
  )

  if (cA || cM) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner /></div>
  }

  // ============================ página individual ============================
  if (slug) {
    if (!aberto) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-10 text-center">
          <p className="text-[14px] text-ink">Conteúdo não encontrado ou ainda não publicado.</p>
          <Button className="mt-3" onClick={fechar}><ArrowLeft className="h-3.5 w-3.5" />Voltar ao guia</Button>
        </div>
      )
    }
    return (
      <div className="mx-auto max-w-4xl px-3 py-4 sm:px-4">
        <Button size="sm" onClick={fechar} className="mb-3">
          <ArrowLeft className="h-3.5 w-3.5" />Voltar ao guia
        </Button>
        {ehMateria ? (
          <DetalheMateria
            m={materiaAberta!}
            imagem={materiaAberta!.imagem_slug ? imagens.get(materiaAberta!.imagem_slug) : null}
            fontes={fontes}
            favorito={favoritos.has(`materia:${materiaAberta!.slug}`)}
            onFavoritar={() => alternar.mutate({ tipo: 'materia', slug: materiaAberta!.slug })}
            relacionados={animais
              .filter(a => a.materias_comuns.includes(materiaAberta!.slug))
              .slice(0, 12)
              .map(a => animalParaItem(a, rotuloAnimal(a)))}
            onAbrirRelacionado={abrir}
          />
        ) : (
          <DetalheAnimal
            a={animalAberto!}
            imagem={animalAberto!.imagem_slug ? imagens.get(animalAberto!.imagem_slug) : null}
            fontes={fontes}
            favorito={favoritos.has(`animal:${animalAberto!.slug}`)}
            onFavoritar={() => alternar.mutate({ tipo: 'animal', slug: animalAberto!.slug })}
            relacionados={relacionadosDe(animalAberto!.materias_comuns)}
            onAbrirRelacionado={abrir}
            onUsarNoEstudo={animalAberto!.fase_estudo
              ? () => irParaEstudo({ especie: animalAberto!.especie, fase: animalAberto!.fase_estudo! })
              : undefined}
          />
        )}
      </div>
    )
  }

  // ================================= índice =================================
  return (
    <div className={cn(
      'mx-auto space-y-4 px-3 py-4 sm:px-4',
      // O Atendimento rápido é FORMULÁRIO em três colunas: com o teto de 1152px
      // as opções quebravam de três em três e as 12 perguntas empurravam o
      // resultado pra fora da tela. As outras abas são grade de cards, que já
      // fica boa em 1152 e viraria uma fileira longa demais se esticasse.
      modo === 'atendimento' ? 'max-w-[1600px]' : 'max-w-6xl',
    )}>
      <header>
        <h1 className="text-lg font-bold text-ink">Guia do Vendedor</h1>
        <p className="text-[12.5px] text-ink-muted">
          Entender a criação, fazer as perguntas certas e ligar a necessidade ao que a Branorte
          consegue produzir — sem prometer o que a máquina não faz.
        </p>
      </header>

      <nav className="flex gap-1.5 overflow-x-auto border-b border-border pb-px" aria-label="Modos do guia">
        {ABAS.map(t => {
          const Icone = t.icone
          const on = modo === t.chave
          return (
            <button
              key={t.chave}
              onClick={() => { setParam('modo', t.chave); setSelecao([]); setComparando(false) }}
              title={t.dica}
              aria-current={on ? 'page' : undefined}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
                on ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              <Icone className="h-4 w-4" />{t.nome}
            </button>
          )
        })}
      </nav>

      {modo === 'atendimento' ? (
        <AtendimentoRapido
          animais={animais}
          materias={materias}
          onAbrir={abrir}
          onUsarNoEstudo={irParaEstudo}
        />
      ) : comparando && paraComparar ? (
        <Comparar
          a={paraComparar.a}
          b={paraComparar.b}
          tipo={paraComparar.tipo}
          onFechar={() => { setComparando(false); setSelecao([]) }}
        />
      ) : (
        <>
          <Filtros
            consulta={consulta}
            onConsulta={v => setParam('q', v || null)}
            filtros={filtros}
            onFiltros={setFiltros}
            materias={materias}
            regioes={regioes}
            total={itens.length}
            atalho={atalho}
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={selecao.length === 2 ? 'primary' : 'secondary'}
              onClick={() => {
                if (selecao.length === 2) setComparando(true)
                else if (!selecao.length) setSelecao([''])   // liga o modo de seleção
                else setSelecao([])
              }}
            >
              <GitCompare className="h-3.5 w-3.5" />
              {selecao.length === 2 ? 'Comparar os 2 selecionados'
                : selecao.length ? 'Selecione 2 cards'
                : 'Comparar'}
            </Button>
            {!!selecao.length && (
              <Button size="sm" onClick={() => setSelecao([])}>
                <X className="h-3.5 w-3.5" />Sair da comparação
              </Button>
            )}
            <Button
              size="sm"
              variant={filtros.soFavoritos ? 'primary' : 'secondary'}
              onClick={() => setFiltros(f => ({ ...f, soFavoritos: !f.soFavoritos }))}
            >
              <Star className={cn('h-3.5 w-3.5', filtros.soFavoritos && 'fill-current')} />Favoritos
            </Button>
          </div>

          {!!recentes.length && (
            <section>
              <h2 className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                Vistos recentemente
              </h2>
              <div className="flex flex-wrap gap-1.5">
                {recentes.map(i => (
                  <button
                    key={`${i.tipo}:${i.slug}`}
                    onClick={() => abrir(i)}
                    className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] text-ink hover:border-border-strong hover:bg-surface-2"
                  >
                    {i.emoji} {i.nome}
                  </button>
                ))}
              </div>
            </section>
          )}

          {itens.length ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {itens.map(i => {
                const chave = `${i.tipo}:${i.slug}`
                return (
                  <CardGuia
                    key={chave}
                    item={i}
                    imagem={i.imagem_slug ? imagens.get(i.imagem_slug) : null}
                    favorito={favoritos.has(chave)}
                    onAbrir={() => abrir(i)}
                    onFavoritar={() => alternar.mutate({ tipo: i.tipo, slug: i.slug })}
                    selecionavel={selecao.length > 0}
                    selecionado={selecao.includes(chave)}
                    onSelecionar={() => setSelecao(s => {
                      const limpo = s.filter(Boolean)
                      if (limpo.includes(chave)) return limpo.filter(x => x !== chave)
                      return limpo.length < 2 ? [...limpo, chave] : limpo
                    })}
                  />
                )
              })}
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center">
              <p className="text-[14px] text-ink">Nada encontrado.</p>
              <p className="mt-1 text-[12.5px] text-ink-muted">
                Tente outro termo ou limpe os filtros. Conteúdo em rascunho ou em revisão só
                aparece para quem edita o guia.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default Guia
