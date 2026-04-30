import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useVendors } from '@/hooks/useVendors'
import { Card } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { Check, X } from 'lucide-react'

interface UserRow {
  id: string
  email: string
  display_name: string | null
  role: 'admin' | 'vendor' | 'pending' | 'rejected'
  vendor_id: string | null
  approved_at: string | null
  created_at: string
}

function useUsers() {
  return useQuery({
    queryKey: ['user_profiles'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as UserRow[]
    },
  })
}

export function AdminUsuarios() {
  const { data, isLoading } = useUsers()
  const { data: vendorsData } = useVendors({ incluirInativos: true })
  const qc = useQueryClient()
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [role, setRole] = useState<'admin' | 'vendor'>('vendor')
  const [vendorId, setVendorId] = useState<string>('')

  const updateUser = useMutation({
    mutationFn: async (u: { id: string; role: 'admin' | 'vendor' | 'rejected' | 'pending'; vendor_id?: string | null }) => {
      const patch: Partial<UserRow> & { approved_at: string | null } = {
        role: u.role,
        vendor_id: u.vendor_id ?? null,
        approved_at: u.role === 'rejected' ? null : new Date().toISOString(),
      }
      const { error } = await supabase
        .from('user_profiles')
        .update(patch)
        .eq('id', u.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['user_profiles'] })
      setEditing(null)
    },
  })

  if (isLoading) return <PageLoading />

  const users = data ?? []
  const pending = users.filter(u => u.role === 'pending')
  const approved = users.filter(u => u.role === 'admin' || u.role === 'vendor')
  const rejected = users.filter(u => u.role === 'rejected')

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Usuários</h1>
        <p className="text-sm text-text-secondary mt-1">
          {pending.length} pendente{pending.length !== 1 ? 's' : ''} de aprovação · {approved.length} ativo{approved.length !== 1 ? 's' : ''} · {rejected.length} rejeitado{rejected.length !== 1 ? 's' : ''}
        </p>
      </div>

      {pending.length > 0 && (
        <Section title="Pendentes de aprovação" rows={pending} onApprove={u => {
          setEditing(u)
          setRole('vendor')
          setVendorId('')
        }} onReject={u => updateUser.mutate({ id: u.id, role: 'rejected' })} />
      )}

      <Section title="Usuários ativos" rows={approved} onEdit={u => {
        setEditing(u)
        setRole(u.role === 'admin' ? 'admin' : 'vendor')
        setVendorId(u.vendor_id ?? '')
      }} />

      {rejected.length > 0 && (
        <Section title="Rejeitados" rows={rejected} muted onRestore={u => updateUser.mutate({ id: u.id, role: 'pending' })} />
      )}

      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4 z-50" onClick={() => setEditing(null)}>
          <Card className="p-6 max-w-md w-full" onClick={(e: React.MouseEvent) => e.stopPropagation()}>
            <h2 className="font-bold text-text-primary mb-1">{editing.display_name || editing.email}</h2>
            <p className="text-xs text-text-muted mb-4">{editing.email}</p>
            <div className="space-y-3">
              <label className="block">
                <span className="text-xs text-text-muted">Role</span>
                <Select
                  value={role}
                  onChange={e => setRole(e.target.value as 'admin' | 'vendor')}
                  options={[{ value: 'admin', label: 'Admin (vê tudo)' }, { value: 'vendor', label: 'Vendedor (só seus leads)' }]}
                  className="w-full mt-1"
                />
              </label>
              {role === 'vendor' && (
                <label className="block">
                  <span className="text-xs text-text-muted">Vendedor vinculado</span>
                  <Select
                    value={vendorId}
                    onChange={e => setVendorId(e.target.value)}
                    placeholder="Selecione..."
                    options={(vendorsData ?? []).map(v => ({ value: v.id, label: v.name }))}
                    className="w-full mt-1"
                  />
                </label>
              )}
              <div className="flex gap-2 pt-2">
                <Button
                  variant="primary"
                  size="md"
                  disabled={role === 'vendor' && !vendorId}
                  onClick={() => updateUser.mutate({
                    id: editing.id,
                    role,
                    vendor_id: role === 'vendor' ? vendorId : null,
                  })}
                >
                  Salvar
                </Button>
                <Button variant="secondary" size="md" onClick={() => setEditing(null)}>
                  Cancelar
                </Button>
              </div>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}

interface SectionProps {
  title: string
  rows: UserRow[]
  muted?: boolean
  onApprove?: (u: UserRow) => void
  onReject?: (u: UserRow) => void
  onEdit?: (u: UserRow) => void
  onRestore?: (u: UserRow) => void
}

function Section({ title, rows, muted, onApprove, onReject, onEdit, onRestore }: SectionProps) {
  if (rows.length === 0) return null
  return (
    <Card className={`overflow-hidden ${muted ? 'opacity-70' : ''}`}>
      <div className="px-4 py-2 border-b border-surface-border bg-surface-secondary">
        <h2 className="text-sm font-semibold text-text-primary">{title} ({rows.length})</h2>
      </div>
      <table className="w-full">
        <thead>
          <tr className="text-xs text-text-muted border-b border-surface-border">
            <th className="text-left px-4 py-2">Nome</th>
            <th className="text-left px-4 py-2">Email</th>
            <th className="text-left px-4 py-2">Role</th>
            <th className="text-left px-4 py-2">Cadastrado</th>
            <th className="text-right px-4 py-2">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-border">
          {rows.map(u => (
            <tr key={u.id}>
              <td className="px-4 py-2 text-sm text-text-primary">{u.display_name || '—'}</td>
              <td className="px-4 py-2 text-sm text-text-secondary">{u.email}</td>
              <td className="px-4 py-2"><RoleBadge role={u.role} /></td>
              <td className="px-4 py-2 text-xs text-text-muted">{new Date(u.created_at).toLocaleDateString('pt-BR')}</td>
              <td className="px-4 py-2 text-right">
                <div className="flex items-center justify-end gap-1">
                  {onApprove && (
                    <Button variant="primary" size="sm" onClick={() => onApprove(u)}>
                      <Check className="h-4 w-4" /> Aprovar
                    </Button>
                  )}
                  {onReject && (
                    <Button variant="ghost" size="sm" onClick={() => onReject(u)}>
                      <X className="h-4 w-4" /> Rejeitar
                    </Button>
                  )}
                  {onEdit && (
                    <Button variant="secondary" size="sm" onClick={() => onEdit(u)}>
                      Editar
                    </Button>
                  )}
                  {onRestore && (
                    <Button variant="ghost" size="sm" onClick={() => onRestore(u)}>
                      Reativar
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

function RoleBadge({ role }: { role: UserRow['role'] }) {
  const m: Record<UserRow['role'], { label: string; cls: string }> = {
    admin:    { label: 'Admin',    cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
    vendor:   { label: 'Vendedor', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
    pending:  { label: 'Pendente', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
    rejected: { label: 'Rejeitado', cls: 'bg-red-50 text-red-700 border border-red-200' },
  }
  const v = m[role]
  return <Badge className={v.cls}>{v.label}</Badge>
}
