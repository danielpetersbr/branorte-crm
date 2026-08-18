import { createContext, useContext, useMemo, useState } from 'react'
import { Search, Loader2, Check, Tags, BookOpen, RefreshCw, AlertCircle, Camera, Link2, Zap } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { useCan } from '@/hooks/usePermissions'
import { PageLoading } from '@/components/ui/LoadingSpinner'
import {
  usePrecosBranorte, useUpdatePrecoBranorte, useSyncTodosModelos, usePrecosAudit,
  type PrecoBranorte,
} from '@/hooks/usePrecosBranorte'
import { useCatalogoMotores } from '@/hooks/useCatalogo'
import {
  motorDoPreco, classeDeMotor,
  CHUPIM_INCLINACAO_PADRAO, CHUPIM_MATERIAL_PADRAO,
  type MotorCatalogoBase, type MotorDoPreco, type VoltagemMotor,
} from '@/lib/motor-do-preco'

const CATEGORIA_LABEL: Record<string, string> = {
  COMPACTA: 'Fábricas Compactas (pacotes)',
  TRANSPORTADOR: 'Transportadores',
  MOINHO: 'Moinho Martelo',
  MISTURADOR: 'Misturadores',
  ELEVADOR: 'Elevador de Caneca',
  CAIXA: 'Caixas',
  SILO: 'Silos',
  CACAMBA: 'Caçamba de Pesagem',
  CACAMBA_PESAGEM: 'Caçamba de Pesagem',
  PRE_LIMPEZA: 'Pré-Limpeza',
  PENEIRA: 'Peneiras',
  BRETE: 'Brete Casqueador',
  ELEVADOR_SACARIA: 'Elevador de Sacaria',
  ENSACADEIRA: 'Ensacadeiras',
  HELICOIDE: 'Helicóide (peças)',
  BALANCA: 'Balanças',
  ACESSORIO: 'Acessórios (Peneiras, Martelos, Fechos)',
  ALIMENTADOR: 'Alimentadores',
  DESCARGA: 'Descarga Duas Vias',
  MOEGA: 'Moega de Descarga',
  ESTEIRA: 'Esteira Transportadora',
  PASSARELA: 'Passarelas',
  SUPORTE_BAG: 'Suporte de Big Bag',
  OUTROS: 'Diversos',
}

const SUBCATEGORIA_LABEL: Record<string, string> = {
  CHUPIM: 'Tipo Chupim',
  HELICOIDAL: 'Tipo Calha (TH)',
  MARTELO: 'Martelo',
  VERTICAL: 'Vertical',
  HORIZONTAL_SPULMAO: 'Horizontal — Sem Pulmão',
  HORIZONTAL_CPULMAO: 'Horizontal — Com Pulmão',
  COMPLETO: 'Completo',
  COMPONENTE: 'Componente (Pé/Padrão)',
  RECEPCAO: 'Recepção',
  PICADOS: 'Picados',
  RACAO: 'Ração',
  MILHO: 'Milho',
  PESAGEM: 'Pesagem',
  PECA: 'Peça',
  ELETRONICA: 'Eletrônica',
  MECANICA: 'Mecânica',
  CELULA: 'Célula de Carga',
  '01': 'Linha 01',
  '01 MASTER': 'Linha 01 Master',
  '02': 'Linha 02',
  '02 MASTER': 'Linha 02 Master',
  '03': 'Linha 03',
  '03 MASTER': 'Linha 03 Master',
  DIVERSOS: 'Diversos',
}

// Ordem fixa por categoria — VERTICAL → S/Pulmão → C/Pulmão
// GRUPOS = etapas da fabrica, na ordem em que o material anda: recebe, limpa,
// guarda, moi/mistura, pesa/ensaca, e transporte ligando tudo. E como o vendedor
// pensa quando monta um orcamento — nao por "quantos itens tem a categoria",
// que era a ordem antiga dos chips (Transportador vinha primeiro so por ter 228).
//
// ⚠️ TODA categoria de `precos_branorte` precisa estar aqui. Categoria fora da
// tabela cai em `GRUPO_SOBRA` e continua alcancavel — some do grupo, nao do site.
// Conferido em 2026-08-17: a soma dos grupos da exatamente 484 (todos os ativos).
const GRUPO_SOBRA = 'Outros'
const GRUPOS: { id: string; label: string; cats: string[] }[] = [
  { id: 'compactas',   label: 'Fábricas Compactas',     cats: ['COMPACTA'] },
  { id: 'recepcao',    label: 'Recepção e Pré-limpeza', cats: ['MOEGA', 'DESCARGA', 'PRE_LIMPEZA'] },
  { id: 'armazenagem', label: 'Armazenagem',            cats: ['SILO', 'CAIXA', 'SUPORTE_BAG'] },
  { id: 'moagem',      label: 'Moagem e Mistura',       cats: ['MOINHO', 'MISTURADOR'] },
  { id: 'pesagem',     label: 'Pesagem e Ensaque',      cats: ['BALANCA', 'CACAMBA_PESAGEM', 'ENSACADEIRA'] },
  { id: 'transporte',  label: 'Transporte',             cats: ['TRANSPORTADOR', 'ELEVADOR', 'ESTEIRA', 'ELEVADOR_SACARIA', 'ALIMENTADOR'] },
  { id: 'eletrica',    label: 'Elétrica',               cats: ['PAINEL_ELETRICO'] },
  { id: 'pecas',       label: 'Peças e Acessórios',     cats: ['HELICOIDE', 'ACESSORIO', 'PASSARELA', 'OUTROS'] },
]
const GRUPO_DE_CAT: Record<string, string> = Object.fromEntries(
  GRUPOS.flatMap(g => g.cats.map(c => [c, g.id])),
)

const SUBCAT_ORDER: Record<string, string[]> = {
  COMPACTA: ['01', '01 MASTER', '02', '02 MASTER', '03', '03 MASTER'],
  MISTURADOR: ['VERTICAL', 'HORIZONTAL_SPULMAO', 'HORIZONTAL_CPULMAO'],
  TRANSPORTADOR: ['CHUPIM', 'TH'],
  SILO: ['RACAO', 'MILHO'],
  CAIXA: ['RECEPCAO', 'PICADOS'],
  ELEVADOR: ['COMPLETO', 'COMPONENTE'],
}

// Categorias que sao UM produto parametrizado por duas coordenadas, e por isso
// viram MATRIZ em vez de lista. Ver o bloco "MATRIZ DE PREÇOS" mais abaixo.
const CATS_MATRIZ = new Set(['TRANSPORTADOR', 'ELEVADOR'])

function formatBRL(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v)
}

function formatLitros(v: number | null): string {
  if (v == null) return '—'
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v) + ' L'
}

function formatPeso(kg: number | null): string {
  if (kg == null) return '—'
  if (kg >= 1000) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 }).format(kg / 1000) + ' ton'
  }
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(kg) + ' kg'
}

// Sem centavos — pra celula estreita da matriz, onde ",60" custa largura e nao
// muda nenhuma decisao de venda.
function formatBRLCurto(v: number): string {
  return 'R$ ' + new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v)
}

function formatCv(cv: number): string {
  return cv.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) + ' cv'
}

// ═══════════════════════════════════════════════════════════════════════════
// MOTOR AVULSO
// ═══════════════════════════════════════════════════════════════════════════
//
// PARTE DO CATALOGO COBRA O MOTOR À PARTE. O Moinho Martelo BNMM7100 aparecia
// aqui por R$ 141.499,60 — mas o motor de 100 CV que ele exige custa R$ 49.826
// e sai por fora. A maquina real e R$ 191.325,60. Somando os 22 itens de
// MOINHO/MARTELO e MISTURADOR/VERTICAL, a tela escondia R$ 276.352 (43% do
// moinho, 26% do misturador vertical). O orcamento sempre fez a conta certa;
// era so esta tela que nao mostrava.
//
// A regra de quem cobra à parte mora em `src/lib/motor-do-preco.ts`, a MESMA
// que o orcamento usa. Aqui e so apresentacao.
//
// A voltagem entra no contexto porque muda o preco do motor — e porque o
// catalogo so tem motor monofasico ate 15 CV: acima disso a resposta correta e
// "sem motor cadastrado", nao o preco trifasico disfarçado.
interface CtxMotor {
  motores: MotorCatalogoBase[]
  voltagem: VoltagemMotor
}
const MotorCtx = createContext<CtxMotor>({ motores: [], voltagem: 'trifasico' })

