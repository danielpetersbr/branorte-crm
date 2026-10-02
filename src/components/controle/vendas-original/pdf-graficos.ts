/** Helpers puros: não consultam dados, não mudam cálculos e não salvam PDF. */
export type ProntidaoAnualPDF = {
  carregando: boolean;
  erro: string | null;
  contexto: string;
  contextoConsulta: string;
};

export function evolucaoAnualPDFPronta(estado: ProntidaoAnualPDF): boolean {
  return !estado.carregando && estado.erro === null && !!estado.contexto && estado.contextoConsulta === estado.contexto;
}

export function exigirEvolucaoAnualPDF(estado: ProntidaoAnualPDF): void {
  if (!evolucaoAnualPDFPronta(estado)) throw Error('A evolução anual ainda não está disponível. Aguarde ou atualize a leitura antes de exportar.');
}

export type EscalaBarrasPDF = {
  minimo: number;
  maximo: number;
  zero: number;
  /** Coordenada 0..1, da esquerda para direita ou de baixo para cima. */
  posicao: (valor: number) => number;
};

const valorInvalido = (): never => {throw Error('Valor de gráfico inválido.');};

export function escalaBarrasPDF(valores: readonly number[]): EscalaBarrasPDF {
  let minimo=0, maximo=0;
  for (const valor of valores) {
    if (!Number.isFinite(valor)) return valorInvalido();
    minimo=Math.min(minimo,valor);maximo=Math.max(maximo,valor);
  }
  // Uma série realmente carregada e vazia/zerada tem domínio neutro, sem barra.
  if (minimo===maximo) maximo=1;
  const amplitude=maximo-minimo;
  if (!Number.isFinite(amplitude)) return valorInvalido();
  const posicao=(valor:number) => {
    if (!Number.isFinite(valor) || valor<minimo || valor>maximo) return valorInvalido();
    return (valor-minimo)/amplitude;
  };
  return {minimo,maximo,zero:posicao(0),posicao};
}

export function segmentoBarraPDF(valor:number,escala:EscalaBarrasPDF): {inicio:number;comprimento:number} {
  const fim=escala.posicao(valor);
  return {inicio:Math.min(escala.zero,fim),comprimento:Math.abs(fim-escala.zero)};
}

/** Mesma série do card de conversão por origem, preservando nomes/valores/ordem. */
export function dadosConversaoOrigemPDF(dados: readonly {origem:string;mediaDias:number}[]): {label:string;valor:number;sufixo:string}[] {
  return dados.map(item => {
    if (!Number.isFinite(item.mediaDias)) return valorInvalido();
    return {label:item.origem,valor:item.mediaDias,sufixo:' dias'};
  });
}

/** Deve envolver html2canvas E toDataURL: falha não pode gerar sucesso parcial. */
export async function capturaMapaPDF<T>(capturar:()=>Promise<T>): Promise<T> {
  try {return await capturar();}
  catch {throw Error('Não foi possível capturar o mapa. Gere o relatório novamente.');}
}
