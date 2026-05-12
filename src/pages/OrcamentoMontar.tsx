import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  Sparkles, Search, Plus, Minus, Trash2, Package,
  Zap, X, AlertCircle, Star, FileText, Eye, ListChecks, Check, Loader2, FolderOpen,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  useCatalogoItems, useCatalogoMotores,
  agruparPorCategoria, acharMotorCompativel,
  type CatalogoItem, type CatalogoMotor,
} from '@/hooks/useCatalogo'
import { FinalizarMontarModal, type CarrinhoSnapshot } from '@/components/FinalizarMontarModal'
import { OrcamentoPreview } from '@/components/OrcamentoPreview'
import { useOrcamentoModelos, type OrcamentoModelo } from '@/hooks/useOrcamentoBuilder'

type Voltagem = 'monofasico' | 'trifasico'
type ModoVisao = 'preview' | 'edicao'

interface CarrinhoItem {
  uid: string
  catalogo_id: number
  categoria: string
  nome: string
  nome_custom?: string | null  // sobrescreve nome se vendedor editou inline
  specs: string[]
  qtd: number
  valor: number
  valor_original: number
  motor_cv: number | null
  motor_polos: number | null
  motor_qtd: number
  motor_valor_unit: number  // valor unitário do motor (não multiplicado)
  foto_url: string | null   // foto do equipamento (mostra no preview, igual orçamento real)
}

