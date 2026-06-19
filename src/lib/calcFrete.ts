// Calculadora de frete Branorte — recomendação de caminhão + cotação multi-fonte.
// Sistema autônomo, sem integração com /orcamentos/montar.
//
// Stack: dados em Supabase (frete_tipos_caminhao, frete_antt_tabela,
// frete_transportadoras_parceiras, frete_cotacoes). Distância via OSRM público.
// CEP via ViaCEP. Geocoding via Nominatim.

export type TipoCaminhao = {
  id: number;
  nome: string;
  peso_max_kg: number;
  comprimento_util_m: number;
  largura_util_m: number;
  altura_util_m: number;
  eixos: number;
  precisa_aet: boolean;
  antt_tabela: string;
  ordem: number;
  ativo: boolean;
};

export type AnttTabela = {
  id: number;
  tipo_caminhao_id: number;
  resolucao_antt: string;
  ccd: number; // R$/km
  cc: number;  // R$ fixo (carga/descarga)
  vigencia_inicio: string;
  vigencia_fim: string | null;
};

export type TransportadoraParceira = {
  id: number;
  nome: string;
  contato_nome: string | null;
  telefone: string | null;
  email: string | null;
  rs_km_vuc: number | null;
  rs_km_toco: number | null;
  rs_km_truck: number | null;
  rs_km_carreta2: number | null;
  rs_km_carreta3: number | null;
  rs_km_bitrem: number | null;
  rs_km_rodotrem: number | null;
  taxa_minima: number;
  ufs_atende: string[];
  observacoes: string | null;
  ativo: boolean;
};

export type Carga = {
  peso_kg: number;
  comprimento_m: number;
  largura_m: number;
  altura_m: number;
  indivisivel: boolean;
};

/**
 * Fator de cubagem rodoviário brasileiro: 1 m³ "pesa" 300 kg para fins de
 * frete. Carga leve e volumosa (estrutura metálica Branorte) estoura por
 * ESPAÇO, não por peso — então cobra-se pelo maior entre peso real e cubado.
 */
export const FATOR_CUBAGEM = 300; // kg/m³

/** Peso efetivo (cobrável) = max(peso real, peso cubado = m³ × 300). */
export function pesoEfetivoKg(carga: Carga): number {
  const m3 = carga.comprimento_m * carga.largura_m * carga.altura_m;
  const cubado = m3 * FATOR_CUBAGEM;
  return Math.max(carga.peso_kg, cubado);
}

/**
 * Recomenda o MENOR caminhão capaz de transportar a carga.
 * - Filtra por PESO EFETIVO (peso real ou cubado, o maior) e dimensões úteis
 * - Ordena por peso_max_kg ascendente (menor = mais barato)
 * - Retorna `null` se nenhum cabe (carga especial — precisa cotação humana)
 */
export function recomendarCaminhao(
  carga: Carga,
  tipos: TipoCaminhao[],
): TipoCaminhao | null {
  const pesoEf = pesoEfetivoKg(carga);
  const candidatos = tipos
    .filter((t) => t.ativo)
    .filter((t) => t.peso_max_kg >= pesoEf)
    .filter((t) => t.comprimento_util_m >= carga.comprimento_m)
    .filter((t) => t.largura_util_m >= carga.largura_m)
    .filter((t) => t.altura_util_m >= carga.altura_m)
    .sort((a, b) => a.peso_max_kg - b.peso_max_kg);

  return candidatos[0] ?? null;
}

/**
 * Piso ANTT — Resolução vigente.
 * Fórmula: piso = distancia_km × CCD + CC
 * Multas por subpagar piso são reais (Lei 13.703/2018), então sistema sempre
 * mostra esse valor mínimo legal pro vendedor.
 */
export function calcularPisoANTT(distancia_km: number, antt: AnttTabela): number {
  return distancia_km * antt.ccd + antt.cc;
}

// ─────────────────────────────────────────────────────────────────────────────
// Modelo Branorte (planilha real)
// ─────────────────────────────────────────────────────────────────────────────

export type ModeloBranorteRow = {
  tipo_caminhao: 'TRUCK' | 'CARRETA';
  modo_carga: 'fracionada_2p' | 'fracionada_4p' | 'completa';
  rs_por_km: number;
  comprimento_util_m: number;
};

/**
 * UFs do Norte/Nordeste — frete de Branorte (SC) pra cá tem retorno barato,
 * então valor divide por 2 (regra real da planilha Branorte).
 */
const UFS_NORTE_NORDESTE = new Set([
  'AC','AL','AM','AP','BA','CE','MA','PA','PB','PE','PI','RN','RO','RR','SE','TO',
]);

