import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface OrcamentoItem {
  letra: string         // A, B, C...
  qtd: number
  nome: string
  specs: string[]
  valor: number
  brinde?: boolean      // item brinde (valor não entra no total)
  por_conta_cliente?: boolean  // item fornecido pelo cliente — mostra "por conta do cliente"
  // ── Round-trip completo (2026-06-10) ──────────────────────────────────────
  // Quando __full=true, o item foi salvo com TODOS os campos do carrinho e a
  // edição recarrega exatamente como estava (sem reconstruir do catálogo —
  // preserva foto manual, item custom, inox, motor, função, etc). Itens de
  // modelos prontos (orcamento_modelos) e orçamentos legados NÃO têm __full →
  // continuam reconstruindo via fuzzy match no carregarDoModelo.
  __full?: boolean
  catalogo_id?: number
  preco_branorte_id?: number | null
  categoria?: string
  valor_original?: number
  foto_url?: string | null
  motor_cv?: number | null
  motor_polos?: number | null
  motor_qtd?: number
  motor_valor_unit?: number
  usa_inversor?: boolean
  funcao_selecionada?: string | null
  ocultar_funcao_no_pdf?: boolean
  inox?: '304' | '316' | false
  tungstenio?: boolean
  specs_original?: string[]
  motor_por_conta_cliente?: boolean
  motor_removido?: boolean
  valor_pre_remocao?: number | null
  motores_extras_snapshot?: any[]
  motores_por_conta_idx?: number[]
  motores_removidos_idx?: number[]
}

export interface OrcamentoAcessorios {
  items: string[]
  valor: number
}

export interface OrcamentoMotor {
  cv: number
  polos: number
  valor: number
  // Bug #25: distinguir "motor genuinamente incluso no preço do equipamento"
  // (motorredutor, TH, spec com "(incluso)") de "motor avulso sem valor preenchido"
  // (catálogo não encontrou match). Quando valor=0 + incluso=false + por_conta_cliente=false
  // => MOTOR SEM VALOR (warning). Antes: qualquer valor=0 virava "incluso" silenciosamente.
  incluso?: boolean
  por_conta_cliente?: boolean
  // Issue #23: vendedor pode REMOVER o motor de um item (cliente não quer).
  // Quando true, o motor é descontado do total (se vier incluso no valor_com_motor_*,
  // recalcula valor do equipamento via valor_equipamento; se for avulso, só zera o motor).
  // O motor não aparece mais na tabela MOTORES TRIFÁSICOS.
  removido?: boolean
}

export interface OrcamentoModelo {
  id: number
  slug: string
  basename: string
  pacote: string         // COMPACTA 01/02/03, MINI FABRICA
  voltagem: 'monofasico' | 'trifasico'
  is_master: boolean
  is_jr: boolean
  com_balanca: boolean
  com_ensacadeira: boolean
  com_chupim: boolean
  producao_kgh: number | null
  armazenamento_kg: number | null
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  arquivo_origem: string | null
  template_path: string | null
  foto_url: string | null  // thumbnail representativa (derivada de catalogo_items)
  ativo: boolean
}

export interface ClienteDados {
  ac?: string
  fone?: string
  cidade?: string
  uf?: string       // sigla UF: SP, SC, RS, etc
  bairro?: string
  endereco?: string
  cep?: string
  cnpj?: string
  ie?: string
  email?: string
}

export interface OrcamentoCliente extends ClienteDados {
  id: number
  nome: string
}

