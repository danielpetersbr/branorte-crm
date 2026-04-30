import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Analytics } from '@/pages/Analytics'
import { Contacts } from '@/pages/Contacts'
import { Assign } from '@/pages/Assign'
import { Orcamentos } from '@/pages/Orcamentos'
import { Vendidos } from '@/pages/Vendidos'
import { Atendimentos } from '@/pages/Atendimentos'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { Pendente } from '@/pages/Pendente'
import { AdminUsuarios } from '@/pages/AdminUsuarios'
import { Perfil } from '@/pages/Perfil'
import { useAuth } from '@/hooks/useAuth'
import { PageLoading } from '@/components/ui/LoadingSpinner'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
})

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
        <Route path="/vendidos" element={<Vendidos />} />
        <Route path="/atendimentos" element={<Atendimentos />} />
        <Route path="/perfil" element={<Perfil />} />
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
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  )
}
