// /frete - Calculadora de Cotacao de Frete Branorte
// Sistema autonomo (sem integracao com /orcamentos/montar).
// 4 metodos de entrada: por equipamento (Compactas) / dimensoes / pallets / carga fechada.
// 4 estimativas comparativas: Modelo Branorte (planilha real) / ANTT (legal) / Parceiras / Historico.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Truck, MapPin, Loader2, AlertTriangle, Plus, Trash2,
  Package, Scale, Sparkles, History, Building2, Save, FileText,
  Factory, Layers, ChevronRight,
} from 'lucide-react'
import {
  recomendarCaminhao,
  calcularPisoANTT,
  calcularParceira,
  calcularModeloBranorte,
  isDestinoNorte,
  sugerirModoCargaBranorte,
  volumeM3,
  calcularDistanciaBranortePara,
  type DistanciaResultado,
  type TipoCaminhao,
  type Carga,
} from '@/lib/calcFrete'
import {
  useTiposCaminhao,
  useAnttVigente,
  useTransportadoras,
  useMediaHistorica,
  useCatalogoFabricas,
  useModeloBranorte,
  useSalvarCotacao,
  type ItemCatalogoComPeso,
} from '@/hooks/useFrete'

type Aba = 'equipamento' | 'dimensoes' | 'pallets' | 'fechada'

type LinhaEquipamento = {
  uid: string
  item: ItemCatalogoComPeso | null
  qtd: number
}

function formatBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

const MODOS_CARGA_LABELS: Record<string, string> = {
  fracionada_2p: 'Fracionada 2 paletes',
  fracionada_4p: 'Fracionada 4 paletes',
  completa: 'Carga completa',
}

