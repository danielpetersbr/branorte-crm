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
const Orcamentos = lazy(() => import('@/pages/Orcamentos').then(m => ({ default: m.Orcamentos })))
const Vendidos = lazy(() => import('@/pages/Vendidos').then(m => ({ default: m.Vendidos })))
const MapaVisitas = lazy(() => import('@/pages/MapaVisitas').then(m => ({ default: m.MapaVisitas })))
const MinhasVisitas = lazy(() => import('@/pages/MinhasVisitas').then(m => ({ default: m.MinhasVisitas })))
const OrganizacaoViagemPage = lazy(() => import('./pages/OrganizacaoViagemPage').then(m => ({ default: m.OrganizacaoViagemPage })))
const MapaRepresentantes = lazy(() => import('@/pages/MapaRepresentantes').then(m => ({ default: m.MapaRepresentantes })))
const MapaPotenciais = lazy(() => import('@/pages/MapaPotenciais').then(m => ({ default: m.MapaPotenciais })))
const Representantes = lazy(() => import('@/pages/Representantes').then(m => ({ default: m.Representantes })))
const SejaRepresentante = lazy(() => import('@/pages/SejaRepresentante').then(m => ({ default: m.SejaRepresentante })))
const Funil = lazy(() => import('@/pages/Funil').then(m => ({ default: m.Funil })))
const FunilWhatsApp = lazy(() => import('@/pages/FunilWhatsApp').then(m => ({ default: m.FunilWhatsApp })))
const FunilRelatorio = lazy(() => import('@/pages/FunilRelatorio').then(m => ({ default: m.FunilRelatorio })))
const OrcamentoBuilder = lazy(() => import('@/pages/OrcamentoBuilder').then(m => ({ default: m.OrcamentoBuilder })))
const OrcamentoMontar = lazy(() => import('@/pages/OrcamentoMontar').then(m => ({ default: m.OrcamentoMontar })))
const CatalogoAdmin = lazy(() => import('@/pages/CatalogoAdmin').then(m => ({ default: m.CatalogoAdmin })))
const Projeto = lazy(() => import('@/pages/Projeto').then(m => ({ default: m.Projeto })))
const Projeto3D = lazy(() => import('@/pages/Projeto3D').then(m => ({ default: m.Projeto3D })))
const ProducaoPropria = lazy(() => import('@/pages/ProducaoPropria').then(m => ({ default: m.ProducaoPropria })))
const VendaRacao = lazy(() => import('@/pages/VendaRacao').then(m => ({ default: m.VendaRacao })))
const Guia = lazy(() => import('@/pages/Guia').then(m => ({ default: m.Guia })))
const GuiaAdmin = lazy(() => import('@/pages/GuiaAdmin').then(m => ({ default: m.GuiaAdmin })))
const AdminUsuarios = lazy(() => import('@/pages/AdminUsuarios').then(m => ({ default: m.AdminUsuarios })))
const AdminPermissoes = lazy(() => import('@/pages/AdminPermissoes').then(m => ({ default: m.AdminPermissoes })))
const AdminTransportadorFuncoes = lazy(() => import('@/pages/AdminTransportadorFuncoes'))
const IaAtendente = lazy(() => import('@/pages/IaAtendente').then(m => ({ default: m.IaAtendente })))
const FluxosFunil = lazy(() => import('@/pages/FluxosFunil').then(m => ({ default: m.FluxosFunil })))
const Perfil = lazy(() => import('@/pages/Perfil').then(m => ({ default: m.Perfil })))
const Disparos = lazy(() => import('@/pages/Disparos').then(m => ({ default: m.Disparos })))
const LinksRoteamento = lazy(() => import('@/pages/LinksRoteamento').then(m => ({ default: m.LinksRoteamento })))
const MotoresAdmin = lazy(() => import('@/pages/MotoresAdmin').then(m => ({ default: m.MotoresAdmin })))
const PrecosBranorte = lazy(() => import('@/pages/PrecosBranorte').then(m => ({ default: m.PrecosBranorte })))
const OrcamentosConversao = lazy(() => import('@/pages/OrcamentosConversao').then(m => ({ default: m.OrcamentosConversao })))
const OrcamentosSalvos = lazy(() => import('@/pages/OrcamentosSalvos').then(m => ({ default: m.OrcamentosSalvos })))
const Roadmap = lazy(() => import('@/pages/Roadmap').then(m => ({ default: m.Roadmap })))
const IaTeste = lazy(() => import('@/pages/IaTeste').then(m => ({ default: m.IaTeste })))
const Reunioes = lazy(() => import('@/pages/Reunioes').then(m => ({ default: m.Reunioes })))
const Ligacoes = lazy(() => import('@/pages/Ligacoes').then(m => ({ default: m.Ligacoes })))
const Agenda = lazy(() => import('@/pages/Agenda').then(m => ({ default: m.Agenda })))
const RelatorioLider = lazy(() => import('@/pages/RelatorioLider').then(m => ({ default: m.RelatorioLider })))
const FreteCotacao = lazy(() => import('@/pages/FreteCotacao'))
const FreteTransportadoras = lazy(() => import('@/pages/FreteTransportadoras'))
const FreteHistorico = lazy(() => import('@/pages/FreteHistorico'))
const FreteSolicitar = lazy(() => import('@/pages/FreteSolicitar'))
// FreteAprovar aposentado 2026-06-25 → consolidado no kanban /frete/cotacoes. Rollback: descomentar + restaurar a rota abaixo.
// const FreteAprovar = lazy(() => import('@/pages/FreteAprovar'))
const FreteMapa = lazy(() => import('@/pages/FreteMapa'))
const CadastrarItemFrete = lazy(() => import('@/pages/CadastrarItemFrete'))
const FreteCotacoesPainel = lazy(() => import('@/pages/FreteCotacoesPainel'))
const ControleDashboard = lazy(() => import('@/pages/ControleDashboard').then(m => ({ default: m.ControleDashboard })))
const ControlePedidos = lazy(() => import('@/pages/ControlePedidos').then(m => ({ default: m.ControlePedidos })))
const ControleFinanceiro = lazy(() => import('@/pages/ControleFinanceiro').then(m => ({ default: m.ControleFinanceiro })))
const ControleNovoPedido = lazy(() => import('@/pages/ControleNovoPedido').then(m => ({ default: m.ControleNovoPedido })))
const Supervisao = lazy(() => import('@/pages/Supervisao').then(m => ({ default: m.Supervisao })))
const SupervisaoVendedor = lazy(() => import('@/pages/SupervisaoVendedor').then(m => ({ default: m.SupervisaoVendedor })))

