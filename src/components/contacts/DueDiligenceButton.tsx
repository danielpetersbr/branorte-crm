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

const PACOTE_INFO: Record<Pacote, { titulo: string; descricao: string; custoBase: number }> = {
  economico: {
    titulo: 'Econômico',
    descricao: 'CNPJ + Score PJ+ (e CPF + PEP do sócio, se informado)',
    custoBase: 10.83,
  },
  completo: {
    titulo: 'Completo',
    descricao: 'Econômico + Faturamento + Quadro Social + Grupo Econômico + Protesto',
    custoBase: 47.32,
  },
  paranoico: {
    titulo: 'Paranoico',
    descricao: 'Completo + Datajud + Google + Instagram + Parecer IA (fases 3-4)',
    custoBase: 90.0,
  },
  custom: { titulo: 'Custom', descricao: 'Não disponível ainda', custoBase: 0 },
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
export function DueDiligenceForm({ contactId, contactName, initialCnpj }: FormProps) {
  const [cnpj, setCnpj] = useState(initialCnpj ?? '')
  const [cpfSocio, setCpfSocio] = useState('')
  const [pacote, setPacote] = useState<Pacote>('economico')
  const consultar = useConsultarDueDiligence()
  const { data: historico = [] } = useDDHistorico(contactId ?? null)

  const cnpjLimpo = cnpj.replace(/\D/g, '')
  const cnpjValido = cnpjLimpo.length === 14
  const cpfLimpo = cpfSocio.replace(/\D/g, '')
  const cpfValido = cpfLimpo.length === 0 || cpfLimpo.length === 11
  const podeEnviar = cnpjValido && cpfValido && !consultar.isPending

  const custoEstimado =
    PACOTE_INFO[pacote].custoBase + (cpfLimpo.length === 11 ? 10.83 : 0)

  function handleSubmit() {
    if (!podeEnviar) return
    consultar.mutate({
      contact_id: contactId ?? null,
      cnpj: cnpjLimpo,
      cpf_socio: cpfLimpo.length === 11 ? cpfLimpo : null,
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

      {/* Inputs */}
      <div className="space-y-3">
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
        <div>
          <label className="text-[11px] font-semibold text-ink-muted block mb-1">
            CPF do sócio decisor <span className="text-ink-faint">(opcional)</span>
          </label>
          <Input
            value={cpfSocio}
            onChange={e => setCpfSocio(formatDoc(e.target.value, 'cpf'))}
            placeholder="000.000.000-00"
            className="font-mono"
          />
          {cpfSocio && !cpfValido && (
            <p className="text-[10px] text-danger mt-1">CPF deve ter 11 dígitos</p>
          )}
        </div>
      </div>

      {/* Escolha de pacote */}
      <div>
        <label className="text-[11px] font-semibold text-ink-muted block mb-2">
          Pacote de consulta
        </label>
        <div className="space-y-1.5">
          {(['economico', 'completo', 'paranoico'] as Pacote[]).map(p => {
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
                    ~R$ {info.custoBase.toFixed(2)}
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

function ResultadoBox({ consulta, cacheHit }: { consulta: DDConsulta; cacheHit: boolean }) {
  const isSuccess = consulta.status === 'success'
  return (
    <div className={`rounded-md border px-3 py-2 ${
      isSuccess ? 'bg-success/10 border-success/30' : 'bg-warning/10 border-warning/30'
    }`}>
      <div className="flex items-center gap-2 mb-1">
        {isSuccess ? (
          <CheckCircle className="h-4 w-4 text-success" />
        ) : (
          <AlertCircle className="h-4 w-4 text-warning" />
        )}
        <span className="text-[12px] font-semibold text-ink">
          {cacheHit ? 'Resultado do cache (30d)' : 'Consulta concluída'}
        </span>
        <span className="ml-auto text-[10px] font-mono text-ink-muted">
          R$ {consulta.custo_brl.toFixed(2)}
        </span>
      </div>
      {consulta.erro && (
        <p className="text-[11px] text-warning">{consulta.erro}</p>
      )}
      <details className="mt-1">
        <summary className="text-[10px] text-ink-faint cursor-pointer hover:text-ink">
          Ver JSON bruto do SPC
        </summary>
        <pre className="text-[9px] font-mono bg-surface-2/60 p-2 rounded mt-1 overflow-x-auto max-h-60">
          {JSON.stringify(consulta.resultado_spc, null, 2)}
        </pre>
      </details>
    </div>
  )
}
