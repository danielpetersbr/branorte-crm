// Rota /print/orcamento — usada APENAS pelo Puppeteer server-side (api/gerar-pdf.ts)
// pra renderizar o OrcamentoPreview em alta fidelidade e imprimir como PDF vetorial.
//
// Os dados do orçamento vêm injetados em window.__BRANORTE_PRINT__ pelo Puppeteer
// via page.evaluateOnNewDocument() ANTES do navigate. Sem auth, sem chrome do app.

import { useEffect, useLayoutEffect, useState } from 'react'
import { OrcamentoPreview, type OrcamentoPreviewProps } from '@/components/OrcamentoPreview'

declare global {
  interface Window {
    __BRANORTE_PRINT__?: OrcamentoPreviewProps
    __BRANORTE_PRINT_READY__?: boolean
  }
}

export default function PrintOrcamento() {
  const [props, setProps] = useState<OrcamentoPreviewProps | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  // FORÇA LIGHT MODE: se .dark estiver no <html>, body fica quase preto
  // (CSS var --bg). Faixas pretas aparecem nas margens da pg PDF onde
  // conteúdo (que é branco) não cobre. useLayoutEffect roda ANTES do paint
  // pra evitar flash de dark.
  useLayoutEffect(() => {
    document.documentElement.classList.remove('dark')
    document.documentElement.style.colorScheme = 'light'
    document.body.style.background = '#ffffff'
    document.documentElement.style.background = '#ffffff'
  }, [])

  useEffect(() => {
    // Tenta ler imediatamente. Se não tiver, faz polling por 5s
    // (Puppeteer injeta via evaluateOnNewDocument, então sempre chega antes do mount).
    let tentativas = 0
    const tick = () => {
      const data = window.__BRANORTE_PRINT__
      if (data) {
        setProps(data)
        return
      }
      tentativas++
      if (tentativas > 50) {
        setErro('window.__BRANORTE_PRINT__ não foi injetado em 5s')
        return
      }
      setTimeout(tick, 100)
    }
    tick()
  }, [])

  // Sinaliza pro Puppeteer que terminou de renderizar (aguarda fonts + imagens).
  // Puppeteer faz waitForFunction(() => window.__BRANORTE_PRINT_READY__).
  useEffect(() => {
    if (!props) return
    Promise.all([
      document.fonts?.ready,
      ...Array.from(document.images).map(img => {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve()
        return new Promise<void>(resolve => {
          img.addEventListener('load', () => resolve(), { once: true })
          img.addEventListener('error', () => resolve(), { once: true })
        })
      }),
    ]).then(() => {
      // Pequeno delay extra pra garantir paint
      setTimeout(() => { window.__BRANORTE_PRINT_READY__ = true }, 200)
    })
  }, [props])

  if (erro) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif', color: '#dc2626' }}>{erro}</div>
  }

  if (!props) {
    return <div style={{ padding: 40, fontFamily: 'sans-serif' }}>Aguardando dados do orçamento…</div>
  }

  return (
    <div style={{ background: '#ffffff', minHeight: '100vh' }}>
      <style>{`
        /* CRÍTICO: html/body com fundo BRANCO PURO. Sem isso, o CSS var
           --bg do .dark vaza pras margens do PDF e aparecem faixas pretas
           no topo/rodapé onde o conteúdo do orçamento não cobre. */
        html, body {
          background: #ffffff !important;
          color: #111827 !important;
          color-scheme: light !important;
        }
        @page {
          size: A4;
          margin: 8mm 6mm 12mm 6mm;
          background: #ffffff;
        }
        /* Sem @media print — aplica SEMPRE (Puppeteer renderiza em modo print) */
        [data-no-break] {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        img {
          break-inside: avoid !important;
          page-break-inside: avoid !important;
        }
        /* Cada item do orçamento */
        .group.relative.border {
          break-inside: avoid;
          page-break-inside: avoid;
        }
        /* Foto principal: força quebra de página DEPOIS */
        .foto-principal-hero {
          break-after: page !important;
          page-break-after: always !important;
        }
        /* Itens começam numa nova página quando tem foto principal */
        .itens-apos-hero {
          break-before: page !important;
          page-break-before: always !important;
        }
      `}</style>
      <OrcamentoPreview {...props} renderMode={true} />
    </div>
  )
}
