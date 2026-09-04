// Modal de ajuste de valor do pedido, portado de controle.branorte.com
// (`src/components/AjusteValorModal.tsx`).
//
// O que o modal devolve é o NOVO VALOR TOTAL (bruto + ajuste), não o delta.
// Quem chama é que calcula a diferença e grava em `ajuste_valor` — o
// `valor_total` e o `payment_plan_json.total` do banco NUNCA são reescritos,
// porque o ajuste é somado em cima deles em toda a aplicação (relatórios,
// ranking, financeiro). Ver PedidoDetalhe.salvarAjusteValor.
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/pedido-ui/dialog";
import { Button } from "@/components/pedido-ui/button";
import { Input } from "@/components/pedido-ui/input";
import { Label } from "@/components/pedido-ui/label";
import { Textarea } from "@/components/pedido-ui/textarea";
import { DollarSign, Info } from "lucide-react";

interface AjusteValorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (novoValorTotal: number, motivo: string) => void;
  pedidoNumero: string;
  valorAtual: number;
  motivoAtual?: string;
}

/** "12.345,67" / "R$ 12.345,67" -> 12345.67 */
function parseBRL(value: string): number {
  if (!value) return 0;
  const cleaned = value.replace(/[R$\s]/g, "").replace(/\./g, "").replace(",", ".");
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** 12345.67 -> "12.345,67" (sem o "R$", que fica no prefixo do input) */
function formatInputBRL(valor: number): string {
  if (!valor) return "";
  return valor.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatarValor(valor: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
}

export function AjusteValorModal({
  open,
  onOpenChange,
  onConfirm,
  pedidoNumero,
  valorAtual = 0,
  motivoAtual = "",
}: AjusteValorModalProps) {
  const [novoValor, setNovoValor] = useState<string>("");
  const [motivo, setMotivo] = useState<string>(motivoAtual);

  // Reseta ao abrir: o modal fica montado entre aberturas, então sem isso o
  // segundo ajuste começaria com o texto digitado no primeiro.
  useEffect(() => {
    if (open) {
      setNovoValor(formatInputBRL(valorAtual));
      setMotivo(motivoAtual);
    }
  }, [open, valorAtual, motivoAtual]);

  const handleValorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setNovoValor(e.target.value.replace(/[^0-9.,]/g, ""));
  };

  const handleValorBlur = () => {
    const n = parseBRL(novoValor);
    if (n > 0) setNovoValor(formatInputBRL(n));
  };

  const handleCancel = () => {
    setNovoValor(formatInputBRL(valorAtual));
    setMotivo(motivoAtual);
    onOpenChange(false);
  };

  const valorNumerico = parseBRL(novoValor);
  const diferenca = valorNumerico - valorAtual;

  const handleConfirm = () => {
    if (!motivo.trim() || valorNumerico <= 0) return;
    onConfirm(valorNumerico, motivo.trim());
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <DollarSign className="h-5 w-5" />
            Ajustar Valor — {pedidoNumero}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="rounded-lg bg-muted/50 p-3">
            <p className="text-sm text-muted-foreground">Valor atual do pedido</p>
            <p className="text-xl font-bold">{formatarValor(valorAtual)}</p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ajuste-novo-valor">Novo Valor Total</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                R$
              </span>
              <Input
                id="ajuste-novo-valor"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={novoValor}
                onChange={handleValorChange}
                onBlur={handleValorBlur}
                className="pl-10 text-lg font-medium"
              />
            </div>

            {diferenca !== 0 && (
              <p
                className={`text-sm font-medium ${
                  diferenca > 0
                    ? "text-emerald-700 dark:text-emerald-400"
                    : "text-red-700 dark:text-red-400"
                }`}
              >
                {diferenca > 0 ? "+" : ""}
                {formatarValor(diferenca)}
                <span className="ml-1 font-normal text-muted-foreground">
                  ({diferenca > 0 ? "aumento" : "desconto"})
                </span>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="ajuste-motivo">
              Motivo do Ajuste
              <span className="ml-1 text-destructive">*</span>
            </Label>
            <Textarea
              id="ajuste-motivo"
              placeholder="Ex: Desconto por pagamento antecipado, negociação especial, correção de valor..."
              value={motivo}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setMotivo(e.target.value)}
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="flex items-start gap-2 rounded-lg bg-blue-500/10 p-3 text-sm text-blue-700 dark:text-blue-300">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <p>O novo valor será refletido em todos os relatórios e controles de vendas do sistema.</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={handleCancel}>
            Cancelar
          </Button>
          <Button onClick={handleConfirm} disabled={!motivo.trim() || valorNumerico <= 0}>
            Salvar Ajuste
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}