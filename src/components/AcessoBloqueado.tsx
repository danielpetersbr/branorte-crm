import { Clock, Boxes, FileText } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import { useCan } from '@/hooks/usePermissions'
import type { EstadoBloqueio } from '@/hooks/useAcesso'

const NOMES_DIA = ['', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom']

function hhmm(h: string) {
  return h.slice(0, 5)
}

function resumoDias(dias: number[]) {
  if (!dias?.length) return ''
  const ordenados = [...dias].sort((a, b) => a - b)
  const uteis = [1, 2, 3, 4, 5]
  if (ordenados.length === 5 && uteis.every(d => ordenados.includes(d))) return 'de segunda a sexta'
  return ordenados.map(d => NOMES_DIA[d]).join(', ')
}

/**
 * Tela mostrada a quem tenta usar o sistema fora da janela permitida.
 *
 * Dizer QUAL é o horário é obrigatório: bloqueio mudo vira chamado de suporte
 * ("não consigo entrar") — foi exatamente o que aconteceu no Controle de
 * Produção, onde a conta nascia inativa sem explicação nenhuma.
 */
export function AcessoBloqueado({ estado }: { estado: EstadoBloqueio }) {
  const { signOut, profile } = useAuth()
  const can = useCan()
  const navigate = useNavigate()
  const j = estado.janela
  // Fora de hora, o Fazedor de Layout pode estar liberado (janela própria da rota).
  // Damos a entrada aqui — senão a pessoa fica presa nesta tela sem menu.
  const podeLayout = can('menu.projeto_3d')
  const podeOrcamento = can('menu.orcamentos')

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mb-5">
          <Clock className="w-7 h-7 text-warning" />
        </div>

        <h1 className="text-xl font-semibold text-ink">Fora do horário de acesso</h1>

        <p className="mt-3 text-ink-muted">
          {j ? (
            <>
              Seu acesso está liberado{' '}
              <span className="font-medium text-ink">
                {resumoDias(j.dias)}, das {hhmm(j.hora_inicio)} às {hhmm(j.hora_fim)}
              </span>
              .
            </>
          ) : (
            <>Seu acesso está restrito a um horário definido pela administração.</>
          )}
        </p>

        <p className="mt-2 text-[13px] text-ink-faint">
          Precisa entrar agora? Fale com o administrador para liberar.
        </p>

        {(podeLayout || podeOrcamento) && (
          <div className="mt-6 flex flex-col items-center gap-2">
            {podeLayout && (
              <Button onClick={() => navigate('/projeto-3d')} className="inline-flex items-center gap-2">
                <Boxes className="w-4 h-4" />
                Abrir o Fazedor de Layout
              </Button>
            )}
            {podeOrcamento && (
              <Button onClick={() => navigate('/orcamentos/montar')} className="inline-flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Fazer Orçamento
              </Button>
            )}
            <p className="mt-1 text-[11px] text-ink-faint">Liberado pra você a qualquer hora.</p>
          </div>
        )}

        {profile?.email && (
          <p className="mt-6 text-[11px] text-ink-faint">Conectado como {profile.email}</p>
        )}

        <div className="mt-4">
          <Button variant="secondary" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  )
}
