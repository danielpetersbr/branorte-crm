import { useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Página PÚBLICA (sem login) — o candidato a representante se cadastra aqui.
// Link colável: branorte-crm.vercel.app/seja-representante
//
// Grava em public.representante_candidaturas. A RLS dá INSERT pro anon e NENHUM
// select — por isso o insert abaixo NÃO pode usar .select()/returning: o Postgres
// devolve "violates row-level security" quando pede a linha de volta.
//
// A NOTA não é calculada aqui: quem pontua é o trigger fn_score_candidatura no
// banco. Se fosse no cliente, bastaria o DevTools pra mandar score=100.
// O candidato também não vê nota nenhuma — ele vê "recebemos".

const UFS = ['AC','AL','AM','AP','BA','CE','DF','ES','GO','MA','MG','MS','MT','PA','PB','PE','PI','PR','RJ','RN','RO','RR','RS','SC','SE','SP','TO'] as const

const LINHAS = [
  { v: 'nutricao', l: 'Nutrição animal / premix / sal mineral' },
  { v: 'equip',    l: 'Equipamento pecuário' },
  { v: 'silo',     l: 'Silos / armazenagem' },
  { v: 'vet',      l: 'Medicamento veterinário' },
  { v: 'consult',  l: 'Consultoria técnica' },
  { v: 'insumo',   l: 'Insumo agrícola / semente' },
  { v: 'outro',    l: 'Outra' },
] as const

const ESPECIES = ['Bovino de corte', 'Bovino de leite', 'Suíno', 'Ave', 'Outros'] as const

const TICKETS = [
  { v: 1, l: 'Até R$ 5 mil' },
  { v: 2, l: 'R$ 5 mil a R$ 20 mil' },
  { v: 3, l: 'R$ 20 mil a R$ 50 mil' },
  { v: 4, l: 'R$ 50 mil a R$ 150 mil' },
  { v: 5, l: 'Acima de R$ 150 mil' },
] as const

const campo = 'w-full min-h-[46px] rounded-md border border-border bg-surface px-3 py-2.5 text-[15px] text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/30 transition-all'
const rotulo = 'block text-[15px] font-semibold text-ink mb-1'
const ajuda  = 'text-[13px] text-ink-muted leading-snug mb-2'

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`text-[14px] px-3.5 py-2 rounded-md border transition-all ${
        on ? 'bg-accent text-white border-accent font-semibold' : 'bg-surface text-ink border-border hover:border-border-strong'
      }`}>
      {children}
    </button>
  )
}

