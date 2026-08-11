import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// ============================================================================
// ARENA DE TESTE DA IA ATENDENTE (/ia-teste)
//
// O vendedor conversa com a MESMA IA que atende no WhatsApp dele — mesma persona,
// mesma base de conhecimento, mesmos textos canned, mesmos guards. O que muda é só
// o `chat_id`: com o prefixo `teste:`, a edge troca o client do Supabase por um
// proxy e nenhuma escrita chega em produção (não cria lead, não enfileira WhatsApp,
// não suja a auditoria). Ver supabase/functions/ia-atendente/index.ts § MODO SANDBOX.
//
// Por que não simular por fora: ~25% das respostas dela são texto canned no código
// da edge, não do modelo. Um clone divergiria no primeiro dia e o vendedor estaria
// avaliando uma IA que não existe.
// ============================================================================

const IA_EDGE_URL = 'https://flwbeevtvjiouxdjmziv.supabase.co/functions/v1/ia-atendente'
const IA_EDGE_SECRET = 'branorte-wa-sync-2026'

export type PapelMsg = 'cliente' | 'ia' | 'sistema'
export type FeedbackStatus = 'novo' | 'analisando' | 'resolvido' | 'rejeitado'
export type FeedbackPrioridade = 'baixa' | 'media' | 'alta' | 'critica'

export interface MidiaIa { tipo?: string; url: string; titulo?: string }

export interface AcoesIa {
  etiqueta?: string | null
  desligada?: boolean
  marcar_nao_lida?: boolean
}

export interface MsgTeste {
  id: number
  chat_id: string
  papel: PapelMsg
  texto: string
  midias: MidiaIa[] | null
  acoes: AcoesIa | null
  payload: Record<string, unknown> | null
  t: number
  created_at: string
}

export interface SessaoTeste {
  chat_id: string
  vendedor_nome: string
  nome_contato: string | null
  ativo: boolean
  respostas_hoje: number
  dados_coletados: Record<string, unknown>
  temperatura: string | null
  motivo_desligamento: string | null
  criado_em: string
  encerrada_em: string | null
}

export interface ApontamentoIa {
  id: number
  chat_id: string | null
  mensagem_id: number | null
  vendedor_nome: string
  categoria: string
  comentario: string | null
  esperado: string | null
  contexto: { conversa?: Array<{ de: string; txt: string }>; texto_ia?: string; dados?: Record<string, unknown> } | null
  status: FeedbackStatus
  prioridade: FeedbackPrioridade | null
  resposta_time: string | null
  created_at: string
  resolvido_em: string | null
}

// As categorias saem das falhas que os vendedores já reportaram no grupo
// "IA Branorte Melhorias" — repetição, modelo errado, invenção, tom.
// Categoria fechada (e não texto livre) é o que permite ranquear onde ela mais erra.
export const CATEGORIAS = [
  { id: 'repetiu', label: 'Repetiu / perguntou o que eu já disse' },
  { id: 'modelo_errado', label: 'Ofereceu o modelo errado' },
  { id: 'inventou', label: 'Inventou informação / prometeu o que não pode' },
  { id: 'nao_entendeu', label: 'Não entendeu o que o cliente quis' },
  { id: 'tom', label: 'Tom / jeito de falar' },
  { id: 'midia', label: 'Mandou mídia errada ou não mandou' },
  { id: 'passou_cedo', label: 'Passou o bastão cedo demais' },
  { id: 'passou_tarde', label: 'Ficou enrolando, devia ter passado' },
  { id: 'preco', label: 'Errou no assunto preço/pagamento' },
  { id: 'outro', label: 'Outro' },
] as const

// ─── Sessão ────────────────────────────────────────────────────────────────

