import { useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

// A foto pertence ao pacote selecionado no orçamento. Alterar a imagem nunca
// regrava valores, motores, itens ou o estado ativo do modelo.
export function useFotoModeloCatalogo(modeloId: number) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (file: File | null): Promise<string | null> => {
      let fotoUrl: string | null = null
      if (file) {
        const extensoes: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }
        const extensao = extensoes[file.type]
        if (!extensao || file.size > 5 * 1024 * 1024) throw new Error('Escolha uma foto JPG, PNG ou WEBP de até 5 MB.')
        const path = `modelos/${modeloId}-${crypto.randomUUID()}.${extensao}`
        const { error } = await supabase.storage.from('catalogo-fotos').upload(path, file, { contentType: file.type })
        if (error) throw error
        fotoUrl = supabase.storage.from('catalogo-fotos').getPublicUrl(path).data.publicUrl
      }
      const { error } = await supabase.from('orcamento_modelos')
        .update({ foto_url: fotoUrl }).eq('id', modeloId).select('id').single()
      if (error) throw error
      return fotoUrl
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['catalogo-items-admin'] })
      queryClient.invalidateQueries({ queryKey: ['orcamento-modelos-v3'] })
    },
  })
}
