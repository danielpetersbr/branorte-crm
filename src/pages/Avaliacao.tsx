import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'

// Página PÚBLICA (sem login) aberta pelo link que a extensão WA Sync envia ao
// cliente após fechar o atendimento. A extensão monta a URL como:
//   /avaliacao?vendedor=<NOME>&telefone=<whatsapp do cliente>
// Aqui o cliente dá a NOTA (1-5 estrelas) + nome + comentário; salvamos em
// public.atendimento_avaliacoes (RLS: anon só INSERT).

const MOTIVOS = ['Demora no retorno', 'Faltou informação', 'Preço', 'Não resolveu', 'Atendimento'] as const

function tituloNome(s: string) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')
}

export function Avaliacao() {
  const [params] = useSearchParams()
  const vendedor = (params.get('vendedor') || '').trim()
  const telefone = (params.get('telefone') || '').trim()
  const consultor = vendedor ? tituloNome(vendedor) : 'nosso consultor'

  const [nota, setNota] = useState(0)
  const [hover, setHover] = useState(0)
  const [nome, setNome] = useState('')
  const [comentario, setComentario] = useState('')
  const [motivo, setMotivo] = useState('')
  const [enviando, setEnviando] = useState(false)
  const [enviado, setEnviado] = useState(false)
  const [erro, setErro] = useState('')

  const notaBaixa = nota > 0 && nota <= 2
  const legenda = ['', 'Péssimo', 'Ruim', 'Ok', 'Bom', 'Excelente'][hover || nota] || ''

  async function enviar() {
    if (nota < 1) {
      setErro('Toque numa estrela pra dar sua nota 🙂')
      return
    }
    setEnviando(true)
    setErro('')
    const { error } = await supabase.from('atendimento_avaliacoes').insert({
      vendedor_nome: vendedor || null,
      telefone: telefone || null,
      cliente_nome: nome.trim() || null,
      nota,
      comentario: comentario.trim() || null,
      motivo: notaBaixa ? (motivo || null) : null,
      origem: 'extensao',
      user_agent: navigator.userAgent.slice(0, 300),
    })
    setEnviando(false)
    if (error) {
      setErro('Não consegui enviar agora. Tente de novo em instantes.')
      return
    }
    setEnviado(true)
  }

  if (enviado) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
        <div className="w-full max-w-md bg-surface-1 border border-border rounded-2xl p-8 text-center">
          <div className="h-16 w-16 rounded-full bg-accent/10 mx-auto flex items-center justify-center mb-4">
            <span className="text-accent text-3xl">✓</span>
          </div>
          <h1 className="text-xl font-bold text-ink mb-2">Obrigado pela avaliação!</h1>
          <p className="text-sm text-ink-muted">
            Sua opinião ajuda a Branorte a melhorar o atendimento. 🙏
          </p>
          <p className="mt-6 text-xs font-semibold tracking-widest text-ink-faint">BRANORTE</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-md bg-surface-1 border border-border rounded-2xl p-6 sm:p-8">
        <div className="text-center mb-6">
          <p className="text-xs font-semibold tracking-widest text-accent mb-3">BRANORTE</p>
          <h1 className="text-xl font-bold text-ink leading-snug">
            Como foi seu atendimento{vendedor ? <> com <span className="text-accent">{consultor}</span></> : null}?
          </h1>
          <p className="text-sm text-ink-muted mt-1">Leva menos de 10 segundos.</p>
        </div>

        {/* Estrelas — a NOTA */}
        <div className="flex flex-col items-center mb-6">
          <div className="flex gap-1" onMouseLeave={() => setHover(0)}>
            {[1, 2, 3, 4, 5].map(n => (
              <button
                key={n}
                type="button"
                aria-label={`${n} estrela${n > 1 ? 's' : ''}`}
                onClick={() => { setNota(n); setErro('') }}
                onMouseEnter={() => setHover(n)}
                className="text-4xl sm:text-5xl leading-none px-1 transition-transform active:scale-95"
              >
                <span className={(hover || nota) >= n ? 'text-accent' : 'text-ink-faint'}>★</span>
              </button>
            ))}
          </div>
          <span className="h-5 mt-1 text-sm font-medium text-ink-muted">{legenda}</span>
        </div>

        {/* Motivo (só quando nota baixa) */}
        {notaBaixa && (
          <div className="mb-4">
            <label className="block text-sm font-medium text-ink mb-2">O que faltou?</label>
            <div className="flex flex-wrap gap-2">
              {MOTIVOS.map(m => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMotivo(motivo === m ? '' : m)}
                  className={
                    'px-3 py-1.5 rounded-full text-sm border transition-colors ' +
                    (motivo === m
                      ? 'bg-accent text-white border-accent'
                      : 'bg-bg text-ink-muted border-border hover:border-accent')
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Nome */}
        <div className="mb-4">
          <label className="block text-sm font-medium text-ink mb-1.5">Seu nome</label>
          <input
            value={nome}
            onChange={e => setNome(e.target.value)}
            placeholder="Como podemos te chamar?"
            className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border text-ink placeholder:text-ink-faint outline-none focus:border-accent"
          />
        </div>

        {/* Comentário */}
        <div className="mb-5">
          <label className="block text-sm font-medium text-ink mb-1.5">
            Comentário <span className="text-ink-faint font-normal">(opcional)</span>
          </label>
          <textarea
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            rows={3}
            placeholder="Conte como foi a sua experiência…"
            className="w-full px-3 py-2.5 rounded-lg bg-bg border border-border text-ink placeholder:text-ink-faint outline-none focus:border-accent resize-none"
          />
        </div>

        {erro && <p className="text-sm text-red-500 mb-3 text-center">{erro}</p>}

        <button
          type="button"
          onClick={enviar}
          disabled={enviando}
          className="w-full py-3 rounded-lg bg-accent text-white font-semibold hover:opacity-90 disabled:opacity-60 transition-opacity"
        >
          {enviando ? 'Enviando…' : 'Enviar avaliação'}
        </button>
      </div>
    </div>
  )
}

export default Avaliacao
