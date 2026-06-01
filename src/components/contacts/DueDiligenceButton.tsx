// Componentes de Due Diligence — formulario reutilizavel + wrappers.
//
// DueDiligenceForm   forma "miolo" sem chrome (usado pela pagina /consulta)
// DueDiligenceModal  wrapper modal (usado quando aparece em outro lugar)
// DueDiligenceButton botao que abre o modal (legado, mantido pra reuso)
import { useState, type ReactNode } from 'react'
import { Search, X, AlertCircle, CheckCircle, Loader2, Sparkles, ChevronDown, ChevronUp, Printer } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  useConsultarDueDiligence,
  useDDHistorico,
  type DDConsulta,
  type Pacote,
} from '@/hooks/useDueDiligence'
import { useCan } from '@/hooks/usePermissions'
import { DossieDetetiveCard, type DossieDetetive } from './DossieDetetiveCard'

// Custos calculados a partir da tabela FCDL/SC jan/2026 com codigos API
// CORRIGIDOS (descobertos em 29/05/2026 — codigos REST sao diferentes
// dos codigos da tabela de precos). Refletem EXATAMENTE o pacote enviado
// em api/dd-consultar.ts → montarPacotes():
//   PJ Economico: 325 (5,62) + Score12m#78 (1,13) + Part#24 (2,72)
//                + AcaoJudicial#18 (4,59) + Receita#5183 (0,33) = R$ 14,39
//   PF Economico: 325 (5,62) + Score12m#78 (1,13) + Part#24 (2,72)
//                + AcaoJudicial#18 (4,59) + Renda#5097 (1,46) = R$ 15,52
const CUSTO_PJ_ECONOMICO = 5.62 + 1.13 + 2.72 + 4.59 + 0.33     // 14.39
const CUSTO_PF_ECONOMICO = 5.62 + 1.13 + 2.72 + 4.59 + 1.46     // 15.52
const CUSTO_PJ_COMPLETO = CUSTO_PJ_ECONOMICO + 17.09 + 16.21 + 6.49 + 16.21 + 1.96 + 4.91
const CUSTO_PF_COMPLETO = CUSTO_PF_ECONOMICO + 13.56 + 1.72 + 0.78

const PACOTE_INFO: Record<Pacote, { titulo: string; descricao: string; custoPj: number; custoPf: number }> = {
  economico: {
    titulo: 'Econômico',
    descricao: 'SPC Maxi + Score 12m + Participações em Empresas + Ações Judiciais + Receita Federal',
    custoPj: CUSTO_PJ_ECONOMICO,
    custoPf: CUSTO_PF_ECONOMICO,
  },
  completo: {
    titulo: 'Completo',
    descricao: 'Econômico + Faturamento Presumido + Quadro Social + Grupo Econômico + Risco Crédito + Limite + Score PJ',
    custoPj: CUSTO_PJ_COMPLETO,
    custoPf: CUSTO_PF_COMPLETO,
  },
  paranoico: {
    titulo: 'Paranoico',
    descricao: 'Completo + Datajud + Google + Instagram + Parecer IA (fases 3-4)',
    custoPj: CUSTO_PJ_COMPLETO + 0.04, // Datajud grátis; placeholder pra Serper+Claude (~R$ 0,04)
    custoPf: CUSTO_PF_COMPLETO + 0.04,
  },
  custom: { titulo: 'Custom', descricao: 'Não disponível ainda', custoPj: 0, custoPf: 0 },
}

export function formatDoc(value: string, type: 'cnpj' | 'cpf'): string {
  const d = value.replace(/\D/g, '')
  if (type === 'cnpj') {
    return d
      .slice(0, 14)
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
  }
  return d
    .slice(0, 11)
    .replace(/^(\d{3})(\d)/, '$1.$2')
    .replace(/^(\d{3})\.(\d{3})(\d)/, '$1.$2.$3')
    .replace(/\.(\d{3})(\d)/, '.$1-$2')
}

interface FormProps {
  contactId?: string | null
  contactName?: string | null
  /** CNPJ inicial pre-preenchido (vem da ficha do contato) */
  initialCnpj?: string
}

/** Formulario "miolo" — usado pela pagina /consulta. */
type TipoConsulta = 'pj' | 'pf' | 'ambos'

