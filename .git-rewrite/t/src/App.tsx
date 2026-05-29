import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { lazy } from 'react'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { Atendimentos } from '@/pages/Atendimentos'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { Pendente } from '@/pages/Pendente'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { InstallPrompt } from '@/components/InstallPrompt'

// Páginas grandes ou pouco-acessadas vão lazy pra reduzir bundle inicial
// (era 2.9MB tudo junto). Cada uma carrega só quando vendedor navega pra ela.
const Analytics = lazy(() => import('@/pages/Analytics').then(m => ({ default: m.Analytics })))
const Contacts = lazy(() => import('@/pages/Contacts').then(m => ({ default: m.Contacts })))
const Assign = lazy(() => import('@/pages/Assign').then(m => ({ default: m.Assign })))
const Orcamentos = lazy(() => import('@/pages/Orcamentos').then(m => ({ default: m.Orcamentos })))
const Vendidos = lazy(() => import('@/pages/Vendidos').then(m => ({ default: m.Vendidos })))
const Funil = lazy(() => import('@/pages/Funil').then(m => ({ default: m.Funil })))
const FunilRelatorio = lazy(() => import('@/pages/FunilRelatorio').then(m => ({ default: m.FunilRelatorio })))
const EtiquetasZap = lazy(() => import('@/pages/EtiquetasZap').then(m => ({ default: m.EtiquetasZap })))
const EtiquetasZapGraficos = lazy(() => import('@/pages/EtiquetasZapGraficos').then(m => ({ default: m.EtiquetasZapGraficos })))
const PainelEtiquetas = lazy(() => import('@/pages/PainelEtiquetas').then(m => ({ default: m.PainelEtiquetas })))
const OrcamentoBuilder = lazy(() => import('@/pages/OrcamentoBuilder').then(m => ({ default: m.OrcamentoBuilder })))
const OrcamentoMontar = lazy(() => import('@/pages/OrcamentoMontar').then(m => ({ default: m.OrcamentoMontar })))
const CatalogoAdmin = lazy(() => import('@/pages/CatalogoAdmin').then(m => ({ default: m.CatalogoAdmin })))
const AtividadeDiaria = lazy(() => import('@/pages/AtividadeDiaria').then(m => ({ default: m.AtividadeDiaria })))
const Projeto = lazy(() => import('@/pages/Projeto').then(m => ({ default: m.Projeto })))
const AdminUsuarios = lazy(() => import('@/pages/AdminUsuarios').then(m => ({ default: m.AdminUsuarios })))
const AdminPermissoes = lazy(() => import('@/pages/AdminPermissoes').then(m => ({ default: m.AdminPermissoes })))
const AdminTransportadorFuncoes = lazy(() => import('@/pages/AdminTransportadorFuncoes'))
const Perfil = lazy(() => import('@/pages/Perfil').then(m => ({ default: m.Perfil })))
const Disparos = lazy(() => import('@/pages/Disparos').then(m => ({ default: m.Disparos })))
const MotoresAdmin = lazy(() => import('@/pages/MotoresAdmin').then(m => ({ default: m.MotoresAdmin })))
const PrecosBranorte = lazy(() => import('@/pages/PrecosBranorte').then(m => ({ default: m.PrecosBranorte })))
const OrcamentosConversao = lazy(() => import('@/pages/OrcamentosConversao').then(m => ({ default: m.OrcamentosConversao })))
const OrcamentosSalvos = lazy(() => import('@/pages/OrcamentosSalvos').then(m => ({ default: m.OrcamentosSalvos })))
const Roadmap = lazy(() => import('@/pages/Roadmap').then(m => ({ default: m.Roadmap })))
const FreteCotacao = lazy(() => import('@/pages/FreteCotacao'))
const FreteTransportadoras = lazy(() => import('@/pages/FreteTransportadoras'))
const FreteHistorico = lazy(() => import('@/pages/FreteHistorico'))

// /print/orcamento é importado direto (sem lazy) pra evitar precisar de Suspense
// no fallback antes do auth. Rota usada APENAS pelo Puppeteer server-side.
import PrintOrcamento from '@/pages/PrintOrcamento'

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
  const can = useCan()
  const loc = useLocation()

  // Rota pública /print — usada pelo Puppeteer pra renderizar OrcamentoPreview
  // sem chrome do app. Dados injetados via window.__BRANORTE_PRINT__ pelo Puppeteer.
  if (loc.pathname === '/print/orcamento') {
    return <PrintOrcamento />
  }

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
  // Layout envolve <Outlet> em <Suspense> pra carregar chunks lazy de cada página.
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/contatos" element={<Contacts />} />
        <Route path="/atribuir" element={<Assign />} />
        <Route path="/orcamentos" element={<Orcamentos />} />
        <Route path="/orcamentos/lista" element={<Orcamentos />} />
        {/* /orcamentos/novo descontinuado: redireciona pro Montar Custom (links antigos continuam funcionando) */}
        <Route path="/orcamentos/novo" element={<Navigate to="/orcamentos/montar" replace />} />
        <Route path="/orcamentos/montar" element={<OrcamentoMontar />} />
        <Route path="/orcamentos/salvos" element={<OrcamentosSalvos />} />
        <Route path="/orcamentos/catalogo-admin" element={<CatalogoAdmin />} />
        <Route path="/orcamentos/motores" element={<MotoresAdmin />} />
        <Route path="/orcamentos/precos" element={<PrecosBranorte />} />
        <Route path="/orcamentos/conversao" element={<OrcamentosConversao />} />
        <Route path="/frete" element={<FreteCotacao />} />
        <Route path="/frete/transportadoras" element={<FreteTransportadoras />} />
        <Route path="/frete/historico" element={<FreteHistorico />} />
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
        {can('menu.disparos') && (
          <Route path="/disparos" element={<Disparos />} />
        )}
        {can('menu.admin_usuarios') && (
          <Route path="/admin/usuarios" element={<AdminUsuarios />} />
        )}
        {can('menu.admin_permissoes') && (
          <Route path="/admin/permissoes" element={<AdminPermissoes />} />
        )}
        {can('menu.admin_transportador_funcoes') && (
          <Route path="/admin/transportador-funcoes" element={<AdminTransportadorFuncoes />} />
        )}
        {can('menu.roadmap') && (
          <Route path="/roadmap" element={<Roadmap />} />
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
          <InstallPrompt />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
