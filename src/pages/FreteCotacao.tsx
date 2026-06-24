// /frete - Calculadora de Cotacao de Frete Branorte
// Sistema autonomo (sem integracao com /orcamentos/montar).
// 4 metodos de entrada: por equipamento (Compactas) / dimensoes / pallets / carga fechada.
// Frete estimado = piso ANTT + regra ida/volta (carga completa) x margem; comparado com
// Transportadoras parceiras e Historico (mediana de cotacoes salvas).

import { useMemo, useState, useEffect } from 'react'
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
  cotarBranorte,
  cotarFreteComercial,
  definirModoCargaBranorte,
  pesoEfetivoKg,
  DESCONTO_RETORNO_MAX_PCT,
  volumeM3,
  resolverDestino,
  resolverDestinoPorCidade,
  type DestinoResolvido,
  type TipoCaminhao,
  type Carga,
} from '@/lib/calcFrete'
import {
  useTiposCaminhao,
  useAnttVigente,
  useTransportadoras,
  useMediaHistorica,
  useFreteCatalogoItens,
  useModeloBranorte,
  useSalvarCotacao,
  useMunicipiosUF,
  UFS_BR,
} from '@/hooks/useFrete'

type Aba = 'equipamento' | 'dimensoes' | 'pallets' | 'fechada'

// Item do seletor de equipamento = vem do cadastro "Itens de frete"
// (frete_catalogo_itens). id é uuid (string), não o catálogo inteiro de Compactas.
type EquipFonte = {
  id: string
  nome_curto: string
  categoria: string
  peso_kg: number | null
  dim_comprimento_m: number | null
  dim_largura_m: number | null
  dim_altura_m: number | null
  indivisivel: boolean
}

