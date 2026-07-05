import { useEffect, useState, type ReactNode } from 'react'
import { X, Save, MessageCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { cn, whatsappLink } from '@/lib/utils'
import { useFichaContato, useSalvarFichaContato, type FichaPatch } from '@/hooks/useFichaContato'

// ============================================================================
// Ficha Completa do Cliente — drawer slide-in (aba "Meus" da /prospeccao).
// Seções em scroll: Dados do cliente / Sobre o negócio / Negociação.
// O pai controla a abertura por `contactId` (open = !!contactId).
// ============================================================================

interface Props {
  contactId: string | null
  phone: string | null
  onClose: () => void
  push: (t: string, tone?: 'success' | 'danger' | 'info') => void
}

interface FormState {
  name: string
  email: string
  cpf_cnpj: string
  empresa: string
  city: string
  state: string
  endereco: string
  animal: string
  capacidade: string
  cabecas: string
  o_que_precisa: string
  galpao: string
  finalidade: string
  quando_investir: string
  valor_negociacao: string
  proximo_followup: string
  forma_pagamento: string
}

const FORM_VAZIO: FormState = {
  name: '', email: '', cpf_cnpj: '', empresa: '', city: '', state: '', endereco: '',
  animal: '', capacidade: '', cabecas: '', o_que_precisa: '', galpao: '', finalidade: '',
  quando_investir: '', valor_negociacao: '', proximo_followup: '', forma_pagamento: '',
}

const ANIMAIS = [
  { v: 'Bovino', ic: '🐂' },
  { v: 'Suíno', ic: '🐖' },
  { v: 'Ave', ic: '🐔' },
]

const OPT_PRECISA = [
  'Fábrica de ração completa', 'Fábrica compacta', 'Equipamento avulso', 'Ainda avaliando',
].map(v => ({ value: v, label: v }))

const OPT_GALPAO = [
  'Já tem pronto', 'Precisa do nosso projeto', 'Ainda vai construir',
].map(v => ({ value: v, label: v }))

const OPT_FINALIDADE = [
  'Consumo próprio', 'Revenda', 'Consumo + revenda',
].map(v => ({ value: v, label: v }))

const OPT_QUANDO = [
  'Agora / esse mês', 'Em 1–2 meses', 'Em 3–4 meses', 'Sem prazo definido',
].map(v => ({ value: v, label: v }))

// Parse BR: "145.000,50" -> 145000.5 ; ponto = milhar, vírgula = decimal.
function parseValor(s: string): number | null {
  const cleaned = s.replace(/[^\d,.-]/g, '').trim()
  if (!cleaned) return null
  const n = Number(cleaned.replace(/\./g, '').replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function Field({ label, full, children }: { label: string; full?: boolean; children: ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1', full && 'col-span-2')}>
      <span className="text-[11px] font-medium text-ink-muted">{label}</span>
      {children}
    </label>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] uppercase tracking-wider text-ink-faint font-semibold mb-3">{children}</p>
  )
}

export function FichaContatoDrawer({ contactId, phone, onClose, push }: Props) {
  const open = !!contactId
  const { data: ficha, isLoading } = useFichaContato(contactId)
  const salvar = useSalvarFichaContato()
  const [form, setForm] = useState<FormState>(FORM_VAZIO)

  useEffect(() => {
    if (ficha) {
      setForm({
        name: ficha.name ?? '',
        email: ficha.email ?? '',
        cpf_cnpj: ficha.cpf_cnpj ?? '',
        empresa: ficha.empresa ?? '',
        city: ficha.city ?? '',
        state: ficha.state ?? '',
        endereco: ficha.endereco ?? '',
        animal: ficha.animal ?? '',
        capacidade: ficha.capacidade ?? '',
        cabecas: ficha.cabecas ?? '',
        o_que_precisa: ficha.o_que_precisa ?? '',
        galpao: ficha.galpao ?? '',
        finalidade: ficha.finalidade ?? '',
        quando_investir: ficha.quando_investir ?? '',
        valor_negociacao: ficha.valor_negociacao != null ? String(ficha.valor_negociacao) : '',
        proximo_followup: ficha.proximo_followup ?? '',
        forma_pagamento: ficha.forma_pagamento ?? '',
      })
    }
  }, [ficha])

  const set = <K extends keyof FormState>(k: K, v: string) => setForm(f => ({ ...f, [k]: v }))

  const handleSave = () => {
    if (!contactId) return
    const patch: FichaPatch = {
      name: form.name || null,
      email: form.email || null,
      cpf_cnpj: form.cpf_cnpj || null,
      empresa: form.empresa || null,
      city: form.city || null,
      state: form.state || null,
      endereco: form.endereco || null,
      animal: form.animal || null,
      capacidade: form.capacidade || null,
      cabecas: form.cabecas || null,
      o_que_precisa: form.o_que_precisa || null,
      galpao: form.galpao || null,
      finalidade: form.finalidade || null,
      quando_investir: form.quando_investir || null,
      valor_negociacao: parseValor(form.valor_negociacao),
      proximo_followup: form.proximo_followup || null,
      forma_pagamento: form.forma_pagamento || null,
    }
    salvar.mutate(
      { contactId, patch },
      {
        onSuccess: () => { push('Ficha salva ✓', 'success'); onClose() },
        onError: () => push('Não deu pra salvar', 'danger'),
      },
    )
  }

  return (
    <aside
      aria-hidden={!open}
      className={cn(
        'fixed top-0 right-0 h-full w-full sm:w-[560px] z-50 bg-surface border-l border-border',
        'shadow-2xl flex flex-col transition-transform duration-300 ease-out',
        open ? 'translate-x-0' : 'translate-x-full',
      )}
    >
      {/* Cabeçalho */}
      <div className="flex items-center gap-3 px-5 py-4 border-b border-border shrink-0">
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink truncate">
            {form.name.trim() || 'Ficha do cliente'}
          </p>
          <p className="text-[12px] text-ink-muted truncate">
            {[form.city, form.state].filter(Boolean).join('/') || 'Cadastro completo do cliente'}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Fechar"
          className="shrink-0 h-8 w-8 inline-flex items-center justify-center rounded-md border border-border text-ink-muted hover:text-ink hover:bg-surface-2 transition-colors"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Corpo */}
      <div className="flex-1 overflow-y-auto px-5 py-5 flex flex-col gap-7">
        {isLoading ? (
          <p className="text-[13px] text-ink-muted">Carregando ficha…</p>
        ) : (
          <>
            {/* Dados do cliente */}
            <section>
              <SectionTitle>👤 Dados do cliente</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Nome / Razão social" full>
                  <Input value={form.name} onChange={e => set('name', e.target.value)} placeholder="Nome do cliente" />
                </Field>
                <Field label="WhatsApp" full>
                  <div className="flex items-center gap-2">
                    <Input value={phone ?? ''} readOnly placeholder="—" className="flex-1 font-mono" />
                    {phone && (
                      <a
                        href={whatsappLink(phone)}
                        target="_blank"
                        rel="noreferrer"
                        className="shrink-0 h-9 px-3 inline-flex items-center gap-1.5 rounded-md bg-accent text-white text-[12.5px] font-medium hover:bg-accent/90 shadow-sm transition-all"
                      >
                        <MessageCircle className="h-3.5 w-3.5" /> Abrir
                      </a>
                    )}
                  </div>
                </Field>
                <Field label="E-mail">
                  <Input value={form.email} onChange={e => set('email', e.target.value)} placeholder="opcional" type="email" />
                </Field>
                <Field label="CPF / CNPJ">
                  <Input value={form.cpf_cnpj} onChange={e => set('cpf_cnpj', e.target.value)} placeholder="opcional" />
                </Field>
                <Field label="Empresa / Fazenda" full>
                  <Input value={form.empresa} onChange={e => set('empresa', e.target.value)} placeholder="opcional" />
                </Field>
                <Field label="Cidade">
                  <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Cidade" />
                </Field>
                <Field label="UF">
                  <Input value={form.state} onChange={e => set('state', e.target.value)} placeholder="UF" />
                </Field>
                <Field label="Endereço (entrega)" full>
                  <Input value={form.endereco} onChange={e => set('endereco', e.target.value)} placeholder="rua, nº, bairro, CEP — opcional" />
                </Field>
              </div>
            </section>

            {/* Sobre o negócio */}
            <section>
              <SectionTitle>🐄 Sobre o negócio</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Animal" full>
                  <div className="flex flex-wrap gap-2">
                    {ANIMAIS.map(a => (
                      <button
                        key={a.v}
                        type="button"
                        onClick={() => set('animal', form.animal === a.v ? '' : a.v)}
                        className={cn(
                          'h-9 px-3.5 rounded-md text-[13px] font-medium border transition-all',
                          form.animal === a.v
                            ? 'bg-success/10 text-success border-success/40'
                            : 'bg-surface-2 text-ink-muted border-border hover:text-ink hover:border-border-strong',
                        )}
                      >
                        {a.ic} {a.v}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="Capacidade (t/h)">
                  <Input value={form.capacidade} onChange={e => set('capacidade', e.target.value)} placeholder="ex: 2 t/h" />
                </Field>
                <Field label="Qtd. de cabeças">
                  <Input value={form.cabecas} onChange={e => set('cabecas', e.target.value)} placeholder="ex: 300" />
                </Field>
                <Field label="O que ele precisa" full>
                  <Select
                    className="w-full"
                    value={form.o_que_precisa}
                    onChange={e => set('o_que_precisa', e.target.value)}
                    placeholder="Selecione…"
                    options={OPT_PRECISA}
                  />
                </Field>
                <Field label="Galpão">
                  <Select
                    className="w-full"
                    value={form.galpao}
                    onChange={e => set('galpao', e.target.value)}
                    placeholder="Selecione…"
                    options={OPT_GALPAO}
                  />
                </Field>
                <Field label="Finalidade">
                  <Select
                    className="w-full"
                    value={form.finalidade}
                    onChange={e => set('finalidade', e.target.value)}
                    placeholder="Selecione…"
                    options={OPT_FINALIDADE}
                  />
                </Field>
                <Field label="Quando pretende investir" full>
                  <Select
                    className="w-full"
                    value={form.quando_investir}
                    onChange={e => set('quando_investir', e.target.value)}
                    placeholder="Selecione…"
                    options={OPT_QUANDO}
                  />
                </Field>
              </div>
            </section>

            {/* Negociação */}
            <section>
              <SectionTitle>💰 Negociação</SectionTitle>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Valor da negociação">
                  <Input value={form.valor_negociacao} onChange={e => set('valor_negociacao', e.target.value)} placeholder="R$ 0" inputMode="decimal" />
                </Field>
                <Field label="Próximo follow-up">
                  <Input value={form.proximo_followup} onChange={e => set('proximo_followup', e.target.value)} type="date" />
                </Field>
                <Field label="Forma de pagamento" full>
                  <Input value={form.forma_pagamento} onChange={e => set('forma_pagamento', e.target.value)} placeholder="à vista, parcelado, BNDES…" />
                </Field>
              </div>
            </section>
          </>
        )}
      </div>

      {/* Rodapé */}
      <div className="px-5 py-3 border-t border-border flex items-center gap-2 bg-surface shrink-0">
        <Button
          variant="primary"
          className="flex-1"
          loading={salvar.isPending}
          disabled={!contactId || isLoading}
          onClick={handleSave}
        >
          <Save className="h-3.5 w-3.5" /> Salvar
        </Button>
        {phone && (
          <a
            href={whatsappLink(phone)}
            target="_blank"
            rel="noreferrer"
            className="h-9 px-3.5 inline-flex items-center gap-1.5 rounded-md border border-success/40 text-success text-[13px] font-medium hover:bg-success/10 transition-colors"
          >
            <MessageCircle className="h-3.5 w-3.5" /> WhatsApp
          </a>
        )}
      </div>
    </aside>
  )
}
