/**
 * Busca global + filtros.
 *
 * O guia antigo não tinha nem busca nem filtro: era uma lista de 49 cards e o
 * vendedor rolava. Aqui a busca é a porta de entrada, e os filtros são as nove
 * dimensões que ele usa de verdade no atendimento.
 */
import { ChevronDown, Filter, Search, Star, X } from 'lucide-react'
import { useState } from 'react'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import {
  CATEGORIAS_MATERIA, COMPAT, EQUIPAMENTOS, ESPECIES, EXEMPLOS_BUSCA, MISTURADOR,
  NOME_CATEGORIA, RISCOS, SISTEMAS, SUBGRUPOS,
} from '@/lib/guia/catalogo'
import type { Filtros as TFiltros } from '@/lib/guia/busca'
import { temFiltro } from '@/lib/guia/busca'
import type {
  CategoriaMateria, CompatBranorte, Especie, GuiaMateria, MisturadorIndicado, NivelRisco,
} from '@/lib/guia/tipos'

interface Props {
  consulta: string
  onConsulta: (s: string) => void
  filtros: TFiltros
  onFiltros: (f: TFiltros) => void
  materias: GuiaMateria[]
  regioes: string[]
  total: number
  atalho?: { rotulo: string } | null
}

function Grupo({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-ink-faint">{titulo}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  )
}

function Chip({
  ativo, onClick, children, className,
}: { ativo: boolean; onClick: () => void; children: React.ReactNode; className?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        'rounded-full border px-2.5 py-1 text-[12px] transition-colors',
        ativo
          ? 'border-accent bg-accent text-white'
          : 'border-border bg-surface text-ink-muted hover:border-border-strong hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

export function Filtros({
  consulta, onConsulta, filtros, onFiltros, materias, regioes, total, atalho,
}: Props) {
  const [aberto, setAberto] = useState(false)
  const ativo = temFiltro(filtros)

  // Um clique no chip já ativo desliga o filtro — ninguém quer caçar o "x".
  const set = <K extends keyof TFiltros>(k: K, v: TFiltros[K]) =>
    onFiltros({ ...filtros, [k]: filtros[k] === v ? null : v })

  const sistemasDaEspecie = filtros.especie
    ? SISTEMAS.filter(s => s.especies.includes(filtros.especie as Especie))
    : SISTEMAS

  return (
    <div className="space-y-2.5">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <Input
            value={consulta}
            onChange={e => onConsulta(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />}
            placeholder="Buscar animal, raça, fase ou matéria-prima…"
            aria-label="Buscar no guia"
          />
        </div>
        <button
          type="button"
          onClick={() => setAberto(v => !v)}
          aria-expanded={aberto}
          className={cn(
            'flex shrink-0 items-center gap-1.5 rounded-md border px-3 text-[13px] font-medium transition-colors',
            'min-h-[44px] sm:min-h-0 sm:h-9',
            ativo || aberto
              ? 'border-accent bg-accent/10 text-accent'
              : 'border-border bg-surface text-ink-muted hover:text-ink',
          )}
        >
          <Filter className="h-4 w-4" />
          <span className="hidden sm:inline">Filtros</span>
          {ativo && <span className="rounded-full bg-accent px-1.5 text-[10px] text-white">on</span>}
          <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', aberto && 'rotate-180')} />
        </button>
      </div>

      {/* Exemplos: o vendedor não sabe que dá pra perguntar por intenção. */}
      {!consulta && !ativo && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-ink-faint">Tente:</span>
          {EXEMPLOS_BUSCA.map(e => (
            <button
              key={e}
              onClick={() => onConsulta(e)}
              className="rounded-full border border-border bg-surface px-2 py-0.5 text-[11px] text-ink-muted hover:border-border-strong hover:text-ink"
            >
              {e}
            </button>
          ))}
        </div>
      )}

      {atalho && (
        <div className="rounded-md border-l-[3px] border-l-accent bg-accent-bg/30 px-3 py-2 text-[12.5px] text-ink">
          {atalho.rotulo}
        </div>
      )}

      {aberto && (
        <div className="grid gap-3 rounded-lg border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
          <Grupo titulo="Espécie">
            {ESPECIES.map(e => (
              <Chip key={e.chave} ativo={filtros.especie === e.chave} onClick={() => set('especie', e.chave)}>
                {e.icone} {e.nome}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Finalidade">
            {['corte', 'leite', 'frango_corte', 'postura', 'caipira', 'comercial'].map(s => (
              <Chip key={s} ativo={filtros.subgrupo === s} onClick={() => set('subgrupo', s)}>
                {SUBGRUPOS[s] ?? s}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Sistema de criação">
            {sistemasDaEspecie.map(s => (
              <Chip key={s.chave} ativo={filtros.sistema === s.chave} onClick={() => set('sistema', s.chave)}>
                {s.nome}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Tipo de alimento">
            {CATEGORIAS_MATERIA.map(c => (
              <Chip
                key={c.chave}
                ativo={filtros.categoria === c.chave}
                onClick={() => set('categoria', c.chave as CategoriaMateria)}
              >
                {c.icone} {c.nome}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Matéria-prima">
            <select
              value={filtros.materia ?? ''}
              onChange={e => onFiltros({ ...filtros, materia: e.target.value || null })}
              aria-label="Filtrar por matéria-prima"
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12px] text-ink"
            >
              <option value="">Todas</option>
              {materias.map(m => <option key={m.slug} value={m.slug}>{m.nome}</option>)}
            </select>
          </Grupo>

          <Grupo titulo="Equipamento compatível">
            <select
              value={filtros.equipamento ?? ''}
              onChange={e => onFiltros({ ...filtros, equipamento: e.target.value || null })}
              aria-label="Filtrar por equipamento"
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12px] text-ink"
            >
              <option value="">Todos</option>
              {Object.entries(EQUIPAMENTOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Grupo>

          <Grupo titulo="Região">
            <select
              value={filtros.regiao ?? ''}
              onChange={e => onFiltros({ ...filtros, regiao: e.target.value || null })}
              aria-label="Filtrar por região"
              className="h-8 w-full rounded-md border border-border bg-surface px-2 text-[12px] text-ink"
            >
              <option value="">Todas</option>
              {regioes.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </Grupo>

          <Grupo titulo="Risco técnico">
            {(Object.keys(RISCOS) as NivelRisco[]).map(r => (
              <Chip key={r} ativo={filtros.risco === r} onClick={() => set('risco', r)}>
                {RISCOS[r].icone} {RISCOS[r].nome}
              </Chip>
            ))}
          </Grupo>

          <Grupo titulo="Processo Branorte">
            {(Object.keys(COMPAT) as CompatBranorte[]).map(c => (
              <Chip key={c} ativo={filtros.compat === c} onClick={() => set('compat', c)}>
                {COMPAT[c].curto}
              </Chip>
            ))}
            {(['horizontal', 'vertical'] as MisturadorIndicado[]).map(m => (
              <Chip key={m} ativo={filtros.misturador === m} onClick={() => set('misturador', m)}>
                Misturador {MISTURADOR[m].toLowerCase()}
              </Chip>
            ))}
          </Grupo>

          <div className="sm:col-span-2 lg:col-span-3 flex flex-wrap items-center gap-2 border-t border-border pt-2.5">
            <Chip ativo={!!filtros.soFavoritos} onClick={() => set('soFavoritos', !filtros.soFavoritos as never)}>
              <Star className={cn('mr-1 inline h-3 w-3', filtros.soFavoritos && 'fill-current')} />
              Só favoritos
            </Chip>
            {ativo && (
              <button
                onClick={() => onFiltros({})}
                className="flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[12px] text-ink-muted hover:text-danger"
              >
                <X className="h-3 w-3" />Limpar filtros
              </button>
            )}
            <span className="ml-auto text-[12px] text-ink-faint">
              {total} {total === 1 ? 'resultado' : 'resultados'}
            </span>
          </div>
        </div>
      )}

      {!aberto && ativo && (
        <div className="flex flex-wrap items-center gap-1.5">
          {Object.entries(filtros).map(([k, v]) => {
            if (!v) return null
            const rotulo = k === 'categoria' ? NOME_CATEGORIA[v as CategoriaMateria]
              : k === 'equipamento' ? EQUIPAMENTOS[v as string]
              : k === 'risco' ? RISCOS[v as NivelRisco].nome
              : k === 'compat' ? COMPAT[v as CompatBranorte].curto
              : k === 'soFavoritos' ? 'Só favoritos'
              : String(v)
            return (
              <Badge key={k} className="bg-accent/10 text-accent">
                {rotulo}
                <button
                  onClick={() => onFiltros({ ...filtros, [k]: null })}
                  aria-label={`Remover filtro ${rotulo}`}
                  className="ml-0.5 hover:text-danger"
                >
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            )
          })}
          <span className="ml-auto text-[12px] text-ink-faint">{total} resultados</span>
        </div>
      )}
    </div>
  )
}
