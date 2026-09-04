import type { ReactNode } from "react";
import { Input } from "@/components/pedido-ui/input";
import { Textarea } from "@/components/pedido-ui/textarea";
import { Label } from "@/components/pedido-ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/pedido-ui/select";
import { cn } from "@/lib/utils";

// ===== CONTRATO COMPARTILHADO (idêntico no App2 — NÃO alterar nomes) =====
export type ChecklistCompras = {
  posicao_pilares: string;
  medidas_alvenaria: string;
  parede_espessura_tipo: string;
  distancia_trelicas: string;
  altura_chupim: string;
  material_linha: string;
  alimentacao_1o_chupim: string;
  tipo_energia: string; // mantido no contrato (App2). Removido da TELA a pedido — fica sempre "".
  medidas_equip_existente: string;
  obs_cliente: string;
  motor_marca: "" | "WEG" | "Mercosul" | "Qualquer marca";
};

export const DEFAULT_CHECKLIST_COMPRAS: ChecklistCompras = {
  posicao_pilares: "",
  medidas_alvenaria: "",
  parede_espessura_tipo: "",
  distancia_trelicas: "",
  altura_chupim: "",
  material_linha: "",
  alimentacao_1o_chupim: "",
  tipo_energia: "",
  medidas_equip_existente: "",
  obs_cliente: "",
  motor_marca: "",
};

// Valor-sentinela gravado quando o vendedor marca "Não precisa". Usa os campos
// de texto que já existem — não muda o contrato compartilhado com o App2.
export const NAO_PRECISA = "Não precisa";

/** Retorna true se TODOS os campos do checklist estiverem vazios. */
export function isChecklistEmpty(c: ChecklistCompras): boolean {
  return (
    !c.posicao_pilares.trim() &&
    !c.medidas_alvenaria.trim() &&
    !c.parede_espessura_tipo.trim() &&
    !c.distancia_trelicas.trim() &&
    !c.altura_chupim.trim() &&
    !c.material_linha.trim() &&
    !c.alimentacao_1o_chupim.trim() &&
    !c.tipo_energia.trim() &&
    !c.medidas_equip_existente.trim() &&
    !c.obs_cliente.trim() &&
    !c.motor_marca.trim()
  );
}

// ====================================================================
// Diagramas ilustrativos (SVG inline) — ajudam o vendedor a entender a
// medida pedida. Sem assets externos / storage.
// ====================================================================
function Diagrama({ children, legenda }: { children: ReactNode; legenda: string }) {
  return (
    <div className="mt-2 rounded-md border bg-muted/30 px-3 py-2">
      <svg viewBox="0 0 260 96" className="h-auto w-full max-w-[260px] text-primary" fill="none">
        {children}
      </svg>
      <p className="mt-1 text-[11px] leading-tight text-muted-foreground">{legenda}</p>
    </div>
  );
}

const ST = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
const txt = { fill: "currentColor", fontSize: 10 } as const;

// 1 — Posições de pilares (vista de cima)
const DiagPilares = (
  <Diagrama legenda="Vista de cima do galpão: marque onde ficam os pilares (possíveis posições de torre).">
    <rect x="30" y="20" width="200" height="56" rx="3" {...ST} strokeDasharray="5 4" className="text-muted-foreground" />
    {[30, 96, 163, 230].map((x) =>
      [20, 76].map((y) => <circle key={`${x}-${y}`} cx={x} cy={y} r="5" fill="currentColor" />)
    )}
    <text x="130" y="52" textAnchor="middle" {...txt} className="fill-muted-foreground">alvenaria</text>
  </Diagrama>
);

