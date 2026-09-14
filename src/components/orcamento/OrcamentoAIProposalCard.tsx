import { AlertTriangle, Check, Image as ImageIcon, PackageCheck } from 'lucide-react'
import type { PropostaOrcamento } from '@/lib/orcamento-ai/types'
import { OrcamentoAIDifferenceList } from './OrcamentoAIDifferenceList'

const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })

export function OrcamentoAIProposalCard({
  proposal, applied, applying, onApply, onCorrect, onFinalize,
}: {
  proposal: PropostaOrcamento
  applied: boolean
  applying: boolean
  onApply: () => void | Promise<void>
  onCorrect: () => void
  onFinalize: () => void
}) {
  const blocked = proposal.status !== 'pronta'
  return (
    <article className="space-y-4 rounded-xl border border-emerald-200 bg-white p-4 text-sm shadow-sm">
      <header>
        <div className="flex items-center gap-2 font-semibold text-emerald-800"><PackageCheck size={18} /> Proposta para conferência</div>
        <p className="mt-1 text-xs text-slate-500">Nada será alterado antes de você confirmar.</p>
      </header>

      <section className="rounded-lg bg-slate-50 p-3">
        <p className="font-semibold">{proposal.cliente.nome || 'Cliente não informado'}</p>
        <p className="text-xs text-slate-600">{[proposal.cliente.telefone, proposal.cliente.cidade, proposal.cliente.uf].filter(Boolean).join(' · ') || 'Contato ainda não informado'}</p>
      </section>

      <section>
        <h4 className="font-semibold">Modelo</h4>
        <p>{proposal.modelo?.basename ?? 'Orçamento composto'}</p>
        <p className="text-xs text-slate-600">{proposal.modelo?.master ? 'Master' : 'Standard'} · {proposal.voltagem === 'monofasico' ? 'Monofásico' : 'Trifásico'}</p>
      </section>

      <section>
        <h4 className="mb-1 font-semibold">Equipamentos ({proposal.itens.length})</h4>
        <div className="max-h-48 space-y-1 overflow-auto pr-1">
          {proposal.itens.map((item, index) => (
            <div key={`${item.catalogoId}-${index}`} className="flex justify-between gap-3 border-b border-slate-100 py-1 text-xs">
              <span>{item.quantidade}× {item.nome}</span><span className="whitespace-nowrap">{money.format(item.quantidade * item.valorUnitario)}</span>
            </div>
          ))}
        </div>
        <p className="mt-1 text-right font-semibold">{money.format(proposal.totais.equipamentos)}</p>
      </section>

      <section>
        <h4 className="mb-1 font-semibold">Motores ({proposal.motores.length})</h4>
        {proposal.motores.map((motor, index) => (
          <div key={`${motor.descricao}-${index}`} className="flex justify-between text-xs">
            <span>{motor.descricao}</span><span>{motor.incluso ? 'Incluso' : money.format(motor.valor)}</span>
          </div>
        ))}
        <p className="mt-1 text-right font-semibold">{money.format(proposal.totais.motores)}</p>
      </section>

      <section>
        <h4 className="mb-1 font-semibold">Acessórios {proposal.acessorios?.mode === 'percentual' ? `(${proposal.acessorios.percentual ?? 0}%)` : '(valor fixo do modelo)'}</h4>
        <ul className="list-inside list-disc text-xs text-slate-700">{proposal.acessorios?.items.map((item) => <li key={item}>{item}</li>)}</ul>
        <p className="mt-1 text-right font-semibold">{money.format(proposal.totais.acessorios)}</p>
      </section>

      {proposal.componentes.length > 0 && <section>
        <h4 className="font-semibold">Componentes adicionais</h4>
        {proposal.componentes.map((item) => <div key={item.nome} className="flex justify-between text-xs"><span>{item.nome}</span><span>{money.format(item.valor)}</span></div>)}
      </section>}

      <section className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded bg-slate-50 p-2"><ImageIcon size={14} className="mb-1" />{proposal.fotoPrincipalUrl ? 'Foto principal definida' : 'Sem foto principal'}</div>
        <div className="rounded bg-slate-50 p-2">{proposal.condicoes.freteTipo} · {proposal.condicoes.prazoDias} dias {proposal.condicoes.prazoTipo.replace('_', ' ')}</div>
      </section>

      <section><h4 className="mb-1 font-semibold">Alterações</h4><OrcamentoAIDifferenceList differences={proposal.diferencas} /></section>

      {proposal.alertas.length > 0 && <section className="space-y-1">
        {proposal.alertas.map((alert) => <p key={`${alert.code}-${alert.message}`} className={`flex gap-2 rounded p-2 text-xs ${alert.severity === 'blocking' ? 'bg-red-50 text-red-800' : 'bg-amber-50 text-amber-800'}`}><AlertTriangle size={14} />{alert.message}</p>)}
      </section>}

      <div className="flex items-end justify-between border-t pt-3"><span className="font-semibold">Total da proposta</span><strong className="text-lg text-emerald-700">{money.format(proposal.totais.proposta)}</strong></div>

      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" onClick={onCorrect} className="rounded-lg border px-3 py-2 font-medium">Corrigir no chat</button>
        <button type="button" disabled={blocked || applied || applying} onClick={onApply} className="rounded-lg bg-emerald-600 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300">
          {applied ? <span className="inline-flex items-center gap-1"><Check size={16} /> Aplicado e conferido</span> : applying ? 'Aplicando…' : 'Aplicar ao orçamento'}
        </button>
      </div>
      {applied && <button type="button" onClick={onFinalize} className="w-full rounded-lg bg-slate-900 px-3 py-2 font-semibold text-white">Finalizar e gerar</button>}
    </article>
  )
}
