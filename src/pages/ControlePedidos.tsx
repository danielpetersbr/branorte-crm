import { useMemo, useState } from 'react'
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  Search, ChevronLeft, ChevronRight, X, FileText, FileDown, Download,
  Pencil, Trash2, ExternalLink, AlertTriangle, Calendar, Factory, Cog, RotateCw,
  Eye, EyeOff, ShieldAlert,
} from 'lucide-react'
import { toast } from 'sonner'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { supabase } from '@/lib/supabase'
import { supabase as controleSupabase } from '@/lib/controle-supabase/client'
import { useAuth } from '@/hooks/useAuth'
import { useVendedorNome } from '@/hooks/useVendedorNome'
import {
  resolverEscopo, escopoPodeConsultar, filtroDoVendedor, descreveEscopo,
  nomeParaEscopo, type EscopoPedidos,
} from '@/lib/escopo-pedidos'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { LoadingSpinner } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'

// ============================================================================
// Pedidos de Venda — lista + ações.
//
// DUAS FONTES, DE PROPÓSITO:
//
//   LER   → `mirror_pedidos_venda` (banco do CRM, flwbeevt...). É ESPELHO e é
//           read-only: só tem policy de SELECT (`mirror_pv_sel`), nenhuma de
//           UPDATE/DELETE. Escrever aqui não dá erro — some silenciosamente.
//           É rápido e já está indexado pro filtro/paginação, então continua
//           sendo quem alimenta a tabela.
//
//   MEXER → `pedidos_venda` (banco do CONTROLE, kfucuvwrnwrkshxpsmyq), via
//           `@/lib/controle-supabase/client`. É a tabela VIVA: status e envio
//           pra fábrica gravam lá, junto com o controle.branorte.com que segue
//           no ar. A EXCLUSÃO passa por `/api/controle-deletar-pedido` (ver
//           mais abaixo o porquê de não ser direto).
//
// A consequência prática é que o espelho fica ATRÁS por alguns minutos depois de
// cada ação. Por isso existe `patches` mais abaixo: o que a tela já fez fica
// aplicado por cima do que o espelho devolve, até o sync alcançar.
// ============================================================================

const PAGE_SIZE = 50

// Teto do "Exportar PDF". O PostgREST corta página grande em silêncio
// (ver reference_supabase_postgrest_10k_linhas), então buscamos em blocos de
// 1000 e paramos aqui em vez de confiar num range gigante.
const PDF_BLOCO = 1000
const PDF_MAX = 5000

const COLS_ESPELHO =
  'id, pedido_numero, numero_orcamento, cliente, vendedor, vendedor_2, valor_total, ajuste_valor, payment_plan_json, status, status_pagamento, data_venda, cidade, estado'

const URL_PRODUCAO = 'https://controledeproducao.mbranorte.com.br'

type PedidoStatus = 'ABERTO' | 'FECHADO' | 'CANCELADO'
const STATUS_VALIDOS: PedidoStatus[] = ['ABERTO', 'FECHADO', 'CANCELADO']

interface PedidoRow {
  id: string
  pedido_numero: string | null
  numero_orcamento: string | null
  cliente: string | null
  vendedor: string | null
  vendedor_2: string | null
  valor_total: number | null
  ajuste_valor: number | null
  payment_plan_json: { total?: number | string } | null
  status: string | null
  status_pagamento: string | null
  data_venda: string | null
  cidade: string | null
  estado: string | null
}

interface Filtros { search: string; status: string; de: string; ate: string; page: number }

// O que esta sessão já mudou na tabela viva e o espelho ainda não sabe.
interface PatchLocal { removido?: boolean; status?: PedidoStatus }

function valorPedido(p: PedidoRow): number {
  const raw = p.payment_plan_json?.total
  const pt = raw != null ? Number(raw) : 0
  const base = pt > 0 ? pt : Number(p.valor_total) || 0
  return base + (Number(p.ajuste_valor) || 0)
}

function brl(v: number, semCentavos = true): string {
  return v.toLocaleString('pt-BR', {
    style: 'currency', currency: 'BRL',
    maximumFractionDigits: semCentavos ? 0 : 2,
    minimumFractionDigits: semCentavos ? 0 : 2,
  })
}

function dataBR(iso: string | null, curto = true): string {
  if (!iso) return '-'
  const [ano, mes, dia] = iso.slice(0, 10).split('-')
  if (!ano || !mes || !dia) return iso
  return `${dia}/${mes}/${curto ? ano.slice(2) : ano}`
}

// YYYY-MM-DD no fuso LOCAL. `toISOString()` aqui erraria o dia: às 21h de
// Brasília ele já devolve a data de amanhã em UTC, e o atalho "Mês Atual"
// entregaria um intervalo deslocado.
function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function mesRelativo(delta: number): { de: string; ate: string } {
  const h = new Date()
  return {
    de: ymd(new Date(h.getFullYear(), h.getMonth() + delta, 1)),
    ate: ymd(new Date(h.getFullYear(), h.getMonth() + delta + 1, 0)),
  }
}

function descrevePeriodo(de: string, ate: string): string | null {
  if (de && ate) return `${dataBR(de, false)} a ${dataBR(ate, false)}`
  if (de) return `a partir de ${dataBR(de, false)}`
  if (ate) return `até ${dataBR(ate, false)}`
  return null
}

// Tokens semânticos (têm valor no tema claro E no escuro em index.css).
// A versão anterior cravava bg-green-50/text-green-700 sem par `dark:` — no tema
// escuro o chip virava um retângulo claro com texto quase invisível.
// ⚠️ FECHADO tem um `dark:` a mais e não é enfeite. Medido no escuro:
// `text-success` sobre `bg-success-bg` dá 4,34:1 — reprova o AA (4,5) a 11px/600.
// ABERTO (4,72) e CANCELADO (4,87) passam porque `--info` e `--danger` foram
// CLAREADOS pro tema escuro (55% e 63%); `--success` ficou em 40% (ver index.css).
// Mexer no token global consertaria aqui e mudaria o app inteiro, então o ajuste
// é só deste chip: com a tinta a 60% o fundo escurece e a razão sobe pra 4,91,
// sem perder o verde que diferencia o status. Medido na tela, não estimado.
const STATUS_TOM: Record<string, string> = {
  FECHADO: 'bg-success-bg dark:bg-success-bg/60 text-success border-success/30',
  ABERTO: 'bg-info-bg text-info border-info/30',
  CANCELADO: 'bg-danger-bg text-danger border-danger/30',
}

