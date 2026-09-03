import { useMemo, useState } from 'react'
import { MapPin, Search, X, Check, Loader2 } from 'lucide-react'
import { useMunicipios, useDefinirCidadeVisita, type Visita, type Municipio } from '@/hooks/useVisitas'

/**
 * Fila de "completar cidade" dos clientes salvos pelo card 📍 Dados pra visita.
 *
 * Medido em 03/09/2026: dos 1.024 registros, 857 estão sem cidade E sem UF — o
 * vendedor salvou a ficha (nome, interesse, qualificação) e não preencheu onde o
 * cliente fica. Sem isso não há pino: o mapa é feito de coordenada, e coordenada
 * sai da cidade. Esta fila existe pra fechar esse buraco sem ter que reabrir cada
 * conversa no WhatsApp.
 *
 * A gravação vai por RPC (`visita_definir_cidade`), que recusa município fora do
 * IBGE e grava a grafia oficial — é o que impede o cache de coordenada de encher
 * de "Senhor do Bonfm" e "Fortaleça", que nunca resolvem e ficam presos no centro
 * do estado.
 */

const UFS = [
  'AC', 'AL', 'AM', 'AP', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MG', 'MS', 'MT',
  'PA', 'PB', 'PE', 'PI', 'PR', 'RJ', 'RN', 'RO', 'RR', 'RS', 'SC', 'SE', 'SP', 'TO',
]

