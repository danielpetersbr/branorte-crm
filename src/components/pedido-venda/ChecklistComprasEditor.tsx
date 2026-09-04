import { useRef, useState } from "react";
import { Loader2, Trash2, Upload, ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { Textarea } from "@/components/pedido-ui/textarea";
import { Label } from "@/components/pedido-ui/label";
import { Button } from "@/components/pedido-ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/pedido-ui/select";
import { supabase } from "@/lib/controle-supabase/client";

// ===== CONTRATO COMPARTILHADO (idêntico no App2 — NÃO alterar nomes) =====
// O objeto inteiro trafega OPACO por gerar-pedido / enviar-docx-app2 /
// sync-pedidos-app2 até virar `producao_cards.checklist_compras` (jsonb).
// Por isso campos novos NÃO exigem migration nem deploy de edge do App1.
export type ImagemProjeto = {
  url: string;
  /** largura/altura em px — o App2 usa pra dimensionar a imagem no DOCX tratado */
  w: number;
  h: number;
};

export type ChecklistCompras = {
  // ===== ATUAL (2026-07-31) =====
  /** Texto livre que o vendedor escreve pro projeto. OBRIGATÓRIO. */
  informacoes_projeto: string;
  /** Rascunhos do equipamento. OBRIGATÓRIO ao menos 1. */
  imagens_projeto: ImagemProjeto[];
  motor_marca: "" | "WEG" | "Mercosul" | "Qualquer marca";

  // ===== LEGADO =====
  // Os 9 itens do antigo "Check List projeto" saíram da tela em 2026-07-31,
  // mas continuam no tipo pra que pedidos ANTIGOS (e o card do App2) sigam
  // lendo/exibindo o que já foi gravado. Nada novo escreve neles.
  posicao_pilares?: string;
  medidas_alvenaria?: string;
  parede_espessura_tipo?: string;
  distancia_trelicas?: string;
  altura_chupim?: string;
  material_linha?: string;
  alimentacao_1o_chupim?: string;
  tipo_energia?: string;
  medidas_equip_existente?: string;
  obs_cliente?: string;
};

export const DEFAULT_CHECKLIST_COMPRAS: ChecklistCompras = {
  informacoes_projeto: "",
  imagens_projeto: [],
  motor_marca: "",
};

/** Campos legados — usados só pra detectar pedido antigo preenchido. */
const CAMPOS_LEGADO = [
  "posicao_pilares",
  "medidas_alvenaria",
  "parede_espessura_tipo",
  "distancia_trelicas",
  "altura_chupim",
  "material_linha",
  "alimentacao_1o_chupim",
  "tipo_energia",
  "medidas_equip_existente",
  "obs_cliente",
] as const;

/** Retorna true se NADA (novo ou legado) estiver preenchido. */
export function isChecklistEmpty(c: ChecklistCompras): boolean {
  if (c.informacoes_projeto?.trim()) return false;
  if (c.imagens_projeto?.length) return false;
  if (c.motor_marca?.trim()) return false;
  return CAMPOS_LEGADO.every((k) => !String(c[k] ?? "").trim());
}

/**
 * Valida o bloco "Informações para o projeto".
 * Retorna a mensagem do 1º problema, ou null se está tudo certo.
 * Usado pra travar o botão de gerar pedido.
 */
export function validarChecklistProjeto(c: ChecklistCompras): string | null {
  if (!c.informacoes_projeto?.trim()) {
    return "Escreva as informações para o projeto";
  }
  if (!c.imagens_projeto?.length) {
    return "Envie ao menos 1 imagem do rascunho do equipamento";
  }
  return null;
}

// ====================================================================
// Upload de imagem — redimensiona no browser antes de subir (o App2 embute
// essa imagem no DOCX tratado; arquivo de celular cru estouraria o payload).
// ====================================================================
const MAX_LADO = 1600;
const MAX_IMAGENS = 6;

async function normalizarImagem(file: File): Promise<{ blob: Blob; w: number; h: number }> {
  const bitmap = await createImageBitmap(file);
  const escala = Math.min(1, MAX_LADO / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * escala));
  const h = Math.max(1, Math.round(bitmap.height * escala));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Não foi possível processar a imagem");
  // fundo branco: PNG com transparência vira preto no JPEG
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  if (!blob) throw new Error("Falha ao converter a imagem");
  return { blob, w, h };
}

