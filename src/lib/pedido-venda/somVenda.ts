// "Ka-ching" de caixa registradora quando o vendedor lança um pedido de venda.
//
// Sintetizado com Web Audio (sem arquivo de som): um estalo curto da gaveta e
// duas batidas de sino. O navegador só libera áudio depois de um gesto do
// usuário, e o som sai segundos depois do clique (depois de o servidor gravar o
// pedido) — por isso `prepararSomVenda()` roda NO clique e destrava o contexto,
// e `tocarSomVenda()` usa esse mesmo contexto quando o pedido existe de verdade.
// Qualquer falha de áudio é engolida: som nunca pode atrapalhar o pedido.

let ctx: AudioContext | null = null

function contexto(): AudioContext | null {
  if (typeof window === 'undefined') return null
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  if (!ctx) ctx = new Ctor()
  return ctx
}

/** Chamar no clique do botão de gerar o pedido (gesto do usuário). */
export function prepararSomVenda(): void {
  try {
    const c = contexto()
    if (c && c.state === 'suspended') void c.resume()
  } catch { /* sem áudio, sem som */ }
}

function estalo(c: AudioContext, destino: AudioNode, t: number) {
  const dur = 0.045
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * dur), c.sampleRate)
  const d = buf.getChannelData(0)
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length)
  const src = c.createBufferSource()
  src.buffer = buf
  const filtro = c.createBiquadFilter()
  filtro.type = 'bandpass'
  filtro.frequency.value = 3200
  filtro.Q.value = 0.9
  const g = c.createGain()
  g.gain.setValueAtTime(0.5, t)
  g.gain.exponentialRampToValueAtTime(0.001, t + dur)
  src.connect(filtro).connect(g).connect(destino)
  src.start(t)
  src.stop(t + dur)
}

// Sino: parciais inarmônicas (proporções de sino real) com decaimento rápido nas altas.
function sino(c: AudioContext, destino: AudioNode, t: number, freq: number, volume: number, duracao: number) {
  const parciais: Array<[number, number]> = [[1, 1], [2.76, 0.45], [5.4, 0.22], [8.93, 0.1]]
  for (const [mult, amp] of parciais) {
    const osc = c.createOscillator()
    osc.type = 'sine'
    osc.frequency.value = freq * mult
    const g = c.createGain()
    const fim = t + duracao / (1 + mult * 0.35)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(volume * amp, t + 0.005)
    g.gain.exponentialRampToValueAtTime(0.0001, fim)
    osc.connect(g).connect(destino)
    osc.start(t)
    osc.stop(fim + 0.02)
  }
}

/** Toca o ka-ching. Silencioso (e sem erro) se o navegador não deixar. */
export function tocarSomVenda(): void {
  try {
    const c = contexto()
    if (!c) return
    if (c.state === 'suspended') void c.resume()
    const saida = c.createGain()
    saida.gain.value = 0.35
    saida.connect(c.destination)
    const t = c.currentTime + 0.03
    estalo(c, saida, t)
    sino(c, saida, t + 0.06, 1567.98, 0.5, 0.5)   // "ka" — sol
    sino(c, saida, t + 0.16, 2093.0, 0.55, 1.3)   // "ching" — dó acima, longo
  } catch { /* sem áudio, sem som */ }
}

// ── Venda nova em TODO CRM aberto ───────────────────────────────────────────
// O vigia (`AvisoVendaNova`) toca em qualquer tela do CRM quando entra pedido.
// Duas travas pra não virar sirene:
//  • uma venda toca UMA vez por navegador, por mais abas do CRM que estejam abertas;
//  • quem lançou já ouviu na hora (`marcarVendaAnunciada` no envio) e não ouve de novo.

const CHAVE_TOCADOS = 'branorte:som-venda:tocados'
const RETER_MS = 2 * 24 * 60 * 60 * 1000

function armazem(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function lerTocados(): Record<string, { por: string; em: number }> {
  try {
    const bruto = armazem()?.getItem(CHAVE_TOCADOS)
    const v = bruto ? JSON.parse(bruto) : {}
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

function gravarTocados(mapa: Record<string, { por: string; em: number }>) {
  try {
    const agora = Date.now()
    for (const [id, v] of Object.entries(mapa)) if (agora - (v?.em ?? 0) > RETER_MS) delete mapa[id]
    armazem()?.setItem(CHAVE_TOCADOS, JSON.stringify(mapa))
  } catch { /* storage cheio ou bloqueado: no pior caso toca duas vezes */ }
}

/** O pedido foi tocado NESTE navegador por quem o lançou — as outras abas não repetem. */
export function marcarVendaAnunciada(id: string | null | undefined): void {
  if (!id) return
  const mapa = lerTocados()
  mapa[id] = { por: 'local', em: Date.now() }
  gravarTocados(mapa)
}

export function vendaJaAnunciada(id: string): boolean {
  return !!lerTocados()[id]
}

/** Foi lançada por quem está neste navegador (já viu o sucesso e ouviu na hora). */
export function vendaLancadaAqui(id: string): boolean {
  return lerTocados()[id]?.por === 'local'
}

/**
 * Disputa entre abas do mesmo navegador: cada uma escreve o próprio token, espera,
 * e só toca quem continuar dono da chave (o último a escrever). Duas abas que veem a
 * venda no mesmo instante não tocam juntas.
 */
export async function reivindicarVenda(id: string, esperaMs = 120): Promise<boolean> {
  if (vendaJaAnunciada(id)) return false
  const token = Math.random().toString(36).slice(2)
  const mapa = lerTocados()
  mapa[id] = { por: token, em: Date.now() }
  gravarTocados(mapa)
  await new Promise(r => setTimeout(r, esperaMs))
  return lerTocados()[id]?.por === token
}

/** O navegador já liberou o áudio nesta aba? (sem gesto nenhum, não libera) */
export function somVendaLiberado(): boolean {
  return !!ctx && ctx.state === 'running'
}

/**
 * Libera o áudio no primeiro clique ou tecla em qualquer lugar da página. Sem isso,
 * uma aba recarregada e nunca tocada fica muda (regra do navegador, não nossa).
 * Devolve a função que remove os ouvintes.
 */
export function destravarSomNoPrimeiroGesto(): () => void {
  if (typeof document === 'undefined') return () => {}
  const destravar = () => {
    prepararSomVenda()
    // `resume()` é assíncrono: confere no próximo ciclo; se ainda não liberou, o próximo gesto tenta de novo.
    setTimeout(() => { if (somVendaLiberado()) remover() }, 0)
  }
  const remover = () => {
    document.removeEventListener('pointerdown', destravar, true)
    document.removeEventListener('keydown', destravar, true)
  }
  document.addEventListener('pointerdown', destravar, true)
  document.addEventListener('keydown', destravar, true)
  return remover
}
