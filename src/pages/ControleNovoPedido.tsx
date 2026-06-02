import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { FilePlus2, CheckCircle2, AlertTriangle } from 'lucide-react'
import { ESTADOS_BR } from '@/types'

function hoje(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function useVendedoresControle() {
  return useQuery({
    queryKey: ['mirror-vendedores'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('mirror_vendedores')
        .select('nome, ativo')
        .order('nome')
      if (error) throw error
      return (data ?? []).filter((v: { ativo: boolean | null }) => v.ativo !== false) as { nome: string }[]
    },
    staleTime: 300_000,
  })
}

interface FormState {
  cliente: string; vendedor: string; data_venda: string; produto: string
  valor_total: string; forma_pagamento: string; telefone: string; cidade: string; estado: string
}
const EMPTY: FormState = { cliente: '', vendedor: '', data_venda: hoje(), produto: '', valor_total: '', forma_pagamento: '', telefone: '', cidade: '', estado: '' }

export function ControleNovoPedido() {
  const navigate = useNavigate()
  const { data: vendedores } = useVendedoresControle()
  const [form, setForm] = useState<FormState>(EMPTY)
  const [submitting, setSubmitting] = useState(false)
  const [ok, setOk] = useState<{ pedido_numero: string } | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const set = (k: keyof FormState) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  const valido = form.vendedor && form.data_venda && form.produto.trim()

  const submit = async () => {
    setErro(null); setOk(null)
    if (!valido) { setErro('Preencha vendedor, data e produto.'); return }
    setSubmitting(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      const token = session?.access_token
      if (!token) { setErro('Sessão expirada — faça login novamente.'); setSubmitting(false); return }

      const resp = await fetch('/api/controle-criar-pedido', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente: form.cliente, vendedor: form.vendedor, data_venda: form.data_venda,
          produto: form.produto, valor_total: form.valor_total, forma_pagamento: form.forma_pagamento,
          telefone: form.telefone, cidade: form.cidade, estado: form.estado,
        }),
      })
      const json = await resp.json().catch(() => ({}))
      if (!resp.ok || !json.ok) {
        const detail = json.detail || json.error || `Erro ${resp.status}`
        setErro(json.error === 'controle_key_missing'
          ? 'A chave do controle não está configurada no servidor (CONTROLE_SERVICE_KEY). Avise o admin.'
          : detail)
        return
      }
      setOk({ pedido_numero: json.pedido.pedido_numero })
      setForm({ ...EMPTY, vendedor: form.vendedor })
    } catch (e) {
      setErro((e as Error).message || 'Falha ao criar pedido.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="p-4 lg:p-8 space-y-4 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
          <FilePlus2 className="h-7 w-7 text-accent" />
          Novo Pedido de Venda
        </h1>
        <p className="text-sm text-text-muted mt-1">Cadastro rápido — grava direto no controle.branorte.com</p>
      </div>

      {ok && (
        <Card className="p-4 border-l-4 border-green-500">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-600 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-text-primary">Pedido criado: <span className="font-mono">{ok.pedido_numero}</span></p>
              <p className="text-xs text-text-muted">Gravado no controle e espelhado no CRM.</p>
            </div>
            <Button variant="secondary" size="sm" onClick={() => navigate('/controle/pedidos')}>Ver pedidos</Button>
          </div>
        </Card>
      )}
      {erro && (
        <Card className="p-4 border-l-4 border-red-500">
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
            <p className="text-sm text-red-700">{erro}</p>
          </div>
        </Card>
      )}

      <Card className="p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Vendedor *">
            <Select
              options={(vendedores ?? []).map(v => ({ value: v.nome, label: v.nome }))}
              placeholder="Selecione"
              value={form.vendedor}
              onChange={set('vendedor')}
            />
          </Field>
          <Field label="Data da venda *">
            <Input type="date" value={form.data_venda} onChange={set('data_venda')} />
          </Field>
          <Field label="Cliente">
            <Input placeholder="Nome do cliente" value={form.cliente} onChange={set('cliente')} />
          </Field>
          <Field label="Telefone">
            <Input placeholder="(00) 00000-0000" value={form.telefone} onChange={set('telefone')} />
          </Field>
          <Field label="Produto / Equipamento *" full>
            <Input placeholder="Ex: Compacta 02 com motor 7,5cv" value={form.produto} onChange={set('produto')} />
          </Field>
          <Field label="Valor total (R$)">
            <Input type="number" inputMode="decimal" placeholder="0,00" value={form.valor_total} onChange={set('valor_total')} />
          </Field>
          <Field label="Forma de pagamento">
            <Input placeholder="Ex: Boleto, PIX, Cartão..." value={form.forma_pagamento} onChange={set('forma_pagamento')} />
          </Field>
          <Field label="Cidade">
            <Input placeholder="Cidade" value={form.cidade} onChange={set('cidade')} />
          </Field>
          <Field label="Estado (UF)">
            <Select
              options={ESTADOS_BR.map(e => ({ value: e, label: e }))}
              placeholder="UF"
              value={form.estado}
              onChange={set('estado')}
            />
          </Field>
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-surface-border">
          <Button variant="ghost" onClick={() => setForm(EMPTY)} disabled={submitting}>Limpar</Button>
          <Button variant="primary" onClick={submit} loading={submitting} disabled={!valido}>Criar pedido</Button>
        </div>
      </Card>
    </div>
  )
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={full ? 'sm:col-span-2' : ''}>
      <label className="block text-xs font-medium text-text-muted mb-1.5">{label}</label>
      {children}
    </div>
  )
}