// /print/orcamento é importado direto (sem lazy) pra evitar precisar de Suspense
// no fallback antes do auth. Rota usada APENAS pelo Puppeteer server-side.
import PrintOrcamento from '@/pages/PrintOrcamento'
// /print/roteiro — mesma ideia, pro PDF do roteiro de viagem (/mapa-visitas).
import PrintRoteiro from '@/pages/PrintRoteiro'

// /sso é o pouso do login automático vindo do controle.branorte.com.
// Importado direto (sem lazy) porque roda antes do gate de auth.
import { SsoLanding } from '@/pages/SsoLanding'

// /avaliacao é a página PÚBLICA de avaliação de atendimento, aberta pelo link
// que a extensão WA Sync envia ao cliente. Import direto: roda deslogada.
import { Avaliacao } from '@/pages/Avaliacao'

// /reuniao/<token> é a página PÚBLICA de feedback pós-reunião, aberta pelo link
// que o gestor manda pros vendedores. Import direto: roda deslogada.
import { ReuniaoFeedback } from '@/pages/ReuniaoFeedback'

// /cotar-frete/<token> é a página PÚBLICA da cotação reversa de frete, aberta pela
// transportadora pelo link que o Jardel envia no WhatsApp. Roda deslogada.
import { CotarFrete } from '@/pages/CotarFrete'

