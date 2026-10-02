/**
 * Helper para carregar fonte Unicode (Noto Sans) no jsPDF
 * Garante suporte completo a acentos e caracteres especiais
 */
import jsPDF from 'jspdf';

// URLs das fontes Noto Sans do Google Fonts
const FONT_URLS = {
  regular: 'https://fonts.gstatic.com/s/notosans/v36/o-0mIpQlx3QUlC5A4PNB6Ryti20_6n1iPHjc5a7d.ttf',
  bold: 'https://fonts.gstatic.com/s/notosans/v36/o-0NIpQlx3QUlC5A4PNjXhFlY9aA5Wl6PQ.ttf'
};

// Cache de fontes já carregadas (base64)
let fontCache: { regular?: string; bold?: string } = {};

/**
 * Converte ArrayBuffer para Base64
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  let binary = '';
  const bytes = new Uint8Array(buffer);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Carrega uma fonte TTF e retorna como base64
 */
async function loadFontAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load font: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return arrayBufferToBase64(buffer);
}

/**
 * Registra as fontes Noto Sans no jsPDF
 * Retorna true se conseguiu carregar, false caso contrário
 */
export async function registerNotoSansFont(doc: jsPDF): Promise<boolean> {
  try {
    // Carrega fontes se ainda não estiverem em cache
    if (!fontCache.regular) {
      fontCache.regular = await loadFontAsBase64(FONT_URLS.regular);
    }
    if (!fontCache.bold) {
      fontCache.bold = await loadFontAsBase64(FONT_URLS.bold);
    }

    // Registra no jsPDF
    doc.addFileToVFS('NotoSans-Regular.ttf', fontCache.regular);
    doc.addFileToVFS('NotoSans-Bold.ttf', fontCache.bold);
    
    doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
    doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
    
    return true;
  } catch (error) {
    console.warn('Erro ao carregar fonte Noto Sans, usando Helvetica:', error);
    return false;
  }
}

/**
 * Remove emojis e caracteres especiais não suportados pelo PDF
 * Mantém acentos e caracteres latinos
 */
export function sanitizePdfText(text: string | null | undefined): string {
  if (!text) return '';
  
  // Remove emojis e símbolos Unicode especiais (ranges de emoji)
  return text
    // Remove emojis comuns (incluindo variações)
    .replace(/[\u{1F300}-\u{1F9FF}]/gu, '')
    // Remove símbolos diversos
    .replace(/[\u{2600}-\u{26FF}]/gu, '')
    // Remove dingbats
    .replace(/[\u{2700}-\u{27BF}]/gu, '')
    // Remove símbolos suplementares
    .replace(/[\u{1F000}-\u{1F02F}]/gu, '')
    // Remove misc symbols and pictographs
    .replace(/[\u{1F0A0}-\u{1F0FF}]/gu, '')
    // Remove símbolos matemáticos que podem causar problemas
    .replace(/[⭐📅🏆⏱️🏭🔧🥇🥈🥉💰📊✨🎯📈📉🔥💪🎉📌📍🏅]/g, '')
    // Remove outros emojis comuns que podem escapar
    .replace(/[👤👥💼📁📂📃📄📋📎📏📐]/g, '')
    // Limpa espaços extras
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Configura opções de autoTable para usar a fonte customizada
 */
export function getAutoTableFontConfig(useNotoSans: boolean): object {
  if (useNotoSans) {
    return {
      font: 'NotoSans',
      fontStyle: 'normal'
    };
  }
  return {
    font: 'helvetica',
    fontStyle: 'normal'
  };
}
