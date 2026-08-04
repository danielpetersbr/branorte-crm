/**
 * Barra de ações do estudo de produção própria.
 *
 * Ela divide a MESMA LINHA com as abas (ver `.vr-topo` no venda-racao.css).
 * Antes eram duas fileiras empilhadas — abas em cima, seis botões embaixo — e
 * o topo da tela virava uma parede antes do formulário começar. A hierarquia
 * que faz caber tudo numa linha:
 *
 *   primário    → Calcular viabilidade (é o que fecha a conta e troca de vista)
 *   secundários → Salvar, Gerar PDF, WhatsApp — SÓ ÍCONE, com tooltip e
 *                 aria-label. Continuam a um clique; o que sumiu foi o rótulo.
 *   "Mais ações" → Revisar premissas, Duplicar, Novo estudo
 *
 * "Apresentar ao cliente" FOI EMBORA: ele era `setAba('apresentacao')`, exatamente
 * o que a aba "Apresentação do estudo" — ao lado dele na mesma barra — já fazia.
 * A checagem de pendências que ele carregava passou pro clique da aba, senão
 * o vendedor abriria a apresentação furada e só descobriria na frente do cliente.
 *
 * O que foi pro menu é o que o vendedor usa uma vez por estudo (ou nem isso).
 * "Novo estudo" em particular estava a um clique de distância de "Gerar PDF" e
 * limpa o formulário inteiro — esconder num menu é também uma proteção.
 *
 * Sem biblioteca de menu: é um popover de três itens, não vale um Radix. O
 * comportamento segue o padrão APG de `menu button` — um único tab stop no
 * gatilho, setas navegam dentro, Escape fecha e devolve o foco.
 */
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  Calculator, Copy, FilePlus2, ListChecks, Loader2, MessageCircle,
  MoreHorizontal, Printer, Save,
} from 'lucide-react'

export interface BarraAcoesProps {
  /** Ação principal — fecha a conta e leva pro resultado. */
  onCalcular: () => void
  onSalvar: () => void
  onGerarPdf: () => void
  onWhatsApp: () => void
  onRevisarPremissas: () => void
  onDuplicar: () => void
  onNovoEstudo: () => void
  /** Mutation em voo: trava o botão de salvar e liga o "Salvando…". */
  salvando: boolean
  /** Quando o último salvamento foi concluído. `null` = nunca salvou nesta sessão. */
  salvoEm: Date | null
  /** Já existe linha no banco? Muda o rótulo entre "alterações" e "rascunho". */
  estudoSalvo?: boolean
  /** Canto direito da barra (código do estudo + seletor de status). */
  extra?: ReactNode
}

interface ItemMenu {
  chave: string
  label: string
  icone: typeof Copy
  onClick: () => void
}