export function useSessaoAtiva(userId: string | null) {
  return useQuery({
    queryKey: ['ia-teste-sessao', userId],
    enabled: !!userId,
    queryFn: async (): Promise<SessaoTeste | null> => {
      const { data, error } = await supabase
        .from('ia_teste_sessoes')
        .select('chat_id, vendedor_nome, nome_contato, ativo, respostas_hoje, dados_coletados, temperatura, motivo_desligamento, criado_em, encerrada_em')
        .eq('criado_por', userId)
        .is('encerrada_em', null)
        .order('criado_em', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (error) throw error
      return (data as SessaoTeste) ?? null
    },
  })
}

// Reiniciar = sessão NOVA, não limpeza da atual. A edge guarda estado em várias
// colunas (dados_coletados, respostas_hoje, temperatura, ativo, motivo) e limpar
// "quase tudo" deixa resíduo que contamina o teste seguinte — foi por isso que a
// memória limpa virou um chat novo em vez de um UPDATE.
export function useNovaSessao() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { userId: string; vendedorNome: string; nomeContato: string }): Promise<SessaoTeste> => {
      await supabase
        .from('ia_teste_sessoes')
        .update({ encerrada_em: new Date().toISOString(), ativo: false })
        .eq('criado_por', input.userId)
        .is('encerrada_em', null)

      const chatId = 'teste:' + crypto.randomUUID()
      const { data, error } = await supabase
        .from('ia_teste_sessoes')
        .insert({
          chat_id: chatId,
          vendedor_nome: input.vendedorNome,
          nome_contato: input.nomeContato || 'Cliente',
          criado_por: input.userId,
          // `origem: 'vendedor'` é o que faz a edge tratar como decisão explícita e
          // não exigir a etiqueta PROSPECÇÃO (que um chat de teste nunca terá).
          origem: 'vendedor',
        })
        .select('chat_id, vendedor_nome, nome_contato, ativo, respostas_hoje, dados_coletados, temperatura, motivo_desligamento, criado_em, encerrada_em')
        .single()
      if (error) throw error
      return data as SessaoTeste
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia-teste-sessao'] })
      qc.invalidateQueries({ queryKey: ['ia-teste-msgs'] })
    },
  })
}

// Depois do bastão a IA desliga sozinha (é o comportamento real). Religar existe
// pra testar o que vem DEPOIS do handoff sem perder a conversa toda.
export function useReligarIa() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (chatId: string) => {
      const { error } = await supabase
        .from('ia_teste_sessoes')
        .update({ ativo: true, motivo_desligamento: null })
        .eq('chat_id', chatId)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ia-teste-sessao'] }),
  })
}

// ─── Conversa ──────────────────────────────────────────────────────────────

export function useMensagens(chatId: string | null) {
  return useQuery({
    queryKey: ['ia-teste-msgs', chatId],
    enabled: !!chatId,
    queryFn: async (): Promise<MsgTeste[]> => {
      const { data, error } = await supabase
        .from('ia_teste_mensagens')
        .select('*')
        .eq('chat_id', chatId)
        .order('t', { ascending: true })
        .order('id', { ascending: true })
      if (error) throw error
      return (data ?? []) as MsgTeste[]
    },
  })
}

export function useEnviarTurno() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      chatId: string
      vendedorNome: string
      nomeContato: string
      texto: string
      historico: MsgTeste[]
    }) => {
      // `t` em SEGUNDOS e sempre crescente: é assim que a edge ordena as mensagens
      // e decide qual é a última do cliente. Duas no mesmo segundo embaralhariam.
      const ultimo = input.historico.length ? Number(input.historico[input.historico.length - 1].t) : 0
      const agora = Math.max(Math.floor(Date.now() / 1000), ultimo + 1)

      const { data: minha, error: e1 } = await supabase
        .from('ia_teste_mensagens')
        .insert({ chat_id: input.chatId, papel: 'cliente', texto: input.texto, t: agora })
        .select('*')
        .single()
      if (e1) throw e1

      const mensagensChat = [...input.historico, minha as MsgTeste]
        .filter(m => m.papel !== 'sistema')
        .map(m => ({ body: m.texto, fromMe: m.papel === 'ia', t: Number(m.t), type: 'chat' }))

      const r = await fetch(IA_EDGE_URL, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${IA_EDGE_SECRET}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'responder',
          chat_id: input.chatId,
          vendedor_nome: input.vendedorNome,
          nome_contato: input.nomeContato,
          mensagens_chat: mensagensChat,
        }),
      })
      const resp = await r.json().catch(() => ({ ok: false, error: 'resposta ilegivel da edge' }))

      // A edge responde 200 com {ok:false, skip} quando um guard barrou. Isso NÃO é
      // erro: é a IA se calando — e é exatamente o que o vendedor precisa enxergar,
      // porque no WhatsApp esse silêncio é invisível pra ele.
      const virouTexto = resp?.ok && typeof resp.texto === 'string' && resp.texto.trim()
      const { error: e2 } = await supabase.from('ia_teste_mensagens').insert({
        chat_id: input.chatId,
        papel: virouTexto ? 'ia' : 'sistema',
        texto: virouTexto ? resp.texto : explicarSilencio(resp),
        midias: virouTexto && Array.isArray(resp.midias) ? resp.midias : (virouTexto && resp.midia ? [resp.midia] : null),
        acoes: virouTexto ? (resp.acoes ?? null) : null,
        payload: resp ?? null,
        t: agora + 1,
      })
      if (e2) throw e2
      return resp
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ia-teste-msgs'] })
      qc.invalidateQueries({ queryKey: ['ia-teste-sessao'] })
    },
  })
}

