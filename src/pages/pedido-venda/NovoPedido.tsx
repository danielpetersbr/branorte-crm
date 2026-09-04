import { PedidoForm } from "@/components/pedido-venda/PedidoForm";
import { FileText, List, LogOut, Home, Zap, Package, FileCheck, ShieldCheck } from "lucide-react";
import { Button } from "@/components/pedido-ui/button";
import { Card } from "@/components/pedido-ui/card";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useAuth } from "@/lib/pedido-venda/auth-shim";
import { toast } from "sonner";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/controle-supabase/client";
import type { Database } from "@/lib/controle-supabase/types";

type PedidoVendaRow = Database["public"]["Tables"]["pedidos_venda"]["Row"];
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
  const [pedidoData, setPedidoData] = useState<PedidoVendaRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<'simples' | 'acessorios' | 'completo' | 'garantia' | null>(null);
  
  const modoAtivo = searchParams.get('modo');

  useEffect(() => {
    if (id) {
      carregarPedido();
    }
  }, [id]);

  const carregarPedido = async () => {
    // `id` vem de useParams() como string | undefined. So chegamos aqui com ele
    // preenchido (o useEffect acima checa), mas o compilador nao sabe disso.
    if (!id) return;
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from("pedidos_venda")
        .select("*")
        .eq("id", id)
        .single();

      if (error) throw error;
      setPedidoData(data);
    } catch (error) {
      console.error("Erro ao carregar pedido:", error);
      toast.error("Erro ao carregar pedido para edição");
    } finally {
      setLoading(false);
    }
  };

  const handleSelectType = (type: 'simples' | 'acessorios' | 'completo' | 'garantia') => {
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
  if (loading || (id && !pedidoData)) {
    return (
      <div className="min-h-full flex items-center justify-center">
        <p>Carregando pedido...</p>
      </div>
    );
  }

  return (
    <div className="min-h-full">

       {/* Main Content */}
       <main className="container mx-auto px-4 py-12 max-w-6xl">
         <div className="mb-8">
           <div className="text-center mb-6">
             <p className="text-lg text-muted-foreground">
               {id ? "Edite os dados do pedido e salve as alterações" : "Preencha os dados abaixo para gerar seu pedido de venda profissional"}
             </p>
           </div>
           
            {!id && (
              <>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
                  {/* Pedido sem orçamento */}
                  <Card 
                    className={`p-8 cursor-pointer transition-all duration-300 group relative overflow-hidden hover:border-primary hover:shadow-xl hover:scale-105`}
                    onClick={() => handleSelectType('simples')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="flex flex-col items-center text-center gap-4 relative z-10">
                      <div className="p-5 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 group-hover:from-primary/30 group-hover:to-primary/20 transition-all duration-300 group-hover:scale-110">
                        <Zap className="h-10 w-10 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-bold text-xl mb-2 group-hover:text-primary transition-colors">Pedido sem Orçamento</h3>
                        <p className="text-sm text-muted-foreground">Para vendas diretas sem orçamento prévio</p>
                        <p className="text-xs text-muted-foreground mt-2">Cadastro rápido e simplificado</p>
                      </div>
                    </div>
                  </Card>

                  {/* Pedido com orçamento de acessórios */}
                  <Card 
                    className={`p-8 cursor-pointer transition-all duration-300 group relative overflow-hidden ${
                      modoAtivo === 'acessorios' ? 'border-2 border-accent shadow-xl scale-105' : 'hover:border-accent hover:shadow-xl hover:scale-105'
                    }`}
                    onClick={() => handleSelectType('acessorios')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-accent/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="flex flex-col items-center text-center gap-4 relative z-10">
                      <div className="p-5 rounded-2xl bg-gradient-to-br from-accent/20 to-accent/10 group-hover:from-accent/30 group-hover:to-accent/20 transition-all duration-300 group-hover:scale-110">
                        <Package className="h-10 w-10 text-accent" />
                      </div>
                      <div>
                        <h3 className="font-bold text-xl mb-2 group-hover:text-accent transition-colors">Pedido de Acessórios</h3>
                        <p className="text-sm text-muted-foreground">Para partes, peças e itens complementares</p>
                        <p className="text-xs text-muted-foreground mt-2">Com orçamento de acessórios</p>
                      </div>
                    </div>
                    {modoAtivo === 'acessorios' && (
                      <div className="absolute top-3 right-3 bg-accent text-accent-foreground text-xs font-bold px-3 py-1 rounded-full animate-fade-in">
                        Ativo
                      </div>
                    )}
                  </Card>

                  {/* Pedido completo */}
                  <Card 
                    className={`p-8 cursor-pointer transition-all duration-300 group relative overflow-hidden ${
                      !modoAtivo && !id ? 'border-2 border-primary shadow-xl' : 'hover:border-primary hover:shadow-xl hover:scale-105'
                    }`}
                    onClick={() => handleSelectType('completo')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="flex flex-col items-center text-center gap-4 relative z-10">
                      <div className="p-5 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 group-hover:from-primary/30 group-hover:to-primary/20 transition-all duration-300 group-hover:scale-110">
                        <FileCheck className="h-10 w-10 text-primary" />
                      </div>
                      <div>
                        <h3 className="font-bold text-xl mb-2 group-hover:text-primary transition-colors">Pedido Completo</h3>
                        <p className="text-sm text-muted-foreground">Com orçamento detalhado e valores individuais</p>
                        <p className="text-xs text-muted-foreground mt-2">Formulário completo e detalhado</p>
                      </div>
                    </div>
                    {!modoAtivo && (
                      <div className="absolute top-3 right-3 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full animate-fade-in">
                        Padrão
                      </div>
                    )}
                  </Card>

                  {/* Pedido de Garantia */}
                  <Card
                    className="p-8 cursor-pointer transition-all duration-300 group relative overflow-hidden hover:border-amber-500 hover:shadow-xl hover:scale-105"
                    onClick={() => handleSelectType('garantia')}
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-amber-500/5 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
                    <div className="flex flex-col items-center text-center gap-4 relative z-10">
                      <div className="p-5 rounded-2xl bg-gradient-to-br from-amber-500/20 to-amber-500/10 group-hover:from-amber-500/30 group-hover:to-amber-500/20 transition-all duration-300 group-hover:scale-110">
                        <ShieldCheck className="h-10 w-10 text-amber-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-xl mb-2 group-hover:text-amber-600 transition-colors">Pedido de Garantia</h3>
                        <p className="text-sm text-muted-foreground">Reposição/garantia sem cobrança</p>
                        <p className="text-xs text-muted-foreground mt-2">Sem valor · com Word · vai para a fábrica</p>
                      </div>
                    </div>
                  </Card>
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
                        Confirmar e Continuar
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </>
            )}
         </div>
         <PedidoForm pedidoInicial={pedidoData} />
       </main>

      {/* Footer */}
      
    </div>
  );
};

export default Index;
