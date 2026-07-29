import { useEffect, useState } from 'react'
import { X, Loader2, Send, AlertTriangle, Mic, MessageSquare } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { Button } from '@/components/ui/Button'
import {
  RITMOS,
  useVendedorAtual,
  useSequenciasDisponiveis,
  useCriarCampanha,
  useMudarStatusCampanha,
  type Ritmo,
} from '@/hooks/useCampanhas'

interface Props {
  open: boolean
  alvos: { telefone: string; nome: string | null }[]
  origemFiltro?: Record<string, unknown>
  onClose: () => void
  onCriada: () => void
}

export function NovaCampanhaModal({ open, alvos, origemFiltro, onClose, onCriada }: Props) {
  const { data: vendedor, isLoading: carregandoVendedor } = useVendedorAtual()
  const { data: sequencias = [], isLoading: carregandoSeqs } = useSequenciasDisponiveis(vendedor)
  const criar = useCriarCampanha()
  const mudarStatus = useMudarStatusCampanha()

  const [titulo, setTitulo] = useState('')
  const [sequenciaId, setSequenciaId] = useState('')
  const [ritmo, setRitmo] = useState<Ritmo>('cauteloso')
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setErro(null)
    setTitulo(`Chamada ${new Date().toLocaleDateString('pt-BR')}`)
    setSequenciaId('')
    setRitmo('cauteloso')
  }, [open])

  if (!open) return null

  const ritmoEscolhido = RITMOS.find(r => r.value === ritmo)!
  // Estimativa honesta de duração — é o número que faz o vendedor entender que
  // isso não é "mandar pra 300 pessoas agora".
  const minutosEstimados = Math.round((alvos.length / ritmoEscolhido.porHora) * 60)
  const duracao = minutosEstimados >= 60
    ? `${Math.floor(minutosEstimados / 60)}h${String(minutosEstimados % 60).padStart(2, '0')}`
    : `${minutosEstimados} min`

  const seqEscolhida = sequencias.find(s => s.id === sequenciaId)
  const podeEnviar = !!vendedor && !!sequenciaId && titulo.trim().length > 0 && alvos.length > 0 && !criar.isPending

  async function confirmar() {
    if (!vendedor) return
    setErro(null)
    try {
      const campanha = await criar.mutateAsync({
        vendedorNome: vendedor,
        titulo: titulo.trim(),
        sequenciaId,
        ritmo,
        alvos,
        origemFiltro,
      })
      // Nasce 'rascunho' e só aqui vira 'ativa' — não existe caminho em que
      // fechar o modal sem querer começa a disparar.
      await mudarStatus.mutateAsync({ id: campanha.id, status: 'ativa' })
      onCriada()
      onClose()
    } catch (e) {
      setErro(e instanceof Error ? e.message : 'Não consegui criar a campanha.')
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-bg border border-border rounded-xl max-w-lg w-full shadow-2xl flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center justify-between">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Chamar {alvos.length} cliente{alvos.length !== 1 ? 's' : ''}</h2>
            <p className="text-[11px] text-ink-faint">Sai do seu próprio WhatsApp, um de cada vez</p>
          </div>
          <button onClick={onClose} className="text-ink-faint hover:text-ink transition" aria-label="Fechar">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 py-4 overflow-y-auto flex flex-col gap-4">
          {carregandoVendedor ? (
            <div className="flex items-center gap-2 text-[12px] text-ink-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Identificando seu usuário...
            </div>
          ) : !vendedor ? (
            <div className="flex items-start gap-2 rounded-lg bg-danger-bg/40 border border-danger/30 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
              <p className="text-[12px] text-ink">
                Seu login não está ligado a um vendedor cadastrado, então eu não sei de qual WhatsApp
                mandar. Peça pro admin vincular seu usuário em Vendedores.
              </p>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
                  Nome da campanha
                </label>
                <Input value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ex: Retomada sem etiqueta" />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
                  O que enviar
                </label>
                {carregandoSeqs ? (
                  <div className="flex items-center gap-2 text-[12px] text-ink-muted py-2">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Carregando suas sequências...
                  </div>
                ) : sequencias.length === 0 ? (
                  <div className="rounded-lg bg-surface-2 border border-border px-3 py-2.5">
                    <p className="text-[12px] text-ink-muted">
                      Você ainda não tem nenhuma sequência salva. Monte uma no WhatsApp
                      (painel Branorte → aba <strong>Msgs</strong> → <strong>Sequências</strong>) e ela aparece aqui.
                      É lá que você grava o áudio e escolhe o tempo entre uma mensagem e outra.
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-52 overflow-y-auto">
                    {sequencias.map(s => (
                      <button
                        key={s.id}
                        onClick={() => setSequenciaId(s.id)}
                        className={`text-left px-3 py-2 rounded-lg border transition ${
                          sequenciaId === s.id
                            ? 'border-accent bg-accent/10'
                            : 'border-border bg-surface hover:bg-surface-2'
                        }`}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-medium text-ink truncate">{s.title}</span>
                          {s.temAudio && (
                            <span className="inline-flex items-center gap-0.5 text-[10px] text-emerald-600 shrink-0">
                              <Mic className="h-2.5 w-2.5" /> áudio
                            </span>
                          )}
                        </div>
                        <span className="text-[11px] text-ink-faint">
                          {s.passos} mensagem{s.passos !== 1 ? 'ns' : ''}
                          {s.category ? ` · ${s.category}` : ''}
                        </span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
                  Ritmo
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {RITMOS.map(r => (
                    <button
                      key={r.value}
                      onClick={() => setRitmo(r.value)}
                      className={`px-3 py-2 rounded-lg border text-left transition ${
                        ritmo === r.value ? 'border-accent bg-accent/10' : 'border-border bg-surface hover:bg-surface-2'
                      }`}
                    >
                      <span className="block text-[13px] font-medium text-ink">{r.label}</span>
                      <span className="block text-[11px] text-ink-faint">{r.detalhe}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="rounded-lg bg-surface-2 border border-border px-3 py-2.5 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 text-[12px] text-ink">
                  <MessageSquare className="h-3.5 w-3.5 text-ink-faint shrink-0" />
                  <span>
                    {alvos.length} contato{alvos.length !== 1 ? 's' : ''} · leva cerca de <strong>{duracao}</strong>
                    {seqEscolhida && seqEscolhida.passos > 1 && ' (cada um recebe a sequência inteira)'}
                  </span>
                </div>
                <p className="text-[11px] text-ink-faint leading-relaxed">
                  Só dispara em dia útil, das 8h às 18h, com no máximo 150 contatos por dia. Fora
                  disso a fila espera sozinha. Você pode pausar quando quiser — o WhatsApp que manda
                  é o seu, então o ritmo é de propósito devagar.
                </p>
              </div>

              {erro && (
                <div className="flex items-start gap-2 rounded-lg bg-danger-bg/40 border border-danger/30 px-3 py-2">
                  <AlertTriangle className="h-4 w-4 text-danger shrink-0 mt-0.5" />
                  <p className="text-[12px] text-ink">{erro}</p>
                </div>
              )}
            </>
          )}
        </div>

        <div className="px-5 py-3.5 border-t border-border flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button onClick={confirmar} disabled={!podeEnviar}>
            {criar.isPending
              ? <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Criando...</>
              : <><Send className="h-3.5 w-3.5" /> Começar a chamar</>}
          </Button>
        </div>
      </div>
    </div>
  )
}