// ─── Leitura: espelho ───────────────────────────────────────────────────────
//
// ⚠️ O `escopo` entra na queryKey E no `enabled`. Na queryKey porque o recorte
// muda o resultado — sem ele, o cache de um gestor seria servido pro vendedor.
// No `enabled` porque enquanto o escopo não resolveu a consulta NÃO PODE correr:
// rodar "só até o nome chegar" já mostraria os 508 pedidos na tela.
function usePedidos(filtros: Filtros, escopo: EscopoPedidos) {
  return useQuery({
    queryKey: ['controle-pedidos', filtros, escopo],
    enabled: escopoPodeConsultar(escopo),
    queryFn: async () => {
      let query = supabase
        .from('mirror_pedidos_venda')
        .select(COLS_ESPELHO, { count: 'exact' })
        .order('data_venda', { ascending: false, nullsFirst: false })

      // Recorte por vendedor ANTES de tudo. Como o `count` sai da mesma
      // consulta, o total e a paginação já nascem recortados.
      if (escopo.tipo === 'vendedor') query = query.or(filtroDoVendedor(escopo.nome))

      if (filtros.search) {
        query = query.or(`cliente.ilike.%${filtros.search}%,pedido_numero.ilike.%${filtros.search}%,numero_orcamento.ilike.%${filtros.search}%,vendedor.ilike.%${filtros.search}%`)
      }
      if (filtros.status) query = query.eq('status', filtros.status)
      // Filtra por `data_venda`, que é a coluna que a tabela mostra e ordena.
      // (O Controle de Vendas também joga `ajuste_data` na conta; aqui isso
      // faria a linha aparecer num mês em que a Data mostrada está fora dele.)
      if (filtros.de) query = query.gte('data_venda', filtros.de)
      if (filtros.ate) query = query.lte('data_venda', filtros.ate)

      const from = filtros.page * PAGE_SIZE
      query = query.range(from, from + PAGE_SIZE - 1)

      const { data, error, count } = await query
      if (error) throw error
      return { pedidos: (data ?? []) as PedidoRow[], total: count ?? 0 }
    },
    placeholderData: (prev) => prev,
    // ⚠️ SEM ISTO A CONSULTA MORRE CALADA.
    // No modo padrão ('online'), um fetch que rejeita com "Failed to fetch" faz
    // o React Query concluir que o BROWSER está offline: ele PAUSA a consulta
    // (`fetchStatus: 'paused'`), mantém `status: 'success'` com o placeholder e
    // nunca mais tenta. Medido na tela: 1 tentativa e pausa estável em 12s, com
    // o paginador anunciando "2 / 11" sobre as linhas da página 1.
    // Aqui o "offline" do browser é um péssimo palpite: o que pode estar fora é
    // o Supabase, a VPN ou o antivírus da máquina (o Kaspersky bloqueando edge
    // function já é caso conhecido nesta operação). 'always' manda tentar do
    // mesmo jeito e ERRAR de verdade — que é o que a tela sabe mostrar.
    networkMode: 'always',
  })
}

// ─── Leitura: tabela VIVA, só pra saber quem tem DOCX ───────────────────────
// O espelho não guarda `arquivo_url` em coluna própria, e é ele que decide se o
// botão "Baixar DOCX" aparece. São 2 colunas pros <=50 ids da página — barato,
// e vem da fonte certa em vez de adivinhar pelo `raw`.
function useArquivosDocx(ids: string[]) {
  return useQuery({
    queryKey: ['controle-pedidos-arquivo', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await controleSupabase
        .from('pedidos_venda')
        .select('id, arquivo_url')
        .in('id', ids)
      if (error) throw error
      const mapa: Record<string, string> = {}
      for (const r of data ?? []) if (r.arquivo_url) mapa[r.id] = r.arquivo_url
      return mapa
    },
  })
}

// ─── Leitura: quem já chegou na fábrica ─────────────────────────────────────
// Pinta o botão Factory de verde (já foi) ou âmbar (nunca foi). Só os ids da
// página — a tela do controle carrega `producao_pedidos` inteira pra isto.
function useNaProducao(ids: string[]) {
  return useQuery({
    queryKey: ['controle-pedidos-producao', ids.join(',')],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await controleSupabase
        .from('producao_pedidos')
        .select('pedido_id')
        .in('pedido_id', ids)
      if (error) throw error
      return new Set((data ?? []).map(r => r.pedido_id).filter((v): v is string => !!v))
    },
  })
}

// ─── Envio pra fábrica (App2) ───────────────────────────────────────────────
// Porte fiel do `importarParaProducao` da tela do controle: cria/reposiciona o
// card em `producao_pedidos` e chama a edge `enviar-docx-app2` (que responde
// CORS `*`, então roda direto do CRM).
//
// POR QUE A LISTA PRECISA DISSO: no CRM o envio só acontece ao SALVAR o pedido,
// e a própria tela do controle assume que ele falha — o toast dela diz "o cron
// job tentará novamente". Sem um botão de reenvio aqui, um pedido que não chegou
// na fábrica não tem por onde ser reenviado.

interface EquipamentoApp2 { numero: number; descricao: string; quantidade: number; unidade: string }
interface MotorApp2 { quantidade: number; modelo: string }

// "A - 06 – SUPORTE PARA BIG BAG" → { quantidade: 6, descricao: "SUPORTE..." }
function extrairQuantidade(texto: string): { quantidade: number; descricao: string } {
  const m = texto.match(/^[A-Z]\s*[-–]\s*(\d+)\s*[-–]\s*(.+)$/i)
  if (m) return { quantidade: parseInt(m[1], 10) || 1, descricao: m[2].trim() }
  return { quantidade: 1, descricao: texto }
}