interface ChecklistComprasEditorProps {
  value: ChecklistCompras;
  onChange: (v: ChecklistCompras) => void;
}

export function ChecklistComprasEditor({ value, onChange }: ChecklistComprasEditorProps) {
  const [enviando, setEnviando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const imagens = value.imagens_projeto ?? [];

  const set = <K extends keyof ChecklistCompras>(key: K, v: ChecklistCompras[K]) => {
    onChange({ ...value, [key]: v });
  };

  const handleArquivos = async (files: FileList | null) => {
    if (!files?.length) return;
    const restante = MAX_IMAGENS - imagens.length;
    if (restante <= 0) {
      toast.error(`Máximo de ${MAX_IMAGENS} imagens`);
      return;
    }

    setEnviando(true);
    const novas: ImagemProjeto[] = [];
    try {
      for (const file of Array.from(files).slice(0, restante)) {
        if (!file.type.startsWith("image/")) {
          toast.error(`"${file.name}" não é uma imagem`);
          continue;
        }
        const { blob, w, h } = await normalizarImagem(file);
        const path = `projeto-rascunhos/${crypto.randomUUID()}.jpg`;
        const { error } = await supabase.storage
          .from("pedidos")
          .upload(path, blob, { contentType: "image/jpeg", upsert: true });
        if (error) throw error;
        const { data } = supabase.storage.from("pedidos").getPublicUrl(path);
        novas.push({ url: data.publicUrl, w, h });
      }
      if (novas.length) {
        onChange({ ...value, imagens_projeto: [...imagens, ...novas] });
        toast.success(novas.length === 1 ? "Imagem enviada" : `${novas.length} imagens enviadas`);
      }
    } catch (err) {
      console.error("[checklist-projeto] erro no upload:", err);
      toast.error("Erro ao enviar a imagem. Tente novamente.");
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const removerImagem = (url: string) => {
    onChange({ ...value, imagens_projeto: imagens.filter((i) => i.url !== url) });
  };

  return (
    <div className="space-y-5">
      {/* 1. Informações para o projeto (obrigatório) */}
      <div>
        <Label htmlFor="informacoes-projeto" className="font-medium">
          Informações para o projeto <span className="text-destructive">*</span>
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Tudo que o projeto precisa saber: medidas do local, posição de pilares,
          altura, material que vai passar, o que já existe no cliente, etc.
        </p>
        <Textarea
          id="informacoes-projeto"
          value={value.informacoes_projeto ?? ""}
          onChange={(e) => set("informacoes_projeto", e.target.value)}
          placeholder="Escreva aqui as informações que o projeto precisa saber"
          className="mt-2 min-h-[160px] text-sm"
        />
      </div>

      {/* 2. Rascunho do equipamento (obrigatório) */}
      <div>
        <Label className="font-medium">
          Imagem do rascunho do equipamento <span className="text-destructive">*</span>
        </Label>
        <p className="mt-1 text-xs text-muted-foreground">
          Obrigatório mesmo quando o equipamento for padrão — suba a foto/rascunho de
          como vai ficar. Ela vai junto com o orçamento enviado para a produção.
        </p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          onChange={(e) => handleArquivos(e.target.files)}
        />

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={enviando || imagens.length >= MAX_IMAGENS}
            onClick={() => inputRef.current?.click()}
          >
            {enviando ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {enviando ? "Enviando..." : imagens.length ? "Adicionar imagem" : "Enviar imagem"}
          </Button>
          <span className="text-xs text-muted-foreground">
            {imagens.length}/{MAX_IMAGENS}
          </span>
        </div>

        {imagens.length === 0 ? (
          <div className="mt-3 flex flex-col items-center justify-center rounded-md border border-dashed py-8 text-muted-foreground">
            <ImageIcon className="h-8 w-8 opacity-50" />
            <p className="mt-2 text-xs">Nenhuma imagem enviada</p>
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {imagens.map((img) => (
              <div key={img.url} className="group relative overflow-hidden rounded-md border">
                <img
                  src={img.url}
                  alt="Rascunho do equipamento"
                  className="h-32 w-full bg-muted object-contain"
                />
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="absolute right-1 top-1 h-7 w-7"
                  onClick={() => removerImagem(img.url)}
                  aria-label="Remover imagem"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 3. Marca do motor */}
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
