import { useState, useEffect } from "react";
import { Button } from "@/components/pedido-ui/button";
import { Input } from "@/components/pedido-ui/input";
import { Label } from "@/components/pedido-ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/pedido-ui/select";
import { Plus, Copy, Trash2, Zap, Target } from "lucide-react";
import { toast } from "@/components/pedido-ui/use-toast";

type DataTipo = "no_pedido" | "apos_pedido" | "na_nf" | "apos_nf" | "data_fixa";

// Exportadas porque o PedidoForm precisa anotar os callbacks que percorrem o plano.
// No repo de origem o tsconfig nao tinha `noImplicitAny`, entao `p`/`acc` viviam como
// `any` implicito; o CRM e estrito e recusa.
export interface Parcela {
  n: number;
  descricao: string;
  metodo: "PIX" | "Boleto" | "Cartão de Crédito" | "A combinar com cliente" | "Outro";
  vencimento: "hoje" | "emissao_nf" | "+30" | "+60" | "+90" | "custom";
  // Vencimento: No pedido / Após o pedido (dias) / Na emissão da nota / Após a emissão da nota (dias) / Data fixa
  dataTipo?: DataTipo;
  dias?: number; // usado quando dataTipo === "apos_nf" ou "apos_pedido"
  data: string;
  valor: { tipo: "percentual" | "fixo"; percentual?: number; fixo?: number };
}

export interface PaymentPlan {
  modo: "padrao_empresa" | "custom";
  observacao: string;
  moeda: "BRL";
  total: number;
  parcelas: Parcela[];
}

interface PaymentPlanEditorProps {
  valorTotal: number;
  paymentPlan: PaymentPlan | null;
  onChange: (plan: PaymentPlan) => void;
  dataEntrega?: Date;
  dataVenda?: Date;
}

