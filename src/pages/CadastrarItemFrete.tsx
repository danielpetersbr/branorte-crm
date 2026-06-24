// /frete/itens — catalogo PROPRIO de itens de frete. O vendedor cadastra aqui
// (nome + medidas/volume) e os itens passam a aparecer no "Puxar do catalogo" da
// pagina Pedir Frete. Separado do catalogo de orcamentos (catalogo_items).
// Soft-delete: excluir so marca ativo=false, nada se perde.
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Plus, Pencil, Trash2, Package, X, ImagePlus, Loader2 } from 'lucide-react'
import {
  useFreteCatalogoItens, useCriarItemFrete, useAtualizarItemFrete, useExcluirItemFrete, uploadFotoFrete,
  type FreteCatalogoItem,
} from '@/hooks/useFrete'
import { volumeM3 } from '@/lib/calcFrete'

const FORM_VAZIO = { nome: '', c: '', l: '', a: '', peso: '', indiv: false, foto: null as string | null }

export function CadastrarItemFrete() {
  const itens = useFreteCatalogoItens()
  const criar = useCriarItemFrete()
  const atualizar = useAtualizarItemFrete()
  const excluir = useExcluirItemFrete()

  const [form, setForm] = useState(FORM_VAZIO)
  const [editId, setEditId] = useState<string | null>(null)
  const [erro, setErro] = useState('')
  const [fotoBusy, setFotoBusy] = useState(false)

  async function onFoto(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return
    setFotoBusy(true); setErro('')
    try { const url = await uploadFotoFrete(f); setForm(s => ({ ...s, foto: url })) }
    catch { setErro('Falha no upload da foto.') }
    finally { setFotoBusy(false) }
  }

  const lista = itens.data ?? []
  const salvando = criar.isPending || atualizar.isPending

  function salvar() {
    const nome = form.nome.trim()
    if (!nome) { setErro('Informe o nome do item.'); return }
    setErro('')
    const payload = {
      nome,
      comprimento_m: form.c ? Number(form.c) : null,
      largura_m: form.l ? Number(form.l) : null,
      altura_m: form.a ? Number(form.a) : null,
      peso_kg: form.peso ? Number(form.peso) : null,
      indivisivel: form.indiv,
      foto_url: form.foto,
    }
    if (editId) {
      atualizar.mutate({ id: editId, ...payload }, {
        onSuccess: () => { setForm(FORM_VAZIO); setEditId(null) },
        onError: (e: any) => setErro(`Não consegui salvar: ${e?.message ?? e}`),
      })
    } else {
      criar.mutate(payload, {
        onSuccess: () => setForm(FORM_VAZIO),
        onError: (e: any) => setErro(`Não consegui salvar: ${e?.message ?? e}`),
      })
    }
  }

  function editar(it: FreteCatalogoItem) {
    setEditId(it.id)
    setErro('')
    setForm({
      nome: it.nome,
      c: it.comprimento_m != null ? String(it.comprimento_m) : '',
      l: it.largura_m != null ? String(it.largura_m) : '',
      a: it.altura_m != null ? String(it.altura_m) : '',
      peso: it.peso_kg != null ? String(it.peso_kg) : '',
      indiv: it.indivisivel,
      foto: it.foto_url ?? null,
    })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function cancelarEdicao() { setEditId(null); setForm(FORM_VAZIO); setErro('') }

  function remover(it: FreteCatalogoItem) {
    if (!confirm(`Remover "${it.nome}" do catálogo de frete?`)) return
    excluir.mutate(it.id)
    if (editId === it.id) cancelarEdicao()
  }

  const inputCls = 'w-full px-3 py-2 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent'
  const miniInputCls = 'w-full px-2 py-1.5 rounded-lg bg-bg border border-border text-ink text-sm placeholder:text-ink-faint outline-none focus:border-accent'

  return (
    <div className="container mx-auto py-6 px-4 max-w-[1400px]">
      <div className="flex items-center gap-3 mb-6">
        <Link to="/frete/solicitar" className="text-ink-faint hover:text-ink"><ArrowLeft className="h-5 w-5" /></Link>
        <Package className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-2xl font-bold text-ink">Itens de frete</h1>
          <p className="text-xs text-ink-muted">Cadastre os itens com medidas — eles aparecem no “Puxar do catálogo” em Pedir Frete.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-start">
        {/* Form de cadastro/edição */}
        <section className="lg:col-span-1 lg:sticky lg:top-6 bg-surface-1 border border-border rounded-xl p-4">
          <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-1.5">
            {editId ? <><Pencil className="h-4 w-4 text-accent" /> Editar item</> : <><Plus className="h-4 w-4 text-accent" /> Novo item</>}
          </h2>
          <div className="space-y-2">
            <div>
              <label className="text-[11px] text-ink-faint block mb-1">Nome do item</label>
              <input value={form.nome} onChange={e => setForm(f => ({ ...f, nome: e.target.value }))}
                placeholder="Ex: Misturador 300" className={inputCls} />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div><label className="text-[10px] text-ink-faint block mb-0.5">Compr. (m)</label>
                <input type="number" step="0.1" min={0} value={form.c} onChange={e => setForm(f => ({ ...f, c: e.target.value }))} className={miniInputCls} placeholder="0" /></div>
              <div><label className="text-[10px] text-ink-faint block mb-0.5">Larg. (m)</label>
                <input type="number" step="0.1" min={0} value={form.l} onChange={e => setForm(f => ({ ...f, l: e.target.value }))} className={miniInputCls} placeholder="0" /></div>
              <div><label className="text-[10px] text-ink-faint block mb-0.5">Alt. (m)</label>
                <input type="number" step="0.1" min={0} value={form.a} onChange={e => setForm(f => ({ ...f, a: e.target.value }))} className={miniInputCls} placeholder="0" /></div>
            </div>
            <div>
              <label className="text-[10px] text-ink-faint block mb-0.5">Peso (kg)</label>
              <input type="number" min={0} value={form.peso} onChange={e => setForm(f => ({ ...f, peso: e.target.value }))} className={miniInputCls} placeholder="0" />
            </div>
            <label className="flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={form.indiv} onChange={e => setForm(f => ({ ...f, indiv: e.target.checked }))} /> Indivisível (não pode desmontar)
            </label>

            <div>
              <label className="text-[11px] text-ink-faint block mb-1">Foto do equipamento <span className="text-ink-faint">(a transportadora vê ao cotar)</span></label>
              {form.foto ? (
                <div className="relative inline-block">
                  <img src={form.foto} alt="" className="h-24 w-24 object-cover rounded-lg border border-border" />
                  <button type="button" onClick={() => setForm(s => ({ ...s, foto: null }))} className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-red-500 text-white flex items-center justify-center"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <label className="flex w-fit items-center gap-2 cursor-pointer px-3 py-2 rounded-lg border border-dashed border-border hover:border-accent text-sm text-ink-muted">
                  {fotoBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />} {fotoBusy ? 'Enviando…' : 'Adicionar foto'}
                  <input type="file" accept="image/*" className="hidden" onChange={onFoto} disabled={fotoBusy} />
                </label>
              )}
            </div>

            {erro && <p className="text-xs text-red-500">{erro}</p>}

            <div className="flex gap-2 pt-1">
              <button onClick={salvar} disabled={salvando}
                className="flex-1 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-60 flex items-center justify-center gap-1">
                {editId ? <><Pencil className="h-4 w-4" /> Salvar alteração</> : <><Plus className="h-4 w-4" /> Cadastrar item</>}
              </button>
              {editId && (
                <button onClick={cancelarEdicao} className="px-3 py-2 rounded-lg border border-border text-sm text-ink-muted hover:text-ink">Cancelar</button>
              )}
            </div>
          </div>
        </section>

        {/* Lista de itens cadastrados */}
        <section className="lg:col-span-2 bg-surface-1 border border-border rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-ink">Itens cadastrados</h2>
            <span className="text-xs text-ink-faint">{lista.length} {lista.length === 1 ? 'item' : 'itens'}</span>
          </div>

          {itens.isLoading && <div className="text-sm text-ink-faint py-6 text-center">Carregando…</div>}
          {itens.error && <div className="text-sm text-red-500 py-6 text-center">Erro ao carregar: {String((itens.error as Error).message)}</div>}

          {!itens.isLoading && !itens.error && lista.length === 0 && (
            <div className="text-sm text-ink-faint text-center border border-dashed border-border rounded-lg py-10">
              Nenhum item de frete cadastrado ainda.<br />Cadastre o primeiro no formulário ao lado.
            </div>
          )}

          {lista.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-ink-faint border-b border-border">
                    <th className="py-2 pr-2 font-medium">Nome</th>
                    <th className="py-2 px-2 font-medium">Medidas (C×L×A)</th>
                    <th className="py-2 px-2 font-medium text-right">Peso</th>
                    <th className="py-2 px-2 font-medium text-right">Volume</th>
                    <th className="py-2 px-2 font-medium text-center">Indiv.</th>
                    <th className="py-2 pl-2 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map(it => {
                    const temDim = (it.comprimento_m ?? 0) > 0 || (it.largura_m ?? 0) > 0 || (it.altura_m ?? 0) > 0
                    const vol = volumeM3(it.comprimento_m ?? 0, it.largura_m ?? 0, it.altura_m ?? 0)
                    return (
                      <tr key={it.id} className={`border-b border-border/60 ${editId === it.id ? 'bg-accent/5' : ''}`}>
                        <td className="py-2 pr-2 text-ink">
                          <div className="flex items-center gap-2">
                            {it.foto_url
                              ? <img src={it.foto_url} alt="" className="h-9 w-9 object-cover rounded border border-border shrink-0" />
                              : <div className="h-9 w-9 rounded border border-border bg-bg shrink-0 flex items-center justify-center text-ink-faint"><Package className="h-4 w-4" /></div>}
                            <span>{it.nome}</span>
                          </div>
                        </td>
                        <td className="py-2 px-2 text-ink-muted">{temDim ? `${it.comprimento_m ?? 0}×${it.largura_m ?? 0}×${it.altura_m ?? 0}m` : '—'}</td>
                        <td className="py-2 px-2 text-ink-muted text-right">{it.peso_kg ? `${it.peso_kg} kg` : '—'}</td>
                        <td className="py-2 px-2 text-ink-muted text-right">{vol > 0 ? `${vol.toFixed(2)} m³` : '—'}</td>
                        <td className="py-2 px-2 text-center">{it.indivisivel ? <span className="text-accent">●</span> : <span className="text-ink-faint">—</span>}</td>
                        <td className="py-2 pl-2">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => editar(it)} title="Editar" className="p-1.5 rounded-md text-ink-faint hover:text-ink hover:bg-bg"><Pencil className="h-4 w-4" /></button>
                            <button onClick={() => remover(it)} title="Remover" className="p-1.5 rounded-md text-ink-faint hover:text-red-500 hover:bg-bg"><Trash2 className="h-4 w-4" /></button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

export default CadastrarItemFrete