function comoLista(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

function campo(o: unknown, chave: string): unknown {
  return o && typeof o === 'object' ? (o as Record<string, unknown>)[chave] : undefined
}

// ⚠️ O supabase-js NÃO rejeita com `Error`: ele resolve com um objeto
// `{ message, details, hint, code }`. Um `e instanceof Error ? e.message : ...`
// cai no fallback e o usuário lê "erro desconhecido" — ou, pior, "[object
// Object]" — bem quando precisava saber o que houve.
function mensagemDeErro(x: unknown): string {
  if (!x) return 'erro desconhecido'
  if (x instanceof Error) return x.message
  if (typeof x === 'string') return x
  const m = campo(x, 'message')
  if (typeof m === 'string' && m) return m
  try { return JSON.stringify(x).slice(0, 200) } catch { return String(x) }
}

// "TypeError: Failed to fetch" não diz nada pro vendedor. Traduz o que é comum
// nesta operação e guarda o texto cru como detalhe técnico.
function explicaFalha(x: unknown): { texto: string; tecnico: string | null } {
  const cru = mensagemDeErro(x)
  if (/failed to fetch|networkerror|load failed|fetch aborted/i.test(cru)) {
    return {
      texto: 'O navegador não conseguiu falar com o servidor. Pode ser a internet, a VPN ou o antivírus bloqueando.',
      tecnico: cru,
    }
  }
  if (/jwt|token|not authorized|permission denied|row-level security/i.test(cru)) {
    return { texto: 'Sua sessão perdeu o acesso a esses dados. Saia e entre de novo.', tecnico: cru }
  }
  if (/timeout|statement timeout|57014/i.test(cru)) {
    return { texto: 'A consulta demorou demais e o banco cortou. Tente com um filtro mais estreito.', tecnico: cru }
  }
  return { texto: cru, tecnico: null }
}

function formatarEquipamentos(bruto: unknown): EquipamentoApp2[] {
  return comoLista(bruto).map((eq, i) => {
    if (typeof eq === 'string') {
      const { quantidade, descricao } = extrairQuantidade(eq)
      return { numero: i + 1, descricao, quantidade, unidade: 'UN' }
    }
    const descBruta = campo(eq, 'descricao')
    const parsed = extrairQuantidade(typeof descBruta === 'string' ? descBruta : '')
    const qtd = Number(campo(eq, 'quantidade')) || 0
    return {
      numero: i + 1,
      descricao: qtd ? String(descBruta ?? '') : parsed.descricao,
      quantidade: qtd || parsed.quantidade,
      unidade: String(campo(eq, 'unidade') ?? 'UN'),
    }
  })
}

function formatarMotores(bruto: unknown): MotorApp2[] {
  return comoLista(bruto).map(m => {
    if (typeof m === 'string') return { quantidade: 1, modelo: m }
    return { quantidade: Number(campo(m, 'quantidade')) || 1, modelo: String(campo(m, 'modelo') ?? '') }
  })
}

const COLS_APP2 =
  'id, pedido_numero, numero_orcamento, cliente, vendedor, arquivo_url, descricao_equipamento, equipamentos_json, equipamentos_detalhados, motores_json, tensao, voltagem, dias_uteis, tipo_prazo, data_entrega, checklist_compras'

async function enviarParaFabrica(pedidoId: string): Promise<{ jaEstava: boolean; app2: boolean }> {
  const { data: pedido, error: erroPedido } = await controleSupabase
    .from('pedidos_venda').select(COLS_APP2).eq('id', pedidoId).maybeSingle()
  if (erroPedido) throw erroPedido
  if (!pedido) throw new Error('Pedido não existe mais na tabela viva')

  // 1) card na produção — primeiro estágio ativo
  const { data: existente } = await controleSupabase
    .from('producao_pedidos').select('id').eq('pedido_id', pedidoId).maybeSingle()
  const jaEstava = !!existente

  const { data: primeiroEstagio } = await controleSupabase
    .from('producao_estagios').select('id').eq('ativo', true)
    .order('ordem', { ascending: true }).limit(1).maybeSingle()

  if (primeiroEstagio) {
    if (existente) {
      await controleSupabase.from('producao_pedidos')
        .update({ estagio_id: primeiroEstagio.id, data_movimentacao: new Date().toISOString() })
        .eq('id', existente.id)
    } else {
      const { error } = await controleSupabase.from('producao_pedidos').insert({
        pedido_id: pedidoId,
        estagio_id: primeiroEstagio.id,
        data_entrada: new Date().toISOString(),
        prioridade: 0,
      })
      // Corrida com o cron de sync: se ele criou o card no meio do caminho, o
      // insert bate em unique. Não é erro pro usuário — o card existe, que é o
      // que importa.
      if (error && !/duplicate/i.test(error.message)) throw error
    }
  }

  // 2) o DOCX é opcional (a edge é "v6 ENVIA COM OU SEM DOCX"): se o arquivo não
  //    baixar, manda os dados estruturados assim mesmo em vez de abortar.
  let docxBase64: string | null = null
  let nomeArquivo: string | null = null
  const url = pedido.arquivo_url
  if (url && url.startsWith('http')) {
    try {
      const blob = await (await fetch(url)).blob()
      docxBase64 = await new Promise<string>((resolve, reject) => {
        const fr = new FileReader()
        fr.onerror = () => reject(new Error('falha lendo o arquivo'))
        fr.onloadend = () => resolve(String(fr.result).split(',')[1] ?? '')
        fr.readAsDataURL(blob)
      })
      nomeArquivo = decodeURIComponent(url.split('/').pop() || '') || `pedido_${pedido.numero_orcamento}.docx`
    } catch (e) {
      console.warn('[fabrica] não baixei o DOCX, seguindo só com os dados:', e)
    }
  }

  const equipamentosBruto = pedido.equipamentos_json ?? pedido.equipamentos_detalhados
  const primeiro = comoLista(equipamentosBruto)[0]
  const tituloEquipamento = pedido.descricao_equipamento?.trim()
    || (typeof primeiro === 'string' ? primeiro : String(campo(primeiro, 'descricao') ?? ''))

  const checklist = pedido.checklist_compras

  const { data: resp, error } = await controleSupabase.functions
    .invoke<{ ok?: boolean; error?: string }>('enviar-docx-app2', {
      body: {
        pedidoId,
        clienteNome: pedido.cliente ?? '',
        vendedorNome: pedido.vendedor ?? '',
        numeroOrcamento: pedido.numero_orcamento ?? '',
        docxBase64,
        nomeArquivo,
        tituloEquipamento,
        equipamentos: formatarEquipamentos(equipamentosBruto),
        motores: formatarMotores(pedido.motores_json),
        tensao: pedido.tensao ?? '',
        voltagem: pedido.voltagem ?? '',
        prazoDias: pedido.dias_uteis ?? 0,
        prazoTipo: pedido.tipo_prazo ?? 'uteis',
        prazoData: pedido.data_entrega ?? '',
        checkListCompras: checklist ?? null,
        motorMarca: String(campo(checklist, 'motor_marca') ?? ''),
      },
    })

  // Falhar aqui NÃO desfaz o card: ele já está na produção local e o cron do
  // controle reenvia. É exatamente o que a tela do controle faz.
  if (error || resp?.error) {
    console.warn('[fabrica] card criado, mas o App2 recusou:', error ?? resp?.error)
    return { jaEstava, app2: false }
  }
  return { jaEstava, app2: true }
}

// ─── Modal de confirmação (mesma casca do /controle/financeiro) ─────────────
function ModalExcluir({ pedido, excluindo, onConfirmar, onFechar }: {
  pedido: PedidoRow
  excluindo: boolean
  onConfirmar: () => void
  onFechar: () => void
}) {
  const [digitado, setDigitado] = useState('')
  // A tela do controle pede a senha fixa "2104", que está em texto puro no
  // bundle e serve pra QUALQUER pedido — quem erra a linha e digita a senha
  // certa apaga o pedido errado. Aqui a confirmação é o NÚMERO DESTE pedido:
  // não é segredo nenhum, mas prova que você olhou a linha certa. Quem PODE
  // apagar é decidido no servidor (`/api/controle-deletar-pedido` exige
  // role=admin), não por este modal.
  const alvo = (pedido.pedido_numero || pedido.numero_orcamento || pedido.id).trim()
  const confere = digitado.trim().toUpperCase() === alvo.toUpperCase()

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onFechar} aria-hidden />
      <div role="dialog" aria-label="Confirmar exclusão"
        className="relative w-full max-w-md rounded-lg border border-border bg-bg shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-danger">
            <AlertTriangle className="h-4 w-4" /> Excluir pedido
          </h3>
          <button onClick={onFechar} aria-label="Fechar" className="rounded p-1 text-text-muted hover:bg-surface-2">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-3 p-4">
          <p className="text-[13px] text-text-secondary">
            <strong className="font-mono text-text-primary">{alvo}</strong>
            {pedido.cliente ? <> — {pedido.cliente}</> : null}
          </p>
          <div className="rounded-md border border-danger/30 bg-danger-bg px-3 py-2 text-[12px] text-danger">
            Não dá pra desfazer. Vão junto: parcelas, recebimentos, o registro na
            produção e o arquivo DOCX.
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">
              Digite <span className="font-mono text-text-primary">{alvo}</span> para confirmar
            </label>
            <Input
              value={digitado}
              autoFocus
              placeholder={alvo}
              onChange={e => setDigitado(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && confere && !excluindo) onConfirmar() }}
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button variant="secondary" onClick={onFechar} disabled={excluindo}>Cancelar</Button>
          <Button variant="danger" onClick={onConfirmar} disabled={!confere} loading={excluindo}>
            {excluindo ? 'Excluindo...' : 'Excluir'}
          </Button>
        </div>
      </div>
    </div>
  )
}

