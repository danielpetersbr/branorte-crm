/**
 * Adiciona dias úteis (segunda a sexta) a uma data
 * @param start Data inicial
 * @param businessDays Número de dias úteis a adicionar
 * @returns Nova data com os dias úteis adicionados
 */
export function addBusinessDays(start: Date, businessDays: number): Date {
  const date = new Date(start);
  let added = 0;
  
  while (added < businessDays) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay(); // 0=Domingo, 6=Sábado
    
    // Só conta se for dia útil (segunda a sexta)
    if (day !== 0 && day !== 6) {
      added++;
    }
  }
  
  return date;
}

/**
 * Adiciona dias corridos (incluindo fins de semana) a uma data
 * @param start Data inicial
 * @param days Número de dias corridos a adicionar
 * @returns Nova data com os dias corridos adicionados
 */
export function addCalendarDays(start: Date, days: number): Date {
  const date = new Date(start);
  date.setDate(date.getDate() + days);
  return date;
}

/**
 * Formata data no padrão brasileiro (dd/MM/yyyy)
 * @param date Data a formatar
 * @returns String formatada
 */
export function formatDateBR(date: Date): string {
  const day = date.getDate().toString().padStart(2, '0');
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}
