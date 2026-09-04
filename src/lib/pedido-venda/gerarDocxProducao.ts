// Gera um DOCX "SEM PREÇO" pra produção a partir das linhas de texto extraídas
// do PDF do orçamento (pdf.js). É o fallback local quando a conversão fiel
// PDF→DOCX do CRM (ConvertAPI) não está disponível — ex.: sem créditos.
//
// Contrato duro: produção nunca vê preço. Valores R$ > 0 são removidos e o
// GATE de verificação é deliberadamente MAIS paranoico que o scrub — formatos
// que o scrub não conhece derrubam o documento (retorna null e o pedido segue
// só com dados estruturados). Falso positivo custa "sem documento"; vazamento
// custa o contrato. "R$ 0,00" fica (não revela margem).
import { Document, Packer, Paragraph, TextRun } from "docx";

// "R " opcional entre R e $ (pdf.js às vezes separa); dígitos corridos (1234,56)
// e milhar com ponto/NBSP/espaço. Preferimos remover DEMAIS (pode comer um nº
// de spec colado no preço) a remover de menos — vazamento é pior que fidelidade.
const MONEY_RX = /R\s?\$\s*\d+(?:[.\s]\d{3})*(?:,\d{1,2})?/g;

const KW_DINHEIRO = /TOTAL|VALOR|PRE[ÇC]O|UNIT|SUBTOTAL|DESCONTO|ENTRADA|PARCELA|SALDO|PAGAMENTO|BOLETO/i;

// ——— Dados do cliente: produção só pode ver NOME, CIDADE e ESTADO ———
// Segmentos rotulados proibidos (do rótulo até o próximo rótulo conhecido ou fim
// da linha) + padrões diretos de CPF/CNPJ/fone/CEP onde quer que apareçam.
// A/C é PERMITIDO (aos cuidados — regra 2026-07-14/21: produção vê CLIENTE, A/C,
// CIDADE, Nº e DATA); saiu dos proibidos e entrou como fronteira em LABELS_TODOS.
const LABELS_PROIBIDOS =
  "FONE|TELEFONE|CELULAR|WHATSAPP|ENDERE[ÇC]O|BAIRRO|CEP|CPF\\s*\\/?\\s*CNPJ|CPF|CNPJ|INSCRI[ÇC][ÃA]O\\s+ESTADUAL|E-?MAIL";
const LABELS_TODOS = `CLIENTE|CIDADE|ESTADO|UF|DATA|OR[ÇC]AMENTO|A\\s*\\/\\s*C|${LABELS_PROIBIDOS}`;
const SEG_PROIBIDO_RX = new RegExp(
  `\\b(?:${LABELS_PROIBIDOS})\\s*:[^]*?(?=\\b(?:${LABELS_TODOS})\\s*:|$)`,
  "gi"
);
const PII_RX: RegExp[] = [
  /\d{3}\.\d{3}\.\d{3}\s?-\s?\d{2}/g, // CPF
  /\d{2}\.\d{3}\.\d{3}\s?\/\s?\d{4}\s?-?\s?\d{2}/g, // CNPJ
  /\(\d{2}\)\s?\d{4,5}[-.\s]?\d{4}\b/g, // telefone (xx) xxxxx-xxxx
  /\b\d{2}\s\d{4,5}[-\s]\d{4}\b/g, // telefone xx xxxxx-xxxx
  /\b\d{5}-\d{3}\b/g, // CEP
];

export function redigirDadosCliente(l: string): string {
  let out = l.replace(SEG_PROIBIDO_RX, "");
  for (const rx of PII_RX) out = out.replace(new RegExp(rx.source, "g"), "");
  // O sanitizador do App2 (processar-docx) corta linhas com o rótulo CIDADE;
  // re-rotula pra "Destino:" pra cidade/estado — permitidos — sobreviverem lá.
  out = out.replace(/\bCIDADE\s*:/gi, "Destino:");
  return out;
}

/** Gate anti-vazamento. Independente do scrub de propósito. */
export function textoVazaPreco(l: string): boolean {
  // dados pessoais: CPF/CNPJ nunca podem sobrar (formatado ou rótulo com dígitos)
  if (/\d{3}\.\d{3}\.\d{3}\s?-\s?\d{2}/.test(l)) return true;
  if (/\d{2}\.\d{3}\.\d{3}\s?\/\s?\d{4}/.test(l)) return true;
  if (/\bCPF\b|\bCNPJ\b/i.test(l) && /\d/.test(l)) return true;
  // R$ seguido de dígitos com algum 1-9 (mesmo com lixo no meio)
  const rs = l.match(/R\s?\$[^0-9A-Za-z]{0,6}([\d.,\s]*)/);
  if (rs && /[1-9]/.test(rs[1] ?? "")) return true;
  // decimal com milhar agrupado SEM R$ (ex.: "Total: 57.639,00")
  const dec = l.match(/\d{1,3}(?:[.\s]\d{3})+,\d{2}/);
  if (dec && /[1-9]/.test(dec[0])) return true;
  // decimal órfão (ex.: "4,56" que sobrou de remoção parcial) em linha de dinheiro
  if (KW_DINHEIRO.test(l) && /\d*[1-9]\d*,\d{2}\b/.test(l)) return true;
  // linha/parágrafo terminando em R$ → preço provavelmente na linha seguinte
  if (/R\s?\$\s*[.:]?\s*$/.test(l)) return true;
  // valor por extenso em linha de dinheiro
  if (KW_DINHEIRO.test(l) && /\breais\b/i.test(l)) return true;
  return false;
}

export function scrubLinhas(linhas: string[]): {
  linhas: string[];
  removidos: number;
  vazou: boolean;
} {
  let removidos = 0;
  const out = linhas.map((l) =>
    redigirDadosCliente(l)
      .replace(MONEY_RX, (v) => {
        if (/[1-9]/.test(v)) {
          removidos++;
          return "";
        }
        return v; // R$ 0,00 fica (não revela margem)
      })
      .replace(/\s{2,}/g, " ")
      .trimEnd()
  );
  const vazou = out.some(textoVazaPreco);
  return { linhas: out, removidos, vazou };
}

export async function gerarDocxProducaoDeLinhas(
  linhas: string[],
  nomePdf: string
): Promise<File | null> {
  const { linhas: limpas, vazou } = scrubLinhas(linhas);
  if (vazou) return null;
  if (!limpas.some((l) => l.trim())) return null;

  const doc = new Document({
    sections: [
      {
        children: [
          new Paragraph({
            children: [
              new TextRun({
                text: "ORÇAMENTO PARA PRODUÇÃO — SEM PREÇOS",
                bold: true,
                size: 28,
              }),
            ],
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: `Origem: ${nomePdf} (texto extraído do PDF)`,
                italics: true,
                size: 18,
              }),
            ],
          }),
          new Paragraph({ text: "" }),
          ...limpas
            .filter((l) => l.trim())
            .map(
              (l) =>
                new Paragraph({
                  children: [new TextRun({ text: l, size: 20 })],
                })
            ),
        ],
      },
    ],
  });

  const blob = await Packer.toBlob(doc);
  const nome = nomePdf.replace(/\.pdf$/i, "") + " - SEM PRECO.docx";
  return new File([blob], nome, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}
