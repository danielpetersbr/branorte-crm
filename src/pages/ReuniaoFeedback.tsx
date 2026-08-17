// Página PÚBLICA (sem login) — o link que o gestor manda pro vendedor DEPOIS da
// reunião: /reuniao/<token>. Ele relê a pauta e a ata, e deixa a sugestão, o que
// ficou faltando ou a dúvida que não coube na hora.
//
// O anon não tem acesso a nenhuma tabela: tudo passa por 2 RPCs SECURITY DEFINER
// que resolvem o token (reuniao_publica / reuniao_feedback_enviar). Por isso a
// página nunca conhece o id da reunião, nem as tarefas (que têm responsável),
// nem as gravações.
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

interface ReuniaoPublica {
  titulo: string
  data_reuniao: string
  pauta: { texto: string }[]
  resumo: string
}

// O tipo vira etiqueta na lista do gestor — dá pra separar sugestão de dúvida
// sem ler tudo. Opcional: quem não escolher manda o comentário solto mesmo.
const TIPOS = ['Sugestão de melhoria', 'Algo a acrescentar', 'Ficou dúvida', 'Um problema'] as const

const LS_NOME = 'reuniao-feedback-nome'

function fmtData(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function ReuniaoFeedback() {
  const { pathname, search } = useLocation()
  const token = decodeURIComponent((pathname.split('/reuniao/')[1] || '').replace(/\/+$/, ''))
  // ?v=Nome pré-preenche — dá pra mandar um link personalizado por vendedor. O
  // que ele digitar continua valendo (o campo é editável).
  const nomeUrl = (new URLSearchParams(search).get('v') || '').trim()

  const [carregando, setCarregando] = useState(true)
  const [reuniao, setReuniao] = useState<ReuniaoPublica | null>(null)
  const [nome, setNome] = useState('')
  const [tipo, setTipo] = useState('')
  const [comentario, setComentario] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState('')

  useEffect(() => {
    // Lembra quem é entre uma reunião e outra — o vendedor não redigita o nome
    // toda semana. A URL manda mais que o localStorage.
    setNome(nomeUrl || localStorage.getItem(LS_NOME) || '')
  }, [nomeUrl])

  useEffect(() => {
    let vivo = true
    supabase.rpc('reuniao_publica', { p_token: token }).then(({ data, error }) => {
      if (!vivo) return
      if (!error && data) setReuniao(data as ReuniaoPublica)
      setCarregando(false)
    })
    return () => { vivo = false }
  }, [token])

  async function enviar() {
    const n = nome.trim(), c = comentario.trim()
    if (!n) { setErro('Escreve seu nome pra gente saber de quem veio 🙂'); return }
    if (!c) { setErro('Escreve o comentário antes de enviar.'); return }
    setEnviando(true); setErro('')
    const { data, error } = await supabase.rpc('reuniao_feedback_enviar', {
      p_token: token,
      p_nome: n,
      p_comentario: c,
      p_tipo: tipo || null,
      p_user_agent: navigator.userAgent.slice(0, 300),
    })
    setEnviando(false)
    const ok = !error && (data as { ok?: boolean } | null)?.ok === true
    if (!ok) {
      setErro('Não consegui enviar agora. Tenta de novo em instantes.')
      return
    }
    localStorage.setItem(LS_NOME, n)
    setEnviado(true)
  }

  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <p className="text-[13px] text-ink-muted">Carregando…</p>
      </div>
    )
  }

  // Token errado, apagado ou reunião excluída — sem detalhe do que existe.
  if (!reuniao) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-8 text-center">
          <h1 className="text-lg font-bold text-ink mb-2">Link inválido ou expirado</h1>
          <p className="text-[13px] text-ink-muted">Peça o link novo pra quem conduziu a reunião.</p>
          <p className="mt-6 text-xs font-semibold tracking-widest text-ink-faint">BRANORTE</p>
        </div>
      </div>
    )
  }

  if (enviado) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-md bg-surface border border-border rounded-2xl p-8 text-center">
          <div className="h-16 w-16 rounded-full bg-accent/10 mx-auto flex items-center justify-center mb-4">
            <span className="text-accent text-3xl">✓</span>
          </div>
          <h1 className="text-xl font-bold text-ink mb-2">Recebido, {nome.trim().split(/\s+/)[0]}!</h1>
          <p className="text-[13px] text-ink-muted">
            Seu comentário já apareceu na reunião. Obrigado por escrever. 🙏
          </p>
          <button
            type="button"
            onClick={() => { setEnviado(false); setComentario(''); setTipo('') }}
            className="mt-5 text-[13px] text-accent font-medium hover:underline"
          >
            Quero acrescentar mais uma coisa →
          </button>
          <p className="mt-6 text-xs font-semibold tracking-widest text-ink-faint">BRANORTE</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-bg py-6 px-4">
      <div className="w-full max-w-lg mx-auto">
        {/* Cabeçalho — que reunião é esta */}
        <div className="text-center mb-5">
          <p className="text-xs font-semibold tracking-widest text-accent mb-2">BRANORTE</p>
          <h1 className="text-xl font-bold text-ink leading-snug">{reuniao.titulo}</h1>
          <p className="text-[12px] text-ink-faint mt-1">{fmtData(reuniao.data_reuniao)}</p>
        </div>

        {/* Contexto: a pauta tratada e a ata. Some quando está vazio — card com
            "nada aqui" só ocupa a tela do celular. */}
        {reuniao.pauta.length > 0 && (
          <div className="bg-surface border border-border rounded-2xl p-5 mb-3">
            <h2 className="text-[12px] font-bold text-ink-muted uppercase tracking-wide mb-2.5">Pauta tratada</h2>
            <ul className="space-y-1.5">
              {reuniao.pauta.map((p, i) => (
                <li key={i} className="flex gap-2 text-[13px] text-ink leading-relaxed">
                  <span className="text-accent shrink-0">•</span>
                  <span>{p.texto}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {reuniao.resumo.trim() && (
          <div className="bg-surface border border-border rounded-2xl p-5 mb-3">
            <h2 className="text-[12px] font-bold text-ink-muted uppercase tracking-wide mb-2.5">O que ficou decidido</h2>
            <p className="text-[13px] text-ink leading-relaxed whitespace-pre-wrap">{reuniao.resumo}</p>
          </div>
        )}

        {/* O formulário */}
        <div className="bg-surface border border-border rounded-2xl p-5">
          <h2 className="text-[15px] font-bold text-ink mb-1">Ficou alguma sugestão?</h2>
          <p className="text-[12.5px] text-ink-muted mb-4">
            Escreve aqui o que você mudaria, o que faltou tratar ou o que quer acrescentar. Vai direto pra reunião.
          </p>

          <label className="block text-[13px] font-medium text-ink mb-1.5">Seu nome</label>
          <input
            value={nome}
            onChange={e => { setNome(e.target.value); setErro('') }}
            placeholder="Como você assina"
            className="w-full px-3 py-2.5 mb-4 rounded-lg bg-bg border border-border text-ink text-[14px] placeholder:text-ink-faint outline-none focus:border-accent"
          />

          <label className="block text-[13px] font-medium text-ink mb-2">
            É sobre o quê? <span className="text-ink-faint font-normal">(opcional)</span>
          </label>
          <div className="flex flex-wrap gap-2 mb-4">
            {TIPOS.map(t => (
              <button
                key={t}
                type="button"
                onClick={() => setTipo(tipo === t ? '' : t)}
                className={
                  'px-3 py-1.5 rounded-full text-[13px] border transition-colors ' +
                  (tipo === t
                    ? 'bg-accent text-white border-accent'
                    : 'bg-bg text-ink-muted border-border hover:border-accent')
                }
              >
                {t}
              </button>
            ))}
          </div>

          <label className="block text-[13px] font-medium text-ink mb-1.5">Seu comentário</label>
          <textarea
            value={comentario}
            onChange={e => { setComentario(e.target.value); setErro('') }}
            rows={5}
            maxLength={4000}
            placeholder="Pode ser direto — o que funcionaria melhor, o que atrapalha no dia a dia, o que ficou faltando decidir…"
            className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border text-ink text-[14px] leading-relaxed placeholder:text-ink-faint outline-none focus:border-accent resize-y"
          />

          {erro && <p className="text-[13px] text-danger mt-3 text-center">{erro}</p>}

          <button
            type="button"
            onClick={enviar}
            disabled={enviando}
            className="w-full mt-4 py-3 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
          >
            {enviando ? 'Enviando…' : 'Enviar'}
          </button>
        </div>

        <p className="text-center text-[11px] text-ink-faint mt-5">Branorte · Adm de Reunião</p>
      </div>
    </div>
  )
}

export default ReuniaoFeedback
