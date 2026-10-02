import { useState, useEffect, useLayoutEffect, useRef, useMemo } from "react";
import { buscarVendasControle, analisarVendasControle } from "@/lib/controle-vendas-api";
import { expandirPedidos, getValorPedido, consultaPertenceAoContexto, percentualComissaoControle, exportacaoPertenceAoContexto, type Pedido } from "@/components/controle/vendas-original/calculos";
import { pedidosFisicos, valorVendaFisica, agruparFabricasVendidas, agruparEquipamentosVendidos, agruparVendasPorEstado, normalizarOrigem } from "@/components/controle/vendas-original/graficos-dados";
import { evolucaoAnualPDFPronta, exigirEvolucaoAnualPDF, capturaMapaPDF } from "@/components/controle/vendas-original/pdf-graficos";
import { periodoMesAnterior } from "@/components/controle/vendas-original/periodos";
import { diasEntreContatoEVenda, conversaoNoMesmoMes } from "@/components/controle/vendas-original/conversao-dados";
import "@/components/controle/vendas-original/theme.css";
import { Button } from "@/components/pedido-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/pedido-ui/card";
import { Select, SelectItem, SelectTrigger, SelectValue } from "@/components/pedido-ui/select";
import { SelectContent } from "@/components/controle/vendas-original/SelectContent";
import { useNavigate } from "react-router-dom";
import { BarChart3, TrendingUp, DollarSign, FileText, Home, LogOut, Trophy, Medal, Target, Download, Package, MapPin, Clock, Users, Wrench, Zap, Sparkles, Loader2, RefreshCw, Crown, Filter, X } from "lucide-react";
import { Input } from "@/components/pedido-ui/input";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Cell, LabelList, PieChart, Pie, ReferenceLine } from "recharts";
import { format, startOfMonth, endOfMonth, startOfYear, endOfYear } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";
import { useCan } from "@/hooks/usePermissions";
import { podeNavegarPedidosVendas, linhasVisiveisVendas } from "@/components/controle/vendas-original/navegacao";
import { toast as sonnerToast } from "sonner";
import { criarRelatorioVendasPDF, type RelatorioVendasPDFInput } from "@/components/controle/vendas-original/relatorio-pdf";
import { resumoAuditoriaVendas } from "@/components/controle/vendas-original/auditoria-dados";
import html2canvas from "html2canvas";
import BrazilMap from "@/components/controle/vendas-original/BrazilMap";

import DOMPurify from "dompurify";
import { useVendedoresControleVendas, mesclarVendedoresComDados, normalizarVendedor, type VendedorControleVendas } from "@/hooks/useVendedoresControleVendas";

// Lista de vendedores vem de `vendedores` (ativo = true) via useVendedores().
// Não chumbar nomes aqui: era isso que escondia LUCAS e IGOR do ranking e do PDF.
const CORES_GRAFICOS =["#8b5cf6", "#6366f1", "#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#ec4899"];