/** Resolve o motor de cada item da tabela UMA vez, e diz se a tabela precisa
 *  das colunas de motor. Tabela sem nenhum item avulso nao ganha coluna. */
function useMotores(items: PrecoBranorte[]): { mapa: Map<number, MotorDoPreco>; temAvulso: boolean } {
  const { motores, voltagem } = useContext(MotorCtx)
  return useMemo(() => {
    const mapa = new Map<number, MotorDoPreco>()
    let temAvulso = false
    for (const it of items) {
      // So paga o custo de resolver quem pode ter motor à parte. Silo, caixa e
      // painel nao passam nem pela funcao.
      if (classeDeMotor(it.categoria, it.subcategoria) !== 'AVULSO') continue
      const r = motorDoPreco(it, motores, voltagem)
      if (r.tipo === 'AVULSO' || r.tipo === 'INDETERMINADO') {
        mapa.set(it.id, r)
        temAvulso = true
      }
    }
    return { mapa, temAvulso }
  }, [items, motores, voltagem])
}

/** Coluna "Motor": qual motor esta sendo somado. */
function CelulaMotor({ r }: { r: MotorDoPreco | undefined }) {
  if (!r) {
    return <span className="block text-right text-[10px] text-ink-faint italic">incluso</span>
  }
  if (r.tipo === 'INDETERMINADO') {
    return (
      <span className="block text-right text-[10px] text-warning" title={r.motivo}>
        a definir
      </span>
    )
  }
  if (r.tipo !== 'AVULSO') return null
  if (!r.motor) {
    // ⚠️ NUNCA somar 0 e chamar de total. Motor de 100 CV nao existe em
    // monofasico — a resposta honesta e essa, nao um numero.
    return (
      <span
        className="block text-right text-[10px] text-danger font-semibold"
        title={`Nenhum motor de ${formatCv(r.cv)} cadastrado em catalogo_motores nesta voltagem.`}
      >
        {formatCv(r.cv)} — sem cadastro
      </span>
    )
  }
  return (
    <div className="text-right leading-tight">
      <div className="text-[11px] font-semibold text-ink tabular-nums">
        {formatBRL(r.motor.valor)}
      </div>
      <div className="text-[9px] text-ink-faint tabular-nums">
        {r.estimado && <span className="text-warning" title="calculado pela fórmula do chupim">≈ </span>}
        {formatCv(r.motor.cv)} · {r.motor.polos} polos
      </div>
    </div>
  )
}

/** Coluna "Equipamento + motor": o preco que o vendedor precisa cotar. */
function CelulaTotal({ r }: { r: MotorDoPreco | undefined }) {
  if (!r) return <span className="block text-right text-ink-faint">—</span>
  if (r.tipo === 'INDETERMINADO') {
    return <span className="block text-right text-[11px] text-ink-faint italic">—</span>
  }
  if (r.tipo !== 'AVULSO') return null
  if (r.total == null) {
    return (
      <span className="block text-right text-[11px] text-danger" title="Sem preço de motor: o total não pode ser calculado.">
        indisponível
      </span>
    )
  }
  return (
    <span className="block text-right text-[12px] font-bold text-accent tabular-nums">
      {formatBRL(r.total)}
    </span>
  )
}

/** Versao de UMA linha, pra celula estreita da matriz do transportador.
 *  Substitui a linha de potencia: no chupim a `potencia` da planilha e
 *  exatamente o numero que o orcamento DESCARTA, entao mostra-la ali ao lado
 *  de um total calculado por outra regra seria mostrar dois motores
 *  diferentes pro mesmo equipamento. */
function LinhaMotorCelula({ r }: { r: MotorDoPreco }) {
  if (r.tipo === 'INDETERMINADO') {
    return (
      <div className="text-right pr-2 text-[9px] text-warning leading-none pb-0.5" title={r.motivo}>
        motor a definir
      </div>
    )
  }
  if (r.tipo !== 'AVULSO') return null
  // ⚠️ `total == null` junto no guard de propósito: sem ele o TS aceitaria um
  // `?? 0` logo abaixo, e "0" apresentado como total é exatamente o defeito.
  if (!r.motor || r.total == null) {
    return (
      <div
        className="text-right pr-2 text-[9px] text-danger leading-none pb-0.5"
        title={`Nenhum motor de ${formatCv(r.cv)} cadastrado nesta voltagem — total indisponível.`}
      >
        {formatCv(r.cv)} sem cadastro
      </div>
    )
  }
  return (
    <div
      className="text-right pr-2 text-[9px] leading-none pb-0.5 tabular-nums"
      title={`Equipamento ${formatBRL(r.valorEquipamento)} + motor ${formatCv(r.motor.cv)} ${r.motor.polos} polos ${formatBRL(r.motor.valor)} = ${formatBRL(r.total)}`}
    >
      <span className="text-ink-faint">
        {r.estimado && <span className="text-warning">≈</span>}
        {formatCv(r.motor.cv)} +{' '}
      </span>
      <span className="font-bold text-accent">{formatBRLCurto(r.total)}</span>
    </div>
  )
}

/** Cabecalho das duas colunas de motor. Reusado nas duas tabelas. */
function ThMotor() {
  return (
    <>
      <th className={THR + ' text-warning'} title="Motor vendido à parte — cobrado como linha separada no orçamento">
        Motor (à parte)
      </th>
      <th className={THR + ' text-accent'} title="Equipamento + motor: o valor real da máquina">
        Equip. + motor
      </th>
    </>
  )
}

/** Aviso acima da tabela: por que apareceu uma coluna a mais. */
function AvisoMotorAvulso({ items }: { items: PrecoBranorte[] }) {
  const { voltagem } = useContext(MotorCtx)
  const ehChupim = items.some(it => it.categoria === 'TRANSPORTADOR' && it.subcategoria === 'CHUPIM')
  return (
    <div className="px-3 py-1.5 bg-warning/10 border-b border-warning/30 flex items-start gap-1.5">
      <Zap className="w-3 h-3 text-warning mt-0.5 shrink-0" />
      <p className="text-[10px] text-ink-muted leading-snug">
        <span className="font-bold text-warning uppercase tracking-wide">Motor à parte</span>
        {' — '}o preço de "Equipamento" <span className="font-semibold">não inclui o motor</span>.
        O orçamento cobra o motor como linha separada, com o preço de{' '}
        <span className="font-semibold">catalogo_motores</span> em{' '}
        <span className="font-semibold">{voltagem === 'trifasico' ? 'trifásico' : 'monofásico'}</span>.
        Cote pela coluna <span className="font-semibold text-accent">Equip. + motor</span>.
        {ehChupim && (
          <>
            {' '}No chupim o CV vem da <span className="font-semibold">fórmula oficial</span> (não da planilha),
            calculada aqui com os padrões do orçamento — {CHUPIM_MATERIAL_PADRAO.toLowerCase()} e {CHUPIM_INCLINACAO_PADRAO}°.
            Mudar material ou inclinação no orçamento muda o motor; por isso vem marcado com{' '}
            <span className="text-warning font-bold">≈</span>.
          </>
        )}
      </p>
    </div>
  )
}

