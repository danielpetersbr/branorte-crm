// Página PÚBLICA (sem login) — a transportadora abre pelo link que o Jardel
// envia no WhatsApp: /cotar-frete/<token>. Mostra o resumo do frete e deixa ela
// preencher o valor. Lê/grava via edge function `frete-lance` (token-scoped):
// a transportadora NÃO vê os lances das concorrentes.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

type EquipItem = { nome?: string; qtd?: number; foto_url?: string | null }
type Resumo = {
  codigo: string | null
  transportadora_nome: string | null
  cidade_destino: string | null
  uf_destino: string | null
  distancia_km: number | null
  equipamentos_itens: EquipItem[] | null
  descricao_carga: string | null
  peso_total_kg: number | null
  comprimento_m: number | null
  largura_m: number | null
  altura_m: number | null
  volume_m3: number | null
  carga_indivisivel: boolean | null
  caminhao_recomendado: string | null
  prazo_desejado: string | null
  observacoes: string | null
  solic_status: string
  lance_status: string
  valor: number | null
  prazo_dias: number | null
  lance_observacoes: string | null
}

function fmtMoeda(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

/** Parser de moeda BR robusto: entende "16.500", "1.234,56", "1500.50", "1500,50". */
function parseMoeda(s: string): number {
  let t = String(s).trim().replace(/[^\d.,]/g, '')
  if (!t) return NaN
  const hasComma = t.includes(','), hasDot = t.includes('.')
  if (hasComma && hasDot) {
    // o ÚLTIMO separador é o decimal
    if (t.lastIndexOf(',') > t.lastIndexOf('.')) t = t.replace(/\./g, '').replace(',', '.') // 1.234,56
    else t = t.replace(/,/g, '') // 1,234.56
  } else if (hasComma) {
    t = t.replace(',', '.') // 1234,56
  } else if (hasDot) {
    // só ponto: 3 dígitos após = milhar (16.500 -> 16500); senão decimal (1500.50)
    const after = t.slice(t.lastIndexOf('.') + 1)
    if (after.length === 3) t = t.replace(/\./g, '')
  }
  return Number(t)
}

function resumoEquip(r: Resumo): string {
  const arr = Array.isArray(r.equipamentos_itens) ? r.equipamentos_itens : []
  if (arr.length) return arr.map(i => `${i.qtd && i.qtd > 1 ? i.qtd + 'x ' : ''}${i.nome ?? 'Equipamento'}`).join(' + ')
  return r.descricao_carga || 'Equipamento Branorte'
}

export function CotarFrete() {
  const { pathname } = useLocation()
  const token = decodeURIComponent((pathname.split('/cotar-frete/')[1] || '').replace(/\/+$/, ''))

  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState('')
  const [encerrada, setEncerrada] = useState(false)
  const [resumo, setResumo] = useState<Resumo | null>(null)
  const [valor, setValor] = useState('')
  const [prazo, setPrazo] = useState('')
  const [zoom, setZoom] = useState(false)
  const [obs, setObs] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [recusado, setRecusado] = useState(false)

  useEffect(() => {
    let cancel = false
    async function load() {
      if (!token) { setErro('Link inválido.'); setLoading(false); return }
      const { data, error } = await supabase.functions.invoke('frete-lance', { body: { action: 'get', token } })
      if (cancel) return
      if (error || !data || data.error) {
        setErro(data?.error === 'token_invalido' ? 'Este link de cotação não é válido ou expirou.' : 'Não consegui carregar a cotação. Tente novamente.')
        setLoading(false); return
      }
      setEncerrada(!!data.encerrada)
      const r = data.resumo as Resumo
      setResumo(r)
      if (r?.valor != null) setValor(String(r.valor))
      if (r?.prazo_dias != null) setPrazo(String(r.prazo_dias))
      if (r?.lance_observacoes) setObs(r.lance_observacoes)
      setLoading(false)
    }
    load()
    return () => { cancel = true }
  }, [token])

  async function enviar() {
    const v = parseMoeda(valor)
    if (!Number.isFinite(v) || v <= 0) { setErro('Informe o valor do frete (R$).'); return }
    const p = Number(prazo)
    if (!prazo || !Number.isFinite(p) || p <= 0) { setErro('Informe o prazo de entrega (dias).'); return }
    setEnviando(true); setErro('')
    const { data, error } = await supabase.functions.invoke('frete-lance', {
      body: { action: 'submit', token, valor: v, prazo_dias: p, observacoes: obs.trim() || null },
    })
    setEnviando(false)
    if (error || data?.error) {
      setErro(data?.error === 'encerrada' ? 'Esta cotação já foi encerrada pela Branorte.' : 'Não consegui enviar agora. Tente de novo em instantes.')
      return
    }
    setEnviado(true)
  }

  async function recusar() {
    if (!confirm('Confirmar que NÃO consegue atender este frete?')) return
    await supabase.functions.invoke('frete-lance', { body: { action: 'recusar', token } })
    setRecusado(true)
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="text-sm text-ink-muted">Carregando cotação…</div>
      </div>
    )
  }

  if (erro && !resumo) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-md bg-surface-1 border border-border rounded-2xl p-8 text-center">
          <div className="h-14 w-14 rounded-full bg-red-500/10 mx-auto flex items-center justify-center mb-4">
            <span className="text-red-500 text-2xl">!</span>
          </div>
          <h1 className="font-bold text-ink mb-2">Ops</h1>
          <p className="text-sm text-ink-muted">{erro}</p>
          <p className="mt-6 text-xs font-semibold tracking-widest text-ink-faint">BRANORTE</p>
        </div>
      </div>
    )
  }

  if (recusado) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-md bg-surface-1 border border-border rounded-2xl p-8 text-center">
          <h1 className="text-xl font-bold text-ink mb-2">Tudo certo 👍</h1>
          <p className="text-sm text-ink-muted">Registramos que você não pode atender este frete. Obrigado pelo retorno!</p>
          <p className="mt-6 text-xs font-semibold tracking-widest text-ink-faint">BRANORTE</p>
        </div>
      </div>
    )
  }

  if (enviado) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-md bg-surface-1 border border-border rounded-2xl p-8 text-center">
          <div className="h-16 w-16 rounded-full bg-accent/10 mx-auto flex items-center justify-center mb-4">
            <span className="text-accent text-3xl">✓</span>
          </div>
          <h1 className="text-xl font-bold text-ink mb-2">Cotação enviada!</h1>
          <p className="text-sm text-ink-muted">
            A Branorte recebeu seu valor de <b className="text-ink">{fmtMoeda(parseMoeda(valor))}</b>. Em breve retornamos. Obrigado! 🚚
          </p>
          <p className="mt-6 text-xs font-semibold tracking-widest text-ink-faint">BRANORTE</p>
        </div>
      </div>
    )
  }

  const r = resumo!
  const jaRespondeu = r.lance_status === 'respondido'

  return (
    <div className="min-h-screen bg-bg py-6 px-4">
      <div className="w-full max-w-lg mx-auto">
        <div className="text-center mb-5">
          <p className="text-xs font-semibold tracking-widest text-accent mb-2">BRANORTE</p>
          <h1 className="text-xl font-bold text-ink leading-snug">
            Cotação de Frete{r.transportadora_nome ? <> — <span className="text-accent">{r.transportadora_nome}</span></> : null}
          </h1>
          <p className="text-sm text-ink-muted mt-1">Preencha seu valor pra este transporte. Leva 30 segundos.</p>
        </div>

        {encerrada && (
          <div className="mb-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-center text-sm text-amber-600">
            Esta cotação já foi <b>encerrada</b> pela Branorte. Não é mais possível enviar valor.
          </div>
        )}

        {/* Resumo do frete */}
        <div className="bg-surface-1 border border-border rounded-2xl p-5 mb-4">
          <div className="text-[11px] uppercase tracking-widest text-ink-faint mb-3">O que transportar</div>
          {(() => { const f = (Array.isArray(r.equipamentos_itens) ? r.equipamentos_itens : []).find(i => i?.foto_url)?.foto_url; return f ? (<>
            <button type="button" onClick={() => setZoom(true)} title="Clique para ampliar a foto" className="block w-full mb-3 cursor-zoom-in">
              <img src={f} alt="" className="w-full max-h-56 object-contain rounded-lg border border-border bg-bg" />
            </button>
            {zoom && (
              <div className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center p-4" onClick={() => setZoom(false)}>
                <img src={f} alt="" className="max-h-[90vh] max-w-[92vw] object-contain rounded-lg shadow-2xl" onClick={e => e.stopPropagation()} />
                <button onClick={() => setZoom(false)} title="Fechar" className="absolute top-4 right-4 h-9 w-9 rounded-full bg-white/15 hover:bg-white/30 text-white text-xl leading-none">✕</button>
              </div>
            )}
          </>) : null })()}
          <div className="text-ink font-semibold mb-1">{resumoEquip(r)}</div>
          {r.carga_indivisivel && (
            <div className="inline-block text-[11px] px-2 py-0.5 rounded-full bg-accent/10 text-accent font-medium mb-3">
              Carga indivisível (não fraciona)
            </div>
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm mt-2">
            <div><dt className="text-ink-faint text-xs">Destino</dt><dd className="text-ink">{r.cidade_destino ?? '—'}{r.uf_destino ? `/${r.uf_destino}` : ''}</dd></div>
            <div><dt className="text-ink-faint text-xs">Origem</dt><dd className="text-ink">Grão Pará/SC</dd></div>
            {r.distancia_km != null && <div><dt className="text-ink-faint text-xs">Distância aprox.</dt><dd className="text-ink">{Math.round(r.distancia_km).toLocaleString('pt-BR')} km</dd></div>}
            {r.peso_total_kg != null && <div><dt className="text-ink-faint text-xs">Peso aprox.</dt><dd className="text-ink">{Math.round(r.peso_total_kg).toLocaleString('pt-BR')} kg</dd></div>}
            {(r.comprimento_m || r.largura_m || r.altura_m) && (
              <div><dt className="text-ink-faint text-xs">Medidas (C×L×A)</dt><dd className="text-ink">{r.comprimento_m ?? '?'} × {r.largura_m ?? '?'} × {r.altura_m ?? '?'} m</dd></div>
            )}
            {r.caminhao_recomendado && <div><dt className="text-ink-faint text-xs">Veículo sugerido</dt><dd className="text-ink">{r.caminhao_recomendado}</dd></div>}
            {r.prazo_desejado && <div><dt className="text-ink-faint text-xs">Prazo desejado</dt><dd className="text-ink">{r.prazo_desejado}</dd></div>}
          </dl>
          {r.observacoes && (
            <div className="mt-3 pt-3 border-t border-border text-sm text-ink-muted">
              <span className="text-ink-faint text-xs block mb-0.5">Observações</span>{r.observacoes}
            </div>
          )}
        </div>

        {/* Form do lance */}
        {!encerrada && (
          <div className="bg-surface-1 border border-border rounded-2xl p-5">
            {jaRespondeu && (
              <div className="mb-3 text-xs text-accent">Você já enviou um valor. Pode atualizar abaixo se quiser.</div>
            )}
            <label className="block text-sm font-medium text-ink mb-1.5">Valor do frete (R$) *</label>
            <div className="relative mb-4">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-sm">R$</span>
              <input
                inputMode="decimal"
                value={valor}
                onChange={e => { setValor(e.target.value); setErro('') }}
                placeholder="0,00"
                className="w-full pl-9 pr-3 py-3 rounded-lg bg-bg border border-border text-ink text-lg placeholder:text-ink-faint outline-none focus:border-accent"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Prazo de entrega (dias) <span className="text-red-500">*</span></label>
                <input
                  inputMode="numeric"
                  value={prazo}
                  onChange={e => setPrazo(e.target.value.replace(/\D/g, ''))}
                  placeholder="Ex: 7"
                  className={`w-full px-3 py-2.5 rounded-lg bg-bg border text-ink placeholder:text-ink-faint outline-none focus:border-accent ${!prazo ? 'border-red-400 ring-1 ring-red-400/30' : 'border-border'}`}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Observação <span className="text-ink-faint font-normal">(opcional)</span></label>
                <textarea
                  value={obs}
                  onChange={e => setObs(e.target.value)}
                  rows={2}
                  placeholder="Tipo de caminhão, condições, etc."
                  className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border text-ink placeholder:text-ink-faint outline-none focus:border-accent resize-none"
                />
              </div>
            </div>

            {erro && <p className="text-sm text-red-500 mb-3 text-center">{erro}</p>}

            <button
              type="button"
              onClick={enviar}
              disabled={enviando}
              className="w-full py-3 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
            >
              {enviando ? 'Enviando…' : jaRespondeu ? 'Atualizar valor' : 'Enviar cotação'}
            </button>
            <button
              type="button"
              onClick={recusar}
              className="w-full mt-2 py-2 text-sm text-ink-faint hover:text-ink underline"
            >
              Não consigo atender esse frete
            </button>
          </div>
        )}

        <p className="mt-6 text-center text-xs font-semibold tracking-widest text-ink-faint">BRANORTE · {r.codigo ?? ''}</p>
      </div>
    </div>
  )
}

export default CotarFrete
