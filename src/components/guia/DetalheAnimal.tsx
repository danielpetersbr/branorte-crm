/**
 * Página individual de um animal (fase/sistema ou raça/linhagem).
 *
 * Ordem das seções segue o que o vendedor precisa NA ORDEM em que precisa:
 * identificação → o que perguntar → consumo → o que a Branorte atende →
 * argumento permitido → o que NÃO prometer → fontes.
 *
 * "O que NÃO prometer" é seção de primeira classe. Era o buraco que fazia o
 * card do Ross recomendar ração peletizada num guia com a marca de um
 * fabricante que só faz farelada.
 */
import { Ban, Factory, MessageCircleQuestion, Scale, Sparkles, Wrench } from 'lucide-react'
import { Alerta, SeloPendente, SeloStatus } from './Selos'
import { Foto } from './Foto'
import {
  BarraAcoes, BlocoBranorteView, Campo, Equipamentos, Fontes, Lista, Perguntas, Secao,
} from './DetalhePartes'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { NOME_ESPECIE, NOME_SISTEMA, SUBGRUPOS, TIPOS_ANIMAL } from '@/lib/guia/catalogo'
import type { GuiaAnimal, GuiaFonte, GuiaImagem, ItemGuia } from '@/lib/guia/tipos'

interface Props {
  a: GuiaAnimal
  imagem?: GuiaImagem | null
  fontes: Map<string, GuiaFonte>
  favorito: boolean
  onFavoritar: () => void
  relacionados: ItemGuia[]
  onAbrirRelacionado: (i: ItemGuia) => void
  onUsarNoEstudo?: () => void
}

function resumoTexto(a: GuiaAnimal): string {
  const L = [`*${a.nome}*`, '', a.resumo]
  if (a.resumo_30s) L.push('', a.resumo_30s)
  if (a.consumo_ref) L.push('', `Consumo de referência: ${a.consumo_ref}`)
  if (a.branorte?.nao_atende?.length) {
    L.push('', 'A Branorte NÃO atende:', ...a.branorte.nao_atende.map(x => `- ${x}`))
  }
  L.push('', 'Valores de referência. Consumo e formulação devem ser confirmados com o cliente '
    + 'e com profissional habilitado em nutrição animal.')
  return L.filter(Boolean).join('\n')
}

