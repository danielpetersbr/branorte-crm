import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

export interface OrcamentoItem {
  letra: string         // A, B, C...
  qtd: number
  nome: string
  specs: string[]
  valor: number
}

export interface OrcamentoAcessorios {
  items: string[]
  valor: number
}

export interface OrcamentoMotor {
  cv: number
  polos: number
  valor: number
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
  ativo: boolean
}

export interface ClienteDados {
  ac?: string
  fone?: string
  cidade?: string
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
  observacoes: string | null
  status: 'rascunho' | 'enviado' | 'aprovado' | 'perdido'
  pdf_url: string | null
  enviado_em: string | null
  created_at: string
  updated_at: string
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
    queryKey: ['orcamento-modelos'],
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
    staleTime: 60 * 60 * 1000,  // 1h — catalogo muda raramente
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
        .limit(100)
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
  const { data, error } = await supabase.rpc('proximo_orcamento_sequencial', { p_ano: ano })
  if (error) throw error
  const seq = Number(data) || 1
  return {
    ano,
    sequencial: seq,
    numero: `${ano} - ${String(seq).padStart(4, '0')}`,
  }
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

      // Resolve conflito: se numero ja existe, incrementa ate achar livre
      for (let tentativa = 0; tentativa < 50; tentativa++) {
        const { data: existente } = await supabase
          .from('orcamentos_gerados')
          .select('id')
          .eq('numero', numero)
          .maybeSingle()
        if (!existente) break
        sequencial += 1
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
        itens: input.itens,
        acessorios: input.acessorios,
        motores: input.motores,
        total_equipamentos: input.total_equipamentos,
        total_motores: input.total_motores,
        total_proposta: input.total_proposta,
        observacoes: input.observacoes ?? null,
        forma_pagamento: input.forma_pagamento ?? null,
        prazo_entrega: input.prazo_entrega ?? null,
        status: input.status ?? 'rascunho',
      }
      // Tenta inserir; se ainda assim der duplicate (race), incrementa e tenta de novo
      let lastErr: any = null
      for (let r = 0; r < 30; r++) {
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
