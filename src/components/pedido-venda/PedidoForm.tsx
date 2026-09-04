import { useState, useRef } from "react";
import React from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/pedido-ui/button";
import { Input } from "@/components/pedido-ui/input";
import { Label } from "@/components/pedido-ui/label";
import { Card } from "@/components/pedido-ui/card";
import { Separator } from "@/components/pedido-ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/pedido-ui/select";
import { Calendar } from "@/components/pedido-ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/pedido-ui/popover";
import { Checkbox } from "@/components/pedido-ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/pedido-ui/dialog";
import { EquipamentosEditor } from "./EquipamentosEditor";
import { PaymentPlanEditor, type Parcela } from "./PaymentPlanEditor";
import { derivePaymentPlanFromForma, finalizarPlanoImportado } from "@/lib/pedido-venda/paymentPlanFromForma";
import type { LocalExtractionResult } from "@/lib/pedido-venda/extractDocxLocal";
import {
  ChecklistComprasEditor,
  type ChecklistCompras,
  DEFAULT_CHECKLIST_COMPRAS,
  isChecklistEmpty,
} from "./ChecklistComprasEditor";
import { toast } from "sonner";
import { supabase } from "@/lib/controle-supabase/client";
import { FileText, Upload, Download, Calendar as CalendarIcon, User, Package, Settings, DollarSign, Loader2, CheckCircle } from "lucide-react";
import { Textarea } from "@/components/pedido-ui/textarea";
import { addBusinessDays, addCalendarDays, formatDateBR } from "@/lib/pedido-venda/businessDays";
import { sumLineItems, sumCurrency } from "@/lib/pedido-venda/currency";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { cn } from "@/lib/utils";

const VENDEDORES = [
  "DANIEL",
  "JARDEL",
  "GUSTAVO",
  "ALVARO",
  "EDER",
  "EDILSON JR",
  "PEDRO",
  "PATRICK",
  "RAMON",
  "LUCAS",
  "IGOR",
];

// Lista de UFs válidas para validação cidade x estado
const ESTADOS_UF = [
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO',
  'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI',
  'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'
];

// Função que detecta UF dentro do nome da cidade
const detectarEstadoNaCidade = (cidade: string): string | null => {
  if (!cidade) return null;
  const cidadeUpper = cidade.toUpperCase();
  const patterns = [
    /–\s*([A-Z]{2})\s*$/,   // Cidade – UF (travessão)
    /-\s*([A-Z]{2})\s*$/,   // Cidade - UF (hífen)
    /\/\s*([A-Z]{2})\s*$/,  // Cidade/UF (barra)
    /\(\s*([A-Z]{2})\s*\)/, // Cidade (UF) (parênteses)
  ];
  for (const pattern of patterns) {
    const match = cidadeUpper.match(pattern);
    if (match && ESTADOS_UF.includes(match[1])) {
      return match[1];
    }
  }
  return null;
};

