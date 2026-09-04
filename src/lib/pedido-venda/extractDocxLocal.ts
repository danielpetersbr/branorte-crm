import mammoth from "mammoth";

interface EquipamentoDetalhado {
  descricao: string;
  unidade: string;
  quantidade: number;
  valor: number;
}

interface MotorItem {
  modelo: string;
  quantidade: number;
}

export interface LocalExtractionResult {
  cliente: string | null;
  atencao_a: string | null;
  telefone: string | null;
  email: string | null;
  cidade: string | null;
  estado: string | null;
  endereco: string | null;
  bairro: string | null;
  cpf_cnpj: string | null;
  cep: string | null;
  fantasia: string | null;
  inscricao_estadual: string | null;
  equipamentos: string[];
  equipamentos_detalhados: EquipamentoDetalhado[];
  motores: MotorItem[];
  numero_orcamento: string | null;
  valor_total: number | null;
  valor_total_com_desconto: number | null;
  tensao: string | null;
  voltagem: string | null;
  forma_pagamento: string | null;
  descricao_equipamento: string | null;
  observacoes: string[];
  observacoes_orcamento: string;
  total_equipamentos: number;
  motores_quantidade_total: number;
  motores_valor_total: number | null;
  acessorios_quantidade: number | null;
  acessorios_valor: number | null;
  itens_adicionais: Array<{ descricao: string; valor: number | null }>;
  payment_plan: any | null;
  alertas: string[];
}

function htmlToLines(html: string): string[] {
  const withBreaks = html
    .replace(/<\/(p|li|h\d|tr)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<br\s*\/?>/gi, "\n");
  const text = withBreaks.replace(/<[^>]+>/g, "").replace(/\u00A0/g, " ");
  return text
    .split("\n")
    .map((s) => s.replace(/\s+\|\s+$/g, "").trim())
    .filter((s) => s.length > 0);
}

