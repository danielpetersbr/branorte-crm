// /frete/solicitar — vendedor abre um pedido de frete (RFQ). Cadastra os itens a
// transportar (manual OU puxando do catálogo, que auto-preenche as medidas) + destino;
// o sistema auto-preenche peso/cubagem, recomenda o caminhão e calcula o piso ANTT de
// referência. Ao enviar, a solicitação cai na fila do Jardel (status 'pendente').
// Aceita prefill por querystring (vindo da extensão/orçamento):
//   ?cliente=&telefone=&uf=&cidade=&vendedor=&origem=extensao
import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Truck, Plus, X, MapPin, Loader2, ArrowLeft, CheckCircle2, Package } from 'lucide-react'
import { useAuth } from '@/hooks/useAuth'
import {
  useFreteCatalogoItens, useTiposCaminhao, useAnttVigente, useMunicipiosUF,
  useCriarSolicitacao, UFS_BR, type FreteCatalogoItem, type FreteEquipItem,
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

function novoUid(): string {
  return `it_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`
}

// Item da carga (unificado): pode vir do catálogo (catalogo_item_id != null, medidas
// pré-preenchidas) ou ser 100% manual (catalogo_item_id = null).
type FreteItemLocal = {
  uid: string
  nome: string
  qtd: number
  peso_kg: number
  comprimento_m: number
  largura_m: number
  altura_m: number
  indivisivel: boolean
  catalogo_item_id: number | null
}

const FORM_VAZIO = { nome: '', c: '', l: '', a: '', peso: '', qtd: '1', indiv: false, catId: null as number | null }

export function FreteSolicitar() {
  const [params] = useSearchParams()
  const { profile } = useAuth()
  const catalogo = useFreteCatalogoItens()
  const tipos = useTiposCaminhao()
  const antt = useAnttVigente()
  const criar = useCriarSolicitacao()

  // Esta tela fica com fundo branco (não o cinza padrão da página). Só no tema claro;
  // restaura o fundo original ao sair da tela.
  useEffect(() => {
    if (document.documentElement.classList.contains('dark')) return
    const prev = document.body.style.backgroundColor
    document.body.style.backgroundColor = '#fff'
    return () => { document.body.style.backgroundColor = prev }
  }, [])

  const origem = (params.get('origem') as 'pagina' | 'extensao' | 'orcamento') || 'pagina'

  // itens a transportar (unificado: manual + catálogo)
  const [itens, setItens] = useState<FreteItemLocal[]>([])
  const [form, setForm] = useState(FORM_VAZIO)

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
  const [descricao, setDescricao] = useState('')
  const [obs, setObs] = useState('')
  // tipo do pedido: 'cotacao' = só previsão de valor (base); 'carregar' = vai mandar.
  const [tipoCotacao, setTipoCotacao] = useState<'cotacao' | 'carregar'>('cotacao')
  const [urgente, setUrgente] = useState(false)

  const [erro, setErro] = useState('')
  const [okCodigo, setOkCodigo] = useState<string | null>(null)

  const catItens: FreteCatalogoItem[] = catalogo.data ?? []

  // Atalho: escolher um item do catálogo de frete preenche o formulário (o usuário ainda
  // pode ajustar antes de adicionar). Não adiciona sozinho — só preenche.
  function puxarDoCatalogo(id: string) {
    const it = catItens.find(x => String(x.id) === id)
    if (!it) return
    setForm({
      nome: it.nome,
      c: it.comprimento_m != null ? String(it.comprimento_m) : '',
      l: it.largura_m != null ? String(it.largura_m) : '',
      a: it.altura_m != null ? String(it.altura_m) : '',
      peso: it.peso_kg != null ? String(it.peso_kg) : '',
      qtd: form.qtd || '1',
      indiv: !!it.indivisivel,
      catId: null,
    })
  }

  function addItem() {
    const nome = form.nome.trim()
    const c = Number(form.c) || 0, l = Number(form.l) || 0, a = Number(form.a) || 0
    const peso = Number(form.peso) || 0
    const qtd = Math.max(1, Number(form.qtd) || 1)
    if (!nome && c <= 0 && peso <= 0) {
      setErro('Preencha pelo menos o nome ou as medidas do item.'); return
    }
    setErro('')
    setItens(prev => [...prev, {
      uid: novoUid(),
      nome: nome || 'Item',
      qtd,
      peso_kg: peso,
      comprimento_m: c,
      largura_m: l,
      altura_m: a,
      indivisivel: form.indiv,
      catalogo_item_id: form.catId,
    }])
    setForm(FORM_VAZIO)
  }

  function removerItem(uid: string) {
    setItens(prev => prev.filter(p => p.uid !== uid))
  }

  // Carga agregada pra recomendar caminhão e calcular ANTT:
  // peso = soma (qtd × peso); dimensões = MAIOR de cada eixo (precisa caber a maior peça);
  // indivisível = se qualquer item for indivisível.
  const carga = useMemo<Carga>(() => {
    if (!itens.length) return { peso_kg: 0, comprimento_m: 0, largura_m: 0, altura_m: 0, indivisivel: false }
    let peso = 0, c = 0, l = 0, a = 0, indiv = false
    for (const it of itens) {
      peso += it.peso_kg * it.qtd
      c = Math.max(c, it.comprimento_m)
      l = Math.max(l, it.largura_m)
      a = Math.max(a, it.altura_m)
      if (it.indivisivel) indiv = true
    }
    return { peso_kg: peso, comprimento_m: c, largura_m: l, altura_m: a, indivisivel: indiv }
  }, [itens])

  // Volume total da carga = soma do volume de cada item × qtd.
  const volumeTotal = useMemo(
    () => itens.reduce((s, it) => s + volumeM3(it.comprimento_m, it.largura_m, it.altura_m) * it.qtd, 0),
    [itens],
  )
  const volume = volumeTotal > 0 ? volumeTotal : null

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
    if (!itens.length) { setErro('Adicione ao menos um item a transportar.'); return }
    const equipamentos_itens: FreteEquipItem[] = itens.map(it => ({
      catalogo_item_id: it.catalogo_item_id,
      nome: it.nome,
      qtd: it.qtd,
      peso_kg: it.peso_kg || null,
      comprimento_m: it.comprimento_m || null,
      largura_m: it.largura_m || null,
      altura_m: it.altura_m || null,
      indivisivel: it.indivisivel,
    }))
    try {
      const res = await criar.mutateAsync({
        origem,
        solicitante_nome: profile?.display_name ?? null,
        vendedor_nome: params.get('vendedor') || profile?.display_name || null,
        cliente_nome: clienteNome.trim() || null,
        cliente_telefone: null,
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
        prazo_desejado: null,
        observacoes: obs.trim() || null,
        tipo_cotacao: tipoCotacao,
        urgente,
        status: 'pendente',
      })
      setOkCodigo(res.codigo ?? '✓')
    } catch (e: any) {
      setErro(`Não consegui salvar: ${e?.message ?? e}`)
    }
  }

  function novaSolicitacao() {
    setItens([]); setForm(FORM_VAZIO)
    setUf(''); setCidade(''); setLatLng(null); setDistancia(null); setCalcMsg('')
    setClienteNome(''); setDescricao(''); setObs(''); setTipoCotacao('cotacao'); setUrgente(false)
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

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent'
  const miniInputCls = 'w-full px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent'
  const secLabel = 'text-[11px] font-semibold uppercase tracking-wider text-ink-muted mb-3 flex items-center gap-1.5'
  const reqRing = (empty: boolean) => empty ? 'border-red-400 ring-1 ring-red-400/30' : 'border-border'

  return (
    <div className="max-w-[1760px] mx-auto px-5 lg:px-8 py-5 pb-24">
      {/* Header */}
      <div className="flex items-center gap-3 mb-4">
        <Link to="/frete" className="text-ink-faint hover:text-ink"><ArrowLeft className="h-5 w-5" /></Link>
        <Truck className="h-5 w-5 text-accent" />
        <h1 className="text-xl font-semibold text-ink">Pedir Frete</h1>
        <Link to="/frete/itens" className="ml-auto text-xs text-ink-muted hover:text-accent flex items-center gap-1"><Package className="h-3.5 w-3.5" /> Itens de frete</Link>
      </div>

      {/* Tipo do pedido + urgente — fica visível pra quem cota (Jardel/transportadora) */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="inline-flex rounded-lg border border-border overflow-hidden text-sm">
          <button type="button" onClick={() => setTipoCotacao('cotacao')}
            className={`px-3.5 py-1.5 font-medium transition-colors ${tipoCotacao === 'cotacao' ? 'bg-accent text-white' : 'bg-white dark:bg-surface text-ink-muted hover:text-ink'}`}>
            Cotação
          </button>
          <button type="button" onClick={() => setTipoCotacao('carregar')}
            className={`px-3.5 py-1.5 font-medium transition-colors ${tipoCotacao === 'carregar' ? 'bg-red-500 text-white' : 'bg-white dark:bg-surface text-ink-muted hover:text-ink'}`}>
            Pra carregar
          </button>
        </div>
        <button type="button" onClick={() => setUrgente(u => !u)}
          className={`px-3 py-1.5 rounded-lg border text-sm font-medium transition-colors ${urgente ? 'bg-red-500/15 border-red-500/40 text-red-500' : 'bg-white dark:bg-surface border-border text-ink-muted hover:text-ink'}`}>
          {urgente ? '⚠ Urgente' : 'Marcar urgente'}
        </button>
        <span className="text-xs text-ink-faint">
          {tipoCotacao === 'cotacao' ? 'Só previsão de valor (base) — não vai carregar ainda.' : 'Pra carregar — já é pra mandar de verdade.'}
        </span>
      </div>

      {/* Resumo — barra de indicadores (hairline cells) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px bg-border rounded-xl overflow-hidden border border-border">
        <div className="bg-white dark:bg-surface px-4 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Peso total</div>
          <div className="text-[15px] font-semibold text-ink mt-0.5">{carga.peso_kg ? `${Math.round(carga.peso_kg).toLocaleString('pt-BR')} kg` : '—'}</div>
        </div>
        <div className="bg-white dark:bg-surface px-4 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Volume</div>
          <div className="text-[15px] font-semibold text-ink mt-0.5">{volume ? `${volume.toFixed(1)} m³` : '—'}</div>
        </div>
        <div className="bg-white dark:bg-surface px-4 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Caminhão sugerido</div>
          <div className="text-[15px] font-semibold text-ink mt-0.5">{caminhao?.nome ?? '—'}</div>
        </div>
        <div className="bg-white dark:bg-surface px-4 py-2.5">
          <div className="text-[10px] uppercase tracking-wider text-ink-faint">Piso ANTT (ref.)</div>
          <div className="text-[15px] font-semibold text-ink mt-0.5">{fmtMoeda(pisoAntt)}</div>
        </div>
      </div>
      <p className="text-[11px] text-ink-faint mt-2 mb-4">
        {carga.indivisivel ? <span className="text-accent">Carga indivisível — cotada como carga completa. </span> : null}
        O piso ANTT é referência interna pro Jardel; as transportadoras preenchem o valor real.
      </p>

      {/* Conteúdo: 3 colunas preenchendo a largura */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* Destino */}
        <section className="order-2 xl:order-1 xl:col-span-3 bg-white dark:bg-surface border border-border rounded-xl p-4">
          <h2 className={secLabel}><MapPin className="h-4 w-4 text-accent" /> Destino <span className="text-red-500 ml-0.5">*</span></h2>
          <div className="space-y-2">
            <div className="flex gap-2">
              <select value={uf} onChange={e => { setUf(e.target.value); setLatLng(null); setDistancia(null) }}
                className={`w-24 px-3 py-2 rounded-lg bg-bg border text-ink text-sm outline-none focus:border-accent ${reqRing(!uf)}`}>
                <option value="">UF</option>
                {UFS_BR.map(u => <option key={u} value={u}>{u}</option>)}
              </select>
              <input list="municipios-frete" value={cidade} onChange={e => { setCidade(e.target.value); setLatLng(null); setDistancia(null) }}
                placeholder="Cidade de destino" disabled={!uf}
                className={`flex-1 min-w-0 px-3 py-2 rounded-lg bg-bg border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent disabled:opacity-50 ${reqRing(!cidade.trim())}`} />
              <datalist id="municipios-frete">{(municipios.data ?? []).map(m => <option key={m} value={m} />)}</datalist>
            </div>
            <button onClick={calcularDestino} disabled={calcLoading || !cidade || !uf}
              className="w-full px-4 py-2 rounded-lg border border-border text-sm text-ink-muted hover:text-ink hover:border-accent disabled:opacity-40 flex items-center justify-center gap-1.5">
              {calcLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />} Calcular distância
            </button>
            {calcMsg && <p className="text-xs text-amber-600">{calcMsg}</p>}
            <div className="flex items-center gap-2">
              <label className="text-xs text-ink-faint whitespace-nowrap">Distância (km)</label>
              <input type="number" value={distancia ?? ''} onChange={e => setDistancia(e.target.value ? Number(e.target.value) : null)}
                placeholder="auto" className="w-24 px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm outline-none focus:border-accent" />
              {latLng && <span className="text-xs text-accent">📍 localizada</span>}
            </div>
          </div>
        </section>

        {/* Cliente */}
        <section className="order-3 xl:order-2 xl:col-span-4 bg-white dark:bg-surface border border-border rounded-xl p-4">
          <h2 className={secLabel}>Cliente</h2>
          <div className="space-y-3">
            <div><label className="text-xs text-ink-faint block mb-1">Nome do cliente (opcional)</label>
              <input value={clienteNome} onChange={e => setClienteNome(e.target.value)} placeholder="Quem é o cliente do frete" className={inputCls} /></div>
            <div><label className="text-xs text-ink-faint block mb-1">Observação / motivo (opcional)</label>
              <textarea value={obs} onChange={e => setObs(e.target.value)} rows={3} placeholder="Ex.: cliente quer só uma base de preço pra fechar a venda…"
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent resize-none" /></div>
          </div>
        </section>

        {/* O que transportar (cadastro de itens) */}
        <section className="order-1 xl:order-3 xl:col-span-5 bg-white dark:bg-surface border border-border rounded-xl p-4">
          <h2 className={secLabel}><Package className="h-4 w-4 text-accent" /> O que transportar <span className="text-red-500 ml-0.5">*</span></h2>

            {/* Formulário de cadastro de item */}
            <div className="space-y-2">
              <select value="" onChange={e => puxarDoCatalogo(e.target.value)}
                className="w-full px-3 py-2 rounded-lg bg-bg border border-dashed border-border text-ink-muted text-sm outline-none focus:border-accent">
                <option value="">{catalogo.isLoading ? 'Carregando…' : (catItens.length ? '+ Puxar do catálogo (preenche medidas)…' : 'Catálogo de frete vazio — cadastre em “Itens de frete”')}</option>
                {catItens.map(it => <option key={it.id} value={it.id}>{it.nome}</option>)}
              </select>

              <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value, catId: f.catId }))}
                placeholder="Nome do item (ex: Misturador 300)" className={inputCls} />

              <div className="grid grid-cols-3 gap-2">
                <div><label className="text-[10px] text-ink-faint block mb-0.5">Compr. (m)</label>
                  <input type="number" step="0.1" min={0} value={form.c} onChange={e => setForm(f => ({ ...f, c: e.target.value }))} className={miniInputCls} placeholder="0" /></div>
                <div><label className="text-[10px] text-ink-faint block mb-0.5">Larg. (m)</label>
                  <input type="number" step="0.1" min={0} value={form.l} onChange={e => setForm(f => ({ ...f, l: e.target.value }))} className={miniInputCls} placeholder="0" /></div>
                <div><label className="text-[10px] text-ink-faint block mb-0.5">Alt. (m)</label>
                  <input type="number" step="0.1" min={0} value={form.a} onChange={e => setForm(f => ({ ...f, a: e.target.value }))} className={miniInputCls} placeholder="0" /></div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div><label className="text-[10px] text-ink-faint block mb-0.5">Peso (kg)</label>
                  <input type="number" min={0} value={form.peso} onChange={e => setForm(f => ({ ...f, peso: e.target.value }))} className={miniInputCls} placeholder="0" /></div>
                <div><label className="text-[10px] text-ink-faint block mb-0.5">Qtd</label>
                  <input type="number" min={1} value={form.qtd} onChange={e => setForm(f => ({ ...f, qtd: e.target.value }))} className={miniInputCls} /></div>
              </div>

              <label className="flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" checked={form.indiv} onChange={e => setForm(f => ({ ...f, indiv: e.target.checked }))} /> Indivisível (não pode desmontar)
              </label>

              <button onClick={addItem}
                className="w-full px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 flex items-center justify-center gap-1">
                <Plus className="h-4 w-4" /> Adicionar item
              </button>
            </div>

            {/* Lista de itens cadastrados */}
            <div className="mt-4 space-y-1.5">
              {itens.length === 0 && (
                <div className="text-xs text-red-500 text-center border border-dashed border-red-400/50 rounded-lg py-5">
                  Adicione ao menos 1 item.<br />Manual ou puxando do catálogo.
                </div>
              )}
              {itens.map(it => {
                const vol = volumeM3(it.comprimento_m, it.largura_m, it.altura_m) * it.qtd
                const temDim = it.comprimento_m > 0 || it.largura_m > 0 || it.altura_m > 0
                return (
                  <div key={it.uid} className="flex items-start justify-between gap-2 bg-bg border border-border rounded-lg px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="text-ink truncate">{it.qtd > 1 && <b>{it.qtd}× </b>}{it.nome}</div>
                      <div className="text-ink-faint text-xs">
                        {temDim ? `${it.comprimento_m}×${it.largura_m}×${it.altura_m}m` : 'sem medidas'}
                        {it.peso_kg ? ` · ${it.peso_kg}kg` : ''}
                        {vol > 0 ? ` · ${vol.toFixed(2)}m³` : ''}
                        {it.indivisivel ? ' · indivisível' : ''}
                      </div>
                    </div>
                    <button onClick={() => removerItem(it.uid)} className="text-ink-faint hover:text-red-500 shrink-0"><X className="h-4 w-4" /></button>
                  </div>
                )
              })}
            </div>

            {/* Totais */}
            {itens.length > 0 && (
              <div className="mt-3 pt-2 border-t border-border flex items-center justify-between text-xs">
                <span className="text-ink-muted">Totais ({itens.length} {itens.length === 1 ? 'item' : 'itens'})</span>
                <span className="text-ink font-medium">{Math.round(carga.peso_kg).toLocaleString('pt-BR')} kg · {volumeTotal.toFixed(2)} m³</span>
              </div>
            )}

            {/* Detalhe livre */}
            <div className="mt-3">
              <label className="text-xs text-ink-faint block mb-1">Detalhe livre da carga (opcional)</label>
              <textarea value={descricao} onChange={e => setDescricao(e.target.value)} rows={2}
                placeholder="Ex.: cuidado com a pintura, leva 2 escadas juntas…"
                className="w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent resize-none" />
            </div>
        </section>
      </div>

      {/* Barra de ação fixa */}
      <div className="sticky bottom-0 -mx-5 lg:-mx-8 mt-4 px-5 lg:px-8 py-3 bg-white/85 dark:bg-bg/85 backdrop-blur border-t border-border flex items-center gap-4 z-10">
        <div className="text-xs text-ink-muted">
          {itens.length
            ? `${itens.length} ${itens.length === 1 ? 'item' : 'itens'} · ${Math.round(carga.peso_kg).toLocaleString('pt-BR')} kg · ${volumeTotal.toFixed(2)} m³`
            : 'Nenhum item adicionado ainda'}
        </div>
        {erro && <span className="text-xs text-red-500">{erro}</span>}
        <button onClick={enviar} disabled={criar.isPending}
          className="ml-auto px-6 py-2.5 rounded-lg bg-accent text-white text-sm font-semibold hover:opacity-90 disabled:opacity-60">
          {criar.isPending ? 'Enviando…' : 'Enviar pedido de frete'}
        </button>
      </div>
    </div>
  )
}

export default FreteSolicitar