const formatarValor = (valor: number) => {
  return valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const formatarData = (data: string | null | undefined): string => {
  if (!data) return '-';
  try {
    // Remove timezone suffix se existir
    const dateStr = data.split('T')[0];
    const parsed = new Date(dateStr + 'T00:00:00');
    if (isNaN(parsed.getTime())) return '-';
    return format(parsed, 'dd/MM/yy');
  } catch {
    return '-';
  }
};

export default function ControleVendasOriginal() {
  const { session, profile, loading: authLoading, profileError, signOut } = useAuth();
  const can = useCan();
  // Esta chave fica apenas em memória e nunca é renderizada ou registrada.
  const authContexto = !authLoading && !profileError && session && profile?.id === session.user.id && profile.approved_at
    ? [session.user.id, profile.role, profile.vendor_id || '', profile.approved_at, session.access_token].join('|') : '';
  const authAtual = useRef(authContexto);
  const podeAbrirPedidos = !!authContexto && podeNavegarPedidosVendas(profile?.role, can('menu.controle'));
  authAtual.current = authContexto;
  const [escopoConsulta, setEscopoConsulta] = useState<{ contexto: string; global: boolean; vendedorNome: string | null }>({ contexto: '', global: false, vendedorNome: null });
  const isAdmin = !!authContexto && escopoConsulta.contexto === authContexto && escopoConsulta.global;
  const vendedorNome = escopoConsulta.contexto === authContexto ? escopoConsulta.vendedorNome : null;
  const [vendedoresConsulta, setVendedoresConsulta] = useState<{ contexto: string; data: VendedorControleVendas[] }>({ contexto: '', data: [] });
  const vendedoresFonte = vendedoresConsulta.contexto === authContexto ? vendedoresConsulta.data : [];
  const { vendedores: vendedoresCadastrados } = useVendedoresControleVendas(vendedoresFonte);
  const [consultaPedidos, setConsultaPedidos] = useState<{ contexto: string; data: Pedido[] }>({ contexto: '', data: [] });
  const [consultaAno, setConsultaAno] = useState<{ contexto: string; data: Pedido[] }>({ contexto: '', data: [] });
  const [carregandoPedidos, setCarregandoPedidos] = useState(true);
  const [periodoFiltro, setPeriodoFiltro] = useState<string>("ano-atual");
  // Para não-admins, força o filtro pelo vendedor logado
  const [vendedorFiltro, setVendedorFiltro] = useState<string>(() => {
    return isAdmin ? "todos" : (vendedorNome || "todos");
  });
  const [valorMinimoFiltro, setValorMinimoFiltro] = useState<number>(() => {
    const saved = localStorage.getItem(`controleVendas:valorMinimoFiltro:${session?.user.id || 'sem-sessao'}`);
    return saved ? parseFloat(saved) || 0 : 0;
  });
  const [valorMinimoCustom, setValorMinimoCustom] = useState<string>("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const filtroValorMinimo = valorMinimoFiltro > 0;
  const [mesSelecionado, setMesSelecionado] = useState<number>(new Date().getMonth());
  const [anoSelecionado, setAnoSelecionado] = useState<number>(new Date().getFullYear());
  // Filtros locais da Listagem de Vendas (não afetam KPIs/gráficos)
  const [tabelaFiltroUF, setTabelaFiltroUF] = useState<string>("todos");
  const [tabelaFiltroVendedor, setTabelaFiltroVendedor] = useState<string>("todos");
  const [tabelaFiltroOrigem, setTabelaFiltroOrigem] = useState<string>("todos");
  const [tabelaFiltroStatus, setTabelaFiltroStatus] = useState<string>("todos");
  const [tabelaBusca, setTabelaBusca] = useState<string>("");
  const metaStorageKey = `controleVendas:metaGeral:${session?.user.id || 'sem-sessao'}`;
  const [metaGeral, setMetaGeral] = useState<number>(() => {
    const saved = localStorage.getItem(metaStorageKey);
    return saved ? parseFloat(saved) : 0;
  });
  const metaDono = useRef(metaStorageKey);
  const [analiseConsulta, setAnaliseConsulta] = useState<{ contexto: string; analise: string | null }>({ contexto: '', analise: null });
  const [analisandoIA, setAnalisandoIA] = useState(false);
  const [exportingPDF, setExportingPDF] = useState(false);
  const [falhaPedidos, setFalhaPedidos] = useState<{ contexto: string; mensagem: string | null }>({ contexto: '', mensagem: null });
  const [falhaAno, setFalhaAno] = useState<{ contexto: string; mensagem: string | null }>({ contexto: '', mensagem: null });
  const [loadingAnoCompleto, setLoadingAnoCompleto] = useState(false);
  const [bloqueioConsulta, setBloqueioConsulta] = useState<{ contexto: string; mensagem: string }>({ contexto: '', mensagem: '' });
  const bloqueioAtualRef = useRef('');
  const acessoNegado = !!authContexto && bloqueioConsulta.contexto === authContexto;
  const contextoPedidos = [authContexto, periodoFiltro, vendedorFiltro, mesSelecionado, anoSelecionado].join('|');
  const contextoAno = [authContexto, vendedorFiltro].join('|');
  const pedidosAtual = useRef(contextoPedidos);
  pedidosAtual.current = contextoPedidos;
  const anoAtualRef = useRef(contextoAno);
  anoAtualRef.current = contextoAno;
  const geracaoPedidos = useRef(0);
  const geracaoAno = useRef(0);
  const geracaoAnalise = useRef(0);
  const analiseController = useRef<AbortController | null>(null);
  const montado = useRef(true);
  const pdfToast = useRef<string | number | null>(null);
  const pedidos = authContexto && !acessoNegado && consultaPedidos.contexto === contextoPedidos ? consultaPedidos.data : [];
  const pedidosAnoCompleto = authContexto && !acessoNegado && consultaAno.contexto === contextoAno ? consultaAno.data : [];
  const erroPedidos = acessoNegado ? bloqueioConsulta.mensagem : falhaPedidos.contexto === contextoPedidos ? falhaPedidos.mensagem : null;
  const erroAnoCompleto = falhaAno.contexto === contextoAno ? falhaAno.mensagem : null;
  const loading = !acessoNegado && (carregandoPedidos || !authContexto || (consultaPedidos.contexto !== contextoPedidos && !erroPedidos));
  const estadoEvolucaoAnual = { carregando: loadingAnoCompleto, erro: erroAnoCompleto, contexto: contextoAno, contextoConsulta: consultaAno.contexto };
  const evolucaoAnualPronta = !!authContexto && !acessoNegado && evolucaoAnualPDFPronta(estadoEvolucaoAnual);
  const contextoAnalise = [contextoPedidos, valorMinimoFiltro].join('|');
  const analiseAtual = useRef(contextoAnalise);
  analiseAtual.current = contextoAnalise;
  const analiseIA = authContexto && !acessoNegado && !loading && analiseConsulta.contexto === contextoAnalise ? analiseConsulta.analise : null;

  // Refs para captura de gráficos
  const evolucaoChartRef = useRef<HTMLDivElement>(null);
  const vendedorChartRef = useRef<HTMLDivElement>(null);
  const mapaRef = useRef<HTMLDivElement>(null);
  const origemChartRef = useRef<HTMLDivElement>(null);
  const conversoesRapidasRef = useRef<HTMLDivElement>(null);
  const tempoConversaoRef = useRef<HTMLDivElement>(null);

  const toast = ({ title, description, variant }: { title: string; description?: string; variant?: string }) => {
    if (variant === 'destructive') sonnerToast.error(title, { description });
    else sonnerToast.message(title, { description });
  };
  const navigate = useNavigate();

  // O gate pai pode desmontar a página sem lhe entregar um novo render de Auth.
  useLayoutEffect(() => {
    montado.current = true;
    authAtual.current = authContexto;
    pedidosAtual.current = contextoPedidos;
    anoAtualRef.current = contextoAno;
    analiseAtual.current = contextoAnalise;
    return () => {
      montado.current = false;
      authAtual.current = ''; pedidosAtual.current = ''; anoAtualRef.current = ''; analiseAtual.current = '';
      geracaoPedidos.current++; geracaoAno.current++; geracaoAnalise.current++;
      analiseController.current?.abort();
      if (pdfToast.current != null) sonnerToast.dismiss(pdfToast.current);
      pdfToast.current = null;
    };
    // Setup restaura refs no replay StrictMode; gerações invalidadas não retrocedem.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const negarLeituras = (error: { status?: number; message?: string }) => {
    if (error.status !== 401 && error.status !== 403) return;
    bloqueioAtualRef.current = authContexto;
    geracaoPedidos.current++; geracaoAno.current++; geracaoAnalise.current++;
    analiseController.current?.abort();
    setBloqueioConsulta({ contexto: authContexto, mensagem: error.message || 'Sem permissão para consultar essas vendas.' });
    setConsultaPedidos({ contexto: '', data: [] }); setConsultaAno({ contexto: '', data: [] });
    setVendedoresConsulta({ contexto: '', data: [] });
    setEscopoConsulta({ contexto: '', global: false, vendedorNome: null });
    setAnaliseConsulta({ contexto: '', analise: null }); setAnalisandoIA(false);
    setCarregandoPedidos(false); setLoadingAnoCompleto(false);
  };

  useEffect(() => {
    if (authContexto && metaDono.current === metaStorageKey) localStorage.setItem(metaStorageKey, metaGeral.toString());
  }, [metaGeral, metaStorageKey, authContexto]);

  // Recarrega meta ao trocar contexto de usuário
  useEffect(() => {
    const saved = localStorage.getItem(metaStorageKey);
    metaDono.current = metaStorageKey;
    setMetaGeral(saved ? parseFloat(saved) : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metaStorageKey]);

  const carregarPedidos = async (signal?: AbortSignal, tentarNovamente = false) => {
    if (!authContexto) return;
    if (bloqueioAtualRef.current === authContexto) {
      if (!tentarNovamente) return;
      bloqueioAtualRef.current = '';
      setBloqueioConsulta({ contexto: '', mensagem: '' });
    }
    const captura = contextoPedidos;
    const geracao = ++geracaoPedidos.current;
    const vigente = () => consultaPertenceAoContexto(captura, pedidosAtual.current, geracao, geracaoPedidos.current, !!signal?.aborted);
    try {
      setCarregandoPedidos(true);
      setFalhaPedidos({ contexto: captura, mensagem: null });
      const hoje = new Date();
      let dataInicio: Date | undefined;
      let dataFim: Date | undefined;

      switch (periodoFiltro) {
        case "mes-atual":
          dataInicio = startOfMonth(hoje);
          dataFim = endOfMonth(hoje);
          break;
        case "mes-passado":
          const anterior = periodoMesAnterior(hoje);
          dataInicio = new Date(anterior.inicio + 'T00:00:00');
          dataFim = new Date(anterior.fim + 'T00:00:00');
          break;
        case "mes-especifico":
          dataInicio = new Date(anoSelecionado, mesSelecionado, 1);
          dataFim = new Date(anoSelecionado, mesSelecionado + 1, 0);
          break;
        case "trimestre-atual":
          const trimestreAtual = Math.floor(hoje.getMonth() / 3);
          dataInicio = new Date(hoje.getFullYear(), trimestreAtual * 3, 1);
          dataFim = new Date(hoje.getFullYear(), trimestreAtual * 3 + 3, 0);
          break;
        case "ano-atual":
          dataInicio = startOfYear(hoje);
          dataFim = endOfYear(hoje);
          break;
        default:
          dataInicio = startOfYear(hoje);
          dataFim = endOfYear(hoje);
      }

      const payload = await buscarVendasControle({
        inicio: format(dataInicio!, 'yyyy-MM-dd'), fim: format(dataFim!, 'yyyy-MM-dd'),
        ...(vendedorFiltro !== 'todos' ? { vendedor: vendedorFiltro } : {}), signal,
      });
      if (!vigente()) return;
      setEscopoConsulta({ contexto: authContexto, ...payload.escopo });
      setVendedoresConsulta({ contexto: authContexto, data: payload.vendedores });
      const raw = ((payload.data || []) as Pedido[]).filter(
        (p) => (p.fonte_origem || '').toLowerCase().trim() !== 'garantia'
      );

      const periodoStart = dataInicio ? format(dataInicio, 'yyyy-MM-dd') : '';
      const periodoEnd = dataFim ? format(dataFim, 'yyyy-MM-dd') : '';
      const vendedorEfetivo = payload.escopo.global ? vendedorFiltro : payload.escopo.vendedorNome!;
      setConsultaPedidos({ contexto: captura, data: expandirPedidos(raw, periodoStart, periodoEnd, vendedorEfetivo) });
    } catch (error: any) {
      if (!vigente() || error?.name === 'AbortError') return;
      negarLeituras(error);
      console.error("Erro ao carregar pedidos:", error);
      const msg = error?.message || "Falha de conexão com o servidor.";
      setFalhaPedidos({ contexto: captura, mensagem: msg });
      setConsultaPedidos({ contexto: captura, data: [] });
      toast({
        title: "Erro ao carregar vendas",
        description: msg,
        variant: "destructive"
      });
    } finally {
      if (vigente()) setCarregandoPedidos(false);
    }
  };

  // Carrega pedidos do ano completo (para gráfico de evolução - respeita filtro de vendedor)
  const carregarPedidosAnoCompleto = async (signal?: AbortSignal) => {
    if (!authContexto || bloqueioAtualRef.current === authContexto) return;
    const captura = contextoAno;
    const geracao = ++geracaoAno.current;
    const vigente = () => consultaPertenceAoContexto(captura, anoAtualRef.current, geracao, geracaoAno.current, !!signal?.aborted);
    try {
      setLoadingAnoCompleto(true);
      setFalhaAno({ contexto: captura, mensagem: null });
      const hoje = new Date();
      const periodoStart = format(startOfYear(hoje), 'yyyy-MM-dd');
      const periodoEnd = format(endOfYear(hoje), 'yyyy-MM-dd');
      const payload = await buscarVendasControle({ inicio: periodoStart, fim: periodoEnd,
        ...(vendedorFiltro !== 'todos' ? { vendedor: vendedorFiltro } : {}), signal });
      if (!vigente()) return;
      const raw = ((payload.data || []) as Pedido[]).filter((p) => (p.fonte_origem || '').toLowerCase().trim() !== 'garantia');
      const vendedorEfetivo = payload.escopo.global ? vendedorFiltro : payload.escopo.vendedorNome!;
      setConsultaAno({ contexto: captura, data: expandirPedidos(raw, periodoStart, periodoEnd, vendedorEfetivo) });
    } catch (error: any) {
      if (!vigente() || error?.name === 'AbortError') return;
      negarLeituras(error);
      setFalhaAno({ contexto: captura, mensagem: error?.message || 'Falha ao carregar evolução anual.' });
      setConsultaAno({ contexto: captura, data: [] });
    } finally {
      if (vigente()) setLoadingAnoCompleto(false);
    }
  };

  // Sincroniza filtro de vendedor com nome do vendedor logado quando auth resolve
  useEffect(() => {
    if (!isAdmin && vendedorNome && vendedorFiltro !== vendedorNome) {
      setVendedorFiltro(vendedorNome);
    }
  }, [isAdmin, vendedorNome]);

  useEffect(() => {
    const controller = new AbortController();
    carregarPedidos(controller.signal);
    return () => controller.abort();
  }, [authContexto, periodoFiltro, vendedorFiltro, mesSelecionado, anoSelecionado]);

  useEffect(() => {
    const controller = new AbortController();
    carregarPedidosAnoCompleto(controller.signal);
    return () => controller.abort();
  }, [authContexto, vendedorFiltro]);

  useEffect(() => {
    bloqueioAtualRef.current = '';
    setBloqueioConsulta({ contexto: '', mensagem: '' });
    setEscopoConsulta({ contexto: '', global: false, vendedorNome: null });
    setVendedoresConsulta({ contexto: '', data: [] });
    setVendedorFiltro('todos');
    setExportingPDF(false);
    const saved = localStorage.getItem(`controleVendas:valorMinimoFiltro:${session?.user.id || 'sem-sessao'}`);
    setValorMinimoFiltro(saved ? parseFloat(saved) || 0 : 0);
    setTabelaFiltroUF('todos'); setTabelaFiltroVendedor('todos'); setTabelaFiltroOrigem('todos'); setTabelaFiltroStatus('todos'); setTabelaBusca('');
  }, [authContexto]);
  useEffect(() => {
    analiseController.current?.abort();
    geracaoAnalise.current++;
    setAnalisandoIA(false);
    setAnaliseConsulta({ contexto: '', analise: null });
    return () => analiseController.current?.abort();
  }, [contextoAnalise]);

  // Função para analisar com IA
  const analisarComIA = async () => {
    if (acessoNegado || loading || pedidosFiltrados.length === 0) {
      toast({ title: "Sem dados", description: "Carregue os dados de vendas primeiro.", variant: "destructive" });
      return;
    }

    const captura = contextoAnalise;
    const geracao = ++geracaoAnalise.current;
    const controller = new AbortController();
    analiseController.current?.abort();
    analiseController.current = controller;
    const vigente = () => consultaPertenceAoContexto(captura, analiseAtual.current, geracao, geracaoAnalise.current, controller.signal.aborted);
    setAnalisandoIA(true);
    setAnaliseConsulta({ contexto: captura, analise: null });

    try {
      const hojeIA = new Date();
      let periodoTexto = '';
      if (periodoFiltro === 'mes-atual') {
        periodoTexto = format(hojeIA, "MMMM 'de' yyyy", { locale: ptBR });
      } else if (periodoFiltro === 'mes-passado') {
        const mp = new Date(hojeIA.getFullYear(), hojeIA.getMonth() - 1, 1);
        periodoTexto = format(mp, "MMMM 'de' yyyy", { locale: ptBR });
      } else if (periodoFiltro === 'mes-especifico') {
        periodoTexto = format(new Date(anoSelecionado, mesSelecionado, 1), "MMMM 'de' yyyy", { locale: ptBR });
      } else if (periodoFiltro === 'trimestre-atual') {
        periodoTexto = `Trimestre ${Math.floor(hojeIA.getMonth() / 3) + 1} de ${hojeIA.getFullYear()}`;
      } else {
        periodoTexto = `Ano de ${hojeIA.getFullYear()}`;
      }
      periodoTexto = periodoTexto.charAt(0).toUpperCase() + periodoTexto.slice(1);

      const dados = {
        periodo: periodoTexto,
        totalVendas: valorTotal,
        quantidadePedidos: totalVendas,
        ticketMedio: ticketMedio,
        vendedores: vendasPorVendedor.slice(0, 8).map(v => ({
          nome: v.vendedor,
          valor: v.valor,
          pedidos: v.quantidade
        })),
        estados: dadosEstados.map(e => ({
          estado: e.estado,
          valor: e.valor,
          pedidos: e.quantidade
        })),
        origens: dadosOrigem.map(o => ({
          origem: o.origem,
          valor: o.valor,
          pedidos: o.quantidade
        })),
        conversoesRapidas: dadosConversoesRapidas.map(c => ({
          origem: c.origem,
          conversoes: c.quantidade
        })),
        tempoConversao: dadosTempoConversao.map(t => ({
          origem: t.origem,
          mediaDias: t.mediaDias
        })),
        equipamentos: [...dadosFabricas.map(f => ({ nome: f.fabrica, quantidade: f.quantidade })), 
                       ...dadosEquipamentos.map(e => ({ nome: e.equipamento, quantidade: e.quantidade }))]
      };

      const response = await analisarVendasControle({ dados, signal: controller.signal });
      if (!vigente()) return;
      setAnaliseConsulta({ contexto: captura, analise: response.analise });
    } catch (error: any) {
      if (!vigente() || error?.name === 'AbortError') return;
      negarLeituras(error);
      toast({
        title: "Erro na análise",
        description: error.message || "Não foi possível analisar os dados.",
        variant: "destructive"
      });
    } finally {
      if (vigente()) setAnalisandoIA(false);
    }
  };

  // Valor TOTAL real do pedido pai (ignora _valorOverride de splits/ajustes)
  // Usado para o filtro de valor mínimo, evitando excluir linhas de ajuste negativo
  // que inflariam o total artificialmente.
  const getValorTotalPedidoPai = (p: Pedido): number => {
    const paymentTotal = p.payment_plan_json?.total ? Number(p.payment_plan_json.total) : 0;
    const base = paymentTotal > 0 ? paymentTotal : (Number(p.valor_total) || 0);
    const ajuste = Number(p.ajuste_valor) || 0;
    return base + ajuste;
  };
  const passaFiltroValorMinimo = (p: Pedido) =>
    !filtroValorMinimo || getValorTotalPedidoPai(p) >= valorMinimoFiltro;

  // Lista de pedidos respeitando o filtro de valor mínimo (mantém todos os status)
  const pedidosFiltrados = pedidos.filter(passaFiltroValorMinimo);
  // Métricas principais - excluir cancelados dos cálculos de valor
  const auditoriaVendas = resumoAuditoriaVendas(pedidos, valorMinimoFiltro);
  const { pedidosAtivos, totalCarregados, totalCancelados, excluidosPorValor } = auditoriaVendas;
  const vendasFisicas = pedidosFisicos(pedidosAtivos);
  const valorTotal = pedidosAtivos.reduce((acc, p) => acc + getValorPedido(p), 0);
  const totalVendas = pedidosAtivos.length;
  const ticketMedio = totalVendas > 0 ? valorTotal / totalVendas : 0;

  // ===== Auditoria do filtro =====

  const comDataContato = vendasFisicas.filter(p => diasEntreContatoEVenda(p.data_primeiro_contato, p.data_venda) !== null).length;
  const comEstado = pedidosAtivos.filter(p => p.estado && p.estado !== 'N/D').length;
  const comOrigem = pedidosAtivos.filter(p => normalizarOrigem(p.fonte_origem) !== 'Não informado').length;
  const conversoesMesmoMes = vendasFisicas.filter(p => conversaoNoMesmoMes(p.data_primeiro_contato, p.data_venda)).length;

  // Nomes usados nas agregações por vendedor: cadastrados + quem de fato tem venda
  // no período. A união é o que garante que a soma do ranking feche com o
  // faturamento total acima — antes o ranking iterava uma lista fixa e deixava de
  // fora quem não estivesse nela (LUCAS, IGOR), sem que o total mudasse.
  const nomesVendedores = mesclarVendedoresComDados(
    vendedoresCadastrados,
    pedidosAtivos.map(p => p.vendedor)
  );

  // Ranking de vendedores
  const vendasPorVendedor = nomesVendedores.map(vendedor => {
    // normalizarVendedor (mesma funcao que monta nomesVendedores) em vez de so
    // toUpperCase: sem o trim, "JARDEL " entra na lista como "JARDEL" mas nao casa
    // aqui, e o pedido some do ranking sem sair do total.
    const vendas = pedidosAtivos.filter(p => normalizarVendedor(p.vendedor) === vendedor);
    const valor = vendas.reduce((acc, p) => acc + getValorPedido(p), 0);
    return {
      vendedor,
      valor,
      quantidade: vendas.length,
      ticketMedio: vendas.length > 0 ? valor / vendas.length : 0
    };
  }).sort((a, b) => b.valor - a.valor);

  // Evolução mensal - usa pedidos do ano completo (ignora filtro)
  const anoAtual = new Date().getFullYear();
  const todosOsMeses = Array.from({ length: 12 }, (_, i) => {
    const data = new Date(anoAtual, i, 1);
    return {
      mes: format(data, "MMM/yy", { locale: ptBR }),
      chave: `${anoAtual}-${String(i + 1).padStart(2, '0')}`,
      valor: 0,
      quantidade: 0
    };
  });

  const vendasPorMesMap = pedidosAnoCompleto.filter(p => p.status !== 'CANCELADO' && passaFiltroValorMinimo(p)).reduce((acc, pedido) => {
    const [ano, mes] = pedido.data_venda.split('T')[0].split('-');
    const chave = `${ano}-${mes}`;
    
    if (!acc[chave]) {
      const dataFormatada = new Date(parseInt(ano), parseInt(mes) - 1, 1);
      acc[chave] = { mes: format(dataFormatada, "MMM/yy", { locale: ptBR }), chave, valor: 0, quantidade: 0 };
    }
    acc[chave].valor += getValorPedido(pedido);
    acc[chave].quantidade += 1;
    return acc;
  }, {} as Record<string, { mes: string; chave: string; valor: number; quantidade: number }>);

  // Mescla todos os meses com os dados de vendas
  const dadosVendasPorMes = todosOsMeses.map(mesBase => {
    const dadosVenda = vendasPorMesMap[mesBase.chave];
    return dadosVenda || mesBase;
  });

  // Unidades físicas: um pedido compartilhado conta uma vez; acréscimos não vendem novas unidades.
  const dadosFabricas = agruparFabricasVendidas(pedidosAtivos);
  const dadosEquipamentos = agruparEquipamentosVendidos(pedidosAtivos);

  // Tempo médio de fechamento por vendedor
  const tempoMedioPorVendedor = nomesVendedores.map(vendedor => {
    const vendas = pedidosFisicos(pedidosAtivos.filter(p => normalizarVendedor(p.vendedor) === vendedor))
      .filter(p => diasEntreContatoEVenda(p.data_primeiro_contato, p.data_venda) !== null);
    
    if (vendas.length === 0) return { vendedor, dias: 0, quantidade: 0 };
    
    const totalDias = vendas.reduce((acc, p) => {
      return acc + diasEntreContatoEVenda(p.data_primeiro_contato, p.data_venda)!;
    }, 0);
    
    return {
      vendedor,
      dias: Math.round(totalDias / vendas.length),
      quantidade: vendas.length
    };
  }).filter(v => v.quantidade > 0).sort((a, b) => a.dias - b.dias);

  // O mapa recebe todos os estados; somente os rankings exibem os dez primeiros.
  const dadosEstados = agruparVendasPorEstado(pedidosAtivos);

  // Origem dos clientes
  const vendasPorOrigem = pedidosAtivos.reduce((acc, pedido) => {
    const origem = normalizarOrigem(pedido.fonte_origem);
    if (!acc[origem]) {
      acc[origem] = { origem, valor: 0, quantidade: 0 };
    }
    acc[origem].valor += getValorPedido(pedido);
    acc[origem].quantidade += 1;
    return acc;
  }, {} as Record<string, { origem: string; valor: number; quantidade: number }>);

  const dadosTodasOrigens = Object.values(vendasPorOrigem)
    .sort((a, b) => b.valor - a.valor);
  const dadosOrigem = dadosTodasOrigens.slice(0, 8);

  // Conversões Rápidas - vendas que começaram e fecharam no mesmo mês por origem
  const conversoesRapidas = vendasFisicas.reduce((acc, pedido) => {
    // Contato posterior à venda não representa uma conversão válida.
    if (conversaoNoMesmoMes(pedido.data_primeiro_contato, pedido.data_venda)) {
      const origem = normalizarOrigem(pedido.fonte_origem);
      if (!acc[origem]) {
        acc[origem] = { origem, quantidade: 0, valor: 0 };
      }
      acc[origem].quantidade += 1;
      acc[origem].valor += valorVendaFisica(pedido);
    }
    
    return acc;
  }, {} as Record<string, { origem: string; quantidade: number; valor: number }>);

  const dadosConversoesRapidas = Object.values(conversoesRapidas)
    .filter(item => item.origem !== 'N/D')
    .sort((a, b) => b.quantidade - a.quantidade);

  // Tempo médio de conversão por origem
  const tempoConversaoPorOrigem = vendasFisicas.reduce((acc, pedido) => {
    const dias = diasEntreContatoEVenda(pedido.data_primeiro_contato, pedido.data_venda);
    if (dias === null) return acc;
    
    const origem = normalizarOrigem(pedido.fonte_origem);
    if (!acc[origem]) {
      acc[origem] = { origem, totalDias: 0, quantidade: 0, valor: 0 };
    }
    acc[origem].totalDias += dias;
    acc[origem].quantidade += 1;
    acc[origem].valor += valorVendaFisica(pedido);
    
    return acc;
  }, {} as Record<string, { origem: string; totalDias: number; quantidade: number; valor: number }>);

  const dadosTempoConversao = Object.values(tempoConversaoPorOrigem)
    .filter(item => item.origem !== 'N/D' && item.quantidade > 0)
    .map(item => ({
      origem: item.origem,
      mediaDias: Math.round(item.totalDias / item.quantidade),
      quantidade: item.quantidade,
      valor: item.valor
    }))
    .sort((a, b) => a.mediaDias - b.mediaDias); // Ordena por menor tempo (melhor)

  const getRankIcon = (position: number) => {
    switch (position) {
      case 0: return <Trophy className="h-6 w-6 text-yellow-500" />;
      case 1: return <Medal className="h-5 w-5 text-slate-400" />;
      case 2: return <Medal className="h-5 w-5 text-amber-600" />;
      default: return <span className="text-muted-foreground font-bold">{position + 1}º</span>;
    }
  };

  const exportarPDF = async () => {
    if (loading || exportingPDF || !authContexto || !pedidos.length) return;
    const capturaPDF = { dono: authContexto, consulta: contextoAnalise, geracaoPedidos: geracaoPedidos.current, geracaoAno: geracaoAno.current };
    const validarExportacao = () => {
      if (!exportacaoPertenceAoContexto(capturaPDF, {
        montado: montado.current, dono: authAtual.current, consulta: analiseAtual.current,
        geracaoPedidos: geracaoPedidos.current, geracaoAno: geracaoAno.current, acessoNegado: bloqueioAtualRef.current === authContexto,
      })) throw new Error('A sessão ou os filtros mudaram. Gere o relatório novamente.');
    };
    setExportingPDF(true);
    const toastDestaExportacao = sonnerToast.loading('Gerando relatório premium...');
    pdfToast.current = toastDestaExportacao;
    try {
      exigirEvolucaoAnualPDF(estadoEvolucaoAnual);
      validarExportacao();
      const geradoEm = new Date();
      const dataPeriodo = periodoFiltro === 'mes-passado'
        ? new Date(geradoEm.getFullYear(), geradoEm.getMonth() - 1, 1)
        : periodoFiltro === 'mes-especifico'
          ? new Date(anoSelecionado, mesSelecionado, 1) : geradoEm;
      const periodo = periodoFiltro === 'trimestre-atual'
        ? `Trimestre ${Math.floor(geradoEm.getMonth() / 3) + 1} de ${geradoEm.getFullYear()}`
        : periodoFiltro === 'ano-atual'
          ? `Ano de ${geradoEm.getFullYear()}`
          : format(dataPeriodo, "MMMM 'de' yyyy", { locale: ptBR });
      // Congela as séries da mesma renderização antes da captura assíncrona do mapa.
      const dadosPDF: Omit<RelatorioVendasPDFInput, 'mapa'> = {
        geradoEm, periodo: periodo.charAt(0).toUpperCase() + periodo.slice(1),
        anoEvolucao: anoAtual, vendedor: vendedorFiltro === 'todos' ? 'Todos os vendedores' : vendedorFiltro,
        valorMinimo: valorMinimoFiltro, valorTotal, totalRegistros: totalVendas, ticketMedio,
        pedidosUnicos: vendasFisicas.length, ajustes: pedidosAtivos.filter(p => p._isAjuste).length,
        cancelados: pedidosFiltrados.filter(p => p.status === 'CANCELADO').length, meta: metaGeral,
        vendedores: vendasPorVendedor.map(v => ({ ...v })), evolucao: dadosVendasPorMes.map(v => ({ ...v })),
        fabricas: dadosFabricas.map(v => ({ ...v })), equipamentos: dadosEquipamentos.map(v => ({ ...v })),
        fechamento: tempoMedioPorVendedor.map(v => ({ ...v })), estados: dadosEstados.map(v => ({ ...v })),
        origens: dadosTodasOrigens.map(v => ({ ...v })), rapidas: dadosConversoesRapidas.map(v => ({ ...v })),
        conversao: dadosTempoConversao.map(v => ({ ...v })), registros: pedidosFiltrados.map(p => ({ ...p })),
        // Mantém a regra do Controle e o escopo global autorizado da consulta.
        comissoes: isAdmin ? vendasPorVendedor
          .filter(v => v.valor > 0 && !['DANIEL', 'PATRICK'].includes(normalizarVendedor(v.vendedor)))
          .map(v => {
            const config = vendedoresFonte.find(vc => normalizarVendedor(vc.nome) === normalizarVendedor(v.vendedor));
            const percentual = percentualComissaoControle(config?.percentual_comissao);
            return { vendedor: v.vendedor, quantidade: v.quantidade, valor: v.valor, percentual, comissao: v.valor * percentual / 100 };
          }) : undefined,
      };
      const mapaElemento = mapaRef.current;
      if (!mapaElemento) throw new Error('O mapa ainda não está disponível. Gere o relatório novamente.');
      const mapa = await capturaMapaPDF(async () => {
        const canvas = await html2canvas(mapaElemento, {
          backgroundColor: '#ffffff', scale: 1.5, useCORS: true, logging: false,
          onclone: clonedDoc => {
            clonedDoc.documentElement.classList.remove('dark');
            clonedDoc.body.classList.remove('dark');
            clonedDoc.querySelectorAll('.controle-vendas-original').forEach(el => (el as HTMLElement).classList.add('controle-vendas-original-pdf'));
            const wrapper = clonedDoc.querySelector('[data-pdf-mapa]') as HTMLElement | null;
            if (wrapper) {
              wrapper.style.backgroundColor = '#ffffff';
              wrapper.style.color = '#0f172a';
              wrapper.querySelectorAll('svg path').forEach(path => {
                if ((path.getAttribute('stroke') || '').toLowerCase() === '#ffffff') {
                  path.setAttribute('stroke', '#94a3b8');
                  path.setAttribute('stroke-width', '0.6');
                }
              });
            }
          },
        });
        if (!canvas.width || !canvas.height) throw new Error('Mapa sem dimensões.');
        return { imagem: canvas.toDataURL('image/jpeg', 0.88), largura: canvas.width, altura: canvas.height };
      });
      validarExportacao();
      const doc = await criarRelatorioVendasPDF({ ...dadosPDF, mapa }, validarExportacao);
      validarExportacao();
      doc.save(`relatorio-vendas-premium-${format(geradoEm, 'dd-MM-yyyy')}.pdf`);
      sonnerToast.dismiss(toastDestaExportacao);
      sonnerToast.success('Relatório Premium exportado com sucesso!');
    } catch (error) {
      if (!montado.current || authAtual.current !== authContexto) return;
      sonnerToast.dismiss(toastDestaExportacao);
      sonnerToast.error(error instanceof Error ? error.message : 'Erro ao exportar relatório.');
    } finally {
      sonnerToast.dismiss(toastDestaExportacao);
      if (pdfToast.current === toastDestaExportacao) pdfToast.current = null;
      if (montado.current && authAtual.current === authContexto) setExportingPDF(false);
    }
  };

  const faltaParaMeta = metaGeral > 0 ? Math.max(0, metaGeral - valorTotal) : 0;
  const percentualMeta = metaGeral > 0 ? Math.min(100, (valorTotal / metaGeral) * 100) : 0;

  // Filtros locais da Listagem de Vendas
  const listagemMeta = useMemo(() => ({
    ufs: Array.from(new Set(pedidosFiltrados.map(p => (p.estado || '').trim().toUpperCase()).filter(Boolean))).sort(),
    vends: Array.from(new Set(pedidosFiltrados.map(p => (p.vendedor || '').toUpperCase()).filter(Boolean))).sort(),
    origens: Array.from(new Set(pedidosFiltrados.map(p => normalizarOrigem(p.fonte_origem)).filter(o => o && o !== '-'))).sort(),
    statuses: Array.from(new Set(pedidosFiltrados.map(p => (p.status || '').toUpperCase()).filter(Boolean))).sort(),
  }), [pedidosFiltrados]);

  const listagemFiltrada = useMemo(() => {
    const busca = tabelaBusca.trim().toLowerCase();
    return pedidosFiltrados.filter(p => {
      if (tabelaFiltroUF !== 'todos' && (p.estado || '').trim().toUpperCase() !== tabelaFiltroUF) return false;
      if (tabelaFiltroVendedor !== 'todos' && (p.vendedor || '').toUpperCase() !== tabelaFiltroVendedor) return false;
      if (tabelaFiltroOrigem !== 'todos' && normalizarOrigem(p.fonte_origem) !== tabelaFiltroOrigem) return false;
      if (tabelaFiltroStatus !== 'todos' && (p.status || '').toUpperCase() !== tabelaFiltroStatus) return false;
      if (busca) {
        const alvo = `${p.pedido_numero || ''} ${p.numero_orcamento || ''} ${p.cliente || ''}`.toLowerCase();
        if (!alvo.includes(busca)) return false;
      }
      return true;
    });
  }, [pedidosFiltrados, tabelaFiltroUF, tabelaFiltroVendedor, tabelaFiltroOrigem, tabelaFiltroStatus, tabelaBusca]);

  const contextoListagem = JSON.stringify([contextoAnalise, geracaoPedidos.current, tabelaFiltroUF, tabelaFiltroVendedor, tabelaFiltroOrigem, tabelaFiltroStatus, tabelaBusca, podeAbrirPedidos]);
  const [expansaoListagem, setExpansaoListagem] = useState<string | null>(null);
  const listagemExpandida = expansaoListagem === contextoListagem;
  const listagemVisivel = linhasVisiveisVendas(listagemFiltrada, contextoListagem, expansaoListagem);
  useEffect(() => { setExpansaoListagem(null); }, [contextoListagem]);


  return (
    <div className="controle-vendas-original min-h-screen bg-background">
      {/* Header */}
      <header className="vendas-header border-b border-border bg-card">
        <div className="vendas-header-inner w-full px-4 sm:px-6 lg:px-8 py-5 sm:py-6">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            <div className="vendas-heading flex items-center gap-3">
              <div className="vendas-header-icon p-3 rounded-xl bg-primary/10 shrink-0">
                <BarChart3 className="h-5 w-5 sm:h-6 sm:w-6 text-primary" />
              </div>
              <div className="min-w-0">
                <p className="vendas-kicker text-xs font-semibold uppercase tracking-widest text-primary mb-1">Visão comercial</p>
                <h1 className="vendas-title text-2xl sm:text-3xl font-bold leading-tight">Controle de Vendas</h1>
                <p className="vendas-subtitle text-sm text-muted-foreground mt-1">Resultados, metas e desempenho da equipe</p>
              </div>
            </div>
            <div className="vendas-header-actions flex flex-wrap items-center gap-2">
              <Button onClick={exportarPDF} disabled={exportingPDF || loading || !pedidos.length || !evolucaoAnualPronta} className="vendas-export text-xs sm:text-sm" size="sm">
                {exportingPDF ? (
                  <>
                    <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    <span className="hidden sm:inline">Gerando...</span>
                    <span className="sm:hidden">...</span>
                  </>
                ) : (
                  <>
                    <Crown className="mr-1.5 h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Exportar PDF Premium</span>
                    <span className="sm:hidden">PDF</span>
                  </>
                )}
              </Button>
              <Button onClick={() => navigate("/controle")} variant="outline" size="sm" className="text-xs sm:text-sm">
                <Home className="mr-1 sm:mr-2 h-3.5 w-3.5 sm:h-4 sm:w-4" />
                Menu
              </Button>
              <Button onClick={async () => { await signOut(); navigate("/login"); }} variant="ghost" size="sm" aria-label="Sair">
                <LogOut className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
              </Button>
            </div>
          </div>
        </div>
      </header>

      <div className="vendas-main w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Filtros */}
        <Card className="vendas-panel vendas-filters">
          <CardContent className="vendas-panel-content py-5">
            <div className="vendas-filter-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 items-end">
              <div className="vendas-filter-field min-w-0">
                <label className="vendas-filter-label text-xs font-semibold mb-2 block">Período</label>
                <Select value={periodoFiltro} onValueChange={setPeriodoFiltro}>
                  <SelectTrigger className="vendas-filter-control">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="mes-atual">Mês Atual</SelectItem>
                    <SelectItem value="mes-passado">Mês Passado</SelectItem>
                    <SelectItem value="mes-especifico">Mês Específico</SelectItem>
                    <SelectItem value="trimestre-atual">Trimestre Atual</SelectItem>
                    <SelectItem value="ano-atual">Ano Atual</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {periodoFiltro === "mes-especifico" && (
                <>
                  <div className="vendas-filter-field min-w-0">
                    <label className="vendas-filter-label text-xs font-semibold mb-2 block">Mês</label>
                    <Select value={String(mesSelecionado)} onValueChange={v => setMesSelecionado(Number(v))}>
                      <SelectTrigger className="vendas-filter-control">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"].map((mes, i) => (
                          <SelectItem key={i} value={String(i)}>{mes}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="vendas-filter-field min-w-0">
                    <label className="vendas-filter-label text-xs font-semibold mb-2 block">Ano</label>
                    <Select value={String(anoSelecionado)} onValueChange={v => setAnoSelecionado(Number(v))}>
                      <SelectTrigger className="vendas-filter-control">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {[2023, 2024, 2025, 2026].map(ano => (
                          <SelectItem key={ano} value={String(ano)}>{ano}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </>
              )}

              {/* Vendedor - Somente para admins */}
              {isAdmin && (
                <div className="vendas-filter-field min-w-0">
                  <label className="vendas-filter-label text-xs font-semibold mb-2 block">Vendedor</label>
                  <Select value={vendedorFiltro} onValueChange={setVendedorFiltro}>
                    <SelectTrigger className="vendas-filter-control">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos os Vendedores</SelectItem>
                      {vendedoresCadastrados.map(v => <SelectItem key={v} value={v}>{v}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="vendas-filter-field vendas-minimum-filter min-w-0">
                <label className="vendas-filter-label text-xs font-semibold mb-2 flex items-center gap-1.5">
                  <Filter className={`h-3.5 w-3.5 ${filtroValorMinimo ? 'text-primary' : 'text-muted-foreground'}`} />
                  Valor mínimo
                </label>
                <div className="vendas-minimum-controls flex items-center gap-2 flex-wrap">
                <Select
                  value={showCustomInput ? "custom" : String(valorMinimoFiltro)}
                  onValueChange={(v) => {
                    if (v === "custom") {
                      setShowCustomInput(true);
                      setValorMinimoCustom(valorMinimoFiltro > 0 ? valorMinimoFiltro.toLocaleString('pt-BR') : "");
                    } else {
                      setShowCustomInput(false);
                      const num = Number(v);
                      setValorMinimoFiltro(num);
                      localStorage.setItem(`controleVendas:valorMinimoFiltro:${session?.user.id || 'sem-sessao'}`, String(num));
                    }
                  }}
                >
                  <SelectTrigger className="vendas-filter-control flex-1 min-w-[150px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0">Todos os valores</SelectItem>
                    <SelectItem value="1000">Acima de R$ 1.000</SelectItem>
                    <SelectItem value="5000">Acima de R$ 5.000</SelectItem>
                    <SelectItem value="10000">Acima de R$ 10.000</SelectItem>
                    <SelectItem value="25000">Acima de R$ 25.000</SelectItem>
                    <SelectItem value="50000">Acima de R$ 50.000</SelectItem>
                    <SelectItem value="100000">Acima de R$ 100.000</SelectItem>
                    <SelectItem value="custom">Personalizado…</SelectItem>
                  </SelectContent>
                </Select>
                {showCustomInput && (
                  <div className="flex items-center gap-1">
                    <span className="text-sm text-muted-foreground">R$</span>
                    <Input
                      type="text"
                      inputMode="decimal"
                      placeholder="Ex: 15.000"
                      value={valorMinimoCustom}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/[^\d,]/g, '');
                        setValorMinimoCustom(raw);
                        const num = parseFloat(raw.replace(/\./g, '').replace(',', '.')) || 0;
                        setValorMinimoFiltro(num);
                        localStorage.setItem(`controleVendas:valorMinimoFiltro:${session?.user.id || 'sem-sessao'}`, String(num));
                      }}
                      className="w-32 h-9"
                      autoFocus
                    />
                  </div>
                )}
                {filtroValorMinimo && (
                  <button
                    onClick={() => {
                      setValorMinimoFiltro(0);
                      setShowCustomInput(false);
                      setValorMinimoCustom("");
                      localStorage.setItem(`controleVendas:valorMinimoFiltro:${session?.user.id || 'sem-sessao'}`, "0");
                    }}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                    title="Limpar filtro"
                  >
                    ≥ {valorMinimoFiltro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}
                    <X className="h-3 w-3" />
                  </button>
                )}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Auditoria do filtro */}
        {!loading && !erroPedidos && pedidos.length > 0 && (
          <Card className="vendas-panel vendas-audit border-border/40 bg-muted/20">
            <CardContent className="vendas-panel-content py-3">
              <details className="group">
                <summary className="flex items-center gap-2 cursor-pointer list-none select-none">
                  <Filter className="h-4 w-4 text-primary" />
                  <span className="text-sm font-semibold">Auditoria do filtro</span>
                  <span className="text-xs text-muted-foreground">
                    {pedidosAtivos.length} de {totalCarregados} registros ativos
                    {filtroValorMinimo && ` • ${excluidosPorValor} excluídos por valor mínimo`}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground group-open:hidden">▼ expandir</span>
                  <span className="ml-auto text-xs text-muted-foreground hidden group-open:inline">▲ recolher</span>
                </summary>

                <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                  <div className="rounded-md border border-border/40 bg-card p-3 space-y-1">
                    <p className="font-semibold text-sm mb-1">📊 Pipeline de filtragem</p>
                    <div className="flex justify-between"><span className="text-muted-foreground">Carregados (período)</span><span className="font-mono font-semibold">{totalCarregados}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">— Cancelados</span><span className="font-mono">{totalCancelados}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">— Abaixo do valor mínimo</span><span className="font-mono">{excluidosPorValor}</span></div>
                    <div className="flex justify-between border-t border-border/40 pt-1 mt-1"><span className="font-semibold">= Registros ativos (base)</span><span className="font-mono font-bold text-primary">{pedidosAtivos.length}</span></div>
                  </div>

                  <div className="rounded-md border border-border/40 bg-card p-3 space-y-1">
                    <p className="font-semibold text-sm mb-1">⚙️ Critério de valor</p>
                    <p className="text-muted-foreground">
                      <span className="font-mono bg-muted px-1 rounded">valor_bruto + ajuste_valor</span> do pedido pai
                      {filtroValorMinimo ? <> ≥ <span className="font-semibold text-foreground">{valorMinimoFiltro.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })}</span></> : ' (sem corte)'}
                    </p>
                    <p className="text-muted-foreground mt-2">
                      Vendas compartilhadas usam os valores atribuídos a cada vendedor; sem valores definidos, a divisão é 50/50 em centavos. O filtro avalia o <strong>valor total do pedido</strong>.
                    </p>
                  </div>

                  <div className="rounded-md border border-border/40 bg-card p-3 space-y-1 md:col-span-2">
                    <p className="font-semibold text-sm mb-1">📈 Quantos passam por dashboard</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
                      <div className="flex justify-between"><span className="text-muted-foreground">Valores / Vendedores (registros)</span><span className="font-mono">{pedidosAtivos.length}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Equipamentos / Fábricas (pedidos únicos)</span><span className="font-mono">{vendasFisicas.length}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Distribuição por Estado</span><span className="font-mono">{comEstado} <span className="text-muted-foreground">/ {pedidosAtivos.length}</span></span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Origem dos Clientes</span><span className="font-mono">{comOrigem} <span className="text-muted-foreground">/ {pedidosAtivos.length}</span></span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Tempo Médio de Fechamento</span><span className="font-mono">{comDataContato} <span className="text-muted-foreground">/ {vendasFisicas.length}</span></span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Tempo Médio de Conversão</span><span className="font-mono">{comDataContato} <span className="text-muted-foreground">/ {vendasFisicas.length}</span></span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">Conversões Rápidas (mesmo mês)</span><span className="font-mono">{conversoesMesmoMes} <span className="text-muted-foreground">/ {vendasFisicas.length}</span></span></div>
                    </div>
                    <p className="text-[11px] text-muted-foreground mt-2 italic">
                      Tempos e conversões contam cada pedido uma vez e ignoram acréscimos. Vendas por vendedor, estado e origem usam as parcelas monetárias. Origens ausentes aparecem como Não informado.
                    </p>
                  </div>
                </div>
              </details>
            </CardContent>
          </Card>
        )}

        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Carregando dados de vendas...</p>
          </div>
        ) : erroPedidos ? (
          <Card className="vendas-panel border-destructive/40 bg-destructive/5">
            <CardContent className="vendas-panel-content py-10 flex flex-col items-center text-center gap-3">
              <div className="p-3 rounded-full bg-destructive/10">
                <RefreshCw className="h-6 w-6 text-destructive" />
              </div>
              <div>
                <p className="font-semibold text-destructive">Não foi possível carregar as vendas</p>
                <p className="text-sm text-muted-foreground mt-1 max-w-md">{erroPedidos}</p>
              </div>
              <Button
                onClick={() => {
                  const c = new AbortController();
                  carregarPedidos(c.signal, true);
                  carregarPedidosAnoCompleto(c.signal);
                }}
                size="sm"
                variant="outline"
                className="gap-2"
              >
                <RefreshCw className="h-4 w-4" />
                Tentar novamente
              </Button>
            </CardContent>
          </Card>
        ) : (
          <>
            {erroAnoCompleto && (
              <Card className="vendas-panel border-amber-500/40 bg-amber-500/5">
                <CardContent className="vendas-panel-content py-3 flex items-center gap-3">
                  <RefreshCw className="h-4 w-4 text-amber-600 shrink-0" />
                  <p className="text-sm text-amber-700 dark:text-amber-400 flex-1">
                    Falha ao carregar evolução anual: {erroAnoCompleto}
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      const c = new AbortController();
                      carregarPedidosAnoCompleto(c.signal);
                    }}
                  >
                    Recarregar
                  </Button>
                </CardContent>
              </Card>
            )}
            {/* KPIs */}
            <div className="vendas-kpis grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <Card className="vendas-panel vendas-kpi vendas-kpi--primary border-primary/20">
                <CardContent className="vendas-panel-content py-6">
                  <div className="vendas-kpi-body flex items-start justify-between gap-3">
                    <div className="vendas-kpi-text min-w-0">
                      <p className="vendas-kpi-label text-sm font-medium text-muted-foreground mb-3">Total em Vendas</p>
                      <p className="vendas-kpi-value text-3xl font-bold text-primary tracking-tight">{formatarValor(valorTotal)}</p>
                    </div>
                    <div className="vendas-kpi-icon p-2.5 rounded-xl bg-primary/10 text-primary shrink-0"><DollarSign className="h-5 w-5" /></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="vendas-panel vendas-kpi">
                <CardContent className="vendas-panel-content py-6">
                  <div className="vendas-kpi-body flex items-start justify-between gap-3">
                    <div className="vendas-kpi-text min-w-0">
                      <p className="vendas-kpi-label text-sm font-medium text-muted-foreground mb-3">Registros de venda</p>
                      <p className="vendas-kpi-value text-3xl font-bold tracking-tight">{totalVendas}</p>
                    </div>
                    <div className="vendas-kpi-icon p-2.5 rounded-xl bg-muted text-muted-foreground shrink-0"><FileText className="h-5 w-5" /></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="vendas-panel vendas-kpi">
                <CardContent className="vendas-panel-content py-6">
                  <div className="vendas-kpi-body flex items-start justify-between gap-3">
                    <div className="vendas-kpi-text min-w-0">
                      <p className="vendas-kpi-label text-sm font-medium text-muted-foreground mb-3">Ticket Médio</p>
                      <p className="vendas-kpi-value text-3xl font-bold tracking-tight">{formatarValor(ticketMedio)}</p>
                    </div>
                    <div className="vendas-kpi-icon p-2.5 rounded-xl bg-muted text-muted-foreground shrink-0"><TrendingUp className="h-5 w-5" /></div>
                  </div>
                </CardContent>
              </Card>

              <Card className="vendas-panel vendas-kpi">
                <CardContent className="vendas-panel-content py-6">
                  <div className="vendas-kpi-body flex items-start justify-between gap-3">
                    <div className="vendas-kpi-text min-w-0">
                      <p className="vendas-kpi-label text-sm font-medium text-muted-foreground mb-3">Fábricas Vendidas</p>
                      <p className="vendas-kpi-value text-3xl font-bold tracking-tight">{dadosFabricas.reduce((acc, f) => acc + f.quantidade, 0)}</p>
                    </div>
                    <div className="vendas-kpi-icon p-2.5 rounded-xl bg-muted text-muted-foreground shrink-0"><Package className="h-5 w-5" /></div>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Meta Geral */}
            <Card className="vendas-panel vendas-goal">
              <CardHeader className="vendas-panel-header vendas-goal-header pb-3">
                <CardTitle className="vendas-panel-title flex items-center gap-2 text-lg">
                  <Target className="h-5 w-5 text-primary" />
                  Meta do Período
                </CardTitle>
              </CardHeader>
              <CardContent className="vendas-panel-content vendas-goal-content">
                <div className="vendas-goal-controls flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-2 shrink-0">
                    <label htmlFor="vendas-meta-periodo" className="text-sm text-muted-foreground">Meta:</label>
                    <input
                      id="vendas-meta-periodo"
                      type="number"
                      value={metaGeral || ""}
                      onChange={e => setMetaGeral(Number(e.target.value))}
                      placeholder="R$ 0,00"
                      className="vendas-goal-input w-36 px-3 py-2 border border-input rounded-lg bg-background text-sm"
                    />
                  </div>
                  {metaGeral > 0 && (
                    <div className="vendas-goal-progress flex items-center gap-6 flex-1 min-w-[220px]">
                      <div className="flex-1">
                        <div className="flex justify-between text-sm mb-1">
                          <span>{formatarValor(valorTotal)}</span>
                          <span className="text-muted-foreground">{formatarValor(metaGeral)}</span>
                        </div>
                        <div className="h-3 bg-muted rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${percentualMeta >= 100 ? 'bg-green-500' : 'bg-primary'}`}
                            style={{ width: `${percentualMeta}%` }}
                          />
                        </div>
                        <p className="text-xs text-muted-foreground mt-1">
                          {percentualMeta.toFixed(1)}% da meta • Falta {formatarValor(faltaParaMeta)}
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Ranking de Vendedores */}
            <Card className="vendas-panel vendas-ranking">
              <CardHeader className="vendas-panel-header">
                <CardTitle className="vendas-panel-title flex items-center gap-2">
                  <Trophy className="h-5 w-5 text-yellow-500" />
                  Ranking de Vendedores
                </CardTitle>
              </CardHeader>
              <CardContent className="vendas-panel-content">
                <div className="vendas-ranking-grid grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                  {vendasPorVendedor.map((v, index) => (
                    <div
                      key={v.vendedor}
                      className={`vendas-ranking-entry p-4 rounded-xl border transition-colors ${index === 0 ? 'vendas-ranking-entry--leader border-primary/25 bg-primary/5' : 'border-border bg-muted/20'}`}
                    >
                      <div className="vendas-ranking-identity flex items-center gap-3 mb-4">
                        <span className="vendas-ranking-position inline-flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-sm font-semibold shrink-0">{index + 1}</span>
                        <span className="vendas-ranking-name font-semibold min-w-0 break-words">{v.vendedor}</span>
                        {index === 0 && <span className="vendas-ranking-award ml-auto shrink-0" aria-hidden="true">{getRankIcon(index)}</span>}
                      </div>
                      <p className="vendas-ranking-value text-2xl font-bold tracking-tight mb-3">{formatarValor(v.valor)}</p>
                      <div className="vendas-ranking-meta flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs text-muted-foreground">
                        <span>{v.quantidade} registros</span>
                        <span>Ticket médio <strong className="font-medium text-foreground">{formatarValor(v.ticketMedio)}</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Gráficos */}
            <div className="vendas-charts grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Evolução de Vendas */}
              <Card className="vendas-panel vendas-chart-card">
                <CardHeader className="vendas-panel-header">
                  <CardTitle className="vendas-panel-title">Evolução de Vendas</CardTitle>
                  <p className="vendas-chart-description text-sm text-muted-foreground">Ano de {anoAtual} · valores mensais</p>
                </CardHeader>
                <CardContent className="vendas-panel-content">
                  <div ref={evolucaoChartRef} className="vendas-chart-surface rounded-xl p-3 sm:p-4 bg-card" role="group" aria-label={`Evolução do valor mensal das vendas no ano de ${anoAtual}`}>
                    {!evolucaoAnualPronta ? (
                      <div className="h-[300px] flex items-center justify-center text-sm text-muted-foreground" role="status">
                        {erroAnoCompleto ? 'Evolução anual indisponível. Recarregue os dados.' : 'Carregando evolução anual…'}
                      </div>
                    ) : <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={dadosVendasPorMes} margin={{ top: 16, right: 12, left: 0, bottom: 8 }} accessibilityLayer>
                        <CartesianGrid strokeDasharray="4 4" stroke="var(--vendas-chart-grid, hsl(var(--border)))" vertical={false} />
                        <XAxis 
                          dataKey="mes" 
                          tick={{ fill: 'var(--vendas-chart-axis, hsl(var(--muted-foreground)))', fontSize: 12, fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          tickMargin={12}
                        />
                        <YAxis 
                          tick={{ fill: 'var(--vendas-chart-axis, hsl(var(--muted-foreground)))', fontSize: 11, fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => {
                            if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                            if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}K`;
                            return value.toString();
                          }}
                          width={60}
                        />
                        <Tooltip
                          cursor={{ stroke: 'var(--vendas-chart-series, hsl(var(--primary)))', strokeOpacity: 0.18, strokeWidth: 1 }}
                          contentStyle={{ 
                            backgroundColor: 'var(--vendas-chart-tooltip-bg, hsl(var(--popover)))',
                            border: '1px solid var(--vendas-chart-tooltip-border, hsl(var(--border)))',
                            borderRadius: '12px',
                            color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))',
                            boxShadow: '0 8px 24px hsl(var(--foreground) / 0.1)'
                          }}
                          formatter={(value: any) => [formatarValor(Number(value)), "Valor"]}
                          labelStyle={{ fontWeight: 600, marginBottom: 4, color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))' }}
                          itemStyle={{ color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))' }}
                        />
                        <Line 
                          type="monotone" 
                          dataKey="valor" 
                          stroke="var(--vendas-chart-series, hsl(var(--primary)))"
                          strokeWidth={3} 
                          name="Valor" 
                          dot={{ fill: 'var(--vendas-chart-series, hsl(var(--primary)))', strokeWidth: 2, r: 4, stroke: 'hsl(var(--card))' }}
                          activeDot={{ r: 6, stroke: 'var(--vendas-chart-series, hsl(var(--primary)))', strokeWidth: 2, fill: 'hsl(var(--card))' }}
                        />
                      </LineChart>
                    </ResponsiveContainer>}
                  </div>
                </CardContent>
              </Card>

              {/* Vendas por Vendedor */}
              <Card className="vendas-panel vendas-chart-card">
                <CardHeader className="vendas-panel-header">
                  <CardTitle className="vendas-panel-title">Vendas por Vendedor</CardTitle>
                  <p className="vendas-chart-description text-sm text-muted-foreground">Valor de vendas no período selecionado</p>
                </CardHeader>
                <CardContent className="vendas-panel-content">
                  <div className="vendas-chart-scroll max-h-[380px] overflow-auto">
                  <div ref={vendedorChartRef} className="vendas-chart-surface vendas-chart-seller min-w-0 rounded-xl p-3 sm:p-4 bg-card" role="group" aria-label="Valor das vendas por vendedor no período selecionado, em barras horizontais">
                    <ResponsiveContainer width="100%" height={Math.max(300, vendasPorVendedor.filter(v => v.valor !== 0).length * 44 + 48)}>
                      <BarChart data={vendasPorVendedor.filter(v => v.valor !== 0)} layout="vertical" margin={{ top: 12, right: 52, left: 0, bottom: 8 }} accessibilityLayer>
                        <CartesianGrid strokeDasharray="4 4" stroke="var(--vendas-chart-grid, hsl(var(--border)))" horizontal={false} />
                        <XAxis 
                          type="number"
                          domain={[(minimo: number) => Math.min(0, minimo), (maximo: number) => Math.max(0, maximo)]}
                          tick={{ fill: 'var(--vendas-chart-axis, hsl(var(--muted-foreground)))', fontSize: 11, fontWeight: 500 }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={(value) => {
                            if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                            if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}K`;
                            return value.toString();
                          }}
                          tickMargin={10}
                        />
                        <YAxis
                          type="category"
                          dataKey="vendedor"
                          tick={({ x, y, payload }: any) => (
                            <text x={x} y={y} dy={4} textAnchor="end" fill="var(--vendas-chart-axis, hsl(var(--muted-foreground)))" fontSize={11} fontWeight={600}>
                              <title>{payload.value}</title>
                              {payload.value.length > 18 ? payload.value.slice(0, 17) + '…' : payload.value}
                            </text>
                          )}
                          axisLine={false}
                          tickLine={false}
                          interval={0}
                          width={120}
                          tickMargin={12}
                        />
                        <Tooltip
                          cursor={{ fill: 'hsl(var(--primary) / 0.06)' }}
                          contentStyle={{ 
                            backgroundColor: 'var(--vendas-chart-tooltip-bg, hsl(var(--popover)))',
                            border: '1px solid var(--vendas-chart-tooltip-border, hsl(var(--border)))',
                            borderRadius: '12px',
                            color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))',
                            boxShadow: '0 8px 24px hsl(var(--foreground) / 0.1)'
                          }}
                          formatter={(value: any) => [formatarValor(Number(value)), "Valor"]}
                          labelStyle={{ fontWeight: 600, marginBottom: 4, color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))' }}
                          itemStyle={{ color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))' }}
                        />
                        <Bar dataKey="valor" name="Valor Total" radius={[0, 5, 5, 0]} maxBarSize={24} fill="var(--vendas-chart-series, hsl(var(--primary)))">
                          <LabelList dataKey="valor" position="right" fill="var(--vendas-chart-axis, hsl(var(--muted-foreground)))" fontSize={11} fontWeight={600} formatter={(value: any) => Number(value).toLocaleString('pt-BR', { notation: 'compact', maximumFractionDigits: 1 })} />
                        </Bar>
                        <ReferenceLine x={0} stroke="var(--vendas-chart-axis, hsl(var(--muted-foreground)))" strokeOpacity={0.4} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  </div>
                </CardContent>
              </Card>

              {/* Fábricas Vendidas - Design Moderno */}
              {dadosFabricas.length > 0 && (
                <Card className="vendas-panel vendas-chart-card lg:col-span-1 overflow-hidden">
                  <CardHeader className="vendas-panel-header pb-2">
                    <div className="vendas-chart-heading flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="vendas-chart-card-icon p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                          <Package className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="vendas-panel-title text-lg font-bold">Fábricas de Ração</CardTitle>
                          <p className="vendas-chart-description text-sm text-muted-foreground mt-1">Unidades por modelo · pedidos sem duplicação</p>
                        </div>
                      </div>
                      <div className="vendas-chart-total text-right shrink-0">
                        <span className="text-2xl font-bold text-primary">{dadosFabricas.reduce((acc, f) => acc + f.quantidade, 0)}</span>
                        <p className="text-xs text-muted-foreground">total vendidas</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="vendas-panel-content pt-4">
                    <div className="vendas-chart-list space-y-4" role="group" aria-label="Quantidade de fábricas vendidas por modelo no período selecionado">
                      {dadosFabricas.map((fabrica, index) => {
                        const maxQtd = Math.max(...dadosFabricas.map(f => f.quantidade));
                        const porcentagem = (fabrica.quantidade / maxQtd) * 100;
                        const cor = 'var(--vendas-chart-series, hsl(var(--primary)))';
                        return (
                          <div key={fabrica.fabrica} className="vendas-chart-row group">
                            <div className="vendas-chart-row-heading flex items-center justify-between gap-3 mb-2">
                              <span className="vendas-chart-row-label text-sm font-medium min-w-0 break-words">{fabrica.fabrica}</span>
                              <div className="vendas-chart-row-metrics flex items-baseline gap-1.5 shrink-0">
                                <span className="vendas-chart-row-quantity text-base font-semibold">{fabrica.quantidade}</span>
                                <span className="text-xs text-muted-foreground">un.</span>
                              </div>
                            </div>
                            <div className="vendas-chart-row-track h-2 bg-muted rounded-full overflow-hidden" aria-hidden="true">
                              <div 
                                className="vendas-chart-row-fill h-full rounded-full transition-all duration-500 ease-out group-hover:opacity-80"
                                style={{ 
                                  width: `${porcentagem}%`,
                                  background: cor
                                }} 
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Equipamentos Separados Vendidos */}
              {dadosEquipamentos.length > 0 && (
                <Card className="vendas-panel vendas-chart-card lg:col-span-1 overflow-hidden">
                  <CardHeader className="vendas-panel-header pb-2">
                    <div className="vendas-chart-heading flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3">
                        <div className="vendas-chart-card-icon p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                          <Wrench className="h-5 w-5" />
                        </div>
                        <div>
                          <CardTitle className="vendas-panel-title text-lg font-bold">Equipamentos Separados</CardTitle>
                          <p className="vendas-chart-description text-sm text-muted-foreground mt-1">Barras por quantidade · valor integral dos itens associados</p>
                        </div>
                      </div>
                      <div className="vendas-chart-total text-right shrink-0">
                        <span className="text-2xl font-bold text-primary">{dadosEquipamentos.reduce((acc, e) => acc + e.quantidade, 0)}</span>
                        <p className="text-xs text-muted-foreground">total vendidos</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="vendas-panel-content pt-4">
                    <div className="vendas-chart-list vendas-chart-scroll space-y-4 max-h-[300px] overflow-y-auto pr-1" role="group" aria-label="Quantidade e valor de vendas de equipamentos avulsos no período selecionado, ordenados por valor">
                      {dadosEquipamentos.map((equip, index) => {
                        const maxQtd = Math.max(...dadosEquipamentos.map(e => e.quantidade));
                        const porcentagem = (equip.quantidade / maxQtd) * 100;
                        const cor = 'var(--vendas-chart-series, hsl(var(--primary)))';
                        return (
                          <div key={equip.equipamento} className="vendas-chart-row group">
                            <div className="vendas-chart-row-heading flex items-center justify-between gap-3 mb-2">
                              <span className="vendas-chart-row-label text-sm font-medium min-w-0 break-words">{equip.equipamento}</span>
                              <div className="vendas-chart-row-metrics flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 shrink-0">
                                <span className="vendas-chart-row-value text-sm text-muted-foreground">
                                  {formatarValor(equip.valor)}
                                </span>
                                <span className="vendas-chart-row-quantity text-base font-semibold">{equip.quantidade} <span className="text-xs font-normal text-muted-foreground">un.</span></span>
                              </div>
                            </div>
                            <div className="vendas-chart-row-track h-2 bg-muted rounded-full overflow-hidden" aria-hidden="true">
                              <div 
                                className="vendas-chart-row-fill h-full rounded-full transition-all duration-500 ease-out group-hover:opacity-80"
                                style={{ 
                                  width: `${porcentagem}%`,
                                  background: cor
                                }} 
                              />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Tempo Médio de Fechamento */}
              {tempoMedioPorVendedor.length > 0 && (
                <Card className="vendas-panel vendas-chart-card">
                  <CardHeader className="vendas-panel-header">
                    <CardTitle className="vendas-panel-title flex items-center gap-2">
                      <Clock className="h-5 w-5 text-primary" />
                      Tempo Médio de Fechamento
                    </CardTitle>
                    <p className="vendas-chart-description text-sm text-muted-foreground">Média de dias entre primeiro contato e venda, por vendedor</p>
                  </CardHeader>
                  <CardContent className="vendas-panel-content">
                    <div className="vendas-chart-surface" role="group" aria-label="Média de dias entre primeiro contato e venda por vendedor no período selecionado">
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={tempoMedioPorVendedor} margin={{ top: 25, right: 10, left: 0, bottom: 12 }} accessibilityLayer>
                        <CartesianGrid strokeDasharray="4 4" stroke="var(--vendas-chart-grid, hsl(var(--border)))" vertical={false} />
                        <XAxis dataKey="vendedor" tick={{ fill: 'var(--vendas-chart-axis, hsl(var(--muted-foreground)))', fontSize: 11, fontWeight: 500 }} axisLine={false} tickLine={false} tickMargin={10} />
                        <YAxis tick={{ fill: 'var(--vendas-chart-axis, hsl(var(--muted-foreground)))', fontSize: 11 }} axisLine={false} tickLine={false} />
                        <Tooltip
                          cursor={{ fill: 'hsl(var(--primary) / 0.06)' }}
                          contentStyle={{ 
                            backgroundColor: 'var(--vendas-chart-tooltip-bg, hsl(var(--popover)))',
                            border: '1px solid var(--vendas-chart-tooltip-border, hsl(var(--border)))',
                            borderRadius: '12px',
                            color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))',
                            boxShadow: '0 8px 24px hsl(var(--foreground) / 0.1)'
                          }}
                          labelStyle={{ color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))', fontWeight: 600, marginBottom: 4 }}
                          itemStyle={{ color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))' }}
                          formatter={(value: any, name: any, props: any) => [
                            `${value} dias (${props.payload.quantidade} vendas)`,
                            "Média"
                          ]}
                        />
                        <Bar dataKey="dias" name="Dias" radius={[5, 5, 0, 0]} maxBarSize={40} fill="var(--vendas-chart-series, hsl(var(--primary)))">
                          <LabelList 
                            dataKey="dias" 
                            position="top" 
                            formatter={(value: any) => `${value}d`}
                            fill="var(--vendas-chart-axis, hsl(var(--muted-foreground)))"
                            fontSize={11}
                            fontWeight={600}
                          />
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                    </div>
                    {/* Detalhes por vendedor */}
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 mt-4 pt-4 border-t border-border">
                      {tempoMedioPorVendedor.map((v, index) => (
                        <div key={v.vendedor} className="flex items-center gap-2 text-xs">
                          <div className="w-2 h-2 rounded-full shrink-0" style={{ background: 'var(--vendas-chart-series, hsl(var(--primary)))' }} />
                          <div>
                            <span className="font-medium">{v.vendedor}</span>
                            <span className="text-muted-foreground ml-1">({v.quantidade} vendas)</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Vendas por Estado - Mapa */}
              <Card className="vendas-panel vendas-chart-card">
                <CardHeader className="vendas-panel-header">
                  <CardTitle className="vendas-panel-title flex items-center gap-2">
                    <MapPin className="h-5 w-5 text-primary" />
                    Distribuição por Estado
                  </CardTitle>
                  <p className="vendas-chart-description text-sm text-muted-foreground">Valor de vendas por estado no período selecionado</p>
                </CardHeader>
                <CardContent className="vendas-panel-content">
                  <div ref={mapaRef} data-pdf-mapa className="vendas-chart-surface bg-card rounded-lg p-2" role="group" aria-label="Valor de vendas por estado no período selecionado">
                    <BrazilMap dados={dadosEstados} formatarValor={formatarValor} />
                  </div>
                </CardContent>
              </Card>

              {/* Origem dos Clientes */}
              {dadosOrigem.length > 0 && (
                <Card className="vendas-panel vendas-chart-card lg:col-span-2">
                  <CardHeader className="vendas-panel-header">
                    <CardTitle className="vendas-panel-title flex items-center gap-2">
                      <Users className="h-5 w-5 text-primary" />
                      Origem dos Clientes
                    </CardTitle>
                    <p className="vendas-chart-description text-sm text-muted-foreground">Valor de vendas no período selecionado · top 8 origens</p>
                  </CardHeader>
                  <CardContent className="vendas-panel-content">
                    <div ref={origemChartRef} className="vendas-chart-surface bg-card rounded-xl p-3 sm:p-4" role="group" aria-label="Valor das vendas por origem do cliente no período selecionado">
                      <ResponsiveContainer width="100%" height={340}>
                        <BarChart data={dadosOrigem} margin={{ top: 30, right: 20, left: 10, bottom: 30 }} accessibilityLayer>
                          <CartesianGrid strokeDasharray="4 4" stroke="var(--vendas-chart-grid, hsl(var(--border)))" vertical={false} />
                          <XAxis 
                            dataKey="origem" 
                            tick={{ fill: 'var(--vendas-chart-axis, hsl(var(--muted-foreground)))', fontSize: 12, fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                            interval={0}
                            angle={-20}
                            textAnchor="end"
                            height={60}
                          />
                          <YAxis 
                            domain={[(minimo: number) => Math.min(0, minimo), (maximo: number) => Math.max(0, maximo)]}
                            tick={{ fill: 'var(--vendas-chart-axis, hsl(var(--muted-foreground)))', fontSize: 11, fontWeight: 500 }}
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(value) => {
                              if (Math.abs(value) >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
                              if (Math.abs(value) >= 1000) return `${(value / 1000).toFixed(0)}K`;
                              return value.toString();
                            }}
                            width={55}
                          />
                          <Tooltip
                            cursor={{ fill: 'hsl(var(--primary) / 0.06)' }}
                            contentStyle={{ 
                              backgroundColor: 'var(--vendas-chart-tooltip-bg, hsl(var(--popover)))',
                              border: '1px solid var(--vendas-chart-tooltip-border, hsl(var(--border)))',
                              borderRadius: '12px',
                              color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))',
                              boxShadow: '0 8px 24px hsl(var(--foreground) / 0.1)'
                            }}
                            itemStyle={{ color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))' }}
                            labelStyle={{ fontWeight: 600, marginBottom: 4, color: 'var(--vendas-chart-tooltip-text, hsl(var(--popover-foreground)))' }}
                            formatter={(value: any, name: any, props: any) => [
                              `${formatarValor(Number(value))} (${props.payload.quantidade} vendas)`,
                              "Valor"
                            ]}
                          />
                          <Bar dataKey="valor" name="Valor" radius={[5, 5, 0, 0]} maxBarSize={60} fill="var(--vendas-chart-series, hsl(var(--primary)))">
                            <LabelList 
                              dataKey="valor" 
                              position="top" 
                              formatter={(value: any) => {
                                const num = Number(value) || 0;
                                if (Math.abs(num) >= 1000000) return `R$ ${(num / 1000000).toFixed(1)}M`;
                                if (Math.abs(num) >= 1000) return `R$ ${(num / 1000).toFixed(0)}K`;
                                return `R$ ${num.toFixed(0)}`;
                              }}
                              fill="var(--vendas-chart-axis, hsl(var(--muted-foreground)))"
                              fontSize={11}
                              fontWeight={700}
                            />
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Conversões Rápidas - Vendas iniciadas e fechadas no mesmo mês */}
              {dadosConversoesRapidas.length > 0 && (
                <Card className="vendas-panel vendas-chart-card lg:col-span-2 overflow-hidden">
                  <div ref={conversoesRapidasRef} className="vendas-chart-surface bg-card">
                    <CardHeader className="vendas-panel-header pb-2">
                      <div className="vendas-chart-heading flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="vendas-chart-card-icon p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                            <Zap className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="vendas-panel-title text-lg font-bold">Conversões Rápidas</CardTitle>
                            <p className="vendas-chart-description text-sm text-muted-foreground mt-1">Pedidos iniciados e fechados no mesmo mês · valor integral da venda</p>
                          </div>
                        </div>
                        <div className="vendas-chart-total text-right shrink-0">
                          <span className="text-2xl font-bold text-primary">{dadosConversoesRapidas.reduce((acc, c) => acc + c.quantidade, 0)}</span>
                          <p className="text-xs text-muted-foreground">total no período</p>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="vendas-panel-content pt-4">
                      <div className="vendas-chart-list space-y-4" role="group" aria-label="Quantidade e valor de vendas iniciadas e fechadas no mesmo mês, por origem, no período selecionado">
                        {dadosConversoesRapidas.map((item, index) => {
                          const maxQtd = Math.max(...dadosConversoesRapidas.map(c => c.quantidade));
                          const porcentagem = (item.quantidade / maxQtd) * 100;
                          const cor = 'var(--vendas-chart-series, hsl(var(--primary)))';
                          return (
                            <div key={item.origem} className="vendas-chart-row group">
                              <div className="vendas-chart-row-heading flex items-center justify-between gap-3 mb-2">
                                <span className="vendas-chart-row-label text-sm font-medium min-w-0 break-words">{item.origem}</span>
                                <div className="vendas-chart-row-metrics flex flex-wrap items-baseline justify-end gap-x-3 gap-y-1 shrink-0">
                                  <span className="vendas-chart-row-value text-sm text-muted-foreground">
                                    {formatarValor(item.valor)}
                                  </span>
                                  <span className="vendas-chart-row-quantity text-base font-semibold">{item.quantidade} <span className="text-xs font-normal text-muted-foreground">vendas</span></span>
                                </div>
                              </div>
                              <div className="vendas-chart-row-track h-2 bg-muted rounded-full overflow-hidden" aria-hidden="true">
                                <div 
                                  className="vendas-chart-row-fill h-full rounded-full transition-all duration-500 ease-out group-hover:opacity-80"
                                  style={{ 
                                    width: `${porcentagem}%`,
                                    background: cor
                                  }} 
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </div>
                </Card>
              )}

              {/* Tempo Médio de Conversão por Origem */}
              {dadosTempoConversao.length > 0 && (
                <Card className="vendas-panel vendas-chart-card lg:col-span-2 overflow-hidden">
                  <div ref={tempoConversaoRef} className="vendas-chart-surface bg-card">
                    <CardHeader className="vendas-panel-header pb-2">
                      <div className="vendas-chart-heading flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3">
                          <div className="vendas-chart-card-icon p-2.5 rounded-xl bg-primary/10 text-primary shrink-0">
                            <Clock className="h-5 w-5" />
                          </div>
                          <div>
                            <CardTitle className="vendas-panel-title text-lg font-bold">Tempo Médio de Conversão</CardTitle>
                            <p className="vendas-chart-description text-sm text-muted-foreground mt-1">Média de dias entre primeiro contato e venda, por origem</p>
                          </div>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="vendas-panel-content pt-4">
                      <div className="vendas-chart-list space-y-4" role="group" aria-label="Média de dias entre primeiro contato e venda por origem no período selecionado">
                        {dadosTempoConversao.map((item, index) => {
                          const maxDias = Math.max(...dadosTempoConversao.map(c => c.mediaDias));
                          const porcentagem = maxDias > 0 ? (item.mediaDias / maxDias) * 100 : 0;
                          // Cores: verde para rápido, vermelho para lento
                          const corGradiente = item.mediaDias <= 7 ? '#10B981' : 
                                              item.mediaDias <= 15 ? '#3B82F6' : 
                                              item.mediaDias <= 30 ? '#F59E0B' : '#EF4444';
                          return (
                            <div key={item.origem} className="vendas-chart-row group">
                              <div className="vendas-chart-row-heading flex items-center justify-between gap-3 mb-2">
                                <div className="flex flex-wrap items-baseline gap-2 min-w-0">
                                  <div 
                                    className="w-3 h-3 rounded-full shadow-sm" 
                                    style={{ background: `linear-gradient(135deg, ${corGradiente}, ${corGradiente}80)` }} 
                                  />
                                  <span className="vendas-chart-row-label text-sm font-medium min-w-0 break-words">{item.origem}</span>
                                  <span className="text-xs text-muted-foreground">({item.quantidade} vendas)</span>
                                </div>
                                <div className="vendas-chart-row-metrics flex items-center gap-2 shrink-0">
                                  <span className="vendas-chart-row-quantity text-base font-semibold" style={{ color: corGradiente }}>
                                    {item.mediaDias} {item.mediaDias === 1 ? 'dia' : 'dias'}
                                  </span>
                                </div>
                              </div>
                              <div className="vendas-chart-row-track h-2 bg-muted rounded-full overflow-hidden" aria-hidden="true">
                                <div 
                                  className="vendas-chart-row-fill h-full rounded-full transition-all duration-500 ease-out group-hover:opacity-80"
                                  style={{ 
                                    width: `${porcentagem}%`,
                                    background: `linear-gradient(90deg, ${corGradiente}, ${corGradiente}90)`
                                  }} 
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex items-center justify-center gap-4 mt-4 pt-4 border-t border-border text-xs text-muted-foreground">
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                          <span>≤7 dias</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
                          <span>8-15 dias</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                          <span>16-30 dias</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
                          <span>&gt;30 dias</span>
                        </div>
                      </div>
                    </CardContent>
                  </div>
                </Card>
              )}
            </div>

            {/* Painel de Análise IA */}
            <Card className="vendas-panel border-primary/20">
              <CardHeader className="vendas-panel-header pb-3">
                <CardTitle className="vendas-panel-title flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Sparkles className="h-5 w-5 text-primary" />
                    </div>
                    <span>Análise Inteligente</span>
                  </div>
                  <Button
                    onClick={analisarComIA}
                    disabled={analisandoIA || pedidosFiltrados.length === 0}
                    size="sm"
                    className="gap-2"
                  >
                    {analisandoIA ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Analisando...
                      </>
                    ) : analiseIA ? (
                      <>
                        <RefreshCw className="h-4 w-4" />
                        Reanalisar
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-4 w-4" />
                        Analisar com IA
                      </>
                    )}
                  </Button>
                </CardTitle>
                <p className="text-sm text-muted-foreground">
                  A IA analisa todos os dados de vendas e fornece insights, alertas e sugestões práticas.
                </p>
              </CardHeader>
              <CardContent className="vendas-panel-content">
                {analisandoIA ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Analisando dados de vendas...</p>
                  </div>
                ) : analiseIA ? (
                  <div className="prose prose-sm dark:prose-invert max-w-none">
                    <div 
                      className="text-sm leading-relaxed whitespace-pre-wrap [&>h1]:text-lg [&>h1]:font-bold [&>h1]:mb-2 [&>h1]:mt-4 [&>h2]:text-base [&>h2]:font-semibold [&>h2]:mb-2 [&>h2]:mt-3 [&>strong]:text-foreground [&>ul]:space-y-1 [&>ul]:my-2 [&>li]:text-muted-foreground"
                      dangerouslySetInnerHTML={{
                        __html: DOMPurify.sanitize(
                          analiseIA
                            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
                            .replace(/### (.*?)(\n|$)/g, '<h2>$1</h2>')
                            .replace(/## (.*?)(\n|$)/g, '<h1>$1</h1>')
                            .replace(/# (.*?)(\n|$)/g, '<h1>$1</h1>')
                            .replace(/\n- /g, '<br/>• ')
                            .replace(/\n\d+\. /g, (match) => '<br/>' + match.trim() + ' ')
                            .replace(/\n\n/g, '<br/><br/>')
                            .replace(/\n/g, '<br/>'),
                          { ALLOWED_TAGS: ['strong', 'em', 'h1', 'h2', 'h3', 'br', 'ul', 'li', 'p', 'span'], ALLOWED_ATTR: [] }
                        )
                      }}
                    />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
                    <div className="p-4 rounded-full bg-muted/50">
                      <Sparkles className="h-8 w-8 text-muted-foreground/50" />
                    </div>
                    <div>
                      <p className="font-medium text-muted-foreground">Nenhuma análise ainda</p>
                      <p className="text-sm text-muted-foreground/70">
                        Clique em "Analisar com IA" para obter insights sobre seus dados de vendas.
                      </p>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="vendas-panel vendas-list">
              <CardHeader className="vendas-panel-header">
                <CardTitle className="vendas-panel-title flex items-center justify-between flex-wrap gap-2">
                  <span>Listagem de Vendas ({new Set(listagemFiltrada.map(p => p.id)).size})</span>
                  {(tabelaFiltroUF !== 'todos' || tabelaFiltroVendedor !== 'todos' || tabelaFiltroOrigem !== 'todos' || tabelaFiltroStatus !== 'todos' || tabelaBusca) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setTabelaFiltroUF('todos');
                        setTabelaFiltroVendedor('todos');
                        setTabelaFiltroOrigem('todos');
                        setTabelaFiltroStatus('todos');
                        setTabelaBusca('');
                      }}
                    >
                      <X className="h-3 w-3 mr-1" /> Limpar filtros
                    </Button>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="vendas-panel-content">
                {/* Barra de filtros */}
                <div className="vendas-table-filters flex flex-wrap gap-2 mb-5 items-center">
                  <Input
                    placeholder="Buscar pedido ou cliente..."
                    value={tabelaBusca}
                    onChange={(e) => setTabelaBusca(e.target.value)}
                    className="w-full sm:w-56 h-9"
                  />
                  <Select value={tabelaFiltroUF} onValueChange={setTabelaFiltroUF}>
                    <SelectTrigger className="w-[110px] h-9"><SelectValue placeholder="UF" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos UFs</SelectItem>
                      {listagemMeta.ufs.map(uf => (
                        <SelectItem key={uf} value={uf}>{uf}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={tabelaFiltroVendedor} onValueChange={setTabelaFiltroVendedor}>
                    <SelectTrigger className="w-[160px] h-9"><SelectValue placeholder="Vendedor" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos vendedores</SelectItem>
                      {listagemMeta.vends.map(v => (
                        <SelectItem key={v} value={v}>{v}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={tabelaFiltroOrigem} onValueChange={setTabelaFiltroOrigem}>
                    <SelectTrigger className="w-[150px] h-9"><SelectValue placeholder="Origem" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todas origens</SelectItem>
                      {listagemMeta.origens.map(o => (
                        <SelectItem key={o} value={o}>{o}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Select value={tabelaFiltroStatus} onValueChange={setTabelaFiltroStatus}>
                    <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="todos">Todos status</SelectItem>
                      {listagemMeta.statuses.map(s => (
                        <SelectItem key={s} value={s}>{s}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="vendas-table-scroll overflow-x-auto">
                  <table className="vendas-table w-full text-sm min-w-[900px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Pedido</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">1º Contato</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Venda</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Cliente</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Vendedor</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">UF</th>
                        <th className="text-left py-3 px-2 font-medium text-muted-foreground">Origem</th>
                        <th className="text-right py-3 px-2 font-medium text-muted-foreground">Valor</th>
                        <th className="text-center py-3 px-2 font-medium text-muted-foreground">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {listagemVisivel.map((pedido) => {
                        const displayId = (pedido as any)._displayId || pedido.id;
                        const parceiro = (pedido as any)._parceiro;
                        return (
                        <tr 
                          key={displayId} 
                          className={`border-b border-border/50 transition-colors ${podeAbrirPedidos ? 'hover:bg-muted/30 cursor-pointer' : ''}`}
                          onClick={podeAbrirPedidos ? () => navigate(`/controle/pedidos/${encodeURIComponent(pedido.id)}`) : undefined}
                        >
                          <td className={`py-3 px-2 font-medium ${podeAbrirPedidos ? 'text-primary' : 'text-foreground'}`}>{pedido.pedido_numero || pedido.numero_orcamento}</td>
                          <td className="py-3 px-2 text-muted-foreground text-xs">
                            {formatarData(pedido.data_primeiro_contato)}
                          </td>
                          <td className="py-3 px-2 text-muted-foreground text-xs">
                            {formatarData(pedido.data_venda)}
                          </td>
                          <td className="py-3 px-2 max-w-[180px] truncate">{pedido.cliente || '-'}</td>
                          <td className="py-3 px-2">
                            {pedido.vendedor}
                          </td>
                          <td className="py-3 px-2">{pedido.estado || '-'}</td>
                          <td className="py-3 px-2 text-xs">
                            {normalizarOrigem(pedido.fonte_origem)}
                          </td>
                          <td className="py-3 px-2 text-right font-medium">
                            {formatarValor(getValorPedido(pedido))}
                          </td>
                          <td className="py-3 px-2 text-center">
                            <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                              (pedido as any)._isAjuste ? 'bg-amber-500/10 text-amber-600' :
                              pedido.status === 'FECHADO' ? 'bg-green-500/10 text-green-600' :
                              pedido.status === 'CANCELADO' ? 'bg-red-500/10 text-red-600' :
                              'bg-blue-500/10 text-blue-600'
                            }`}>
                              {(pedido as any)._isAjuste ? 'AJUSTE' : pedido.status}
                            </span>
                          </td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {listagemFiltrada.length > 50 && !listagemExpandida && (
                    <p className="vendas-table-footer text-sm text-muted-foreground text-center py-4">
                      Exibindo 50 de {listagemFiltrada.length} pedidos • 
                      <Button variant="link" size="sm" onClick={() => podeAbrirPedidos ? navigate('/controle/pedidos') : setExpansaoListagem(contextoListagem)} className="ml-1">
                        Ver todos
                      </Button>
                    </p>
                  )}
                  {listagemFiltrada.length === 0 && (
                    <p className="text-center py-8 text-muted-foreground">Nenhuma venda encontrada com esses filtros.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