function sanitize(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Remove TODOS os espaços. Usado nos valores estruturados (email/CPF/IE) que o
// pdf.js fragmenta glifo a glifo no PDF do CRM (ex.: "agricola 2 b @ hotmail . com").
function stripSpaces(s: string): string {
  return s.replace(/\s+/g, "");
}

function parseBRL(str: string): number | null {
  const raw = str.trim().replace(/^R\$\s*/i, "").replace(/\./g, "").replace(",", ".");
  const num = Number(raw);
  return Number.isFinite(num) ? num : null;
}

function extractField(lines: string[], regex: RegExp): string | null {
  for (const ln of lines) {
    const m = ln.match(regex);
    if (m) return sanitize(m[1]);
  }
  return null;
}

// Os regexes toleram os espaços que o pdf.js insere nos rótulos do PDF do CRM
// ("CLIENTE :", "A / C :", "FONE :"). CLIENTE/A/C/FONE costumam vir na MESMA linha.
function extractCliente(lines: string[]): string | null {
  return extractField(lines, /CLIENTE\s*[:\-–]\s*(.+?)(?:\s+A\s*\/\s*C\b|\s+FONE\b|$)/i);
}

function extractAtencaoA(lines: string[]): string | null {
  return extractField(lines, /A\s*\/\s*C\s*\.?\s*[:\-–]\s*(.+?)(?:\s+FONE\b|$)/i);
}

function extractTelefone(lines: string[]): string | null {
  return extractField(lines, /FONE\s*[:\-–]\s*(.+?)$/i);
}

function isVendorEmail(email: string): boolean {
  const lower = email.toLowerCase().trim();
  if (lower.endsWith('@mbranorte.com.br')) return true;
  if (/^vendas\d*[._]?m?branorte@gmail\.com$/.test(lower)) return true;
  if (/^mkt[._]?m?branorte@gmail\.com$/.test(lower)) return true;
  return false;
}

function extractEmail(lines: string[]): string | null {
  for (const ln of lines) {
    // "E - MAIL" no PDF; email fragmentado ("agricola 2 b @ hotmail . com") → tira os espaços.
    if (/E\s*-?\s*MAIL\s*[:\-–]/i.test(ln)) {
      const m = ln.match(/E\s*-?\s*MAIL\s*[:\-–]\s*(.+)$/i);
      if (m) {
        const email = stripSpaces(m[1].split("|")[0]);
        if (email.includes("@") && !isVendorEmail(email)) return email;
        if (email.includes("@")) console.log('E-mail de vendedor ignorado:', email);
      }
    }
  }
  return null;
}

function extractCidade(lines: string[]): string | null {
  for (const ln of lines) {
    const m = ln.match(/CIDADE\s*[:\-–]\s*(.+)/i);
    if (m) {
      let cidade = sanitize(m[1]);
      cidade = cidade.replace(/\s*[-–]\s*[A-Z]{2}\s*$/i, "");
      cidade = cidade.replace(/\b[A-Z]{2}\s*$/i, "");
      return cidade;
    }
  }
  return null;
}

function extractEstado(lines: string[]): string | null {
  for (const ln of lines) {
    if (/CIDADE/i.test(ln)) {
      const m = ln.match(/\b([A-Z]{2})\s*$/);
      if (m) return m[1];
    }
  }
  return null;
}

function extractEndereco(lines: string[]): string | null {
  for (const ln of lines) {
    const m = ln.match(/ENDERE[ÇC]O\s*[:\-–]\s*(.+)/i);
    if (m) {
      let endereco = sanitize(m[1]);
      endereco = endereco.replace(/\s+BAIRRO\s*[:\-–].+$/i, "");
      return endereco;
    }
  }
  return null;
}

function extractBairro(lines: string[]): string | null {
  return extractField(lines, /BAIRRO\s*[:\-–]\s*(.+)/i);
}

function extractCpfCnpj(lines: string[]): string | null {
  for (const ln of lines) {
    // "CPF / CNPJ" no PDF (espaços em volta da barra).
    if (/CPF\s*\/\s*CNPJ/i.test(ln)) {
      const m = ln.match(/CPF\s*\/\s*CNPJ\s*[:\-–]\s*(.+)/i);
      if (m) {
        const valor = stripSpaces(m[1].split("|")[0]);
        if (valor.length > 5 && !/^[-–_]+$/.test(valor)) return valor;
      }
    }
  }
  return null;
}

function extractCep(lines: string[]): string | null {
  for (const ln of lines) {
    if (/CEP\s*[:\-–]/i.test(ln)) {
      const m = ln.match(/CEP\s*[:\-–]\s*(.+?)(?:\s+\||$)/i);
      if (m) {
        const valor = sanitize(m[1]);
        if (/\d{2}[.\s]?\d{3}[-\s]?\d{3}/.test(valor)) return valor;
      }
    }
  }
  return null;
}

function extractFantasia(lines: string[]): string | null {
  return extractField(lines, /FANTASIA\s*[:\-–]\s*(.+)/i);
}

function extractInscricaoEstadual(lines: string[]): string | null {
  for (const ln of lines) {
    // "I . E ." no PDF (espaços entre I, ponto e E). (?:^|\s) evita casar no meio de palavra.
    const m = ln.match(/(?:^|\s)I\s*\.?\s*E\s*\.?\s*[:\-–]\s*(.+)/i);
    if (m) {
      const valor = stripSpaces(m[1].split("|")[0]);
      if (valor.length > 3 && !/^[-–_]+$/.test(valor)) return valor;
    }
  }
  return null;
}

function extractNumeroOrcamento(lines: string[], fileName: string): string | null {
  // Try from lines
  for (const ln of lines) {
    const m = ln.match(/(?:n[ºo°]\s*\.?\s*|número do orçamento|orcamento|orçamento)\s*[:\-–]?\s*(\d{4}\s*[-–]\s*\d{3,6}|\d{6,10})/i);
    if (m) return sanitize(m[1]).replace(/\s+/g, "").replace(/[–]/g, "-");
  }
  // Try from filename (supports underscores around dash: 2023_-_0910)
  const fm = fileName.match(/(\d{4})[_\s]*[-–][_\s]*(\d{3,6})/);
  if (fm) return `${fm[1]}-${fm[2]}`;
  return null;
}

function extractEquipamentosDetalhados(lines: string[]): EquipamentoDetalhado[] {
  const equipamentos: EquipamentoDetalhado[] = [];
  const eqRegex = /^([A-Z])\s*[-–]\s*(\d{1,3})\s*[-–]\s*(.+)/i;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(eqRegex);
    if (m) {
      let quantidade = parseInt(m[2], 10);
      let fullContent = sanitize(m[3]);
      let valor = 0;

      // Try to extract value from table columns (pipe-separated)
      const parts = fullContent.split(/\s*\|\s*/);
      let descricao = parts[0].trim();

      // Search for R$ value in all parts
      for (const part of parts) {
        const valorMatch = part.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/);
        if (valorMatch) {
          valor = parseBRL(valorMatch[0]) || 0;
          break;
        }
      }

      // Also check for value directly in description if no pipe format
      if (valor === 0) {
        const valorMatch = descricao.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/);
        if (valorMatch) {
          valor = parseBRL(valorMatch[0]) || 0;
          descricao = descricao.replace(/\s*R\$\s*\d{1,3}(?:\.\d{3})*(?:,\d{2})/, "").trim();
        }
      }

      // If value still 0, look ahead up to 15 lines for a "VALOR" line with R$
      if (valor === 0) {
        for (let j = i + 1; j < Math.min(i + 15, lines.length); j++) {
          const aheadLine = lines[j];
          // Stop if we hit another equipment item or motor section
          if (eqRegex.test(aheadLine)) break;
          if (/MOTOR(?:ES)?\s*(?:TRIF|MONOF|INCLUS)/i.test(aheadLine)) break;
          if (/ACESS[OÓ]RIOS/i.test(aheadLine)) break;

          if (/VALOR/i.test(aheadLine)) {
            const valMatch = aheadLine.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/);
            if (valMatch) {
              valor = parseBRL(valMatch[0]) || 0;
              break;
            }
          }
        }
      }

      // Clean description
      descricao = descricao.replace(/\s*\|.*$/, "").trim();

      // JOGO DE PENEIRA: multiply quantity by 2
      if (/JOGO\s*DE\s*PENEIRA/i.test(descricao)) {
        quantidade = quantidade * 2;
      }

      equipamentos.push({ descricao, unidade: "UN", quantidade, valor });
    }
  }
  return equipamentos;
}

