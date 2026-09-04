// Ponte entre as telas portadas do controle.branorte.com e o auth REAL do CRM.
//
// POR QUE ISSO EXISTE (não é boilerplate):
// O controle.branorte.com autentica em localStorage — `isAuthenticated: 'true'`, role e
// usuário gravados no navegador, senha conferida por edge function. Quem editar o
// localStorage entra como admin. O banco de lá também está aberto pra anon
// (ver memória `reference_branorte_controle_kfucu_banco_aberto`).
//
// Esse AuthContext NÃO foi portado de propósito. Trazê-lo junto importaria a falha pra
// dentro do CRM. No lugar dele, este shim expõe a MESMA interface que os arquivos portados
// consomem, mas alimentada pela sessão Supabase de verdade do CRM (JWT + user_profiles +
// approved_at, checado em App.tsx).
//
// O acoplamento real era mínimo — as telas só usavam `logout` (nos headers, que aqui viram
// o Layout do CRM). O resto vem do formulário, não do auth. Por isso o shim cabe em 30 linhas.
import { useAuth as useCrmAuth } from '@/hooks/useAuth'

export interface PedidoVendaAuth {
  /** Sai da sessão do CRM (Supabase signOut), não do localStorage do controle. */
  logout: () => Promise<void>
  /** Nome de exibição do usuário logado no CRM — usado como sugestão de vendedor. */
  vendedorNome: string | null
  /** Papel no CRM. Não é o papel do controle: lá era 'admin' | 'vendedor' | 'user'. */
  userRole: string | null
  isAuthenticated: boolean
}

export function useAuth(): PedidoVendaAuth {
  const { signOut, profile, session } = useCrmAuth()
  return {
    logout: signOut,
    vendedorNome: profile?.display_name ?? null,
    userRole: profile?.role ?? null,
    isAuthenticated: Boolean(session),
  }
}
