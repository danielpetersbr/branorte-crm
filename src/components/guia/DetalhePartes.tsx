/**
 * Peças compartilhadas pelas páginas individuais (animal e matéria-prima).
 */
import { Check, Copy, Star } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { EQUIPAMENTOS } from '@/lib/guia/catalogo'
import type { BlocoBranorte, GuiaFonte } from '@/lib/guia/tipos'

export function Secao({
  titulo, icone, children, className, destaque,
}: {
  titulo: string; icone?: React.ReactNode; children: React.ReactNode
  className?: string; destaque?: boolean
}) {
  return (
    <section className={cn(
      'rounded-lg border p-4',
      destaque ? 'border-accent/30 bg-accent-bg/30' : 'border-border bg-surface',
      className,
    )}>
      {/* O contraste era o problema, não o tamanho. `ink-faint` (240 3% 50%)
          sobre `surface` (240 8% 11%) mede 4,23:1 — reprova no AA, que pede 4,5.
          Subir a COR resolve isso.
          Eu tinha trocado por `text-[13px] text-ink` e criado outro defeito: o
          corpo de `Lista` e `Perguntas` também é 13px/ink, então título e texto
          ficavam idênticos a menos do peso. Em `DetalheAnimal` são 10 seções
          empilhadas e em `DetalheMateria` 8 — virava parede de 13px sem nada
          nomeando nada. Caixa-alta menor É a hierarquia; só faltava contraste. */}
      <h3 className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-muted">
        {icone}{titulo}
      </h3>
      {children}
    </section>
  )
}

export function Campo({ rotulo, valor }: { rotulo: string; valor?: string | null }) {
  if (!valor) return null
  return (
    <div className="py-1.5">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{rotulo}</dt>
      <dd className="mt-0.5 text-[13px] leading-relaxed text-ink">{valor}</dd>
    </div>
  )
}

export function Lista({ itens, marcador = '•' }: { itens: string[]; marcador?: string }) {
  if (!itens?.length) return null
  return (
    <ul className="space-y-1.5">
      {itens.map((t, i) => (
        <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-ink">
          <span aria-hidden className="shrink-0 text-ink-faint">{marcador}</span>
          <span className="min-w-0">{t}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Lista numerada de perguntas — o vendedor lê em sequência, no telefone.
 *
 * `className` existe pro Atendimento rápido: quando as perguntas caem na faixa
 * de largura inteira (notebook 1366), uma coluna só deixaria 900px de vazio à
 * direita. Lá elas viram `columns-2/3`.
 */
export function Perguntas({ perguntas, className }: { perguntas: string[]; className?: string }) {
  if (!perguntas?.length) return null
  return (
    <ol className={cn('space-y-2', className)}>
      {perguntas.map((p, i) => (
        <li key={i} className="flex gap-2.5 text-[13px] leading-relaxed text-ink">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[10px] font-bold text-accent">
            {i + 1}
          </span>
          <span className="min-w-0">{p}</span>
        </li>
      ))}
    </ol>
  )
}

/**
 * Bloco "O que a Branorte consegue atender?" — obrigatório em toda página.
 * É a peça que impede o vendedor de prometer peletização, silagem ou óleo.
 */
export function BlocoBranorteView({ b }: { b?: BlocoBranorte | null }) {
  if (!b || (!b.atende?.length && !b.nao_atende?.length && !b.ressalvas?.length)) return null
  return (
    <Secao titulo="O que a Branorte consegue atender?" destaque>
      <div className="grid gap-3 sm:grid-cols-2">
        {!!b.atende?.length && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-success">Atende</p>
            <Lista itens={b.atende} marcador="✓" />
          </div>
        )}
        {!!b.nao_atende?.length && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-danger">Não atende</p>
            <Lista itens={b.nao_atende} marcador="✗" />
          </div>
        )}
      </div>
      {!!b.ressalvas?.length && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-warning">Ressalvas</p>
          <Lista itens={b.ressalvas} marcador="!" />
        </div>
      )}
    </Secao>
  )
}

export function Equipamentos({ chaves }: { chaves: string[] }) {
  if (!chaves?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {chaves.map(c => (
        <Badge key={c} className="bg-surface-2 text-ink-muted">{EQUIPAMENTOS[c] ?? c}</Badge>
      ))}
    </div>
  )
}

/**
 * Fontes e data de revisão. O guia antigo tinha 0 de 49 cards com fonte; a
 * ausência aqui é informação, não omissão — por isso o texto explícito.
 */
export function Fontes({
  chaves, revisadoEm, revisor, mapa,
}: {
  chaves: string[]; revisadoEm?: string | null; revisor?: string | null
  mapa: Map<string, GuiaFonte>
}) {
  return (
    <Secao titulo="Fontes e revisão">
      {chaves?.length ? (
        <ul className="space-y-1.5">
          {chaves.map(c => {
            const f = mapa.get(c)
            if (!f) return <li key={c} className="text-[12px] text-ink-faint">{c}</li>
            return (
              <li key={c} className="text-[12px] leading-relaxed text-ink-muted">
                <span className="font-medium text-ink">{f.titulo}</span>
                {f.organizacao && ` — ${f.organizacao}`}
                {f.edicao && `, ${f.edicao}`}
                {f.ano && ` (${f.ano})`}
                {f.url && (
                  <>
                    {' '}
                    <a href={f.url} target="_blank" rel="noopener noreferrer" className="text-accent underline">abrir</a>
                  </>
                )}
                {!f.url && <span className="text-ink-faint"> · URL a confirmar na revisão técnica</span>}
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="text-[12px] text-ink-faint">Sem fonte registrada. Conteúdo aguarda atribuição na revisão técnica.</p>
      )}
      <p className="mt-2.5 border-t border-border pt-2 text-[11px] text-ink-faint">
        {revisadoEm
          ? `Revisão técnica em ${new Date(revisadoEm).toLocaleDateString('pt-BR')}${revisor ? ` por ${revisor}` : ''}.`
          : 'Ainda sem revisão técnica assinada.'}
      </p>
    </Secao>
  )
}

/** Barra de ações. "Copiar resumo" existe porque o vendedor cola no WhatsApp. */
export function BarraAcoes({
  favorito, onFavoritar, textoParaCopiar, extra,
}: {
  favorito: boolean; onFavoritar: () => void; textoParaCopiar: string; extra?: React.ReactNode
}) {
  const [copiado, setCopiado] = useState(false)
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(textoParaCopiar)
      setCopiado(true)
      setTimeout(() => setCopiado(false), 2000)
    } catch { /* clipboard bloqueado: o usuário ainda pode selecionar o texto */ }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {extra}
      <Button size="sm" onClick={copiar}>
        {copiado ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copiado ? 'Copiado' : 'Copiar resumo'}
      </Button>
      <Button size="sm" onClick={onFavoritar} aria-pressed={favorito}>
        <Star className={cn('h-3.5 w-3.5', favorito && 'fill-yellow-400 text-yellow-500')} />
        {favorito ? 'Favorito' : 'Salvar'}
      </Button>
    </div>
  )
}
