import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { getGenerationState, subscribeGeneration } from '@/lib/generation-progress'

export function GenerationOverlay() {
  const [state, setState] = useState(getGenerationState)

  useEffect(() => subscribeGeneration(() => setState(getGenerationState())), [])

  if (!state.active) return null

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-bg border border-border rounded-xl shadow-2xl w-[380px] overflow-hidden">
        {/* Header */}
        <div className="px-5 pt-5 pb-3 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center shrink-0">
            <FileText className="w-5 h-5 text-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-semibold text-ink truncate">
              Gerando orçamento
            </p>
            <p className="text-[12px] text-ink-muted truncate">
              {state.clienteNome || 'Processando...'}
            </p>
          </div>
          <span className="text-[13px] font-bold text-accent tabular-nums shrink-0">
            {Math.round(state.progress)}%
          </span>
        </div>

        {/* Progress bar */}
        <div className="px-5 pb-2">
          <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
            <div
              className="h-full bg-accent rounded-full transition-all duration-500 ease-out"
              style={{ width: `${state.progress}%` }}
            />
          </div>
        </div>

        {/* Step label */}
        <div className="px-5 pb-4">
          <p className="text-[11px] text-ink-faint truncate">
            {state.step}
          </p>
        </div>
      </div>
    </div>
  )
}