function extractMotores(lines: string[]): MotorItem[] {
  const motores: MotorItem[] = [];
  
  // Find the motor section start
  let motorSectionStart = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/MOTOR(?:ES)?\s*(?:TRIF[AÁ]SICO|MONOF[AÁ]SICO|INCLUS)/i.test(lines[i])) {
      motorSectionStart = i;
      break;
    }
  }
  
  // If no motor section found, return empty
  if (motorSectionStart === -1) return motores;
  
  // Parse motors within the section
  const motorMap = new Map<string, number>();
  
  for (let i = motorSectionStart + 1; i < lines.length; i++) {
    const ln = lines[i];
    
    // Stop at next major section
    if (/^[A-Z]\s*[-–]\s*\d+\s*[-–]/i.test(ln)) break;
    if (/ACESS[OÓ]RIOS/i.test(ln)) break;
    if (/VALOR\s*TOTAL/i.test(ln)) break;
    if (/FORMA\s*DE\s*PAGAMENTO/i.test(ln)) break;
    if (/OBSERVA[ÇC][ÕO]ES/i.test(ln)) break;
    
    // Skip "Acionamento" lines - these are NOT motors
    if (/ACIONAMENTO/i.test(ln)) continue;
    // Skip "por motorredutor" lines
    if (/por\s*motorredutor/i.test(ln)) continue;
    
    // Match pattern: "X CV X polos" / "X,X CV X polos" (CV inteiro ou decimal) with optional R$ value
    const cvMatch = ln.match(/(\d+(?:[,.]\d+)?)\s*CV\s*(\d+)\s*pol/i);
    if (cvMatch) {
      // Build clean model: "X CV X polos"
      const modelo = `${cvMatch[1]} CV ${cvMatch[2]} polos`;
      const existing = motorMap.get(modelo) || 0;
      motorMap.set(modelo, existing + 1);
      continue;
    }
    
    // Match motorredutor pattern
    if (/motorredutor/i.test(ln) && !/por\s*motorredutor/i.test(ln)) {
      let modelo = sanitize(ln);
      modelo = modelo.replace(/\s*\|?\s*R\$\s*[\d.,]+/g, "").replace(/\s*\|\s*$/g, "").trim();
      const existing = motorMap.get(modelo) || 0;
      motorMap.set(modelo, existing + 1);
    }
  }
  
  // Convert map to array
  for (const [modelo, quantidade] of motorMap) {
    motores.push({ modelo, quantidade });
  }
  
  return motores;
}

function extractMotoresValorTotal(lines: string[]): number | null {
  let inMotorSection = false;
  let totalValor: number | null = null;
  const valoresIndividuais: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/MOTOR(?:ES)?\s*(?:TRIF[AÁ]SICO|MONOF[AÁ]SICO|INCLUS)/i.test(line)) {
      inMotorSection = true;
      continue;
    }

    if (inMotorSection && (/^VALOR\s*TOTAL\s*DA\s*PROPOSTA/i.test(line) || /^OBSERVA[ÇC][ÕO]ES/i.test(line) || /^ACESS[ÓO]RIOS/i.test(line) || /^Frete/i.test(line) || /^Difal/i.test(line))) {
      break;
    }

    // Linha TOTAL ("TOTAL R$ x" OU "TOTAL" com o valor na linha seguinte - formato 2026)
    if (inMotorSection && /^\s*\|?\s*TOTAL\b/i.test(line) && !/VALOR\s*TOTAL/i.test(line)) {
      let valorMatch = line.match(/R\$\s*([\d.,]+)/);
      if (!valorMatch && i + 1 < lines.length && /^\s*\|?\s*R\$\s*[\d.,]+/.test(lines[i + 1])) {
        valorMatch = lines[i + 1].match(/R\$\s*([\d.,]+)/);
      }
      if (valorMatch) {
        const valorStr = valorMatch[1].replace(/\./g, '').replace(',', '.');
        totalValor = parseFloat(valorStr);
        console.log('[Fallback] Valor total de motores encontrado:', totalValor);
        return totalValor;
      }
    }
    if (inMotorSection && /valor\s+total\s+de\s+motores/i.test(line)) {
      const valorMatch = line.match(/R\$\s*([\d.,]+)/);
      if (valorMatch) {
        const valorStr = valorMatch[1].replace(/\./g, '').replace(',', '.');
        totalValor = parseFloat(valorStr);
        console.log('[Fallback] Valor total de motores encontrado:', totalValor);
        return totalValor;
      }
    }

    // Valor individual de motor: mesma linha OU linha seguinte (formato 2026)
    if (inMotorSection && /\d+[,.]?\d*\s*CV/i.test(line) && !/VALOR\s*TOTAL/i.test(line)) {
      // Skip "POR CONTA DO CLIENTE" motors - they have no cost
      if (/POR\s*CONTA\s*(DO\s*CLIENTE)?/i.test(line)) continue;

      let valorMatch = line.match(/R\$\s*([\d.,]+)/);
      if (!valorMatch && i + 1 < lines.length && /^\s*\|?\s*R\$\s*[\d.,]+/.test(lines[i + 1])) {
        valorMatch = lines[i + 1].match(/R\$\s*([\d.,]+)/);
      }
      if (valorMatch) {
        const valorStr = valorMatch[1].replace(/\./g, '').replace(',', '.');
        const valor = parseFloat(valorStr);
        valoresIndividuais.push(valor);
        console.log('[Fallback] Valor individual de motor:', valor, 'na linha:', line);
      }
    }
  }

  if (totalValor === null && valoresIndividuais.length > 0) {
    totalValor = valoresIndividuais.reduce((sum, val) => sum + val, 0);
    console.log('[Fallback] Somando valores individuais de motores:', valoresIndividuais, '=', totalValor);
  }

  return totalValor;
}

