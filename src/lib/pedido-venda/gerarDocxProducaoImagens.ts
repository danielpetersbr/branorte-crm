// Gera um DOCX "SEM PREÇO" pra produção RASTERIZANDO as páginas do PDF do
// orçamento (mantém imagens + layout, igual ao original) e tapando os preços
// com faixa branca — em vez do dump de texto do gerarDocxProducao.ts.
//
// Portado do sanitizador do card (controle-de-producao: src/lib/sanitize-pdf.ts),
// mas a saída é DOCX (uma imagem por página) pra passar pelo pipeline atual
// (enviar-docx-app2 → processar-docx), que trata DOCX. Preço já vem apagado na
// imagem (raster remove o texto de verdade), então não depende do ConvertAPI.
//
// Contrato duro: produção nunca vê preço. Se não achar o rodapé financeiro
// (PDF escaneado/sem texto), retorna null → o chamador NÃO expõe (segue só com
// dados estruturados). 100% no browser (pdfjs-dist + docx), sem edge/ConvertAPI.
import { Document, Packer, Paragraph, ImageRun } from "docx";
import * as pdfjsLib from "pdfjs-dist";

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

// Marcadores do rodapé financeiro (normalizados). MESMOS do sanitize-pdf/docx.
const CUT_MARKERS = [
  "valor total da proposta",
  "termos da proposta",
  "data da venda",
  "nossas redes sociais",
  "dados do fabricante",
  "conta para deposito",
];

const SP = "\\s\\u00A0\\u202F\\u2009";
const AMOUNT_ANY = new RegExp(`\\d{1,3}(?:[.${SP}]\\d{3})+(?:,\\d{2})?|\\d+,\\d{2}`);
const RS_RX = /R\$/;
const PRICE_LABEL_RX =
  /\b(valor|total|subtotal|desconto|parcela|entrada|preco|pagamento|pix|a vista|sinal|no pedido|na emissao|forma de pagamento)\b/;
const CNPJ_RX = /^\d{2}\.?\d{3}\.?\d{3}\/\d{4}-?\d{2}\.?$/;
const CPF_RX = /^\d{3}\.\d{3}\.\d{3}-\d{2}$/;
const RIGHT_COL_FRAC = 0.55;
// Rótulos do cabeçalho do cliente que produção NÃO pode ver (faixa do rótulo pra
// direita). Produção vê CLIENTE (nome), A/C, Nº do orçamento, DATA e CIDADE-UF
// (destino da entrega — decisão do Daniel 2026-07-21; cidade/municipio saíram da lista).
const PII_LABEL_RX = /^(fone|telefone|celular|whatsapp|bairro|endereco|cep|cpf|cnpj|inscricao|i\.?e\.?|e-?mail)\b/;

function norm(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

interface Box { x: number; y: number; w: number; h: number }
interface Item { s: string; x: number; y: number; w: number; h: number }
interface TextItemLite { str?: string; transform: number[]; width?: number; height?: number }

function groupLines(items: Item[]): Array<{ y: number; items: Item[] }> {
  const lines: Array<{ y: number; items: Item[] }> = [];
  for (const it of [...items].sort((a, b) => b.y - a.y)) {
    let ln = lines.find((l) => Math.abs(l.y - it.y) <= 3);
    if (!ln) { ln = { y: it.y, items: [] }; lines.push(ln); }
    ln.items.push(it);
  }
  for (const l of lines) l.items.sort((a, b) => a.x - b.x);
  return lines;
}

function canvasToJpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (b) => {
        if (!b) return reject(new Error("canvas.toBlob falhou"));
        resolve(new Uint8Array(await b.arrayBuffer()));
      },
      "image/jpeg",
      0.85
    );
  });
}

/** Gera DOCX SEM PREÇO (páginas rasterizadas) a partir de um PDF de orçamento.
 *  Retorna null se não achar o rodapé financeiro (PDF escaneado) — caller NÃO expõe. */
