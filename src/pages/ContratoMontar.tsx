// MONTAR CONTRATO — pega um orçamento salvo e gera o contrato de compra e venda
// com reserva de domínio já preenchido.
//
// O orçamento entrega cliente, itens, total, parcelas com datas, prazo, frete e
// montagem. O que ele não tem é o bloco jurídico (representante legal,
// garantidor, cônjuge) — esse bloco aparece DESTACADO em amarelo, porque é o
// que o vendedor preenche em todo contrato. Uma vez preenchido, fica guardado
// no cliente (orcamento_clientes.dados_contrato) e volta pronto na próxima venda.

import { useState, useMemo, useEffect } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  FileSignature, Search, AlertTriangle, FileText, Download, Save,
  ChevronLeft, User, Loader2, CheckCircle2,
} from 'lucide-react'
import { useOrcamentosGerados, useOrcamentoGerado } from '@/hooks/useOrcamentoBuilder'
import { supabase } from '@/lib/supabase'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  contratoDoOrcamento, camposPendentes,
  type ContratoDados, type ContratoPessoa, type ContratoGarantidor, type TipoPessoa,
} from '@/lib/contrato/contrato-dados'
import { gerarContratoDocx, nomeArquivoContrato } from '@/lib/contrato/contrato-docx'
import { docxParaPdfServer } from '@/lib/docx-to-pdf-server'
import { formatBRL } from '@/lib/contrato/extenso'

// ── UI base ──────────────────────────────────────────────────────────────────

function Campo({ label, value, onChange, placeholder, destaque, largura = 'w-full', tipo = 'text' }: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  destaque?: boolean
  largura?: string
  tipo?: string
}) {
  const vazio = !value?.trim()
  return (
    <label className={`block ${largura}`}>
      <span className="block text-[11px] font-semibold text-ink-muted mb-1">{label}</span>
      <input
        type={tipo}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className={`w-full px-2.5 py-1.5 text-[13px] border rounded-md outline-none transition-colors
          ${destaque && vazio
            ? 'border-amber-400 bg-amber-50 focus:border-amber-500'
            : 'border-border bg-surface-2 focus:border-accent'}`}
      />
    </label>
  )
}

function Bloco({ titulo, subtitulo, destaque, children }: {
  titulo: string
  subtitulo?: string
  destaque?: boolean
  children: React.ReactNode
}) {
  return (
    <section className={`rounded-lg border p-4 mb-4 ${destaque ? 'border-amber-300 bg-amber-50/40' : 'border-border bg-surface'}`}>
      <header className="mb-3">
        <h2 className="text-[13px] font-bold text-ink flex items-center gap-2">
          {destaque && <span className="inline-block w-2 h-2 rounded-full bg-amber-500" />}
          {titulo}
        </h2>
        {subtitulo && <p className="text-[11px] text-ink-muted mt-0.5">{subtitulo}</p>}
      </header>
      {children}
    </section>
  )
}

// ── seleção do orçamento ─────────────────────────────────────────────────────