export interface OrcamentoGerado {
  id: number
  numero: string                    // 2026 - 0691
  ano: number
  sequencial: number
  data_emissao: string
  vendedor_nome: string
  cliente_id: number | null
  cliente_nome: string
  cliente_dados: ClienteDados
  modelo_id: number | null
  modelo_basename: string | null
  voltagem: 'monofasico' | 'trifasico'
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  componentes_extras: Array<{ id: string; nome: string; valor: number }> | null
  balanca_dispensada: boolean | null
  observacoes: string | null
  forma_pagamento: string | null
  prazo_entrega: string | null
  // Frete editavel inline no preview. Colunas criadas via migration 2026-06-10
  // (frete_tipo/frete_txt/desconto/tensao_motores/marca_motores). Default legado
  // quando null: FOB + "por conta do cliente".
  frete_tipo?: 'CIF' | 'FOB' | null
  frete_txt?: string | null
  desconto?: { tipo: 'pct' | 'valor'; valor: number; motivo?: string; base?: 'total' | 'equipamento'; manterValorParcelas?: boolean } | null
  tensao_motores?: 220 | 380 | 660 | null
  marca_motores?: string | null
  parcelas: any[] | null
  status: 'rascunho' | 'enviado' | 'aprovado' | 'perdido'
  pdf_url: string | null
  foto_principal_url: string | null
  enviado_em: string | null
  created_at: string
  updated_at: string
  parent_id: number | null
  versao_alt: number | null
  numero_base: string | null
}

export interface SubirModeloInput {
  basename: string                  // ex: "Avulso - Martelos e Peneiras"
  pacote: string                    // ex: "ACESSÓRIOS", "PEÇAS", "OUTROS"
  voltagem: 'monofasico' | 'trifasico'
  is_master: boolean
  is_jr: boolean
  com_balanca: boolean
  com_ensacadeira: boolean
  com_chupim: boolean
  producao_kgh: number | null
  armazenamento_kg: number | null
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  arquivo_docx: File | Blob          // o .docx em si pra subir no Storage
}

// Faz upload do .docx pro bucket + cria registro em orcamento_modelos
export async function subirModeloCustomizado(input: SubirModeloInput): Promise<OrcamentoModelo> {
  const slug = `custom-${Date.now()}-${input.basename.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 60)}`
  const templatePath = `v1/${slug}.docx`

  // 1) Upload do .docx pro bucket
  const { error: upErr } = await supabase.storage
    .from('orcamento-templates')
    .upload(templatePath, input.arquivo_docx, {
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      upsert: true,
    })
  if (upErr) throw new Error(`Falha upload .docx: ${upErr.message}`)

  // 2) Insere em orcamento_modelos
  const payload = {
    slug,
    basename: input.basename,
    pacote: input.pacote,
    voltagem: input.voltagem,
    is_master: input.is_master,
    is_jr: input.is_jr,
    com_balanca: input.com_balanca,
    com_ensacadeira: input.com_ensacadeira,
    com_chupim: input.com_chupim,
    producao_kgh: input.producao_kgh,
    armazenamento_kg: input.armazenamento_kg,
    itens: input.itens as any,
    acessorios: input.acessorios as any,
    motores: input.motores as any,
    total_equipamentos: input.total_equipamentos,
    total_motores: input.total_motores,
    total_proposta: input.total_proposta,
    template_path: templatePath,
    arquivo_origem: '(upload manual)',
    ativo: true,
  }
  const { data, error } = await supabase
    .from('orcamento_modelos')
    .insert(payload)
    .select()
    .single()
  if (error) throw new Error(`Falha salvar modelo: ${error.message}`)
  return data as OrcamentoModelo
}

// Lista todos os modelos (catalogo Branorte)
export function useOrcamentoModelos() {
  return useQuery({
    // queryKey bumped v3 — invalidar caches antigos com total_proposta sem acessorios
    queryKey: ['orcamento-modelos-v3'],
    queryFn: async (): Promise<OrcamentoModelo[]> => {
      const { data, error } = await supabase
        .from('orcamento_modelos')
        .select('*')
        .eq('ativo', true)
        .order('pacote')
        .order('producao_kgh', { ascending: true })
        .order('armazenamento_kg', { ascending: true })
      if (error) throw error
      return (data ?? []) as OrcamentoModelo[]
    },
    staleTime: 0,              // sempre considera dados stale
    gcTime: 60_000,            // limpa do cache apos 1 min sem uso
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  })
}

