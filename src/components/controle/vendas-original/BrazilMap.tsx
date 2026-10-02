import React, { useState, memo } from "react";
import {
  ComposableMap,
  Geographies,
  Geography,
} from "react-simple-maps";

interface EstadoData {
  estado: string;
  valor: number;
  quantidade: number;
}

interface BrazilMapProps {
  dados: EstadoData[];
  formatarValor: (valor: number) => string;
}

const BRAZIL_TOPO_JSON = "/brasil-estados.geojson";

const ESTADO_SIGLAS: Record<string, string> = {
  "Acre": "AC", "Alagoas": "AL", "Amapá": "AP", "Amazonas": "AM", "Bahia": "BA",
  "Ceará": "CE", "Distrito Federal": "DF", "Espírito Santo": "ES", "Goiás": "GO",
  "Maranhão": "MA", "Mato Grosso": "MT", "Mato Grosso do Sul": "MS", "Minas Gerais": "MG",
  "Pará": "PA", "Paraíba": "PB", "Paraná": "PR", "Pernambuco": "PE", "Piauí": "PI",
  "Rio de Janeiro": "RJ", "Rio Grande do Norte": "RN", "Rio Grande do Sul": "RS",
  "Rondônia": "RO", "Roraima": "RR", "Santa Catarina": "SC", "São Paulo": "SP",
  "Sergipe": "SE", "Tocantins": "TO"
};

const COLORS = {
  noData: "#e8f5f5",
  low: "#b2dfdb",
  medium: "#4db6ac",
  high: "#00897b",
  veryHigh: "#004d40"
};

