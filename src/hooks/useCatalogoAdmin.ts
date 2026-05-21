import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import type { CatalogoItem } from './useCatalogo'

// Item do catálogo com todos os campos de curadoria.
// Quando `is_virtual=true`, o registro veio só de precos_branorte e ainda não tem
// catalogo_items próprio. id eh negativo (-preco_branorte_id) como sentinel pro UI;
// no primeiro save/upload, o sistema cria a row real e troca o id.
export interface CatalogoItemAdmin extends CatalogoItem {
  is_oficial: boolean
  descricao: string | null
  foto_url: string | null
  acessorios_relacionados_ids: number[]
  items_relacionados_ids: number[]
  notas_curadoria: string | null
  atualizado_por: string | null
  atualizado_em: string | null
  is_virtual?: boolean
}

const BUCKET_FOTOS = 'catalogo-fotos'

// Extrai modelo_id de notas_curadoria (ex: "modelo_id=42" → 42)
function extrairModeloId(notas: string | null | undefined): number | null {
  if (!notas) return null
  const match = notas.match(/^modelo_id=(\d+)/)
  return match ? Number(match[1]) : null
}

// Propaga foto_url e/ou valor de um catalogo_item para o orcamento_modelo vinculado.
// Chamada após qualquer mutação que altere foto_url ou valor de um item COMPACTA.
// Silenciosa: erros de propagação são logados mas NÃO bloqueiam o save principal.
async function propagarParaModeloVinculado(item: CatalogoItemAdmin): Promise<void> {
  const modeloId = extrairModeloId(item.notas_curadoria)
  if (!modeloId) return
  try {
    const updatePayload: Record<string, unknown> = {}
    // Sempre propaga foto (pode ser null = remoção)
    if ('foto_url' in item) {
      updatePayload.foto_url = item.foto_url
    }
    // Propaga total_equipamentos se valor mudou
    if (item.valor != null) {
      updatePayload.total_equipamentos = item.valor
    }
    if (Object.keys(updatePayload).length === 0) return
    await supabase
      .from('orcamento_modelos')
      .update(updatePayload)
      .eq('id', modeloId)
  } catch (err) {
    console.warn('[propagarParaModeloVinculado] Falha ao propagar para modelo', modeloId, err)
  }
}

// Helper: extrai path interno do bucket a partir de URL pública do Supabase Storage
export function extrairPathDaUrl(url: string): string | null {
  if (!url) return null
  const match = url.match(
    new RegExp(`/storage/v1/object/public/${BUCKET_FOTOS}/(.+)$`)
  )
  return match ? match[1] : null
}

// Constrói item virtual a partir de uma linha de precos_branorte (quando ela ainda
// não tem catalogo_items linkado). Usa id negativo como sentinel — UI mostra normal,
// mas no save/upload o hook cria a row real e troca o id.
function precoToVirtualItem(preco: {
  id: number
  categoria: string
  subcategoria: string | null
  descricao: string
  capacidade: string | null
  valor_equipamento: number | null
  motor_cv: number | null
  motor_polos: number | null
  observacoes: string | null
  ordem: number
}): CatalogoItemAdmin {
  return {
    id: -preco.id,
    categoria: preco.categoria,
    subcategoria: preco.subcategoria,
    nome_curto: preco.descricao,
    nome_completo: preco.descricao,
    specs: [],
    capacidade_kg: null,
    capacidade_litros: null,
    potencia_cv: preco.motor_cv,
    motor_padrao_cv: preco.motor_cv,
    motor_padrao_polos: preco.motor_polos,
    motor_padrao_qtd: 1,
    valor: preco.valor_equipamento ?? 0,
    imagem_url: null,
    ativo: true,
    ordem: preco.ordem,
    ocorrencias: 0,
    is_oficial: true, // vive em precos_branorte = é oficial por definição
    foto_url: null,
    descricao: preco.observacoes,
    acessorios_relacionados_ids: [],
    items_relacionados_ids: [],
    notas_curadoria: null,
    atualizado_por: null,
    atualizado_em: null,
    usa_inversor: false,
    funcao_opcoes: [],
    tamanho_codigo: null,
    ocultar_funcao_no_pdf: false,
    motor_id: null,
    preco_branorte_id: preco.id,
    is_virtual: true,
  }
}