export function PedidoForm({ pedidoInicial }: { pedidoInicial?: any }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isProcessingRef = useRef(false);
  const [numeroOrcamento, setNumeroOrcamento] = useState("");
  const [numeroOrcamentoLocked, setNumeroOrcamentoLocked] = useState(true);
  const [cliente, setCliente] = useState("");
  const [atencaoA, setAtencaoA] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [cidade, setCidade] = useState("");
  const [estado, setEstado] = useState("");
  const [endereco, setEndereco] = useState("");
  const [bairro, setBairro] = useState("");
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [cep, setCep] = useState("");
  const [fantasia, setFantasia] = useState("");
  const [inscricaoEstadual, setInscricaoEstadual] = useState("");
  const [enderecoEntregaDiferente, setEnderecoEntregaDiferente] = useState(false);
  const [enderecoEntrega, setEnderecoEntrega] = useState("");
  const [bairroEntrega, setBairroEntrega] = useState("");
  const [cepEntrega, setCepEntrega] = useState("");
  const [cidadeEntrega, setCidadeEntrega] = useState("");
  const [estadoEntrega, setEstadoEntrega] = useState("");
  const [responsavelRecebimento, setResponsavelRecebimento] = useState("");
  const [tensao, setTensao] = useState<"" | "Trifásico" | "Monofásico" | "Trifásico: Motores por conta do cliente" | "Monofásico: Por conta do cliente" | "Sem motor">("");
  const [voltagem, setVoltagem] = useState("");
  const [porContaCliente, setPorContaCliente] = useState(false);
  const [motoresPorContaCliente, setMotoresPorContaCliente] = useState<number[]>([]);
  const [dialogMotoresAberto, setDialogMotoresAberto] = useState(false);
  const [formaPagamento, setFormaPagamento] = useState("");
  const [descricaoEquipamento, setDescricaoEquipamento] = useState("");
  const [dataVenda, setDataVenda] = useState<Date>(new Date());
  const [diasUteis, setDiasUteis] = useState(90);
  const [tipoPrazo, setTipoPrazo] = useState<"uteis" | "corridos">("uteis");
  const [dataEntregaManual, setDataEntregaManual] = useState<Date | undefined>(undefined);
  const [usarDataEntregaManual, setUsarDataEntregaManual] = useState(false);
  const [vendedor, setVendedor] = useState("");
  const [vendedor2, setVendedor2Raw] = useState("");
  const setVendedor2 = (v: string) => setVendedor2Raw(v === "nenhum" ? "" : v);
  const [valorTotal, setValorTotal] = useState("");
  const [valorTotalLocked, setValorTotalLocked] = useState(true);
  const [dataPrimeiroContato, setDataPrimeiroContato] = useState<Date | undefined>(undefined);
  const [fonteOrigem, setFonteOrigem] = useState("");
  const [equipamentos, setEquipamentos] = useState<string[]>([]);
  const [equipamentosDetalhados, setEquipamentosDetalhados] = useState<Array<{
    descricao: string;
    unidade: string;
    quantidade: number;
    valor: number;
  }>>([]);
  const [motores, setMotores] = useState<Array<{ modelo: string; quantidade: number }>>([]);
  const [checklistCompras, setChecklistCompras] = useState<ChecklistCompras>(DEFAULT_CHECKLIST_COMPRAS);
  const [observacoes, setObservacoes] = useState<string[]>([]);
  const [observacoesOrcamento, setObservacoesOrcamento] = useState(""); // Campo readonly do escritório
  const [observacoesAdicionais, setObservacoesAdicionais] = useState("");
  const [paymentPlan, setPaymentPlan] = useState<any>(null);
  const [isExtracting, setIsExtracting] = useState(false);
  const [showValidation, setShowValidation] = useState(true); // Sempre mostra validação
  const [validationAlerts, setValidationAlerts] = useState<string[]>([]);
  const [modoPartesOutros, setModoPartesOutros] = useState(false); // Modo simplificado para partes e outros
  
  // Estados para integração App2
  // Usar useRef para evitar problema de closure/stale state
  const arquivoOriginalRef = useRef<File | null>(null);
  // Orçamento importado em PDF → DOCX sem preço gerado pelo CRM (pdf-to-docx-producao).
  // É este arquivo que vai pra limpeza/produção quando o anexo original não é Word.
  const arquivoProducaoRef = useRef<File | null>(null);
  const [statusApp2, setStatusApp2] = useState<'idle' | 'sending' | 'done' | 'error'>('idle');

  // Helper para verificar se é CNPJ
  const isCNPJ = (value: string): boolean => {
    const cleaned = value.replace(/\D/g, '');
    return cleaned.length === 14;
  };

  // Calcular totais para comparação
  const totalEquipamentosCalculado = equipamentosDetalhados.reduce((sum, eq) => 
    sum + (eq.quantidade * eq.valor), 0
  );
  
  const valorTotalNum = valorTotal ? parseFloat(valorTotal.replace(/[^\d,]/g, '').replace(',', '.')) : 0;
  const diferencaTotal = Math.abs(totalEquipamentosCalculado - valorTotalNum);
  const temDivergencia = diferencaTotal > 10;

  // Função helper para verificar se um campo obrigatório está vazio
  const isFieldEmpty = (value: string | undefined | null | Date) => {
    if (!showValidation) return false;
    if (value instanceof Date) return false;
    // Se modo partes e outros está ativo, não destacar campos em vermelho (exceto vendedor e forma de pagamento)
    if (modoPartesOutros) return false;
    return !value || value.trim() === "";
  };

  // Carregar dados do pedido quando estiver editando
  React.useEffect(() => {
    if (pedidoInicial) {
      console.log('Carregando pedido inicial:', pedidoInicial);
      console.log('CEP do pedido:', pedidoInicial.cep);
      console.log('Forma de pagamento:', pedidoInicial.forma_pagamento);
      console.log('Data primeiro contato:', pedidoInicial.data_primeiro_contato);
      console.log('Fonte origem:', pedidoInicial.fonte_origem);
      
      setNumeroOrcamento(pedidoInicial.numero_orcamento || "");
      setNumeroOrcamentoLocked(true);
      setCliente(pedidoInicial.cliente || "");
      setAtencaoA(pedidoInicial.atencao_a || "");
      setTelefone(pedidoInicial.telefone || "");
      setEmail(pedidoInicial.email || "");
      setCidade(pedidoInicial.cidade || "");
      setEstado(pedidoInicial.estado || "");
      setEndereco(pedidoInicial.endereco || "");
      setBairro(pedidoInicial.bairro || "");
      setCep(pedidoInicial.cep || "");
      setCpfCnpj(pedidoInicial.cpf_cnpj || "");
      setFantasia(pedidoInicial.fantasia || "");
      setInscricaoEstadual(pedidoInicial.inscricao_estadual || "");
      setEnderecoEntregaDiferente(pedidoInicial.endereco_entrega_diferente || false);
      setEnderecoEntrega(pedidoInicial.endereco_entrega || "");
      setBairroEntrega(pedidoInicial.bairro_entrega || "");
      setCepEntrega(pedidoInicial.cep_entrega || "");
      setCidadeEntrega(pedidoInicial.cidade_entrega || "");
      setEstadoEntrega(pedidoInicial.estado_entrega || "");
      setResponsavelRecebimento(pedidoInicial.responsavel_recebimento || "");
      setTensao(pedidoInicial.tensao || "");
      setVoltagem(pedidoInicial.voltagem || "");
      setDescricaoEquipamento(pedidoInicial.descricao_equipamento || "");
      // Parsear data sem conversão de timezone para evitar mudança de dia
      const [ano, mes, dia] = pedidoInicial.data_venda.split('T')[0].split('-');
      setDataVenda(new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia)));
      setDiasUteis(pedidoInicial.dias_uteis || 90);
      setTipoPrazo(pedidoInicial.tipo_prazo || "uteis");
      if (pedidoInicial.data_entrega_manual) {
        // Parsear data sem conversão de timezone
        const [ano, mes, dia] = pedidoInicial.data_entrega_manual.split('T')[0].split('-');
        setDataEntregaManual(new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia)));
        setUsarDataEntregaManual(true);
      }
      setVendedor(pedidoInicial.vendedor || "");
      setVendedor2((pedidoInicial as any).vendedor_2 || "");
      setFormaPagamento(pedidoInicial.forma_pagamento || "");
      
      // Formatar e mostrar valor total se existir
      if (pedidoInicial.valor_total) {
        const formatted = new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        }).format(pedidoInicial.valor_total);
        setValorTotal(formatted);
        setValorTotalLocked(true);
      }
      
      if (pedidoInicial.data_primeiro_contato) {
        // Parsear data sem conversão de timezone
        const [ano, mes, dia] = pedidoInicial.data_primeiro_contato.split('T')[0].split('-');
        setDataPrimeiroContato(new Date(parseInt(ano), parseInt(mes) - 1, parseInt(dia)));
      }
      setFonteOrigem(pedidoInicial.fonte_origem || "");
      
      // Verificar qual fonte de equipamentos usar
      const equipDetalhados = pedidoInicial.equipamentos_detalhados;
      const equipJson = pedidoInicial.equipamentos_json;
      
      // Usar equipamentos_detalhados apenas se tiver MAIS itens que equipamentos_json
      // Isso evita carregar um único item consolidado quando existem múltiplos itens individuais
      const usarDetalhados = equipDetalhados && 
        Array.isArray(equipDetalhados) && 
        equipDetalhados.length > 0 &&
        equipJson &&
        Array.isArray(equipJson) &&
        equipDetalhados.length >= equipJson.length;
      
      if (usarDetalhados) {
        console.log('✅ Carregando equipamentos_detalhados do banco:', equipDetalhados);
        setEquipamentosDetalhados(equipDetalhados);
        setEquipamentos(equipDetalhados.map(eq => eq.descricao));
      }
      // Carregar do equipamentos_json
      else if (equipJson) {
        if (Array.isArray(pedidoInicial.equipamentos_json) && pedidoInicial.equipamentos_json.length > 0) {
          // Se for array de objetos detalhados
          if (typeof pedidoInicial.equipamentos_json[0] === 'object' && 'descricao' in pedidoInicial.equipamentos_json[0]) {
            console.log('Carregando equipamentos detalhados de equipamentos_json:', pedidoInicial.equipamentos_json);
            setEquipamentosDetalhados(pedidoInicial.equipamentos_json);
            setEquipamentos(pedidoInicial.equipamentos_json.map((eq: { descricao: string }) => eq.descricao));
          } else {
            // Se for array de strings, criar objetos detalhados básicos
            console.log('Convertendo strings em equipamentos detalhados:', pedidoInicial.equipamentos_json);
            const detalhados = pedidoInicial.equipamentos_json.map((desc: string) => ({
              descricao: desc,
              unidade: 'UN',
              quantidade: 1,
              valor: 0
            }));
            setEquipamentosDetalhados(detalhados);
            setEquipamentos(pedidoInicial.equipamentos_json);
          }
        }
      } else {
        // Se não tem nenhum equipamento, limpar estados
        console.log('Nenhum equipamento encontrado no pedido');
        setEquipamentosDetalhados([]);
        setEquipamentos([]);
      }
      
      // Carregar motores do banco de dados
      if (pedidoInicial.motores_json && Array.isArray(pedidoInicial.motores_json)) {
        // Converter formato antigo (string[]) para novo formato (objeto[])
        const motoresFormatados = pedidoInicial.motores_json.map((motor: any) => {
          if (typeof motor === 'string') {
            // Formato antigo: "2,0 CV 4 polos" -> { quantidade: 1, modelo: "2,0 CV 4 polos" }
            return { quantidade: 1, modelo: motor };
          }
          // Formato novo já está correto
          return motor;
        });
        setMotores(motoresFormatados);
      } else {
        setMotores([]);
      }

      // Carregar Check List de Compras (se existir no pedido)
      if (pedidoInicial.checklist_compras && typeof pedidoInicial.checklist_compras === 'object') {
        setChecklistCompras({ ...DEFAULT_CHECKLIST_COMPRAS, ...pedidoInicial.checklist_compras });
      } else {
        setChecklistCompras(DEFAULT_CHECKLIST_COMPRAS);
      }

      setPaymentPlan(pedidoInicial.payment_plan_json || null);
      
      console.log('Campos carregados - Forma pagamento:', pedidoInicial.forma_pagamento);
      console.log('Motores carregados:', pedidoInicial.motores_json);
    }
  }, [pedidoInicial]);

  // Atualizar dias úteis quando modo Partes e Outros for ativado
  React.useEffect(() => {
    if (modoPartesOutros) {
      setDiasUteis(0);
    }
  }, [modoPartesOutros]);

  // Ativar modo Partes e Outros automaticamente se vier da URL
  React.useEffect(() => {
    const modo = searchParams.get('modo');
    if (modo === 'acessorios' && !pedidoInicial) {
      setModoPartesOutros(true);
    }
  }, [searchParams, pedidoInicial]);

  // Atualizar observações automaticamente quando tensão ou voltagem mudar
  const especificacoesEletricas = React.useMemo(() => {
    if (!tensao) return "";
    
    let especText = `ESPECIFICAÇÕES ELÉTRICAS: ${tensao.toUpperCase()}`;
    
    if ((tensao === "Trifásico" || tensao.includes("Trifásico")) && voltagem) {
      especText += ` - ${voltagem.toUpperCase()}${voltagem !== 'A confirmar' ? 'V' : ''}`;
    } else if (tensao === "Monofásico" || tensao.includes("Monofásico")) {
      especText += " - 220V";
    }
    
    return especText;
  }, [tensao, voltagem]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
  const [arquivoUrl, setArquivoUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);

  // Calcular data de entrega
  const dataEntrega = usarDataEntregaManual && dataEntregaManual
    ? dataEntregaManual
    : (tipoPrazo === "uteis" 
      ? addBusinessDays(dataVenda, diasUteis)
      : addCalendarDays(dataVenda, diasUteis));
  const totalMotoresQtd = motores.reduce((acc, m) => acc + m.quantidade, 0);

  // Validação do plano de pagamento
  const validarPlanoPagamento = (): boolean => {
    if (!paymentPlan || !paymentPlan.parcelas || paymentPlan.parcelas.length === 0) {
      return false;
    }

    // Verificar se todas as parcelas estão completas
    const todasParcelasCompletas = paymentPlan.parcelas.every((p: Parcela) => {
      const temDescricao = p.descricao && p.descricao.trim() !== "";
      const temData = p.data && p.data.trim() !== "";
      const temValor = p.valor && (
        (p.valor.tipo === "percentual" && (p.valor.percentual || 0) > 0) ||
        (p.valor.tipo === "fixo" && (p.valor.fixo || 0) > 0)
      );
      return temDescricao && temData && temValor;
    });

    if (!todasParcelasCompletas) {
      return false;
    }

    // Verificar se a soma bate com o valor total
    const valorTotalNum = valorTotal ? parseFloat(valorTotal.replace(/[^\d,]/g, '').replace(',', '.')) : 0;
    const somaTotal = paymentPlan.parcelas.reduce((acc: number, p: Parcela) => {
      if (p.valor.tipo === "percentual") {
        return acc + (valorTotalNum * (p.valor.percentual || 0)) / 100;
      }
      return acc + (p.valor.fixo || 0);
    }, 0);
    
    const diferenca = Math.abs(somaTotal - valorTotalNum);
    return diferenca < 0.01;
  };

  const planoPagamentoValido = validarPlanoPagamento();

  // Aplica um resultado de extração local (mammoth/PDF) aos campos do formulário.
  // Mesmo shape do extrair-orcamento; usado pelo fallback DOCX e pela importação de PDF.
  const aplicarResultadoLocal = (data: LocalExtractionResult, file: File) => {
    if (data.cliente) setCliente(data.cliente);
    if (data.atencao_a) setAtencaoA(data.atencao_a);
    if (data.telefone) setTelefone(data.telefone);
    if (data.cidade) setCidade(data.cidade);
    if (data.estado) setEstado(data.estado);
    if (data.endereco) setEndereco(data.endereco);
    if (data.bairro) setBairro(data.bairro);
    if (data.cpf_cnpj) setCpfCnpj(data.cpf_cnpj);
    if (data.cep) setCep(data.cep);
    if (data.email) setEmail(data.email);
    if (data.fantasia) setFantasia(data.fantasia);
    if (data.inscricao_estadual) setInscricaoEstadual(data.inscricao_estadual);
    if (data.numero_orcamento) {
      setNumeroOrcamento(data.numero_orcamento);
      setNumeroOrcamentoLocked(true);
    }

    const valorFinal = data.valor_total_com_desconto || data.valor_total;
    if (valorFinal) {
      const formatted = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(valorFinal);
      setValorTotal(formatted);
      setValorTotalLocked(true);
    }

    let equipamentosFinais = data.equipamentos_detalhados || [];
    if (data.itens_adicionais && data.itens_adicionais.length > 0) {
      const itensComoEquipamentos = data.itens_adicionais.map((item) => ({
        descricao: item.descricao,
        unidade: "UN",
        quantidade: 1,
        valor: item.valor || 0,
      }));
      equipamentosFinais = [...equipamentosFinais, ...itensComoEquipamentos];
    }
    setEquipamentos(equipamentosFinais.map((eq) => eq.descricao));
    setEquipamentosDetalhados(equipamentosFinais);

    if (data.motores) setMotores(data.motores);
    if (data.observacoes) setObservacoes(data.observacoes);
    if (data.observacoes_orcamento) setObservacoesOrcamento(data.observacoes_orcamento);

    if (data.tensao) {
      setTensao(data.tensao === "MONOFÁSICO" ? "Monofásico" : "Trifásico");
      setVoltagem(data.voltagem || "");
    }
    if (data.forma_pagamento) setFormaPagamento(data.forma_pagamento);
    if (data.descricao_equipamento) setDescricaoEquipamento(data.descricao_equipamento);

    // Condições de pagamento: se a extração leu a TABELA de parcelas do orçamento
    // (PDF/DOCX do CRM), usa ela; senão deriva das frases da forma de pagamento
    // (à vista, entrada+saldo, forma padrão…). "a combinar" -> fica vazio (por design).
    const planoImportado = finalizarPlanoImportado(data.payment_plan, valorFinal || 0, dataVenda, dataEntrega);
    if (planoImportado) {
      setPaymentPlan(planoImportado);
    } else {
      const planoDerivadoLocal = derivePaymentPlanFromForma(data.forma_pagamento, valorFinal || 0, dataVenda, dataEntrega);
      if (planoDerivadoLocal) setPaymentPlan(planoDerivadoLocal);
    }

    // Espelha os agregados em window.* (mesmos campos lidos na geração do pedido)
    const totalComItensAdicionais = (data.total_equipamentos || 0) +
      (data.itens_adicionais?.reduce((sum, item) => sum + (item.valor || 0), 0) || 0);
    (window as any).equipamentosDetalhados = equipamentosFinais;
    (window as any).totalEquipamentos = totalComItensAdicionais;
    if (data.motores_quantidade_total != null) (window as any).motoresQuantidadeTotal = data.motores_quantidade_total;
    if (data.motores_valor_total != null) (window as any).motoresValorTotal = data.motores_valor_total;
    if (data.acessorios_quantidade != null) (window as any).acessoriosQuantidade = data.acessorios_quantidade;
    if (data.acessorios_valor != null) (window as any).acessoriosValor = data.acessorios_valor;
    if (data.valor_total != null) (window as any).valorTotalSemDesconto = data.valor_total;
    if (data.valor_total_com_desconto != null) (window as any).valorTotalComDesconto = data.valor_total_com_desconto;
    if (data.itens_adicionais) (window as any).itensAdicionais = data.itens_adicionais;

    arquivoOriginalRef.current = file;
    setStatusApp2('idle');
  };

  const processFile = async (file: File) => {
    const lower = file.name.toLowerCase();
    const isPdf = lower.endsWith('.pdf');
    const isDocx = lower.endsWith('.docx');
    if (!isPdf && !isDocx) {
      toast.error("Por favor, envie um arquivo .docx ou .pdf");
      return;
    }
    arquivoProducaoRef.current = null;

    // IMPORTANTE: Só limpar campos se NÃO estiver editando um pedido existente
    if (!pedidoInicial?.id) {
      // Limpar todos os dados antes de processar novo arquivo (apenas para pedidos novos)
      setCliente("");
      setAtencaoA("");
      setTelefone("");
      setCidade("");
      setEstado("");
      setEndereco("");
      setBairro("");
      setCpfCnpj("");
      setCep("");
      setFantasia("");
      setNumeroOrcamento("");
      setNumeroOrcamentoLocked(true);
      setValorTotal("");
      setValorTotalLocked(true);
      setEquipamentos([]);
      setEquipamentosDetalhados([]);
      setMotores([]);
      setObservacoes([]);
      setTensao("");
      setVoltagem("");
      setPorContaCliente(false);
      setMotoresPorContaCliente([]);
      setFormaPagamento("");
      setDescricaoEquipamento("");
    }

    setIsExtracting(true);
    toast.info("Extraindo dados do orçamento...");

    // PDF: extração 100% local (pdf.js + parser de linhas). O App2/limpeza de preços
    // só roda para DOCX; para PDF o pedido segue à fábrica apenas com os dados estruturados.
    if (isPdf) {
      try {
        const { extractPdfLines } = await import("@/lib/pedido-venda/extractPdfText");
        const { extrairDadosDeLinhas } = await import("@/lib/pedido-venda/extractDocxLocal");
        const linhas = await extractPdfLines(file);
        const data = extrairDadosDeLinhas(linhas, file.name);
        console.log('[PDF] Dados extraídos localmente:', data);
        aplicarResultadoLocal(data, file);
        setValidationAlerts([]);

        // Salva o PDF ORIGINAL no Storage pra aparecer na aba "Orçamento" do pedido
        // (o PedidoPreviewModal busca em pedidos/orcamentos/<numero>...). Antes isso só
        // rodava pro DOCX — o ramo do PDF dá `return` antes do upload lá embaixo — então
        // orçamento importado em PDF nunca aparecia no modal ("não foi gerado no CRM").
        if (data.numero_orcamento) {
          try {
            const sanitizedPdfName = file.name
              .normalize('NFD')
              .replace(/[̀-ͯ]/g, '')
              .replace(/[^a-zA-Z0-9._-]/g, '_')
              .replace(/_+/g, '_');
            const orcPath = `orcamentos/${data.numero_orcamento.replace(/\s+/g, '_')}_${Date.now()}_${sanitizedPdfName}`;
            const { error: orcUpErr } = await supabase.storage
              .from('pedidos')
              .upload(orcPath, file, { upsert: true });
            if (orcUpErr) {
              console.error('[Orçamento PDF] Erro no upload do original:', orcUpErr);
            } else {
              const { data: orcUrl } = supabase.storage.from('pedidos').getPublicUrl(orcPath);
              await supabase.from('orcamentos').upsert({
                numero: data.numero_orcamento,
                cliente: data.cliente || null,
                arquivo_url: orcUrl.publicUrl,
                vendedor: vendedor || null,
                data: new Date().toISOString().split('T')[0],
              }, { onConflict: 'numero' });
            }
          } catch (e) {
            console.error('[Orçamento PDF] Falha ao salvar original:', e);
          }
        }

        // GUARDA anti-folha-em-branco: PDF escaneado/imagem não tem camada de
        // texto → a extração vem vazia. Sem texto útil nenhum gerador produz um
        // documento fiel; NÃO mandar folha em branco pra Produção. O pedido segue
        // SEM_DOCX (só os dados estruturados) e o vendedor é avisado. (Caso real:
        // pedido 2026-1708 gerou ORCAMENTO_TRATADO em branco de um PDF escaneado.)
        const linhasUteis = linhas.filter((l) => l.trim().length > 0);
        if (linhasUteis.length === 0) {
          arquivoProducaoRef.current = null;
          toast.warning(
            "PDF sem texto legível (provável PDF escaneado) — o documento de produção NÃO foi gerado. Envie um PDF/DOCX com texto selecionável ou anexe o orçamento em Word (.docx). O pedido segue à Produção só com os dados.",
            { duration: 15000 }
          );
          return; // o finally do bloco PDF cuida do setIsExtracting(false)
        }

        toast.success(
          `Extraído do PDF: ${data.equipamentos_detalhados?.length || 0} equipamentos, ${data.motores?.length || 0} motores. Confira os valores.`,
          { duration: 8000 }
        );

        // Gera o DOCX sem preço pra produção. 1º tenta a conversão fiel via CRM
        // (ConvertAPI — mantém layout); sem ela (ex.: sem créditos), gera localmente
        // a partir das linhas extraídas. Falhou tudo: segue só com dados estruturados.
        try {
          toast.info("Gerando documento sem preço pra produção...", { duration: 20000 });
          let docxProducao: File | null = null;
          // 1º: rasteriza as páginas do PDF (mantém IMAGENS + LAYOUT do original,
          // tapando só o preço) → DOCX de imagens. Não depende do ConvertAPI. Só cai
          // nos fallbacks abaixo se falhar (ex.: PDF escaneado sem texto pesquisável).
          try {
            const { gerarDocxProducaoDePaginas } = await import("@/lib/pedido-venda/gerarDocxProducaoImagens");
            docxProducao = await gerarDocxProducaoDePaginas(file);
            // guard de tamanho: DOCX de imagens muito grande pode estourar o envio ao
            // App2 → produção ficaria sem doc. Nesse caso descarta e cai no dump de texto.
            if (docxProducao && docxProducao.size > 3.5 * 1024 * 1024) {
              console.warn('[PDF→DOCX produção] rasterizado grande (' + docxProducao.size + 'b) — usando fallback de texto');
              docxProducao = null;
            } else if (docxProducao) {
              console.log('[PDF→DOCX produção] Gerado por rasterização (imagens das páginas, layout preservado)');
            }
          } catch (imgErr) {
            console.warn('[PDF→DOCX produção] Rasterização falhou, tentando fallbacks:', imgErr);
          }
          // Limite real de body na Vercel é ~4.5MB; base64 infla 33% → só tenta o CRM até 3MB
          if (!docxProducao && file.size <= 3 * 1024 * 1024) {
            try {
              const pdfBase64 = await fileToBase64(file);
              const resp = await fetch('https://branorte-crm.vercel.app/api/pdf-to-docx-producao', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pdfBase64, filename: file.name }),
              });
              if (resp.ok) {
                const blob = await resp.blob();
                const nomeDocx = file.name.replace(/\.pdf$/i, '') + ' - SEM PRECO.docx';
                const convertido = new File([blob], nomeDocx, {
                  type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                });
                // Valida que o DOCX convertido tem texto de verdade (<w:t> com
                // conteúdo). ConvertAPI sobre PDF escaneado/imagem pode devolver um
                // DOCX "ok" mas em branco (só imagem/parágrafos vazios) → não aceitar.
                // (Não se aplica ao rasterizador, que é imagem por design.)
                try {
                  const mammoth = (await import('mammoth')).default;
                  const { value: textoConvertido } = await mammoth.extractRawText({
                    arrayBuffer: await convertido.arrayBuffer(),
                  });
                  if (textoConvertido && textoConvertido.trim().length > 0) {
                    docxProducao = convertido;
                  } else {
                    console.warn('[PDF→DOCX produção] Conversão CRM veio sem texto — descartada (provável PDF escaneado)');
                  }
                } catch (valErr) {
                  console.warn('[PDF→DOCX produção] Falha ao validar DOCX convertido:', valErr);
                }
              } else {
                console.warn('[PDF→DOCX produção] Conversão CRM indisponível:', resp.status, await resp.text().catch(() => ''));
              }
            } catch (convErr) {
              console.warn('[PDF→DOCX produção] Conversão CRM falhou:', convErr);
            }
          } else {
            console.warn('[PDF→DOCX produção] PDF > 3MB — pulando conversão CRM, usando gerador local');
          }
          if (!docxProducao) {
            const { gerarDocxProducaoDeLinhas } = await import("@/lib/pedido-venda/gerarDocxProducao");
            docxProducao = await gerarDocxProducaoDeLinhas(linhas, file.name);
            if (docxProducao) console.log('[PDF→DOCX produção] Gerado localmente das linhas extraídas');
          }
          if (!docxProducao) throw new Error('sem documento seguro');
          // Guard anti-corrida: só grava se este ainda é o arquivo importado atual
          if (arquivoOriginalRef.current === file) {
            arquivoProducaoRef.current = docxProducao;
            toast.success("Documento sem preço pronto — vai junto pra produção ✅", { duration: 8000 });
          }
        } catch (convErr) {
          console.error('[PDF→DOCX produção] Falhou:', convErr);
          if (arquivoOriginalRef.current === file) {
            arquivoProducaoRef.current = null;
            toast.warning(
              "Não consegui gerar o documento sem preço deste PDF — a Produção receberá só os dados. Se a fábrica precisa do documento, anexe o orçamento em Word (.docx).",
              { duration: 15000 }
            );
          }
        }
      } catch (pdfError) {
        console.error('[PDF] Erro na extração:', pdfError);
        toast.error("Não consegui ler este PDF. Verifique se é um orçamento gerado pelo sistema (com texto selecionável, não escaneado).");
      } finally {
        setIsExtracting(false);
      }
      return;
    }

    try {
      const formData = new FormData();
      formData.append('file', file);

      const { data, error } = await supabase.functions.invoke('extrair-orcamento', {
        body: formData,
      });

      if (error) throw error;

      // Atualizar estados com dados extraídos
      console.log('Dados extraídos do Word:', data);
      if (data.cliente) setCliente(data.cliente);
      if (data.atencao_a) setAtencaoA(data.atencao_a);
      if (data.telefone) setTelefone(data.telefone);
      if (data.cidade) setCidade(data.cidade);
      if (data.estado) setEstado(data.estado);
      if (data.endereco) setEndereco(data.endereco);
      if (data.bairro) setBairro(data.bairro);
      if (data.cpf_cnpj) setCpfCnpj(data.cpf_cnpj);
      if (data.cep) {
        console.log('CEP extraído:', data.cep);
        setCep(data.cep);
      } else {
        console.log('CEP não foi extraído do documento');
      }
      if (data.email) {
        console.log('E-mail extraído:', data.email);
        setEmail(data.email);
      }
      if (data.fantasia) setFantasia(data.fantasia);
      if (data.inscricao_estadual) setInscricaoEstadual(data.inscricao_estadual);
      if (data.numero_orcamento) {
        setNumeroOrcamento(data.numero_orcamento);
        setNumeroOrcamentoLocked(true);
      }
      
      // Usa valor com desconto como preferência
      const valorFinal = data.valor_total_com_desconto || data.valor_total;
      if (valorFinal) {
        const formatted = new Intl.NumberFormat('pt-BR', {
          style: 'currency',
          currency: 'BRL'
        }).format(valorFinal);
        setValorTotal(formatted);
        setValorTotalLocked(true);
      }
      
      if (data.equipamentos) setEquipamentos(data.equipamentos);
      
      // Integrar itens adicionais aos equipamentos
      let equipamentosFinais = data.equipamentos_detalhados || [];
      if (data.itens_adicionais && data.itens_adicionais.length > 0) {
        const itensComoEquipamentos = data.itens_adicionais.map((item: { descricao: string; valor: number }) => ({
          descricao: item.descricao,
          unidade: "UN",
          quantidade: 1,
          valor: item.valor
        }));
        equipamentosFinais = [...equipamentosFinais, ...itensComoEquipamentos];
      }
      
      // Criar array de strings para equipamentos sincronizado com equipamentosDetalhados
      const equipamentosStrings = equipamentosFinais.map((eq: { descricao: string }) => eq.descricao);
      setEquipamentos(equipamentosStrings);
      setEquipamentosDetalhados(equipamentosFinais);
      
      if (data.motores) setMotores(data.motores);
      if (data.observacoes) setObservacoes(data.observacoes);
      if (data.observacoes_orcamento) setObservacoesOrcamento(data.observacoes_orcamento);
      // Plano de pagamento: usa o do backend se já vier com parcelas; caso contrário,
      // deriva as parcelas a partir da forma de pagamento (à vista, entrada+saldo, forma padrão...).
      // "a combinar" / texto não estruturado -> deixa as Condições de Pagamento vazias.
      if (data.payment_plan?.parcelas?.length) {
        setPaymentPlan(data.payment_plan);
      } else {
        const planoDerivado = derivePaymentPlanFromForma(data.forma_pagamento, valorFinal || 0, dataVenda, dataEntrega);
        if (planoDerivado) setPaymentPlan(planoDerivado);
      }
      
      // Salvar novos dados extraídos em window para usar no payload
      // Calcular total incluindo itens adicionais
      const totalComItensAdicionais = (data.total_equipamentos || 0) + 
        (data.itens_adicionais?.reduce((sum: number, item: { valor?: number }) => sum + (item.valor || 0), 0) || 0);
      
      (window as any).equipamentosDetalhados = equipamentosFinais;
      (window as any).totalEquipamentos = totalComItensAdicionais;
      if (data.motores_quantidade_total !== undefined) {
        (window as any).motoresQuantidadeTotal = data.motores_quantidade_total;
      }
      if (data.motores_valor_total !== undefined) {
        (window as any).motoresValorTotal = data.motores_valor_total;
      }
      if (data.acessorios_quantidade !== undefined) {
        (window as any).acessoriosQuantidade = data.acessorios_quantidade;
      }
      if (data.acessorios_valor !== undefined) {
        (window as any).acessoriosValor = data.acessorios_valor;
      }
      if (data.valor_total !== undefined) {
        (window as any).valorTotalSemDesconto = data.valor_total;
      }
      if (data.valor_total_com_desconto !== undefined) {
        (window as any).valorTotalComDesconto = data.valor_total_com_desconto;
      }
      if (data.itens_adicionais) {
        (window as any).itensAdicionais = data.itens_adicionais;
      }
      
      // Exibir alertas se houver divergências
      if (data.alertas && data.alertas.length > 0) {
        setValidationAlerts(data.alertas);
        data.alertas.forEach((alerta: string) => {
          toast.warning(alerta, { duration: 10000 });
        });
      } else {
        setValidationAlerts([]);
      }
      
      if (data.tensao) {
        setTensao(data.tensao === "MONOFÁSICO" ? "Monofásico" : "Trifásico");
        if (data.voltagem) {
          setVoltagem(data.voltagem);
        } else {
          setVoltagem("");
        }
      } else {
        setTensao("");
        setVoltagem("");
      }
      if (data.forma_pagamento) setFormaPagamento(data.forma_pagamento);
      if (data.descricao_equipamento) setDescricaoEquipamento(data.descricao_equipamento);

      toast.success(`Extraído: ${data.equipamentos?.length || 0} equipamentos, ${data.motores?.length || 0} motores`);
      if (data.motores) setMotores(data.motores);

      toast.success("Dados extraídos com sucesso!");
      
      // Guardar referência do arquivo original para envio posterior ao App2
      arquivoOriginalRef.current = file;
      setStatusApp2('idle');
      
      // Salvar arquivo original na tabela orcamentos para uso posterior (botão fábrica)
      if (data.numero_orcamento) {
        try {
          console.log('[Orçamento] Salvando arquivo original para uso posterior...');
          
          // Fazer upload do arquivo original para o Storage
          const sanitizedFileName = file.name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-zA-Z0-9._-]/g, '_')
            .replace(/_+/g, '_');
          const storagePath = `orcamentos/${data.numero_orcamento.replace(/\s+/g, '_')}_${Date.now()}_${sanitizedFileName}`;
          
          const { error: uploadError } = await supabase.storage
            .from('pedidos')
            .upload(storagePath, file, { upsert: true });
          
          if (uploadError) {
            console.error('[Orçamento] Erro no upload do arquivo original:', uploadError);
          } else {
            // Obter URL pública
            const { data: urlData } = supabase.storage.from('pedidos').getPublicUrl(storagePath);
            
            // Upsert na tabela orcamentos
            const { error: upsertError } = await supabase
              .from('orcamentos')
              .upsert({
                numero: data.numero_orcamento,
                cliente: data.cliente || null,
                arquivo_url: urlData.publicUrl,
                vendedor: vendedor || null,
                data: new Date().toISOString().split('T')[0],
              }, { onConflict: 'numero' });
            
            if (upsertError) {
              console.error('[Orçamento] Erro ao salvar orçamento:', upsertError);
            } else {
              console.log('[Orçamento] Arquivo original salvo com sucesso:', urlData.publicUrl);
            }
          }
        } catch (orcErr) {
          console.error('[Orçamento] Erro ao salvar arquivo original:', orcErr);
        }
      }
    } catch (error) {
      console.error('Erro na extração via backend:', error);
      
      // Fallback: extração local com mammoth quando backend estiver bloqueado
      try {
        console.log('[Fallback] Tentando extração local com mammoth...');
        toast.info("Backend indisponível. Extraindo dados localmente...");

        const { extrairLocalComMammoth } = await import("@/lib/pedido-venda/extractDocxLocal");
        const data = await extrairLocalComMammoth(file);

        console.log('[Fallback] Dados extraídos localmente:', data);

        aplicarResultadoLocal(data, file);

        toast.success("Dados extraídos com sucesso (modo local)!");
      } catch (fallbackError) {
        console.error('[Fallback] Erro na extração local:', fallbackError);
        toast.error("Erro ao extrair dados do orçamento. Tente desativar extensões do navegador.");
      }
    } finally {
      setIsExtracting(false);
    }
  };

  // Função para converter File para base64
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remover o prefixo "data:application/...;base64,"
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  // Função para enviar documento para App2 (limpeza de preços)
  const enviarParaApp2 = async (pedidoId: string, file: File) => {
    setStatusApp2('sending');
    // App2 (limpeza de preços) trata um DOCX: o anexo original quando é Word,
    // ou o convertido sem preço (arquivoProducaoRef) quando o orçamento veio em PDF.
    // Sem nenhum dos dois, envia só os dados estruturados (App2 v6 aceita sem DOCX).
    const docParaProducao = file.name.toLowerCase().endsWith('.docx')
      ? file
      : arquivoProducaoRef.current;
    const isDocx = !!docParaProducao;
    toast.info(isDocx ? "Enviando para limpeza de preços..." : "Enviando dados à Produção (sem documento — orçamento em PDF)...");

    try {
      const base64 = docParaProducao ? await fileToBase64(docParaProducao) : null;

      // Preparar lista de equipamentos formatada para o App2
      const equipamentosFormatados = equipamentosDetalhados.map((eq, index) => ({
        numero: index + 1,
        descricao: eq.descricao,
        quantidade: eq.quantidade,
        unidade: eq.unidade || 'UN'
      }));
      
      // Preparar lista de motores formatada para o App2
      // Formato: { quantidade: number, modelo: string (contém potência e polos) }
      const motoresFormatados = motores.map((m) => ({
        quantidade: m.quantidade || 1,
        modelo: m.modelo || ''
      }));
      
      // === DEBUG LOGS App1 → App2 ===
      console.log('=== [DEBUG App2] Requisição PedidoForm.tsx ===');
      console.log('[DEBUG App2] Endpoint: enviar-docx-app2');
      console.log('[DEBUG App2] pedidoId:', pedidoId);
      console.log('[DEBUG App2] clienteNome:', cliente);
      console.log('[DEBUG App2] vendedorNome:', vendedor);
      console.log('[DEBUG App2] nomeArquivo:', file.name);
      console.log('[DEBUG App2] docxBase64 length:', base64?.length || 0);
      console.log('[DEBUG App2] equipamentos:', JSON.stringify(equipamentosFormatados, null, 2));
      console.log('[DEBUG App2] motores:', JSON.stringify(motoresFormatados, null, 2));
      console.log('[DEBUG App2] tensao:', tensao);
      console.log('[DEBUG App2] voltagem:', voltagem);
      console.log('[DEBUG App2] Supabase URL:', import.meta.env.VITE_SUPABASE_URL);
      console.log('[DEBUG App2] Token (primeiros 50 chars):', import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.substring(0, 50) + '...');
      console.log('=============================================');
      
      const { data, error } = await supabase.functions.invoke('enviar-docx-app2', {
        body: {
          pedidoId,
          clienteNome: cliente || '',
          vendedorNome: vendedor || '',
          docxBase64: base64,
          nomeArquivo: docParaProducao ? docParaProducao.name : null,
          // Dados estruturados extraídos do formulário
          equipamentos: equipamentosFormatados,
          motores: motoresFormatados,
          tensao: tensao || '',
          voltagem: voltagem || '',
          prazoDias: diasUteis,
          prazoTipo: tipoPrazo,
          prazoData: `${dataEntrega.getFullYear()}-${String(dataEntrega.getMonth() + 1).padStart(2, '0')}-${String(dataEntrega.getDate()).padStart(2, '0')}`,
          observacaoVendedor: observacoesAdicionais.trim() || '',
          checkListCompras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
          motorMarca: checklistCompras.motor_marca,
          numeroOrcamento: numeroOrcamento || ''
        }
      });

      // === DEBUG LOGS Response ===
      if (error) {
        console.error('[DEBUG App2] Erro completo:', {
          error: error,
          message: error?.message,
          stack: (error as any)?.stack
        });
        throw error;
      }
      
      if (!data?.ok) {
        console.error('[DEBUG App2] Resposta com erro:', JSON.stringify(data, null, 2));
        throw new Error(data?.error || 'Erro desconhecido');
      }
      
      console.log('[DEBUG App2] Resposta recebida:', JSON.stringify(data, null, 2));
      setStatusApp2('done');
      if (isDocx) {
        toast.success("Documento tratado enviado para Produção ✅");
      } else {
        toast.warning("Dados enviados à Produção SEM documento tratado (orçamento era PDF). Se a fábrica precisa do documento sem preço, importe o orçamento em .docx.", { duration: 12000 });
      }
    } catch (err) {
      console.error('[DEBUG App2] Erro ao enviar:', err);
      setStatusApp2('error');
      toast.error("Erro ao enviar para limpeza de preços");
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    await processFile(file);
    // Limpar o input file para permitir reupload do mesmo arquivo
    event.target.value = '';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    // Evita corrida: um 2º arquivo solto durante a extração/conversão do 1º
    // poderia deixar o doc de produção de um orçamento no pedido de outro.
    if (isExtracting) {
      toast.warning("Aguarde terminar o processamento do arquivo anterior.");
      return;
    }
    const file = e.dataTransfer.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

  const handleGerarPedido = async (formato: 'docx' | 'pdf' = 'docx') => {
    // Proteção SINCRONIZADA contra dupla submissão usando ref
    if (isProcessingRef.current) {
      console.log('⚠️ BLOQUEADO: Já está processando um pedido');
      return;
    }

    // Marcar como processando SINCRONAMENTE (não espera re-render)
    isProcessingRef.current = true;
    
    // Também marcar nos estados do React para UI
    if (formato === 'pdf') {
      setIsGeneratingPDF(true);
    } else {
      setIsGenerating(true);
    }

    // Se estiver editando, atualizar diretamente sem validações rigorosas
    if (pedidoInicial?.id) {
      try {
        console.log('💾 Iniciando atualização do pedido...');
        toast.info("Atualizando pedido...");

        const updateData = {
          numero_orcamento: numeroOrcamento,
          cliente: cliente || null,
          atencao_a: atencaoA || null,
          telefone: telefone || null,
          cidade: cidade || null,
          estado: estado || null,
          endereco: endereco || null,
          bairro: bairro || null,
          cep: cep || null,
          cpf_cnpj: cpfCnpj || null,
          fantasia: fantasia || null,
          inscricao_estadual: inscricaoEstadual || null,
          endereco_entrega_diferente: enderecoEntregaDiferente,
          endereco_entrega: enderecoEntregaDiferente ? enderecoEntrega : null,
          bairro_entrega: enderecoEntregaDiferente ? bairroEntrega : null,
          cep_entrega: enderecoEntregaDiferente ? cepEntrega : null,
          cidade_entrega: enderecoEntregaDiferente ? cidadeEntrega : null,
          estado_entrega: enderecoEntregaDiferente ? estadoEntrega : null,
          responsavel_recebimento: enderecoEntregaDiferente ? responsavelRecebimento : null,
          data_venda: `${dataVenda.getFullYear()}-${String(dataVenda.getMonth() + 1).padStart(2, '0')}-${String(dataVenda.getDate()).padStart(2, '0')}`,
          dias_uteis: diasUteis,
          tipo_prazo: tipoPrazo,
          data_entrega: `${dataEntrega.getFullYear()}-${String(dataEntrega.getMonth() + 1).padStart(2, '0')}-${String(dataEntrega.getDate()).padStart(2, '0')}`,
          data_entrega_manual: usarDataEntregaManual && dataEntregaManual ? `${dataEntregaManual.getFullYear()}-${String(dataEntregaManual.getMonth() + 1).padStart(2, '0')}-${String(dataEntregaManual.getDate()).padStart(2, '0')}` : null,
          vendedor,
          vendedor_2: vendedor2 || null,
          equipamentos_json: equipamentosDetalhados && equipamentosDetalhados.length > 0 ? equipamentosDetalhados : [],
          equipamentos_detalhados: equipamentosDetalhados && equipamentosDetalhados.length > 0 ? equipamentosDetalhados : [],
          motores_json: motores,
          tensao,
          voltagem,
          forma_pagamento: formaPagamento || null,
          descricao_equipamento: descricaoEquipamento || null,
          payment_plan_json: paymentPlan ? { ...paymentPlan, total: valorTotalNum > 0 ? valorTotalNum : (totalEquipamentosCalculado > 0 ? totalEquipamentosCalculado : paymentPlan.total) } : null,
          data_primeiro_contato: dataPrimeiroContato ? `${dataPrimeiroContato.getFullYear()}-${String(dataPrimeiroContato.getMonth() + 1).padStart(2, '0')}-${String(dataPrimeiroContato.getDate()).padStart(2, '0')}` : null,
          fonte_origem: fonteOrigem || null,
          valor_total: valorTotalNum > 0 ? valorTotalNum : (totalEquipamentosCalculado > 0 ? totalEquipamentosCalculado : null),
          checklist_compras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
        };

        console.log('📝 Dados a serem atualizados:', updateData);

        const { error, data } = await supabase
          .from('pedidos_venda')
          .update(updateData)
          .eq('id', pedidoInicial.id)
          .select();

        if (error) {
          console.error('❌ Erro ao atualizar pedido:', error);
          throw error;
        }

        if (!data || data.length === 0) {
          console.error('❌ Nenhum registro foi atualizado!');
          throw new Error('Nenhum registro foi atualizado');
        }

        console.log('✅ Pedido atualizado no banco de dados!', data[0]);

        // Regenerar o arquivo DOCX com as informações atualizadas
        console.log('📄 Regenerando arquivo DOCX...');
        toast.info("Regenerando arquivo do pedido...");

        const { data: retroData, error: retroError } = await supabase.functions.invoke('gerar-pedido-retroativo', {
          body: { order_id: pedidoInicial.id }
        });

        if (retroError) {
          console.error('❌ Erro ao regenerar arquivo:', retroError);
          toast.error("Pedido atualizado, mas erro ao regenerar arquivo");
        } else {
          console.log('✅ Arquivo regerado com sucesso!', retroData);
          toast.success("Pedido e arquivo atualizados com sucesso!");
        }

        // === Sincronizar edição com App2 ===
        try {
          console.log('=== [DEBUG App2] Sincronizando edição com App2 ===');
          
          const equipamentosFormatados = (equipamentosDetalhados && equipamentosDetalhados.length > 0)
            ? equipamentosDetalhados.map((eq: any) => ({
                descricao: eq.descricao || '',
                quantidade: eq.quantidade || 1,
                valorUnitario: eq.valorUnitario || 0,
                valorTotal: eq.valorTotal || 0,
              }))
            : equipamentos.filter(e => e.trim()).map(e => ({ descricao: e, quantidade: 1, valorUnitario: 0, valorTotal: 0 }));

          const motoresFormatados = motores.map((m) => ({
            quantidade: m.quantidade || 1,
            modelo: m.modelo || ''
          }));

          const { error: app2Error } = await supabase.functions.invoke('enviar-docx-app2', {
            body: {
              pedidoId: pedidoInicial.id,
              clienteNome: cliente || '',
              vendedorNome: vendedor || '',
              equipamentos: equipamentosFormatados,
              motores: motoresFormatados,
              tensao: tensao || '',
              voltagem: voltagem || '',
              prazoDias: diasUteis,
              prazoTipo: tipoPrazo,
              prazoData: `${dataEntrega.getFullYear()}-${String(dataEntrega.getMonth() + 1).padStart(2, '0')}-${String(dataEntrega.getDate()).padStart(2, '0')}`,
              observacaoVendedor: observacoesAdicionais.trim() || '',
              checkListCompras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
              motorMarca: checklistCompras.motor_marca,
              isUpdate: true,
            }
          });

          if (app2Error) {
            console.error('[DEBUG App2] Erro ao sincronizar edição:', app2Error);
            toast.error("Pedido atualizado localmente, mas erro ao sincronizar com App2");
          } else {
            console.log('[DEBUG App2] ✅ Edição sincronizada com App2!');
          }
        } catch (app2Err) {
          console.error('[DEBUG App2] Falha ao sincronizar edição:', app2Err);
          // Não bloquear o fluxo - pedido já foi salvo localmente
        }
        
        // Aguardar um pouco antes de redirecionar
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Forçar reload completo da página com timestamp para evitar cache
        const timestamp = new Date().getTime();
        window.location.href = `/controle/pedidos?t=${timestamp}`;
      } catch (error) {
        console.error('Erro ao atualizar pedido:', error);
        toast.error("Erro ao atualizar pedido");
      } finally {
        setIsGenerating(false);
        isProcessingRef.current = false;
      }
      return;
    }
    
    // Ativar validação visual e aguardar um momento para o React re-renderizar
    setShowValidation(true);
    
    // Aguardar um momento para o React atualizar a UI com os campos vermelhos
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Função helper para resetar os estados de loading quando falhar validação
    const resetLoading = () => {
      setIsGenerating(false);
      setIsGeneratingPDF(false);
      isProcessingRef.current = false;
    };

    // Se modo Partes e Outros estiver ativo, validar apenas vendedor e forma de pagamento
    if (modoPartesOutros) {
      if (!vendedor) {
        toast.error("Selecione um vendedor");
        resetLoading();
        return;
      }
      if (!formaPagamento || formaPagamento.trim() === "") {
        toast.error("Forma de pagamento é obrigatória");
        resetLoading();
        return;
      }
      // Pular para geração do pedido
    } else {
      // Validações completas para pedidos normais
      if (!numeroOrcamento.trim()) {
        toast.error("Número do orçamento é obrigatório");
        resetLoading();
        return;
      }
      if (!cliente.trim()) {
        toast.error("Nome do cliente é obrigatório");
        resetLoading();
        return;
      }
      if (!atencaoA.trim()) {
        toast.error("Campo 'Atenção A' é obrigatório");
        resetLoading();
        return;
      }
      if (!telefone.trim()) {
        toast.error("Telefone é obrigatório");
        resetLoading();
        return;
      }
      if (!cidade.trim()) {
        toast.error("Cidade é obrigatória");
        resetLoading();
        return;
      }
      if (!estado.trim()) {
        toast.error("Estado (UF) é obrigatório");
        resetLoading();
        return;
      }
      if (!endereco.trim()) {
        toast.error("Endereço é obrigatório");
        resetLoading();
        return;
      }
      if (!bairro.trim()) {
        toast.error("Bairro é obrigatório");
        resetLoading();
        return;
      }
      if (!cpfCnpj.trim()) {
        toast.error("CPF/CNPJ é obrigatório");
        resetLoading();
        return;
      }
      if (!cep.trim()) {
        toast.error("CEP é obrigatório");
        resetLoading();
        return;
      }
      // Validação de formato do e-mail (opcional, mas se preenchido deve ser válido)
      if (email.trim()) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email.trim())) {
          toast.error("E-mail inválido. Verifique o formato (ex: nome@dominio.com)");
          resetLoading();
          return;
        }
      }
      
      // Validação especial para CNPJ - verificar se fantasia está preenchido
      if (isCNPJ(cpfCnpj) && !fantasia.trim()) {
        toast.error("Para CNPJ, o campo Nome Fantasia é obrigatório");
        resetLoading();
        return;
      }
      
      // Validação de informações do orçamento
      if (!vendedor) {
        toast.error("Selecione um vendedor");
        resetLoading();
        return;
      }
      if (!descricaoEquipamento.trim()) {
        toast.error("Descrição do equipamento/fábrica é obrigatória");
        resetLoading();
        return;
      }
      if (!observacoesAdicionais.trim()) {
        toast.error("Observação do vendedor é obrigatória. Clique em 'Sem observação' se não houver.");
        resetLoading();
        return;
      }
      if (!dataVenda) {
        toast.error("Data da venda é obrigatória");
        resetLoading();
        return;
      }
      
      // Validação de voltagem - só exigir para Trifásico padrão
      if (tensao === "Trifásico" && !voltagem && !porContaCliente) {
        toast.error("Selecione a voltagem para motores trifásicos");
        resetLoading();
        return;
      }
      
      // Validação de valor total e plano de pagamento
      if (!valorTotal || valorTotal.trim() === "" || valorTotal === "R$ 0,00") {
        toast.error("Valor total é obrigatório");
        resetLoading();
        return;
      }
      if (!paymentPlan || !paymentPlan.parcelas || paymentPlan.parcelas.length === 0) {
        toast.error("Plano de pagamento é obrigatório");
        resetLoading();
        return;
      }
      if (!planoPagamentoValido) {
        toast.error("O plano de pagamento está incompleto ou os valores não batem com o total");
        resetLoading();
        return;
      }
      
      // Apenas validar fonte_origem se for pedido novo (não editando)
      if (!pedidoInicial && !fonteOrigem) {
        toast.error("Selecione como o cliente encontrou a empresa");
        resetLoading();
        return;
      }
      
      // Validação de endereço de entrega
      if (enderecoEntregaDiferente) {
        if (!enderecoEntrega.trim()) {
          toast.error("Endereço de entrega é obrigatório");
          resetLoading();
          return;
        }
        if (!cidadeEntrega.trim()) {
          toast.error("Cidade de entrega é obrigatória");
          resetLoading();
          return;
        }
        if (!estadoEntrega.trim()) {
          toast.error("Estado de entrega é obrigatório");
          resetLoading();
          return;
        }
        if (!responsavelRecebimento.trim()) {
          toast.error("Responsável pelo recebimento é obrigatório");
          resetLoading();
          return;
        }
      }

      // Validação de data de entrega manual
      if (usarDataEntregaManual && !dataEntregaManual) {
        toast.error("Selecione a data de entrega manual");
        resetLoading();
        return;
      }
    }

    // Ativar validação visual e aguardar um momento para o React re-renderizar
    setShowValidation(true);
    
    // Aguardar um momento para o React atualizar a UI com os campos vermelhos
    await new Promise(resolve => setTimeout(resolve, 100));

    // Notificar usuário do início do processamento
    if (formato === 'pdf') {
      toast.info("Gerando pedido em PDF...");
    } else {
      toast.info("Gerando pedido em Word...");
    }

    try {
      // Corrigir cidade/estado duplicado
      let cidadeFormatada = cidade || "";
      let estadoFormatado = estado || "";
      
      // Remover estado duplicado da cidade se existir
      if (cidadeFormatada && estadoFormatado) {
        cidadeFormatada = cidadeFormatada.replace(new RegExp(`\\s+${estadoFormatado}\\b`, 'gi'), "").trim();
      }
      
      // Usar os equipamentos EDITADOS pelo usuário (do estado React)
      const equipamentosEditados = equipamentosDetalhados || [];
      const motoresEquipamentos = equipamentosEditados.filter(eq =>
        eq.descricao.toLowerCase().includes("motor")
      );
      const outrosEquipamentos = equipamentosEditados.filter(
        eq => !eq.descricao.toLowerCase().includes("motor")
      );

      const valorMotores = motoresEquipamentos.reduce((s, m) => s + (m.valor ?? 0), 0);
      
      // Salvar APENAS equipamentos com descrição válida
      let equipamentosParaEnviar = equipamentosEditados.filter(eq => 
        eq.descricao && eq.descricao.trim().length > 0
      );

      // Calcular total dos equipamentos (incluindo motores)
      // Usa sumLineItems para evitar float drift (ex: 100.1 * 3 = 300.29999...)
      const itensAdicionais = (window as any).itensAdicionais || [];
      const totalEquipamentos = sumCurrency([
        sumLineItems(outrosEquipamentos, (e) => e.valor, (e) => e.quantidade ?? 1),
        valorMotores,
      ]);

      // Calcular total geral
      const totalItensAdicionais = sumCurrency(itensAdicionais.map((item: any) => item.valor));
      const valorTotalFinal = sumCurrency([totalEquipamentos, totalItensAdicionais]);
      
      // Usar valores extraídos do documento se disponíveis, senão usar valores calculados
      const valorTotalSemDesconto = (window as any).valorTotalSemDesconto || totalEquipamentos;
      const valorTotalComDesconto = (window as any).valorTotalComDesconto || totalEquipamentos;

      const payload = {
        numero_orcamento: numeroOrcamento,
        cliente: cliente || "Não informado",
        atencao_a: atencaoA || null,
        telefone: telefone || null,
        cidade: cidadeFormatada || null,
        estado: estadoFormatado || null,
        endereco: endereco || null,
        bairro: bairro || null,
        cpf_cnpj: cpfCnpj || null,
        cep: cep || null,
        email: email || null,
        fantasia: fantasia || null,
        inscricao_estadual: inscricaoEstadual || null,
        data_venda: `${dataVenda.getFullYear()}-${String(dataVenda.getMonth() + 1).padStart(2, '0')}-${String(dataVenda.getDate()).padStart(2, '0')}`,
        dias_uteis: diasUteis,
        tipo_prazo: tipoPrazo,
        data_entrega: `${dataEntrega.getFullYear()}-${String(dataEntrega.getMonth() + 1).padStart(2, '0')}-${String(dataEntrega.getDate()).padStart(2, '0')}`,
        data_entrega_manual: usarDataEntregaManual && dataEntregaManual ? `${dataEntregaManual.getFullYear()}-${String(dataEntregaManual.getMonth() + 1).padStart(2, '0')}-${String(dataEntregaManual.getDate()).padStart(2, '0')}` : null,
        vendedor,
        vendedor_2: vendedor2 || null,
        equipamentos,
        equipamentos_detalhados: equipamentosParaEnviar,
        motores,
        motores_quantidade_total: motoresEquipamentos.length,
        motores_valor_total: valorMotores,
        acessorios_quantidade: (window as any).acessoriosQuantidade || null,
        acessorios_valor: (window as any).acessoriosValor || null,
        motores_por_conta_cliente: motoresPorContaCliente,
        observacoes: [
          ...(especificacoesEletricas ? [especificacoesEletricas] : []),
          ...observacoes,
          ...(observacoesAdicionais.trim() ? [observacoesAdicionais.trim()] : [])
        ],
        observacoes_orcamento: observacoesOrcamento,
        total_equipamentos: totalEquipamentos,
        valor_total: valorTotalSemDesconto, // Valor sem desconto do documento
        valor_total_com_desconto: valorTotalComDesconto, // Valor com desconto do documento
        valor_total_final: valorTotalFinal,
        tensao,
        voltagem,
        forma_pagamento: formaPagamento || null,
        descricao_equipamento: descricaoEquipamento || null,
        payment_plan_json: paymentPlan,
        data_primeiro_contato: dataPrimeiroContato ? `${dataPrimeiroContato.getFullYear()}-${String(dataPrimeiroContato.getMonth() + 1).padStart(2, '0')}-${String(dataPrimeiroContato.getDate()).padStart(2, '0')}` : null,
        fonte_origem: fonteOrigem || null,
        checklist_compras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
      };

      const functionName = formato === 'pdf' ? 'gerar-pedido-pdf' : 'gerar-pedido';
      const { data, error } = await supabase.functions.invoke(functionName, {
        body: payload,
      });

      if (error) throw error;

      setArquivoUrl(data.arquivo_url);
      const tipoArquivo = formato === 'pdf' ? 'PDF' : 'Word (DOCX)';
      toast.success(`Pedido ${tipoArquivo} gerado com sucesso!`);
      
      // Baixar automaticamente o arquivo
      if (data.arquivo_url) {
        const link = document.createElement('a');
        link.href = data.arquivo_url;
        link.download = `Pedido_${numeroOrcamento}.${formato === 'pdf' ? 'pdf' : 'docx'}`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
      }
      
      // Enviar para App2 (limpeza de preços) se tiver arquivo original e pedido_id
      console.log('[App2 Debug] arquivoOriginalRef.current:', arquivoOriginalRef.current);
      console.log('[App2 Debug] pedido_id:', data.pedido_id);
      
      if (arquivoOriginalRef.current && data.pedido_id) {
        console.log('[App2] Iniciando envio para App2...');
        await enviarParaApp2(data.pedido_id, arquivoOriginalRef.current);
      } else {
        console.log('[App2] Condições não atendidas - arquivoOriginalRef:', !!arquivoOriginalRef.current, 'pedido_id:', !!data.pedido_id);
      }
      
      // Redirecionar para página de pedidos após sucesso
      setTimeout(() => {
        navigate("/controle/pedidos");
      }, 1500);
    } catch (error: any) {
      console.error('Erro na geração:', error);
      
      // Detectar erro de rede/bloqueio (inclui FunctionsFetchError do Supabase)
      const isNetworkError = 
        error?.message?.includes('Failed to fetch') || 
        error?.message?.includes('Failed to send') ||
        error?.message?.includes('NetworkError') ||
        error?.message?.includes('Edge Function') ||
        error?.name === 'FunctionsFetchError' ||
        error?.name === 'TypeError';
      
      if (isNetworkError) {
        console.log('[Fallback] Edge function bloqueada, salvando pedido localmente...');
        toast.info("Conexão bloqueada. Salvando pedido diretamente...", { duration: 5000 });
        
        try {
          // 1. Gerar número do pedido via RPC
          const dataVendaStr = `${dataVenda.getFullYear()}-${String(dataVenda.getMonth() + 1).padStart(2, '0')}-${String(dataVenda.getDate()).padStart(2, '0')}`;
          const { data: pedidoNumero, error: rpcError } = await supabase
            .rpc('gerar_pedido_numero', { p_data: dataVendaStr });
          
          if (rpcError) throw rpcError;
          
          console.log('[Fallback] Número do pedido gerado:', pedidoNumero);
          
          // Corrigir cidade/estado duplicado
          let cidadeFormatada = cidade || "";
          let estadoFormatado = estado || "";
          if (cidadeFormatada && estadoFormatado) {
            cidadeFormatada = cidadeFormatada.replace(new RegExp(`\\s+${estadoFormatado}\\b`, 'gi'), "").trim();
          }
          
          const equipamentosParaEnviar = (equipamentosDetalhados || []).filter(eq => 
            eq.descricao && eq.descricao.trim().length > 0
          );
          
          const dataEntregaStr = `${dataEntrega.getFullYear()}-${String(dataEntrega.getMonth() + 1).padStart(2, '0')}-${String(dataEntrega.getDate()).padStart(2, '0')}`;
          
          const numeroOrcFinal = (!numeroOrcamento || numeroOrcamento.startsWith('PV-TEMP-'))
            ? pedidoNumero
            : numeroOrcamento;
          
          // 2. Upload do DOCX via SDK (não é bloqueado pelo antivírus)
          let arquivoUrl = `SEM_DOCX:fallback_local_${Date.now()}`;
          
          if (arquivoOriginalRef.current) {
            try {
              const file = arquivoOriginalRef.current;
              const sanitizedName = (file.name || 'pedido.docx')
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-zA-Z0-9._-]/g, '_')
                .replace(/_+/g, '_');
              const storagePath = `Pedido_de_Venda_${pedidoNumero.replace(/\s/g, '_')}_${sanitizedName}`;
              const isPdfOriginal = (file.name || '').toLowerCase().endsWith('.pdf');

              const { error: uploadError } = await supabase.storage
                .from('pedidos')
                .upload(storagePath, file, {
                  contentType: isPdfOriginal
                    ? 'application/pdf'
                    : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  upsert: true,
                });
              
              if (!uploadError) {
                const { data: urlData } = supabase.storage.from('pedidos').getPublicUrl(storagePath);
                arquivoUrl = urlData.publicUrl;
                console.log('[Fallback] DOCX uploaded com sucesso:', arquivoUrl);
              } else {
                console.error('[Fallback] Erro no upload do DOCX (não-crítico):', uploadError);
              }
            } catch (uploadErr) {
              console.error('[Fallback] Erro ao fazer upload do DOCX:', uploadErr);
            }
          }
          
          // 3. Inserir pedido no banco
          const { data: insertedOrder, error: dbError } = await supabase
            .from('pedidos_venda')
            .insert({
              pedido_numero: pedidoNumero,
              numero_orcamento: numeroOrcFinal,
              cliente: cliente || null,
              atencao_a: atencaoA || null,
              telefone: telefone || null,
              cidade: cidadeFormatada || null,
              estado: estadoFormatado || null,
              endereco: endereco || null,
              bairro: bairro || null,
              cpf_cnpj: cpfCnpj || null,
              cep: cep || null,
              fantasia: fantasia || null,
              inscricao_estadual: inscricaoEstadual || null,
              data_venda: dataVendaStr,
              dias_uteis: diasUteis,
              tipo_prazo: tipoPrazo,
              data_entrega: dataEntregaStr,
              data_entrega_manual: usarDataEntregaManual && dataEntregaManual ? `${dataEntregaManual.getFullYear()}-${String(dataEntregaManual.getMonth() + 1).padStart(2, '0')}-${String(dataEntregaManual.getDate()).padStart(2, '0')}` : null,
              vendedor,
              vendedor_2: vendedor2 || null,
              equipamentos_json: equipamentos,
              motores_json: motores,
              equipamentos_detalhados: equipamentosParaEnviar,
              arquivo_url: arquivoUrl,
              valor_total: paymentPlan?.total || null,
              tensao: tensao || null,
              voltagem: voltagem || null,
              forma_pagamento: formaPagamento || null,
              descricao_equipamento: descricaoEquipamento || null,
              payment_plan_json: paymentPlan || null,
              data_primeiro_contato: dataPrimeiroContato ? `${dataPrimeiroContato.getFullYear()}-${String(dataPrimeiroContato.getMonth() + 1).padStart(2, '0')}-${String(dataPrimeiroContato.getDate()).padStart(2, '0')}` : null,
              fonte_origem: fonteOrigem || null,
              checklist_compras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
              status: 'ABERTO',
            })
            .select()
            .single();
          
          if (dbError) throw dbError;
          
          console.log('[Fallback] Pedido salvo no banco:', insertedOrder.id);
          
          // 3. Criar registro na produção
          try {
            const { data: primeiroEstagio } = await supabase
              .from('producao_estagios')
              .select('id, nome')
              .eq('ativo', true)
              .order('ordem', { ascending: true })
              .limit(1)
              .single();
            
            if (primeiroEstagio) {
              await supabase.from('producao_pedidos').insert({
                pedido_id: insertedOrder.id,
                estagio_id: primeiroEstagio.id,
              });
              
              await supabase.from('producao_historico').insert({
                pedido_id: insertedOrder.id,
                estagio_anterior: null,
                estagio_novo: primeiroEstagio.nome,
                movido_por: 'Sistema (fallback)',
                observacao: 'Pedido criado via fallback local (sem DOCX)',
              });
              console.log('[Fallback] Registro de produção criado');
            }
          } catch (prodError) {
            console.error('[Fallback] Erro na produção (não-crítico):', prodError);
          }
          
          // 4. Enviar ao App2 (com ou sem DOCX)
          try {
            console.log('[Fallback] Enviando ao App2...');
            let base64 = null;
            let nomeArq = null;
            
            // Anexa DOCX ao App2 (limpeza de preços): o original quando é Word,
            // ou o convertido sem preço (arquivoProducaoRef) quando o orçamento veio em PDF.
            const docFallback = arquivoOriginalRef.current?.name.toLowerCase().endsWith('.docx')
              ? arquivoOriginalRef.current
              : arquivoProducaoRef.current;
            // Envia o doc mesmo se o upload do original falhou — são independentes
            if (docFallback) {
              base64 = await fileToBase64(docFallback);
              nomeArq = docFallback.name;
            }
            
            const equipamentosFormatados = equipamentosDetalhados.map((eq, index) => ({
              numero: index + 1,
              descricao: eq.descricao,
              quantidade: eq.quantidade,
              unidade: eq.unidade || 'UN'
            }));
            
            const motoresFormatados = motores.map((m) => ({
              quantidade: m.quantidade || 1,
              modelo: m.modelo || ''
            }));
            
            const { error: app2Error } = await supabase.functions.invoke('enviar-docx-app2', {
              body: {
                pedidoId: insertedOrder.id,
                clienteNome: cliente || '',
                vendedorNome: vendedor || '',
                docxBase64: base64,
                nomeArquivo: nomeArq,
                tituloEquipamento: descricaoEquipamento || '',
                equipamentos: equipamentosFormatados,
                motores: motoresFormatados,
                tensao: tensao || '',
                voltagem: voltagem || '',
                prazoDias: diasUteis,
                prazoTipo: tipoPrazo,
                prazoData: dataEntregaStr,
                observacaoVendedor: observacoesAdicionais.trim() || '',
                checkListCompras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
                motorMarca: checklistCompras.motor_marca,
                numeroOrcamento: numeroOrcamento || '',
              }
            });

            if (app2Error) {
              console.error('[Fallback] Erro App2 (não-crítico):', app2Error);
            } else {
              console.log('[Fallback] App2 enviado com sucesso');
            }
          } catch (app2Err) {
            console.error('[Fallback] Erro ao enviar ao App2 (não-crítico):', app2Err);
          }
          
          // 5. Gerar parcelas
          if (paymentPlan?.parcelas?.length) {
            try {
              await supabase.functions.invoke('gerar-parcelas', {
                body: { order_id: insertedOrder.id }
              });
              console.log('[Fallback] Parcelas geradas');
            } catch (parcelasError) {
              console.error('[Fallback] Erro ao gerar parcelas (não-crítico):', parcelasError);
            }
          }
          
          toast.success("Pedido cadastrado com sucesso (modo local, sem documento Word)!", { duration: 6000 });
          
          setTimeout(() => {
            navigate("/controle/pedidos");
          }, 1500);
        } catch (fallbackError: any) {
          console.error('[Fallback] Erro no fallback local:', fallbackError);
          toast.error(`Erro ao cadastrar pedido (fallback): ${fallbackError?.message || 'Erro desconhecido'}`);
        }
      } else {
        toast.error(`Erro ao cadastrar pedido: ${error?.message || 'Erro desconhecido'}`);
      }
    } finally {
      setIsGenerating(false);
      setIsGeneratingPDF(false);
      isProcessingRef.current = false;
    }
  };

  return (
    <Card className="shadow-[var(--shadow-large)] border-2 bg-card overflow-hidden">
      {/* Header do Card */}
      <div className="bg-[var(--gradient-primary)] p-6 text-primary-foreground">
        <h2 className="text-2xl font-bold flex items-center gap-3">
          <FileText className="h-7 w-7" />
          Novo Pedido de Venda
        </h2>
        <p className="text-primary-foreground/80 mt-1">Preencha os dados ou faça upload de um orçamento DOCX</p>
      </div>

      <div className="p-6 space-y-6">
        {/* Botão Modo Partes e Outros - oculto quando já está ativo via URL */}
        {!modoPartesOutros && (
          <div className="flex items-center justify-between p-4 rounded-lg border-2 bg-muted/30" style={{
            borderColor: modoPartesOutros ? 'hsl(var(--primary))' : 'hsl(var(--border))',
            backgroundColor: modoPartesOutros ? 'hsl(var(--primary) / 0.05)' : 'hsl(var(--muted) / 0.3)'
          }}>
            <div className="flex items-center gap-3">
              <Package className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-semibold text-base">Modo: Partes e Outros</h3>
                <p className="text-xs text-muted-foreground">Apenas Vendedor e Forma de Pagamento são obrigatórios</p>
              </div>
            </div>
            <Button
              type="button"
              variant={modoPartesOutros ? "default" : "outline"}
              onClick={() => setModoPartesOutros(!modoPartesOutros)}
              className="font-semibold"
            >
              {modoPartesOutros ? "Ativo" : "Ativar"}
            </Button>
          </div>
        )}

        {/* Upload de Orçamento */}
        <div className="space-y-3">
          <Label htmlFor="file-upload" className="text-base font-semibold flex items-center gap-2">
            <Upload className="h-4 w-4 text-primary" />
            Upload do Orçamento (DOCX ou PDF)
          </Label>
          <div 
            className={cn(
              "border-2 border-dashed rounded-lg p-6 transition-colors bg-muted/30",
              isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            )}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <Label
              htmlFor="file-upload"
              className="flex flex-col items-center gap-3 cursor-pointer"
            >
              {isExtracting ? (
                <>
                  <Loader2 className="h-10 w-10 text-primary animate-spin" />
                  <span className="text-sm font-medium text-primary">Extraindo informações...</span>
                </>
              ) : (
                <>
                  <Upload className={cn("h-10 w-10", isDragging ? "text-primary" : "text-muted-foreground")} />
                  <span className={cn("text-sm font-medium", isDragging ? "text-primary" : "text-foreground")}>
                    {isDragging ? "Solte o arquivo aqui" : "Clique ou arraste o arquivo .docx ou .pdf"}
                  </span>
                  <span className="text-xs text-muted-foreground">Os dados serão extraídos automaticamente</span>
                </>
              )}
            </Label>
            <Input
              id="file-upload"
              type="file"
              accept=".docx,.pdf"
              onChange={handleFileUpload}
              disabled={isExtracting}
              className="hidden"
            />
          </div>
          
          {/* Feedback de status do App2 */}
          {statusApp2 === 'sending' && (
            <div className="flex items-center gap-2 text-blue-600 mt-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm font-medium">Enviando à Produção...</span>
            </div>
          )}
          {statusApp2 === 'done' && (
            <div className="flex items-center gap-2 text-green-600 mt-3 p-3 rounded-lg bg-green-50 border border-green-200">
              <CheckCircle className="h-4 w-4" />
              <span className="text-sm font-medium">Documento tratado enviado para Produção ✅</span>
            </div>
          )}
          {statusApp2 === 'error' && (
            <div className="flex items-center gap-2 text-red-600 mt-3 p-3 rounded-lg bg-red-50 border border-red-200">
              <span className="text-sm font-medium">❌ Erro ao enviar para limpeza de preços</span>
            </div>
          )}
        </div>

        <Separator className="my-8" />

        {/* Seções organizadas verticalmente */}
        <div className="space-y-6">
          {/* Dados do Cliente */}
          <div className="space-y-4">
            <div className="bg-muted/30 p-6 rounded-lg border">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-primary">
                <User className="h-5 w-5" />
                Informações do Cliente
              </h3>
              <div className="space-y-4">
                {/* Nome do Cliente - Full Width */}
                <div>
                  <Label htmlFor="cliente" className="font-medium">Nome do Cliente *</Label>
                  <Input
                    id="cliente"
                    value={cliente}
                    onChange={(e) => setCliente(e.target.value)}
                    placeholder="Ex: João Silva Ltda"
                    className={cn(
                      "mt-1",
                      isFieldEmpty(cliente) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                </div>

                {/* Grid para A/C e Telefone */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="atencao_a" className="font-medium">A/C (Atenção a) *</Label>
                    <Input
                      id="atencao_a"
                      value={atencaoA}
                      onChange={(e) => setAtencaoA(e.target.value)}
                      placeholder="Nome do contato"
                      className={cn(
                        "mt-1",
                        isFieldEmpty(atencaoA) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                      )}
                    />
                  </div>
                  <div>
                    <Label htmlFor="telefone" className="font-medium">Telefone/FONE *</Label>
                    <Input
                      id="telefone"
                      value={telefone}
                      onChange={(e) => setTelefone(e.target.value)}
                      placeholder="Ex: (11) 98765-4321"
                      className={cn(
                        "mt-1",
                        isFieldEmpty(telefone) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                      )}
                    />
                  </div>
                </div>

                {/* E-mail */}
                <div>
                  <Label htmlFor="email" className="font-medium">E-mail</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Ex: cliente@email.com"
                    className={cn(
                      "mt-1",
                      isFieldEmpty(email) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                </div>

                {/* Grid para CPF/CNPJ e Inscrição Estadual */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="cpf_cnpj" className="font-medium">CPF/CNPJ *</Label>
                    <Input
                      id="cpf_cnpj"
                      value={cpfCnpj}
                      onChange={(e) => setCpfCnpj(e.target.value)}
                      placeholder="Ex: 000.000.000-00 ou 00.000.000/0001-00"
                      className={cn(
                        "mt-1",
                        isFieldEmpty(cpfCnpj) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                      )}
                    />
                  </div>
                  <div>
                    <Label htmlFor="inscricao_estadual" className="font-medium">Inscrição Estadual</Label>
                    <Input
                      id="inscricao_estadual"
                      value={inscricaoEstadual}
                      onChange={(e) => setInscricaoEstadual(e.target.value)}
                      placeholder="Ex: 123.456.789.012"
                      className="mt-1"
                    />
                  </div>
                </div>

                {/* Fantasia - só aparece para CNPJ */}
                {cpfCnpj && cpfCnpj.replace(/\D/g, '').length === 14 && (
                  <div>
                    <Label htmlFor="fantasia" className="font-medium">Fantasia *</Label>
                    <Input
                      id="fantasia"
                      value={fantasia}
                      onChange={(e) => setFantasia(e.target.value)}
                      placeholder="Nome fantasia (obrigatório para CNPJ)"
                      className={cn(
                        "mt-1",
                        isFieldEmpty(fantasia) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                      )}
                    />
                  </div>
                )}

                {/* Endereço completo */}
                <div>
                  <Label htmlFor="endereco" className="font-medium">Endereço *</Label>
                  <Input
                    id="endereco"
                    value={endereco}
                    onChange={(e) => setEndereco(e.target.value)}
                    placeholder="Ex: Rua das Flores, 123"
                    className={cn(
                      "mt-1",
                      isFieldEmpty(endereco) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                </div>

                {/* Bairro sozinho */}
                <div>
                  <Label htmlFor="bairro" className="font-medium">Bairro *</Label>
                  <Input
                    id="bairro"
                    value={bairro}
                    onChange={(e) => setBairro(e.target.value)}
                    placeholder="Ex: Centro"
                    className={cn(
                      "mt-1",
                      isFieldEmpty(bairro) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                </div>

                {/* CEP */}
                <div>
                  <Label htmlFor="cep" className="font-medium">CEP *</Label>
                  <Input
                    id="cep"
                    value={cep}
                    onChange={(e) => setCep(e.target.value)}
                    placeholder="Ex: 12345-678"
                    className={cn(
                      "mt-1",
                      isFieldEmpty(cep) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                </div>

                 {/* Grid para Cidade e Estado */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="cidade" className="font-medium">Cidade *</Label>
                    <Input
                      id="cidade"
                      value={cidade}
                      onChange={(e) => setCidade(e.target.value)}
                      placeholder="Ex: São Paulo"
                      className={cn(
                        "mt-1",
                        isFieldEmpty(cidade) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                      )}
                    />
                  </div>
                  <div>
                    <Label htmlFor="estado" className="font-medium">Estado (UF) *</Label>
                    <Input
                       id="estado"
                       value={estado}
                       onChange={(e) => setEstado(e.target.value.toUpperCase())}
                       placeholder="Ex: SP"
                       maxLength={2}
                       className={cn(
                         "mt-1 uppercase",
                         isFieldEmpty(estado) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400",
                         // Destacar em laranja se houver inconsistência cidade x estado
                         detectarEstadoNaCidade(cidade) && detectarEstadoNaCidade(cidade) !== estado.toUpperCase() && "border-orange-400 bg-orange-50/50 focus:border-orange-400 focus:ring-orange-400"
                       )}
                     />
                   </div>
                 </div>

                 {/* Alerta de inconsistência cidade x estado */}
                 {detectarEstadoNaCidade(cidade) && detectarEstadoNaCidade(cidade) !== estado.toUpperCase() && estado.trim() !== '' && (
                   <div className="flex items-center gap-2 p-3 rounded-lg bg-orange-50 border border-orange-300 text-orange-800">
                     <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-orange-500 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
                       <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                     </svg>
                     <span className="text-sm font-medium">
                       ⚠️ A cidade contém "<strong>{detectarEstadoNaCidade(cidade)}</strong>" mas o estado selecionado é "<strong>{estado.toUpperCase()}</strong>". Verifique se está correto!
                     </span>
                   </div>
                 )}

                 {/* Endereço de entrega diferente */}
                 <div className="space-y-4 border-t pt-4 mt-4">
                   <div className="flex items-center space-x-2">
                     <Checkbox 
                       id="endereco_entrega_diferente"
                       checked={enderecoEntregaDiferente}
                       onCheckedChange={(checked) => setEnderecoEntregaDiferente(checked === true)}
                     />
                     <Label htmlFor="endereco_entrega_diferente" className="font-medium cursor-pointer">
                       Endereço de entrega é diferente do cadastro?
                     </Label>
                   </div>

                    {enderecoEntregaDiferente && (
                      <div className="space-y-4 pl-6 border-l-2 border-primary/30">
                        <div>
                          <Label htmlFor="endereco_entrega" className="font-medium">Endereço de Entrega *</Label>
                          <Input
                            id="endereco_entrega"
                            value={enderecoEntrega}
                            onChange={(e) => setEnderecoEntrega(e.target.value)}
                            placeholder="Ex: Rua das Flores, 123"
                            className={cn(
                              "mt-1",
                              enderecoEntregaDiferente && isFieldEmpty(enderecoEntrega) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                            )}
                          />
                        </div>
                        <div>
                          <Label htmlFor="bairro_entrega" className="font-medium">Bairro *</Label>
                          <Input
                            id="bairro_entrega"
                            value={bairroEntrega}
                            onChange={(e) => setBairroEntrega(e.target.value)}
                            placeholder="Ex: Centro"
                            className={cn(
                              "mt-1",
                              enderecoEntregaDiferente && isFieldEmpty(bairroEntrega) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                            )}
                          />
                        </div>
                        <div>
                          <Label htmlFor="cep_entrega" className="font-medium">CEP *</Label>
                          <Input
                            id="cep_entrega"
                            value={cepEntrega}
                            onChange={(e) => setCepEntrega(e.target.value)}
                            placeholder="Ex: 12345-678"
                            className={cn(
                              "mt-1",
                              enderecoEntregaDiferente && isFieldEmpty(cepEntrega) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                            )}
                          />
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                          <div>
                            <Label htmlFor="cidade_entrega" className="font-medium">Cidade *</Label>
                            <Input
                              id="cidade_entrega"
                              value={cidadeEntrega}
                              onChange={(e) => setCidadeEntrega(e.target.value)}
                              placeholder="Ex: São Paulo"
                              className={cn(
                                "mt-1",
                                enderecoEntregaDiferente && isFieldEmpty(cidadeEntrega) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                              )}
                            />
                          </div>
                          <div>
                            <Label htmlFor="estado_entrega" className="font-medium">Estado (UF) *</Label>
                            <Input
                              id="estado_entrega"
                              value={estadoEntrega}
                              onChange={(e) => setEstadoEntrega(e.target.value.toUpperCase())}
                              placeholder="Ex: SP"
                              maxLength={2}
                              className={cn(
                                "mt-1 uppercase",
                                enderecoEntregaDiferente && isFieldEmpty(estadoEntrega) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                              )}
                            />
                          </div>
                        </div>
                        <div>
                          <Label htmlFor="responsavel_recebimento" className="font-medium">Responsável pelo Recebimento *</Label>
                          <Input
                            id="responsavel_recebimento"
                            value={responsavelRecebimento}
                            onChange={(e) => setResponsavelRecebimento(e.target.value)}
                            placeholder="Nome do responsável"
                            className={cn(
                              "mt-1",
                              enderecoEntregaDiferente && isFieldEmpty(responsavelRecebimento) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                            )}
                          />
                        </div>
                      </div>
                   )}
                 </div>

                   {/* Grid para Data Primeiro Contato e Fonte de Origem */}
                   <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                     <div>
                       <Label className="font-medium">Data do Primeiro Contato {!modoPartesOutros && "*"}</Label>
                       <Popover>
                         <PopoverTrigger asChild>
                           <Button
                             variant="outline"
                             className={cn(
                               "w-full justify-start text-left font-normal mt-1",
                               !dataPrimeiroContato && "text-muted-foreground",
                               showValidation && !modoPartesOutros && !dataPrimeiroContato && "border-red-300 bg-red-50/50"
                             )}
                             onFocus={(e) => e.currentTarget.click()}
                           >
                             <CalendarIcon className="mr-2 h-4 w-4" />
                             {dataPrimeiroContato ? format(dataPrimeiroContato, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                           </Button>
                         </PopoverTrigger>
                          <PopoverContent className="w-auto p-0" align="start">
                            <Calendar
                              mode="single"
                              selected={dataPrimeiroContato}
                              onSelect={setDataPrimeiroContato}
                              initialFocus
                              className="pointer-events-auto"
                            />
                          </PopoverContent>
                       </Popover>
                      </div>
                      <div>
                        <Label htmlFor="fonte_origem" className="font-medium">Como o cliente encontrou a empresa? {!modoPartesOutros && "*"}</Label>
                        <Select value={fonteOrigem} onValueChange={setFonteOrigem}>
                          <SelectTrigger id="fonte_origem" className={cn(
                            "mt-1",
                            !modoPartesOutros && isFieldEmpty(fonteOrigem) && "border-red-300 bg-red-50/50"
                          )}>
                            <SelectValue placeholder="Selecione a fonte" />
                          </SelectTrigger>
                           <SelectContent>
                             <SelectItem value="facebook">Facebook</SelectItem>
                             <SelectItem value="instagram">Instagram</SelectItem>
                             <SelectItem value="google">Google</SelectItem>
                             <SelectItem value="youtube">YouTube</SelectItem>
                             <SelectItem value="site">Site</SelectItem>
                             <SelectItem value="indicacao">Indicação</SelectItem>
                             <SelectItem value="ja_era_cliente">Já era cliente</SelectItem>
                             <SelectItem value="representante">Representante</SelectItem>
                             <SelectItem value="feira">Feira</SelectItem>
                             <SelectItem value="lp_mini_fabrica">LANDINGPAGE - MINI FÁBRICA DE RAÇÃO</SelectItem>
                             <SelectItem value="lp_compacta_01">LANDINGPAGE - FÁBRICA DE RAÇÃO COMPACTA 01</SelectItem>
                             <SelectItem value="lp_compacta_01_master">LANDINGPAGE - FÁBRICA DE RAÇÃO COMPACTA 01 MASTER</SelectItem>
                             <SelectItem value="lp_compacta_02">LANDINGPAGE - FÁBRICA DE RAÇÃO COMPACTA 02</SelectItem>
                             <SelectItem value="lp_compacta_03">LANDINGPAGE - FÁBRICA DE RAÇÃO COMPACTA 03</SelectItem>
                             <SelectItem value="nao_lembra">Não lembra</SelectItem>
                             <SelectItem value="nao_informado">Não informado</SelectItem>
                           </SelectContent>
                        </Select>
                      </div>
                    </div>
                </div>
              </div>
            </div>

           {/* Dados do Orçamento */}
          <div className="space-y-4">
            <div className="bg-muted/30 p-6 rounded-lg border">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-primary">
                <FileText className="h-5 w-5" />
                Dados do Orçamento
              </h3>
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="numero_orcamento" className="font-medium">Número do Orçamento *</Label>
                    <Input
                      id="numero_orcamento"
                      value={numeroOrcamento}
                      onChange={(e) => setNumeroOrcamento(e.target.value)}
                      placeholder="Ex: 2025 - 1234"
                      className={cn(
                        "mt-1",
                        isFieldEmpty(numeroOrcamento) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                      )}
                    />
                  </div>
                  <div>
                    <Label htmlFor="vendedor" className="font-medium">
                      Vendedor Responsável *
                      {modoPartesOutros && <span className="ml-2 text-red-500 font-semibold animate-pulse">• Obrigatório</span>}
                    </Label>
                    <Select value={vendedor} onValueChange={setVendedor}>
                      <SelectTrigger className={cn(
                        "mt-1",
                        (isFieldEmpty(vendedor) || (modoPartesOutros && !vendedor)) && "border-red-300 bg-red-50/50"
                      )}>
                        <SelectValue placeholder="Selecione o vendedor" />
                      </SelectTrigger>
                      <SelectContent>
                        {VENDEDORES.map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor="vendedor2" className="font-medium">
                      Segundo Vendedor (opcional)
                    </Label>
                    <Select value={vendedor2} onValueChange={setVendedor2}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Nenhum" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="nenhum">Nenhum</SelectItem>
                        {VENDEDORES.filter(v => v !== vendedor).map((v) => (
                          <SelectItem key={v} value={v}>
                            {v}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground mt-1">
                      Venda compartilhada: valor dividido 50/50
                    </p>
                  </div>
                </div>

                <div>
                  <Label htmlFor="descricao_equipamento" className="font-medium">Descrição do Equipamento/Fábrica *</Label>
                  <Input
                    id="descricao_equipamento"
                    value={descricaoEquipamento}
                    onChange={(e) => setDescricaoEquipamento(e.target.value)}
                    placeholder="Ex: Fabrica de Ração Master - 300500 com moega e silos"
                    className={cn(
                      "mt-1",
                      isFieldEmpty(descricaoEquipamento) && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Extraído automaticamente do nome do arquivo entre parênteses
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <Label className="flex items-center gap-2 font-medium">
                      <CalendarIcon className="h-4 w-4" />
                      Data da Venda *
                    </Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left font-normal mt-1",
                            !dataVenda && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dataVenda ? format(dataVenda, "PPP", { locale: ptBR }) : "Selecione"}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={dataVenda}
                          onSelect={(date) => date && setDataVenda(date)}
                          initialFocus
                          locale={ptBR}
                        />
                      </PopoverContent>
                    </Popover>
                  </div>
                  <div>
                    <Label htmlFor="tipo_prazo" className="font-medium">Tipo de Prazo *</Label>
                    <Select value={tipoPrazo} onValueChange={(value: "uteis" | "corridos") => setTipoPrazo(value)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="uteis">Dias Úteis</SelectItem>
                        <SelectItem value="corridos">Dias Corridos</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div>
                  <Label htmlFor="dias_uteis" className="font-medium">
                    Prazo de Entrega ({tipoPrazo === "uteis" ? "dias úteis" : "dias corridos"}) *
                  </Label>
                  <Input
                    id="dias_uteis"
                    type="number"
                    min="1"
                    value={diasUteis}
                    onChange={(e) => setDiasUteis(parseInt(e.target.value) || 1)}
                    placeholder="Ex: 30"
                    className={cn(
                      "mt-1",
                      (!diasUteis || (diasUteis === 0 && !modoPartesOutros)) && showValidation && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                </div>

                {/* Opção de data manual */}
                <div className="space-y-3">
                  <div className="flex items-center space-x-2">
                    <Checkbox 
                      id="data_manual" 
                      checked={usarDataEntregaManual}
                      onCheckedChange={(checked) => {
                        setUsarDataEntregaManual(checked === true);
                        if (!checked) setDataEntregaManual(undefined);
                      }}
                    />
                    <Label htmlFor="data_manual" className="font-medium cursor-pointer">
                      Definir data de entrega manualmente
                    </Label>
                  </div>

                  {usarDataEntregaManual && (
                    <div>
                      <Label className="font-medium">Data de Entrega Manual *</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "w-full justify-start text-left font-normal mt-1",
                              !dataEntregaManual && "text-muted-foreground"
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4" />
                            {dataEntregaManual ? format(dataEntregaManual, "dd/MM/yyyy", { locale: ptBR }) : "Selecione a data"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={dataEntregaManual}
                            onSelect={setDataEntregaManual}
                            initialFocus
                            className="pointer-events-auto"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>
                  )}
                </div>
              </div>
              
              {dataEntrega && (
                <div className="mt-6 p-4 rounded-lg bg-accent/10 border border-accent/30">
                  <p className="text-sm font-semibold text-accent flex items-center gap-2">
                    <CalendarIcon className="h-4 w-4" />
                    Data prevista de entrega: {formatDateBR(dataEntrega)}
                    {usarDataEntregaManual && <span className="text-xs">(Manual)</span>}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Itens (Equipamentos, Motores) */}
          <div className="space-y-6">
            {/* 1. EQUIPAMENTOS (A, B, C, ACESSÓRIOS, CÉLULA, FRETE, MONTAGEM, ETC) */}
            <div className="bg-muted/30 p-6 rounded-lg border">
              {equipamentosDetalhados.length > 0 ? (
                <EquipamentosEditor
                  equipamentos={equipamentos}
                  equipamentosDetalhados={equipamentosDetalhados}
                  onChange={(newEquipamentos, newDetalhados) => {
                    setEquipamentos(newEquipamentos);
                    if (newDetalhados) {
                      setEquipamentosDetalhados(newDetalhados);
                      // Atualizar total no window para o resumo
                      const total = sumLineItems(newDetalhados, (eq) => eq.valor, (eq) => eq.quantidade);
                      (window as any).totalEquipamentos = total;
                    }
                  }}
                />
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="font-semibold text-lg flex items-center gap-2 text-primary">
                      <Settings className="h-5 w-5" />
                      Equipamentos
                    </h3>
                  </div>
                  <div className="text-center py-8 text-muted-foreground">
                    <Settings className="h-12 w-12 mx-auto mb-2 opacity-50" />
                    <p className="text-sm">Nenhum equipamento cadastrado</p>
                    <p className="text-xs mt-1">Faça upload de um orçamento para extrair automaticamente</p>
                  </div>
                </div>
              )}
            </div>

            {/* 2. MOTORES INCLUSOS */}
            <div className="bg-muted/30 p-6 rounded-lg border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 text-primary">
                  <Package className="h-5 w-5" />
                  Motores Inclusos
                </h3>
              </div>
              {motores.length > 0 ? (
                <div className="space-y-2 max-h-[300px] overflow-y-auto">
                  {motores.map((motor, index) => (
                    <div key={index} className="flex items-center gap-2 p-3 rounded-lg bg-card border hover:border-primary/50 transition-colors">
                      <span className="font-bold text-primary text-base">{motor.quantidade}x</span>
                      <span className="font-medium text-sm flex-1">{motor.modelo}</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">Nenhum motor extraído ainda</p>
                  <p className="text-xs mt-1">Faça upload de um orçamento para extrair automaticamente</p>
                </div>
              )}
            </div>

            {/* 2.1 CHECK LIST DE COMPRAS */}
            <div className="bg-muted/30 p-6 rounded-lg border">
              <div className="flex items-center justify-between mb-4">
                <h3 className="font-semibold text-lg flex items-center gap-2 text-primary">
                  <Package className="h-5 w-5" />
                  Check List projeto
                </h3>
              </div>
              <ChecklistComprasEditor
                value={checklistCompras}
                onChange={setChecklistCompras}
              />
            </div>

            {/* 3. OBSERVAÇÕES DO ORÇAMENTO — ESCRITÓRIO (readonly) */}
            {observacoesOrcamento && observacoesOrcamento.trim() && (
              <div className="bg-muted/30 p-6 rounded-lg border">
                <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-primary">
                  <FileText className="h-5 w-5" />
                  Observações do Orçamento — Escritório
                </h3>
                <div className="p-4 bg-accent/5 rounded-lg border border-accent/20">
                  <Textarea
                    value={observacoesOrcamento}
                    readOnly
                    className="min-h-[120px] bg-transparent border-none resize-none text-sm"
                  />
                </div>
              </div>
            )}

            {/* Tensão e Voltagem */}
            <div className="bg-muted/30 p-6 rounded-lg border">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-primary">
                <Settings className="h-5 w-5" />
                Especificações Elétricas
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label className="font-medium">Tipo de Tensão *</Label>
                  <Select value={tensao} onValueChange={(value: "" | "Trifásico" | "Monofásico" | "Trifásico: Motores por conta do cliente" | "Monofásico: Por conta do cliente" | "Sem motor") => {
                    setTensao(value);
                    setVoltagem("");
                  }}>
                    <SelectTrigger className="mt-1">
                      <SelectValue placeholder="Selecione" />
                    </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Trifásico">Trifásico</SelectItem>
                          <SelectItem value="Monofásico">Monofásico</SelectItem>
                          <SelectItem value="Trifásico: Motores por conta do cliente">Trifásico: Motores por conta do cliente</SelectItem>
                          <SelectItem value="Monofásico: Por conta do cliente">Monofásico: Por conta do cliente</SelectItem>
                          <SelectItem value="Sem motor">Sem motor</SelectItem>
                        </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="font-medium">Voltagem (V) *</Label>
                  {(tensao === "Trifásico" || tensao === "Trifásico: Motores por conta do cliente") ? (
                    <Select value={voltagem} onValueChange={setVoltagem}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Selecione a voltagem" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="220">220V</SelectItem>
                        <SelectItem value="380">380V</SelectItem>
                        <SelectItem value="660">660V</SelectItem>
                        <SelectItem value="A confirmar">FICA A CONFIRMAR</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : tensao === "Sem motor" ? (
                    <Input
                      value="N/A"
                      disabled
                      className="mt-1 bg-muted"
                    />
                  ) : (
                    <Input
                      value="220V"
                      disabled
                      className="mt-1 bg-muted"
                    />
                  )}
                </div>
              </div>
              <div className="flex items-center space-x-2 mt-4">
                <Checkbox 
                  id="por-conta-cliente" 
                  checked={porContaCliente}
                  onCheckedChange={(checked) => {
                    setPorContaCliente(checked as boolean);
                    if (checked) {
                      setDialogMotoresAberto(true);
                    } else {
                      setMotoresPorContaCliente([]);
                    }
                  }}
                />
                <Label 
                  htmlFor="por-conta-cliente" 
                  className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 cursor-pointer"
                >
                  MOTORES POR CONTA DO CLIENTE
                </Label>
                {porContaCliente && motoresPorContaCliente.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setDialogMotoresAberto(true)}
                    className="ml-auto text-xs"
                  >
                    Editar seleção ({motoresPorContaCliente.length})
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-3">
                {tensao === "Trifásico" || tensao === "Trifásico: Motores por conta do cliente"
                  ? "Para motores trifásicos, selecione a voltagem adequada"
                  : tensao === "Sem motor"
                  ? "Este equipamento não possui motor"
                  : "Motores monofásicos utilizam 220V"}
              </p>
            </div>
          </div>

          {/* Observações / Itens Adicionais */}
          <div className="space-y-4">
            <div className="bg-muted/30 p-6 rounded-lg border">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-primary">
                <FileText className="h-5 w-5" />
                Observações / Itens Adicionais
              </h3>
              
              {/* Especificações Elétricas (automáticas) */}
              {especificacoesEletricas && (
                <div className="mb-4">
                  <Label className="font-medium text-sm text-primary">Especificações Elétricas (Automático)</Label>
                  <div className="p-3 mt-1 rounded-lg bg-primary/5 border border-primary/20">
                    <span className="text-sm font-medium">{especificacoesEletricas}</span>
                  </div>
                </div>
              )}
              
              {/* Observações extraídas do orçamento */}
              {observacoes.length > 0 && (
                <div className="mb-4">
                  <Label className="font-medium text-sm">Observações do Orçamento</Label>
                  <div className="space-y-2 mt-1 max-h-[150px] overflow-y-auto">
                    {observacoes.map((obs, index) => (
                      <div key={index} className="p-3 rounded-lg bg-card border">
                        <span className="text-sm">{obs}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
                {/* Campo para observação do vendedor (obrigatório) */}
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor="obs-adicionais" className="font-medium">
                      Observação do Vendedor <span className="text-destructive">*</span>
                    </Label>
                    <Button
                      type="button"
                      variant={observacoesAdicionais === "Sem observação" ? "default" : "outline"}
                      size="sm"
                      onClick={() => {
                        if (observacoesAdicionais === "Sem observação") {
                          setObservacoesAdicionais("");
                        } else {
                          setObservacoesAdicionais("Sem observação");
                        }
                      }}
                    >
                      Sem observação
                    </Button>
                  </div>
                 <Textarea
                    id="obs-adicionais"
                    value={observacoesAdicionais}
                    onChange={(e) => setObservacoesAdicionais(e.target.value)}
                    placeholder="Digite aqui a observação do vendedor sobre este pedido..."
                    className={`mt-1 min-h-[100px] ${isFieldEmpty(observacoesAdicionais) && observacoesAdicionais !== "Sem observação" ? 'border-destructive' : ''}`}
                    disabled={observacoesAdicionais === "Sem observação"}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Campo obrigatório — informe observações relevantes ou clique em "Sem observação"
                  </p>
                </div>
              
              {!especificacoesEletricas && observacoes.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <FileText className="h-12 w-12 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">As especificações elétricas serão preenchidas automaticamente</p>
                  <p className="text-xs mt-1">Selecione tensão e voltagem para gerar as especificações</p>
                </div>
              )}
            </div>
          </div>

          {/* Valores e Forma de Pagamento */}
          <div className="space-y-4">
            <div className="bg-muted/30 p-6 rounded-lg border">
              <h3 className="font-semibold text-lg mb-4 flex items-center gap-2 text-primary">
                <DollarSign className="h-5 w-5" />
                Valor e Forma de Pagamento
              </h3>
              <div className="space-y-4">
                <div>
                  <Label htmlFor="valor_total" className="font-medium">Valor Total da Proposta (R$) *</Label>
                  <Input
                    id="valor_total"
                    type="text"
                    value={valorTotal}
                    onChange={(e) => setValorTotal(e.target.value)}
                    placeholder="Ex: 150.000,00"
                    className={cn(
                      "mt-1 text-lg font-semibold",
                      (isFieldEmpty(valorTotal) || valorTotal === "R$ 0,00") && "border-red-300 bg-red-50/50 focus:border-red-400 focus:ring-red-400"
                    )}
                  />
                  <p className="text-xs text-muted-foreground mt-1">
                    Este valor será usado para calcular as parcelas
                  </p>
                </div>

                {validationAlerts.length > 0 && (
                  <div className="bg-amber-50 border-2 border-amber-300 dark:bg-amber-950/20 dark:border-amber-800 p-4 rounded-lg">
                    <h4 className="font-semibold text-sm text-amber-900 dark:text-amber-200 mb-2">⚠️ Alertas de Validação</h4>
                    <ul className="space-y-1">
                      {validationAlerts.map((alerta, i) => (
                        <li key={i} className="text-xs text-amber-800 dark:text-amber-300">{alerta}</li>
                      ))}
                    </ul>
                  </div>
                )}

                <Separator className="my-4" />

                <div>
                  <h4 className="font-semibold text-base mb-3">Condições de Pagamento *</h4>
                  <PaymentPlanEditor
                    valorTotal={valorTotal ? parseFloat(valorTotal.replace(/[^\d,]/g, '').replace(',', '.')) : 0}
                    paymentPlan={paymentPlan}
                    onChange={setPaymentPlan}
                    dataEntrega={dataEntrega}
                    dataVenda={dataVenda}
                  />
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Botão de Gerar */}
        <div className="pt-6">
          <Button
            onClick={() => handleGerarPedido('docx')}
            disabled={isGenerating || isGeneratingPDF || isExtracting || !numeroOrcamento || !vendedor || !planoPagamentoValido || (!voltagem && !porContaCliente && tensao === "Trifásico")}
            className={cn(
              "w-full h-14 text-lg font-bold shadow-[var(--shadow-medium)] transition-all hover:scale-[1.02]",
              (!vendedor || !planoPagamentoValido || (!voltagem && !porContaCliente && tensao === "Trifásico")) 
                ? "bg-muted hover:bg-muted text-muted-foreground cursor-not-allowed" 
                : "bg-green-600 hover:bg-green-700 text-white"
            )}
          >
            {isGenerating ? (
              <>
                <Loader2 className="mr-2 h-6 w-6 animate-spin" />
                {pedidoInicial ? "Salvando..." : "Gerando..."}
              </>
            ) : (
              <>
                <FileText className="mr-2 h-6 w-6" />
                {pedidoInicial ? "Salvar Alterações" : "Gerar Word (DOCX)"}
              </>
            )}
          </Button>
          {!planoPagamentoValido && paymentPlan && paymentPlan.parcelas && paymentPlan.parcelas.length > 0 && (
            <p className="text-xs text-destructive mt-2 text-center">
              Complete todas as informações do plano de pagamento (descrição, data e valor) e certifique-se que a soma está correta
            </p>
          )}
          {!vendedor && (
            <p className="text-xs text-destructive mt-2 text-center">
              Selecione um vendedor responsável
            </p>
          )}
          {!voltagem && !porContaCliente && tensao === "Trifásico" && (
            <p className="text-xs text-destructive mt-2 text-center">
              Selecione a voltagem
            </p>
          )}
        </div>

        {/* Mensagem de Sucesso */}
        {arquivoUrl && (
          <div className="p-6 rounded-lg bg-[var(--gradient-accent)] text-accent-foreground flex items-center gap-4 animate-in fade-in slide-in-from-bottom-4 shadow-[var(--shadow-accent)]">
            <div className="p-3 rounded-lg bg-accent-foreground/10">
              <FileText className="h-8 w-8" />
            </div>
            <div>
              <p className="font-bold text-lg">Pedido gerado com sucesso!</p>
              <p className="text-sm opacity-90">O download foi iniciado automaticamente</p>
            </div>
          </div>
        )}
      </div>

      {/* Dialog de Seleção de Motores Por Conta do Cliente */}
      <Dialog open={dialogMotoresAberto} onOpenChange={setDialogMotoresAberto}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Selecionar Motores Por Conta do Cliente</DialogTitle>
            <DialogDescription>
              Marque os motores que serão fornecidos por conta do cliente
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {motores.length > 0 ? (
              motores.map((motor, index) => (
                <div
                  key={index}
                  className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted/50 transition-colors"
                >
                  <Checkbox
                    id={`motor-${index}`}
                    checked={motoresPorContaCliente.includes(index)}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setMotoresPorContaCliente([...motoresPorContaCliente, index]);
                      } else {
                        setMotoresPorContaCliente(motoresPorContaCliente.filter(i => i !== index));
                      }
                    }}
                  />
                  <Label
                    htmlFor={`motor-${index}`}
                    className="flex-1 cursor-pointer flex items-center gap-2"
                  >
                    <span className="font-bold text-primary text-base">{motor.quantidade}x</span>
                    <span className="font-medium">{motor.modelo}</span>
                  </Label>
                </div>
              ))
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Nenhum motor disponível para seleção
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogMotoresAberto(false)}
            >
              Fechar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
