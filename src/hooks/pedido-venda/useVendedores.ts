import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/controle-supabase/client";

/**
 * Fonte única da lista de vendedores.
 *
 * Antes cada tela tinha o próprio array chumbado no código, e todos ficaram
 * defasados em graus diferentes. O sintoma clássico: LUCAS e IGOR tinham pedidos
 * no banco mas não apareciam no ranking nem no PDF do Controle de Vendas, porque
 * o relatório iterava sobre a lista fixa em vez de iterar sobre os dados.
 *
 * Para cadastrar vendedor novo: inserir em `vendedores` com ativo = true.
 * NÃO adicionar nome no fallback abaixo.
 */

/** Usado somente se a consulta à tabela `vendedores` falhar (rede/RLS). */
const FALLBACK_VENDEDORES = [
  "ALVARO",
  "DANIEL",
  "EDER",
  "EDILSON JR",
  "GUSTAVO",
  "IGOR",
  "JARDEL",
  "LUCAS",
  "PATRICK",
  "PEDRO",
  "RAMON",
];

/** Idem, para quem tem instância de WhatsApp (subconjunto do anterior). */
const FALLBACK_VENDEDORES_WHATSAPP = [
  "ALVARO",
  "DANIEL",
  "EDER",
  "EDILSON JR",
  "GUSTAVO",
  "JARDEL",
  "PEDRO",
];

export const normalizarVendedor = (nome?: string | null): string =>
  (nome || "").toUpperCase().trim();

/**
 * Nem todo vendedor tem instância de WhatsApp própria (hoje 7 dos 11 têm).
 * Telas de venda devem usar `vendedores`; telas que monitoram instância de
 * WhatsApp devem usar `vendedoresComWhatsapp`, senão listam gente que nunca
 * pode ter dado ali e o vazio parece defeito.
 */
export function useVendedores() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["vendedores-ativos"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("vendedores")
        .select("nome, wa_number, instance_token")
        .eq("ativo", true);

      if (error) throw error;

      const linhas = (data || [])
        .map((v) => ({ ...v, nome: normalizarVendedor(v.nome) }))
        .filter((v) => v.nome);

      const dedup = (nomes: string[]) => [...new Set(nomes)].sort();

      return {
        todos: dedup(linhas.map((v) => v.nome)),
        comWhatsapp: dedup(
          linhas.filter((v) => v.wa_number && v.instance_token).map((v) => v.nome)
        ),
      };
    },
  });

  return {
    /** Todos os vendedores ativos. Use em telas de venda e dropdowns de filtro. */
    vendedores: data?.todos.length ? data.todos : FALLBACK_VENDEDORES,
    /** Só quem tem instância de WhatsApp configurada. Use em telas de conversa/webhook. */
    vendedoresComWhatsapp: data?.comWhatsapp.length
      ? data.comWhatsapp
      : FALLBACK_VENDEDORES_WHATSAPP,
    isLoading,
    error,
  };
}

/**
 * Une os vendedores cadastrados com os nomes que realmente aparecem nos dados.
 *
 * Use em rankings e agregações: garante que a soma por vendedor sempre feche com
 * o total geral, mesmo que alguém tenha venda sem estar cadastrado (ex.: pedido
 * importado do CRM com vendedor que ainda não existe na tabela `vendedores`).
 */
export function mesclarVendedoresComDados(
  cadastrados: string[],
  nomesNosDados: Array<string | null | undefined>
): string[] {
  const nomes = new Set(cadastrados);
  for (const nome of nomesNosDados) {
    const normalizado = normalizarVendedor(nome);
    if (normalizado) nomes.add(normalizado);
  }
  return [...nomes].sort();
}