// Lista todos os items orçáveis ESPELHANDO precos_branorte (fonte de verdade):
// - catalogo_items linkados a precos_branorte (foto + specs curadas)
// - virtuais pros precos_branorte sem catalogo_items ainda
// - catalogo_items "oficiais" sem link (produtos ad-hoc cadastrados pelo vendedor
//   mas ainda não migrados pra precos_branorte) — preserva fluxo de aprovação
//
// O que NÃO aparece: catalogo_items legacy sem link e sem is_oficial (lixo de
// OCR de orçamentos antigos). Esses são ~430 items que poluiriam o admin.
export function useCatalogoItemsAdmin() {
  return useQuery({
    queryKey: ['catalogo-items-admin'],
    queryFn: async (): Promise<CatalogoItemAdmin[]> => {
      const [itemsRes, precosRes] = await Promise.all([
        supabase
          .from('catalogo_items')
          .select('*')
          // Espelha precos_branorte: linkados OU oficiais (ad-hoc aguardando migração)
          .or('preco_branorte_id.not.is.null,is_oficial.eq.true')
          .order('is_oficial', { ascending: false })
          .order('ocorrencias', { ascending: false })
          .order('categoria', { ascending: true })
          .order('nome_curto', { ascending: true }),
        supabase
          .from('precos_branorte')
          .select('id, categoria, subcategoria, descricao, capacidade, valor_equipamento, motor_cv, motor_polos, observacoes, ordem')
          .eq('ativo', true),
      ])
      if (itemsRes.error) throw itemsRes.error
      if (precosRes.error) throw precosRes.error
      const items = (itemsRes.data ?? []) as CatalogoItemAdmin[]
      const precos = (precosRes.data ?? []) as Parameters<typeof precoToVirtualItem>[0][]

      const precosComLink = new Set(
        items.filter(i => i.preco_branorte_id != null).map(i => i.preco_branorte_id as number)
      )
      const virtuais: CatalogoItemAdmin[] = precos
        .filter(p => !precosComLink.has(p.id))
        .map(precoToVirtualItem)

      // Reais primeiro (curados), virtuais depois (sem foto/specs ainda)
      return [...items, ...virtuais]
    },
    staleTime: 30_000,
  })
}

// Helper interno: garante que o item tem row real em catalogo_items.
// Se for virtual (id < 0), faz INSERT linkando ao preco_branorte e retorna o id novo.
// Se já existir, retorna o id atual sem mexer.
async function garantirRowReal(
  id: number,
  baseUpdates: Partial<CatalogoItemAdmin> = {},
): Promise<number> {
  if (id > 0) return id
  // É virtual — preciso buscar a row de precos_branorte pra criar catalogo_items
  const precoId = -id
  const { data: preco, error: precoErr } = await supabase
    .from('precos_branorte')
    .select('id, categoria, subcategoria, descricao, valor_equipamento, motor_cv, motor_polos')
    .eq('id', precoId)
    .single()
  if (precoErr) throw precoErr
  const p = preco as {
    id: number
    categoria: string
    subcategoria: string | null
    descricao: string
    valor_equipamento: number | null
    motor_cv: number | null
    motor_polos: number | null
  }
  const payload = {
    categoria: p.categoria,
    subcategoria: p.subcategoria,
    nome_curto: p.descricao,
    nome_completo: p.descricao,
    valor: p.valor_equipamento ?? 0,
    motor_padrao_cv: p.motor_cv,
    motor_padrao_polos: p.motor_polos,
    motor_padrao_qtd: 1,
    preco_branorte_id: p.id,
    is_oficial: true,
    ativo: true,
    ocorrencias: 0,
    specs: [],
    ...baseUpdates,
    atualizado_em: new Date().toISOString(),
  }
  const { data: novo, error: insertErr } = await supabase
    .from('catalogo_items')
    .insert(payload)
    .select('id')
    .single()
  if (insertErr) throw insertErr
  return (novo as { id: number }).id
}

