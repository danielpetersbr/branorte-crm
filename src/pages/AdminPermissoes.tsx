import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  ASSIGNABLE_ROLES,
  FEATURE_CATALOG,
  ROLE_LABELS,
  useRolePermissions,
  type AssignableRole,
} from '@/hooks/usePermissions'

type PermMatrix = Record<AssignableRole, Record<string, boolean>>

function emptyMatrix(): PermMatrix {
  return {
    admin: {},
    vendor: {},
    marketing: {},
  }
}

export function AdminPermissoes() {
  const { data, isLoading } = useRolePermissions()
  const qc = useQueryClient()
  const [draft, setDraft] = useState<PermMatrix>(emptyMatrix)
  const [savedAt, setSavedAt] = useState<string | null>(null)

  // Hidrata o draft sempre que a query atualizar (e antes do primeiro save).
  useEffect(() => {
    if (!data) return
    const next = emptyMatrix()
    for (const row of data) {
      next[row.role as AssignableRole] = { ...row.permissions }
    }
    setDraft(next)
  }, [data])

  const dirty = useMemo(() => {
    if (!data) return false
    for (const role of ASSIGNABLE_ROLES) {
      const original = data.find(r => r.role === role)?.permissions ?? {}
      const current = draft[role] ?? {}
      const allKeys = new Set([...Object.keys(original), ...Object.keys(current), ...FEATURE_CATALOG.map(f => f.key)])
      for (const k of allKeys) {
        if (!!original[k] !== !!current[k]) return true
      }
    }
    return false
  }, [data, draft])

  const saveMutation = useMutation({
    mutationFn: async () => {
      // Salva uma role por vez (UPSERT). Mais simples que monta payload bulk e
      // ainda dá pra ver erro por role no log.
      for (const role of ASSIGNABLE_ROLES) {
        const perms: Record<string, boolean> = {}
        for (const f of FEATURE_CATALOG) perms[f.key] = !!draft[role][f.key]
        const { error } = await supabase
          .from('role_permissions')
          .upsert({ role, permissions: perms }, { onConflict: 'role' })
        if (error) throw error
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['role_permissions'] })
      setSavedAt(new Date().toLocaleTimeString('pt-BR'))
    },
  })

  if (isLoading) return <PageLoading />

  const toggle = (role: AssignableRole, key: string) => {
    setDraft(d => ({ ...d, [role]: { ...d[role], [key]: !d[role][key] } }))
  }

  const setAll = (role: AssignableRole, value: boolean) => {
    const next: Record<string, boolean> = {}
    for (const f of FEATURE_CATALOG) next[f.key] = value
    setDraft(d => ({ ...d, [role]: next }))
  }

  const groups = Array.from(new Set(FEATURE_CATALOG.map(f => f.group)))

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-5xl">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Permissões por Função</h1>
          <p className="text-sm text-text-secondary mt-1">
            Marque o que cada role pode ver/fazer. Aplica-se a todos os usuários daquela role.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {savedAt && !dirty && (
            <span className="text-xs text-text-muted">Salvo às {savedAt}</span>
          )}
          {saveMutation.isError && (
            <span className="text-xs text-red-600">Erro ao salvar</span>
          )}
          <Button
            variant="primary"
            size="md"
            disabled={!dirty || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
          >
            {saveMutation.isPending ? 'Salvando…' : 'Salvar alterações'}
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-surface-secondary text-text-muted text-xs">
            <tr>
              <th className="text-left px-4 py-2 w-1/2">Feature</th>
              {ASSIGNABLE_ROLES.map(role => (
                <th key={role} className="px-4 py-2 text-center">
                  <div>{ROLE_LABELS[role]}</div>
                  <div className="flex justify-center gap-1 mt-1">
                    <button
                      onClick={() => setAll(role, true)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-surface-border hover:bg-text-muted/20"
                      title="Marcar tudo"
                    >
                      tudo
                    </button>
                    <button
                      onClick={() => setAll(role, false)}
                      className="text-[10px] px-1.5 py-0.5 rounded bg-surface-border hover:bg-text-muted/20"
                      title="Desmarcar tudo"
                    >
                      nada
                    </button>
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(group => (
              <FeatureGroup
                key={group}
                title={group}
                features={FEATURE_CATALOG.filter(f => f.group === group)}
                draft={draft}
                onToggle={toggle}
              />
            ))}
          </tbody>
        </table>
      </Card>

      <Card className="p-4 bg-surface-secondary">
        <h2 className="text-sm font-semibold text-text-primary mb-1">Como funciona</h2>
        <ul className="text-xs text-text-secondary space-y-1 list-disc list-inside">
          <li>Mudanças entram em vigor no próximo refresh dos usuários (cache de 1 min).</li>
          <li>Roles <code>pending</code> e <code>rejected</code> nunca veem nada (gerenciadas em /admin/usuarios).</li>
          <li>Pra adicionar nova feature na matriz, edite <code>FEATURE_CATALOG</code> em <code>src/hooks/usePermissions.ts</code>.</li>
        </ul>
      </Card>
    </div>
  )
}

interface GroupProps {
  title: string
  features: typeof FEATURE_CATALOG
  draft: PermMatrix
  onToggle: (role: AssignableRole, key: string) => void
}

function FeatureGroup({ title, features, draft, onToggle }: GroupProps) {
  return (
    <>
      <tr className="bg-surface-secondary/50">
        <td colSpan={1 + ASSIGNABLE_ROLES.length} className="px-4 py-1.5 text-[11px] uppercase tracking-wider text-text-muted font-semibold">
          {title}
        </td>
      </tr>
      {features.map(f => (
        <tr key={f.key} className="border-t border-surface-border">
          <td className="px-4 py-2">
            <div className="text-text-primary">{f.label}</div>
            <div className="text-[10px] text-text-muted font-mono">{f.key}</div>
          </td>
          {ASSIGNABLE_ROLES.map(role => (
            <td key={role} className="px-4 py-2 text-center">
              <input
                type="checkbox"
                checked={!!draft[role]?.[f.key]}
                onChange={() => onToggle(role, f.key)}
                className="h-4 w-4 cursor-pointer accent-accent"
              />
            </td>
          ))}
        </tr>
      ))}
    </>
  )
}

export default AdminPermissoes
