import { useEffect, useMemo, useRef, useState } from 'react'
import {
  X, Check, Loader2, Upload, Image as ImageIcon, Trash2, Plus, Star,
  Camera, Search,
} from 'lucide-react'
import { Input } from '@/components/ui/Input'
import {
  useAtualizarItemCatalogo,
  useCriarItemCatalogo,
  useToggleOficialCatalogo,
  useDeletarItemCatalogo,
  useUploadFotoCatalogo,
  useRemoverFotoCatalogo,
  useCatalogoItemsAdmin,
  type CatalogoItemAdmin,
} from '@/hooks/useCatalogoAdmin'
import { useCatalogoAcessorios } from '@/hooks/useCatalogo'
import { useAuth } from '@/hooks/useAuth'
import {
  ATRIBUTOS_POR_CATEGORIA,
  parseSpecsParaAtributos,
  atributosParaSpecs,
} from '@/lib/categoria-atributos'

interface Props {
  open: boolean
  item: CatalogoItemAdmin | null
  onClose: () => void
  onSaved: () => void
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024 // 5MB
const POLOS_OPTIONS = [2, 4, 6]

function formatBRL(v: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

export function CatalogoItemEditModal({ open, item, onClose, onSaved }: Props) {
  const { profile } = useAuth()
  const { data: todosItems } = useCatalogoItemsAdmin()
  const { data: acessorios } = useCatalogoAcessorios()

  // ─── Estado dos campos editáveis ─────────────────────────────────
  const [isOficial, setIsOficial] = useState(false)
  const [categoria, setCategoria] = useState('')
  const [nomeCurto, setNomeCurto] = useState('')
  const [nomeCompleto, setNomeCompleto] = useState('')
  const [descricao, setDescricao] = useState('')
  const [specs, setSpecs] = useState<string[]>([])
  const [novaSpec, setNovaSpec] = useState('')
  // Atributos estruturados por categoria (ex: capacidade_ton pra SILO).
  // Sao serializados/desserializados de/pra `specs` no banco.
  const [atributos, setAtributos] = useState<Record<string, string>>({})
  const [valor, setValor] = useState<string>('')
  const [motorCv, setMotorCv] = useState<string>('')
  const [motorPolos, setMotorPolos] = useState<string>('')
  const [motorQtd, setMotorQtd] = useState<string>('1')
  const [capKg, setCapKg] = useState<string>('')
  const [capLitros, setCapLitros] = useState<string>('')
  const [acessoriosIds, setAcessoriosIds] = useState<number[]>([])
  const [buscaAcessorio, setBuscaAcessorio] = useState('')
  const [notasCuradoria, setNotasCuradoria] = useState('')

  // ─── Estado de UI ────────────────────────────────────────────────
  const [erroValidacao, setErroValidacao] = useState<string | null>(null)
  const [previewFoto, setPreviewFoto] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const atualizar = useAtualizarItemCatalogo()
  const criar = useCriarItemCatalogo()
  const toggleOficial = useToggleOficialCatalogo()
  const deletar = useDeletarItemCatalogo()
  const uploadFoto = useUploadFotoCatalogo()
  const removerFoto = useRemoverFotoCatalogo()

  // ─── Reseta estado quando item muda (ou quando vai criar novo) ──
  useEffect(() => {
    if (!open) return
    if (!item) {
      // Modo CRIAR — reseta tudo pra vazio
      setIsOficial(false)
      setCategoria('')
      setNomeCurto('')
      setNomeCompleto('')
      setDescricao('')
      setSpecs([])
      setNovaSpec('')
      setAtributos({})
      setValor('')
      setMotorCv('')
      setMotorPolos('')
      setMotorQtd('1')
      setCapKg('')
      setCapLitros('')
      setAcessoriosIds([])
      setBuscaAcessorio('')
      setNotasCuradoria('')
      setErroValidacao(null)
      setPreviewFoto(null)
      return
    }
    // Modo EDITAR — preenche com dados do item
    setIsOficial(item.is_oficial)
    setCategoria(item.categoria || '')
    setNomeCurto(item.nome_curto || '')
    setNomeCompleto(item.nome_completo || '')
    setDescricao(item.descricao || '')
    // Parseia specs: separa atributos estruturados (Capacidade: 200 ton) de specs livres
    const parsed = parseSpecsParaAtributos(Array.isArray(item.specs) ? item.specs : [], item.categoria || '')
    setAtributos(parsed.atributos)
    setSpecs(parsed.specsLivres)
    setNovaSpec('')
    setValor(item.valor != null ? String(item.valor) : '')
    setMotorCv(item.motor_padrao_cv != null ? String(item.motor_padrao_cv) : '')
    setMotorPolos(item.motor_padrao_polos != null ? String(item.motor_padrao_polos) : '')
    setMotorQtd(item.motor_padrao_qtd != null ? String(item.motor_padrao_qtd) : '1')
    setCapKg(item.capacidade_kg != null ? String(item.capacidade_kg) : '')
    setCapLitros(item.capacidade_litros != null ? String(item.capacidade_litros) : '')
    setAcessoriosIds(Array.isArray(item.acessorios_relacionados_ids) ? [...item.acessorios_relacionados_ids] : [])
    setBuscaAcessorio('')
    setNotasCuradoria(item.notas_curadoria || '')
    setErroValidacao(null)
    setPreviewFoto(null)
  }, [item, open])

  // Limpa preview ao fechar
  useEffect(() => {
    if (!open) {
      setPreviewFoto(null)
    }
  }, [open])

  // Quando categoria muda, recalcula as defs (atributos sao mantidos pelo state)
  const atributoDefs = useMemo(() =>
    ATRIBUTOS_POR_CATEGORIA[categoria.trim().toUpperCase()] || [],
    [categoria],
  )

  // ─── Sugestão de categorias (autocomplete) ───────────────────────
  const categoriasSugeridas = useMemo(() => {
    if (!todosItems) return []
    const set = new Set<string>()
    for (const it of todosItems) if (it.categoria) set.add(it.categoria)
    return [...set].sort()
  }, [todosItems])

  // ─── Acessórios filtrados pra dropdown ───────────────────────────
  const acessoriosFiltrados = useMemo(() => {
    if (!acessorios) return []
    const q = buscaAcessorio.trim().toLowerCase()
    const naoSelecionados = acessorios.filter(a => !acessoriosIds.includes(a.id))
    if (!q) return naoSelecionados.slice(0, 8)
    return naoSelecionados
      .filter(a => a.nome.toLowerCase().includes(q) || (a.categoria || '').toLowerCase().includes(q))
      .slice(0, 8)
  }, [acessorios, acessoriosIds, buscaAcessorio])

  const acessoriosSelecionados = useMemo(() => {
    if (!acessorios) return []
    return acessoriosIds
      .map(id => acessorios.find(a => a.id === id))
      .filter((a): a is NonNullable<typeof a> => !!a)
  }, [acessorios, acessoriosIds])

  if (!open || !item) return null

  // ─── Handlers ────────────────────────────────────────────────────
  function adicionarSpec() {
    const s = novaSpec.trim()
    if (!s) return
    setSpecs(prev => [...prev, s])
    setNovaSpec('')
  }

  function removerSpec(idx: number) {
    setSpecs(prev => prev.filter((_, i) => i !== idx))
  }

  function adicionarAcessorio(id: number) {
    setAcessoriosIds(prev => (prev.includes(id) ? prev : [...prev, id]))
    setBuscaAcessorio('')
  }

  function removerAcessorio(id: number) {
    setAcessoriosIds(prev => prev.filter(x => x !== id))
  }

  function abrirSeletor() {
    fileInputRef.current?.click()
  }

  async function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f || !item) return
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(f.type)) {
      setErroValidacao('Formato inválido. Use JPG, PNG ou WEBP.')
      return
    }
    if (f.size > MAX_UPLOAD_BYTES) {
      setErroValidacao('Arquivo maior que 5MB.')
      return
    }
    setErroValidacao(null)
    // Preview imediato
    const url = URL.createObjectURL(f)
    setPreviewFoto(url)
    try {
      await uploadFoto.mutateAsync({ id: item.id, file: f })
      // O hook deve invalidar query; preview some quando item.foto_url chegar
      setPreviewFoto(null)
      URL.revokeObjectURL(url)
    } catch (err) {
      setPreviewFoto(null)
      URL.revokeObjectURL(url)
      setErroValidacao('Falha no upload: ' + (err as Error).message)
    }
  }

  async function handleRemoverFoto() {
    if (!item) return
    if (!confirm('Remover a foto deste item?')) return
    try {
      await removerFoto.mutateAsync(item.id)
    } catch (err) {
      setErroValidacao('Falha ao remover: ' + (err as Error).message)
    }
  }

  async function handleSalvar() {
    if (!nomeCurto.trim()) {
      setErroValidacao('Nome curto é obrigatório.')
      return
    }
    if (!categoria.trim()) {
      setErroValidacao('Categoria é obrigatória.')
      return
    }
    setErroValidacao(null)

    const updates: Partial<CatalogoItemAdmin> = {
      is_oficial: isOficial,
      categoria: categoria.trim().toUpperCase(),
      nome_curto: nomeCurto.trim(),
      nome_completo: nomeCompleto.trim() || nomeCurto.trim(),
      descricao: descricao.trim() || null,
      // Junta atributos estruturados + specs livres
      specs: atributosParaSpecs(atributos, specs.filter(s => s.trim().length > 0), categoria),
      valor: valor === '' ? 0 : Number(valor) || 0,
      motor_padrao_cv: motorCv === '' ? null : Number(motorCv) || null,
      motor_padrao_polos: motorPolos === '' ? null : Number(motorPolos) || null,
      motor_padrao_qtd: motorQtd === '' ? 1 : Math.max(1, Math.floor(Number(motorQtd) || 1)),
      capacidade_kg: capKg === '' ? null : Number(capKg) || null,
      capacidade_litros: capLitros === '' ? null : Number(capLitros) || null,
      acessorios_relacionados_ids: [...acessoriosIds],
      notas_curadoria: notasCuradoria.trim() || null,
      atualizado_por: profile?.display_name || null,
    }

    try {
      if (item) {
        await atualizar.mutateAsync({ id: item.id, updates })
      } else {
        // Modo CRIAR
        await criar.mutateAsync(updates)
      }
      onSaved()
      onClose()
    } catch (err) {
      setErroValidacao('Falha ao salvar: ' + (err as Error).message)
    }
  }

  async function handleToggleOficial() {
    if (!item) return
    const novo = !isOficial
    setIsOficial(novo)
    try {
      await toggleOficial.mutateAsync({ id: item.id, is_oficial: novo })
    } catch (err) {
      setIsOficial(!novo)
      setErroValidacao('Falha ao trocar status: ' + (err as Error).message)
    }
  }

  async function handleExcluir() {
    if (!item) return
    if (!confirm(`Excluir o item "${item.nome_curto}"?\n\nIsso vai desativar o item (soft delete).`)) return
    try {
      await deletar.mutateAsync(item.id)
      onSaved()
      onClose()
    } catch (err) {
      setErroValidacao('Falha ao excluir: ' + (err as Error).message)
    }
  }

  const fotoAtual = previewFoto || item?.foto_url
  const salvando = atualizar.isPending || criar.isPending
  const uploading = uploadFoto.isPending
  const excluindo = deletar.isPending

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-bg border border-border rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto">
        {/* ── Header ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border sticky top-0 bg-bg z-10">
          <div className="min-w-0">
            <h2 className="text-[14px] font-semibold text-ink truncate">
              {item ? `Editar item · #${item.id}` : '+ Novo Produto'}
            </h2>
            <p className="text-[11px] text-ink-faint truncate">
              {item
                ? `${item.categoria || 'Sem categoria'} · ${item.ocorrencias}× usado`
                : 'Cadastrar item novo no catálogo'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-ink-faint hover:text-ink p-1.5 rounded hover:bg-surface-2 transition"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* ── Body ────────────────────────────────────────────────── */}
        <div className="p-5 grid grid-cols-1 md:grid-cols-[200px_1fr] gap-5">
          {/* ── Coluna esquerda: foto ───────────────────────────── */}
          <div className="flex flex-col gap-2">
            <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide">
              Foto
            </label>
            <div className="relative w-[200px] h-[200px] border border-border rounded-md overflow-hidden bg-surface-2 flex items-center justify-center">
              {fotoAtual ? (
                <img src={fotoAtual} alt={item?.nome_curto || 'preview'} className="w-full h-full object-cover" />
              ) : (
                <button
                  type="button"
                  onClick={abrirSeletor}
                  disabled={!item}
                  className="w-full h-full flex flex-col items-center justify-center gap-2 text-ink-faint hover:text-accent hover:bg-surface-3 transition disabled:opacity-50 disabled:cursor-not-allowed"
                  title={!item ? 'Salve primeiro pra adicionar foto' : ''}
                >
                  <Upload className="w-8 h-8" />
                  <span className="text-[11px]">{item ? 'Clique pra enviar' : 'Salve 1° pra adicionar foto'}</span>
                </button>
              )}
              {uploading && (
                <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 animate-spin text-white" />
                </div>
              )}
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/jpg,image/png,image/webp"
              className="hidden"
              onChange={handleFileSelect}
            />
            <div className="flex gap-1.5">
              <button
                type="button"
                onClick={abrirSeletor}
                disabled={uploading || !item}
                className="flex-1 text-[11px] px-2 py-1.5 rounded border border-border bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink transition disabled:opacity-50 flex items-center justify-center gap-1"
              >
                <Camera className="w-3 h-3" />
                Trocar
              </button>
              {item?.foto_url && (
                <button
                  type="button"
                  onClick={handleRemoverFoto}
                  disabled={uploading || removerFoto.isPending}
                  className="flex-1 text-[11px] px-2 py-1.5 rounded border border-border bg-surface-2 hover:bg-danger-bg hover:text-danger text-ink-muted transition disabled:opacity-50 flex items-center justify-center gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Remover
                </button>
              )}
            </div>
            <p className="text-[10px] text-ink-faint">
              JPG/PNG/WEBP até 5MB
            </p>
          </div>

          {/* ── Coluna direita: campos ──────────────────────────── */}
          <div className="flex flex-col gap-4">
            {/* Status toggle */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1.5">
                Status no catálogo
              </label>
              <button
                type="button"
                onClick={handleToggleOficial}
                disabled={toggleOficial.isPending}
                className={`w-full text-[13px] px-4 py-2.5 rounded-md font-semibold transition flex items-center justify-center gap-2 ${
                  isOficial
                    ? 'bg-success-bg text-success border border-success/40'
                    : 'bg-surface-2 text-ink-faint border border-border'
                }`}
              >
                <Star className={`w-4 h-4 ${isOficial ? 'fill-current' : ''}`} />
                {isOficial ? 'OFICIAL — aparece no builder' : 'PENDENTE — escondido do vendedor'}
              </button>
            </div>

            {/* Categoria com sugestões */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                Categoria
              </label>
              <Input
                value={categoria}
                onChange={e => setCategoria(e.target.value)}
                list="catalogo-categorias-sugeridas"
                placeholder="ex: COMPACTA 01"
              />
              <datalist id="catalogo-categorias-sugeridas">
                {categoriasSugeridas.map(c => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>

            {/* ── BLOCO ORÇAMENTO — campos que aparecem pro cliente ── */}
            <div className="p-3 border border-info/30 bg-info/5 rounded-md">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[11px] font-semibold text-info uppercase tracking-wide">
                  Visível no orçamento
                </span>
                <span className="text-[10px] text-ink-faint">
                  — o cliente vê exatamente esses textos no PDF
                </span>
              </div>

              {/* Título (nome_curto + sincroniza nome_completo) */}
              <div className="mb-3">
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                  Título do equipamento <span className="text-danger">*</span>
                </label>
                <Input
                  value={nomeCurto}
                  onChange={e => { setNomeCurto(e.target.value); setNomeCompleto(e.target.value) }}
                  placeholder="ex: CAÇAMBA DE PESAGEM 1000 LITROS (500 KG)"
                />
                <p className="text-[10px] text-info mt-1">
                  Aparece como título do item no orçamento (ex: "A — CAÇAMBA DE PESAGEM 1000L")
                </p>
              </div>

              {/* Descrição */}
              <div>
                <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                  Descrição comercial
                </label>
                <textarea
                  value={descricao}
                  onChange={e => setDescricao(e.target.value)}
                  rows={4}
                  className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all resize-none"
                  placeholder="Descreva o equipamento de forma comercial: o que faz, pra que serve, diferenciais. Ex: Silo metálico com capacidade para 200 toneladas, ideal para armazenamento de grãos e ração animal."
                />
                <p className="text-[10px] text-info mt-1">
                  Aparece no corpo do orçamento abaixo do título — escreva pensando no cliente
                </p>
              </div>

              {/* Preview idêntico ao PDF do orçamento */}
              {nomeCurto.trim() && (
                <div className="mt-3 rounded-lg overflow-hidden border border-border/60">
                  <div className="bg-white/[0.03] px-3 py-1.5 border-b border-border/40">
                    <span className="text-[9px] text-ink-faint uppercase tracking-widest font-semibold">Preview no orçamento (PDF)</span>
                  </div>
                  <div className="px-4 py-3 bg-[#f8f9fa] rounded-b-lg">
                    <p className="font-bold text-[#1a1a2e] text-[13px] leading-tight mb-1.5">
                      B - 01 – {nomeCurto.trim().toUpperCase()}
                    </p>
                    {specs.length > 0 && (
                      <div className="flex flex-col gap-0.5">
                        {specs.map((s, i) => (
                          <p key={i} className="text-[11px] text-[#333] flex items-start gap-1.5">
                            <span className="text-[#999] mt-[2px]">·</span>
                            <span>{s}</span>
                          </p>
                        ))}
                      </div>
                    )}
                    {specs.length === 0 && (
                      <p className="text-[11px] text-[#999] italic">Sem specs — adicione abaixo</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Atributos especificos por categoria */}
            {atributoDefs.length > 0 && (
              <div className="p-3 border border-accent/30 bg-accent/5 rounded-md">
                <div className="flex items-center gap-2 mb-2.5">
                  <span className="text-[11px] font-semibold text-accent uppercase tracking-wide">
                    Atributos do {categoria}
                  </span>
                  <span className="text-[10px] text-ink-faint">
                    (campos específicos pra essa categoria)
                  </span>
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {atributoDefs.map(def => (
                    <div key={def.key}>
                      <label className="text-[10px] text-ink-muted block mb-0.5">
                        {def.label}{def.unidade ? ` (${def.unidade})` : ''}
                      </label>
                      {def.tipo === 'select' ? (
                        <select
                          value={atributos[def.key] || ''}
                          onChange={e => setAtributos(a => ({ ...a, [def.key]: e.target.value }))}
                          className="w-full h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                        >
                          <option value="">—</option>
                          {def.opcoes!.map(op => <option key={op} value={op}>{op}</option>)}
                        </select>
                      ) : (
                        <Input
                          type={def.tipo === 'number' ? 'number' : 'text'}
                          step={def.tipo === 'number' ? 'any' : undefined}
                          value={atributos[def.key] || ''}
                          onChange={e => setAtributos(a => ({ ...a, [def.key]: e.target.value }))}
                          placeholder={def.placeholder}
                        />
                      )}
                      {def.hint && (
                        <p className="text-[9px] text-ink-faint mt-0.5">{def.hint}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Specs livres (lista editável) — atributos extras fora do schema */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1.5">
                {atributoDefs.length > 0 ? 'Specs adicionais (livre)' : 'Specs técnicas'}
              </label>
              <div className="flex flex-col gap-1.5">
                {specs.map((s, i) => (
                  <div key={i} className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-2.5 py-1.5">
                    <span className="flex-1 text-[13px] text-ink truncate">{s}</span>
                    <button
                      type="button"
                      onClick={() => removerSpec(i)}
                      className="text-ink-faint hover:text-danger p-0.5"
                      aria-label="Remover spec"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <div className="flex gap-1.5 mt-0.5">
                  <Input
                    value={novaSpec}
                    onChange={e => setNovaSpec(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault()
                        adicionarSpec()
                      }
                    }}
                    placeholder="Nova spec (ex: Capacidade 200kg/h)"
                  />
                  <button
                    type="button"
                    onClick={adicionarSpec}
                    disabled={!novaSpec.trim()}
                    className="text-[12px] px-3 rounded border border-border bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink transition disabled:opacity-40 flex items-center gap-1 shrink-0"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Preço base */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                Preço base (R$)
              </label>
              <Input
                type="number"
                step="0.01"
                min="0"
                value={valor}
                onChange={e => setValor(e.target.value)}
                placeholder="0,00"
              />
              {valor !== '' && !isNaN(Number(valor)) && (
                <p className="text-[11px] text-ink-faint mt-1">
                  ≈ {formatBRL(Number(valor))}
                </p>
              )}
            </div>

            {/* Motor padrão */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                Motor padrão
              </label>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-[10px] text-ink-faint mb-1">CV</p>
                  <Input
                    type="number"
                    step="0.25"
                    min="0"
                    value={motorCv}
                    onChange={e => setMotorCv(e.target.value)}
                    placeholder="5"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-ink-faint mb-1">Polos</p>
                  <select
                    value={motorPolos}
                    onChange={e => setMotorPolos(e.target.value)}
                    className="w-full h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-ink focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30"
                  >
                    <option value="">—</option>
                    {POLOS_OPTIONS.map(p => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="text-[10px] text-ink-faint mb-1">Qtd</p>
                  <Input
                    type="number"
                    min="1"
                    value={motorQtd}
                    onChange={e => setMotorQtd(e.target.value)}
                    placeholder="1"
                  />
                </div>
              </div>
            </div>

            {/* Capacidade */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                Capacidade
              </label>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-ink-faint mb-1">kg/h</p>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={capKg}
                    onChange={e => setCapKg(e.target.value)}
                    placeholder="—"
                  />
                </div>
                <div>
                  <p className="text-[10px] text-ink-faint mb-1">litros</p>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    value={capLitros}
                    onChange={e => setCapLitros(e.target.value)}
                    placeholder="—"
                  />
                </div>
              </div>
            </div>

            {/* Acessórios relacionados */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1.5">
                Acessórios relacionados
              </label>
              {acessoriosSelecionados.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {acessoriosSelecionados.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => removerAcessorio(a.id)}
                      className="text-[11px] px-2 py-1 rounded-md bg-info/15 text-info hover:bg-danger-bg hover:text-danger transition flex items-center gap-1 border border-info/30"
                    >
                      {a.nome}
                      <X className="w-3 h-3" />
                    </button>
                  ))}
                </div>
              )}
              <div className="relative">
                <Input
                  value={buscaAcessorio}
                  onChange={e => setBuscaAcessorio(e.target.value)}
                  leftIcon={<Search className="w-3.5 h-3.5" />}
                  placeholder="Buscar acessórios pra vincular..."
                />
                {buscaAcessorio && acessoriosFiltrados.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 mt-1 bg-bg border border-border rounded-md shadow-lg max-h-48 overflow-y-auto">
                    {acessoriosFiltrados.map(a => (
                      <button
                        key={a.id}
                        type="button"
                        onClick={() => adicionarAcessorio(a.id)}
                        className="w-full text-left px-3 py-2 text-[12px] text-ink hover:bg-surface-2 transition flex items-center justify-between"
                      >
                        <span className="truncate">{a.nome}</span>
                        <span className="text-[10px] text-ink-faint shrink-0 ml-2">
                          {a.categoria || '—'}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-[10px] text-ink-faint mt-1">
                {acessoriosSelecionados.length} acessório(s) vinculado(s)
              </p>
            </div>

            {/* Notas de curadoria */}
            <div>
              <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wide block mb-1">
                Notas de curadoria
              </label>
              <textarea
                value={notasCuradoria}
                onChange={e => setNotasCuradoria(e.target.value)}
                rows={3}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all resize-none"
                placeholder="Anotações internas (não aparece pro cliente)"
              />
            </div>

            {/* Metadata */}
            {(item.atualizado_por || item.atualizado_em) && (
              <p className="text-[10px] text-ink-faint">
                Última atualização:{' '}
                {item.atualizado_por || 'sistema'}
                {item.atualizado_em && ` em ${new Date(item.atualizado_em).toLocaleString('pt-BR')}`}
              </p>
            )}
          </div>
        </div>

        {/* ── Erro ────────────────────────────────────────────────── */}
        {erroValidacao && (
          <div className="mx-5 mb-3 px-3 py-2 rounded-md bg-danger-bg text-danger text-[12px] border border-danger/30">
            {erroValidacao}
          </div>
        )}

        {/* ── Footer ──────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-border bg-surface-2 sticky bottom-0">
          {item ? (
            <button
              type="button"
              onClick={handleExcluir}
              disabled={excluindo || salvando}
              className="text-[12px] text-danger hover:bg-danger-bg px-2 py-1 rounded transition flex items-center gap-1 disabled:opacity-40"
            >
              {excluindo ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
              Excluir item
            </button>
          ) : <div />}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="text-[12px] px-4 py-2 rounded border border-border bg-surface-2 hover:bg-surface-3 text-ink-muted hover:text-ink font-semibold transition disabled:opacity-40"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleSalvar}
              disabled={salvando || !nomeCurto.trim()}
              className="text-[12px] px-4 py-2 rounded bg-accent hover:bg-accent/90 text-white font-semibold transition flex items-center gap-1.5 disabled:opacity-40"
            >
              {salvando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Salvar
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
