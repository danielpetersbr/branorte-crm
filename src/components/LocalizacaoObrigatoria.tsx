import { MapPin, Lock } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/hooks/useAuth'
import type { EstadoLocalizacao } from '@/hooks/useLocalizacaoObrigatoria'

/**
 * Tela que barra o uso do CRM até a pessoa permitir a localização.
 *
 * Duas telas em uma, porque os caminhos são diferentes:
 *  - ainda não decidiu ("prompt"): um botão dispara o popup do navegador;
 *  - já negou ("denied"): o navegador NÃO pergunta de novo — só resta ensinar
 *    onde reverter. Sem essa instrução, a pessoa fica presa e liga pro suporte.
 */
function metros(m: number | null) {
  if (m === null) return 'desconhecida'
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}

export function LocalizacaoObrigatoria({ estado }: { estado: EstadoLocalizacao }) {
  const { signOut, profile } = useAuth()
  const negado = estado.estado === 'denied'

  // Localizou, mas com raio maior que o exigido: o problema não é permissão,
  // é o aparelho não ter como se localizar direito. PC de mesa cabeado só tem
  // o IP — ligar o Wi-Fi (mesmo sem usar pra navegar) é o que mais ajuda.
  if (estado.precisaoRuim) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg px-4">
        <div className="max-w-md w-full text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mb-5">
            <MapPin className="w-7 h-7 text-warning" />
          </div>
          <h1 className="text-xl font-semibold text-ink">Localização imprecisa demais</h1>
          <p className="mt-3 text-[13px] text-ink-muted">
            Consegui te localizar num raio de{' '}
            <strong className="text-ink">{metros(estado.coords?.precisao_m ?? null)}</strong>, e o
            sistema exige no máximo{' '}
            <strong className="text-ink">{metros(estado.precisaoMaxima)}</strong>.
          </p>
          <div className="mt-4 text-[13px] text-ink-muted text-left space-y-1.5">
            <p className="text-center text-ink-faint">Para melhorar:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>
                <strong>Ligue o Wi-Fi</strong> do computador, mesmo que use cabo para navegar — é
                o que mais melhora a precisão.
              </li>
              <li>No celular, ligue a localização/GPS do aparelho.</li>
              <li>Se estiver com VPN, desligue.</li>
            </ul>
          </div>
          <div className="mt-5">
            <Button variant="primary" onClick={estado.pedir} loading={estado.estado === 'checando'}>
              <MapPin className="w-3.5 h-3.5" />
              Tentar de novo
            </Button>
          </div>
          {profile?.email && (
            <p className="mt-6 text-[11px] text-ink-faint">Conectado como {profile.email}</p>
          )}
          <div className="mt-3">
            <Button variant="ghost" size="sm" onClick={() => void signOut()}>
              Sair
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-bg px-4">
      <div className="max-w-md w-full text-center">
        <div className="mx-auto w-14 h-14 rounded-full bg-surface-2 flex items-center justify-center mb-5">
          {negado ? (
            <Lock className="w-7 h-7 text-warning" />
          ) : (
            <MapPin className="w-7 h-7 text-accent" />
          )}
        </div>

        <h1 className="text-xl font-semibold text-ink">
          {negado ? 'Localização bloqueada no navegador' : 'Permita o acesso à localização'}
        </h1>

        {negado ? (
          <div className="mt-3 text-[13px] text-ink-muted space-y-3 text-left">
            <p className="text-center">
              O navegador guardou o bloqueio e não vai perguntar de novo. Para liberar:
            </p>
            <ol className="list-decimal pl-5 space-y-1.5">
              <li>
                Clique no <strong>cadeado</strong> (ou no ícone à esquerda do endereço, no alto da
                tela).
              </li>
              <li>
                Procure <strong>Localização</strong> e mude para <strong>Permitir</strong>.
              </li>
              <li>Recarregue a página.</li>
            </ol>
            <p className="text-center text-ink-faint">
              No celular: menu do navegador → Configurações do site → Localização.
            </p>
          </div>
        ) : (
          <>
            <p className="mt-3 text-[13px] text-ink-muted">
              O acesso ao sistema é registrado com a localização do dispositivo. Clique abaixo e
              confirme <strong>Permitir</strong> na janela do navegador.
            </p>
            <div className="mt-5">
              <Button variant="primary" onClick={estado.pedir}>
                <MapPin className="w-3.5 h-3.5" />
                Permitir localização
              </Button>
            </div>
            {estado.estado === 'erro' && (
              <p className="mt-3 text-[12px] text-danger">
                Não consegui obter a localização. Verifique se o GPS/localização do aparelho está
                ligado e tente de novo.
              </p>
            )}
          </>
        )}

        {profile?.email && (
          <p className="mt-6 text-[11px] text-ink-faint">Conectado como {profile.email}</p>
        )}
        <div className="mt-3">
          <Button variant="ghost" size="sm" onClick={() => void signOut()}>
            Sair
          </Button>
        </div>
      </div>
    </div>
  )
}
