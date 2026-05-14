import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Analytics } from '@/pages/Analytics'
import { Contacts } from '@/pages/Contacts'
import { Assign } from '@/pages/Assign'
import { Orcamentos } from '@/pages/Orcamentos'
import { Vendidos } from '@/pages/Vendidos'
import { Atendimentos } from '@/pages/Atendimentos'
import { Funil } from '@/pages/Funil'
import { FunilRelatorio } from '@/pages/FunilRelatorio'
import { EtiquetasZap } from '@/pages/EtiquetasZap'
import { EtiquetasZapGraficos } from '@/pages/EtiquetasZapGraficos'
import { PainelEtiquetas } from '@/pages/PainelEtiquetas'
import { OrcamentoBuilder } from '@/pages/OrcamentoBuilder'
import { OrcamentoMontar } from '@/pages/OrcamentoMontar'
import { CatalogoAdmin } from '@/pages/CatalogoAdmin'
import { AtividadeDiaria } from '@/pages/AtividadeDiaria'
import { Projeto } from '@/pages/Projeto'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { Pendente } from '@/pages/Pendente'
import { AdminUsuarios } from '@/pages/AdminUsuarios'
import { Perfil } from '@/pages/Perfil'
import { Disparos } from '@/pages/Disparos'
import { MotoresAdmin } from '@/pages/MotoresAdmin'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { PageLoading } from '@/components/ui/LoadingSpinner'

// Loga TODO erro de query/mutation no console. Evita falha silenciosa.
// Erros visuais aparecem no SyncIndicator da Atendimentos (e outras páginas podem opt-in).
const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => {
      const key = JSON.stringify(query.queryKey)
      // eslint-disable-next-line no-console
      console.error('[rq:query]', key, error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _vars, _ctx, mutation) => {
      const key = JSON.stringify(mutation.options.mutationKey ?? 'unknown')
      // eslint-disable-next-line no-console
      console.error('[rq:mutation]', key, error)
    },
  }),
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

// Log auxiliar verbose: timestamps de fetch das queries principais.
// Ativar via `localStorage.setItem('debug-rq','1')` no console e recarregar.
if (typeof window !== 'undefined' && window.localStorage?.getItem('debug-rq') === '1') {
  queryClient.getQueryCache().subscribe(event => {
    if (event.type === 'updated' && event.action?.type === 'success') {
      // eslint-disable-next-line no-console
      console.log(`[rq] ${new Date().toISOString().slice(11, 19)} ${JSON.stringify(event.query.queryKey)}`)
    }
  })
}

function AppRoutes() {
  const { session, profile, loading } = useAuth()
  const loc = useLocation()

  if (loading) return <PageLoading />

  // Não logado → /login (exceto /signup)
  if (!session) {
    if (loc.pathname === '/signup') {
      return <Signup />
    }
    if (loc.pathname === '/login') {
      return <Login />
    }
    return <Navigate to="/login" replace state={{ from: loc.pathname }} />
  }

  // Logado mas sem profile aprovado → /pendente
  if (!profile || !profile.approved_at || profile.role === 'pending' || profile.role === 'rejected') {
    return <Pendente />
  }

  // Aprovado → app
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/contatos" element={<Contacts />} />
        <Route path="/atribuir" element={<Assign />} />
        <Route path="/orcamentos" element={<Orcamentos />} />
        <Route path="/orcamentos/lista" element={<Orcamentos />} />
        <Route path="/orcamentos/novo" element={<OrcamentoBuilder />} />
        <Route path="/orcamentos/montar" element={<OrcamentoMontar />} />
        <Route path="/orcamentos/catalogo-admin" element={<CatalogoAdmin />} />
        <Route path="/orcamentos/motores" element={<MotoresAdmin />} />
        <Route path="/vendidos" element={<Vendidos />} />
        <Route path="/atendimentos" element={<Atendimentos />} />
        <Route path="/funil" element={<Funil />} />
        <Route path="/funil/relatorio" element={<FunilRelatorio />} />
        <Route path="/etiquetas-zap" element={<EtiquetasZap />} />
        <Route path="/etiquetas-zap/graficos" element={<EtiquetasZapGraficos />} />
        <Route path="/etiquetas-zap/painel" element={<PainelEtiquetas />} />
        <Route path="/atividade-diaria" element={<AtividadeDiaria />} />
        <Route path="/projeto" element={<Projeto />} />
        <Route path="/perfil" element={<Perfil />} />
        {profile.role === 'admin' && (
          <Route path="/disparos" element={<Disparos />} />
        )}
        {profile.role === 'admin' && (
          <Route path="/admin/usuarios" element={<AdminUsuarios />} />
        )}
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