// 2 — Medidas da alvenaria (C x L x A)
const DiagAlvenaria = (
  <Diagrama legenda="Comprimento × Largura × Altura do prédio (em metros).">
    <path d="M40 76 V30 H150 V76 Z" {...ST} />
    <path d="M150 30 L195 16 V62 L150 76" {...ST} />
    <path d="M40 30 L85 16 H195" {...ST} className="text-muted-foreground" />
    {/* setas */}
    <path d="M40 88 H150" {...ST} markerStart="url(#a)" markerEnd="url(#a)" />
    <text x="95" y="86" textAnchor="middle" {...txt}>Comprimento</text>
    <path d="M28 30 V76" {...ST} markerStart="url(#a)" markerEnd="url(#a)" />
    <text x="14" y="56" textAnchor="middle" {...txt}>Altura</text>
    <text x="178" y="30" textAnchor="middle" {...txt}>Largura</text>
    <defs>
      <marker id="a" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
        <path d="M0 0 L7 3.5 L0 7" fill="currentColor" />
      </marker>
    </defs>
  </Diagrama>
);

// 3 — Espessura das paredes (corte)
const DiagParede = (
  <Diagrama legenda="Espessura da parede (corte) + material (tijolo, bloco…).">
    <rect x="100" y="18" width="34" height="60" {...ST} fill="currentColor" fillOpacity="0.12" />
    <path d="M100 18 L134 28 M100 30 L134 40 M100 42 L134 52 M100 54 L134 64" {...ST} className="text-muted-foreground" />
    <path d="M100 88 H134" {...ST} markerStart="url(#b)" markerEnd="url(#b)" />
    <text x="117" y="86" textAnchor="middle" {...txt}>espessura</text>
    <defs>
      <marker id="b" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
        <path d="M0 0 L7 3.5 L0 7" fill="currentColor" />
      </marker>
    </defs>
  </Diagrama>
);

// 4 — Distância entre treliças
const DiagTrelicas = (
  <Diagrama legenda="Distância (vão) entre uma treliça e a próxima.">
    {[70, 150].map((x) => (
      <path key={x} d={`M${x} 20 L${x - 16} 70 L${x + 16} 70 Z M${x - 16} 70 L${x} 44 L${x + 16} 70`} {...ST} />
    ))}
    <path d="M70 84 H150" {...ST} markerStart="url(#c)" markerEnd="url(#c)" />
    <text x="110" y="82" textAnchor="middle" {...txt}>distância</text>
    <defs>
      <marker id="c" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
        <path d="M0 0 L7 3.5 L0 7" fill="currentColor" />
      </marker>
    </defs>
  </Diagrama>
);

// 5 — Altura da saída do chupim
const DiagChupim = (
  <Diagrama legenda="Altura do chão até a SAÍDA do chupim (e qual equipamento ele alimenta).">
    <path d="M20 82 H240" {...ST} className="text-muted-foreground" />
    <path d="M30 82 L26 88 M50 82 L46 88 M70 82 L66 88 M90 82 L86 88" {...ST} className="text-muted-foreground" />
    <path d="M120 82 V34 H150" {...ST} fill="currentColor" fillOpacity="0.1" />
    <path d="M150 28 v12 l16 -6 Z" {...ST} fill="currentColor" />
    <path d="M104 82 V34" {...ST} markerStart="url(#d)" markerEnd="url(#d)" />
    <text x="92" y="60" textAnchor="end" {...txt}>altura</text>
    <defs>
      <marker id="d" markerWidth="7" markerHeight="7" refX="3.5" refY="3.5" orient="auto">
        <path d="M0 0 L7 3.5 L0 7" fill="currentColor" />
      </marker>
    </defs>
  </Diagrama>
);

// ====================================================================
// Config dos campos (ordem = numeração na tela). tipo_energia ficou de fora.
// ====================================================================
type CampoKey = Exclude<keyof ChecklistCompras, "motor_marca">;
type Campo = {
  key: CampoKey;
  label: string;
  placeholder: string;
  multiline?: boolean;
  diagrama?: ReactNode;
};

