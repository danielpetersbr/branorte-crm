import { useMemo, useState } from 'react'
import { Settings2, Plus, X, Check, Tag, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import {
  corDaEtiqueta, ETIQUETAS_OCULTAS, familiaDe, FAMILIA_CHIP, type FamiliaEtiqueta,
} from '@/lib/wa-funil'
import {
  useContatosEtiquetas, useCrmEtiquetas, useCriarEtiqueta, useEditarEtiqueta,
  useEtiquetaPrefs, CORES_ETIQUETA, hexDaCor, estiloEtiqueta, type ChipEtiqueta,
} from '@/hooks/useCrmEtiquetas'
import type { ContactFilters } from '@/types'

// Barra de chips no topo de /contatos: cada etiqueta com quantos contatos tem
// DENTRO dos filtros atuais. Clicar filtra; clicar de novo limpa.
//
// A contagem vem de contatos_etiquetas_resumo, que recebe os mesmos filtros da
// lista. A RPC anterior não recebia nenhum — por isso filtrar por vendedor mudava
// a lista e deixava os números dos chips no total geral.
//
// Chips do CRM levam um ponto na frente: são internos e NÃO existem no WhatsApp
// do cliente.
//
// VISUAL (2026-08): o chip deixou de ser "um hex saturado por etiqueta" e passou
// a ser FAMÍLIA (fundo pastel + texto escuro) com a identidade individual no
// dot. Eram ~27 etiquetas, cada uma com sua cor cheia, empilhadas em 4+ linhas —
// o topo da lista virava um arco-íris. Ver FAMILIA_CHIP em lib/wa-funil.

function chaveDoChip(c: ChipEtiqueta) { return `${c.origem}:${c.etiqueta}` }

// Sentinela da RPC: são contatos COM conversa que ninguém classificou (60% da
// base). Não pode ser um chip colorido — qualquer cor que receba domina a barra.
const SEM_ETIQUETA = '(sem etiqueta)'

// Quantos chips aparecem antes do "ver todas". Com 25+ etiquetas (e as do CRM
// não têm teto) a barra chegava a 4-6 linhas e empurrava a primeira linha da
// tabela pra fora da dobra.
const CHIPS_VISIVEIS = 14

// A cor que o usuário escolheu na etiqueta do CRM continua significando algo:
// ela escolhe a FAMÍLIA do chip e pinta o dot.
const FAMILIA_DA_COR: Record<string, FamiliaEtiqueta> = {
  verde: 'positivo',
  azul: 'andamento',
  roxo: 'andamento',
  amarelo: 'sem-retorno',
  laranja: 'sem-retorno',
  vermelho: 'perdido',
  rosa: 'perdido',
  cinza: 'neutro',
}

export function BarraEtiquetas({
  filters, onEscolher,
}: {
  filters: ContactFilters
  onEscolher: (etiqueta: string) => void
}) {
  const { data: chips, isLoading } = useContatosEtiquetas(filters)
  const { data: etiquetasCrm } = useCrmEtiquetas()
  const { ocultas, salvar } = useEtiquetaPrefs()
  const criar = useCriarEtiqueta()
  const editar = useEditarEtiqueta()

  const [gerindo, setGerindo] = useState(false)
  const [expandido, setExpandido] = useState(false)
  const [novoNome, setNovoNome] = useState('')
  const [novaCor, setNovaCor] = useState<string>('azul')
  const [erro, setErro] = useState('')

  // ETIQUETAS_OCULTAS são as de sistema do WhatsApp (GRUPOS, FAVORITOS…). A coluna
  // já as esconde; um chip delas prometeria uma lista que a tela não representa.
  const todos = useMemo(
    () => (chips ?? []).filter(c => !(c.origem === 'wa' && ETIQUETAS_OCULTAS.has(c.etiqueta))),
    [chips])

  const visiveis = useMemo(
    () => todos.filter(c => !ocultas.includes(chaveDoChip(c))),
    [todos, ocultas])

  const ativa = filters.etiqueta

  // Corta a barra sem esconder função: o chip ATIVO entra na fatia mesmo que
  // esteja além do corte, e o resto continua a um clique de distância.
  const { mostrados, escondidos } = useMemo(() => {
    if (expandido || visiveis.length <= CHIPS_VISIVEIS) return { mostrados: visiveis, escondidos: 0 }
    const fatia = visiveis.slice(0, CHIPS_VISIVEIS)
    const ativoFora = ativa ? visiveis.find(c => c.etiqueta === ativa && !fatia.includes(c)) : undefined
    return {
      mostrados: ativoFora ? [...fatia, ativoFora] : fatia,
      escondidos: visiveis.length - CHIPS_VISIVEIS - (ativoFora ? 1 : 0),
    }
  }, [visiveis, expandido, ativa])

  function corDoChip(c: ChipEtiqueta): string | null {
    if (c.etiqueta === SEM_ETIQUETA) return null
    return c.origem === 'crm'
      ? hexDaCor(etiquetasCrm?.find(e => e.nome === c.etiqueta)?.cor ?? 'cinza')
      : corDaEtiqueta(c.etiqueta)
  }

  function familiaDoChip(c: ChipEtiqueta): FamiliaEtiqueta {
    if (c.origem === 'crm') {
      const cor = etiquetasCrm?.find(e => e.nome === c.etiqueta)?.cor ?? 'cinza'
      return FAMILIA_DA_COR[cor] ?? 'neutro'
    }
    return familiaDe(c.etiqueta)
  }

  // Hex do estilo dos chips do painel de organização (mantém o selo antigo lá,
  // onde o que importa é reconhecer a etiqueta uma a uma, não a leitura em massa).
  function hexDoChip(c: ChipEtiqueta): string {
    return corDoChip(c) ?? '#52525b'
  }

  async function alternarVisibilidade(c: ChipEtiqueta) {
    const k = chaveDoChip(c)
    await salvar(ocultas.includes(k) ? ocultas.filter(x => x !== k) : [...ocultas, k])
  }

  async function criarEtiqueta() {
    setErro('')
    const nome = novoNome.trim()
    if (nome.length < 2) { setErro('Dê um nome com pelo menos 2 letras.'); return }
    try {
      await criar.mutateAsync({ nome, cor: novaCor })
      setNovoNome('')
    } catch (e: any) {
      setErro(e?.message ?? 'Não consegui criar a etiqueta.')
    }
  }

  if (isLoading) {
    return <div className="h-7 flex items-center text-[12px] text-ink-faint">Contando etiquetas…</div>
  }
  if (!todos.length) return null

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase font-semibold tracking-[0.08em] text-ink-faint mr-1 shrink-0">
          Etiquetas
        </span>

        {mostrados.map(c => {
          const selecionado = ativa === c.etiqueta
          const fam = familiaDoChip(c)
          const hex = corDoChip(c)
          const fantasma = c.etiqueta === SEM_ETIQUETA
          return (
            <button
              key={chaveDoChip(c)}
              onClick={() => onEscolher(selecionado ? '' : c.etiqueta)}
              aria-pressed={selecionado}
              aria-label={`${c.etiqueta}, ${c.contatos} contato${c.contatos === 1 ? '' : 's'}`}
              title={c.origem === 'crm'
                ? `${c.etiqueta} — etiqueta do CRM (não vai pro WhatsApp)`
                : fantasma
                  ? 'Tem conversa no WhatsApp mas ninguém classificou'
                  : `${c.etiqueta} — etiqueta do WhatsApp`}
              className={cn(
                'group inline-flex items-center gap-1.5 h-7 pl-2 pr-2 rounded-md border text-[12px]',
                'transition-colors duration-150 motion-reduce:transition-none',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                'focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
                selecionado
                  ? cn(FAMILIA_CHIP[fam].solido, 'font-semibold shadow-sm')
                  : fantasma
                    // Ausência de dado = ausência de cor. Borda tracejada, sem preenchimento.
                    ? 'border-dashed border-border-strong text-ink-muted hover:bg-surface-2'
                    : FAMILIA_CHIP[fam].normal,
              )}
            >
              {selecionado
                ? <Check className="h-3 w-3 shrink-0" aria-hidden />
                : hex && (
                  // O dot passou a existir nos DOIS tipos (é ele que carrega a
                  // identidade da etiqueta agora que o fundo é da família), então
                  // "tem dot = é do CRM" deixou de valer. Quem separa é a FORMA:
                  // círculo = WhatsApp, quadradinho = CRM. Forma sobrevive a
                  // daltonismo e a print P&B; cor não.
                  <span
                    // `.etq-dot` porque o fundo do chip TEM tema (FAMILIA_CHIP traz
                    // as variantes dark:): o hex calibrado pro pastel claro vira
                    // mancha invisível sobre o tinto escuro. Só entra no estado
                    // não-selecionado — selecionado troca o dot pelo Check.
                    className={cn('etq-dot h-1.5 w-1.5 shrink-0', c.origem === 'crm' ? 'rounded-[2px]' : 'rounded-full')}
                    style={estiloEtiqueta(hex)}
                    aria-hidden
                  />
                )}
              <span className="truncate max-w-[150px]">{c.etiqueta}</span>
              {/* Contagem sem pílula: era um fundo dentro de outro fundo e pesava
                  quase tanto quanto o nome. A discrição vem do PESO e do TAMANHO
                  (font-normal, 11px) — nunca de opacidade: `opacity` compõe o
                  glifo junto com o fundo e derruba o contraste de verdade. Medido:
                  `opacity-70` levava a contagem a 2,98:1 sobre o chip `sem-retorno`,
                  e o separador (0,5 × 0,7 = 0,35 efetivo) a 1,68:1. */}
              <span aria-hidden className={cn('shrink-0 tabular-nums text-[11px] font-normal',
                selecionado && 'text-white/90 dark:text-black/85')}>
                <span className="mr-1">·</span>{c.contatos}
              </span>
            </button>
          )
        })}

        {escondidos > 0 && (
          <button onClick={() => setExpandido(true)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-dashed border-border-strong text-[12px] text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
            <ChevronDown className="h-3 w-3" aria-hidden /> ver todas ({escondidos})
          </button>
        )}
        {expandido && visiveis.length > CHIPS_VISIVEIS && (
          <button onClick={() => setExpandido(false)}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md border border-border text-[12px] text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
            <ChevronDown className="h-3 w-3 rotate-180" aria-hidden /> ver menos
          </button>
        )}

        {ativa && (
          <button onClick={() => onEscolher('')}
            className="inline-flex items-center gap-1 h-7 px-2 rounded-md text-[12px] text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg">
            <X className="h-3 w-3" aria-hidden /> limpar
          </button>
        )}

        <button onClick={() => setGerindo(v => !v)} title="Escolher quais etiquetas aparecem e criar novas"
          aria-label="Organizar etiquetas" aria-expanded={gerindo}
          className={cn('inline-flex items-center gap-1 h-7 px-2 rounded-md border text-[12px] transition-colors duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg',
            gerindo ? 'border-accent/50 text-accent bg-accent-bg' : 'border-border text-ink-muted hover:text-ink hover:bg-surface-2')}>
          <Settings2 className="h-3.5 w-3.5" aria-hidden />
          {ocultas.length > 0 && <span className="tabular-nums">{ocultas.length} oculta{ocultas.length > 1 ? 's' : ''}</span>}
        </button>
      </div>

      {gerindo && (
        <div className="mt-2.5 rounded-lg border border-border bg-surface p-3.5 shadow-sm">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div>
              <p className="text-[13px] font-semibold text-ink">Organizar etiquetas</p>
              <p className="text-[12px] text-ink-muted mt-0.5 max-w-2xl leading-snug">
                Desmarque as que você não quer ver na barra — vale só pra você. As
                etiquetas do CRM (as que têm um pontinho) são criadas aqui e
                <strong className="text-ink"> não vão pro WhatsApp do cliente</strong>;
                as outras vêm das conversas.
              </p>
            </div>
            <button onClick={() => setGerindo(false)} aria-label="Fechar"
              className="text-ink-muted hover:text-ink shrink-0 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex flex-wrap gap-1.5 mb-4">
            {todos.map(c => {
              const k = chaveDoChip(c)
              const on = !ocultas.includes(k)
              return (
                <button key={k} onClick={() => alternarVisibilidade(c)}
                  aria-pressed={on}
                  style={on ? estiloEtiqueta(hexDoChip(c)) : undefined}
                  className={cn('inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px] transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
                    // `line-through` ja comunica "desligada" sem custar contraste;
                    // com `opacity-70` o rotulo caia pra 2,93:1 (claro) / 2,71:1 (escuro).
                    on ? 'etq-soft' : 'border border-border text-ink-muted line-through')}>
                  {on ? <Check className="h-3 w-3" aria-hidden /> : <X className="h-3 w-3" aria-hidden />}
                  {c.origem === 'crm' && <span className="w-1.5 h-1.5 rounded-full bg-current" />}
                  {c.etiqueta}
                  <span className="tabular-nums text-[11px]">{c.contatos}</span>
                </button>
              )
            })}
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-[12px] font-semibold text-ink mb-2 flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5 text-accent" aria-hidden /> Criar etiqueta do CRM
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <input value={novoNome} onChange={e => { setNovoNome(e.target.value); setErro('') }}
                onKeyDown={e => { if (e.key === 'Enter') criarEtiqueta() }}
                placeholder="Ex.: 3a tentativa" maxLength={40} aria-label="Nome da nova etiqueta"
                className="h-8 w-[210px] rounded-md border border-border bg-surface px-2.5 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30" />
              <div className="flex gap-1">
                {CORES_ETIQUETA.map(c => (
                  /* `.etq-dot` em vez do hex cru: os hues foram escurecidos pra
                      servirem de TEXTO no claro, e como mancha no escuro caiam pra
                      1,7-2,8:1 (antes 4,1-9,1). O `.etq-dot` mostra no escuro o MESMO
                      tom que o selo daquela cor vai ter — o quadradinho passa a prever
                      a cor de verdade. `opacity-70` saiu pelo mesmo motivo. */
                  <button key={c.v} onClick={() => setNovaCor(c.v)} title={c.label}
                    aria-label={`Cor ${c.label}`} aria-pressed={novaCor === c.v}
                    style={estiloEtiqueta(c.hex)}
                    className={cn('etq-dot h-6 w-6 rounded transition-all',
                      novaCor === c.v && 'ring-2 ring-accent ring-offset-2 ring-offset-surface')} />
                ))}
              </div>
              <button onClick={criarEtiqueta} disabled={criar.isPending}
                className="h-8 px-3 rounded-md bg-accent text-white text-[12.5px] font-semibold inline-flex items-center gap-1 disabled:opacity-50 hover:bg-accent/90 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 focus-visible:ring-offset-2 focus-visible:ring-offset-surface">
                <Plus className="h-3.5 w-3.5" aria-hidden /> {criar.isPending ? 'Criando…' : 'Criar'}
              </button>
            </div>
            {erro && <p className="text-[12px] text-danger mt-2" role="alert">{erro}</p>}

            {!!etiquetasCrm?.length && (
              <div className="mt-3">
                <p className="text-[11px] uppercase font-semibold tracking-[0.08em] text-ink-faint mb-1.5">
                  Etiquetas do CRM ({etiquetasCrm.length})
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {etiquetasCrm.map(e => (
                    <span key={e.id} style={estiloEtiqueta(hexDaCor(e.cor))}
                      className="etq-soft inline-flex items-center gap-1.5 h-7 px-2 rounded-md text-[12px]">
                      <span className="w-1.5 h-1.5 rounded-full bg-current" />
                      {e.nome}
                      <button title="Arquivar — some da lista, mas os contatos continuam marcados"
                        aria-label={`Arquivar etiqueta ${e.nome}`}
                        onClick={() => editar.mutate({ id: e.id, ativa: false })}
                        className="opacity-60 hover:opacity-100 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