// /monte-sua-fabrica é o quiz PÚBLICO: o produtor responde 7 perguntas e vê a
// linha de equipamentos que atende ele, do recebimento à expedição. Import
// direto (sem lazy) pelo mesmo motivo das de cima: roda ANTES do gate de auth,
// onde não existe Suspense pra segurar o chunk.
import { MonteSuaFabrica } from '@/pages/MonteSuaFabrica'
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

  // Rota pública /print/roteiro — Puppeteer renderiza o roteiro de viagem.
  // Dados via window.__BRANORTE_ROTEIRO__, injetado antes do navigate.
  if (loc.pathname === '/print/roteiro') {
    return <PrintRoteiro />
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

  // Rota pública /reuniao/<token> — o vendedor comenta a reunião depois dela.
  // Roda deslogada (ele abre no celular, fora do CRM). A barra depois de
  // "/reuniao" é o que separa daqui da /reunioes interna.
  if (loc.pathname.startsWith('/reuniao/')) {
    return <ReuniaoFeedback />
  }

  // Rota pública /cotar-frete/<token> — a transportadora preenche o valor do frete.
  // Roda deslogada (transportadora não tem conta).
  if (loc.pathname.startsWith('/cotar-frete/')) {
    return <CotarFrete />
  }

  // Rota pública /seja-representante — link colável do programa de representantes.
  // Roda deslogada (o candidato não tem conta e não vai ter). Grava em
  // representante_candidaturas, cuja RLS dá INSERT pro anon e nenhum SELECT.
  // As candidaturas aparecem em /representantes, aba "Candidaturas".
  if (loc.pathname === '/seja-representante') {
    return <SejaRepresentante />
  }

  // Rota pública /monte-sua-fabrica — o quiz que o produtor responde sozinho,
  // pelo link do WhatsApp ou do anúncio. Roda deslogada (ele não tem conta e
  // não vai ter). O resultado NÃO é gateado: ele vê a fábrica antes de dar o
  // telefone, e quem quiser falar com técnico deixa o contato no fim. Grava em
  // quiz_fabrica_respostas, cuja RLS dá INSERT pro anon e nenhum SELECT.
  // A prévia interna (equipe conferindo) é /monte-sua-fabrica/previa, lá embaixo.
  if (loc.pathname === '/monte-sua-fabrica') {
    return <MonteSuaFabrica />
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

  // Mapa de Representantes: visão de gestão (carteira de todos os reps + comparação
  // com a média). Só ADMIN e as contas de papel 'mapa' (Patrick) — vendedor/visualizador
  // caem no início mesmo digitando a URL. O menu já esconde pra quem não pode.
  if (loc.pathname.startsWith('/mapa-representantes') && !['admin', 'mapa'].includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  // Rede de Representantes: painel de GESTÃO do campo (visitas, execução, alertas).
  // Rota diferente de /mapa-representantes — o startsWith acima NÃO cobre esta.
  // Aqui o guard só escolhe a tela: a trava real é pode_gerir_representantes()
  // dentro das RPCs rep_painel/rep_visitas, que devolvem ZERO linha pra quem não
  // gere. Sem ela, bastava o DevTools pra ler o desempenho de todo mundo.
  if (loc.pathname.startsWith('/representantes') && !['admin', 'mapa'].includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  // Possíveis Representantes: prospecção OUTBOUND (54 candidatos de fonte pública,
  // com telefone e e-mail). Este guard só escolhe a tela — a trava real é a RLS de
  // representante_prospects, que exige pode_gerir_representantes(). Sem ela bastava
  // o DevTools pra baixar a lista de contatos inteira.
  if (loc.pathname.startsWith('/mapa-potenciais') && !['admin', 'mapa'].includes(profile.role)) {
    return <Navigate to="/" replace />
  }

  // Visualizador: acesso restrito a Dashboard + Atendimentos. Bloqueia URL direta
  // pra qualquer outra rota (o menu já esconde; isto trava o acesso por link).
  const VIEWER_PATHS = new Set(['/', '/dashboard', '/atendimentos', '/perfil', '/agenda'])
  // Frete liberado pra TODOS os roles (exceto a fila de aprovação /frete/aprovar, gateada).
  const freteLiberado = loc.pathname.startsWith('/frete') && !loc.pathname.startsWith('/frete/aprovar')
  if (profile.role === 'visualizador' && !VIEWER_PATHS.has(loc.pathname) && !freteLiberado) {
    return <Navigate to="/" replace />
  }

  // Vendedor: acesso restrito a Atendimentos, Consulta, Montar/Editar Orçamento e
  // Mapa de Visitas (+ Perfil). Dashboard escondido → "/" e demais rotas caem em
  // Atendimentos. O menu já esconde; isto trava o acesso por URL direta.
  const VENDOR_PREFIXES = ['/atendimentos', '/consulta', '/orcamentos/precos', '/orcamentos/montar', '/orcamentos/salvos', '/orcamentos/novo', '/mapa-visitas', '/minhas-visitas', '/organizacao-viagem', '/frete/solicitar', '/perfil', '/agenda']
  if (profile.role === 'vendor') {
    const p = loc.pathname
    // gestor de frete pode ter papel 'vendor' + permissão frete.aprovar → libera a fila pra ele
    const aprovarOk = p.startsWith('/frete/aprovar') && can('frete.aprovar')
    // Projeto 3D é liberado por permissão (menu.projeto_3d) — o menu já mostra pro vendedor,
    // então o guard precisa deixar passar por URL/nav também (senão redireciona pra /atendimentos).
    const projeto3dOk = p.startsWith('/projeto-3d') && can('menu.projeto_3d')
    // Guias de apoio à venda, liberadas pra quem tem a permissão da viabilidade
    const viabilidadeOk = (p.startsWith('/viabilidade') || p.startsWith('/guia')) && can('menu.viabilidade')
    // Produção Própria: o estudo de viabilidade completo. Aceita QUALQUER uma das
    // duas permissões porque absorveu a calculadora que ficava em /viabilidade —
    // quem já usava a antiga não pode perder a ferramenta.
    const producaoPropriaOk = (p.startsWith('/producao-propria') || p.startsWith('/venda-racao') || p.startsWith('/viabilidade'))
      && (can('menu.venda_racao') || can('menu.viabilidade'))
    // Roadmap & Feedback: vendedor VÊ o retorno dos feedbacks que enviou (#49)
    const roadmapOk = p.startsWith('/roadmap') && can('menu.roadmap')
    /*
     * Contatos: liberado por PERMISSÃO, não por lista fixa.
     *
     * Em 06/08 demos `menu.contatos` aos 9 vendedores e o item continuou fora do
     * alcance deles. Não bastava o menu: este guard tem lista branca própria, e
     * quem clicasse cairia de volta em /atendimentos. As duas coisas — permissão
     * e guard — precisam concordar.
     *
     * Amarrado no `can()` de propósito (mesmo padrão de projeto3d/roadmap): se
     * amanhã tirarem a permissão em /admin/permissoes, o acesso por URL fecha
     * junto. Numa entrada fixa em VENDOR_PREFIXES, não fecharia.
     */
    const contatosOk = p.startsWith('/contatos') && can('menu.contatos')
    /*
     * Financeiro: SÓ /controle/financeiro, não o grupo /controle inteiro.
     *
     * O vendedor precisa ver os recebíveis dos pedidos dele, mas não o Painel de
     * Vendas nem o Novo Pedido, que moram no mesmo prefixo. Por isso a entrada é
     * exata e amarrada em `menu.financeiro` (chave própria, não `menu.controle`).
     *
     * O recorte "só os pedidos dele" NÃO depende deste guard nem do menu: quem
     * decide é /api/financeiro, no servidor, a partir do JWT. Este guard só
     * escolhe a tela.
     */
    const financeiroOk = p.startsWith('/controle/financeiro') && can('menu.financeiro')
    // Testar a IA: arena isolada onde o vendedor conversa com a própria IA e aponta
    // o que ela errou. Amarrado no can() pelo mesmo motivo do roadmap/contatos —
    // tirar a permissão fecha o acesso por URL junto.
    const iaTesteOk = p.startsWith('/ia-teste') && can('menu.ia_teste')
    /*
     * Ligações: a tela nasceu pra supervisão, mas o vendedor precisa da PRÓPRIA
     * régua — quantas fez, quantas atenderam, quais chamadas de cliente ficaram
     * sem retorno. Ela abre em modo pessoal pra ele (Ligacoes.tsx decide pelo
     * papel): sem ranking de time, sem seletor de colega.
     *
     * ⚠️ `menu.ligacoes` JÁ estava `true` pro papel `vendor` em role_permissions
     * desde que a tela nasceu — o item aparecia no menu dele e o clique caía aqui
     * e voltava pra /atendimentos. Mesmo desencontro do /contatos em 06/08: a
     * permissão liberada e o guard fechado, duas fontes de verdade discordando.
     *
     * O recorte "só as dele" NÃO depende deste guard nem do menu: quem decide é a
     * RLS de wa_ligacoes (`is_admin() OR vendedor_nome = current_vendedor_nome()`),
     * com as 3 RPCs em SECURITY INVOKER e as views em security_invoker=true. Este
     * guard só escolhe a tela.
     */
    const ligacoesOk = p.startsWith('/ligacoes') && can('menu.ligacoes')
    const allowed = freteLiberado || aprovarOk || projeto3dOk || viabilidadeOk || producaoPropriaOk || roadmapOk || contatosOk || financeiroOk || iaTesteOk || ligacoesOk || VENDOR_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/'))
    if (!allowed) return <Navigate to="/atendimentos" replace />
  }

  // PAPÉIS DE ACESSO RESTRITO: contas externas liberadas por LISTA BRANCA —
  // qualquer outra URL (inclusive "/") cai na primeira rota do papel. O Layout
  // esconde todo o chrome deles e serve um menu lateral próprio (MENUS_RESTRITOS),
  // que é a ÚNICA navegação que têm. ⚠️ As duas listas precisam casar: rota sem
  // item = tela inalcançável; item sem rota = clique que devolve pro começo.
  //
  // Não passam por role_permissions de propósito: não existe linha pra eles lá,
  // nem estão em ASSIGNABLE_ROLES — `useCan()` é sempre false. Quem barra é aqui.
  //
  // Os DOIS estudos de ração que entraram em 03/08/2026 viraram UM só: a
  // /viabilidade era um iframe da calculadora pública e o /venda-racao precificava
  // ração pronta — que a Branorte não vende. Ambos redirecionam pra
  // /producao-propria, o estudo nativo.
  // As guias (/guia-animais, /guia-materias) ficaram DE FORA por ora; se for pra
  // liberar, é acrescentar aqui E no MENUS_RESTRITOS do Layout.
  //
  // A lista é mapa papel -> rotas. Cai
  // SEMPRE na primeira rota do papel, então ao logar já abre nela.
  //   mapa      = Patrick. Mapas + o estudo.
  //   consultor = consultor externo (03/08/2026). SÓ o estudo — sem mapa, sem
  //               contato, sem orçamento: não enxerga carteira nem dado
  //               comercial. No /producao-propria a RLS já cobre (só vê/edita
  //               as próprias simulações; venda_racao_ve_todas() é falso, então
  //               não altera os padrões da empresa).
  // As rotas antigas /viabilidade e /venda-racao seguem nas listas porque este
  // guard roda ANTES do <Navigate> que as redireciona — tirá-las mandaria link
  // salvo pro começo em vez do estudo.
  const ROTAS_RESTRITAS: Record<string, string[]> = {
    mapa: [
      '/mapa-visitas', '/mapa-representantes', '/mapa-potenciais', '/representantes', '/ficha-representante',
      '/producao-propria', '/viabilidade', '/venda-racao', '/perfil',
      // O Patrick tem papel 'mapa' mas vende: 12 pedidos, R$ 5,95 mi. Com o
      // vendor_id apontado, /api/financeiro devolve só os pedidos dele.
      '/controle/financeiro',
    ],
    consultor: ['/producao-propria', '/viabilidade', '/venda-racao', '/perfil'],
    // representante = representante EXTERNO com territorio (06/08/2026). Ve o mapa
    // de visitas, mas so os estados dele. A restricao NAO e este guard — ela mora
    // nas RPCs mapa_orcamentos_v2/lista_orcamentos_mapa, que filtram por
    // ufs_visiveis(). Este guard so escolhe a tela; sem a trava do banco ele
    // baixaria a carteira nacional pelo DevTools. Fica FORA do /mapa-representantes,
    // que mostra o territorio e os numeros de todo mundo.
    // O [0] é a LANDING do papel. Fica /mapa-visitas de propósito: é a tela que
    // ele já usa e que tem conteúdo hoje. /minhas-visitas só enche quando houver
    // roteiro montado pra ele — pôr uma tela vazia como porta de entrada seria
    // trocar o que funciona por uma promessa.
    representante: [
      '/mapa-visitas', '/minhas-visitas', '/producao-propria',
      '/viabilidade', '/venda-racao', '/perfil',
    ],
  }
  const rotasDoPapel = ROTAS_RESTRITAS[profile.role]
  if (rotasDoPapel && !rotasDoPapel.includes(loc.pathname)) {
    return <Navigate to={rotasDoPapel[0]} replace />
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
        {/* /frete/aprovar aposentado → redireciona pro kanban (config do disparo migrada pra lá) */}
        <Route path="/frete/aprovar" element={<Navigate to="/frete/cotacoes" replace />} />
        <Route path="/vendidos" element={<Vendidos />} />
        <Route path="/mapa-visitas" element={<MapaVisitas />} />
        <Route path="/minhas-visitas" element={<MinhasVisitas />} />
        <Route path="/organizacao-viagem" element={<OrganizacaoViagemPage />} />
        <Route path="/mapa-representantes" element={<MapaRepresentantes />} />
        <Route path="/mapa-potenciais" element={<MapaPotenciais />} />
        <Route path="/representantes" element={<Representantes />} />
        {/* Prévia da ficha DENTRO do CRM: mesma tela do candidato, envio travado.
            A pública é /seja-representante e roda antes do login. */}
        <Route path="/ficha-representante" element={<SejaRepresentante previa />} />
        <Route path="/controle" element={<ControleDashboard />} />
        <Route path="/controle/pedidos" element={<ControlePedidos />} />
        <Route path="/controle/financeiro" element={<ControleFinanceiro />} />
        <Route path="/controle/novo-pedido" element={<ControleNovoPedido />} />
        <Route path="/atendimentos" element={<Atendimentos />} />
        {/* Adm de Reunião — pauta + checklist de tarefas + resumo */}
        <Route path="/reunioes" element={<Reunioes />} />
        {/* ⚠️ /reuniao/<token> (singular, público) é checado ANTES do gate de auth. */}
        <Route path="/ligacoes" element={<Ligacoes />} />
        {/* Placar das metas de comportamento (resgate, pós-orçamento, negócio grande) */}
        <Route path="/agenda" element={<Agenda />} />
        {/* Relatorio diario do lider de time. O link vai com o time embutido
            (/relatorio-lider?time=caca-lead); sem o param a tela pede o time.
            Fica AUTENTICADA de proposito: a P1 mostra nome de cliente e valor de
            orcamento — abrir pro anon repetiria o vazamento do schema auditoria. */}
        <Route path="/relatorio-lider" element={<RelatorioLider />} />
        {/* /funil = Kanban WhatsApp (espelho das etiquetas Wascript); o kanban
            manual antigo (status_vendedor) continua em /funil/manual */}
        <Route path="/funil" element={<FunilWhatsApp />} />
        <Route path="/funil/manual" element={<Funil />} />
        <Route path="/funil/relatorio" element={<FunilRelatorio />} />
        <Route path="/projeto" element={<Projeto />} />
        <Route path="/projeto-3d" element={<Projeto3D />} />
        {/* DUAS telas de ração, com propósitos opostos — não confundir:
            /producao-propria = vale a pena o CLIENTE parar de comprar e produzir?
                                (economia, payback, investimento). Absorveu a
                                calculadora que ficava em iframe na /viabilidade.
            /venda-racao      = a Branorte VENDENDO ração: custo, margem, preço
                                sugerido, desconto máximo e proposta do cliente.
            A /venda-racao chegou a ser removida em 13b5278 (com a premissa de
            que a Branorte não vende ração) e foi restaurada a pedido do Daniel
            em 03/08/2026, com motor e componentes em namespace próprio
            (lib/components `precificacao-racao`) — o lib compartilhado foi
            reescrito pelo estudo e os dois formatos não convivem.
            /viabilidade segue redirecionando: aquela era iframe, morreu mesmo. */}
        <Route path="/producao-propria" element={<ProducaoPropria />} />
        {/* Prévia do quiz DENTRO do CRM: mesma tela do produtor, envio travado.
            A pública é /monte-sua-fabrica e roda antes do login. */}
        <Route path="/monte-sua-fabrica/previa" element={<MonteSuaFabrica previa />} />
        <Route path="/venda-racao" element={<VendaRacao />} />
        <Route path="/viabilidade" element={<Navigate to="/producao-propria" replace />} />
        {/* Guia do Vendedor — nativo desde 03/08/2026 (era iframe de
            branorte-viabilidade.vercel.app/guia.html). /guia-animais e
            /guia-materias continuam funcionando: viraram os modos da mesma tela,
            pra não quebrar link salvo nem o menu antigo. */}
        <Route path="/guia" element={<Guia />} />
        <Route path="/guia/:slug" element={<Guia />} />
        <Route path="/guia-animais" element={<Navigate to="/guia?modo=animais" replace />} />
        <Route path="/guia-materias" element={<Navigate to="/guia?modo=materias" replace />} />
        <Route path="/guia/admin" element={<GuiaAdmin />} />
        <Route path="/perfil" element={<Perfil />} />
        {can('menu.disparos') && (
          <Route path="/disparos" element={<Disparos />} />
        )}
        {can('menu.disparos') && (
          <Route path="/disparos/links" element={<LinksRoteamento />} />
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
        {can('menu.ia_atendente') && (
          <Route path="/ia-atendente" element={<IaAtendente />} />
        )}
        {can('menu.fluxos_funil') && (
          <Route path="/fluxos" element={<FluxosFunil />} />
        )}
        {can('menu.roadmap') && (
          <Route path="/roadmap" element={<Roadmap />} />
        )}
        {can('menu.ia_teste') && (
          <Route path="/ia-teste" element={<IaTeste />} />
        )}
        {/* Central de Supervisao - a IA le as conversas dos vendedores e mostra
            o que ficou por fazer. Nesta fase e ADMIN ONLY: o motor deterministico
            esta em modo sombra e a precisao medida em 14/08/2026 REPROVOU
            (cliente_aguardando acerta ~1 em 4). Nenhum vendedor pode ser cobrado
            por isso ainda.
            Gate por ROLE e nao por can(): chave nova de permissao volta false ate
            pro admin enquanto a linha 'admin' de role_permissions nao a tiver -
            foi assim que a /motor nasceu morta.
            Quem tranca de verdade e a RLS de supervisao_* (is_admin() OR
            supervisao_meu_vendor_id()); o gate de rota e a segunda camada. */}
        {profile.role === 'admin' && (
          <>
            <Route path="/supervisao" element={<Supervisao />} />
            {/* Sem o :vendedorId (ou com id desconhecido) a propria pagina
                lista quem tem apontamento aberto, em vez de abrir vazia. */}
            <Route path="/supervisao/vendedor" element={<SupervisaoVendedor />} />
            <Route path="/supervisao/vendedor/:vendedorId" element={<SupervisaoVendedor />} />
          </>
        )}
      </Route>
      <Route path="/login" element={<Navigate to="/" replace />} />
      <Route path="/signup" element={<Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

/**
 * Overlays globais (instalar PWA, aviso de nova versão).
 * NÃO podem aparecer nas rotas /print/* — elas são renderizadas pelo Puppeteer e
 * qualquer coisa flutuante entra no PDF. Foi assim que o banner "Instalar Branorte
 * CRM" apareceu no roteiro de viagem (e aparecia no PDF de orçamento também).
 */
function OverlaysGlobais() {
  const { pathname } = useLocation()
  // /reuniao/<token> é aberta no celular do vendedor por um link do WhatsApp: o
  // card de instalar o PWA senta em cima do botão de enviar. Ele já tem o CRM.
  //
  // /monte-sua-fabrica é o quiz público: quem abre é PRODUTOR RURAL vindo de um
  // link do WhatsApp ou de um anúncio. Oferecer "Instalar Branorte CRM" pra ele
  // é oferecer o sistema interno da empresa — e no celular o card senta em cima
  // do fluxo de equipamentos. Medido em 360px: cobria a estação 1 inteira.
  //
  // ⚠️ As outras rotas públicas (/avaliacao, /cotar-frete, /seja-representante)
  // continuam mostrando o convite — lá quem abre é CLIENTE, transportadora ou
  // candidato, que também não têm nada a instalar. Vale barrar também.
  if (
    pathname.startsWith('/print/')
    || pathname.startsWith('/reuniao/')
    || pathname === '/monte-sua-fabrica'
  ) return null
  return (
    <>
      <InstallPrompt />
      <NovaVersaoBanner />
    </>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <AppRoutes />
          <OverlaysGlobais />
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  )
}
