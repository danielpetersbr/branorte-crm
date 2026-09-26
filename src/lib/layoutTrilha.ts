// Trilha do que o vendedor faz no Fazedor de Layout (/projeto-3d).
// Grava em public.layout_atividade — cada um só insere a PRÓPRIA atividade (RLS),
// e só admin lê (a tela /admin/layout-atividade). Falha em silêncio: registrar a
// atividade nunca pode atrapalhar o vendedor a trabalhar.
import { supabase } from '@/lib/supabase'

export type AcaoLayout = 'entrou' | 'abriu' | 'salvou' | 'saiu'

/** Lista de equipamentos (catalogId) presentes no projeto — o retrato do que ele montou. */
export function extrairEquipamentos(project: unknown): string[] {
  try {
    const floors = (project as { floors?: Array<{ furniture?: Array<{ catalogId?: string }> }> })?.floors ?? []
    const ids: string[] = []
    for (const f of floors) for (const it of f.furniture ?? []) if (it?.catalogId) ids.push(it.catalogId)
    return ids
  } catch {
    return []
  }
}

interface RegistroLayout {
  userId: string | null
  email?: string | null
  acao: AcaoLayout
  projetoId?: string | null
  projetoNome?: string | null
  project?: unknown
  thumb?: string | null
}

export function registrarAtividadeLayout(r: RegistroLayout): void {
  if (!r.userId) return
  const equipamentos = r.acao === 'salvou' && r.project ? extrairEquipamentos(r.project) : null
  const linha = {
    user_id: r.userId,
    email: r.email ?? null,
    acao: r.acao,
    projeto_id: r.projetoId ?? null,
    projeto_nome: r.projetoNome ?? null,
    qtd_equip: equipamentos ? equipamentos.length : null,
    equipamentos: equipamentos ? equipamentos : null,
    // Miniatura só no salvamento; corta se vier gigante (o banco aguenta, mas não precisa).
    thumb: r.acao === 'salvou' && typeof r.thumb === 'string' ? r.thumb.slice(0, 400_000) : null,
  }
  void supabase.from('layout_atividade').insert(linha).then(({ error }) => {
    if (error) console.debug('[layoutTrilha] não registrou', error.message)
  })
}