const CAMPOS: Campo[] = [
  { key: "posicao_pilares", label: "Posições de pilares (para possíveis posições de torres)", placeholder: "Descreva as posições dos pilares", multiline: true, diagrama: DiagPilares },
  { key: "medidas_alvenaria", label: "Medidas da alvenaria (comprimento × largura × altura)", placeholder: "Ex: 10m × 8m × 5m de altura", multiline: true, diagrama: DiagAlvenaria },
  { key: "parede_espessura_tipo", label: "Espessura das paredes + tipo (tijolo, bloco…)", placeholder: "Ex: 20cm, bloco de concreto", diagrama: DiagParede },
  { key: "distancia_trelicas", label: "Distância entre treliças (armação)", placeholder: "Ex: 2,5m", diagrama: DiagTrelicas },
  { key: "altura_chupim", label: "Altura da saída dos chupins (quando não tiver equip.) e o equip. que vai alimentar", placeholder: "Descreva a altura e o equipamento alimentado", multiline: true, diagrama: DiagChupim },
  { key: "material_linha", label: "Material que vai passar na linha", placeholder: "Ex: milho, soja, ração" },
  { key: "alimentacao_1o_chupim", label: "Como vai ser alimentado o 1º chupim (moega de cimento, moega padrão 500×500…)", placeholder: "Ex: moega padrão 500×500" },
  { key: "medidas_equip_existente", label: "Medidas do equip. existente", placeholder: "Medidas do equipamento já existente no local", multiline: true },
  { key: "obs_cliente", label: "Obs do cliente", placeholder: "Observações adicionais do cliente", multiline: true },
];

interface ChecklistComprasEditorProps {
  value: ChecklistCompras;
  onChange: (v: ChecklistCompras) => void;
}

export function ChecklistComprasEditor({ value, onChange }: ChecklistComprasEditorProps) {
  const set = <K extends keyof ChecklistCompras>(key: K, v: ChecklistCompras[K]) => {
    onChange({ ...value, [key]: v });
  };

  return (
    <div className="space-y-5">
      {CAMPOS.map((campo, i) => {
        const np = value[campo.key] === NAO_PRECISA;
        return (
          <div key={campo.key}>
            <div className="flex items-start justify-between gap-2">
              <Label className="font-medium">
                {i + 1}. {campo.label}
              </Label>
              <button
                type="button"
                onClick={() => set(campo.key, np ? "" : NAO_PRECISA)}
                aria-pressed={np}
                className={cn(
                  "shrink-0 rounded-md border px-2 py-1 text-xs transition-colors",
                  np
                    ? "border-destructive/40 bg-destructive/15 font-semibold text-destructive"
                    : "border-muted-foreground/30 text-muted-foreground hover:bg-muted"
                )}
              >
                {np ? "✓ Não precisa" : "Não precisa"}
              </button>
            </div>

            {np ? (
              <p className="mt-1 text-sm italic text-muted-foreground">
                Marcado como “não precisa” — não será considerado neste pedido.
              </p>
            ) : (
              <>
                {campo.diagrama}
                {campo.multiline ? (
                  <Textarea
                    value={value[campo.key]}
                    onChange={(e) => set(campo.key, e.target.value)}
                    placeholder={campo.placeholder}
                    className="mt-2 min-h-[80px] text-sm"
                  />
                ) : (
                  <Input
                    value={value[campo.key]}
                    onChange={(e) => set(campo.key, e.target.value)}
                    placeholder={campo.placeholder}
                    className="mt-2 text-sm"
                  />
                )}
              </>
            )}
          </div>
        );
      })}

      {/* Marca do motor (ÚNICO OBRIGATÓRIO) — sem "não precisa" */}
      <div>
        <Label className="font-medium">
          Marca do motor <span className="text-destructive">*</span>
        </Label>
        <Select
          value={value.motor_marca}
          onValueChange={(v) => set("motor_marca", v as ChecklistCompras["motor_marca"])}
        >
          <SelectTrigger className="mt-1">
            <SelectValue placeholder="Selecione a marca do motor" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="WEG">WEG</SelectItem>
            <SelectItem value="Mercosul">Mercosul</SelectItem>
            <SelectItem value="Qualquer marca">Qualquer marca</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
