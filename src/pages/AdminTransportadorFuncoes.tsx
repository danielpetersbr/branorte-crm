import { useState } from 'react'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Plus, Pencil, Trash2, Check, X, Settings } from 'lucide-react'
import {
  useTransportadorFuncoes,
  useCriarTransportadorFuncao,
  useAtualizarTransportadorFuncao,
  useDeletarTransportadorFuncao,
  type TransportadorFuncao,
} from '@/hooks/useTransportadorFuncoes'

export default function AdminTransportadorFuncoes() {
  const { data: funcoes, isLoading } = useTransportadorFuncoes()
  const criar = useCriarTransportadorFuncao()
  const atualizar = useAtualizarTransportadorFuncao()
  const deletar = useDeletarTransportadorFuncao()

  // Form de adicionar (sempre visível no topo)
  const [novoNome, setNovoNome] = useState('')
  const [novoCurto, setNovoCurto] = useState('')
  const [novoPolos, setNovoPolos] = useState<4 | 6>(4)

  // Edit inline por linha
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editPatch, setEditPatch] = useState<Partial<TransportadorFuncao>>({})

  if (isLoading) return <PageLoading />

  async function handleCriar() {
    const nome = novoNome.trim()
    if (!nome) return
    try {
      await criar.mutateAsync({ nome, nome_curto: novoCurto.trim() || null, polos: novoPolos })
      setNovoNome('')
      setNovoCurto('')
      setNovoPolos(4)
    } catch (e: any) {
      alert('Erro: ' + (e?.message || e))
    }
  }

  function startEdit(f: TransportadorFuncao) {
    setEditingId(f.id)
    setEditPatch({ nome: f.nome, nome_curto: f.nome_curto, polos: f.polos, ordem: f.ordem })
  }

  async function saveEdit() {
    if (editingId == null) return
    try {
      await atualizar.mutateAsync({ id: editingId, patch: editPatch })
      setEditingId(null)
      setEditPatch({})
    } catch (e: any) {
      alert('Erro: ' + (e?.message || e))
    }
  }

  async function handleDelete(f: TransportadorFuncao) {
    if (!confirm(`Desativar "${f.nome}"? (Soft-delete — orçamentos antigos que usam essa função preservam o nome no item.)`)) return
    try {
      await deletar.mutateAsync(f.id)
    } catch (e: any) {
      alert('Erro: ' + (e?.message || e))
    }
  }

  return (
    <div className="p-4 space-y-4 max-w-4xl mx-auto">
      <header>
        <h1 className="text-2xl font-bold text-ink flex items-center gap-2">
          <Settings className="h-6 w-6 text-accent" /> Funções do Transportador
        </h1>
        <p className="text-ink-muted text-sm">
          Cadastro de funções pré-definidas que aparecem no popup de cálculo de motor por chupim.
          Cada função vai pro nome do item entre parênteses e (se trifásico) determina os polos do motor.
        </p>
      </header>

      {/* Form de cadastro rápido */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink mb-3 flex items-center gap-2">
          <Plus className="h-4 w-4 text-accent" /> Cadastrar nova função
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-12 gap-2 items-end">
          <div className="md:col-span-5">
            <label className="text-[10px] uppercase font-bold text-ink-muted">Nome completo *</label>
            <Input
              value={novoNome}
              onChange={e => setNovoNome(e.target.value)}
              placeholder="ex: Coleta de pó (vertical)"
            />
          </div>
          <div className="md:col-span-4">
            <label className="text-[10px] uppercase font-bold text-ink-muted">
              Nome curto <span className="font-normal text-ink-faint">(opcional — usado no nome do item)</span>
            </label>
            <Input
              value={novoCurto}
              onChange={e => setNovoCurto(e.target.value)}
              placeholder="ex: Coleta de pó"
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-[10px] uppercase font-bold text-ink-muted">Polos</label>
            <div className="flex gap-1">
              {([4, 6] as const).map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setNovoPolos(p)}
                  className={`flex-1 text-[12px] py-1.5 rounded border font-bold transition-colors ${
                    novoPolos === p
                      ? 'bg-accent/20 text-accent border-accent/60'
                      : 'bg-surface-2 text-ink-muted border-border hover:text-ink'
                  }`}
                >{p}p</button>
              ))}
            </div>
          </div>
          <div className="md:col-span-1">
            <Button
              variant="primary"
              size="md"
              onClick={handleCriar}
              disabled={!novoNome.trim() || criar.isPending}
              className="w-full"
            >
              {criar.isPending ? '...' : 'Criar'}
            </Button>
          </div>
        </div>
      </Card>

      {/* Lista */}
      <Card className="p-4">
        <h2 className="text-sm font-semibold text-ink mb-3">
          Funções cadastradas <span className="text-ink-faint font-normal text-[11px]">({funcoes?.length ?? 0})</span>
        </h2>
        <div className="border border-border rounded-md overflow-hidden">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2/60">
              <tr>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">Nome completo</th>
                <th className="text-left px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium">Nome curto</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium w-[80px]">Polos</th>
                <th className="text-center px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium w-[80px]">Ordem</th>
                <th className="text-right px-3 py-2 text-[10px] uppercase tracking-wider text-ink-faint font-medium w-[140px]">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(funcoes ?? []).map(f => {
                const isEditing = editingId === f.id
                return (
                  <tr key={f.id} className="border-t border-border/40 hover:bg-surface-2/30">
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <Input
                          value={editPatch.nome ?? ''}
                          onChange={e => setEditPatch(p => ({ ...p, nome: e.target.value }))}
                        />
                      ) : (
                        <span className="text-ink">{f.nome}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {isEditing ? (
                        <Input
                          value={editPatch.nome_curto ?? ''}
                          onChange={e => setEditPatch(p => ({ ...p, nome_curto: e.target.value || null }))}
                          placeholder="(usa o nome completo)"
                        />
                      ) : (
                        <span className={f.nome_curto ? 'text-ink-muted' : 'text-ink-faint italic'}>
                          {f.nome_curto || '—'}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isEditing ? (
                        <div className="flex gap-0.5 justify-center">
                          {([4, 6] as const).map(p => (
                            <button
                              key={p}
                              type="button"
                              onClick={() => setEditPatch(s => ({ ...s, polos: p }))}
                              className={`text-[11px] px-2 py-1 rounded border font-bold ${
                                editPatch.polos === p
                                  ? 'bg-accent/20 text-accent border-accent/60'
                                  : 'bg-surface-2 text-ink-muted border-border'
                              }`}
                            >{p}p</button>
                          ))}
                        </div>
                      ) : (
                        <span className={`text-[12px] font-bold ${f.polos === 6 ? 'text-warning' : 'text-ink-muted'}`}>
                          {f.polos}p
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {isEditing ? (
                        <Input
                          type="number"
                          value={editPatch.ordem ?? 100}
                          onChange={e => setEditPatch(p => ({ ...p, ordem: parseInt(e.target.value, 10) || 100 }))}
                          className="w-16 text-center mx-auto"
                        />
                      ) : (
                        <span className="text-ink-faint tabular-nums">{f.ordem}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {isEditing ? (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="primary" onClick={saveEdit} loading={atualizar.isPending}>
                            <Check className="h-3.5 w-3.5" /> Salvar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditingId(null); setEditPatch({}) }}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex gap-1 justify-end">
                          <Button size="sm" variant="secondary" onClick={() => startEdit(f)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleDelete(f)}>
                            <Trash2 className="h-3.5 w-3.5 text-danger" />
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
              {(funcoes ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center py-8 text-ink-faint italic">
                    Nenhuma função cadastrada — use o form acima pra criar.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-ink-faint mt-3">
          💡 <strong>Soft-delete:</strong> ao deletar, a função vira inativa (não aparece mais no popup) mas
          orçamentos antigos que usaram preservam o nome do item intacto. Pra reativar é via SQL: <code>UPDATE transportador_funcoes SET ativo=true WHERE id=N</code>.
        </p>
      </Card>
    </div>
  )
}