export function PaymentPlanEditor({ valorTotal, paymentPlan, onChange, dataEntrega, dataVenda }: PaymentPlanEditorProps) {
  const [modo, setModo] = useState<"padrao_empresa" | "custom">("custom");
  const [observacao, setObservacao] = useState(paymentPlan?.observacao || "");
  const [parcelas, setParcelas] = useState<Parcela[]>(paymentPlan?.parcelas || []);
  const [tipoValor, setTipoValor] = useState<"fixo">("fixo");

  // Sincronizar com paymentPlan quando ele muda (ex: ao carregar pedido existente)
  useEffect(() => {
    if (paymentPlan) {
      setModo(paymentPlan.modo || "custom");
      setObservacao(paymentPlan.observacao || "");
      setParcelas(paymentPlan.parcelas || []);
    }
  }, [paymentPlan]);

  const calcularData = (vencimento: string): string => {
    const hoje = new Date();
    const emissao = dataEntrega || hoje;
    
    switch (vencimento) {
      case "hoje":
        return hoje.toISOString().split('T')[0];
      case "emissao_nf":
        return emissao.toISOString().split('T')[0];
      case "+30":
        const data30 = new Date(emissao);
        data30.setDate(data30.getDate() + 30);
        return data30.toISOString().split('T')[0];
      case "+60":
        const data60 = new Date(emissao);
        data60.setDate(data60.getDate() + 60);
        return data60.toISOString().split('T')[0];
      case "+90":
        const data90 = new Date(emissao);
        data90.setDate(data90.getDate() + 90);
        return data90.toISOString().split('T')[0];
      default:
        return "";
    }
  };

  // Vencimento calculado a partir da base de cada tipo:
  // No pedido = data da venda · Após o pedido = venda + N dias · Na emissão da nota = data de entrega/NF
  // · Após a emissão da nota = NF + N dias · Data fixa = manual
  const dataDoTipo = (dataTipo: DataTipo, dias?: number): string => {
    const hoje = new Date();
    const venda = dataVenda || hoje;
    const emissao = dataEntrega || hoje;
    switch (dataTipo) {
      case "no_pedido":
        return venda.toISOString().split('T')[0];
      case "apos_pedido": {
        const d = new Date(venda);
        d.setDate(d.getDate() + (dias || 0));
        return d.toISOString().split('T')[0];
      }
      case "na_nf":
        return emissao.toISOString().split('T')[0];
      case "apos_nf": {
        const d = new Date(emissao);
        d.setDate(d.getDate() + (dias || 0));
        return d.toISOString().split('T')[0];
      }
      default:
        return ""; // data_fixa: preenchida manualmente no campo Data
    }
  };

  // Tipos que usam o campo de "dias" ao lado do seletor.
  const usaDias = (dataTipo: DataTipo): boolean => dataTipo === "apos_nf" || dataTipo === "apos_pedido";

  const labelData = (dataTipo: DataTipo, dias?: number): string => {
    switch (dataTipo) {
      case "no_pedido": return "No pedido";
      case "apos_pedido": return `Após o pedido (${dias || 0} dias)`;
      case "na_nf": return "Na emissão da nota";
      case "apos_nf": return `Após a emissão da nota (${dias || 0} dias)`;
      case "data_fixa": return "Data fixa";
    }
  };

  // Infere o tipo pra parcelas antigas (sem dataTipo) a partir da descrição/data.
  const inferirDataTipo = (p: Parcela): DataTipo => {
    if (p.dataTipo) return p.dataTipo;
    const d = (p.descricao || "").toLowerCase();
    const temDias = d.includes("após") || d.includes("apos") || /\d+\s*dias/.test(d);
    const mencionaNota = d.includes("emiss") || d.includes("nf") || d.includes("nota");
    const mencionaPedido = d.includes("pedido");
    if (temDias && mencionaPedido && !mencionaNota) return "apos_pedido";
    if (temDias) return "apos_nf"; // "após" sem "pedido" -> assume emissão (comportamento anterior)
    if (mencionaNota) return "na_nf";
    if (mencionaPedido) return "no_pedido";
    return p.data ? "data_fixa" : "no_pedido";
  };

  // Preset padrão 4x
  const gerarPresetPadrao = () => {
    const novasParcelas: Parcela[] = [
      {
        n: 1,
        descricao: "No pedido (colocar em produção)",
        metodo: "PIX",
        vencimento: "hoje",
        data: calcularData("hoje"),
        valor: { tipo: "percentual", percentual: 25 }
      },
      {
        n: 2,
        descricao: "Na emissão da NF",
        metodo: "PIX",
        vencimento: "emissao_nf",
        data: calcularData("emissao_nf"),
        valor: { tipo: "percentual", percentual: 25 }
      },
      {
        n: 3,
        descricao: "+30 dias após emissão",
        metodo: "Boleto",
        vencimento: "+30",
        data: calcularData("+30"),
        valor: { tipo: "percentual", percentual: 25 }
      },
      {
        n: 4,
        descricao: "+60 dias após emissão",
        metodo: "Boleto",
        vencimento: "+60",
        data: calcularData("+60"),
        valor: { tipo: "percentual", percentual: 25 }
      }
    ];
    setParcelas(novasParcelas);
    setModo("padrao_empresa");
    emitChange("padrao_empresa", novasParcelas, observacao);
  };

  const emitChange = (novoModo: typeof modo, novasParcelas: Parcela[], novaObs: string) => {
    onChange({
      modo: novoModo,
      observacao: novaObs,
      moeda: "BRL",
      total: valorTotal,
      parcelas: novasParcelas
    });
  };

  const calcularValor = (p: Parcela): number => {
    if (p.valor.tipo === "percentual") {
      return (valorTotal * (p.valor.percentual || 0)) / 100;
    }
    return p.valor.fixo || 0;
  };

  const calcularPercentual = (p: Parcela): number => {
    if (p.valor.tipo === "percentual") {
      return p.valor.percentual || 0;
    }
    if (valorTotal === 0) return 0;
    return ((p.valor.fixo || 0) / valorTotal) * 100;
  };

  const somaTotal = parcelas.reduce((acc, p) => acc + calcularValor(p), 0);
  const diferenca = Math.abs(somaTotal - valorTotal);
  const estaCorreto = diferenca < 0.01;

  const adicionarParcela = () => {
    // Calcular data automaticamente: +30 dias da última parcela
    let novaData = "";
    if (parcelas.length > 0) {
      const ultimaParcela = parcelas[parcelas.length - 1];
      if (ultimaParcela.data) {
        const dataBase = new Date(ultimaParcela.data);
        dataBase.setDate(dataBase.getDate() + 30);
        novaData = dataBase.toISOString().split('T')[0];
      }
    }
    // Garante uma data válida sempre (senão a validação do pedido barra a parcela).
    if (!novaData) {
      novaData = new Date().toISOString().split('T')[0];
    }

    // Nasce como "Data fixa" com descrição JÁ preenchida — assim o seletor e o estado
    // ficam consistentes e o pedido libera assim que o valor for informado.
    const nova: Parcela = {
      n: parcelas.length + 1,
      descricao: "Data fixa",
      metodo: "PIX",
      vencimento: "custom",
      dataTipo: "data_fixa",
      data: novaData,
      valor: { tipo: "fixo", fixo: 0 }
    };
    const novas = [...parcelas, nova];
    setParcelas(novas);
    emitChange("custom", novas, observacao);
  };

  const duplicarParcela = (index: number) => {
    const original = parcelas[index];
    const nova: Parcela = { 
      ...original, 
      n: parcelas.length + 1,
      descricao: original.descricao + " (cópia)"
    };
    const novas = [...parcelas, nova];
    setParcelas(novas);
    emitChange("custom", novas, observacao);
  };

  const excluirParcela = (index: number) => {
    const novas = parcelas.filter((_, i) => i !== index).map((p, i) => ({ ...p, n: i + 1 }));
    setParcelas(novas);
    emitChange("custom", novas, observacao);
  };

  const saldoAutomatico = () => {
    if (parcelas.length === 0) return;
    
    const valorPorParcela = valorTotal / parcelas.length;
    const novas = parcelas.map(p => ({
      ...p,
      valor: { tipo: "fixo" as const, fixo: valorPorParcela }
    }));
    
    setParcelas(novas);
    emitChange("custom", novas, observacao);
  };

  const completarUltimaParcela = () => {
    if (parcelas.length === 0) return;
    
    const somaExcetoUltima = parcelas.slice(0, -1).reduce((acc, p) => acc + calcularValor(p), 0);
    const valorRestante = valorTotal - somaExcetoUltima;
    
    if (valorRestante < 0) {
      toast({
        title: "Erro",
        description: "A soma das outras parcelas já excede o valor total",
        variant: "destructive"
      });
      return;
    }
    
    const novas = [...parcelas];
    novas[novas.length - 1] = {
      ...novas[novas.length - 1],
      valor: { tipo: "fixo", fixo: valorRestante }
    };
    
    setParcelas(novas);
    emitChange("custom", novas, observacao);
  };

  const atualizarParcela = (index: number, campo: keyof Parcela, valor: any) => {
    const novas = [...parcelas];
    (novas[index] as any)[campo] = valor;
    setParcelas(novas);
    emitChange("custom", novas, observacao);
  };

  const atualizarParcelaCampos = (index: number, campos: Partial<Parcela>) => {
    const novas = [...parcelas];
    novas[index] = { ...novas[index], ...campos };
    setParcelas(novas);
    emitChange("custom", novas, observacao);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">Condições de Pagamento</h3>
      <div className="flex flex-wrap gap-2 mb-4">
        <Button type="button" onClick={adicionarParcela} size="sm" variant="outline" className="text-xs sm:text-sm">
          <Plus className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
          Adicionar
        </Button>
        <Button type="button" onClick={saldoAutomatico} size="sm" variant="outline" disabled={parcelas.length === 0} className="text-xs sm:text-sm">
          <Zap className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
          <span className="hidden sm:inline">Saldo automático</span>
          <span className="sm:hidden">Saldo auto.</span>
        </Button>
        <Button type="button" onClick={completarUltimaParcela} size="sm" variant="outline" disabled={parcelas.length === 0} className="text-xs sm:text-sm">
          <Target className="h-3.5 w-3.5 sm:h-4 sm:w-4 mr-1" />
          <span className="hidden sm:inline">Completar última</span>
          <span className="sm:hidden">Completar</span>
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="p-2 text-left w-8">#</th>
                <th className="p-2 text-left">Descrição</th>
                <th className="p-2 text-left w-24">Método</th>
                <th className="p-2 text-left w-36">Data</th>
                <th className="p-2 text-left w-28">Valor</th>
                <th className="p-2 w-20"></th>
              </tr>
            </thead>
            <tbody>
              {parcelas.map((p, idx) => (
                <tr key={idx} className="border-t">
                  <td className="p-2 font-bold">{p.n}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1">
                      <Select
                        value={inferirDataTipo(p)}
                        onValueChange={(v) => {
                          const dataTipo = v as DataTipo;
                          const dias = usaDias(dataTipo) ? (p.dias && p.dias > 0 ? p.dias : 30) : undefined;
                          const metodo: Parcela["metodo"] = usaDias(dataTipo) ? "Boleto" : "PIX";
                          atualizarParcelaCampos(idx, {
                            dataTipo,
                            dias,
                            descricao: labelData(dataTipo, dias),
                            metodo,
                            vencimento: "custom",
                            // "Data fixa" mantém a data atual; os demais recalculam a partir de venda/NF
                            ...(dataTipo === "data_fixa" ? {} : { data: dataDoTipo(dataTipo, dias) }),
                          });
                        }}
                      >
                        <SelectTrigger className="h-8 text-xs bg-background min-w-[120px]">
                          <SelectValue placeholder="Selecione..." />
                        </SelectTrigger>
                        <SelectContent className="z-50 bg-popover">
                          <SelectItem value="no_pedido">No pedido</SelectItem>
                          <SelectItem value="apos_pedido">Após o pedido (dias)</SelectItem>
                          <SelectItem value="na_nf">Na emissão da nota</SelectItem>
                          <SelectItem value="apos_nf">Após a emissão da nota (dias)</SelectItem>
                          <SelectItem value="data_fixa">Data fixa</SelectItem>
                        </SelectContent>
                      </Select>
                      {usaDias(inferirDataTipo(p)) && (
                        <Input
                          type="number"
                          min={1}
                          max={365}
                          value={p.dias ?? 30}
                          onChange={(e) => {
                            const dias = parseInt(e.target.value) || 0;
                            const tipo = inferirDataTipo(p);
                            atualizarParcelaCampos(idx, {
                              dias,
                              descricao: labelData(tipo, dias),
                              data: dataDoTipo(tipo, dias),
                              vencimento: "custom",
                            });
                          }}
                          className="h-8 w-14 text-xs bg-background text-center"
                          title="Dias após o pedido / a emissão da nota"
                        />
                      )}
                    </div>
                  </td>
                  <td className="p-2">
                    <Select 
                      value={p.metodo} 
                      onValueChange={(v) => atualizarParcela(idx, "metodo", v)}
                    >
                      <SelectTrigger className="h-8 text-xs bg-background">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="z-50 bg-popover">
                        <SelectItem value="PIX">PIX</SelectItem>
                        <SelectItem value="Boleto">Boleto</SelectItem>
                        <SelectItem value="Cartão de Crédito">Cartão de Crédito</SelectItem>
                        <SelectItem value="A combinar com cliente">A combinar com cliente</SelectItem>
                        <SelectItem value="Outro">Outro</SelectItem>
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="p-2">
                    <Input
                      type="date"
                      value={p.data || ""}
                      onChange={(e) => {
                        atualizarParcelaCampos(idx, { data: e.target.value, dataTipo: "data_fixa", vencimento: "custom" as const });
                      }}
                      className="h-8 text-xs bg-background"
                    />
                  </td>
                  <td className="p-2">
                    <Input
                      type="number"
                      step="0.01"
                      value={p.valor.tipo === "percentual" ? p.valor.percentual || 0 : p.valor.fixo || 0}
                      onChange={(e) => {
                        const val = parseFloat(e.target.value) || 0;
                        atualizarParcela(idx, "valor", {
                          tipo: "fixo",
                          fixo: val
                        });
                      }}
                      className="h-8 text-xs"
                    />
                    <div className="text-[10px] text-muted-foreground mt-0.5">
                      {`${calcularPercentual(p).toFixed(1)}%`}
                    </div>
                  </td>
                  <td className="p-2">
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => duplicarParcela(idx)}
                        className="h-8 w-8"
                      >
                        <Copy className="h-3 w-3" />
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => excluirParcela(idx)}
                        className="h-8 w-8 text-destructive"
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* `--destructive` é var do app de origem e NÃO existe no CRM: quando as parcelas
          NÃO fechavam com o total, a cor inválida caía fora e o bloco ficava SEM FUNDO —
          justamente o caso em que o alerta precisa aparecer. Aqui a var é `--danger`. */}
      <div className="p-3 rounded-lg border" style={{ backgroundColor: estaCorreto ? 'hsl(var(--accent) / 0.1)' : 'hsl(var(--danger) /0.1)' }}>
        <p className={`text-sm font-semibold ${estaCorreto ? 'text-accent' : 'text-destructive'}`}>
          Soma = R$ {somaTotal.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {estaCorreto ? '✓ OK' : `(falta R$ ${diferenca.toLocaleString('pt-BR', { minimumFractionDigits: 2 })})`}
        </p>
      </div>

      <div>
        <Label htmlFor="observacao_pagamento" className="text-sm font-medium">Observação</Label>
        <Input
          id="observacao_pagamento"
          value={observacao}
          onChange={(e) => {
            setObservacao(e.target.value);
            emitChange(modo, parcelas, e.target.value);
          }}
          placeholder="Ex: Valores sujeitos a reajuste..."
          className="mt-1"
        />
      </div>
    </div>
  );
}