type TensaoMotor = 220 | 380 | 660 | null

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function formatBRLBare(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function gerarUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Detecta se o motor do item já vem incluso no preço do equipamento.
// Padrões no docx Branorte: "Acionamento ... (incluso)", "Motorredutor X CV (Incluso)", etc.
// Quando incluso = true, motor_valor_unit deve ser 0 pra não cobrar duas vezes.
function motorJaInclusoNoItem(specs: string[]): boolean {
  if (!specs || specs.length === 0) return false
  const motorKeywords = /acionamento|motorredutor|moto\s*redutor|pot[êe]ncia|\bcv\b/i
  const inclusoMarker = /\(\s*inclus[oa]\.?\s*\)/i
  return specs.some(s => motorKeywords.test(s) && inclusoMarker.test(s))
}

// Lista motores por item (não agrupa CV iguais — 1 linha por item do carrinho que tem motor)
interface MotorAgrupado {
  cv: number
  polos: number
  qtd: number              // motor_qtd * item.qtd (motores totais)
  valor_unit: number
  valor_total: number
  item_nome?: string       // nome do item que usa esse motor (pra mostrar no listagem)
}

function agruparMotores(carrinho: CarrinhoItem[]): MotorAgrupado[] {
  const linhas: MotorAgrupado[] = []
  for (const it of carrinho) {
    if (!it.motor_cv || !it.motor_polos) continue
    const qtdMotor = it.motor_qtd * it.qtd
    linhas.push({
      cv: it.motor_cv,
      polos: it.motor_polos,
      qtd: qtdMotor,
      valor_unit: it.motor_valor_unit,
      valor_total: it.motor_valor_unit * qtdMotor,
      item_nome: it.nome_custom || it.nome,
    })
  }
  // Ordena por CV desc pra ficar agrupado visualmente
  return linhas.sort((a, b) => b.cv - a.cv)
}

export function OrcamentoMontar() {
  const { data: items, isLoading: loadingItems } = useCatalogoItems()
  const { data: motores, isLoading: loadingMotores } = useCatalogoMotores()

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [voltagem, setVoltagem] = useState<Voltagem>('trifasico')
  // Tensão dos motores (global pra todos). null = "tensão a confirmar".
  const [tensaoMotores, setTensaoMotores] = useState<TensaoMotor>(null)
  const [carrinho, setCarrinho] = useState<CarrinhoItem[]>([])
  // Acessórios: bloco opcional com valor calculado como % do total de equipamentos
  const [acessorios, setAcessorios] = useState<{ pct: number; items: string[] } | null>(null)
  const [acessoriosOpen, setAcessoriosOpen] = useState(false)
  const [showOnlyPopular, setShowOnlyPopular] = useState(false)
  const [showOnlyOficiais, setShowOnlyOficiais] = useState(true)  // default: só items curados
  const [modoVisao, setModoVisao] = useState<ModoVisao>('preview')
  const [finalizarOpen, setFinalizarOpen] = useState(false)
  const [sucesso, setSucesso] = useState<{ numero: string; baixouDocx: boolean; baixouPdf: boolean; salvouNaPasta: boolean; pdfBlob: Blob | null; cliente: string } | null>(null)
  const [enviandoWA, setEnviandoWA] = useState<'idle' | 'enviando' | 'enviado' | 'erro'>('idle')
  const [enviandoWAMsg, setEnviandoWAMsg] = useState<string>('')
  const [waPromptOpen, setWaPromptOpen] = useState(false)
  const [waPromptValue, setWaPromptValue] = useState('')
  const [waPromptResolve, setWaPromptResolve] = useState<((v: string | null) => void) | null>(null)
  const [fotoPrincipal, setFotoPrincipal] = useState<string | null>(null)
  // Desconto + termos editáveis inline no preview
  const [descontoCfg, setDescontoCfg] = useState<{ tipo: 'pct' | 'valor'; valor: number } | null>(null)
  const [dataVendaTxt, setDataVendaTxt] = useState('')
  const [prazoEntregaTxt, setPrazoEntregaTxt] = useState('')
  const [formaPagamentoTxt, setFormaPagamentoTxt] = useState('')

  function atualizarTermo(key: 'dataVenda' | 'prazoEntrega' | 'formaPagamento', v: string) {
    if (key === 'dataVenda') setDataVendaTxt(v)
    else if (key === 'prazoEntrega') setPrazoEntregaTxt(v)
    else if (key === 'formaPagamento') setFormaPagamentoTxt(v)
  }

  const categorias = useMemo(() => agruparPorCategoria(items ?? []), [items])

  const itemsFiltrados = useMemo(() => {
    if (!items) return []
    const buscaLower = busca.trim().toLowerCase()
    return items.filter(it => {
      if (showOnlyOficiais && !it.is_oficial) return false
      if (categoria && it.categoria !== categoria) return false
      if (showOnlyPopular && it.ocorrencias < 5) return false
      if (buscaLower) {
        const haystack = `${it.nome_curto} ${it.nome_completo} ${it.categoria}`.toLowerCase()
        if (!haystack.includes(buscaLower)) return false
      }
      return true
    })
  }, [items, categoria, busca, showOnlyPopular, showOnlyOficiais])

  const totalOficiais = useMemo(() => (items ?? []).filter(i => i.is_oficial).length, [items])

  const motoresAgrupados = useMemo(() => agruparMotores(carrinho), [carrinho])

  const totalItems = useMemo(
    () => carrinho.reduce((s, c) => s + (c.valor * c.qtd), 0),
    [carrinho],
  )
  const totalMotores = useMemo(
    () => motoresAgrupados.reduce((s, m) => s + m.valor_total, 0),
    [motoresAgrupados],
  )
  // Valor dos acessórios = % do total de equipamentos (arredondado em centavos)
  const valorAcessorios = useMemo(
    () => acessorios ? Math.round((totalItems * acessorios.pct) / 100 * 100) / 100 : 0,
    [acessorios, totalItems],
  )
  const totalEquip = totalItems + valorAcessorios   // entra no "VALOR TOTAL DE EQUIPAMENTOS"
  const totalGeral = totalEquip + totalMotores

  function adicionarItem(item: CatalogoItem) {
    const specs = item.specs || []
    const motorIncluso = motorJaInclusoNoItem(specs)

    const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos && motores
      ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagem)
      : null

    setCarrinho(c => [...c, {
      uid: gerarUid(),
      catalogo_id: item.id,
      categoria: item.categoria,
      nome: item.nome_curto,
      specs,
      qtd: 1,
      valor: Number(item.valor),
      valor_original: Number(item.valor),
      motor_cv: item.motor_padrao_cv ? Number(item.motor_padrao_cv) : null,
      motor_polos: item.motor_padrao_polos,
      motor_qtd: item.motor_padrao_qtd || 1,
      // Se a spec já marca "(incluso)", motor não é cobrado de novo.
      motor_valor_unit: motorIncluso ? 0 : (motorMatch ? Number(motorMatch.valor) : 0),
      foto_url: item.foto_url || null,
    }])
  }

  function removerItem(uid: string) {
    setCarrinho(c => c.filter(it => it.uid !== uid))
  }

  function alterarQtd(uid: string, novaQtd: number) {
    if (novaQtd < 1) return
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, qtd: novaQtd } : it))
  }

  function alterarValor(uid: string, novoValor: number) {
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, valor: novoValor } : it))
  }

  function alterarNome(uid: string, novoNome: string) {
    setCarrinho(c => c.map(it => it.uid === uid ? { ...it, nome_custom: novoNome } : it))
  }

  function limparCarrinho() {
    if (carrinho.length === 0) return
    if (confirm('Limpar carrinho?')) setCarrinho([])
  }

  function moverItem(uid: string, direcao: 'cima' | 'baixo') {
    setCarrinho(c => {
      const idx = c.findIndex(it => it.uid === uid)
      if (idx === -1) return c
      const novo = idx + (direcao === 'cima' ? -1 : 1)
      if (novo < 0 || novo >= c.length) return c
      const novaLista = [...c]
      const [item] = novaLista.splice(idx, 1)
      novaLista.splice(novo, 0, item)
      return novaLista
    })
  }

  function aplicarVoltagem(novaVoltagem: Voltagem) {
    setVoltagem(novaVoltagem)
    if (!motores) return
    setCarrinho(c => c.map(it => {
      if (!it.motor_cv || !it.motor_polos) return it
      // Motor incluso continua com valor 0 mesmo ao trocar voltagem.
      if (motorJaInclusoNoItem(it.specs)) return { ...it, motor_valor_unit: 0 }
      const motor = acharMotorCompativel(motores, it.motor_cv, it.motor_polos, novaVoltagem)
      return { ...it, motor_valor_unit: motor ? Number(motor.valor) : it.motor_valor_unit }
    }))
  }

  // Carrega um modelo pronto (orcamento_modelos) no carrinho do Montar Custom
  function carregarDoModelo(modelo: OrcamentoModelo) {
    if (carrinho.length > 0 && !confirm('Substituir os items atuais pelos do modelo?')) return
    const novos: CarrinhoItem[] = []
    // 1) Items do modelo viram CarrinhoItem; motores distribuídos round-robin
    modelo.itens.forEach((it, i) => {
      const motor = modelo.motores[i] || null
      novos.push({
        uid: gerarUid(),
        catalogo_id: -1,
        categoria: 'MODELO',
        nome: it.nome,
        specs: it.specs || [],
        qtd: it.qtd || 1,
        valor: Number(it.valor) || 0,
        valor_original: Number(it.valor) || 0,
        motor_cv: motor ? motor.cv : null,
        motor_polos: motor ? motor.polos : null,
        motor_qtd: 1,
        motor_valor_unit: motor ? Number(motor.valor) : 0,
        foto_url: null,
      })
    })
    // 2) Motores extras (mais motores que items) → items dummy só com motor
    for (let i = modelo.itens.length; i < modelo.motores.length; i++) {
      const m = modelo.motores[i]
      novos.push({
        uid: gerarUid(),
        catalogo_id: -1,
        categoria: 'MOTOR',
        nome: `Motor ${m.cv} CV ${m.polos} polos`,
        specs: [`Tensão a confirmar (220V / 380V / 660V)`],
        qtd: 1,
        valor: 0,
        valor_original: 0,
        motor_cv: m.cv,
        motor_polos: m.polos,
        motor_qtd: 1,
        motor_valor_unit: Number(m.valor) || 0,
        foto_url: null,
      })
    }
    setCarrinho(novos)
    // 3) Acessórios — converte { items, valor } → { pct, items }
    if (modelo.acessorios && modelo.acessorios.items?.length) {
      const totalNovo = novos.reduce((s, it) => s + it.valor * it.qtd, 0)
      const pct = totalNovo > 0 ? Math.round((modelo.acessorios.valor / totalNovo) * 100) : 5
      setAcessorios({ pct: Math.max(1, Math.min(50, pct)), items: modelo.acessorios.items })
    } else {
      setAcessorios(null)
    }
    // 4) Voltagem do modelo
    if (modelo.voltagem) aplicarVoltagem(modelo.voltagem)
  }

  if (loadingItems || loadingMotores) return <PageLoading />

  return (
    <div className="h-full flex flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-[18px] font-bold text-ink flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-accent" />
            Montar Orçamento Personalizado
          </h1>
          <p className="text-[11px] text-ink-faint mt-0.5">
            Adicione items à esquerda. Veja o orçamento se montando à direita.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          {/* Seletor de modelo pronto */}
          <SelectorModelo onCarregar={carregarDoModelo} />

          <div className="flex items-center gap-2">
            <span className="text-[10px] uppercase tracking-wider text-ink-muted font-semibold">Voltagem:</span>
            <button
              onClick={() => aplicarVoltagem('monofasico')}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold transition-all ${
                voltagem === 'monofasico'
                  ? 'bg-warning text-white'
                  : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >
              Monofásico
            </button>
            <button
              onClick={() => aplicarVoltagem('trifasico')}
              className={`text-[11px] px-3 py-1.5 rounded font-semibold transition-all ${
                voltagem === 'trifasico'
                  ? 'bg-info text-white'
                  : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
              }`}
            >
              Trifásico
            </button>
          </div>
        </div>
      </div>

      {/* Grid 2 colunas: catálogo + preview (largura A4 ~794px @ 96dpi) */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[1fr_760px] gap-3 min-h-0">
        {/* CATÁLOGO */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
          <div className="p-3 border-b border-border space-y-2">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
              <Input
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar item (ex: triturador, caçamba, transportador)..."
                className="pl-7 text-[12px]"
              />
              {busca && (
                <button
                  onClick={() => setBusca('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-1.5 flex-wrap">
              <button
                onClick={() => setShowOnlyOficiais(p => !p)}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  showOnlyOficiais
                    ? 'bg-success text-white'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
                title={showOnlyOficiais ? `Mostrando só items curados (${totalOficiais}). Click pra ver todos.` : 'Mostrando todos. Click pra filtrar só items curados.'}
              >
                <Check className="h-3 w-3" />
                Só oficiais ({totalOficiais})
              </button>
              <button
                onClick={() => setShowOnlyPopular(p => !p)}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  showOnlyPopular
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
              >
                <Star className="h-3 w-3" />
                Só populares
              </button>
              <button
                onClick={() => setCategoria(null)}
                className={`text-[10px] px-2 py-1 rounded font-semibold transition-all ${
                  !categoria
                    ? 'bg-ink text-bg'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                }`}
              >
                Todas ({items?.length ?? 0})
              </button>
              {categorias.map(c => (
                <button
                  key={c.categoria}
                  onClick={() => setCategoria(c.categoria === categoria ? null : c.categoria)}
                  className={`text-[10px] px-2 py-1 rounded font-semibold transition-all ${
                    categoria === c.categoria
                      ? 'bg-ink text-bg'
                      : 'bg-surface-2 text-ink-muted hover:bg-surface-3'
                  }`}
                >
                  {c.categoria} ({c.qtd})
                </button>
              ))}
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3">
            {itemsFiltrados.length === 0 ? (
              <div className="text-center py-12 text-ink-faint">
                <Package className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-[12px]">Nenhum item encontrado</p>
                {busca && (
                  <button
                    onClick={() => { setBusca(''); setCategoria(null); setShowOnlyPopular(false) }}
                    className="text-[11px] text-accent mt-2 hover:underline"
                  >
                    Limpar filtros
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1.5">
                {itemsFiltrados.slice(0, 200).map(item => (
                  <CardItem
                    key={item.id}
                    item={item}
                    voltagem={voltagem}
                    motores={motores ?? []}
                    onAdd={() => adicionarItem(item)}
                  />
                ))}
                {itemsFiltrados.length > 200 && (
                  <div className="col-span-full text-center py-3 text-[11px] text-ink-faint italic">
                    Mostrando 200 de {itemsFiltrados.length}. Use a busca pra filtrar mais.
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>

        {/* PREVIEW DO ORÇAMENTO — sticky no desktop pra não rolar com a lista esquerda */}
        <Card className="flex flex-col min-h-0 overflow-hidden lg:sticky lg:top-3 lg:self-start lg:max-h-[calc(100vh-1.5rem)] lg:h-[calc(100vh-1.5rem)]">
          {/* Toolbar do preview */}
          <div className="p-2 border-b border-border flex items-center justify-between bg-surface-2/30">
            <div className="flex items-center gap-1">
              <button
                onClick={() => setModoVisao('preview')}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  modoVisao === 'preview'
                    ? 'bg-accent text-white'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
              >
                <Eye className="h-3 w-3" />
                Preview
              </button>
              <button
                onClick={() => setModoVisao('edicao')}
                className={`text-[10px] px-2 py-1 rounded font-semibold flex items-center gap-1 transition-all ${
                  modoVisao === 'edicao'
                    ? 'bg-accent text-white'
                    : 'text-ink-muted hover:bg-surface-3'
                }`}
              >
                <ListChecks className="h-3 w-3" />
                Edição
              </button>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-ink-faint">
                {carrinho.length} {carrinho.length === 1 ? 'item' : 'items'}
              </span>
              {carrinho.length > 0 && (
                <button
                  onClick={limparCarrinho}
                  className="text-[10px] text-danger hover:text-danger/70 flex items-center gap-1"
                >
                  <Trash2 className="h-3 w-3" />
                  Limpar
                </button>
              )}
              <button
                disabled={carrinho.length === 0}
                onClick={() => setFinalizarOpen(true)}
                className="text-[11px] bg-accent hover:bg-accent-700 text-white font-semibold px-3 py-1.5 rounded disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
              >
                <FileText className="h-3 w-3" />
                Gerar .docx + PDF
              </button>
            </div>
          </div>

          {/* Conteúdo do preview / edição */}
          <div className="flex-1 overflow-y-auto bg-white">
            {carrinho.length === 0 ? (
              <div className="text-center py-16 text-ink-faint">
                <FileText className="h-12 w-12 mx-auto mb-3 opacity-30" />
                <p className="text-[12px] font-semibold">Orçamento em branco</p>
                <p className="text-[10px] mt-1">Adicione items à esquerda pra começar</p>
              </div>
            ) : modoVisao === 'preview' ? (
              <OrcamentoPreview
                carrinho={carrinho}
                motoresAgrupados={motoresAgrupados}
                voltagem={voltagem}
                totalItems={totalItems}
                totalMotores={totalMotores}
                totalEquip={totalEquip}
                totalGeral={totalGeral}
                acessorios={acessorios}
                valorAcessorios={valorAcessorios}
                fotoPrincipal={fotoPrincipal}
                onAddAcessorios={() => setAcessoriosOpen(true)}
                onEditAcessorios={() => setAcessoriosOpen(true)}
                onRemoveAcessorios={() => setAcessorios(null)}
                onRemove={removerItem}
                onFotoChange={setFotoPrincipal}
                onUpdateNome={alterarNome}
                tensaoMotores={tensaoMotores}
                onUpdateTensaoMotores={setTensaoMotores}
                desconto={descontoCfg}
                onUpdateDesconto={setDescontoCfg}
                terms={{ dataVenda: dataVendaTxt, prazoEntrega: prazoEntregaTxt, formaPagamento: formaPagamentoTxt }}
                onUpdateTerm={atualizarTermo}
                onMoverItem={moverItem}
              />
            ) : (
              <div className="divide-y divide-border">
                {carrinho.map(it => (
                  <CarrinhoLinhaEdicao
                    key={it.uid}
                    item={it}
                    onRemove={() => removerItem(it.uid)}
                    onQtd={n => alterarQtd(it.uid, n)}
                    onValor={v => alterarValor(it.uid, v)}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Footer com total + ação */}
          {carrinho.length > 0 && (
            <div className="border-t border-border p-3 space-y-1.5 bg-surface-2/50">
              <div className="flex justify-between text-[11px] text-ink-muted">
                <span>Equipamentos</span>
                <span className="font-semibold">{formatBRL(totalItems)}</span>
              </div>
              {acessorios && (
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>Acessórios ({acessorios.pct}%)</span>
                  <span className="font-semibold">{formatBRL(valorAcessorios)}</span>
                </div>
              )}
              {totalMotores > 0 && (
                <div className="flex justify-between text-[11px] text-ink-muted">
                  <span>Motores ({motoresAgrupados.length})</span>
                  <span className="font-semibold">{formatBRL(totalMotores)}</span>
                </div>
              )}
              <div className="flex justify-between text-[14px] font-bold text-ink pt-1 border-t border-border">
                <span>TOTAL DA PROPOSTA</span>
                <span className="text-accent">{formatBRL(totalGeral)}</span>
              </div>
            </div>
          )}
        </Card>
      </div>

      {/* Modal de finalização */}
      <FinalizarMontarModal
        open={finalizarOpen}
        snapshot={{
          voltagem,
          itens: carrinho.map(c => ({
            nome: c.nome_custom || c.nome,  // usa nome customizado se vendedor editou
            qtd: c.qtd,
            valor: c.valor,
            specs: c.specs,
            motor_cv: c.motor_cv,
            motor_polos: c.motor_polos,
            motor_qtd: c.motor_qtd,
            motor_valor_unit: c.motor_valor_unit,
            foto_url: c.foto_url,
          })),
          motoresAgrupados,
          acessorios: acessorios ? { pct: acessorios.pct, items: acessorios.items, valor: valorAcessorios } : null,
          totalItems,
          totalMotores,
          totalEquip,
          totalGeral,
          fotoPrincipal,
          tensaoMotores,
          desconto: descontoCfg,
          termsInline: {
            dataVenda: dataVendaTxt || null,
            prazoEntrega: prazoEntregaTxt || null,
            formaPagamento: formaPagamentoTxt || null,
          },
        } as CarrinhoSnapshot}
        onClose={() => setFinalizarOpen(false)}
        onSuccess={info => {
          setSucesso(info)
          setFinalizarOpen(false)
          setCarrinho([])
          setAcessorios(null)
        }}
      />

      {/* Modal de Acessórios */}
      <AcessoriosModal
        open={acessoriosOpen}
        initial={acessorios}
        onClose={() => setAcessoriosOpen(false)}
        onSave={cfg => { setAcessorios(cfg); setAcessoriosOpen(false) }}
        onRemove={() => { setAcessorios(null); setAcessoriosOpen(false) }}
      />

      {/* Feedback de sucesso — toast premium */}
      {sucesso && (
        <div className="fixed bottom-6 right-6 z-50 bg-bg border border-success rounded-xl shadow-2xl max-w-sm w-[360px] overflow-hidden">
          {/* Header */}
          <div className="bg-success/15 border-b border-success/30 px-4 py-3 flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-success flex items-center justify-center shrink-0">
              <Check className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] uppercase tracking-wider text-success font-bold">Orçamento gerado</div>
              <div className="text-[16px] font-bold text-ink leading-tight">Nº {sucesso.numero}</div>
            </div>
            <button onClick={() => setSucesso(null)} className="text-ink-faint hover:text-ink p-1 -m-1 rounded hover:bg-surface-2">
              <X className="h-4 w-4" />
            </button>
          </div>
          {/* Body — status de cada saída */}
          <div className="px-4 py-3 space-y-1.5 text-[11px]">
            {sucesso.salvouNaPasta && (
              <div className="flex items-center gap-2 text-ink-muted">
                <FolderOpen className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span>Salvo na pasta Z:</span>
              </div>
            )}
            {sucesso.baixouDocx && (
              <div className="flex items-center gap-2 text-ink-muted">
                <FileText className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                <span>.docx baixado</span>
              </div>
            )}
            {sucesso.baixouPdf && (
              <div className="flex items-center gap-2 text-ink-muted">
                <FileText className="h-3.5 w-3.5 text-red-400 shrink-0" />
                <span>PDF baixado</span>
              </div>
            )}
          </div>
          {sucesso.pdfBlob && enviandoWA !== 'enviado' && (
            <button
              onClick={async () => {
                setEnviandoWA('enviando')
                setEnviandoWAMsg('Detectando vendedor...')
                try {
                  // Pega telefone via postMessage da extensão (se aberto via popup)
                  let telefone = await new Promise<string>((resolve) => {
                    const onMsg = (ev: MessageEvent) => {
                      if (ev.data?.type === 'branorte:vendor-info') {
                        window.removeEventListener('message', onMsg)
                        resolve(ev.data.telefone || '')
                      }
                    }
                    window.addEventListener('message', onMsg)
                    try { window.opener?.postMessage({ type: 'branorte:request-vendor-info' }, '*') } catch {}
                    setTimeout(() => { window.removeEventListener('message', onMsg); resolve('') }, 3000)
                  })
                  if (!telefone) {
                    const saved = localStorage.getItem('branorte_meu_telefone_wa') || ''
                    setWaPromptValue(saved.replace(/^55/, ''))
                    const tel = await new Promise<string | null>((resolve) => {
                      setWaPromptResolve(() => resolve)
                      setWaPromptOpen(true)
                    })
                    setWaPromptOpen(false)
                    setWaPromptResolve(null)
                    if (!tel) throw new Error('Cancelado')
                    const d = tel.replace(/[^\d]/g, '')
                    if (d.length < 10) throw new Error('Telefone inválido')
                    telefone = d.startsWith('55') ? d : '55' + d
                    localStorage.setItem('branorte_meu_telefone_wa', telefone)
                  }
                  setEnviandoWAMsg('Fazendo upload do PDF...')
                  const filename = `${sucesso.numero}-${(sucesso.cliente || 'cliente').replace(/[^a-zA-Z0-9]+/g,'_')}.pdf`
                  const path = `orcamentos/${new Date().toISOString().slice(0,7)}/${filename}`
                  const { error: upErr } = await supabase.storage.from('qr-media').upload(path, sucesso.pdfBlob!, { contentType: 'application/pdf', upsert: true })
                  if (upErr) throw new Error('Upload: ' + upErr.message)
                  const { data: pub } = supabase.storage.from('qr-media').getPublicUrl(path)
                  const { data: { session } } = await supabase.auth.getSession()
                  const r = await fetch('https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/orcamento-enviar-meu-zap', {
                    method: 'POST',
                    headers: { 'authorization': `Bearer ${session?.access_token ?? ''}`, 'content-type': 'application/json' },
                    body: JSON.stringify({ telefone_destino: telefone, pdf_url: pub.publicUrl, filename, cliente_nome: sucesso.cliente }),
                  })
                  const j = await r.json()
                  if (!j.ok) throw new Error(j.error || 'erro')
                  setEnviandoWA('enviado')
                  setEnviandoWAMsg(j.msg)
                } catch (e: any) {
                  setEnviandoWA('erro')
                  setEnviandoWAMsg(e?.message || 'erro')
                }
              }}
              disabled={enviandoWA === 'enviando'}
              className="w-full bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:opacity-60 text-white text-[12px] font-semibold py-2.5 flex items-center justify-center gap-2 transition"
            >
              {enviandoWA === 'enviando'
                ? <><Loader2 className="h-4 w-4 animate-spin" /> {enviandoWAMsg || 'Enviando...'}</>
                : <><svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.31a7.85 7.85 0 0 0-13.4 5.6 7.85 7.85 0 0 0 1.05 3.94L4 20l4.27-1.12a7.85 7.85 0 0 0 3.74.95h.01a7.86 7.86 0 0 0 5.58-13.52zm-5.58 12.07h-.01a6.52 6.52 0 0 1-3.32-.91l-.24-.14-2.46.65.66-2.4-.16-.25a6.5 6.5 0 0 1-1-3.42 6.52 6.52 0 0 1 11.13-4.61 6.48 6.48 0 0 1 1.91 4.61 6.52 6.52 0 0 1-6.51 6.47z"/></svg> Enviar pro meu WhatsApp</>}
            </button>
          )}
          {enviandoWA === 'enviado' && (
            <div className="px-4 py-2.5 bg-emerald-600/15 border-t border-emerald-600/30 text-[11px] text-emerald-300 flex items-start gap-2">
              <Check className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{enviandoWAMsg}</span>
            </div>
          )}
          {enviandoWA === 'erro' && (
            <div className="px-4 py-2.5 bg-red-600/15 border-t border-red-600/30 text-[11px] text-red-400 flex items-start gap-2">
              <X className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              <span>{enviandoWAMsg}</span>
            </div>
          )}
        </div>
      )}

      {/* Modal estilizado pra pedir telefone WhatsApp (substitui prompt() feio) */}
      {waPromptOpen && (
        <div
          className="fixed inset-0 z-[60] bg-black/70 flex items-center justify-center p-4"
          onClick={() => { waPromptResolve?.(null); setWaPromptOpen(false) }}
        >
          <div
            className="bg-bg border border-border rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="bg-emerald-600/15 border-b border-emerald-600/30 px-5 py-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-600 flex items-center justify-center">
                <svg className="h-5 w-5 text-white" viewBox="0 0 24 24" fill="currentColor"><path d="M17.6 6.31a7.85 7.85 0 0 0-13.4 5.6 7.85 7.85 0 0 0 1.05 3.94L4 20l4.27-1.12a7.85 7.85 0 0 0 3.74.95h.01a7.86 7.86 0 0 0 5.58-13.52z"/></svg>
              </div>
              <div>
                <div className="text-[13px] font-bold text-ink">SEU WhatsApp</div>
                <div className="text-[11px] text-ink-faint">Pra mandar o PDF pro seu próprio número</div>
              </div>
            </div>
            <div className="p-5">
              <label className="text-[11px] uppercase tracking-wider text-ink-muted font-semibold">Telefone (DDD + número)</label>
              <input
                autoFocus
                type="tel"
                value={waPromptValue}
                onChange={(e) => setWaPromptValue(e.target.value.replace(/[^\d]/g, '').slice(0, 13))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && waPromptValue.replace(/\D/g, '').length >= 10) {
                    waPromptResolve?.(waPromptValue)
                  }
                  if (e.key === 'Escape') { waPromptResolve?.(null); setWaPromptOpen(false) }
                }}
                placeholder="48984692860"
                className="mt-1 w-full px-3 py-2.5 text-[15px] bg-surface-2 border border-border rounded-md focus:outline-none focus:border-emerald-500 text-ink"
              />
              <div className="text-[10px] text-ink-faint mt-1.5">Ex: 48984692860 (sem +55, sem espaços, sem traços)</div>
            </div>
            <div className="bg-surface-2 px-5 py-3 flex justify-end gap-2 border-t border-border">
              <button
                onClick={() => { waPromptResolve?.(null); setWaPromptOpen(false) }}
                className="text-[12px] px-4 py-2 rounded text-ink-muted hover:bg-surface-3 transition"
              >
                Cancelar
              </button>
              <button
                onClick={() => waPromptResolve?.(waPromptValue)}
                disabled={waPromptValue.replace(/\D/g, '').length < 10}
                className="text-[12px] px-5 py-2 rounded bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-semibold transition"
              >
                Confirmar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ──────────────────────────────────────────────────────────────────────────
// Selector de modelo pronto (carrega items + motores + acessórios do banco)
// ──────────────────────────────────────────────────────────────────────────
function SelectorModelo({ onCarregar }: { onCarregar: (m: OrcamentoModelo) => void }) {
  const { data: modelos, isLoading } = useOrcamentoModelos()
  const [open, setOpen] = useState(false)
  const [busca, setBusca] = useState('')
  const filtrados = useMemo(() => {
    if (!modelos) return []
    if (!busca.trim()) return modelos
    const q = busca.toLowerCase()
    return modelos.filter(m =>
      m.basename.toLowerCase().includes(q) ||
      (m.pacote || '').toLowerCase().includes(q)
    )
  }, [modelos, busca])
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="text-[11px] px-3 py-1.5 rounded font-semibold bg-accent/15 hover:bg-accent/25 text-accent border border-accent/30 flex items-center gap-1.5"
        title="Carregar items a partir de um modelo pronto"
      >
        <Package className="h-3.5 w-3.5" />
        Carregar Modelo {modelos && `(${modelos.length})`}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full right-0 mt-1 w-[420px] max-h-[60vh] overflow-hidden bg-bg border border-border rounded-lg shadow-2xl z-50 flex flex-col">
            <div className="p-2 border-b border-border bg-surface-2">
              <input
                type="text"
                value={busca}
                onChange={e => setBusca(e.target.value)}
                placeholder="Buscar modelo (ex: compacta, mini fabrica)..."
                className="w-full px-2 py-1.5 bg-bg border border-border rounded text-[11px] text-ink focus:border-accent outline-none"
                autoFocus
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading && <div className="p-4 text-[11px] text-ink-muted text-center">Carregando modelos…</div>}
              {!isLoading && filtrados.length === 0 && <div className="p-4 text-[11px] text-ink-muted text-center">Nenhum modelo encontrado</div>}
              {filtrados.map(m => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => { onCarregar(m); setOpen(false); setBusca('') }}
                  className="w-full text-left px-3 py-2 hover:bg-surface-2 border-b border-border/50 group flex items-center gap-2.5"
                >
                  {m.foto_url ? (
                    <img
                      src={m.foto_url}
                      alt={m.basename}
                      className="w-12 h-12 object-cover rounded-md border border-border shrink-0 bg-white"
                      loading="lazy"
                      onError={e => { e.currentTarget.style.display = 'none' }}
                    />
                  ) : (
                    <div className="w-12 h-12 rounded-md border border-border bg-surface-2 shrink-0 flex items-center justify-center text-ink-faint">
                      <Package className="h-4 w-4" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[11px] font-semibold text-ink truncate">{m.basename}</span>
                      <span className="text-[10px] font-bold text-success tabular-nums shrink-0">{formatBRL(Number(m.total_proposta))}</span>
                    </div>
                    <div className="text-[9px] text-ink-faint mt-0.5 flex items-center gap-1.5 flex-wrap">
                      {m.pacote && <span className="px-1 py-0.5 rounded bg-surface-3 text-accent font-bold">{m.pacote}</span>}
                      <span className="text-blue-400 font-medium">{m.voltagem}</span>
                      {m.is_master && <span className="text-warning font-bold">MASTER</span>}
                      {m.is_jr && <span className="text-info font-bold">JR</span>}
                      <span>· {m.itens.length} items · {m.motores.length} motores</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}


// ──────────────────────────────────────────────────────────────────────────
// Card de item do catálogo (esquerda)
// ──────────────────────────────────────────────────────────────────────────

function CardItem({
  item, voltagem, motores, onAdd,
}: {
  item: CatalogoItem
  voltagem: Voltagem
  motores: CatalogoMotor[]
  onAdd: () => void
}) {
  const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos
    ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagem)
    : null
  const motorValor = motorMatch ? Number(motorMatch.valor) * (item.motor_padrao_qtd || 1) : 0
  const totalComMotor = Number(item.valor) + motorValor

  return (
    <button
      onClick={onAdd}
      className="text-left p-2 rounded-lg border border-border hover:border-accent hover:bg-surface-2 transition-all group flex items-center gap-2.5 relative"
    >
      {item.foto_url ? (
        <img
          src={item.foto_url}
          alt={item.nome_curto}
          className="w-14 h-14 object-cover rounded-md border border-border shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-14 h-14 rounded-md border border-border bg-surface-2 shrink-0 flex items-center justify-center text-ink-faint">
          <Package className="h-5 w-5" />
        </div>
      )}
      <div className="flex-1 min-w-0 self-stretch flex flex-col justify-between py-0.5">
        <div>
          <div className="flex items-center gap-1 mb-0.5">
            <span className="text-[9px] uppercase tracking-wider text-accent font-bold truncate">
              {item.categoria}
            </span>
            {item.is_oficial && <Check className="h-2.5 w-2.5 text-success shrink-0" />}
          </div>
          <div className="text-[13px] font-semibold text-ink leading-snug" title={item.nome_curto}>
            {item.nome_curto}
          </div>
        </div>
        <div className="flex items-center gap-2 mt-1">
          {item.motor_padrao_cv && (
            <div className="text-[9px] text-ink-faint leading-none flex items-center gap-0.5">
              ⚡ <span>{item.motor_padrao_cv} CV {item.motor_padrao_polos}p</span>
            </div>
          )}
        </div>
      </div>
      <div className="text-right shrink-0 self-stretch flex flex-col justify-center">
        <div className="text-[12px] font-bold text-ink leading-tight tabular-nums">
          {formatBRL(Number(item.valor))}
        </div>
        {motorValor > 0 && (
          <div className="text-[10px] font-semibold text-accent leading-tight tabular-nums mt-0.5">
            ={formatBRL(totalComMotor)}
          </div>
        )}
      </div>
      <Plus className="h-3.5 w-3.5 text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0 absolute top-1.5 right-1.5" />
    </button>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Linha do carrinho em modo EDIÇÃO (controles compactos)
// ──────────────────────────────────────────────────────────────────────────

function CarrinhoLinhaEdicao({
  item, onRemove, onQtd, onValor,
}: {
  item: CarrinhoItem
  onRemove: () => void
  onQtd: (n: number) => void
  onValor: (v: number) => void
}) {
  const [editingValor, setEditingValor] = useState(false)
  const subtotal = item.valor * item.qtd
  const motorTotal = item.motor_valor_unit * item.motor_qtd * item.qtd
  const totalLinha = subtotal + motorTotal
  const valorEditado = item.valor !== item.valor_original

  return (
    <div className="p-3 hover:bg-surface-2/30 transition-colors group">
      <div className="flex gap-3">
        {/* Foto à esquerda */}
        <div className="shrink-0">
          {item.foto_url ? (
            <img
              src={item.foto_url}
              alt={item.nome}
              className="w-14 h-14 object-cover rounded border border-border bg-white"
              loading="lazy"
            />
          ) : (
            <div className="w-14 h-14 rounded border border-border bg-surface-2 flex items-center justify-center text-ink-faint">
              <Package className="h-5 w-5" />
            </div>
          )}
        </div>

        {/* Info + controles à direita */}
        <div className="flex-1 min-w-0">
          {/* Header: categoria + nome + remover */}
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="text-[9px] uppercase tracking-wider text-ink-faint font-bold">
                {item.categoria}
              </div>
              <div className="text-[12px] font-semibold text-ink leading-tight">
                {item.nome}
              </div>
              {item.motor_cv && (
                <div className="text-[10px] text-ink-muted mt-1 flex items-center gap-1.5">
                  <Zap className="h-2.5 w-2.5 text-warning" />
                  <span>Motor {item.motor_cv} CV {item.motor_polos} polos{item.motor_qtd > 1 && ` (x${item.motor_qtd})`}</span>
                  {item.motor_valor_unit > 0
                    ? <span className="text-ink-faint">— {formatBRL(item.motor_valor_unit * item.motor_qtd)}/un</span>
                    : (
                      <span className="text-warning flex items-center gap-0.5">
                        <AlertCircle className="h-2.5 w-2.5" />
                        sem motor cadastrado
                      </span>
                    )
                  }
                </div>
              )}
            </div>
            <button
              onClick={onRemove}
              className="text-ink-faint hover:text-danger shrink-0 p-1 opacity-50 group-hover:opacity-100 transition-opacity"
              title="Remover item"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Controles: qtd + valor unit + total */}
          <div className="flex items-center justify-between gap-3 mt-2.5 pt-2 border-t border-border/50">
            {/* Quantidade */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-ink-faint font-semibold">Qtd</span>
              <div className="flex items-center bg-surface-2 border border-border rounded">
                <button
                  onClick={() => onQtd(item.qtd - 1)}
                  disabled={item.qtd <= 1}
                  className="px-1.5 py-1 text-ink-muted hover:text-ink hover:bg-surface-3 disabled:opacity-30 disabled:hover:bg-transparent rounded-l"
                >
                  <Minus className="h-3 w-3" />
                </button>
                <span className="text-[12px] font-bold w-7 text-center text-ink">{item.qtd}</span>
                <button
                  onClick={() => onQtd(item.qtd + 1)}
                  className="px-1.5 py-1 text-ink-muted hover:text-ink hover:bg-surface-3 rounded-r"
                >
                  <Plus className="h-3 w-3" />
                </button>
              </div>
            </div>

            {/* Valor unitário (editável) */}
            <div className="flex items-center gap-1.5">
              <span className="text-[9px] uppercase tracking-wider text-ink-faint font-semibold">Unit.</span>
              {editingValor ? (
                <input
                  type="number"
                  value={item.valor}
                  onChange={e => onValor(Number(e.target.value) || 0)}
                  onBlur={() => setEditingValor(false)}
                  onKeyDown={e => { if (e.key === 'Enter') setEditingValor(false) }}
                  autoFocus
                  className="w-24 text-[11px] text-right bg-surface-1 border border-accent rounded px-1.5 py-0.5"
                />
              ) : (
                <button
                  onClick={() => setEditingValor(true)}
                  className={`text-[11px] px-2 py-0.5 rounded border ${valorEditado ? 'border-warning/40 bg-warning/10 text-warning' : 'border-border bg-surface-2 text-ink hover:border-accent/50'}`}
                  title="Clique pra editar"
                >
                  {formatBRL(item.valor)}
                  {valorEditado && <span className="ml-1 text-[9px]">●</span>}
                </button>
              )}
            </div>

            {/* Total da linha */}
            <div className="text-right ml-auto">
              <div className="text-[9px] uppercase tracking-wider text-ink-faint font-semibold">Total</div>
              <div className="text-[13px] font-bold text-accent leading-tight">
                {formatBRL(totalLinha)}
              </div>
              {motorTotal > 0 && (
                <div className="text-[8.5px] text-ink-faint leading-tight">
                  equip {formatBRL(subtotal)} + motor {formatBRL(motorTotal)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ──────────────────────────────────────────────────────────────────────────
// Modal de Acessórios (% sobre equipamentos + lista de itens)
// ──────────────────────────────────────────────────────────────────────────

function AcessoriosModal({
  open, initial, onClose, onSave, onRemove,
}: {
  open: boolean
  initial: { pct: number; items: string[] } | null
  onClose: () => void
  onSave: (cfg: { pct: number; items: string[] }) => void
  onRemove: () => void
}) {
  const [pct, setPct] = useState<number>(initial?.pct ?? 5)
  const [itemsTxt, setItemsTxt] = useState<string>(
    (initial?.items ?? [
      'Painel elétrico',
      'Caixa de comando',
      'Suporte para bag',
    ]).join('\n')
  )

  // Reseta ao abrir o modal pra pegar o estado atual
  useEffect(() => {
    if (open) {
      setPct(initial?.pct ?? 5)
      setItemsTxt((initial?.items ?? ['Painel elétrico', 'Caixa de comando', 'Suporte para bag']).join('\n'))
    }
  }, [open, initial])

  if (!open) return null

  function handleSalvar() {
    const items = itemsTxt.split('\n').map(l => l.trim()).filter(Boolean)
    onSave({ pct: Math.max(0, Math.min(100, pct)), items })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-bg border border-border rounded-lg max-w-md w-full p-5 shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-[15px] font-bold text-ink">Acessórios do orçamento</h2>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="text-[11px] text-ink-muted mb-3">
          O valor é calculado como uma <strong>porcentagem do total de equipamentos</strong>. Os itens listados aparecem como bullets na seção ACESSÓRIOS do orçamento.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] font-semibold text-ink-muted block mb-1">% sobre equipamentos</label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                max={100}
                step={0.5}
                value={pct}
                onChange={e => setPct(Number(e.target.value))}
                className="w-24 text-center"
              />
              <span className="text-[12px] text-ink-muted">%</span>
              <div className="text-[10px] text-ink-faint ml-auto">ex: 5% / 10% / 15%</div>
            </div>
          </div>

          <div>
            <label className="text-[11px] font-semibold text-ink-muted block mb-1">Itens (um por linha)</label>
            <textarea
              value={itemsTxt}
              onChange={e => setItemsTxt(e.target.value)}
              rows={8}
              className="w-full bg-surface-2 border border-border rounded p-2 text-[11px] text-ink resize-none focus:outline-none focus:border-accent"
              placeholder="Painel elétrico&#10;Caixa de comando&#10;Suporte para bag"
            />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button
            onClick={handleSalvar}
            className="flex-1 bg-accent hover:bg-accent-700 text-white text-[12px] font-semibold py-2 rounded"
          >
            Salvar
          </button>
          {initial && (
            <button
              onClick={onRemove}
              className="px-3 py-2 text-[12px] text-danger hover:bg-danger/10 rounded border border-danger/30"
            >
              Remover
            </button>
          )}
          <button
            onClick={onClose}
            className="px-3 py-2 text-[12px] text-ink-muted hover:bg-surface-2 rounded"
          >
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}
