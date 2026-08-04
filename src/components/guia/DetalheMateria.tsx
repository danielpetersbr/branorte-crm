/**
 * Página individual de uma matéria-prima.
 *
 * Duas metades explícitas, e é essa separação que consertou o guia:
 *   NUTRIÇÃO — pra que serve, quanto entra, em quem, restrições
 *   MECÂNICA — o que o ingrediente faz COM A MÁQUINA
 *
 * O guia antigo só tinha a primeira. Dezoito ingredientes e nenhuma palavra
 * sobre moagem, poeira, corrosão, ponte no silo, pré-mistura ou misturador
 * indicado — o vendedor não conseguia dimensionar nada.
 */
import { Beaker, Cog, MessageCircleQuestion, Package, Wrench } from 'lucide-react'
import { Alerta, SeloCompat, SeloPendente, SeloRisco, SeloStatus } from './Selos'
import { Foto } from './Foto'
import {
  BarraAcoes, Campo, Equipamentos, Fontes, Lista, Perguntas, Secao,
} from './DetalhePartes'
import { Badge } from '@/components/ui/Badge'
import {
  COMPAT, FICHA_MECANICA, FLUIDEZ, MISTURADOR, NOME_CATEGORIA, NOME_ESPECIE,
} from '@/lib/guia/catalogo'
import type { Especie, GuiaFonte, GuiaImagem, GuiaMateria, ItemGuia } from '@/lib/guia/tipos'

interface Props {
  m: GuiaMateria
  imagem?: GuiaImagem | null
  fontes: Map<string, GuiaFonte>
  favorito: boolean
  onFavoritar: () => void
  relacionados: ItemGuia[]
  onAbrirRelacionado: (i: ItemGuia) => void
}

function resumoTexto(m: GuiaMateria): string {
  const L = [`*${m.nome}* — ${NOME_CATEGORIA[m.categoria]}`, '', m.resumo]
  if (m.resumo_30s) L.push('', m.resumo_30s)
  if (m.compat_branorte !== 'ok') L.push('', `Branorte: ${COMPAT[m.compat_branorte].nome}.`,
    m.compat_motivo ?? '')
  if (m.nivel_risco === 'alto_risco' || m.nivel_risco === 'incompativel') {
    L.push('', `ATENÇÃO: ${m.alerta ?? ''}`)
  }
  L.push('', 'Valores de referência. Formulação por profissional habilitado em nutrição animal.')
  return L.filter(Boolean).join('\n')
}

