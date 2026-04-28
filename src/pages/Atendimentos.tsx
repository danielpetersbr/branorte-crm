import { useState } from 'react'
import { Search, MessageCircle, Phone, ChevronLeft, ChevronRight, X, MessageSquare, ExternalLink } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { formatPhone, whatsappLink, formatRelative, formatNumber } from '@/lib/utils'
import { ufFromTelefone } from '@/lib/ddd-uf'
import { ESTADOS_BR } from '@/types'
import {
  ATENDIMENTO_PAGE_SIZE,
  STATUS_REAL_VALUES,
  type StatusReal,
} from '@/types/atendimento'
import {
  useAtendimentos,
  useAtendimentoKpis,
  useAtendimentoResponsaveis,
} from '@/hooks/useAtendimentos'

const STATUS_STYLE: Record<StatusReal, { color: string; label: string }> = {
  'Vendido': { color: 'bg-green-100 text-green-800 border border-green-200', label: 'Vendido' },
  'Em-andamento': { color: 'bg-blue-100 text-blue-700 border border-blue-200', label: 'Em andamento' },
  'Aguardando-Vendedor': { color: 'bg-amber-100 text-amber-700 border border-amber-200', label: 'Aguardando' },
  'Abandonado': { color: 'bg-gray-100 text-gray-600 border border-gray-200', label: 'Abandonado' },
  'Sem-Resposta': { color: 'bg-rose-100 text-rose-700 border border-rose-200', label: 'Sem resposta' },
  'Perdido': { color: 'bg-red-100 text-red-700 border border-red-200', label: 'Perdido' },
}

const AUDITORIA_BASE = 'https://branorte-auditoria.vercel.app'

