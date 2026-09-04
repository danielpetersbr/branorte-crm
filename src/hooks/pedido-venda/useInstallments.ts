import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/controle-supabase/client";
import { startOfMonth, endOfMonth, format, parseISO } from "date-fns";

export interface Installment {
  id: string;
  order_id: string;
  installment_no: number;
  total_installments: number;
  due_date: string;
  amount: number;
  description: string;
  status: 'PENDENTE' | 'PARCIAL' | 'PAGO' | 'VENCIDO' | 'BOLETO_ENVIADO';
  pedido_numero: string;
  cliente: string;
  vendedor: string;
  forma_pagamento: string | null;
  paid_amount: number;
  balance: number;
  canceled: boolean;
  canceled_at: string | null;
  cancellation_reason: string | null;
  boleto_enviado: boolean;
  boleto_enviado_em: string | null;
}

export interface InstallmentFilters {
  startDate?: Date;
  endDate?: Date;
  vendedor?: string;
  status?: string;
  cliente?: string;
  showCanceled?: boolean;
}

export const useInstallments = (filters: InstallmentFilters) => {
  return useQuery({
    queryKey: ['installments', filters],
    queryFn: async () => {
      let query = supabase
        .from('v_installments_summary')
        .select('*')
        .order('due_date', { ascending: true });

      // Não mostrar canceladas por padrão
      if (!filters.showCanceled) {
        query = query.eq('canceled', false);
      }

      if (filters.startDate) {
        query = query.gte('due_date', format(filters.startDate, 'yyyy-MM-dd'));
      }

      if (filters.endDate) {
        query = query.lte('due_date', format(filters.endDate, 'yyyy-MM-dd'));
      }

      if (filters.vendedor && filters.vendedor !== 'all') {
        query = query.eq('vendedor', filters.vendedor);
      }

      if (filters.status && filters.status !== 'all') {
        // Se filtro for PENDENTE, incluir BOLETO_ENVIADO também (ambos são "A Receber")
        if (filters.status === 'PENDENTE') {
          query = query.in('status', ['PENDENTE', 'BOLETO_ENVIADO']);
        } else {
          query = query.eq('status', filters.status as 'PAGO' | 'PARCIAL' | 'PENDENTE' | 'VENCIDO' | 'BOLETO_ENVIADO');
        }
      }

      if (filters.cliente) {
        query = query.ilike('cliente', `%${filters.cliente}%`);
      }

      const { data, error } = await query;

      if (error) throw error;
      return data as Installment[];
    },
  });
};

export const useInstallmentsSummary = (filters: InstallmentFilters) => {
  return useQuery({
    queryKey: ['installments-summary', filters],
    queryFn: async () => {
      let query = supabase
        .from('v_installments_summary')
        .select('*');

      // Não incluir canceladas nos totais
      query = query.eq('canceled', false);

      if (filters.startDate) {
        query = query.gte('due_date', format(filters.startDate, 'yyyy-MM-dd'));
      }

      if (filters.endDate) {
        query = query.lte('due_date', format(filters.endDate, 'yyyy-MM-dd'));
      }

      if (filters.vendedor && filters.vendedor !== 'all') {
        query = query.eq('vendedor', filters.vendedor);
      }

      if (filters.status && filters.status !== 'all') {
        // Se filtro for PENDENTE, incluir BOLETO_ENVIADO também (ambos são "A Receber")
        if (filters.status === 'PENDENTE') {
          query = query.in('status', ['PENDENTE', 'BOLETO_ENVIADO']);
        } else {
          query = query.eq('status', filters.status as 'PAGO' | 'PARCIAL' | 'PENDENTE' | 'VENCIDO' | 'BOLETO_ENVIADO');
        }
      }

      if (filters.cliente) {
        query = query.ilike('cliente', `%${filters.cliente}%`);
      }

      const { data, error } = await query;

      if (error) throw error;

      const installments = data as Installment[];

      // Calcular totais do período
      const totalSales = installments.reduce((sum, i) => sum + i.amount, 0);
      const totalReceived = installments.reduce((sum, i) => sum + i.paid_amount, 0);
      
      // Separar "A Receber" (PENDENTE/VENCIDO/PARCIAL) de "Boleto" (BOLETO_ENVIADO)
      const pendingInstallments = installments.filter(i => 
        i.status === 'PENDENTE' || i.status === 'VENCIDO' || i.status === 'PARCIAL'
      );
      const boletoInstallments = installments.filter(i => i.status === 'BOLETO_ENVIADO');
      
      const totalToReceive = pendingInstallments.reduce((sum, i) => sum + i.balance, 0);
      const totalBoleto = boletoInstallments.reduce((sum, i) => sum + i.balance, 0);
      
      const percentReceived = totalSales > 0 ? (totalReceived / totalSales) * 100 : 0;

      // Agrupar por mês
      const byMonth = installments.reduce((acc, inst) => {
        const month = format(parseISO(inst.due_date), 'yyyy-MM');
        if (!acc[month]) {
          acc[month] = {
            total: 0,
            received: 0,
            toReceive: 0,
            installments: []
          };
        }
        acc[month].total += inst.amount;
        acc[month].received += inst.paid_amount;
        acc[month].toReceive += inst.balance;
        acc[month].installments.push(inst);
        return acc;
      }, {} as Record<string, { total: number; received: number; toReceive: number; installments: Installment[] }>);

      return {
        totalSales,
        totalReceived,
        totalToReceive,
        totalBoleto,
        percentReceived,
        byMonth
      };
    },
  });
};

export const useVendors = () => {
  return useQuery({
    queryKey: ['vendors'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pedidos_venda')
        .select('vendedor')
        .not('vendedor', 'is', null);

      if (error) throw error;

      const uniqueVendors = [...new Set(data.map(p => p.vendedor))].filter(Boolean);
      return uniqueVendors as string[];
    },
  });
};

export const useClients = () => {
  return useQuery({
    queryKey: ['clients'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('pedidos_venda')
        .select('cliente')
        .not('cliente', 'is', null);

      if (error) throw error;

      const uniqueClients = [...new Set(data.map(p => p.cliente))].filter(Boolean);
      return uniqueClients as string[];
    },
  });
};
