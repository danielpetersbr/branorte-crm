import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/hooks/useAuth'
import { Card } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { useVendorMap } from '@/hooks/useVendorMap'
import { Mail, User, Shield, Save, Lock, LogOut } from 'lucide-react'

const ROLE_BADGE: Record<string, { label: string; cls: string }> = {
  admin: { label: 'Admin', cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
  vendor: { label: 'Vendedor', cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
  pending: { label: 'Pendente', cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
  rejected: { label: 'Rejeitado', cls: 'bg-red-50 text-red-700 border border-red-200' },
}

export function Perfil() {
  const { profile, signOut } = useAuth()
  const vendorMap = useVendorMap()

  const [name, setName] = useState(profile?.display_name ?? '')
  const [savingName, setSavingName] = useState(false)
  const [nameMsg, setNameMsg] = useState<string | null>(null)

  const [oldPwd, setOldPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)
  const [pwdMsg, setPwdMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (profile) setName(profile.display_name ?? '')
  }, [profile])

  if (!profile) return null

  const role = ROLE_BADGE[profile.role] ?? ROLE_BADGE.pending
  const vendorName = profile.vendor_id ? vendorMap[profile.vendor_id] : null

  const saveName = async () => {
    if (!name.trim() || name === profile.display_name) return
    setSavingName(true)
    setNameMsg(null)
    const { error } = await supabase
      .from('user_profiles')
      .update({ display_name: name.trim() })
      .eq('id', profile.id)
    setSavingName(false)
    if (error) setNameMsg('Erro: ' + error.message)
    else setNameMsg('Salvo!')
    setTimeout(() => setNameMsg(null), 2500)
  }

  const changePwd = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwdMsg(null)
    if (newPwd.length < 6) {
      setPwdMsg({ ok: false, text: 'Senha nova precisa ter no mínimo 6 caracteres' })
      return
    }
    if (newPwd !== confirmPwd) {
      setPwdMsg({ ok: false, text: 'Confirmação não bate com a senha nova' })
      return
    }
    setSavingPwd(true)
    // Re-autenticar com senha antiga primeiro (verifica que é o dono da conta)
    const { error: signErr } = await supabase.auth.signInWithPassword({
      email: profile.email,
      password: oldPwd,
    })
    if (signErr) {
      setSavingPwd(false)
      setPwdMsg({ ok: false, text: 'Senha atual incorreta' })
      return
    }
    const { error: updErr } = await supabase.auth.updateUser({ password: newPwd })
    setSavingPwd(false)
    if (updErr) {
      setPwdMsg({ ok: false, text: 'Erro ao trocar senha: ' + updErr.message })
      return
    }
    setOldPwd('')
    setNewPwd('')
    setConfirmPwd('')
    setPwdMsg({ ok: true, text: 'Senha trocada com sucesso!' })
  }

  return (
    <div className="p-4 lg:p-8 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-text-primary">Meu perfil</h1>
        <p className="text-sm text-text-secondary mt-1">Sua conta no Branorte CRM</p>
      </div>

      {/* Info card */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center gap-3 pb-4 border-b border-surface-border">
          <div className="h-12 w-12 rounded-full bg-accent flex items-center justify-center text-white font-bold text-lg">
            {(profile.display_name ?? profile.email)[0].toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="font-semibold text-text-primary truncate">{profile.display_name ?? '—'}</p>
            <p className="text-sm text-text-muted truncate">{profile.email}</p>
          </div>
          <Badge className={role.cls}>{role.label}</Badge>
        </div>

        <Field icon={<Mail className="h-4 w-4" />} label="Email" value={profile.email} readOnly />

        <Field
          icon={<User className="h-4 w-4" />}
          label="Nome de exibição"
          value={name}
          onChange={setName}
          action={
            name.trim() !== (profile.display_name ?? '') && name.trim() !== '' ? (
              <Button size="sm" variant="primary" onClick={saveName} disabled={savingName}>
                <Save className="h-3.5 w-3.5" /> {savingName ? 'Salvando...' : 'Salvar'}
              </Button>
            ) : null
          }
          msg={nameMsg}
        />

        {profile.role === 'vendor' && vendorName && (
          <Field icon={<Shield className="h-4 w-4" />} label="Vendedor vinculado" value={vendorName} readOnly hint="Só admin pode mudar isso" />
        )}

        {profile.role === 'admin' && (
          <Field icon={<Shield className="h-4 w-4" />} label="Permissão" value="Admin (acesso total)" readOnly />
        )}
      </Card>

      {/* Trocar senha */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Lock className="h-4 w-4 text-text-muted" />
          <h2 className="font-semibold text-text-primary">Trocar senha</h2>
        </div>
        <form onSubmit={changePwd} className="space-y-3 max-w-md">
          <label className="block">
            <span className="text-xs text-text-muted">Senha atual</span>
            <input
              type="password"
              required
              value={oldPwd}
              onChange={e => setOldPwd(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-surface-border bg-bg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted">Nova senha (mín. 6 chars)</span>
            <input
              type="password"
              required
              minLength={6}
              value={newPwd}
              onChange={e => setNewPwd(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-surface-border bg-bg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          <label className="block">
            <span className="text-xs text-text-muted">Confirmar nova senha</span>
            <input
              type="password"
              required
              value={confirmPwd}
              onChange={e => setConfirmPwd(e.target.value)}
              className="w-full mt-1 px-3 py-2 rounded-md border border-surface-border bg-bg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
          {pwdMsg && (
            <p className={`text-sm ${pwdMsg.ok ? 'text-green-600' : 'text-red-600'}`}>{pwdMsg.text}</p>
          )}
          <Button type="submit" variant="primary" disabled={savingPwd}>
            {savingPwd ? 'Trocando...' : 'Trocar senha'}
          </Button>
        </form>
      </Card>

      {/* Logout */}
      <Card className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <h2 className="font-semibold text-text-primary">Sair da conta</h2>
            <p className="text-sm text-text-muted mt-0.5">Você será deslogado em todos os dispositivos</p>
          </div>
          <Button variant="secondary" onClick={signOut}>
            <LogOut className="h-4 w-4" /> Sair
          </Button>
        </div>
      </Card>
    </div>
  )
}

interface FieldProps {
  icon: React.ReactNode
  label: string
  value: string
  readOnly?: boolean
  onChange?: (v: string) => void
  action?: React.ReactNode
  hint?: string
  msg?: string | null
}

function Field({ icon, label, value, readOnly, onChange, action, hint, msg }: FieldProps) {
  return (
    <div>
      <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
        {icon}
        <span>{label}</span>
      </div>
      <div className="flex items-center gap-2">
        {readOnly ? (
          <span className="flex-1 text-sm text-text-primary px-3 py-2 rounded-md bg-surface-secondary border border-surface-border">
            {value || '—'}
          </span>
        ) : (
          <input
            type="text"
            value={value}
            onChange={e => onChange?.(e.target.value)}
            className="flex-1 px-3 py-2 rounded-md border border-surface-border bg-bg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent"
          />
        )}
        {action}
      </div>
      {hint && <p className="text-xs text-text-muted mt-1">{hint}</p>}
      {msg && <p className="text-xs text-green-600 mt-1">{msg}</p>}
    </div>
  )
}
