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
  if (phone.length === 13) {
    return `+${phone.slice(0, 2)} (${phone.slice(2, 4)}) ${phone.slice(4, 9)}-${phone.slice(9)}`
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