export async function gerarDocxProducaoDePaginas(file: File): Promise<File | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const loadingTask = pdfjsLib.getDocument({ data: bytes.slice(0) });
  const pdf = await loadingTask.promise;

  try {
    // PASSO 1: página do corte + Y do corte (marcador mais alto da 1ª página com marcador).
    // ⚠️ Comparar por LINHA agrupada, não por item: o pdf.js fragmenta o texto em
    // pedaços ("VALOR TOTAL" + " DA PROPOSTA" + ...) e nos PDFs novos (jul/2026)
    // nenhum fragmento isolado contém o marcador inteiro → cutPage nunca achava
    // e o rasterizador devolvia null (pedido caía no fallback de texto/sem doc).
    let cutPage = -1, cutY = -1;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const tc = await page.getTextContent();
      const items: Item[] = (tc.items as TextItemLite[])
        .map((it) => ({ s: it.str ?? "", x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || 10 }))
        .filter((it) => it.s.trim());
      let topMarkerY = -1;
      for (const ln of groupLines(items)) {
        const nLine = norm(ln.items.map((i) => i.s).join(" ")).replace(/\s+/g, " ");
        if (CUT_MARKERS.some((m) => nLine.includes(m))) {
          const y = Math.max(...ln.items.map((i) => i.y));
          if (y > topMarkerY) topMarkerY = y;
        }
      }
      if (topMarkerY >= 0) { cutPage = p; cutY = topMarkerY; break; }
    }
    if (cutPage === -1) return null; // sem rodapé financeiro → não expõe

    // PASSO 2: faixas de redação por linha nas páginas mantidas.
    const redactByPage = new Map<number, Box[]>();
    for (let p = 1; p <= cutPage; p++) {
      const page = await pdf.getPage(p);
      const pw = page.getViewport({ scale: 1, rotation: 0 }).width;
      const tc = await page.getTextContent();
      const items: Item[] = (tc.items as TextItemLite[])
        .map((it) => ({ s: it.str ?? "", x: it.transform[4], y: it.transform[5], w: it.width || 0, h: it.height || 10 }))
        .filter((it) => it.s.trim());
      const boxes: Box[] = [];

      for (const ln of groupLines(items)) {
        const nLine = norm(ln.items.map((i) => i.s).join(" "));
        const hasRS = ln.items.some((i) => RS_RX.test(i.s));
        const hasLabel = PRICE_LABEL_RX.test(nLine);
        const amountItems = ln.items.filter((i) => AMOUNT_ANY.test(i.s));

        let bandX: number | null = null;
        if (hasRS) {
          bandX = Math.min(...ln.items.filter((i) => RS_RX.test(i.s)).map((i) => i.x));
          for (const a of amountItems) if (a.x < bandX) bandX = a.x;
        } else if (amountItems.length && (hasLabel || amountItems.some((i) => i.x > pw * RIGHT_COL_FRAC))) {
          bandX = Math.min(...amountItems.map((i) => i.x));
        }

        if (bandX != null) {
          const top = Math.max(...ln.items.map((i) => i.y + i.h));
          const bot = Math.min(...ln.items.map((i) => i.y));
          boxes.push({ x: bandX - 3, y: bot - 3, w: pw - (bandX - 3) + 3, h: top - bot + 6 });
        }

        for (const i of ln.items) {
          const t = i.s.trim();
          if (CNPJ_RX.test(t) || CPF_RX.test(t)) {
            boxes.push({ x: i.x - 2, y: i.y - 2, w: (i.w || t.length * i.h * 0.5) + 4, h: i.h + 4 });
          }
        }

        // Cabeçalho do cliente: FONE/TELEFONE/BAIRRO/ENDEREÇO/CEP/CPF/CNPJ/IE/EMAIL/
        // CIDADE — redige do rótulo pra direita (mantém CLIENTE, A/C, Nº e DATA).
        const piiItem = ln.items.find((i) => PII_LABEL_RX.test(norm(i.s.trim())));
        if (piiItem) {
          const top = Math.max(...ln.items.map((i) => i.y + i.h));
          const bot = Math.min(...ln.items.map((i) => i.y));
          boxes.push({ x: piiItem.x - 3, y: bot - 3, w: pw - (piiItem.x - 3), h: top - bot + 6 });
        }
      }
      redactByPage.set(p, boxes);
    }

    // PASSO 3: rasteriza páginas 1..cutPage tapando faixas + tudo do corte pra baixo.
    const SCALE = 1.8; // resolução de render (redaction escala junto; menor = arquivo menor)
    const CUT_MARGIN = 20;
    const MAX_W = 680, MAX_H = 920; // px de exibição no DOCX (fit em página Letter, margem 0.25")
    const paras: Paragraph[] = [];

    for (let p = 1; p <= cutPage; p++) {
      const page = await pdf.getPage(p);
      const phPts = page.getViewport({ scale: 1, rotation: 0 }).height;
      const pwPts = page.getViewport({ scale: 1, rotation: 0 }).width;
      const vp = page.getViewport({ scale: SCALE, rotation: 0 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(vp.width);
      canvas.height = Math.ceil(vp.height);
      const ctx = canvas.getContext("2d")!;
      await page.render({ canvasContext: ctx, viewport: vp, canvas } as unknown as Parameters<typeof page.render>[0]).promise;

      ctx.fillStyle = "#ffffff";
      for (const r of redactByPage.get(p) ?? []) {
        const topPx = (phPts - (r.y + r.h)) * SCALE;
        ctx.fillRect(r.x * SCALE, topPx, r.w * SCALE, r.h * SCALE);
      }
      if (p === cutPage) {
        const topPx = Math.max(0, (phPts - (cutY + CUT_MARGIN)) * SCALE);
        ctx.fillRect(0, topPx, canvas.width, canvas.height - topPx);
      }

      const jpeg = await canvasToJpegBytes(canvas);
      // dimensiona pra caber na página do Word mantendo a proporção
      let w = MAX_W, h = MAX_W * (phPts / pwPts);
      if (h > MAX_H) { h = MAX_H; w = MAX_H * (pwPts / phPts); }
      paras.push(new Paragraph({
        pageBreakBefore: p > 1,
        children: [new ImageRun({ type: "jpg", data: jpeg, transformation: { width: Math.round(w), height: Math.round(h) } })],
      }));
    }

    const doc = new Document({
      sections: [{
        properties: { page: { margin: { top: 360, bottom: 360, left: 360, right: 360 } } },
        children: paras,
      }],
    });
    const blob = await Packer.toBlob(doc);
    const nome = file.name.replace(/\.pdf$/i, "") + " - SEM PRECO.docx";
    return new File([blob], nome, {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    });
  } finally {
    await loadingTask.destroy();
  }
}