export function isDestinoNorte(uf: string): boolean {
  return UFS_NORTE_NORDESTE.has(uf);
}

/**
 * @deprecated Dividia por 2 automaticamente por geografia (regra falaciosa) e
 * não respeitava o piso ANTT. Use `cotarBranorte`. Mantida só pra compat.
 */
export function calcularModeloBranorte(
  distancia_km: number,
  uf_destino: string,
  modelo: ModeloBranorteRow,
): { bruto: number; ajustado: number; aplicou_retorno: boolean } {
  const bruto = distancia_km * modelo.rs_por_km;
  const aplicou_retorno = isDestinoNorte(uf_destino);
  const ajustado = aplicou_retorno ? bruto / 2 : bruto;
  return { bruto, ajustado, aplicou_retorno };
}

/** Desconto máximo de frete-retorno (não 50%). Retorno reduz margem, não fura piso. */
export const DESCONTO_RETORNO_MAX_PCT = 30;

export type CotacaoBranorte = {
  /** distancia × R$/km do modo (sem desconto, sem trava) */
  valor_tabela: number;
  /** piso mínimo legal ANTT pra esse caminhão/distância */
  piso_antt: number;
  /** true quando a tabela ficou ABAIXO do piso e foi travada no piso */
  aplicou_piso: boolean;
  /** % de desconto de retorno efetivamente aplicado (0 se toggle off) */
  desconto_retorno_pct: number;
  /** true quando o desconto de retorno foi cortado pela trava do piso */
  limitou_retorno: boolean;
  /** valor base final (>= piso), ANTES da margem comercial */
  valor_final: number;
};

/**
 * Cotação Branorte CORRETA — substitui a lógica antiga (que dividia por 2 e
 * furava o piso). Garante: nenhum caminho retorna valor < piso ANTT.
 *
 *  1. valor_tabela = distancia × R$/km do modo
 *  2. base = MAX(valor_tabela, piso_antt)            ← trava 1 (piso é lei)
 *  3. se retorno ligado: aplica desconto (máx 30%), MAS base nunca < piso  ← trava 2
 *  4. valor_final = base travada (margem é aplicada DEPOIS, pela UI)
 *
 * @param pisoAntt piso legal ANTT já calculado pra esse caminhão/distância.
 * @param opts.descontoRetornoPct desconto manual de retorno (0-30). Default 0.
 *        SÓ deve ser > 0 quando o vendedor confirma veículo de retorno concreto.
 */
export function cotarBranorte(
  distancia_km: number,
  modelo: ModeloBranorteRow,
  pisoAntt: number,
  opts?: { descontoRetornoPct?: number },
): CotacaoBranorte {
  const valor_tabela = distancia_km * modelo.rs_por_km;
  const aplicou_piso = valor_tabela < pisoAntt;
  let base = Math.max(valor_tabela, pisoAntt);

  const pct = Math.min(
    Math.max(opts?.descontoRetornoPct ?? 0, 0),
    DESCONTO_RETORNO_MAX_PCT,
  );
  let limitou_retorno = false;
  if (pct > 0) {
    const comDesconto = base * (1 - pct / 100);
    if (comDesconto < pisoAntt) {
      limitou_retorno = true;
      base = pisoAntt; // trava 2: retorno nunca fura o piso
    } else {
      base = comDesconto;
    }
  }

  return {
    valor_tabela,
    piso_antt: pisoAntt,
    aplicou_piso,
    desconto_retorno_pct: pct,
    limitou_retorno,
    valor_final: base,
  };
}

export type FreteComercial = {
  /** piso legal ANTT só da IDA (a lei mede km carregado) — referência mínima */
  pisoLegalIda: number;
  /** true quando cobrou ida+volta (carga completa/dedicada volta vazia) */
  idaEVolta: boolean;
  /** km efetivamente cobrado (2× a distância quando ida+volta) */
  kmCobravel: number;
  /** valor base ANTES da margem (>= piso legal de ida) */
  base: number;
  /** valor comercial final (base × margem) — o número que o vendedor passa */
  comMargem: number;
};

/**
 * Cotação comercial Branorte (o número que aparece pro vendedor).
 *
 * Regra (definida pelo dono em 2026-06-19): carga COMPLETA é dedicada/indivisível
 * e o caminhão sai de SC e VOLTA VAZIO — então cobra ida+volta (dobra o
 * deslocamento). Carga fracionada divide o caminhão → cobra só a ida.
 * Se o vendedor confirmar carga de retorno (`temRetorno`), cobra só ida mesmo
 * em completa.
 *
 * O custo fixo de carga/descarga (CC) conta UMA vez (carrega/descarrega 1×).
 * Nunca retorna abaixo do piso legal da ida (Lei 13.703/2018).
 *
 * Ex. Pres. Prudente: 1010 km, carreta (CCD 4,85 / CC 420), margem 1,1 →
 * base = 2020×4,85 + 420 = 10.217 ; ×1,1 = R$ 11.239 (mercado ~R$ 11.500).
 */