// ─── Estado de falha da lista ───────────────────────────────────────────────
// Erro tem que vir ANTES de vazio. Sem isto, uma consulta que falha vira
// "Nenhum pedido encontrado" com 508 pedidos no banco — e o vendedor conclui
// que o filtro dele não achou nada.
function FalhaAoCarregar({ causa, tecnico, tinhaLista, tentando, onTentar }: {
  causa: string; tecnico: string | null; tinhaLista: boolean; tentando: boolean; onTentar: () => void
}) {
  return (
    <Card className="p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <AlertTriangle className="h-8 w-8 text-danger" />
        <p className="text-sm font-medium text-text-primary">Não consegui carregar os pedidos.</p>
        <p className="max-w-md text-sm text-text-secondary">{causa}</p>
        {tecnico && <p className="max-w-md font-mono text-[11px] text-text-muted">{tecnico}</p>}
        {tinhaLista && (
          // Sem esta frase o vendedor não entende por que a tabela sumiu — e
          // mostrar as linhas velhas no lugar seria pior: ele leria a página 1
          // achando que é a 2 (ou pedidos ABERTO achando que são CANCELADO).
          <p className="max-w-md text-xs text-text-muted">
            Tirei a tabela da tela de propósito: o que estava ali era o resultado
            da consulta anterior, não o que você pediu agora.
          </p>
        )}
        <Button variant="secondary" onClick={onTentar} loading={tentando}>
          <RotateCw className="h-4 w-4" /> Tentar Novamente
        </Button>
      </div>
    </Card>
  )
}

