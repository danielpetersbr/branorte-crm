// Hooks do sistema de cotacao de frete Branorte.
// Carregam tipos de caminhao, tabela ANTT vigente, transportadoras parceiras
// e historico de cotacoes. Persistem novas cotacoes.

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type {
  TipoCaminhao,
  AnttTabela,
  TransportadoraParceira,
} from '@/lib/calcFrete';

// ─────────────────────────────────────────────────────────────
// Municipios IBGE por UF (autocomplete da busca por cidade)
// ─────────────────────────────────────────────────────────────

/** 27 UFs do Brasil pro select da busca por cidade. */
export const UFS_BR = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const;

/**
 * Lista de municipios de uma UF via API publica do IBGE.
 * Payload pequeno (centenas de nomes por estado) e cacheado pra sempre.
 * Alimenta o <datalist> do autocomplete da busca por cidade.
 */
export function useMunicipiosUF(uf: string | null) {
  return useQuery({
    queryKey: ['ibge-municipios', uf],
    queryFn: async (): Promise<string[]> => {
      if (!uf) return [];
      const res = await fetch(
        `https://servicodados.ibge.gov.br/api/v1/localidades/estados/${uf}/municipios`,
      );
      if (!res.ok) return [];
      const arr = await res.json();
      if (!Array.isArray(arr)) return [];
      return arr
        .map((m: any) => m?.nome as string)
        .filter(Boolean)
        .sort((a: string, b: string) => a.localeCompare(b, 'pt-BR'));
    },
    enabled: !!uf,
    staleTime: Infinity, // municipios não mudam
  });
}

// ─────────────────────────────────────────────────────────────
// Tipos de caminhao
// ─────────────────────────────────────────────────────────────

export function useTiposCaminhao() {
  return useQuery({
    queryKey: ['frete-tipos-caminhao'],
    queryFn: async (): Promise<TipoCaminhao[]> => {
      const { data, error } = await (supabase as any)
        .from('frete_tipos_caminhao')
        .select('*')
        .eq('ativo', true)
        .order('ordem', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TipoCaminhao[];
    },
    staleTime: 60_000 * 10, // 10 min - dados quase estaticos
  });
}

// ─────────────────────────────────────────────────────────────
// Modelo Branorte (planilha real Z:/1 - Comercial/4 - Logistica)
// ─────────────────────────────────────────────────────────────

export type ModeloBranorte = {
  id: number;
  tipo_caminhao: 'TRUCK' | 'CARRETA';
  modo_carga: 'fracionada_2p' | 'fracionada_4p' | 'completa';
  rs_por_km: number;
  comprimento_util_m: number;
  observacao: string | null;
};

export function useModeloBranorte() {
  return useQuery({
    queryKey: ['frete-modelo-branorte'],
    queryFn: async (): Promise<ModeloBranorte[]> => {
      const { data, error } = await (supabase as any)
        .from('frete_modelo_branorte')
        .select('*')
        .order('tipo_caminhao')
        .order('rs_por_km');
      if (error) throw error;
      return (data ?? []) as ModeloBranorte[];
    },
    staleTime: 60_000 * 10,
  });
}

// ─────────────────────────────────────────────────────────────
// Tabela ANTT vigente
// ─────────────────────────────────────────────────────────────

export function useAnttVigente() {
  return useQuery({
    queryKey: ['frete-antt-vigente'],
    queryFn: async (): Promise<AnttTabela[]> => {
      // Resolucao com vigencia_fim null = vigente
      const { data, error } = await (supabase as any)
        .from('frete_antt_tabela')
        .select('*')
        .is('vigencia_fim', null);
      if (error) throw error;
      return (data ?? []) as AnttTabela[];
    },
    staleTime: 60_000 * 60, // 1h
  });
}

// ─────────────────────────────────────────────────────────────
// Transportadoras parceiras
// ─────────────────────────────────────────────────────────────

export function useTransportadoras() {
  return useQuery({
    queryKey: ['frete-transportadoras'],
    queryFn: async (): Promise<TransportadoraParceira[]> => {
      const { data, error } = await (supabase as any)
        .from('frete_transportadoras_parceiras')
        .select('*')
        .order('nome', { ascending: true });
      if (error) throw error;
      return (data ?? []) as TransportadoraParceira[];
    },
    staleTime: 30_000,
  });
}

export function useUpsertTransportadora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (t: Partial<TransportadoraParceira> & { id?: number }) => {
      const payload: any = { ...t, updated_at: new Date().toISOString() };
      if (payload.id) {
        const { error } = await (supabase as any)
          .from('frete_transportadoras_parceiras')
          .update(payload)
          .eq('id', payload.id);
        if (error) throw error;
      } else {
        delete payload.id;
        const { error } = await (supabase as any)
          .from('frete_transportadoras_parceiras')
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['frete-transportadoras'] }),
  });
}

export function useDeleteTransportadora() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: number) => {
      const { error } = await (supabase as any)
        .from('frete_transportadoras_parceiras')
        .update({ ativo: false })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['frete-transportadoras'] }),
  });
}

// ─────────────────────────────────────────────────────────────
// Cotacoes - historico + salvar
// ─────────────────────────────────────────────────────────────

export type CotacaoSalva = {
  id: string;
  criado_em: string;
  vendedor_id: string | null;
  cliente_nome: string | null;
  cep_destino: string | null;
  cidade_destino: string | null;
  uf_destino: string | null;
  distancia_km: number | null;
  tempo_viagem_horas: number | null;
  metodo_entrada: 'equipamento' | 'dimensoes' | 'pallets';
  peso_total_kg: number | null;
  comprimento_m: number | null;
  largura_m: number | null;
  altura_m: number | null;
  volume_m3: number | null;
  carga_indivisivel: boolean;
  equipamentos_itens: unknown;
  caminhao_recomendado_id: number | null;
  valor_antt_minimo: number | null;
  valor_parceira_escolhida_id: number | null;
  valor_parceira_escolhida: number | null;
  valor_historico_medio: number | null;
  margem_aplicada: number | null;
  valor_final: number | null;
  observacoes: string | null;
};

