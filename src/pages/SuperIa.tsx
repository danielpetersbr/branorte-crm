import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Brain, Loader2, Save, Power, ShieldAlert, Clock, KeyRound } from 'lucide-react'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

// ============================================================================
// Super IA (piloto) — o prompt do vendedor que RACIOCINA, rodando isolado.
//
// Por que existe: a persona da ia-atendente e hardcoded na edge. Trocar o jeito
// dela atender exigia deploy e pegava os 10 vendedores de uma vez. Aqui o texto
// vive no banco (ia_persona) e so vale pra quem tem ativacao viva.
//
// TRES travas, de proposito redundantes:
//   1. a tabela ia_persona_ativacao tem CHECK que aceita literalmente 'DANIEL';
//   2. a edge falha FECHADO — erro de leitura cai na persona fixa de sempre;
//   3. a ativacao expira em 12h, pra piloto esquecido nao virar producao.
//
// O texto e livre. A edge anexa sozinha o contrato JSON (sem ele a resposta nao
// parseia), e — conforme as flags — a base de conhecimento e a lista de midias.
// ============================================================================

const VENDEDOR_PILOTO = 'DANIEL'
const VERSAO = 'v3'

interface Persona {
  id: number
  versao: string
  descricao: string | null
  conteudo: string
  incluir_kb: boolean
  incluir_midias: boolean
  atualizado_em: string
}

interface Ativacao {
  vendedor_nome: string
  persona_versao: string
  ativo: boolean
  expira_em: string | null
  ativado_em: string | null
  ativado_por: string | null
}

function horasRestantes(expira: string | null): number | null {
  if (!expira) return null
  return (new Date(expira).getTime() - Date.now()) / 36e5
}

function vivo(a: Ativacao | null): boolean {
  if (!a || !a.ativo) return false
  const h = horasRestantes(a.expira_em)
  return h === null || h > 0
}