function valorBRLNaLinhaOuProxima(lines: string[], i: number): number | null {
  const re = /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))/;
  const m = lines[i].match(re);
  if (m) return parseBRL(m[0]);
  // No layout de PDF o valor pode ficar sozinho na linha seguinte ("VALOR TOTAL COM DESCONTO" / "R$ x")
  if (i + 1 < lines.length) {
    const mNext = lines[i + 1].match(/^\s*R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))\s*$/);
    if (mNext) return parseBRL(mNext[0]);
  }
  return null;
}

function extractValorTotal(lines: string[]): { semDesconto: number | null; comDesconto: number | null } {
  let semDesconto: number | null = null;
  let comDesconto: number | null = null;

  // Linhas de "TOTAL DA PROPOSTA" (DOCX) ou "VALOR TOTAL ... DESCONTO" (PDF).
  // Ignora "VALOR TOTAL DE EQUIPAMENTOS" (subtotal antes dos motores).
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    const ehTotalProposta =
      /TOTAL\s+DA\s+PROPOSTA/i.test(ln) ||
      (/VALOR\s+TOTAL/i.test(ln) && /DESCONTO/i.test(ln));
    if (!ehTotalProposta) continue;
    if (/EQUIPAMENTOS/i.test(ln)) continue;

    const val = valorBRLNaLinhaOuProxima(lines, i);
    if (!val || val <= 1000) continue;

    // "COM DESCONTO" = total com desconto; "(SEM DESCONTO)" NÃO é uma linha de desconto
    const temDesconto = /COM\s+DESCONTO/i.test(ln) && !/SEM\s+DESCONTO/i.test(ln);
    if (temDesconto) {
      if (comDesconto === null) comDesconto = val;
    } else if (semDesconto === null || /MOTOR\s+NOVO/i.test(ln)) {
      // Prefere a linha "COM MOTOR NOVO" (total padrão de venda)
      semDesconto = val;
    }
  }

  // Fallback: nenhum total da proposta -> último "VALOR TOTAL" que não seja equipamentos/desconto
  if (semDesconto === null && comDesconto === null) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const ln = lines[i];
      if (/VALOR\s*TOTAL/i.test(ln) && !/EQUIPAMENTOS/i.test(ln) && !/DESCONTO/i.test(ln)) {
        const v = valorBRLNaLinhaOuProxima(lines, i);
        if (v && v > 1000) { semDesconto = v; break; }
      }
    }
  }

  return { semDesconto, comDesconto };
}