// Lista clientes recentes para autocomplete
export function useClientesOrcamento(search: string) {
  return useQuery({
    queryKey: ['orcamento-clientes', search],
    queryFn: async (): Promise<OrcamentoCliente[]> => {
      let q = supabase.from('orcamento_clientes').select('*').limit(20)
      if (search.trim()) q = q.ilike('nome', `%${search.trim()}%`)
      const { data, error } = await q.order('updated_at', { ascending: false })
      if (error) throw error
      return (data ?? []) as OrcamentoCliente[]
    },
    enabled: true,
    staleTime: 30_000,
  })
}

// Carrega 1 orçamento pelo id (pra modo edição)
export function useOrcamentoGerado(id: number | null) {
  return useQuery({
    queryKey: ['orcamento-gerado', id],
    queryFn: async (): Promise<OrcamentoGerado | null> => {
      if (!id) return null
      const { data, error } = await supabase
        .from('orcamentos_gerados')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (error) throw error
      return (data ?? null) as OrcamentoGerado | null
    },
    enabled: !!id,
    staleTime: 0, // sempre busca fresh ao entrar em edição
  })
}

// UPDATE de orçamento existente. Mantém numero/sequencial originais.
export function useAtualizarOrcamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: number } & Partial<CriarOrcamentoInput>): Promise<OrcamentoGerado> => {
      const { id, numero_override: _no, ...rest } = input as any
      void _no
      // Fix #21: sufixa voltagem nos nomes dos itens (quando há motores e voltagem definida).
      const itensComVoltagemUpd = (rest.itens && rest.voltagem)
        ? suffixVoltagemNosItens(rest.itens as OrcamentoItem[], rest.voltagem, rest.motores ?? null)
        : rest.itens
      const payload: any = {
        ...rest,
        ...(itensComVoltagemUpd ? { itens: itensComVoltagemUpd } : {}),
        updated_at: new Date().toISOString(),
      }
      // Remove campos undefined (mantém comportamento idempotente)
      Object.keys(payload).forEach(k => payload[k] === undefined && delete payload[k])
      const { data, error } = await supabase
        .from('orcamentos_gerados')
        .update(payload)
        .eq('id', id)
        .select()
        .single()
      if (error) throw error
      return data as OrcamentoGerado
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos-gerados'] })
      qc.invalidateQueries({ queryKey: ['orcamento-gerado'] })
    },
  })
}

// Lista orçamentos gerados (recentes)
export function useOrcamentosGerados(filters?: { vendedor_nome?: string; status?: string }) {
  return useQuery({
    queryKey: ['orcamentos-gerados', filters],
    queryFn: async (): Promise<OrcamentoGerado[]> => {
      let q = supabase
        .from('orcamentos_gerados')
        .select('*')
        .order('data_emissao', { ascending: false })
        .order('sequencial', { ascending: false })
        // antes era 100 -> escondia orcamentos antigos (ex: 2026-1050, o 112o mais
        // recente). Filtro de vendedor/status e a busca rodam client-side, entao tudo
        // precisa estar carregado. Tabela inteira ~376 linhas / 659KB, cabe folgado.
        .limit(1000)
      if (filters?.vendedor_nome) q = q.eq('vendedor_nome', filters.vendedor_nome)
      if (filters?.status) q = q.eq('status', filters.status)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as OrcamentoGerado[]
    },
    staleTime: 30_000,
  })
}

