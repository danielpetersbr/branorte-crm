import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { formatDistanceToNow, parseISO } from 'date-fns'
import { ptBR } from 'date-fns/locale'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatNumber(n: number): string {
  return new Intl.NumberFormat('pt-BR').format(n)
}

export function formatPhone(phone: string): string {
  const d = phone.replace(/\D/g, '')
  // BR celular completo: +55 (DD) 9XXXX-XXXX
  if (d.length === 13 && d.startsWith('55')) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`
  }
  // BR fixo/celular antigo: +55 (DD) XXXX-XXXX
  if (d.length === 12 && d.startsWith('55')) {
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`
  }
  // BR sem +55, celular: (DD) 9XXXX-XXXX
  if (d.length === 11) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
  }
  // BR sem +55, fixo: (DD) XXXX-XXXX
  if (d.length === 10) {
    return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`
  }
  // Estrangeiros (Argentina +54, etc.): formato genérico
  if (d.length >= 10 && d.length <= 15) {
    const cc = d.length === 12 ? d.slice(0, 2) : d.length === 13 ? d.slice(0, 2) : d.slice(0, d.length - 10)
    const rest = d.slice(cc.length)
    if (rest.length === 10) return `+${cc} (${rest.slice(0, 2)}) ${rest.slice(2, 6)}-${rest.slice(6)}`
    if (rest.length === 11) return `+${cc} (${rest.slice(0, 2)}) ${rest.slice(2, 7)}-${rest.slice(7)}`
  }
  return phone
}

export function whatsappLink(phone: string): string {
  return `https://wa.me/${phone}`
}

export function phoneLink(phone: string): string {
  return `tel:+${phone}`
}

export function formatRelative(dateStr: string): string {
  try {
    return formatDistanceToNow(parseISO(dateStr), { addSuffix: true, locale: ptBR })
  } catch {
    return dateStr
  }
}

// Formata "28/04 23:03" — compacto p/ tabela
export function formatDateTimeShort(dateStr: string | null | undefined): string {
  if (!dateStr) return '-'
  try {
    const d = parseISO(dateStr)
    const dd = String(d.getDate()).padStart(2, '0')
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const mi = String(d.getMinutes()).padStart(2, '0')
    return `${dd}/${mm} ${hh}:${mi}`
  } catch {
    return dateStr
  }
}

export function estadoNome(uf: string): string {
  const map: Record<string, string> = {
    AC: 'Acre', AL: 'Alagoas', AM: 'Amazonas', AP: 'Amapa',
    BA: 'Bahia', CE: 'Ceara', DF: 'Distrito Federal', ES: 'Espirito Santo',
    GO: 'Goias', MA: 'Maranhao', MG: 'Minas Gerais', MS: 'Mato Grosso do Sul',
    MT: 'Mato Grosso', PA: 'Para', PB: 'Paraiba', PE: 'Pernambuco',
    PI: 'Piaui', PR: 'Parana', RJ: 'Rio de Janeiro', RN: 'Rio Grande do Norte',
    RO: 'Rondonia', RR: 'Roraima', RS: 'Rio Grande do Sul', SC: 'Santa Catarina',
    SE: 'Sergipe', SP: 'Sao Paulo', TO: 'Tocantins',
  }
  return map[uf] ?? uf
}