export function BarraAcoes({
  onCalcular, onSalvar, onGerarPdf, onWhatsApp,
  onRevisarPremissas, onDuplicar, onNovoEstudo,
  salvando, salvoEm, estudoSalvo = false, extra,
}: BarraAcoesProps) {
  const [aberto, setAberto] = useState(false)
  /**
   * Índice do item com foco. -1 = menu aberto no clique do mouse, o foco ficou
   * no gatilho. Guardar isso em estado (e não só chamar .focus()) é o que
   * permite as setas circularem sem consultar o document.activeElement.
   */
  const [foco, setFoco] = useState(-1)

  const caixaRef = useRef<HTMLDivElement>(null)
  const gatilhoRef = useRef<HTMLButtonElement>(null)
  const itensRef = useRef<Array<HTMLButtonElement | null>>([])
  const idMenu = useId()

  const itens: ItemMenu[] = [
    { chave: 'premissas', label: 'Revisar premissas', icone: ListChecks, onClick: onRevisarPremissas },
    { chave: 'duplicar', label: 'Duplicar estudo', icone: Copy, onClick: onDuplicar },
    { chave: 'novo', label: 'Novo estudo', icone: FilePlus2, onClick: onNovoEstudo },
  ]

  const fechar = (devolverFoco = true) => {
    setAberto(false)
    setFoco(-1)
    // Devolver o foco ao gatilho é obrigatório: sem isso o foco vai pro <body>
    // e quem navega por teclado recomeça do topo da página.
    if (devolverFoco) gatilhoRef.current?.focus()
  }

  const abrir = (indice: number) => {
    setAberto(true)
    setFoco(indice)
  }

  // Fechar ao clicar fora e no Escape.
  //
  // `mousedown` e não `click`: o clique que fecha costuma cair em cima de outro
  // botão, e com `click` o menu só sumiria depois que o outro botão já tivesse
  // disparado — o usuário vê o menu piscando por cima da ação.
  //
  // O Escape mora no document (e não no onKeyDown da caixa) pra funcionar mesmo
  // se o foco tiver escapado do menu por algum caminho não previsto.
  useEffect(() => {
    if (!aberto) return
    const foraDaCaixa = (e: MouseEvent) => {
      if (caixaRef.current && !caixaRef.current.contains(e.target as Node)) {
        fechar(false)  // clicou fora: o foco é problema de quem recebeu o clique
      }
    }
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); fechar() }
    }
    document.addEventListener('mousedown', foraDaCaixa)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', foraDaCaixa)
      document.removeEventListener('keydown', escape)
    }
  }, [aberto])

  // Move o foco real pro item marcado. Roda depois do render, quando o <button>
  // do item já existe no DOM.
  useEffect(() => {
    if (aberto && foco >= 0) itensRef.current[foco]?.focus()
  }, [aberto, foco])

  const teclasDoGatilho = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()  // espaço rolaria a página
      abrir(0)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      abrir(itens.length - 1)  // seta pra cima abre pelo último, como no APG
    }
  }

  const teclasDoMenu = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setFoco(i => (i + 1) % itens.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setFoco(i => (i - 1 + itens.length) % itens.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setFoco(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setFoco(itens.length - 1)
    } else if (e.key === 'Tab') {
      // Tab sai do menu: fecha sem prender o foco, mas deixa o navegador seguir
      // pro próximo elemento naturalmente (por isso não devolve o foco).
      fechar(false)
    }
  }

  const escolher = (item: ItemMenu) => {
    fechar()
    item.onClick()
  }

  /**
   * Hora fixa em vez de "há 2 minutos": tempo relativo exigiria um setInterval,
   * e este componente vive numa tela onde cada render arrasta o formulário
   * inteiro junto. A hora do salvamento responde a mesma pergunta e não custa
   * nada.
   */
  const horaSalvo = salvoEm
    ? salvoEm.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null

  /** Tooltip e nome acessível do botão de salvar — carrega o estado inteiro. */
  const rotuloSalvar = salvando
    ? 'Salvando…'
    : horaSalvo
      ? `Salvo às ${horaSalvo} — salvar de novo`
      : estudoSalvo ? 'Salvar alterações' : 'Salvar rascunho'

  return (
    <div className="vr-acoes vr-no-print">
      <div className="vr-cta" style={{ marginTop: 0 }}>
        <button type="button" className="vr-btn primary" onClick={onCalcular}>
          <Calculator className="h-4 w-4" /> Calcular viabilidade
        </button>

        {/* SÓ ÍCONE daqui pra baixo. `title` dá o tooltip do mouse e `aria-label`
            dá o nome pro leitor de tela — sem os dois, um botão sem texto é um
            quadrado mudo.

            O ESTADO DO SALVAMENTO MORA AQUI DENTRO. Antes era um texto solto ao
            lado ("Alterações salvas às 14:32") que custava ~90px de uma linha de
            1076 — e ele só aparecia DEPOIS de salvar, ou seja, a barra cabia
            enquanto ninguém salvava e quebrava na hora que o vendedor salvava.
            Agora o ícone fica verde e a hora vai pro tooltip. */}
        <button
          type="button"
          className={`vr-btn ghost icone${horaSalvo && !salvando ? ' salvo' : ''}`}
          disabled={salvando}
          title={rotuloSalvar}
          aria-label={rotuloSalvar}
          onClick={onSalvar}
        >
          {salvando
            ? <Loader2 className="h-4 w-4 animate-spin" />
            : <Save className="h-4 w-4" />}
        </button>

        <button
          type="button"
          className="vr-btn ghost icone"
          title="Gerar PDF" aria-label="Gerar PDF"
          onClick={onGerarPdf}
        >
          <Printer className="h-4 w-4" />
        </button>

        <button
          type="button"
          className="vr-btn ghost icone"
          title="Enviar no WhatsApp" aria-label="Enviar no WhatsApp"
          onClick={onWhatsApp}
        >
          <MessageCircle className="h-4 w-4" />
        </button>

        {/* --------------------------------------------------- mais ações
            Estilo inline com os tokens --vr-*: o popover é o único bloco novo
            desta barra e não valia abrir mais um bloco no venda-racao.css. Como
            os tokens já viram no `.dark .vr`, o tema escuro sai de graça. */}
        <div ref={caixaRef} style={{ position: 'relative', display: 'inline-block' }}>
          <button
            ref={gatilhoRef}
            type="button"
            className="vr-btn ghost icone"
            title="Mais ações"
            aria-label="Mais ações"
            aria-haspopup="menu"
            aria-expanded={aberto}
            aria-controls={aberto ? idMenu : undefined}
            onClick={() => (aberto ? fechar() : abrir(-1))}
            onKeyDown={teclasDoGatilho}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {aberto && (
            <div
              id={idMenu}
              role="menu"
              aria-label="Mais ações do estudo"
              onKeyDown={teclasDoMenu}
              style={{
                position: 'absolute', top: 'calc(100% + 6px)', right: 0, zIndex: 40,
                minWidth: 226, padding: 5,
                background: 'var(--vr-card)',
                border: '1px solid var(--vr-hair)',
                borderRadius: 10,
                boxShadow: '0 10px 28px rgba(0,0,0,0.14)',
              }}
            >
              {itens.map((item, i) => (
                <button
                  key={item.chave}
                  ref={el => { itensRef.current[i] = el }}
                  type="button"
                  role="menuitem"
                  // Um único tab stop no conjunto (o gatilho). Dentro do menu a
                  // navegação é por setas — Tab tem que sair, não passear item a item.
                  tabIndex={-1}
                  onClick={() => escolher(item)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 9, width: '100%',
                    padding: '9px 11px', border: 0, borderRadius: 7,
                    background: foco === i ? 'var(--vr-green-l)' : 'transparent',
                    color: 'var(--vr-ink)',
                    font: '600 13px/1.2 inherit', textAlign: 'left', cursor: 'pointer',
                  }}
                  // Passar o mouse sincroniza o índice: sem isso o realce do
                  // teclado e o do mouse aparecem em itens diferentes ao mesmo tempo.
                  onMouseEnter={() => setFoco(i)}
                >
                  <item.icone className="h-4 w-4" style={{ color: 'var(--vr-ink60)', flexShrink: 0 }} />
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="vr-acoes-status">
        {/* O aviso de salvamento sumiu da tela mas NÃO da acessibilidade: quem
            usa leitor de tela não vê a cor do ícone nem passa o mouse pra ler o
            tooltip. Este span é invisível e só existe pro aria-live anunciar.
            `polite` pra não cortar a leitura em curso. */}
        <span aria-live="polite" className="vr-sr">
          {salvando ? 'Salvando…' : horaSalvo ? `Estudo salvo às ${horaSalvo}` : ''}
        </span>
        {extra}
      </div>
    </div>
  )
}

export default BarraAcoes
