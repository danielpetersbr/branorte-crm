/**
 * Fila de revisão do Guia — a tela que faz as 96 pendências serem assináveis.
 *
 * O painel item-a-item não escala: pedir a um nutricionista que abra 81 cards,
 * um por um, para assinar garante que ninguém assina nunca. Aqui ele escolhe a
 * SUA frente, vê só o que é dele, marca e assina de uma vez.
 *
 * Três frentes, três pessoas diferentes:
 *   NUTRIÇÃO   — faixa de inclusão, composição, consumo de referência
 *   ENGENHARIA — densidade, fluidez, ponte, corrosão, misturador indicado
 *   IMAGEM     — autor, licença, e a decisão de que a foto representa o item
 *
 * A assinatura não é decorativa: `pendente_validacao` é DERIVADO dela por
 * trigger. Assinou todas as frentes que o card exige, o selo "referência —
 * pendente de validação" some da tela do vendedor sozinho.
 */
import { useMemo, useState } from 'react'
import { Check, CheckCheck, FlaskConical, Image as ImageIcon, Search, Wrench } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useAssinarRevisao, useFilaRevisao, useGuiaImagens, useVerificarImagens } from '@/hooks/useGuia'
import { normalizar } from '@/lib/guia/busca'
import { cn } from '@/lib/utils'
import type { FrenteRevisao, GuiaImagem, ItemFila } from '@/lib/guia/tipos'

type Aba = FrenteRevisao | 'imagem'

const FRENTES: Array<{
  chave: Aba; nome: string; icone: typeof Wrench; oQueAssina: string
}> = [
  {
    chave: 'nutricao', nome: 'Nutrição', icone: FlaskConical,
    oQueAssina: 'Você confirma que as faixas de inclusão, composições e consumos de referência '
      + 'deste conteúdo estão corretos e podem ser apresentados ao cliente como referência.',
  },
  {
    chave: 'engenharia', nome: 'Engenharia', icone: Wrench,
    oQueAssina: 'Você confirma que o comportamento descrito no equipamento — densidade, fluidez, '
      + 'formação de ponte, corrosão, misturador indicado e compatibilidade com a linha — '
      + 'corresponde à realidade da Branorte.',
  },
  {
    chave: 'imagem', nome: 'Imagens', icone: ImageIcon,
    oQueAssina: 'Você confirma a procedência da imagem (autor e licença) e que ela é adequada '
      + 'para representar o item no material comercial da Branorte.',
  },
]

function Linha({
  titulo, subtitulo, marcado, onMarcar, direita,
}: {
  titulo: string; subtitulo: string; marcado: boolean
  onMarcar: () => void; direita?: React.ReactNode
}) {
  return (
    <li>
      <label className={cn(
        'flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors',
        marcado ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:border-border-strong',
      )}>
        <input type="checkbox" checked={marcado} onChange={onMarcar} className="h-4 w-4 shrink-0" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-medium text-ink">{titulo}</span>
          <span className="block truncate text-[11px] text-ink-faint">{subtitulo}</span>
        </span>
        {direita}
      </label>
    </li>
  )
}

