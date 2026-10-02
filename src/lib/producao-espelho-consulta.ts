// Browser-owned physical contract; never imports a server reader/client.
const utf8=(text:string)=>new TextEncoder().encode(text).byteLength;
type Linha = Record<string, unknown>;
type DadosCard = Linha & { checklist_compras: string | null; vinculo: 'confirmado' | 'nao_verificado'; historico: Linha[]; logistica: Linha | null; setores: Array<Linha & { checklists: Linha[] }> };
export type CardEspelho = { id: string; pedidoId: string | null; numeroOrcamento: string | null; cliente: string; vendedor: string | null; etapa: string; atualizadoEm: string; dadosOriginais: DadosCard };
export type ConsultaEspelho = {
  origem: 'app2'; fonte: 'controle-producao-live'; consultadoEm: string; atualizadoEm: null; sincronizadoEm: null;
  parcial: false; aviso: string; consistency: 'crossread_unproved';
  complete: { cards: true; historico: true; logistica: true; setores: true; checklists: true };
  totals: { cards: number; historico: number; logistica: number; setores: number; checklists: number };
  dados: { cards: CardEspelho[]; kpis: Record<string, number>; porEtapa: Record<string, number>; porSetor: Record<string, number> };
};
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 100000;
const AVISO = 'Leituras independentes; consistência entre coleções não comprovada.';
const own = (v: object, k: PropertyKey) => Object.prototype.hasOwnProperty.call(v, k);
const fail = (): never => { throw Error('Produção indisponível. Tente atualizar a leitura.'); };
const record = (v: unknown): Linha => { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(); return v as Linha; };
const fields = (v: Linha, keys: readonly string[]) => { if (!keys.every(k => own(v, k))) fail(); };
const uuid = (v: unknown) => typeof v === 'string' && UUID.test(v);
const key = (v: unknown): string => { if (!uuid(v)) return fail(); return (v as string).toLowerCase(); };
const string = (v: unknown) => typeof v === 'string';
const int4 = (v: unknown) => typeof v === 'number' && Number.isInteger(v) && v >= -2147483648 && v <= 2147483647;
const bool = (v: unknown) => typeof v === 'boolean';
const numericText = (v: unknown) => typeof v === 'string' && /^(?:NaN|-?Infinity|[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)$/.test(v);
type Field = { name: string; test: (v: unknown) => boolean; nullable: boolean };
const required = (names: string, test: (v: unknown) => boolean = string): Field[] => names.split(',').map(name => ({ name, test, nullable: false }));
const nullable = (names: string, test: (v: unknown) => boolean = string): Field[] => names.split(',').map(name => ({ name, test, nullable: true }));
const CARD = [...required('id', uuid), ...required('pedido_id,cliente_nome,vendedor_nome,status,doc_original_path,created_at,updated_at'), ...required('excluido', bool), ...nullable('doc_tratado_path,prazo_tipo,prazo_data,observacoes,numero_orcamento,motor_marca,motor_tensao,resumo_equipamentos,titulo_equipamento,codigo_rastreio,cidade_destino,observacao_vendedor,parado_status,parado_motivo,orcamento_revisado_info,motor_tensao_vendedor,excluido_em,parado_em,orcamento_revisado_em,orcamento_revisado_visto_em'), ...nullable('prazo_dias', int4), ...nullable('excluido_por', uuid)];
const HISTORY = [...required('id,card_id', uuid), ...required('new_status,changed_at'), ...nullable('old_status,cliente_nome,numero_orcamento'), ...nullable('changed_by', uuid)];
const LOGISTICS = [...required('card_id', uuid), ...required('updated_at'), ...nullable('peso_kg', numericText), ...nullable('medidas,observacoes'), ...nullable('qtd_volumes', int4), ...nullable('updated_by', uuid)];
const SECTOR = [...required('id,card_id', uuid), ...required('setor'), ...nullable('responsavel_id', uuid), ...nullable('previsao_termino,status,motivo_bloqueio,iniciado_em,concluido_em,created_at,updated_at'), ...nullable('andamento', int4)];
const CHECKLIST = [...required('id,setor_producao_id', uuid), ...required('titulo'), ...nullable('descricao,concluido_em,created_at'), ...nullable('ordem', int4), ...nullable('concluido', bool), ...nullable('concluido_por', uuid)];
const schemas = { producao_cards: CARD, producao_status_log: HISTORY, producao_logistica: LOGISTICS, setor_producao: SECTOR, setor_checklist: CHECKLIST };
type Table = keyof typeof schemas;

/** PostgreSQL JSONB text survives number parsing unchanged; parsed values are temporary. */
function json(value: unknown, check: () => void) {
  check(); if (value === null) return { value: null, bytes: 0 };
  if (typeof value !== 'string') return fail();
  const bytes = utf8(value); check(); if (bytes > 1048576) return fail();
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
function dense(value: unknown): unknown[] { if (!Array.isArray(value) || value.length > MAX_ROWS) return fail(); for (let i = 0; i < value.length; i++) if (!own(value, i)) return fail(); return value; }
function unique(rows: Linha[], column = 'id') { const ids = new Set<string>(); for (const row of rows) { const id = key(row[column]); if (ids.has(id)) return fail(); ids.add(id); } return ids; }
function countBy(values: string[]) { const counts = new Map<string, number>(); for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1); return Object.fromEntries(counts); }
function assemble(cards: CardEspelho[], instant: string): ConsultaEspelho {
  const sectors = cards.flatMap(c => c.dadosOriginais.setores);
  return { origem: 'app2', fonte: 'controle-producao-live', consultadoEm: instant, atualizadoEm: null, sincronizadoEm: null, parcial: false, aviso: AVISO, consistency: 'crossread_unproved',
    complete: { cards: true, historico: true, logistica: true, setores: true, checklists: true },
    totals: { cards: cards.length, historico: cards.reduce((n, c) => n + c.dadosOriginais.historico.length, 0), logistica: cards.filter(c => c.dadosOriginais.logistica !== null).length, setores: sectors.length, checklists: sectors.reduce((n, s) => n + s.checklists.length, 0) },
    dados: { cards, kpis: { total: cards.length, excluidos: cards.filter(c => c.dadosOriginais.excluido === true).length, ativos: cards.filter(c => c.dadosOriginais.excluido === false && !['ENTREGUE', 'CANCELADO'].includes(c.etapa)).length, entregues: cards.filter(c => c.dadosOriginais.excluido === false && c.etapa === 'ENTREGUE').length, cancelados: cards.filter(c => c.dadosOriginais.excluido === false && c.etapa === 'CANCELADO').length, pedidosUnicos: new Set(cards.flatMap(c => c.pedidoId ? [c.pedidoId.toLowerCase()] : [])).size }, porEtapa: countBy(cards.map(c => c.etapa)), porSetor: countBy(sectors.map(s => s.setor as string)) } };
}

/** Closed browser boundary: preserves only the physical readonly contract. */
export function decodificarConsultaEspelho(input: unknown): ConsultaEspelho {
  try {
    const check = () => {}; const dto = record(input);
    fields(dto, ['origem', 'fonte', 'consultadoEm', 'atualizadoEm', 'sincronizadoEm', 'parcial', 'aviso', 'consistency', 'complete', 'totals', 'dados']);
    const complete = record(dto.complete); fields(complete, ['cards', 'historico', 'logistica', 'setores', 'checklists']);
    if (dto.origem !== 'app2' || dto.fonte !== 'controle-producao-live' || dto.atualizadoEm !== null || dto.sincronizadoEm !== null || dto.parcial !== false || typeof dto.aviso !== 'string' || dto.consistency !== 'crossread_unproved' || Object.values(complete).some(v => v !== true) || typeof dto.consultadoEm !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(dto.consultadoEm) || !Number.isFinite(Date.parse(dto.consultadoEm))) return fail();
    const totals = record(dto.totals), totalFields = ['cards', 'historico', 'logistica', 'setores', 'checklists'] as const;
    fields(totals, totalFields);
    for (const field of totalFields) { check(); const count = totals[field]; if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return fail(); }
    const data = record(dto.dados); fields(data, ['cards', 'kpis', 'porEtapa', 'porSetor']);
    record(data.kpis); record(data.porEtapa); record(data.porSetor);
    const cards: CardEspelho[] = [], historyIds = new Set<string>(), sectorIds = new Set<string>(), checkIds = new Set<string>(); let total = 0, jsonBytes = 0;
    const reserve = (count: number) => { check(); total += count; if (total > MAX_ROWS) fail(); };
    const dedup = (row: Linha, ids: Set<string>) => { check(); const id = key(row.id); if (ids.has(id)) fail(); ids.add(id); };
    for (const candidate of dense(data.cards)) {
      check(); reserve(1); const c = record(candidate); fields(c, ['id', 'pedidoId', 'numeroOrcamento', 'cliente', 'vendedor', 'etapa', 'atualizadoEm', 'dadosOriginais']);
      const raw = record(c.dadosOriginais), row = physical(raw, 'producao_cards', check); fields(raw, ['vinculo', 'historico', 'logistica', 'setores']);
      if (c.id !== row.id || c.numeroOrcamento !== row.numero_orcamento || c.cliente !== row.cliente_nome || c.vendedor !== row.vendedor_nome || c.etapa !== row.status || c.atualizadoEm !== row.updated_at) return fail();
      if (raw.vinculo === 'nao_verificado') { if (c.pedidoId !== null) return fail(); }
      else if (raw.vinculo !== 'confirmado' || !uuid(c.pedidoId) || key(c.pedidoId) !== key(row.pedido_id)) return fail();
      jsonBytes += json(row.checklist_compras, check).bytes; if (jsonBytes > 8388608) return fail();
      const historico = dense(raw.historico).map(v => { reserve(1); const h = physical(v, 'producao_status_log', check); if (key(h.card_id) !== key(row.id)) return fail(); dedup(h, historyIds); return h; });
      let logistica: Linha | null = null; if (raw.logistica !== null) { reserve(1); logistica = physical(raw.logistica, 'producao_logistica', check); if (key(logistica.card_id) !== key(row.id)) return fail(); }
      const setores = dense(raw.setores).map(v => { reserve(1); const inputSector = record(v), s = physical(inputSector, 'setor_producao', check); fields(inputSector, ['checklists']); if (key(s.card_id) !== key(row.id)) return fail(); dedup(s, sectorIds);
        const checklists = dense(inputSector.checklists).map(v => { reserve(1); const ch = physical(v, 'setor_checklist', check); if (key(ch.setor_producao_id) !== key(s.id)) return fail(); dedup(ch, checkIds); return ch; }); return { ...s, checklists }; });
      cards.push({ id: row.id as string, pedidoId: c.pedidoId as string | null, numeroOrcamento: row.numero_orcamento as string | null, cliente: row.cliente_nome as string, vendedor: row.vendedor_nome as string, etapa: row.status as string, atualizadoEm: row.updated_at as string, dadosOriginais: { ...row, checklist_compras: row.checklist_compras as string | null, vinculo: raw.vinculo as 'confirmado' | 'nao_verificado', historico, logistica, setores } });
    }
    unique(cards as unknown as Linha[]); check(); const out = assemble(cards, dto.consultadoEm); check();
    for (const field of totalFields) { if (totals[field] !== out.totals[field]) return fail(); }
    for (const field of ['kpis', 'porEtapa', 'porSetor'] as const) {
      const declared = record(data[field]), actual = out.dados[field]; fields(declared, Object.keys(actual));
      if (Object.keys(actual).some(k => declared[k] !== actual[k])) return fail();
      if (field !== 'kpis' && Object.keys(declared).some(k => !own(actual, k))) return fail();
    }
    const responseBytes = utf8(JSON.stringify(out)); check();
    if (responseBytes > 4000000) return fail(); return out;
  } catch { return fail(); }
}


export type AutoridadeEspelho = { userId:string|null; profileId:string|null; role:string|null; vendorId:string|null; approvedAt:string|null; menu:boolean; loading:boolean; profileError:boolean; generation:number };
const NS='producao-espelho-fabrica';
const mensagens={sessao:'Sessão alterada. Atualize a leitura.',negado:'Sem permissão para a produção da fábrica.',indisponivel:'Produção indisponível. Tente atualizar a leitura.'} as const;
export function autoridadeEspelhoValida(a:AutoridadeEspelho) {
  return !a.loading&&!a.profileError&&!!a.userId&&a.userId===a.profileId&&!!a.approvedAt&&a.menu===true&&['admin','financeiro','vendor','mapa','marketing','visualizador'].includes(a.role??'');
}
export function chaveConsultaEspelho(a:AutoridadeEspelho):readonly unknown[] {
  return [NS,a.userId,a.profileId,a.role,a.vendorId,a.approvedAt,'menu.producao_fabrica',a.menu,a.loading,a.profileError,a.generation];
}
export function dadosEspelhoVisiveis(data:ConsultaEspelho|undefined,a:AutoridadeEspelho,error:boolean) {return autoridadeEspelhoValida(a)&&!error?data:undefined;}
let ultimaGeracao=0;
export function criarCicloEspelho() {
  const initial=++ultimaGeracao,owned=new Set<number>([initial]);
  const cycle={geracao:initial,ativo:true,avancar(){cycle.ativo=true;cycle.geracao=++ultimaGeracao;owned.add(cycle.geracao);return cycle.geracao;},encerrar(){cycle.ativo=false;},possui(queryKey:readonly unknown[]){return queryKey[0]===NS&&owned.has(queryKey[queryKey.length-1] as number);}};
  return cycle;
}
/** All cleanup paths are limited to this page lifetime, even when an old effect runs late. */
export function consultaEspelhoRemovivel(cycle:ReturnType<typeof criarCicloEspelho>,queryKey:readonly unknown[],a:AutoridadeEspelho,failed?:string) {
  if(!cycle.possui(queryKey))return false;
  const signature=JSON.stringify(queryKey);
  return !cycle.ativo||!autoridadeEspelhoValida(a)||signature===failed||signature!==JSON.stringify(chaveConsultaEspelho(a));
}
export type DepsConsultaEspelho={authority:AutoridadeEspelho;signal:AbortSignal;getCurrentAuthority:()=>AutoridadeEspelho;getCurrentToken:()=>string|null;getSession:()=>Promise<{user:{id:string};access_token:string}|null>;fetch:(url:string,init:RequestInit)=>Promise<{ok:boolean;status:number;json:()=>Promise<unknown>}>};
export async function consultarEspelho(d:DepsConsultaEspelho):Promise<ConsultaEspelho> {
  const signature=JSON.stringify(chaveConsultaEspelho(d.authority)),token=d.getCurrentToken();
  const check=()=>{const live=d.getCurrentAuthority();if(d.signal.aborted||!token||d.getCurrentToken()!==token||!autoridadeEspelhoValida(d.authority)||!autoridadeEspelhoValida(live)||signature!==JSON.stringify(chaveConsultaEspelho(live)))throw Error(mensagens.sessao);};
  const checkSession=(session:Awaited<ReturnType<DepsConsultaEspelho['getSession']>>)=>{check();if(!session||session.user.id!==d.authority.userId||session.access_token!==token)throw Error(mensagens.sessao);};
  try {
    check();const before=await d.getSession();checkSession(before);
    check();const response=await d.fetch('/api/controle-producao?origem=app2',{method:'GET',headers:{Authorization:`Bearer ${token}`},cache:'no-store',signal:d.signal});check();
    if(!response.ok)throw Error(response.status===401?mensagens.sessao:response.status===403?mensagens.negado:mensagens.indisponivel);
    check();const raw=await response.json();check();const dto=decodificarConsultaEspelho(raw);check();
    const after=await d.getSession();checkSession(after);return dto;
  } catch(error) {
    // A SDK rejection racing revocation must still be classified as changed authority.
    check();
    if(error instanceof Error&&Object.values(mensagens).some(message=>message===error.message))throw error;
    throw Error(mensagens.indisponivel);
  }
}
export type FiltrosEspelho={busca:string;status:string;exclusao:'todos'|'incluidos'|'excluidos';vendedor:string};
export function codificarFiltroEspelho(v:string|null){return JSON.stringify(v);}
export function filtrarEspelho(cards:readonly CardEspelho[],f:FiltrosEspelho) {
  const search=f.busca.toLocaleLowerCase();
  return cards.filter(c=>(!search||[c.id,c.numeroOrcamento,c.cliente,c.vendedor,c.etapa].some(v=>v?.toLocaleLowerCase().includes(search)))&&(!f.status||codificarFiltroEspelho(c.etapa)===f.status)&&(!f.vendedor||codificarFiltroEspelho(c.vendedor)===f.vendedor)&&(f.exclusao==='todos'||c.dadosOriginais.excluido===(f.exclusao==='excluidos')));
}
export function paginarEspelho<T>(rows:readonly T[],page:number) {
  const paginas=Math.max(1,Math.ceil(rows.length/25)),pagina=Math.min(paginas,Math.max(1,Number.isSafeInteger(page)?page:1));
  return {linhas:rows.slice((pagina-1)*25,pagina*25),pagina,paginas,total:rows.length};
}
export function chaveSelecaoEspelho(identity:string,revision:number,filters:FiltrosEspelho,page:number,cards:readonly CardEspelho[]) {return JSON.stringify([identity,revision,filters,page,cards.map(c=>c.id)]);}
export function selecionarEspelhoPagina(cards:readonly CardEspelho[],selected:{id:string;context:string}|null,context:string) {return selected?.context===context?cards.find(c=>c.id===selected.id):undefined;}
