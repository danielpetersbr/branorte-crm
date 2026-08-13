// Peças de UI das seções recolhíveis. Estado e persistência ficam em
// @/hooks/useSecaoRecolhivel — aqui é só o desenho.
//
// Duas formas de usar:
//
// 1) Card que já existe (o título vira o gatilho, o resto do Card você esconde):
//      const sec = useSecaoRecolhivel('disparos.funil')
//      <TituloRecolhivel secao={sec} icone={<GitBranch/>} resumo="3 de 9 ligados">
//        Automação do Funil
//      </TituloRecolhivel>
//      {sec.aberta && <>...corpo...</>}
//
// 2) Bloco que já desenha o próprio Card (só quero a barra em cima):
//      <SecaoRecolhivel id="disparos.escritorio" titulo="Escritório" icone={<Building2/>}>
//        <EscritorioMapa ... />
//      </SecaoRecolhivel>

import type { ReactNode } from 'react'
import { ChevronDown, ChevronsDownUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useSecaoRecolhivel, useTodasAsSecoes } from '@/hooks/useSecaoRecolhivel'

export type Secao = { aberta: boolean; alternar: () => void }

/**
 * Título de seção que recolhe ao clicar. Mantém a cara do h2 que já existia nos
 * Cards (text-sm font-semibold) e só acrescenta a setinha na frente.
 * `resumo` aparece somente quando está recolhida — pra não fechar às cegas.
 * `nivel` existe pra não quebrar a hierarquia: sub-bloco dentro de um Card que
 * já tem h2 deve usar h3.
 */
export function TituloRecolhivel({
  secao,
  icone,
  resumo,
  children,
  className,
  nivel: Tag = 'h2',
}: {
  secao: Secao
  icone?: ReactNode
  resumo?: ReactNode
  children: ReactNode
  className?: string
  nivel?: 'h2' | 'h3'
}) {
  return (
    <Tag className={cn('text-sm font-semibold text-ink flex items-center gap-2 flex-wrap', className)}>
      <button
        type="button"
        onClick={secao.alternar}
        aria-expanded={secao.aberta}
        title={secao.aberta ? 'Recolher esta seção' : 'Abrir esta seção'}
        // -mx/px/py: aumenta o alvo de clique e dá fundo no hover sem deslocar o
        // texto — antes era uma tira de ~20px sem resposta visual nenhuma.
        className="group flex items-center gap-2 text-left -mx-1.5 -my-1 px-1.5 py-1 rounded-md transition-colors hover:bg-surface-2 hover:text-accent"
      >
        <ChevronDown
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ink-faint transition-all duration-150 group-hover:text-accent',
            !secao.aberta && '-rotate-90',
          )}
        />
        {icone}
        <span>{children}</span>
      </button>
      {!secao.aberta && resumo != null && (
        <span className="text-ink-faint font-normal text-[11px]">· {resumo}</span>
      )}
    </Tag>
  )
}

/**
 * Barra recolhível pra blocos que já vêm com Card próprio (Atividade Diária,
 * Escritório). Recolhido, o bloco nem é montado — as consultas dele param.
 */
export function SecaoRecolhivel({
  id,
  titulo,
  icone,
  resumo,
  defaultAberta = true,
  children,
}: {
  id: string
  titulo: ReactNode
  icone?: ReactNode
  resumo?: ReactNode
  defaultAberta?: boolean
  children: ReactNode
}) {
  const secao = useSecaoRecolhivel(id, defaultAberta)
  // Aberta, a faixa fica DISCRETA de propósito: o bloco logo abaixo já desenha o
  // próprio título (o EscritorioMapa tem "Escritório — quem senta em cada mesa"
  // com o mesmo ícone). Duas linhas gêmeas empilhadas pareciam erro de render.
  // Recolhida, ela é a única representação do bloco — aí vem ícone e resumo.
  return (
    <div>
      <div
        className={cn(
          'rounded-lg border bg-surface px-4',
          secao.aberta ? 'border-border/60 py-1.5 mb-1' : 'border-border py-2.5',
        )}
      >
        <TituloRecolhivel
          secao={secao}
          icone={secao.aberta ? undefined : icone}
          resumo={resumo}
          className={secao.aberta ? 'text-[11px] uppercase tracking-wider text-ink-faint font-semibold' : undefined}
        >
          {titulo}
        </TituloRecolhivel>
      </div>
      {secao.aberta && children}
    </div>
  )
}

/** "Recolher tudo / Abrir tudo" — vale pras seções montadas na tela atual. */
export function BotaoRecolherTudo({ className }: { className?: string }) {
  const { algumaAberta, definirTodas, total } = useTodasAsSecoes()
  if (total === 0) return null
  return (
    <button
      type="button"
      onClick={() => definirTodas(!algumaAberta)}
      title={
        algumaAberta
          ? 'Fecha todas as seções da tela (fica só o essencial)'
          : 'Abre todas as seções da tela'
      }
      className={cn(
        'shrink-0 inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg',
        'border border-border bg-surface-2 text-ink-muted hover:text-ink hover:border-border-strong transition-colors',
        className,
      )}
    >
      {algumaAberta ? (
        <>
          <ChevronsDownUp className="h-3.5 w-3.5" /> Recolher tudo
        </>
      ) : (
        <>
          <ChevronsUpDown className="h-3.5 w-3.5" /> Abrir tudo
        </>
      )}
    </button>
  )
}
