/**
 * Import orcamentos-index.json -> public.orcamentos_files
 *
 * Idempotent: uses UPSERT on (ano, numero, path_principal).
 * Batches of 500 with retry/backoff.
 *
 * Usage:
 *   cd c:/temp/branorte-crm-source && npx tsx c:/temp/import-orcamentos.ts
 */
import { createClient } from "@supabase/supabase-js";
import * as fs from "fs";

const SUPABASE_URL = "https://flwbeevtvjiouxdjmziv.supabase.co";
const SERVICE_ROLE_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsd2JlZXZ0dmppb3V4ZGpteml2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1MTA0MDY3NiwiZXhwIjoyMDY2NjE2Njc2fQ.6zYh9j5Zcjv9mEPvbrR29Vaq5gr625SvgwonYYM3xPI";
const JSON_PATH = "c:/temp/orcamentos-index.json";
const BATCH_SIZE = 500;
const MAX_RETRIES = 4;

interface OrcamentoRaw {
  ano: number;
  numero: string;
  cliente: string;
  equipamento?: string;
  fase_eletrica?: string;
  extras?: string;
  extensoes_disponiveis?: string[];
  revisoes?: unknown[];
  qtd_arquivos_total?: number;
  status_kanban: string;
  subpasta?: string;
  path_principal: string;
  paths_por_extensao?: Record<string, string[]>;
  mtime_iso?: string;
  size_bytes_principal?: number;
}

interface OrcamentoRow {
  ano: number;
  numero: string;
  cliente: string;
  equipamento: string | null;
  fase_eletrica: string | null;
  extras: string | null;
  status_kanban: string;
  subpasta: string | null;
  path_principal: string;
  extensoes_disponiveis: string[];
  paths_por_extensao: Record<string, string[]>;
  revisoes: unknown[];
  qtd_arquivos_total: number | null;
  mtime_iso: string | null;
  size_bytes_principal: number | null;
}

function nullIfEmpty(v: string | undefined | null): string | null {
  if (v === undefined || v === null) return null;
  const trimmed = String(v).trim();
  return trimmed === "" ? null : trimmed;
}

function safeMtime(v: string | undefined | null): string | null {
  const s = nullIfEmpty(v);
  if (!s) return null;
  // Validate ISO-ish format
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function transform(o: OrcamentoRaw): OrcamentoRow {
  return {
    ano: o.ano,
    numero: o.numero,
    cliente: o.cliente,
    equipamento: nullIfEmpty(o.equipamento),
    fase_eletrica: nullIfEmpty(o.fase_eletrica),
    extras: nullIfEmpty(o.extras),
    status_kanban: o.status_kanban,
    subpasta: nullIfEmpty(o.subpasta),
    path_principal: o.path_principal,
    extensoes_disponiveis: Array.isArray(o.extensoes_disponiveis)
      ? o.extensoes_disponiveis
      : [],
    paths_por_extensao: o.paths_por_extensao ?? {},
    revisoes: Array.isArray(o.revisoes) ? o.revisoes : [],
    qtd_arquivos_total:
      typeof o.qtd_arquivos_total === "number" ? o.qtd_arquivos_total : null,
    mtime_iso: safeMtime(o.mtime_iso),
    size_bytes_principal:
      typeof o.size_bytes_principal === "number"
        ? o.size_bytes_principal
        : null,
  };
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  console.log(`[load] reading ${JSON_PATH} ...`);
  const raw = fs.readFileSync(JSON_PATH, "utf-8");
  const parsed = JSON.parse(raw) as {
    metadata: { orcamentos_unicos: number };
    orcamentos: OrcamentoRaw[];
  };
  console.log(
    `[load] expected=${parsed.metadata.orcamentos_unicos}  got=${parsed.orcamentos.length}`
  );

  const rows = parsed.orcamentos.map(transform);

  // Deduplicate within input by uniq key (ano, numero, path_principal)
  const seen = new Set<string>();
  const dedup: OrcamentoRow[] = [];
  for (const r of rows) {
    const k = `${r.ano}|${r.numero}|${r.path_principal}`;
    if (seen.has(k)) continue;
    seen.add(k);
    dedup.push(r);
  }
  if (dedup.length !== rows.length) {
    console.log(
      `[dedup] removed ${rows.length - dedup.length} duplicates within input`
    );
  }

  const supa = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const total = dedup.length;
  const batches = Math.ceil(total / BATCH_SIZE);
  console.log(`[upload] ${total} rows in ${batches} batches of ${BATCH_SIZE}`);

  let inserted = 0;
  let errors: Array<{ batch: number; error: string }> = [];

  for (let i = 0; i < batches; i++) {
    const start = i * BATCH_SIZE;
    const slice = dedup.slice(start, start + BATCH_SIZE);

    let attempt = 0;
    let success = false;
    let lastErr = "";

    while (attempt < MAX_RETRIES && !success) {
      attempt++;
      const { error } = await supa
        .from("orcamentos_files")
        .upsert(slice, {
          onConflict: "ano,numero,path_principal",
          ignoreDuplicates: false,
        });

      if (!error) {
        success = true;
      } else {
        lastErr = error.message;
        const backoff = 500 * Math.pow(2, attempt - 1);
        console.log(
          `[batch ${i + 1}/${batches}] attempt ${attempt} failed: ${lastErr} - retrying in ${backoff}ms`
        );
        await sleep(backoff);
      }
    }

    if (success) {
      inserted += slice.length;
      console.log(
        `[batch ${i + 1}/${batches}] OK · ${slice.length} rows · cumulative ${inserted}/${total}`
      );
    } else {
      errors.push({ batch: i + 1, error: lastErr });
      console.error(
        `[batch ${i + 1}/${batches}] FAILED after ${MAX_RETRIES} retries: ${lastErr}`
      );
    }
  }

  console.log(
    `\n[done] inserted/upserted=${inserted}  errors=${errors.length}`
  );
  if (errors.length > 0) {
    console.error("[errors]", JSON.stringify(errors, null, 2));
    process.exit(1);
  }
}

main().catch((e: unknown) => {
  console.error("[fatal]", e);
  process.exit(1);
});
