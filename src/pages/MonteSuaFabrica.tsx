/**
 * Página PÚBLICA (sem login) — "Monte sua fábrica".
 *
 * Link colável: branorte-crm.vercel.app/monte-sua-fabrica
 *
 * O produtor responde 7 perguntas e vê, na hora, a linha de equipamentos que
 * atende a rotina dele: do recebimento do grão até a expedição da ração. Toda a
 * decisão mora em `lib/quiz-fabrica/motor.ts` — aqui só tem tela.
 *
 * ── Três decisões que valem repetir ────────────────────────────────────────
 *
 * 1) O RESULTADO NÃO É GATEADO. O produtor vê a fábrica antes de dar o telefone.
 *    Trancar o resultado atrás do cadastro num link que circula no WhatsApp
 *    rende telefone falso e mata o compartilhamento — que é justamente o que faz
 *    esta página valer. O contato aparece DENTRO do resultado, pra quem quiser
 *    falar com um técnico. A linha só é gravada quando ele envia o contato.
 *
 * 2) NÃO TEM PREÇO. Nenhum. Preço é conversa de orçamento, com vendedor. E a
 *    página roda deslogada: puxar preço daqui exigiria abrir `precos_branorte`
 *    pro anon, que é a tabela com a margem da empresa inteira.
 *
 * 3) PEIXE E PELETIZADA SAEM NA PRIMEIRA PERGUNTA. A Branorte só faz ração
 *    FARELADA — não fabrica peletizadora nem extrusora, e peixe exige extrusão.
 *    Dizer isso na cara, no primeiro clique, poupa o produtor de responder o
 *    quiz inteiro pra ouvir "não" no telefone depois.
 */
import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { CATEGORIAS, ESPECIES } from '@/lib/venda-racao/catalogo'
import {
  DIAS_MES_COMERCIAL, baseNaturalDe, calcularQuiz, consumoDeReferencia, consumoNaBase,
  consumoParaMes, inteiro, kg, respostasIniciais,
} from '@/lib/quiz-fabrica/motor'
import type { Especie, RespostasQuiz, ResultadoQuiz } from '@/lib/quiz-fabrica/tipos'

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'] as const

const TOTAL_PERGUNTAS = 7

const campo = 'w-full min-h-[46px] rounded-md border border-border bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all'
const rotulo = 'block text-[15px] font-semibold text-ink mb-1'
const ajuda = 'text-[13.5px] text-ink-muted leading-snug mb-3'

/** Número com no máximo uma casa: 297 kg, 9,9 kg. */
function num1(v: number): string {
  return v.toLocaleString('pt-BR', { maximumFractionDigits: 1 })
}

/**
 * Consumo diário na unidade em que a criação é falada.
 *
 * Boi come em quilo ("10 kg por dia"); poedeira come em GRAMA ("113 g por dia").
 * Mostrar "0,11 kg" pra quem cria ave é tecnicamente certo e praticamente
 * ilegível — ninguém confere um número que não usa.
 */
function porDia(consumoMes: number): string {
  const d = consumoMes / DIAS_MES_COMERCIAL
  return d < 1 ? `${Math.round(d * 1000).toLocaleString('pt-BR')} g` : `${num1(d)} kg`
}

/** Cartão grande de escolha. No celular o produtor responde com o polegar. */
function Opcao({ on, onClick, titulo, desc }: {
  on: boolean; onClick: () => void; titulo: string; desc?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`w-full text-left rounded-lg border-2 px-4 py-3.5 transition-all ${
        on ? 'border-accent bg-accent/5' : 'border-border bg-surface hover:border-border-strong'
      }`}
    >
      <span className={`block text-[15.5px] font-semibold ${on ? 'text-accent' : 'text-ink'}`}>{titulo}</span>
      {desc && <span className="block text-[13.5px] text-ink-muted leading-snug mt-1">{desc}</span>}
    </button>
  )
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={`text-[14px] px-3.5 py-2 rounded-md border transition-all ${
        on ? 'bg-accent text-white border-accent font-semibold' : 'bg-surface text-ink border-border hover:border-border-strong'
      }`}>
      {children}
    </button>
  )
}

