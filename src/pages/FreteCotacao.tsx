// /frete - Calculadora de Cotação de Frete Branorte
// Sistema autonomo (sem integracao com /orcamentos/montar).
// 3 metodos de entrada: por equipamento, por dimensoes, por pallets.
// Mostra 3 estimativas comparativas: ANTT, Parceiras, Historico.

import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Truck, MapPin, Loader2, AlertTriangle, Plus, Trash2 } from 'lucide-react'
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
          <Truck className="h-7 w-7 text-primary" />
          <h1 className="text-2xl font-bold">Cotação de Frete</h1>
        </div>
        <div className="flex gap-2">
          <Link to="/frete/historico" className="text-sm text-muted-foreground hover:text-primary underline">
            Histórico
          </Link>
          <Link to="/frete/transportadoras" className="text-sm text-muted-foreground hover:text-primary underline">
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

        {/* Resumo da carga */}
        {carga && (
          <div className="mt-4 pt-3 border-t text-sm text-muted-foreground">
            Carga: <b className="text-foreground">{carga.peso_kg.toLocaleString('pt-BR')} kg</b>
            {carga.comprimento_m > 0 && <> · {carga.comprimento_m.toFixed(1)}m × {carga.largura_m.toFixed(1)}m × {carga.altura_m.toFixed(1)}m</>}
            {carga.indivisivel && <> · <span className="text-amber-600">indivisível</span></>}
          </div>
        )}
      </div>

      {/* Resultado */}
      {carga && distanciaKm && (
        <div className="bg-card border rounded-lg p-4 mb-4">
          <h2 className="font-semibold mb-3">Resultado</h2>

          {/* Caminhão recomendado */}
          {caminhao ? (
            <div className="mb-4">
              <div className="text-sm text-muted-foreground">Caminhão recomendado:</div>
              <div className="text-lg font-bold flex items-center gap-2">
                <Truck className="h-5 w-5 text-primary" /> {caminhao.nome.toUpperCase()}
              </div>
              <div className="text-xs text-muted-foreground">
                Capacidade: {caminhao.peso_max_kg.toLocaleString('pt-BR')} kg · {caminhao.comprimento_util_m}m × {caminhao.largura_util_m}m × {caminhao.altura_util_m}m
                {caminhao.precisa_aet && <> · <span className="text-amber-600">precisa AET (autorização especial)</span></>}
              </div>
            </div>
          ) : (
            <div className="mb-4 flex items-start gap-2 p-3 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded">
              <AlertTriangle className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <b>Carga especial</b> — nenhum caminhão padrão comporta essa carga. Solicite cotação humana com parceira especializada (silos grandes, estruturas, etc.).
              </div>
            </div>
          )}

          {/* 3 estimativas */}
          {caminhao && (
            <div className="space-y-3">
              <div className="text-sm font-medium">3 estimativas pra comparar:</div>

              {/* ANTT */}
              <div className="flex items-center justify-between p-3 border rounded">
                <div>
                  <div className="font-medium text-sm">ANTT mínimo (legal)</div>
                  <div className="text-xs text-muted-foreground">
                    Resolução 6.076/2026 · piso {formatBRL(valorAntt?.piso)} ·
                    <label className="ml-1">
                      margem ×
                      <input
                        type="number"
                        step="0.1"
                        value={margem}
                        onChange={e => setMargem(e.target.value)}
                        className="w-14 ml-1 border rounded px-1 text-xs bg-background"
                      />
                    </label>
                  </div>
                </div>
                <div className="text-lg font-bold">{formatBRL(valorAntt?.com_margem)}</div>
              </div>

              {/* Parceiras */}
              {estimativasParceiras.length > 0 ? (
                estimativasParceiras.map(({ parceira, valor }) => (
                  <label
                    key={parceira.id}
                    className={`flex items-center justify-between p-3 border rounded cursor-pointer transition-colors ${
                      parceiraEscolhidaId === parceira.id ? 'border-primary bg-primary/5' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <input
                        type="radio"
                        name="parceira"
                        checked={parceiraEscolhidaId === parceira.id}
                        onChange={() => {
                          setParceiraEscolhidaId(parceira.id)
                          setValorFinal(String(Math.round(valor!)))
                        }}
                      />
                      <div>
                        <div className="font-medium text-sm">{parceira.nome}</div>
                        {parceira.telefone && (
                          <div className="text-xs text-muted-foreground">{parceira.telefone}</div>
                        )}
                      </div>
                    </div>
                    <div className="text-lg font-bold">{formatBRL(valor)}</div>
                  </label>
                ))
              ) : (
                <div className="p-3 border border-dashed rounded text-sm text-muted-foreground">
                  Nenhuma transportadora parceira cadastrada para esse caminhão / UF.
                  <Link to="/frete/transportadoras" className="ml-1 text-primary hover:underline">
                    Cadastrar agora
                  </Link>
                </div>
              )}

              {/* Média histórica */}
              <div className="flex items-center justify-between p-3 border rounded">
                <div>
                  <div className="font-medium text-sm">Histórico médio</div>
                  <div className="text-xs text-muted-foreground">
                    Cotações anteriores similares (mesma UF, mesmo caminhão, dist. ±20%)
                  </div>
                </div>
                <div className="text-lg font-bold">
                  {mediaHist.isLoading ? '...' : formatBRL(mediaHist.data)}
                </div>
              </div>

              {/* Decisão */}
              <div className="mt-4 pt-3 border-t space-y-2">
                <label className="text-sm font-medium block">Valor final pra negociar com o cliente</label>
                <input
                  type="number"
                  value={valorFinal}
                  onChange={e => setValorFinal(e.target.value)}
                  placeholder="R$"
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                />
                <textarea
                  value={observacoes}
                  onChange={e => setObservacoes(e.target.value)}
                  placeholder="Observações (ex: cliente já tem transportadora, frete CIF, etc.)"
                  className="w-full border rounded px-3 py-2 text-sm bg-background"
                  rows={2}
                />
                <button
                  type="button"
                  onClick={handleSalvar}
                  disabled={salvar.isPending}
                  className="w-full px-4 py-2 bg-primary text-primary-foreground rounded font-medium hover:bg-primary/90 disabled:opacity-50"
                >
                  {salvar.isPending ? 'Salvando…' : 'Salvar cotação'}
                </button>
              </div>
            </div>
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