const norm = (s: string) =>
  (s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim()

/** +5566998144699 → (66) 99814-4699 */
function foneBonito(fone: string | null): string {
  const d = (fone || '').replace(/\D/g, '')
  const s = d.startsWith('55') ? d.slice(2) : d
  if (s.length < 10) return fone || '—'
  const meio = s.length === 11 ? `${s.slice(2, 7)}-${s.slice(7)}` : `${s.slice(2, 6)}-${s.slice(6)}`
  return `(${s.slice(0, 2)}) ${meio}`
}

interface LinhaProps {
  v: Visita
  municipios: Municipio[]
  onSalvo: (telefone: string) => void
}

function Linha({ v, municipios, onSalvo }: LinhaProps) {
  const [cidade, setCidade] = useState('')
  const [uf, setUf] = useState(v.estado?.trim().toUpperCase() || '')
  const [aberto, setAberto] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const salvar = useDefinirCidadeVisita()

  // Sugestões por prefixo primeiro (quem digita "cri" quer Criciúma, não "Nova Cristina"),
  // e a UF já escolhida filtra — 5.571 municípios têm 200 "Bom Jesus" da vida.
  const sugestoes = useMemo(() => {
    const t = norm(cidade)
    if (t.length < 2) return []
    const base = uf ? municipios.filter(m => m.uf === uf) : municipios
    const pref: Municipio[] = []
    const meio: Municipio[] = []
    for (const m of base) {
      const n = norm(m.nome)
      if (n.startsWith(t)) pref.push(m)
      else if (n.includes(t)) meio.push(m)
      if (pref.length >= 8) break
    }
    return [...pref, ...meio].slice(0, 8)
  }, [cidade, uf, municipios])

  const escolher = (m: Municipio) => {
    setCidade(m.nome)
    setUf(m.uf)
    setAberto(false)
  }

  const gravar = () => {
    setErro(null)
    salvar.mutate({ telefone: v.telefone || '', cidade, uf }, {
      onSuccess: () => onSalvo(v.telefone || ''),
      onError: (e: unknown) => setErro(e instanceof Error ? e.message : 'falhou'),
    })
  }

  return (
    <div className="border-b border-border last:border-b-0 py-2.5 px-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <div className="min-w-[8rem] flex-1">
          <div className="text-[13px] font-semibold text-ink truncate">{v.nome || 'sem nome'}</div>
          <div className="text-[11px] text-ink-muted">
            <a href={`https://wa.me/${(v.telefone || '').replace(/\D/g, '')}`} target="_blank" rel="noreferrer"
               className="hover:text-accent">{foneBonito(v.telefone)}</a>
            {v.vendedor_nome && <> · {v.vendedor_nome}</>}
            {v.interesse && <> · <span className="italic">{v.interesse.slice(0, 40)}</span></>}
          </div>
        </div>

        <div className="relative">
          <input
            value={cidade}
            onChange={e => { setCidade(e.target.value); setAberto(true) }}
            onFocus={() => setAberto(true)}
            onBlur={() => setTimeout(() => setAberto(false), 150)}
            placeholder="cidade"
            className="h-8 w-44 px-2 rounded-md border border-border bg-surface text-[13px] text-ink"
          />
          {aberto && sugestoes.length > 0 && (
            <ul className="absolute z-20 mt-1 w-56 max-h-56 overflow-auto rounded-md border border-border bg-surface shadow-lg">
              {sugestoes.map(m => (
                <li key={`${m.nome}|${m.uf}`}>
                  <button type="button" onMouseDown={() => escolher(m)}
                          className="w-full text-left px-2.5 py-1.5 text-[13px] text-ink hover:bg-accent-bg">
                    {m.nome} <span className="text-ink-muted">· {m.uf}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <select value={uf} onChange={e => setUf(e.target.value)}
                className="h-8 w-[4.5rem] px-1.5 rounded-md border border-border bg-surface text-[13px] text-ink">
          <option value="">UF</option>
          {UFS.map(u => <option key={u} value={u}>{u}</option>)}
        </select>

        <button
          onClick={gravar}
          disabled={!cidade.trim() || !uf || salvar.isPending}
          className="h-8 px-3 rounded-md text-[12px] font-semibold bg-accent text-white disabled:opacity-40 flex items-center gap-1.5"
        >
          {salvar.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          Salvar
        </button>
      </div>
      {erro && <div className="mt-1 text-[11px] text-danger">{erro}</div>}
    </div>
  )
}

export function CompletarCidade({ visitas, aberto, onFechar }: {
  visitas: Visita[]
  aberto: boolean
  onFechar: () => void
}) {
  const { data: municipios = [], isLoading } = useMunicipios()
  const [termo, setTermo] = useState('')
  const [vendSel, setVendSel] = useState('')
  const [prontos, setProntos] = useState<Set<string>>(new Set())

  const semCidade = useMemo(
    () => visitas.filter(v => !(v.cidade || '').trim() || !(v.estado || '').trim()),
    [visitas])

  const vendedores = useMemo(
    () => [...new Set(semCidade.map(v => (v.vendedor_nome || '').trim()).filter(Boolean))].sort(),
    [semCidade])

  const lista = useMemo(() => {
    const t = termo.trim().toLowerCase()
    return semCidade.filter(v =>
      !prontos.has(v.telefone || '') &&
      (!vendSel || (v.vendedor_nome || '') === vendSel) &&
      (!t || [v.nome, v.telefone, v.interesse].some(x => (x || '').toLowerCase().includes(t))))
  }, [semCidade, termo, vendSel, prontos])

  if (!aberto) return null

  return (
    <div className="fixed inset-0 z-[1200] flex items-end md:items-center justify-center bg-black/40 p-0 md:p-6"
         onClick={onFechar}>
      <div className="w-full md:max-w-3xl max-h-[85vh] flex flex-col rounded-t-2xl md:rounded-2xl border border-border bg-bg shadow-2xl"
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <MapPin className="w-4 h-4 text-warning" />
          <div className="flex-1">
            <div className="text-[14px] font-bold text-ink">Cliente sem cidade</div>
            <div className="text-[11px] text-ink-muted">
              Salvos no WhatsApp pelo card 📍 Dados pra visita. Sem cidade não há pino no mapa.
            </div>
          </div>
          <button onClick={onFechar} className="h-8 w-8 rounded-md hover:bg-surface flex items-center justify-center">
            <X className="w-4 h-4 text-ink-muted" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 px-3 py-2 border-b border-border">
          <div className="relative flex-1 min-w-[10rem]">
            <Search className="w-3.5 h-3.5 text-ink-muted absolute left-2 top-1/2 -translate-y-1/2" />
            <input value={termo} onChange={e => setTermo(e.target.value)} placeholder="Buscar nome ou telefone"
                   className="h-8 w-full pl-7 pr-2 rounded-md border border-border bg-surface text-[13px] text-ink" />
          </div>
          <select value={vendSel} onChange={e => setVendSel(e.target.value)}
                  className="h-8 px-2 rounded-md border border-border bg-surface text-[13px] text-ink">
            <option value="">Todos os vendedores</option>
            {vendedores.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <span className="text-[12px] text-ink-muted font-semibold">{lista.length} na fila</span>
        </div>

        <div className="overflow-auto">
          {isLoading && <div className="p-6 text-center text-[13px] text-ink-muted">carregando municípios…</div>}
          {!isLoading && lista.length === 0 && (
            <div className="p-8 text-center text-[13px] text-ink-muted">
              {prontos.size > 0 ? `Pronto — ${prontos.size} cliente(s) ganharam cidade agora.` : 'Ninguém na fila.'}
            </div>
          )}
          {!isLoading && lista.map(v => (
            <Linha key={v.id} v={v} municipios={municipios}
                   onSalvo={tel => setProntos(p => new Set(p).add(tel))} />
          ))}
        </div>

        <div className="px-4 py-2.5 border-t border-border text-[11px] text-ink-muted">
          O pino aparece na próxima vez que o mapa abrir — ele geocodifica sozinho quem ganhou cidade.
        </div>
      </div>
    </div>
  )
}