export default function FreteCotacao() {
  // ── Dados base ──
  const tipos = useTiposCaminhao()
  const antts = useAnttVigente()
  const modeloBN = useModeloBranorte()
  const parceiras = useTransportadoras()
  const catalogo = useCatalogoFabricas()
  const salvar = useSalvarCotacao()

  // ── Inputs gerais ──
  const [clienteNome, setClienteNome] = useState('')
  const [cep, setCep] = useState('')
  const [aba, setAba] = useState<Aba>('equipamento')
  const [distancia, setDistancia] = useState<DistanciaResultado | null>(null)
  const [loadingDist, setLoadingDist] = useState(false)
  const [errDist, setErrDist] = useState<string | null>(null)
  const [kmManual, setKmManual] = useState<string>('')

  // ── Aba: por equipamento ──
  const [linhasEquip, setLinhasEquip] = useState<LinhaEquipamento[]>([
    { uid: crypto.randomUUID(), item: null, qtd: 1 },
  ])

  // ── Aba: por dimensoes ──
  const [dimPeso, setDimPeso] = useState<string>('')
  const [dimComp, setDimComp] = useState<string>('')
  const [dimLarg, setDimLarg] = useState<string>('')
  const [dimAlt, setDimAlt] = useState<string>('')
  const [dimIndivisivel, setDimIndivisivel] = useState<boolean>(false)

  // ── Aba: pallets ──
  const [palQtd, setPalQtd] = useState<string>('1')
  const [palPeso, setPalPeso] = useState<string>('800')
  const [palAltura, setPalAltura] = useState<string>('1.4')

  // ── Aba: carga fechada (novo) ──
  const [fechadaTipo, setFechadaTipo] = useState<'TRUCK' | 'CARRETA'>('CARRETA')
  const [fechadaModo, setFechadaModo] = useState<'fracionada_2p' | 'fracionada_4p' | 'completa'>('completa')

  // ── Resultado / decisao ──
  const [valorFinal, setValorFinal] = useState<string>('')
  const [parceiraEscolhidaId, setParceiraEscolhidaId] = useState<number | null>(null)
  const [margem, setMargem] = useState<string>('1.3')
  const [observacoes, setObservacoes] = useState('')

  async function buscarDistancia() {
    const cepLimpo = cep.replace(/\D/g, '')
    if (cepLimpo.length !== 8) {
      setErrDist('CEP precisa ter 8 dígitos')
      return
    }
    setLoadingDist(true)
    setErrDist(null)
    setDistancia(null)
    try {
      const res = await calcularDistanciaBranortePara(cep)
      if (!res) {
        setErrDist('Não consegui calcular a distância. Digite km manualmente abaixo.')
      } else {
        setDistancia(res)
        setKmManual(String(res.distancia_km))
      }
    } catch {
      setErrDist('Erro ao consultar APIs de mapas. Tente novamente ou digite km manual.')
    } finally {
      setLoadingDist(false)
    }
  }

  // ── Calcula a carga total conforme aba ativa ──
  const carga = useMemo<Carga | null>(() => {
    if (aba === 'equipamento') {
      const itens = linhasEquip.filter(l => l.item && l.qtd > 0)
      if (itens.length === 0) return null
      let peso = 0, comp = 0, larg = 0, alt = 0, indiv = false
      for (const l of itens) {
        const it = l.item!
        peso += (it.peso_kg ?? 0) * l.qtd
        comp = Math.max(comp, it.dim_comprimento_m ?? 0)
        larg = Math.max(larg, it.dim_largura_m ?? 0)
        alt = Math.max(alt, it.dim_altura_m ?? 0)
        if (it.indivisivel) indiv = true
      }
      if (peso === 0) return null
      return { peso_kg: peso, comprimento_m: comp, largura_m: larg, altura_m: alt, indivisivel: indiv }
    }
    if (aba === 'dimensoes') {
      const p = Number(dimPeso); const c = Number(dimComp); const l = Number(dimLarg); const a = Number(dimAlt)
      if (!Number.isFinite(p) || p <= 0) return null
      return { peso_kg: p, comprimento_m: c || 0, largura_m: l || 0, altura_m: a || 0, indivisivel: dimIndivisivel }
    }
    if (aba === 'pallets') {
      const q = Number(palQtd); const pp = Number(palPeso); const ah = Number(palAltura)
      if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(pp) || pp <= 0) return null
      return {
        peso_kg: q * pp,
        comprimento_m: q * 1.2,
        largura_m: 1.0,
        altura_m: ah || 1.4,
        indivisivel: false,
      }
    }
    // aba === 'fechada': carga = capacidade maxima do caminhao escolhido
    const tipoMatch = tipos.data?.find(t => {
      if (fechadaTipo === 'TRUCK') return t.nome === 'Truck'
      // CARRETA: pega a Carreta 2 eixos (padrao)
      return t.nome === 'Carreta 2 eixos'
    })
    if (!tipoMatch) return null
    return {
      peso_kg: tipoMatch.peso_max_kg,
      comprimento_m: tipoMatch.comprimento_util_m,
      largura_m: tipoMatch.largura_util_m,
      altura_m: tipoMatch.altura_util_m,
      indivisivel: false,
    }
  }, [aba, linhasEquip, dimPeso, dimComp, dimLarg, dimAlt, dimIndivisivel, palQtd, palPeso, palAltura, fechadaTipo, tipos.data])

  // ── Recomendar caminhao ──
  const caminhao = useMemo(() => {
    if (!carga || !tipos.data) return null
    return recomendarCaminhao(carga, tipos.data)
  }, [carga, tipos.data])

  // Sempre que muda a aba "fechada", força o caminhão correspondente
  const caminhaoEfetivo = useMemo(() => {
    if (aba === 'fechada' && tipos.data) {
      const t = tipos.data.find(t => t.nome === (fechadaTipo === 'TRUCK' ? 'Truck' : 'Carreta 2 eixos'))
      return t ?? caminhao
    }
    return caminhao
  }, [aba, fechadaTipo, tipos.data, caminhao])

  const distanciaKm = useMemo(() => {
    const m = Number(kmManual)
    if (Number.isFinite(m) && m > 0) return m
    return distancia?.distancia_km ?? null
  }, [kmManual, distancia])

  // ── Estimativa 1: Modelo Branorte ──
  const modoCargaBranorte = useMemo<'fracionada_2p' | 'fracionada_4p' | 'completa'>(() => {
    if (aba === 'fechada') return fechadaModo
    if (aba === 'pallets') {
      const q = Number(palQtd) || 0
      return sugerirModoCargaBranorte(carga?.peso_kg ?? 0, q)
    }
    return sugerirModoCargaBranorte(carga?.peso_kg ?? 0)
  }, [aba, fechadaModo, palQtd, carga])

  const tipoCaminhaoBranorte = useMemo<'TRUCK' | 'CARRETA'>(() => {
    if (aba === 'fechada') return fechadaTipo
    if (!caminhaoEfetivo) return 'CARRETA'
    // Truck ate 14 ton; acima disso vai Carreta
    return caminhaoEfetivo.peso_max_kg <= 14000 ? 'TRUCK' : 'CARRETA'
  }, [aba, fechadaTipo, caminhaoEfetivo])

  const valorModeloBranorte = useMemo(() => {
    if (!distanciaKm || !modeloBN.data || !distancia) return null
    // Tenta achar row exata. Se TRUCK não tem fracionada_2p, cai pra 4p.
    let row = modeloBN.data.find(
      m => m.tipo_caminhao === tipoCaminhaoBranorte && m.modo_carga === modoCargaBranorte,
    )
    if (!row && tipoCaminhaoBranorte === 'TRUCK' && modoCargaBranorte === 'fracionada_2p') {
      row = modeloBN.data.find(m => m.tipo_caminhao === 'TRUCK' && m.modo_carga === 'fracionada_4p')
    }
    if (!row) return null
    const calc = calcularModeloBranorte(distanciaKm, distancia.destino.uf, row)
    return { row, ...calc }
  }, [distanciaKm, modeloBN.data, distancia, tipoCaminhaoBranorte, modoCargaBranorte])

  // ── Estimativa 2: ANTT ──
  const valorAntt = useMemo(() => {
    if (!caminhaoEfetivo || !distanciaKm || !antts.data) return null
    const antt = antts.data.find(a => a.tipo_caminhao_id === caminhaoEfetivo.id)
    if (!antt) return null
    const piso = calcularPisoANTT(distanciaKm, antt)
    const m = Number(margem) || 1
    return { piso, com_margem: piso * m }
  }, [caminhaoEfetivo, distanciaKm, antts.data, margem])

  // ── Estimativa 3: Parceiras ──
  const estimativasParceiras = useMemo(() => {
    if (!caminhaoEfetivo || !distanciaKm || !parceiras.data || !distancia) return []
    return parceiras.data
      .filter(p => p.ativo)
      .map(p => ({
        parceira: p,
        valor: calcularParceira(distanciaKm, distancia.destino.uf, caminhaoEfetivo, p),
      }))
      .filter(x => x.valor != null)
  }, [caminhaoEfetivo, distanciaKm, parceiras.data, distancia])

  // ── Estimativa 4: Histórico ──
  const mediaHist = useMediaHistorica(caminhaoEfetivo?.id ?? null, distancia?.destino.uf ?? null, distanciaKm)

  const aplicouRetornoSulNorte = distancia ? isDestinoNorte(distancia.destino.uf) : false

  async function handleSalvar() {
    if (!carga || !caminhaoEfetivo || !distancia || !distanciaKm) {
      alert('Faltam dados pra salvar: cliente, CEP, carga e caminhão recomendado.')
      return
    }
    const vf = Number(valorFinal)
    if (!Number.isFinite(vf) || vf <= 0) {
      alert('Informe o valor final escolhido.')
      return
    }
    try {
      await salvar.mutateAsync({
        cliente_nome: clienteNome || null,
        cep_destino: cep,
        cidade_destino: distancia.destino.cidade,
        uf_destino: distancia.destino.uf,
        distancia_km: distanciaKm,
        tempo_viagem_horas: distancia.tempo_horas,
        metodo_entrada: aba === 'fechada' ? 'dimensoes' : aba,
        peso_total_kg: carga.peso_kg,
        comprimento_m: carga.comprimento_m,
        largura_m: carga.largura_m,
        altura_m: carga.altura_m,
        volume_m3: volumeM3(carga.comprimento_m, carga.largura_m, carga.altura_m),
        carga_indivisivel: carga.indivisivel,
        equipamentos_itens: aba === 'equipamento'
          ? linhasEquip.filter(l => l.item).map(l => ({ id: l.item!.id, nome: l.item!.nome_curto, qtd: l.qtd, peso: l.item!.peso_kg }))
          : aba === 'fechada'
            ? { modo: 'carga_fechada', tipo: fechadaTipo, modo_carga: fechadaModo }
            : null,
        caminhao_recomendado_id: caminhaoEfetivo.id,
        valor_antt_minimo: valorAntt?.piso ?? null,
        valor_parceira_escolhida_id: parceiraEscolhidaId,
        valor_parceira_escolhida: parceiraEscolhidaId
          ? estimativasParceiras.find(x => x.parceira.id === parceiraEscolhidaId)?.valor ?? null
          : null,
        valor_historico_medio: mediaHist.data ?? null,
        margem_aplicada: Number(margem) || null,
        valor_final: vf,
        observacoes: observacoes || null,
      })
      alert('Cotação salva!')
      setValorFinal('')
      setObservacoes('')
      setParceiraEscolhidaId(null)
    } catch (e: any) {
      alert(`Erro ao salvar: ${e?.message ?? e}`)
    }
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-5xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 bg-gradient-to-br from-primary via-primary to-primary/70 rounded-2xl flex items-center justify-center shadow-lg shadow-primary/40">
            <Truck className="h-6 w-6 text-primary-foreground" strokeWidth={2.5} />
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight">Cotação de Frete</h1>
            <div className="text-xs text-muted-foreground">Estimativa pra negociação · Branorte/SC</div>
          </div>
        </div>
        <div className="flex gap-1">
          <Link
            to="/frete/historico"
            className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <History className="h-3.5 w-3.5" />
            Histórico
          </Link>
          <Link
            to="/frete/transportadoras"
            className="px-3 py-1.5 text-xs font-semibold text-muted-foreground hover:text-primary hover:bg-primary/5 rounded-lg transition-colors flex items-center gap-1.5"
          >
            <Building2 className="h-3.5 w-3.5" />
            Transportadoras
          </Link>
        </div>
      </div>

      {/* Cliente + CEP */}
      <div className="bg-card border rounded-xl p-4 mb-4 space-y-3">
        <div>
          <label className="text-sm font-semibold block mb-1.5">Cliente (opcional)</label>
          <input
            type="text"
            value={clienteNome}
            onChange={e => setClienteNome(e.target.value)}
            placeholder="Nome do cliente / fazenda"
            className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-sm font-semibold block mb-1.5">CEP destino</label>
            <input
              type="text"
              value={cep}
              onChange={e => setCep(e.target.value)}
              placeholder="00000-000"
              className="w-full border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
              maxLength={9}
            />
          </div>
          <button
            type="button"
            onClick={buscarDistancia}
            disabled={loadingDist}
            className="px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-bold hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2 shadow-sm hover:shadow transition-all"
          >
            {loadingDist ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
            Buscar
          </button>
        </div>
        {errDist && (
          <div className="text-xs text-amber-600 flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> {errDist}
          </div>
        )}
        {distancia && (
          <div className="flex items-center gap-2 p-3 bg-primary/5 border border-primary/20 rounded-lg text-sm">
            <ChevronRight className="h-4 w-4 text-primary" />
            <div className="flex-1">
              <b className="text-foreground">{distancia.destino.cidade}/{distancia.destino.uf}</b>
              {' · '}<span className="tabular-nums">{distancia.distancia_km.toLocaleString('pt-BR')} km</span>
              {' · '}<span className="text-muted-foreground">~{distancia.tempo_horas}h de viagem</span>
            </div>
            {isDestinoNorte(distancia.destino.uf) && (
              <div className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 rounded text-xs font-semibold">
                ↓50% retorno
              </div>
            )}
          </div>
        )}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Ajuste manual de km (se necessário)</label>
          <input
            type="number"
            value={kmManual}
            onChange={e => setKmManual(e.target.value)}
            placeholder="Km"
            className="w-32 border rounded px-3 py-1 text-sm bg-background tabular-nums"
          />
        </div>
      </div>

      {/* Abas */}
      <div className="bg-card border rounded-xl p-4 mb-4">
        <div className="flex gap-1 border-b mb-4 -mx-4 px-4 overflow-x-auto">
          {([
            ['equipamento', 'Por fábrica', Factory],
            ['dimensoes', 'Por dimensões', Package],
            ['pallets', 'Por pallets', Layers],
            ['fechada', 'Carga fechada', Truck],
          ] as Array<[Aba, string, typeof Factory]>).map(([a, label, Icon]) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={`px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-all flex items-center gap-2 whitespace-nowrap ${
                aba === a
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              }`}
            >
              <Icon className="h-4 w-4" />
              {label}
            </button>
          ))}
        </div>

        {/* Aba: por equipamento (Compactas) */}
        {aba === 'equipamento' && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground mb-2">
              Filtra apenas <b>Fábricas Compactas</b> ({catalogo.data?.length ?? 0} modelos).
              Pra outros equipamentos use "Por dimensões" ou "Carga fechada".
            </div>
            {linhasEquip.map((l, i) => (
              <div key={l.uid} className="flex items-center gap-2">
                <select
                  value={l.item?.id ?? ''}
                  onChange={e => {
                    const id = Number(e.target.value)
                    const item = catalogo.data?.find(c => c.id === id) ?? null
                    setLinhasEquip(prev => prev.map((x, idx) => idx === i ? { ...x, item } : x))
                  }}
                  className="flex-1 border rounded-lg px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50"
                >
                  <option value="">— selecione fábrica —</option>
                  {catalogo.data?.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.nome_curto} ({c.peso_kg} kg)
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min={1}
                  value={l.qtd}
                  onChange={e => {
                    const q = Number(e.target.value) || 1
                    setLinhasEquip(prev => prev.map((x, idx) => idx === i ? { ...x, qtd: q } : x))
                  }}
                  className="w-16 border rounded-lg px-2 py-2 text-sm bg-background tabular-nums text-center"
                />
                <button
                  type="button"
                  onClick={() => setLinhasEquip(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i))}
                  className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLinhasEquip(prev => [...prev, { uid: crypto.randomUUID(), item: null, qtd: 1 }])}
              className="text-sm text-primary hover:underline flex items-center gap-1 mt-1"
            >
              <Plus className="h-3 w-3" /> Adicionar fábrica
            </button>
            {catalogo.data && catalogo.data.length === 0 && (
              <div className="text-xs text-amber-600 mt-2">
                Nenhuma fábrica com peso cadastrado ainda.
              </div>
            )}
          </div>
        )}

        {/* Aba: por dimensoes */}
        {aba === 'dimensoes' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1">Peso total (kg)</label>
              <input type="number" value={dimPeso} onChange={e => setDimPeso(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-background tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Comprimento (m)</label>
              <input type="number" step="0.1" value={dimComp} onChange={e => setDimComp(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-background tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Largura (m)</label>
              <input type="number" step="0.1" value={dimLarg} onChange={e => setDimLarg(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-background tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Altura (m)</label>
              <input type="number" step="0.1" value={dimAlt} onChange={e => setDimAlt(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-background tabular-nums" />
            </div>
            <label className="flex items-center gap-2 text-sm col-span-2 cursor-pointer">
              <input type="checkbox" checked={dimIndivisivel} onChange={e => setDimIndivisivel(e.target.checked)} />
              Carga indivisível (silo inteiro, fábrica montada)
            </label>
          </div>
        )}

        {/* Aba: pallets */}
        {aba === 'pallets' && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1">Quantidade</label>
              <input type="number" min={1} value={palQtd} onChange={e => setPalQtd(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-background tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Peso por pallet (kg)</label>
              <input type="number" value={palPeso} onChange={e => setPalPeso(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-background tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Altura média (m)</label>
              <input type="number" step="0.1" value={palAltura} onChange={e => setPalAltura(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-background tabular-nums" />
            </div>
            <div className="col-span-3 text-xs text-muted-foreground bg-muted/50 rounded p-2">
              💡 Pallet PBR padrão (1,0 × 1,2 m). Empilhamento linear.
              {Number(palQtd) > 0 && (
                <> Modo de cobrança automático: <b>{MODOS_CARGA_LABELS[sugerirModoCargaBranorte(Number(palPeso) * Number(palQtd), Number(palQtd))]}</b></>
              )}
            </div>
          </div>
        )}

        {/* Aba: carga fechada (novo) */}
        {aba === 'fechada' && (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground bg-muted/50 rounded p-2">
              💡 Escolha o caminhão que quer cotar como se já estivesse cheio. Útil pra cliente que aluga frota dedicada ou pra estimativa rápida de carga grande.
            </div>

            {/* Tipo de caminhão */}
            <div>
              <label className="text-sm font-semibold block mb-2">Tipo de caminhão</label>
              <div className="grid grid-cols-2 gap-2">
                {(['TRUCK', 'CARRETA'] as const).map(t => {
                  const tipoMatch = tipos.data?.find(x => x.nome === (t === 'TRUCK' ? 'Truck' : 'Carreta 2 eixos'))
                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setFechadaTipo(t)}
                      className={`p-3 border-2 rounded-lg text-left transition-all ${
                        fechadaTipo === t
                          ? 'border-primary bg-primary/10'
                          : 'border-border hover:border-muted-foreground/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Truck className={`h-5 w-5 ${fechadaTipo === t ? 'text-primary' : 'text-muted-foreground'}`} />
                        <span className="font-bold">{t === 'TRUCK' ? 'TRUCK' : 'CARRETA'}</span>
                      </div>
                      <div className="text-xs text-muted-foreground tabular-nums">
                        {t === 'TRUCK' ? '8 m' : '12 m'} · {tipoMatch?.peso_max_kg.toLocaleString('pt-BR') ?? '—'} kg
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Modo de cobrança */}
            <div>
              <label className="text-sm font-semibold block mb-2">Modo de cobrança</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['fracionada_2p', '2 paletes', '~R$ 1,70/km'],
                  ['fracionada_4p', '4 paletes', '~R$ 1,90/km'],
                  ['completa', 'Completa', '~R$ 3,90/km'],
                ] as const).map(([m, label, hint]) => {
                  const disabled = fechadaTipo === 'TRUCK' && m === 'fracionada_2p'
                  return (
                    <button
                      key={m}
                      type="button"
                      disabled={disabled}
                      onClick={() => setFechadaModo(m)}
                      className={`p-3 border-2 rounded-lg text-left transition-all ${
                        disabled
                          ? 'opacity-40 cursor-not-allowed'
                          : fechadaModo === m
                            ? 'border-primary bg-primary/10'
                            : 'border-border hover:border-muted-foreground/50'
                      }`}
                    >
                      <div className="font-bold text-sm">{label}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{hint}</div>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        )}

        {/* Resumo da carga */}
        {carga && aba !== 'fechada' && (
          <div className="mt-4 pt-3 border-t flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-full text-xs font-semibold">
              <Scale className="h-3.5 w-3.5" />
              {carga.peso_kg.toLocaleString('pt-BR')} kg
            </div>
            {carga.comprimento_m > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted text-foreground rounded-full text-xs font-medium tabular-nums">
                <Package className="h-3.5 w-3.5" />
                {carga.comprimento_m.toFixed(1)} × {carga.largura_m.toFixed(1)} × {carga.altura_m.toFixed(1)} m
              </div>
            )}
            {carga.indivisivel && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded-full text-xs font-semibold">
                <AlertTriangle className="h-3.5 w-3.5" />
                Indivisível
              </div>
            )}
          </div>
        )}
      </div>

      {/* Resultado */}
      {carga && distanciaKm && (
        <div className="bg-gradient-to-br from-card to-card/50 border-2 border-primary/20 rounded-xl p-5 mb-4 shadow-xl shadow-primary/5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold uppercase tracking-wider">Resultado</h2>
            {aplicouRetornoSulNorte && (
              <span className="ml-auto text-xs text-emerald-700 dark:text-emerald-400 font-semibold">
                Frete retorno aplicado (÷2)
              </span>
            )}
          </div>

          {/* Caminhão recomendado/escolhido — HERO */}
          {caminhaoEfetivo ? (
            <div className="mb-5 p-4 bg-gradient-to-br from-primary/15 via-primary/5 to-transparent border-2 border-primary/30 rounded-xl">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-14 h-14 bg-primary/20 rounded-xl flex items-center justify-center shadow-inner">
                  <Truck className="h-8 w-8 text-primary" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-0.5">
                    {aba === 'fechada' ? 'Caminhão escolhido' : 'Caminhão recomendado'}
                  </div>
                  <div className="text-2xl font-black text-primary tracking-tight">
                    {caminhaoEfetivo.nome.toUpperCase()}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
                    <span className="text-muted-foreground">
                      Capacidade: <b className="text-foreground tabular-nums">{caminhaoEfetivo.peso_max_kg.toLocaleString('pt-BR')} kg</b>
                    </span>
                    <span className="text-muted-foreground">
                      Útil: <b className="text-foreground tabular-nums">{caminhaoEfetivo.comprimento_util_m} × {caminhaoEfetivo.largura_util_m} × {caminhaoEfetivo.altura_util_m} m</b>
                    </span>
                  </div>
                  {caminhaoEfetivo.precisa_aet && (
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded text-xs font-semibold">
                      <AlertTriangle className="h-3 w-3" />
                      Precisa AET (autorização especial)
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex items-start gap-3 p-4 bg-amber-500/10 border-2 border-amber-500/40 rounded-xl">
              <AlertTriangle className="h-6 w-6 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold text-amber-700 dark:text-amber-400">Carga especial</div>
                <div className="text-sm text-amber-800 dark:text-amber-300 mt-0.5">
                  Nenhum caminhão padrão comporta essa carga. Solicite cotação humana com parceira especializada.
                </div>
              </div>
            </div>
          )}

          {/* 4 estimativas comparativas */}
          {caminhaoEfetivo && (
            <>
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-bold mb-3">
                4 estimativas pra comparar
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
                {/* 1) MODELO BRANORTE — destaque verde-Branorte */}
                <div className="relative p-4 bg-gradient-to-br from-green-500/15 to-green-500/5 border-2 border-green-500/40 rounded-xl hover:border-green-500/60 transition-all shadow-md shadow-green-500/10">
                  <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-green-500 text-white text-[9px] font-black uppercase tracking-wider rounded-full shadow">
                    Branorte
                  </div>
                  <div className="flex items-center gap-1.5 mb-2">
                    <Factory className="h-4 w-4 text-green-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-green-700 dark:text-green-400">
                      Planilha
                    </span>
                  </div>
                  <div className="text-2xl font-black tabular-nums text-green-700 dark:text-green-400 leading-tight">
                    {formatBRL(valorModeloBranorte?.ajustado)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    {valorModeloBranorte && (
                      <>
                        {valorModeloBranorte.row.tipo_caminhao} ·{' '}
                        {MODOS_CARGA_LABELS[valorModeloBranorte.row.modo_carga]}<br />
                        R$ {valorModeloBranorte.row.rs_por_km.toFixed(2)}/km
                        {valorModeloBranorte.aplicou_retorno && (
                          <> · <span className="text-emerald-600 font-bold">↓50%</span></>
                        )}
                      </>
                    )}
                  </div>
                  {valorModeloBranorte && (
                    <button
                      type="button"
                      onClick={() => setValorFinal(String(Math.round(valorModeloBranorte.ajustado)))}
                      className="mt-2 w-full text-[10px] py-1 bg-green-500/20 hover:bg-green-500/30 text-green-700 dark:text-green-400 rounded font-bold transition-colors"
                    >
                      Usar este valor
                    </button>
                  )}
                </div>

                {/* 2) ANTT — âmbar */}
                <div className="relative p-4 bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-2 border-amber-500/30 rounded-xl hover:border-amber-500/50 transition-all">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Building2 className="h-4 w-4 text-amber-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      ANTT (legal)
                    </span>
                  </div>
                  <div className="text-2xl font-black tabular-nums text-amber-700 dark:text-amber-400 leading-tight">
                    {formatBRL(valorAntt?.com_margem)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    Res. 6.076/2026<br />piso {formatBRL(valorAntt?.piso)}
                  </div>
                  <div className="mt-2 flex items-center gap-1 text-[10px]">
                    <span className="text-muted-foreground">× margem</span>
                    <input
                      type="number"
                      step="0.1"
                      value={margem}
                      onChange={e => setMargem(e.target.value)}
                      className="w-12 border border-amber-500/30 rounded px-1 py-0.5 text-xs bg-background tabular-nums"
                    />
                  </div>
                </div>

                {/* 3) Parceiras — verde-esmeralda */}
                {estimativasParceiras.length > 0 ? (
                  <div className="relative p-4 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-2 border-emerald-500/30 rounded-xl">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Truck className="h-4 w-4 text-emerald-600" />
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        Parceiras ({estimativasParceiras.length})
                      </span>
                    </div>
                    <div className="space-y-1.5 max-h-[120px] overflow-y-auto">
                      {estimativasParceiras.map(({ parceira, valor }) => (
                        <label
                          key={parceira.id}
                          className={`flex items-center gap-1.5 p-1.5 rounded cursor-pointer transition-all border ${
                            parceiraEscolhidaId === parceira.id
                              ? 'bg-emerald-500/15 border-emerald-500/50'
                              : 'border-transparent hover:bg-emerald-500/5'
                          }`}
                        >
                          <input
                            type="radio"
                            name="parceira"
                            checked={parceiraEscolhidaId === parceira.id}
                            onChange={() => {
                              setParceiraEscolhidaId(parceira.id)
                              setValorFinal(String(Math.round(valor!)))
                            }}
                            className="accent-emerald-600"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-[10px] font-semibold truncate">{parceira.nome}</div>
                            <div className="text-sm font-black tabular-nums text-emerald-700 dark:text-emerald-400">
                              {formatBRL(valor)}
                            </div>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                ) : (
                  <Link
                    to="/frete/transportadoras"
                    className="relative p-4 bg-muted/30 border-2 border-dashed border-muted-foreground/30 rounded-xl hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center text-center group"
                  >
                    <Truck className="h-6 w-6 text-muted-foreground/50 group-hover:text-primary/70 mb-1.5" />
                    <div className="text-xs font-semibold text-muted-foreground group-hover:text-primary">
                      Nenhuma parceira
                    </div>
                    <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                      Cadastrar agora →
                    </div>
                  </Link>
                )}

                {/* 4) Histórico — azul */}
                <div className="relative p-4 bg-gradient-to-br from-sky-500/10 to-sky-500/5 border-2 border-sky-500/30 rounded-xl hover:border-sky-500/50 transition-all">
                  <div className="flex items-center gap-1.5 mb-2">
                    <History className="h-4 w-4 text-sky-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                      Histórico
                    </span>
                  </div>
                  <div className="text-2xl font-black tabular-nums text-sky-700 dark:text-sky-400 leading-tight">
                    {mediaHist.isLoading ? (
                      <Loader2 className="h-6 w-6 animate-spin" />
                    ) : mediaHist.data ? (
                      formatBRL(mediaHist.data)
                    ) : (
                      <span className="text-muted-foreground text-base font-normal">—</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    {mediaHist.data
                      ? 'Mediana similares (±20% km)'
                      : 'Mín. 3 cotações pra ativar'}
                  </div>
                </div>
              </div>

              {/* Decisão final */}
              <div className="border-t-2 border-dashed border-primary/20 pt-4 mt-2">
                <label className="flex items-center gap-1.5 text-xs uppercase tracking-wider font-bold text-muted-foreground mb-2">
                  <Save className="h-3.5 w-3.5" />
                  Valor final pra negociar com o cliente
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-lg font-bold text-muted-foreground tabular-nums">
                    R$
                  </span>
                  <input
                    type="number"
                    value={valorFinal}
                    onChange={e => setValorFinal(e.target.value)}
                    placeholder="0,00"
                    className="w-full border-2 border-primary/30 focus:border-primary rounded-xl pl-12 pr-4 py-3 text-2xl font-black tabular-nums bg-background focus:outline-none focus:ring-4 focus:ring-primary/10 transition-all"
                  />
                </div>
                <div className="relative mt-3">
                  <FileText className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <textarea
                    value={observacoes}
                    onChange={e => setObservacoes(e.target.value)}
                    placeholder="Observações (ex: cliente já tem transportadora, frete CIF...)"
                    className="w-full border rounded-xl pl-10 pr-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
                    rows={2}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSalvar}
                  disabled={salvar.isPending}
                  className="mt-3 w-full px-6 py-3.5 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/95 hover:to-primary text-primary-foreground rounded-xl font-bold text-base uppercase tracking-wider shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all flex items-center justify-center gap-2"
                >
                  {salvar.isPending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Salvando…
                    </>
                  ) : (
                    <>
                      <Save className="h-5 w-5" />
                      Salvar cotação
                    </>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      )}

      <div className="text-xs text-muted-foreground mt-4 text-center">
        <AlertTriangle className="h-3 w-3 inline mr-1" />
        Valores são ESTIMATIVAS pra negociação. Confirme com a transportadora antes de fechar com o cliente.
      </div>
    </div>
  )
}