export function SejaRepresentante() {
  const [f, setF] = useState({
    nome: '', telefone: '', cidade: '', uf: '', cidades_atendidas: '',
    cnpj: '', veiculo: '', anos_agro: '',
    linha_principal: '', marcas: '', conflito: '',
    clientes_ativos: '', visitados_90d: '', visitas_semana: '', km_mes: '',
    ticket_faixa: '', maior_venda: '', clientes_racao: '', tres_clientes: '', referencia: '',
  })
  const [ufsDesejadas, setUfsDesejadas] = useState<string[]>([])
  const [especies, setEspecies] = useState<string[]>([])
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState('')

  const set = (k: keyof typeof f) => (v: string) => setF(p => ({ ...p, [k]: v }))
  const toggle = (arr: string[], setArr: (a: string[]) => void, v: string) =>
    setArr(arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v])

  // O próprio candidato vê quando exagerou no território — muitos se corrigem
  // sozinhos aqui, antes de enviar.
  const avisoUf = useMemo(() => {
    const n = ufsDesejadas.length
    if (!n) return { txt: 'nenhum estado marcado', alerta: false }
    const t = `${n} ${n === 1 ? 'estado marcado' : 'estados marcados'}`
    if (n > 6) return { txt: `${t} — território grande demais para um representante. Marque só onde você roda de verdade.`, alerta: true }
    if (n > 3) return { txt: `${t} — confirme que consegue visitar todos com frequência.`, alerta: false }
    return { txt: t, alerta: false }
  }, [ufsDesejadas])

  async function enviar(e: React.FormEvent) {
    e.preventDefault()
    setErro('')

    const faltou: string[] = []
    const obrig: [keyof typeof f, string][] = [
      ['nome','nome'], ['telefone','WhatsApp'], ['cidade','cidade'], ['uf','estado'],
      ['cidades_atendidas','cidades que atende'], ['anos_agro','anos de experiência'],
      ['linha_principal','linha principal'], ['marcas','marcas que representa'],
      ['conflito','conflito de interesse'], ['cnpj','CNPJ'], ['veiculo','veículo próprio'],
      ['clientes_ativos','clientes ativos'], ['visitados_90d','visitados em 90 dias'],
      ['visitas_semana','visitas por semana'], ['km_mes','km por mês'],
      ['ticket_faixa','ticket médio'], ['maior_venda','maior venda'],
      ['clientes_racao','clientes que fazem ração'], ['tres_clientes','os 3 clientes'],
      ['referencia','referência'],
    ]
    obrig.forEach(([k, r]) => { if (!String(f[k]).trim()) faltou.push(r) })
    if (!ufsDesejadas.length) faltou.push('estados que quer atender')
    if (!especies.length) faltou.push('animais dos clientes')

    if (faltou.length) {
      setErro(`Ainda falta responder: ${faltou.join(', ')}.`)
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
      return
    }

    setEnviando(true)
    // ⚠️ sem .select() — a RLS do anon não tem policy de SELECT (ver topo do arquivo)
    const { error } = await supabase.from('representante_candidaturas' as any).insert({
      nome: f.nome.trim(),
      telefone: f.telefone.trim(),
      cidade: f.cidade.trim(),
      uf: f.uf,
      ufs_desejadas: ufsDesejadas,
      cidades_atendidas: f.cidades_atendidas.trim(),
      cnpj: f.cnpj,
      veiculo: f.veiculo === 'sim',
      anos_agro: Number(f.anos_agro) || 0,
      linha_principal: f.linha_principal,
      marcas: f.marcas.trim(),
      conflito: f.conflito === 'sim',
      especies,
      clientes_ativos: Number(f.clientes_ativos) || 0,
      visitados_90d: Number(f.visitados_90d) || 0,
      visitas_semana: Number(f.visitas_semana) || 0,
      km_mes: Number(f.km_mes) || 0,
      ticket_faixa: Number(f.ticket_faixa) || 0,
      maior_venda: f.maior_venda.trim(),
      clientes_racao: Number(f.clientes_racao) || 0,
      tres_clientes: f.tres_clientes.trim(),
      referencia: f.referencia.trim(),
    })
    setEnviando(false)

    if (error) {
      setErro('Não consegui enviar agora. Confira os campos e tente de novo — se persistir, chame a gente no WhatsApp.')
      return
    }
    setEnviado(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (enviado) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center p-5">
        <div className="max-w-md text-center">
          <div className="w-14 h-14 rounded-full bg-accent/10 text-accent grid place-items-center mx-auto mb-5 text-2xl">✓</div>
          <h1 className="text-2xl font-bold text-ink tracking-tight">Candidatura recebida</h1>
          <p className="text-ink-muted mt-3 leading-relaxed">
            Obrigado, {f.nome.split(' ')[0]}. Sua candidatura chegou pra nós e vai ser analisada
            pela equipe comercial da BraNorte.
          </p>
          <p className="text-ink-muted mt-3 leading-relaxed">
            Se o seu perfil for aderente ao território que estamos abrindo,
            <strong className="text-ink"> retornamos em até 5 dias úteis</strong> pelo WhatsApp
            que você informou.
          </p>
          <p className="text-[13px] text-ink-faint mt-6">BraNorte · Equipamentos e fábricas de ração</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg">
      <div className="max-w-[680px] mx-auto px-5 pb-24">

        <header className="pt-12 pb-7 border-b-2 border-accent mb-8">
          <div className="text-[11px] font-bold uppercase tracking-[0.16em] text-accent">
            BraNorte · Representação Comercial
          </div>
          <h1 className="text-[clamp(26px,5.5vw,36px)] font-extrabold tracking-tight leading-[1.1] text-ink mt-3">
            Seja um representante BraNorte
          </h1>
          <p className="text-[17px] text-ink-muted leading-relaxed mt-4">
            Fabricamos fábricas de ração e equipamentos para bovinos, suínos e aves.
            Estamos abrindo território para representantes que já atendem o produtor rural.
          </p>
          <div className="mt-5 bg-accent/5 border-l-[3px] border-accent px-4 py-3 text-[14.5px] text-ink leading-snug">
            <strong>Isto não é uma vaga de emprego.</strong> É uma parceria comercial para quem já tem
            carteira ativa no agronegócio. Se você está começando agora em vendas, este não é o momento certo.
          </div>
          <p className="text-[12px] text-ink-faint mt-4 font-mono">
            20 perguntas · cerca de 6 minutos · retorno em até 5 dias úteis
          </p>
        </header>

        <form onSubmit={enviar} noValidate className="space-y-9">

          {/* ---------- 01 ---------- */}
          <section>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-ink-muted pb-2 border-b border-border mb-5">
              <span className="text-accent font-mono mr-2">01</span>Você e sua região
            </div>

            <div className="space-y-5">
              <div>
                <label className={rotulo}>Nome completo *</label>
                <input className={campo} value={f.nome} onChange={e => set('nome')(e.target.value)} autoComplete="name" />
              </div>

              <div>
                <label className={rotulo}>WhatsApp *</label>
                <input className={campo} value={f.telefone} onChange={e => set('telefone')(e.target.value)}
                  placeholder="(00) 00000-0000" inputMode="tel" autoComplete="tel" />
              </div>

              <div>
                <label className={rotulo}>Onde você mora *</label>
                <p className={ajuda}>Só trabalhamos com representantes que moram na região que vão atender.</p>
                <div className="grid grid-cols-[1fr_110px] gap-3">
                  <input className={campo} value={f.cidade} onChange={e => set('cidade')(e.target.value)} placeholder="Cidade" />
                  <select className={campo} value={f.uf} onChange={e => set('uf')(e.target.value)}>
                    <option value="">UF</option>
                    {UFS.map(u => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              <div>
                <label className={rotulo}>Que estados você quer atender pela BraNorte? *</label>
                <p className={ajuda}>
                  Marque só onde você <strong>realmente roda e tem relacionamento</strong>. Território é definido
                  por região que dá pra visitar — não por estado no mapa.
                </p>
                <div className="grid grid-cols-[repeat(auto-fill,minmax(56px,1fr))] gap-1.5">
                  {UFS.map(u => (
                    <button key={u} type="button" onClick={() => toggle(ufsDesejadas, setUfsDesejadas, u)}
                      className={`py-2 rounded-md border text-[13px] font-mono font-semibold tracking-wide transition-all ${
                        ufsDesejadas.includes(u)
                          ? 'bg-accent text-white border-accent'
                          : 'bg-surface text-ink border-border hover:border-border-strong'
                      }`}>{u}</button>
                  ))}
                </div>
                <p className={`text-[12px] font-mono mt-2 ${avisoUf.alerta ? 'text-danger font-bold' : 'text-ink-muted'}`}>
                  {avisoUf.txt}
                </p>
              </div>

              <div>
                <label className={rotulo}>Quais as principais cidades que você já atende hoje? *</label>
                <p className={ajuda}>Liste de 5 a 12, separadas por vírgula. São as cidades do seu roteiro de verdade.</p>
                <textarea className={campo} rows={3} value={f.cidades_atendidas}
                  onChange={e => set('cidades_atendidas')(e.target.value)}
                  placeholder="Ex.: Rio Verde, Jataí, Montividiu, Santa Helena, Acreúna, Paraúna" />
              </div>

              <div>
                <label className={rotulo}>Você tem CNPJ ativo? *</label>
                <div className="flex flex-wrap gap-2">
                  {[['sim','Sim'],['abrindo','Em abertura'],['nao','Não tenho']].map(([v,l]) => (
                    <Chip key={v} on={f.cnpj === v} onClick={() => set('cnpj')(v)}>{l}</Chip>
                  ))}
                </div>
              </div>

              <div>
                <label className={rotulo}>Você tem veículo próprio e roda a região visitando clientes? *</label>
                <div className="flex flex-wrap gap-2">
                  {[['sim','Sim'],['nao','Não']].map(([v,l]) => (
                    <Chip key={v} on={f.veiculo === v} onClick={() => set('veiculo')(v)}>{l}</Chip>
                  ))}
                </div>
              </div>

              <div>
                <label className={rotulo}>Há quantos anos você vende para o agronegócio? *</label>
                <input className={campo} type="number" min={0} max={60} inputMode="numeric"
                  value={f.anos_agro} onChange={e => set('anos_agro')(e.target.value)} placeholder="Ex.: 8" />
              </div>
            </div>
          </section>

          {/* ---------- 02 ---------- */}
          <section>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-ink-muted pb-2 border-b border-border mb-5">
              <span className="text-accent font-mono mr-2">02</span>O que você representa hoje
            </div>

            <div className="space-y-5">
              <div>
                <label className={rotulo}>Qual é a sua linha principal hoje? *</label>
                <div className="flex flex-wrap gap-2">
                  {LINHAS.map(o => (
                    <Chip key={o.v} on={f.linha_principal === o.v} onClick={() => set('linha_principal')(o.v)}>{o.l}</Chip>
                  ))}
                </div>
              </div>

              <div>
                <label className={rotulo}>Quais marcas ou empresas você representa hoje? *</label>
                <p className={ajuda}>Pode listar as principais.</p>
                <textarea className={campo} rows={2} value={f.marcas} onChange={e => set('marcas')(e.target.value)}
                  placeholder="Ex.: Nutrifarma (núcleos), Casa do Criador (sal mineral)" />
              </div>

              <div>
                <label className={rotulo}>
                  Você representa alguma empresa de fábrica de ração, moinho, misturador,
                  elevador ou transportador para ração? *
                </label>
                <p className={ajuda}>
                  Precisamos saber por causa de conflito de interesse. Ser honesto aqui não te
                  desclassifica de outras conversas.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[['nao','Não'],['sim','Sim']].map(([v,l]) => (
                    <Chip key={v} on={f.conflito === v} onClick={() => set('conflito')(v)}>{l}</Chip>
                  ))}
                </div>
              </div>

              <div>
                <label className={rotulo}>Que animais os seus clientes criam? *</label>
                <div className="flex flex-wrap gap-2">
                  {ESPECIES.map(e => (
                    <Chip key={e} on={especies.includes(e)} onClick={() => toggle(especies, setEspecies, e)}>{e}</Chip>
                  ))}
                </div>
              </div>
            </div>
          </section>

          {/* ---------- 03 ---------- */}
          <section>
            <div className="text-[11px] font-extrabold uppercase tracking-[0.13em] text-ink-muted pb-2 border-b border-border mb-5">
              <span className="text-accent font-mono mr-2">03</span>Sua carteira e sua rotina
            </div>

            <div className="space-y-5">
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={rotulo}>Clientes ativos *</label>
                  <p className={ajuda}>Compraram de você nos últimos 12 meses.</p>
                  <input className={campo} type="number" min={0} inputMode="numeric"
                    value={f.clientes_ativos} onChange={e => set('clientes_ativos')(e.target.value)} placeholder="Ex.: 80" />
                </div>
                <div>
                  <label className={rotulo}>Visitados em 90 dias *</label>
                  <p className={ajuda}>Quantos desses você visitou <strong>pessoalmente</strong>.</p>
                  <input className={campo} type="number" min={0} inputMode="numeric"
                    value={f.visitados_90d} onChange={e => set('visitados_90d')(e.target.value)} placeholder="Ex.: 45" />
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className={rotulo}>Visitas por semana *</label>
                  <p className={ajuda}>Média das últimas semanas.</p>
                  <input className={campo} type="number" min={0} inputMode="numeric"
                    value={f.visitas_semana} onChange={e => set('visitas_semana')(e.target.value)} placeholder="Ex.: 12" />
                </div>
                <div>
                  <label className={rotulo}>Km rodados por mês *</label>
                  <p className={ajuda}>Aproximado.</p>
                  <input className={campo} type="number" min={0} inputMode="numeric"
                    value={f.km_mes} onChange={e => set('km_mes')(e.target.value)} placeholder="Ex.: 2500" />
                </div>
              </div>

              <div>
                <label className={rotulo}>Qual o ticket médio das suas vendas? *</label>
                <select className={campo} value={f.ticket_faixa} onChange={e => set('ticket_faixa')(e.target.value)}>
                  <option value="">Selecione</option>
                  {TICKETS.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
                </select>
              </div>

              <div>
                <label className={rotulo}>Qual foi a maior venda que você já fechou? *</label>
                <p className={ajuda}>Valor, o que era, e quanto tempo levou do primeiro contato até o fechamento.</p>
                <textarea className={campo} rows={3} value={f.maior_venda} onChange={e => set('maior_venda')(e.target.value)}
                  placeholder="Ex.: R$ 180 mil em equipamento de ordenha pra uma fazenda em Patos de Minas. Levou uns 5 meses, tive que voltar lá 4 vezes." />
              </div>

              <div>
                <label className={rotulo}>
                  Dos seus clientes, quantos fabricam ou gostariam de fabricar a própria ração? *
                </label>
                <p className={ajuda}>Um número aproximado já serve.</p>
                <input className={campo} type="number" min={0} inputMode="numeric"
                  value={f.clientes_racao} onChange={e => set('clientes_racao')(e.target.value)} placeholder="Ex.: 20" />
              </div>

              <div>
                <label className={rotulo}>Cite 3 clientes da sua região que teriam perfil para uma fábrica de ração *</label>
                <p className={ajuda}>
                  De cada um: <strong>nome</strong> (pode abreviar o sobrenome), <strong>cidade</strong>,
                  <strong> o que cria</strong> e <strong>quantas cabeças</strong>, mais ou menos.
                  Não precisam ser clientes seus — precisam ser gente que você consegue chegar.
                </p>
                <textarea className={campo} rows={5} value={f.tres_clientes} onChange={e => set('tres_clientes')(e.target.value)}
                  placeholder={'1. Fazenda Santa R. — Rio Verde/GO — bovino de corte, uns 1.200 em confinamento\n2. Granja do José M. — Jataí/GO — postura, umas 30 mil aves\n3. Sítio dos Irmãos P. — Montividiu/GO — suíno, 400 matrizes'} />
              </div>

              <div>
                <label className={rotulo}>Uma referência comercial *</label>
                <p className={ajuda}>
                  Nome, empresa e telefone de alguém que já trabalhou com você — pode ser um fabricante
                  que você representa, um parceiro ou um cliente antigo.
                </p>
                <textarea className={campo} rows={2} value={f.referencia} onChange={e => set('referencia')(e.target.value)}
                  placeholder="Ex.: Carlos Menezes — Nutrifarma, gerente comercial — (64) 99999-0000" />
              </div>
            </div>
          </section>

          <div className="border-t-2 border-accent pt-6">
            {erro && (
              <div className="bg-danger/10 border-l-[3px] border-danger px-4 py-3 text-[14px] text-ink mb-4">
                {erro}
              </div>
            )}
            <button type="submit" disabled={enviando}
              className="w-full bg-accent text-white font-bold text-[16px] rounded-md py-4 hover:opacity-90 disabled:opacity-50 transition-opacity">
              {enviando ? 'Enviando…' : 'Enviar minha candidatura'}
            </button>
            <p className="text-[12px] text-ink-faint text-center mt-4 leading-relaxed">
              Ao enviar, você autoriza a BraNorte a entrar em contato pelo WhatsApp informado
              e a analisar os dados para fins de seleção comercial.
            </p>
          </div>
        </form>
      </div>
    </div>
  )
}