export function cotarFreteComercial(
  distancia_km: number,
  antt: AnttTabela,
  modo: 'fracionada_2p' | 'fracionada_4p' | 'completa',
  margem: number,
  temRetorno = false,
): FreteComercial {
  const pisoLegalIda = distancia_km * antt.ccd + antt.cc;
  const idaEVolta = modo === 'completa' && !temRetorno;
  const kmCobravel = idaEVolta ? distancia_km * 2 : distancia_km;
  const desloc = kmCobravel * antt.ccd + antt.cc; // CC (carga/descarga) conta 1×
  const base = Math.max(desloc, pisoLegalIda);
  return { pisoLegalIda, idaEVolta, kmCobravel, base, comMargem: base * (margem || 1) };
}

/**
 * Sugere automaticamente o modo_carga do modelo Branorte baseado no perfil
 * da carga. Regras:
 *  - 1-2 paletes → fracionada_2p (só Carreta tem)
 *  - 3-4 paletes → fracionada_4p
 *  - 5+ paletes ou peso > capacidade do Truck → completa
 *
 * Esta função é usada quando o vendedor digita carga via "Por equipamento"
 * ou "Por dimensões". Quando usa aba "Carga fechada" ele mesmo escolhe o modo.
 */
export function sugerirModoCargaBranorte(
  peso_kg: number,
  qtd_paletes?: number,
): 'fracionada_2p' | 'fracionada_4p' | 'completa' {
  if (qtd_paletes != null) {
    if (qtd_paletes <= 2) return 'fracionada_2p';
    if (qtd_paletes <= 4) return 'fracionada_4p';
    return 'completa';
  }
  // Sem qtd paletes explícita: cargas pequenas vão fracionadas
  if (peso_kg <= 1500) return 'fracionada_2p';
  if (peso_kg <= 3500) return 'fracionada_4p';
  return 'completa';
}

// Limites úteis aproximados por tipo Branorte — usados só pra decidir o MODO
// (ocupação do baú). Capacidade real de peso/dimensão vem de frete_tipos_caminhao.
const LIM_MODO = {
  TRUCK: { kg: 14000, comp_m: 8.0 },
  CARRETA: { kg: 27000, comp_m: 12.0 },
} as const;

/**
 * Decide o modo de carga (fracionada vs completa) com a regra CORRETA, que
 * substitui `sugerirModoCargaBranorte` (que olhava só o peso).
 *
 * Ordem das regras (a primeira que bate vence):
 *  0. INDIVISÍVEL  -> sempre `completa` (uma fábrica não vira "4 paletes")
 *  1. ocupa >50% do baú (comprimento OU peso efetivo) -> `completa`
 *  2. altura > 2,2 m (não empilha, ocupa a coluna toda) -> `completa`
 *  3. senão, divisível e pequena -> fracionada por paletes-equivalentes
 *
 * Usa PESO EFETIVO (max peso real vs cubado), porque carga metálica leve e
 * volumosa estoura por espaço, não por peso.
 */
export function definirModoCargaBranorte(
  carga: Carga,
  tipo: 'TRUCK' | 'CARRETA',
  qtd_paletes?: number,
): 'fracionada_2p' | 'fracionada_4p' | 'completa' {
  // REGRA 0 — indivisibilidade força completa, ignora todo o resto
  if (carga.indivisivel) return 'completa';

  const m3 = carga.comprimento_m * carga.largura_m * carga.altura_m;
  const pesoEf = pesoEfetivoKg(carga);
  const lim = LIM_MODO[tipo];
  const ocupComp = lim.comp_m > 0 ? carga.comprimento_m / lim.comp_m : 0;
  const ocupPeso = lim.kg > 0 ? pesoEf / lim.kg : 0;
  const ocupacao = Math.max(ocupComp, ocupPeso);

  // REGRA 1 — alta ocupação => completa
  if (ocupacao > 0.5) return 'completa';
  // REGRA 2 — carga alta não empilha => completa
  if (carga.altura_m > 2.2) return 'completa';

  // REGRA 3 — fracionada por paletes-equivalentes
  const paletesEquiv =
    qtd_paletes ?? Math.ceil(Math.max(m3 / 2.0, pesoEf / 1200));
  if (paletesEquiv <= 2) return 'fracionada_2p';
  if (paletesEquiv <= 4) return 'fracionada_4p';
  return 'completa';
}

