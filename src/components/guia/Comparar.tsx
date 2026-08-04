/**
 * Comparação lado a lado.
 *
 * O vendedor compara para DECIDIR: milho × sorgo, farelo de soja × farelo de
 * algodão, calcário × fosfato. A tabela mostra só as linhas em que os dois
 * itens diferem de fato — comparação que repete tudo igual não ajuda ninguém.
 *
 * "Ração comprada × produção própria" não é comparação de card: é o estudo de
 * viabilidade. Por isso o atalho para /producao-propria no rodapé.
 */
import { ArrowRight, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { SeloCompat, SeloRisco } from './Selos'
import { FLUIDEZ, MISTURADOR, NOME_CATEGORIA, NOME_ESPECIE } from '@/lib/guia/catalogo'
import { cn } from '@/lib/utils'
import type { Especie, GuiaAnimal, GuiaMateria } from '@/lib/guia/tipos'

type Linha = { rotulo: string; a: string; b: string; diferente: boolean }

const sn = (v: boolean | null | undefined) => v === true ? 'Sim' : v === false ? 'Não' : '—'
const txt = (v: string | null | undefined) => v && v.trim() ? v : '—'

function linhasMateria(a: GuiaMateria, b: GuiaMateria): Linha[] {
  const incl = (m: GuiaMateria) => Object.entries(m.inclusao ?? {})
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`).join(' · ') || '—'
  const brutas: Array<[string, string, string]> = [
    ['Categoria', NOME_CATEGORIA[a.categoria], NOME_CATEGORIA[b.categoria]],
    ['Função', txt(a.funcao), txt(b.funcao)],
    ['Composição de referência', txt(a.composicao), txt(b.composicao)],
    ['Faixa de inclusão (referência)', incl(a), incl(b)],
    ['Espécies compatíveis',
      a.especies.map(e => NOME_ESPECIE[e as Especie] ?? e).join(', ') || '—',
      b.especies.map(e => NOME_ESPECIE[e as Especie] ?? e).join(', ') || '—'],
    ['Forma física', txt(a.forma_fisica), txt(b.forma_fisica)],
    ['Densidade', txt(a.densidade_kg_m3), txt(b.densidade_kg_m3)],
    ['Fluidez', a.fluidez ? FLUIDEZ[a.fluidez] : '—', b.fluidez ? FLUIDEZ[b.fluidez] : '—'],
    ['Precisa moer', sn(a.precisa_moer), sn(b.precisa_moer)],
    ['Entra direto no misturador', sn(a.direto_misturador), sn(b.direto_misturador)],
    ['Exige pré-mistura', sn(a.exige_pre_mistura), sn(b.exige_pre_mistura)],
    ['Microingrediente', sn(a.microingrediente), sn(b.microingrediente)],
    ['Compatível com rosca', sn(a.compat_rosca), sn(b.compat_rosca)],
    ['Forma ponte no silo', sn(a.forma_ponte), sn(b.forma_ponte)],
    ['Gera poeira', sn(a.gera_poeira), sn(b.gera_poeira)],
    ['Abrasivo', sn(a.abrasivo), sn(b.abrasivo)],
    ['Corrosivo', sn(a.corrosivo), sn(b.corrosivo)],
    ['Risco de micotoxina', sn(a.risco_micotoxina), sn(b.risco_micotoxina)],
    ['Misturador indicado',
      a.misturador_indicado ? MISTURADOR[a.misturador_indicado] : '—',
      b.misturador_indicado ? MISTURADOR[b.misturador_indicado] : '—'],
    ['Armazenamento', txt(a.armazenamento), txt(b.armazenamento)],
    ['Região', txt(a.regiao), txt(b.regiao)],
  ]
  return brutas.map(([rotulo, x, y]) => ({ rotulo, a: x, b: y, diferente: x !== y }))
}

function linhasAnimal(a: GuiaAnimal, b: GuiaAnimal): Linha[] {
  const brutas: Array<[string, string, string]> = [
    ['Espécie', NOME_ESPECIE[a.especie], NOME_ESPECIE[b.especie]],
    ['Finalidade', txt(a.finalidade), txt(b.finalidade)],
    ['Classificação', txt(a.classificacao), txt(b.classificacao)],
    ['Sistemas', a.sistemas.join(', ') || '—', b.sistemas.join(', ') || '—'],
    ['Consumo de referência', txt(a.consumo_ref), txt(b.consumo_ref)],
    ['Tipos de alimentação', a.tipos_alimentacao.join(', ') || '—', b.tipos_alimentacao.join(', ') || '—'],
    ['Matérias-primas comuns', a.materias_comuns.join(', ') || '—', b.materias_comuns.join(', ') || '—'],
    ['Processo', txt(a.processo), txt(b.processo)],
    ['Equipamentos', a.equipamentos.join(', ') || '—', b.equipamentos.join(', ') || '—'],
    ['Restrições', a.restricoes.join(' · ') || '—', b.restricoes.join(' · ') || '—'],
    ['Região', txt(a.regiao), txt(b.regiao)],
  ]
  return brutas.map(([rotulo, x, y]) => ({ rotulo, a: x, b: y, diferente: x !== y }))
}

interface Props {
  a: GuiaAnimal | GuiaMateria
  b: GuiaAnimal | GuiaMateria
  tipo: 'animal' | 'materia'
  onFechar: () => void
}

export function Comparar({ a, b, tipo, onFechar }: Props) {
  const linhas = tipo === 'materia'
    ? linhasMateria(a as GuiaMateria, b as GuiaMateria)
    : linhasAnimal(a as GuiaAnimal, b as GuiaAnimal)

  const diferentes = linhas.filter(l => l.diferente)
  const iguais = linhas.length - diferentes.length

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-bold text-ink">Comparação</h2>
          <p className="text-[12px] text-ink-faint">
            {diferentes.length} {diferentes.length === 1 ? 'diferença' : 'diferenças'}
            {iguais > 0 && ` · ${iguais} ${iguais === 1 ? 'campo igual omitido' : 'campos iguais omitidos'}`}
          </p>
        </div>
        <Button size="sm" onClick={onFechar}><X className="h-3.5 w-3.5" />Fechar</Button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="bg-surface-2">
              <th scope="col" className="w-44 px-3 py-2.5 text-left text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                Campo
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold text-ink">
                <div className="flex flex-wrap items-center gap-1.5">
                  {a.nome}
                  {tipo === 'materia' && <SeloCompat compat={(a as GuiaMateria).compat_branorte} />}
                  {tipo === 'materia' && <SeloRisco nivel={(a as GuiaMateria).nivel_risco} />}
                </div>
              </th>
              <th scope="col" className="px-3 py-2.5 text-left font-semibold text-ink">
                <div className="flex flex-wrap items-center gap-1.5">
                  {b.nome}
                  {tipo === 'materia' && <SeloCompat compat={(b as GuiaMateria).compat_branorte} />}
                  {tipo === 'materia' && <SeloRisco nivel={(b as GuiaMateria).nivel_risco} />}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {diferentes.map((l, i) => (
              <tr key={l.rotulo} className={cn('border-t border-border align-top', i % 2 && 'bg-surface-2/40')}>
                <th scope="row" className="px-3 py-2 text-left text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                  {l.rotulo}
                </th>
                <td className="px-3 py-2 leading-relaxed text-ink">{l.a}</td>
                <td className="px-3 py-2 leading-relaxed text-ink">{l.b}</td>
              </tr>
            ))}
            {!diferentes.length && (
              <tr>
                <td colSpan={3} className="px-3 py-6 text-center text-[13px] text-ink-faint">
                  Os dois itens não diferem em nenhum campo comparável.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <p className="text-[12.5px] text-ink-muted">
          Comparar <strong className="text-ink">ração comprada × produção própria</strong> não é
          comparação de ficha — é conta. Isso é o estudo de viabilidade, com os números do cliente.
        </p>
        <Link
          to="/producao-propria"
          className="mt-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent hover:underline"
        >
          Abrir o estudo de viabilidade <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </div>
  )
}
