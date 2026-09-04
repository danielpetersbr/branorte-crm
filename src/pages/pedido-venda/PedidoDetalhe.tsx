// Detalhe do Pedido de Venda — portado de controle.branorte.com
// (`src/pages/PedidoDetalhe.tsx`) pra dentro do CRM.
//
// TRÊS COISAS QUE MUDARAM NA TRAVESSIA (não são liberdade poética):
//
// 1. NÃO TEM HEADER PRÓPRIO. Na origem a página era o app inteiro e trazia
//    "Menu Inicial / Ver Pedidos / Sair" no topo. Aqui ela mora DENTRO do Layout
//    do CRM, que já tem sidebar e logout — repetir viraria navegação dupla. Sobra
//    um voltar discreto pra /controle/pedidos.
//
// 2. LÊ A TABELA VIVA. `pedidos_venda` no projeto do CONTROLE
//    (kfucuvwrnwrkshxpsmyq), via `@/lib/controle-supabase/client` — nunca
//    `mirror_pedidos_venda`, que é espelho read-only e chega atrasado. Escrita
//    (status, ajuste, número do orçamento, exclusão) também vai na viva.
//
// 3. AS ESCRITAS PASSAM PELO SERVIDOR, NÃO PELO BROWSER. Status, número do
//    orçamento e ajuste vão por `/api/controle-atualizar-pedido`; a exclusão por
//    `/api/controle-deletar-pedido`. Dois motivos: (a) RECORTE — gravando direto
//    com a anon key não havia nada impedindo um `role='vendor'` de mexer no
//    pedido do colega; (b) a cascata da exclusão e o reespelhamento precisam de
//    credencial que não pode ir pro bundle.
//
// 4. TEM RECORTE POR VENDEDOR. admin/financeiro veem tudo; os demais só os
//    pedidos em que são `vendedor` ou `vendedor_2`. A regra vem de
//    `@/lib/escopo-pedidos` — o MESMO módulo da lista.
import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { useParams, useNavigate, useLocation } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft,
  Check,
  Copy,
  DollarSign,
  Download,
  Edit2,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Lock,
  Tag,
  Trash2,
  X,
} from "lucide-react";

import { supabase, CONTROLE_URL, CONTROLE_ANON_KEY } from "@/lib/controle-supabase/client";
// Client do CRM (≠ do controle): só pra pegar o JWT da sessão que autentica as
// rotas /api/ deste repo. Apelidado pra não colidir com o `supabase` do controle.
import { supabase as crmSupabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useVendedorNome } from "@/hooks/useVendedorNome";
// Recorte por vendedor: MESMO módulo que a lista /controle/pedidos usa. Não
// duplicar a regra aqui — se as duas telas discordarem, uma delas vaza.
import {
  resolverEscopo,
  escopoPodeConsultar,
  pedidoNoEscopo,
  descreveEscopo,
  MSG_FORA_DO_ESCOPO,
} from "@/lib/escopo-pedidos";
import type { Database } from "@/lib/controle-supabase/types";
import { Button } from "@/components/pedido-ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/pedido-ui/card";
import { Input } from "@/components/pedido-ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/pedido-ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/pedido-ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/pedido-ui/alert-dialog";
import { AjusteValorModal } from "@/components/pedido-venda/AjusteValorModal";
import { StatusBadgePedido, STATUS_LABEL } from "@/components/pedido-venda/StatusBadgePedido";

// O visualizador carrega o mammoth (~600 KB) — fica fora do bundle da rota.
const DocViewer = lazy(() => import("@/components/pedido-venda/DocViewer"));

type PedidoRow = Database["public"]["Tables"]["pedidos_venda"]["Row"];
type PedidoStatus = Database["public"]["Enums"]["pedido_status"];

const STATUS_OPCOES: PedidoStatus[] = ["ABERTO", "FECHADO", "CANCELADO"];

// ─────────────────────────────────────────────────────────────────────────────
// Leitura defensiva de jsonb
//
// `equipamentos_json`, `motores_json` e `payment_plan_json` são `Json` no tipo
// gerado — ou seja, QUALQUER coisa. Na prática o banco tem três gerações de
// gravação convivendo: array de string, array de objeto, e (em linhas antigas)
// o JSON ainda como TEXTO dentro do jsonb. Ler com `as any` até funciona, mas
// quebra em runtime na primeira linha fora do padrão. Daí os parsers abaixo.
// ─────────────────────────────────────────────────────────────────────────────

function asRecord(valor: unknown): Record<string, unknown> | null {
  if (typeof valor === "string") {
    try {
      return asRecord(JSON.parse(valor));
    } catch {
      return null;
    }
  }
  if (valor && typeof valor === "object" && !Array.isArray(valor)) {
    return valor as Record<string, unknown>;
  }
  return null;
}