export function Atendimentos() {
  const [filters, setFilters] = useState({
    search: '',
    responsavel: '',
    status_real: '',
    uf: '',
    page: 0,
  })
  const [searchInput, setSearchInput] = useState('')

  const { data, isLoading } = useAtendimentos(filters)
  const { data: kpis } = useAtendimentoKpis()
  const { data: responsaveis } = useAtendimentoResponsaveis()

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / ATENDIMENTO_PAGE_SIZE)
  const hasFilters = filters.search || filters.responsavel || filters.status_real || filters.uf

  const clearFilters = () => {
    setFilters({ search: '', responsavel: '', status_real: '', uf: '', page: 0 })
    setSearchInput('')
  }

  return (
    <div className="p-4 lg:p-8 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <MessageSquare className="h-7 w-7 text-green-600" />
            Atendimentos
          </h1>
          <p className="text-sm text-text-muted mt-1">
            {kpis ? (
              <><span className="font-semibold text-green-600">{formatNumber(kpis.total)}</span> conversas (1 por cliente)</>
            ) : 'Carregando...'}
          </p>
        </div>
        <a
          href={`${AUDITORIA_BASE}/atendimentos`}
          target="_blank"
          rel="noopener"
          className="hidden sm:inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-green-700 transition-colors"
        >
          Versao completa <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* KPI cards */}
      {kpis && (
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {STATUS_REAL_VALUES.map(s => (
            <Card key={s} className="p-3">
              <p className="text-[11px] uppercase tracking-wide text-text-muted">{STATUS_STYLE[s].label}</p>
              <p className="text-2xl font-bold text-text-primary mt-1">{formatNumber(kpis.byStatus[s] ?? 0)}</p>
            </Card>
          ))}
        </div>
      )}

      {/* Filtros */}
      <Card className="p-4">
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Buscar por nome ou telefone..."
            leftIcon={<Search className="h-4 w-4" />}
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setFilters(f => ({ ...f, search: searchInput, page: 0 }))}
            className="lg:w-96"
          />
          <Select
            options={(responsaveis ?? []).map(r => ({ value: r, label: r }))}
            placeholder="Vendedor"
            value={filters.responsavel}
            onChange={e => setFilters(f => ({ ...f, responsavel: e.target.value, page: 0 }))}
            className="lg:w-48"
          />
          <Select
            options={STATUS_REAL_VALUES.map(s => ({ value: s, label: STATUS_STYLE[s].label }))}
            placeholder="Status"
            value={filters.status_real}
            onChange={e => setFilters(f => ({ ...f, status_real: e.target.value, page: 0 }))}
            className="lg:w-44"
          />
          <Select
            options={ESTADOS_BR.map(uf => ({ value: uf, label: uf }))}
            placeholder="UF"
            value={filters.uf}
            onChange={e => setFilters(f => ({ ...f, uf: e.target.value, page: 0 }))}
            className="lg:w-24"
          />
          {hasFilters && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </div>
      </Card>

      {isLoading ? (
        <PageLoading />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-text-muted">
              {formatNumber(total)} resultado{total !== 1 ? 's' : ''}
            </p>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={filters.page === 0}
                  onClick={() => setFilters(f => ({ ...f, page: f.page - 1 }))}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-text-secondary">
                  {filters.page + 1} / {totalPages}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={filters.page >= totalPages - 1}
                  onClick={() => setFilters(f => ({ ...f, page: f.page + 1 }))}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-secondary">
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Nome</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Telefone</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Animal · Qtd · Precisa</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3" title="Fábrica para consumo / vender / Consumo e vender">Finalidade</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3" title="Quantos animais o cliente declarou ter">Qtd animais</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3" title="Capacidade desejada">Capacidade</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3" title="Quando pretende investir">Quando</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Criativo</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Última msg</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {rows.map(r => {
                    const tel = (r.telefone || '').replace(/\D/g, '')
                    const uf = ufFromTelefone(r.telefone)
                    const status = (r.status_real ?? '') as StatusReal
                    const statusStyle = STATUS_STYLE[status]
                    const animal = r.qual_animal && r.qual_animal !== 'não informado' ? r.qual_animal : null
                    const qtd = r.quantidade && r.quantidade !== '0' ? r.quantidade : null
                    const precisa = r.o_que_precisa
                    const animalLine = [animal, qtd, precisa].filter(Boolean).join(' · ') || '-'
                    const criativoNome = r.criativo_facebook?.nome_oficial || r.criativo_facebook?.headline
                    return (
                      <tr key={r.id} className="hover:bg-green-50/30 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-text-primary">
                            {r.nome || '(sem nome)'}
                          </span>
                          {uf && uf !== '—' && uf !== 'INTL' && (
                            <Badge className="bg-blue-50 text-blue-700 ml-2">{uf}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary font-mono">
                            {tel ? formatPhone(tel) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm text-text-secondary">{r.responsavel ?? '-'}</span>
                        </td>
                        <td className="px-4 py-3">
                          {statusStyle ? (
                            <Badge className={statusStyle.color}>{statusStyle.label}</Badge>
                          ) : (
                            <span className="text-xs text-text-muted">{r.status_real ?? '-'}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className="text-xs text-text-secondary truncate max-w-[260px] block"
                            title={animalLine}
                          >
                            {animalLine}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {r.finalidade_fabrica ? (
                            <span className="text-xs text-text-secondary truncate max-w-[160px] block" title={r.finalidade_fabrica}>
                              {r.finalidade_fabrica}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.quantos_animais ? (
                            <span className="text-xs text-text-secondary truncate max-w-[120px] block" title={r.quantos_animais}>
                              {r.quantos_animais}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.capacidade_producao ? (
                            <span className="text-xs text-text-secondary truncate max-w-[140px] block" title={r.capacidade_producao}>
                              {r.capacidade_producao}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {r.quando_investir ? (
                            <span className="text-xs text-text-secondary truncate max-w-[140px] block" title={r.quando_investir}>
                              {r.quando_investir}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {criativoNome ? (
                            <span
                              className="text-xs text-text-muted truncate max-w-[180px] block"
                              title={`${r.criativo_codigo ?? ''} · ${criativoNome}`}
                            >
                              {criativoNome}
                            </span>
                          ) : (
                            <span className="text-xs text-text-muted">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs text-text-muted">
                            {r.ultima_msg ? formatRelative(r.ultima_msg) : '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            {tel && (
                              <>
                                <a
                                  href={whatsappLink(tel)}
                                  target="_blank"
                                  rel="noopener"
                                  title="WhatsApp"
                                  className="p-1.5 rounded-lg hover:bg-green-50 text-green-600 transition-colors"
                                >
                                  <MessageCircle className="h-4 w-4" />
                                </a>
                                <a
                                  href={`tel:+${tel}`}
                                  title="Ligar"
                                  className="p-1.5 rounded-lg hover:bg-blue-50 text-blue-600 transition-colors"
                                >
                                  <Phone className="h-4 w-4" />
                                </a>
                              </>
                            )}
                            <a
                              href={`${AUDITORIA_BASE}/atendimentos/${r.id}`}
                              target="_blank"
                              rel="noopener"
                              title="Abrir no Auditoria"
                              className="p-1.5 rounded-lg hover:bg-amber-50 text-amber-600 transition-colors"
                            >
                              <ExternalLink className="h-4 w-4" />
                            </a>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={12} className="px-4 py-8 text-center text-text-muted">
                        Nenhum atendimento encontrado.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
