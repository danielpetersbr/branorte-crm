// /frete/solicitar — vendedor abre um pedido de frete (RFQ). Escolhe equipamento(s)
// + destino; o sistema auto-preenche peso/cubagem, recomenda o caminhão e calcula o
// piso ANTL de referência. Ao enviar, a solicitação cai na fila do Jardel (status
// 'pendente'). Aceita prefill por querystring (vindo da extensão/orçamento):
//   ?cliente=&telefone=&uf=&cidade=&vendedor=&origem=extensao
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Truck, Plus, X, MapPin, Loader2, ArrowLeft, CheckCircle2 } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  useCatalogoFabricas, useTiposCaminhao, useAnttVigente, useMunicipiosUF,
  useCriarSolicitacao, UFS_BR, type ItemCatalogoComPeso, type FreteEquipItem,
} from '@/hooks/useFrete'
import {
  recomendarCaminhao, calcularPisoANTT, geocodificarCidade, calcularDistanciaOSRM,
  volumeM3, type Carga,
} from '@/lib/calcFrete'

const GRAO_PARA = { lat: -28.1828, lng: -49.2280 } // origem fixa Branorte

function fmtMoeda(v: number | null): string {
  if (v == null) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

type ItemSelecionado = { item: ItemCatalogoComPeso; qtd: number }

export function FreteSolicitar() {
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const catalogo = useCatalogoFabricas()
  const tipos = useTiposCaminhao()
  const antt = useAnttVigente()
  const criar = useCriarSolicitacao()

  const origem = (params.get('origem') as 'pagina' | 'extensao' | 'orcamento') || 'pagina'

  // equipamentos selecionados
  const [itens, setItens] = useState<ItemSelecionado[]>([])
  const [selId, setSelId] = useState('')
  const [selQtd, setSelQtd] = useState(1)

  // medidas manuais (alternativa ao catálogo)
  const [manual, setManual] = useState(false)
  const [mPeso, setMPeso] = useState('')
  const [mC, setMC] = useState('')
  const [mL, setML] = useState('')
  const [mA, setMA] = useState('')
  const [mIndiv, setMIndiv] = useState(true)

  // destino
  const [uf, setUf] = useState(params.get('uf') || '')
  const [cidade, setCidade] = useState(params.get('cidade') || '')
  const municipios = useMunicipiosUF(uf || null)
  const [latLng, setLatLng] = useState<{ lat: number; lng: number } | null>(null)
  const [distancia, setDistancia] = useState<number | null>(null)
  const [calcLoading, setCalcLoading] = useState(false)
  const [calcMsg, setCalcMsg] = useState('')

  // cliente / extras
  const [clienteNome, setClienteNome] = useState(params.get('cliente') || '')
  const [clienteTel, setClienteTel] = useState(params.get('telefone') || '')
  const [prazo, setPrazo] = useState('')
  const [descricao, setDescricao] = useState('')
  const [obs, setObs] = useState('')

  const [erro, setErro] = useState('')
  const [okCodigo, setOkCodigo] = useState<string | null>(null)

  // catálogo agrupado por categoria pro <select>
  const grupos = useMemo(() => {
    const m = new Map<string, ItemCatalogoComPeso[]>()
    for (const it of catalogo.data ?? []) {
      if (!m.has(it.categoria)) m.set(it.categoria, [])
      m.get(it.categoria)!.push(it)
    }
    return [...m.entries()]
  }, [catalogo.data])

  function addItem() {
    const it = (catalogo.data ?? []).find(x => String(x.id) === selId)
    if (!it) return
    setItens(prev => {
      const ex = prev.find(p => p.item.id === it.id)
      if (ex) return prev.map(p => p.item.id === it.id ? { ...p, qtd: p.qtd + selQtd } : p)
      return [...prev, { item: it, qtd: selQtd }]
    })
    setSelId(''); setSelQtd(1)
  }

  // carga agregada (catálogo OU manual)
  const carga = useMemo<Carga>(() => {
    if (itens.length) {
      let peso = 0, c = 0, l = 0, a = 0, indiv = false
      for (const { item, qtd } of itens) {
        peso += (Number(item.peso_kg) || 0) * qtd
        c = Math.max(c, Number(item.dim_comprimento_m) || 0)
        l = Math.max(l, Number(item.dim_largura_m) || 0)
        a = Math.max(a, Number(item.dim_altura_m) || 0)
        if (item.indivisivel) indiv = true
      }
      return { peso_kg: peso, comprimento_m: c, largura_m: l, altura_m: a, indivisivel: indiv }
    }
    return {
      peso_kg: Number(mPeso) || 0,
      comprimento_m: Number(mC) || 0,
      largura_m: Number(mL) || 0,
      altura_m: Number(mA) || 0,
      indivisivel: mIndiv,
    }
  }, [itens, mPeso, mC, mL, mA, mIndiv])

  const caminhao = useMemo(() => {
    if (!tipos.data || carga.comprimento_m <= 0) return null
    return recomendarCaminhao(carga, tipos.data)
  }, [tipos.data, carga])

  const pisoAntt = useMemo(() => {
    if (!caminhao || !distancia || !antt.data) return null
    const a = antt.data.find(x => x.tipo_caminhao_id === caminhao.id)
    if (!a) return null
    return calcularPisoANTT(distancia, a)
  }, [caminhao, distancia, antt.data])

  const volume = carga.comprimento_m && carga.largura_m && carga.altura_m
    ? volumeM3(carga.comprimento_m, carga.largura_m, carga.altura_m) : null

  async function calcularDestino() {
    if (!cidade.trim() || !uf) { setCalcMsg('Informe UF e cidade.'); return }
    setCalcLoading(true); setCalcMsg(''); setLatLng(null); setDistancia(null)
    const coords = await geocodificarCidade(cidade.trim(), uf)
    if (coords) {
      setLatLng(coords)
      const d = await calcularDistanciaOSRM(GRAO_PARA, coords)
      if (d) setDistancia(Math.round(d.distancia_km))
      setCalcMsg(d ? '' : 'Localizei a cidade, mas não calculei a distância. Pode digitar o km manual.')
    } else {
      setCalcMsg('Não localizei essa cidade. Confira o nome ou digite o km manual.')
    }
    setCalcLoading(false)
  }

  async function enviar() {
    setErro('')
    if (!uf || !cidade.trim()) { setErro('Informe o destino (UF + cidade).'); return }
    if (!itens.length && carga.comprimento_m <= 0 && carga.peso_kg <= 0) {
      setErro('Adicione ao menos um equipamento ou preencha as medidas manuais.'); return
    }
    const equipamentos_itens: FreteEquipItem[] = itens.map(({ item, qtd }) => ({
      catalogo_item_id: item.id,
      nome: item.nome_curto,
      qtd,
      peso_kg: item.peso_kg,
      comprimento_m: item.dim_comprimento_m,
      largura_m: item.dim_largura_m,
      altura_m: item.dim_altura_m,
      indivisivel: item.indivisivel,
    }))
    try {
      const res = await criar.mutateAsync({
        origem,
        solicitante_nome: profile?.display_name ?? null,
        vendedor_nome: params.get('vendedor') || profile?.display_name || null,
        cliente_nome: clienteNome.trim() || null,
        cliente_telefone: clienteTel.replace(/\D/g, '') || null,
        cidade_destino: cidade.trim(),
        uf_destino: uf,
        destino_lat: latLng?.lat ?? null,
        destino_lng: latLng?.lng ?? null,
        distancia_km: distancia,
        equipamentos_itens,
        descricao_carga: descricao.trim() || null,
        peso_total_kg: carga.peso_kg || null,
        comprimento_m: carga.comprimento_m || null,
        largura_m: carga.largura_m || null,
        altura_m: carga.altura_m || null,
        volume_m3: volume,
        carga_indivisivel: carga.indivisivel,
        caminhao_recomendado_id: caminhao?.id ?? null,
        valor_antt_minimo: pisoAntt,
        valor_referencia: pisoAntt ? Math.round(pisoAntt * 1.3) : null,
        prazo_desejado: prazo.trim() || null,
        observacoes: obs.trim() || null,
        status: 'pendente',
      })
      setOkCodigo(res.codigo ?? '✓')
    } catch (e: any) {
      setErro(`Não consegui salvar: ${e?.message ?? e}`)
    }
  }

  function novaSolicitacao() {
    setItens([]); setMPeso(''); setMC(''); setML(''); setMA(''); setManual(false)
    setUf(''); setCidade(''); setLatLng(null); setDistancia(null); setCalcMsg('')
    setClienteNome(''); setClienteTel(''); setPrazo(''); setDescricao(''); setObs('')
    setOkCodigo(null); setErro('')
  }

  if (okCodigo) {
    return (
      <div className="container mx-auto py-10 px-4 max-w-lg text-center">
        <div className="h-16 w-16 rounded-full bg-accent/10 mx-auto flex items-center justify-center mb-4">
          <CheckCircle2 className="h-8 w-8 text-accent" />
        </div>
        <h1 className="text-xl font-bold text-ink mb-1">Pedido de frete enviado!</h1>
        <p className="text-sm text-ink-muted mb-1">Código <b className="text-ink">{okCodigo}</b> — foi pra fila do Jardel pra aprovação e disparo às transportadoras.</p>
        <div className="flex items-center justify-center gap-2 mt-6">
          <button onClick={novaSolicitacao} className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90">Novo pedido</button>
          <Link to="/frete/aprovar" className="px-4 py-2 rounded-lg border border-border text-sm text-ink-muted hover:text-ink">Ver fila</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/frete" className="text-ink-faint hover:text-ink"><ArrowLeft className="h-5 w-5" /></Link>
        <Truck className="h-6 w-6 text-accent" />
        <h1 className="text-2xl font-bold text-ink">Pedir Frete</h1>
      </div>

      {/* Equipamentos */}
      <section className="bg-surface-1 border border-border rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">1. O que transportar</h2>
        {!manual && (
          <div className="flex flex-col sm:flex-row gap-2 mb-3">
            <select value={selId} onChange={e => setSelId(e.target.value)}
              className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent">
              <option value="">{catalogo.isLoading ? 'Carregando catálogo…' : 'Escolha um equipamento…'}</option>
              {grupos.map(([cat, lista]) => (
                <optgroup key={cat} label={cat}>
                  {lista.map(it => <option key={it.id} value={it.id}>{it.nome_curto}</option>)}
                </optgroup>
              ))}
            </select>
            <input type="number" min={1} value={selQtd} onChange={e => setSelQtd(Math.max(1, Number(e.target.value) || 1))}
              className="w-20 px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" />
            <button onClick={addItem} disabled={!selId}
              className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-40 flex items-center justify-center gap-1">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        )}

        {itens.length > 0 && (
          <div className="space-y-1.5 mb-3">
            {itens.map(({ item, qtd }) => (
              <div key={item.id} className="flex items-center justify-between bg-bg border border-border rounded-lg px-3 py-2 text-sm">
                <span className="text-ink">{qtd > 1 && <b>{qtd}× </b>}{item.nome_curto}
                  <span className="text-ink-faint text-xs ml-2">
                    {item.peso_kg ? `${item.peso_kg}kg` : ''} {item.dim_comprimento_m ? `· ${item.dim_comprimento_m}×${item.dim_largura_m}×${item.dim_altura_m}m` : ''}{item.indivisivel ? ' · indivisível' : ''}
                  </span>
                </span>
                <button onClick={() => setItens(prev => prev.filter(p => p.item.id !== item.id))} className="text-ink-faint hover:text-red-500"><X className="h-4 w-4" /></button>
              </div>
            ))}
          </div>
        )}

        <button onClick={() => setManual(m => !m)} className="text-xs text-accent hover:underline">
          {manual ? '↑ Usar catálogo' : '+ Sem catálogo / medidas manuais'}
        </button>

        {manual && (
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2">
            <div className="col-span-2 sm:col-span-1"><label className="text-xs text-ink-faint block mb-1">Peso (kg)</label>
              <input type="number" value={mPeso} onChange={e => setMPeso(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Compr. (m)</label>
              <input type="number" step="0.1" value={mC} onChange={e => setMC(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Larg. (m)</label>
              <input type="number" step="0.1" value={mL} onChange={e => setML(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Alt. (m)</label>
              <input type="number" step="0.1" value={mA} onChange={e => setMA(e.target.value)} className="w-full px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
            <label className="col-span-2 sm:col-span-1 flex items-center gap-2 text-xs text-ink-muted mt-5">
              <input type="checkbox" checked={mIndiv} onChange={e => setMIndiv(e.target.checked)} /> Indivisível
            </label>
          </div>
        )}

        <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
          placeholder="Detalhe livre da carga (opcional)…"
          className="mt-3 w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent resize-none" />
      </section>

      {/* Destino */}
      <section className="bg-surface-1 border border-border rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">2. Destino</h2>
        <div className="flex flex-col sm:flex-row gap-2 mb-2">
          <select value={uf} onChange={e => { setUf(e.target.value); setLatLng(null); setDistancia(null) }}
            className="w-full sm:w-28 px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent">
            <option value="">UF</option>
            {UFS_BR.map(u => <option key={u} value={u}>{u}</option>)}
          </select>
          <input list="municipios-frete" value={cidade} onChange={e => { setCidade(e.target.value); setLatLng(null); setDistancia(null) }}
            placeholder="Cidade de destino" disabled={!uf}
            className="flex-1 px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent disabled:opacity-50" />
          <datalist id="municipios-frete">{(municipios.data ?? []).map(m => <option key={m} value={m} />)}</datalist>
          <button onClick={calcularDestino} disabled={calcLoading || !cidade || !uf}
            className="px-4 py-2 rounded-lg border border-border text-sm text-ink-muted hover:text-ink hover:border-accent disabled:opacity-40 flex items-center justify-center gap-1.5">
            {calcLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Calcular
          </button>
        </div>
        {calcMsg && <p className="text-xs text-amber-600 mb-2">{calcMsg}</p>}
        <div className="flex items-center gap-3 text-sm">
          <label className="text-xs text-ink-faint">Distância (km)</label>
          <input type="number" value={distancia ?? ''} onChange={e => setDistancia(e.target.value ? Number(e.target.value) : null)}
            placeholder="auto" className="w-28 px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" />
          {latLng && <span className="text-xs text-accent">📍 cidade localizada</span>}
        </div>
      </section>

      {/* Resumo auto-calculado */}
      <section className="bg-surface-1 border border-border rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">3. Resumo automático</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
          <div><div className="text-xs text-ink-faint">Peso total</div><div className="text-ink font-medium">{carga.peso_kg ? `${Math.round(carga.peso_kg).toLocaleString('pt-BR')} kg` : '—'}</div></div>
          <div><div className="text-xs text-ink-faint">Volume</div><div className="text-ink font-medium">{volume ? `${volume.toFixed(1)} m³` : '—'}</div></div>
          <div><div className="text-xs text-ink-faint">Caminhão sugerido</div><div className="text-ink font-medium">{caminhao?.nome ?? '—'}</div></div>
          <div><div className="text-xs text-ink-faint">Piso ANTT (ref.)</div><div className="text-ink font-medium">{fmtMoeda(pisoAntt)}</div></div>
        </div>
        {carga.indivisivel && <p className="text-xs text-accent mt-2">Carga indivisível — será cotada como carga completa.</p>}
        <p className="text-[11px] text-ink-faint mt-2">O piso ANTT é só referência interna pro Jardel. As transportadoras é que vão preencher o valor real.</p>
      </section>

      {/* Cliente + extras */}
      <section className="bg-surface-1 border border-border rounded-xl p-4 mb-4">
        <h2 className="text-sm font-semibold text-ink mb-3">4. Cliente & prazo</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="text-xs text-ink-faint block mb-1">Cliente (opcional)</label>
            <input value={clienteNome} onChange={e => setClienteNome(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
          <div><label className="text-xs text-ink-faint block mb-1">WhatsApp do cliente (opcional)</label>
            <input value={clienteTel} onChange={e => setClienteTel(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
          <div><label className="text-xs text-ink-faint block mb-1">Prazo desejado (opcional)</label>
            <input value={prazo} onChange={e => setPrazo(e.target.value)} placeholder="Ex: até 15 dias" className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
          <div><label className="text-xs text-ink-faint block mb-1">Observações (opcional)</label>
            <input value={obs} onChange={e => setObs(e.target.value)} className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" /></div>
        </div>
      </section>

      {erro && <p className="text-sm text-red-500 mb-3">{erro}</p>}

      <button onClick={enviar} disabled={criar.isPending}
        className="w-full py-3 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-60">
        {criar.isPending ? 'Enviando…' : 'Enviar pedido de frete'}
      </button>
    </div>
  )
}

export default FreteSolicitar
