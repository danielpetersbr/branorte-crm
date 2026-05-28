// /frete - Calculadora de Cotação de Frete Branorte
// Sistema autonomo (sem integracao com /orcamentos/montar).
// 3 metodos de entrada: por equipamento, por dimensoes, por pallets.
// Mostra 3 estimativas comparativas: ANTT, Parceiras, Historico.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Truck, MapPin, Loader2, AlertTriangle, Plus, Trash2, Package, Scale, Sparkles, History, Building2, Save, FileText } from 'lucide-react'
import {
  recomendarCaminhao,
  calcularPisoANTT,
  calcularParceira,
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
  useCatalogoComPeso,
  useSalvarCotacao,
  type ItemCatalogoComPeso,
} from '@/hooks/useFrete'

type Aba = 'equipamento' | 'dimensoes' | 'pallets'

type LinhaEquipamento = {
  uid: string
  item: ItemCatalogoComPeso | null
  qtd: number
}

function formatBRL(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—'
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
}

export default function FreteCotacao() {
  // ── Dados base ──
  const tipos = useTiposCaminhao()
  const antts = useAnttVigente()
  const parceiras = useTransportadoras()
  const catalogo = useCatalogoComPeso()
  const salvar = useSalvarCotacao()

  // ── Inputs gerais ──
  const [clienteNome, setClienteNome] = useState('')
  const [cep, setCep] = useState('')
  const [aba, setAba] = useState<Aba>('equipamento')
  const [distancia, setDistancia] = useState<DistanciaResultado | null>(null)
  const [loadingDist, setLoadingDist] = useState(false)
  const [errDist, setErrDist] = useState<string | null>(null)

  // Override manual de km (se API falhar)
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

  // ── Resultado / decisao ──
  const [valorFinal, setValorFinal] = useState<string>('')
  const [parceiraEscolhidaId, setParceiraEscolhidaId] = useState<number | null>(null)
  const [margem, setMargem] = useState<string>('1.3')
  const [observacoes, setObservacoes] = useState('')

  // ── Buscar distancia quando o CEP completar 8 dig ──
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
    // pallets
    const q = Number(palQtd); const pp = Number(palPeso); const ah = Number(palAltura)
    if (!Number.isFinite(q) || q <= 0 || !Number.isFinite(pp) || pp <= 0) return null
    // Pallet PBR 1.0 × 1.2 m. Empilhados linearmente.
    return {
      peso_kg: q * pp,
      comprimento_m: q * 1.2,
      largura_m: 1.0,
      altura_m: ah || 1.4,
      indivisivel: false,
    }
  }, [aba, linhasEquip, dimPeso, dimComp, dimLarg, dimAlt, dimIndivisivel, palQtd, palPeso, palAltura])

  // ── Recomendar caminhao ──
  const caminhao = useMemo(() => {
    if (!carga || !tipos.data) return null
    return recomendarCaminhao(carga, tipos.data)
  }, [carga, tipos.data])

  // ── Distancia efetiva (manual prevalece sobre API) ──
  const distanciaKm = useMemo(() => {
    const m = Number(kmManual)
    if (Number.isFinite(m) && m > 0) return m
    return distancia?.distancia_km ?? null
  }, [kmManual, distancia])

  // ── 3 estimativas ──
  const valorAntt = useMemo(() => {
    if (!caminhao || !distanciaKm || !antts.data) return null
    const antt = antts.data.find(a => a.tipo_caminhao_id === caminhao.id)
    if (!antt) return null
    const piso = calcularPisoANTT(distanciaKm, antt)
    const m = Number(margem) || 1
    return { piso, com_margem: piso * m }
  }, [caminhao, distanciaKm, antts.data, margem])

  const estimativasParceiras = useMemo(() => {
    if (!caminhao || !distanciaKm || !parceiras.data || !distancia) return []
    return parceiras.data
      .filter(p => p.ativo)
      .map(p => ({
        parceira: p,
        valor: calcularParceira(distanciaKm, distancia.destino.uf, caminhao, p),
      }))
      .filter(x => x.valor != null)
  }, [caminhao, distanciaKm, parceiras.data, distancia])

  const mediaHist = useMediaHistorica(caminhao?.id ?? null, distancia?.destino.uf ?? null, distanciaKm)

  async function handleSalvar() {
    if (!carga || !caminhao || !distancia || !distanciaKm) {
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
        metodo_entrada: aba,
        peso_total_kg: carga.peso_kg,
        comprimento_m: carga.comprimento_m,
        largura_m: carga.largura_m,
        altura_m: carga.altura_m,
        volume_m3: volumeM3(carga.comprimento_m, carga.largura_m, carga.altura_m),
        carga_indivisivel: carga.indivisivel,
        equipamentos_itens: aba === 'equipamento'
          ? linhasEquip.filter(l => l.item).map(l => ({ id: l.item!.id, nome: l.item!.nome_curto, qtd: l.qtd, peso: l.item!.peso_kg }))
          : null,
        caminhao_recomendado_id: caminhao.id,
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
      // Reset campos de decisao mas mantem busca
      setValorFinal('')
      setObservacoes('')
      setParceiraEscolhidaId(null)
    } catch (e: any) {
      alert(`Erro ao salvar: ${e?.message ?? e}`)
    }
  }

  return (
    <div className="container mx-auto py-6 px-4 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 bg-gradient-to-br from-primary to-primary/70 rounded-xl flex items-center justify-center shadow-lg shadow-primary/30">
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
      <div className="bg-card border rounded-lg p-4 mb-4 space-y-3">
        <div>
          <label className="text-sm font-medium block mb-1">Cliente (opcional)</label>
          <input
            type="text"
            value={clienteNome}
            onChange={e => setClienteNome(e.target.value)}
            placeholder="Nome do cliente / fazenda"
            className="w-full border rounded px-3 py-2 text-sm bg-background"
          />
        </div>
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <label className="text-sm font-medium block mb-1">CEP destino</label>
            <input
              type="text"
              value={cep}
              onChange={e => setCep(e.target.value)}
              placeholder="00000-000"
              className="w-full border rounded px-3 py-2 text-sm bg-background"
              maxLength={9}
            />
          </div>
          <button
            type="button"
            onClick={buscarDistancia}
            disabled={loadingDist}
            className="px-4 py-2 bg-primary text-primary-foreground rounded text-sm font-medium hover:bg-primary/90 disabled:opacity-50 flex items-center gap-2"
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
          <div className="text-sm text-muted-foreground">
            → <b>{distancia.destino.cidade}/{distancia.destino.uf}</b> · {distancia.distancia_km} km · ~{distancia.tempo_horas}h de viagem
          </div>
        )}
        {/* Override manual km */}
        <div>
          <label className="text-xs text-muted-foreground block mb-1">Ajuste manual de km (se necessário)</label>
          <input
            type="number"
            value={kmManual}
            onChange={e => setKmManual(e.target.value)}
            placeholder="Km"
            className="w-32 border rounded px-3 py-1 text-sm bg-background"
          />
        </div>
      </div>

      {/* Abas */}
      <div className="bg-card border rounded-lg p-4 mb-4">
        <div className="flex gap-2 border-b mb-4">
          {(['equipamento', 'dimensoes', 'pallets'] as Aba[]).map(a => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                aba === a
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {a === 'equipamento' && 'Por equipamento'}
              {a === 'dimensoes' && 'Por dimensões'}
              {a === 'pallets' && 'Por pallets'}
            </button>
          ))}
        </div>

        {/* Aba: por equipamento */}
        {aba === 'equipamento' && (
          <div className="space-y-2">
            {linhasEquip.map((l, i) => (
              <div key={l.uid} className="flex items-center gap-2">
                <select
                  value={l.item?.id ?? ''}
                  onChange={e => {
                    const id = Number(e.target.value)
                    const item = catalogo.data?.find(c => c.id === id) ?? null
                    setLinhasEquip(prev => prev.map((x, idx) => idx === i ? { ...x, item } : x))
                  }}
                  className="flex-1 border rounded px-2 py-1 text-sm bg-background"
                >
                  <option value="">— selecione equipamento —</option>
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
                  className="w-16 border rounded px-2 py-1 text-sm bg-background"
                />
                <button
                  type="button"
                  onClick={() => setLinhasEquip(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i))}
                  className="p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLinhasEquip(prev => [...prev, { uid: crypto.randomUUID(), item: null, qtd: 1 }])}
              className="text-sm text-primary hover:underline flex items-center gap-1"
            >
              <Plus className="h-3 w-3" /> Adicionar equipamento
            </button>
            {catalogo.data && catalogo.data.length === 0 && (
              <div className="text-xs text-amber-600 mt-2">
                Nenhum equipamento com peso cadastrado. Preencha peso/dim em /orcamentos/catalogo-admin ou use a aba "Por dimensões".
              </div>
            )}
          </div>
        )}

        {/* Aba: por dimensoes */}
        {aba === 'dimensoes' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Peso total (kg)</label>
              <input type="number" value={dimPeso} onChange={e => setDimPeso(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Comprimento (m)</label>
              <input type="number" step="0.1" value={dimComp} onChange={e => setDimComp(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Largura (m)</label>
              <input type="number" step="0.1" value={dimLarg} onChange={e => setDimLarg(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Altura (m)</label>
              <input type="number" step="0.1" value={dimAlt} onChange={e => setDimAlt(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background" />
            </div>
            <label className="flex items-center gap-2 text-sm col-span-2">
              <input type="checkbox" checked={dimIndivisivel} onChange={e => setDimIndivisivel(e.target.checked)} />
              Carga indivisível (silo inteiro, fábrica montada)
            </label>
          </div>
        )}

        {/* Aba: pallets */}
        {aba === 'pallets' && (
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-sm font-medium block mb-1">Quantidade</label>
              <input type="number" min={1} value={palQtd} onChange={e => setPalQtd(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Peso por pallet (kg)</label>
              <input type="number" value={palPeso} onChange={e => setPalPeso(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background" />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1">Altura média (m)</label>
              <input type="number" step="0.1" value={palAltura} onChange={e => setPalAltura(e.target.value)} className="w-full border rounded px-3 py-2 text-sm bg-background" />
            </div>
            <div className="col-span-3 text-xs text-muted-foreground">
              Pallet PBR padrão (1,0 × 1,2 m). Sistema assume empilhamento linear.
            </div>
          </div>
        )}

        {/* Resumo da carga - badges destacados */}
        {carga && (
          <div className="mt-4 pt-3 border-t flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-primary/10 text-primary border border-primary/20 rounded-full text-xs font-semibold">
              <Scale className="h-3.5 w-3.5" />
              {carga.peso_kg.toLocaleString('pt-BR')} kg
            </div>
            {carga.comprimento_m > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-muted text-foreground rounded-full text-xs font-medium">
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
        <div className="bg-gradient-to-br from-card to-card/50 border-2 border-primary/20 rounded-xl p-5 mb-4 shadow-lg shadow-primary/5">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="h-5 w-5 text-primary" />
            <h2 className="text-base font-bold uppercase tracking-wider">Resultado</h2>
          </div>

          {/* Caminhão recomendado — HERO CARD */}
          {caminhao ? (
            <div className="mb-5 p-4 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent border-2 border-primary/30 rounded-lg">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0 w-14 h-14 bg-primary/20 rounded-lg flex items-center justify-center">
                  <Truck className="h-8 w-8 text-primary" strokeWidth={2.5} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-0.5">
                    Caminhão recomendado
                  </div>
                  <div className="text-2xl font-black text-primary tracking-tight">
                    {caminhao.nome.toUpperCase()}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-xs">
                    <span className="text-muted-foreground">
                      Capacidade: <b className="text-foreground tabular-nums">{caminhao.peso_max_kg.toLocaleString('pt-BR')} kg</b>
                    </span>
                    <span className="text-muted-foreground">
                      Útil: <b className="text-foreground tabular-nums">{caminhao.comprimento_util_m} × {caminhao.largura_util_m} × {caminhao.altura_util_m} m</b>
                    </span>
                  </div>
                  {caminhao.precisa_aet && (
                    <div className="mt-2 inline-flex items-center gap-1 px-2 py-1 bg-amber-500/15 text-amber-700 dark:text-amber-400 border border-amber-500/30 rounded text-xs font-semibold">
                      <AlertTriangle className="h-3 w-3" />
                      Precisa AET (autorização especial)
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-5 flex items-start gap-3 p-4 bg-amber-500/10 border-2 border-amber-500/40 rounded-lg">
              <AlertTriangle className="h-6 w-6 text-amber-600 mt-0.5 flex-shrink-0" />
              <div>
                <div className="font-bold text-amber-700 dark:text-amber-400">Carga especial</div>
                <div className="text-sm text-amber-800 dark:text-amber-300 mt-0.5">
                  Nenhum caminhão padrão comporta essa carga. Solicite cotação humana com parceira especializada (silos grandes, estruturas customizadas).
                </div>
              </div>
            </div>
          )}

          {/* 3 estimativas — CARDS COMPARATIVOS */}
          {caminhao && (
            <>
              <div className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-3">
                3 estimativas pra comparar
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-5">
                {/* CARD 1: ANTT (âmbar/legal) */}
                <div className="relative p-4 bg-gradient-to-br from-amber-500/10 to-amber-500/5 border-2 border-amber-500/30 rounded-lg hover:border-amber-500/50 transition-all">
                  <div className="flex items-center gap-1.5 mb-2">
                    <Building2 className="h-4 w-4 text-amber-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-700 dark:text-amber-400">
                      ANTT (legal)
                    </span>
                  </div>
                  <div className="text-3xl font-black tabular-nums text-amber-700 dark:text-amber-400 leading-tight">
                    {formatBRL(valorAntt?.com_margem)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    Res. 6.076/2026 · piso {formatBRL(valorAntt?.piso)}
                  </div>
                  <div className="mt-2 flex items-center gap-1.5 text-[11px]">
                    <span className="text-muted-foreground">margem ×</span>
                    <input
                      type="number"
                      step="0.1"
                      value={margem}
                      onChange={e => setMargem(e.target.value)}
                      className="w-12 border border-amber-500/30 rounded px-1.5 py-0.5 text-xs bg-background tabular-nums"
                    />
                  </div>
                </div>

                {/* CARD 2: Parceiras (primary/verde) */}
                {estimativasParceiras.length > 0 ? (
                  <div className="relative p-4 bg-gradient-to-br from-emerald-500/10 to-emerald-500/5 border-2 border-emerald-500/30 rounded-lg">
                    <div className="flex items-center gap-1.5 mb-2">
                      <Truck className="h-4 w-4 text-emerald-600" />
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
                        Parceiras ({estimativasParceiras.length})
                      </span>
                    </div>
                    <div className="space-y-2 max-h-[120px] overflow-y-auto">
                      {estimativasParceiras.map(({ parceira, valor }) => (
                        <label
                          key={parceira.id}
                          className={`flex items-center gap-2 p-2 rounded cursor-pointer transition-all border ${
                            parceiraEscolhidaId === parceira.id
                              ? 'bg-emerald-500/15 border-emerald-500/50 shadow-sm'
                              : 'border-transparent hover:bg-emerald-500/5 hover:border-emerald-500/20'
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
                            <div className="text-xs font-semibold truncate">{parceira.nome}</div>
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
                    className="relative p-4 bg-muted/30 border-2 border-dashed border-muted-foreground/30 rounded-lg hover:border-primary/50 hover:bg-primary/5 transition-all flex flex-col items-center justify-center text-center group"
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

                {/* CARD 3: Histórico (azul/data) */}
                <div className="relative p-4 bg-gradient-to-br from-sky-500/10 to-sky-500/5 border-2 border-sky-500/30 rounded-lg hover:border-sky-500/50 transition-all">
                  <div className="flex items-center gap-1.5 mb-2">
                    <History className="h-4 w-4 text-sky-600" />
                    <span className="text-xs font-bold uppercase tracking-wider text-sky-700 dark:text-sky-400">
                      Histórico
                    </span>
                  </div>
                  <div className="text-3xl font-black tabular-nums text-sky-700 dark:text-sky-400 leading-tight">
                    {mediaHist.isLoading ? (
                      <Loader2 className="h-7 w-7 animate-spin" />
                    ) : mediaHist.data ? (
                      formatBRL(mediaHist.data)
                    ) : (
                      <span className="text-muted-foreground text-base font-normal">—</span>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                    {mediaHist.data
                      ? 'Mediana de cotações similares (±20% km)'
                      : 'Mín. 3 cotações pra ativar'}
                  </div>
                </div>
              </div>

              {/* DECISÃO — destaque final */}
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
                    className="w-full border-2 border-primary/30 focus:border-primary rounded-lg pl-12 pr-4 py-3 text-2xl font-black tabular-nums bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
                  />
                </div>
                <div className="relative mt-3">
                  <FileText className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <textarea
                    value={observacoes}
                    onChange={e => setObservacoes(e.target.value)}
                    placeholder="Observações (ex: cliente já tem transportadora, frete CIF, escolta especial...)"
                    className="w-full border rounded-lg pl-10 pr-3 py-2.5 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary/50 transition-all"
                    rows={2}
                  />
                </div>
                <button
                  type="button"
                  onClick={handleSalvar}
                  disabled={salvar.isPending}
                  className="mt-3 w-full px-6 py-3.5 bg-gradient-to-r from-primary to-primary/90 hover:from-primary/95 hover:to-primary text-primary-foreground rounded-lg font-bold text-base uppercase tracking-wider shadow-lg shadow-primary/30 hover:shadow-xl hover:shadow-primary/40 hover:-translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:translate-y-0 transition-all flex items-center justify-center gap-2"
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