export function DetalheMateria({
  m, imagem, fontes, favorito, onFavoritar, relacionados, onAbrirRelacionado,
}: Props) {
  const ficha = FICHA_MECANICA
    .map(f => ({ ...f, valor: (m as unknown as Record<string, unknown>)[f.campo] }))
    .filter(f => f.valor === true)

  const inclusoes = Object.entries(m.inclusao ?? {})

  return (
    <article className="space-y-4">
      {/* ---------------- cabeçalho ---------------- */}
      <header className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Foto imagem={imagem} emoji={m.emoji} nome={m.nome} variante="detalhe" mostrarCredito />
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold leading-tight text-ink">{m.nome}</h2>
              <Badge className="bg-surface-2 text-ink-muted">{NOME_CATEGORIA[m.categoria]}</Badge>
            </div>
            {!!m.sinonimos?.length && (
              <p className="text-[12px] text-ink-faint">Também chamado de: {m.sinonimos.join(', ')}</p>
            )}
            <p className="text-[13.5px] leading-relaxed text-ink">{m.resumo}</p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              <SeloCompat compat={m.compat_branorte} />
              <SeloRisco nivel={m.nivel_risco} />
              {m.status !== 'aprovado' && <SeloStatus status={m.status} />}
              {m.pendente_validacao && <SeloPendente pendencias={m.pendencias} />}
            </div>
          </div>
        </div>

        <BarraAcoes favorito={favorito} onFavoritar={onFavoritar} textoParaCopiar={resumoTexto(m)} />
      </header>

      {/* ---------------- alertas no topo: o vendedor não pode rolar pra ver ---------------- */}
      {(m.nivel_risco === 'alto_risco' || m.nivel_risco === 'incompativel') && m.alerta && (
        <Alerta nivel={m.nivel_risco}><strong>{m.alerta}</strong></Alerta>
      )}
      {m.compat_branorte === 'incompativel' && m.compat_motivo && (
        <Alerta nivel="incompativel">{m.compat_motivo}</Alerta>
      )}

      {m.resumo_30s && (
        <Secao titulo="Resumo em 30 segundos" destaque>
          <p className="text-[13.5px] font-medium leading-relaxed text-ink">{m.resumo_30s}</p>
        </Secao>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ============ NUTRIÇÃO ============ */}
        <Secao titulo="Nutrição" icone={<Beaker className="h-3.5 w-3.5" />}>
          <dl>
            <Campo rotulo="Pra que serve" valor={m.funcao} />
            <Campo rotulo="Composição de referência" valor={m.composicao} />
          </dl>
          {!!inclusoes.length && (
            <div className="mt-2">
              <p className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">
                Faixa de inclusão <span className="normal-case text-warning">(referência, não prescrição)</span>
              </p>
              <dl className="mt-1 space-y-1">
                {inclusoes.map(([k, v]) => (
                  <div key={k} className="flex gap-2 text-[13px]">
                    <dt className="shrink-0 font-medium capitalize text-ink-muted">{k.replace(/_/g, ' ')}:</dt>
                    <dd className="min-w-0 text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
          {!!m.especies?.length && (
            <div className="mt-2.5">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Espécies compatíveis</p>
              <div className="flex flex-wrap gap-1.5">
                {m.especies.map(e => (
                  <Badge key={e} className="bg-success-bg text-success">
                    {NOME_ESPECIE[e as Especie] ?? e}
                  </Badge>
                ))}
              </div>
            </div>
          )}
          {!!m.restricoes?.length && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-warning">Restrições</p>
              <Lista itens={m.restricoes} marcador="!" />
            </div>
          )}
        </Secao>

        {/* ============ MECÂNICA — a metade que não existia ============ */}
        <Secao titulo="Como se comporta no equipamento" icone={<Cog className="h-3.5 w-3.5" />}>
          <dl className="divide-y divide-border">
            <Campo rotulo="Forma física" valor={m.forma_fisica} />
            <Campo rotulo="Densidade aproximada" valor={m.densidade_kg_m3} />
            <Campo rotulo="Umidade" valor={m.umidade} />
            <Campo rotulo="Fluidez" valor={m.fluidez ? FLUIDEZ[m.fluidez] : null} />
            <Campo rotulo="Granulometria" valor={m.granulometria} />
            <Campo
              rotulo="Misturador indicado"
              valor={m.misturador_indicado ? MISTURADOR[m.misturador_indicado] : null}
            />
            <Campo rotulo="Armazenamento" valor={m.armazenamento} />
          </dl>

          {!!ficha.length && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                Ficha rápida
              </p>
              <ul className="flex flex-wrap gap-1.5">
                {ficha.map(f => (
                  <li key={f.campo}>
                    <Badge className={f.alerta ? 'bg-warning-bg text-warning' : 'bg-success-bg text-success'}>
                      {f.quandoTrue}
                    </Badge>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {m.compat_motivo && m.compat_branorte !== 'incompativel' && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                Compatibilidade com a linha Branorte
              </p>
              <p className="text-[13px] leading-relaxed text-ink">{m.compat_motivo}</p>
            </div>
          )}

          {!!m.equipamentos?.length && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="mb-1.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                <Wrench className="h-3 w-3" />Equipamentos relacionados
              </p>
              <Equipamentos chaves={m.equipamentos} />
            </div>
          )}
        </Secao>
      </div>

      {/* ---------------- venda ---------------- */}
      <div className="grid gap-4 lg:grid-cols-2">
        {!!m.perguntas?.length && (
          <Secao titulo="Perguntas para fazer ao cliente" icone={<MessageCircleQuestion className="h-3.5 w-3.5" />}>
            <Perguntas perguntas={m.perguntas} />
          </Secao>
        )}
        {m.explicar_cliente && (
          <Secao titulo="Como explicar para o cliente">
            <blockquote className="border-l-[3px] border-accent/40 pl-3 text-[13.5px] italic leading-relaxed text-ink">
              {m.explicar_cliente}
            </blockquote>
          </Secao>
        )}
      </div>

      {m.regiao && (
        <Secao titulo="Onde encontrar" icone={<Package className="h-3.5 w-3.5" />}>
          <p className="text-[13px] leading-relaxed text-ink">{m.regiao}</p>
        </Secao>
      )}

      {!!m.pendencias?.length && (
        <Secao titulo="Pendências de validação">
          <Lista itens={m.pendencias} marcador="□" />
        </Secao>
      )}

      <Fontes
        chaves={m.fontes} revisadoEm={m.revisado_em} revisor={m.revisor_tecnico} mapa={fontes}
      />

      {!!relacionados.length && (
        <Secao titulo="Conteúdos relacionados">
          <div className="flex flex-wrap gap-1.5">
            {relacionados.map(r => (
              <button
                key={`${r.tipo}:${r.slug}`}
                onClick={() => onAbrirRelacionado(r)}
                className="rounded-md border border-border bg-surface px-2.5 py-1 text-[12px] text-ink hover:border-border-strong hover:bg-surface-2"
              >
                {r.emoji} {r.nome}
              </button>
            ))}
          </div>
        </Secao>
      )}
    </article>
  )
}