// Traduz o motivo técnico do skip pra linguagem de vendedor. Sem isso a tela
// mostraria "skip: ultima_nao_e_do_cliente" e ninguém saberia o que fazer.
function explicarSilencio(resp: { skip?: string; error?: string; ok?: boolean }): string {
  const m: Record<string, string> = {
    ia_desligada: 'Ela parou de responder aqui — passou o bastão ou a conversa encerrou. É o comportamento real: no WhatsApp, o atendimento seria seu a partir daqui. Use "Religar a IA" pra continuar testando, ou reinicie.',
    cap_diario: 'Bateu o teto de respostas desta conversa de teste. Reinicie pra continuar.',
    resposta_repetida: 'Ela ia repetir palavra por palavra a mesma resposta anterior, e a trava anti-repetição segurou. No WhatsApp o cliente não receberia nada.',
    ultima_nao_e_do_cliente: 'Ela só responde depois que o cliente fala. Manda uma mensagem como cliente.',
    sem_mensagem_real: 'Não encontrou mensagem de cliente pra responder.',
    chat_bloqueado: 'Esta conversa está bloqueada.',
    outro_vendedor: 'Esta conversa de teste é de outro vendedor.',
    fora_prospeccao: 'Guardrail de PROSPECÇÃO barrou.',
    etiqueta_indeterminada: 'Guardrail de etiqueta barrou.',
  }
  if (resp?.skip && m[resp.skip]) return m[resp.skip]
  if (resp?.skip) return `Ela não respondeu (motivo técnico: ${resp.skip}).`
  if (resp?.error) return `Deu erro na IA: ${resp.error}`
  return 'Ela não respondeu e não disse por quê.'
}

// ─── Apontamentos ──────────────────────────────────────────────────────────

export function useApontar() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: {
      chatId: string
      mensagemId: number
      vendedorNome: string
      userId: string
      categoria: string
      comentario: string
      esperado: string
      contexto: ApontamentoIa['contexto']
    }) => {
      const { error } = await supabase.from('ia_teste_feedback').insert({
        chat_id: input.chatId,
        mensagem_id: input.mensagemId,
        vendedor_nome: input.vendedorNome,
        criado_por: input.userId,
        categoria: input.categoria,
        comentario: input.comentario || null,
        esperado: input.esperado || null,
        contexto: input.contexto,
      })
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ia-teste-apontamentos'] }),
  })
}

export function useApontamentos(status: FeedbackStatus | 'todos') {
  return useQuery({
    queryKey: ['ia-teste-apontamentos', status],
    queryFn: async (): Promise<ApontamentoIa[]> => {
      let q = supabase.from('ia_teste_feedback').select('*').order('created_at', { ascending: false }).limit(300)
      if (status !== 'todos') q = q.eq('status', status)
      const { data, error } = await q
      if (error) throw error
      return (data ?? []) as ApontamentoIa[]
    },
  })
}

export function useApontamentosDaConversa(chatId: string | null) {
  return useQuery({
    queryKey: ['ia-teste-apontamentos-chat', chatId],
    enabled: !!chatId,
    queryFn: async (): Promise<ApontamentoIa[]> => {
      const { data, error } = await supabase.from('ia_teste_feedback').select('*').eq('chat_id', chatId)
      if (error) throw error
      return (data ?? []) as ApontamentoIa[]
    },
  })
}

export function useAtualizarApontamento() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: number; patch: Partial<Pick<ApontamentoIa, 'status' | 'prioridade' | 'resposta_time'>> }) => {
      const patch: Record<string, unknown> = { ...input.patch, atualizado_em: new Date().toISOString() }
      if (input.patch.status === 'resolvido' || input.patch.status === 'rejeitado') patch.resolvido_em = new Date().toISOString()
      const { error } = await supabase.from('ia_teste_feedback').update(patch).eq('id', input.id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ia-teste-apontamentos'] }),
  })
}
