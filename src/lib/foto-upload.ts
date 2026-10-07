// Foto do orçamento (principal, de item ou das observações) antes de subir pro Storage.
//
// Roadmap #94 (07/10/2026): a "Foto 3D" do Layout sai em PNG 3840x2000 de 8 a 16 MB. O bucket
// catalogo-fotos aceitava até 5 MB, o upload voltava 400 e o save gravava foto_principal_url = null
// sem avisar ninguém — a proposta saía com a foto (o PDF usa a imagem da memória) e ao reabrir pra
// editar ela tinha sumido. 3 orçamentos em 24 h (2948, 2959, 2963).
//
// Foto acima de LIMITE_SEM_REDUZIR vira JPEG com o lado maior em LADO_MAX — 2560 px cobre uma folha
// A4 inteira a 300 dpi, e uma Foto 3D cai de ~15 MB pra ~1 MB. Foto pequena passa intacta (PNG com
// transparência de item do catálogo continua PNG). Se o navegador não conseguir redesenhar, devolve a
// original: quem decide se sobe ou não é o Storage, e a falha é avisada pelo chamador.

export const LIMITE_SEM_REDUZIR = 3 * 1024 * 1024
export const LADO_MAX = 2560

export function dimensoesReduzidas(w: number, h: number, ladoMax = LADO_MAX): { w: number; h: number } {
  const maior = Math.max(w, h)
  if (!maior || maior <= ladoMax) return { w, h }
  const k = ladoMax / maior
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) }
}

export async function reduzirFotoParaUpload(blob: Blob): Promise<Blob> {
  if (blob.size <= LIMITE_SEM_REDUZIR || !blob.type.startsWith('image/')) return blob
  try {
    const bmp = await createImageBitmap(blob)
    const { w, h } = dimensoesReduzidas(bmp.width, bmp.height)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    // Fundo branco: PNG com transparência viraria preto no JPEG.
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, w, h)
    ctx.drawImage(bmp, 0, 0, w, h)
    bmp.close?.()
    const jpg = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/jpeg', 0.88))
    return jpg && jpg.size < blob.size ? jpg : blob
  } catch {
    return blob
  }
}

export function extensaoDaFoto(blob: Blob): 'png' | 'webp' | 'jpg' {
  if (blob.type.includes('png')) return 'png'
  if (blob.type.includes('webp')) return 'webp'
  return 'jpg'
}
