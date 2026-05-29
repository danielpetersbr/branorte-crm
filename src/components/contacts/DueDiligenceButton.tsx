// Componentes de Due Diligence — formulario reutilizavel + wrappers.
//
// DueDiligenceForm   forma "miolo" sem chrome (usado pela pagina /consulta)
// DueDiligenceModal  wrapper modal (usado quando aparece em outro lugar)
// DueDiligenceButton botao que abre o modal (legado, mantido pra reuso)
import { useState } from 'react'
import { Search, X, AlertCircle, CheckCircle, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  useConsultarDueDiligence,
  useDDHistorico,
  type DDConsulta,
  type Pacote,
} from '@/hooks/useDueDiligence'
import { useCan } from '@/hooks/usePermissions'

// Custos calculados a partir da tabela FCDL/SC jan/2026:
//   PJ: Novo SPC Maxi (5,62) + Score 12m (1,13) + Part Empresas (2,72) + Controle Societario (2,72) = 12,19
//   PF: Novo SPC Maxi (5,62) + Score 12m (1,13) + Part Empresas (2,72)                              =  9,47
const CUSTO_PJ_ECONOMICO = 12.19
const CUSTO_PF_ECONOMICO = 9.47
const CUSTO_PJ_COMPLETO = CUSTO_PJ_ECONOMICO + 17.09 + 16.21 + 6.49 + 4.10 // +Faturamento+QuadroSocial+GrupoEcon+Protesto
const CUSTO_PF_COMPLETO = CUSTO_PF_ECONOMICO + 1.46 + 1.02 // +Renda Presumida+PEP

