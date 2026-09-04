import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { FileText, Home, List, LogOut } from "lucide-react";
import { Button } from "@/components/pedido-ui/button";
import { Input } from "@/components/pedido-ui/input";
import { Label } from "@/components/pedido-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/pedido-ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/pedido-ui/card";
import { useAuth } from "@/lib/pedido-venda/auth-shim";
import { supabase } from "@/lib/controle-supabase/client";
import { toast } from "sonner";
import { useVendors } from "@/hooks/pedido-venda/useInstallments";
import { PaymentPlanEditor } from "@/components/pedido-venda/PaymentPlanEditor";
import {
  ChecklistComprasEditor,
  type ChecklistCompras,
  DEFAULT_CHECKLIST_COMPRAS,
  isChecklistEmpty,
  validarChecklistProjeto,
} from "@/components/pedido-venda/ChecklistComprasEditor";

const formSchema = z.object({
  data_venda: z.string().min(1, "Data da venda é obrigatória"),
  cliente: z.string().min(1, "Nome do cliente é obrigatório"),
  produto: z.string().min(1, "Produto é obrigatório"),
  vendedor: z.string().min(1, "Vendedor é obrigatório"),
  valor_total: z.string().min(1, "Valor da venda é obrigatório"),
});

type FormData = z.infer<typeof formSchema>;

