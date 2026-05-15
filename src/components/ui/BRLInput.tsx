import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

/**
 * Input de moeda BR formatado.
 * Aceita digitação com vírgula OU ponto, exibe "1.234,56" mas armazena number.
 *
 * Por que não <input type="number">: força ponto decimal, não respeita locale BR,
 * vendedor digita "1500,50" e perde a parte decimal.
 */
interface BRLInputProps {
  value: number | null | undefined
  onChange: (value: number) => void
  placeholder?: string
  className?: string
  title?: string
  /** Mostra prefixo "R$ " inline (default true) */
  prefix?: boolean
  disabled?: boolean
}

function formatBR(n: number): string {
  return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function parseBR(s: string): number {
  if (!s) return 0
  // Remove tudo que não for dígito, vírgula ou ponto
  const limpo = s.replace(/[^\d,.\-]/g, '')
  // Heurística: se tem vírgula, é separador decimal BR (1.234,56). Se só ponto,
  // pode ser BR sem casa decimal (1.234) ou US (1234.56). Assume BR se >1 ponto.
  let normalizado: string
  if (limpo.includes(',')) {
    // BR clássico: pontos = milhar, vírgula = decimal
    normalizado = limpo.replace(/\./g, '').replace(',', '.')
  } else if ((limpo.match(/\./g) || []).length > 1) {
    // Múltiplos pontos = milhar BR (ex: 1.234.567)
    normalizado = limpo.replace(/\./g, '')
  } else {
    // Único ponto = decimal US OU sem decimal
    normalizado = limpo
  }
  const n = parseFloat(normalizado)
  return isNaN(n) ? 0 : n
}

export function BRLInput({
  value, onChange, placeholder = '0,00', className, title, prefix = false, disabled,
}: BRLInputProps) {
  // Mantém string local pra não atrapalhar enquanto vendedor digita
  const [raw, setRaw] = useState<string>(value != null && value > 0 ? formatBR(value) : '')
  const [focused, setFocused] = useState(false)

  // Sync quando o value externo muda (ex: % editado em outra parcela altera R$ aqui)
  useEffect(() => {
    if (focused) return // não pisotear digitação
    setRaw(value != null && value > 0 ? formatBR(value) : '')
  }, [value, focused])

  const inputEl = (
    <input
      type="text"
      inputMode="decimal"
      value={raw}
      onChange={e => {
        setRaw(e.target.value)
        onChange(parseBR(e.target.value))
      }}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        // Reformata pro padrão BR ao sair do foco
        const n = parseBR(raw)
        setRaw(n > 0 ? formatBR(n) : '')
      }}
      placeholder={placeholder}
      title={title}
      disabled={disabled}
      className={cn(
        'text-right tabular-nums px-2 py-0.5 bg-white border border-gray-300 rounded',
        'hover:border-blue-400 focus:border-blue-500 focus:ring-1 focus:ring-blue-200 outline-none',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        className,
      )}
    />
  )

  if (!prefix) return inputEl
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-gray-500 text-[12px]">R$</span>
      {inputEl}
    </span>
  )
}