export function DueDiligenceForm({ contactId, contactName, initialCnpj }: FormProps) {
  const [tipoConsulta, setTipoConsulta] = useState<TipoConsulta>('pj')
  const [cnpj, setCnpj] = useState(initialCnpj ?? '')
  const [cpf, setCpf] = useState('')
  const [pacote, setPacote] = useState<Pacote>('economico')
  const consultar = useConsultarDueDiligence()
  const { data: historico = [] } = useDDHistorico(contactId ?? null)

  const cnpjLimpo = cnpj.replace(/\D/g, '')
  const cnpjValido = cnpjLimpo.length === 14
  const cpfLimpo = cpf.replace(/\D/g, '')
  const cpfValido = cpfLimpo.length === 11

  const precisaCnpj = tipoConsulta === 'pj' || tipoConsulta === 'ambos'
  const precisaCpf = tipoConsulta === 'pf' || tipoConsulta === 'ambos'

  const podeEnviar =
    (!precisaCnpj || cnpjValido) &&
    (!precisaCpf || cpfValido) &&
    !consultar.isPending

  // Custo: soma só do que vai ser consultado
  const info = PACOTE_INFO[pacote]
  const custoEstimado =
    (precisaCnpj ? info.custoPj : 0) + (precisaCpf ? info.custoPf : 0)

  function handleSubmit(forceRefresh = false) {
    if (!podeEnviar) return
    consultar.mutate({
      contact_id: contactId ?? null,
      tipo_consulta: tipoConsulta,
      cnpj: precisaCnpj ? cnpjLimpo : null,
      cpf_socio: precisaCpf ? cpfLimpo : null,
      pacote,
      force_refresh: forceRefresh,
    })
  }

  return (
    <div className="space-y-3">
      {contactName && (
        <p className="text-[11px] text-ink-muted">
          Vinculado ao contato: <span className="text-ink font-semibold">{contactName}</span>
        </p>
      )}

      {/* Form INLINE compacto — uma linha em desktop, empilha em mobile */}
      <div className="border border-border rounded-lg bg-surface-2/30 p-3">
        <div className="grid grid-cols-1 md:grid-cols-[auto_1fr_auto_auto] gap-3 items-end">
          {/* Toggle tipo de consulta (PJ/PF) */}
          <div className="min-w-0">
            <label className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider block mb-1">
              Tipo
            </label>
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              {([
                { v: 'pj', label: 'CNPJ' },
                { v: 'pf', label: 'CPF' },
              ] as Array<{ v: TipoConsulta; label: string }>).map(opt => {
                const ativo = tipoConsulta === opt.v
                return (
                  <button
                    key={opt.v}
                    type="button"
                    onClick={() => setTipoConsulta(opt.v)}
                    className={`text-[11px] px-3 py-2 font-semibold transition-all ${
                      ativo
                        ? 'bg-accent text-white'
                        : 'bg-surface-2 text-ink-muted hover:text-ink'
                    }`}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Documento input */}
          <div className="min-w-0">
            <label className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider block mb-1">
              {precisaCnpj ? 'CNPJ da empresa' : 'CPF da pessoa'}
            </label>
            {precisaCnpj ? (
              <Input
                value={cnpj}
                onChange={e => setCnpj(formatDoc(e.target.value, 'cnpj'))}
                placeholder="00.000.000/0000-00"
                className="font-mono tabular-nums"
              />
            ) : (
              <Input
                value={cpf}
                onChange={e => setCpf(formatDoc(e.target.value, 'cpf'))}
                placeholder="000.000.000-00"
                className="font-mono tabular-nums"
              />
            )}
            {precisaCnpj && cnpj && !cnpjValido && (
              <p className="text-[10px] text-danger mt-1">CNPJ deve ter 14 dígitos</p>
            )}
            {precisaCpf && cpf && !cpfValido && (
              <p className="text-[10px] text-danger mt-1">CPF deve ter 11 dígitos</p>
            )}
          </div>

          {/* Pacote select */}
          <div className="min-w-0">
            <label className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider block mb-1">
              Pacote
            </label>
            <select
              value={pacote}
              onChange={e => setPacote(e.target.value as Pacote)}
              className="text-[12px] px-3 py-2 rounded-md border border-border bg-surface-2 text-ink font-semibold focus:outline-none focus:border-accent"
              title={PACOTE_INFO[pacote].descricao}
            >
              <option value="economico">Econômico · R$ {custoEstimado.toFixed(2)}</option>
            </select>
          </div>

          {/* Botão consultar */}
          <div className="min-w-0">
            <label className="text-[10px] font-semibold text-ink-faint uppercase tracking-wider block mb-1 md:invisible">
              Ação
            </label>
            <Button
              variant="primary"
              onClick={() => handleSubmit(false)}
              disabled={!podeEnviar}
              className="whitespace-nowrap"
            >
              {consultar.isPending ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando...</>
              ) : (
                <><Search className="h-3.5 w-3.5" /> Consultar — R$ {custoEstimado.toFixed(2)}</>
              )}
            </Button>
          </div>
        </div>

        {/* Hint LGPD/cache inline */}
        <p className="text-[10px] text-ink-faint mt-2">
          {PACOTE_INFO[pacote].descricao} · Mesmo documento em ≤30d retorna do cache sem custo.
        </p>
      </div>
      {/* Fim do form */}

      {/* Resultado da consulta atual (se houver) — FULL WIDTH */}
      {consultar.data && (
        <ResultadoBox
          consulta={consultar.data.consulta}
          cacheHit={consultar.data._cache_hit}
          onReconsultar={() => handleSubmit(true)}
          podeReconsultar={podeEnviar}
        />
      )}
      {consultar.error && (
        <div className="bg-danger/15 border border-danger/40 rounded-md px-3 py-2 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
          <div>
            <p className="text-[12px] font-semibold text-danger">Falha na consulta</p>
            <p className="text-[11px] text-ink-muted">{(consultar.error as Error).message}</p>
          </div>
        </div>
      )}

      {/* Historico */}
      {contactId && historico.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-ink-muted hover:text-ink">
            Histórico ({historico.length} consultas anteriores)
          </summary>
          <div className="mt-2 space-y-1">
            {historico.map(h => (
              <div
                key={h.id}
                className="flex items-center justify-between px-2 py-1 rounded bg-surface-2/40 border border-border/50"
              >
                <span className="font-mono text-ink-muted tabular-nums">
                  {new Date(h.created_at).toLocaleDateString('pt-BR')} · {h.cnpj}
                </span>
                <span className={`text-[10px] font-semibold tabular-nums ${
                  h.status === 'success' ? 'text-success' :
                  h.status === 'partial' ? 'text-warning' :
                  h.status === 'failed' ? 'text-danger' : 'text-ink-faint'
                }`}>
                  {h.status} · R$ {h.custo_brl.toFixed(2)}
                </span>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

// ============================================================================
// Wrappers — Modal e Botao (legado, ainda usavel se quiser embutir em outras telas)
// ============================================================================

interface ButtonProps {
  contactId: string
  contactName?: string | null
}

export function DueDiligenceModal({
  contactId,
  contactName,
  onClose,
}: ButtonProps & { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-start md:items-center justify-center p-4 overflow-y-auto">
      <div className="bg-bg border border-border rounded-lg max-w-2xl w-full shadow-2xl flex flex-col max-h-[90vh] my-4">
        <div className="px-5 py-3 border-b border-border flex items-center justify-between">
          <h2 className="text-[15px] font-bold text-ink flex items-center gap-2">
            <Search className="h-4 w-4 text-accent" />
            Due Diligence {contactName ? `· ${contactName}` : ''}
          </h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          <DueDiligenceForm contactId={contactId} contactName={contactName} />
        </div>
      </div>
    </div>
  )
}

export function DueDiligenceButton({ contactId, contactName }: ButtonProps) {
  const can = useCan()
  const [open, setOpen] = useState(false)
  if (!can('due_diligence.consultar')) return null

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        className="w-full"
        title="Consultar SPC, processos e perfil deste cliente"
      >
        <Search className="h-4 w-4" /> Due Diligence
      </Button>
      {open && (
        <DueDiligenceModal
          contactId={contactId}
          contactName={contactName}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

// ============================================================================
// Render do resultado da consulta — visual humano, nao JSON
// ============================================================================
interface Resumo {
  consumidor: {
    tipo: 'F' | 'J'
    documento: string
    nome: string | null
    razao_social?: string | null
    nome_fantasia?: string | null
    situacao?: string | null
    data_fundacao?: string | null
    data_nascimento?: string | null
    natureza_juridica?: string | null
    endereco?: string | null
    telefones?: string[]
    email?: string | null
  }
  score: { valor: number | null; classificacao: string | null; mensagem?: string | null }
  inadimplencias: {
    qtd: number
    valor_total: number
    detalhes: Array<{ origem: string; valor: number; data: string | null }>
  }
  protestos: { qtd: number; valor_total: number }
  socios?: Array<{ nome: string; participacao?: string | null; documento?: string | null }>
  administradores?: Array<{ nome: string; cargo?: string | null }>
  participacoes_em_empresas?: Array<{ nome: string; cnpj?: string | null; tipo?: string | null }>
  acoes_judiciais?: {
    qtd: number
    valor_total: number
    detalhes?: Array<{
      tipo?: string | null
      valor?: number | null
      data?: string | null
      comarca?: string | null
      uf?: string | null
    }>
  }
  faturamento_presumido?: { valor: number; periodicidade?: 'mensal' | 'anual' | null } | null
  alertas?: string[]
}

interface ResumoEnvelope {
  produto?: string
  documento?: string | null
  ok?: boolean
  resumo: Resumo
}

function ResultadoBox({
  consulta, cacheHit, onReconsultar, podeReconsultar,
}: {
  consulta: DDConsulta
  cacheHit: boolean
  onReconsultar: () => void
  podeReconsultar: boolean
}) {
  const isSuccess = consulta.status === 'success'
  const isMock = !!(consulta.resultado_spc as { _mock?: boolean } | null)?._mock
  const resumos = ((consulta.resultado_spc as { resumos?: ResumoEnvelope[] } | null)?.resumos ?? [])
  const semDadosEstruturados = isSuccess && resumos.length === 0
  const primeiroResumo = resumos[0]?.resumo
  const datajud = consulta.resultado_datajud as DatajudPayload | null
  const analise = primeiroResumo ? analisar(primeiroResumo) : null

  return (
    // ÚNICA borda externa do bloco de resultado
    // id="dd-print-area" + classe "dd-printable" usados pelo CSS @media print
    // pra esconder todo o resto da página e imprimir só este bloco em A4.
    <div id="dd-print-area" className="dd-printable border border-border rounded-lg bg-surface-2/20 overflow-hidden">
      {/* Status bar topo (sem borda dupla — só uma divisória interna) */}
      <div className={`flex items-center gap-2 px-4 py-2 border-b border-border/40 ${
        isSuccess ? 'bg-success/15' : 'bg-warning/15'
      }`}>
        {isSuccess ? (
          <CheckCircle className="h-4 w-4 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 text-warning" />
        )}
        <span className="text-[13px] font-bold text-ink">
          {cacheHit ? 'Cache (30d)' : 'Consulta concluída'}
        </span>
        {isMock && (
          <span className="text-[9px] font-mono uppercase text-warning bg-warning/20 px-1.5 py-0.5 rounded">
            mock
          </span>
        )}
        <span className="ml-auto text-[11px] font-mono font-semibold text-ink tabular-nums">
          R$ {consulta.custo_brl.toFixed(2)}
        </span>
        {/* Botão IMPRIMIR — disparra window.print(). CSS @media print isola o bloco. */}
        <button
          onClick={() => window.print()}
          className="dd-no-print text-[10px] font-semibold text-ink-muted hover:text-accent flex items-center gap-1 px-2 py-1 rounded border border-border bg-surface-2 hover:border-accent"
          title="Imprimir consulta em folha A4"
        >
          <Printer className="h-3 w-3" /> Imprimir
        </button>
        {(cacheHit || semDadosEstruturados) && (
          <button
            onClick={onReconsultar}
            disabled={!podeReconsultar}
            className="dd-no-print text-[10px] font-semibold text-accent hover:underline disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            title="Faz uma nova consulta ignorando o cache (cobra de novo)"
          >
            <Loader2 className="h-3 w-3" /> Reconsultar
          </button>
        )}
      </div>

      {semDadosEstruturados && (
        <div className="px-3 py-2 bg-warning/15 border-b border-border/40 text-[11px] text-ink-muted flex items-start gap-2">
          <AlertCircle className="h-3.5 w-3.5 text-warning shrink-0 mt-0.5" />
          <span>
            Esta consulta foi feita antes da última atualização do sistema e está no
            formato antigo. Clique em <strong>Reconsultar</strong> pra obter o resultado
            renderizado.
          </span>
        </div>
      )}
      {consulta.erro && (
        <p className="text-[11px] text-warning px-3 py-2">{consulta.erro}</p>
      )}

      {/* Parecer IA — STICKY no topo, FULL WIDTH, com score gigante */}
      {(consulta.parecer_ia || analise) && (
        <ParecerIaBox
          parecer={consulta.parecer_ia ?? ''}
          score={primeiroResumo?.score ?? null}
          veredito={analise?.veredito ?? null}
        />
      )}

      {/* Dossiê do Detetive Branorte — score 0-100, semáforo, red flags */}
      {(() => {
        const dossie =
          (consulta.resultado_spc as { dossie_detetive?: DossieDetetive } | null)?.dossie_detetive
        if (!dossie) return null
        return (
          <div className="p-3 border-b border-border/40">
            <DossieDetetiveCard dossie={dossie} />
          </div>
        )
      })()}

      {/* Grid 4 colunas: Empresa | Sócios | Inadimplências/Score | Datajud */}
      {primeiroResumo ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3 p-3">
          {/* Coluna 1: Dados cadastrais da empresa */}
          <ColunaEmpresa resumo={primeiroResumo} produto={resumos[0]?.produto} analise={analise!} />

          {/* Coluna 2: Sócios + Participações */}
          <ColunaSocios resumo={primeiroResumo} />

          {/* Coluna 3: Score + Inadimplências + Protestos */}
          <ColunaRisco resumo={primeiroResumo} analise={analise!} />

          {/* Coluna 4: Datajud */}
          {datajud ? (
            <ColunaDatajud datajud={datajud} />
          ) : (
            <SubCard titulo="Processos judiciais">
              <p className="text-[11px] text-ink-faint">Datajud não consultado.</p>
            </SubCard>
          )}
        </div>
      ) : (
        <p className="text-[11px] text-ink-muted p-3">
          Sem dados estruturados — veja o JSON bruto abaixo.
        </p>
      )}

      <details className="dd-no-print border-t border-border/30">
        <summary className="text-[10px] text-ink-faint cursor-pointer hover:text-ink px-3 py-1.5">
          Ver JSON bruto (debug)
        </summary>
        <pre className="text-[9px] font-mono bg-surface-2/60 mx-3 mb-2 p-2 rounded overflow-x-auto max-h-60">
          {JSON.stringify({ spc: consulta.resultado_spc, datajud: consulta.resultado_datajud }, null, 2)}
        </pre>
      </details>

      {/* Rodapé de impressão A4 — só visível ao imprimir */}
      <div className="dd-print-only" aria-hidden="true">
        <hr />
        <div style={{ marginTop: 8, fontSize: 9, color: '#666' }}>
          <strong>METALÚRGICA BRANORTE</strong> · Consulta de Due Diligence ·
          Gerado em {new Date(consulta.created_at).toLocaleString('pt-BR')} ·
          Custo: R$ {consulta.custo_brl.toFixed(2)} ·
          Status: {consulta.status.toUpperCase()}
          <br />
          Fontes: SPC Brasil {isMock ? '(MOCK)' : '(produção)'} ·
          Datajud (CNJ) · Parecer consolidado por IA ·
          Uso restrito conforme LGPD (interesse legítimo — análise de crédito)
        </div>
      </div>
    </div>
  )
}

// ============================================================================
// Sub-cards do grid 4 colunas — sem border externa, só hairline divisória
// ============================================================================
function SubCard({ titulo, badge, children }: { titulo: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="bg-surface-2/40 rounded-md overflow-hidden flex flex-col">
      <div className="px-3 py-2 border-b border-border/30 bg-surface-2/30 flex items-center gap-2">
        <h3 className="text-[10px] uppercase tracking-wider text-ink-faint font-bold flex-1 min-w-0 truncate">
          {titulo}
        </h3>
        {badge}
      </div>
      <div className="px-3 py-2.5 flex-1 min-w-0">
        {children}
      </div>
    </section>
  )
}

function ColunaEmpresa({ resumo, produto, analise }: { resumo: Resumo; produto?: string; analise: Analise }) {
  const c = resumo.consumidor
  return (
    <SubCard
      titulo={c.tipo === 'J' ? 'Empresa' : 'Pessoa Física'}
      badge={produto ? <span className="text-[9px] font-mono text-ink-faint">SPC #{produto}</span> : null}
    >
      <h3 className="text-[13px] font-bold text-ink leading-tight mb-1">
        {c.nome ?? '(sem nome no SPC)'}
      </h3>
      <p className="text-[10px] font-mono text-ink-muted tabular-nums mb-2">
        {c.tipo === 'J' ? 'CNPJ' : 'CPF'}: {c.documento}
      </p>
      {c.situacao && (
        <p className="mb-2">
          <span className={`px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
            /ATIV|REGUL/i.test(c.situacao)
              ? 'bg-success/20 text-success'
              : 'bg-warning/20 text-warning'
          }`}>
            {c.situacao}
          </span>
        </p>
      )}

      <div className="space-y-1 text-[11px] border-t border-border/30 pt-2 mt-2">
        {c.razao_social && c.razao_social !== c.nome && (
          <Linha label="Razão" valor={c.razao_social} />
        )}
        {c.natureza_juridica && <Linha label="Natureza" valor={c.natureza_juridica} />}
        {c.data_fundacao && <Linha label="Fundação" valor={c.data_fundacao} />}
        {c.data_nascimento && <Linha label="Nasc." valor={c.data_nascimento} />}
        {c.endereco && <Linha label="Endereço" valor={c.endereco} />}
        {c.telefones && c.telefones.length > 0 && (
          <Linha label="Telefones" valor={c.telefones.join(' · ')} />
        )}
        {c.email && <Linha label="Email" valor={c.email} />}
      </div>

      {/* Limite + condição (recomendação operacional) */}
      <div className="border-t border-border/30 pt-2 mt-2 space-y-1.5">
        <div>
          <p className="text-[9px] uppercase tracking-wider text-ink-faint">Limite sugerido</p>
          <p className="text-[14px] font-bold font-mono tabular-nums text-ink">
            {analise.limiteCreditoSugerido != null
              ? analise.limiteCreditoSugerido > 0
                ? fmtBRL(analise.limiteCreditoSugerido)
                : 'Não conceder'
              : '—'}
          </p>
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-ink-faint">Condição de pagamento</p>
          <p className="text-[11px] text-ink leading-tight">
            {analise.condicaoPagamentoSugerida}
          </p>
        </div>
      </div>
    </SubCard>
  )
}

function ColunaSocios({ resumo }: { resumo: Resumo }) {
  const socios = resumo.socios ?? []
  const participacoes = resumo.participacoes_em_empresas ?? []
  const totalBadge = (socios.length + participacoes.length) > 0
    ? <span className="text-[9px] font-mono text-ink-faint tabular-nums">{socios.length + participacoes.length}</span>
    : null
  return (
    <SubCard titulo="Sócios & participações" badge={totalBadge}>
      {socios.length === 0 && participacoes.length === 0 && (
        <p className="text-[11px] text-ink-faint">Sem informações de quadro societário.</p>
      )}

      {socios.length > 0 && (
        <div>
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-1">
            Sócios ({socios.length})
          </p>
          <ul className="space-y-0.5">
            {socios.map((s, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="text-ink truncate flex-1 min-w-0">{s.nome}</span>
                <span className="text-ink-muted font-mono text-[10px] shrink-0 tabular-nums">
                  {s.participacao ?? ''} {s.documento ? `· ${s.documento}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {participacoes.length > 0 && (
        <div className={socios.length > 0 ? 'border-t border-border/30 pt-2 mt-2' : ''}>
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-1">
            Participações ({participacoes.length})
          </p>
          <ul className="space-y-0.5">
            {participacoes.map((p, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="text-ink truncate flex-1 min-w-0">{p.nome}</span>
                <span className="text-ink-muted font-mono text-[10px] shrink-0 tabular-nums">
                  {p.tipo ?? ''} {p.cnpj ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </SubCard>
  )
}

function ColunaRisco({ resumo, analise }: { resumo: Resumo; analise: Analise }) {
  const r = resumo
  const temInad = r.inadimplencias.qtd > 0
  const temProtesto = r.protestos.qtd > 0
  return (
    <SubCard titulo="Score & risco">
      <div className="grid grid-cols-2 gap-2 mb-2">
        <ScoreGauge valor={r.score.valor} classificacao={r.score.classificacao} />
        <Stat
          label={r.consumidor.tipo === 'J' ? 'Tempo' : 'Idade'}
          value={analise.tempoEmpresaAnos != null ? `${analise.tempoEmpresaAnos}` : '—'}
          sub={analise.tempoEmpresaAnos != null ? 'anos' : null}
          tone={
            analise.tempoEmpresaAnos == null
              ? 'neutral'
              : analise.tempoEmpresaAnos >= 5
              ? 'good'
              : analise.tempoEmpresaAnos >= 2
              ? 'warn'
              : 'bad'
          }
        />
      </div>

      <div className="grid grid-cols-2 gap-2 border-t border-border/30 pt-2 mb-2">
        <Stat
          label="Inadimplências"
          value={r.inadimplencias.qtd > 0 ? `${r.inadimplencias.qtd}` : 'Nenhuma'}
          sub={r.inadimplencias.qtd > 0 ? fmtBRL(r.inadimplencias.valor_total) : null}
          tone={temInad ? 'bad' : 'good'}
        />
        <Stat
          label="Protestos"
          value={r.protestos.qtd > 0 ? `${r.protestos.qtd}` : 'Nenhum'}
          sub={r.protestos.qtd > 0 ? fmtBRL(r.protestos.valor_total) : null}
          tone={temProtesto ? 'bad' : 'good'}
        />
      </div>

      {/* Detalhe de inadimplências */}
      {r.inadimplencias.detalhes.length > 0 && (
        <div className="border-t border-border/30 pt-2">
          <p className="text-[10px] uppercase tracking-wider text-danger font-semibold mb-1">
            Inadimplências detectadas
          </p>
          <ul className="space-y-0.5">
            {r.inadimplencias.detalhes.map((d, i) => (
              <li key={i} className="flex items-start justify-between gap-2 text-[11px]">
                <span className="text-ink truncate flex-1 min-w-0">{d.origem}</span>
                <span className="text-danger font-mono text-[10px] shrink-0 tabular-nums">
                  {fmtBRL(d.valor)} {d.data ? `· ${d.data}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Mensagem interpretativa do score (vinda do SPC) */}
      {r.score.mensagem && (
        <div className="border-t border-border/30 pt-2 mt-2">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-0.5">
            Interpretação do Score (SPC)
          </p>
          <p className="text-[11px] text-ink-muted italic leading-tight">"{r.score.mensagem}"</p>
        </div>
      )}

      {/* Ações Judiciais (SPC) */}
      {r.acoes_judiciais && (
        <div className="border-t border-border/30 pt-2 mt-2">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint font-bold mb-1">
            AÇÕES JUDICIAIS (SPC)
          </div>
          {r.acoes_judiciais.qtd === 0 ? (
            <div className="text-success text-[11px]">Nenhuma ação registrada</div>
          ) : (
            <>
              <div className="text-danger font-semibold text-[12px] tabular-nums">
                {r.acoes_judiciais.qtd} ação(ões) · {fmtBRL(r.acoes_judiciais.valor_total)}
              </div>
              {r.acoes_judiciais.detalhes?.slice(0, 5).map((d, i) => (
                <div key={i} className="text-[10px] text-ink-muted mt-1 leading-tight">
                  • {d.tipo || 'Ação Judicial'}
                  {d.valor != null ? ` · ${fmtBRL(d.valor)}` : ''}
                  {d.data ? ` · ${d.data}` : ''}
                  {d.comarca ? ` · ${d.comarca}${d.uf ? '/' + d.uf : ''}` : ''}
                </div>
              ))}
            </>
          )}
        </div>
      )}

      {/* Faturamento presumido */}
      {r.faturamento_presumido && r.faturamento_presumido.valor > 0 && (
        <div className="border-t border-border/30 pt-2 mt-2">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-0.5">
            Faturamento Presumido (SPC)
          </p>
          <p className="text-[14px] font-mono font-bold text-accent tabular-nums">
            {fmtBRL(r.faturamento_presumido.valor)}
            <span className="text-[10px] text-ink-faint font-normal ml-1">
              / {r.faturamento_presumido.periodicidade ?? 'período'}
            </span>
          </p>
          <p className="text-[9px] text-ink-faint leading-tight">
            Estimativa estatística baseada em CNAE, capital, tempo de mercado.
          </p>
        </div>
      )}

      {/* Sinais positivos/alerta condensados */}
      {(analise.sinaisPositivos.length > 0 || analise.sinaisAlerta.length > 0) && (
        <div className="border-t border-border/30 pt-2 mt-2 space-y-1.5">
          {analise.sinaisPositivos.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-success font-bold mb-0.5">
                ✓ Positivos
              </p>
              <ul className="space-y-0.5">
                {analise.sinaisPositivos.map((s, i) => (
                  <li key={i} className="text-[11px] text-ink leading-tight">• {s}</li>
                ))}
              </ul>
            </div>
          )}
          {analise.sinaisAlerta.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wider text-danger font-bold mb-0.5">
                ⚠ Alertas
              </p>
              <ul className="space-y-0.5">
                {analise.sinaisAlerta.map((s, i) => (
                  <li key={i} className="text-[11px] text-ink leading-tight">• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </SubCard>
  )
}

function ColunaDatajud({ datajud }: { datajud: DatajudPayload }) {
  const tem = datajud.processos.length > 0
  const total = datajud.totalEncontrado
  const badge = (
    <span className={`text-[9px] font-mono uppercase ${tem ? 'text-warning' : 'text-success'} tabular-nums`}>
      Datajud · CNJ
    </span>
  )
  return (
    <SubCard titulo="Processos judiciais" badge={badge}>
      <div className="flex items-center gap-2 mb-2">
        {tem ? (
          <AlertCircle className="h-4 w-4 text-warning shrink-0" />
        ) : (
          <CheckCircle className="h-4 w-4 text-success shrink-0" />
        )}
        <span className="text-[12px] font-semibold text-ink tabular-nums">
          {tem
            ? `${total} processo${total === 1 ? '' : 's'}`
            : 'Nenhum processo encontrado'}
        </span>
      </div>

      {tem && (
        <div className="space-y-1.5">
          {datajud.processos.slice(0, 8).map((p, i) => (
            <div
              key={i}
              className="border-b border-border/30 pb-1.5 last:border-b-0 last:pb-0"
            >
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[11px] font-mono text-ink tabular-nums">{p.numeroProcesso}</span>
                <span className="text-[9px] font-mono text-ink-faint">
                  {p.tribunal} · {p.grau}
                </span>
              </div>
              <p className="text-[11px] text-ink-muted leading-tight">
                <span className="font-semibold">{p.classe}</span>
                {p.assunto && p.assunto !== '—' && ` · ${p.assunto}`}
              </p>
              <div className="flex items-center justify-between mt-0.5 text-[9px] text-ink-faint">
                <span className="truncate">{p.orgaoJulgador}</span>
                <span className="shrink-0 ml-1 tabular-nums">
                  {p.dataAjuizamento && `Ajuiz. ${p.dataAjuizamento}`}
                </span>
              </div>
            </div>
          ))}
          {datajud.processos.length > 8 && (
            <p className="text-[10px] text-ink-faint text-center pt-1 tabular-nums">
              + {datajud.processos.length - 8} processo(s) — total {total}
            </p>
          )}
        </div>
      )}

      <details className="mt-2 text-[10px]">
        <summary className="cursor-pointer text-ink-faint hover:text-ink">
          Por tribunal ({datajud.resumoTribunais.length})
        </summary>
        <ul className="mt-1 space-y-0.5">
          {datajud.resumoTribunais.map((t, i) => (
            <li key={i} className="flex items-center justify-between">
              <span className="text-ink-muted">{t.tribunal}</span>
              <span className={`font-mono tabular-nums ${
                t.erro ? 'text-danger' : t.total > 0 ? 'text-warning' : 'text-ink-faint'
              }`}>
                {t.erro ? `erro: ${t.erro.slice(0, 30)}` : `${t.total} processo(s)`}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </SubCard>
  )
}

// ============================================================================
// Parecer IA — sticky no topo, hero com score gigante
// ============================================================================
function ParecerIaBox({
  parecer,
  score,
  veredito: vereditoExterno,
}: {
  parecer: string
  score: { valor: number | null; classificacao: string | null } | null
  veredito: 'verde' | 'amarelo' | 'vermelho' | null
}) {
  const [expandido, setExpandido] = useState(false)

  // Detectar veredito no texto pra colorir o card (fallback do veredito analítico)
  const verdeMatch = /PODE VENDER/i.test(parecer)
  const vermelhoMatch = /N[ÃA]O RECOMENDADO/i.test(parecer)
  const vereditoTexto = vermelhoMatch ? 'vermelho' : verdeMatch ? 'verde' : 'amarelo'
  const verdict = vereditoExterno ?? vereditoTexto

  const verdictConfig = {
    verde: {
      bg: 'bg-success/15',
      text: 'text-success',
      label: 'PODE VENDER',
      sticky: 'bg-success/15',
    },
    amarelo: {
      bg: 'bg-warning/15',
      text: 'text-warning',
      label: 'ATENÇÃO',
      sticky: 'bg-warning/15',
    },
    vermelho: {
      bg: 'bg-danger/15',
      text: 'text-danger',
      label: 'NÃO RECOMENDADO',
      sticky: 'bg-danger/15',
    },
  }[verdict]

  // Preview de ~2 linhas (primeiros 200 chars do markdown sem ##)
  const previewTexto = parecer
    .replace(/##\s+/g, '')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .split('\n')
    .filter(l => l.trim())
    .slice(0, 2)
    .join(' ')
    .slice(0, 220)

  const temScore = score?.valor != null
  const valorScoreGigante = temScore ? `${score!.valor}` : verdictConfig.label

  return (
    <div
      className={`sticky top-[57px] z-10 backdrop-blur ${verdictConfig.sticky} border-b border-border/40`}
    >
      <div className="px-4 py-3">
        {/* Hero: score gigante à esquerda, parecer à direita */}
        <div className="flex flex-col md:flex-row items-start gap-4">
          {/* Score gigante / Veredito */}
          <div className="shrink-0 flex flex-col items-center md:items-start">
            <div className={`text-5xl md:text-7xl font-bold tabular-nums leading-none ${verdictConfig.text}`}>
              {valorScoreGigante}
            </div>
            {temScore && (
              <div className="text-[10px] uppercase tracking-wider text-ink-faint mt-1">
                Score / 1000
                {score?.classificacao && <span className="ml-1">· {score.classificacao}</span>}
              </div>
            )}
            <div className={`mt-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${verdictConfig.bg} ${verdictConfig.text}`}>
              <Sparkles className="h-3 w-3" />
              {verdictConfig.label}
            </div>
          </div>

          {/* Parecer texto + collapse */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Sparkles className="h-3.5 w-3.5 text-accent" />
              <span className="text-[11px] font-bold text-ink uppercase tracking-wider">
                Parecer da IA
              </span>
              <span className="text-[9px] font-mono text-ink-faint ml-auto">
                Análise SPC + Datajud
              </span>
            </div>
            {parecer ? (
              expandido ? (
                <div className="text-[12px] text-ink leading-relaxed prose-sm">
                  <MarkdownSimples texto={parecer} />
                </div>
              ) : (
                <p className="text-[12px] text-ink leading-relaxed line-clamp-2">
                  {previewTexto}
                  {parecer.length > previewTexto.length && '...'}
                </p>
              )
            ) : (
              <p className="text-[11px] text-ink-muted italic">
                Parecer IA não disponível nesta consulta.
              </p>
            )}

            {parecer && parecer.length > previewTexto.length && (
              <button
                type="button"
                onClick={() => setExpandido(e => !e)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-accent hover:underline"
              >
                {expandido ? (
                  <>Ocultar parecer <ChevronUp className="h-3 w-3" /></>
                ) : (
                  <>Ver completo <ChevronDown className="h-3 w-3" /></>
                )}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function MarkdownSimples({ texto }: { texto: string }) {
  // Render markdown bem simples: ## headers, **bold**, listas com -
  const blocos: ReactNode[] = []
  const linhas = texto.split('\n')
  let listaAtual: string[] | null = null

  const flushLista = (idx: number) => {
    if (listaAtual && listaAtual.length) {
      blocos.push(
        <ul key={`ul-${idx}`} className="list-disc pl-5 my-1.5 space-y-0.5">
          {listaAtual.map((item, i) => (
            <li key={i} dangerouslySetInnerHTML={{ __html: aplicarBoldEEmojis(item) }} />
          ))}
        </ul>,
      )
      listaAtual = null
    }
  }

  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i]
    if (linha.startsWith('## ')) {
      flushLista(i)
      blocos.push(
        <h3 key={`h-${i}`} className="text-[12px] font-bold text-ink mt-2 mb-1 uppercase tracking-wider">
          {linha.slice(3).trim()}
        </h3>,
      )
    } else if (linha.startsWith('- ') || linha.startsWith('* ')) {
      if (!listaAtual) listaAtual = []
      listaAtual.push(linha.slice(2).trim())
    } else if (linha.trim() === '') {
      flushLista(i)
    } else {
      flushLista(i)
      blocos.push(
        <p key={`p-${i}`} className="my-1" dangerouslySetInnerHTML={{ __html: aplicarBoldEEmojis(linha) }} />,
      )
    }
  }
  flushLista(linhas.length)

  return <>{blocos}</>
}

function aplicarBoldEEmojis(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`(.+?)`/g, '<code class="text-[10px] font-mono bg-surface-2/60 px-1 rounded">$1</code>')
}

// ============================================================================
// Datajud — processos judiciais (CNJ) — tipos (componente movido pra ColunaDatajud)
// ============================================================================
interface DatajudPayload {
  ok: boolean
  documento: string
  tipoDocumento: 'F' | 'J'
  totalEncontrado: number
  processos: Array<{
    numeroProcesso: string
    tribunal: string
    grau: string
    classe: string
    assunto: string
    dataAjuizamento: string | null
    dataUltimaAtualizacao: string | null
    orgaoJulgador: string
  }>
  resumoTribunais: Array<{ tribunal: string; total: number; retornados: number; erro?: string }>
  erros: string[]
}

// ============================================================================
// Analise consolidada — calcula veredito, sinais, limite sugerido
// ============================================================================
interface Analise {
  veredito: 'verde' | 'amarelo' | 'vermelho'
  resumoVeredito: string
  tempoEmpresaAnos: number | null
  limiteCreditoSugerido: number | null
  condicaoPagamentoSugerida: string
  sinaisPositivos: string[]
  sinaisAlerta: string[]
}

function analisar(r: Resumo): Analise {
  const c = r.consumidor
  const score = r.score.valor
  const qtdInad = r.inadimplencias.qtd
  const valorInad = r.inadimplencias.valor_total
  const qtdProtesto = r.protestos.qtd
  const valorProtesto = r.protestos.valor_total
  const situacao = (c.situacao ?? '').toUpperCase()

  // Tempo de empresa em anos
  let tempoEmpresaAnos: number | null = null
  const dataFund = c.tipo === 'J' ? c.data_fundacao : c.data_nascimento
  if (dataFund) {
    const m = dataFund.match(/(\d{2})\/(\d{2})\/(\d{4})/)
    if (m) {
      const ano = Number(m[3])
      const hoje = new Date().getFullYear()
      tempoEmpresaAnos = hoje - ano
    }
  }

  // Pontuação de risco (0-100, quanto MAIOR pior)
  let risco = 0
  if (score != null) {
    if (score < 300) risco += 50
    else if (score < 500) risco += 30
    else if (score < 700) risco += 15
  } else {
    risco += 10
  }
  if (qtdInad > 0) risco += Math.min(40, 10 + qtdInad * 5)
  if (qtdProtesto > 0) risco += Math.min(40, 15 + qtdProtesto * 5)
  if (situacao && !/ATIV|REGUL/i.test(situacao)) risco += 30
  if (tempoEmpresaAnos != null) {
    if (tempoEmpresaAnos < 1) risco += 15
    else if (tempoEmpresaAnos < 3) risco += 5
  }

  // Veredito a partir do risco
  let veredito: Analise['veredito']
  let resumoVeredito: string
  if (risco >= 50) {
    veredito = 'vermelho'
    resumoVeredito = 'Operação de alto risco. Recomenda-se cautela ou recusa.'
  } else if (risco >= 20) {
    veredito = 'amarelo'
    resumoVeredito = 'Crédito com ressalvas. Pedir garantia ou reduzir prazo.'
  } else {
    veredito = 'verde'
    resumoVeredito = 'Cliente apto a crédito nas condições padrão.'
  }

  // Limite de crédito sugerido (heurística simples)
  let limiteCreditoSugerido: number | null = null
  if (veredito === 'verde') {
    limiteCreditoSugerido = c.tipo === 'J' ? 200_000 : 50_000
  } else if (veredito === 'amarelo') {
    limiteCreditoSugerido = c.tipo === 'J' ? 50_000 : 15_000
  } else {
    limiteCreditoSugerido = 0
  }

  // Condição de pagamento sugerida
  let condicaoPagamentoSugerida: string
  if (veredito === 'verde') {
    condicaoPagamentoSugerida = 'Boleto faturado 28/56/84 dias ou parcelamento de até 90 dias'
  } else if (veredito === 'amarelo') {
    condicaoPagamentoSugerida = 'Entrada + saldo em 30 dias, com aval ou boleto registrado'
  } else {
    condicaoPagamentoSugerida = 'Pagamento à vista, antes da expedição'
  }

  // Sinais positivos e de alerta
  const sinaisPositivos: string[] = []
  const sinaisAlerta: string[] = []

  if (score != null) {
    if (score >= 700) sinaisPositivos.push(`Score alto (${score}/1000)`)
    else if (score < 400) sinaisAlerta.push(`Score baixo (${score}/1000) — indica risco`)
  }
  if (qtdInad === 0 && qtdProtesto === 0) {
    sinaisPositivos.push('Sem inadimplências e sem protestos')
  }
  if (qtdInad > 0) {
    sinaisAlerta.push(`${qtdInad} inadimplência(s) somando ${fmtBRL(valorInad)}`)
  }
  if (qtdProtesto > 0) {
    sinaisAlerta.push(`${qtdProtesto} protesto(s) somando ${fmtBRL(valorProtesto)}`)
  }
  if (r.acoes_judiciais) {
    if (r.acoes_judiciais.qtd === 0) {
      sinaisPositivos.push('Sem ações judiciais registradas no SPC')
    } else {
      sinaisAlerta.push(
        `${r.acoes_judiciais.qtd} ação(ões) judicial(is) totalizando ${fmtBRL(r.acoes_judiciais.valor_total)}`,
      )
    }
  }
  if (tempoEmpresaAnos != null) {
    if (tempoEmpresaAnos >= 10) sinaisPositivos.push(`Empresa consolidada — ${tempoEmpresaAnos} anos de mercado`)
    else if (tempoEmpresaAnos >= 3) sinaisPositivos.push(`Empresa estabelecida — ${tempoEmpresaAnos} anos`)
    else if (tempoEmpresaAnos < 1) sinaisAlerta.push('Empresa muito nova (menos de 1 ano)')
  }
  if (situacao && /ATIV|REGUL/i.test(situacao)) {
    sinaisPositivos.push(`Situação cadastral ${situacao}`)
  } else if (situacao) {
    sinaisAlerta.push(`Situação cadastral irregular (${situacao})`)
  }
  if (r.participacoes_em_empresas && r.participacoes_em_empresas.length > 1) {
    sinaisPositivos.push(`Sócio em ${r.participacoes_em_empresas.length} empresas — perfil empresarial diversificado`)
  }
  if (r.socios && r.socios.length >= 2) {
    sinaisPositivos.push(`Quadro societário com ${r.socios.length} sócios`)
  }

  return {
    veredito,
    resumoVeredito,
    tempoEmpresaAnos,
    limiteCreditoSugerido,
    condicaoPagamentoSugerida,
    sinaisPositivos,
    sinaisAlerta,
  }
}

function ScoreGauge({ valor, classificacao }: { valor: number | null; classificacao: string | null }) {
  const pct = valor != null ? Math.max(0, Math.min(100, (valor / 1000) * 100)) : 0
  const tone =
    valor == null
      ? 'neutral'
      : valor >= 700
      ? 'good'
      : valor >= 400
      ? 'warn'
      : 'bad'
  const barClass = {
    good: 'bg-success',
    warn: 'bg-warning',
    bad: 'bg-danger',
    neutral: 'bg-ink-muted',
  }[tone]
  const textClass = {
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-danger',
    neutral: 'text-ink-muted',
  }[tone]

  return (
    <div className="text-center">
      <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">Score</p>
      <p className={`text-[14px] font-bold font-mono tabular-nums ${textClass}`}>
        {valor != null ? `${valor}` : '—'}
        <span className="text-[9px] text-ink-faint">/1000</span>
      </p>
      <div className="h-1 bg-surface-2 rounded-full overflow-hidden mt-1">
        <div
          className={`h-full ${barClass} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {classificacao && <p className="text-[9px] text-ink-muted mt-0.5">{classificacao}</p>}
    </div>
  )
}

function Stat({
  label, value, sub, tone,
}: { label: string; value: string; sub?: string | null; tone: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const toneClass = {
    good: 'text-success',
    warn: 'text-warning',
    bad: 'text-danger',
    neutral: 'text-ink-muted',
  }[tone]
  return (
    <div className="text-center">
      <p className="text-[9px] uppercase tracking-wider text-ink-faint mb-0.5">{label}</p>
      <p className={`text-[14px] font-bold font-mono tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="text-[9px] text-ink-muted tabular-nums">{sub}</p>}
    </div>
  )
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex">
      <span className="text-ink-faint w-20 shrink-0">{label}:</span>
      <span className="text-ink flex-1 break-words">{valor}</span>
    </div>
  )
}

function fmtBRL(v: number): string {
  return v.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  })
}