function BrazilMap({ dados, formatarValor }: BrazilMapProps) {
  const [hoveredState, setHoveredState] = useState<string | null>(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
  const [tooltipContent, setTooltipContent] = useState<{ nome: string; data?: EstadoData } | null>(null);

  const dadosPorEstado = dados.reduce((acc, item) => {
    const sigla = item.estado?.toUpperCase();
    if (sigla && sigla !== 'N/D') {
      acc[sigla] = item;
    }
    return acc;
  }, {} as Record<string, EstadoData>);

  const valores = Object.values(dadosPorEstado).map(d => d.valor);
  const maxValor = Math.max(...valores, 1);

  // Ranking dos top 10 estados
  const ranking = Object.entries(dadosPorEstado)
    .sort((a, b) => b[1].valor - a[1].valor)
    .slice(0, 10);

  const getColor = (sigla: string) => {
    const data = dadosPorEstado[sigla];
    if (!data) return COLORS.noData;
    const ratio = data.valor / maxValor;
    if (ratio <= 0.2) return COLORS.low;
    if (ratio <= 0.45) return COLORS.medium;
    if (ratio <= 0.7) return COLORS.high;
    return COLORS.veryHigh;
  };

  const handleMouseMove = (e: React.MouseEvent, nome: string, sigla: string) => {
    setHoveredState(sigla);
    setTooltipPos({ x: e.clientX, y: e.clientY });
    setTooltipContent({ nome, data: dadosPorEstado[sigla] });
  };

  const handleMouseLeave = () => {
    setHoveredState(null);
    setTooltipContent(null);
  };

  return (
    <div className="flex flex-col lg:flex-row gap-4 w-full">
      {/* Mapa */}
      <div className="flex-1 min-w-0 flex flex-col items-center">
        <ComposableMap
          projection="geoMercator"
          projectionConfig={{
            scale: 480,
            center: [-54, -15]
          }}
          width={400}
          height={400}
          style={{ width: "100%", height: "auto", maxWidth: "100%" }}
        >
          <Geographies geography={BRAZIL_TOPO_JSON}>
            {({ geographies }) =>
              geographies.map((geo) => {
                const stateName = geo.properties.name;
                const sigla = geo.properties.sigla || ESTADO_SIGLAS[stateName] || stateName;
                const isHovered = hoveredState === sigla;
                
                return (
                  <Geography
                    key={geo.rsmKey}
                    geography={geo}
                    fill={getColor(sigla)}
                    stroke="#ffffff"
                    strokeWidth={isHovered ? 2 : 0.5}
                    style={{
                      default: { outline: "none", transition: "all 0.2s" },
                      hover: { fill: getColor(sigla), filter: "brightness(0.85)", outline: "none", cursor: "pointer" },
                      pressed: { outline: "none" },
                    }}
                    onMouseMove={(e) => handleMouseMove(e, stateName, sigla)}
                    onMouseLeave={handleMouseLeave}
                  />
                );
              })
            }
          </Geographies>
        </ComposableMap>

        {/* Legenda */}
        <div className="flex justify-center items-center gap-3 mt-2 flex-wrap">
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm" style={{ background: COLORS.noData, border: "1px solid #e0e0e0" }} />
            <span className="text-[10px] text-muted-foreground">Sem dados</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm" style={{ background: COLORS.low }} />
            <span className="text-[10px] text-muted-foreground">Baixo</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm" style={{ background: COLORS.medium }} />
            <span className="text-[10px] text-muted-foreground">Médio</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-3 h-2 rounded-sm" style={{ background: COLORS.veryHigh }} />
            <span className="text-[10px] text-muted-foreground">Alto</span>
          </div>
        </div>
      </div>

      {/* Ranking */}
      <div className="w-full lg:w-64 lg:flex-shrink-0 rounded-lg border border-border/40 bg-card/50 p-3">
        <h4 className="text-sm font-bold mb-3 text-foreground tracking-tight">
          Top Estados
        </h4>
        <div className="space-y-1">
          {ranking.map(([sigla, data], index) => {
            const valorCompacto = data.valor >= 1000
              ? `${(data.valor / 1000).toFixed(0)} mil`
              : data.valor.toFixed(0);
            const isTop3 = index < 3;

            return (
              <div
                key={sigla}
                className="flex items-center gap-2.5 text-sm py-1.5 px-2 rounded-md hover:bg-muted/50 transition-colors"
              >
                <span
                  className={`w-5 h-5 inline-flex items-center justify-center rounded-full text-[10px] font-bold flex-shrink-0 leading-none ${
                    isTop3
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'bg-muted text-muted-foreground'
                  }`}
                  style={{ lineHeight: '20px', paddingTop: 0, paddingBottom: 0 }}
                >
                  <span style={{ display: 'inline-block', lineHeight: 1, transform: 'translateY(0)' }}>{index + 1}</span>
                </span>
                <span className="font-bold w-8 flex-shrink-0 text-foreground text-sm">{sigla}</span>
                <span className="flex-1 font-medium text-foreground/80 text-sm tabular-nums">
                  R$ {valorCompacto}
                </span>
                <span className="text-xs flex-shrink-0 text-muted-foreground tabular-nums">
                  ({data.quantidade})
                </span>
              </div>
            );
          })}
          {ranking.length === 0 && (
            <p className="text-sm text-muted-foreground">Sem dados</p>
          )}
        </div>
      </div>

      {/* Tooltip */}
      {tooltipContent && (
        <div
          className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl px-3 py-2 pointer-events-none"
          style={{ left: tooltipPos.x + 10, top: tooltipPos.y - 40 }}
        >
          <p className="font-semibold text-gray-800 text-sm">{tooltipContent.nome}</p>
          {tooltipContent.data ? (
            <>
              <p className="text-xs text-gray-500">{tooltipContent.data.quantidade} vendas</p>
              <p className="text-xs font-bold text-emerald-600">{formatarValor(tooltipContent.data.valor)}</p>
            </>
          ) : (
            <p className="text-xs text-gray-400">Sem vendas</p>
          )}
        </div>
      )}
    </div>
  );
}

export default memo(BrazilMap);