function extractAcessorios(lines: string[]): { quantidade: number | null; valor: number | null } {
  let quantidade: number | null = null;
  let valor: number | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const acessoriosMatch = line.match(/^(?:[A-Z]\s*[-–—]\s*)?(?:(\d+)\s*[-–—]\s*)?[-–—]?\s*ACESS[ÓO]RIOS/i);

    if (acessoriosMatch) {
      console.log('[Fallback] Linha de ACESSÓRIOS encontrada:', line);

      if (acessoriosMatch[1]) {
        quantidade = parseInt(acessoriosMatch[1]);
      }

      // Valor na mesma linha
      const valorMatch = line.match(/R\$\s*([\d.,]+)/);
      if (valorMatch) {
        const valorStr = valorMatch[1].replace(/\./g, '').replace(',', '.');
        valor = parseFloat(valorStr);
      } else {
        // Busca valor nas próximas linhas
        let itemCount = 0;
        for (let j = i + 1; j < Math.min(i + 30, lines.length); j++) {
          const nextLine = lines[j];

          if (/^[A-Z]\s*[-–—]\s*\d+\s*[-–—]/i.test(nextLine)) break;
          if (/^MOTORES?\s+(TRIF[ÁA]SICOS?|MONOF[ÁA]SICOS?|INCLUSOS)/i.test(nextLine)) break;
          if (/VALOR\s+TOTAL\s+(DA|DE)\s+PROPOSTA/i.test(nextLine)) break;

          if (/^VALOR\s*$/i.test(nextLine) || /VALOR.*R\$/i.test(nextLine)) {
            if (!/DA\s+PROPOSTA|DE\s+PROPOSTA/i.test(nextLine)) {
              let nextValorMatch = nextLine.match(/R\$\s*([\d.,]+)/);
              if (nextValorMatch) {
                const valorStr = nextValorMatch[1].replace(/\./g, '').replace(',', '.');
                valor = parseFloat(valorStr);
              } else if (j + 1 < lines.length) {
                const lineAfterValor = lines[j + 1];
                nextValorMatch = lineAfterValor.match(/R\$\s*([\d.,]+)/);
                if (nextValorMatch) {
                  const valorStr = nextValorMatch[1].replace(/\./g, '').replace(',', '.');
                  valor = parseFloat(valorStr);
                }
              }
            }
            break;
          }

          if (/^\s*-\s+/.test(nextLine) && !/ACESS[ÓO]RIO/i.test(nextLine)) {
            itemCount++;
          }
        }

        if (valor && valor > 0) {
          quantidade = 1;
        } else if (itemCount > 0 && quantidade === null) {
          quantidade = itemCount;
        }
      }
      break;
    }
  }

  console.log('[Fallback] ACESSÓRIOS extraídos - Quantidade:', quantidade, 'Valor:', valor);
  return { quantidade, valor };
}

/** Extrai a seção "COMPONENTES ADICIONAIS" (ex.: "• Célula de Carga R$ 8.080,00"). */
function extractComponentesAdicionais(lines: string[]): Array<{ descricao: string; valor: number | null }> {
  const itens: Array<{ descricao: string; valor: number | null }> = [];
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/COMPONENTES?\s+ADICIONAIS/i.test(lines[i])) { start = i; break; }
  }
  if (start === -1) return itens;

  for (let i = start + 1; i < lines.length; i++) {
    const ln = lines[i];
    // Fim da seção: linha TOTAL ou início de outra seção
    if (/^\s*\|?\s*TOTAL\b/i.test(ln) && !/R\$.*R\$/.test(ln)) break;
    if (/VALOR\s*TOTAL\s*(DA|DE)\s*PROPOSTA/i.test(ln)) break;
    if (/FORMA\s*DE\s*PAGAMENTO|OBSERVA[ÇC]/i.test(ln)) break;

    // Item "• Nome ... R$ x" (bullet/coluna opcional)
    const m = ln.match(/^\s*[•·\-–]?\s*(.+?)\s*\|?\s*R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2}))\s*$/);
    if (m) {
      const descricao = sanitize(m[1].replace(/\s*\|.*$/, ""));
      if (descricao && !/^(COMPONENTE|TOTAL|VALOR)$/i.test(descricao)) {
        itens.push({ descricao, valor: parseBRL("R$ " + m[2]) });
      }
    }
  }
  return itens;
}

function extractFormaPagamento(lines: string[]): string | null {
  for (let i = 0; i < lines.length; i++) {
    if (/FORMA\s*DE\s*PAGAMENTO|CONDI[ÇC][ÃA]O\s*DE\s*PAGAMENTO/i.test(lines[i])) {
      const m = lines[i].match(/(?:FORMA|CONDI[ÇC][ÃA]O)\s*DE\s*PAGAMENTO\s*[:\-–—]\s*(.+)/i);
      if (m && sanitize(m[1])) return sanitize(m[1]);
      // Valor pode estar nas próximas linhas; pula bullets/marcadores vazios (layout de PDF)
      for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
        const cand = sanitize(lines[j]).replace(/^[•·•\-–]\s*/, "").trim();
        if (cand) return cand;
      }
    }
  }
  return null;
}

function parseMetodoPagamento(s: string): string {
  const u = s.toUpperCase();
  if (u.includes("PIX")) return "PIX";
  if (u.includes("BOLETO")) return "Boleto";
  if (u.includes("CART")) return "Cartão de Crédito";
  if (u.includes("DINHEIRO") || u.includes("TRANSFER")) return "Outro";
  return "PIX";
}

function parseValorAncora(s: string): number | null {
  if (!/R\$/.test(s)) return null;
  const m = s.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+,\d{2})/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(/\./g, "").replace(",", "."));
  return Number.isFinite(v) ? v : null;
}

