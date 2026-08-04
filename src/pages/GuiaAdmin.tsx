/**
 * Painel de revisão do Guia do Vendedor.
 *
 * Existe porque o guia antigo era HTML gerado por script: corrigir um número
 * exigia editar 40 KB de uma linha e redeployar OUTRO projeto Vercel. Aqui o
 * conteúdo tem dono, status, fonte, data de revisão e histórico de versões.
 *
 * Acesso por `guia.editar` — a MESMA chave que a RLS usa em
 * public.guia_pode_editar(). Sem ela, a tela não abre e o banco também nega.
 */
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle, ArrowLeft, Check, History, Image as ImageIcon, Save, Search, X,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Badge } from '@/components/ui/Badge'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { useCan } from '@/hooks/usePermissions'
import { useAuth } from '@/hooks/useAuth'
import {
  useGuiaAnimais, useGuiaFontes, useGuiaImagens, useGuiaMaterias, useSalvarAnimal,
  useSalvarFonte, useSalvarImagem, useSalvarMateria, useVersoes,
} from '@/hooks/useGuia'
import { NOME_CATEGORIA, NOME_ESPECIE, STATUS } from '@/lib/guia/catalogo'
import { normalizar } from '@/lib/guia/busca'
import { cn } from '@/lib/utils'
import type {
  GuiaAnimal, GuiaFonte, GuiaImagem, GuiaMateria, StatusConteudo, StatusImagem,
} from '@/lib/guia/tipos'

type Aba = 'animais' | 'materias' | 'imagens' | 'fontes'

const FLUXO: StatusConteudo[] = ['rascunho', 'em_revisao', 'aprovado', 'desatualizado', 'arquivado']

function Campo({ rotulo, children, dica }: { rotulo: string; children: React.ReactNode; dica?: string }) {
  return (
    <label className="block">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{rotulo}</span>
      {dica && <span className="ml-1 text-[11px] normal-case text-ink-faint">— {dica}</span>}
      <div className="mt-1">{children}</div>
    </label>
  )
}

const areaCls = 'w-full rounded-md border border-border bg-surface px-2.5 py-2 text-[13px] text-ink focus:border-accent focus:outline-none'

/** Lista de strings editada como uma linha por item — é como o revisor pensa. */
function ListaTexto({ valor, onChange, linhas = 4 }: {
  valor: string[]; onChange: (v: string[]) => void; linhas?: number
}) {
  return (
    <textarea
      rows={linhas}
      className={areaCls}
      value={valor.join('\n')}
      onChange={e => onChange(e.target.value.split('\n').map(s => s.trim()).filter(Boolean))}
    />
  )
}

function Historico({ tabela, id }: { tabela: string; id: number }) {
  const { data = [], isLoading } = useVersoes(tabela, id)
  if (isLoading) return <p className="text-[12px] text-ink-faint">Carregando histórico…</p>
  if (!data.length) return <p className="text-[12px] text-ink-faint">Sem alterações registradas ainda.</p>
  return (
    <ul className="space-y-1.5">
      {data.map(v => {
        const s = v.snapshot as Record<string, unknown>
        return (
          <li key={v.id} className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-[12px]">
            <span className="font-medium text-ink">v{v.versao}</span>
            <span className="text-ink-faint"> · {new Date(v.alterado_em).toLocaleString('pt-BR')}</span>
            <span className="text-ink-muted"> · status anterior: {String(s.status ?? '—')}</span>
          </li>
        )
      })}
    </ul>
  )
}

