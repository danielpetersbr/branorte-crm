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
 * Recomenda o MENOR caminhão capaz de transportar a carga.
 * - Filtra por capacidade de peso e dimensões úteis
 * - Ordena por peso_max_kg ascendente (menor = mais barato)
 * - Retorna `null` se nenhum cabe (carga especial — precisa cotação humana)
 */
export function recomendarCaminhao(
  carga: Carga,
  tipos: TipoCaminhao[],
): TipoCaminhao | null {
  const candidatos = tipos
    .filter((t) => t.ativo)
    .filter((t) => t.peso_max_kg >= carga.peso_kg)
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