// Busca proximo numero (lê do banco e calcula 2026 - XXXX)
export async function obterProximoNumero(): Promise<{ ano: number; sequencial: number; numero: string }> {
  const ano = new Date().getFullYear()

  // Busca em paralelo: pasta index (leitura imediata, sem polling) + MAX do banco.
  // Escolhe o maior dos dois + 1. Rápido: 1 round trip em vez de 3s de polling.
  const [pastaResult, dbResult] = await Promise.all([
    // Lê o index da pasta (valor mais recente, sem esperar scan)
    supabase
      .from('pasta_orcamento_index')
      .select('ultimo_sequencial')
      .eq('ano', ano)
      .maybeSingle(),
    // Lê o MAX sequencial do banco (fonte autoritativa)
    supabase
      .from('orcamentos_gerados')
      .select('sequencial')
      .eq('ano', ano)
      .order('sequencial', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ])

  const seqPasta = Number(pastaResult.data?.ultimo_sequencial ?? 0)
  const seqDb = Number(dbResult.data?.sequencial ?? 0)
  const seq = Math.max(seqPasta, seqDb) + 1

  // Dispara scan da pasta Z em background (pra próxima vez) — fire and forget
  try {
    const ch = supabase.channel('force-scan-pasta')
    ch.subscribe().then(() => {
      ch.send({ type: 'broadcast', event: 'scan-now', payload: { ts: Date.now() } })
      setTimeout(() => { try { supabase.removeChannel(ch) } catch {} }, 3000)
    })
  } catch { /* non-blocking */ }

  return {
    ano,
    sequencial: seq,
    numero: `${ano} - ${String(seq).padStart(4, '0')}`,
  }
}

// Regex compartilhado pra detectar Balança Eletrônica em nomes de itens/componentes.
// Usado tanto no auto-add (cacamba puxa balança) quanto na detecção de duplicata
// (vendedor tenta adicionar balança avulsa quando cacamba já adicionou uma).
export const BALANCA_NOME_RE = /balan.a.*el.tr.nica/i

// Detecta categoria de Caçamba de Pesagem (que auto-adiciona balança como extra).
export function isCacambaPesagemItem(
  categoria: string | null | undefined,
  nome: string | null | undefined,
): boolean {
  const cat = (categoria || '').toUpperCase()
  const n = (nome || '').toUpperCase()
  return cat === 'CACAMBA_PESAGEM' || /CA[ÇC]AMBA.*PESAGEM/i.test(n)
}

// Bug #27: vendedor adiciona Caçamba (que auto-adiciona Balança Eletrônica como
// componente extra) e DEPOIS também adiciona uma Balança avulsa pelo picker —
// resultado: balança contabilizada 2x no total. Esta função detecta o conflito
// pra avisar o vendedor antes da adição duplicada.
//
// Retorna true se:
//   - O item sendo adicionado é uma Balança (categoria BALANCA ou nome match)
//   - E já existe uma Caçamba de Pesagem no carrinho (que auto-adiciona balança)
//   - OU já existe Balança Eletrônica nos componentes extras
export function detectarBalancaDuplicada(
  itemSendoAdicionado: { categoria?: string | null; nome?: string | null },
  carrinhoAtual: Array<{ categoria?: string | null; nome?: string | null }>,
  componentesExtras: Array<{ nome: string }>,
): { duplicada: boolean; motivo: string } {
  const cat = (itemSendoAdicionado.categoria || '').toUpperCase()
  const nome = itemSendoAdicionado.nome || ''
  const eBalanca = cat === 'BALANCA' || BALANCA_NOME_RE.test(nome)
  if (!eBalanca) return { duplicada: false, motivo: '' }

  // 1) Caçamba no carrinho → auto-adicionou balança nos extras
  const cacambaNoCarrinho = carrinhoAtual.some(it =>
    isCacambaPesagemItem(it.categoria, it.nome)
  )
  if (cacambaNoCarrinho) {
    return {
      duplicada: true,
      motivo: 'A Caçamba de Pesagem já adicionou uma Balança Eletrônica como componente extra.',
    }
  }

  // 2) Balança já existe nos componentes extras
  const balancaNosExtras = componentesExtras.some(c =>
    BALANCA_NOME_RE.test(c.nome.trim())
  )
  if (balancaNosExtras) {
    return {
      duplicada: true,
      motivo: 'Já existe uma Balança Eletrônica nos componentes adicionais do orçamento.',
    }
  }

  return { duplicada: false, motivo: '' }
}

// Suffix voltagem (Monofásico/Trifásico) ao nome do item se ainda não tiver.
// Resolve bug #21: vendedores estavam concatenando à mão pra identificar a tensão.
// Aplica somente se o orçamento tem motor(es) — caso contrário voltagem é irrelevante.
function suffixVoltagemNosItens(
  itens: OrcamentoItem[],
  voltagem: 'monofasico' | 'trifasico',
  motores: OrcamentoMotor[] | null | undefined
): OrcamentoItem[] {
  const temMotores = Array.isArray(motores) && motores.length > 0
  if (!temMotores) return itens
  const label = voltagem === 'monofasico' ? 'Monofásico' : 'Trifásico'
  const jaTemVoltagem = /\b(mono(f[aá]sico)?|trif[aá]sico)\b/i
  return itens.map(it => {
    const nome = it.nome || ''
    if (!nome) return it
    if (jaTemVoltagem.test(nome)) return it
    return { ...it, nome: `${nome} - ${label}` }
  })
}

export interface CriarOrcamentoInput {
  vendedor_nome: string
  vendedor_id?: string | null
  cliente_id?: number | null
  cliente_nome: string
  cliente_dados: ClienteDados
  modelo_id: number | null
  modelo_basename: string | null
  voltagem: 'monofasico' | 'trifasico'
  itens: OrcamentoItem[]
  acessorios: OrcamentoAcessorios | null
  motores: OrcamentoMotor[]
  total_equipamentos: number
  total_motores: number
  total_proposta: number
  observacoes?: string | null
  forma_pagamento?: string | null
  prazo_entrega?: string | null
  status?: 'rascunho' | 'enviado' | 'aprovado' | 'perdido'
  // Override do numero (se vier da pasta Z:). Se nao fornecido, usa DB sequence.
  numero_override?: { ano: number; sequencial: number; numero: string } | null
  // Componentes adicionais (NÃO fabricados pela Branorte) — painel, balança, célula de carga…
  componentes_extras?: Array<{ id: string; nome: string; valor: number }> | null
  // Vendedor dispensou a balança auto-adicionada pela Caçamba de Pesagem.
  balanca_dispensada?: boolean | null
  // Foto principal do orçamento (URL pública no Storage após upload)
  foto_principal_url?: string | null
  // Seção "Observação — por conta do cliente" editável (null = default histórico)
  obs_por_conta?: string[] | null
}

export function useCriarOrcamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CriarOrcamentoInput): Promise<OrcamentoGerado> => {
      // Pega numero do override (pasta Z) E do banco, escolhe o MAIOR + 1.
      // Evita conflito quando a pasta tem numero antigo mas o banco ja avancou.
      const fromBank = await obterProximoNumero()
      const fromOverride = input.numero_override
      let ano = fromOverride?.ano ?? fromBank.ano
      let sequencial = Math.max(
        fromOverride?.sequencial ?? 0,
        fromBank.sequencial,
      )
      let numero = `${ano} - ${String(sequencial).padStart(4, '0')}`

      // Resolve conflito: 1 query pra pegar o MAX real do banco e pular colisões
      const { data: maxRow } = await supabase
        .from('orcamentos_gerados')
        .select('sequencial')
        .eq('ano', ano)
        .gte('sequencial', sequencial)
        .order('sequencial', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (maxRow) {
        sequencial = maxRow.sequencial + 1
        numero = `${ano} - ${String(sequencial).padStart(4, '0')}`
      }

      // Cria/atualiza cliente se tiver nome
      let cliente_id = input.cliente_id ?? null
      if (!cliente_id && input.cliente_nome.trim()) {
        const { data: cli } = await supabase
          .from('orcamento_clientes')
          .insert({
            nome: input.cliente_nome.trim(),
            ac: input.cliente_dados.ac ?? null,
            fone: input.cliente_dados.fone ?? null,
            cidade: input.cliente_dados.cidade ?? null,
            bairro: input.cliente_dados.bairro ?? null,
            endereco: input.cliente_dados.endereco ?? null,
            cep: input.cliente_dados.cep ?? null,
            cnpj: input.cliente_dados.cnpj ?? null,
            ie: input.cliente_dados.ie ?? null,
            email: input.cliente_dados.email ?? null,
          })
          .select('id')
          .single()
        cliente_id = cli?.id ?? null
      }

      // Fix #21: sufixa voltagem nos nomes dos itens (quando há motores).
      const itensComVoltagem = suffixVoltagemNosItens(input.itens, input.voltagem, input.motores)

      const payload = {
        numero,
        ano,
        sequencial,
        data_emissao: new Date().toISOString().split('T')[0],
        vendedor_nome: input.vendedor_nome,
        vendedor_id: input.vendedor_id ?? null,
        cliente_id,
        cliente_nome: input.cliente_nome.trim(),
        cliente_dados: input.cliente_dados,
        modelo_id: input.modelo_id,
        modelo_basename: input.modelo_basename,
        voltagem: input.voltagem,
        itens: itensComVoltagem,
        acessorios: input.acessorios,
        motores: input.motores,
        total_equipamentos: input.total_equipamentos,
        total_motores: input.total_motores,
        total_proposta: input.total_proposta,
        observacoes: input.observacoes ?? null,
        forma_pagamento: input.forma_pagamento ?? null,
        prazo_entrega: input.prazo_entrega ?? null,
        status: input.status ?? 'rascunho',
        componentes_extras: input.componentes_extras ?? null,
        balanca_dispensada: input.balanca_dispensada ?? false,
        obs_por_conta: input.obs_por_conta ?? null,
        foto_principal_url: input.foto_principal_url ?? null,
        numero_base: numero,
      }
      // Tenta inserir; se ainda assim der duplicate (race rara), incrementa e tenta de novo
      let lastErr: any = null
      for (let r = 0; r < 5; r++) {
        const tryPayload = { ...payload, numero, sequencial }
        const { data, error } = await supabase
          .from('orcamentos_gerados')
          .insert(tryPayload)
          .select()
          .single()
        if (!error) return data as OrcamentoGerado
        lastErr = error
        const isDup = String(error.message || '').toLowerCase().includes('duplicate') ||
                       String(error.code || '') === '23505'
        if (!isDup) throw error
        sequencial += 1
        numero = `${ano} - ${String(sequencial).padStart(4, '0')}`
      }
      throw lastErr || new Error('Não foi possível gerar número único')
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos-gerados'] })
      qc.invalidateQueries({ queryKey: ['orcamento-clientes'] })
    },
  })
}