const PACOTE_INFO: Record<Pacote, { titulo: string; descricao: string; custoPj: number; custoPf: number }> = {
  economico: {
    titulo: 'Econômico',
    descricao: 'Novo SPC Maxi + Score 12m + Participação em Empresas (+ Controle Societário pra PJ)',
    custoPj: CUSTO_PJ_ECONOMICO,
    custoPf: CUSTO_PF_ECONOMICO,
  },
  completo: {
    titulo: 'Completo',
    descricao: 'Econômico + Faturamento Presumido + Quadro Social + Grupo Econômico + Protesto + Renda + PEP',
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

  function handleSubmit() {
    if (!podeEnviar) return
    consultar.mutate({
      contact_id: contactId ?? null,
      tipo_consulta: tipoConsulta,
      cnpj: precisaCnpj ? cnpjLimpo : null,
      cpf_socio: precisaCpf ? cpfLimpo : null,
      pacote,
    })
  }

  return (
    <div className="space-y-4">
      {contactName && (
        <p className="text-[12px] text-ink-muted">
          Vinculado ao contato: <span className="text-ink font-semibold">{contactName}</span>
        </p>
      )}

      {/* Toggle tipo de consulta */}
      <div>
        <label className="text-[11px] font-semibold text-ink-muted block mb-1.5">
          Tipo de consulta
        </label>
        <div className="grid grid-cols-2 gap-1.5">
          {([
            { v: 'pj', label: 'Empresa (CNPJ)' },
            { v: 'pf', label: 'Pessoa Física (CPF)' },
          ] as Array<{ v: TipoConsulta; label: string }>).map(opt => {
            const ativo = tipoConsulta === opt.v
            return (
              <button
                key={opt.v}
                type="button"
                onClick={() => setTipoConsulta(opt.v)}
                className={`text-[11px] px-2 py-1.5 rounded-md border font-semibold transition-all ${
                  ativo
                    ? 'bg-accent text-white border-accent'
                    : 'bg-surface-2 border-border text-ink-muted hover:border-accent'
                }`}
              >
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Inputs */}
      <div className="space-y-3">
        {precisaCnpj && (
          <div>
            <label className="text-[11px] font-semibold text-ink-muted block mb-1">
              CNPJ da empresa *
            </label>
            <Input
              value={cnpj}
              onChange={e => setCnpj(formatDoc(e.target.value, 'cnpj'))}
              placeholder="00.000.000/0000-00"
              className="font-mono"
            />
            {cnpj && !cnpjValido && (
              <p className="text-[10px] text-danger mt-1">CNPJ deve ter 14 dígitos</p>
            )}
          </div>
        )}
        {precisaCpf && (
          <div>
            <label className="text-[11px] font-semibold text-ink-muted block mb-1">
              CPF {tipoConsulta === 'ambos' ? 'do sócio decisor' : 'da pessoa'} *
            </label>
            <Input
              value={cpf}
              onChange={e => setCpf(formatDoc(e.target.value, 'cpf'))}
              placeholder="000.000.000-00"
              className="font-mono"
            />
            {cpf && !cpfValido && (
              <p className="text-[10px] text-danger mt-1">CPF deve ter 11 dígitos</p>
            )}
          </div>
        )}
      </div>

      {/* Escolha de pacote */}
      <div>
        <label className="text-[11px] font-semibold text-ink-muted block mb-2">
          Pacote de consulta
        </label>
        <div className="space-y-1.5">
          {(['economico', 'paranoico'] as Pacote[]).map(p => {
            const info = PACOTE_INFO[p]
            const ativo = pacote === p
            const disabled = p === 'paranoico'  // Fase 3-4 ainda nao implementada
            return (
              <button
                key={p}
                type="button"
                disabled={disabled}
                onClick={() => setPacote(p)}
                className={`w-full text-left px-3 py-2 rounded-md border transition-all ${
                  ativo
                    ? 'bg-accent-bg border-accent'
                    : disabled
                    ? 'bg-surface-2/30 border-border opacity-50 cursor-not-allowed'
                    : 'bg-surface-2 border-border hover:border-accent'
                }`}
              >
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[12px] font-semibold text-ink">
                    {info.titulo}
                    {disabled && (
                      <span className="text-[9px] text-ink-faint font-normal ml-2">
                        (em breve · fases 3-4)
                      </span>
                    )}
                  </span>
                  <span className="text-[11px] font-mono text-ink-muted">
                    R$ {(
                      (precisaCnpj ? info.custoPj : 0) +
                      (precisaCpf ? info.custoPf : 0)
                    ).toFixed(2)}
                  </span>
                </div>
                <p className="text-[10px] text-ink-muted">{info.descricao}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Resumo de custo + acao */}
      <div className="bg-surface-2/40 border border-border rounded-md p-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-ink-muted">Custo estimado da consulta</span>
          <span className="text-[14px] font-mono font-bold text-accent">
            R$ {custoEstimado.toFixed(2)}
          </span>
        </div>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!podeEnviar}
          className="w-full"
        >
          {consultar.isPending ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Consultando...</>
          ) : (
            <><Search className="h-3.5 w-3.5" /> Consultar agora</>
          )}
        </Button>
        <p className="text-[10px] text-ink-faint text-center">
          Consultas no mesmo CNPJ nos últimos 30d retornam do cache sem custo.
        </p>
      </div>

      {/* Resultado da consulta atual (se houver) */}
      {consultar.data && (
        <ResultadoBox
          consulta={consultar.data.consulta}
          cacheHit={consultar.data._cache_hit}
        />
      )}
      {consultar.error && (
        <div className="bg-danger/10 border border-danger/30 rounded-md px-3 py-2 flex items-start gap-2">
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
                <span className="font-mono text-ink-muted">
                  {new Date(h.created_at).toLocaleDateString('pt-BR')} · {h.cnpj}
                </span>
                <span className={`text-[10px] font-semibold ${
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
  score: { valor: number | null; classificacao: string | null }
  inadimplencias: {
    qtd: number
    valor_total: number
    detalhes: Array<{ origem: string; valor: number; data: string | null }>
  }
  protestos: { qtd: number; valor_total: number }
  socios?: Array<{ nome: string; participacao?: string | null; documento?: string | null }>
  administradores?: Array<{ nome: string; cargo?: string | null }>
  participacoes_em_empresas?: Array<{ nome: string; cnpj?: string | null; tipo?: string | null }>
  alertas?: string[]
}

interface ResumoEnvelope {
  produto?: string
  documento?: string | null
  ok?: boolean
  resumo: Resumo
}

function ResultadoBox({ consulta, cacheHit }: { consulta: DDConsulta; cacheHit: boolean }) {
  const isSuccess = consulta.status === 'success'
  const isMock = !!(consulta.resultado_spc as { _mock?: boolean } | null)?._mock
  const resumos = ((consulta.resultado_spc as { resumos?: ResumoEnvelope[] } | null)?.resumos ?? [])

  return (
    <div className={`rounded-md border ${
      isSuccess ? 'bg-success/5 border-success/30' : 'bg-warning/10 border-warning/30'
    }`}>
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border/60">
        {isSuccess ? (
          <CheckCircle className="h-4 w-4 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 text-warning" />
        )}
        <span className="text-[12px] font-semibold text-ink">
          {cacheHit ? 'Resultado do cache (30d)' : 'Consulta concluída'}
        </span>
        {isMock && (
          <span className="text-[9px] font-mono uppercase text-warning bg-warning/15 px-1.5 py-0.5 rounded">
            mock
          </span>
        )}
        <span className="ml-auto text-[10px] font-mono text-ink-muted">
          R$ {consulta.custo_brl.toFixed(2)}
        </span>
      </div>
      {consulta.erro && (
        <p className="text-[11px] text-warning px-3 py-2">{consulta.erro}</p>
      )}

      {/* Render dos resumos */}
      {resumos.length > 0 ? (
        <div className="p-3 space-y-3">
          {resumos.map((r, i) => (
            <ResumoCard key={i} env={r} />
          ))}
        </div>
      ) : (
        <p className="text-[11px] text-ink-muted px-3 py-2">
          Sem dados estruturados — veja o JSON bruto abaixo.
        </p>
      )}

      <details className="border-t border-border/60">
        <summary className="text-[10px] text-ink-faint cursor-pointer hover:text-ink px-3 py-1.5">
          Ver JSON bruto (debug)
        </summary>
        <pre className="text-[9px] font-mono bg-surface-2/60 mx-3 mb-2 p-2 rounded overflow-x-auto max-h-60">
          {JSON.stringify(consulta.resultado_spc, null, 2)}
        </pre>
      </details>
    </div>
  )
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

function ResumoCard({ env }: { env: ResumoEnvelope }) {
  const r = env.resumo
  const c = r.consumidor
  const temInad = r.inadimplencias.qtd > 0
  const temProtesto = r.protestos.qtd > 0
  const analise = analisar(r)

  const veredictoStyle = {
    verde:    { bg: 'bg-success/15',  border: 'border-success/40',  text: 'text-success',  label: 'PODE VENDER',     icon: '✓' },
    amarelo:  { bg: 'bg-warning/15',  border: 'border-warning/40',  text: 'text-warning',  label: 'ATENÇÃO',          icon: '!' },
    vermelho: { bg: 'bg-danger/15',   border: 'border-danger/40',   text: 'text-danger',   label: 'NÃO RECOMENDADO',  icon: '✕' },
  }[analise.veredito]

  return (
    <div className="border border-border rounded-md bg-surface-2/30 overflow-hidden">
      {/* Header: nome + documento */}
      <div className="px-3 py-2 border-b border-border/60 bg-surface-2/50">
        <div className="flex items-center justify-between mb-0.5">
          <span className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold">
            {c.tipo === 'J' ? 'Empresa' : 'Pessoa Física'}
          </span>
          {env.produto && (
            <span className="text-[9px] font-mono text-ink-faint">SPC #{env.produto}</span>
          )}
        </div>
        <h3 className="text-[13px] font-bold text-ink leading-tight">
          {c.nome ?? '(sem nome no SPC)'}
        </h3>
        <p className="text-[10px] font-mono text-ink-muted">
          {c.tipo === 'J' ? 'CNPJ' : 'CPF'}: {c.documento}
          {c.situacao && (
            <span className={`ml-2 px-1.5 py-0.5 rounded text-[9px] uppercase font-bold ${
              /ATIV|REGUL/i.test(c.situacao)
                ? 'bg-success/20 text-success'
                : 'bg-warning/20 text-warning'
            }`}>
              {c.situacao}
            </span>
          )}
        </p>
      </div>

      {/* ANALISE — veredito + limite + pagamento sugerido */}
      <div className={`p-3 border-b border-border/60 ${veredictoStyle.bg} ${veredictoStyle.border} border-b-2`}>
        <div className="flex items-start gap-3">
          <div className={`h-9 w-9 rounded-full flex items-center justify-center text-[18px] font-bold ${veredictoStyle.text} bg-bg/40 shrink-0`}>
            {veredictoStyle.icon}
          </div>
          <div className="flex-1 min-w-0">
            <p className={`text-[10px] uppercase tracking-wider font-bold ${veredictoStyle.text}`}>
              {veredictoStyle.label}
            </p>
            <p className="text-[12px] text-ink font-semibold leading-tight">
              {analise.resumoVeredito}
            </p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3 pt-3 border-t border-border/40">
          <div>
            <p className="text-[9px] uppercase tracking-wider text-ink-faint">Limite sugerido</p>
            <p className={`text-[15px] font-bold font-mono ${veredictoStyle.text}`}>
              {analise.limiteCreditoSugerido != null
                ? analise.limiteCreditoSugerido > 0
                  ? fmtBRL(analise.limiteCreditoSugerido)
                  : 'Não conceder'
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[9px] uppercase tracking-wider text-ink-faint">Condição de pagamento</p>
            <p className="text-[11px] text-ink font-semibold leading-tight">
              {analise.condicaoPagamentoSugerida}
            </p>
          </div>
        </div>
      </div>

      {/* Sinais positivos / Alerta */}
      {(analise.sinaisPositivos.length > 0 || analise.sinaisAlerta.length > 0) && (
        <div className="grid md:grid-cols-2 gap-2 p-3 border-b border-border/60">
          {analise.sinaisPositivos.length > 0 && (
            <div className="bg-success/5 border border-success/30 rounded p-2">
              <p className="text-[9px] uppercase tracking-wider font-bold text-success mb-1">
                ✓ Sinais positivos
              </p>
              <ul className="space-y-0.5">
                {analise.sinaisPositivos.map((s, i) => (
                  <li key={i} className="text-[11px] text-ink leading-tight">• {s}</li>
                ))}
              </ul>
            </div>
          )}
          {analise.sinaisAlerta.length > 0 && (
            <div className="bg-danger/5 border border-danger/30 rounded p-2">
              <p className="text-[9px] uppercase tracking-wider font-bold text-danger mb-1">
                ⚠ Sinais de alerta
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

      {/* Score visual + Inadimplências + Protestos + Tempo */}
      <div className="grid grid-cols-4 gap-2 p-3 border-b border-border/60">
        <ScoreGauge valor={r.score.valor} classificacao={r.score.classificacao} />
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
        <Stat
          label={c.tipo === 'J' ? 'Tempo no mercado' : 'Idade'}
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

      {/* Dados cadastrais */}
      <div className="px-3 py-2 text-[11px] space-y-1 border-b border-border/60">
        {c.razao_social && c.razao_social !== c.nome && (
          <Linha label="Razão Social" valor={c.razao_social} />
        )}
        {c.natureza_juridica && <Linha label="Natureza" valor={c.natureza_juridica} />}
        {c.data_fundacao && <Linha label="Fundação" valor={c.data_fundacao} />}
        {c.data_nascimento && <Linha label="Nascimento" valor={c.data_nascimento} />}
        {c.endereco && <Linha label="Endereço" valor={c.endereco} />}
        {c.telefones && c.telefones.length > 0 && (
          <Linha label="Telefones" valor={c.telefones.join(' · ')} />
        )}
        {c.email && <Linha label="Email" valor={c.email} />}
      </div>

      {/* Sócios */}
      {r.socios && r.socios.length > 0 && (
        <div className="px-3 py-2 text-[11px] border-b border-border/60">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-1">
            Sócios ({r.socios.length})
          </p>
          <ul className="space-y-0.5">
            {r.socios.map((s, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-ink">{s.nome}</span>
                <span className="text-ink-muted font-mono text-[10px]">
                  {s.participacao ?? ''} {s.documento ? `· ${s.documento}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Participações em outras empresas */}
      {r.participacoes_em_empresas && r.participacoes_em_empresas.length > 0 && (
        <div className="px-3 py-2 text-[11px] border-b border-border/60">
          <p className="text-[10px] uppercase tracking-wider text-ink-faint font-semibold mb-1">
            Participação em outras empresas ({r.participacoes_em_empresas.length})
          </p>
          <ul className="space-y-0.5">
            {r.participacoes_em_empresas.map((p, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-ink truncate">{p.nome}</span>
                <span className="text-ink-muted font-mono text-[10px] shrink-0 ml-2">
                  {p.tipo ?? ''} {p.cnpj ?? ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Detalhe de inadimplências (top 5) */}
      {r.inadimplencias.detalhes.length > 0 && (
        <div className="px-3 py-2 text-[11px]">
          <p className="text-[10px] uppercase tracking-wider text-danger font-semibold mb-1">
            Inadimplências detectadas
          </p>
          <ul className="space-y-0.5">
            {r.inadimplencias.detalhes.map((d, i) => (
              <li key={i} className="flex items-center justify-between">
                <span className="text-ink truncate">{d.origem}</span>
                <span className="text-danger font-mono text-[10px] shrink-0 ml-2">
                  {fmtBRL(d.valor)} {d.data ? `· ${d.data}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
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
      <p className={`text-[14px] font-bold font-mono ${textClass}`}>
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
      <p className={`text-[14px] font-bold font-mono ${toneClass}`}>{value}</p>
      {sub && <p className="text-[9px] text-ink-muted">{sub}</p>}
    </div>
  )
}

function Linha({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="flex">
      <span className="text-ink-faint w-24 shrink-0">{label}:</span>
      <span className="text-ink flex-1">{valor}</span>
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
