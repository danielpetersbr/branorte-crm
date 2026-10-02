import { createClient } from '@supabase/supabase-js';
import { pedidoNoEscopoEspelho as pedidoNoEscopo, type EscopoEspelho as Escopo } from './producao-espelho-acesso.js';

export type ReciboEspelho = { data: unknown[] | null; count: number | null; error: unknown };
interface ConsultaEspelho {
  in(column: string, ids: string[]): ConsultaEspelho;
  order(column: string, options: { ascending: true }): ConsultaEspelho;
  range(from: number, to: number): ConsultaEspelho;
  abortSignal(signal: AbortSignal): PromiseLike<ReciboEspelho>;
}
export interface FonteEspelho { from(table: string): { select(columns: string, options: { count: 'exact' }): ConsultaEspelho } }
type Linha = Record<string, unknown>;
export type ProjetoEspelho = { id: string; card_id: string; responsavel_projeto_id: string | null; status_projeto: string | null; andamento: number | null; previsao_termino: string | null; prazo_prometido: string | null; prazo_interno: string | null; responsavel_nome: string | null };
type DadosCard = Linha & { checklist_compras: string | null; vinculo: 'confirmado' | 'nao_verificado'; historico: Linha[]; logistica: Linha | null; setores: Array<Linha & { checklists: Linha[] }>; projeto?: ProjetoEspelho | null };
export type CardEspelho = { id: string; pedidoId: string | null; numeroOrcamento: string | null; cliente: string; vendedor: string | null; etapa: string; atualizadoEm: string; dadosOriginais: DadosCard };
export type EnvelopeEspelho = {
  origem: 'app2'; fonte: 'controle-producao-live'; consultadoEm: string; atualizadoEm: null; sincronizadoEm: null;
  parcial: false; aviso: string; consistency: 'crossread_unproved';
  complete: { cards: true; historico: true; logistica: true; setores: true; checklists: true };
  totals: { cards: number; historico: number; logistica: number; setores: number; checklists: number };
  dados: { cards: CardEspelho[]; kpis: Record<string, number>; porEtapa: Record<string, number>; porSetor: Record<string, number> };
};
type ConfigEspelho = { PRODUCAO_SUPABASE_URL?: string; PRODUCAO_PRIVATE_READ_KEY?: string; CONTROLE_SUPABASE_URL?: string; CONTROLE_SERVICE_KEY?: string };
type FabricaEspelho = (url: string, key: string, options: { auth: { persistSession: false; autoRefreshToken: false; detectSessionInUrl: false } }) => FonteEspelho;
export type ReciboPais = { complete: true; rows: unknown[] };
export type DepsEspelho = { fonte?: () => FonteEspelho | Promise<FonteEspelho>; fontePais?: () => FonteEspelho | Promise<FonteEspelho>; pais?: (ids: string[], signal: AbortSignal) => Promise<ReciboPais>; agora?: () => number; instante?: () => string; deadlineMs?: number; signal?: AbortSignal };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES = ['admin', 'financeiro', 'vendor', 'mapa', 'marketing', 'visualizador'];
const MAX_ROWS = 100000, PAGE_SIZE = 1000, BATCH_SIZE = 100;
const AVISO = 'Leituras independentes; consistência entre coleções não comprovada.';
const own = (v: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (): never => { throw Error('producao_indisponivel'); };
const record = (v: unknown): Linha => { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(); return v as Linha; };
const fields = (v: Linha, keys: readonly string[]) => { if (!keys.every(k => own(v, k))) fail(); };
const uuid = (v: unknown) => typeof v === 'string' && UUID.test(v);
const key = (v: unknown): string => { if (!uuid(v)) return fail(); return (v as string).toLowerCase(); };
const string = (v: unknown) => typeof v === 'string';
const int4 = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
const bool = (v: unknown) => typeof v === 'boolean';
const professionalName = (v: unknown) => typeof v === 'string' && v.trim().length > 0;
const numericText = (v: unknown) => typeof v === 'string' && /^(?:NaN|-?Infinity|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(v);
type Field = { name: string; test: (v: unknown) => boolean; nullable: boolean };
const required = (names: string, test: (v: unknown) => boolean = string): Field[] => names.split(',').map(name => ({ name, test, nullable: false }));
const nullable = (names: string, test: (v: unknown) => boolean = string): Field[] => names.split(',').map(name => ({ name, test, nullable: true }));
const CARD = [...required('id', uuid), ...required('pedido_id,cliente_nome,vendedor_nome,status,doc_original_path,created_at,updated_at'), ...required('excluido', bool), ...nullable('doc_tratado_path,prazo_tipo,prazo_data,observacoes,numero_orcamento,motor_marca,motor_tensao,resumo_equipamentos,titulo_equipamento,codigo_rastreio,cidade_destino,observacao_vendedor,parado_status,parado_motivo,orcamento_revisado_info,motor_tensao_vendedor,excluido_em,parado_em,orcamento_revisado_em,orcamento_revisado_visto_em'), ...nullable('prazo_dias', int4), ...nullable('excluido_por', uuid)];
const HISTORY = [...required('id,card_id', uuid), ...required('new_status,changed_at'), ...nullable('old_status,cliente_nome,numero_orcamento'), ...nullable('changed_by', uuid)];
const LOGISTICS = [...required('card_id', uuid), ...required('updated_at'), ...nullable('peso_kg', numericText), ...nullable('medidas,observacoes'), ...nullable('qtd_volumes', int4), ...nullable('updated_by', uuid)];
const SECTOR = [...required('id,card_id', uuid), ...required('setor'), ...nullable('responsavel_id', uuid), ...nullable('previsao_termino,status,motivo_bloqueio,iniciado_em,concluido_em,created_at,updated_at'), ...nullable('andamento', int4)];
const CHECKLIST = [...required('id,setor_producao_id', uuid), ...required('titulo'), ...nullable('descricao,concluido_em,created_at'), ...nullable('ordem', int4), ...nullable('concluido', bool), ...nullable('concluido_por', uuid)];
const PARENT = [...required('id', uuid), ...nullable('vendedor,vendedor_2')];
const PROJECT = [...required('id,card_id', uuid), ...nullable('responsavel_projeto_id', uuid), ...nullable('status_projeto'), ...nullable('andamento', int4), ...nullable('previsao_termino,prazo_prometido,prazo_interno')];
const PROFESSIONAL = [...required('id', uuid), ...required('nome', professionalName)];
const schemas = { producao_cards: CARD, producao_status_log: HISTORY, producao_logistica: LOGISTICS, setor_producao: SECTOR, setor_checklist: CHECKLIST, pedidos_venda: PARENT, projeto_detalhes: PROJECT, projetistas: PROFESSIONAL };
type Table = keyof typeof schemas;

/** No role/name from source can widen this CRM-authorized scope. */
export function validarEscopoEspelho(input: unknown): Escopo {
  const scope = record(input); fields(scope, ['userId', 'role', 'vendedores']);
  if (!uuid(scope.userId) || typeof scope.role !== 'string' || !ROLES.includes(scope.role)) return fail();
  if (scope.vendedores === null) { if (!['admin', 'financeiro'].includes(scope.role)) return fail(); }
  else {
    if (!Array.isArray(scope.vendedores) || !scope.vendedores.length || scope.vendedores.length > MAX_ROWS) return fail();
    for (let i = 0; i < scope.vendedores.length; i++) if (!own(scope.vendedores, i) || typeof scope.vendedores[i] !== 'string' || !scope.vendedores[i].trim()) return fail();
  }
  return { userId: scope.userId as string, role: scope.role, displayName: typeof scope.displayName === 'string' ? scope.displayName : '', vendedores: scope.vendedores === null ? null : [...scope.vendedores as string[]] };
}

/** Shape only: provider/runtime rights must still be verified independently. */
export function criarFonteEspelhoPrivada(config: ConfigEspelho, channel: 'fabrica' | 'pais', create: FabricaEspelho = (url, secret, options) => createClient(url, secret, options) as unknown as FonteEspelho): FonteEspelho {
  try {
    if (channel !== 'fabrica' && channel !== 'pais') return fail();
    const names = channel === 'fabrica' ? ['PRODUCAO_SUPABASE_URL', 'PRODUCAO_PRIVATE_READ_KEY'] as const : ['CONTROLE_SUPABASE_URL', 'CONTROLE_SERVICE_KEY'] as const;
    const ref = channel === 'fabrica' ? 'yyfosrvlpsaycjnxcnkj' : 'kfucuvwrnwrkshxpsmyq';
    const cfg = record(config); if (Object.keys(cfg).some(k => !(names as readonly string[]).includes(k))) return fail();
    const url = cfg[names[0]], secret = cfg[names[1]], root = `https://${ref}.supabase.co`;
    if (url !== root && url !== root + '/') return fail();
    if (typeof secret !== 'string' || /[\s\u0000-\u001f\u007f]/.test(secret)) return fail();
    if (!/^sb_secret_[A-Za-z0-9_-]{20,}$/.test(secret)) {
      if (!/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(secret)) return fail();
      const header = record(JSON.parse(Buffer.from(secret.split('.')[0], 'base64url').toString('utf8')));
      const payload = record(JSON.parse(Buffer.from(secret.split('.')[1], 'base64url').toString('utf8')));
      fields(header, ['alg']); fields(payload, ['role', 'ref']);
      if (header.alg !== 'HS256' || payload.role !== 'service_role' || payload.ref !== ref) return fail();
    }
    return create(url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  } catch { return fail(); }
}

/** PostgreSQL JSONB text survives number parsing unchanged; parsed values are temporary. */
function json(value: unknown, check: () => void) {
  check(); if (value === null) return { value: null, bytes: 0 };
  if (typeof value !== 'string') return fail();
  const bytes = Buffer.byteLength(value, 'utf8'); check(); if (bytes > 1048576) return fail();
  const parsed: unknown = JSON.parse(value); check(); let nodes = 0;
  const stack = [{ value: parsed, depth: 0 }];
  while (stack.length) {
    check(); const current = stack.pop()!; if (++nodes > 10000 || current.depth > 16) return fail();
    // Syntactically valid huge JSON numbers can parse as Infinity. Their original
    // lexemes remain in value; parsed numbers are never returned or stringified.
    if (current.value !== null && typeof current.value === 'object') {
      const children = Array.isArray(current.value) ? current.value : Object.values(current.value);
      if (children.length > 10000) return fail();
      for (const child of children) { check(); stack.push({ value: child, depth: current.depth + 1 }); }
    }
  }
  check(); return { value, bytes };
}
function physical(value: unknown, table: Table, check: () => void): Linha {
  check(); const row = record(value), schema = schemas[table]; fields(row, schema.map(f => f.name)); const entries: Array<[string, unknown]> = [];
  for (const f of schema) { check(); const v = row[f.name]; if (!(f.nullable && v === null) && !f.test(v)) return fail(); entries.push([f.name, v]); }
  if (table === 'producao_cards') { fields(row, ['checklist_compras']); entries.push(['checklist_compras', json(row.checklist_compras, check).value]); } return Object.fromEntries(entries);
}
function projectPhysical(value: unknown, cardId: unknown, check: () => void): ProjetoEspelho {
  check(); const input = record(value), row = physical(input, 'projeto_detalhes', check); fields(input, ['responsavel_nome']);
  const nome = input.responsavel_nome;
  if (key(row.card_id) !== key(cardId) || (row.responsavel_projeto_id === null ? nome !== null : !professionalName(nome))) return fail();
  return { ...row, responsavel_nome: nome } as ProjetoEspelho;
}
function dense(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > MAX_ROWS) return fail(); for (let i = 0; i < value.length; i++) if (!own(value, i)) return fail(); return value; }
function unique(rows: Linha[], column = 'id') { const ids = new Set<string>(); for (const row of rows) { const id = key(row[column]); if (ids.has(id)) return fail(); ids.add(id); } return ids; }
function countBy(values: string[]) { const counts = new Map<string, number>(); for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1); return Object.fromEntries(counts); }
function assemble(cards: CardEspelho[], instant: string): EnvelopeEspelho {
  const sectors = cards.flatMap(c => c.dadosOriginais.setores);
  return { origem: 'app2', fonte: 'controle-producao-live', consultadoEm: instant, atualizadoEm: null, sincronizadoEm: null, parcial: false, aviso: AVISO, consistency: 'crossread_unproved',
    complete: { cards: true, historico: true, logistica: true, setores: true, checklists: true },
    totals: { cards: cards.length, historico: cards.reduce((n, c) => n + c.dadosOriginais.historico.length, 0), logistica: cards.filter(c => c.dadosOriginais.logistica !== null).length, setores: sectors.length, checklists: sectors.reduce((n, s) => n + s.checklists.length, 0) },
    dados: { cards, kpis: { total: cards.length, excluidos: cards.filter(c => c.dadosOriginais.excluido === true).length, ativos: cards.filter(c => c.dadosOriginais.excluido === false && !['ENTREGUE', 'CANCELADO'].includes(c.etapa)).length, entregues: cards.filter(c => c.dadosOriginais.excluido === false && c.etapa === 'ENTREGUE').length, cancelados: cards.filter(c => c.dadosOriginais.excluido === false && c.etapa === 'CANCELADO').length, pedidosUnicos: new Set(cards.flatMap(c => c.pedidoId ? [c.pedidoId.toLowerCase()] : [])).size }, porEtapa: countBy(cards.map(c => c.etapa)), porSetor: countBy(sectors.map(s => s.setor as string)) } };
}

/** Revalidates injection output before HTTP, projecting only public allowlisted fields. */
export function projetarEspelhoProducao(input: unknown, scopeInput: Escopo, check: () => void = () => {}): EnvelopeEspelho {
  try {
    check(); const scope = validarEscopoEspelho(scopeInput), dto = record(input);
    fields(dto, ['origem', 'fonte', 'consultadoEm', 'atualizadoEm', 'sincronizadoEm', 'parcial', 'aviso', 'consistency', 'complete', 'totals', 'dados']);
    const complete = record(dto.complete); fields(complete, ['cards', 'historico', 'logistica', 'setores', 'checklists']);
    if (dto.origem !== 'app2' || dto.fonte !== 'controle-producao-live' || dto.atualizadoEm !== null || dto.sincronizadoEm !== null || dto.parcial !== false || typeof dto.aviso !== 'string' || dto.consistency !== 'crossread_unproved' || Object.values(complete).some(v => v !== true) || typeof dto.consultadoEm !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(dto.consultadoEm) || !Number.isFinite(Date.parse(dto.consultadoEm))) return fail();
    const totals = record(dto.totals), totalFields = ['cards', 'historico', 'logistica', 'setores', 'checklists'] as const;
    fields(totals, totalFields);
    for (const field of totalFields) { check(); const count = totals[field]; if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return fail(); }
    const data = record(dto.dados); fields(data, ['cards', 'kpis', 'porEtapa', 'porSetor']);
    record(data.kpis); record(data.porEtapa); record(data.porSetor);
    const cards: CardEspelho[] = [], historyIds = new Set<string>(), sectorIds = new Set<string>(), checkIds = new Set<string>(), projectIds = new Set<string>(); let total = 0, jsonBytes = 0;
    const reserve = (count: number) => { check(); total += count; if (total > MAX_ROWS) fail(); };
    const dedup = (row: Linha, ids: Set<string>) => { check(); const id = key(row.id); if (ids.has(id)) fail(); ids.add(id); };
    for (const candidate of dense(data.cards)) {
      check(); reserve(1); const c = record(candidate); fields(c, ['id', 'pedidoId', 'numeroOrcamento', 'cliente', 'vendedor', 'etapa', 'atualizadoEm', 'dadosOriginais']);
      const raw = record(c.dadosOriginais), row = physical(raw, 'producao_cards', check); fields(raw, ['vinculo', 'historico', 'logistica', 'setores']);
      if (c.id !== row.id || c.numeroOrcamento !== row.numero_orcamento || c.cliente !== row.cliente_nome || c.vendedor !== row.vendedor_nome || c.etapa !== row.status || c.atualizadoEm !== row.updated_at) return fail();
      if (scope.vendedores === null) { if (c.pedidoId !== null || raw.vinculo !== 'nao_verificado') return fail(); }
      else if (!uuid(c.pedidoId) || key(c.pedidoId) !== key(row.pedido_id) || raw.vinculo !== 'confirmado') return fail();
      jsonBytes += json(row.checklist_compras, check).bytes; if (jsonBytes > 8388608) return fail();
      const historico = dense(raw.historico).map(v => { reserve(1); const h = physical(v, 'producao_status_log', check); if (key(h.card_id) !== key(row.id)) return fail(); dedup(h, historyIds); return h; });
      let logistica: Linha | null = null; if (raw.logistica !== null) { reserve(1); logistica = physical(raw.logistica, 'producao_logistica', check); if (key(logistica.card_id) !== key(row.id)) return fail(); }
      const setores = dense(raw.setores).map(v => { reserve(1); const inputSector = record(v), s = physical(inputSector, 'setor_producao', check); fields(inputSector, ['checklists']); if (key(s.card_id) !== key(row.id)) return fail(); dedup(s, sectorIds);
        const checklists = dense(inputSector.checklists).map(v => { reserve(1); const ch = physical(v, 'setor_checklist', check); if (key(ch.setor_producao_id) !== key(s.id)) return fail(); dedup(ch, checkIds); return ch; }); return { ...s, checklists }; });
      // Legacy DTOs omit projeto. New readers always supply null or a closed object.
      const extraProject: { projeto?: ProjetoEspelho | null } = {};
      if (own(raw, 'projeto')) {
        if (raw.projeto === null) extraProject.projeto = null;
        else { reserve(1); const p = projectPhysical(raw.projeto, row.id, check); dedup(p, projectIds); extraProject.projeto = p; }
      }
      cards.push({ id: row.id as string, pedidoId: c.pedidoId as string | null, numeroOrcamento: row.numero_orcamento as string | null, cliente: row.cliente_nome as string, vendedor: row.vendedor_nome as string, etapa: row.status as string, atualizadoEm: row.updated_at as string, dadosOriginais: { ...row, checklist_compras: row.checklist_compras as string | null, vinculo: scope.vendedores === null ? 'nao_verificado' : 'confirmado', historico, logistica, setores, ...extraProject } });
    }
    unique(cards as unknown as Linha[]); check(); const out = assemble(cards, dto.consultadoEm); check();
    for (const field of totalFields) { check(); if (totals[field] !== out.totals[field]) return fail(); }
    const responseBytes = Buffer.byteLength(JSON.stringify(out), 'utf8'); check();
    if (responseBytes > 4000000) return fail(); return out;
  } catch { return fail(); }
}

/** Five original collections plus scoped project/name lookups; independent SELECTs do not promise a snapshot. */
export async function lerProducaoEspelho(scopeInput: Escopo, deps: DepsEspelho = {}): Promise<EnvelopeEspelho> {
  const scope = validarEscopoEspelho(scopeInput), duration = deps.deadlineMs ?? 30000;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 30000) return fail();
  const controller = new AbortController(), now = deps.agora ?? (() => performance.now());
  const start = now(), expires = start + duration; let last = start, used = 0;
  const check = () => { const t = now(); if (!Number.isFinite(t) || !Number.isFinite(start) || t < last || t >= expires || controller.signal.aborted) return fail(); last = t; };
  let active = 0;
  const queued: Array<{ start: () => void; reject: (error: Error) => void }> = [];
  let timer: ReturnType<typeof setTimeout> | undefined, rejectStop: (e: Error) => void = () => {};
  const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
  const stop = () => { controller.abort(); const error = Error('producao_indisponivel'); for (const job of queued.splice(0)) job.reject(error); rejectStop(error); };
  deps.signal?.addEventListener('abort', stop, { once: true }); timer = setTimeout(stop, duration);
  const drain = () => { while (!controller.signal.aborted && active < 4 && queued.length) queued.shift()!.start(); };
  // One limit for this invocation, shared by every table and UUID batch. Keep
  // the slot through receipt validation so failure aborts before queued SQL.
  const limited = <T>(read: () => Promise<T>): Promise<T> => new Promise((resolve, reject) => {
    if (controller.signal.aborted) { reject(Error('producao_indisponivel')); return; }
    const begin = () => {
      try { check(); } catch { stop(); reject(Error('producao_indisponivel')); return; }
      active++;
      void (async () => {
        try { const value = await read(); check(); resolve(value); }
        catch { stop(); reject(Error('producao_indisponivel')); }
        finally { active--; drain(); }
      })();
    };
    queued.push({ start: begin, reject }); drain();
  });
  const reserve = (n: number) => { check(); used += n; if (used > MAX_ROWS) return fail(); };
  const collection = (source: FonteEspelho, table: Table, filter?: { field: string; ids: string[] }): Promise<Linha[]> => limited(async () => {
    const rows: Linha[] = []; let total: number | undefined, previousId: string | undefined; const allowed = filter ? new Set(filter.ids) : undefined;
    const columns = schemas[table].map(f => f.name === 'peso_kg' ? 'peso_kg:peso_kg::text' : f.name).concat(table === 'producao_cards' ? ['checklist_compras:checklist_compras::text'] : []).join(',');
    for (let offset = 0; ; offset += PAGE_SIZE) {
      check(); let q = source.from(table).select(columns, { count: 'exact' }); if (filter) q = q.in(filter.field, filter.ids);
      const receipt = await q.order(table === 'producao_logistica' ? 'card_id' : 'id', { ascending: true }).range(offset, offset + PAGE_SIZE - 1).abortSignal(controller.signal); check();
      fields(record(receipt), ['data', 'count', 'error']);
      if (!receipt || receipt.error !== null && receipt.error !== undefined || !Number.isSafeInteger(receipt.count) || receipt.count === null || receipt.count < 0 || receipt.count > MAX_ROWS) return fail();
      if (total === undefined) { total = receipt.count; reserve(total); } else if (receipt.count !== total) return fail();
      const page = dense(receipt.data); if (page.length !== Math.min(PAGE_SIZE, Math.max(0, total - offset))) return fail();
      for (const value of page) { check(); const row = physical(value, table, check); if (filter && !allowed!.has(key(row[filter.field]))) return fail();
        const rowId = key(row[table === 'producao_logistica' ? 'card_id' : 'id']); if (previousId !== undefined && rowId <= previousId) return fail(); previousId = rowId; rows.push(row); }
      if (offset + PAGE_SIZE >= total) break;
    }
    unique(rows, table === 'producao_logistica' ? 'card_id' : 'id'); check(); return rows;
  });
  const batches = async (source: FonteEspelho, table: Table, field: string, ids: string[]) => {
    const requested = [...new Set(ids.map(key))];
    const rows = (await Promise.all(Array.from({ length: Math.ceil(requested.length / BATCH_SIZE) }, async (_, batch) => {
      check(); const offset = batch * BATCH_SIZE;
      return collection(source, table, { field, ids: requested.slice(offset, offset + BATCH_SIZE) });
    }))).flat(); check();
    unique(rows, table === 'producao_logistica' ? 'card_id' : 'id'); return rows;
  };
  try {
    const work = async () => {
      if (deps.signal?.aborted) stop(); check();
      const source = await (deps.fonte ?? (() => criarFonteEspelhoPrivada({ PRODUCAO_SUPABASE_URL: process.env.PRODUCAO_SUPABASE_URL, PRODUCAO_PRIVATE_READ_KEY: process.env.PRODUCAO_PRIVATE_READ_KEY }, 'fabrica')))(); check();
      const allCards = await collection(source, 'producao_cards'); check(); let parents: Linha[] = [];
      if (scope.vendedores !== null) {
        const ids = [...new Set(allCards.flatMap(c => uuid(c.pedido_id) ? [key(c.pedido_id)] : []))];
        const candidates = new Set(ids);
        if (deps.pais) { const receipt = await deps.pais(ids, controller.signal); check(); const r = record(receipt); fields(r, ['complete', 'rows']); if (r.complete !== true) return fail(); const rows = dense(r.rows); reserve(rows.length); parents = rows.map(v => physical(v, 'pedidos_venda', check)); }
        else {
          // Creating the channel is mandatory even when there are no candidates.
          const parentSource = await (deps.fontePais ?? (() => criarFonteEspelhoPrivada({ CONTROLE_SUPABASE_URL: process.env.CONTROLE_SUPABASE_URL, CONTROLE_SERVICE_KEY: process.env.CONTROLE_SERVICE_KEY }, 'pais')))(); check(); parents = await batches(parentSource, 'pedidos_venda', 'id', ids); check();
        }
        unique(parents); for (const parent of parents) { check(); if (!candidates.has(key(parent.id))) return fail(); }
      }
      const parentMap = new Map(parents.map(p => [key(p.id), p]));
      const cards = allCards.filter(c => { check(); if (scope.vendedores === null) return true; const parent = uuid(c.pedido_id) ? parentMap.get(key(c.pedido_id)) : undefined; return !!parent && pedidoNoEscopo({ vendedor: parent.vendedor as string | null, vendedor_2: parent.vendedor_2 as string | null }, scope); });
      const cardIds = cards.map(c => key(c.id));
      const [histories, logistics, { sectors, checklists }, { projects, professionals }] = await Promise.all([
        batches(source, 'producao_status_log', 'card_id', cardIds),
        batches(source, 'producao_logistica', 'card_id', cardIds),
        (async () => {
          const sectors = await batches(source, 'setor_producao', 'card_id', cardIds); check();
          const checklists = await batches(source, 'setor_checklist', 'setor_producao_id', sectors.map(s => key(s.id))); check();
          return { sectors, checklists };
        })(),
        (async () => {
          // Project ownership comes from projetistas, never source Auth/profiles or card display names.
          const projects = await batches(source, 'projeto_detalhes', 'card_id', cardIds); check(); unique(projects, 'card_id');
          const professionals = await batches(source, 'projetistas', 'id', projects.flatMap(p => p.responsavel_projeto_id === null ? [] : [key(p.responsavel_projeto_id)])); check();
          return { projects, professionals };
        })(),
      ]); check();
      const professionalMap = new Map(professionals.map(p => [key(p.id), p.nome]));
      const projectMap = new Map(projects.map(p => {
        check(); const nome = p.responsavel_projeto_id === null ? null : professionalMap.get(key(p.responsavel_projeto_id));
        const projected = projectPhysical({ ...p, responsavel_nome: nome }, p.card_id, check);
        return [key(p.card_id), projected] as const;
      }));
      const group = (rows: Linha[], column: string) => { const map = new Map<string, Linha[]>(); for (const row of rows) { check(); const k = key(row[column]), list = map.get(k) ?? []; list.push(row); map.set(k, list); } return map; };
      const hs = group(histories, 'card_id'), ls = new Map(logistics.map(l => [key(l.card_id), l])), ss = group(sectors, 'card_id'), cs = group(checklists, 'setor_producao_id');
      const projected: CardEspelho[] = cards.map(c => { check(); const parent = scope.vendedores !== null ? parentMap.get(key(c.pedido_id)) : undefined;
        return { id: c.id as string, pedidoId: parent ? parent.id as string : null, numeroOrcamento: c.numero_orcamento as string | null, cliente: c.cliente_nome as string, vendedor: c.vendedor_nome as string, etapa: c.status as string, atualizadoEm: c.updated_at as string,
          dadosOriginais: { ...c, checklist_compras: c.checklist_compras as string | null, vinculo: parent ? 'confirmado' : 'nao_verificado', historico: hs.get(key(c.id)) ?? [], logistica: ls.get(key(c.id)) ?? null, setores: (ss.get(key(c.id)) ?? []).map(s => ({ ...s, checklists: cs.get(key(s.id)) ?? [] })), projeto: projectMap.get(key(c.id)) ?? null } }; });
      check(); const instant = (deps.instante ?? (() => new Date().toISOString()))(); check(); return projetarEspelhoProducao(assemble(projected, instant), scope, check);
    };
    return await Promise.race([work(), stopped]);
  } catch { stop(); return fail(); }
  finally { if (timer !== undefined) clearTimeout(timer); deps.signal?.removeEventListener('abort', stop); }
}