type LinhaEquipamento = {
  uid: string
  item: EquipFonte | null
  qtd: number
  // Dimensões/peso EDITÁVEIS por equipamento (pré-preenchidos do catálogo,
  // mas o vendedor pode ajustar em cada cotação). Vazio = usa o do catálogo.
  peso: string
  comp: string
  larg: string
  alt: string
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

// Rótulos amigáveis das categorias do seletor de equipamento (frete).
const CAT_LABELS: Record<string, string> = {
  FRETE: 'Itens de frete',
  COMPACTA: 'Fábricas Compactas',
  MISTURADOR: 'Misturadores',
  MOINHO: 'Moinhos',
  PRE_LIMPEZA: 'Pré-limpeza',
  CACAMBA_PESAGEM: 'Caçambas de pesagem',
  ENSACADEIRA: 'Ensacadeiras',
  SUPORTE_BAG: 'Suporte para bag',
  ESTEIRA: 'Esteiras',
  MOEGA: 'Moegas',
}
// Ordem de exibição dos grupos (fábricas primeiro).
const CAT_ORDEM = ['FRETE','COMPACTA','MISTURADOR','MOINHO','PRE_LIMPEZA','CACAMBA_PESAGEM','ENSACADEIRA','SUPORTE_BAG','ESTEIRA','MOEGA']

export default function FreteCotacao() {
  // ── Dados base ──
  const tipos = useTiposCaminhao()
  const antts = useAnttVigente()
  const modeloBN = useModeloBranorte()
  const parceiras = useTransportadoras()
  const catFrete = useFreteCatalogoItens()
  // Seletor de equipamento usa SÓ os "Itens de frete" cadastrados (frete_catalogo_itens),
  // não o catálogo inteiro de Compactas. Mapeia pro shape do seletor.
  const catalogo = useMemo(() => ({
    data: (catFrete.data ?? []).map((it): EquipFonte => ({
      id: it.id, nome_curto: it.nome, categoria: 'FRETE', peso_kg: it.peso_kg,
      dim_comprimento_m: it.comprimento_m, dim_largura_m: it.largura_m,
      dim_altura_m: it.altura_m, indivisivel: it.indivisivel,
    })),
    isLoading: catFrete.isLoading,
  }), [catFrete.data, catFrete.isLoading])
  const salvar = useSalvarCotacao()

  // ── Inputs gerais ──
  const [clienteNome, setClienteNome] = useState('')
  const [cep, setCep] = useState('')
  const [aba, setAba] = useState<Aba>('equipamento')
  const [destino, setDestino] = useState<DestinoResolvido | null>(null)
  const [loadingDist, setLoadingDist] = useState(false)
  const [errDist, setErrDist] = useState<string | null>(null)
  const [kmManual, setKmManual] = useState<string>('')

  // ── Modo de busca de destino: por CEP ou por cidade ──
  const [modoBusca, setModoBusca] = useState<'cep' | 'cidade'>('cep')
  const [cidadeInput, setCidadeInput] = useState('')
  const [ufInput, setUfInput] = useState<string>('')
  const municipios = useMunicipiosUF(modoBusca === 'cidade' ? ufInput : null)

  // ── Aba: por equipamento ──
  const [linhasEquip, setLinhasEquip] = useState<LinhaEquipamento[]>([
    { uid: crypto.randomUUID(), item: null, qtd: 1, peso: '', comp: '', larg: '', alt: '' },
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

  // ── Aba: carga fechada (escolhe o caminhão direto da tabela) ──
  const [fechadaCaminhaoId, setFechadaCaminhaoId] = useState<number | null>(null)
  const [fechadaModo, setFechadaModo] = useState<'fracionada_2p' | 'fracionada_4p' | 'completa'>('completa')

  // ── Resultado / decisao ──
  const [valorFinal, setValorFinal] = useState<string>('')
  const [parceiraEscolhidaId, setParceiraEscolhidaId] = useState<number | null>(null)
  const [margem, setMargem] = useState<string>('1.1')
  const [observacoes, setObservacoes] = useState('')
  // Carga completa cobra ida+volta por padrão (caminhão volta vazio). Liga isto
  // quando há carga de retorno confirmada → cobra só a ida.
  const [temRetorno, setTemRetorno] = useState(false)

  // ── Frete de retorno (manual, NÃO automático por geografia) ──
  // Default OFF. Só ligar quando vendedor confirma caminhão voltando vazio.
  const [retornoLigado, setRetornoLigado] = useState(false)
  const [retornoPct, setRetornoPct] = useState<string>('20')

  async function buscarDistancia() {
    const cepLimpo = cep.replace(/\D/g, '')
    if (cepLimpo.length !== 8) {
      setErrDist('CEP precisa ter 8 dígitos')
      return
    }
    setLoadingDist(true)
    setErrDist(null)
    setDestino(null)
    try {
      const res = await resolverDestino(cep)
      if (!res) {
        setErrDist('CEP não encontrado. Confira os 8 dígitos.')
      } else {
        // Cidade/UF SEMPRE aparecem (vem do ViaCEP). Distância é best-effort.
        setDestino(res)
        if (res.distancia_km != null) {
          setKmManual(String(res.distancia_km))
        } else {
          setKmManual('')
          setErrDist(`${res.cidade}/${res.uf} encontrado, mas não consegui calcular o km automaticamente. Digite manualmente abaixo.`)
        }
      }
    } catch {
      setErrDist('Erro ao consultar o CEP. Tente novamente.')
    } finally {
      setLoadingDist(false)
    }
  }

  async function buscarPorCidade() {
    const cidade = cidadeInput.trim()
    if (!ufInput) {
      setErrDist('Escolha a UF (estado) primeiro.')
      return
    }
    if (cidade.length < 2) {
      setErrDist('Digite o nome da cidade.')
      return
    }
    setLoadingDist(true)
    setErrDist(null)
    setDestino(null)
    try {
      const res = await resolverDestinoPorCidade(cidade, ufInput)
      setDestino(res)
      if (res.distancia_km != null) {
        setKmManual(String(res.distancia_km))
      } else {
        setKmManual('')
        setErrDist(`${res.cidade}/${res.uf} selecionado, mas não consegui calcular o km automaticamente. Digite manualmente abaixo.`)
      }
    } catch {
      setErrDist('Erro ao calcular a distância. Digite o km manual abaixo.')
    } finally {
      setLoadingDist(false)
    }
  }

  // Default do caminhão na aba "carga fechada": primeira Carreta da tabela.
  useEffect(() => {
    if (fechadaCaminhaoId == null && tipos.data && tipos.data.length > 0) {
      const carreta = tipos.data.find(t => t.nome === 'Carreta 2 eixos') ?? tipos.data[0]
      setFechadaCaminhaoId(carreta.id)
    }
  }, [tipos.data, fechadaCaminhaoId])

  // ── Calcula a carga total conforme aba ativa ──
  const carga = useMemo<Carga | null>(() => {
    if (aba === 'equipamento') {
      const itens = linhasEquip.filter(l => l.item && l.qtd > 0)
      if (itens.length === 0) return null
      let peso = 0, comp = 0, larg = 0, alt = 0, indiv = false
      for (const l of itens) {
        const it = l.item!
        // Valores editados na linha têm prioridade; senão cai no catálogo.
        const p = Number(l.peso) || it.peso_kg || 0
        const c = Number(l.comp) || it.dim_comprimento_m || 0
        const w = Number(l.larg) || it.dim_largura_m || 0
        const h = Number(l.alt) || it.dim_altura_m || 0
        peso += p * l.qtd
        comp += c * l.qtd          // soma o comprimento (carga enfileirada no baú)
        larg = Math.max(larg, w)   // largura/altura = a maior peça manda
        alt = Math.max(alt, h)
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
    const tipoMatch = tipos.data?.find(t => t.id === fechadaCaminhaoId)
    if (!tipoMatch) return null
    return {
      peso_kg: tipoMatch.peso_max_kg,
      comprimento_m: tipoMatch.comprimento_util_m,
      largura_m: tipoMatch.largura_util_m,
      altura_m: tipoMatch.altura_util_m,
      indivisivel: false,
    }
  }, [aba, linhasEquip, dimPeso, dimComp, dimLarg, dimAlt, dimIndivisivel, palQtd, palPeso, palAltura, fechadaCaminhaoId, tipos.data])

  // ── Catálogo agrupado por categoria (pro <select> com optgroups) ──
  const gruposEquip = useMemo(() => {
    const data = catalogo.data ?? []
    const porCat = new Map<string, EquipFonte[]>()
    for (const item of data) {
      const arr = porCat.get(item.categoria) ?? []
      arr.push(item)
      porCat.set(item.categoria, arr)
    }
    return CAT_ORDEM
      .filter(cat => porCat.has(cat))
      .map(cat => ({ cat, label: CAT_LABELS[cat] ?? cat, itens: porCat.get(cat)! }))
  }, [catalogo.data])

  // ── Recomendar caminhao ──
  const caminhao = useMemo(() => {
    if (!carga || !tipos.data) return null
    return recomendarCaminhao(carga, tipos.data)
  }, [carga, tipos.data])

  // Na aba "fechada" o caminhão é o que o vendedor escolheu (por id).
  const caminhaoEfetivo = useMemo(() => {
    if (aba === 'fechada' && tipos.data) {
      const t = tipos.data.find(t => t.id === fechadaCaminhaoId)
      return t ?? caminhao
    }
    return caminhao
  }, [aba, fechadaCaminhaoId, tipos.data, caminhao])

  const distanciaKm = useMemo(() => {
    const m = Number(kmManual)
    if (Number.isFinite(m) && m > 0) return m
    return destino?.distancia_km ?? null
  }, [kmManual, destino])

  // ── Tipo de caminhão Branorte (TRUCK/CARRETA) — derivado do peso máx ──
  const tipoCaminhaoBranorte = useMemo<'TRUCK' | 'CARRETA'>(() => {
    if (!caminhaoEfetivo) return 'CARRETA'
    // Truck ate 14 ton; acima disso (bitruque, carretas) vai Carreta
    return caminhaoEfetivo.peso_max_kg <= 14000 ? 'TRUCK' : 'CARRETA'
  }, [caminhaoEfetivo])

  // ── Modo de carga (nova lógica: indivisível->completa + cubagem) ──
  const modoCargaBranorte = useMemo<'fracionada_2p' | 'fracionada_4p' | 'completa'>(() => {
    if (aba === 'fechada') return fechadaModo
    if (!carga) return 'completa'
    const q = aba === 'pallets' ? (Number(palQtd) || undefined) : undefined
    return definirModoCargaBranorte(carga, tipoCaminhaoBranorte, q)
  }, [aba, fechadaModo, palQtd, carga, tipoCaminhaoBranorte])

  // ── Piso ANTT (chão legal) — base pro card ANTT E pra trava do modelo Branorte ──
  const pisoAntt = useMemo<number | null>(() => {
    if (!caminhaoEfetivo || !distanciaKm || !antts.data) return null
    const antt = antts.data.find(a => a.tipo_caminhao_id === caminhaoEfetivo.id)
    if (!antt) return null
    return calcularPisoANTT(distanciaKm, antt)
  }, [caminhaoEfetivo, distanciaKm, antts.data])

  // ── Estimativa 1: Modelo Branorte (COM trava de piso + retorno manual) ──
  const valorModeloBranorte = useMemo(() => {
    if (!distanciaKm || !modeloBN.data || pisoAntt == null) return null
    // Tenta achar row exata. Se TRUCK não tem fracionada_2p, cai pra 4p.
    let row = modeloBN.data.find(
      m => m.tipo_caminhao === tipoCaminhaoBranorte && m.modo_carga === modoCargaBranorte,
    )
    if (!row && tipoCaminhaoBranorte === 'TRUCK' && modoCargaBranorte === 'fracionada_2p') {
      row = modeloBN.data.find(m => m.tipo_caminhao === 'TRUCK' && m.modo_carga === 'fracionada_4p')
    }
    if (!row) return null
    const pct = retornoLigado ? (Number(retornoPct) || 0) : 0
    const calc = cotarBranorte(distanciaKm, row, pisoAntt, { descontoRetornoPct: pct })
    return { row, ...calc }
  }, [distanciaKm, modeloBN.data, pisoAntt, tipoCaminhaoBranorte, modoCargaBranorte, retornoLigado, retornoPct])

  // ── Valor comercial (piso ANTT + regra ida/volta) × margem ──
  const freteComercial = useMemo(() => {
    if (!caminhaoEfetivo || !distanciaKm || !antts.data) return null
    const antt = antts.data.find(a => a.tipo_caminhao_id === caminhaoEfetivo.id)
    if (!antt) return null
    return cotarFreteComercial(distanciaKm, antt, modoCargaBranorte, Number(margem) || 1, temRetorno)
  }, [caminhaoEfetivo, distanciaKm, antts.data, modoCargaBranorte, margem, temRetorno])

  // ── Estimativa: Parceiras (aplica ida+volta igual ao card principal) ──
  const estimativasParceiras = useMemo(() => {
    if (!caminhaoEfetivo || !distanciaKm || !parceiras.data || !destino) return []
    const km = freteComercial?.kmCobravel ?? distanciaKm // carga completa = ida+volta
    return parceiras.data
      .filter(p => p.ativo)
      .map(p => ({
        parceira: p,
        valor: calcularParceira(km, destino.uf, caminhaoEfetivo, p),
      }))
      .filter(x => x.valor != null)
      .sort((a, b) => (a.valor ?? 0) - (b.valor ?? 0))
  }, [caminhaoEfetivo, distanciaKm, parceiras.data, destino, freteComercial])

  // ── Estimativa 4: Histórico ──
  const mediaHist = useMediaHistorica(caminhaoEfetivo?.id ?? null, destino?.uf ?? null, distanciaKm)

  // Peso efetivo (real vs cubado) — mostrado pro vendedor entender a cubagem
  const pesoEfetivo = useMemo(() => (carga ? pesoEfetivoKg(carga) : null), [carga])
  const cargaIndivisivel = carga?.indivisivel ?? false

  async function handleSalvar() {
    if (!carga || !caminhaoEfetivo || !destino || !distanciaKm) {
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
        cidade_destino: destino.cidade,
        uf_destino: destino.uf,
        distancia_km: distanciaKm,
        tempo_viagem_horas: destino.tempo_horas,
        metodo_entrada: aba === 'fechada' ? 'dimensoes' : aba,
        peso_total_kg: carga.peso_kg,
        comprimento_m: carga.comprimento_m,
        largura_m: carga.largura_m,
        altura_m: carga.altura_m,
        volume_m3: volumeM3(carga.comprimento_m, carga.largura_m, carga.altura_m),
        carga_indivisivel: carga.indivisivel,
        equipamentos_itens: aba === 'equipamento'
          ? linhasEquip.filter(l => l.item).map(l => ({
              id: l.item!.id, nome: l.item!.nome_curto, qtd: l.qtd,
              peso: Number(l.peso) || l.item!.peso_kg,
              comp: Number(l.comp) || l.item!.dim_comprimento_m,
              larg: Number(l.larg) || l.item!.dim_largura_m,
              alt: Number(l.alt) || l.item!.dim_altura_m,
            }))
          : aba === 'fechada'
            ? { modo: 'carga_fechada', caminhao: caminhaoEfetivo.nome, modo_carga: fechadaModo }
            : null,
        caminhao_recomendado_id: caminhaoEfetivo.id,
        valor_antt_minimo: freteComercial?.pisoLegalIda ?? null,
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
    <div className="relative min-h-screen overflow-hidden">
      {/* Decorative background — brilho verde da marca + textura sutil */}
      <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="absolute -top-48 -right-40 w-[640px] h-[640px] bg-gradient-to-br from-accent/25 via-accent/8 to-transparent rounded-full blur-3xl opacity-70 animate-pulse" style={{ animationDuration: '9s' }} />
        <div className="absolute bottom-[-15%] -left-40 w-[560px] h-[560px] bg-gradient-to-tr from-accent/20 via-accent/5 to-transparent rounded-full blur-3xl opacity-60 animate-pulse" style={{ animationDuration: '13s' }} />
        {/* textura de pontos (neutra — funciona em claro e escuro) */}
        <div className="absolute inset-0 opacity-[0.05]" style={{ backgroundImage: 'radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)', backgroundSize: '30px 30px' }} />
      </div>

      <div className="container mx-auto py-8 px-4 max-w-[1400px] relative">
        {/* Header — hero treatment */}
        <div className="mb-8 flex items-end justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-4">
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-br from-accent to-emerald-500 rounded-2xl blur-lg opacity-50" />
              <div className="relative w-16 h-16 bg-gradient-to-br from-accent via-accent to-emerald-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-accent/40 ring-1 ring-white/20">
                <Truck className="h-8 w-8 text-white drop-shadow-lg" strokeWidth={2.5} />
              </div>
            </div>
            <div>
              <div className="inline-block px-2.5 py-0.5 bg-accent/10 text-accent text-[10px] font-black uppercase tracking-[0.2em] rounded-full mb-1.5 ring-1 ring-accent/20">
                Branorte · SC
              </div>
              <h1 className="text-3xl sm:text-4xl font-black tracking-tighter leading-none bg-gradient-to-r from-ink via-accent to-emerald-400 bg-clip-text text-transparent">
                Cotação de Frete
              </h1>
              <div className="text-sm text-ink-muted mt-1.5 flex items-center gap-2">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                Estimativa rápida pra negociação em segundos
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Link
              to="/frete/historico"
              className="group px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-ink-muted hover:text-accent bg-surface border border-border hover:border-accent/40 hover:shadow-md hover:shadow-accent/10 rounded-xl transition-all flex items-center gap-2"
            >
              <History className="h-4 w-4 group-hover:scale-110 transition-transform" />
              Histórico
            </Link>
            <Link
              to="/frete/transportadoras"
              className="group px-4 py-2.5 text-xs font-bold uppercase tracking-wider text-ink-muted hover:text-accent bg-surface border border-border hover:border-accent/40 hover:shadow-md hover:shadow-accent/10 rounded-xl transition-all flex items-center gap-2"
            >
              <Building2 className="h-4 w-4 group-hover:scale-110 transition-transform" />
              Transportadoras
            </Link>
          </div>
        </div>

        {/* Layout 2 colunas no desktop: inputs (esquerda, sticky) · resultado (direita) */}
        <div className="lg:grid lg:grid-cols-[minmax(0,400px)_1fr] lg:gap-6 lg:items-start">
          {/* ── Coluna esquerda: entradas ── */}
          <div className="lg:sticky lg:top-6">

      {/* Cliente + CEP — glassmorphism */}
      <div className="relative bg-surface/80 backdrop-blur-xl border border-border/60 rounded-2xl p-6 mb-5 space-y-4 shadow-xl shadow-black/5">
        <div className="absolute top-0 left-6 right-6 h-px bg-gradient-to-r from-transparent via-accent/40 to-transparent" />

        {/* Toggle: buscar por CEP ou por cidade */}
        <div className="inline-flex p-1 bg-surface-2/40 rounded-xl gap-1">
          <button
            type="button"
            onClick={() => { setModoBusca('cep'); setErrDist(null) }}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${modoBusca === 'cep' ? 'bg-bg text-ink shadow' : 'text-ink-muted hover:text-ink'}`}
          >
            Por CEP
          </button>
          <button
            type="button"
            onClick={() => { setModoBusca('cidade'); setErrDist(null) }}
            className={`px-4 py-1.5 rounded-lg text-[11px] font-black uppercase tracking-wider transition-all ${modoBusca === 'cidade' ? 'bg-bg text-ink shadow' : 'text-ink-muted hover:text-ink'}`}
          >
            Por cidade
          </button>
        </div>

        {modoBusca === 'cep' ? (
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-ink-muted block mb-2">
                CEP destino
              </label>
              <input
                type="text"
                value={cep}
                onChange={e => setCep(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') buscarDistancia() }}
                placeholder="00000-000"
                className="w-full border-2 border-border/60 rounded-xl px-4 py-3 text-base font-bold tabular-nums tracking-wider bg-bg/60 focus:outline-none focus:ring-4 focus:ring-accent/15 focus:border-accent transition-all placeholder:text-ink-muted/40 placeholder:font-normal placeholder:tracking-normal"
                maxLength={9}
              />
            </div>
            <button
              type="button"
              onClick={buscarDistancia}
              disabled={loadingDist}
              className="group relative px-6 py-3 bg-gradient-to-br from-accent to-emerald-600 text-white rounded-xl text-sm font-black uppercase tracking-wider hover:shadow-2xl hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 flex items-center gap-2 shadow-lg shadow-accent/30 transition-all"
            >
              {loadingDist ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <MapPin className="h-5 w-5 group-hover:scale-110 transition-transform" />
              )}
              Buscar
            </button>
          </div>
        ) : (
          <div className="flex items-end gap-3">
            <div className="w-24">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-ink-muted block mb-2">
                UF
              </label>
              <select
                value={ufInput}
                onChange={e => { setUfInput(e.target.value); setCidadeInput('') }}
                className="w-full border-2 border-border/60 rounded-xl px-3 py-3 text-base font-bold bg-bg/60 focus:outline-none focus:ring-4 focus:ring-accent/15 focus:border-accent transition-all"
              >
                <option value="">—</option>
                {UFS_BR.map(uf => <option key={uf} value={uf}>{uf}</option>)}
              </select>
            </div>
            <div className="flex-1">
              <label className="text-[10px] font-black uppercase tracking-[0.15em] text-ink-muted block mb-2">
                Cidade {municipios.isLoading && <span className="font-normal normal-case text-ink-muted/50">(carregando…)</span>}
              </label>
              <input
                type="text"
                list="lista-municipios"
                value={cidadeInput}
                onChange={e => setCidadeInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') buscarPorCidade() }}
                disabled={!ufInput}
                placeholder={ufInput ? 'Comece a digitar a cidade…' : 'Escolha a UF primeiro'}
                className="w-full border-2 border-border/60 rounded-xl px-4 py-3 text-base font-bold bg-bg/60 focus:outline-none focus:ring-4 focus:ring-accent/15 focus:border-accent transition-all disabled:opacity-50 placeholder:text-ink-muted/40 placeholder:font-normal"
              />
              <datalist id="lista-municipios">
                {(municipios.data ?? []).map(nome => <option key={nome} value={nome} />)}
              </datalist>
            </div>
            <button
              type="button"
              onClick={buscarPorCidade}
              disabled={loadingDist}
              className="group relative px-6 py-3 bg-gradient-to-br from-accent to-emerald-600 text-white rounded-xl text-sm font-black uppercase tracking-wider hover:shadow-2xl hover:shadow-accent/40 hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50 disabled:hover:translate-y-0 flex items-center gap-2 shadow-lg shadow-accent/30 transition-all"
            >
              {loadingDist ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : (
                <MapPin className="h-5 w-5 group-hover:scale-110 transition-transform" />
              )}
              Buscar
            </button>
          </div>
        )}
        {errDist && (
          <div className="flex items-start gap-2 p-3 bg-amber-500/10 border border-amber-500/30 rounded-xl text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 flex-shrink-0" /> {errDist}
          </div>
        )}
        {destino && (
          <div className="relative overflow-hidden rounded-xl border border-accent/30 bg-gradient-to-r from-accent/10 via-accent/5 to-transparent">
            <div className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-accent to-emerald-500" />
            <div className="flex items-center gap-3 p-3 pl-4">
              <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center">
                <MapPin className="h-5 w-5 text-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-base font-black text-ink">
                  {destino.cidade}/{destino.uf}
                </div>
                <div className="flex items-center gap-3 text-xs text-ink-muted mt-0.5">
                  {destino.distancia_km != null ? (
                    <>
                      <span className="tabular-nums font-bold text-accent">
                        {destino.distancia_km.toLocaleString('pt-BR')} km
                      </span>
                      {destino.tempo_horas != null && (
                        <>
                          <span>·</span>
                          <span>~{destino.tempo_horas}h viagem</span>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-600 font-semibold">
                      Digite o km manual abaixo ↓
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 pt-1">
          <label className="text-[10px] font-black uppercase tracking-[0.15em] text-ink-muted/60">
            Ajuste manual km
          </label>
          <input
            type="number"
            value={kmManual}
            onChange={e => setKmManual(e.target.value)}
            placeholder="—"
            className="w-28 border border-border/60 rounded-lg px-3 py-1.5 text-sm font-bold tabular-nums bg-bg/60 focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/50"
          />
        </div>
      </div>

      {/* Abas — pill style */}
      <div className="bg-surface/80 backdrop-blur-xl border border-border/60 rounded-2xl p-5 mb-5 shadow-xl shadow-black/5">
        <div className="grid grid-cols-2 gap-2 mb-5 p-1.5 bg-surface-2/40 rounded-2xl">
          {([
            ['equipamento', 'Equipamento', Factory],
            ['dimensoes', 'Dimensões', Package],
            ['pallets', 'Pallets', Layers],
            ['fechada', 'Carga fechada', Truck],
          ] as Array<[Aba, string, typeof Factory]>).map(([a, label, Icon]) => (
            <button
              key={a}
              type="button"
              onClick={() => setAba(a)}
              className={`relative px-3 py-2.5 text-[11px] font-black uppercase tracking-wider rounded-xl transition-all flex items-center justify-center gap-2 whitespace-nowrap ${
                aba === a
                  ? 'bg-gradient-to-br from-accent to-emerald-600 text-white shadow-lg shadow-accent/30'
                  : 'text-ink-muted hover:text-ink hover:bg-surface'
              }`}
            >
              <Icon className={`h-4 w-4 flex-shrink-0 ${aba === a ? 'drop-shadow-md' : ''}`} />
              <span className="truncate">{label}</span>
            </button>
          ))}
        </div>

        {/* Aba: por equipamento (Compactas + avulsos com medida) */}
        {aba === 'equipamento' && (
          <div className="space-y-2">
            <div className="text-xs text-ink-muted mb-2">
              Itens de frete cadastrados ({catalogo.data?.length ?? 0}). Cadastre/edite em "Itens de frete".
              Pra algo fora do cadastro, use "Por dimensões".
            </div>
            {linhasEquip.map((l, i) => (
              <div key={l.uid} className="border border-border/70 rounded-xl p-2.5 space-y-2 bg-surface/40">
                <div className="flex items-center gap-2">
                  <select
                    value={l.item?.id ?? ''}
                    onChange={e => {
                      const id = e.target.value
                      const item = catalogo.data?.find(c => c.id === id) ?? null
                      setLinhasEquip(prev => prev.map((x, idx) => idx === i ? {
                        ...x, item,
                        // pré-preenche os campos com a medida do catálogo (editável)
                        peso: item ? String(item.peso_kg ?? '') : '',
                        comp: item ? String(item.dim_comprimento_m ?? '') : '',
                        larg: item ? String(item.dim_largura_m ?? '') : '',
                        alt: item ? String(item.dim_altura_m ?? '') : '',
                      } : x))
                    }}
                    className="flex-1 min-w-0 border border-border rounded-lg px-3 py-2 text-sm bg-bg focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/50"
                  >
                    <option value="">— selecione equipamento —</option>
                    {gruposEquip.map(g => (
                      <optgroup key={g.cat} label={g.label}>
                        {g.itens.map(c => (
                          <option key={c.id} value={c.id}>
                            {c.nome_curto}{c.peso_kg ? ` (${c.peso_kg} kg)` : ''}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <input
                    type="number"
                    min={1}
                    value={l.qtd}
                    title="Quantidade"
                    onChange={e => {
                      const q = Number(e.target.value) || 1
                      setLinhasEquip(prev => prev.map((x, idx) => idx === i ? { ...x, qtd: q } : x))
                    }}
                    className="w-14 flex-shrink-0 border border-border rounded-lg px-2 py-2 text-sm bg-bg tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/50"
                  />
                  <button
                    type="button"
                    onClick={() => setLinhasEquip(prev => prev.length === 1 ? prev : prev.filter((_, idx) => idx !== i))}
                    className="flex-shrink-0 p-2 text-ink-muted hover:text-danger transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                {/* Medidas/peso editáveis por equipamento (preenche do catálogo, ajuste à vontade) */}
                {l.item && (
                  <div className="grid grid-cols-4 gap-1.5">
                    {([
                      ['peso', 'Peso kg', l.peso],
                      ['comp', 'Compr. m', l.comp],
                      ['larg', 'Larg. m', l.larg],
                      ['alt', 'Alt. m', l.alt],
                    ] as const).map(([campo, label, val]) => (
                      <div key={campo}>
                        <label className="block text-[9px] font-bold uppercase tracking-wider text-ink-muted/70 mb-0.5">{label}</label>
                        <input
                          type="number"
                          step={campo === 'peso' ? 1 : 0.1}
                          value={val}
                          onChange={e => {
                            const v = e.target.value
                            setLinhasEquip(prev => prev.map((x, idx) => idx === i ? { ...x, [campo]: v } : x))
                          }}
                          className="w-full border border-border/60 rounded-md px-1.5 py-1 text-xs bg-bg tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-accent/20 focus:border-accent/50"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLinhasEquip(prev => [...prev, { uid: crypto.randomUUID(), item: null, qtd: 1, peso: '', comp: '', larg: '', alt: '' }])}
              className="text-sm text-accent hover:underline flex items-center gap-1 mt-1"
            >
              <Plus className="h-3 w-3" /> Adicionar equipamento
            </button>
            {catalogo.data && catalogo.data.length === 0 && (
              <div className="text-xs text-amber-600 mt-2">
                Nenhum item de frete cadastrado ainda. Cadastre em "Itens de frete".
              </div>
            )}
          </div>
        )}

        {/* Aba: por dimensoes */}
        {aba === 'dimensoes' && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-semibold block mb-1">Peso total (kg)</label>
              <input type="number" value={dimPeso} onChange={e => setDimPeso(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-bg tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Comprimento (m)</label>
              <input type="number" step="0.1" value={dimComp} onChange={e => setDimComp(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-bg tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Largura (m)</label>
              <input type="number" step="0.1" value={dimLarg} onChange={e => setDimLarg(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-bg tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Altura (m)</label>
              <input type="number" step="0.1" value={dimAlt} onChange={e => setDimAlt(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-bg tabular-nums" />
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
              <input type="number" min={1} value={palQtd} onChange={e => setPalQtd(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-bg tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Peso por pallet (kg)</label>
              <input type="number" value={palPeso} onChange={e => setPalPeso(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-bg tabular-nums" />
            </div>
            <div>
              <label className="text-sm font-semibold block mb-1">Altura média (m)</label>
              <input type="number" step="0.1" value={palAltura} onChange={e => setPalAltura(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm bg-bg tabular-nums" />
            </div>
            <div className="col-span-3 text-xs text-ink-muted bg-surface-2/50 rounded p-2">
              💡 Pallet PBR padrão (1,0 × 1,2 m). Empilhamento linear.
              {Number(palQtd) > 0 && (
                <> Modo de cobrança automático: <b>{MODOS_CARGA_LABELS[modoCargaBranorte]}</b></>
              )}
            </div>
          </div>
        )}

        {/* Aba: carga fechada (novo) */}
        {aba === 'fechada' && (
          <div className="space-y-4">
            <div className="text-xs text-ink-muted bg-surface-2/50 rounded p-2">
              💡 Escolha o caminhão que quer cotar como se já estivesse cheio. Útil pra cliente que aluga frota dedicada ou pra estimativa rápida de carga grande.
            </div>

            {/* Tipo de caminhão — lista completa da tabela (truque, bitruque, carretas…) */}
            <div>
              <label className="text-sm font-semibold block mb-2">Tipo de caminhão</label>
              <div className="grid grid-cols-2 gap-2">
                {(tipos.data ?? []).filter(t => t.ativo).map(t => {
                  const sel = fechadaCaminhaoId === t.id
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setFechadaCaminhaoId(t.id)}
                      className={`p-3 border-2 rounded-lg text-left transition-all ${
                        sel ? 'border-accent bg-accent/10' : 'border-border hover:border-ink-faint/50'
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <Truck className={`h-5 w-5 flex-shrink-0 ${sel ? 'text-accent' : 'text-ink-muted'}`} />
                        <span className="font-bold text-sm leading-tight">{t.nome}</span>
                      </div>
                      <div className="text-xs text-ink-muted tabular-nums">
                        {t.comprimento_util_m}m · {t.peso_max_kg.toLocaleString('pt-BR')} kg
                        {t.precisa_aet && <span className="text-amber-600 font-bold"> · AET</span>}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Modo de cobrança — completa = ida+volta (dedicada); fracionada = só ida */}
            <div>
              <label className="text-sm font-semibold block mb-2">Modo de cobrança</label>
              <div className="grid grid-cols-3 gap-2">
                {([
                  ['completa', 'Completa', 'ida + volta'],
                  ['fracionada_4p', 'Fracionada', 'rateado · só ida'],
                  ['fracionada_2p', 'Fracionada leve', 'rateado · só ida'],
                ] as const).map(([m, label, hint]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setFechadaModo(m)}
                    className={`p-3 border-2 rounded-lg text-left transition-all ${
                      fechadaModo === m
                        ? 'border-accent bg-accent/10'
                        : 'border-border hover:border-ink-faint/50'
                    }`}
                  >
                    <div className="font-bold text-sm">{label}</div>
                    <div className="text-xs text-ink-muted">{hint}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Resumo da carga */}
        {carga && aba !== 'fechada' && (
          <div className="mt-4 pt-3 border-t flex flex-wrap gap-2">
            <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-accent/10 text-accent border border-accent/20 rounded-full text-xs font-semibold">
              <Scale className="h-3.5 w-3.5" />
              {carga.peso_kg.toLocaleString('pt-BR')} kg
            </div>
            {carga.comprimento_m > 0 && (
              <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 text-ink rounded-full text-xs font-medium tabular-nums">
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
          </div>{/* /coluna esquerda */}

          {/* ── Coluna direita: resultado / onboarding ── */}
          <div className="mt-5 lg:mt-0 min-w-0">

      {/* Resultado — hero card maximalista */}
      {carga && distanciaKm && (
        <div className="relative overflow-hidden bg-gradient-to-br from-surface via-surface to-surface/40 border-2 border-accent/30 rounded-3xl p-6 mb-5 shadow-2xl shadow-accent/10">
          {/* Decorative corner */}
          <div className="absolute -top-20 -right-20 w-60 h-60 bg-gradient-to-br from-accent/30 to-emerald-500/20 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-60 h-60 bg-gradient-to-tr from-sky-500/15 to-accent/10 rounded-full blur-3xl pointer-events-none" />


          {/* Caminhão recomendado/escolhido — HERO */}
          {caminhaoEfetivo ? (
            <div className="relative mb-6 p-5 bg-gradient-to-br from-accent/20 via-accent/10 to-transparent border-2 border-accent/40 rounded-2xl overflow-hidden">
              <div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-bl from-accent/30 to-transparent rounded-full blur-2xl" />
              <div className="relative flex items-start gap-4">
                <div className="relative flex-shrink-0">
                  <div className="absolute inset-0 bg-accent rounded-2xl blur-lg opacity-60" />
                  <div className="relative w-20 h-20 bg-gradient-to-br from-accent via-accent to-emerald-600 rounded-2xl flex items-center justify-center shadow-2xl shadow-accent/40 ring-1 ring-white/20">
                    <Truck className="h-12 w-12 text-white drop-shadow-lg" strokeWidth={2.5} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[10px] uppercase tracking-[0.2em] text-ink-muted font-black mb-1">
                    {aba === 'fechada' ? '✓ Caminhão escolhido' : '✓ Caminhão recomendado'}
                  </div>
                  <div className="text-3xl sm:text-4xl font-black tracking-tighter leading-none bg-gradient-to-r from-accent via-accent to-emerald-600 bg-clip-text text-transparent">
                    {caminhaoEfetivo.nome.toUpperCase()}
                  </div>
                  <div className="flex flex-wrap gap-2 mt-3">
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg/70 backdrop-blur border border-accent/20 rounded-full text-xs font-bold tabular-nums">
                      <Scale className="h-3.5 w-3.5 text-accent" />
                      {caminhaoEfetivo.peso_max_kg.toLocaleString('pt-BR')} kg
                    </div>
                    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-bg/70 backdrop-blur border border-accent/20 rounded-full text-xs font-bold tabular-nums">
                      <Package className="h-3.5 w-3.5 text-accent" />
                      {caminhaoEfetivo.comprimento_util_m} × {caminhaoEfetivo.largura_util_m} × {caminhaoEfetivo.altura_util_m} m
                    </div>
                  </div>
                  {caminhaoEfetivo.precisa_aet && (
                    <div className="mt-3 inline-flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/40 rounded-full text-xs font-black uppercase tracking-wider shadow-md shadow-amber-500/10">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Precisa AET
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <div className="mb-6 relative overflow-hidden p-5 bg-gradient-to-br from-amber-500/15 via-amber-500/10 to-transparent border-2 border-amber-500/50 rounded-2xl">
              <div className="absolute top-0 right-0 w-32 h-32 bg-amber-500/30 rounded-full blur-3xl" />
              <div className="relative flex items-start gap-3">
                <div className="flex-shrink-0 w-12 h-12 bg-amber-500/30 rounded-xl flex items-center justify-center">
                  <AlertTriangle className="h-7 w-7 text-amber-600" />
                </div>
                <div>
                  <div className="font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">Carga especial</div>
                  <div className="text-sm text-amber-800 dark:text-amber-300 mt-1">
                    Nenhum caminhão padrão comporta essa carga. Solicite cotação humana com parceira especializada.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Frete legal (ANTT) — unico valor */}
          {caminhaoEfetivo && (
            <div className="relative overflow-hidden p-6 bg-gradient-to-br from-amber-500/15 to-amber-500/5 border-2 border-amber-500/40 rounded-2xl">
              <div className="absolute -top-16 -right-16 w-40 h-40 bg-amber-500/20 rounded-full blur-3xl pointer-events-none" />
              <div className="relative">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-amber-500/20 rounded-lg flex items-center justify-center">
                    <Building2 className="h-5 w-5 text-amber-600" />
                  </div>
                  <span className="text-xs font-black uppercase tracking-wider text-amber-700 dark:text-amber-400">
                    Frete estimado
                  </span>
                </div>
                <div className="text-5xl font-black tabular-nums text-amber-700 dark:text-amber-400 leading-none tracking-tighter">
                  {formatBRL(freteComercial?.comMargem)}
                </div>
                <div className="text-xs text-ink-muted mt-3 leading-relaxed">
                  Piso legal mínimo da ida (Res. 6.076/2026): <b className="tabular-nums text-ink">{formatBRL(freteComercial?.pisoLegalIda)}</b>
                  {distanciaKm != null && <> · <b className="tabular-nums">{distanciaKm.toLocaleString('pt-BR')} km</b></>}
                  <br />Modo: <b>{MODOS_CARGA_LABELS[modoCargaBranorte]}</b>
                  {freteComercial?.idaEVolta && (
                    <> · <b className="text-amber-700 dark:text-amber-400">cobra ida + volta ({freteComercial.kmCobravel.toLocaleString('pt-BR')} km)</b></>
                  )}
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <span className="text-xs text-ink-muted font-bold">× margem</span>
                  <input
                    type="number"
                    step="0.1"
                    value={margem}
                    onChange={e => setMargem(e.target.value)}
                    className="w-16 border border-amber-500/40 rounded-lg px-2 py-1.5 text-sm bg-bg tabular-nums font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/30"
                  />
                  <span className="text-[11px] text-ink-muted">sobre a base</span>
                </div>
                {modoCargaBranorte === 'completa' && (
                  <label className="mt-3 flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                    <input
                      type="checkbox"
                      checked={temRetorno}
                      onChange={e => setTemRetorno(e.target.checked)}
                    />
                    Tem carga de retorno? <span className="text-ink-muted/70">(cobra só a ida, sem dobrar)</span>
                  </label>
                )}
              </div>
            </div>
          )}
        </div>
      )}

        {/* Comparativos — Parceiras + Histórico (mesma regra ida+volta do card principal) */}
        {carga && distanciaKm && caminhaoEfetivo && (
          <div className="grid sm:grid-cols-2 gap-4 mb-5">
            {/* Parceiras */}
            <div className="relative overflow-hidden bg-surface/80 backdrop-blur-xl border border-border/60 rounded-2xl p-5 shadow-lg shadow-black/5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-sky-500/15 rounded-lg flex items-center justify-center">
                  <Building2 className="h-4 w-4 text-sky-500" />
                </div>
                <span className="text-xs font-black uppercase tracking-wider text-ink-muted">Transportadoras parceiras</span>
              </div>
              {estimativasParceiras.length > 0 ? (
                <div className="space-y-1.5">
                  {estimativasParceiras.map(({ parceira, valor }) => (
                    <div key={parceira.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-ink truncate">{parceira.nome}</span>
                      <span className="font-bold tabular-nums text-ink">{formatBRL(valor)}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-ink-muted">
                  {destino ? 'Nenhuma parceira ativa atende essa UF / esse caminhão.' : 'Informe o destino (CEP/cidade) pra ver as parceiras.'}
                </div>
              )}
            </div>

            {/* Histórico */}
            <div className="relative overflow-hidden bg-surface/80 backdrop-blur-xl border border-border/60 rounded-2xl p-5 shadow-lg shadow-black/5">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-7 h-7 bg-violet-500/15 rounded-lg flex items-center justify-center">
                  <History className="h-4 w-4 text-violet-500" />
                </div>
                <span className="text-xs font-black uppercase tracking-wider text-ink-muted">Histórico (mediana)</span>
              </div>
              {mediaHist.data != null ? (
                <>
                  <div className="text-2xl font-black tabular-nums text-ink">{formatBRL(mediaHist.data)}</div>
                  <div className="text-[11px] text-ink-muted mt-1">Mediana de cotações salvas pra {caminhaoEfetivo.nome}{destino ? ` → ${destino.uf}` : ''} em distância parecida.</div>
                </>
              ) : (
                <div className="text-xs text-ink-muted">Sem histórico salvo ainda pra esse caminhão/rota.</div>
              )}
            </div>
          </div>
        )}

        {/* Estado vazio — onboarding guiado em 3 passos (preenche o vão até ter resultado) */}
        {!(carga && distanciaKm) && (
          <div className="relative overflow-hidden bg-gradient-to-br from-surface/80 via-surface/40 to-surface/10 backdrop-blur-xl border border-border/50 rounded-3xl p-8 sm:p-12 mb-5 shadow-xl shadow-black/5">
            {/* glow ambiente */}
            <div className="absolute -top-24 left-1/2 -translate-x-1/2 w-[520px] h-[320px] bg-gradient-to-b from-accent/20 via-accent/5 to-transparent rounded-full blur-3xl pointer-events-none animate-pulse" style={{ animationDuration: '6s' }} />
            <div className="relative flex flex-col items-center text-center">
              {/* ilustração */}
              <div className="relative mb-6">
                <div className="absolute inset-0 bg-accent rounded-[1.75rem] blur-2xl opacity-30 animate-pulse" style={{ animationDuration: '3.5s' }} />
                <div className="relative w-24 h-24 bg-accent/10 border border-accent/30 rounded-[1.75rem] flex items-center justify-center ring-1 ring-accent/10 shadow-xl shadow-accent/15">
                  <Truck className="h-11 w-11 text-accent drop-shadow-lg" strokeWidth={1.75} />
                </div>
              </div>
              <h2 className="text-2xl sm:text-3xl font-black tracking-tighter text-ink">
                Pronto pra cotar
              </h2>
              <p className="text-sm text-ink-muted max-w-md mt-2 mb-8">
                Informe o <b className="text-ink">destino</b> e a <b className="text-ink">carga</b> — o frete estimado aparece na hora (ida+volta na carga completa), comparado com parceiras e histórico e travado no piso legal.
              </p>

              {/* 3 passos com status ao vivo */}
              <div className="relative grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-3xl">
                {/* linha conectora (desktop) */}
                <div className="hidden sm:block absolute top-7 left-[16.6%] right-[16.6%] h-0.5 bg-gradient-to-r from-accent/40 via-accent/25 to-accent/10 -z-0" />
                {[
                  { icon: MapPin, title: 'Destino', desc: 'CEP ou cidade', done: !!destino },
                  { icon: Package, title: 'Carga', desc: 'fábrica, dimensões ou pallets', done: !!carga },
                  { icon: Sparkles, title: 'Estimativa', desc: 'frete + parceiras + histórico', done: !!(carga && distanciaKm) },
                ].map((step, i, arr) => {
                  const isCurrent = !step.done && arr.slice(0, i).every(s => s.done)
                  const Icon = step.icon
                  return (
                    <div
                      key={step.title}
                      className={`relative z-10 flex flex-col items-center gap-2 p-4 rounded-2xl border-2 bg-surface/60 backdrop-blur transition-all hover:-translate-y-0.5 ${
                        step.done
                          ? 'border-accent/50 shadow-lg shadow-accent/10'
                          : isCurrent
                            ? 'border-accent/60 shadow-lg shadow-accent/15'
                            : 'border-border/50'
                      }`}
                    >
                      <div
                        className={`relative w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
                          step.done
                            ? 'bg-accent text-white shadow-md shadow-accent/30'
                            : isCurrent
                              ? 'bg-accent/15 text-accent ring-1 ring-accent/30'
                              : 'bg-surface-2 text-ink-faint'
                        }`}
                      >
                        {step.done ? (
                          <span className="text-2xl font-black leading-none">✓</span>
                        ) : (
                          <Icon className="h-6 w-6" strokeWidth={2} />
                        )}
                        {isCurrent && (
                          <span className="absolute inset-0 rounded-2xl ring-2 ring-accent/40 animate-ping" style={{ animationDuration: '2s' }} />
                        )}
                      </div>
                      <div className="text-[10px] font-black uppercase tracking-[0.15em] text-ink-muted/60">
                        Passo {i + 1}
                      </div>
                      <div className={`text-sm font-black ${step.done ? 'text-accent' : 'text-ink'}`}>
                        {step.title}
                      </div>
                      <div className="text-[11px] text-ink-muted/70 leading-tight">
                        {step.desc}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        )}
          </div>{/* /coluna direita */}
        </div>{/* /grid 2 colunas */}

        <div className="flex items-center justify-center gap-2 mt-6 text-[10px] uppercase tracking-[0.2em] font-bold text-ink-muted/70">
          <AlertTriangle className="h-3 w-3" />
          Valores são estimativas · confirme com a transportadora
        </div>
      </div>
    </div>
  )
}
