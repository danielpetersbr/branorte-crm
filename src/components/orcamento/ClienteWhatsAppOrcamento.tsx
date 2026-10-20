import { useEffect, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import { toast } from 'sonner'
import type { useOrcamentosEtiquetas } from '@/hooks/useOrcamentosEtiquetas'
import { detalharEtiquetasOrcamento, etiquetaPrincipalOrcamento, type OrcamentoComFone } from '@/lib/orcamentos-etiquetas'
import { formatarTelefone } from '@/lib/wa-funil'

export type ConsultaEtiquetasOrcamento = Pick<ReturnType<typeof useOrcamentosEtiquetas>, 'data' | 'isPending' | 'error'>

type Cliente = OrcamentoComFone & { cliente_nome: string | null; numero: string }

export function ClienteWhatsAppOrcamento({ cliente }: { cliente: Cliente }) {
  const [copiado, setCopiado] = useState(false)
  // Copiar o número cadastrado, preservando DDI e nono dígito. O canônico é só para buscar etiquetas.
  const numero = (cliente.cliente_fone ?? '').replace(/\D/g, '')
  const nome = cliente.cliente_nome || 'Cliente sem nome'
  useEffect(() => {
    if (!copiado) return
    const timer = window.setTimeout(() => setCopiado(false), 1800)
    return () => window.clearTimeout(timer)
  }, [copiado])

  return (
    <div className="flex items-center gap-2 whitespace-nowrap">
        {numero ? <>
          <span className="font-mono text-xs select-text">{formatarTelefone(cliente.cliente_fone!)}</span>
          <button
            type="button"
            title={copiado ? 'Número copiado' : 'Copiar número do WhatsApp'}
            aria-label={`Copiar WhatsApp de ${nome}`}
            className="inline-flex min-h-[32px] min-w-[32px] items-center justify-center rounded border border-border bg-surface-2 text-ink-muted hover:text-accent focus-visible:ring-2 focus-visible:ring-accent"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(numero)
                setCopiado(true)
                toast.success('Número copiado')
              } catch {
                toast.error('Não foi possível copiar. Selecione o número e copie manualmente.')
              }
            }}
          >
            {copiado ? <Check className="h-3.5 w-3.5 text-accent" aria-hidden /> : <Copy className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </> : <span className="text-xs text-ink-faint">Sem número informado</span>}
    </div>
  )
}

export function EtiquetaPrincipalOrcamento({ cliente, etiquetas }: { cliente: Cliente; etiquetas: ConsultaEtiquetasOrcamento }) {
  if (!cliente.cliente_fone?.replace(/\D/g, '')) return <span className="text-xs text-ink-faint">Sem número</span>
  if (etiquetas.error) return <span className="text-xs text-danger">Etiquetas indisponíveis</span>
  if (etiquetas.isPending || !etiquetas.data) return <span className="text-xs text-ink-muted">Carregando…</span>
  const detalhe = detalharEtiquetasOrcamento(cliente, etiquetas.data.indice, etiquetas.data.catalogo)
  if (!detalhe.conversaLocalizada) return <span className="text-xs text-ink-faint" title="Conversa não localizada no WhatsApp sincronizado deste vendedor">Não sincronizado</span>
  const principal = etiquetaPrincipalOrcamento(detalhe.nomes)
  if (!principal) return <span className="text-xs text-ink-faint" title="Nenhuma etiqueta identificada na sincronização desta conversa">Sem etiqueta</span>
  return (
    <span aria-label={`Etiqueta principal: ${principal}`} title={detalhe.nomes.join(' · ')} className="inline-flex max-w-[220px] rounded-md border border-border bg-surface-2 px-2 py-1 text-xs font-medium text-ink-muted">
      {principal}
    </span>
  )
}
