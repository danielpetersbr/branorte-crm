import { PedidoForm } from "@/components/pedido-venda/PedidoForm";
import { Zap, Package, FileCheck, ShieldCheck, Check, Loader2, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/pedido-ui/button";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/pedido-venda/auth-shim";
import { toast } from "sonner";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/controle-supabase/client";
import type { Database } from "@/lib/controle-supabase/types";

type PedidoVendaRow = Database["public"]["Tables"]["pedidos_venda"]["Row"];
type TipoPedido = 'simples' | 'acessorios' | 'completo' | 'garantia';

// Cores só de token do tema (accent/warning + *-bg): os gradientes primary/amber-600
// de antes eram fixos e o cartão escolhido "pulava" (scale-105) e desalinhava a grade.
const TIPOS: Array<{ key: TipoPedido; titulo: string; desc: string; Icon: LucideIcon; garantia?: boolean }> = [
  { key: 'completo', titulo: 'Pedido completo', desc: 'Orçamento detalhado, com valor por item', Icon: FileCheck },
  { key: 'acessorios', titulo: 'Acessórios', desc: 'Peças, partes e itens complementares', Icon: Package },
  { key: 'simples', titulo: 'Sem orçamento', desc: 'Venda direta, cadastro rápido', Icon: Zap },
  { key: 'garantia', titulo: 'Garantia', desc: 'Reposição sem cobrança, vai para a fábrica', Icon: ShieldCheck, garantia: true },
];
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/pedido-ui/alert-dialog";

const Index = () => {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const { id } = useParams();
  const [searchParams] = useSearchParams();
  // Linha do `pedidos_venda` do controle, no modo edicao. `useState(null)` cru era
  // inferido como `null` e recusava a linha do banco sob os tipos estritos do CRM.
  const [estadoPedido, setEstadoPedido] = useState<{ id: string; data: PedidoVendaRow | null; erro: string | null; loading: boolean } | null>(null);
  const consultaPedido = useRef<AbortController | null>(null);
  const idAtual = useRef(id);
  idAtual.current = id;
  const consulta = estadoPedido?.id === id ? estadoPedido : null;
  const pedidoData = consulta?.data ?? null;
  const loading = !!id && (!consulta || consulta.loading);
  const erroPedido = consulta?.erro;
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<TipoPedido | null>(null);
  
  const modoAtivo = searchParams.get('modo');
  // Nesta rota só existem os dois tipos que usam o formulário completo.
  const tipoAtual: TipoPedido = modoAtivo === 'acessorios' ? 'acessorios' : 'completo';

  useEffect(() => {
    if (id) {
      carregarPedido();
    }
    return () => { consultaPedido.current?.abort(); };
  }, [id]);

  const carregarPedido = async () => {
    // `id` vem de useParams() como string | undefined. So chegamos aqui com ele
    // preenchido (o useEffect acima checa), mas o compilador nao sabe disso.
    if (!id || idAtual.current !== id) return;
    consultaPedido.current?.abort();
    const controller = new AbortController();
    consultaPedido.current = controller;
    const vigente = () => consultaPedido.current === controller && idAtual.current === id && !controller.signal.aborted;
    try {
      setEstadoPedido({ id, data: null, erro: null, loading: true });
      const { data, error } = await supabase
        .from("pedidos_venda")
        .select("*")
        .eq("id", id)
        .abortSignal(controller.signal)
        .maybeSingle();

      if (!vigente()) return;
      if (error) throw error;
      setEstadoPedido({ id, data, erro: data ? null : "Pedido não encontrado.", loading: false });
    } catch (error) {
      if (!vigente()) return;
      console.error("Erro ao carregar pedido:", error);
      setEstadoPedido({ id, data: null, erro: "Não foi possível carregar o pedido para edição.", loading: false });
    }
  };

  const handleSelectType = (type: TipoPedido) => {
    // Clicar no tipo que já está aberto abria um "Criar Pedido Completo?" que não mudava nada.
    if (type === tipoAtual) return;
    setSelectedType(type);
    setConfirmDialogOpen(true);
  };

  const handleConfirm = () => {
    if (selectedType === 'simples') {
      navigate('/controle/pedido-simples');
    } else if (selectedType === 'acessorios') {
      navigate('/controle/novo-pedido?modo=acessorios');
    } else if (selectedType === 'completo') {
      navigate('/controle/novo-pedido');
    } else if (selectedType === 'garantia') {
      navigate('/controle/pedido-garantia');
    }
    setConfirmDialogOpen(false);
  };

  const getConfirmationText = () => {
    switch (selectedType) {
      case 'simples':
        return {
          title: "Criar Pedido sem Orçamento?",
          description: "Você está criando um pedido de venda direta sem orçamento prévio. Este é um cadastro rápido onde o número do pedido será igual ao número do orçamento."
        };
      case 'acessorios':
        return {
          title: "Criar Pedido de Acessórios?",
          description: "Você está criando um pedido com orçamento de acessórios, partes e outros itens complementares."
        };
      case 'completo':
        return {
          title: "Criar Pedido Completo?",
          description: "Você está criando um pedido completo com orçamento detalhado, incluindo todos os equipamentos, motores e valores individuais."
        };
      case 'garantia':
        return {
          title: "Criar Pedido de Garantia?",
          description: "Você está criando um pedido de garantia. Não é necessário informar valor nem forma de pagamento, apenas o documento Word descritivo. O pedido será enviado normalmente para a fábrica (App2)."
        };
      default:
        return { title: "", description: "" };
    }
  };

  // Se está carregando OU se tem ID mas ainda não tem dados, mostra loading
  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center gap-2 text-ink-muted">
        <Loader2 className="h-5 w-5 animate-spin text-accent" />
        <p className="text-sm">Carregando pedido...</p>
      </div>
    );
  }

  if (id && erroPedido) return (
    <div className="p-6 space-y-3" role="alert">
      <p>{erroPedido}</p>
      <Button variant="outline" onClick={() => carregarPedido()}>Tentar novamente</Button>
      <Button variant="ghost" onClick={() => navigate('/controle/pedidos')}>Voltar aos pedidos</Button>
    </div>
  );

  return (
    <div className="min-h-full">
      <main className="mx-auto max-w-6xl px-3 py-6 sm:px-4 sm:py-10">
        {!id && (
          <>
            <header className="mb-5">
              <h1 className="text-2xl font-bold text-ink sm:text-3xl">Novo pedido</h1>
              <p className="mt-1 text-sm text-ink-muted">Escolha o tipo e suba o orçamento — o resto é preenchido sozinho.</p>
            </header>

            <div role="radiogroup" aria-label="Tipo de pedido" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {TIPOS.map((t) => {
                const ativo = t.key === tipoAtual;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="radio"
                    aria-checked={ativo}
                    onClick={() => handleSelectType(t.key)}
                    className={cn(
                      "group relative flex items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-bg",
                      ativo
                        ? "border-accent shadow-md ring-1 ring-accent"
                        : "border-border hover:-translate-y-0.5 hover:border-border-strong hover:shadow-md"
                    )}
                  >
                    <div className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-xl transition-colors",
                      t.garantia
                        ? "bg-warning-bg text-warning"
                        : ativo ? "bg-accent text-accent-fg" : "bg-accent-bg text-accent"
                    )}>
                      <t.Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 pr-5">
                      <div className="font-semibold text-ink">{t.titulo}</div>
                      <p className="mt-0.5 text-xs leading-snug text-ink-muted">{t.desc}</p>
                    </div>
                    {ativo && (
                      <span className="absolute right-3 top-3 flex h-5 w-5 items-center justify-center rounded-full bg-accent text-accent-fg">
                        <Check className="h-3.5 w-3.5" strokeWidth={3} />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            <AlertDialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{getConfirmationText().title}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {getConfirmationText().description}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancelar</AlertDialogCancel>
                  <AlertDialogAction onClick={handleConfirm}>
                    Confirmar e continuar
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
        <PedidoForm pedidoInicial={pedidoData} />
      </main>
    </div>
  );
};

export default Index;