function matchDataLabelParcela(
  line: string
): { dataTipo: string; dias?: number; dataFixa?: string; descricao: string } | null {
  const u = line.toUpperCase().replace(/\s+/g, " ").trim();
  let m: RegExpMatchArray | null;
  if (/^NO PEDIDO\b/.test(u)) return { dataTipo: "no_pedido", descricao: "No pedido" };
  if ((m = u.match(/^(\d+)\s*DIAS?\s*AP[OÓ]S\s*O\s*PEDIDO/)))
    return { dataTipo: "apos_pedido", dias: parseInt(m[1], 10), descricao: `Após o pedido (${m[1]} dias)` };
  if ((m = u.match(/^(\d+)\s*DIAS?\s*AP[OÓ]S\s*A\s*(NOTA|NF|EMISS)/)))
    return { dataTipo: "apos_nf", dias: parseInt(m[1], 10), descricao: `Após a emissão da nota (${m[1]} dias)` };
  if (/^NA\s*(EMISS[AÃ]O\s*DA\s*NOTA|NF|NOTA)/.test(u)) return { dataTipo: "na_nf", descricao: "Na emissão da nota" };
  if (/^DATA\s*FIXA/.test(u)) return { dataTipo: "data_fixa", descricao: "Data fixa" };
  if ((m = u.match(/^(\d{2}\/\d{2}\/\d{4})\b/)))
    return { dataTipo: "data_fixa", descricao: "Data fixa", dataFixa: m[1] };
  return null;
}

/**
 * Lê a TABELA de parcelas ("FORMA DE PAGAMENTO" com colunas DATA / MÉTODO / VALOR) que o
 * orçamento do CRM gera, quando importado como PDF/texto. Antes disso, o PDF só extraía a
 * forma de pagamento como texto e caía no derivePaymentPlanFromForma — que só entende frases
 * simples (à vista, entrada+saldo…) e deixava as Condições de Pagamento VAZIAS numa tabela.
 *
 * Abordagem por ÂNCORA: cada linha "MÉTODO R$ valor" é uma parcela; o dataTipo vem do RÓTULO
 * na linha imediatamente ANTERIOR ("NO PEDIDO", "30 DIAS APÓS A NOTA", data fixa…). As datas
 * dd/mm/aaaa que aparecem DEPOIS da âncora são notas de vencimento, não rótulos — por isso
 * não são confundidas com parcelas de data fixa. Validado contra PDFs reais do CRM
 * (2026-1804 = 8 parcelas, 1730 = 3, 1815 = 4). Retorna null quando não há tabela (ex.:
 * "à vista (PIX)" texto livre ou "a combinar"), deixando o chamador cair no derive por texto.
 */
export function extractPaymentPlanFromLines(lines: string[], total: number): any | null {
  const startRe = /forma\s*de\s*pagamento|condi[çc][õo]es?\s*de\s*pagamento/i;
  const stopRe = /^[•·\-–]?\s*(FRETE|VALIDADE|OBSERVA|GARANTIA|PRAZO DE ENTREGA|NOSSAS REDES|DADOS DO FABRICANTE|DADOS BANC|P[áa]gina \d)/i;
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) return null;
  const parcelas: any[] = [];
  for (let i = start + 1; i < lines.length && i < start + 40; i++) {
    const line = lines[i].trim();
    if (stopRe.test(line)) break;
    if (/^DATA\s+M[EÉ]TODO\s+VALOR/i.test(line)) continue; // cabeçalho da tabela
    const valor = parseValorAncora(line);
    if (valor === null || valor < 1 || valor > (total || 0) * 2) continue;
    const lbl = matchDataLabelParcela((lines[i - 1] || "").trim());
    if (!lbl) continue; // âncora sem rótulo reconhecível (ex.: total) → ignora
    parcelas.push({
      n: parcelas.length + 1,
      descricao: lbl.descricao,
      metodo: parseMetodoPagamento(line),
      vencimento: "custom",
      dataTipo: lbl.dataTipo,
      ...(lbl.dias != null ? { dias: lbl.dias } : {}),
      ...(lbl.dataFixa ? { dataFixa: lbl.dataFixa } : {}),
      data: "",
      valor: { tipo: "fixo", fixo: valor },
    });
  }
  if (parcelas.length === 0) return null;
  return { modo: "custom", observacao: "", moeda: "BRL", total, parcelas };
}

function extractTensao(lines: string[], fileName: string): string | null {
  for (const ln of lines) {
    if (/TRIF[AÁ]SICO/i.test(ln)) return "TRIFÁSICO";
    if (/MONOF[AÁ]SICO/i.test(ln)) return "MONOFÁSICO";
  }
  if (/TRIF/i.test(fileName)) return "TRIFÁSICO";
  if (/MONO/i.test(fileName)) return "MONOFÁSICO";
  return null;
}

function extractVoltagem(lines: string[], tensao: string | null): string | null {
  if (!tensao || tensao === "MONOFÁSICO") return tensao === "MONOFÁSICO" ? "220" : null;
  for (const ln of lines) {
    const m = ln.match(/(\d{3})\s*V/);
    if (m && ["220", "380", "440"].includes(m[1])) return m[1];
  }
  return null;
}

