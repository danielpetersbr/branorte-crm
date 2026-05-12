import { useEffect, useMemo, useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  Sparkles, Search, Plus, Minus, Trash2, Package,
  Zap, X, AlertCircle, Star, FileText, Eye, ListChecks, Check, Loader2,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import {
  useCatalogoItems, useCatalogoMotores,
  agruparPorCategoria, acharMotorCompativel,
  type CatalogoItem, type CatalogoMotor,
} from '@/hooks/useCatalogo'
import { FinalizarMontarModal, type CarrinhoSnapshot } from '@/components/FinalizarMontarModal'
import { OrcamentoPreview } from '@/components/OrcamentoPreview'

type Voltagem = 'monofasico' | 'trifasico'
type ModoVisao = 'preview' | 'edicao'

interface CarrinhoItem {
  uid: string
  catalogo_id: number
  categoria: string
  nome: string
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

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function formatBRLBare(v: number): string {
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function gerarUid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
}

// Agrupa motores iguais (mesmo CV/polos)
interface MotorAgrupado {
  cv: number
  polos: number
  qtd: number
  valor_unit: number
  valor_total: number
}

function agruparMotores(carrinho: CarrinhoItem[]): MotorAgrupado[] {
  const m = new Map<string, MotorAgrupado>()
  for (const it of carrinho) {
    if (!it.motor_cv || !it.motor_polos) continue
    const qtdMotor = it.motor_qtd * it.qtd
    const key = `${it.motor_cv}-${it.motor_polos}`
    const e = m.get(key)
    if (e) {
      e.qtd += qtdMotor
      e.valor_total += it.motor_valor_unit * qtdMotor
    } else {
      m.set(key, {
        cv: it.motor_cv,
        polos: it.motor_polos,
        qtd: qtdMotor,
        valor_unit: it.motor_valor_unit,
        valor_total: it.motor_valor_unit * qtdMotor,
      })
    }
  }
  return [...m.values()].sort((a, b) => b.cv - a.cv)
}

export function OrcamentoMontar() {
  const { data: items, isLoading: loadingItems } = useCatalogoItems()
  const { data: motores, isLoading: loadingMotores } = useCatalogoMotores()

  const [busca, setBusca] = useState('')
  const [categoria, setCategoria] = useState<string | null>(null)
  const [voltagem, setVoltagem] = useState<Voltagem>('trifasico')
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
  const [fotoPrincipal, setFotoPrincipal] = useState<string | null>(null)

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
    const motorMatch = item.motor_padrao_cv && item.motor_padrao_polos && motores
      ? acharMotorCompativel(motores, Number(item.motor_padrao_cv), item.motor_padrao_polos, voltagem)
      : null

    setCarrinho(c => [...c, {
      uid: gerarUid(),
      catalogo_id: item.id,
      categoria: item.categoria,
      nome: item.nome_curto,
      specs: item.specs || [],
      qtd: 1,
      valor: Number(item.valor),
      valor_original: Number(item.valor),
      motor_cv: item.motor_padrao_cv ? Number(item.motor_padrao_cv) : null,
      motor_polos: item.motor_padrao_polos,
      motor_qtd: item.motor_padrao_qtd || 1,
      motor_valor_unit: motorMatch ? Number(motorMatch.valor) : 0,
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

  function limparCarrinho() {
    if (carrinho.length === 0) return
    if (confirm('Limpar carrinho?')) setCarrinho([])
  }

  function aplicarVoltagem(novaVoltagem: Voltagem) {
    setVoltagem(novaVoltagem)
    if (!motores) return
    setCarrinho(c => c.map(it => {
      if (!it.motor_cv || !it.motor_polos) return it
      const motor = acharMotorCompativel(motores, it.motor_cv, it.motor_polos, novaVoltagem)
      return { ...it, motor_valor_unit: motor ? Number(motor.valor) : it.motor_valor_unit }
    }))
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
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-1.5">
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

        {/* PREVIEW DO ORÇAMENTO */}
        <Card className="flex flex-col min-h-0 overflow-hidden">
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
            nome: c.nome,
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

      {/* Feedback de sucesso */}
      {sucesso && (
        <div className="fixed bottom-4 right-4 z-50 bg-success-bg/20 border border-success/50 rounded-lg p-4 shadow-lg max-w-md">
          <div className="flex items-start gap-2">
            <div className="text-[13px] font-bold text-success">✓ Orçamento {sucesso.numero} gerado</div>
            <button onClick={() => setSucesso(null)} className="ml-auto text-ink-faint hover:text-ink">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="text-[11px] text-ink-muted mt-1">
            {sucesso.salvouNaPasta && '📁 Salvo na pasta Z:'}
            {sucesso.baixouDocx && '⬇️ .docx baixado'}
            {sucesso.baixouPdf && ' · PDF baixado'}
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
                    const tel = window.prompt('Digite SEU número de WhatsApp (DDD + número):', saved.replace(/^55/, ''))
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
              className="mt-2 w-full bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[11px] font-semibold px-3 py-1.5 rounded flex items-center justify-center gap-1.5"
            >
              {enviandoWA === 'enviando'
                ? <><Loader2 className="h-3 w-3 animate-spin" /> Enviando...</>
                : <>📲 Enviar pro meu WhatsApp</>}
            </button>
          )}
          {enviandoWA === 'enviado' && (
            <div className="text-[10px] text-emerald-300 mt-1">✅ {enviandoWAMsg}</div>
          )}
          {enviandoWA === 'erro' && (
            <div className="text-[10px] text-red-400 mt-1">❌ {enviandoWAMsg}</div>
          )}
        </div>
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
      className="text-left p-1.5 rounded border border-border hover:border-accent hover:bg-surface-2 transition-all group flex items-center gap-1.5"
    >
      {item.foto_url ? (
        <img
          src={item.foto_url}
          alt={item.nome_curto}
          className="w-9 h-9 object-cover rounded border border-border shrink-0"
          loading="lazy"
        />
      ) : (
        <div className="w-9 h-9 rounded border border-border bg-surface-2 shrink-0 flex items-center justify-center text-ink-faint">
          <Package className="h-3.5 w-3.5" />
        </div>
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1 mb-0.5">
          <span className="text-[8px] uppercase tracking-wider text-ink-muted font-bold truncate">
            {item.categoria}
          </span>
          {item.is_oficial && (
            <Check className="h-2.5 w-2.5 text-success shrink-0" />
          )}
        </div>
        <div className="text-[11px] font-semibold text-ink truncate leading-tight">
          {item.nome_curto}
        </div>
        {item.motor_padrao_cv && (
          <div className="text-[9px] text-ink-faint truncate">
            ⚡ {item.motor_padrao_cv} CV {item.motor_padrao_polos}p
          </div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="text-[11px] font-bold text-ink leading-tight">
          {formatBRL(Number(item.valor))}
        </div>
        {motorValor > 0 && (
          <div className="text-[9px] font-semibold text-accent leading-tight">
            ={formatBRL(totalComMotor)}
          </div>
        )}
      </div>
      <Plus className="h-3 w-3 text-accent opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
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