// Atualiza qualquer subset de campos do item. Se for virtual, cria a row real
// embutindo os updates no INSERT inicial (em vez de INSERT vazio + UPDATE depois).
export function useAtualizarItemCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      updates,
    }: {
      id: number
      updates: Partial<CatalogoItemAdmin>
    }) => {
      // Remove campo sentinel antes de mandar pro DB (não existe na tabela)
      const { is_virtual: _isv, ...cleanUpdates } = updates as Partial<CatalogoItemAdmin> & { is_virtual?: boolean }
      void _isv
      if (id < 0) {
        // Virtual → cria row real com todos os updates de uma vez
        const newId = await garantirRowReal(id, cleanUpdates)
        const { data, error } = await supabase
          .from('catalogo_items')
          .select('*')
          .eq('id', newId)
          .single()
        if (error) throw error
        const saved = data as CatalogoItemAdmin
        await propagarParaModeloVinculado(saved)
        return saved
      }
      const payload = {
        ...cleanUpdates,
        atualizado_em: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from('catalogo_items')
        .update(payload)
        .eq('id', id)
        .select('*')
        .single()
      if (error) throw error
      const saved = data as CatalogoItemAdmin
      // Propaga foto/valor para orcamento_modelo vinculado (se houver)
      await propagarParaModeloVinculado(saved)
      return saved
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
      queryClient.invalidateQueries({ queryKey: ['orcamento-modelos-v3'] })
    },
  })
}

// Cria item novo (INSERT) — usado pelo modo "novo item" no admin (fora do fluxo virtual)
export function useCriarItemCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (novo: Partial<CatalogoItemAdmin>) => {
      const { is_virtual: _isv, ...clean } = novo as Partial<CatalogoItemAdmin> & { is_virtual?: boolean }
      void _isv
      const payload = {
        ...clean,
        ativo: true,
        ocorrencias: 0,
        atualizado_em: new Date().toISOString(),
      }
      const { data, error } = await supabase
        .from('catalogo_items')
        .insert(payload)
        .select('*')
        .single()
      if (error) throw error
      return data as CatalogoItemAdmin
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Toggle do flag "oficial". Virtual items já são oficiais (vivem em precos_branorte),
// mas se vendedor quiser desmarcar, o hook cria a row real com is_oficial=false.
export function useToggleOficialCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      is_oficial,
    }: {
      id: number
      is_oficial: boolean
    }) => {
      const realId = await garantirRowReal(id, { is_oficial })
      const { data, error } = await supabase
        .from('catalogo_items')
        .update({
          is_oficial,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', realId)
        .select('*')
        .single()
      if (error) throw error
      return data as CatalogoItemAdmin
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Soft delete: marca ativo=false. Em virtual, cria row real só pra desativar
// (preserva preco_branorte intacto — pra desativar lá, usar /orcamentos/precos).
export function useDeletarItemCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      const realId = await garantirRowReal(id, { ativo: false })
      const { data, error } = await supabase
        .from('catalogo_items')
        .update({
          ativo: false,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', realId)
        .select('*')
        .single()
      if (error) throw error
      return data as CatalogoItemAdmin
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
    },
  })
}

// Upload de foto: envia ao bucket, pega URL pública e atualiza foto_url do item.
// Pra items virtuais, cria a row real ANTES do upload (pra ter id real no path).
export function useUploadFotoCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      file,
    }: {
      id: number
      file: File
    }): Promise<{ url: string }> => {
      const realId = await garantirRowReal(id)
      const extFromName = file.name.includes('.')
        ? file.name.split('.').pop()
        : null
      const extFromType = file.type.split('/').pop()
      const ext = (extFromName || extFromType || 'jpg').toLowerCase()
      const timestamp = Date.now()
      const path = `items/${realId}-${timestamp}.${ext}`

      const { error: uploadError } = await supabase.storage
        .from(BUCKET_FOTOS)
        .upload(path, file, {
          upsert: true,
          contentType: file.type || undefined,
        })
      if (uploadError) throw uploadError

      const { data: publicData } = supabase.storage
        .from(BUCKET_FOTOS)
        .getPublicUrl(path)

      const url = publicData.publicUrl

      const { error: updateError } = await supabase
        .from('catalogo_items')
        .update({
          foto_url: url,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', realId)
      if (updateError) throw updateError

      // Propaga foto para orcamento_modelo vinculado (se houver)
      const { data: updated } = await supabase
        .from('catalogo_items')
        .select('notas_curadoria')
        .eq('id', realId)
        .single()
      if (updated) {
        const modeloId = extrairModeloId((updated as { notas_curadoria: string | null }).notas_curadoria)
        if (modeloId) {
          await supabase
            .from('orcamento_modelos')
            .update({ foto_url: url })
            .eq('id', modeloId)
            .then(({ error: propErr }) => {
              if (propErr) console.warn('[useUploadFotoCatalogo] Falha ao propagar foto para modelo', modeloId, propErr)
            })
        }
      }

      return { url }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
      queryClient.invalidateQueries({ queryKey: ['orcamento-modelos-v3'] })
    },
  })
}

