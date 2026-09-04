import * as pdfjsLib from "pdfjs-dist";

// Use the bundled worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url
).toString();

/**
 * Extracts all text content from a PDF file, page by page.
 * Returns an array of lines (same format as htmlToLines from mammoth).
 */
export async function extractPdfLines(file: File): Promise<string[]> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const allLines: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    
    // Group text items by Y position to reconstruct lines
    const itemsByY = new Map<number, string[]>();
    for (const item of content.items) {
      if (!("str" in item)) continue;
      const y = Math.round((item as any).transform[5]);
      if (!itemsByY.has(y)) itemsByY.set(y, []);
      itemsByY.get(y)!.push((item as any).str);
    }

    // Sort by Y (descending = top to bottom in PDF coords)
    const sortedYs = Array.from(itemsByY.keys()).sort((a, b) => b - a);
    for (const y of sortedYs) {
      const line = itemsByY.get(y)!.join(" ").replace(/\s+/g, " ").trim();
      if (line) allLines.push(line);
    }
  }

  return allLines;
}
