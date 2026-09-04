import { useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { FileText, Home, List, LogOut, ShieldCheck, Upload, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/pedido-ui/button";
import { Input } from "@/components/pedido-ui/input";
import { Label } from "@/components/pedido-ui/label";
import { Textarea } from "@/components/pedido-ui/textarea";
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

const formSchema = z.object({
  data_venda: z.string().min(1, "Data é obrigatória"),
  cliente: z.string().min(1, "Nome do cliente é obrigatório"),
  vendedor: z.string().min(1, "Vendedor é obrigatório"),
  telefone: z.string().optional(),
  cidade: z.string().optional(),
  estado: z.string().optional(),
  endereco: z.string().optional(),
  motivo: z.string().min(5, "Descreva o motivo da garantia"),
});

type FormData = z.infer<typeof formSchema>;

const fileToBase64 = (file: File): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(",")[1] || "");
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

export default function PedidoGarantia() {
  const navigate = useNavigate();
  const { logout } = useAuth();
  const [loading, setLoading] = useState(false);
  const { data: vendedores = [] } = useVendors();
  const [arquivo, setArquivo] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      data_venda: (() => {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      })(),
    },
  });

  const vendedor = watch("vendedor");

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".docx")) {
      toast.error("Envie um arquivo .docx");
      return;
    }
    setArquivo(f);
    toast.success(`Arquivo selecionado: ${f.name}`);
  };

  const onSubmit = async (data: FormData) => {
    if (!arquivo) {
      toast.error("Anexe o documento Word descritivo da garantia");
      return;
    }
    try {
      setLoading(true);

      const { data: pedidoNumero, error: rpcError } = await supabase.rpc(
        "gerar_pedido_numero",
        { p_data: data.data_venda }
      );
      if (rpcError) throw new Error("Erro ao gerar número do pedido");

      // Upload do DOCX
      let arquivoUrl = `SEM_DOCX:garantia_${Date.now()}`;
      const sanitized = arquivo.name
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_")
        .replace(/_+/g, "_");
      const storagePath = `Pedido_Garantia_${String(pedidoNumero).replace(/\s/g, "_")}_${sanitized}`;
      const { error: uploadError } = await supabase.storage
        .from("pedidos")
        .upload(storagePath, arquivo, {
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          upsert: true,
        });
      if (!uploadError) {
        const { data: urlData } = supabase.storage.from("pedidos").getPublicUrl(storagePath);
        arquivoUrl = urlData.publicUrl;
      }

      const descricaoFinal = `[PEDIDO DE GARANTIA] ${data.motivo}`;

      const { data: pedidoInserido, error: insertError } = await supabase
        .from("pedidos_venda")
        .insert({
          pedido_numero: pedidoNumero,
          numero_orcamento: pedidoNumero,
          cliente: data.cliente,
          vendedor: data.vendedor,
          telefone: data.telefone || null,
          cidade: data.cidade || null,
          estado: data.estado || null,
          endereco: data.endereco || null,
          data_venda: data.data_venda,
          data_entrega: data.data_venda,
          dias_uteis: 0,
          equipamentos_json: [descricaoFinal],
          motores_json: [],
          equipamentos_detalhados: [
            { descricao: descricaoFinal, quantidade: 1, unidade: "UN" },
          ],
          valor_total: 0,
          ajuste_valor: 0,
          descricao_equipamento: descricaoFinal,
          arquivo_url: arquivoUrl,
          status: "ABERTO",
          fonte_origem: "GARANTIA",
        })
        .select("id")
        .single();

      if (insertError) throw new Error("Erro ao salvar pedido de garantia");

      // Produção
      try {
        const { data: primeiroEstagio } = await supabase
          .from("producao_estagios")
          .select("id")
          .eq("ativo", true)
          .order("ordem", { ascending: true })
          .limit(1)
          .single();
        if (primeiroEstagio) {
          await supabase.from("producao_pedidos").insert({
            pedido_id: pedidoInserido.id,
            estagio_id: primeiroEstagio.id,
            prioridade: 0,
          });
        }
      } catch (e) {
        console.warn("Sem registro de produção:", e);
      }

      // App2
      try {
        const base64 = await fileToBase64(arquivo);
        await supabase.functions.invoke("enviar-docx-app2", {
          body: {
            pedidoId: pedidoInserido.id,
            clienteNome: data.cliente,
            vendedorNome: data.vendedor,
            docxBase64: base64,
            nomeArquivo: arquivo.name,
            tituloEquipamento: descricaoFinal,
            equipamentos: [
              { numero: 1, descricao: descricaoFinal, quantidade: 1, unidade: "UN" },
            ],
            motores: [],
            tensao: "",
            voltagem: "",
            prazoDias: 0,
            prazoTipo: "corridos",
            prazoData: data.data_venda,
            observacaoVendedor: `PEDIDO DE GARANTIA - ${data.motivo}`,
            checkListCompras: null,
            motorMarca: "",
          },
        });
      } catch (e) {
        console.warn("App2 não enviado:", e);
      }

      toast.success("Pedido de Garantia cadastrado e enviado à fábrica ✅");
      reset();
      setArquivo(null);
      navigate("/controle/pedidos");
    } catch (error: any) {
      console.error(error);
      toast.error(error?.message || "Erro ao cadastrar pedido de garantia");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-full">

      <main className="container mx-auto px-4 py-12 max-w-3xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              Dados da Garantia
            </CardTitle>
            <p className="text-sm text-muted-foreground mt-1">
              Este pedido <strong>não exige valor</strong> nem forma de pagamento. O documento Word
              descritivo é obrigatório e será enviado para a fábrica (App2) automaticamente.
            </p>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="data_venda">Data *</Label>
                  <Input id="data_venda" type="date" {...register("data_venda")} />
                  {errors.data_venda && (
                    <p className="text-sm text-destructive">{errors.data_venda.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="vendedor">Vendedor Responsável *</Label>
                  <Select value={vendedor} onValueChange={(v) => setValue("vendedor", v)}>
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
                    <p className="text-sm text-destructive">{errors.vendedor.message}</p>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="cliente">Nome do Cliente *</Label>
                <Input id="cliente" placeholder="Ex: João Silva Ltda" {...register("cliente")} />
                {errors.cliente && (
                  <p className="text-sm text-destructive">{errors.cliente.message}</p>
                )}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="telefone">Telefone</Label>
                  <Input id="telefone" placeholder="(00) 00000-0000" {...register("telefone")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="endereco">Endereço de Entrega</Label>
                  <Input id="endereco" placeholder="Rua, número" {...register("endereco")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="cidade">Cidade</Label>
                  <Input id="cidade" {...register("cidade")} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="estado">Estado (UF)</Label>
                  <Input id="estado" maxLength={2} {...register("estado")} />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="motivo">Motivo / Descrição da Garantia *</Label>
                <Textarea
                  id="motivo"
                  rows={4}
                  placeholder="Descreva o equipamento, defeito, peça de reposição, etc."
                  {...register("motivo")}
                />
                {errors.motivo && (
                  <p className="text-sm text-destructive">{errors.motivo.message}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Documento Word descritivo (.docx) *</Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".docx"
                  onChange={handleFile}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full justify-start"
                  onClick={() => fileInputRef.current?.click()}
                >
                  {arquivo ? (
                    <>
                      <CheckCircle2 className="mr-2 h-5 w-5 text-green-600" />
                      {arquivo.name}
                    </>
                  ) : (
                    <>
                      <Upload className="mr-2 h-5 w-5" />
                      Selecionar arquivo Word (.docx)
                    </>
                  )}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Igual ao orçamento do pedido completo. Será enviado para a fábrica.
                </p>
              </div>

              <div className="flex gap-4 pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate("/controle/novo-pedido")}
                  className="flex-1"
                >
                  Cancelar
                </Button>
                <Button type="submit" disabled={loading} className="flex-1">
                  {loading ? "Salvando..." : "Cadastrar Pedido de Garantia"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