export function useCotacoes(filtros?: {
  uf?: string;
  caminhao_id?: number;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['frete-cotacoes', filtros ?? {}],
    queryFn: async (): Promise<CotacaoSalva[]> => {
      let q = (supabase as any)
        .from('frete_cotacoes')
        .select('*')
        .order('criado_em', { ascending: false })
        .limit(filtros?.limit ?? 50);
      if (filtros?.uf) q = q.eq('uf_destino', filtros.uf);
      if (filtros?.caminhao_id) q = q.eq('caminhao_recomendado_id', filtros.caminhao_id);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as CotacaoSalva[];
    },
  });
}

export function useSalvarCotacao() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (c: Omit<CotacaoSalva, 'id' | 'criado_em' | 'vendedor_id'>) => {
      const { data: { user } } = await supabase.auth.getUser();
      const payload: any = { ...c, vendedor_id: user?.id };
      const { data, error } = await (supabase as any)
        .from('frete_cotacoes')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return data as CotacaoSalva;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['frete-cotacoes'] }),
  });
}

/**
 * Busca cotacoes similares pra calcular media historica.
 * Criterio: mesmo caminhao, mesma UF, distancia +/- 20%.
 * Retorna mediana de `valor_final` (mais robusto a outliers).
 * Retorna null se menos de 3 cotacoes similares (amostra pequena).
 */
export function useMediaHistorica(
  caminhao_id: number | null,
  uf_destino: string | null,
  distancia_km: number | null,
) {
  return useQuery({
    queryKey: ['frete-media-historica', caminhao_id, uf_destino, distancia_km],
    queryFn: async (): Promise<number | null> => {
      if (!caminhao_id || !uf_destino || !distancia_km) return null;
      const distMin = distancia_km * 0.8;
      const distMax = distancia_km * 1.2;
      const { data, error } = await (supabase as any)
        .from('frete_cotacoes')
        .select('valor_final')
        .eq('caminhao_recomendado_id', caminhao_id)
        .eq('uf_destino', uf_destino)
        .gte('distancia_km', distMin)
        .lte('distancia_km', distMax)
        .not('valor_final', 'is', null);
      if (error) throw error;
      const valores = (data ?? [])
        .map((r: any) => Number(r.valor_final))
        .filter((v: number) => Number.isFinite(v) && v > 0);
      if (valores.length < 3) return null;
      const sorted = [...valores].sort((a, b) => a - b);
      const meio = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[meio - 1] + sorted[meio]) / 2
        : sorted[meio];
    },
    enabled: !!(caminhao_id && uf_destino && distancia_km),
  });
}

// ─────────────────────────────────────────────────────────────
// Catalogo de equipamentos com peso/dim (pra aba "Por equipamento")
// ─────────────────────────────────────────────────────────────

export type ItemCatalogoComPeso = {
  id: number;
  nome_curto: string;
  categoria: string;
  peso_kg: number | null;
  dim_comprimento_m: number | null;
  dim_largura_m: number | null;
  dim_altura_m: number | null;
  indivisivel: boolean;
};

/**
 * Categorias que aparecem no seletor de equipamento da cotacao de frete.
 * FABRICAS (Compactas) + equipamentos avulsos QUE TEM MEDIDA cadastrada.
 * Exclui de proposito: ELEVADOR (de caneca) e TRANSPORTADOR (helicoidal),
 * que tem peso mas NAO tem dimensoes no catalogo — pra esses usar "Por dimensoes".
 */
export const CATEGORIAS_FRETE = [
  'COMPACTA',
  'MISTURADOR',
  'MOINHO',
  'PRE_LIMPEZA',
  'CACAMBA_PESAGEM',
  'ENSACADEIRA',
  'SUPORTE_BAG',
  'ESTEIRA',
  'MOEGA',
] as const;

/**
 * Catalogo do seletor de frete: fabricas Compactas + avulsos com medida.
 * Exige `dim_comprimento_m` nao-nulo — so entra o que tem C x L x A real,
 * porque o frete depende da dimensao (nao adianta ter so o peso).
 */
export function useCatalogoFabricas() {
  return useQuery({
    queryKey: ['frete-catalogo-fabricas'],
    queryFn: async (): Promise<ItemCatalogoComPeso[]> => {
      const { data, error } = await (supabase as any)
        .from('catalogo_items')
        .select('id, nome_curto, categoria, peso_kg, dim_comprimento_m, dim_largura_m, dim_altura_m, indivisivel')
        .in('categoria', CATEGORIAS_FRETE as unknown as string[])
        .not('dim_comprimento_m', 'is', null)
        .order('nome_curto', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ItemCatalogoComPeso[];
    },
    staleTime: 60_000 * 10,
  });
}

/** Catalogo amplo (compat - mantido caso outras telas usem). */
export function useCatalogoComPeso() {
  return useQuery({
    queryKey: ['frete-catalogo-com-peso'],
    queryFn: async (): Promise<ItemCatalogoComPeso[]> => {
      const { data, error } = await (supabase as any)
        .from('catalogo_items')
        .select('id, nome_curto, categoria, peso_kg, dim_comprimento_m, dim_largura_m, dim_altura_m, indivisivel')
        .eq('is_oficial', true)
        .not('peso_kg', 'is', null)
        .order('nome_curto', { ascending: true });
      if (error) throw error;
      return (data ?? []) as ItemCatalogoComPeso[];
    },
    staleTime: 60_000 * 10,
  });
}
