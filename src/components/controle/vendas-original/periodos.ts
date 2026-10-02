/** Limites inclusivos do mês anterior, usando o calendário local da página. */
export function periodoMesAnterior(data: Date): { inicio: string; fim: string } {
  const ultimoDia = new Date(data.getTime());
  // Fixar primeiro o dia evita o transbordamento de 31/mês para o mês seguinte.
  ultimoDia.setDate(1);
  ultimoDia.setDate(0);
  const ano = ultimoDia.getFullYear();
  const mes = String(ultimoDia.getMonth() + 1).padStart(2, '0');
  const dia = String(ultimoDia.getDate()).padStart(2, '0');
  return { inicio: `${ano}-${mes}-01`, fim: `${ano}-${mes}-${dia}` };
}