function extractDescricaoEquipamento(fileName: string, cliente: string | null): string | null {
  const base = fileName.replace(/\.docx$/i, "");

  // 1) Try extracting from parentheses: "Carlos Hobold (Peneiras e Martelos)"
  const parenMatch = base.match(/\(([^)]+)\)\s*$/);
  if (parenMatch) return parenMatch[1].trim();

  // 2) Try splitting by "_-_": "2023_-_0910_-_Mondo_Sementes_Ltda_Martelos"
  const underscoreParts = base.split(/_-_/);
  if (underscoreParts.length >= 3) {
    let rest = underscoreParts.slice(2).join("_-_").replace(/_/g, " ").trim();
    if (cliente) {
      const escaped = cliente.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rest = rest.replace(new RegExp("^" + escaped + "\\s*", "i"), "").trim();
    }
    if (rest) return rest;
  }

  // 3) Try splitting by " - ": "2021 - 1095 - Carlos Hobold"
  const spaceParts = base.split(/\s+-\s+/);
  if (spaceParts.length >= 3) {
    let rest = spaceParts.slice(2).join(" - ").trim();
    if (cliente) {
      const escaped = cliente.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      rest = rest.replace(new RegExp("^" + escaped + "\\s*", "i"), "").trim();
    }
    if (rest) return rest;
  }

  return null;
}

function extractObservacoes(lines: string[]): string[] {
  const obs: string[] = [];
  let inObs = false;
  for (const ln of lines) {
    if (/OBSERVA[ÇC][ÕO]ES/i.test(ln)) {
      inObs = true;
      const after = ln.replace(/.*OBSERVA[ÇC][ÕO]ES\s*[:\-–]?\s*/i, "").trim();
      if (after) obs.push(after);
      continue;
    }
    if (inObs) {
      if (/VALOR\s*TOTAL|FORMA\s*DE\s*PAGAMENTO|PRAZO/i.test(ln)) break;
      obs.push(ln);
    }
  }
  return obs;
}

/**
 * Completa um nome de cliente truncado usando o padrão de nome de arquivo do CRM
 * "ANO - NUM - CLIENTE (descrição).pdf". Só substitui quando o nome extraído do
 * corpo for prefixo do nome do arquivo (confirma e estende — nunca inventa).
 */