export default function PedidoSimples() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const { data: vendedores = [] } = useVendors();
  const [paymentPlan, setPaymentPlan] = useState<any>(null);
  const [checklistCompras, setChecklistCompras] = useState<ChecklistCompras>(DEFAULT_CHECKLIST_COMPRAS);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      data_venda: new Date().toISOString().split("T")[0],
    },
  });

  const vendedor = watch("vendedor");
  const valor_total = watch("valor_total");
  
  const valorTotalNumerico = valor_total 
    ? parseFloat(valor_total.replace(/[^\d,]/g, "").replace(",", ".")) || 0
    : 0;

  const onSubmit = async (data: FormData) => {
    try {
      setLoading(true);

      // Informações para o projeto: texto + ao menos 1 imagem são obrigatórios
      const erroProjeto = validarChecklistProjeto(checklistCompras);
      if (erroProjeto) {
        toast.error(`Informações para o projeto: ${erroProjeto.toLowerCase()}`);
        setLoading(false);
        return;
      }

      // Validar se há plano de pagamento
      if (!paymentPlan || !paymentPlan.parcelas || paymentPlan.parcelas.length === 0) {
        toast.error("Por favor, configure as condições de pagamento");
        setLoading(false);
        return;
      }

      console.log("Gerando número do pedido via SDK direto...");
      
      // 1. Gerar número do pedido via RPC
      const { data: pedidoNumero, error: rpcError } = await supabase.rpc(
        'gerar_pedido_numero',
        { p_data: data.data_venda }
      );

      if (rpcError) {
        console.error("Erro ao gerar número:", rpcError);
        throw new Error("Erro ao gerar número do pedido");
      }

      console.log("Número gerado:", pedidoNumero);

      // 2. Inserir pedido diretamente no banco
      const { data: pedidoInserido, error: insertError } = await supabase
        .from('pedidos_venda')
        .insert({
          pedido_numero: pedidoNumero,
          numero_orcamento: pedidoNumero,
          cliente: data.cliente,
          vendedor: data.vendedor,
          data_venda: data.data_venda,
          data_entrega: data.data_venda,
          equipamentos_json: [data.produto],
          motores_json: [],
          valor_total: valorTotalNumerico,
          payment_plan_json: paymentPlan,
          descricao_equipamento: data.produto,
          status: 'ABERTO',
          dias_uteis: 0,
          arquivo_url: '', // Pedido simples não tem DOCX
          checklist_compras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
        })
        .select('id')
        .single();

      if (insertError) {
        console.error("Erro ao inserir pedido:", insertError);
        throw new Error("Erro ao inserir pedido no banco");
      }

      console.log("Pedido inserido:", pedidoInserido.id);

      // 3. Gerar parcelas diretamente no banco
      const totalParcelas = paymentPlan.parcelas.length;
      const installments = paymentPlan.parcelas.map((parcela: any, index: number) => {
        // Calcular valor da parcela
        let amount = 0;
        if (parcela.valor?.tipo === 'fixo') {
          amount = parcela.valor.fixo || 0;
        } else if (parcela.valor?.tipo === 'percentual') {
          amount = (valorTotalNumerico * (parcela.valor.percentual || 0)) / 100;
        } else if (parcela.valor?.fixo) {
          amount = parcela.valor.fixo;
        } else {
          amount = valorTotalNumerico / totalParcelas;
        }

        // Determinar data de vencimento
        let dueDate = parcela.data || data.data_venda;
        
        return {
          order_id: pedidoInserido.id,
          installment_no: parcela.n || (index + 1),
          total_installments: totalParcelas,
          due_date: dueDate,
          amount: amount,
          description: parcela.descricao || `Parcela ${index + 1}/${totalParcelas}`,
          reference_type: 'pedido',
          reference_date: data.data_venda,
          status: 'PENDENTE' as const,
        };
      });

      if (installments.length > 0) {
        const { error: installmentsError } = await supabase
          .from('order_installments')
          .insert(installments);

        if (installmentsError) {
          console.error("Erro ao inserir parcelas:", installmentsError);
          // Não aborta - parcelas podem ser geradas depois
        } else {
          console.log(`${installments.length} parcelas inseridas`);
        }
      }

      // 4. Criar registro na produção (opcional, falha silenciosa)
      try {
        // Buscar primeiro estágio de produção
        const { data: primeiroEstagio } = await supabase
          .from('producao_estagios')
          .select('id')
          .eq('ativo', true)
          .order('ordem', { ascending: true })
          .limit(1)
          .single();

        if (primeiroEstagio) {
          await supabase.from('producao_pedidos').insert({
            pedido_id: pedidoInserido.id,
            estagio_id: primeiroEstagio.id,
            prioridade: 0,
          });
          console.log("Registro de produção criado");
        }
      } catch (prodError) {
        console.warn("Não foi possível criar registro de produção:", prodError);
      }

      // 5. Enviar para App2 (fábrica) - sem DOCX, apenas dados estruturados
      try {
        const equipamentosFormatados = [{
          numero: 1,
          descricao: data.produto,
          quantidade: 1,
          unidade: 'UN'
        }];

        await supabase.functions.invoke('enviar-docx-app2', {
          body: {
            pedidoId: pedidoInserido.id,
            clienteNome: data.cliente,
            vendedorNome: data.vendedor,
            equipamentos: equipamentosFormatados,
            motores: [],
            tensao: '',
            voltagem: '',
            prazoDias: 0,
            prazoTipo: 'corridos',
            prazoData: data.data_venda,
            checkListCompras: isChecklistEmpty(checklistCompras) ? null : checklistCompras,
            motorMarca: checklistCompras.motor_marca
          }
        });
        console.log("Pedido enviado para App2 (fábrica)");
      } catch (app2Error) {
        console.warn("Não foi possível enviar para App2:", app2Error);
        // Não bloqueia - pedido já foi criado localmente
      }

      toast.success("Pedido cadastrado com sucesso!");
      reset();
      navigate("/controle/pedidos");
    } catch (error: any) {
      console.error("Erro ao cadastrar pedido:", error);
      toast.error(error?.message || "Erro ao cadastrar pedido");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full">

      {/* Main Content */}
      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle>Dados do Pedido</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="data_venda">Data da Venda *</Label>
                  <Input
                    id="data_venda"
                    type="date"
                    {...register("data_venda")}
                  />
                  {errors.data_venda && (
                    <p className="text-sm text-destructive">
                      {errors.data_venda.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="vendedor">Vendedor *</Label>
                  <Select
                    value={vendedor}
                    onValueChange={(value) => setValue("vendedor", value)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione o vendedor" />
                    </SelectTrigger>
                    <SelectContent>
                      {vendedores.map((v) => (
                        <SelectItem key={v} value={v}>
                          {v}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {errors.vendedor && (
                    <p className="text-sm text-destructive">
                      {errors.vendedor.message}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cliente">Nome do Cliente *</Label>
                <Input
                  id="cliente"
                  placeholder="Ex: João Silva Ltda"
                  {...register("cliente")}
                />
                {errors.cliente && (
                  <p className="text-sm text-destructive">
                    {errors.cliente.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="produto">Produto/Equipamento *</Label>
                <Input
                  id="produto"
                  placeholder="Ex: Misturador de Ração 500kg"
                  {...register("produto")}
                />
                {errors.produto && (
                  <p className="text-sm text-destructive">
                    {errors.produto.message}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="valor_total">Valor da Venda *</Label>
                <Input
                  id="valor_total"
                  placeholder="Ex: 15.000,00"
                  {...register("valor_total")}
                />
                {errors.valor_total && (
                  <p className="text-sm text-destructive">
                    {errors.valor_total.message}
                  </p>
                )}
              </div>

              <div className="mt-6 pt-6 border-t">
                <h3 className="text-lg font-semibold mb-4">Informações para o projeto</h3>
                <ChecklistComprasEditor
                  value={checklistCompras}
                  onChange={setChecklistCompras}
                />
              </div>

              <div className="mt-6 pt-6 border-t">
                <PaymentPlanEditor
                  valorTotal={valorTotalNumerico}
                  paymentPlan={paymentPlan}
                  onChange={setPaymentPlan}
                  dataVenda={new Date(watch("data_venda") || new Date())}
                  dataEntrega={new Date(watch("data_venda") || new Date())}
                />
              </div>

              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/controle/pedidos")}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "Salvando..." : "Cadastrar Pedido"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
