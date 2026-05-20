// Store global de progresso de geração de orçamento.
// Persiste entre navegações de página (não é React state).
// Qualquer componente pode ler via useGenerationProgress() hook.

type Listener = () => void

interface GenerationState {
  active: boolean
  clienteNome: string
  step: string
  progress: number  // 0-100
}

let state: GenerationState = { active: false, clienteNome: '', step: '', progress: 0 }
const listeners = new Set<Listener>()

function notify() { listeners.forEach(fn => fn()) }

export function startGeneration(clienteNome: string) {
  state = { active: true, clienteNome, step: 'Preparando...', progress: 0 }
  notify()
}

export function updateGeneration(step: string, progress: number) {
  if (!state.active) return
  state = { ...state, step, progress: Math.max(state.progress, Math.min(100, progress)) }
  notify()
}

export function finishGeneration() {
  state = { active: false, clienteNome: '', step: '', progress: 0 }
  notify()
}

export function getGenerationState(): GenerationState {
  return state
}

export function subscribeGeneration(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