export function FilaRevisao({ nomePadrao }: { nomePadrao: string }) {
  const [aba, setAba] = useState<Aba>('nutricao')
  const [q, setQ] = useState('')
  const [assinante, setAssinante] = useState(nomePadrao)
  const [marcados, setMarcados] = useState<Set<string>>(new Set())
  const [aviso, setAviso] = useState<{ ok: boolean; texto: string } | null>(null)

  const { data: fila = [], isLoading } = useFilaRevisao()
  const { data: imagens = [] } = useGuiaImagens()
  const assinar = useAssinarRevisao()
  const verificar = useVerificarImagens()

  const trocarAba = (a: Aba) => { setAba(a); setMarcados(new Set()); setAviso(null) }
  const alternar = (id: string) =>
    setMarcados(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  // Imagem só entra na fila se puder virar 'verificada'. O CHECK do banco exige
  // arquivo, alt, autor e licença — sem isso a assinatura não teria efeito, e
  // mostrar na fila só faria o revisor marcar em vão.
  const imagensPendentes = useMemo(
    () => imagens.filter(i =>
      i.status === 'pendente' && i.arquivo_url && i.alt && i.autor && i.licenca),
    [imagens],
  )
  const imagensIncompletas = useMemo(
    () => imagens.filter(i =>
      i.status === 'pendente' && !(i.arquivo_url && i.alt && i.autor && i.licenca)),
    [imagens],
  )

  const pendentesDaFrente = useMemo(
    () => aba === 'imagem' ? [] : fila.filter(f => f.frentes_pendentes?.includes(aba)),
    [fila, aba],
  )

  const filtrar = <T extends { nome?: string; slug: string }>(l: T[]) =>
    !q ? l : l.filter(x =>
      normalizar(x.nome ?? x.slug).includes(normalizar(q)) || x.slug.includes(normalizar(q)))

  const visiveisConteudo = filtrar(pendentesDaFrente)
  const visiveisImagem = filtrar(imagensPendentes)
  const visiveis: Array<ItemFila | GuiaImagem> = aba === 'imagem' ? visiveisImagem : visiveisConteudo

  const idDe = (x: ItemFila | GuiaImagem) =>
    'tabela' in x ? `${x.tabela}:${x.slug}` : `img:${x.slug}`

  const todosMarcados = visiveis.length > 0 && visiveis.every(x => marcados.has(idDe(x)))
  const alternarTodos = () =>
    setMarcados(todosMarcados ? new Set() : new Set(visiveis.map(idDe)))

  const contagem = (a: Aba) => a === 'imagem'
    ? imagensPendentes.length
    : fila.filter(f => f.frentes_pendentes?.includes(a)).length

  const semNome = !assinante.trim()
  const executando = assinar.isPending || verificar.isPending

  const executar = async () => {
    setAviso(null)
    const ids = [...marcados]
    if (!ids.length || semNome) return
    try {
      if (aba === 'imagem') {
        const n = await verificar.mutateAsync({
          slugs: ids.map(i => i.replace('img:', '')), por: assinante.trim(),
        })
        setAviso({ ok: true, texto: `${n} ${n === 1 ? 'imagem verificada' : 'imagens verificadas'}.` })
      } else {
        // A RPC recebe uma tabela por vez; a fila mistura animais e matérias.
        let n = 0
        for (const tabela of ['guia_animais', 'guia_materias'] as const) {
          const slugs = ids.filter(i => i.startsWith(tabela + ':')).map(i => i.split(':')[1])
          if (slugs.length) n += await assinar.mutateAsync({ tabela, slugs, frente: aba, por: assinante.trim() })
        }
        setAviso({
          ok: true,
          texto: `${n} ${n === 1 ? 'conteúdo assinado' : 'conteúdos assinados'} na frente de `
            + `${FRENTES.find(f => f.chave === aba)!.nome.toLowerCase()}. `
            + 'Onde todas as frentes estavam assinadas, o selo de pendência já saiu da tela do vendedor.',
        })
      }
      setMarcados(new Set())
    } catch (e) {
      setAviso({ ok: false, texto: e instanceof Error ? e.message : 'Falha ao assinar' })
    }
  }

  if (isLoading) {
    return <div className="flex h-48 items-center justify-center"><LoadingSpinner /></div>
  }

  const frente = FRENTES.find(f => f.chave === aba)!

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1.5">
        {FRENTES.map(f => {
          const Icone = f.icone
          const n = contagem(f.chave)
          return (
            <button
              key={f.chave}
              onClick={() => trocarAba(f.chave)}
              className={cn(
                'flex items-center gap-1.5 rounded-lg border px-3 py-2 text-[13px] font-medium transition-colors',
                aba === f.chave
                  ? 'border-accent bg-accent text-white'
                  : 'border-border bg-surface text-ink-muted hover:text-ink',
              )}
            >
              <Icone className="h-4 w-4" />
              {f.nome}
              <span className={cn('rounded-full px-1.5 text-[11px]',
                aba === f.chave ? 'bg-white/20' : 'bg-surface-2')}>{n}</span>
            </button>
          )
        })}
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-[12.5px] leading-relaxed text-ink">
          <strong>Ao assinar, você declara:</strong> {frente.oQueAssina}
        </p>
        <div className="mt-2.5 flex flex-wrap items-end gap-2">
          <label className="min-w-[220px] flex-1">
            <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
              Assinando como
            </span>
            <Input
              value={assinante}
              onChange={e => setAssinante(e.target.value)}
              placeholder="Nome de quem está revisando"
              aria-label="Nome de quem assina a revisão"
            />
          </label>
          <Button
            variant="primary"
            disabled={!marcados.size || semNome}
            loading={executando}
            onClick={executar}
          >
            <Check className="h-4 w-4" />
            {aba === 'imagem' ? 'Verificar' : 'Assinar'} {marcados.size || ''} {marcados.size === 1 ? 'item' : 'itens'}
          </Button>
        </div>
        {semNome && (
          <p className="mt-1.5 text-[11.5px] text-warning">
            A assinatura precisa de um responsável nomeado — é o banco que exige, não a tela.
          </p>
        )}
      </div>

      {aviso && (
        <div className={cn('rounded-md border-l-[3px] px-3 py-2 text-[12.5px] text-ink',
          aviso.ok ? 'border-l-success bg-success-bg/40' : 'border-l-danger bg-danger-bg/40')}>
          {aviso.texto}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[200px] flex-1">
          <Input value={q} onChange={e => setQ(e.target.value)}
            leftIcon={<Search className="h-4 w-4" />} placeholder="Filtrar…" />
        </div>
        <Button size="sm" onClick={alternarTodos} disabled={!visiveis.length}>
          <CheckCheck className="h-3.5 w-3.5" />
          {todosMarcados ? 'Desmarcar' : `Marcar os ${visiveis.length} visíveis`}
        </Button>
      </div>

      {!visiveis.length ? (
        <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center">
          <p className="text-[14px] text-ink">
            {q ? 'Nada com esse filtro.' : `Nada pendente em ${frente.nome.toLowerCase()}.`}
          </p>
        </div>
      ) : aba === 'imagem' ? (
        <ul className="space-y-1.5">
          {visiveisImagem.map(i => (
            <Linha
              key={i.slug}
              titulo={i.slug}
              subtitulo={`${i.autor} · ${i.licenca}${i.identifica_item ? '' : ' · ilustrativa'}`}
              marcado={marcados.has(`img:${i.slug}`)}
              onMarcar={() => alternar(`img:${i.slug}`)}
              direita={i.arquivo_url
                ? <img src={i.arquivo_url} alt="" className="h-10 w-14 shrink-0 rounded object-cover" />
                : undefined}
            />
          ))}
        </ul>
      ) : (
        <ul className="space-y-1.5">
          {visiveisConteudo.map(f => (
            <Linha
              key={`${f.tabela}:${f.slug}`}
              titulo={f.nome}
              subtitulo={`${f.tabela === 'guia_animais' ? 'Animal' : 'Matéria-prima'} · ${f.grupo} · ${f.slug}`}
              marcado={marcados.has(`${f.tabela}:${f.slug}`)}
              onMarcar={() => alternar(`${f.tabela}:${f.slug}`)}
              direita={
                <span className="flex shrink-0 gap-1">
                  {f.frentes_exigidas?.map(fr => (
                    <Badge key={fr} className={f.frentes_pendentes?.includes(fr)
                      ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success'}>
                      {fr === 'nutricao' ? 'nutrição' : 'engenharia'}
                    </Badge>
                  ))}
                </span>
              }
            />
          ))}
        </ul>
      )}

      {aba === 'imagem' && !!imagensIncompletas.length && (
        <div className="rounded-lg border border-border bg-surface p-3">
          <p className="text-[12px] font-medium text-ink">
            {imagensIncompletas.length} imagens ficaram fora da fila
          </p>
          <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
            Falta autor, licença ou texto alternativo. O banco não deixa marcar como verificada sem
            isso, então assiná-las aqui não teria efeito — complete os campos na aba Imagens antes:{' '}
            <span className="text-ink-faint">{imagensIncompletas.map(i => i.slug).join(', ')}</span>
          </p>
        </div>
      )}
    </div>
  )
}
