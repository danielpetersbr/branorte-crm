// Selo de status do pedido de venda, portado de controle.branorte.com
// (`src/components/StatusBadge.tsx`).
//
// ⚠️ O RÓTULO NÃO É O VALOR DO BANCO. No `pedidos_venda` o enum é
// ABERTO | FECHADO | CANCELADO, mas na operação "FECHADO" quer dizer que o
// equipamento foi ENTREGUE — é isso que o vendedor lê na tela. Trocar o texto
// aqui pra "FECHADO" já confundiu quem leu a listagem como "venda fechada".
//
// As cores usam alpha (/15, /40) em cima de `emerald`/`red`, então funcionam nos
// dois temas sem par `dark:` no fundo; só o texto ganha o par, que é onde o
// contraste realmente muda.
import { Badge } from "@/components/pedido-ui/badge";
import type { Database } from "@/lib/controle-supabase/types";

export type PedidoStatus = Database["public"]["Enums"]["pedido_status"];

interface StatusBadgePedidoProps {
  status: PedidoStatus | null;
  className?: string;
}

const STATUS_STYLES: Record<PedidoStatus, string> = {
  ABERTO: "border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  FECHADO: "border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-400",
  CANCELADO: "border-muted-foreground/40 bg-muted text-muted-foreground",
};

/**
 * Vocabulário ÚNICO do status na tela. Exportado de propósito: o select do
 * cabeçalho tem que dizer a MESMA palavra que o selo. Antes o selo dizia
 * "ENTREGUE" e o select, no mesmo pedido, dizia "FECHADO" — mesmo campo, dois
 * nomes, e o vendedor lendo que o pedido estava em dois estados.
 * O VALOR gravado continua sendo o do enum (FECHADO); isto aqui é só a etiqueta.
 */
export const STATUS_LABEL: Record<PedidoStatus, string> = {
  ABERTO: "ABERTO",
  FECHADO: "ENTREGUE",
  CANCELADO: "CANCELADO",
};

export function StatusBadgePedido({ status, className }: StatusBadgePedidoProps) {
  // `status` é nullable na tabela; sem isso a indexação abaixo quebra em runtime.
  const s: PedidoStatus = status ?? "ABERTO";
  return (
    <Badge variant="outline" className={`font-semibold ${STATUS_STYLES[s]} ${className ?? ""}`}>
      {STATUS_LABEL[s]}
    </Badge>
  );
}