export function DetalheAnimal({
  a, imagem, fontes, favorito, onFavoritar, relacionados, onAbrirRelacionado, onUsarNoEstudo,
}: Props) {
  const peso = a.peso_min_kg && a.peso_max_kg
    ? `${a.peso_min_kg}–${a.peso_max_kg} kg`
    : a.peso_nota ?? null

  return (
    <article className="space-y-4">
      <header className="space-y-3">
        <div className="overflow-hidden rounded-lg border border-border bg-surface">
          <Foto imagem={imagem} emoji={a.emoji} nome={a.nome} variante="detalhe" mostrarCredito
            semRetrato={a.tipo === 'categoria'} />
          {/* Lacuna vira informação. Sem isso, o vendedor abre o card do Ross,
              vê um espaço vazio e supõe que o guia está incompleto — quando na
              verdade a foto é IMPOSSÍVEL: nenhuma imagem distingue Cobb de Ross. */}
          {!imagem?.arquivo_url && a.especie === 'aves' && a.tipo === 'linhagem' && (
            <p className="border-b border-border bg-surface-2/60 px-4 py-2 text-[11.5px] leading-relaxed text-ink-muted">
              Sem foto porque nenhuma foto resolve: linhagens comerciais de ave não são
              visualmente distinguíveis entre si. Frangos de corte são todos brancos; poedeiras
              comerciais, todas marrons ou todas brancas. Quem identifica a linhagem é o
              documento do incubatório, não a aparência da ave.
            </p>
          )}
          <div className="space-y-2 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-bold leading-tight text-ink">{a.nome}</h2>
              <Badge className="bg-surface-2 text-ink-muted">{TIPOS_ANIMAL[a.tipo]}</Badge>
              <Badge className="bg-surface-2 text-ink-muted">{NOME_ESPECIE[a.especie]}</Badge>
              {a.subgrupo && (
                <Badge className="bg-surface-2 text-ink-muted">{SUBGRUPOS[a.subgrupo] ?? a.subgrupo}</Badge>
              )}
            </div>
            {a.classificacao && <p className="text-[12px] text-ink-faint">{a.classificacao}</p>}
            {!!a.sinonimos?.length && (
              <p className="text-[12px] text-ink-faint">Também chamado de: {a.sinonimos.join(', ')}</p>
            )}
            <p className="text-[13.5px] leading-relaxed text-ink">{a.resumo}</p>
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {a.status !== 'aprovado' && <SeloStatus status={a.status} />}
              {a.pendente_validacao && <SeloPendente pendencias={a.pendencias} />}
            </div>
          </div>
        </div>

        <BarraAcoes
          favorito={favorito}
          onFavoritar={onFavoritar}
          textoParaCopiar={resumoTexto(a)}
          extra={onUsarNoEstudo && a.fase_estudo ? (
            <Button size="sm" variant="primary" onClick={onUsarNoEstudo}>
              <Factory className="h-3.5 w-3.5" />
              Usar no estudo de viabilidade
            </Button>
          ) : undefined}
        />
      </header>

      {a.resumo_30s && (
        <Secao titulo="Resumo em 30 segundos" destaque>
          <p className="text-[13.5px] font-medium leading-relaxed text-ink">{a.resumo_30s}</p>
        </Secao>
      )}

      {/* Perguntas vêm ANTES do conteúdo: o vendedor está no telefone agora. */}
      {!!a.perguntas?.length && (
        <Secao titulo="Perguntas para fazer ao cliente" icone={<MessageCircleQuestion className="h-3.5 w-3.5" />}>
          <Perguntas perguntas={a.perguntas} />
          {!!a.sinais_falta_info?.length && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-warning">
                Sinais de que ainda falta informação
              </p>
              <Lista itens={a.sinais_falta_info} marcador="?" />
            </div>
          )}
        </Secao>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Secao titulo="Criação" icone={<Scale className="h-3.5 w-3.5" />}>
          <dl className="divide-y divide-border">
            <Campo rotulo="Finalidade" valor={a.finalidade} />
            <Campo rotulo="Faixa de peso" valor={peso} />
            <Campo rotulo="Consumo de referência" valor={a.consumo_ref} />
            <Campo rotulo="Unidade" valor={a.consumo_unidade} />
          </dl>
          {!!a.sistemas?.length && (
            <div className="mt-2.5">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Sistemas de criação</p>
              <div className="flex flex-wrap gap-1.5">
                {a.sistemas.map(s => (
                  <Badge key={s} className="bg-surface-2 text-ink-muted">{NOME_SISTEMA(s)}</Badge>
                ))}
              </div>
            </div>
          )}
          {!!a.tipos_alimentacao?.length && (
            <div className="mt-2.5">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Tipos de alimentação</p>
              <div className="flex flex-wrap gap-1.5">
                {a.tipos_alimentacao.map(t => (
                  <Badge key={t} className="bg-surface-2 text-ink-muted">{t}</Badge>
                ))}
              </div>
            </div>
          )}
          {!!a.forma_fisica?.length && (
            <div className="mt-2.5">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-ink-faint">Forma física da ração</p>
              <div className="flex flex-wrap gap-1.5">
                {a.forma_fisica.map(f => (
                  <Badge key={f} className="bg-surface-2 text-ink-muted">{f}</Badge>
                ))}
              </div>
            </div>
          )}
          {!!a.consumo_fatores?.length && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                O que altera o consumo
              </p>
              <Lista itens={a.consumo_fatores} />
            </div>
          )}
        </Secao>

        <Secao titulo="Processo e equipamento" icone={<Wrench className="h-3.5 w-3.5" />}>
          {a.processo && <p className="text-[13px] leading-relaxed text-ink">{a.processo}</p>}
          {!!a.equipamentos?.length && (
            <div className="mt-3">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-ink-faint">
                Equipamentos que podem ser analisados
              </p>
              <Equipamentos chaves={a.equipamentos} />
              <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                Lista para ANÁLISE. O equipamento só se define com quantidade, consumo confirmado,
                horas disponíveis e energia da propriedade.
              </p>
            </div>
          )}
          {!!a.restricoes?.length && (
            <div className="mt-3 border-t border-border pt-2.5">
              <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-warning">Restrições importantes</p>
              <Lista itens={a.restricoes} marcador="!" />
            </div>
          )}
        </Secao>
      </div>

      <BlocoBranorteView b={a.branorte} />

      <div className="grid gap-4 lg:grid-cols-2">
        {a.argumento && (
          <Secao titulo="Argumento comercial permitido" icone={<Sparkles className="h-3.5 w-3.5" />}>
            <p className="text-[13.5px] leading-relaxed text-ink">{a.argumento}</p>
          </Secao>
        )}
        {!!a.promessas_proibidas?.length && (
          <Secao titulo="O que NÃO prometer" icone={<Ban className="h-3.5 w-3.5" />}>
            <div className="space-y-2">
              {a.promessas_proibidas.map((p, i) => (
                <Alerta key={i} nivel="atencao">{p}</Alerta>
              ))}
            </div>
          </Secao>
        )}
      </div>

      {a.explicar_cliente && (
        <Secao titulo="Como explicar para o cliente">
          <blockquote className="border-l-[3px] border-accent/40 pl-3 text-[13.5px] italic leading-relaxed text-ink">
            {a.explicar_cliente}
          </blockquote>
        </Secao>
      )}

      {a.regiao && (
        <Secao titulo="Onde está esse cliente">
          <p className="text-[13px] leading-relaxed text-ink">{a.regiao}</p>
        </Secao>
      )}

      {!!a.pendencias?.length && (
        <Secao titulo="Pendências de validação">
          <Lista itens={a.pendencias} marcador="□" />
        </Secao>
      )}

      <Fontes chaves={a.fontes} revisadoEm={a.revisado_em} revisor={a.revisor_tecnico} mapa={fontes} />

      {!!relacionados.length && (
        <Secao titulo="Matérias-primas comuns nessa criação">
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
