/**
 * ORGANIZAÇÃO DE VIAGEM — página própria, no menu abaixo de "Mapa de Visitas".
 *
 * Nasceu como um bloco DENTRO do /mapa-visitas e estava errado ali: aquela tela
 * já carrega filtros, painel de valor por estado, os 2.344 pinos e o planejador
 * aberto na lateral. Um bloco a mais embaixo virava rodapé que ninguém abre — e
 * este trabalho não é do mapa: é o vaivém com o vendedor, que dura dias e é o
 * que decide se a viagem sai ou não.
 *
 * Montar o roteiro continua no mapa (é lá que se escolhe pino). Acompanhar a
 * confirmação é aqui.
 */
import { useNavigate } from 'react-router-dom'
import { OrganizacaoViagem } from '@/components/mapa/OrganizacaoViagem'

export function OrganizacaoViagemPage() {
  const navigate = useNavigate()

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-3 py-4 sm:px-4">
      <header>
        <h1 className="text-lg font-bold text-ink">Organização de viagem</h1>
        <p className="text-[12.5px] text-ink-muted">
          As viagens salvas esperando o vendedor confirmar a data com o cliente e mandar a
          localização exata da propriedade. Enquanto uma parada estiver no centro da cidade,
          a rota sai errada.
        </p>
      </header>

      {/* Abrir no planejador leva de volta pro mapa com a viagem carregada — é lá
          que se mexe em parada, porque é lá que estão os pinos. */}
      <OrganizacaoViagem
        onAbrirViagem={id => navigate(`/mapa-visitas?viagem=${encodeURIComponent(id)}`)}
        semMoldura
      />
    </div>
  )
}