// Remove foto: deleta do bucket e limpa foto_url. Virtual sem foto não faz nada.
export function useRemoverFotoCatalogo() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: number) => {
      if (id < 0) return { id } // virtual nunca tem foto
      const { data: item, error: fetchError } = await supabase
        .from('catalogo_items')
        .select('foto_url')
        .eq('id', id)
        .single()
      if (fetchError) throw fetchError

      const fotoUrl = (item as { foto_url: string | null } | null)?.foto_url
      if (fotoUrl) {
        const path = extrairPathDaUrl(fotoUrl)
        if (path) {
          const { error: removeError } = await supabase.storage
            .from(BUCKET_FOTOS)
            .remove([path])
          if (removeError) throw removeError
        }
      }

      const { error: updateError } = await supabase
        .from('catalogo_items')
        .update({
          foto_url: null,
          atualizado_em: new Date().toISOString(),
        })
        .eq('id', id)
      if (updateError) throw updateError

      // Propaga remoção de foto para orcamento_modelo vinculado
      const { data: cur } = await supabase
        .from('catalogo_items')
        .select('notas_curadoria')
        .eq('id', id)
        .single()
      if (cur) {
        const modeloId = extrairModeloId((cur as { notas_curadoria: string | null }).notas_curadoria)
        if (modeloId) {
          await supabase
            .from('orcamento_modelos')
            .update({ foto_url: null })
            .eq('id', modeloId)
            .then(({ error: propErr }) => {
              if (propErr) console.warn('[useRemoverFotoCatalogo] Falha ao propagar remoção para modelo', modeloId, propErr)
            })
        }
      }

      return { id }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items'] })
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
      queryClient.invalidateQueries({ queryKey: ['orcamento-modelos-v3'] })
    },
  })
}

// Estatísticas agregadas. Agora cruza precos_branorte (fonte de verdade pro total)
// com catalogo_items (curadoria de foto/specs). Gap = items orçáveis ainda sem foto.
export interface CatalogoStats {
  total: number
  oficiais: number
  pendentes: number
  com_foto: number
  com_motor: number
}

export function useStatsCatalogo() {
  return useQuery({
    queryKey: ['catalogo-stats'],
    queryFn: async (): Promise<CatalogoStats> => {
      // Stats coerentes com o que o admin mostra: precos_branorte + ad-hoc oficiais
      const [precosRes, adhocRes, comFotoLinkRes, comFotoAdhocRes, comMotorRes] = await Promise.all([
        supabase.from('precos_branorte').select('id', { count: 'exact', head: true }).eq('ativo', true),
        supabase.from('catalogo_items').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('is_oficial', true).is('preco_branorte_id', null),
        supabase.from('catalogo_items').select('id', { count: 'exact', head: true })
          .eq('ativo', true).not('preco_branorte_id', 'is', null).not('foto_url', 'is', null),
        supabase.from('catalogo_items').select('id', { count: 'exact', head: true })
          .eq('ativo', true).eq('is_oficial', true).is('preco_branorte_id', null).not('foto_url', 'is', null),
        supabase.from('precos_branorte').select('id', { count: 'exact', head: true }).eq('ativo', true).not('motor_cv', 'is', null),
      ])

      if (precosRes.error) throw precosRes.error
      if (adhocRes.error) throw adhocRes.error
      if (comFotoLinkRes.error) throw comFotoLinkRes.error
      if (comFotoAdhocRes.error) throw comFotoAdhocRes.error
      if (comMotorRes.error) throw comMotorRes.error

      const precos = precosRes.count ?? 0
      const adhoc = adhocRes.count ?? 0
      const com_foto = (comFotoLinkRes.count ?? 0) + (comFotoAdhocRes.count ?? 0)
      const com_motor = comMotorRes.count ?? 0
      const total = precos + adhoc
      // "Oficial" = curado (tem foto). "Pendente" = falta curar (sem foto).
      const oficiais = com_foto
      const pendentes = Math.max(total - com_foto, 0)

      return { total, oficiais, pendentes, com_foto, com_motor }
    },
    staleTime: 30_000,
  })
}