function asArray(valor: unknown): unknown[] {
  if (typeof valor === "string") {
    try {
      const parsed: unknown = JSON.parse(valor);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return Array.isArray(valor) ? valor : [];
}

/** Number() tolerante: string "12345.67" do jsonb vira número; lixo vira 0. */
function num(valor: unknown): number {
  if (valor == null || valor === "") return 0;
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

interface MotorItem {
  modelo: string;
  quantidade: number;
}

interface Parcela {
  n: number;
  descricao: string;
  vencimento: unknown;
  valor: unknown;
  /** Data concreta do vencimento (YYYY-MM-DD). É o irmão que o `vencimento:"custom"` esconde. */
  data: string | null;
  /** PIX, Boleto, etc. Existe no banco e não era exibido. */
  metodo: string | null;
}

interface PaymentPlan {
  total: number;
  observacao: string | null;
  parcelas: Parcela[];
}

function parsePaymentPlan(raw: unknown): PaymentPlan | null {
  const obj = asRecord(raw);
  if (!obj) return null;
  const parcelas = asArray(obj.parcelas).map((p: unknown, i: number): Parcela => {
    const r = asRecord(p) ?? {};
    return {
      n: typeof r.n === "number" ? r.n : i + 1,
      descricao: typeof r.descricao === "string" ? r.descricao : "",
      vencimento: r.vencimento,
      valor: r.valor,
      data: typeof r.data === "string" && r.data.trim() ? r.data : null,
      metodo: typeof r.metodo === "string" && r.metodo.trim() ? r.metodo : null,
    };
  });
  const obs = typeof obj.observacao === "string" ? obj.observacao.trim() : "";
  return { total: num(obj.total), observacao: obs || null, parcelas };
}

function parseEquipamentos(raw: unknown): string[] {
  return asArray(raw)
    .map((eq: unknown): string => {
      if (typeof eq === "string") return eq;
      const r = asRecord(eq);
      if (!r) return "";
      const candidato = r.descricao ?? r.nome ?? r.equipamento ?? r.item;
      if (typeof candidato === "string" && candidato.trim()) return candidato;
      // Último recurso: mostra o objeto cru em vez de sumir com a linha.
      return JSON.stringify(eq);
    })
    .filter((s: string) => s.trim().length > 0);
}

function parseMotores(raw: unknown): MotorItem[] {
  return asArray(raw)
    .map((m: unknown): MotorItem | null => {
      if (typeof m === "string") return m.trim() ? { modelo: m, quantidade: 1 } : null;
      const r = asRecord(m);
      if (!r) return null;
      const modelo =
        typeof r.modelo === "string" ? r.modelo : typeof r.nome === "string" ? r.nome : "";
      if (!modelo.trim()) return null;
      return { modelo, quantidade: num(r.quantidade) || 1 };
    })
    .filter((m: MotorItem | null): m is MotorItem => m !== null);
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatação
// ─────────────────────────────────────────────────────────────────────────────

function formatarValor(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

/**
 * Data "nua" (YYYY-MM-DD) fatiada na mão de propósito: `new Date('2026-01-05')`
 * é meia-noite UTC e, no fuso -03, volta a exibir 04/01. Isso já fez pedido
 * aparecer entregue um dia antes.
 */
function formatarData(data: string | null | undefined): string {
  if (!data) return "—";
  const [ano, mes, dia] = data.split("T")[0].split("-");
  if (!ano || !mes || !dia) return data;
  return `${dia}/${mes}/${ano}`;
}

function formatarDataHora(valor: string | null | undefined): string {
  if (!valor) return "—";
  const d = new Date(valor);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR");
}

/**
 * Vencimento da parcela, olhando a PARCELA INTEIRA e não só o campo `vencimento`.
 *
 * ⚠️ `vencimento: "custom"` NÃO quer dizer "personalizado, data desconhecida" —
 * quer dizer "a data está no irmão `data`". No PV-2026-2142 as 5 parcelas trazem
 * 2026-03-26, 04-20, 05-20, 06-19 e 07-19, e a tela imprimia "Personalizado"
 * cinco vezes, jogando fora o dado que estava do lado.
 *
 * Regra: data concreta ganha sempre. Só cai no rótulo relativo ("+30 dias") quando
 * não existe data nenhuma.
 */
function formatarVencimentoDaParcela(parcela: Parcela): string {
  if (parcela.data) return formatarData(parcela.data);
  return formatarVencimento(parcela.vencimento);
}

function formatarVencimento(venc: unknown): string {
  if (!venc) return "—";

  if (typeof venc === "string") {
    const mapa: Record<string, string> = {
      hoje: "Hoje",
      emissao_nf: "Emissão NF",
      "+30": "+30 dias",
      "+60": "+60 dias",
      "+90": "+90 dias",
      custom: "Personalizado",
    };
    return mapa[venc] ?? "—";
  }

  const o = asRecord(venc);
  if (o) {
    if (o.tipo === "imediato") return "No pedido";
    if (o.tipo === "apos_dias") return `+${num(o.dias)} dias`;
    if (o.tipo === "data" && typeof o.data === "string") return formatarData(o.data);
  }

  return "—";
}

function calcularValorParcela(valor: unknown, total: number): number {
  const o = asRecord(valor);
  if (!o) return 0;
  if (o.tipo === "percentual") return (total * num(o.percentual)) / 100;
  return num(o.fixo);
}

/**
 * ⚠️ `arquivo_url` NÃO GUARDA ORÇAMENTO. Nunca guardou.
 *
 * Contado no banco (456 pedidos com arquivo http): 445 são `Pedido_de_Venda_*`
 * e 11 são `Pedido_Garantia_*`. ZERO orçamentos. A tela de origem chama os três
 * botões de "Orçamento" porque a COLUNA se chama assim — o resultado é que o
 * vendedor clica em "Ver Orçamento" e recebe um .docx cujo cabeçalho diz
 * "PEDIDO DE VENDA".
 *
 * Então o rótulo sai do NOME DO ARQUIVO, não do nome da coluna. Se algum dia
 * entrar um orçamento de verdade aqui (importação de DOCX, por exemplo), o
 * regex pega e a tela passa a dizer "Orçamento" sozinha — sem precisar assumir.
 */
function rotuloDoArquivo(url: string | null | undefined): string {
  let nome = String(url || "")
    .split("/")
    .pop()
    ?.split("?")[0] ?? "";
  try {
    nome = decodeURIComponent(nome);
  } catch {
    /* nome com % solto: segue com o cru */
  }
  if (/^pedido[_-]?garantia/i.test(nome)) return "Pedido de Garantia";
  if (/^pedido[_-]?de[_-]?venda/i.test(nome)) return "Pedido de Venda";
  if (/or[çc]amento/i.test(nome)) return "Orçamento";
  return "Documento do pedido";
}

/** Nome de arquivo seguro: `pedido_numero` costuma vir com "/" e espaço. */
function slugArquivo(valor: string | null): string {
  return (valor || "pedido").replace(/[^\w.-]+/g, "-").replace(/^-+|-+$/g, "") || "pedido";
}

// ─────────────────────────────────────────────────────────────────────────────

type DocEmExibicao = "orcamento" | "pedido" | null;
type AcaoEmCurso = "ver-pedido" | "baixar-pedido" | "placa" | null;

export default function PedidoDetalhe() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile } = useAuth();
  // ⚠️ NÃO usar `display_name` pra casar com `pedidos_venda.vendedor`: medido no
  // banco, "Igor Zanelato" vs "IGOR", "Pedro Dela Giustina " vs "PEDRO". Daria
  // falso negativo em 3 dos 9 vendedores — eles perderiam os próprios pedidos.
  // O caminho certo é vendor_id -> vendors.name, que é o que este hook faz.
  const { nome: meuNomeVendedor, isLoading: carregandoNome } = useVendedorNome();

  // ⚠️ NÃO ACEITAR O FALLBACK DE `display_name` COMO ESCOPO.
  // `useVendedorNome()` nasceu pra Agenda e, sem `vendor_id`, devolve o
  // display_name em maiúsculas. Pra agendar isso é inofensivo; pra decidir ACESSO
  // é fabricar um vendedor que não existe em `vendors`. Visto no teste: usuário
  // `marketing` sem vendor_id virou escopo "QA PEDIDO" e a tela disse "Somente os
  // pedidos de QA PEDIDO" — some por acaso (ninguém se chama assim), mas um
  // display_name que calhe de bater com um vendedor real ("Daniel" -> DANIEL, 10
  // pedidos) daria acesso ao que não é dele.
  //
  // O servidor NÃO faz isso: `resolverEscopo()` de api/_lib/financeiro-core.ts
  // devolve 403 `sem_escopo` quando falta vendor_id. Aqui iguala-se ao servidor —
  // sem vendor_id, sem nome, e o usuário vê a tela que explica o que pedir ao admin.
  const nomeParaEscopo = profile?.vendor_id ? meuNomeVendedor : "";

  const escopo = resolverEscopo({
    role: profile?.role,
    nomeVendedor: nomeParaEscopo,
    nomeCarregando: carregandoNome,
  });

  // Esconder o botão é CORTESIA, não segurança: quem manda é o `role === 'admin'`
  // checado no servidor (api/controle-deletar-pedido.ts). Aqui só evita oferecer
  // uma ação que vai voltar 403.
  const podeExcluir = profile?.role === "admin";

  const [pedido, setPedido] = useState<PedidoRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [naoEncontrado, setNaoEncontrado] = useState(false);

  const [excluindo, setExcluindo] = useState(false);
  const [confirmarExclusao, setConfirmarExclusao] = useState(false);
  const [editandoOrcamento, setEditandoOrcamento] = useState(false);
  const [numeroOrcamento, setNumeroOrcamento] = useState("");
  const [salvandoOrcamento, setSalvandoOrcamento] = useState(false);
  const [ajusteModalOpen, setAjusteModalOpen] = useState(false);
  const [viewingDoc, setViewingDoc] = useState<DocEmExibicao>(null);
  const [pedidoVendaUrl, setPedidoVendaUrl] = useState<string | null>(null);
  const [acaoEmCurso, setAcaoEmCurso] = useState<AcaoEmCurso>(null);

  const podeConsultar = escopoPodeConsultar(escopo);

  const carregarPedido = useCallback(async () => {
    if (!id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("pedidos_venda")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (error) throw error;
      if (!data) {
        setNaoEncontrado(true);
        setPedido(null);
        return;
      }
      setNaoEncontrado(false);
      setPedido(data);
      setNumeroOrcamento(data.numero_orcamento || "");
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao carregar pedido:", error);
      toast.error("Não foi possível carregar o pedido");
    } finally {
      setLoading(false);
    }
  }, [id]);

  // `location.key` no dep: voltar da tela de edição recarrega o pedido em vez
  // de mostrar o valor velho que ficou no state.
  useEffect(() => {
    // Só busca depois que o recorte está resolvido. Buscar "enquanto o nome não
    // chega" abriria uma janela em que o pedido do colega já estaria em memória
    // e pintado na tela antes da trava valer.
    if (!podeConsultar) return;
    carregarPedido();
  }, [carregarPedido, location.key, podeConsultar]);

  /**
   * Reespelha o pedido em `mirror_pedidos_venda` (projeto do CRM).
   *
   * ⚠️ POR QUE PRECISA. Esta tela grava na tabela VIVA do controle, mas a
   * listagem /controle/pedidos lê o ESPELHO, que só é atualizado por um sync
   * periódico — medido com `synced_at` de ~18 h atrás. Sem isto: troca o status
   * aqui, volta pra lista, e a lista mostra o valor velho.
   *
   * Vai por /api/ porque o espelho está com RLS LIGADA e sem policy permissiva
   * de UPDATE/INSERT: escrita do browser volta 0 linhas SEM ERRO, ou seja,
   * fracassaria em silêncio. Só a service key no servidor escreve de verdade.
   *
   * NÃO-FATAL de propósito: a escrita principal já deu certo e o detalhe relê da
   * viva. Se o espelho falhar, o pior caso é a LISTA ficar velha até o próximo
   * sync — não vale estragar o toast de sucesso do usuário por causa disso.
   */
  /**
   * Manda UMA escrita do detalhe pro servidor.
   *
   * ⚠️ NÃO grava mais direto na `pedidos_venda` com a anon key. Do jeito antigo
   * não havia recorte: qualquer um dos 9 usuários `role='vendor'` que abrisse
   * /controle/pedidos/<id> de um pedido alheio trocava o status, renomeava o
   * orçamento ou dava desconto no negócio do colega. Esconder o botão não
   * resolve — o POST continua saindo. O servidor relê o pedido e recusa fora do
   * escopo (`pedidoNoEscopo`, a mesma regra do /api/financeiro).
   *
   * O endpoint também reespelha em `mirror_pedidos_venda`, que é o que a lista
   * /controle/pedidos lê — sem isso o vendedor troca o status aqui, volta pra
   * lista e vê o valor velho.
   */
  const escreverNoPedido = useCallback(
    async (corpo: Record<string, unknown>): Promise<void> => {
      const {
        data: { session },
      } = await crmSupabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("Sessão expirada — faça login novamente.");

      const r = await fetch("/api/controle-atualizar-pedido", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const json: Record<string, unknown> = await r.json().catch(() => ({}));
      if (!r.ok || json.ok !== true) {
        const codigo = typeof json.error === "string" ? json.error : "";
        if (codigo === "fora_do_escopo") throw new Error(MSG_FORA_DO_ESCOPO);
        if (codigo === "sem_escopo") {
          throw new Error("Seu usuário não está ligado a um vendedor. Fale com o admin.");
        }
        if (codigo === "not_approved") throw new Error("Seu usuário ainda não está aprovado.");
        const detalhe = typeof json.detail === "string" ? json.detail : codigo;
        throw new Error(detalhe || `Erro ${r.status}`);
      }
      // O espelho é não-fatal no servidor; avisa no console pra dar rastro quando
      // a LISTA ficar velha.
      if (json.espelhado === false) {
        console.warn(
          "[PedidoDetalhe] pedido gravado, mas o espelho nao atualizou. A listagem " +
            "/controle/pedidos pode mostrar dado velho ate o proximo sync.",
        );
      }
    },
    [],
  );

  // ── Ações ──────────────────────────────────────────────────────────────────

  const alterarStatus = async (novoStatus: PedidoStatus) => {
    if (!pedido) return;
    try {
      await escreverNoPedido({ id: pedido.id, acao: "status", status: novoStatus });
      toast.success(`Pedido marcado como ${STATUS_LABEL[novoStatus]}`);
      carregarPedido();
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao atualizar status:", error);
      toast.error(error instanceof Error ? error.message : "Não foi possível atualizar o status");
    }
  };

  const salvarNumeroOrcamento = async () => {
    if (!pedido || !numeroOrcamento.trim()) return;
    try {
      setSalvandoOrcamento(true);
      await escreverNoPedido({
        id: pedido.id,
        acao: "numero_orcamento",
        numero_orcamento: numeroOrcamento.trim(),
      });
      toast.success("Número do orçamento atualizado");
      setEditandoOrcamento(false);
      carregarPedido();
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao atualizar número do orçamento:", error);
      toast.error(
        error instanceof Error ? error.message : "Não foi possível atualizar o número do orçamento",
      );
    } finally {
      setSalvandoOrcamento(false);
    }
  };

  const salvarAjusteValor = async (novoValorTotal: number, motivo: string) => {
    if (!pedido) return;
    try {
      // Grava só o DELTA. `valor_total` e `payment_plan_json.total` continuam
      // com o valor bruto original — o resto da aplicação soma `ajuste_valor`
      // em cima deles. Reescrever o bruto aqui duplicaria o ajuste lá fora.
      const plan = parsePaymentPlan(pedido.payment_plan_json);
      const valorBruto = plan && plan.total > 0 ? plan.total : num(pedido.valor_total);
      const diferenca = novoValorTotal - valorBruto;

      await escreverNoPedido({
        id: pedido.id,
        acao: "ajuste",
        ajuste_valor: diferenca,
        ajuste_motivo: motivo,
      });
      toast.success(`Valor ajustado para ${formatarValor(novoValorTotal)}`);
      carregarPedido();
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao ajustar valor:", error);
      toast.error(error instanceof Error ? error.message : "Não foi possível ajustar o valor");
    }
  };

  /**
   * ⚠️ NÃO chama a edge `deletar-pedido` do controle — ela morre no PREFLIGHT.
   * O CORS dela responde `Access-Control-Allow-Origin: https://controle.branorte.com`
   * (as outras 5 edges que esta tela usa respondem `*`), então o browser derruba a
   * chamada antes de sair. A rota /api/ deste repo faz a mesma cascata de servidor
   * pra servidor — onde CORS não existe — e ainda checa `role === 'admin'` de
   * verdade, coisa que a `requireAuth` da edge não faz (ela aceita a anon key).
   */
  const excluirPedido = async () => {
    if (!pedido) return;
    try {
      setExcluindo(true);

      const {
        data: { session },
      } = await crmSupabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        toast.error("Sessão expirada — faça login novamente.");
        return;
      }

      const resposta = await fetch("/api/controle-deletar-pedido", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ id: pedido.id }),
      });
      const json: Record<string, unknown> = await resposta.json().catch(() => ({}));

      if (!resposta.ok || json.ok !== true) {
        // Mensagem específica pros dois 403 — "erro genérico" aqui faz o usuário
        // achar que o sistema quebrou, quando na verdade ele não tem permissão.
        const codigo = typeof json.error === "string" ? json.error : "";
        if (codigo === "admin_required") throw new Error("Só administrador pode excluir pedido.");
        if (codigo === "not_approved") throw new Error("Seu usuário ainda não está aprovado.");
        const detalhe = typeof json.detail === "string" ? json.detail : codigo;
        throw new Error(detalhe || `Erro ${resposta.status}`);
      }

      toast.success(`Pedido ${pedido.pedido_numero ?? ""} excluído`.trim());
      setConfirmarExclusao(false);
      navigate("/controle/pedidos");
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao excluir pedido:", error);
      toast.error(
        error instanceof Error ? error.message : "Não foi possível excluir o pedido",
      );
    } finally {
      setExcluindo(false);
    }
  };

  /**
   * Gera (ou regenera) o .docx do Pedido de Venda e devolve a URL.
   * A função também atualiza `arquivo_url` no banco, por isso quem chama
   * recarrega o pedido depois.
   */
  const gerarPedidoRetroativo = async (): Promise<string> => {
    if (!pedido) throw new Error("pedido não carregado");
    const { data, error } = await supabase.functions.invoke("gerar-pedido-retroativo", {
      body: { order_id: pedido.id },
    });
    if (error) throw error;
    const resposta = asRecord(data);
    const url = typeof resposta?.arquivo_url === "string" ? resposta.arquivo_url : null;
    if (!resposta?.ok || !url) {
      throw new Error(
        typeof resposta?.error === "string" ? resposta.error : "resposta inválida da função",
      );
    }
    return url;
  };

  const verPedidoDeVenda = async () => {
    if (viewingDoc === "pedido") {
      setViewingDoc(null);
      return;
    }
    const toastId = toast.loading("Gerando Pedido de Venda...");
    try {
      setAcaoEmCurso("ver-pedido");
      const url = await gerarPedidoRetroativo();
      setPedidoVendaUrl(url);
      setViewingDoc("pedido");
      await carregarPedido();
      toast.success("Pedido de Venda gerado", { id: toastId });
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao gerar pedido de venda:", error);
      toast.error("Não foi possível gerar o Pedido de Venda", { id: toastId });
    } finally {
      setAcaoEmCurso(null);
    }
  };

  const baixarPedidoDeVenda = async () => {
    const toastId = toast.loading("Gerando Pedido de Venda...");
    try {
      setAcaoEmCurso("baixar-pedido");
      const url = await gerarPedidoRetroativo();
      setPedidoVendaUrl(url);
      window.open(url, "_blank", "noopener,noreferrer");
      await carregarPedido();
      toast.success("Pedido de Venda gerado — baixando...", { id: toastId });
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao baixar pedido de venda:", error);
      toast.error("Não foi possível gerar o Pedido de Venda", { id: toastId });
    } finally {
      setAcaoEmCurso(null);
    }
  };

  const baixarPlaca = async () => {
    if (!pedido) return;
    const toastId = toast.loading("Gerando placa de identificação...");
    try {
      setAcaoEmCurso("placa");
      // fetch na mão, NÃO functions.invoke: a função devolve o .docx cru e o
      // supabase-js cairia no `response.text()`, corrompendo o binário.
      // Sem sessão no client do controle — o Bearer é a própria anon key, que é
      // o que a `requireAuth` das edge functions de lá exige.
      const resposta = await fetch(`${CONTROLE_URL}/functions/v1/gerar-placa-identificacao`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: CONTROLE_ANON_KEY,
          Authorization: `Bearer ${CONTROLE_ANON_KEY}`,
        },
        body: JSON.stringify({ order_id: pedido.id }),
      });

      if (!resposta.ok) throw new Error((await resposta.text()) || `HTTP ${resposta.status}`);

      const blob = await resposta.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `placa-identificacao-${slugArquivo(pedido.pedido_numero)}.docx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success("Placa gerada — arquivo baixado", { id: toastId });
    } catch (error) {
      console.error("[PedidoDetalhe] erro ao gerar placa:", error);
      toast.error("Não foi possível gerar a placa de identificação", { id: toastId });
    } finally {
      setAcaoEmCurso(null);
    }
  };

  const copiarLink = async () => {
    // Monta a partir da rota REAL em que a página está montada, em vez de cravar
    // o caminho: se a rota mudar de lugar, o link copiado continua certo.
    const url = `${window.location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copiado para a área de transferência");
    } catch {
      // clipboard exige contexto seguro / permissão; o fallback mostra a URL.
      toast.error(`Não foi possível copiar. Link: ${url}`);
    }
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  // Recorte ainda resolvendo (lendo vendor_id -> vendors.name). Sem esta parada
  // a tela renderizaria o pedido antes de saber se ele é do usuário.
  if (escopo.tipo === "carregando") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Verificando seu acesso...</span>
      </div>
    );
  }

  // Não deu pra saber quem é o usuário (sem vendor_id, ou a leitura de `vendors`
  // falhou). Fecha — e diz o que fazer, senão vira chamado de suporte.
  if (escopo.tipo === "sem-escopo") {
    return (
      <TelaBloqueada
        titulo="Não foi possível confirmar seu acesso"
        detalhe={
          profile?.role
            ? "Seu usuário não está ligado a um vendedor, então não dá pra saber quais pedidos são seus. Peça a um administrador pra vincular seu cadastro a um vendedor."
            : "Sua sessão ainda não foi reconhecida. Recarregue a página ou entre de novo."
        }
        aoVoltar={() => navigate("/controle/pedidos")}
      />
    );
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">Carregando pedido...</span>
      </div>
    );
  }

  if (!pedido) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-4 text-center">
        <FileText className="h-12 w-12 text-muted-foreground" />
        <p className="text-muted-foreground">
          {naoEncontrado ? "Pedido não encontrado." : "Não foi possível carregar o pedido."}
        </p>
        <div className="flex gap-2">
          {!naoEncontrado && (
            <Button variant="outline" onClick={() => carregarPedido()}>
              Tentar de novo
            </Button>
          )}
          <Button onClick={() => navigate("/controle/pedidos")}>Voltar para a listagem</Button>
        </div>
      </div>
    );
  }

  // ⚠️ TRAVA DE ACESSO POR ID. A lista dá pra filtrar na consulta; aqui não —
  // /controle/pedidos/<id> entrega o pedido inteiro e só depois dá pra dizer se
  // é dele. Então a recusa é aqui, ANTES de qualquer dado ir pra tela.
  //
  // Isto é o que fecha a porta de entrada. A trava que vale de verdade nas
  // ESCRITAS está no servidor (api/controle-atualizar-pedido.ts), porque
  // esconder botão não impede um POST.
  if (!pedidoNoEscopo(pedido, escopo)) {
    const dono = [pedido.vendedor, pedido.vendedor_2].filter(Boolean).join(" + ");
    return (
      <TelaBloqueada
        titulo="Este pedido é de outro vendedor"
        detalhe={
          dono
            ? `O pedido ${pedido.pedido_numero || ""} está com ${dono}. Você vê apenas os pedidos em que é o vendedor responsável (ou o segundo vendedor, em venda dividida).`
            : "Você vê apenas os pedidos em que é o vendedor responsável."
        }
        rodape={descreveEscopo(escopo)}
        aoVoltar={() => navigate("/controle/pedidos")}
      />
    );
  }

  const plan = parsePaymentPlan(pedido.payment_plan_json);
  const equipamentos = parseEquipamentos(pedido.equipamentos_json);
  const motores = parseMotores(pedido.motores_json);

  const valorBruto = plan && plan.total > 0 ? plan.total : num(pedido.valor_total);
  const ajuste = num(pedido.ajuste_valor);
  const valorFinal = valorBruto + ajuste;

  // Soma das parcelas COMO ELAS SÃO EXIBIDAS (mesma função de cada linha), pra
  // que o rodapé não possa discordar da tabela que está logo acima dele.
  const somaParcelas = plan
    ? plan.parcelas.reduce(
        (acc: number, p: Parcela) => acc + calcularValorParcela(p.valor, plan.total),
        0,
      )
    : 0;

  // "arquivado" = o .docx que está gravado em `arquivo_url` (gerado quando o
  // pedido foi criado). "atualizado" = o que a `gerar-pedido-retroativo` produz
  // agora, com os dados de hoje. Os dois podem ser Pedido de Venda — por isso o
  // par arquivado/atualizado no rótulo, senão viravam dois botões com o mesmo nome.
  const temArquivo = Boolean(pedido.arquivo_url && pedido.arquivo_url.startsWith("http"));
  const rotuloArquivado = rotuloDoArquivo(pedido.arquivo_url);
  const urlDocumento =
    viewingDoc === "orcamento" ? pedido.arquivo_url : pedidoVendaUrl || pedido.arquivo_url;
  const tituloVisualizador =
    viewingDoc === "orcamento" ? `${rotuloArquivado} (arquivado)` : "Pedido de Venda (atualizado)";

  return (
    <div className="min-h-full pb-10">
      {/* ── Cabeçalho da página (o header do app é o Layout do CRM) ── */}
      <header className="sticky top-0 z-20 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="container mx-auto max-w-6xl px-4 py-3 sm:py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 items-center gap-3">
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0"
                title="Voltar para os pedidos"
                aria-label="Voltar para os pedidos"
                onClick={() => navigate("/controle/pedidos")}
              >
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div className="min-w-0">
                {/* Só o número aqui. O status do cabeçalho é o SELECT ao lado —
                    ter um selo colado no número punha o mesmo campo duas vezes
                    na mesma linha. */}
                <h1 className="truncate font-mono text-xl font-bold text-foreground sm:text-2xl">
                  {pedido.pedido_numero || "SEM NÚMERO"}
                </h1>

                <div className="mt-1 flex items-center gap-2">
                  {editandoOrcamento ? (
                    <>
                      <Input
                        value={numeroOrcamento}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          setNumeroOrcamento(e.target.value)
                        }
                        onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                          if (e.key === "Enter") salvarNumeroOrcamento();
                          if (e.key === "Escape") {
                            setEditandoOrcamento(false);
                            setNumeroOrcamento(pedido.numero_orcamento || "");
                          }
                        }}
                        className="h-7 w-40 text-sm"
                        placeholder="Ex: 2025 - 1992"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Salvar número do orçamento"
                        aria-label="Salvar número do orçamento"
                        disabled={salvandoOrcamento || !numeroOrcamento.trim()}
                        onClick={salvarNumeroOrcamento}
                      >
                        {salvandoOrcamento ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Check className="h-4 w-4 text-emerald-700 dark:text-emerald-400" />
                        )}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        title="Cancelar"
                        aria-label="Cancelar edição do número do orçamento"
                        onClick={() => {
                          setEditandoOrcamento(false);
                          setNumeroOrcamento(pedido.numero_orcamento || "");
                        }}
                      >
                        <X className="h-4 w-4 text-destructive" />
                      </Button>
                    </>
                  ) : (
                    <>
                      <p className="truncate text-sm text-muted-foreground">
                        Orçamento: {pedido.numero_orcamento || "—"}
                      </p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        title="Editar número do orçamento"
                        aria-label="Editar número do orçamento"
                        onClick={() => setEditandoOrcamento(true)}
                      >
                        <Edit2 className="h-3 w-3" />
                      </Button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Atalhos do topo. Repetem de propósito o que o card "Ações" já faz:
                a tela é longa e o vendedor abre o pedido pra baixar o documento —
                fazer ele rolar até a lateral era o atrito da origem. Em telas
                pequenas os rótulos somem e ficam só os ícones. */}
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate(`/controle/pedidos/editar/${pedido.id}`)}
                title="Editar Pedido"
              >
                <Edit2 className="h-4 w-4 sm:mr-2" />
                <span className="hidden sm:inline">Editar Pedido</span>
              </Button>

              {temArquivo && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(pedido.arquivo_url, "_blank", "noopener,noreferrer")}
                  title={`Baixar ${rotuloArquivado} arquivado`}
                >
                  <FileText className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Baixar arquivado</span>
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                disabled={acaoEmCurso !== null}
                onClick={baixarPedidoDeVenda}
                title="Gerar e baixar o Pedido de Venda com os dados atuais"
              >
                {acaoEmCurso === "baixar-pedido" ? (
                  <Loader2 className="h-4 w-4 animate-spin sm:mr-2" />
                ) : (
                  <Download className="h-4 w-4 sm:mr-2" />
                )}
                <span className="hidden sm:inline">Baixar atualizado</span>
              </Button>

              <Select
                value={pedido.status ?? "ABERTO"}
                onValueChange={(value: string) => alterarStatus(value as PedidoStatus)}
              >
                <SelectTrigger className="h-9 w-[120px] sm:w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {/* Rótulo vem do MESMO mapa do selo (STATUS_LABEL): FECHADO
                      aparece como ENTREGUE aqui também. O <SelectValue /> repete
                      o filho do item selecionado, então o gatilho já sai certo. */}
                  {STATUS_OPCOES.map((s: PedidoStatus) => (
                    <SelectItem key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <AlertDialog open={confirmarExclusao} onOpenChange={setConfirmarExclusao}>
                {podeExcluir && (
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="outline"
                      size="sm"
                      title="Excluir pedido"
                      className="border-red-500/40 text-red-700 hover:bg-red-500/10 dark:text-red-400"
                    >
                      <Trash2 className="h-4 w-4 sm:mr-2" />
                      <span className="hidden sm:inline">Excluir</span>
                    </Button>
                  </AlertDialogTrigger>
                )}
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      Excluir o pedido {pedido.pedido_numero || ""}?
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      Isso apaga o pedido, o card de produção, o checklist da fábrica, as
                      parcelas, os recebimentos, o ponto no mapa de vendas e o arquivo do
                      orçamento. Não tem desfazer.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel disabled={excluindo}>Cancelar</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={excluindo}
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={(e: React.MouseEvent<HTMLButtonElement>) => {
                        // Sem isso o Radix fecha o diálogo antes do await e o
                        // usuário não vê o estado "Excluindo...".
                        e.preventDefault();
                        excluirPedido();
                      }}
                    >
                      {excluindo ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Excluindo...
                        </>
                      ) : (
                        "Excluir pedido"
                      )}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>
        </div>
      </header>

      {/* ── Conteúdo ── */}
      <div className="container mx-auto max-w-6xl px-4 py-4 sm:py-6">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Coluna principal */}
          <div className="space-y-6 lg:col-span-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center justify-between text-lg">
                  <span>Resumo do Pedido</span>
                  <StatusBadgePedido status={pedido.status} />
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <p className="text-sm text-muted-foreground">Cliente</p>
                    <p className="font-medium">{pedido.cliente || "—"}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Vendedor</p>
                    <p className="font-medium">
                      {pedido.vendedor || "—"}
                      {pedido.vendedor_2 && (
                        <span className="text-muted-foreground"> + {pedido.vendedor_2}</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Data da Venda</p>
                    <p className="font-medium">{formatarData(pedido.data_venda)}</p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Valor Total</p>
                    {ajuste !== 0 ? (
                      <div>
                        <p className="text-xs text-muted-foreground line-through">
                          {formatarValor(valorBruto)}
                        </p>
                        <p className="text-lg font-medium text-primary">
                          {formatarValor(valorFinal)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {ajuste > 0 ? "+" : ""}
                          {formatarValor(ajuste)} ({pedido.ajuste_motivo || "Ajuste"})
                        </p>
                      </div>
                    ) : (
                      <p className="text-lg font-medium text-primary">
                        {formatarValor(valorBruto)}
                      </p>
                    )}
                  </div>
                  {pedido.atencao_a && (
                    <div>
                      <p className="text-sm text-muted-foreground">A/C</p>
                      <p className="font-medium">{pedido.atencao_a}</p>
                    </div>
                  )}
                  {pedido.telefone && (
                    <div>
                      <p className="text-sm text-muted-foreground">Telefone</p>
                      <p className="font-medium">{pedido.telefone}</p>
                    </div>
                  )}
                  {pedido.cidade && (
                    <div className="sm:col-span-2">
                      <p className="text-sm text-muted-foreground">Localização</p>
                      <p className="font-medium">
                        {pedido.cidade}
                        {pedido.estado && ` - ${pedido.estado}`}
                      </p>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Prazo e Entrega</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-sm text-muted-foreground">Dias Úteis</p>
                    <p className="text-lg font-medium text-blue-700 dark:text-blue-400">
                      {pedido.dias_uteis} dias
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground">Data de Entrega</p>
                    <p className="text-lg font-medium text-emerald-700 dark:text-emerald-400">
                      {formatarData(pedido.data_entrega)}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Equipamentos</CardTitle>
              </CardHeader>
              <CardContent>
                {pedido.descricao_equipamento && (
                  <div className="mb-4 rounded-lg bg-muted/50 p-3">
                    <p className="text-sm font-medium">{pedido.descricao_equipamento}</p>
                  </div>
                )}
                {equipamentos.length > 0 ? (
                  <ul className="space-y-2">
                    {equipamentos.map((descricao: string, idx: number) => (
                      <li key={idx} className="flex items-start gap-2">
                        <span className="font-bold text-primary">{idx + 1}.</span>
                        <span className="min-w-0 break-words">{descricao}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Nenhum equipamento listado neste pedido.
                  </p>
                )}
                {(pedido.tensao || pedido.voltagem) && (
                  <div className="mt-4 space-y-1 border-t border-border pt-4">
                    {pedido.tensao && (
                      <p className="text-sm">
                        <span className="font-medium">Tensão:</span> {pedido.tensao}
                      </p>
                    )}
                    {pedido.voltagem && (
                      <p className="text-sm">
                        <span className="font-medium">Voltagem:</span> {pedido.voltagem}
                      </p>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>

            {motores.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Motores</CardTitle>
                </CardHeader>
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Modelo</TableHead>
                        <TableHead className="text-right">Quantidade</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {motores.map((motor: MotorItem, idx: number) => (
                        <TableRow key={idx}>
                          <TableCell>{motor.modelo}</TableCell>
                          <TableCell className="text-right">{motor.quantidade}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Forma de Pagamento</CardTitle>
              </CardHeader>
              <CardContent>
                {plan && plan.parcelas.length > 0 ? (
                  <>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="w-10">#</TableHead>
                          <TableHead>Descrição</TableHead>
                          <TableHead>Vencimento</TableHead>
                          <TableHead>Método</TableHead>
                          <TableHead className="text-right">Valor</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {plan.parcelas.map((parcela: Parcela, idx: number) => (
                          <TableRow key={idx}>
                            <TableCell className="font-mono">{parcela.n}</TableCell>
                            <TableCell>{parcela.descricao || "—"}</TableCell>
                            <TableCell className="whitespace-nowrap">
                              {formatarVencimentoDaParcela(parcela)}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {parcela.metodo || "—"}
                            </TableCell>
                            <TableCell className="text-right">
                              {formatarValor(calcularValorParcela(parcela.valor, plan.total))}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                      {/* Rodapé de soma: sem ele a tabela era uma pilha de números
                          que o leitor tinha que somar de cabeça pra descobrir se
                          batia com o valor lá de cima. */}
                      <TableFooter>
                        <TableRow>
                          <TableCell colSpan={4} className="font-medium">
                            Total das parcelas
                          </TableCell>
                          <TableCell className="text-right font-semibold">
                            {formatarValor(somaParcelas)}
                          </TableCell>
                        </TableRow>
                      </TableFooter>
                    </Table>

                    {/* ⚠️ O ajuste NÃO é rateado nas parcelas — ele vive em
                        `ajuste_valor`, fora do payment_plan_json. Sem este aviso a
                        tela mostrava "R$ 30.000,00" no topo e parcelas somando
                        "R$ 197.674,00", sem nada explicando a diferença. */}
                    {ajuste !== 0 && (
                      <div className="mt-4 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                        <p className="font-medium text-amber-800 dark:text-amber-300">
                          As parcelas acima são do valor bruto, sem o ajuste.
                        </p>
                        <dl className="mt-2 space-y-0.5 text-muted-foreground">
                          <div className="flex justify-between gap-4">
                            <dt>Bruto (base das parcelas)</dt>
                            <dd className="font-mono">{formatarValor(plan.total)}</dd>
                          </div>
                          <div className="flex justify-between gap-4">
                            <dt>{ajuste > 0 ? "Acréscimo" : "Desconto"}</dt>
                            <dd className="font-mono">
                              {ajuste > 0 ? "+" : ""}
                              {formatarValor(ajuste)}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-4 border-t border-border pt-1 font-medium text-foreground">
                            <dt>Total do pedido</dt>
                            <dd className="font-mono">{formatarValor(valorFinal)}</dd>
                          </div>
                        </dl>
                      </div>
                    )}

                    {/* Plano inconsistente com ele mesmo (parcela percentual que
                        não fecha 100%, ou valor fixo digitado errado). 1 centavo
                        de folga pra arredondamento. */}
                    {Math.abs(somaParcelas - plan.total) > 0.01 && (
                      <div className="mt-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm">
                        <p className="font-medium text-red-800 dark:text-red-300">
                          As parcelas não somam o total do plano.
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          Soma das parcelas {formatarValor(somaParcelas)} · total do plano{" "}
                          {formatarValor(plan.total)} · diferença{" "}
                          <span className="font-mono">
                            {formatarValor(somaParcelas - plan.total)}
                          </span>
                          . Confira o plano de pagamento em "Editar Pedido".
                        </p>
                      </div>
                    )}
                    {plan.observacao && (
                      <div className="mt-4 rounded-lg bg-muted/50 p-3">
                        <p className="text-sm">
                          <span className="font-medium">Observação:</span> {plan.observacao}
                        </p>
                      </div>
                    )}
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    {pedido.forma_pagamento || "Forma de pagamento não especificada"}
                  </p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Coluna lateral */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Ações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {temArquivo && (
                  <p className="pb-1 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Arquivado</span> é o{" "}
                    {rotuloArquivado.toLowerCase()} que já está salvo neste pedido.{" "}
                    <span className="font-medium text-foreground">Atualizado</span> gera um
                    novo agora, com os dados de hoje.
                  </p>
                )}

                {temArquivo && (
                  <Button
                    className="w-full justify-start"
                    variant={viewingDoc === "orcamento" ? "default" : "outline"}
                    onClick={() =>
                      setViewingDoc(viewingDoc === "orcamento" ? null : "orcamento")
                    }
                  >
                    {viewingDoc === "orcamento" ? (
                      <EyeOff className="mr-2 h-4 w-4" />
                    ) : (
                      <Eye className="mr-2 h-4 w-4" />
                    )}
                    {viewingDoc === "orcamento"
                      ? `Fechar ${rotuloArquivado.toLowerCase()}`
                      : `Ver ${rotuloArquivado} arquivado`}
                  </Button>
                )}

                <Button
                  className="w-full justify-start"
                  variant={viewingDoc === "pedido" ? "default" : "outline"}
                  disabled={acaoEmCurso !== null}
                  onClick={verPedidoDeVenda}
                >
                  {acaoEmCurso === "ver-pedido" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : viewingDoc === "pedido" ? (
                    <EyeOff className="mr-2 h-4 w-4" />
                  ) : (
                    <Eye className="mr-2 h-4 w-4" />
                  )}
                  {viewingDoc === "pedido"
                    ? "Fechar pedido de venda"
                    : "Ver Pedido de Venda atualizado"}
                </Button>

                {temArquivo && (
                  <Button
                    className="w-full justify-start"
                    variant="outline"
                    onClick={() =>
                      window.open(pedido.arquivo_url, "_blank", "noopener,noreferrer")
                    }
                  >
                    <FileText className="mr-2 h-4 w-4" />
                    Baixar {rotuloArquivado} arquivado
                  </Button>
                )}

                <Button
                  className="w-full justify-start"
                  variant="outline"
                  disabled={acaoEmCurso !== null}
                  onClick={baixarPedidoDeVenda}
                >
                  {acaoEmCurso === "baixar-pedido" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  Baixar Pedido de Venda atualizado
                </Button>

                <Button
                  className="w-full justify-start"
                  variant="outline"
                  disabled={acaoEmCurso !== null}
                  onClick={baixarPlaca}
                >
                  {acaoEmCurso === "placa" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Tag className="mr-2 h-4 w-4" />
                  )}
                  Baixar placa de identificação
                </Button>

                <Button
                  className="w-full justify-start"
                  variant="outline"
                  onClick={() => setAjusteModalOpen(true)}
                >
                  <DollarSign className="mr-2 h-4 w-4" />
                  Ajustar Valor
                </Button>

                <Button className="w-full justify-start" variant="outline" onClick={copiarLink}>
                  <Copy className="mr-2 h-4 w-4" />
                  Copiar Link
                </Button>
              </CardContent>
            </Card>

            {/* Visualizador inline */}
            {viewingDoc && (
              <Card>
                <CardHeader className="flex-row items-center justify-between space-y-0 pb-2">
                  {/* Título do card = o que o documento É de fato. Antes dizia
                      "Orçamento" por cima de um .docx com "PEDIDO DE VENDA" no
                      cabeçalho. */}
                  <CardTitle className="text-base">{tituloVisualizador}</CardTitle>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Fechar visualizador"
                    aria-label="Fechar visualizador"
                    onClick={() => setViewingDoc(null)}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </CardHeader>
                <CardContent>
                  <Suspense
                    fallback={
                      <div className="flex items-center justify-center py-12">
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      </div>
                    }
                  >
                    <DocViewer url={urlDocumento} title={tituloVisualizador} height="60vh" />
                  </Suspense>
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle className="text-lg">Informações do Sistema</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <p className="text-sm text-muted-foreground">Criado em</p>
                  <p className="text-sm font-medium">{formatarDataHora(pedido.created_at)}</p>
                </div>
                {pedido.updated_at && (
                  <div>
                    <p className="text-sm text-muted-foreground">Atualizado em</p>
                    <p className="text-sm font-medium">{formatarDataHora(pedido.updated_at)}</p>
                  </div>
                )}
                {ajuste !== 0 && pedido.ajuste_data && (
                  <div>
                    <p className="text-sm text-muted-foreground">Valor ajustado em</p>
                    <p className="text-sm font-medium">{formatarData(pedido.ajuste_data)}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm text-muted-foreground">ID</p>
                  <p className="break-all font-mono text-xs text-muted-foreground">{pedido.id}</p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <AjusteValorModal
        open={ajusteModalOpen}
        onOpenChange={setAjusteModalOpen}
        onConfirm={salvarAjusteValor}
        pedidoNumero={pedido.pedido_numero || ""}
        valorAtual={valorFinal}
        motivoAtual={pedido.ajuste_motivo || ""}
      />
    </div>
  );
}

/**
 * Tela de recusa. Existe pra que "não posso ver" não vire tela em branco nem
 * "não encontrado" genérico — sem dizer o MOTIVO, o vendedor abre chamado.
 */
function TelaBloqueada({
  titulo,
  detalhe,
  rodape,
  aoVoltar,
}: {
  titulo: string;
  detalhe: string;
  rodape?: string | null;
  aoVoltar: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-center">
        <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15">
          <Lock className="h-5 w-5 text-amber-700 dark:text-amber-400" />
        </div>
        <h2 className="mb-1 text-lg font-semibold text-foreground">{titulo}</h2>
        <p className="text-sm text-muted-foreground">{detalhe}</p>
        {rodape && <p className="mt-2 text-xs text-muted-foreground">{rodape}</p>}
        <Button className="mt-5 w-full" onClick={aoVoltar}>
          Voltar para os pedidos
        </Button>
      </div>
    </div>
  );
}
