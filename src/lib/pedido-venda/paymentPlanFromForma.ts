/**
 * Deriva um plano de pagamento (parcelas) a partir do texto livre da
 * "Forma de pagamento" extraída do orçamento Word.
 *
 * Regras de negócio (decididas com o usuário):
 *  - "a combinar" / texto não estruturado  -> retorna null (deixa as Condições de Pagamento vazias).
 *  - "forma padrão"                          -> preset da empresa (4x: 25/25/25/25).
 *  - "à vista" / "PIX"                        -> 1 parcela única (100%) no pedido.
 *  - "entrada R$ X ... restante na emissão"   -> 2 parcelas (entrada + saldo).
 *  - "R$ X (colocar em produção/entrada)"     -> 2 parcelas (entrada + saldo) quando X < total.
 *
 * As descrições usam exatamente as opções do <Select> do PaymentPlanEditor
 * ("No pedido", "Na emissão da nota", "N dias após a emissão"/"... o pedido")
 * para que apareçam selecionadas na tabela.
 *
 * Os valores são sempre do tipo "fixo" e a última parcela absorve o
 * arredondamento, garantindo que a soma seja EXATAMENTE igual ao total.
 */

export type MetodoPagamento =
  | "PIX"
  | "Boleto"
  | "Cartão de Crédito"
  | "A combinar com cliente"
  | "Outro";

export interface ParcelaDerivada {
  n: number;
  descricao: string;
  metodo: MetodoPagamento;
  vencimento: "hoje" | "emissao_nf" | "+30" | "+60" | "+90" | "custom";
  // Vencimento: No pedido / Após o pedido (dias) / Na emissão da nota / Após a emissão da nota (dias) / Data fixa
  dataTipo?: "no_pedido" | "apos_pedido" | "na_nf" | "apos_nf" | "data_fixa";
  dias?: number; // quando dataTipo === "apos_nf" ou "apos_pedido"
  data: string; // YYYY-MM-DD
  valor: { tipo: "fixo"; fixo: number };
}