function SelecionarOrcamento({ onPick }: { onPick: (id: number) => void }) {
  const [busca, setBusca] = useState('')
  const { data, isLoading } = useOrcamentosGerados()

  const lista = useMemo(() => {
    const termo = busca.trim().toLowerCase()
    const base = (data ?? []).filter(o => o.versao_alt == null || termo)
    const filtrada = termo
      ? base.filter(o => `${o.numero} ${o.cliente_nome} ${o.vendedor_nome}`.toLowerCase().includes(termo))
      : base
    return filtrada.slice(0, 40)
  }, [data, busca])

  if (isLoading) return <PageLoading />

  return (
    <div>
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-faint" />
        <input
          value={busca}
          onChange={e => setBusca(e.target.value)}
          placeholder="Buscar pelo número do orçamento ou nome do cliente…"
          className="w-full pl-9 pr-3 py-2 text-sm border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
          autoFocus
        />
      </div>

      {lista.length === 0 ? (
        <div className="text-center py-12 text-ink-faint">
          <FileText className="h-10 w-10 mx-auto mb-2 opacity-40" />
          <p>Nenhum orçamento encontrado</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-[13px]">
            <thead className="bg-surface-2 border-b border-border">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Número</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Cliente</th>
                <th className="text-left px-3 py-2 font-semibold text-ink-muted">Vendedor</th>
                <th className="text-right px-3 py-2 font-semibold text-ink-muted">Total</th>
                <th className="text-center px-3 py-2 font-semibold text-ink-muted">Ação</th>
              </tr>
            </thead>
            <tbody>
              {lista.map(o => (
                <tr key={o.id} className="border-b border-border/60 hover:bg-surface-2/40">
                  <td className="px-3 py-2 font-mono font-bold text-accent">{o.numero}</td>
                  <td className="px-3 py-2">{o.cliente_nome || <span className="italic text-ink-faint">[sem nome]</span>}</td>
                  <td className="px-3 py-2 text-ink-muted">{o.vendedor_nome}</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-success">
                    {formatBRL(Number(o.total_proposta))}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <button
                      onClick={() => onPick(Number(o.id))}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold rounded-md bg-accent text-white hover:opacity-90"
                    >
                      <FileSignature className="h-3.5 w-3.5" />
                      Montar contrato
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── dados jurídicos salvos no cliente ────────────────────────────────────────

interface DadosContratoSalvos {
  representante?: ContratoPessoa
  garantidor?: ContratoGarantidor
}

function useDadosContratoCliente(clienteId: number | null) {
  return useQuery({
    queryKey: ['dados-contrato-cliente', clienteId],
    enabled: !!clienteId,
    queryFn: async (): Promise<DadosContratoSalvos | null> => {
      const { data, error } = await supabase
        .from('orcamento_clientes')
        .select('dados_contrato')
        .eq('id', clienteId!)
        .maybeSingle()
      if (error) throw error
      return (data?.dados_contrato as DadosContratoSalvos) ?? null
    },
    staleTime: 60_000,
  })
}

// ── editor do contrato ───────────────────────────────────────────────────────

const ESTADOS_CIVIS = ['solteiro(a)', 'casado(a)', 'divorciado(a)', 'viúvo(a)', 'união estável']

function EditorContrato({ orcamentoId, onVoltar }: { orcamentoId: number; onVoltar: () => void }) {
  const { data: orc, isLoading } = useOrcamentoGerado(orcamentoId)
  const clienteId = orc?.cliente_id ?? null
  const { data: salvos, isLoading: carregandoSalvos } = useDadosContratoCliente(clienteId)

  const [dados, setDados] = useState<ContratoDados | null>(null)
  const [gerando, setGerando] = useState<'docx' | 'pdf' | null>(null)
  const [salvando, setSalvando] = useState(false)
  const [msg, setMsg] = useState<{ tipo: 'ok' | 'erro'; texto: string } | null>(null)

  // Monta o contrato quando o orçamento (e os dados salvos do cliente) chegam.
  useEffect(() => {
    if (!orc) return
    if (clienteId && carregandoSalvos) return
    setDados(contratoDoOrcamento(orc, salvos ?? null))
  }, [orc, salvos, clienteId, carregandoSalvos])

  if (isLoading || !dados) return <PageLoading />

  const set = (patch: Partial<ContratoDados>) => setDados(d => (d ? { ...d, ...patch } : d))
  const setComprador = (patch: Partial<ContratoDados['comprador']>) =>
    setDados(d => {
      if (!d) return d
      const comprador = { ...d.comprador, ...patch }
      // Pessoa fisica: o CPF do comprador E o do signatario. Um campo so na tela,
      // mas o contrato usa o do representante — manter os dois em sincronia.
      if (comprador.tipoPessoa !== 'pj') {
        if (patch.cnpj !== undefined) comprador.representante = { ...comprador.representante, cpf: patch.cnpj }
        if (patch.nome !== undefined) comprador.representante = { ...comprador.representante, nome: patch.nome }
      }
      return { ...d, comprador }
    })
  const setRep = (patch: Partial<ContratoPessoa>) =>
    setDados(d => (d ? { ...d, comprador: { ...d.comprador, representante: { ...d.comprador.representante, ...patch } } } : d))
  const setGar = (patch: Partial<ContratoGarantidor>) =>
    setDados(d => (d ? { ...d, garantidor: { ...d.garantidor, ...patch } } : d))

  const pendentes = camposPendentes(dados)
  const temQuadroProprio = Array.isArray(orc?.parcelas) && orc!.parcelas!.length > 0
  const divergencia = Math.abs(dados.somaItens - dados.valorTotal) > 1
  const repCasado = /casad|estável/i.test(dados.comprador.representante.estadoCivil)
  const garCasado = /casad|estável/i.test(dados.garantidor.estadoCivil)

  async function baixar(tipo: 'docx' | 'pdf') {
    if (!dados) return
    setGerando(tipo)
    setMsg(null)
    try {
      const docx = await gerarContratoDocx(dados)
      const blob = tipo === 'pdf'
        ? await docxParaPdfServer(docx, nomeArquivoContrato(dados, 'docx'))
        : docx
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = nomeArquivoContrato(dados, tipo)
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 5000)
      setMsg({ tipo: 'ok', texto: `Contrato gerado em ${tipo.toUpperCase()}.` })
    } catch (e: any) {
      setMsg({ tipo: 'erro', texto: `Falhou ao gerar ${tipo.toUpperCase()}: ${e?.message || e}` })
    } finally {
      setGerando(null)
    }
  }

  async function salvarNoCliente() {
    if (!dados || !clienteId) {
      setMsg({ tipo: 'erro', texto: 'Este orçamento não está vinculado a um cliente da agenda — não há onde guardar.' })
      return
    }
    setSalvando(true)
    setMsg(null)
    try {
      const payload: DadosContratoSalvos = {
        representante: dados.comprador.representante,
        garantidor: dados.garantidor,
      }
      const { error } = await supabase
        .from('orcamento_clientes')
        .update({ dados_contrato: payload })
        .eq('id', clienteId)
      if (error) throw error
      setMsg({ tipo: 'ok', texto: 'Dados guardados no cliente — no próximo contrato já vêm preenchidos.' })
    } catch (e: any) {
      setMsg({ tipo: 'erro', texto: `Não consegui guardar: ${e?.message || e}` })
    } finally {
      setSalvando(false)
    }
  }

  const ehPJ = dados.comprador.tipoPessoa === 'pj'

  return (
    <div>
      {/* cabeçalho */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <button onClick={onVoltar} className="inline-flex items-center gap-1 text-[13px] text-ink-muted hover:text-ink">
          <ChevronLeft className="h-4 w-4" /> Trocar orçamento
        </button>
        <div className="text-[13px] text-ink-muted">
          Orçamento <span className="font-mono font-bold text-accent">{dados.orcamentoNumero}</span>
          {' · '}{dados.orcamentoData}
          {' · '}<span className="font-bold text-success">{formatBRL(dados.valorTotal)}</span>
          {dados.descontoValor > 0 && (
            <span className="ml-1 text-[12px] text-ink-faint">
              (bruto {formatBRL(dados.totalBruto)} − desconto {formatBRL(dados.descontoValor)})
            </span>
          )}
        </div>
      </div>

      {/* o que falta */}
      {pendentes.length > 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 mb-4">
          <div className="flex items-center gap-2 text-[13px] font-bold text-amber-800 mb-1">
            <AlertTriangle className="h-4 w-4" />
            Falta preencher ({pendentes.length})
          </div>
          <p className="text-[12px] text-amber-800/90">{pendentes.join(' · ')}</p>
          <p className="text-[11px] text-amber-700 mt-1">
            Dá pra gerar mesmo assim: o que faltar sai marcado entre colchetes no documento, pra você completar no Word.
          </p>
        </div>
      )}

      {divergencia && (
        <div className="rounded-lg border border-orange-300 bg-orange-50 p-3 mb-4 text-[12px] text-orange-800">
          <b>Confira os valores:</b> a soma das linhas ({formatBRL(dados.somaItens)}) não bate com o preço do
          contrato ({formatBRL(dados.valorTotal)}). A diferença costuma ser motor avulso sem valor ou item
          incluso. O contrato usa o <b>preço do orçamento</b> na cláusula 2.1 — confira a tabela antes de assinar.
        </div>
      )}

      {/* COMPRADOR */}
      <Bloco titulo="Comprador" subtitulo="Veio do orçamento. Corrija aqui se algum dado estiver desatualizado.">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <label className="block">
            <span className="block text-[11px] font-semibold text-ink-muted mb-1">Tipo</span>
            <select
              value={dados.comprador.tipoPessoa}
              onChange={e => setComprador({ tipoPessoa: e.target.value as TipoPessoa })}
              className="w-full px-2.5 py-1.5 text-[13px] border border-border rounded-md bg-surface-2 focus:border-accent outline-none"
            >
              <option value="pj">Empresa (pessoa jurídica)</option>
              <option value="produtor_rural">Produtor rural (pessoa física)</option>
              <option value="pf">Pessoa física</option>
            </select>
          </label>
          <Campo label={ehPJ ? 'Razão social' : 'Nome completo'} value={dados.comprador.nome}
            onChange={v => setComprador({ nome: v })} largura="md:col-span-2" />
          <Campo label={ehPJ ? 'CNPJ' : 'CPF'} value={dados.comprador.cnpj}
            onChange={v => setComprador({ cnpj: v })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <Campo label={dados.comprador.tipoPessoa === 'produtor_rural' ? 'Inscrição de produtor' : 'Inscrição estadual'}
            value={dados.comprador.ie} onChange={v => setComprador({ ie: v })} />
          <Campo label="Endereço (rua, nº, bairro)" value={dados.comprador.endereco}
            onChange={v => setComprador({ endereco: v })} largura="md:col-span-2" />
          <Campo label="CEP" value={dados.comprador.cep} onChange={v => setComprador({ cep: v })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Campo label="Cidade" value={dados.comprador.cidade} onChange={v => setComprador({ cidade: v })} />
          <Campo label="UF" value={dados.comprador.uf} onChange={v => setComprador({ uf: v })} />
          <Campo label="Telefone" value={dados.comprador.telefone} onChange={v => setComprador({ telefone: v })} />
          <Campo label="E-mail" value={dados.comprador.email} onChange={v => setComprador({ email: v })} />
        </div>
        {dados.comprador.tipoPessoa === 'produtor_rural' && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3">
            <Campo label="Nome da propriedade (opcional)" value={dados.comprador.propriedadeNome}
              onChange={v => setComprador({ propriedadeNome: v })} />
            <Campo label="Endereço da propriedade (se diferente)" value={dados.comprador.propriedadeEndereco}
              onChange={v => setComprador({ propriedadeEndereco: v })} />
          </div>
        )}
      </Bloco>

      {/* REPRESENTANTE — destacado */}
      <Bloco
        destaque
        titulo={ehPJ ? 'Representante legal (quem assina pela empresa)' : 'Dados pessoais do comprador'}
        subtitulo={ehPJ
          ? 'O orçamento não tem esses dados. São obrigatórios pra protesto e execução — e ficam guardados no cliente.'
          : 'Completam o CPF que já está acima. São obrigatórios pra protesto e execução — e ficam guardados no cliente.'}
      >
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          {ehPJ && (
            <Campo destaque label="Nome completo" value={dados.comprador.representante.nome}
              onChange={v => setRep({ nome: v })} largura="md:col-span-2" />
          )}
          {ehPJ && (
            <Campo destaque label="CPF" value={dados.comprador.representante.cpf} onChange={v => setRep({ cpf: v })} />
          )}
          <Campo destaque label="RG / órgão emissor" value={dados.comprador.representante.rg} onChange={v => setRep({ rg: v })} />
          {!ehPJ && (
            <Campo destaque label="Data de nascimento" value={dados.comprador.representante.nascimento}
              onChange={v => setRep({ nascimento: v })} placeholder="DD/MM/AAAA" />
          )}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          {ehPJ && (
            <Campo destaque label="Data de nascimento" value={dados.comprador.representante.nascimento}
              onChange={v => setRep({ nascimento: v })} placeholder="DD/MM/AAAA" />
          )}
          <Campo destaque label="Nome da mãe" value={dados.comprador.representante.mae}
            onChange={v => setRep({ mae: v })} largura="md:col-span-2" />
          <label className="block">
            <span className="block text-[11px] font-semibold text-ink-muted mb-1">Estado civil</span>
            <select
              value={dados.comprador.representante.estadoCivil}
              onChange={e => setRep({ estadoCivil: e.target.value })}
              className={`w-full px-2.5 py-1.5 text-[13px] border rounded-md outline-none
                ${dados.comprador.representante.estadoCivil ? 'border-border bg-surface-2' : 'border-amber-400 bg-amber-50'}`}
            >
              <option value="">—</option>
              {ESTADOS_CIVIS.map(e => <option key={e} value={e}>{e}</option>)}
            </select>
          </label>
          <Campo destaque label="Profissão" value={dados.comprador.representante.profissao}
            onChange={v => setRep({ profissao: v })} />
        </div>
        {!ehPJ && repCasado && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-amber-200">
            <Campo destaque label="Nome do cônjuge (assina junto)" value={dados.comprador.representante.conjugeNome}
              onChange={v => setRep({ conjugeNome: v })} />
            <Campo destaque label="CPF do cônjuge" value={dados.comprador.representante.conjugeCpf}
              onChange={v => setRep({ conjugeCpf: v })} />
          </div>
        )}
      </Bloco>

      {/* GARANTIDOR — destacado */}
      <Bloco
        destaque={dados.garantidor.incluir}
        titulo="Garantidor (devedor solidário)"
        subtitulo="Em venda parcelada o garantidor é o que dá força ao contrato: responde com o patrimônio pessoal e avaliza as promissórias."
      >
        <label className="inline-flex items-center gap-2 text-[13px] mb-3 cursor-pointer">
          <input
            type="checkbox"
            checked={dados.garantidor.incluir}
            onChange={e => setGar({ incluir: e.target.checked })}
            className="h-4 w-4 accent-amber-500"
          />
          Incluir garantidor neste contrato
          <span className="text-ink-faint text-[11px]">
            (desmarque só em venda à vista, com pagamento antes da entrega)
          </span>
        </label>

        {dados.garantidor.incluir && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <Campo destaque label="Nome completo" value={dados.garantidor.nome}
                onChange={v => setGar({ nome: v })} largura="md:col-span-2" />
              <Campo destaque label="CPF" value={dados.garantidor.cpf} onChange={v => setGar({ cpf: v })} />
              <Campo destaque label="RG / órgão emissor" value={dados.garantidor.rg} onChange={v => setGar({ rg: v })} />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
              <Campo destaque label="Data de nascimento" value={dados.garantidor.nascimento}
                onChange={v => setGar({ nascimento: v })} placeholder="DD/MM/AAAA" />
              <Campo destaque label="Nome da mãe" value={dados.garantidor.mae}
                onChange={v => setGar({ mae: v })} largura="md:col-span-2" />
              <label className="block">
                <span className="block text-[11px] font-semibold text-ink-muted mb-1">Estado civil</span>
                <select
                  value={dados.garantidor.estadoCivil}
                  onChange={e => setGar({ estadoCivil: e.target.value })}
                  className={`w-full px-2.5 py-1.5 text-[13px] border rounded-md outline-none
                    ${dados.garantidor.estadoCivil ? 'border-border bg-surface-2' : 'border-amber-400 bg-amber-50'}`}
                >
                  <option value="">—</option>
                  {ESTADOS_CIVIS.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </label>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <Campo destaque label="Profissão" value={dados.garantidor.profissao} onChange={v => setGar({ profissao: v })} />
              <Campo destaque label="Endereço completo" value={dados.garantidor.endereco}
                onChange={v => setGar({ endereco: v })} largura="md:col-span-2" />
              <Campo label="Cidade/UF" value={dados.garantidor.cidadeUf} onChange={v => setGar({ cidadeUf: v })} />
            </div>
            {garCasado && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-3 pt-3 border-t border-amber-200">
                <Campo destaque label="Nome do cônjuge (assina junto)" value={dados.garantidor.conjugeNome}
                  onChange={v => setGar({ conjugeNome: v })} />
                <Campo destaque label="CPF do cônjuge" value={dados.garantidor.conjugeCpf}
                  onChange={v => setGar({ conjugeCpf: v })} />
              </div>
            )}
            <p className="text-[11px] text-amber-700 mt-2">
              Garantidor casado sem a assinatura do cônjuge: a garantia pode ser anulada quanto à meação (art. 1.647, III, CC).
            </p>
          </>
        )}
      </Bloco>

      {/* CONDIÇÕES */}
      <Bloco titulo="Condições do contrato" subtitulo="Prazo, frete e montagem vieram do orçamento. Local de instalação, comarca e data são do contrato.">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3">
          <Campo destaque label="Local de instalação" value={dados.localInstalacao}
            onChange={v => set({ localInstalacao: v })}
            placeholder="ou: no endereço indicado no preâmbulo" largura="md:col-span-2" />
          <Campo destaque label="Comarca do cartório (RTD)" value={dados.comarca}
            onChange={v => set({ comarca: v })} placeholder="Cidade/UF do cliente" />
          <Campo label="Data do contrato" value={dados.dataContrato} tipo="date"
            onChange={v => set({ dataContrato: v })} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
          <Campo label="Prazo de entrega (dias)" value={dados.prazoEntrega} onChange={v => set({ prazoEntrega: v })} />
          <label className="block">
            <span className="block text-[11px] font-semibold text-ink-muted mb-1">Dias</span>
            <select value={dados.prazoTipo} onChange={e => set({ prazoTipo: e.target.value as any })}
              className="w-full px-2.5 py-1.5 text-[13px] border border-border rounded-md bg-surface-2 focus:border-accent outline-none">
              <option value="corridos">corridos</option>
              <option value="úteis">úteis</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-ink-muted mb-1">Frete</span>
            <select value={dados.freteFob ? 'FOB' : 'CIF'} onChange={e => set({ freteFob: e.target.value === 'FOB' })}
              className="w-full px-2.5 py-1.5 text-[13px] border border-border rounded-md bg-surface-2 focus:border-accent outline-none">
              <option value="FOB">FOB — por conta do cliente</option>
              <option value="CIF">CIF — por conta da Branorte</option>
            </select>
          </label>
          <label className="block">
            <span className="block text-[11px] font-semibold text-ink-muted mb-1">Multa por atraso</span>
            <select value={String(dados.multaPct)} onChange={e => set({ multaPct: Number(e.target.value) })}
              className="w-full px-2.5 py-1.5 text-[13px] border border-border rounded-md bg-surface-2 focus:border-accent outline-none">
              <option value="10">10% (padrão da casa)</option>
              <option value="2">2% (padrão do contrato JELMAX)</option>
            </select>
          </label>
        </div>
        <div className="flex flex-wrap gap-4 mt-3">
          <label className="inline-flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={dados.montagemInclusa}
              onChange={e => set({ montagemInclusa: e.target.checked })} className="h-4 w-4 accent-accent" />
            Montagem inclusa no preço
          </label>
          <label className="inline-flex items-center gap-2 text-[13px] cursor-pointer">
            <input type="checkbox" checked={dados.usoImagem}
              onChange={e => set({ usoImagem: e.target.checked })} className="h-4 w-4 accent-accent" />
            Autoriza uso de imagem da instalação (cláusula 14.3)
          </label>
        </div>
      </Bloco>

      {/* ITENS */}
      <Bloco titulo={`Equipamentos (${dados.itens.length})`} subtitulo="Vieram do orçamento. Dá pra ajustar a descrição que vai no contrato.">
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-[12px]">
            <thead className="bg-surface-2 border-b border-border">
              <tr>
                <th className="text-left px-2 py-1.5 font-semibold text-ink-muted w-10">Item</th>
                <th className="text-left px-2 py-1.5 font-semibold text-ink-muted">Descrição</th>
                <th className="text-center px-2 py-1.5 font-semibold text-ink-muted w-14">Qtd</th>
                <th className="text-right px-2 py-1.5 font-semibold text-ink-muted w-32">Valor</th>
              </tr>
            </thead>
            <tbody>
              {dados.itens.map((it, idx) => (
                <tr key={idx} className="border-b border-border/60">
                  <td className="px-2 py-1 font-mono text-ink-muted">{it.letra}</td>
                  <td className="px-2 py-1">
                    <input
                      value={it.descricao}
                      onChange={e => {
                        const novos = [...dados.itens]
                        novos[idx] = { ...it, descricao: e.target.value }
                        set({ itens: novos })
                      }}
                      className="w-full px-1.5 py-1 text-[12px] border border-transparent hover:border-border focus:border-accent rounded bg-transparent outline-none"
                    />
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums">{it.qtd}</td>
                  <td className="px-2 py-1 text-right tabular-nums font-medium">
                    {it.rotulo ?? formatBRL(it.valorLinha)}
                  </td>
                </tr>
              ))}
              <tr className="bg-surface-2 font-bold">
                <td colSpan={3} className="px-2 py-1.5 text-right">VALOR TOTAL DO CONTRATO</td>
                <td className="px-2 py-1.5 text-right tabular-nums text-success">{formatBRL(dados.valorTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Bloco>

      {/* PAGAMENTO */}
      <Bloco
        titulo="Pagamento"
        subtitulo={dados.parcelas.length > 0 && !temQuadroProprio
          ? 'Lido da condição escrita no orçamento. Confira os vencimentos antes de gerar.'
          : 'Entrada e parcelas calculadas a partir do orçamento. Confira os vencimentos.'}
      >
        {dados.entrada && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 mb-3 pb-3 border-b border-border">
            <Campo label="Entrada — vencimento" value={dados.entrada.vencimento}
              onChange={v => set({ entrada: { ...dados.entrada!, vencimento: v } })} placeholder="DD/MM/AAAA" />
            <Campo label="Entrada — valor (R$)" value={String(dados.entrada.valor)}
              onChange={v => set({ entrada: { ...dados.entrada!, valor: Number(v.replace(',', '.')) || 0 } })} />
          </div>
        )}
        {dados.parcelas.length === 0 ? (
          dados.formaPagamentoTexto ? (
            <div className="rounded-md border border-border bg-surface-2 p-3">
              <p className="text-[11px] font-semibold text-ink-muted mb-1">
                Condição escrita no orçamento — vai no contrato exatamente assim (cláusula 2.2):
              </p>
              <textarea
                value={dados.formaPagamentoTexto}
                onChange={e => set({ formaPagamentoTexto: e.target.value })}
                rows={4}
                className="w-full px-2 py-1.5 text-[12px] border border-border rounded bg-surface focus:border-accent outline-none resize-y"
              />
              <p className="text-[11px] text-ink-faint mt-1.5">
                Não deu pra montar o quadro de parcelas a partir desse texto (as datas e valores não fecharam
                com o preço), então o contrato leva a condição por extenso. A reserva de domínio continua valendo.
              </p>
            </div>
          ) : (
            <p className="text-[12px] text-ink-muted">
              Sem condição de pagamento no orçamento — o contrato sai como pagamento integral antecipado
              (item 3.7 desliga a reserva de domínio). Se a venda for parcelada, preencha a condição no orçamento.
            </p>
          )
        ) : (
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-[12px]">
              <thead className="bg-surface-2 border-b border-border">
                <tr>
                  <th className="text-center px-2 py-1.5 font-semibold text-ink-muted w-20">Parcela</th>
                  <th className="text-center px-2 py-1.5 font-semibold text-ink-muted w-40">Vencimento</th>
                  <th className="text-right px-2 py-1.5 font-semibold text-ink-muted w-40">Valor (R$)</th>
                  <th className="text-left px-2 py-1.5 font-semibold text-ink-muted">Forma</th>
                </tr>
              </thead>
              <tbody>
                {dados.parcelas.map((pc, idx) => (
                  <tr key={idx} className="border-b border-border/60">
                    <td className="px-2 py-1 text-center font-mono">{pc.numero}</td>
                    <td className="px-2 py-1">
                      <input value={pc.vencimento} placeholder="DD/MM/AAAA"
                        onChange={e => {
                          const novas = [...dados.parcelas]
                          novas[idx] = { ...pc, vencimento: e.target.value }
                          set({ parcelas: novas })
                        }}
                        className="w-full px-1.5 py-1 text-[12px] text-center border border-transparent hover:border-border focus:border-accent rounded bg-transparent outline-none" />
                    </td>
                    <td className="px-2 py-1">
                      <input value={String(pc.valor)}
                        onChange={e => {
                          const novas = [...dados.parcelas]
                          novas[idx] = { ...pc, valor: Number(e.target.value.replace(',', '.')) || 0 }
                          set({ parcelas: novas })
                        }}
                        className="w-full px-1.5 py-1 text-[12px] text-right tabular-nums border border-transparent hover:border-border focus:border-accent rounded bg-transparent outline-none" />
                    </td>
                    <td className="px-2 py-1 text-ink-muted">{pc.metodo}</td>
                  </tr>
                ))}
                <tr className="bg-surface-2 font-bold">
                  <td colSpan={2} className="px-2 py-1.5 text-right">SOMA</td>
                  <td className="px-2 py-1.5 text-right tabular-nums">
                    {formatBRL(dados.parcelas.reduce((s, x) => s + x.valor, 0) + (dados.entrada?.valor ?? 0))}
                  </td>
                  <td />
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Bloco>

      {/* AÇÕES */}
      <div className="sticky bottom-0 bg-surface border-t border-border py-3 flex flex-wrap items-center gap-3">
        <button
          onClick={() => baixar('docx')}
          disabled={!!gerando}
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-bold rounded-md bg-accent text-white hover:opacity-90 disabled:opacity-50"
        >
          {gerando === 'docx' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSignature className="h-4 w-4" />}
          Gerar contrato (Word)
        </button>
        <button
          onClick={() => baixar('pdf')}
          disabled={!!gerando}
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-bold rounded-md border border-border bg-surface-2 hover:bg-surface-2/70 disabled:opacity-50"
        >
          {gerando === 'pdf' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
          Gerar em PDF
        </button>
        <button
          onClick={salvarNoCliente}
          disabled={salvando || !clienteId}
          title={clienteId ? 'Guarda representante e garantidor no cliente' : 'Orçamento sem cliente vinculado na agenda'}
          className="inline-flex items-center gap-2 px-4 py-2 text-[13px] font-semibold rounded-md border border-border hover:bg-surface-2 disabled:opacity-50"
        >
          {salvando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Guardar dados no cliente
        </button>

        {msg && (
          <span className={`inline-flex items-center gap-1.5 text-[12px] font-semibold
            ${msg.tipo === 'ok' ? 'text-success' : 'text-danger'}`}>
            {msg.tipo === 'ok' ? <CheckCircle2 className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {msg.texto}
          </span>
        )}
      </div>
    </div>
  )
}

// ── página ───────────────────────────────────────────────────────────────────

export function ContratoMontar() {
  const [searchParams, setSearchParams] = useSearchParams()
  const orcParam = searchParams.get('orcamento')
  const orcamentoId = orcParam ? Number(orcParam) : null

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto">
      <header className="mb-5">
        <h1 className="text-xl font-bold flex items-center gap-2">
          <FileSignature className="h-5 w-5 text-accent" />
          Montar Contrato
        </h1>
        <p className="text-[13px] text-ink-muted mt-1">
          Contrato de compra e venda com reserva de domínio, montado a partir de um orçamento salvo.
          {' '}
          <Link to="/orcamentos/salvos" className="text-accent hover:underline inline-flex items-center gap-1">
            <User className="h-3 w-3" /> ver orçamentos
          </Link>
        </p>
      </header>

      {orcamentoId ? (
        <EditorContrato
          orcamentoId={orcamentoId}
          onVoltar={() => setSearchParams({})}
        />
      ) : (
        <SelecionarOrcamento onPick={id => setSearchParams({ orcamento: String(id) })} />
      )}
    </div>
  )
}

export default ContratoMontar