// Editor inline de campo numerico (valor)
//
// ⚠️ ESTE COMPONENTE E O UNICO PONTO DE ESCRITA DE PRECO DA TELA. Por isso o
// gate de permissao mora AQUI: quem nao tem `precos.editar` ve o numero como
// texto morto, sem botao e sem input, em TODAS as tabelas de uma vez. Se um dia
// aparecer outro caminho de escrita, ele precisa do mesmo gate — a pagina em si
// nao tem nenhum.
function ValorEditor({ id, field, valor, rotuloCampo, fallback }: {
  id: number
  field: keyof PrecoBranorte
  valor: number | null
  /** Nome do campo que o input vai GRAVAR, mostrado enquanto edita.
   *  Obrigatorio nas matrizes, onde a MESMA celula muda de campo conforme o
   *  seletor de variante — sem o rotulo os tres casos sao pixel por pixel
   *  identicos e da pra gravar preco de motor achando que e o preco base. */
  rotuloCampo?: string
  /** Preco base mostrado quando ESTA variante nao existe pro item.
   *  E so exibicao: gravar aqui continua gravando em `field`. */
  fallback?: number | null
}) {
  const [editando, setEditando] = useState(false)
  const [v, setV] = useState<number | ''>(valor ?? '')
  const upd = useUpdatePrecoBranorte()
  const can = useCan()

  // Nao ha preco proprio pra variante ativa — mostro o base como referencia.
  const herdado = valor == null && fallback != null
  const titulo = herdado
    ? `Sem preco de "${rotuloCampo ?? 'variante'}" cadastrado neste item.\nO valor mostrado e o preco base (so equipamento), como referencia.`
    : undefined

  const exibido = herdado
    ? <span className="text-ink-faint italic">~ {formatBRL(fallback)}</span>
    : <span className="font-semibold text-ink">{formatBRL(valor)}</span>

  if (!can('precos.editar')) {
    return <span className="block w-full text-right tabular-nums px-2 py-1" title={titulo}>{exibido}</span>
  }

  if (!editando) {
    return (
      <button
        // ⚠️ Abre com o valor REAL do campo — null vira input VAZIO, nunca o
        // fallback. Se abrisse com o fallback, um Enter sem digitar nada
        // copiaria o preco base pra dentro do campo de motor e inventaria um
        // preco que ninguem cadastrou.
        onClick={() => { setV(valor ?? ''); setEditando(true) }}
        title={titulo}
        className="w-full text-right tabular-nums hover:text-accent hover:bg-surface-2 px-2 py-1 rounded transition-all"
      >
        {exibido}
      </button>
    )
  }

  async function salvar() {
    if (typeof v !== 'number' || v < 0) { setEditando(false); return }
    if (Math.abs(v - (valor ?? 0)) < 0.001) { setEditando(false); return }
    try {
      await upd.mutateAsync({ id, patch: { [field]: v } })
      setEditando(false)
    } catch (err: any) {
      alert('Erro: ' + (err?.message ?? 'desconhecido'))
    }
  }

  return (
    <div className="flex flex-col items-end gap-0.5">
      {/* QUAL campo esta sendo gravado. Na matriz a celula troca de campo com o
          seletor de variante, entao o rotulo e a unica coisa que separa
          "gravei o preco base" de "gravei o preco com motor trifasico". */}
      {rotuloCampo && (
        <span className="text-[9px] uppercase tracking-wider font-bold text-accent whitespace-nowrap leading-none">
          {rotuloCampo}
        </span>
      )}
      <div className="flex items-center gap-1 justify-end">
        <Input
          type="number"
          value={v}
          onChange={e => setV(e.target.value ? Number(e.target.value) : '')}
          onKeyDown={e => {
            if (e.key === 'Enter') salvar()
            if (e.key === 'Escape') setEditando(false)
          }}
          autoFocus
          aria-label={rotuloCampo ? `Novo valor — ${rotuloCampo}` : 'Novo valor'}
          className="w-28 text-right text-[12px]"
          min="0"
          step="0.01"
        />
        <button
          onClick={salvar}
          disabled={upd.isPending}
          title={rotuloCampo ? `Salvar em: ${rotuloCampo}` : 'Salvar'}
          className="p-1 rounded bg-success hover:bg-success/90 text-white disabled:opacity-40"
        >
          {upd.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
        </button>
      </div>
    </div>
  )
}

const TH = 'text-left px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider whitespace-nowrap text-ink-muted'
const THR = 'text-right px-3 py-1.5 font-semibold uppercase text-[10px] tracking-wider whitespace-nowrap text-ink-muted'
const TD = 'px-3 py-1.5'

// SILOS: colunas geométricas dedicadas
function TabelaSilos({ items }: { items: PrecoBranorte[] }) {
  if (items.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 sticky top-0">
          <tr>
            <th className={TH + ' w-32'}>Código</th>
            <th className={TH}>Descrição</th>
            <th className={THR}>Capacidade</th>
            <th className={THR}>Volume</th>
            <th className={THR}>⌀ Diâm.</th>
            <th className={THR}>Altura</th>
            <th className={THR}>Anéis</th>
            <th className={TH}>Funil</th>
            <th className={THR}>Equipamento</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className={TD + ' text-ink-muted font-mono text-[11px] font-semibold'}>
                {it.codigo || <span className="text-ink-faint italic">—</span>}
              </td>
              <td className={TD + ' text-ink font-medium'}>{it.descricao}</td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-warning font-bold'}>
                {it.capacidade_ton ? `${Number(it.capacidade_ton).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} ton` : '—'}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-ink'}>
                {it.volume_m3 ? `${Number(it.volume_m3).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} m³` : '—'}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-ink-muted'}>
                {it.diametro_m ? `${Number(it.diametro_m).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m` : '—'}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-ink-muted'}>
                {it.altura_m ? `${Number(it.altura_m).toLocaleString('pt-BR', { maximumFractionDigits: 2 })} m` : '—'}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-ink-muted'}>
                {it.aneis_qtd ?? '—'}
              </td>
              <td className={TD + ' text-[11px]'}>
                {it.funil_tipo === 'PLANO'
                  ? <span className="px-1.5 py-0.5 rounded bg-info/20 text-info font-bold text-[10px]">PLANO</span>
                  : it.funil_tipo
                    ? <span className="px-1.5 py-0.5 rounded bg-surface-2 border border-border font-bold text-[10px]">{it.funil_tipo}°</span>
                    : '—'}
              </td>
              <td className={TD}><ValorEditor id={it.id} field="valor_equipamento" valor={it.valor_equipamento} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// CAIXAS: volume + peso milho (0,65)
function TabelaCaixas({ items }: { items: PrecoBranorte[] }) {
  if (items.length === 0) return null
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 sticky top-0">
          <tr>
            <th className={TH + ' w-36'}>Código</th>
            <th className={TH}>Descrição</th>
            <th className={THR}>Volume</th>
            <th className={THR} title="Peso de milho picado (densidade 0,65 g/cm³)">Milho · 0,65</th>
            <th className={TH}>Dimensões (mm)</th>
            <th className={THR}>Equipamento</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className={TD + ' text-ink-muted font-mono text-[11px] font-semibold'}>
                {it.codigo || <span className="text-ink-faint italic">—</span>}
              </td>
              <td className={TD + ' text-ink font-medium'}>
                {it.descricao.replace(/\s*-\s*\d+\s*M[³3]?\s*$/, '').replace(/\s*-\s*\d+\s*$/, '')}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-ink'}>
                {formatLitros(it.capacidade_litros ? Number(it.capacidade_litros) : null)}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-warning font-bold'}>
                {formatPeso(it.capacidade_kg_milho ? Number(it.capacidade_kg_milho) : null)}
              </td>
              <td className={TD + ' text-ink-faint text-[10px] font-mono'}>{it.dimensoes || '—'}</td>
              <td className={TD}><ValorEditor id={it.id} field="valor_equipamento" valor={it.valor_equipamento} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// MISTURADORES: litros + kg prática + 3 valores motor
function TabelaMisturadores({ items }: { items: PrecoBranorte[] }) {
  // Só o VERTICAL é avulso; os horizontais têm o motor no preço. Como a tela
  // agrupa por subcategoria, as colunas nascem no bloco do vertical e não
  // aparecem nos horizontais.
  const { mapa, temAvulso } = useMotores(items)
  if (items.length === 0) return null
  return (
    <div>
      {temAvulso && <AvisoMotorAvulso items={items} />}
      <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 sticky top-0">
          <tr>
            <th className={TH + ' w-32'}>Código</th>
            <th className={THR}>Capacidade</th>
            <th className={THR} title="Capacidade prática em kg (≈ litros ÷ 2)">Kg prática</th>
            <th className={TH}>Potência</th>
            <th className={THR}>Equipamento</th>
            <th className={THR}>+ Trif</th>
            <th className={THR}>+ Mono</th>
            <th className={THR}>+ Redutor</th>
            {temAvulso && <ThMotor />}
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className={TD + ' text-ink-muted font-mono text-[11px] font-semibold'}>
                {it.codigo || <span className="text-ink-faint italic">—</span>}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-ink'}>
                {formatLitros(it.capacidade_litros ? Number(it.capacidade_litros) : null)}
              </td>
              <td className={TD + ' text-right tabular-nums text-[11px] text-warning font-bold'}>
                {formatPeso(it.capacidade_kg_pratica ? Number(it.capacidade_kg_pratica) : null)}
              </td>
              <td className={TD + ' text-ink-muted text-[11px]'}>{it.potencia || '—'}</td>
              <td className={TD}><ValorEditor id={it.id} field="valor_equipamento" valor={it.valor_equipamento} /></td>
              <td className={TD}><ValorEditor id={it.id} field="valor_com_motor_trif" valor={it.valor_com_motor_trif} /></td>
              <td className={TD}><ValorEditor id={it.id} field="valor_com_motor_mono" valor={it.valor_com_motor_mono} /></td>
              <td className={TD}><ValorEditor id={it.id} field="valor_com_motorredutor" valor={it.valor_com_motorredutor} /></td>
              {temAvulso && (
                <>
                  <td className={TD + ' bg-warning/5'}><CelulaMotor r={mapa.get(it.id)} /></td>
                  <td className={TD + ' bg-accent/5'}><CelulaTotal r={mapa.get(it.id)} /></td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// Tabela genérica padrão (Transportador, Moinho, Elevador, Pré-limpeza, etc)
//
// ⚠️ A coluna de motor nasce por PRESENCA REAL, uma a uma — nao pelo par
// `trif != null || mono != null`. Com a regra do par, o transportador (90 itens
// com trifasico, ZERO com monofasico) abria as DUAS colunas e a de monofasico
// nascia 100% vazia: uma coluna inteira de "—" ocupando largura e sugerindo que
// o preco existe e alguem esqueceu de preencher.
function TabelaPrecos({ items }: { items: PrecoBranorte[] }) {
  // ⚠️ hooks antes de qualquer return — `items` vazio ainda passa por aqui.
  const { mapa, temAvulso } = useMotores(items)
  if (items.length === 0) return null
  const temTrif = items.some(it => it.valor_com_motor_trif != null)
  const temMono = items.some(it => it.valor_com_motor_mono != null)
  return (
    <div>
      {temAvulso && <AvisoMotorAvulso items={items} />}
      <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 sticky top-0">
          <tr>
            <th className={TH + ' w-32'}>Código</th>
            <th className={TH}>Descrição</th>
            <th className={TH}>Capacidade</th>
            <th className={TH}>Potência</th>
            <th className={THR}>Equipamento</th>
            {temTrif && <th className={THR}>+ Trif</th>}
            {temMono && <th className={THR}>+ Mono</th>}
            {temAvulso && <ThMotor />}
            <th className={TH}>Obs.</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className={TD + ' text-ink-muted font-mono text-[11px]'}>
                {it.codigo || <span className="text-ink-faint italic">—</span>}
              </td>
              <td className={TD + ' text-ink font-medium'}>{it.descricao}</td>
              <td className={TD + ' text-ink-muted text-[11px]'}>{it.capacidade || '—'}</td>
              <td className={TD + ' text-ink-muted text-[11px]'}>{it.potencia || '—'}</td>
              <td className={TD}><ValorEditor id={it.id} field="valor_equipamento" valor={it.valor_equipamento} /></td>
              {temTrif && <td className={TD}><ValorEditor id={it.id} field="valor_com_motor_trif" valor={it.valor_com_motor_trif} /></td>}
              {temMono && <td className={TD}><ValorEditor id={it.id} field="valor_com_motor_mono" valor={it.valor_com_motor_mono} /></td>}
              {temAvulso && (
                <>
                  <td className={TD + ' bg-warning/5'}><CelulaMotor r={mapa.get(it.id)} /></td>
                  <td className={TD + ' bg-accent/5'}><CelulaTotal r={mapa.get(it.id)} /></td>
                </>
              )}
              <td className={TD + ' text-ink-faint text-[10px]'}>
                {[it.dimensoes, it.observacoes].filter(Boolean).join(' · ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  )
}

// COMPACTAS: pacote fechado de equipamentos. 4 variantes de preço:
//   - Só equipamento (sem motor, sem balança)
//   - + Motor Trif / + Motor Mono
//   - + Motor Trif + Balança / + Motor Mono + Balança
function TabelaCompactas({ items }: { items: PrecoBranorte[] }) {
  if (items.length === 0) return null

  function fmt(v: number | null): string {
    if (v == null) return '—'
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 }).format(v)
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[12px]">
        <thead className="bg-surface-2/50 sticky top-0">
          <tr>
            <th className={TH + ' w-32'} rowSpan={2}>Linha</th>
            <th className={THR + ' w-24'} rowSpan={2}>Produção</th>
            <th className={THR + ' w-24'} rowSpan={2}>Armaz.</th>
            <th className={THR + ' w-36'} rowSpan={2} title="Equipamento sem motor e sem balança">Só Equipamento</th>
            <th className="text-center px-3 py-1 font-semibold uppercase text-[10px] tracking-wider whitespace-nowrap text-ink-muted border-l border-border/40" colSpan={2}>+ Motor</th>
            <th className="text-center px-3 py-1 font-semibold uppercase text-[10px] tracking-wider whitespace-nowrap text-ink-muted border-l border-border/40" colSpan={2}>+ Motor + Balança</th>
          </tr>
          <tr>
            <th className={THR + ' border-l border-border/40 text-info'}>Trifásico</th>
            <th className={THR + ' text-warning'}>Monofásico</th>
            <th className={THR + ' border-l border-border/40 text-info'}>Trifásico</th>
            <th className={THR + ' text-warning'}>Monofásico</th>
          </tr>
        </thead>
        <tbody>
          {items.map(it => (
            <tr key={it.id} className="border-t border-border/40 hover:bg-surface-2/30">
              <td className={TD + ' text-ink font-mono font-bold text-[11px]'}>
                {it.subcategoria?.includes('MASTER')
                  ? <span className="px-1.5 py-0.5 rounded bg-warning/15 text-warning text-[10px] font-bold">Master</span>
                  : <span className="px-1.5 py-0.5 rounded bg-info/15 text-info text-[10px] font-bold">Linha {it.subcategoria}</span>}
              </td>
              <td className={TD + ' text-right tabular-nums text-[12px] text-ink font-semibold'}>
                {it.producao_kgh ? `${it.producao_kgh} kg/h` : '—'}
              </td>
              <td className={TD + ' text-right tabular-nums text-[12px] text-ink'}>
                {it.armazenamento_kg ? `${fmt(it.armazenamento_kg)} kg` : '—'}
              </td>
              <td className={TD + ' border-r border-border/40'}>
                <ValorEditor id={it.id} field="valor_equipamento" valor={it.valor_equipamento} />
              </td>
              <td className={TD + ' border-l border-border/40 bg-info/5'}>
                <ValorEditor id={it.id} field="valor_com_motor_trif" valor={it.valor_com_motor_trif} />
              </td>
              <td className={TD + ' bg-warning/5'}>
                <ValorEditor id={it.id} field="valor_com_motor_mono" valor={it.valor_com_motor_mono} />
              </td>
              <td className={TD + ' border-l border-border/40 bg-info/10'}>
                <ValorEditor id={it.id} field="valor_com_motor_trif_balanca" valor={it.valor_com_motor_trif_balanca} />
              </td>
              <td className={TD + ' bg-warning/10'}>
                <ValorEditor id={it.id} field="valor_com_motor_mono_balanca" valor={it.valor_com_motor_mono_balanca} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// MATRIZ DE PREÇOS  (transportador e elevador)
// ═══════════════════════════════════════════════════════════════════════════
//
// POR QUE MATRIZ, E NAO LISTA:
// Transportador e elevador nao sao catalogos de itens diferentes — sao UM
// produto parametrizado por duas coordenadas. O transportador e (bitola ×
// comprimento): 6 bitolas × 39 comprimentos = 228 linhas que repetem a mesma
// descricao 39 vezes seguidas. O elevador e (modelo × altura): 5 modelos × 21
// alturas = 61 linhas. Em lista, achar "TH 200 de 6,5 m" e rolar 228 linhas
// lendo texto; em matriz e cruzar uma coluna com uma linha.
//
// A COLUNA `descricao` SOME de proposito: ela E as duas coordenadas juntas
// ("TH 200 X 6,5 m"). Repetir isso na celula seria escrever o cabecalho de novo
// em cada uma das 234 celulas.
//
// O QUE SOBE PRO CABECALHO e o que e CONSTANTE na coluna. Conferido no banco:
// `capacidade` tem 1 valor unico por bitola (⌀160=10 t/h, ⌀300=60 t/h) e por
// modelo de elevador (EC-2310=6 t/h) — entao vai pro cabecalho. `potencia` NAO:
// ela cresce com o comprimento (chupim 160 vai de 1,5 a 3 cv conforme o vao),
// entao fica na celula, junto do preco.

type CampoValor = 'valor_equipamento' | 'valor_com_motor_trif' | 'valor_com_motor_mono'

interface Variante { campo: CampoValor; label: string }
const VARIANTES: Variante[] = [
  { campo: 'valor_equipamento', label: 'Só equipamento' },
  { campo: 'valor_com_motor_trif', label: '+ Motor trifásico' },
  { campo: 'valor_com_motor_mono', label: '+ Motor monofásico' },
]

interface Eixo { chave: string; ordem: number; rotulo: string }
interface ColunaEixo extends Eixo { grupo: string; nota: string | null }

// "1,50" -> 1.5   (numero em pt-BR dentro de texto livre)
function numeroBR(s: string): number {
  return parseFloat(s.replace(/\./g, '').replace(',', '.'))
}

// Potencia legivel. Vem de `potencia` quando existe; senao da descricao —
// 3 elevadores tem `potencia` NULL no banco mas carregam o cv no texto
// ("EC-2310 - 10,0 m - 1,5 cv"), e sem esse fallback a celula ficava muda.
// Normaliza "1,50 CV" e "1,0 cv" pro mesmo "1,5 cv".
function potenciaCurta(it: PrecoBranorte): string | null {
  const bruto = it.potencia ?? it.descricao.match(/[\d,.]+\s*cv/i)?.[0] ?? null
  if (!bruto) return null
  const n = numeroBR(bruto.match(/[\d,.]+/)?.[0] ?? '')
  return isFinite(n) ? `${n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} cv` : null
}

interface Matriz {
  linhas: Eixo[]
  colunas: ColunaEixo[]
  celulas: Map<string, PrecoBranorte>
  orfaos: PrecoBranorte[]
}

/**
 * Cruza os itens nos dois eixos.
 *
 * ⚠️ NENHUM ITEM PODE SUMIR. Quem nao encaixa nos dois eixos (descricao fora do
 * padrao, item novo com outro formato) vai pra `orfaos` e e renderizado em
 * lista embaixo da matriz. Uma matriz que engole silenciosamente a linha que
 * nao soube posicionar e uma matriz que esconde preco — o pior defeito
 * possivel numa tela de tabela de precos.
 */
function montarMatriz(
  items: PrecoBranorte[],
  linhaDe: (it: PrecoBranorte) => Eixo | null,
  colunaDe: (it: PrecoBranorte) => ColunaEixo | null,
): Matriz {
  const linhas = new Map<string, Eixo>()
  const colunas = new Map<string, ColunaEixo>()
  const celulas = new Map<string, PrecoBranorte>()
  const orfaos: PrecoBranorte[] = []

  for (const it of items) {
    const l = linhaDe(it)
    const c = colunaDe(it)
    if (!l || !c) { orfaos.push(it); continue }
    const k = `${l.chave}|${c.chave}`
    // Dois itens na MESMA coordenada: nao ha desempate honesto, entao o segundo
    // vira orfao (sai da grade, continua visivel) em vez de sobrescrever o
    // primeiro em silencio.
    if (celulas.has(k)) { orfaos.push(it); continue }
    linhas.set(l.chave, l)
    colunas.set(c.chave, c)
    celulas.set(k, it)
  }

  const ord = <T extends Eixo>(a: T, b: T) => a.ordem - b.ordem || a.chave.localeCompare(b.chave)
  return {
    linhas: [...linhas.values()].sort(ord),
    colunas: [...colunas.values()].sort(ord),
    celulas,
    orfaos,
  }
}

// Celula sem item: a combinacao nao existe no catalogo (⌀250 nao e fabricado
// abaixo de 2,5 m; o EC-2310 para em 12 m). Hachura + "·" pra ler como
// "vazio de proposito", nao como "preco faltando" — a diferenca entre as duas
// leituras e um vendedor ligando pra fabrica perguntar por um produto que nao
// existe. O rodape da matriz explica.
const HACHURA: React.CSSProperties = {
  backgroundImage:
    'repeating-linear-gradient(45deg, hsl(var(--border) / 0.55) 0 1px, transparent 1px 7px)',
}

function MatrizPrecos({
  items, rotuloEixo, tituloEixo, larguraEixo, rodape,
  linhaDe, colunaDe,
}: {
  items: PrecoBranorte[]
  rotuloEixo: string
  tituloEixo: string
  /** % da largura pro cabecalho de linha; o resto e dividido pelas colunas. */
  larguraEixo: number
  rodape: string
  linhaDe: (it: PrecoBranorte) => Eixo | null
  colunaDe: (it: PrecoBranorte) => ColunaEixo | null
}) {
  const [variante, setVariante] = useState<CampoValor>('valor_equipamento')
  // Chupim cobra o motor à parte; Calha TH não. Como as duas dividem a mesma
  // grade, o mapa só tem as células de chupim e a linha extra nasce só nelas.
  const { mapa: mapaMotor, temAvulso } = useMotores(items)
  // Depende so de `items`: linhaDe/colunaDe chegam como arrow inline (identidade
  // nova a cada render do pai) mas sao funcoes PURAS de parsing, fixas por
  // matriz. Inclui-las nas deps refaria a grade de 234 celulas a cada tecla
  // digitada na busca, sem nunca mudar o resultado.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const { linhas, colunas, celulas, orfaos } = useMemo(() => montarMatriz(items, linhaDe, colunaDe), [items])

  // Variantes OFERECIDAS = as que existem de verdade nestes itens (regra de
  // PRESENCA). No transportador o monofasico tem ZERO itens: oferecer o botao
  // seria abrir uma matriz inteira de fallback cinza.
  const disponiveis = VARIANTES.filter(v => items.some(it => it[v.campo] != null))
  const ativa = disponiveis.find(v => v.campo === variante) ?? disponiveis[0]

  if (linhas.length === 0 || colunas.length === 0 || !ativa) {
    // Sem os dois eixos nao ha matriz — cai na lista, que sempre funciona.
    return <TabelaPrecos items={items} />
  }

  // Quantos itens de CADA coluna tem a variante ativa. Com "+ Motor trifasico"
  // ligado as colunas de Chupim ficam 100% em fallback (o chupim nao tem
  // trifasico cadastrado): sem avisar no cabecalho, a coluna parece uma tabela
  // de preco de motor e nao e.
  const naColuna = new Map<string, number>()
  for (const [k, it] of celulas) {
    if (it[ativa.campo] != null) {
      const col = k.slice(k.indexOf('|') + 1)
      naColuna.set(col, (naColuna.get(col) ?? 0) + 1)
    }
  }

  // Cabecalho de 2 niveis: agrupa colunas vizinhas do mesmo grupo (CHUPIM /
  // CALHA TH). Grupo vazio em todas = 1 nivel so (elevador).
  const faixas: { grupo: string; span: number }[] = []
  for (const c of colunas) {
    const ult = faixas[faixas.length - 1]
    if (ult && ult.grupo === c.grupo) ult.span++
    else faixas.push({ grupo: c.grupo, span: 1 })
  }
  const temNivel2 = faixas.some(f => f.grupo)

  // `table-fixed` + larguras somando 100%: e a licao da tabela de /contatos —
  // com soma > 100 o navegador reescala TODAS as colunas e o cabecalho medido
  // deixa de bater com o corpo. Aqui o numero de colunas e derivado do dado
  // (6 bitolas hoje, 7 se a fabrica lancar outra), entao a divisao e calculada
  // e nao escrita a mao.
  const wCol = (100 - larguraEixo) / colunas.length
  const vazias = linhas.length * colunas.length - celulas.size

  return (
    <div>
      {temAvulso && <AvisoMotorAvulso items={items} />}
      {/* SELETOR DE VARIANTE — troca o campo de preco da matriz inteira. */}
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-border/40 bg-surface-2/30">
        <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mr-1">Preço</span>
        {disponiveis.map(v => {
          const on = v.campo === ativa.campo
          return (
            <button
              key={v.campo}
              onClick={() => setVariante(v.campo)}
              aria-pressed={on}
              className={`text-[11px] px-2.5 py-1 rounded-md font-semibold transition ${
                on ? 'bg-accent text-white'
                   : 'bg-surface-2 text-ink-muted hover:text-ink hover:bg-surface-3 border border-border'
              }`}
            >
              {v.label}
            </button>
          )
        })}
        {ativa.campo !== 'valor_equipamento' && (
          <span className="text-[10px] text-ink-faint ml-1">
            célula em <span className="italic">~ cinza</span> = sem este preço; mostra o base
          </span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-[12px]">
          <thead className="sticky top-0 z-10">
            {temNivel2 && (
              <tr className="[&>th]:bg-surface-2 [&>th]:py-1 [&>th]:whitespace-nowrap [&>th]:overflow-hidden [&>th]:text-ellipsis">
                <th style={{ width: `${larguraEixo}%` }} />
                {faixas.map((f, i) => (
                  <th
                    key={f.grupo + i}
                    colSpan={f.span}
                    className="text-center text-[10px] font-bold uppercase tracking-wider text-accent border-l border-border/60"
                  >
                    {f.grupo}
                  </th>
                ))}
              </tr>
            )}
            <tr className="[&>th]:bg-surface-2 [&>th]:py-1.5 [&>th]:px-2 [&>th]:whitespace-nowrap [&>th]:overflow-hidden [&>th]:text-ellipsis [&>th]:border-b [&>th]:border-border">
              <th
                style={{ width: `${larguraEixo}%` }}
                title={tituloEixo}
                className="text-left text-[10px] font-semibold uppercase tracking-wider text-ink-muted"
              >
                {rotuloEixo}
              </th>
              {colunas.map((c, i) => {
                const semVariante = (naColuna.get(c.chave) ?? 0) === 0
                const novaFaixa = i === 0 || colunas[i - 1].grupo !== c.grupo
                return (
                  <th
                    key={c.chave}
                    style={{ width: `${wCol}%` }}
                    title={[c.grupo, c.rotulo, c.nota, semVariante ? `Sem preço de "${ativa.label}" nesta coluna` : null]
                      .filter(Boolean).join(' · ')}
                    className={`text-right ${novaFaixa ? 'border-l border-border/60' : ''}`}
                  >
                    <div className="text-[11px] font-bold text-ink tabular-nums">{c.rotulo}</div>
                    {/* Capacidade e constante na coluna — por isso mora aqui e
                        nao repetida em 39 celulas. */}
                    {c.nota && <div className="text-[9px] font-normal normal-case tracking-normal text-warning">{c.nota}</div>}
                    {semVariante && (
                      <div className="text-[9px] font-normal normal-case tracking-normal text-ink-faint italic">sem este preço</div>
                    )}
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {linhas.map(l => (
              <tr key={l.chave} className="border-t border-border/40 hover:bg-surface-2/30">
                <th
                  scope="row"
                  className="text-left px-2 py-1 text-[11px] font-semibold text-ink-muted tabular-nums whitespace-nowrap"
                >
                  {l.rotulo}
                </th>
                {colunas.map((c, i) => {
                  const it = celulas.get(`${l.chave}|${c.chave}`)
                  const borda = i === 0 || colunas[i - 1].grupo !== c.grupo ? 'border-l border-border/60' : ''
                  if (!it) {
                    return (
                      <td
                        key={c.chave}
                        style={HACHURA}
                        title={`${c.grupo} ${c.rotulo} não é fabricado em ${l.rotulo}`}
                        className={`text-center text-ink-faint/60 ${borda}`}
                      >
                        ·
                      </td>
                    )
                  }
                  const pot = potenciaCurta(it)
                  const rm = mapaMotor.get(it.id)
                  // A linha do motor só entra em cima do preço BASE: nas
                  // variantes "+ motor trifásico" o motor já está dentro do
                  // valor, e somar de novo cobraria duas vezes.
                  const mostraMotor = rm != null && ativa.campo === 'valor_equipamento'
                  return (
                    <td key={c.chave} className={`px-1 py-0.5 ${borda} ${mostraMotor ? 'bg-warning/5' : ''}`}>
                      <ValorEditor
                        id={it.id}
                        field={ativa.campo}
                        valor={it[ativa.campo]}
                        rotuloCampo={ativa.label}
                        // So faz sentido cair pro base quando a variante NAO e o base.
                        fallback={ativa.campo === 'valor_equipamento' ? null : it.valor_equipamento}
                      />
                      {mostraMotor
                        ? <LinhaMotorCelula r={rm} />
                        : pot && (
                          <div className="text-right pr-2 text-[10px] text-ink-faint tabular-nums leading-none pb-0.5">{pot}</div>
                        )}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="px-3 py-1.5 text-[10px] text-ink-faint border-t border-border/40 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <span style={HACHURA} className="inline-block h-3 w-5 rounded-sm border border-border/60" aria-hidden />
          {vazias > 0
            ? <>{vazias} combinaç{vazias === 1 ? 'ão' : 'ões'} sem produto — {rodape}</>
            : <>combinação sem produto</>}
        </span>
        <span>{celulas.size} itens na grade · {linhas.length} × {colunas.length}</span>
      </div>

      {/* Itens que nao entraram na grade. Ver montarMatriz(). */}
      {orfaos.length > 0 && (
        <div className="border-t border-warning/30">
          <div className="px-3 py-1 bg-warning/10">
            <span className="text-[10px] uppercase tracking-wider font-bold text-warning">
              Fora da grade ({orfaos.length})
            </span>
            <span className="text-[10px] text-ink-muted ml-2">
              descrição fora do padrão medida × bitola — avise pra arrumar
            </span>
          </div>
          <TabelaPrecos items={orfaos} />
        </div>
      )}
    </div>
  )
}

// TRANSPORTADOR — 228 linhas viram 39. Chupim e Calha TH dividem exatamente os
// mesmos comprimentos (1,0 a 20,0 m de meio em meio), entao sao UMA tabela com
// cabecalho de 2 niveis, e nao duas tabelas de 39 linhas lado a lado.
function MatrizTransportador({ items }: { items: PrecoBranorte[] }) {
  return (
    <MatrizPrecos
      items={items}
      rotuloEixo="Comp."
      tituloEixo="Comprimento do transportador, em metros"
      larguraEixo={8}
      rodape="⌀250 e ⌀300 não são fabricados abaixo de 2,5 m"
      // "chupim 160 x 1,0 m" / "TH 250 X 10,0 m" — a medida fecha a descricao.
      linhaDe={it => {
        const m = it.descricao.match(/([\d,.]+)\s*m\s*$/i)
        if (!m) return null
        const n = numeroBR(m[1])
        if (!isFinite(n)) return null
        return { chave: n.toFixed(1), ordem: n, rotulo: `${n.toFixed(1).replace('.', ',')} m` }
      }}
      colunaDe={it => {
        const m = it.descricao.match(/(\d{3})\s*[xX]/)
        if (!m) return null
        const chupim = it.subcategoria === 'CHUPIM'
        if (!chupim && it.subcategoria !== 'TH') return null
        const d = Number(m[1])
        return {
          chave: `${it.subcategoria}-${d}`,
          // Chupim primeiro, depois TH; dentro de cada um, bitola crescente.
          ordem: (chupim ? 0 : 1000) + d,
          rotulo: `⌀${d}`,
          grupo: chupim ? 'Chupim' : 'Calha TH',
          nota: it.capacidade ? it.capacidade.toLowerCase().replace('ton/h', 't/h') : null,
        }
      }}
    />
  )
}

// ELEVADOR — 61 linhas viram 21. As alturas NAO sao uma regua regular: o
// EC-2310 anda de metro em metro (4 a 11 m) e os demais de 2 em 2 (ate 36 m).
// A uniao da 21 valores e os vazios formam uma escada — cada modelo cobre a
// sua faixa. Por isso as linhas saem do DADO, e nao de uma sequencia fixa.
//
// Os 2 itens de subcategoria COMPONENTE (pe/padrao, sem altura) ficam FORA da
// grade: nao tem a segunda coordenada. Viram listinha rotulada embaixo.
function MatrizElevador({ items }: { items: PrecoBranorte[] }) {
  const completos = items.filter(it => it.subcategoria === 'COMPLETO')
  const componentes = items.filter(it => it.subcategoria !== 'COMPLETO')

  return (
    <div>
      {completos.length > 0 && (
        <MatrizPrecos
          items={completos}
          rotuloEixo="Altura"
          tituloEixo="Altura do elevador, em metros"
          larguraEixo={10}
          rodape="cada modelo cobre uma faixa de altura"
          // "EC-2310 - 4,0 m - 1,0 cv" — a altura vem antes do cv.
          linhaDe={it => {
            const m = it.descricao.match(/(\d+(?:[,.]\d+)?)\s*m(?![a-zà-ú])/i)
            if (!m) return null
            const n = numeroBR(m[1])
            if (!isFinite(n)) return null
            return { chave: n.toFixed(1), ordem: n, rotulo: `${n.toFixed(1).replace('.', ',')} m` }
          }}
          colunaDe={it => {
            const cod = it.codigo?.trim()
            if (!cod) return null
            // Ordena por capacidade (e assim que o vendedor escolhe), com o
            // codigo como desempate.
            const cap = numeroBR(it.capacidade?.match(/[\d,.]+/)?.[0] ?? '')
            return {
              chave: cod,
              ordem: isFinite(cap) ? cap : 9999,
              rotulo: cod,
              grupo: '',
              nota: it.capacidade ? it.capacidade.toLowerCase().replace('ton/h', 't/h') : null,
            }
          }}
        />
      )}
      {componentes.length > 0 && (
        <div className="border-t border-border">
          <div className="px-3 py-1 bg-surface-2/50 border-b border-border/30">
            <span className="text-[10px] uppercase tracking-wider font-bold text-ink-muted">
              {SUBCATEGORIA_LABEL.COMPONENTE}
            </span>
            <span className="text-[10px] text-ink-faint ml-2">
              vendido avulso — sem altura, fora da grade
            </span>
          </div>
          <TabelaPrecos items={componentes} />
        </div>
      )}
    </div>
  )
}

// Dispatcher por categoria
function TabelaPorCategoria({ items }: { items: PrecoBranorte[] }) {
  if (items.length === 0) return null
  const cat = items[0].categoria
  if (cat === 'COMPACTA') return <TabelaCompactas items={items} />
  if (cat === 'SILO') return <TabelaSilos items={items} />
  if (cat === 'CAIXA') return <TabelaCaixas items={items} />
  if (cat === 'MISTURADOR' || cat === 'CAÇAMBA DE PESAGEM') return <TabelaMisturadores items={items} />
  return <TabelaPrecos items={items} />
}

// Sincroniza todos os 319 orcamento_modelos com os preços vigentes
// (o trigger já cobre updates futuros; este botão é pro backfill / força bruta)
function BotaoSincronizarModelos() {
  const sync = useSyncTodosModelos()
  return (
    <button
      onClick={() => sync.mutate()}
      disabled={sync.isPending}
      className="text-[12px] px-3 py-2 rounded bg-accent hover:bg-accent-700 text-white font-semibold flex items-center gap-1.5 shadow disabled:opacity-50"
      title="Recalcula todos os templates de orçamento com os preços atuais"
    >
      {sync.isPending
        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
        : <RefreshCw className="h-3.5 w-3.5" />}
      Sincronizar templates
      {sync.data && (
        <span className="text-[10px] opacity-80 ml-1">
          ({sync.data.modelos_atualizados} atualizados)
        </span>
      )}
    </button>
  )
}

// Painel de auditoria — mostra quanto do catálogo oficial tá íntegro
function PainelAuditoria() {
  const { data: audit } = usePrecosAudit()
  if (!audit) return null
  const cards = [
    { label: 'Itens oficiais ativos', valor: audit.total_ativos, icon: BookOpen, color: 'text-accent', alerta: false },
    { label: 'Sem foto', valor: audit.sem_foto, icon: Camera, color: 'text-amber-400', alerta: audit.sem_foto > 0 },
    { label: 'Sem link c/ preços', valor: audit.sem_link_oficial, icon: Link2, color: 'text-rose-400', alerta: audit.sem_link_oficial > 0 },
    { label: 'Preço > 30 dias', valor: audit.desatualizados_30d, icon: AlertCircle, color: 'text-orange-400', alerta: audit.desatualizados_30d > 50 },
  ]
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
      {cards.map(c => {
        const Icon = c.icon
        return (
          <div
            key={c.label}
            className={`bg-surface border rounded-lg p-3 ${c.alerta ? 'border-amber-500/40' : 'border-border'}`}
          >
            <div className="flex items-center gap-1.5 mb-1">
              <Icon className={`w-3.5 h-3.5 ${c.color}`} />
              <span className="text-[10px] text-ink-muted uppercase tracking-wide">{c.label}</span>
            </div>
            <div className={`text-[20px] font-bold tabular-nums ${c.alerta ? c.color : 'text-ink'}`}>
              {c.valor}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function PrecosBranorte() {
  // `precos.editar` = mexer no preco oficial (celula, sincronizar templates,
  // painel de auditoria). Quem so tem `precos.consultar` chega aqui pelo menu
  // Comercial e ve a tabela como referencia, sem nenhum caminho de escrita.
  const podeEditar = useCan()('precos.editar')
  const { data: precos, isLoading } = usePrecosBranorte()
  // Motores do catálogo central — a MESMA fonte de onde o orçamento puxa o
  // preço do motor avulso. Sem isto a tela mostra o equipamento pelado.
  const { data: motores } = useCatalogoMotores()
  const [busca, setBusca] = useState('')
  const [catSelecionada, setCatSelecionada] = useState<string | null>(null)
  const [grupoSel, setGrupoSel] = useState<string | null>(null)
  // Trifásico é o default comercial. Monofásico existe, mas o catálogo só tem
  // motor mono até 15 CV — acima disso a tela diz "sem cadastro" em vez de
  // devolver o preço trifásico disfarçado.
  const [voltagem, setVoltagem] = useState<VoltagemMotor>('trifasico')
  const ctxMotor = useMemo<CtxMotor>(
    () => ({ motores: motores ?? [], voltagem }),
    [motores, voltagem],
  )

  const filtrados = useMemo(() => {
    if (!precos) return []
    const q = busca.trim().toLowerCase()
    return precos.filter(p => {
      // A BUSCA IGNORA o grupo de proposito: quem digita "BNMM" quer achar,
      // nao lembrar em que etapa da fabrica aquilo mora.
      if (!q && grupoSel && (GRUPO_DE_CAT[p.categoria] ?? GRUPO_SOBRA) !== grupoSel) return false
      if (catSelecionada && p.categoria !== catSelecionada) return false
      if (q) {
        const hay = `${p.descricao} ${p.codigo ?? ''} ${p.modelo ?? ''} ${p.capacidade ?? ''} ${p.potencia ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [precos, busca, catSelecionada, grupoSel])

  // Agrupa por categoria > subcategoria, respeitando SUBCAT_ORDER
  const grupos = useMemo(() => {
    const map = new Map<string, Map<string | null, PrecoBranorte[]>>()
    for (const p of filtrados) {
      if (!map.has(p.categoria)) map.set(p.categoria, new Map())
      const sub = map.get(p.categoria)!
      if (!sub.has(p.subcategoria)) sub.set(p.subcategoria, [])
      sub.get(p.subcategoria)!.push(p)
    }
    // Reordena subcategorias conforme SUBCAT_ORDER
    const ordered = new Map<string, Map<string | null, PrecoBranorte[]>>()
    for (const [cat, subs] of map.entries()) {
      const order = SUBCAT_ORDER[cat] ?? []
      const sortedSub = new Map<string | null, PrecoBranorte[]>()
      // Primeiro insere as subcategorias na ordem definida
      for (const subName of order) {
        if (subs.has(subName)) sortedSub.set(subName, subs.get(subName)!)
      }
      // Depois insere as remanescentes (sem ordem definida)
      for (const [subName, items] of subs.entries()) {
        if (!sortedSub.has(subName)) sortedSub.set(subName, items)
      }
      ordered.set(cat, sortedSub)
    }
    return ordered
  }, [filtrados])

  // Quantos itens em cada etapa (conta sobre TUDO, nao sobre o filtrado — o
  // numero no chip nao pode mudar conforme o que ja esta filtrado).
  const contaGrupo = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of precos ?? []) {
      const g = GRUPO_DE_CAT[p.categoria] ?? GRUPO_SOBRA
      m.set(g, (m.get(g) || 0) + 1)
    }
    return m
  }, [precos])

  // Categorias mostradas na 2a fileira = so as do grupo aberto. Sem grupo aberto
  // nao ha 2a fileira (era exatamente a parede de 22 chips em 4 fileiras).
  const categorias = useMemo(() => {
    if (!precos) return []
    const m = new Map<string, number>()
    for (const p of precos) {
      if (grupoSel && (GRUPO_DE_CAT[p.categoria] ?? GRUPO_SOBRA) !== grupoSel) continue
      m.set(p.categoria, (m.get(p.categoria) || 0) + 1)
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [precos, grupoSel])

  if (isLoading) return <PageLoading />

  const totalGeral = precos?.length ?? 0
  const totalFiltrados = filtrados.length

  return (
    <MotorCtx.Provider value={ctxMotor}>
    <div className="min-h-screen bg-bg">
      {/* 1800px e nao `max-w-7xl` (1280): a matriz do transportador tem 7 colunas
          e num monitor de 1920 sobrava ~45% de tela vazia enquanto as celulas de
          preco se espremiam. `mx-auto` mantem centralizado, entao telas menores
          nao mudam nada — so param de ser o teto pras grandes. */}
      <div className="max-w-[1800px] mx-auto px-4 sm:px-6 py-6">
        <div className="mb-3 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <BookOpen className="w-5 h-5 text-accent" />
              <h1 className="text-[18px] font-semibold text-ink">Tabela de Preços Branorte</h1>
            </div>
            <p className="text-[12px] text-ink-muted">
              Banco oficial extraído da planilha 06/2025 — {totalGeral} equipamentos em {categorias.length} categorias.
              {podeEditar ? ' Clique em qualquer valor pra editar (Enter salva).' : ' Preços oficiais para consulta.'}
            </p>
          </div>
          {podeEditar && <BotaoSincronizarModelos />}
        </div>

        {podeEditar && <PainelAuditoria />}

        <div className="bg-surface border border-border rounded-lg p-3 mb-4 space-y-3">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-ink-faint" />
            <Input
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder="Buscar por nome, código (BNMM, EC, SAB, BNCX), capacidade ou potência..."
              className="pl-7"
            />
          </div>
          {/* FILEIRA 1 — etapa da fabrica. Trocar de etapa zera a categoria: sem
              isso sobra filtro de categoria que nao existe na etapa nova e a
              lista volta vazia sem explicar por que. */}
          <div className="flex flex-wrap gap-1.5">
            {GRUPOS.map(g => {
              const qtd = contaGrupo.get(g.id) ?? 0
              if (qtd === 0) return null
              const on = grupoSel === g.id
              return (
                <button
                  key={g.id}
                  onClick={() => { setGrupoSel(on ? null : g.id); setCatSelecionada(null) }}
                  className={`text-[11px] px-3 py-1.5 rounded-md font-semibold transition ${
                    on ? 'bg-accent text-white'
                       : 'bg-surface-2 text-ink hover:bg-surface-3 border border-border'
                  }`}
                >
                  {g.label} ({qtd})
                </button>
              )
            })}
            {(contaGrupo.get(GRUPO_SOBRA) ?? 0) > 0 && (
              <button
                onClick={() => { setGrupoSel(grupoSel === GRUPO_SOBRA ? null : GRUPO_SOBRA); setCatSelecionada(null) }}
                className={`text-[11px] px-3 py-1.5 rounded-md font-semibold transition ${
                  grupoSel === GRUPO_SOBRA ? 'bg-accent text-white'
                    : 'bg-amber-500/15 text-amber-500 border border-amber-500/40'
                }`}
                title="Categoria que ainda nao foi encaixada numa etapa — avise pra arrumar"
              >
                {GRUPO_SOBRA} ({contaGrupo.get(GRUPO_SOBRA)})
              </button>
            )}
          </div>

          {/* FILEIRA 2 — categorias. SEMPRE visível: com etapa aberta mostra as dela,
              sem etapa mostra TODAS as 22. Ficava escondida atrás de um clique e o
              dono pediu as categorias alcançáveis direto. */}
          {categorias.length > 1 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setCatSelecionada(null)}
              className={`text-[11px] px-3 py-1.5 rounded-md font-medium transition ${
                catSelecionada === null
                  ? 'bg-accent text-white'
                  : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'
              }`}
            >
              {grupoSel ? `Tudo da etapa (${contaGrupo.get(grupoSel) ?? 0})` : `Todas (${totalGeral})`}
            </button>
            {categorias.map(([cat, qtd]) => (
              <button
                key={cat}
                onClick={() => setCatSelecionada(cat === catSelecionada ? null : cat)}
                className={`text-[11px] px-3 py-1.5 rounded-md font-medium transition flex items-center gap-1 ${
                  catSelecionada === cat
                    ? 'bg-accent text-white'
                    : 'bg-surface-2 text-ink-muted hover:bg-surface-3 hover:text-ink border border-border'
                }`}
              >
                <Tags className="h-3 w-3" />
                {CATEGORIA_LABEL[cat] ?? cat} ({qtd})
              </button>
            ))}
          </div>
          )}
          {/* VOLTAGEM — só afeta o preço do MOTOR À PARTE (moinho martelo,
              chupim, misturador vertical). O preço do equipamento não muda. */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-border/40">
            <Zap className="w-3 h-3 text-warning" />
            <span className="text-[10px] uppercase tracking-wider font-semibold text-ink-faint mr-1">
              Motor à parte
            </span>
            {([['trifasico', 'Trifásico'], ['monofasico', 'Monofásico']] as const).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setVoltagem(v)}
                aria-pressed={voltagem === v}
                className={`text-[11px] px-2.5 py-1 rounded-md font-semibold transition ${
                  voltagem === v ? 'bg-warning text-white'
                    : 'bg-surface-2 text-ink-muted hover:text-ink hover:bg-surface-3 border border-border'
                }`}
              >
                {label}
              </button>
            ))}
            <span className="text-[10px] text-ink-faint ml-1">
              muda só o preço do motor vendido à parte
              {voltagem === 'monofasico' && (
                <span className="text-warning"> — catálogo só tem motor monofásico até 15 cv</span>
              )}
            </span>
          </div>
          {busca && (
            <div className="text-[10px] text-ink-faint">
              {totalFiltrados} resultado{totalFiltrados !== 1 ? 's' : ''} para "{busca}"
            </div>
          )}
        </div>

        {/* Sem etapa escolhida e sem busca, a tela NAO despeja as 484 linhas em 22
            secoes — que era a rolagem infinita. Mostra o convite e para. */}
        {!grupoSel && !catSelecionada && !busca ? (
          <div className="bg-surface border border-border rounded-lg p-8 text-center">
            <BookOpen className="w-6 h-6 text-ink-faint mx-auto mb-2" />
            <p className="text-[13px] text-ink">Escolha uma etapa ou uma categoria acima</p>
            <p className="text-[12px] text-ink-muted mt-1">
              ou busque direto por nome, código, capacidade ou potência — a busca varre as {totalGeral} linhas de uma vez.
            </p>
          </div>
        ) : totalFiltrados === 0 ? (
          <div className="bg-surface border border-border rounded-lg p-8 text-center">
            <p className="text-[13px] text-ink">Nada encontrado</p>
            <p className="text-[12px] text-ink-muted mt-1">
              {busca ? <>Nenhum item bate com "{busca}".</> : 'Esta etapa não tem itens ativos.'}
            </p>
          </div>
        ) : (
        <div className="space-y-4">
          {[...grupos.entries()].map(([cat, subs]) => (
            <div key={cat} className="bg-surface border border-border rounded-lg overflow-hidden">
              <div className="px-3 py-2 bg-accent/15 border-b border-accent/30 flex items-center justify-between">
                <h2 className="text-[12px] font-bold uppercase tracking-wider text-accent">
                  {CATEGORIA_LABEL[cat] ?? cat}
                </h2>
                <span className="text-[10px] text-ink-muted">
                  {[...subs.values()].reduce((s, arr) => s + arr.length, 0)} {[...subs.values()].reduce((s, arr) => s + arr.length, 0) === 1 ? 'item' : 'itens'}
                </span>
              </div>
              {/* MATRIZ vs LISTA.
                  Com BUSCA ativa a matriz nao serve: ela e uma grade completa de
                  6 colunas × 39 linhas, e um resultado de busca preenche 2 ou 3
                  celulas dela — o usuario receberia uma grade quase toda
                  hachurada pra achar 3 precos. Buscando, as duas categorias
                  voltam pra lista, que mostra exatamente o que casou. */}
              {CATS_MATRIZ.has(cat) && !busca ? (
                cat === 'TRANSPORTADOR'
                  ? <MatrizTransportador items={[...subs.values()].flat()} />
                  : <MatrizElevador items={[...subs.values()].flat()} />
              ) : (
                [...subs.entries()].map(([sub, items]) => (
                  <div key={sub ?? '_'}>
                    {sub && (
                      <div className="px-3 py-1 bg-surface-2/50 border-b border-border/30">
                        <span className="text-[10px] uppercase tracking-wider font-bold text-ink-muted">
                          {SUBCATEGORIA_LABEL[sub] ?? sub}
                        </span>
                        <span className="text-[10px] text-ink-faint ml-2">{items.length}</span>
                      </div>
                    )}
                    <TabelaPorCategoria items={items} />
                  </div>
                ))
              )}
            </div>
          ))}
        </div>
        )}
      </div>
    </div>
    </MotorCtx.Provider>
  )
}