// ---------------------------------------------------------------------------
// Editor de conteúdo (animal ou matéria — os campos editoriais são os mesmos)
// ---------------------------------------------------------------------------
function EditorConteudo({ item, tabela, onFechar, autorPadrao }: {
  item: GuiaAnimal | GuiaMateria
  tabela: 'guia_animais' | 'guia_materias'
  onFechar: () => void
  autorPadrao: string
}) {
  const salvarA = useSalvarAnimal()
  const salvarM = useSalvarMateria()
  const salvando = salvarA.isPending || salvarM.isPending
  const [f, setF] = useState({
    status: item.status,
    pendente_validacao: item.pendente_validacao,
    resumo: item.resumo,
    resumo_30s: item.resumo_30s ?? '',
    explicar_cliente: item.explicar_cliente ?? '',
    perguntas: item.perguntas ?? [],
    pendencias: item.pendencias ?? [],
    fontes: item.fontes ?? [],
    revisor_tecnico: item.revisor_tecnico ?? '',
    revisado_em: item.revisado_em ?? '',
    proxima_revisao: item.proxima_revisao ?? '',
  })
  const [erro, setErro] = useState<string | null>(null)

  const aprovarBloqueado = f.status === 'aprovado' && !f.fontes.length

  const salvar = async () => {
    setErro(null)
    const patch = {
      id: item.id,
      ...f,
      resumo_30s: f.resumo_30s || null,
      explicar_cliente: f.explicar_cliente || null,
      revisor_tecnico: f.revisor_tecnico || null,
      revisado_em: f.revisado_em || null,
      proxima_revisao: f.proxima_revisao || null,
    }
    try {
      if (tabela === 'guia_animais') await salvarA.mutateAsync(patch as never)
      else await salvarM.mutateAsync(patch as never)
      onFechar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Falha ao salvar')
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-accent/40 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-[15px] font-bold text-ink">{item.nome}</h3>
          <p className="text-[11px] text-ink-faint">{item.slug} · atualizado em {new Date(item.updated_at).toLocaleString('pt-BR')}</p>
        </div>
        <Button size="sm" onClick={onFechar}><X className="h-3.5 w-3.5" />Fechar</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Status editorial">
          <div className="flex flex-wrap gap-1.5">
            {FLUXO.map(s => (
              <button
                key={s}
                onClick={() => setF(v => ({ ...v, status: s }))}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-[12px]',
                  f.status === s ? 'border-accent bg-accent text-white' : 'border-border text-ink-muted hover:text-ink',
                )}
              >
                {STATUS[s].nome}
              </button>
            ))}
          </div>
        </Campo>

        <Campo rotulo="Pendência de validação">
          <label className="flex items-center gap-2 text-[13px] text-ink">
            <input
              type="checkbox"
              checked={f.pendente_validacao}
              onChange={e => setF(v => ({ ...v, pendente_validacao: e.target.checked }))}
              className="h-3.5 w-3.5"
            />
            Mostrar selo “referência — pendente de validação”
          </label>
        </Campo>
      </div>

      <Campo rotulo="Resumo (identificação)">
        <textarea rows={3} className={areaCls} value={f.resumo}
          onChange={e => setF(v => ({ ...v, resumo: e.target.value }))} />
      </Campo>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Resumo em 30 segundos">
          <textarea rows={3} className={areaCls} value={f.resumo_30s}
            onChange={e => setF(v => ({ ...v, resumo_30s: e.target.value }))} />
        </Campo>
        <Campo rotulo="Como explicar para o cliente">
          <textarea rows={3} className={areaCls} value={f.explicar_cliente}
            onChange={e => setF(v => ({ ...v, explicar_cliente: e.target.value }))} />
        </Campo>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Perguntas para o vendedor" dica="uma por linha">
          <ListaTexto valor={f.perguntas} onChange={v => setF(s => ({ ...s, perguntas: v }))} linhas={5} />
        </Campo>
        <Campo rotulo="Pendências" dica="uma por linha">
          <ListaTexto valor={f.pendencias} onChange={v => setF(s => ({ ...s, pendencias: v }))} linhas={5} />
        </Campo>
      </div>

      <Campo rotulo="Fontes" dica="chaves de guia_fontes, uma por linha">
        <ListaTexto valor={f.fontes} onChange={v => setF(s => ({ ...s, fontes: v }))} linhas={3} />
      </Campo>

      <div className="grid gap-3 sm:grid-cols-3">
        <Campo rotulo="Revisor técnico">
          <Input value={f.revisor_tecnico} placeholder={autorPadrao}
            onChange={e => setF(v => ({ ...v, revisor_tecnico: e.target.value }))} />
        </Campo>
        <Campo rotulo="Revisado em">
          <Input type="date" value={f.revisado_em}
            onChange={e => setF(v => ({ ...v, revisado_em: e.target.value }))} />
        </Campo>
        <Campo rotulo="Próxima revisão">
          <Input type="date" value={f.proxima_revisao}
            onChange={e => setF(v => ({ ...v, proxima_revisao: e.target.value }))} />
        </Campo>
      </div>

      {aprovarBloqueado && (
        <div className="flex items-start gap-2 rounded-md border-l-[3px] border-l-warning bg-warning-bg/40 px-3 py-2 text-[12.5px] text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>
            Aprovar sem fonte é exatamente o defeito que a auditoria encontrou (0 de 49 cards tinham
            fonte). Registre pelo menos uma antes de publicar.
          </span>
        </div>
      )}
      {erro && (
        <div className="rounded-md border-l-[3px] border-l-danger bg-danger-bg/40 px-3 py-2 text-[12.5px] text-ink">
          {erro}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button variant="primary" onClick={salvar} loading={salvando} disabled={aprovarBloqueado}>
          <Save className="h-4 w-4" />Salvar
        </Button>
        <details className="ml-auto">
          <summary className="cursor-pointer text-[12px] text-ink-muted hover:text-ink">
            <History className="mr-1 inline h-3.5 w-3.5" />Histórico de versões
          </summary>
          <div className="mt-2 w-full min-w-[280px]"><Historico tabela={tabela} id={item.id} /></div>
        </details>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Editor de imagem — o formulário reflete a regra do banco: 'verificada' exige
// arquivo, alt, autor, licença, data e aprovador. Nada de meia verificação.
// ---------------------------------------------------------------------------
function EditorImagem({ img, onFechar, autorPadrao }: {
  img: GuiaImagem; onFechar: () => void; autorPadrao: string
}) {
  const salvar = useSalvarImagem()
  const [f, setF] = useState({
    arquivo_url: img.arquivo_url ?? '', alt: img.alt ?? '', legenda: img.legenda ?? '',
    autor: img.autor ?? '', licenca: img.licenca ?? '', fonte_url: img.fonte_url ?? '',
    url_original: img.url_original ?? '', status: img.status,
    identifica_item: img.identifica_item,
    verificada_em: img.verificada_em ?? '', aprovada_por: img.aprovada_por ?? '',
    motivo_reprovacao: img.motivo_reprovacao ?? '',
  })
  const [erro, setErro] = useState<string | null>(null)

  const faltando = f.status === 'verificada'
    ? [
        !f.arquivo_url && 'arquivo', !f.alt && 'texto alternativo', !f.autor && 'autor',
        !f.licenca && 'licença', !f.verificada_em && 'data da verificação',
        !f.aprovada_por && 'responsável pela aprovação',
      ].filter(Boolean) as string[]
    : []

  return (
    <div className="space-y-3 rounded-lg border border-accent/40 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          {f.arquivo_url && f.status !== 'reprovada' && (
            <img src={f.arquivo_url} alt={f.alt || img.slug} className="h-16 w-24 rounded border border-border object-cover" />
          )}
          <div className="min-w-0">
            <h3 className="text-[15px] font-bold text-ink">{img.slug}</h3>
            <p className="text-[11px] text-ink-faint">{img.largura_px ? `${img.largura_px}px` : ''}</p>
          </div>
        </div>
        <Button size="sm" onClick={onFechar}><X className="h-3.5 w-3.5" />Fechar</Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {(['pendente', 'verificada', 'reprovada'] as StatusImagem[]).map(s => (
          <button
            key={s}
            onClick={() => setF(v => ({ ...v, status: s }))}
            className={cn('rounded-md border px-3 py-2 text-[12.5px] font-medium',
              f.status === s ? 'border-accent bg-accent text-white' : 'border-border text-ink-muted hover:text-ink')}
          >
            {s === 'pendente' ? 'Pendente (aparece com selo)'
              : s === 'verificada' ? 'Verificada' : 'Reprovada (cai no fallback)'}
          </button>
        ))}
      </div>

      <Campo rotulo="Caminho do arquivo" dica="/img/guia/slug.webp">
        <Input value={f.arquivo_url} onChange={e => setF(v => ({ ...v, arquivo_url: e.target.value }))} />
      </Campo>
      <Campo rotulo="Texto alternativo (alt)" dica="descreva o que se vê; obrigatório para acessibilidade">
        <Input value={f.alt} onChange={e => setF(v => ({ ...v, alt: e.target.value }))} />
      </Campo>

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Autor"><Input value={f.autor} onChange={e => setF(v => ({ ...v, autor: e.target.value }))} /></Campo>
        <Campo rotulo="Licença"><Input value={f.licenca} onChange={e => setF(v => ({ ...v, licenca: e.target.value }))} /></Campo>
        <Campo rotulo="Fonte (página)"><Input value={f.fonte_url} onChange={e => setF(v => ({ ...v, fonte_url: e.target.value }))} /></Campo>
        <Campo rotulo="URL original do arquivo"><Input value={f.url_original} onChange={e => setF(v => ({ ...v, url_original: e.target.value }))} /></Campo>
        <Campo rotulo="Verificada em"><Input type="date" value={f.verificada_em} onChange={e => setF(v => ({ ...v, verificada_em: e.target.value }))} /></Campo>
        <Campo rotulo="Aprovada por"><Input value={f.aprovada_por} placeholder={autorPadrao} onChange={e => setF(v => ({ ...v, aprovada_por: e.target.value }))} /></Campo>
      </div>

      <label className="flex items-start gap-2 text-[13px] text-ink">
        <input type="checkbox" checked={f.identifica_item} className="mt-0.5 h-3.5 w-3.5"
          onChange={e => setF(v => ({ ...v, identifica_item: e.target.checked }))} />
        <span>
          Esta foto IDENTIFICA o item (serve como prova da raça ou do ingrediente).
          <span className="block text-ink-faint">
            Desmarque para linhagem comercial de ave: Cobb e Ross são ambos frangos brancos —
            nenhuma foto prova qual é qual. Desmarcado, o card mostra “imagem ilustrativa”.
          </span>
        </span>
      </label>

      {f.status === 'reprovada' && (
        <Campo rotulo="Motivo da reprovação">
          <textarea rows={3} className={areaCls} value={f.motivo_reprovacao}
            onChange={e => setF(v => ({ ...v, motivo_reprovacao: e.target.value }))} />
        </Campo>
      )}

      {!!faltando.length && (
        <div className="flex items-start gap-2 rounded-md border-l-[3px] border-l-warning bg-warning-bg/40 px-3 py-2 text-[12.5px] text-ink">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <span>Para marcar como verificada, falta: {faltando.join(', ')}.</span>
        </div>
      )}
      {erro && <div className="rounded-md border-l-[3px] border-l-danger bg-danger-bg/40 px-3 py-2 text-[12.5px] text-ink">{erro}</div>}

      <Button
        variant="primary"
        loading={salvar.isPending}
        disabled={!!faltando.length}
        onClick={async () => {
          setErro(null)
          try {
            await salvar.mutateAsync({
              id: img.id, ...f,
              legenda: f.legenda || null, autor: f.autor || null, licenca: f.licenca || null,
              fonte_url: f.fonte_url || null, url_original: f.url_original || null,
              arquivo_url: f.arquivo_url || null, verificada_em: f.verificada_em || null,
              aprovada_por: f.aprovada_por || null, motivo_reprovacao: f.motivo_reprovacao || null,
            } as never)
            onFechar()
          } catch (e) { setErro(e instanceof Error ? e.message : 'Falha ao salvar') }
        }}
      >
        <Save className="h-4 w-4" />Salvar imagem
      </Button>
    </div>
  )
}

function EditorFonte({ fonte, onFechar }: { fonte: GuiaFonte; onFechar: () => void }) {
  const salvar = useSalvarFonte()
  const [f, setF] = useState({
    titulo: fonte.titulo, organizacao: fonte.organizacao ?? '', edicao: fonte.edicao ?? '',
    ano: fonte.ano ?? '', url: fonte.url ?? '', consultada_em: fonte.consultada_em ?? '',
    observacao: fonte.observacao ?? '',
  })
  return (
    <div className="space-y-3 rounded-lg border border-accent/40 bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <h3 className="text-[15px] font-bold text-ink">{fonte.chave}</h3>
        <Button size="sm" onClick={onFechar}><X className="h-3.5 w-3.5" />Fechar</Button>
      </div>
      <Campo rotulo="Título"><Input value={f.titulo} onChange={e => setF(v => ({ ...v, titulo: e.target.value }))} /></Campo>
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Organização"><Input value={f.organizacao} onChange={e => setF(v => ({ ...v, organizacao: e.target.value }))} /></Campo>
        <Campo rotulo="Edição" dica="sem isso, número de linhagem não vale">
          <Input value={f.edicao} onChange={e => setF(v => ({ ...v, edicao: e.target.value }))} />
        </Campo>
        <Campo rotulo="Ano"><Input type="number" value={f.ano} onChange={e => setF(v => ({ ...v, ano: e.target.value }))} /></Campo>
        <Campo rotulo="Consultada em"><Input type="date" value={f.consultada_em} onChange={e => setF(v => ({ ...v, consultada_em: e.target.value }))} /></Campo>
      </div>
      <Campo rotulo="URL"><Input value={f.url} onChange={e => setF(v => ({ ...v, url: e.target.value }))} /></Campo>
      <Campo rotulo="Observação">
        <textarea rows={3} className={areaCls} value={f.observacao}
          onChange={e => setF(v => ({ ...v, observacao: e.target.value }))} />
      </Campo>
      <Button
        variant="primary"
        loading={salvar.isPending}
        onClick={async () => {
          await salvar.mutateAsync({
            id: fonte.id, ...f,
            ano: f.ano ? Number(f.ano) : null,
            organizacao: f.organizacao || null, edicao: f.edicao || null,
            url: f.url || null, consultada_em: f.consultada_em || null,
            observacao: f.observacao || null,
          } as never)
          onFechar()
        }}
      >
        <Save className="h-4 w-4" />Salvar fonte
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
export function GuiaAdmin() {
  const can = useCan()
  const { profile } = useAuth()
  const [aba, setAba] = useState<Aba>('animais')
  const [q, setQ] = useState('')
  const [status, setStatus] = useState<StatusConteudo | ''>('')
  const [editando, setEditando] = useState<string | null>(null)

  const { data: animais = [], isLoading: cA } = useGuiaAnimais()
  const { data: materias = [], isLoading: cM } = useGuiaMaterias()
  const { data: imagens = [], isLoading: cI } = useGuiaImagens()
  const { data: fontes = [], isLoading: cF } = useGuiaFontes()

  const podeEditar = profile?.role === 'admin' || can('guia.editar')
  const autorPadrao = profile?.display_name ?? ''

  const filtrar = <T extends { nome: string; slug: string; status: StatusConteudo }>(l: T[]) =>
    l.filter(x =>
      (!status || x.status === status)
      && (!q || normalizar(x.nome).includes(normalizar(q)) || x.slug.includes(normalizar(q))))

  const resumo = useMemo(() => {
    const conta = (l: Array<{ status: StatusConteudo; pendente_validacao: boolean }>) => ({
      total: l.length,
      pendentes: l.filter(x => x.pendente_validacao).length,
      naoAprovados: l.filter(x => x.status !== 'aprovado').length,
      semFonte: 0,
    })
    const a = conta(animais); const m = conta(materias)
    a.semFonte = animais.filter(x => !x.fontes?.length).length
    m.semFonte = materias.filter(x => !x.fontes?.length).length
    return {
      total: a.total + m.total,
      pendentes: a.pendentes + m.pendentes,
      naoAprovados: a.naoAprovados + m.naoAprovados,
      semFonte: a.semFonte + m.semFonte,
      imgReprovadas: imagens.filter(i => i.status === 'reprovada').length,
      imgVerificadas: imagens.filter(i => i.status === 'verificada').length,
      imgTotal: imagens.length,
      fontesSemUrl: fontes.filter(f => !f.url).length,
    }
  }, [animais, materias, imagens, fontes])

  if (!podeEditar) {
    return (
      <div className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="text-[14px] text-ink">Você não tem permissão para editar o Guia.</p>
        <p className="mt-1 text-[12.5px] text-ink-muted">Peça a permissão “guia.editar” a um administrador.</p>
        <Link to="/guia" className="mt-3 inline-block text-[13px] text-accent hover:underline">Voltar ao guia</Link>
      </div>
    )
  }

  if (cA || cM || cI || cF) {
    return <div className="flex h-64 items-center justify-center"><LoadingSpinner /></div>
  }

  return (
    <div className="mx-auto max-w-6xl space-y-4 px-3 py-4 sm:px-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-ink">Revisão do Guia</h1>
          <p className="text-[12.5px] text-ink-muted">
            Todo conteúdo tem status, fonte, revisor e histórico. Nada fica fixo no código.
          </p>
        </div>
        <Link to="/guia">
          <Button size="sm"><ArrowLeft className="h-3.5 w-3.5" />Ver o guia</Button>
        </Link>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { r: 'Conteúdos', v: resumo.total, alerta: false },
          { r: 'Pendentes de validação', v: resumo.pendentes, alerta: resumo.pendentes > 0 },
          { r: 'Sem fonte', v: resumo.semFonte, alerta: resumo.semFonte > 0 },
          { r: 'Imagens verificadas', v: `${resumo.imgVerificadas}/${resumo.imgTotal}`, alerta: resumo.imgVerificadas === 0 },
        ].map(k => (
          <div key={k.r} className="rounded-lg border border-border bg-surface p-3">
            <p className="text-[11px] uppercase tracking-wide text-ink-faint">{k.r}</p>
            <p className={cn('text-xl font-bold', k.alerta ? 'text-warning' : 'text-ink')}>{k.v}</p>
          </div>
        ))}
      </div>

      <nav className="flex gap-1.5 overflow-x-auto border-b border-border pb-px">
        {([
          ['animais', `Animais (${animais.length})`],
          ['materias', `Matérias-primas (${materias.length})`],
          ['imagens', `Imagens (${imagens.length})`],
          ['fontes', `Fontes (${fontes.length})`],
        ] as Array<[Aba, string]>).map(([k, n]) => (
          <button
            key={k}
            onClick={() => { setAba(k); setEditando(null) }}
            className={cn('shrink-0 rounded-t-md border-b-2 px-3 py-2 text-[13px] font-medium',
              aba === k ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink')}
          >
            {n}
          </button>
        ))}
      </nav>

      {(aba === 'animais' || aba === 'materias') && (
        <div className="flex flex-wrap gap-2">
          <div className="min-w-[200px] flex-1">
            <Input value={q} onChange={e => setQ(e.target.value)} leftIcon={<Search className="h-4 w-4" />}
              placeholder="Filtrar por nome ou slug…" />
          </div>
          <select
            value={status}
            onChange={e => setStatus(e.target.value as StatusConteudo | '')}
            className="h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-ink"
            aria-label="Filtrar por status"
          >
            <option value="">Todos os status</option>
            {FLUXO.map(s => <option key={s} value={s}>{STATUS[s].nome}</option>)}
          </select>
        </div>
      )}

      {aba === 'animais' && (
        <ul className="space-y-2">
          {filtrar(animais).map(a => (
            <li key={a.slug}>
              {editando === `a:${a.slug}` ? (
                <EditorConteudo item={a} tabela="guia_animais" autorPadrao={autorPadrao}
                  onFechar={() => setEditando(null)} />
              ) : (
                <button
                  onClick={() => setEditando(`a:${a.slug}`)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-border-strong"
                >
                  <span className="text-lg">{a.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{a.nome}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {NOME_ESPECIE[a.especie]} · {a.slug}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Badge className={STATUS[a.status].classe}>{STATUS[a.status].nome}</Badge>
                    {!a.fontes?.length && <Badge className="bg-danger-bg text-danger">sem fonte</Badge>}
                    {a.pendente_validacao && <Badge className="bg-warning-bg text-warning">pendente</Badge>}
                    {!a.imagem_slug && <Badge className="bg-surface-2 text-ink-faint">sem foto</Badge>}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {aba === 'materias' && (
        <ul className="space-y-2">
          {filtrar(materias).map(m => (
            <li key={m.slug}>
              {editando === `m:${m.slug}` ? (
                <EditorConteudo item={m} tabela="guia_materias" autorPadrao={autorPadrao}
                  onFechar={() => setEditando(null)} />
              ) : (
                <button
                  onClick={() => setEditando(`m:${m.slug}`)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-border-strong"
                >
                  <span className="text-lg">{m.emoji}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] font-medium text-ink">{m.nome}</span>
                    <span className="block truncate text-[11px] text-ink-faint">
                      {NOME_CATEGORIA[m.categoria]} · {m.slug}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-wrap justify-end gap-1">
                    <Badge className={STATUS[m.status].classe}>{STATUS[m.status].nome}</Badge>
                    {!m.fontes?.length && <Badge className="bg-danger-bg text-danger">sem fonte</Badge>}
                    {m.pendente_validacao && <Badge className="bg-warning-bg text-warning">pendente</Badge>}
                  </span>
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {aba === 'imagens' && (
        <>
          <p className="text-[12.5px] text-ink-muted">
            Nenhuma imagem nasce verificada: o banco exige arquivo, texto alternativo, autor,
            licença, data e aprovador nomeado. {resumo.imgReprovadas} estão reprovadas e caem no
            fallback até haver foto do acervo Branorte.
          </p>
          <ul className="grid gap-2 sm:grid-cols-2">
            {imagens.map(i => (
              <li key={i.slug} className="sm:col-span-1">
                {editando === `i:${i.slug}` ? (
                  <div className="sm:col-span-2">
                    <EditorImagem img={i} autorPadrao={autorPadrao} onFechar={() => setEditando(null)} />
                  </div>
                ) : (
                  <button
                    onClick={() => setEditando(`i:${i.slug}`)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface p-2 text-left hover:border-border-strong"
                  >
                    {i.arquivo_url && i.status !== 'reprovada' ? (
                      <img src={i.arquivo_url} alt={i.alt} className="h-12 w-16 shrink-0 rounded object-cover" />
                    ) : (
                      <span className="flex h-12 w-16 shrink-0 items-center justify-center rounded bg-surface-2 text-ink-faint">
                        <ImageIcon className="h-4 w-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">{i.slug}</span>
                      <span className="block truncate text-[11px] text-ink-faint">{i.autor ?? 'sem autor'}</span>
                    </span>
                    <span className="flex shrink-0 flex-col items-end gap-1">
                      <Badge className={
                        i.status === 'verificada' ? 'bg-success-bg text-success'
                          : i.status === 'reprovada' ? 'bg-danger-bg text-danger'
                          : 'bg-warning-bg text-warning'}>
                        {i.status}
                      </Badge>
                      {!i.identifica_item && i.status !== 'reprovada' && (
                        <Badge className="bg-surface-2 text-ink-faint">ilustrativa</Badge>
                      )}
                    </span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      {aba === 'fontes' && (
        <>
          <p className="text-[12.5px] text-ink-muted">
            {resumo.fontesSemUrl} fontes ainda sem URL/edição confirmada. Número de linhagem só
            vira número fechado com edição, ano, sexo, idade e condição de teste.
          </p>
          <ul className="space-y-2">
            {fontes.map(f => (
              <li key={f.chave}>
                {editando === `f:${f.chave}` ? (
                  <EditorFonte fonte={f} onFechar={() => setEditando(null)} />
                ) : (
                  <button
                    onClick={() => setEditando(`f:${f.chave}`)}
                    className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2 text-left hover:border-border-strong"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-medium text-ink">{f.titulo}</span>
                      <span className="block truncate text-[11px] text-ink-faint">
                        {f.organizacao ?? '—'} · {f.chave}
                      </span>
                    </span>
                    {f.url
                      ? <Badge className="bg-success-bg text-success"><Check className="h-3 w-3" />com URL</Badge>
                      : <Badge className="bg-warning-bg text-warning">sem URL</Badge>}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

export default GuiaAdmin
