// Client Supabase do CONTROLE (projeto kfucuvwrnwrkshxpsmyq — controle.branorte.com).
//
// O subsistema de Pedido de Venda foi portado de controle.branorte.com pra dentro do CRM,
// mas os DADOS continuam morando no banco do controle: `pedidos_venda`, `producao_pedidos`,
// o bucket `pedidos` e as edge functions (extrair-orcamento, gerar-pedido, gerar-pedido-pdf,
// gerar-parcelas, gerar-pedido-retroativo, enviar-docx-app2) são todos de lá. Enquanto o
// controle seguir no ar em paralelo, as duas telas gravam no MESMO lugar — é isso que
// permite migrar sem parar a operação.
//
// ⚠️ persistSession: false é OBRIGATÓRIO.
// O CRM já tem um GoTrueClient (src/lib/supabase.ts) usando o localStorage. Um segundo
// client persistindo sessão no mesmo storage briga pela chave e derruba o login do CRM.
// Aqui não existe usuário: todo request sai como `anon` do projeto do controle.
//
// ⚠️ A anon key abaixo NÃO é segredo: é a mesma que já está no bundle público de
// controle.branorte.com e no api/controle-criar-pedido.ts deste repo (role=anon,
// ref=kfucuvwrnwrkshxpsmyq, exp 2075). Pode ser sobrescrita por env sem rebuild de código.
//
// Quem trava o acesso é o CRM: a rota só abre pra usuário logado e aprovado (App.tsx).
// A RLS do controle é permissiva pra anon — ver memória `reference_branorte_controle_kfucu_banco_aberto`.
// Se um dia a RLS de lá apertar, o caminho é rotear por /api/ com service key no servidor,
// como já faz o api/controle-criar-pedido.ts.
import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const CONTROLE_URL =
  import.meta.env.VITE_CONTROLE_SUPABASE_URL || 'https://kfucuvwrnwrkshxpsmyq.supabase.co'

const CONTROLE_ANON_KEY =
  import.meta.env.VITE_CONTROLE_ANON_KEY ||
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtmdWN1dndybndya3NoeHBzbXlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjAwMzAwODgsImV4cCI6MjA3NTYwNjA4OH0.Oe0otpf1l_Ssbi8FQJlbcDRNtW_j_IRY5EMnr8dNYNE'

// Nome `supabase` de propósito: os arquivos portados importam
// `import { supabase } from "@/lib/controle-supabase/client"` sem precisar de renomeio,
// o que mantém o diff contra o repo de origem legível.
export const supabase = createClient<Database>(CONTROLE_URL, CONTROLE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
})
