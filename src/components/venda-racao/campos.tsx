/**
 * Campos do formulário do estudo de produção própria.
 *
 * Números são digitados em pt-BR (vírgula decimal, ponto de milhar) e guardados
 * como `number`. O truque é o mesmo do BRLInput do CRM: manter uma string local
 * enquanto o campo está em foco pra não pisotear a digitação, e reformatar no
 * blur. Sem isso, digitar "1," some com a vírgula no próximo render.
 */
import { useEffect, useState, type ReactNode } from 'react'
import type { CustoOpcional } from '@/lib/venda-racao/tipos'

/** Aceita "1.234,56", "1234.56", "1234" e devolve number. */
export function parseBR(s: string): number {
  if (!s) return 0
  const limpo = s.replace(/[^\d,.-]/g, '')
  if (!limpo || limpo === '-') return 0
  let normalizado: string
  if (limpo.includes(',')) {
    normalizado = limpo.replace(/\./g, '').replace(',', '.')
  } else if ((limpo.match(/\./g) || []).length > 1) {
    normalizado = limpo.replace(/\./g, '')
  } else {
    normalizado = limpo
  }
  const n = parseFloat(normalizado)
  return Number.isFinite(n) ? n : 0
}

function formatar(n: number, casas: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: casas })
}

interface CampoNumeroProps {
  valor: number
  onChange: (v: number) => void
  /** Casas decimais aceitas na exibição (a precisão interna é sempre cheia). */
  casas?: number
  placeholder?: string
  className?: string
  disabled?: boolean
  id?: string
  'aria-label'?: string
}

export function CampoNumero({
  valor, onChange, casas = 2, placeholder = '0', className = 'vr-inp', disabled, id,
  'aria-label': ariaLabel,
}: CampoNumeroProps) {
  const [raw, setRaw] = useState(() => (valor ? formatar(valor, casas) : ''))
  const [focado, setFocado] = useState(false)

  useEffect(() => {
    if (focado) return
    setRaw(valor ? formatar(valor, casas) : '')
  }, [valor, casas, focado])

  return (
    <input
      id={id}
      type="text"
      inputMode="decimal"
      value={raw}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      className={className}
      onFocus={() => setFocado(true)}
      onChange={e => { setRaw(e.target.value); onChange(parseBR(e.target.value)) }}
      onBlur={() => {
        setFocado(false)
        const n = parseBR(raw)
        setRaw(n ? formatar(n, casas) : '')
        onChange(n)
      }}
    />
  )
}

export function CampoTexto({
  valor, onChange, placeholder, className = 'vr-inp txt', tipo = 'text', disabled, id,
}: {
  valor: string
  onChange: (v: string) => void
  placeholder?: string
  className?: string
  tipo?: 'text' | 'date' | 'tel'
  disabled?: boolean
  id?: string
}) {
  return (
    <input
      id={id}
      type={tipo}
      value={valor}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      onChange={e => onChange(e.target.value)}
    />
  )
}

/**
 * Rótulo + controle. O rótulo é um <div> e não um <label for>: o filho pode ser
 * um grupo (toggle + input), e apontar `for` pra um wrapper não-rotulável não
 * ajuda leitor de tela nenhum — os controles carregam aria-label próprio.
 */
export function Campo({
  label, unidade, children, dica,
}: { label: ReactNode; unidade?: ReactNode; children: ReactNode; dica?: ReactNode }) {
  return (
    <div className="vr-field">
      <div className="vr-label">
        <span>{label}</span>
        {unidade ? <span className="u">{unidade}</span> : null}
      </div>
      {children}
      {dica ? <div className="vr-hint">{dica}</div> : null}
    </div>
  )
}

export function Etapa({
  numero, titulo, descricao, children,
}: {
  numero: number | string
  titulo: ReactNode
  descricao?: ReactNode
  children: ReactNode
}) {
  return (
    <div className="vr-step">
      <div className="vr-q"><span className="vr-n">{numero}</span><span>{titulo}</span></div>
      {descricao ? <div className="vr-stepdesc">{descricao}</div> : null}
      {children}
    </div>
  )
}

export function Alternador<T extends string>({
  valor, opcoes, onChange,
}: { valor: T; opcoes: Array<{ v: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="vr-toggle">
      {opcoes.map(o => (
        <button
          key={o.v}
          type="button"
          className={o.v === valor ? 'on' : ''}
          onClick={() => onChange(o.v)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Selecao<T extends string>({
  valor, opcoes, onChange, className = 'vr-inp',
}: {
  valor: T
  opcoes: Array<{ v: T; label: string }>
  onChange: (v: T) => void
  className?: string
}) {
  return (
    <select className={className} value={valor} onChange={e => onChange(e.target.value as T)}>
      {opcoes.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
    </select>
  )
}

/**
 * Custo com liga/desliga — desligado sai da conta e o campo fica inerte.
 *
 * `origem` existe porque nenhum valor padrão pode ser tratado como custo real
 * da propriedade: o vendedor precisa ver de onde a estimativa veio pra decidir
 * se confirma, ajusta ou desliga.
 */
export function CustoLinha({
  label, unidade, custo, onChange, casas = 3, origem, disabled,
}: {
  label: string
  unidade: string
  custo: CustoOpcional
  onChange: (c: CustoOpcional) => void
  casas?: number
  origem?: string
  disabled?: boolean
}) {
  return (
    <div className="vr-custo">
      <div className="vr-frow" style={{ gridTemplateColumns: 'auto minmax(0,1fr) 90px' }}>
        <input
          type="checkbox"
          checked={custo.ativo}
          disabled={disabled}
          aria-label={`Ativar ${label}`}
          style={{ width: 16, height: 16, accentColor: 'var(--vr-green)' }}
          onChange={e => onChange({ ...custo, ativo: e.target.checked })}
        />
        <span className="fn" style={{ opacity: custo.ativo ? 1 : 0.5 }}>
          {label} <span style={{ color: 'var(--vr-ink40)', fontWeight: 400 }}>{unidade}</span>
        </span>
        <CampoNumero
          valor={custo.valor}
          casas={casas}
          disabled={disabled || !custo.ativo}
          aria-label={label}
          onChange={v => onChange({ ...custo, valor: v })}
          className=""
        />
      </div>
      {origem ? <div className="vr-origem">{origem}</div> : null}
    </div>
  )
}
