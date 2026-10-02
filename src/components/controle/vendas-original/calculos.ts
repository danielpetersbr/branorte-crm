export type PedidoStatus = "ABERTO" | "FECHADO" | "CANCELADO";

export interface Pedido {
  id: string;
  pedido_numero: string;
  numero_orcamento: string;
  cliente: string;
  vendedor: string;
  vendedor_2?: string | null;
  valor_split_v1?: number | null;
  valor_split_v2?: number | null;
  data_venda: string;
  valor_total: number;
  status: PedidoStatus;
  atencao_a: string;
  descricao_equipamento: string;
  data_primeiro_contato: string | null;
  fonte_origem: string | null;
  estado: string | null;
  equipamentos_json: any[];
  equipamentos_detalhados?: Array<{ descricao?: string; quantidade?: number; unidade?: string; valor?: number }>;
  ajuste_valor: number;
  ajuste_motivo: string | null;
  ajuste_data: string | null;
  payment_plan_json?: {
    total?: number;
    parcelas?: any[];
  };
  _displayId?: string;
  _valorOverride?: number;
  _isAjuste?: boolean;
}

export const getValorPedido = (pedido: Pedido): number => {
  // Se tem override (pedido dividido 50/50), usar direto
  if ((pedido as any)._valorOverride != null) {
    return (pedido as any)._valorOverride;
  }
  
  let valor = 0;
  
  // Forçar conversão para número (payment_plan_json.total vem como string do JSON)
  const paymentTotal = pedido.payment_plan_json?.total 
    ? Number(pedido.payment_plan_json.total) 
    : 0;
    
  if (paymentTotal > 0) {
    valor = paymentTotal;
  } else {
    valor = Number(pedido.valor_total) || 0;
  }
  
  // Garantir que ajuste também é número
  const ajuste = Number(pedido.ajuste_valor) || 0;
  
  return valor + ajuste;
};

// O centavo excedente pertence ao vendedor 1, com o sinal do valor original.
// Base e ajuste são repartidos separadamente para a data do ajuste não mudar a venda.
const ratearCentavos = (valor: number): [number, number] => {
  const centavos = Math.round(valor * 100);
  const primeiro = Math.sign(centavos) * Math.ceil(Math.abs(centavos) / 2);
  return [primeiro / 100, (centavos - primeiro) / 100];
};

// Valores explícitos de split representam o total final no ranking original.
// Um ajuste datado pertence ao seu próprio período e é dividido 50/50, como
// nas comissões: subtrai essa parte da venda e a lança em ajuste_data. Sem data,
// o ajuste acompanha a venda. Não divide unidades físicas nem os itens do pedido.
export const expandirPedidos = (
  raw: Pedido[],
  periodoStart: string,
  periodoEnd: string,
  filtroVendedor: string
): Pedido[] => {
  const expanded: Pedido[] = [];
  const filtroAtivo = filtroVendedor?.trim().toUpperCase();
  const dentro = (data: string) => !!data && (!periodoStart || !periodoEnd || (data >= periodoStart && data <= periodoEnd));
  for (const p of raw) {
    const dataVendaStr = p.data_venda?.split('T')[0] || '';
    const ajusteDataStr = p.ajuste_data?.split('T')[0] || '';
    const ajuste = Number(p.ajuste_valor) || 0;
    const ajusteDatado = ajuste !== 0 && !!ajusteDataStr;
    const totalFinal = getValorPedido(p);
    const vendedor = p.vendedor.trim().toUpperCase();
    const vendedor2 = p.vendedor_2?.trim().toUpperCase();
    const split1 = p.valor_split_v1;
    const split2 = p.valor_split_v2;
    const ajustes = vendedor2 ? ratearCentavos(ajuste) : [ajuste, 0];
    const bases = ratearCentavos(getValorPedido({ ...p, _valorOverride: undefined, ajuste_valor: 0 }));
    const totaisImplicitos = bases.map((base, i) => (Math.round(base * 100) + Math.round(ajustes[i] * 100)) / 100);
    const partes = vendedor2
      ? [{ vendedor, sufixo: '_v1', valor: split1 != null ? Number(split1) : split2 != null ? (Math.round(totalFinal * 100) - Number(split2) * 100) / 100 : totaisImplicitos[0] },
         { vendedor: vendedor2, sufixo: '_v2', valor: split2 != null ? Number(split2) : split1 != null ? (Math.round(totalFinal * 100) - Number(split1) * 100) / 100 : totaisImplicitos[1] }]
      : [{ vendedor, sufixo: '', valor: totalFinal }];
    for (const [indice, parte] of partes.entries()) {
      if (filtroAtivo && filtroAtivo !== 'TODOS' && filtroAtivo !== parte.vendedor) continue;
      const ajusteParte = ajustes[indice];
      if (dentro(dataVendaStr)) {
        expanded.push({ ...p, vendedor: parte.vendedor,
          _displayId: `${p.id}${parte.sufixo}${ajusteDatado ? '_base' : ''}`,
          _valorOverride: ajusteDatado ? (parte.valor * 100 - ajusteParte * 100) / 100 : parte.valor, _isAjuste: false });
      }
      if (ajusteDatado && dentro(ajusteDataStr)) {
        expanded.push({ ...p, vendedor: parte.vendedor,
          _displayId: `${p.id}${parte.sufixo}_ajuste`, _valorOverride: ajusteParte, _isAjuste: true,
          pedido_numero: `Acréscimo ${p.pedido_numero || p.numero_orcamento}`, data_venda: p.ajuste_data! });
      }
    }
  }
  expanded.sort((a, b) => {
    const dateA = a.data_venda || '';
    const dateB = b.data_venda || '';
    return dateB.localeCompare(dateA);
  });
  return expanded;
};


export const consultaPertenceAoContexto = (capturado: string, atual: string, geracaoCapturada: number, geracaoAtual: number, abortado: boolean): boolean => !abortado && !!capturado && capturado === atual && geracaoCapturada === geracaoAtual

/** Padrão explícito da página original para cadastro ausente ou zero. */
export const percentualComissaoControle = (percentual: number | null | undefined): number => Number(percentual) || 1

type ContextoPDF = { dono: string; consulta: string; geracaoPedidos: number; geracaoAno: number }
export const exportacaoPertenceAoContexto = (captura: ContextoPDF, atual: ContextoPDF & { montado: boolean; acessoNegado: boolean }): boolean =>
  atual.montado && !!captura.dono && captura.dono === atual.dono && captura.consulta === atual.consulta &&
  captura.geracaoPedidos === atual.geracaoPedidos && captura.geracaoAno === atual.geracaoAno && !atual.acessoNegado