/**
 * Valor estimado de uma transportadora parceira para o caminhão recomendado.
 * Retorna `null` se a parceira não tem tabela pra esse tipo de caminhão,
 * não atende a UF de destino, ou está inativa.
 */
export function calcularParceira(
  distancia_km: number,
  uf_destino: string,
  caminhao: TipoCaminhao,
  parceira: TransportadoraParceira,
): number | null {
  if (!parceira.ativo) return null;
  if (parceira.ufs_atende.length > 0 && !parceira.ufs_atende.includes(uf_destino)) {
    return null;
  }

  const rs_km = rsKmDoTipo(parceira, caminhao);
  if (rs_km == null || rs_km <= 0) return null;

  const bruto = distancia_km * rs_km;
  return Math.max(bruto, parceira.taxa_minima ?? 0);
}

function rsKmDoTipo(p: TransportadoraParceira, c: TipoCaminhao): number | null {
  switch (c.nome) {
    case 'VUC': return p.rs_km_vuc;
    case 'Toco': return p.rs_km_toco;
    case 'Truck': return p.rs_km_truck;
    case 'Carreta 2 eixos': return p.rs_km_carreta2;
    case 'Carreta 3 eixos': return p.rs_km_carreta3;
    case 'Bitrem': return p.rs_km_bitrem;
    case 'Rodotrem': return p.rs_km_rodotrem;
    default: return null;
  }
}

/**
 * Mediana — base do cálculo de média histórica.
 * Mediana é mais robusta que média aritmética contra outliers (frete absurdo
 * que entrou no histórico por erro de digitação).
 */
export function mediana(valores: number[]): number | null {
  if (valores.length === 0) return null;
  const ordenados = [...valores].sort((a, b) => a - b);
  const meio = Math.floor(ordenados.length / 2);
  if (ordenados.length % 2 === 0) {
    return (ordenados[meio - 1] + ordenados[meio]) / 2;
  }
  return ordenados[meio];
}

/**
 * Calcula volume (m³) a partir de LxWxH.
 */
export function volumeM3(comp: number, larg: number, alt: number): number {
  return comp * larg * alt;
}

// ─────────────────────────────────────────────────────────────────────────────
// CEP → Coordenadas → Distância via APIs públicas gratuitas
// ─────────────────────────────────────────────────────────────────────────────

const BRANORTE_ORIGEM = {
  cep: '88890-000',
  cidade: 'Grão Pará',
  uf: 'SC',
  lat: -28.1828,
  lng: -49.2280,
};

export type DestinoInfo = {
  cep: string;
  cidade: string;
  uf: string;
  lat: number;
  lng: number;
};

export type DistanciaResultado = {
  distancia_km: number;
  tempo_horas: number;
  origem: DestinoInfo;
  destino: DestinoInfo;
};

/**
 * Consulta ViaCEP para resolver CEP -> endereço.
 * Aceita CEP com ou sem hífen.
 */
export async function consultarCEP(cep: string): Promise<{
  cidade: string;
  uf: string;
  bairro: string;
  logradouro: string;
} | null> {
  const cepLimpo = cep.replace(/\D/g, '');
  if (cepLimpo.length !== 8) return null;

  try {
    const res = await fetch(`https://viacep.com.br/ws/${cepLimpo}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.erro) return null;
    return {
      cidade: data.localidade,
      uf: data.uf,
      bairro: data.bairro,
      logradouro: data.logradouro,
    };
  } catch {
    return null;
  }
}

/**
 * Geocoding via Nominatim (OpenStreetMap). Rate limit oficial: 1 req/s.
 * Pra produção considerar self-host se uso ficar alto.
 */
export async function geocodificarCidade(
  cidade: string,
  uf: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const query = encodeURIComponent(`${cidade}, ${uf}, Brasil`);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${query}&format=json&limit=1&countrycodes=br`,
      {
        headers: {
          'User-Agent': 'Branorte-CRM-Frete/1.0 (contato@mbranorte.com.br)',
        },
      },
    );
    if (!res.ok) return null;
    const arr = await res.json();
    if (!Array.isArray(arr) || arr.length === 0) return null;
    return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
  } catch {
    return null;
  }
}

/**
 * OSRM público: rota rodoviária real entre 2 pontos.
 * Retorna distância (km) e tempo (horas).
 */
