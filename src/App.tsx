import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { QueryClient, QueryClientProvider, QueryCache, MutationCache } from '@tanstack/react-query'
import { lazy, useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { Layout } from '@/components/layout/Layout'
import { Dashboard } from '@/pages/Dashboard'
import { MobileHome } from '@/pages/MobileHome'
import { useIsMobile } from '@/hooks/useIsMobile'
import { Atendimentos } from '@/pages/Atendimentos'
import { Login } from '@/pages/Login'
import { Signup } from '@/pages/Signup'
import { Pendente } from '@/pages/Pendente'
import { AuthProvider, useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import { InstallPrompt } from '@/components/InstallPrompt'
import { NovaVersaoBanner } from '@/components/NovaVersaoBanner'

// Páginas grandes ou pouco-acessadas vão lazy pra reduzir bundle inicial
// (era 2.9MB tudo junto). Cada uma carrega só quando vendedor navega pra ela.
const Analytics = lazy(() => import('@/pages/Analytics').then(m => ({ default: m.Analytics })))
const Contacts = lazy(() => import('@/pages/Contacts').then(m => ({ default: m.Contacts })))
const Consulta = lazy(() => import('@/pages/Consulta').then(m => ({ default: m.Consulta })))
const ConsultaHistorico = lazy(() => import('@/pages/ConsultaHistorico').then(m => ({ default: m.ConsultaHistorico })))
const Assign = lazy(() => import('@/pages/Assign').then(m => ({ default: m.Assign })))
const Orcamentos = lazy(() => import('@/pages/Orcamentos').then(m => ({ default: m.Orcamentos })))
const Vendidos = lazy(() => import('@/pages/Vendidos').then(m => ({ default: m.Vendidos })))
const MapaVisitas = lazy(() => import('@/pages/MapaVisitas').then(m => ({ default: m.MapaVisitas })))
const Funil = lazy(() => import('@/pages/Funil').then(m => ({ default: m.Funil })))
const FunilWhatsApp = lazy(() => import('@/pages/FunilWhatsApp').then(m => ({ default: m.FunilWhatsApp })))
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
const Avaliacoes = lazy(() => import('@/pages/Avaliacoes').then(m => ({ default: m.Avaliacoes })))
const FreteCotacao = lazy(() => import('@/pages/FreteCotacao'))
const FreteTransportadoras = lazy(() => import('@/pages/FreteTransportadoras'))
const FreteHistorico = lazy(() => import('@/pages/FreteHistorico'))
const FreteSolicitar = lazy(() => import('@/pages/FreteSolicitar'))
const FreteAprovar = lazy(() => import('@/pages/FreteAprovar'))
const FreteMapa = lazy(() => import('@/pages/FreteMapa'))
const CadastrarItemFrete = lazy(() => import('@/pages/CadastrarItemFrete'))
const FreteCotacoesPainel = lazy(() => import('@/pages/FreteCotacoesPainel'))
const ControleDashboard = lazy(() => import('@/pages/ControleDashboard').then(m => ({ default: m.ControleDashboard })))
const ControlePedidos = lazy(() => import('@/pages/ControlePedidos').then(m => ({ default: m.ControlePedidos })))
const ControleFinanceiro = lazy(() => import('@/pages/ControleFinanceiro').then(m => ({ default: m.ControleFinanceiro })))
const ControleNovoPedido = lazy(() => import('@/pages/ControleNovoPedido').then(m => ({ default: m.ControleNovoPedido })))

// /print/orcamento é importado direto (sem lazy) pra evitar precisar de Suspense
// no fallback antes do auth. Rota usada APENAS pelo Puppeteer server-side.
import PrintOrcamento from '@/pages/PrintOrcamento'

// /sso é o pouso do login automático vindo do controle.branorte.com.
// Importado direto (sem lazy) porque roda antes do gate de auth.
import { SsoLanding } from '@/pages/SsoLanding'

// /avaliacao é a página PÚBLICA de avaliação de atendimento, aberta pelo link
// que a extensão WA Sync envia ao cliente. Import direto: roda deslogada.
import { Avaliacao } from '@/pages/Avaliacao'

// /cotar-frete/<token> é a página PÚBLICA da cotação reversa de frete, aberta pela
// transportadora pelo link que o Jardel envia no WhatsApp. Roda deslogada.
import { CotarFrete } from '@/pages/CotarFrete'
// /transportadora — portal das transportadoras (auth própria, fora do app do staff).
import { TransportadoraApp } from '@/pages/TransportadoraApp'

// Hosts dedicados ao Portal de Transportadoras. Quando o app é acessado por um
// destes domínios, a raiz já serve o portal (sem precisar do path /transportadora,
// sem expor a URL do CRM interno). transportadoras.branorte.com = link profissional;
// o .vercel.app é o link instantâneo (sem depender de DNS).
const PORTAL_HOSTS = new Set([
  'transportadoras.branorte.com',
  'transportadoras-branorte.vercel.app',
])

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

/** "/" → launcher mobile no celular, Dashboard no desktop. */
function HomeRouter() {
  const isMobile = useIsMobile()
  return isMobile ? <MobileHome /> : <Dashboard />
}

// Tela mostrada quando a sessão existe mas o perfil não carregou (timeout/erro do
// Supabase). Diferente de "Aguardando aprovação": aqui não sabemos o status, então
// oferecemos retry em vez de bloquear como não-aprovado.
function ProfileLoadError() {
  const { signOut } = useAuth()
  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-md bg-surface-1 border border-border rounded-2xl p-8 text-center">
        <div className="h-12 w-12 rounded-full bg-amber-50 mx-auto flex items-center justify-center mb-4">
          <span className="text-amber-600 text-xl">📡</span>
        </div>
        <h1 className="font-bold text-ink mb-2">Não consegui carregar seu acesso</h1>
        <p className="text-sm text-ink-muted mb-6">
          O servidor demorou pra responder (instabilidade momentânea). Seu login está
          ok — é só tentar de novo.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="w-full mb-3 px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90"
        >
          Tentar de novo
        </button>
        <button
          onClick={signOut}
          className="text-sm text-ink-faint hover:text-ink underline"
        >
          Sair
        </button>
      </div>
    </div>
  )
}

// Logado sem profile de staff aprovado. Pode ser uma TRANSPORTADORA (tem conta no
// portal /transportadora) que caiu numa rota do staff — nesse caso manda pro portal
// dela em vez de mostrar o "aguardando aprovação" do staff (que é um fluxo separado).
function PendenteOuTransportadora() {
  const [estado, setEstado] = useState<'check' | 'transp' | 'staff'>('check')
  useEffect(() => {
    let vivo = true
    ;(async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser()
        if (!user) { if (vivo) setEstado('staff'); return }
        const { data } = await supabase
          .from('frete_transportadora_contas')
          .select('user_id')
          .eq('user_id', user.id)
          .maybeSingle()
        if (vivo) setEstado(data ? 'transp' : 'staff')
      } catch {
        if (vivo) setEstado('staff')
      }
    })()
    return () => { vivo = false }
  }, [])
  if (estado === 'check') return <PageLoading />
  if (estado === 'transp') return <Navigate to="/transportadora" replace />
  return <Pendente />
}