export interface PlanoDerivado {
  modo: "padrao_empresa" | "custom";
  observacao: string;
  moeda: "BRL";
  total: number;
  parcelas: ParcelaDerivada[];
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Remove acentos e baixa caixa para facilitar o casamento de padrões. */
function normalizar(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Extrai o primeiro valor monetário "de verdade" (com milhar ou centavos). Evita pegar "5%" ou "160". */
function primeiroValorBRL(s: string): number | null {
  const m = s.match(/(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+,\d{2})/);
  if (!m) return null;
  const raw = m[1].replace(/\./g, "").replace(",", ".");
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** Ajusta os valores fixos para que a soma feche exatamente no total (última parcela absorve a diferença). */
function fecharSoma(parcelas: ParcelaDerivada[], total: number): ParcelaDerivada[] {
  if (parcelas.length === 0) return parcelas;
  const somaMenosUltima = parcelas
    .slice(0, -1)
    .reduce((acc, p) => acc + (p.valor.fixo || 0), 0);
  const ultima = parcelas[parcelas.length - 1];
  ultima.valor.fixo = round2(total - somaMenosUltima);
  return parcelas;
}

/**
 * @param forma       texto de "Forma de pagamento" extraído do orçamento
 * @param total       valor total (já com desconto, quando houver)
 * @param dataVenda   base para "no pedido"/"N dias após o pedido"
 * @param dataEntrega base para "na emissão"/"N dias após a emissão"
 */
export function derivePaymentPlanFromForma(
  forma: string | null | undefined,
  total: number,
  dataVenda?: Date,
  dataEntrega?: Date
): PlanoDerivado | null {
  const original = (forma || "").trim();
  if (!original || !Number.isFinite(total) || total <= 0) return null;

  const norm = normalizar(original);
  const baseVenda = dataVenda || new Date();
  const baseEmissao = dataEntrega || dataVenda || new Date();

  const plano = (parcelas: ParcelaDerivada[], modo: PlanoDerivado["modo"] = "custom", obs = ""): PlanoDerivado => ({
    modo,
    observacao: obs,
    moeda: "BRL",
    total: round2(total),
    parcelas: fecharSoma(parcelas, total),
  });

  // 1) "a combinar" / texto não estruturado -> deixa vazio
  const temEntrada = /\bentrada\b|colocar em produc|sinal\b/.test(norm);
  const temVista = /\ba vista\b|\bavista\b|^vista\b|\bvista\b|\bpix\b/.test(norm);
  const ehPadrao = /forma padrao|padrao da empresa|^padrao\b/.test(norm);
  if (/combinar/.test(norm) && !temEntrada && !temVista && !ehPadrao) {
    return null;
  }

  // 2) Forma padrão da empresa -> 4x (25/25/25/25)
  if (ehPadrao) {
    const q = round2(total * 0.25);
    const parcelas: ParcelaDerivada[] = [
      { n: 1, descricao: "No pedido", dataTipo: "no_pedido", metodo: "PIX", vencimento: "hoje", data: toISO(baseVenda), valor: { tipo: "fixo", fixo: q } },
      { n: 2, descricao: "Na emissão da nota", dataTipo: "na_nf", metodo: "PIX", vencimento: "emissao_nf", data: toISO(baseEmissao), valor: { tipo: "fixo", fixo: q } },
      { n: 3, descricao: "Após a emissão da nota (30 dias)", dataTipo: "apos_nf", dias: 30, metodo: "Boleto", vencimento: "+30", data: toISO(addDays(baseEmissao, 30)), valor: { tipo: "fixo", fixo: q } },
      { n: 4, descricao: "Após a emissão da nota (60 dias)", dataTipo: "apos_nf", dias: 60, metodo: "Boleto", vencimento: "+60", data: toISO(addDays(baseEmissao, 60)), valor: { tipo: "fixo", fixo: q } },
    ];
    return plano(parcelas, "padrao_empresa");
  }

  const valorMencionado = primeiroValorBRL(original);

  // 3) Entrada (+ restante) — quando há valor de entrada explícito menor que o total
  if ((temEntrada || valorMencionado !== null) && valorMencionado !== null && valorMencionado < total - 0.01 && valorMencionado > 0) {
    const entrada = round2(valorMencionado);
    const saldoNaEmissao = /emissao|nota|nf\b/.test(norm);
    const diasMatch = norm.match(/(\d+)\s*dias/);

    const parcela2: ParcelaDerivada = saldoNaEmissao
      ? { n: 2, descricao: "Na emissão da nota", dataTipo: "na_nf", metodo: "PIX", vencimento: "emissao_nf", data: toISO(baseEmissao), valor: { tipo: "fixo", fixo: round2(total - entrada) } }
      : diasMatch
        ? { n: 2, descricao: "Data fixa", dataTipo: "data_fixa", metodo: "Boleto", vencimento: "custom", data: toISO(addDays(baseVenda, parseInt(diasMatch[1], 10))), valor: { tipo: "fixo", fixo: round2(total - entrada) } }
        : { n: 2, descricao: "Na emissão da nota", dataTipo: "na_nf", metodo: "PIX", vencimento: "emissao_nf", data: toISO(baseEmissao), valor: { tipo: "fixo", fixo: round2(total - entrada) } };

    const parcelas: ParcelaDerivada[] = [
      { n: 1, descricao: "No pedido", dataTipo: "no_pedido", metodo: "PIX", vencimento: "hoje", data: toISO(baseVenda), valor: { tipo: "fixo", fixo: entrada } },
      parcela2,
    ];
    return plano(parcelas);
  }

  // 4) À vista / PIX -> parcela única (100%) no pedido
  if (temVista) {
    const parcelas: ParcelaDerivada[] = [
      { n: 1, descricao: "No pedido", dataTipo: "no_pedido", metodo: "PIX", vencimento: "hoje", data: toISO(baseVenda), valor: { tipo: "fixo", fixo: round2(total) } },
    ];
    // mantém nota original (ex: "À vista (PIX) com 5% de desconto")
    return plano(parcelas, "custom", original.length <= 80 ? original : "");
  }

  // 5) "Na emissão da nota" (sem entrada/à vista) -> parcela única na emissão
  if (/emissao|nota fiscal|na nf\b/.test(norm)) {
    const parcelas: ParcelaDerivada[] = [
      { n: 1, descricao: "Na emissão da nota", dataTipo: "na_nf", metodo: "PIX", vencimento: "emissao_nf", data: toISO(baseEmissao), valor: { tipo: "fixo", fixo: round2(total) } },
    ];
    return plano(parcelas);
  }

  // 6) Não foi possível estruturar com segurança -> deixa vazio (melhor que adivinhar errado)
  return null;
}

/**
 * Finaliza um plano de parcelas JÁ ESTRUTURADO (vindo da tabela do orçamento —
 * extractPaymentPlanFromLines), preenchendo a DATA de cada parcela a partir do dataTipo
 * (o parser só sabe o tipo, não tem as datas-base) e fechando a soma no total do pedido.
 * Sem isso, a validação do PedidoForm barra o submit (exige data e soma == total).
 */
export function finalizarPlanoImportado(
  plano: { parcelas: any[]; [k: string]: any } | null | undefined,
  total: number,
  dataVenda?: Date,
  dataEntrega?: Date
): PlanoDerivado | null {
  if (!plano || !Array.isArray(plano.parcelas) || plano.parcelas.length === 0) return null;
  if (!Number.isFinite(total) || total <= 0) return null;
  const baseVenda = dataVenda || new Date();
  const baseEmissao = dataEntrega || dataVenda || new Date();
  const parseBr = (s?: string): Date | null => {
    const m = (s || "").match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    return m ? new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : null;
  };
  const parcelas: ParcelaDerivada[] = plano.parcelas.map((p: any, idx: number) => {
    let data: string = p.data || "";
    if (!data) {
      switch (p.dataTipo) {
        case "no_pedido": data = toISO(baseVenda); break;
        case "apos_pedido": data = toISO(addDays(baseVenda, p.dias || 0)); break;
        case "na_nf": data = toISO(baseEmissao); break;
        case "apos_nf": data = toISO(addDays(baseEmissao, p.dias || 0)); break;
        case "data_fixa": { const d = parseBr(p.dataFixa); data = toISO(d || baseVenda); break; }
        default: data = toISO(baseVenda);
      }
    }
    const fixo = Number(p?.valor?.fixo ?? p?.valor ?? 0);
    return {
      n: idx + 1,
      descricao: p.descricao || "Parcela",
      metodo: (p.metodo || "PIX") as MetodoPagamento,
      vencimento: (p.vencimento || "custom") as ParcelaDerivada["vencimento"],
      dataTipo: p.dataTipo,
      dias: p.dias,
      data,
      valor: { tipo: "fixo", fixo: round2(fixo) },
    } as ParcelaDerivada;
  });
  return {
    modo: "custom",
    observacao: "",
    moeda: "BRL",
    total: round2(total),
    parcelas: fecharSoma(parcelas, total),
  };
}