export async function calcularDistanciaOSRM(
  origem: { lat: number; lng: number },
  destino: { lat: number; lng: number },
): Promise<{ distancia_km: number; tempo_horas: number } | null> {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${origem.lng},${origem.lat};${destino.lng},${destino.lat}?overview=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.routes || data.routes.length === 0) return null;
    const rota = data.routes[0];
    return {
      distancia_km: rota.distance / 1000,
      tempo_horas: rota.duration / 3600,
    };
  } catch {
    return null;
  }
}

/**
 * Pipeline completo: CEP destino -> distância de Branorte até o cliente.
 * Devolve `null` se qualquer passo falhar (vendedor pode digitar manual).
 */
export async function calcularDistanciaBranortePara(
  cepDestino: string,
): Promise<DistanciaResultado | null> {
  const enderecoDestino = await consultarCEP(cepDestino);
  if (!enderecoDestino) return null;

  const coordsDestino = await geocodificarCidade(
    enderecoDestino.cidade,
    enderecoDestino.uf,
  );
  if (!coordsDestino) return null;

  const dist = await calcularDistanciaOSRM(
    { lat: BRANORTE_ORIGEM.lat, lng: BRANORTE_ORIGEM.lng },
    coordsDestino,
  );
  if (!dist) return null;

  return {
    distancia_km: Math.round(dist.distancia_km),
    tempo_horas: Math.round(dist.tempo_horas * 10) / 10,
    origem: BRANORTE_ORIGEM,
    destino: {
      cep: cepDestino,
      cidade: enderecoDestino.cidade,
      uf: enderecoDestino.uf,
      lat: coordsDestino.lat,
      lng: coordsDestino.lng,
    },
  };
}

/**
 * Destino resolvido com cidade/UF SEMPRE presentes (do ViaCEP, ~99% confiável)
 * e distância OPCIONAL (Nominatim+OSRM são flaky / rate-limited).
 *
 * Diferença pro calcularDistanciaBranortePara: aqui a cidade/estado aparece
 * mesmo quando o cálculo de distância falha — o vendedor vê "Goiânia/GO"
 * imediatamente e digita o km manual se o OSRM não respondeu.
 *
 * Retorna `null` SÓ quando o CEP é inválido (ViaCEP não achou).
 */
export type DestinoResolvido = {
  cep: string;
  cidade: string;
  uf: string;
  bairro: string;
  logradouro: string;
  /** null quando geocode/OSRM falhou — vendedor digita km manual */
  distancia_km: number | null;
  tempo_horas: number | null;
};

/**
 * Resolve destino direto por CIDADE + UF (sem CEP). Útil quando o vendedor
 * sabe a cidade mas não o CEP (comum no agro). Cidade/UF vêm validados (do
 * autocomplete IBGE); aqui só calculamos a distância (best-effort).
 *
 * Retorna `null` só se a cidade não geocodificar — mas mesmo assim a UI pode
 * mostrar cidade/UF e pedir km manual (ver tratamento no componente).
 */
export async function resolverDestinoPorCidade(
  cidade: string,
  uf: string,
): Promise<DestinoResolvido> {
  let distancia_km: number | null = null;
  let tempo_horas: number | null = null;

  const coords = await geocodificarCidade(cidade, uf);
  if (coords) {
    const dist = await calcularDistanciaOSRM(
      { lat: BRANORTE_ORIGEM.lat, lng: BRANORTE_ORIGEM.lng },
      coords,
    );
    if (dist) {
      distancia_km = Math.round(dist.distancia_km);
      tempo_horas = Math.round(dist.tempo_horas * 10) / 10;
    }
  }

  return {
    cep: '',
    cidade,
    uf,
    bairro: '',
    logradouro: '',
    distancia_km,
    tempo_horas,
  };
}

export async function resolverDestino(
  cepDestino: string,
): Promise<DestinoResolvido | null> {
  const endereco = await consultarCEP(cepDestino);
  if (!endereco) return null; // CEP inválido — único caso de null

  // Cidade/UF já garantidos. Distância é best-effort.
  let distancia_km: number | null = null;
  let tempo_horas: number | null = null;

  const coords = await geocodificarCidade(endereco.cidade, endereco.uf);
  if (coords) {
    const dist = await calcularDistanciaOSRM(
      { lat: BRANORTE_ORIGEM.lat, lng: BRANORTE_ORIGEM.lng },
      coords,
    );
    if (dist) {
      distancia_km = Math.round(dist.distancia_km);
      tempo_horas = Math.round(dist.tempo_horas * 10) / 10;
    }
  }

  return {
    cep: cepDestino,
    cidade: endereco.cidade,
    uf: endereco.uf,
    bairro: endereco.bairro,
    logradouro: endereco.logradouro,
    distancia_km,
    tempo_horas,
  };
}