export function ControlePedidos() {
  const [filtros, setFiltros] = useState<Filtros>({ search: '', status: '', de: '', ate: '', page: 0 })
  const [buscaInput, setBuscaInput] = useState('')
  const [patches, setPatches] = useState<Record<string, PatchLocal>>({})
  const [paraExcluir, setParaExcluir] = useState<PedidoRow | null>(null)
  const [baixando, setBaixando] = useState<string | null>(null)
  const [exportando, setExportando] = useState(false)
  // Nasce DESLIGADO, como na tela do controle. Quem abre a lista numa reunião,
  // com o cliente do lado ou espelhando a tela, não tinha como esconder valor.
  const [valoresVisiveis, setValoresVisiveis] = useState(false)

  const navigate = useNavigate()
  const qc = useQueryClient()
  const { profile, session } = useAuth()
  const podeExcluir = profile?.role === 'admin'

  const { nome: nomeDoHook, isLoading: nomeCarregando } = useVendedorNome()
  // ⚠️ `nomeParaEscopo` NÃO é enfeite: sem ele, um perfil sem `vendor_id` entra
  // aqui com o `display_name` do hook e vira filtro. Medido nesta tela antes da
  // trava: `or=(vendedor.ilike.DANIEL PETERS,...)` — que só voltou vazio porque
  // ninguém em `vendors` se chama assim.
  const escopo = useMemo(
    () => resolverEscopo({
      role: profile?.role,
      nomeVendedor: nomeParaEscopo(profile?.vendor_id, nomeDoHook),
      nomeCarregando,
    }),
    [profile?.role, profile?.vendor_id, nomeDoHook, nomeCarregando],
  )
  const rotuloEscopo = descreveEscopo(escopo)

  const {
    data, isLoading, isError, error, isPlaceholderData, isFetching, fetchStatus,
    failureReason, refetch,
  } = usePedidos(filtros, escopo)

  const brutos = useMemo(() => (data?.pedidos ?? []), [data])

  // Quando a consulta ERRA, o React Query solta o placeholder e `brutos` fica
  // vazio — então na hora de explicar "sumiu a tabela" já não dá pra saber se
  // havia uma. Este flag lembra.
  const [jaMostrouLista, setJaMostrouLista] = useState(false)
  if (brutos.length > 0 && !jaMostrouLista) setJaMostrouLista(true)

  // Aplica por cima o que já mudamos na tabela viva e o espelho ainda não pegou.
  const pedidos = useMemo(() => brutos
    .filter(p => !patches[p.id]?.removido)
    .map(p => {
      const novo = patches[p.id]?.status
      return novo ? { ...p, status: novo } : p
    }), [brutos, patches])

  // Deriva de `brutos`, NÃO de `pedidos`: excluir muda `patches`, que mudaria a
  // queryKey e faria as consultas auxiliares recomeçarem do zero.
  const idsPagina = useMemo(() => brutos.map(p => p.id), [brutos])
  const { data: arquivos, isLoading: arquivosCarregando } = useArquivosDocx(idsPagina)
  const { data: naProducao } = useNaProducao(idsPagina)

  const removidos = useMemo(
    () => Object.values(patches).filter(p => p.removido).length, [patches])
  // Contagem vem do espelho, que ainda conta o que apagamos nesta sessão.
  const total = Math.max(0, (data?.total ?? 0) - removidos)
  const totalPages = Math.ceil(total / PAGE_SIZE)
  const temFiltros = Boolean(filtros.search || filtros.status || filtros.de || filtros.ate)
  const periodo = descrevePeriodo(filtros.de, filtros.ate)

  // ⚠️ AS TRÊS MANEIRAS DE A LISTA MENTIR — todas medidas na tela, não supostas.
  //
  // `placeholderData: prev => prev` serve as linhas da consulta ANTERIOR
  // enquanto a nova não volta. Combinado com um paginador que já pulou de
  // página, vira mentira: "2 / 11" em cima das linhas da página 1.
  //
  // 1) EM VOO      → esmaece e diz "atualizando...". Honesto, é temporário.
  // 2) ERRO        → status 'error'. Some com a tabela e mostra a causa.
  // 3) PAUSADA     → fetchStatus 'paused'. ESTA É A TRAIÇOEIRA: quando o fetch
  //    rejeita com "Failed to fetch", o React Query conclui que o browser está
  //    OFFLINE e PARA a consulta — `status` continua 'success', `isError` fica
  //    FALSE pra sempre e o placeholder segue na tela. Medido: 1 tentativa,
  //    `fetchStatus: "paused"` estável em 12s. Quem olhasse só `isError` (como
  //    esta tela olhava) nunca veria o problema.
  const pausada = fetchStatus === 'paused'
  const falhou = isError || pausada
  const buscando = isPlaceholderData && isFetching && !falhou
  const falha = pausada
    ? { texto: 'O navegador não conseguiu falar com o servidor. Pode ser a internet, a VPN ou o antivírus bloqueando.', tecnico: 'consulta pausada (offline)' }
    : explicaFalha(error ?? failureReason)

  // `networkMode: 'always'` já evita a pausa nesta consulta. O cinto extra é
  // para o caso de ela pausar por outro caminho: o onlineManager só avisa quem
  // escuta quando o valor MUDA, então `setOnline(true)` num manager que já se
  // acha online não emite nada e o refetch nasceria pausado igual. Forçar
  // false→true dispara o evento de "voltou a rede" e destrava a fila.
  const tentarDeNovo = () => {
    if (!onlineManager.isOnline()) onlineManager.setOnline(true)
    else { onlineManager.setOnline(false); onlineManager.setOnline(true) }
    void refetch()
  }

  const limparTudo = () => {
    setFiltros({ search: '', status: '', de: '', ate: '', page: 0 })
    setBuscaInput('')
  }

  const invalidarLista = () => {
    void qc.invalidateQueries({ queryKey: ['controle-pedidos'] })
    void qc.invalidateQueries({ queryKey: ['controle-pedidos-arquivo'] })
    void qc.invalidateQueries({ queryKey: ['controle-pedidos-producao'] })
    // Quem mais soma pedido a partir do MESMO espelho: o painel /controle
    // (useControleDashboard) e o card de vendas do mês (useVendasReais).
    void qc.invalidateQueries({ queryKey: ['controle-vendas'] })
    void qc.invalidateQueries({ queryKey: ['vendas-reais-mes'] })
  }

  // ── Ação: excluir ────────────────────────────────────────────────────────
  //
  // Vai por `/api/controle-deletar-pedido` (serverless do CRM), NÃO direto na
  // edge `deletar-pedido` do controle: o CORS dela só libera
  // controle.branorte.com, então a chamada do CRM morre no preflight (medido:
  // `TypeError: Failed to fetch`). O endpoint resolve isso de servidor pra
  // servidor E aperta o portão — ele revalida `role === 'admin'` no backend,
  // enquanto a edge original aceita qualquer Bearer de 20+ chars. Esconder o
  // botão aqui não é controle de acesso; o servidor é.
  const excluir = useMutation({
    mutationFn: async (pedido: PedidoRow) => {
      const jwt = session?.access_token
      if (!jwt) throw new Error('Sessão expirada — entre de novo.')
      const r = await fetch('/api/controle-deletar-pedido', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${jwt}` },
        body: JSON.stringify({ id: pedido.id }),
      })
      const corpo = await r.json().catch(() => null) as { error?: string; detail?: string } | null
      if (!r.ok) throw new Error(corpo?.detail || corpo?.error || `HTTP ${r.status}`)
    },
    onSuccess: (_v, pedido) => {
      setPatches(p => ({ ...p, [pedido.id]: { ...p[pedido.id], removido: true } }))
      // Tira da lista já, sem esperar refetch.
      qc.setQueriesData<{ pedidos: PedidoRow[]; total: number }>(
        { queryKey: ['controle-pedidos'] },
        (antigo) => antigo
          ? { pedidos: antigo.pedidos.filter(x => x.id !== pedido.id), total: Math.max(0, antigo.total - 1) }
          : antigo,
      )
      setParaExcluir(null)
      invalidarLista()
      toast.success(`Pedido ${pedido.pedido_numero || pedido.numero_orcamento} excluído.`)
    },
    onError: (e: unknown) => {
      toast.error(`Não deu pra excluir: ${mensagemDeErro(e)}`)
    },
  })

  // ── Ação: mudar status (tabela VIVA) ─────────────────────────────────────
  const alterarStatus = useMutation({
    mutationFn: async ({ pedido, status }: { pedido: PedidoRow; status: PedidoStatus }) => {
      const { error: erro } = await controleSupabase
        .from('pedidos_venda').update({ status }).eq('id', pedido.id)
      if (erro) throw erro
    },
    onSuccess: (_v, { pedido, status }) => {
      setPatches(p => ({ ...p, [pedido.id]: { ...p[pedido.id], status } }))
      invalidarLista()
      toast.success(`Pedido ${pedido.pedido_numero || pedido.numero_orcamento} agora é ${status}.`)
    },
    onError: (e: unknown) => {
      toast.error(`Não deu pra mudar o status: ${mensagemDeErro(e)}`)
    },
  })

  // ── Ação: enviar/reenviar pra fábrica ────────────────────────────────────
  const mandarPraFabrica = useMutation({
    mutationFn: (pedido: PedidoRow) => enviarParaFabrica(pedido.id),
    onSuccess: ({ jaEstava, app2 }, pedido) => {
      const nome = pedido.pedido_numero || pedido.numero_orcamento
      if (app2) toast.success(jaEstava ? `${nome} reenviado pra fábrica.` : `${nome} enviado pra fábrica.`)
      else toast.warning(`${nome} entrou na produção local, mas o App2 não respondeu. O cron reenvia.`)
      void qc.invalidateQueries({ queryKey: ['controle-pedidos-producao'] })
    },
    onError: (e: unknown) => {
      toast.error(`Não deu pra enviar pra fábrica: ${mensagemDeErro(e)}`)
    },
  })

  // ── Ação: baixar DOCX ────────────────────────────────────────────────────
  // A edge `gerar-pedido-retroativo` REGERA o documento a partir da linha viva,
  // então o que sai é o pedido de hoje, não o .docx congelado de quando foi
  // criado. Ela responde CORS `*` — chamada direta daqui funciona.
  const baixarDocx = async (pedido: PedidoRow) => {
    setBaixando(pedido.id)
    const original = arquivos?.[pedido.id]
    const aviso = toast.loading('Gerando o documento atualizado...')
    try {
      const { data: resp, error: erro } = await controleSupabase.functions
        .invoke<{ ok?: boolean; arquivo_url?: string; error?: string }>(
          'gerar-pedido-retroativo', { body: { order_id: pedido.id } })
      if (erro) throw erro
      if (!resp?.ok || !resp.arquivo_url) throw new Error(resp?.error || 'A função não devolveu arquivo')
      window.open(resp.arquivo_url, '_blank', 'noopener')
      toast.success('Documento gerado.', { id: aviso })
    } catch (e) {
      console.error('[baixarDocx] regeração falhou, tentando o arquivo original:', e)
      if (original && original.startsWith('http')) {
        window.open(original, '_blank', 'noopener')
        toast.info('Não deu pra regerar — abrindo o documento original do pedido.', { id: aviso })
      } else {
        toast.error('Não foi possível gerar o documento deste pedido.', { id: aviso })
      }
    } finally {
      setBaixando(null)
    }
  }

  // ── Ação: exportar PDF da lista (respeita os filtros da tela) ────────────
  const exportarPDF = async () => {
    setExportando(true)
    const aviso = toast.loading('Buscando todos os pedidos do filtro...')
    try {
      const linhas: PedidoRow[] = []
      let truncado = false

      for (let inicio = 0; inicio < PDF_MAX; inicio += PDF_BLOCO) {
        let query = supabase
          .from('mirror_pedidos_venda')
          .select(COLS_ESPELHO)
          .order('data_venda', { ascending: false, nullsFirst: false })
        // ⚠️ O MESMO recorte da tela. Sem esta linha o escopo vazaria inteiro
        // pela exportação — e pior que ver na tela: vira arquivo, que anda.
        if (escopo.tipo === 'vendedor') query = query.or(filtroDoVendedor(escopo.nome))
        if (filtros.search) {
          query = query.or(`cliente.ilike.%${filtros.search}%,pedido_numero.ilike.%${filtros.search}%,numero_orcamento.ilike.%${filtros.search}%,vendedor.ilike.%${filtros.search}%`)
        }
        if (filtros.status) query = query.eq('status', filtros.status)
        if (filtros.de) query = query.gte('data_venda', filtros.de)
        if (filtros.ate) query = query.lte('data_venda', filtros.ate)

        const { data: bloco, error: erro } = await query.range(inicio, inicio + PDF_BLOCO - 1)
        if (erro) throw erro
        const lote = (bloco ?? []) as PedidoRow[]
        linhas.push(...lote)
        if (lote.length < PDF_BLOCO) break
        if (inicio + PDF_BLOCO >= PDF_MAX) truncado = true
      }

      const finais = linhas.filter(p => !patches[p.id]?.removido)
      if (finais.length === 0) { toast.error('Nenhum pedido para exportar.', { id: aviso }); return }

      const doc = new jsPDF()
      doc.setFontSize(16).setFont('helvetica', 'bold')
      doc.text('Pedidos de Venda', 14, 18)

      doc.setFontSize(9).setFont('helvetica', 'normal')
      let y = 26
      const cabecalho: string[] = []
      // O recorte fica ESCRITO no arquivo: quem receber o PDF depois precisa
      // saber que aquilo não é a empresa inteira.
      if (rotuloEscopo) cabecalho.push(rotuloEscopo)
      if (periodo) cabecalho.push(`Período (data da venda): ${periodo}`)
      if (filtros.search) cabecalho.push(`Busca: "${filtros.search}"`)
      if (filtros.status) cabecalho.push(`Status: ${filtros.status}`)
      cabecalho.push(`Emitido em ${new Date().toLocaleDateString('pt-BR')}`)
      for (const linha of cabecalho) { doc.text(linha, 14, y); y += 5 }
      doc.text(`Total de pedidos: ${finais.length}`, 14, y); y += 8

      autoTable(doc, {
        startY: y,
        head: [['Data', 'Nº Pedido', 'Nº Orçamento', 'Cliente', 'Vendedor', 'UF', 'Valor', 'Status']],
        body: finais.map(p => [
          dataBR(p.data_venda, false),
          p.pedido_numero || '-',
          p.numero_orcamento || '-',
          p.cliente || '(sem nome)',
          [p.vendedor, p.vendedor_2].filter(Boolean).join(' + ') || '-',
          p.estado || '-',
          brl(valorPedido(p), false),
          patches[p.id]?.status || p.status || '-',
        ]),
        theme: 'grid',
        styles: { fontSize: 7.5, cellPadding: 1.6 },
        headStyles: { fillColor: [31, 41, 55], textColor: 255, fontSize: 7.5 },
        columnStyles: { 6: { halign: 'right' } },
        margin: { left: 14, right: 14 },
      })

      // Cancelado não entra no total — mesmo critério do Controle de Vendas.
      const soma = finais
        .filter(p => (patches[p.id]?.status || p.status) !== 'CANCELADO')
        .reduce((acc, p) => acc + valorPedido(p), 0)
      const fim = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y
      doc.setFontSize(10).setFont('helvetica', 'bold')
      doc.text(`Valor total (sem cancelados): ${brl(soma, false)}`, 14, fim + 8)

      if (truncado) {
        doc.setFontSize(8).setFont('helvetica', 'normal')
        doc.text(`Atenção: exportação limitada aos primeiros ${PDF_MAX} pedidos.`, 14, fim + 14)
      }

      doc.save(`pedidos-de-venda-${new Date().toISOString().slice(0, 10)}.pdf`)
      toast.success(`PDF com ${finais.length} pedido${finais.length !== 1 ? 's' : ''} gerado.`, { id: aviso })
    } catch (e) {
      console.error('[exportarPDF]', e)
      toast.error(`Não deu pra exportar: ${mensagemDeErro(e)}`, { id: aviso })
    } finally {
      setExportando(false)
    }
  }

  const abrirDetalhe = (id: string) => navigate(`/controle/pedidos/${id}`)
  const abrirNaProducao = (numero: string) => window.open(
    `${URL_PRODUCAO}/dashboard?origem=crm&pedido=${encodeURIComponent(numero)}`,
    '_blank', 'noopener',
  )

  return (
    <div className="p-4 lg:p-8 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-text-primary flex items-center gap-2">
            <FileText className="h-7 w-7 text-accent" />
            Pedidos de Venda
          </h1>
          <p className="text-sm text-text-muted mt-1">
            A lista vem do espelho do controle.branorte.com; abrir, editar, baixar,
            excluir e mandar pra fábrica mexem no pedido de verdade.
          </p>
          {rotuloEscopo && (
            <p className="mt-1 text-xs font-medium text-info">{rotuloEscopo}</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            onClick={() => setValoresVisiveis(v => !v)}
            title={valoresVisiveis ? 'Ocultar os valores' : 'Mostrar os valores'}
          >
            {valoresVisiveis ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            {valoresVisiveis ? 'Ocultar valores' : 'Mostrar valores'}
          </Button>
          <Button variant="secondary" onClick={() => void exportarPDF()} loading={exportando}>
            <FileDown className="h-4 w-4" /> Exportar PDF
          </Button>
        </div>
      </div>

      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-3 items-center">
          <Input
            placeholder="Buscar por cliente, nº do pedido/orçamento ou vendedor..."
            leftIcon={<Search className="h-4 w-4" />}
            value={buscaInput}
            onChange={e => setBuscaInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && setFiltros(f => ({ ...f, search: buscaInput, page: 0 }))}
            className="lg:w-96"
          />
          <Select
            options={STATUS_VALIDOS.map(s => ({ value: s, label: s[0] + s.slice(1).toLowerCase() }))}
            placeholder="Status"
            value={filtros.status}
            onChange={e => setFiltros(f => ({ ...f, status: e.target.value, page: 0 }))}
            className="lg:w-40"
          />
          {temFiltros && (
            <Button variant="ghost" size="sm" onClick={limparTudo}>
              <X className="h-4 w-4" /> Limpar
            </Button>
          )}
        </div>

        {/* Período — "quanto vendemos mês passado" é um clique. */}
        <div className="flex flex-wrap items-center gap-2">
          <Calendar className="h-4 w-4 shrink-0 text-text-muted" />
          <input
            type="date"
            aria-label="Data da venda — de"
            value={filtros.de}
            onChange={e => setFiltros(f => ({ ...f, de: e.target.value, page: 0 }))}
            className="h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 [color-scheme:light] dark:[color-scheme:dark]"
          />
          <span className="text-xs text-text-muted">até</span>
          <input
            type="date"
            aria-label="Data da venda — até"
            value={filtros.ate}
            onChange={e => setFiltros(f => ({ ...f, ate: e.target.value, page: 0 }))}
            className="h-9 rounded-md border border-border bg-surface px-2 text-[13px] text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30 [color-scheme:light] dark:[color-scheme:dark]"
          />
          <Button variant="secondary" size="sm"
            onClick={() => setFiltros(f => ({ ...f, ...mesRelativo(0), page: 0 }))}>
            Mês Atual
          </Button>
          <Button variant="secondary" size="sm"
            onClick={() => setFiltros(f => ({ ...f, ...mesRelativo(-1), page: 0 }))}>
            Mês Passado
          </Button>
          {(filtros.de || filtros.ate) && (
            <Button variant="ghost" size="sm"
              onClick={() => setFiltros(f => ({ ...f, de: '', ate: '', page: 0 }))}>
              Todo o período
            </Button>
          )}
        </div>
      </Card>

      {/* Ordem do gate: ESCOPO → FALHA → carregando → conteúdo.
          O escopo vem PRIMEIRO de propósito: sem saber de quem é a lista, não
          existe lista pra mostrar. */}
      {escopo.tipo === 'carregando' ? (
        <Card className="p-10">
          <LoadingSpinner size="lg" label="Conferindo de quem são os pedidos..." />
        </Card>
      ) : escopo.tipo === 'sem-escopo' ? (
        <Card className="p-8">
          <div className="flex flex-col items-center gap-3 text-center">
            <ShieldAlert className="h-8 w-8 text-warning" />
            <p className="text-sm font-medium text-text-primary">
              Não consegui identificar de quem são os pedidos.
            </p>
            <p className="max-w-md text-xs text-text-muted">
              Seu usuário não está ligado a um vendedor, então não dá pra saber o
              que é seu — e mostrar a lista inteira exporia os pedidos dos colegas.
              Peça pro admin vincular seu perfil a um vendedor.
            </p>
          </div>
        </Card>
      ) : falhou ? (
        <FalhaAoCarregar
          causa={falha.texto}
          tecnico={falha.tecnico}
          tinhaLista={jaMostrouLista}
          tentando={isFetching}
          onTentar={tentarDeNovo}
        />
      ) : isLoading && !data ? (
        <Card className="p-10">
          <div className="flex flex-col items-center gap-4">
            <LoadingSpinner size="lg" label="Carregando pedidos..." />
            <p className="text-xs text-text-muted">Se a lista não aparecer, clique no botão abaixo.</p>
            <Button variant="secondary" size="sm" onClick={tentarDeNovo}>
              <RotateCw className="h-4 w-4" /> Tentar Novamente
            </Button>
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <p className="text-sm text-text-muted">
                {total.toLocaleString('pt-BR')} pedido{total !== 1 ? 's' : ''}
                {periodo ? <span className="text-text-muted"> · {periodo}</span> : null}
              </p>
              {buscando && (
                <span className="flex items-center gap-1.5 text-xs font-medium text-warning">
                  <RotateCw className="h-3 w-3 animate-spin" /> atualizando...
                </span>
              )}
            </div>
            {totalPages > 1 && (
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" disabled={filtros.page === 0} onClick={() => setFiltros(f => ({ ...f, page: f.page - 1 }))}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-sm text-text-secondary">{filtros.page + 1} / {totalPages}</span>
                <Button variant="ghost" size="sm" disabled={filtros.page >= totalPages - 1} onClick={() => setFiltros(f => ({ ...f, page: f.page + 1 }))}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>

          <Card className="overflow-hidden">
            <div className={cn('overflow-x-auto transition-opacity', buscando && 'pointer-events-none opacity-40')}>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-surface-border bg-surface-secondary">
                    <th className="text-left text-xs font-medium text-text-muted px-3 py-3">Data</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Pedido</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Orçamento</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Cliente</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Vendedor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-3 py-3 w-12">UF</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Valor</th>
                    <th className="text-left text-xs font-medium text-text-muted px-4 py-3">Status</th>
                    <th className="text-right text-xs font-medium text-text-muted px-4 py-3">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border">
                  {pedidos.map(p => {
                    const vendedor = [p.vendedor, p.vendedor_2].filter(Boolean).join(' + ')
                    const rotulo = p.pedido_numero || p.numero_orcamento || p.id.slice(0, 8)
                    const arquivo = arquivos?.[p.id]
                    // Enquanto a consulta da tabela viva não voltou, mostramos o
                    // botão: a edge regera do zero, então funciona mesmo sem
                    // arquivo antigo. Só some quando SABEMOS que não há DOCX.
                    const mostraDocx = arquivosCarregando || (!!arquivo && !arquivo.startsWith('SEM_DOCX:'))
                    const mudandoStatus = alterarStatus.isPending && alterarStatus.variables?.pedido.id === p.id
                    const statusConhecido = STATUS_VALIDOS.includes(p.status as PedidoStatus)
                    const jaNaFabrica = naProducao?.has(p.id) ?? false
                    const enviando = mandarPraFabrica.isPending && mandarPraFabrica.variables?.id === p.id

                    return (
                      <tr
                        key={p.id}
                        onClick={() => abrirDetalhe(p.id)}
                        className="hover:bg-surface-secondary/50 transition-colors cursor-pointer"
                      >
                        <td className="px-3 py-3"><span className="text-xs text-text-muted font-mono whitespace-nowrap">{dataBR(p.data_venda)}</span></td>
                        <td className="px-4 py-3">
                          <button
                            type="button"
                            onClick={e => { e.stopPropagation(); abrirDetalhe(p.id) }}
                            className="text-sm font-medium text-accent font-mono hover:underline"
                          >
                            {rotulo}
                          </button>
                        </td>
                        <td className="px-4 py-3"><span className="text-sm text-text-secondary font-mono whitespace-nowrap">{p.numero_orcamento || '-'}</span></td>
                        <td className="px-4 py-3"><span className="text-sm text-text-primary truncate max-w-[220px] block" title={p.cliente || ''}>{p.cliente || '(sem nome)'}</span></td>
                        <td className="px-4 py-3"><span className="text-sm text-text-secondary">{vendedor || '-'}</span></td>
                        <td className="px-3 py-3">{p.estado ? <Badge className="bg-info-bg text-info font-mono text-[11px]">{p.estado}</Badge> : <span className="text-xs text-text-muted">-</span>}</td>
                        <td className="px-4 py-3 text-right">
                          <span className={cn(
                            'text-sm font-semibold tabular-nums',
                            valoresVisiveis ? 'text-text-primary' : 'text-text-muted',
                          )}>
                            {valoresVisiveis ? brl(valorPedido(p)) : 'R$ •••••'}
                          </span>
                        </td>

                        {/* Status vira campo: muda direto na tabela viva, como na tela do controle. */}
                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          {/* O <Select> do CRM embrulha o <select> num div.relative e
                              pendura a setinha em `right-2.5` DESSE div. Como className
                              só chega no <select>, sem esta caixa de 118px o div fica
                              com a largura da célula e a setinha voa pro canto direito
                              da coluna, longe da pílula. */}
                          <div className="w-[118px]">
                            <Select
                              aria-label={`Status do pedido ${rotulo}`}
                              options={STATUS_VALIDOS.map(s => ({ value: s, label: s }))}
                              // Sem status conhecido (ou um valor que o enum não
                              // tem), o <select> controlado precisa de uma opção
                              // vazia pra casar com value=''.
                              placeholder={statusConhecido ? undefined : '—'}
                              value={statusConhecido ? (p.status as PedidoStatus) : ''}
                              disabled={mudandoStatus}
                              onChange={e => {
                                const novo = e.target.value as PedidoStatus
                                if (!novo || novo === p.status) return
                                alterarStatus.mutate({ pedido: p, status: novo })
                              }}
                              className={cn(
                                'h-7 w-full text-[11px] font-semibold border',
                                STATUS_TOM[p.status || ''] || 'bg-surface-2 text-text-secondary border-border',
                              )}
                            />
                          </div>
                        </td>

                        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                          <div className="flex items-center justify-end gap-1">
                            <IconBtn title="Abrir detalhes" onClick={() => abrirDetalhe(p.id)}>
                              <ExternalLink className="h-4 w-4" />
                            </IconBtn>

                            {mostraDocx && (
                              <IconBtn
                                title="Baixar DOCX atualizado"
                                loading={baixando === p.id}
                                onClick={() => void baixarDocx(p)}
                              >
                                <Download className="h-4 w-4" />
                              </IconBtn>
                            )}

                            <IconBtn
                              title={jaNaFabrica
                                ? 'Já está na fábrica — reenviar e voltar pro início'
                                : 'Enviar para a fábrica (Produção/App2)'}
                              tone={jaNaFabrica ? 'ok' : 'atencao'}
                              loading={enviando}
                              onClick={() => mandarPraFabrica.mutate(p)}
                            >
                              <Factory className="h-4 w-4" />
                            </IconBtn>

                            <IconBtn
                              title="Abrir no Controle de Produção"
                              onClick={() => abrirNaProducao(p.pedido_numero || p.numero_orcamento || '')}
                            >
                              <Cog className="h-4 w-4" />
                            </IconBtn>

                            <IconBtn title="Editar pedido" onClick={() => navigate(`/controle/pedidos/editar/${p.id}`)}>
                              <Pencil className="h-4 w-4" />
                            </IconBtn>

                            {podeExcluir && (
                              <IconBtn title="Excluir pedido" tone="danger" onClick={() => setParaExcluir(p)}>
                                <Trash2 className="h-4 w-4" />
                              </IconBtn>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}

                  {pedidos.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-10">
                        <div className="flex flex-col items-center gap-3 text-center">
                          <FileText className="h-8 w-8 text-text-muted" />
                          <p className="text-sm text-text-secondary">
                            {temFiltros
                              ? 'Nenhum pedido encontrado para os filtros selecionados.'
                              : 'Nenhum pedido cadastrado ainda.'}
                          </p>
                          {periodo && (
                            <p className="text-xs text-text-muted">Período: {periodo}</p>
                          )}
                          {/* Os botões de escapar ficam AQUI, onde o vendedor está
                              olhando — não só lá em cima no card de filtro. */}
                          {temFiltros && (
                            <div className="flex flex-wrap justify-center gap-2 pt-1">
                              {(filtros.de || filtros.ate) && (
                                <Button variant="secondary" size="sm"
                                  onClick={() => setFiltros(f => ({ ...f, de: '', ate: '', page: 0 }))}>
                                  Limpar o período
                                </Button>
                              )}
                              <Button variant="secondary" size="sm"
                                onClick={() => setFiltros(f => ({ ...f, ...mesRelativo(-1), page: 0 }))}>
                                Mês Passado
                              </Button>
                              <Button variant="secondary" size="sm" onClick={limparTudo}>
                                Limpar todos os filtros
                              </Button>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      )}

      {paraExcluir && (
        <ModalExcluir
          pedido={paraExcluir}
          excluindo={excluir.isPending}
          onConfirmar={() => excluir.mutate(paraExcluir)}
          onFechar={() => { if (!excluir.isPending) setParaExcluir(null) }}
        />
      )}
    </div>
  )
}

// Botão-ícone da coluna de ações. Fica aqui embaixo porque é detalhe de layout
// desta tela — o design system do CRM não tem variante icon-only.
function IconBtn({ children, title, onClick, tone, loading }: {
  children: React.ReactNode
  title: string
  onClick: () => void
  tone?: 'danger' | 'ok' | 'atencao'
  loading?: boolean
}) {
  const tons: Record<string, string> = {
    danger: 'text-danger hover:bg-danger-bg',
    ok: 'text-success hover:bg-success-bg',
    atencao: 'text-warning hover:bg-warning-bg',
  }
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={loading}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40',
        tone ? tons[tone] : 'text-text-muted hover:text-text-primary hover:bg-surface-2',
      )}
    >
      {loading
        ? <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        : children}
    </button>
  )
}