function Secao({ n, titulo, children }: { n: number; titulo: string; children: React.ReactNode }) {
  return (
    <section>
      <div className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-ink-muted pb-2 border-b border-border mb-4">
        <span className="text-accent font-mono mr-2">{String(n).padStart(2, '0')}</span>{titulo}
      </div>
      {children}
    </section>
  )
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

function Numero({ v, l }: { v: string; l: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3.5 py-3">
      <div className="text-[19px] font-extrabold text-ink leading-none tracking-tight">{v}</div>
      <div className="text-[12px] text-ink-muted mt-1.5 leading-snug">{l}</div>
    </div>
  )
}

function Resultado({ r }: { r: ResultadoQuiz }) {
  const d = r.dimensionamento
  const fluxo = r.estacoes.filter(e => e.ordem > 0)
  const apoio = r.estacoes.find(e => e.chave === 'apoio')

  return (
    <div className="space-y-8">
      {/* ---- o que é a fábrica dele */}
      <div className="rounded-xl border-2 border-accent bg-accent/5 px-5 py-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-accent">
          A fábrica que atende você
        </div>
        <h2 className="text-[clamp(21px,4.6vw,28px)] font-extrabold text-ink tracking-tight leading-[1.15] mt-2">
          {r.compacta
            ? r.compacta.codigo.replace(/ - .*$/, '')
            : `Linha ${inteiro(d.capacidadeEscolhidaKgH)} kg/h montada sob medida`}
        </h2>
        <p className="text-[14.5px] text-ink-muted leading-relaxed mt-2">
          {r.compacta
            ? r.compacta.porque
            : 'Nessa produção não existe fábrica pronta de catálogo: a linha é montada equipamento por '
              + 'equipamento, no desenho do seu galpão. Os itens abaixo são a espinha dela.'}
        </p>

        {r.compacta && r.compacta.alternativas.length > 0 && (
          <p className="text-[13px] text-ink-muted leading-snug mt-3 pt-3 border-t border-accent/25">
            Mesma produção, outro tamanho de misturador:{' '}
            {r.compacta.alternativas.map(a => `${kg(a.misturadorKg)}`).join(' · ')}. Quem fecha esse
            detalhe é o técnico, junto com você.
          </p>
        )}
      </div>

      {/* ---- os números da rotina */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
        <Numero v={kg(d.demandaMensalKg)} l="de ração por mês" />
        <Numero v={kg(d.producaoPorDiaKg)} l="por dia de trabalho" />
        <Numero v={`${inteiro(d.capacidadeEscolhidaKgH)} kg/h`} l="capacidade da fábrica" />
        <Numero
          v={d.horasReaisPorDia < 1
            ? `${Math.round(d.horasReaisPorDia * 60)} min`
            : `${d.horasReaisPorDia.toLocaleString('pt-BR', { maximumFractionDigits: 1 })} h`}
          l="de fábrica ligada por dia"
        />
      </div>

      {/* ---- o fluxo, estação por estação */}
      <div>
        <h3 className="text-[17px] font-extrabold text-ink tracking-tight">
          Do recebimento à expedição
        </h3>
        <p className="text-[13.5px] text-ink-muted leading-snug mt-1 mb-5">
          O caminho que o grão faz dentro da sua fábrica, e a máquina de cada parada.
        </p>

        <ol className="space-y-3">
          {fluxo.map((e, i) => (
            <li key={e.chave} className="relative pl-11">
              {/* Linha do tempo ligando uma estação na próxima.
                  Renderizada por CONDIÇÃO, não por `last:hidden`: aquele
                  variante mira `:last-child`, e este span nunca é o último
                  filho do <li> (o cartão vem depois). O resultado era 144px de
                  linha pendurada embaixo da Expedição, apontando pro nada. */}
              {i < fluxo.length - 1 && (
                <span aria-hidden className="absolute left-[15px] top-9 bottom-[-12px] w-px bg-border" />
              )}
              <span className="absolute left-0 top-0 w-[31px] h-[31px] rounded-full bg-accent text-white grid place-items-center text-[13px] font-bold font-mono">
                {e.ordem}
              </span>

              <div className="rounded-lg border border-border bg-surface px-4 py-3.5">
                <div className="text-[15.5px] font-bold text-ink leading-tight">{e.titulo}</div>
                <div className="text-[13px] text-ink-muted leading-snug mt-0.5">{e.resumo}</div>

                <ul className="mt-3 space-y-2.5">
                  {e.itens.map((it, i) => (
                    <li key={i} className="border-l-[3px] border-accent/35 pl-3">
                      <div className="text-[14.5px] font-semibold text-ink leading-snug">
                        {it.quantidade > 1 && <span className="font-mono text-accent mr-1">{it.quantidade}×</span>}
                        {it.nome}
                        {it.aProjetar && (
                          <span className="ml-2 align-middle text-[10.5px] font-bold uppercase tracking-wide text-ink-faint border border-border rounded px-1.5 py-0.5">
                            sai no projeto
                          </span>
                        )}
                      </div>
                      <div className="text-[13px] text-ink-muted leading-snug mt-0.5">{it.porque}</div>
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* ---- infraestrutura */}
      {apoio && (
        <div className="rounded-lg border border-border bg-bg px-4 py-3.5">
          <div className="text-[15.5px] font-bold text-ink">{apoio.titulo}</div>
          <div className="text-[13px] text-ink-muted leading-snug mt-0.5">{apoio.resumo}</div>
          <ul className="mt-3 space-y-2.5">
            {apoio.itens.map((it, i) => (
              <li key={i} className="border-l-[3px] border-border-strong pl-3">
                <div className="text-[14.5px] font-semibold text-ink leading-snug">
                  {it.nome}
                  {it.aProjetar && (
                    <span className="ml-2 align-middle text-[10.5px] font-bold uppercase tracking-wide text-ink-faint border border-border rounded px-1.5 py-0.5">
                      sai no projeto
                    </span>
                  )}
                </div>
                <div className="text-[13px] text-ink-muted leading-snug mt-0.5">{it.porque}</div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ---- o que a fábrica NÃO resolve */}
      {r.alertas.length > 0 && (
        <div className="rounded-lg border-l-[3px] border-warning bg-warning/10 px-4 py-3.5">
          <div className="text-[14px] font-bold text-ink mb-2">Antes de decidir, leia isto</div>
          <ul className="space-y-2">
            {r.alertas.map((a, i) => (
              <li key={i} className="text-[13.5px] text-ink leading-snug">{a}</li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[12px] text-ink-faint leading-relaxed border-t border-border pt-4">
        Esta é uma indicação preliminar, montada a partir do que você respondeu. Medidas de
        transportador, altura de elevador e a disposição das máquinas saem do projeto, feito com o
        desenho do seu galpão. A formulação da ração deve ser definida ou validada por profissional
        habilitado em nutrição animal.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Fora de escopo
// ---------------------------------------------------------------------------

function ForaDeEscopo({ tipo, onVoltar }: { tipo: 'peixe' | 'peletizada'; onVoltar: () => void }) {
  return (
    <div className="rounded-xl border-2 border-border bg-surface px-5 py-6">
      <h2 className="text-[21px] font-extrabold text-ink tracking-tight leading-tight">
        Esse a gente não faz — e é melhor te falar agora
      </h2>
      <p className="text-[15px] text-ink-muted leading-relaxed mt-3">
        {tipo === 'peixe'
          ? 'Ração de peixe precisa ser EXTRUSADA pra boiar e não se desmanchar na água. Extrusora é '
            + 'outra máquina, de outro fabricante — a Branorte não produz.'
          : 'Ração peletizada sai de uma PELETIZADORA, que prensa o farelo em pelete. A Branorte não '
            + 'fabrica peletizadora.'}
      </p>
      <p className="text-[15px] text-ink-muted leading-relaxed mt-3">
        O que fazemos é <strong className="text-ink">fábrica de ração farelada</strong>: moer o grão,
        dosar e misturar a fórmula, e entregar a ração pronta pra bovino, suíno e ave. Se um dia isso
        for o que você precisa, a porta está aberta.
      </p>
      <button type="button" onClick={onVoltar}
        className="mt-5 text-[14px] font-semibold text-accent hover:underline">
        ← Voltar e escolher outra criação
      </button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Página
// ---------------------------------------------------------------------------

/**
 * `previa` = está aberta DENTRO do CRM (rota /monte-sua-fabrica/previa), pra a
 * equipe ver exatamente o que o produtor vê. Nesse modo o envio fica travado —
 * ninguém suja a base de leads testando — e o tema NÃO é forçado, senão o app
 * inteiro piscaria de escuro pra claro ao abrir a prévia.
 */
export function MonteSuaFabrica({ previa = false }: { previa?: boolean } = {}) {
  const [r, setR] = useState<RespostasQuiz>(respostasIniciais)
  const [etapa, setEtapa] = useState(1)
  const [verResultado, setVerResultado] = useState(false)
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState('')

  // SEMPRE tema claro. Página pública: o produtor cai aqui vindo de um link e
  // acabava vendo o tema escuro que o DONO da máquina escolheu pro CRM (classe
  // `dark` no <html>, gravada em localStorage pelo useDarkMode). Mexe só na
  // classe e devolve no cleanup — NÃO grava em localStorage, senão trocaria a
  // preferência de quem usa o CRM na mesma máquina.
  useEffect(() => {
    if (previa) return
    const root = document.documentElement
    const eraDark = root.classList.contains('dark')
    const meta = document.querySelector('meta[name="theme-color"]')
    const corAntes = meta?.getAttribute('content') ?? null
    if (eraDark) root.classList.remove('dark')
    meta?.setAttribute('content', '#f5f5f7')
    return () => {
      if (eraDark) root.classList.add('dark')
      if (corAntes) meta?.setAttribute('content', corAntes)
    }
  }, [previa])

  const set = <K extends keyof RespostasQuiz>(k: K) => (v: RespostasQuiz[K]) =>
    setR(p => ({ ...p, [k]: v }))

  const resultado = useMemo(() => calcularQuiz(r), [r])
  const categorias = r.especie ? CATEGORIAS[r.especie] : []

  /**
   * Trocar de espécie tem que zerar a fase e o consumo. Sem isso o produtor
   * escolhia "Postura" em aves, voltava pra bovinos e seguia com 3,4 kg/mês por
   * cabeça — a fábrica saía 90 vezes menor que a real.
   */
  const escolherEspecie = (e: Especie) => {
    setR(p => ({
      ...p, especie: e, categoria: '', consumoPorAnimalMes: 0, foraDeEscopo: null,
      // Boi e porco em kg/dia; ave em kg/mês (por dia ela come grama).
      baseConsumo: baseNaturalDe(e),
    }))
  }

  const escolherCategoria = (chave: string) => {
    setR(p => ({
      ...p,
      categoria: chave,
      // Só sugere; o produtor corrige na etapa seguinte se souber o número dele.
      consumoPorAnimalMes: consumoDeReferencia(p.especie, chave),
    }))
  }

  /** Cada etapa só libera o "Próximo" quando tem o que ela pede. */
  const etapaOk = (n: number): boolean => {
    switch (n) {
      case 1: return !!r.especie && (r.especie === 'milho' || !!r.categoria)
      case 2: return r.modo === 'direto'
        ? r.toneladasMes > 0
        : r.numeroAnimais > 0 && r.consumoPorAnimalMes > 0
      case 3: return r.diasPorSemana > 0 && r.horasPorDia > 0
      case 4: return !!r.recebimento
      case 5: return !!r.estoqueGrao
      case 6: return !!r.expedicao
      case 7: return r.pesagemAutomatica !== null && !!r.energia
      default: return true
    }
  }

  async function enviarContato(e: React.FormEvent) {
    e.preventDefault()
    setErro('')
    if (previa) {
      setErro('Isto é a prévia — o envio fica travado aqui pra não criar lead de teste.')
      return
    }
    if (r.nome.trim().length < 2 || r.telefone.replace(/\D/g, '').length < 10) {
      setErro('Preciso do seu nome e de um WhatsApp com DDD pra conseguir te retornar.')
      return
    }

    setEnviando(true)
    // ⚠️ sem .select(): a RLS do anon tem INSERT e NENHUM select. Pedir a linha
    // de volta faz o Postgres responder "violates row-level security".
    const { error } = await supabase.from('quiz_fabrica_respostas' as never).insert({
      nome: r.nome.trim(),
      telefone: r.telefone.trim(),
      cidade: r.cidade.trim() || null,
      uf: r.uf || null,
      especie: r.especie,
      categoria: r.categoria || null,
      fora_de_escopo: r.foraDeEscopo,
      modo: r.modo,
      numero_animais: r.modo === 'animais' ? Math.round(r.numeroAnimais) : null,
      consumo_por_animal_mes: r.modo === 'animais' ? r.consumoPorAnimalMes : null,
      toneladas_mes: r.modo === 'direto' ? r.toneladasMes : null,
      dias_por_semana: r.diasPorSemana,
      horas_por_dia: r.horasPorDia,
      recebimento: r.recebimento,
      estoque_grao: r.estoqueGrao,
      expedicao: r.expedicao,
      pesagem_automatica: r.pesagemAutomatica,
      energia: r.energia,
      demanda_mensal_kg: resultado.dimensionamento.demandaMensalKg,
      capacidade_kg_h: resultado.dimensionamento.capacidadeEscolhidaKgH,
      compacta_linha: resultado.compacta?.linha ?? null,
      compacta_codigo: resultado.compacta?.codigo ?? null,
      // Snapshot do que ele VIU. O vendedor liga sabendo a tela dele.
      resultado: {
        estacoes: resultado.estacoes,
        alertas: resultado.alertas,
        dimensionamento: resultado.dimensionamento,
      },
      origem: 'monte-sua-fabrica',
    })
    setEnviando(false)

    if (error) {
      setErro('Não consegui enviar agora. Tente de novo em instantes — se persistir, chame a gente no WhatsApp.')
      return
    }
    setEnviado(true)
  }

  // -------------------------------------------------------------- fora de escopo
  if (r.foraDeEscopo) {
    return (
      <Casca previa={previa}>
        <ForaDeEscopo tipo={r.foraDeEscopo} onVoltar={() => setR(p => ({ ...p, foraDeEscopo: null }))} />
      </Casca>
    )
  }

  // -------------------------------------------------------------- resultado
  if (verResultado && resultado.completo) {
    return (
      <Casca previa={previa}>
        <div className="flex items-center justify-between gap-3 mb-6">
          <button type="button" onClick={() => setVerResultado(false)}
            className="text-[14px] font-semibold text-accent hover:underline">
            ← Mudar uma resposta
          </button>
          <span className="text-[12px] text-ink-faint font-mono">indicação preliminar</span>
        </div>

        <Resultado r={resultado} />

        {/* ---- contato: DEPOIS do resultado, nunca antes dele */}
        <div id="falar" className="mt-9 rounded-xl border-2 border-accent bg-accent/5 px-5 py-5">
          {enviado ? (
            <div className="text-center py-3">
              <div className="w-12 h-12 rounded-full bg-accent/15 text-accent grid place-items-center mx-auto mb-4 text-xl">✓</div>
              <h3 className="text-[19px] font-extrabold text-ink tracking-tight">Recebido, {r.nome.split(' ')[0]}</h3>
              <p className="text-[14.5px] text-ink-muted leading-relaxed mt-2 max-w-md mx-auto">
                Um técnico da BraNorte vai te chamar no WhatsApp que você informou pra conferir os
                números com você e fechar o desenho da fábrica.
              </p>
            </div>
          ) : (
            <form onSubmit={enviarContato} noValidate className="space-y-4">
              <div>
                <h3 className="text-[18px] font-extrabold text-ink tracking-tight leading-tight">
                  Quer conferir isso com um técnico?
                </h3>
                <p className="text-[14px] text-ink-muted leading-snug mt-1.5">
                  A gente confere o consumo do seu rebanho, ajusta o que precisar e te manda o desenho
                  da fábrica. Sem compromisso.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className={rotulo}>Seu nome</label>
                  <input className={campo} value={r.nome} onChange={e => set('nome')(e.target.value)} autoComplete="name" />
                </div>
                <div>
                  <label className={rotulo}>WhatsApp</label>
                  <input className={campo} value={r.telefone} onChange={e => set('telefone')(e.target.value)}
                    placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" />
                </div>
              </div>

              <div className="grid grid-cols-[1fr_110px] gap-3">
                <div>
                  <label className={rotulo}>Cidade</label>
                  <input className={campo} value={r.cidade} onChange={e => set('cidade')(e.target.value)} autoComplete="address-level2" />
                </div>
                <div>
                  <label className={rotulo}>UF</label>
                  <select className={campo} value={r.uf} onChange={e => set('uf')(e.target.value)}>
                    <option value="">—</option>
                    {UFS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {erro && (
                <div className="bg-danger/10 border-l-[3px] border-danger px-4 py-3 text-[14px] text-ink">{erro}</div>
              )}

              <button type="submit" disabled={enviando || previa}
                title={previa ? 'Travado na prévia — o produtor de verdade consegue enviar' : undefined}
                className="w-full bg-accent text-white font-bold text-[16px] rounded-md py-4 hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed transition-opacity">
                {previa ? 'Falar com um técnico (travado na prévia)' : enviando ? 'Enviando…' : 'Falar com um técnico'}
              </button>
              <p className="text-[12px] text-ink-faint text-center leading-relaxed">
                Ao enviar, você autoriza a BraNorte a entrar em contato pelo WhatsApp informado.
              </p>
            </form>
          )}
        </div>
      </Casca>
    )
  }

  // -------------------------------------------------------------- questionário
  const pct = Math.round(((etapa - 1) / TOTAL_PERGUNTAS) * 100)

  return (
    <Casca previa={previa}>
      <header className={`pb-6 border-b-2 border-accent mb-7 ${previa ? 'pt-6' : 'pt-10'}`}>
        <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
          BraNorte · Fábricas de Ração
        </div>
        <h1 className="text-[clamp(25px,5.5vw,35px)] font-extrabold tracking-tight leading-[1.1] text-ink mt-3">
          Monte sua fábrica de ração
        </h1>
        <p className="text-[16.5px] text-ink-muted leading-relaxed mt-3">
          Responda 7 perguntas sobre a sua criação e veja, na hora, quais equipamentos atendem
          você — do recebimento do grão até a ração saindo pro cocho.
        </p>
        <p className="text-[12px] text-ink-faint mt-4 font-mono">
          7 perguntas · cerca de 2 minutos · resultado na tela, sem cadastro
        </p>
      </header>

      {/* progresso */}
      <div className="mb-7">
        <div className="h-1.5 rounded-full bg-border overflow-hidden">
          <div className="h-full bg-accent transition-all duration-300" style={{ width: `${pct}%` }} />
        </div>
        <div className="text-[12px] text-ink-faint font-mono mt-2">
          Pergunta {Math.min(etapa, TOTAL_PERGUNTAS)} de {TOTAL_PERGUNTAS}
        </div>
      </div>

      <div className="space-y-6">
        {/* ---------- 01 · o que cria ---------- */}
        {etapa === 1 && (
          <Secao n={1} titulo="O que você cria">
            <p className={ajuda}>É isso que define a fórmula, o consumo e o tipo de misturador.</p>
            <div className="space-y-2.5">
              {ESPECIES.map(e => (
                <Opcao key={e.chave} on={r.especie === e.chave} onClick={() => escolherEspecie(e.chave)}
                  titulo={`${e.icone}  ${e.nome}`} />
              ))}
            </div>

            {/* Peixe e ração peletizada ficam FORA da lista de cartões — e é
                deliberado. A Branorte não fabrica extrusora nem peletizadora, e
                num cartão do mesmo tamanho, ao lado dos produtos, os dois liam
                como se ela vendesse. Aqui embaixo, em texto miúdo, seguem
                pegando o lead fora de escopo no primeiro clique (que é o ponto:
                dizer "não" agora vale mais que dizer depois do quiz inteiro)
                sem parecerem oferta. */}
            <p className="text-[13px] text-ink-muted leading-snug mt-5 pt-4 border-t border-border">
              Não é nada disso? Se você precisa de ração para{' '}
              <button type="button" onClick={() => setR(p => ({ ...p, foraDeEscopo: 'peixe' }))}
                className="text-accent font-semibold underline underline-offset-2">peixe</button>
              {' '}ou de ração{' '}
              <button type="button" onClick={() => setR(p => ({ ...p, foraDeEscopo: 'peletizada' }))}
                className="text-accent font-semibold underline underline-offset-2">peletizada</button>
              , leia isto antes de seguir.
            </p>

            {r.especie && r.especie !== 'milho' && (
              <div className="mt-6">
                <label className={rotulo}>Em qual fase?</label>
                <p className={ajuda}>
                  Não existe "tantas cabeças = fábrica tal": 200 bois de confinamento comem 60 t por
                  mês, 200 poedeiras não chegam a uma. A fase é que diz.
                </p>
                <div className="flex flex-wrap gap-2">
                  {categorias.map(c => (
                    <Chip key={c.chave} on={r.categoria === c.chave} onClick={() => escolherCategoria(c.chave)}>
                      {c.nome}
                    </Chip>
                  ))}
                </div>
                {r.categoria && categorias.find(c => c.chave === r.categoria)?.nota && (
                  <p className="text-[12.5px] text-ink-faint leading-snug mt-2.5">
                    {categorias.find(c => c.chave === r.categoria)!.nota}
                  </p>
                )}
              </div>
            )}
          </Secao>
        )}

        {/* ---------- 02 · quanto ---------- */}
        {etapa === 2 && (
          <Secao n={2} titulo="Quanto de ração">
            <div className="flex gap-2 mb-5">
              <Chip on={r.modo === 'animais'} onClick={() => set('modo')('animais')}>Sei o meu rebanho</Chip>
              <Chip on={r.modo === 'direto'} onClick={() => set('modo')('direto')}>Sei a tonelagem</Chip>
            </div>

            {r.modo === 'animais' ? (
              <div className="space-y-5">
                <div>
                  <label className={rotulo}>Quantos animais?</label>
                  <input className={campo} type="number" min={0} inputMode="numeric"
                    value={r.numeroAnimais || ''} onChange={e => set('numeroAnimais')(Number(e.target.value) || 0)}
                    placeholder="Ex.: 400" />
                </div>
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                    <label className={rotulo} style={{ marginBottom: 0 }}>
                      Quanto cada um come {r.baseConsumo === 'dia' ? 'por dia' : 'por mês'} (kg)?
                    </label>
                    {/* Trocar a unidade NÃO mexe no consumo — só em como ele é
                        mostrado. O valor vive em kg/mês por dentro. */}
                    <div className="flex gap-1.5">
                      {([['dia', 'por dia'], ['mes', 'por mês']] as const).map(([v, l]) => (
                        <button key={v} type="button" onClick={() => set('baseConsumo')(v)}
                          className={`text-[13px] px-2.5 py-1 rounded-md border transition-all ${
                            r.baseConsumo === v
                              ? 'bg-accent text-white border-accent font-semibold'
                              : 'bg-surface text-ink-muted border-border hover:border-border-strong'
                          }`}>{l}</button>
                      ))}
                    </div>
                  </div>
                  <p className={ajuda}>
                    Já preenchi com a referência do nosso catálogo. Se você sabe o número do seu
                    rebanho, corrija — é ele que manda no tamanho da fábrica.
                  </p>
                  <input className={campo} type="number" min={0} step={r.baseConsumo === 'dia' ? '0.01' : '0.1'}
                    inputMode="decimal"
                    value={consumoNaBase(r.consumoPorAnimalMes, r.baseConsumo) || ''}
                    onChange={e => set('consumoPorAnimalMes')(
                      consumoParaMes(Number(e.target.value) || 0, r.baseConsumo),
                    )} />
                  {/* As duas unidades sempre à vista: quem digita 10 confere na
                      hora que virou 300 no mês, e vice-versa. */}
                  {r.consumoPorAnimalMes > 0 && (
                    <p className="text-[12.5px] text-ink-faint mt-1.5">
                      {r.baseConsumo === 'dia'
                        ? `Dá ${num1(r.consumoPorAnimalMes)} kg por mês, por animal.`
                        : `Dá ${porDia(r.consumoPorAnimalMes)} por animal por dia.`}
                    </p>
                  )}
                </div>
                {r.numeroAnimais > 0 && r.consumoPorAnimalMes > 0 && (
                  <div className="rounded-lg border border-border bg-surface px-4 py-3 text-[14px] text-ink">
                    Dá <strong>{kg(r.numeroAnimais * r.consumoPorAnimalMes)}</strong> de ração por mês.
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className={rotulo}>Quantas toneladas de ração por mês?</label>
                <input className={campo} type="number" min={0} step="0.1" inputMode="decimal"
                  value={r.toneladasMes || ''} onChange={e => set('toneladasMes')(Number(e.target.value) || 0)}
                  placeholder="Ex.: 120" />
              </div>
            )}
          </Secao>
        )}

        {/* ---------- 03 · jornada ---------- */}
        {etapa === 3 && (
          <Secao n={3} titulo="Quando você quer fabricar">
            <p className={ajuda}>
              Esta é a pergunta que mais muda a máquina. A mesma tonelagem feita em um dia por semana
              precisa de uma fábrica bem maior do que feita todo dia.
            </p>

            <label className={rotulo}>Dias por semana</label>
            <div className="flex flex-wrap gap-2 mb-6">
              {[
                { v: 1, l: '1 dia' }, { v: 2, l: '2 dias' }, { v: 3, l: '3 dias' },
                { v: 5, l: '5 dias' }, { v: 6, l: '6 dias' }, { v: 7, l: 'Todo dia' },
              ].map(o => (
                <Chip key={o.v} on={r.diasPorSemana === o.v} onClick={() => set('diasPorSemana')(o.v)}>{o.l}</Chip>
              ))}
            </div>

            <label className={rotulo}>Horas por dia</label>
            <div className="flex flex-wrap gap-2">
              {[2, 4, 6, 8, 10].map(h => (
                <Chip key={h} on={r.horasPorDia === h} onClick={() => set('horasPorDia')(h)}>{h} h</Chip>
              ))}
            </div>
          </Secao>
        )}

        {/* ---------- 04 · recebimento ---------- */}
        {etapa === 4 && (
          <Secao n={4} titulo="Como o grão chega na propriedade">
            <p className={ajuda}>Define a moega, a pré-limpeza e como o grão sobe pra fábrica.</p>
            <div className="space-y-2.5">
              <Opcao on={r.recebimento === 'granel'} onClick={() => set('recebimento')('granel')}
                titulo="A granel, no caminhão ou na carreta"
                desc="O grão vem solto e é descarregado na moega." />
              <Opcao on={r.recebimento === 'ensacado'} onClick={() => set('recebimento')('ensacado')}
                titulo="Ensacado ou em big bag"
                desc="Compro em saco e descarrego na mão." />
              <Opcao on={r.recebimento === 'propria'} onClick={() => set('recebimento')('propria')}
                titulo="Colheita da minha lavoura"
                desc="O grão vem direto da roça, com palha e impureza." />
            </div>
          </Secao>
        )}

        {/* ---------- 05 · estoque ---------- */}
        {etapa === 5 && (
          <Secao n={5} titulo="Você vai guardar grão">
            <p className={ajuda}>É isto que decide se entra silo, e de que tamanho.</p>
            <div className="space-y-2.5">
              <Opcao on={r.estoqueGrao === 'nenhum'} onClick={() => set('estoqueGrao')('nenhum')}
                titulo="Não — compro conforme uso"
                desc="Sem silo. O grão vai da moega direto pro moinho." />
              <Opcao on={r.estoqueGrao === 'mes'} onClick={() => set('estoqueGrao')('mes')}
                titulo="Mais ou menos um mês"
                desc="Silo pequeno, pra não depender de entrega toda semana." />
              <Opcao on={r.estoqueGrao === 'safra'} onClick={() => set('estoqueGrao')('safra')}
                titulo="Encho na safra e uso o ano"
                desc="Silo grande — comprar milho barato na safra é onde mora boa parte da economia." />
            </div>
          </Secao>
        )}

        {/* ---------- 06 · expedição ---------- */}
        {etapa === 6 && (
          <Secao n={6} titulo="Como a ração sai da fábrica">
            <p className={ajuda}>Define ensacadeira, esteira e onde a ração pronta espera.</p>
            <div className="space-y-2.5">
              <Opcao on={r.expedicao === 'granel'} onClick={() => set('expedicao')('granel')}
                titulo="A granel, direto pro vagão ou pro cocho"
                desc="Sem saco e sem embalagem." />
              <Opcao on={r.expedicao === 'ensacada'} onClick={() => set('expedicao')('ensacada')}
                titulo="Ensacada"
                desc="Pra estocar, transportar longe ou vender." />
              <Opcao on={r.expedicao === 'ambos'} onClick={() => set('expedicao')('ambos')}
                titulo="Os dois, depende do dia" />
            </div>
          </Secao>
        )}

        {/* ---------- 07 · pesagem + energia ---------- */}
        {etapa === 7 && (
          <Secao n={7} titulo="Dois detalhes e acabou">
            <label className={rotulo}>Você quer que a máquina pese a fórmula sozinha?</label>
            <p className={ajuda}>
              Com caçamba de pesagem cada ingrediente entra na quantidade certa, sem depender de
              quem está operando. Sem ela, você pesa e joga no misturador.
            </p>
            <div className="space-y-2.5 mb-7">
              <Opcao on={r.pesagemAutomatica === true} onClick={() => set('pesagemAutomatica')(true)}
                titulo="Sim, quero pesagem automática"
                desc="Menos erro de fórmula. Fórmula errada é prejuízo que não aparece na nota." />
              <Opcao on={r.pesagemAutomatica === false} onClick={() => set('pesagemAutomatica')(false)}
                titulo="Não precisa, eu peso na balança"
                desc="Funciona bem com poucos ingredientes." />
            </div>

            <label className={rotulo}>Qual a energia da propriedade?</label>
            <div className="flex flex-wrap gap-2">
              {([
                ['trifasico', 'Trifásica'],
                ['monofasico', 'Monofásica'],
                ['nao_sei', 'Não sei'],
              ] as const).map(([v, l]) => (
                <Chip key={v} on={r.energia === v} onClick={() => set('energia')(v)}>{l}</Chip>
              ))}
            </div>
          </Secao>
        )}
      </div>

      {/* navegação */}
      <div className="flex items-center justify-between gap-3 mt-9 pt-6 border-t border-border">
        <button type="button" disabled={etapa === 1}
          onClick={() => { setEtapa(n => Math.max(1, n - 1)); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
          className="text-[14.5px] font-semibold text-ink-muted disabled:opacity-40 hover:text-ink transition-colors">
          ← Voltar
        </button>

        {etapa < TOTAL_PERGUNTAS ? (
          <button type="button" disabled={!etapaOk(etapa)}
            onClick={() => { setEtapa(n => n + 1); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            className="bg-accent text-white font-bold text-[15.5px] rounded-md px-7 py-3.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            Próximo →
          </button>
        ) : (
          <button type="button" disabled={!etapaOk(7) || !resultado.completo}
            onClick={() => { setVerResultado(true); window.scrollTo({ top: 0, behavior: 'smooth' }) }}
            className="bg-accent text-white font-bold text-[15.5px] rounded-md px-7 py-3.5 hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity">
            Ver minha fábrica
          </button>
        )}
      </div>

      {/* O que ainda falta, quando o botão final está travado. Sem isto o
          produtor fica olhando pro botão apagado sem saber o motivo. */}
      {etapa === TOTAL_PERGUNTAS && !resultado.completo && resultado.faltando.length > 0 && (
        <p className="text-[13px] text-ink-muted leading-snug mt-4">
          Ainda falta responder: {resultado.faltando.join(', ')}.
        </p>
      )}
    </Casca>
  )
}

/** Moldura comum — evita repetir o container em cada estado da tela. */
function Casca({ previa, children }: { previa: boolean; children: React.ReactNode }) {
  return (
    <div className={previa ? '' : 'min-h-screen bg-bg'}>
      <div className="max-w-[720px] mx-auto px-5 pb-24">
        {previa && (
          <div className="mt-5 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3">
            <p className="text-[13px] font-semibold text-ink">Prévia do quiz público</p>
            <p className="text-[12.5px] text-ink-muted leading-snug mt-0.5">
              É exatamente isto que o produtor vê em{' '}
              <a href="/monte-sua-fabrica" target="_blank" rel="noopener"
                 className="text-accent font-mono hover:underline">/monte-sua-fabrica</a>.
              Aqui o envio fica travado, então pode clicar à vontade sem criar lead de teste.
            </p>
          </div>
        )}
        {children}
      </div>
    </div>
  )
}

export default MonteSuaFabrica