export function SuperIa() {
  const qc = useQueryClient()
  const [texto, setTexto] = useState('')
  const [incluirKb, setIncluirKb] = useState(true)
  const [incluirMidias, setIncluirMidias] = useState(true)
  const [aviso, setAviso] = useState<string | null>(null)

  const persona = useQuery({
    queryKey: ['super-ia', 'persona'],
    queryFn: async (): Promise<Persona | null> => {
      const { data, error } = await supabase.from('ia_persona')
        .select('id, versao, descricao, conteudo, incluir_kb, incluir_midias, atualizado_em')
        .eq('versao', VERSAO).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const ativacao = useQuery({
    queryKey: ['super-ia', 'ativacao'],
    queryFn: async (): Promise<Ativacao | null> => {
      const { data, error } = await supabase.from('ia_persona_ativacao')
        .select('vendedor_nome, persona_versao, ativo, expira_em, ativado_em, ativado_por')
        .eq('vendedor_nome', VENDEDOR_PILOTO).maybeSingle()
      if (error) throw error
      return data
    },
    refetchInterval: 30_000,
  })

  const codigos = useQuery({
    queryKey: ['super-ia', 'codigos'],
    queryFn: async () => {
      const { data, error } = await supabase.from('ia_config')
        .select('chave, valor').in('chave', ['persona_codigo_ligar', 'persona_codigo_desligar'])
      if (error) throw error
      const m: Record<string, string> = {}
      for (const r of data ?? []) m[r.chave] = (r.valor as any)?.v ?? ''
      return m
    },
  })

  useEffect(() => {
    if (!persona.data) return
    setTexto(persona.data.conteudo)
    setIncluirKb(persona.data.incluir_kb)
    setIncluirMidias(persona.data.incluir_midias)
  }, [persona.data?.id, persona.data?.atualizado_em])

  const salvar = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('ia_persona')
        .update({ conteudo: texto, incluir_kb: incluirKb, incluir_midias: incluirMidias, atualizado_em: new Date().toISOString() })
        .eq('versao', VERSAO)
      if (error) throw error
    },
    onSuccess: () => { setAviso('Salvo. Vale na proxima resposta da IA.'); qc.invalidateQueries({ queryKey: ['super-ia', 'persona'] }) },
    onError: (e: any) => setAviso('Nao salvou: ' + String(e?.message || e)),
  })

  const alternar = useMutation({
    mutationFn: async (ligar: boolean) => {
      const { error } = await supabase.from('ia_persona_ativacao').upsert({
        vendedor_nome: VENDEDOR_PILOTO,
        persona_versao: VERSAO,
        ativo: ligar,
        // mesmo prazo do codigo por WhatsApp: 12h, e nao "pra sempre"
        expira_em: ligar ? new Date(Date.now() + 12 * 36e5).toISOString() : null,
        ativado_em: ligar ? new Date().toISOString() : null,
        ativado_por: ligar ? 'crm' : null,
        desligado_em: ligar ? null : new Date().toISOString(),
        atualizado_em: new Date().toISOString(),
      }, { onConflict: 'vendedor_nome' })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['super-ia', 'ativacao'] }),
    onError: (e: any) => setAviso('Nao mudou: ' + String(e?.message || e)),
  })

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 4000)
    return () => clearTimeout(t)
  }, [aviso])

  if (persona.isLoading) return <PageLoading />

  const a = ativacao.data ?? null
  const ligada = vivo(a)
  const horas = horasRestantes(a?.expira_em ?? null)
  const sujo = !!persona.data && (
    texto !== persona.data.conteudo ||
    incluirKb !== persona.data.incluir_kb ||
    incluirMidias !== persona.data.incluir_midias
  )

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-4">
      <header className="flex items-center gap-2.5">
        <Brain className="w-5 h-5 text-accent" />
        <div>
          <h1 className="text-[18px] font-semibold text-ink">Super IA</h1>
          <p className="text-[12px] text-ink-muted">
            Piloto isolado — vale só no WhatsApp do {VENDEDOR_PILOTO}. Os outros vendedores seguem na IA de sempre.
          </p>
        </div>
      </header>

      {/* ── Estado + liga/desliga ─────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-surface p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <span className={cn('w-2.5 h-2.5 rounded-full', ligada ? 'bg-success' : 'bg-border')} />
            <div>
              <p className="text-[14px] font-medium text-ink">
                {ligada ? 'Ligada — o Daniel está atendendo pela Super IA' : 'Desligada — atendimento pela IA de sempre'}
              </p>
              {ligada && horas !== null && (
                <p className="text-[12px] text-ink-muted flex items-center gap-1 mt-0.5">
                  <Clock className="w-3 h-3" />
                  desliga sozinha em {horas < 1 ? `${Math.round(horas * 60)} min` : `${horas.toFixed(1)} h`}
                  {a?.ativado_por && a.ativado_por !== 'crm' && ` · ligada pelo ${a.ativado_por}`}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => alternar.mutate(!ligada)}
            disabled={alternar.isPending}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-md text-[13px] font-medium disabled:opacity-60',
              ligada ? 'bg-danger text-white hover:opacity-90' : 'bg-accent text-white hover:opacity-90',
            )}
          >
            {alternar.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
            {ligada ? 'Desligar' : 'Ligar'}
          </button>
        </div>

        <div className="mt-3 pt-3 border-t border-border flex items-start gap-2 text-[12px] text-ink-muted">
          <KeyRound className="w-3.5 h-3.5 mt-px shrink-0" />
          <span>
            Também liga por WhatsApp: mande{' '}
            <code className="px-1 py-0.5 rounded bg-surface-2 text-accent">{codigos.data?.persona_codigo_ligar ?? '…'}</code>{' '}
            de outro número pro seu, e{' '}
            <code className="px-1 py-0.5 rounded bg-surface-2 text-accent">{codigos.data?.persona_codigo_desligar ?? '…'}</code>{' '}
            pra desligar. Se as duas palavras vierem juntas, desligar vence.
          </span>
        </div>
      </section>

      {/* ── O prompt ──────────────────────────────────────────────────────── */}
      <section className="rounded-lg border border-border bg-surface">
        <div className="px-4 py-2.5 border-b border-border flex items-center justify-between gap-3">
          <div>
            <h2 className="text-[14px] font-medium text-ink">Como ela pensa</h2>
            <p className="text-[11px] text-ink-muted">
              Escreva do jeito que quiser — não precisa seguir formato. {texto.length.toLocaleString('pt-BR')} caracteres.
            </p>
          </div>
          <button
            onClick={() => salvar.mutate()}
            disabled={!sujo || salvar.isPending}
            className={cn(
              'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-[12px] font-medium shrink-0',
              sujo ? 'bg-accent text-white hover:opacity-90' : 'bg-surface-2 text-ink-faint cursor-default',
            )}
          >
            {salvar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
            Salvar
          </button>
        </div>

        <textarea
          value={texto}
          onChange={e => setTexto(e.target.value)}
          spellCheck={false}
          className="w-full h-[55vh] p-4 bg-transparent text-ink text-[13px] leading-relaxed font-mono resize-y outline-none"
          placeholder="O que ela precisa entender pra atender bem…"
        />

        <div className="px-4 py-3 border-t border-border flex flex-wrap gap-4">
          {([
            ['incluir_kb', incluirKb, setIncluirKb, 'Anexar a base de conhecimento', 'os blocos do /ia-atendente entram no fim do prompt'],
            ['incluir_midias', incluirMidias, setIncluirMidias, 'Deixar mandar mídia', 'fotos e vídeos que ela pode anexar'],
          ] as const).map(([k, val, set, label, hint]) => (
            <label key={k} className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={val} onChange={e => set(e.target.checked)} className="mt-0.5 accent-accent" />
              <span>
                <span className="block text-[12px] text-ink">{label}</span>
                <span className="block text-[11px] text-ink-muted">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </section>

      <p className="flex items-start gap-2 text-[11px] text-ink-muted">
        <ShieldAlert className="w-3.5 h-3.5 mt-px shrink-0" />
        O contrato de saída (etiqueta, passar o bastão, qual mídia) a edge anexa sozinha — não precisa
        escrever aqui, e apagar não desliga.
      </p>

      {aviso && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[1100] px-4 py-2.5 rounded-lg shadow-lg text-[13px] font-medium border bg-surface/95 backdrop-blur border-accent/30 text-ink">
          {aviso}
        </div>
      )}
    </div>
  )
}
