import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

// Formato cru pra copiar: +55 sem espaços/parenteses/hifens (ex: +5548984692860)
function rawPhone(tel: string | null | undefined): string {
  if (!tel) return ''
  const digits = String(tel).replace(/\D/g, '')
  if (!digits) return ''
  return digits.startsWith('55') ? `+${digits}` : `+55${digits}`
}

export function PhoneCopyButton({ telefone }: { telefone: string | null | undefined }) {
  const [copied, setCopied] = useState(false)
  const raw = rawPhone(telefone)
  if (!raw) return <span className="text-ink-faint">—</span>

  async function copiar(e: React.MouseEvent) {
    e.stopPropagation()
    e.preventDefault()
    try {
      await navigator.clipboard.writeText(raw)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // fallback: seleciona o texto
      const ta = document.createElement('textarea')
      ta.value = raw
      document.body.appendChild(ta)
      ta.select()
      try { document.execCommand('copy') } catch { /* ignore */ }
      document.body.removeChild(ta)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="inline-flex items-center gap-1.5 group">
      <span className="text-[12px] text-ink-muted font-mono tabular-nums select-all">{raw}</span>
      <button
        onClick={copiar}
        title={copied ? 'Copiado!' : 'Copiar telefone'}
        className={`p-1 -m-1 rounded transition-colors opacity-50 group-hover:opacity-100 ${
          copied ? 'text-emerald-400' : 'text-ink-faint hover:text-ink'
        }`}
      >
        {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      </button>
    </div>
  )
}