// Cria ALT (alteração) de um orçamento existente. Mantém numero_base do pai,
// incrementa versao_alt (ALT1, ALT2...) e gera numero como "2026 - 0844-ALT1".
export function useCriarAlteracao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: CriarOrcamentoInput & { parent_id: number; parent_numero: string; parent_numero_base: string }): Promise<OrcamentoGerado> => {
      const { parent_id, parent_numero, parent_numero_base, numero_override: _no, ...rest } = input as any
      void _no

      // Busca a maior versao_alt existente para esse parent
      const { data: existentes } = await supabase
        .from('orcamentos_gerados')
        .select('versao_alt')
        .eq('parent_id', parent_id)
        .order('versao_alt', { ascending: false })
        .limit(1)
      const maxAlt = existentes?.[0]?.versao_alt ?? 0
      const nextAlt = maxAlt + 1

      // Issue #13: data_emissao da ALT herda do pedido original (data do pedido),
      // não usa a data de hoje (data da venda). ALT é alteração do MESMO pedido,
      // então a data do pedido se mantém — só muda quando vendemos um pedido novo.
      const { data: parentRow } = await supabase
        .from('orcamentos_gerados')
        .select('data_emissao')
        .eq('id', parent_id)
        .single()
      const dataEmissaoPedido = parentRow?.data_emissao ?? new Date().toISOString().split('T')[0]

      // Numero base (sem -ALTx) é sempre o do pai original
      const numeroBase = parent_numero_base || parent_numero
      const numero = `${numeroBase}-ALT${nextAlt}`

      // Cria/atualiza cliente se tiver nome
      let cliente_id = rest.cliente_id ?? null
      if (!cliente_id && rest.cliente_nome?.trim()) {
        const { data: cli } = await supabase
          .from('orcamento_clientes')
          .insert({
            nome: rest.cliente_nome.trim(),
            ac: rest.cliente_dados?.ac ?? null,
            fone: rest.cliente_dados?.fone ?? null,
            cidade: rest.cliente_dados?.cidade ?? null,
            bairro: rest.cliente_dados?.bairro ?? null,
            endereco: rest.cliente_dados?.endereco ?? null,
            cep: rest.cliente_dados?.cep ?? null,
            cnpj: rest.cliente_dados?.cnpj ?? null,
            ie: rest.cliente_dados?.ie ?? null,
            email: rest.cliente_dados?.email ?? null,
          })
          .select('id')
          .single()
        cliente_id = cli?.id ?? null
      }

      // Usa ano/sequencial do pai (ALTs não consomem sequencial novo)
      // Extrai ano do numero base (ex: "2026 - 0844" → 2026)
      const anoMatch = numeroBase.match(/^(\d{4})/)
      const ano = anoMatch ? Number(anoMatch[1]) : new Date().getFullYear()

      // Fix #21: sufixa voltagem nos nomes dos itens (quando há motores).
      const itensComVoltagemAlt = suffixVoltagemNosItens(rest.itens, rest.voltagem, rest.motores)

      const payload = {
        numero,
        ano,
        sequencial: 0, // ALTs não usam sequencial real
        data_emissao: dataEmissaoPedido,
        vendedor_nome: rest.vendedor_nome,
        vendedor_id: rest.vendedor_id ?? null,
        cliente_id,
        cliente_nome: rest.cliente_nome?.trim() ?? '',
        cliente_dados: rest.cliente_dados ?? {},
        modelo_id: rest.modelo_id ?? null,
        modelo_basename: rest.modelo_basename ?? null,
        voltagem: rest.voltagem,
        itens: itensComVoltagemAlt,
        acessorios: rest.acessorios ?? null,
        motores: rest.motores,
        total_equipamentos: rest.total_equipamentos,
        total_motores: rest.total_motores,
        total_proposta: rest.total_proposta,
        observacoes: rest.observacoes ?? null,
        forma_pagamento: rest.forma_pagamento ?? null,
        prazo_entrega: rest.prazo_entrega ?? null,
        status: rest.status ?? 'rascunho',
        componentes_extras: rest.componentes_extras ?? null,
        balanca_dispensada: rest.balanca_dispensada ?? false,
        obs_por_conta: rest.obs_por_conta ?? null,
        foto_principal_url: rest.foto_principal_url ?? null,
        parent_id,
        versao_alt: nextAlt,
        numero_base: numeroBase,
      }
      const { data, error } = await supabase
        .from('orcamentos_gerados')
        .insert(payload)
        .select()
        .single()
      if (error) throw new Error(`Falha criar alteração: ${error.message}`)
      return data as OrcamentoGerado
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['orcamentos-gerados'] })
      qc.invalidateQueries({ queryKey: ['orcamento-clientes'] })
      qc.invalidateQueries({ queryKey: ['orcamento-gerado'] })
    },
  })
}