function completarClientePeloArquivo(cliente: string | null, fileName: string): string | null {
  const base = fileName.replace(/\.(pdf|docx)$/i, "");
  const m = base.match(/\d{4}\s*[-–]\s*\d{3,6}\s*[-–]\s*(.+?)\s*[\(\[]/);
  if (!m) return cliente;
  const nomeArq = sanitize(m[1]);
  if (!nomeArq) return cliente;
  if (!cliente) return nomeArq;
  if (nomeArq.toLowerCase().startsWith(cliente.toLowerCase())) return nomeArq;
  return cliente;
}

export async function extrairLocalComMammoth(file: File): Promise<LocalExtractionResult> {
  console.log("[Fallback local] Iniciando extração com mammoth...");

  const arrayBuffer = await file.arrayBuffer();
  const result = await mammoth.convertToHtml({ arrayBuffer });
  const html = result.value;
  const lines = htmlToLines(html);

  console.log("[Fallback local] Total de linhas extraídas:", lines.length);
  console.log("[Fallback local] Primeiras 10 linhas:", lines.slice(0, 10));

  // Debug: show lines that match equipment pattern
  const eqDebugRegex = /^([A-Z])\s*[-–]\s*(\d{1,3})\s*[-–]/i;
  const eqLines = lines.filter(ln => eqDebugRegex.test(ln));
  console.log("[Fallback local] Linhas de equipamento encontradas:", eqLines.length, eqLines.slice(0, 3));

  const equipamentosDetalhados = extractEquipamentosDetalhados(lines);
  const motores = extractMotores(lines);
  const valores = extractValorTotal(lines);
  const tensao = extractTensao(lines, file.name);
  const voltagem = extractVoltagem(lines, tensao);
  const acessorios = extractAcessorios(lines);
  const motoresValorTotal = extractMotoresValorTotal(lines);
  const itensAdicionais = extractComponentesAdicionais(lines);

  // Adicionar motores e acessórios como itens na lista de equipamentos
  if (motoresValorTotal && motoresValorTotal > 0) {
    const label = tensao === "MONOFÁSICO" ? "MOTORES MONOFÁSICOS" : "MOTORES TRIFÁSICOS";
    equipamentosDetalhados.push({ descricao: label, unidade: "UN", quantidade: 1, valor: motoresValorTotal });
  }
  if (acessorios.valor && acessorios.valor > 0) {
    equipamentosDetalhados.push({ descricao: "ACESSÓRIOS", unidade: "UN", quantidade: acessorios.quantidade || 1, valor: acessorios.valor });
  }

  const totalEquipamentos = equipamentosDetalhados.reduce(
    (sum, eq) => sum + eq.quantidade * eq.valor,
    0
  );

  return {
    cliente: extractCliente(lines),
    atencao_a: extractAtencaoA(lines),
    telefone: extractTelefone(lines),
    email: extractEmail(lines),
    cidade: extractCidade(lines),
    estado: extractEstado(lines),
    endereco: extractEndereco(lines),
    bairro: extractBairro(lines),
    cpf_cnpj: extractCpfCnpj(lines),
    cep: extractCep(lines),
    fantasia: extractFantasia(lines),
    inscricao_estadual: extractInscricaoEstadual(lines),
    equipamentos: equipamentosDetalhados.map((e) => e.descricao),
    equipamentos_detalhados: equipamentosDetalhados,
    motores,
    numero_orcamento: extractNumeroOrcamento(lines, file.name),
    valor_total: valores.semDesconto,
    valor_total_com_desconto: valores.comDesconto,
    tensao,
    voltagem,
    forma_pagamento: extractFormaPagamento(lines),
    descricao_equipamento: extractDescricaoEquipamento(file.name, extractCliente(lines)),
    observacoes: extractObservacoes(lines),
    observacoes_orcamento: "",
    total_equipamentos: totalEquipamentos,
    motores_quantidade_total: motores.reduce((s, m) => s + m.quantidade, 0),
    motores_valor_total: extractMotoresValorTotal(lines),
    acessorios_quantidade: acessorios.quantidade,
    acessorios_valor: acessorios.valor,
    itens_adicionais: itensAdicionais,
    payment_plan: extractPaymentPlanFromLines(lines, valores.comDesconto || valores.semDesconto || 0),
    alertas: [],
  };
}

/** Extract data from pre-parsed lines (reusable for PDF or any text source) */
export function extrairDadosDeLinhas(lines: string[], fileName: string): LocalExtractionResult {
  console.log("[extrairDadosDeLinhas] Total de linhas:", lines.length);
  console.log("[extrairDadosDeLinhas] Primeiras 10 linhas:", lines.slice(0, 10));

  const equipamentosDetalhados = extractEquipamentosDetalhados(lines);
  const motores = extractMotores(lines);
  const valores = extractValorTotal(lines);
  const tensao = extractTensao(lines, fileName);
  const voltagem = extractVoltagem(lines, tensao);
  const acessorios2 = extractAcessorios(lines);
  const motoresValorTotal2 = extractMotoresValorTotal(lines);
  const itensAdicionais2 = extractComponentesAdicionais(lines);

  // Adicionar motores e acessórios como itens na lista de equipamentos
  if (motoresValorTotal2 && motoresValorTotal2 > 0) {
    const label = tensao === "MONOFÁSICO" ? "MOTORES MONOFÁSICOS" : "MOTORES TRIFÁSICOS";
    equipamentosDetalhados.push({ descricao: label, unidade: "UN", quantidade: 1, valor: motoresValorTotal2 });
  }
  if (acessorios2.valor && acessorios2.valor > 0) {
    equipamentosDetalhados.push({ descricao: "ACESSÓRIOS", unidade: "UN", quantidade: acessorios2.quantidade || 1, valor: acessorios2.valor });
  }

  const totalEquipamentos = equipamentosDetalhados.reduce(
    (sum, eq) => sum + eq.quantidade * eq.valor,
    0
  );

  return {
    cliente: completarClientePeloArquivo(extractCliente(lines), fileName),
    atencao_a: extractAtencaoA(lines),
    telefone: extractTelefone(lines),
    email: extractEmail(lines),
    cidade: extractCidade(lines),
    estado: extractEstado(lines),
    endereco: extractEndereco(lines),
    bairro: extractBairro(lines),
    cpf_cnpj: extractCpfCnpj(lines),
    cep: extractCep(lines),
    fantasia: extractFantasia(lines),
    inscricao_estadual: extractInscricaoEstadual(lines),
    equipamentos: equipamentosDetalhados.map((e) => e.descricao),
    equipamentos_detalhados: equipamentosDetalhados,
    motores,
    numero_orcamento: extractNumeroOrcamento(lines, fileName),
    valor_total: valores.semDesconto,
    valor_total_com_desconto: valores.comDesconto,
    tensao,
    voltagem,
    forma_pagamento: extractFormaPagamento(lines),
    descricao_equipamento: extractDescricaoEquipamento(fileName, extractCliente(lines)),
    observacoes: extractObservacoes(lines),
    observacoes_orcamento: "",
    total_equipamentos: totalEquipamentos,
    motores_quantidade_total: motores.reduce((s, m) => s + m.quantidade, 0),
    motores_valor_total: extractMotoresValorTotal(lines),
    acessorios_quantidade: acessorios2.quantidade,
    acessorios_valor: acessorios2.valor,
    itens_adicionais: itensAdicionais2,
    payment_plan: extractPaymentPlanFromLines(lines, valores.comDesconto || valores.semDesconto || 0),
    alertas: [],
  };
}