function AppRoutes() {
  const { session, profile, loading, profileError } = useAuth()
  const can = useCan()
  const loc = useLocation()

  // Rota pública /print — usada pelo Puppeteer pra renderizar OrcamentoPreview
  // sem chrome do app. Dados injetados via window.__BRANORTE_PRINT__ pelo Puppeteer.
  if (loc.pathname === '/print/orcamento') {
    return <PrintOrcamento />
  }

  // Rota pública /sso — pouso do login automático do sistema principal.
  // Precisa rodar deslogado (é ela que estabelece a sessão).
  if (loc.pathname === '/sso') {
    return <SsoLanding />
  }

  // Rota pública /avaliacao — cliente avalia o atendimento pelo link da extensão.
  // Roda deslogada (cliente não tem conta).
  if (loc.pathname === '/avaliacao') {
    return <Avaliacao />
  }

  // Rota pública /cotar-frete/<token> — a transportadora preenche o valor do frete.
  // Roda deslogada (transportadora não tem conta).
  if (loc.pathname.startsWith('/cotar-frete/')) {
    return <CotarFrete />
  }

  // Portal das transportadoras — auth própria, ANTES do gating do staff (a
  // transportadora não tem profile de staff, então não passa pelo fluxo interno).
  // Acessível de 2 jeitos:
  //   1) path /transportadora no domínio do CRM (branorte-crm.vercel.app/transportadora)
  //   2) host dedicado (transportadoras.branorte.com) — serve o portal direto na raiz,
  //      sem expor a URL do CRM interno. Os links públicos acima (/cotar-frete etc.)
  //      continuam funcionando em qualquer host porque são checados antes daqui.
  const ehHostPortal = typeof window !== 'undefined' && PORTAL_HOSTS.has(window.location.hostname)
  if (ehHostPortal || loc.pathname === '/transportadora' || loc.pathname.startsWith('/transportadora/')) {
    return <TransportadoraApp />
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

  // Logado, mas a query do profile FALHOU (timeout/erro do Supabase sob carga).
  // NÃO é "não aprovado" — não temos como saber. Mostra reconexão, não /pendente.
  if (session && !profile && profileError) {
    return <ProfileLoadError />
  }

  // Logado mas sem profile aprovado → /pendente (ou portal, se for transportadora)
  if (!profile || !profile.approved_at || profile.role === 'pending' || profile.role === 'rejected') {
    return <PendenteOuTransportadora />
  }

  // Visualizador: acesso restrito a Dashboard + Atendimentos. Bloqueia URL direta
  // pra qualquer outra rota (o menu já esconde; isto trava o acesso por link).
  const VIEWER_PATHS = new Set(['/', '/dashboard', '/atendimentos', '/perfil'])
  // Frete liberado pra TODOS os roles (exceto a fila de aprovação /frete/aprovar, gateada).
  const freteLiberado = loc.pathname.startsWith('/frete') && !loc.pathname.startsWith('/frete/aprovar')
  if (profile.role === 'visualizador' && !VIEWER_PATHS.has(loc.pathname) && !freteLiberado) {
    return <Navigate to="/" replace />
  }

  // Vendedor: acesso restrito a Atendimentos, Consulta, Montar/Editar Orçamento e
  // Mapa de Visitas (+ Perfil). Dashboard escondido → "/" e demais rotas caem em
  // Atendimentos. O menu já esconde; isto trava o acesso por URL direta.
  const VENDOR_PREFIXES = ['/atendimentos', '/consulta', '/orcamentos/montar', '/orcamentos/salvos', '/orcamentos/novo', '/mapa-visitas', '/frete/solicitar', '/perfil']
  if (profile.role === 'vendor') {
    const p = loc.pathname
    // gestor de frete pode ter papel 'vendor' + permissão frete.aprovar → libera a fila pra ele
    const aprovarOk = p.startsWith('/frete/aprovar') && can('frete.aprovar')
    const allowed = freteLiberado || aprovarOk || VENDOR_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/'))
    if (!allowed) return <Navigate to="/atendimentos" replace />
  }

  // Mapa: conta externa que só consulta o Mapa de Visitas. Acesso EXCLUSIVO a
  // /mapa-visitas (+ /perfil). Qualquer outra URL (inclusive "/") cai no mapa —
  // então ao logar já abre o mapa. O Layout esconde todo o chrome pra esse papel.
  if (profile.role === 'mapa') {
    const p = loc.pathname
    if (p !== '/mapa-visitas' && p !== '/perfil') return <Navigate to="/mapa-visitas" replace />
  }

  // Aprovado → app
  // Layout envolve <Outlet> em <Suspense> pra carregar chunks lazy de cada página.
  return (
    <Routes>
      <Route element={<Layout />}>
        {/* No celular "/" mostra o launcher mobile; no desktop, o Dashboard.
            Admin alcança o Dashboard completo no mobile via card → /dashboard. */}
        <Route path="/" element={<HomeRouter />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/contatos" element={<Contacts />} />
        {can('due_diligence.consultar') && (
          <>
            <Route path="/consulta" element={<Consulta />} />
            <Route path="/consulta/historico" element={<ConsultaHistorico />} />
          </>
        )}
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
        <Route path="/frete/solicitar" element={<FreteSolicitar />} />
        <Route path="/frete/cotacoes" element={<FreteCotacoesPainel />} />
        <Route path="/frete/itens" element={<CadastrarItemFrete />} />
        <Route path="/frete/mapa" element={<FreteMapa />} />
        {can('frete.aprovar') && (
          <Route path="/frete/aprovar" element={<FreteAprovar />} />
        )}
        <Route path="/vendidos" element={<Vendidos />} />
        <Route path="/mapa-visitas" element={<MapaVisitas />} />
        <Route path="/controle" element={<ControleDashboard />} />
        <Route path="/controle/pedidos" element={<ControlePedidos />} />
        <Route path="/controle/financeiro" element={<ControleFinanceiro />} />
        <Route path="/controle/novo-pedido" element={<ControleNovoPedido />} />
        <Route path="/atendimentos" element={<Atendimentos />} />
        {/* Painel admin das avaliações de atendimento (página pública /avaliacao).
            Vendedor/visualizador são redirecionados pelos guards acima. */}
        <Route path="/avaliacoes" element={<Avaliacoes />} />
        {/* /funil = Kanban WhatsApp (espelho das etiquetas Wascript); o kanban
            manual antigo (status_vendedor) continua em /funil/manual */}
        <Route path="/funil" element={<FunilWhatsApp />} />
        <Route path="/funil/manual" element={<Funil />} />
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
          <NovaVersaoBanner />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
